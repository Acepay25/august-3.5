/**
 * chatTurnRunner — the Chart AI dock's chat orchestrator, extracted from
 * TradeChatPanel. Every function here is the service-shaped core of the
 * dock: it never touches JSX and reads/writes the conversation entirely
 * through the module store (chatStore) plus the deps object the shell hands
 * in — `createChatTurnRunner(deps)`.
 *
 * What lives here:
 * - `executePanelTool` — the desk-tool surface that touches the LIVE canvas
 *   (drawings, trade plans, the watch/schedule harness).
 * - `buildContextBlock` — the fresh market packet + on-screen + plans block
 *   every message rides (short-TTL cached per symbol).
 * - `runSeatTurn` — streams ONE seat's turn into its store entry.
 * - `maybeReviewSessions` — the fire-and-forget learning hooks after a send.
 * - `send` — the solo/panel turn orchestrator (also the RETRY path).
 * - `runFullAnalysis` — the ensemble pipeline launched from the dock.
 * - `runHarnessTurn` — one queued harness signal as a model turn.
 *
 * The panel shell keeps the session-store subscription, the UI state
 * (pickers, menus, drag), the header, the transcript render and the
 * composer. It rebuilds the runner with useMemo over the deps entries —
 * the same set `send`'s former dep array listed, with `effort`, `symbol`
 * and `interval` now explicit instead of arriving only transitively
 * through the intermediate useCallbacks.
 */

import type { LoggedTrade } from '../../types';
import type { Message } from '../../types/message';
import type { ProviderConfig } from '../../types/provider';
import type { ChatMessage, ContentPart } from '../providers/GenericProviderService';
import { streamChatWithDeskTools, type DeskToolCall, type DeskToolResult } from '../analysis/DeskToolsService';
import { fetchHybridData, generateHybridPromptInjection } from '../analysis/HybridIntelligenceService';
import { buildTradeChatContext, describeChartSnapshotForModel } from './tradeChatContext';
import {
    describeDrawingsForModel, drawingFromChartTool, drawingsFromLevelTool, type ChartDrawing,
} from './chartDrawings';
import { parseTradeProposal } from './proposedTrade';
import * as levelWatch from './levelWatchService';
import { describePlanForModel, staleLevelsAtArm, type WatchPlan } from './tradePlanLevels';
import { runAnalysisAsChatTurn } from './analysisTurn';
import { recordBotTurnOutcome } from '../agents/botLearning';
import * as watchService from './watchService';
import { parsePriceWatch, parseTimeWake, describeWatchesForModel } from './chartTriggers';
import { phtClock } from '../../utils/timezone';
import { ensureNotifyPermission } from '../infrastructure/notify';
import { recordSessionForReview, runSessionSkillReview, runThesisResolver, type ReviewableSession } from '../learning/sessionSkillReview';
import { runTraderLearner } from '../learning/traderLearner';
import {
    nudgeSupervisor, setSessionModel,
} from '../learning/skillSupervisor';
import { getActiveUsername } from '../../utils/activeUser';
import { baseOf, quoteOf } from '../../utils/symbol';
import { isPassReply } from '../agents/groupRounds';
import {
    titleFromMessage, PANEL_MAX_MODELS,
} from './chatSessions';
import * as chatStore from './chatStore';
import type { LiveEntry, LiveSession } from './chatStore';
import {
    panelSeats, planPanelTurn, formatRoomTranscript, parsePanelMentions, panelCouldStillBePass,
} from './chatPanel';
import { createDebateMailbox, formatDmEventLine } from '../analysis/DebateMailbox';
import type { ChartSnapshot } from '../../components/trade/TradingChart';
import { intervalSeconds } from '../../components/trade/TradingChart';
import type { AgentBot } from '../agents/agentRoster';
import { formatModelDisplayName } from '../../utils/providerUtils';
import { isVisionModel } from '../../utils/modelUtils';
import { splitThinkingFromOutput } from '../../utils/thinkingSplit';
import { TASK_BUDGETS } from '../providers/taskBudgets';
import { effortForTask, type ReasoningEffort } from '../providers/reasoningControls';
import type { Attachment } from '../../hooks/useChatAttachments';

/** Identity of a RUNNING model turn, captured the moment it starts. Every
 *  side-effect of a panel tool (proposal card attach, drawing persistence,
 *  level-watch arming) must resolve WHO IT BELONGS TO from this object —
 *  never from the panel's render-snapshot view state (`activeId`, or a
 *  shared "current entry" ref). A harness turn or a background session's
 *  turn keeps running while the user switches sessions/symbols; keying its
 *  output off the VIEWED session made proposals and drawings land in the
 *  wrong transcript (deep-dive 2026-09-15, per-turn identity class).
 *  Re-exported by TradeChatPanel so the canvas owner (TradeView) can
 *  persist against it too. */
export interface PanelTurnContext {
    /** The session the turn runs in. */
    sid: string;
    /** The streaming AI entry the turn writes into. */
    entryId: string;
    /** The chart the turn started under. */
    symbol: string;
    interval: string;
}

const TRADE_TOOLS = [
    'get_price_snapshot', 'get_order_book', 'get_derivatives',
    'get_liquidations', 'get_session_context', 'get_market_packet', 'get_all_timeframes', 'get_chart_view',
    'get_btc_context', 'recall', 'get_setup_history_stats', 'web_search', 'scan_setups',
    'project_future_price',
    // Market-wide discovery: grade the whole top-volume universe at once.
    'run_screener', 'run_monte_carlo',
    // Growth set: the model edits its own memory, skills and tools from here.
    'write_memory_note', 'get_notebook_map', 'propose_skill', 'revise_skill',
    'amend_memory', 'forge_tool', 'scan_chart_skills',
    // Chart-action set: the model draws on the live chart (levels, lines).
    'draw_on_chart', 'mark_trade_levels', 'clear_chart_drawings', 'present_trade',
    // Watch/schedule harness: real-time price triggers + time wake-ups.
    'watch_price', 'wake_me', 'cancel_watch',
    // Collaboration memory: this environment's MEMORY.md analogue — the model
    // maintains durable facts about the USER (index always loaded, bodies on demand).
    'remember', 'read_memory', 'forget',
    // Read-back for a clipped tool result. Without this the dock had no way to
    // recover a truncated result AND spillReceiptAllowed() suppressed the
    // receipt that would have named the loss, so a clipped chart read was a
    // dead end: the seat could not even learn it was holding part of a chart.
    // Anything that can be clipped must be able to be re-read.
    'read_tool_output',
];

/** An image the composer attached to this turn, in the shape the runner needs. */
type ScreenshotAttachment = { kind: string; payload: string };

/**
 * Attach a screenshot to a turn — or say plainly that this seat cannot see it.
 *
 * This lives in ONE place because the two callers used to disagree, and the
 * disagreement was invisible from the outside. The solo path built a real
 * `image_url` part. The panel path built a plain string and dropped the
 * attachment entirely, while offering the user the same camera button. So in a
 * multi-seat panel — the app's headline mode — the user clicked the camera,
 * saw the screenshot in their own bubble, and every seat answered blind. No
 * error, no notice, and every measurement you would naturally take (button
 * enabled, bubble renders, model replies) is identical across both states.
 *
 * The fallback is not decoration either: a seat that cannot see images must
 * be told, or it invents a confident read of a chart it never received. A
 * panel can mix vision and text-only seats, so this is decided PER SEAT.
 */
export const userContentWithImage = (
    text: string,
    attachment: ScreenshotAttachment | undefined,
    selectedModel: string,
): string | ContentPart[] => {
    if (!attachment) return text;
    if (isVisionModel(selectedModel)) {
        return [
            { type: 'text', text },
            { type: 'image_url', image_url: { url: attachment.payload } },
        ];
    }
    return `${text}\n\n[The user attached a chart screenshot but this model cannot see images.]`;
};

/** Cap on attached text file bulk handed to the prompt. */
const MAX_FILE_CHARS = 200_000;

/** Short-TTL cache of the slow hybrid-packet pull, keyed by symbol — lets a
 *  rapid follow-up question start the model without re-fetching. The market
 *  moves, so the window is deliberately tight. */
const PACKET_CACHE_MS = 8_000;
const packetCache = new Map<string, { markdown: string; atMs: number }>();
/** Test hook: drop cached packets so a test can observe the fetch path. */
export const __clearPacketCacheForTests = (): void => packetCache.clear();

const newId = (prefix: string): string => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

/** Everything the orchestrator needs from the panel shell, stated once.
 *  chatStore is imported directly (the module store — turn state is read
 *  FRESH at call time so a double-send inside one React tick still sees the
 *  run slot); React state setters, prop-driven config getters and the
 *  resolved provider objects ride in here. The shell rebuilds the runner
 *  with useMemo over exactly these entries. */
export interface ChatTurnRunnerDeps {
    /** The chart the panel is mounted under — stamped onto every turn
     *  context and every session write. */
    symbol: string;
    interval: string;
    /** The composer's thinking-effort choice (per-session shell state). */
    effort: ReasoningEffort | 'auto';
    /** The solo model selection — stamped onto the session on send. */
    selectedChatModel: string;
    /** Levels currently drawn on the chart, forwarded to the desk tools. */
    chartLevels?: { label: string; price: number }[];
    /** The user's own drawings PLUS the model's marks — what the model reads. */
    allDrawings: ChartDrawing[];
    /** The user's logged trades (desk-tool recall + learning hooks). */
    trades: LoggedTrade[];
    /** Plain-data snapshot of everything the canvas currently displays. */
    getChartSnapshot?: () => ChartSnapshot | null;
    /** The fallback provider (the composer's resolved selection). */
    provider: ProviderConfig | null;
    /** Resolve a `${providerId}:${modelId}` seat to a runnable config. */
    configForSeat: (providerId: string, modelId: string) => ProviderConfig | null;
    /** The system prompt every seat of this session answers under. */
    systemPromptFor: (bot?: AgentBot, roleNote?: string) => string;
    /** Roster bots (solo persona + panel agent seats). */
    bots: AgentBot[];
    /** The ACTIVE session id (runFullAnalysis reads it from the render —
     *  send and runHarnessTurn read the store fresh instead). */
    activeId: string;
    /** The composer draft — runFullAnalysis sends and clears it. */
    draft: string;
    /** The shell's render-snapshot sessions — the learning-hook review scan
     *  reads it (the turns themselves read the store FRESH instead). */
    sessions: LiveSession[];
    /** The canonical bot conversation rows (App's `messages`), LIVE. */
    botThreadRows?: Message[];
    /** ONE merge of the canonical conversation into a bot session's view. */
    mergeBotConversation: (
        bot: AgentBot | undefined, local: LiveEntry[], canonical: Message[] | undefined,
    ) => LiveEntry[];
    /** Composer attachment tray (read at send, cleared after). */
    attachments: Attachment[];
    /** Attached images as the analysis pipeline takes them. */
    attachedImages: () => Array<{ name: string; dataURL: string }>;
    clearAttachments: () => void;
    setDraft: (value: string) => void;
    /** Last packet fetch stamp (the composer's ctx badge). */
    setContextAt: (atMs: number) => void;
    /** entryId → App-side analysis message id, recorded when the ensemble
     *  pipeline hands one back (runFullAnalysis). */
    setAnalysisMessageIds: (fn: (prev: Record<string, string>) => Record<string, string>) => void;
    /** Desk-tool drawing surface (draw_on_chart / mark_trade_levels). */
    addModelDrawings?: (drawings: ChartDrawing[], turn?: PanelTurnContext) => void;
    /** Clear only the model's own shapes (clear_chart_drawings scope=model). */
    clearModelDrawings?: (turn?: PanelTurnContext) => void;
    /** Clear model + user shapes (scope=all — only on the user's request). */
    clearAllDrawings?: (turn?: PanelTurnContext) => void;
    /** Report a presented plan to the harness level-watch (TradeView arms
     *  it; a later price touch comes back as a [HARNESS SIGNAL] turn). */
    onPlanPresented?: (plan: WatchPlan, turn?: PanelTurnContext) => void;
    /** Commit a bot turn asked HERE into the canonical conversation. */
    onBotTurnCommit?: (bot: AgentBot, prompt: string, answer?: string) => void;
    /** Launches the FULL ensemble pipeline from this chat (hybrid data in,
     *  debate verdict back as an AI entry). */
    onRunAnalysis?: (prompt: string, images: Array<{ name: string; dataURL: string }>) =>
        Promise<string | { text: string; messageId?: string }>;
}

/** The three entry points the shell drives: the composer's send (and the
 *  retry chips' re-send), the Full-analysis button, and the harness-signal
 *  drain effect. */
export interface ChatTurnRunner {
    send: (raw: string, retryOf?: string) => Promise<void>;
    runFullAnalysis: () => Promise<void>;
    runHarnessTurn: (signalText: string) => Promise<void>;
}

export const createChatTurnRunner = (deps: ChatTurnRunnerDeps): ChatTurnRunner => {
    const {
        symbol, interval, effort, selectedChatModel, chartLevels, allDrawings, trades,
        getChartSnapshot, provider, configForSeat, systemPromptFor, bots, activeId, draft,
        sessions, botThreadRows, mergeBotConversation, attachments, attachedImages,
        clearAttachments, setDraft, setContextAt, setAnalysisMessageIds, addModelDrawings,
        clearModelDrawings, clearAllDrawings, onPlanPresented, onBotTurnCommit, onRunAnalysis,
    } = deps;

    const mutate = (id: string, fn: (s: LiveSession) => LiveSession): void => {
        chatStore.mutate(id, fn);
    };

    /** End a run ONLY if the store still holds THIS run's controller — the rule
     *  itself lives in chatStore beside the controller map it reads, because a
     *  queued harness flush racing this run can REPLACE the slot. */
    const endRunOwned = chatStore.endRunOwned;

    /** Desk-tool drawing surface. draw_on_chart / mark_trade_levels /
     *  clear_chart_drawings land here — the market executor never sees
     *  them (they touch the live canvas). Bars-ago anchors resolve against
     *  the chart's newest candle so a line the model draws at "10 bars ago"
     *  lands where the user is looking.
     *  `turn` is the RUNNING turn's identity (captured by runSeatTurn when
     *  the stream starts) — every attach/persist keys off it, never off
     *  the view state, so a background or harness turn's output lands in
     *  ITS OWN session even after the user switched away. */
    const executePanelTool = async (call: DeskToolCall, turn: PanelTurnContext): Promise<DeskToolResult | null> => {
        const name = call.name;
        if (name !== 'draw_on_chart' && name !== 'mark_trade_levels' && name !== 'clear_chart_drawings'
            && name !== 'present_trade' && name !== 'watch_price' && name !== 'wake_me' && name !== 'cancel_watch') return null;
        const args = call.arguments ?? {};
        const receipt = (ok: boolean, content: string): DeskToolResult => ({ toolCallId: call.id, name, ok, content });
        // The chart snapshot is shared by every drawing branch: its live mark
        // is stamped onto each shape (drawnPrice) so describeDrawingsForModel
        // can later tell the model how far price has moved since the shape was
        // made — the difference between a fresh level and a stale one.
        const snap = getChartSnapshot?.() ?? null;
        const drawnPrice = snap?.markPrice ?? null;
        // CANVAS HONESTY (residual of the per-turn identity refactor): the
        // snapshot is the VIEWED canvas, but a turn keeps running after the
        // user switches instruments. When the two disagree, every stamp taken
        // from it — drawnPrice, the bars-ago anchor, the arm-time stale call —
        // is NOT the turn's coin's live data. Say so in the receipt instead of
        // silently stamping the viewed coin's numbers onto another coin's
        // turn (the text-level half of the identity class; the canvas itself
        // stays owned by TradeView).
        const canvasSymbol = snap && typeof snap.symbol === 'string' && snap.symbol ? snap.symbol : '';
        const crossCanvas = !!canvasSymbol && !!turn.symbol && canvasSymbol !== turn.symbol;
        const canvasNote = crossCanvas
            ? ` NOTE: the canvas shows ${canvasSymbol}; this snapshot was taken while the turn was on ${turn.symbol} — treat its prices/bar times as stale for ${turn.symbol}, not as its live mark.`
            : '';
        // ── Watch / schedule harness (model arms a price trigger or a time
        //    wake-up; the harness wakes it back up when the condition holds).
        if (name === 'watch_price' || name === 'wake_me') {
            const makeId = (): string => `w-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
            const nowMs = Date.now();
            // Arming a watch is an explicit "alert me later" — request the OS
            // notification permission NOW so the grant exists when the trigger
            // fires minutes/hours from now (a permission prompt at fire time
            // would be too late, or silently dropped).
            void ensureNotifyPermission();
            if (name === 'watch_price') {
                const { watch, error } = parsePriceWatch(args, { symbol: turn.symbol, makeId, nowMs });
                if (error || !watch) return receipt(false, `watch_price rejected: ${error ?? 'invalid'}`);
                watchService.arm(watch);
                return receipt(true, `Watch ${watch.id} armed: ${watch.symbol} ${watch.condition} ${watch.price}, expires ${phtClock(watch.expiresAt)} PHT. The harness will wake you with a [HARNESS TRIGGER] the first time it holds — then it lapses. Tell the user you are watching for it.`);
            }
            const { wake, error } = parseTimeWake(args, { symbol: turn.symbol, makeId, nowMs });
            if (error || !wake) return receipt(false, `wake_me rejected: ${error ?? 'invalid'}`);
            watchService.arm(wake);
            return receipt(true, `Scheduled wake ${wake.id} at ${phtClock(wake.atMs)} PHT (in ${Math.round((wake.atMs - nowMs) / 60_000)}m). The harness will signal you then to re-check ${wake.symbol}: "${wake.note}".`);
        }
        if (name === 'cancel_watch') {
            const ids = Array.isArray(args.ids) ? args.ids.map(String) : [];
            let n = 0;
            for (const id of ids) if (watchService.cancel(id)) n += 1;
            if (args.allForSymbol) {
                // The SAME canonicalization chartTriggers applies at arm time
                // (baseOf+quoteOf: 'BTC' → 'BTCUSDT'). Plans now live under the
                // normalized full form, so a raw toUpperCase() target could
                // never match a watch the model armed as bare 'BTC' — compare
                // canonically on BOTH sides to stay robust to legacy rows.
                const target = String(args.symbol ?? turn.symbol).trim();
                const canon = target ? `${baseOf(target)}${quoteOf(target)}` : '';
                n += watchService.cancelWhere(w => (w.symbol.trim() ? `${baseOf(w.symbol)}${quoteOf(w.symbol)}` : w.symbol) === canon);
            }
            const left = watchService.list().map(w => w.id);
            return receipt(true, n > 0
                ? `Cancelled ${n} watch${n === 1 ? '' : 'es'}. Still armed: ${left.join(', ') || 'none'}.`
                : `Nothing to cancel (ids: ${ids.join(', ') || '—'}). Still armed: ${left.join(', ') || 'none'}.`);
        }
        // present_trade: draw the plan, ARM the harness level-watch on it,
        // AND surface a Log-this-trade card on the streaming entry.
        if (name === 'present_trade') {
            const { proposal, error } = parseTradeProposal({ ...args, symbol: args.symbol || turn.symbol });
            if (error || !proposal) return receipt(false, `present_trade rejected: ${error ?? 'invalid proposal'}`);
            // The DOCK generates the stable plan id: the level-watch arms on
            // it, the receipt names its level ids for the model to quote,
            // and "Log this trade" carries it onto the journal row.
            proposal.planId = `${baseOf(proposal.symbol).toLowerCase()}-${Date.now().toString(36)}`;
            const { drawings } = drawingsFromLevelTool({ entry: proposal.entry, stopLoss: proposal.stopLoss, takeProfits: proposal.takeProfits }, { drawnPrice });
            addModelDrawings?.(drawings, turn);
            const plan: WatchPlan = {
                planId: proposal.planId, symbol: proposal.symbol, direction: proposal.direction,
                entry: proposal.entry, stopLoss: proposal.stopLoss, takeProfits: proposal.takeProfits,
            };
            // The honest disposition of the watch TradeView is about to arm:
            // arm() REFUSES a plan already through its SL/target at the live
            // mark (staleLevelsAtArm is the same gate), so the receipt must
            // not promise a watch that will never ping. CROSS-CANVAS MIRROR
            // OF TradeView.handlePlanPresented: off-view the viewed mark is
            // NOT the turn's coin's live price, so arm() gets a null anchor
            // (plain first-tick touch test, never a stale-refuse) — the
            // receipt must evaluate the gate with the SAME null, or it lies
            // "REFUSED… no HARNESS SIGNAL will come" about a watch that arms
            // fine in the background-turn case this refactor exists for.
            const armPrice = crossCanvas ? null : (typeof drawnPrice === 'number' && Number.isFinite(drawnPrice) && drawnPrice > 0 ? drawnPrice : null);
            const stale = staleLevelsAtArm(plan, armPrice);
            onPlanPresented?.(plan, turn);
            // THE TURN's entry — not "whatever is streaming in the viewed
            // session": the card must land in this run's transcript even if
            // the user switched sessions mid-stream.
            if (turn.entryId) chatStore.mutate(turn.sid, s => ({ ...s, entries: s.entries.map(e => (e.id === turn.entryId ? { ...e, proposal } : e)) }));
            const rr = proposal.takeProfits.length && Math.abs(proposal.entry - proposal.stopLoss) > 0
                ? (Math.abs(proposal.takeProfits[0] - proposal.entry) / Math.abs(proposal.entry - proposal.stopLoss)).toFixed(1) : '—';
            const levelIds = [`${proposal.planId}:ENTRY`, `${proposal.planId}:SL`,
                ...proposal.takeProfits.map((_, i) => `${proposal.planId}:TP${i + 1}`)];
            // Only reachable on the VIEWED canvas (crossCanvas ⇒ armPrice is
            // null ⇒ stale is empty), so the price named here is genuinely
            // the coin's live mark.
            const staleWatchLine = `WARNING: the harness REFUSED to watch this plan — price ${drawnPrice} is already through a stop/target, so every level (${stale.join(', ')}) latched as already-reached and NO [HARNESS SIGNAL] will come for them. Do not claim a watch is live; if the user still wants one, re-present a plan whose levels sit ahead of price.`;
            const watchLine = stale.length > 0
                ? staleWatchLine
                : `The harness now watches these levels — ids ${levelIds.join(', ')} — and will send you a [HARNESS SIGNAL] when one is reached; refer to levels by those ids and never re-announce one that already fired.`;
            return receipt(true, `Presented ${proposal.direction} ${proposal.symbol} @ ${proposal.entry}, SL ${proposal.stopLoss}, TP ${proposal.takeProfits.join('/')}, R:R ~${rr}:1. The user sees a "Log this trade" card. ${watchLine}${canvasNote}`);
        }
        if (name === 'clear_chart_drawings') {
            const scope = args.scope === 'all' ? 'all' : 'model';
            if (!clearModelDrawings && !clearAllDrawings) return receipt(false, 'clear_chart_drawings: no chart is attached to this session.');
            if (scope === 'all') clearAllDrawings?.(turn);
            else clearModelDrawings?.(turn);
            return receipt(true, scope === 'all'
                ? 'Cleared ALL drawings (the model\'s marks and the user\'s own shapes) from the chart.'
                : 'Cleared the model\'s own drawings from the chart (the user\'s shapes were kept).');
        }
        if (!addModelDrawings) return receipt(false, `${name}: no chart is attached to this session.`);
        // Whether a drawn shape is actually ON SCREEN. repaint() clips to the
        // plot rect, so a price outside the visible scale is discarded
        // silently and a trend anchored past the window never appears — and the
        // receipt used to say "The user sees it now" either way. The model was
        // told its work landed, and had no way to learn otherwise.
        const vis = snap?.visibleRange ?? null;
        const inView = (p: number): boolean =>
            vis ? p >= vis.priceLow && p <= vis.priceHigh : true;
        /** Only claims visibility when it is known; never guesses either way. */
        const visibility = (drawings2: { points: { p: number }[] }[]): string => {
            if (!vis) return '';
            const off = drawings2.filter(d => !d.points.every(pt => inView(pt.p)));
            if (off.length === 0) return ' The user sees these now.';
            if (off.length === drawings2.length) {
                return ` WARNING: every price is OUTSIDE the visible range ${Math.round(vis.priceLow)}–${Math.round(vis.priceHigh)} — repaint() clips there, so the user will NOT see this until the chart is scrolled or zoomed out.`;
            }
            return ` WARNING: ${off.length} of ${drawings2.length} shapes fall outside the visible range ${Math.round(vis.priceLow)}–${Math.round(vis.priceHigh)} and will be clipped until the user scrolls or zooms out.`;
        };
        if (name === 'mark_trade_levels') {
            const { drawings, error } = drawingsFromLevelTool(args, { drawnPrice });
            if (error) return receipt(false, `mark_trade_levels rejected: ${error}`);
            addModelDrawings(drawings, turn);
            const listed = drawings.map(d => `${d.label} ${d.points[0].p}`).join(', ');
            return receipt(true, `Marked on the chart: ${listed}.${visibility(drawings)}${canvasNote}`);
        }
        // draw_on_chart — resolve bars-ago anchors against the newest candle.
        const lastBarTime = snap && snap.candles.length > 0
            ? snap.candles[snap.candles.length - 1].time
            : Math.floor(Date.now() / 1000);
        const { drawings, error } = drawingFromChartTool(args, { lastBarTime, barSeconds: intervalSeconds(turn.interval as never), drawnPrice });
        if (error) return receipt(false, `draw_on_chart rejected: ${error}`);
        addModelDrawings(drawings, turn);
        const d = drawings[0];
        const described = describeDrawingsForModel([d]).split('\n').slice(1).join(' ').trim();
        return receipt(true, `Drew on the chart: ${described || d.kind}.${visibility([d])}${canvasNote}`);
    };

    /** The fresh code-calculated packet every message rides (fetched ONCE per
     *  send — shared across all panel seats so they argue about the same tape).
     *  The hybrid pull is the slow network leg before the first token, so a
     *  short-TTL cache (per symbol) lets rapid follow-up questions skip it —
     *  only the PACKET is cached; drawings/plans/on-screen are rebuilt fresh
     *  every send, and the block carries the real fetch time so the model
     *  knows its age. */
    const buildContextBlock = async (): Promise<string> => {
        // What the canvas is PAINTING right now (the snapshot), independent
        // of the network fetch below — if they disagree, the model sees both.
        const snap = getChartSnapshot?.() ?? null;
        const onScreen = snap ? describeChartSnapshotForModel(snap) : '';
        // The harness level-watch's armed plans for THIS symbol PLUS the
        // model's own armed watches (price triggers / time wake-ups): the
        // model always knows what it is waiting on, even without a signal.
        const plansBlock = [
            ...levelWatch.getArmedPlans()
                .filter(p => p.symbol === symbol)
                .map(p => describePlanForModel(p, levelWatch.firedLevelsFor(p.planId))),
            describeWatchesForModel(watchService.list(), Date.now()),
        ].filter(Boolean).join('\n\n');
        // Send-time stamps from the websocket feed: the live mark plus the
        // FORMING candle (last painted bar — already ws-updated), so a
        // cached/snapshot packet can never read as a fresh move or a stale
        // candle.
        const liveMarkPrice = snap?.markPrice ?? null;
        const snapCandles = snap?.candles ?? [];
        const formingCandle = snapCandles.length > 0 ? snapCandles[snapCandles.length - 1] : null;
        // Drawings carry their draw-time price, so describe them against the
        // live mark HERE — the model sees how far price has moved since each
        // shape and knows which levels are still fresh vs gone stale.
        const drawingsDescription = describeDrawingsForModel(allDrawings, { priceNow: liveMarkPrice, nowMs: Date.now() });
        const cached = packetCache.get(symbol);
        if (cached && Date.now() - cached.atMs < PACKET_CACHE_MS) {
            return buildTradeChatContext({ symbol, interval, contextWindowTokens: provider?.contextWindowTokens, packetMarkdown: cached.markdown, fetchedAtMs: cached.atMs, drawingsDescription, onScreenDescription: onScreen, plansDescription: plansBlock, liveMarkPrice, formingCandle });
        }
        try {
            const packet = await fetchHybridData(symbol);
            const markdown = generateHybridPromptInjection(packet, { compact: true });
            const atMs = Date.now();
            setContextAt(atMs);
            packetCache.set(symbol, { markdown, atMs });
            return buildTradeChatContext({ symbol, interval, contextWindowTokens: provider?.contextWindowTokens, packetMarkdown: markdown, fetchedAtMs: atMs, drawingsDescription, onScreenDescription: onScreen, plansDescription: plansBlock, liveMarkPrice, formingCandle });
        } catch {
            return buildTradeChatContext({ symbol, interval, contextWindowTokens: provider?.contextWindowTokens, packetMarkdown: '', fetchedAtMs: Date.now(), drawingsDescription, onScreenDescription: onScreen, plansDescription: plansBlock, liveMarkPrice, formingCandle });
        }
    };

    /** Stream one seat turn into its entry; resolves with the full text. */
    const runSeatTurn = async (params: {
        sid: string;
        entryId: string;
        config: ProviderConfig;
        messages: ChatMessage[];
        mailboxSeat: string;
        mailbox?: ReturnType<typeof createDebateMailbox>;
        onMailSent?: (info: { from: string; to: string; text: string; round: number }) => void;
        /** Mirrors every side-effect (proposal/write) out to the caller so
         *  the panel loop can carry it into the shared room transcript. */
        onAction?: (label: string) => void;
        /** Panel seats: keep the bubble EMPTY while the stream could still
         *  collapse to a pure (pass), so silence never takes a visible turn. */
        hidePass?: boolean;
    }): Promise<string> => {
        const { sid, entryId, config, messages, mailboxSeat, mailbox, onMailSent, onAction, hidePass } = params;
        const controller = chatStore.getController(sid);
        if (!controller) return '';
        // One snapshot per seat turn feeds BOTH stamps (live mark + forming
        // candle) and the desk tools' context — a single consistent read of
        // what the canvas is painting as the turn starts.
        const sendSnap = getChartSnapshot?.() ?? null;
        const sendCandles = sendSnap?.candles ?? [];
        // The identity of THIS turn, frozen at start. Every panel-tool
        // side-effect (proposal card, drawings, arming) is dispatched with
        // this context — so a turn running in the background while the user
        // watches another session/symbol still writes into ITS transcript.
        const turnCtx: PanelTurnContext = { sid, entryId, symbol, interval };
        const patch = (fn: (e: LiveEntry) => LiveEntry): void => {
            mutate(sid, s => ({ ...s, updatedAt: Date.now(), entries: s.entries.map(e => (e.id === entryId ? fn(e) : e)) }));
        };
        let full = '';
        let reasoning = '';
        const stream = streamChatWithDeskTools(config, messages, {
            defaultSymbol: symbol,
            allowedTools: TRADE_TOOLS,
            signal: controller.signal,
            maxTokens: TASK_BUDGETS.chat,
            temperature: 0.4,
            reasoningEffort: effort === 'auto' ? effortForTask('chat') : effort,
            chartInterval: interval,
            chartLevels,
            chartDrawings: allDrawings,
            liveMarkPrice: sendSnap?.markPrice ?? null,
            formingCandle: sendCandles.length > 0 ? sendCandles[sendCandles.length - 1] : null,
            // ...and re-read the canvas on every desk call. The two above are
            // frozen when the turn starts; a three-round turn can spend a
            // minute in tool calls, and a "live mark" stamped with the opening
            // tick is the same misreport the stamp exists to prevent.
            getLiveMarkPrice: () => getChartSnapshot?.()?.markPrice ?? null,
            getFormingCandle: () => {
                const cs = getChartSnapshot?.()?.candles ?? [];
                return cs.length > 0 ? cs[cs.length - 1] : null;
            },
            executePanelTool: call => executePanelTool(call, turnCtx),
            trades,
            mailbox,
            mailboxSeat,
            mailboxRound: 0,
            onMailSent,
            onStreamReset: () => {
                // Self-heal bounce: what streamed so far was a malformed
                // tool-call attempt, NOT the answer — clear it so the
                // corrected turn paints alone instead of concatenating.
                full = '';
                patch(e => ({ ...e, text: hidePass && panelCouldStillBePass(full) ? '' : full }));
            },
            onReasoning: (chunk: string) => { reasoning += chunk; patch(e => ({ ...e, reasoning: (e.reasoning ?? '') + chunk })); },
            onToolEvent: (line: string) => patch(e => ({ ...e, tools: [...e.tools, line] })),
            onToolAction: action => {
                patch(e => ({ ...e, actions: [...(e.actions ?? []), action] }));
                // Mirror the side-effect into the caller's collector so a
                // PANEL seat's next turn (and the synthesis) can SEE that a
                // peer proposed/edited something — the cross-talk the user
                // asked for around skill/memory/tool edits.
                onAction?.(`${action.ok ? action.verb : 'rejected'} ${action.tool === 'revise_skill' || action.tool === 'propose_skill' ? `skill ${action.label}` : action.tool === 'write_memory_note' ? `memory note ${action.label}` : action.tool === 'amend_memory' ? `memory amendment ${action.label}` : action.tool === 'forge_tool' ? `tool ${action.label}` : action.label}`);
            },
        });
        for await (const delta of stream) {
            if (controller.signal.aborted) break;
            full += delta;
            // Absolute text (not += delta): a hidden-pass stream shows ''
            // until it proves it spoke, then the whole answer lands at once.
            patch(e => ({ ...e, text: hidePass && panelCouldStillBePass(full) ? '' : full }));
        }
        // An explicit Stop is the user pulling the plug — NOT a failure.
        // Settle quietly and check this FIRST: without the guard, a stopped
        // turn fell through to the pure-echo repair below and printed
        // "streamed only its reasoning…" on a deliberate stop click (and
        // callers' catch blocks labelled it "could not answer").
        if (controller.signal.aborted) {
            patch(e => ({ ...e, streaming: false }));
            return full;
        }
        // Settle-time repair: the live gate only strips TAG-delimited thinking
        // (<thinking>…). Header-style ("Thinking:" / "FINAL_OUTPUT:") or a model
        // that repeats its native CoT into the content stream leaks raw
        // reasoning into the answer bubble — which is both the "thinking isn't
        // stripped" and the "final output doesn't render" complaint (a stray
        // scratchpad fence breaks the markdown). Run the journal's splitter on
        // the settled text, but ONLY act when it actually peeled something the
        // native stream didn't already own — so a clean answer (even one that
        // opens with "Verdict:") is left byte-for-byte untouched.
        const settled = splitThinkingFromOutput(reasoning, full);
        // PURE ECHO: the model repeated its native CoT verbatim into the
        // content channel (the "thinking and response are the same" report —
        // the splitter confirms it by returning an empty answer). The reply
        // is only what comes AFTER the echo; if nothing does (the budget died
        // mid-reasoning), say so instead of showing the scratchpad twice.
        // The `f === ''` arm covers the desktop bridge: main.cjs no longer
        // substitutes reasoning into text, so a turn that really ends with no
        // answer arrives as empty content + reasoning, and deserves the same
        // explanation rather than a blank bubble.
        const r = reasoning.trim();
        const f = full.trim();
        if (r && settled.output === '' && (f === '' || f.startsWith(r))) {
            const rest = f.slice(r.length).trim();
            patch(e => ({
                ...e,
                streaming: false,
                text: rest,
                tools: rest ? e.tools : [...e.tools, 'The model streamed only its reasoning this turn — no separate answer came through. Try a lower thinking effort, or ask again.'],
            }));
            // The panel room still carries the analysis for the peers.
            return rest || f;
        }
        // A peel happened when the splitter's answer differs from the raw
        // stream, and it's genuinely leaked reasoning (not just a benign
        // label like "Verdict:") only when something sits in thinking now.
        const peeled = full.trim() !== settled.output;
        const leaked = peeled && !!(settled.thinking.trim() || reasoning.trim());
        const finalText = leaked ? (settled.output || full) : full;
        patch(e => ({ ...e, streaming: false, text: finalText, reasoning: leaked ? (settled.thinking || e.reasoning) : (e.reasoning || reasoning) }));
        return finalText;
    };

    /** Every few Chart AI conversations, quietly review the recent ones for
     *  concrete trades the user+model discussed, score each against the price
     *  history that followed, and queue win→repeat / loss→avoid skill DRAFTS
     *  for the Inbox. Fire-and-forget, provider-gated, never blocks the chat. */
    /** Skill learning hooks, fire-and-forget after each send. Layers:
     *  (1) the EVENT-DRIVEN resolver re-scores cached unresolved theses on
     *  every send (throttled inside to ~1/10min) so a discussed trade lands
     *  in the Inbox the moment price resolves it; (2) the every-3-sessions
     *  counter additionally runs the full transcript EXTRACTION pass;
     *  (3) the TRADER LEARNER distills durable habits into profileMemory
     *  every 2 sessions; (4) the SUPERVISOR gets a throttled nudge to work
     *  its queues. All four run the session's own model (panel ⇒ first
     *  seat) as independent calls, and all route through the draft gates. */
    const maybeReviewSessions = (supervisorCfg: ProviderConfig | null): void => {
        const model = supervisorCfg ?? provider;
        if (!model) return;
        const user = getActiveUsername();
        void runThesisResolver(user, model, trades).catch(() => { /* best-effort */ });
        const reviewable: ReviewableSession[] = sessions
            .filter(s => s.kind !== 'group' && s.entries.some(e => e.role === 'ai' && e.text.trim()))
            .map(s => ({
                id: s.id,
                transcript: s.entries
                    .filter(e => e.text.trim())
                    .map(e => `${e.role === 'user' ? 'User' : 'Assistant'}: ${e.text}`)
                    .join('\n\n'),
                atMs: s.updatedAt,
                symbol,
            }));
        if (reviewable.length > 0) {
            void runTraderLearner(user, model, reviewable.map(s => s.transcript)).catch(() => { /* best-effort */ });
            if (recordSessionForReview(user, 3)) {
                void runSessionSkillReview(user, reviewable, model, trades).catch(() => { /* best-effort */ });
            }
        }
        nudgeSupervisor(supervisorCfg);
    };

    /** Send a message — or RETRY one: `retryOf` is the id of a previous USER
     *  entry whose answer should be regenerated. The stale answer(s) after
     *  that bubble are dropped and the turn re-runs with the same text/image
     *  and fresh live context. */
    const send = async (raw: string, retryOf?: string): Promise<void> => {
        // Fresh STORE read (the pattern runHarnessTurn already uses) — never
        // the render snapshot: a key-repeat/double-click fires two sends
        // inside one React tick, and the snapshot's `busy` is still false
        // for the second one, so two runs overlap.
        const live = chatStore.getSnapshot();
        const sid = live.activeId;
        const session0 = live.sessions.find(s => s.id === sid);
        if (!session0) return;
        const retryEntry = retryOf
            ? session0.entries.find(e => e.id === retryOf && e.role === 'user')
            : undefined;
        if (retryOf && !retryEntry) return;
        const text = retryEntry
            ? (retryEntry.text === '(chart screenshot)' ? '' : retryEntry.text.trim())
            : raw.trim();
        const sentAttachments: Attachment[] = retryEntry
            ? (retryEntry.image ? [{ id: newId('at'), kind: 'image', name: 'chart.png', payload: retryEntry.image }] : [])
            : attachments;
        if ((!text && sentAttachments.length === 0 && !retryEntry) || live.running[sid]) return;
        if (!provider) return;
        if (retryEntry) {
            // Drop the stale answer(s) AFTER the original user bubble — the
            // branch restarts from that message.
            mutate(sid, s => {
                const idx = s.entries.findIndex(e => e.id === retryEntry.id);
                return idx < 0 ? s : { ...s, updatedAt: Date.now(), entries: s.entries.slice(0, idx + 1) };
            });
        } else {
            setDraft('');
            clearAttachments();
        }
        const session = session0;
        // WHO SUPERVISES: this session's model — a panel's FIRST seat when
        // several are selected. Reported now, and it rides every learning
        // hook fired from this send's finally block.
        const supSeat = session.kind === 'panel' ? session.panelModels?.[0] : undefined;
        const supBot = session.botId ? bots.find(b => b.id === session.botId) : undefined;
        const supervisorCfg = (supSeat ? configForSeat(supSeat.providerId, supSeat.modelId) : null)
            ?? (supBot ? configForSeat(supBot.providerId, supBot.modelId) : null)
            ?? (session.kind !== 'panel' ? provider : null);
        setSessionModel(supervisorCfg);
        // Retry: the model's history is everything BEFORE the retried bubble
        // (its stale answers are gone from the store too).
        // The bot answers from the SAME conversation the trader is looking at.
        // Reading the raw session here is what let a turn said in the Chat
        // surface reach the trader but never reach the bot: two views of one
        // conversation, which is the split this merge exists to remove.
        const conversation = mergeBotConversation(
            session.botId ? bots.find(b => b.id === session.botId) : undefined,
            session.entries,
            botThreadRows,
        );
        const retryIdx = retryEntry ? conversation.findIndex(e => e.id === retryEntry.id) : -1;
        const history = retryIdx >= 0 ? conversation.slice(0, retryIdx) : conversation;
        const imageAttachment = sentAttachments.find(a => a.kind === 'image');
        const fileBlocks = sentAttachments.filter(a => a.kind === 'file')
            .map(a => `\n\n[ATTACHED FILE — ${a.name}]\n${a.payload.slice(0, MAX_FILE_CHARS)}`)
            .join('');
        const userEntry: LiveEntry = { id: retryEntry?.id ?? newId('u'), role: 'user', text: text || '(chart screenshot)', tools: [], image: imageAttachment?.payload, at: Date.now() };
        // The controller is armed (and registered in the store, keyed by
        // session) BEFORE the context fetch so a stop click during the
        // network-bound packet pull already kills the turn — and so the run
        // keeps streaming into the store even if the panel unmounts.
        const controller = new AbortController();
        chatStore.beginRun(sid, controller);
        // Paint the transcript NOW, before the packet fetch: the user's
        // bubble + a "Thinking…" placeholder appear the instant they hit send,
        // so the dock never looks dead during the network round-trip. Solo
        // appends its streaming AI entry up front; panel seats stream into
        // their own entries added later in the loop.
        const isSolo = session.kind !== 'panel';
        const soloAiEntry: LiveEntry = { id: newId('a'), role: 'ai', text: '', tools: [], streaming: true, at: Date.now() };
        mutate(sid, s => ({
            ...s,
            title: s.entries.some(e => e.role === 'user') ? s.title : titleFromMessage(text),
            updatedAt: Date.now(),
            // Bind the session to the chart + composer state it was asked
            // under, so re-opening it later restores exactly this setup.
            symbol,
            interval,
            effort,
            ...(isSolo && !session.botId && selectedChatModel ? { soloModel: selectedChatModel } : {}),
            entries: [...s.entries, ...(retryEntry ? [] : [userEntry]), ...(isSolo ? [soloAiEntry] : [])],
        }));
        const contextBlock = await buildContextBlock();
        if (controller.signal.aborted) {
            // Stopped during the fetch — undo the optimistic bubbles (a
            // retried user bubble stays; only the fresh answer is removed).
            mutate(sid, s => ({ ...s, entries: s.entries.filter(e => e.id !== soloAiEntry.id && (retryEntry || e.id !== userEntry.id)) }));
            endRunOwned(sid, controller);
            return;
        }
        const userText = `${contextBlock}\n\n${text}${fileBlocks}`;

        // ── SOLO (optionally bound to a roster bot persona) ────────────────
        if (isSolo) {
            const aiEntry = soloAiEntry;
            const bot = bots.find(b => b.id === session.botId);
            const soloProvider = bot
                ? (configForSeat(bot.providerId, bot.modelId) ?? provider)
                : provider;
            const systemPrompt = systemPromptFor(bot);
            const userContent = userContentWithImage(userText, imageAttachment, soloProvider.selectedModel);
            // Solo answers carry the seat label, so returning to a session
            // shows who said each line (the renderer the panel seats already
            // use). A bot-bound session names the AGENT, not the slug: the
            // same bot answers at the desk under its name, and one answer
            // claimed by model here and by identity there is two claims.
            mutate(sid, s => ({ ...s, entries: s.entries.map(en => (en.id === aiEntry.id ? { ...en, speaker: bot?.name ?? `${soloProvider.id}:${soloProvider.selectedModel}` } : en)) }));

            // Commit the QUESTION to the conversation that owns it, so the
            // Chat surface shows the exchange while it is still being answered
            // rather than after. The dock's composer writes into the chat
            // session, not into `messages`, so unlike the Chat surface there is
            // no trader's row already waiting to be claimed.
            if (bot) onBotTurnCommit?.(bot, text);
            // History carries its images. The user attached a chart two turns
            // ago and asked "what about that pattern?" — the screenshot was
            // stored on the entry all along (StoredChatEntry.image, which is why
            // RETRY could recover it), but the history rebuild read e.text
            // alone, so the follow-up was answered blind by a model that had
            // just been shown the chart. Rebuilt through the same helper as the
            // live turn, so a prior image is re-sent as a real part and a
            // text-only seat is told it is there rather than not knowing.
            const messages: ChatMessage[] = [
                { role: 'system', content: systemPrompt },
                ...history.slice(-10).flatMap(e => {
                    if (!e.text.trim() && !e.image) return [];
                    const role = e.role === 'user' ? 'user' : 'assistant';
                    const content = e.role === 'user' && e.image
                        ? userContentWithImage(e.text, { kind: 'image', payload: e.image }, soloProvider.selectedModel)
                        : e.text;
                    return [{ role, content } as ChatMessage];
                }),
                { role: 'user', content: userContent },
            ];
            try {
                await runSeatTurn({ sid, entryId: aiEntry.id, config: soloProvider, messages, mailboxSeat: '' });
            } catch (e) {
                // An explicit Stop throws a transport AbortError — that is a
                // user action, not a failure: the bubble keeps what streamed
                // (already settled by runSeatTurn) instead of being stamped
                // "The chart copilot could not answer…".
                if (!controller.signal.aborted) {
                    const message = e instanceof Error ? e.message : String(e);
                    mutate(sid, s => ({ ...s, entries: s.entries.map(en => en.id === aiEntry.id && !en.text ? { ...en, text: `The chart copilot could not answer: ${message}`, streaming: false } : en) }));
                }
            } finally {
                mutate(sid, s => ({ ...s, entries: s.entries.map(en => (en.id === aiEntry.id ? { ...en, streaming: false } : en)) }));
                endRunOwned(sid, controller);
                maybeReviewSessions(supervisorCfg);
                // THE TURN HAS TO TEACH THE BOT. `recordBotTurnOutcome` writes
                // the lesson into this bot's own memory.md and feeds a closed
                // bot-authored trade into the shared skills/evidence path. The
                // mailbox, the group rooms and the automations all call it on
                // every reply — this dock did not, so asking a bot something
                // in Chart AI taught it NOTHING, while the same question in
                // the Chat surface did. A bot's memory was whichever surface
                // you happened to use, which is not a property anyone would
                // defend.
                //
                // Fire-and-forget on purpose, matching all three siblings: a
                // failed lesson write must never turn a delivered answer into
                // a failed turn.
                const usernameNow = getActiveUsername();
                if (bot) {
                    const settledText = chatStore.getSnapshot().sessions
                        .find(x => x.id === sid)?.entries.find(en => en.id === aiEntry.id)?.text ?? '';
                    // Only a real answer is committed. The stop placeholder and
                    // the "could not answer" text would put a failed turn into
                    // the conversation as though the bot had said something.
                    if (settledText.trim() && !/^Running the full ensemble/.test(settledText)) {
                        onBotTurnCommit?.(bot, text, settledText);
                    }
                }
                if (bot && usernameNow) {
                    const answered = chatStore.getSnapshot().sessions
                        .find(x => x.id === sid)?.entries.find(en => en.id === aiEntry.id)?.text ?? '';
                    if (answered.trim()) {
                        void recordBotTurnOutcome(bot, text, answered, {
                            username: usernameNow,
                            trades,
                        });
                    }
                }
            }
            return;
        }

        // ── PANEL: up to 5 models, one request, cross-talk + synthesis ─────
        const seats = panelSeats(session, formatModelDisplayName, id => bots.find(b => b.id === id)?.name);
        if (seats.length < 2) {
            // Say it out loud — a bare return left the user staring at their
            // own message (and leaked the run controller armed above). The
            // user bubble is already painted (optimistic), so just append the
            // notice.
            mutate(sid, s => ({
                ...s,
                entries: [...s.entries, {
                    id: newId('n'), role: 'ai' as const, text: '',
                    tools: ['This panel has fewer than 2 usable seats — add models or agents in the panel picker above.'],
                    notice: true,
                }],
            }));
            endRunOwned(sid, controller);
            return;
        }
        const mailbox = createDebateMailbox(seats.map(s => s.name));
        const spoken: string[] = [];
        const unavailableNotified = new Set<string>();
        // Seats a prior speaker @mentioned but hasn't talked yet — they jump
        // the round-robin queue so cross-talk actually routes.
        const pull: string[] = [];
        const room: { seatId: string; text: string; synthesis?: boolean }[] = [];
        const nameFor = (seatId: string): string => seats.find(s => s.id === seatId)?.name ?? seatId;
        // The user bubble was already painted optimistically above; seats
        // stream into their own entries appended inside the loop.
        try {
            for (let guard = 0; guard < PANEL_MAX_MODELS + 2; guard += 1) {
                const plan = planPanelTurn(seats, spoken, pull);
                if (!plan.seat) break;
                const seat = plan.seat;
                const seatBot = seat.botId ? bots.find(b => b.id === seat.botId) : undefined;
                // An agent seat answers with its OWN model first: the panel was
                // configured with the model, but the roster may since have
                // moved the bot — the bot's current pair is the truer read.
                const seatConfig = configForSeat(seat.providerId, seat.modelId)
                    ?? (seatBot ? configForSeat(seatBot.providerId, seatBot.modelId) : null);
                if (!seatConfig) {
                    // The seat's provider/model vanished from Settings — say so
                    // in the transcript; a silent skip looked like a hang.
                    // Once per seat (the synthesis pass would repeat it).
                    spoken.push(seat.id);
                    if (!unavailableNotified.has(seat.id)) {
                        unavailableNotified.add(seat.id);
                        mutate(sid, s => ({ ...s, entries: [...s.entries, {
                            id: newId('n'), role: 'ai' as const, text: '', streaming: false, notice: true,
                            speaker: seat.name,
                            tools: [`Seat unavailable — "${seat.name}" is no longer configured (Settings → Providers). Remove it or re-add its model.`],
                        }] }));
                    }
                    continue;
                }
                const roomTranscript = formatRoomTranscript(room, nameFor);
                const turnIntro = plan.isSynthesis
                    ? 'You are the LAST seat. Write ONE final answer for the user that synthesizes the whole panel above: agree where they agree, name where they disagree, and give the single actionable read of this chart. Keep every memory/skill/tool proposal you make explicitly labeled.'
                    : roomTranscript
                        ? 'Answer the user for this chart. Other seats already spoke (shown above) — build on or rebut their read, do not repeat it. You can @Name another seat to pull it into the conversation next, or send_message to a peer seat by name mid-turn to compare a number.'
                        : 'You are the first seat to answer for this chart.';
                const userMsg = `${userText}\n\n${turnIntro}${roomTranscript ? `\n\n${roomTranscript}` : ''}`;
                const aiEntry: LiveEntry = {
                    id: newId('a'), role: 'ai', text: '', tools: [], streaming: true,
                    speaker: seat.name,
                    at: Date.now(),
                };
                mutate(sid, s => ({ ...s, entries: [...s.entries, aiEntry] }));
                // An agent seat keeps its own mandate AND the panel's: the seat
                // still has to know it is one voice among N on this chart, which
                // the roster persona alone never says.
                const panelMandate = `You are "${seat.name}" on a ${seats.length}-seat chart panel. Seats: ${seats.map(x => x.name).join(', ')}.`;
                // The panel used to pass a bare string here and drop the
                // screenshot on the floor: the user attached a chart, saw it
                // in their own bubble, and every seat answered without it.
                // Decided per seat, because a panel can mix vision and
                // text-only models, and a seat that cannot see the image is
                // told so rather than left to invent a read of it.
                const seatContent = userContentWithImage(userMsg, imageAttachment, seatConfig.selectedModel);
                const messages: ChatMessage[] = [
                    { role: 'system', content: systemPromptFor(seatBot, panelMandate) },
                    { role: 'user', content: seatContent },
                ];
                let full = '';
                let seatFailed = false;
                const seatActions: string[] = [];
                try {
                    full = await runSeatTurn({
                        sid,
                        entryId: aiEntry.id,
                        config: seatConfig,
                        messages,
                        mailboxSeat: seat.name,
                        mailbox,
                        hidePass: true,
                        onAction: line => seatActions.push(line),
                        onMailSent: info => mutate(sid, s => ({
                            ...s,
                            entries: s.entries.map(e => (e.id === aiEntry.id
                                ? { ...e, tools: [...e.tools, formatDmEventLine({ from: info.from, toLabel: info.to, text: info.text, toKey: info.to.toLowerCase(), round: 0 })] }
                                : e)),
                        })),
                    });
                } catch (e) {
                    // Seat failed — a visible line beats a silent gap, and
                    // the line carries the REAL reason (the provider's
                    // friendly error), not just "failed to answer". An
                    // explicit Stop is not a failure: keep whatever streamed.
                    seatFailed = true;
                    if (!controller.signal.aborted) {
                        const msg = e instanceof Error ? e.message : String(e);
                        // Always settle the flag — a seat that threw AFTER partial
                        // text used to keep streaming:true forever, which then
                        // blocked the whole store from persisting.
                        mutate(sid, s => ({ ...s, entries: s.entries.map(en => (en.id === aiEntry.id
                            ? { ...en, streaming: false, ...(en.text ? {} : { text: `(this seat failed to answer: ${msg})` }) }
                            : en)) }));
                    }
                }
                spoken.push(seat.id);
                if (!seatFailed && isPassReply(full)) {
                    // Silence is not a turn: drop the empty bubble and keep
                    // the pass out of the room the peers + synthesis read.
                    mutate(sid, s => ({ ...s, entries: s.entries.filter(e => e.id !== aiEntry.id) }));
                    continue;
                }
                // Route this seat's @mentions to the front of the queue.
                for (const mentioned of parsePanelMentions(full, seats, seat.id)) {
                    if (!spoken.includes(mentioned) && !pull.includes(mentioned)) pull.push(mentioned);
                }
                // Peers + the synthesis SEE this seat's memory/skill/tool
                // edits, so the panel co-authorizes its own growth.
                const roomText = seatActions.length > 0
                    ? `${full || '(no answer)'}\n\n[side-effects: ${seatActions.join('; ')}]`
                    : (full || '(no answer)');
                room.push({ seatId: seat.id, text: roomText, synthesis: plan.isSynthesis });
            }
        } finally {
            endRunOwned(sid, controller);
            maybeReviewSessions(supervisorCfg);
        }
    };

    /** "Run full analysis" — the ensemble pipeline launched from this chat;
     *  its verdict comes back as an AI entry in the same transcript. */
    const runFullAnalysis = async (): Promise<void> => {
        const text = draft.trim();
        // Fresh store read, same double-submit defense as send().
        if (!text || !onRunAnalysis || chatStore.getSnapshot().running[activeId]) return;
        setDraft('');
        const sentAttachments = attachments;
        const images = attachedImages();
        clearAttachments();
        const fileNote = sentAttachments.filter(a => a.kind === 'file')
            .map(a => `\n\n[ATTACHED FILE — ${a.name}]\n${a.payload.slice(0, MAX_FILE_CHARS)}`)
            .join('');
        const sid = activeId;
        // The transcript bookkeeping is shared with the Agents surface, which
        // runs the same pipeline from the same session — see analysisTurn.ts
        // for why a second copy of this is how the two surfaces drift apart.
        await runAnalysisAsChatTurn({
            sid,
            text: text + fileNote,
            image: images[0]?.dataURL,
            run: () => onRunAnalysis!(text + fileNote, images),
            // The bridge may hand back the App-side message id alongside the
            // verdict text — stamp the entry with it so Locate can scroll here.
            onMessageId: (entryId, messageId) => {
                setAnalysisMessageIds(prev => ({ ...prev, [entryId]: messageId }));
            },
        });
    };

    /** Run one queued harness signal (a level-watch price event) as a model
     *  turn: a notice row shows the event, then the model warns the user.
     *  The signal text is synthesized as the user message — it never renders
     *  as a user bubble. Modelled on runFullAnalysis: it arms its own
     *  controller and bypasses the composer's busy/empty guards (the queue
     *  lives in chatStore, so a hit that lands mid-run or mid-unmount is
     *  never dropped — the drain effect in the shell flushes it when idle). */
    const runHarnessTurn = async (signalText: string): Promise<void> => {
        const sid = chatStore.getActiveId();
        const current = chatStore.getSnapshot();
        if (current.running[sid]) return; // busy — stays queued, flushed on idle
        const session = current.sessions.find(s => s.id === sid);
        if (!session) return;
        // Routes to the ACTIVE session even when the plan belongs to another
        // symbol/session — the dock has one transcript; deliberate v1 scope.
        const bot = bots.find(b => b.id === session.botId);
        const seatModel = session.kind === 'panel' ? session.panelModels?.[0] : undefined;
        const config = (seatModel ? configForSeat(seatModel.providerId, seatModel.modelId) : null)
            ?? (bot ? configForSeat(bot.providerId, bot.modelId) : null)
            ?? provider;
        if (!config) return;
        // Strip the leading machine-tag ([HARNESS SIGNAL …] / [HARNESS
        // TRIGGER …]) so the user sees a readable line, not the raw envelope.
        const noticeLine = signalText.split('\n')[0].replace(/^\[[^\]]*\]\s*/, '').replace(/^⚡\s*/, '').trim();
        const noticeEntry: LiveEntry = { id: newId('n'), role: 'ai', text: '', tools: [noticeLine], notice: true, at: Date.now() };
        const aiEntry: LiveEntry = { id: newId('a'), role: 'ai', text: '', tools: [], streaming: true, at: Date.now(), ...(bot ? { speaker: bot.name } : {}) };
        mutate(sid, s => ({ ...s, updatedAt: Date.now(), entries: [...s.entries, noticeEntry, aiEntry] }));
        const controller = new AbortController();
        chatStore.beginRun(sid, controller);
        const contextBlock = await buildContextBlock();
        if (controller.signal.aborted) {
            mutate(sid, s => ({ ...s, entries: s.entries.filter(e => e.id !== aiEntry.id) }));
            endRunOwned(sid, controller);
            return;
        }
        const messages: ChatMessage[] = [
            { role: 'system', content: systemPromptFor(bot) },
            ...session.entries.slice(-10).flatMap(e =>
                e.text.trim() && !e.notice ? [{ role: e.role === 'user' ? 'user' : 'assistant', content: e.text } as ChatMessage] : []),
            { role: 'user', content: `${contextBlock}\n\n${signalText}` },
        ];
        try {
            await runSeatTurn({ sid, entryId: aiEntry.id, config, messages, mailboxSeat: '' });
        } catch (e) {
            // A Stop of a harness warning is not a failure to narrate.
            if (!controller.signal.aborted) {
                const message = e instanceof Error ? e.message : String(e);
                mutate(sid, s => ({ ...s, entries: s.entries.map(en => (en.id === aiEntry.id && !en.text ? { ...en, text: `The harness warning failed: ${message}`, streaming: false } : en)) }));
            }
        } finally {
            mutate(sid, s => ({ ...s, entries: s.entries.map(en => (en.id === aiEntry.id ? { ...en, streaming: false } : en)) }));
            endRunOwned(sid, controller);
        }
    };

    return { send, runFullAnalysis, runHarnessTurn };
};
