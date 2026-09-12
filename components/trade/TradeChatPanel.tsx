/**
 * TradeChatPanel — the Chart AI dock on the trade surface. EVERY message
 * carries a freshly fetched, code-calculated market packet, and the model can
 * pull even more itself through the desk tools: get_market_packet (the full
 * hybrid pull), get_all_timeframes (every timeframe + book/funding/OI at
 * once), get_chart_view (candles + live mark + verdict levels + the
 * order book + the user's own drawings), and the GROWTH set —
 * write_memory_note / get_notebook_map / propose_skill / revise_skill /
 * amend_memory / forge_tool — so the model can create, update and edit its
 * own memory, skills and tools right from this chat (proposals still need the
 * human's approval in Settings / the Coach inbox; visible status rows show
 * every side-effect). It can also DRAW on the live chart exactly like the
 * user: mark_trade_levels lays an Entry/SL/TP plan as labeled lines,
 * draw_on_chart adds a trendline/ray/zone, clear_chart_drawings wipes them —
 * the model's marks render on the canvas and flow back into its own context.
 *
 * The composer mirrors the reference agent client: a model selector, a +
 * attach button (files + images), a chart-screenshot button (the model sees
 * the chart as an image AND the image renders in the transcript), and a
 * thinking-effort toggle (Off → Max). AI answers stream with a real
 * collapsible Thinking row and fade in as text lands.
 *
 * Sessions: parallel chats persisted per user (new / switch / delete). A
 * session is SOLO (one model, optionally bound to a roster bot persona),
 * a PANEL (up to 5 models that see each other's turns, can DM each other
 * through the desk mailbox, and close with one synthesized answer), or an
 * ANALYSIS run (the full ensemble pipeline — hybrid intelligence, debate,
 * verdict — launched from this chat and answered back into it). The whole
 * dock is drag-resizable, collapsible to a rail, and expandable full width.
 *
 * No order execution — this is the copilot read of the tape, not a button.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Brain, Camera, Check, ChevronDown, Copy, FileText, Gavel, History, MoreHorizontal, PanelRightOpen, Plus, Search, ShieldCheck, Sparkles, Trash2, TriangleAlert, X } from 'lucide-react';
import { ProviderConfig } from '../../types/provider';
import type { LoggedTrade } from '../../types';
import { ChatMessage, ContentPart } from '../../services/providers/GenericProviderService';
import { streamChatWithDeskTools, type DeskToolCall, type DeskToolResult } from '../../services/analysis/DeskToolsService';
import { fetchHybridData, generateHybridPromptInjection } from '../../services/analysis/HybridIntelligenceService';
import {
    buildSkillsIndexForPrompt, buildTradeChatContext, describeChartSnapshotForModel, TRADE_CHAT_SYSTEM_PROMPT,
} from '../../services/trade/tradeChatContext';
import {
    describeDrawingsForModel, drawingFromChartTool, drawingsFromLevelTool, type ChartDrawing,
} from '../../services/trade/chartDrawings';
import { parseTradeProposal, type TradeProposal } from '../../services/trade/proposedTrade';
import * as levelWatch from '../../services/trade/levelWatchService';
import { describePlanForModel, type WatchPlan } from '../../services/trade/tradePlanLevels';
import * as watchService from '../../services/trade/watchService';
import { parsePriceWatch, parseTimeWake, describeWatchesForModel } from '../../services/trade/chartTriggers';
import { phtClock } from '../../utils/timezone';
import { ensureNotifyPermission } from '../../services/infrastructure/notify';
import { recordSessionForReview, runSessionSkillReview, runThesisResolver, type ReviewableSession } from '../../services/learning/sessionSkillReview';
import { runTraderLearner } from '../../services/learning/traderLearner';
import { tipForSeed } from '../../utils/tradingTips';
import * as supervisorStore from '../../services/learning/supervisorStore';
import {
    ensureSupervisorListeners, nudgeSupervisor, setSessionModel,
} from '../../services/learning/skillSupervisor';
import SupervisorPanel from './SupervisorPanel';
import type { SupervisorPhase } from '../../services/learning/supervisorStore';
import { getActiveUsername } from '../../utils/activeUser';
import { listSkills } from '../../services/learning/SkillMemoryService';
import { buildProfileMemoryIndex } from '../../services/learning/profileMemory';
import { isPassReply } from '../../services/agents/groupRounds';
import { saveBot } from '../../services/agents/agentRoster';
import {
    titleFromMessage, PANEL_MAX_MODELS,
} from '../../services/trade/chatSessions';
import * as chatStore from '../../services/trade/chatStore';
import type { LiveEntry, LiveSession } from '../../services/trade/chatStore';
import {
    panelSeats, planPanelTurn, formatRoomTranscript, parsePanelMentions, panelCouldStillBePass,
} from '../../services/trade/chatPanel';
import { createDebateMailbox, formatDmEventLine } from '../../services/analysis/DebateMailbox';
import type { ChartSnapshot } from './TradingChart';
import { intervalSeconds } from './TradingChart';
import type { AgentBot } from '../../services/agents/agentRoster';
import { seatPersonaPrompt } from '../../services/agents/seatPersonas';
import { getFirstReadyProvider, isProviderReady, formatModelDisplayName, resolveChatModelSelection, findChatModelOwner, chatModelIdOf } from '../../utils/providerUtils';
import { isVisionModel } from '../../utils/modelUtils';
import { splitThinkingFromOutput } from '../../utils/thinkingSplit';
import { copyText } from '../../utils/clipboard';
import { TASK_BUDGETS } from '../../services/providers/taskBudgets';
import { effortForTask, ReasoningEffort } from '../../services/providers/reasoningControls';
import { useSmoothStreamText } from '../../hooks/useSmoothStreamText';
import ModelPicker from '../shared/ModelPicker';
import ReasoningRow from '../shared/ReasoningRow';
import ToolActivityRow from '../shared/ToolActivityRow';
import ToolActionsRow from '../chat/ToolActionsRow';
import { SendIcon, StopIcon } from '../shared/Icons';
import MarkdownContent from '../shared/MarkdownContent';
import NewBotDialog from '../chat/NewBotDialog';

interface TradeChatPanelProps {
    symbol: string;
    interval: string;
    providers: ProviderConfig[];
    selectedChatModel: string;
    onSelectChatModel: (modelId: string) => void;
    /** Websocket feed status label for the header hint only — the panel's
     *  context packet is fetched fresh per send regardless. */
    live?: boolean;
    /** Levels currently drawn on the chart (Entry/SL/TP) — forwarded to the
     *  desk tools so get_chart_view can report what the user sees. */
    chartLevels?: { label: string; price: number }[];
    /** The user's own chart drawings (trendlines, zones…) — model-readable. */
    chartDrawings?: ChartDrawing[];
    /** Shapes the MODEL drew via desk tools — merged into what the model
     *  reads (so it sees its own marks) and rendered by the chart. */
    modelDrawings?: ChartDrawing[];
    /** Desk-tool drawing surface (draw_on_chart / mark_trade_levels). */
    addModelDrawings?: (drawings: ChartDrawing[]) => void;
    /** Clear only the model's own shapes (clear_chart_drawings scope=model). */
    clearModelDrawings?: () => void;
    /** Clear model + user shapes (scope=all — only on the user's request). */
    clearAllDrawings?: () => void;
    /** Captures the current chart (candles + drawings) as a PNG data URL. */
    onCaptureChart?: () => string | null;
    /** Plain-data snapshot of everything the canvas currently displays
     *  (last bars, mark, levels, drawings) — rides the context block so the
     *  model reads the SAME numbers the user sees, not a re-fetch. */
    getChartSnapshot?: () => ChartSnapshot | null;
    /** Roster bots — a session can be bound to one for its persona. */
    bots?: AgentBot[];
    /** The user's logged trade history — feeds the desk tools' recall /
     *  get_setup_history_stats so the model learns from what the user traded. */
    trades?: LoggedTrade[];
    /** A roster click (Agents tab) asked Chart AI to open this bot: create
     *  (or switch to) a session bound to it. Nonce-keyed so repeats work. */
    botSessionRequest?: { botId: string; nonce: number };
    /** Same for group rooms and the Coach inbox. */
    groupSessionRequest?: { groupId: string; nonce: number };
    coachSessionRequest?: number;
    /** Launches the FULL ensemble pipeline from this chat (hybrid data in,
     *  debate verdict back as an AI entry). Absent ⇒ the option is hidden. */
    onRunAnalysis?: (prompt: string, images: Array<{ name: string; dataURL: string }>) => Promise<string>;
    /** "Log this trade" on a model proposal → App records it as an OPEN
     *  (PENDING) trade the outcome autopilot later scores. Absent ⇒ the Log
     *  button is hidden (no journal attached). */
    onLogProposedTrade?: (proposal: TradeProposal) => void;
    /** Report a presented plan to the harness level-watch (TradeView arms
     *  it; a later price touch comes back as a [HARNESS SIGNAL] turn). */
    onPlanPresented?: (plan: WatchPlan) => void;
    /** Roster surfaces carried into the dock: the Coach inbox and group
     *  rooms render INSIDE the session tabs (App owns the wiring — the dock
     *  only shows the slot). Absent ⇒ those session options are hidden. */
    renderCoachSurface?: () => React.ReactNode;
    renderGroupSurface?: (groupId: string) => React.ReactNode;
    /** Group rooms available to open as a session (title for the tab). */
    groups?: Array<{ id: string; name: string }>;
    /** Dock geometry controls, hoisted to the trade layout (drag handle). */
    collapsed?: boolean;
    onToggleCollapsed?: () => void;
    expanded?: boolean;
    onToggleExpanded?: () => void;
}

const TRADE_TOOLS = [
    'get_price_snapshot', 'get_order_book', 'get_derivatives',
    'get_liquidations', 'get_session_context', 'get_market_packet', 'get_all_timeframes', 'get_chart_view',
    'get_btc_context', 'recall', 'get_setup_history_stats', 'web_search', 'scan_setups',
    // Growth set: the model edits its own memory, skills and tools from here.
    'write_memory_note', 'get_notebook_map', 'propose_skill', 'revise_skill',
    'amend_memory', 'forge_tool',
    // Chart-action set: the model draws on the live chart (levels, lines).
    'draw_on_chart', 'mark_trade_levels', 'clear_chart_drawings', 'present_trade',
    // Watch/schedule harness: real-time price triggers + time wake-ups.
    'watch_price', 'wake_me', 'cancel_watch',
    // Collaboration memory: this environment's MEMORY.md analogue — the model
    // maintains durable facts about the USER (index always loaded, bodies on demand).
    'remember', 'read_memory', 'forget',
];

const QUICK_PROMPTS = ['Read this chart', 'Key levels?', 'What is the bias?', 'Order-flow pressure?'];

const EFFORT_CHOICES: { id: ReasoningEffort | 'auto'; label: string }[] = [
    { id: 'off', label: 'Off' },
    { id: 'auto', label: 'Auto' },
    { id: 'low', label: 'Low' },
    { id: 'medium', label: 'Medium' },
    { id: 'high', label: 'High' },
    { id: 'max', label: 'Max' },
];

/** Per-send cap on attached files (keeps prompts sane). */
const MAX_ATTACHMENTS = 4;
const MAX_FILE_CHARS = 200_000;

/** Short-TTL cache of the slow hybrid-packet pull, keyed by symbol — lets a
 *  rapid follow-up question start the model without re-fetching. The market
 *  moves, so the window is deliberately tight. */
const PACKET_CACHE_MS = 8_000;
const packetCache = new Map<string, { markdown: string; atMs: number }>();
/** Test hook: drop cached packets so a test can observe the fetch path. */
export const __clearPacketCacheForTests = (): void => packetCache.clear();

interface Attachment {
    id: string;
    kind: 'image' | 'file';
    name: string;
    /** data URL for images, text content for files. */
    payload: string;
}

const newId = (prefix: string): string => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

/** "2 days ago" style relative time — the Past Conversations palette's right
 *  column, copied from the reference's recency labels. */
const relTime = (ts: number): string => {
    const mins = Math.max(0, Math.round((Date.now() - ts) / 60_000));
    if (mins < 1) return 'now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.round(hours / 24);
    if (days < 7) return `${days} ${days === 1 ? 'day' : 'days'} ago`;
    return `${Math.round(days / 7)} wk ago`;
};

/** Phase-honest icon for the supervisor indicator — the icon ALWAYS tells
 *  the truth about what the supervising model is doing right now. */
const SUPERVISOR_PHASE_ICON: Record<SupervisorPhase, React.ReactNode> = {
    idle: <Sparkles className="h-4 w-4" />,
    reviewing: <Search className="h-4 w-4" />,
    verifying: <ShieldCheck className="h-4 w-4" />,
    enhancing: <Sparkles className="h-4 w-4" />,
    deciding: <Gavel className="h-4 w-4" />,
    learning: <Brain className="h-4 w-4" />,
};

/** The live supervisor indicator: swaps icon per phase + pulses while a
 *  supervision call is in flight; click opens the live panel. */
const SupervisorIndicator: React.FC<{ onOpen: () => void; compact?: boolean }> = ({ onOpen, compact = false }) => {
    const snap = useSyncExternalStore(supervisorStore.subscribe, supervisorStore.getSnapshot, supervisorStore.getSnapshot);
    const active = snap.running;
    const Icon = SUPERVISOR_PHASE_ICON[snap.phase] ?? SUPERVISOR_PHASE_ICON.idle;
    return (
        <button
            type="button"
            onClick={onOpen}
            data-testid="supervisor-indicator"
            aria-label="Skill supervisor"
            title={active ? `${snap.modelName ? `${snap.modelName} — ` : ''}${snap.activity || 'supervising…'}` : 'Skill supervisor — watching the queues (click to open)'}
            className={`shrink-0 rounded-control transition-colors ${active ? 'animate-pulse text-cyan-300' : 'text-zinc-600 hover:text-zinc-300'} ${compact ? 'p-1' : 'p-1.5'}`}
        >
            {Icon}
        </button>
    );
};

const TradeChatPanel: React.FC<TradeChatPanelProps> = ({
    symbol, interval, providers, selectedChatModel, onSelectChatModel, live = false,
    chartLevels, chartDrawings, modelDrawings, addModelDrawings, clearModelDrawings, clearAllDrawings,
    onCaptureChart, getChartSnapshot, bots = [], trades = [], botSessionRequest, groupSessionRequest, coachSessionRequest, onRunAnalysis, onLogProposedTrade, onPlanPresented,
    renderCoachSurface, renderGroupSurface, groups = [],
    collapsed, onToggleCollapsed, expanded, onToggleExpanded,
}) => {
    // Session state lives in the module store (chatStore) so an in-flight
    // answer survives switching to another surface tab and back — the panel
    // unmounts, but the run keeps streaming into the store.
    const snap = useSyncExternalStore(chatStore.subscribe, chatStore.getSnapshot, chatStore.getSnapshot);
    const sessions = snap.sessions;
    const activeId = snap.activeId;
    const [draft, setDraft] = useState('');
    const [contextAt, setContextAt] = useState<number | null>(null);
    const [attachments, setAttachments] = useState<Attachment[]>([]);
    const [effort, setEffort] = useState<ReasoningEffort | 'auto'>('auto');
    const [showEffortMenu, setShowEffortMenu] = useState(false);
    const [showNewMenu, setShowNewMenu] = useState(false);
    /** The reference's Agent-panel header cluster: + / history / ⋯ / ×. The
     *  history button opens a "Past Conversations" palette (search + recent
     *  sessions with relative times); ⋯ opens the Customization popover. */
    const [historyOpen, setHistoryOpen] = useState(false);
    /** The supervisor detail panel (click the header indicator). */
    const [supervisorOpen, setSupervisorOpen] = useState(false);
    const [historyQuery, setHistoryQuery] = useState('');
    const [historySel, setHistorySel] = useState(0);
    const [historyShowAll, setHistoryShowAll] = useState(false);
    const [showAttachMenu, setShowAttachMenu] = useState(false);
    const [showNewBot, setShowNewBot] = useState(false);
    /** Per-entry disposition of a model proposal card: logged / dismissed. */
    const [proposalState, setProposalState] = useState<Record<string, 'logged' | 'dismissed'>>({});
    const [panelPickerFor, setPanelPickerFor] = useState<string | null>(null);
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    /** The AI entry currently streaming, so a present_trade tool call can
     *  attach its proposal to the right message for the card. */
    const activeEntryIdRef = useRef<string | null>(null);

    const activeSession = sessions.find(s => s.id === activeId) ?? sessions[0];
    const entries = activeSession.entries;
    const isPanel = activeSession.kind === 'panel';
    const boundBot = activeSession.botId ? bots.find(b => b.id === activeSession.botId) : undefined;
    const busy = !!snap.running[activeId];

    /** Compact index of the trader's skill library — rides the system prompt
     *  so the model APPLYs existing skills and strategies instead of
     *  free-styling (the mandate lives in TRADE_CHAT_SYSTEM_PROMPT). Read
     *  FRESH on every prompt build (not a memo): a skill proposed, approved
     *  or retired mid-session — in this dock or anywhere else — is in the
     *  next turn's prompt. One sync index read per send, against a network
     *  packet fetch: negligible. */
    const skillsIndexForPrompt = (): string => {
        try {
            return buildSkillsIndexForPrompt(listSkills().map(({ file, meta }) => ({
                slug: file.name.replace(/\.md$/i, ''),
                status: meta.status,
                kind: meta.kind,
                description: meta.description,
                ifCondition: meta.ifCondition,
                thenAction: meta.thenAction,
            })));
        } catch {
            return '';
        }
    };

    /** The system prompt every seat of this session answers under. The
     *  collaboration-memory index is read FRESH per prompt (like the skills
     *  index): a `remember` call lands in the NEXT turn's prompt immediately,
     *  and the model always sees what it already knows before writing — the
     *  update-don't-duplicate discipline of this environment's memory. */
    const systemPromptFor = useCallback((persona?: string): string => {
        const skillsBlock = skillsIndexForPrompt();
        const memoryBlock = buildProfileMemoryIndex();
        const base = `${TRADE_CHAT_SYSTEM_PROMPT}${skillsBlock ? `\n\n${skillsBlock}` : ''}${memoryBlock ? `\n\n${memoryBlock}` : ''}`;
        return persona ? `${base}\n\n## Your role\n${persona}` : base;
    }, []);

    /** What the model reads as "the drawings on the chart": the user's own
     *  shapes PLUS the model's marks from earlier turns — so it sees its own
     *  Entry/SL/TP lines and builds on them instead of redrawing. */
    const allDrawings = useMemo(
        () => [...(chartDrawings ?? []), ...(modelDrawings ?? [])],
        [chartDrawings, modelDrawings],
    );

    /** Desk-tool drawing surface. draw_on_chart / mark_trade_levels /
     *  clear_chart_drawings land here — the market executor never sees
     *  them (they touch the live canvas). Bars-ago anchors resolve against
     *  the chart's newest candle so a line the model draws at "10 bars ago"
     *  lands where the user is looking. */
    const executePanelTool = useCallback(async (call: DeskToolCall): Promise<DeskToolResult | null> => {
        const name = call.name;
        if (name !== 'draw_on_chart' && name !== 'mark_trade_levels' && name !== 'clear_chart_drawings'
            && name !== 'present_trade' && name !== 'watch_price' && name !== 'wake_me' && name !== 'cancel_watch') return null;
        const args = call.arguments ?? {};
        const receipt = (ok: boolean, content: string): DeskToolResult => ({ toolCallId: call.id, name, ok, content });
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
                const { watch, error } = parsePriceWatch(args, { symbol, makeId, nowMs });
                if (error || !watch) return receipt(false, `watch_price rejected: ${error ?? 'invalid'}`);
                watchService.arm(watch);
                return receipt(true, `Watch ${watch.id} armed: ${watch.symbol} ${watch.condition} ${watch.price}, expires ${phtClock(watch.expiresAt)} PHT. The harness will wake you with a [HARNESS TRIGGER] the first time it holds — then it lapses. Tell the user you are watching for it.`);
            }
            const { wake, error } = parseTimeWake(args, { symbol, makeId, nowMs });
            if (error || !wake) return receipt(false, `wake_me rejected: ${error ?? 'invalid'}`);
            watchService.arm(wake);
            return receipt(true, `Scheduled wake ${wake.id} at ${phtClock(wake.atMs)} PHT (in ${Math.round((wake.atMs - nowMs) / 60_000)}m). The harness will signal you then to re-check ${wake.symbol}: "${wake.note}".`);
        }
        if (name === 'cancel_watch') {
            const ids = Array.isArray(args.ids) ? args.ids.map(String) : [];
            let n = 0;
            for (const id of ids) if (watchService.cancel(id)) n += 1;
            if (args.allForSymbol) {
                const target = String(args.symbol ?? symbol).toUpperCase();
                n += watchService.cancelWhere(w => w.symbol === target);
            }
            const left = watchService.list().map(w => w.id);
            return receipt(true, n > 0
                ? `Cancelled ${n} watch${n === 1 ? '' : 'es'}. Still armed: ${left.join(', ') || 'none'}.`
                : `Nothing to cancel (ids: ${ids.join(', ') || '—'}). Still armed: ${left.join(', ') || 'none'}.`);
        }
        // present_trade: draw the plan, ARM the harness level-watch on it,
        // AND surface a Log-this-trade card on the streaming entry.
        if (name === 'present_trade') {
            const { proposal, error } = parseTradeProposal({ ...args, symbol: args.symbol || symbol });
            if (error || !proposal) return receipt(false, `present_trade rejected: ${error ?? 'invalid proposal'}`);
            // The DOCK generates the stable plan id: the level-watch arms on
            // it, the receipt names its level ids for the model to quote,
            // and "Log this trade" carries it onto the journal row.
            proposal.planId = `${proposal.symbol.replace(/USDT$/i, '').toLowerCase()}-${Date.now().toString(36)}`;
            const { drawings } = drawingsFromLevelTool({ entry: proposal.entry, stopLoss: proposal.stopLoss, takeProfits: proposal.takeProfits });
            addModelDrawings?.(drawings);
            onPlanPresented?.({
                planId: proposal.planId, symbol: proposal.symbol, direction: proposal.direction,
                entry: proposal.entry, stopLoss: proposal.stopLoss, takeProfits: proposal.takeProfits,
            });
            const entryId = activeEntryIdRef.current;
            const sid = activeId;
            if (entryId) chatStore.mutate(sid, s => ({ ...s, entries: s.entries.map(e => (e.id === entryId ? { ...e, proposal } : e)) }));
            const rr = proposal.takeProfits.length && Math.abs(proposal.entry - proposal.stopLoss) > 0
                ? (Math.abs(proposal.takeProfits[0] - proposal.entry) / Math.abs(proposal.entry - proposal.stopLoss)).toFixed(1) : '—';
            const levelIds = [`${proposal.planId}:ENTRY`, `${proposal.planId}:SL`,
                ...proposal.takeProfits.map((_, i) => `${proposal.planId}:TP${i + 1}`)];
            return receipt(true, `Presented ${proposal.direction} ${proposal.symbol} @ ${proposal.entry}, SL ${proposal.stopLoss}, TP ${proposal.takeProfits.join('/')}, R:R ~${rr}:1. The user sees a "Log this trade" card. The harness now watches these levels — ids ${levelIds.join(', ')} — and will send you a [HARNESS SIGNAL] when one is reached; refer to levels by those ids and never re-announce one that already fired.`);
        }
        if (name === 'clear_chart_drawings') {
            const scope = args.scope === 'all' ? 'all' : 'model';
            if (!clearModelDrawings && !clearAllDrawings) return receipt(false, 'clear_chart_drawings: no chart is attached to this session.');
            if (scope === 'all') clearAllDrawings?.();
            else clearModelDrawings?.();
            return receipt(true, scope === 'all'
                ? 'Cleared ALL drawings (the model\'s marks and the user\'s own shapes) from the chart.'
                : 'Cleared the model\'s own drawings from the chart (the user\'s shapes were kept).');
        }
        if (!addModelDrawings) return receipt(false, `${name}: no chart is attached to this session.`);
        if (name === 'mark_trade_levels') {
            const { drawings, error } = drawingsFromLevelTool(args);
            if (error) return receipt(false, `mark_trade_levels rejected: ${error}`);
            addModelDrawings(drawings);
            const listed = drawings.map(d => `${d.label} ${d.points[0].p}`).join(', ');
            return receipt(true, `Marked on the chart: ${listed}. The user sees these lines now.`);
        }
        // draw_on_chart — resolve bars-ago anchors against the newest candle.
        const snap = getChartSnapshot?.() ?? null;
        const lastBarTime = snap && snap.candles.length > 0
            ? snap.candles[snap.candles.length - 1].time
            : Math.floor(Date.now() / 1000);
        const { drawings, error } = drawingFromChartTool(args, { lastBarTime, barSeconds: intervalSeconds(interval as never) });
        if (error) return receipt(false, `draw_on_chart rejected: ${error}`);
        addModelDrawings(drawings);
        const d = drawings[0];
        const described = describeDrawingsForModel([d]).split('\n').slice(1).join(' ').trim();
        return receipt(true, `Drew on the chart: ${described || d.kind}. The user sees it now.`);
    }, [addModelDrawings, clearModelDrawings, clearAllDrawings, getChartSnapshot, interval, symbol, activeId, onPlanPresented]);

    // The solo chat model: a `providerId::modelId` selection (the composer's
    // picker is provider-qualified so duplicate model names across providers
    // can't silently route to the wrong one). Legacy bare model ids resolve
    // heuristically; when nothing matches, the first ready provider answers
    // so the dock never dies — but NEVER silently: modelIssue explains it.
    const resolvedSelection = useMemo(() => resolveChatModelSelection(providers, selectedChatModel), [providers, selectedChatModel]);
    const provider = resolvedSelection ?? getFirstReadyProvider(providers);
    // A stored pick can go stale (provider edited, disabled, key removed,
    // deleted) — the fallback must be VISIBLE, not silent.
    const modelIssue = useMemo((): string | null => {
        if (!selectedChatModel || resolvedSelection || !provider) return null;
        if (isPanel || activeSession?.botId) return null; // panels answer from seats; bots from their own config
        const owner = findChatModelOwner(providers, selectedChatModel);
        const modelId = chatModelIdOf(selectedChatModel);
        if (!owner) {
            return `The selected model "${modelId}" is no longer configured on any provider.`;
        }
        return `The provider for "${modelId}" (${owner.config.name}) is disabled or has no API key.`;
    }, [selectedChatModel, resolvedSelection, provider, providers, isPanel, activeSession?.botId]);

    /** Resolve a `${providerId}:${modelId}` seat to a runnable config. */
    const configForSeat = useCallback((providerId: string, modelId: string): ProviderConfig | null => {
        const base = providers.find(p => p.id === providerId && isProviderReady(p)) ?? providers.find(p => p.id === providerId && p.isEnabled);
        if (!base) return null;
        return { ...base, selectedModel: modelId };
    }, [providers]);

    // ── Per-session composer memory ─────────────────────────────────────────
    // Switching sessions restores THAT chat's thinking-effort and solo-model
    // choice the same way panel sessions already restore their seats. Reads
    // the store fresh inside the effect so it fires on SWITCH, not on every
    // streaming patch; sessions without stored choices keep the current ones.
    const effortRef = useRef(effort);
    effortRef.current = effort;
    const soloModelRef = useRef(selectedChatModel);
    soloModelRef.current = selectedChatModel;
    // WHO SUPERVISES: the ACTIVE session's model — a panel's FIRST seat when
    // several are selected — is reported to the supervisor on every switch
    // and every send, so oversight always runs on the model the user chose.
    const reportSupervisorModel = useCallback((session: LiveSession | undefined): void => {
        if (!session) return;
        const seat = session.kind === 'panel' ? session.panelModels?.[0] : undefined;
        const supBot = session.botId ? bots.find(b => b.id === session.botId) : undefined;
        setSessionModel(
            (seat ? configForSeat(seat.providerId, seat.modelId) : null)
                ?? (supBot ? configForSeat(supBot.providerId, supBot.modelId) : null)
                ?? (session.kind !== 'panel' ? provider : null),
        );
    }, [bots, configForSeat, provider]);
    useEffect(() => {
        const s = chatStore.getSnapshot().sessions.find(x => x.id === activeId);
        if (!s) return;
        const nextEffort = (s.effort as ReasoningEffort | 'auto' | undefined) ?? 'auto';
        if (nextEffort !== effortRef.current) setEffort(nextEffort);
        if (s.kind !== 'panel' && !s.botId && s.soloModel && s.soloModel !== soloModelRef.current) {
            onSelectChatModel(s.soloModel);
        }
        reportSupervisorModel(s);
    }, [activeId, onSelectChatModel, reportSupervisorModel]);
    // The supervisor's queue-event listeners (drafts/tools/amendments landing
    // anywhere schedule a debounced pass) — wired once on dock mount.
    useEffect(() => { ensureSupervisorListeners(); }, []);
    /** Composer model change: keep the app-wide default AND bind it to the
     *  active session so coming back to this chat reselects it. */
    const changeSoloModel = useCallback((value: string): void => {
        onSelectChatModel(value);
        if (!isPanel) chatStore.mutate(activeId, sess => ({ ...sess, soloModel: value }));
    }, [onSelectChatModel, isPanel, activeId]);
    const changeEffort = useCallback((next: ReasoningEffort | 'auto'): void => {
        setEffort(next);
        chatStore.mutate(activeId, sess => ({ ...sess, effort: next }));
    }, [activeId]);

    // Follow the bottom while the answer streams.
    useEffect(() => {
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [entries]);

    // NOTE: no unmount-abort on purpose. Switching to another surface tab
    // unmounts this panel; the run must keep streaming into the store so
    // returning shows the completed answer. Only an explicit Stop (or
    // deleting a session) aborts.

    // The Agents tab handed us a bot: reuse (or create) its bound session
    // and make it active. Nonce-keyed so re-clicking the same bot re-fires.
    const lastBotRequestRef = useRef(0);
    useEffect(() => {
        if (!botSessionRequest || botSessionRequest.nonce === lastBotRequestRef.current) return;
        lastBotRequestRef.current = botSessionRequest.nonce;
        const existing = sessions.find(s => s.botId === botSessionRequest.botId);
        if (existing) { chatStore.setActiveId(existing.id); return; }
        chatStore.addSession({ botId: botSessionRequest.botId });
    }, [botSessionRequest, sessions]);

    // Same two effects for group rooms and the Coach inbox.
    const lastGroupRequestRef = useRef(0);
    useEffect(() => {
        if (!groupSessionRequest || groupSessionRequest.nonce === lastGroupRequestRef.current) return;
        lastGroupRequestRef.current = groupSessionRequest.nonce;
        const name = groups.find(g => g.id === groupSessionRequest.groupId)?.name ?? 'Room';
        const existing = sessions.find(s => s.groupId === groupSessionRequest.groupId);
        if (existing) { chatStore.setActiveId(existing.id); return; }
        chatStore.addSession({ kind: 'group', title: name, groupId: groupSessionRequest.groupId });
    }, [groupSessionRequest, groups, sessions]);

    const lastCoachRequestRef = useRef(0);
    useEffect(() => {
        if (!coachSessionRequest || coachSessionRequest === lastCoachRequestRef.current) return;
        lastCoachRequestRef.current = coachSessionRequest;
        const existing = sessions.find(s => s.kind === 'coach');
        if (existing) { chatStore.setActiveId(existing.id); return; }
        chatStore.addSession({ kind: 'coach', title: 'Coach inbox' });
    }, [coachSessionRequest, sessions]);

    const mutate = (id: string, fn: (s: LiveSession) => LiveSession): void => {
        chatStore.mutate(id, fn);
    };

    /** The fresh code-calculated packet every message rides (fetched ONCE per
     *  send — shared across all panel seats so they argue about the same tape).
     *  The hybrid pull is the slow network leg before the first token, so a
     *  short-TTL cache (per symbol) lets rapid follow-up questions skip it —
     *  only the PACKET is cached; drawings/plans/on-screen are rebuilt fresh
     *  every send, and the block carries the real fetch time so the model
     *  knows its age. */
    const buildContextBlock = useCallback(async (): Promise<string> => {
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
        const cached = packetCache.get(symbol);
        if (cached && Date.now() - cached.atMs < PACKET_CACHE_MS) {
            return buildTradeChatContext({ symbol, interval, packetMarkdown: cached.markdown, fetchedAtMs: cached.atMs, drawingsDescription: describeDrawingsForModel(allDrawings), onScreenDescription: onScreen, plansDescription: plansBlock });
        }
        try {
            const packet = await fetchHybridData(symbol);
            const markdown = generateHybridPromptInjection(packet, { compact: true });
            const atMs = Date.now();
            setContextAt(atMs);
            packetCache.set(symbol, { markdown, atMs });
            return buildTradeChatContext({ symbol, interval, packetMarkdown: markdown, fetchedAtMs: atMs, drawingsDescription: describeDrawingsForModel(allDrawings), onScreenDescription: onScreen, plansDescription: plansBlock });
        } catch {
            return buildTradeChatContext({ symbol, interval, packetMarkdown: '', fetchedAtMs: Date.now(), drawingsDescription: describeDrawingsForModel(allDrawings), onScreenDescription: onScreen, plansDescription: plansBlock });
        }
    }, [symbol, interval, allDrawings, getChartSnapshot]);

    /** Stream one seat turn into its entry; resolves with the full text. */
    const runSeatTurn = useCallback(async (params: {
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
        // present_trade attaches its proposal to whichever entry is streaming.
        activeEntryIdRef.current = entryId;
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
            executePanelTool,
            trades,
            mailbox,
            mailboxSeat,
            mailboxRound: 0,
            onMailSent,
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
        const r = reasoning.trim();
        const f = full.trim();
        if (r && settled.output === '' && f.startsWith(r)) {
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
    }, [symbol, interval, effort, chartLevels, allDrawings, executePanelTool]);

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
    const maybeReviewSessions = useCallback((supervisorCfg: ProviderConfig | null): void => {
        const model = supervisorCfg ?? provider;
        if (!model) return;
        const user = getActiveUsername();
        void runThesisResolver(user, model, trades).catch(() => { /* best-effort */ });
        const reviewable: ReviewableSession[] = sessions
            .filter(s => s.kind !== 'coach' && s.kind !== 'group' && s.entries.some(e => e.role === 'ai' && e.text.trim()))
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
    }, [provider, sessions, symbol, trades]);

    const send = useCallback(async (raw: string): Promise<void> => {
        const text = raw.trim();
        if ((!text && attachments.length === 0) || busy) return;
        if (!provider) return;
        setDraft('');
        const sentAttachments = attachments;
        setAttachments([]);
        const sid = activeId;
        const session = sessions.find(s => s.id === sid);
        if (!session) return;
        // WHO SUPERVISES: this session's model — a panel's FIRST seat when
        // several are selected. Reported now, and it rides every learning
        // hook fired from this send's finally block.
        const supSeat = session.kind === 'panel' ? session.panelModels?.[0] : undefined;
        const supBot = session.botId ? bots.find(b => b.id === session.botId) : undefined;
        const supervisorCfg = (supSeat ? configForSeat(supSeat.providerId, supSeat.modelId) : null)
            ?? (supBot ? configForSeat(supBot.providerId, supBot.modelId) : null)
            ?? (session.kind !== 'panel' ? provider : null);
        setSessionModel(supervisorCfg);
        const history = session.entries;
        const imageAttachment = sentAttachments.find(a => a.kind === 'image');
        const fileBlocks = sentAttachments.filter(a => a.kind === 'file')
            .map(a => `\n\n[ATTACHED FILE — ${a.name}]\n${a.payload.slice(0, MAX_FILE_CHARS)}`)
            .join('');
        const userEntry: LiveEntry = { id: newId('u'), role: 'user', text: text || '(chart screenshot)', tools: [], image: imageAttachment?.payload };
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
        const soloAiEntry: LiveEntry = { id: newId('a'), role: 'ai', text: '', tools: [], streaming: true };
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
            entries: [...s.entries, userEntry, ...(isSolo ? [soloAiEntry] : [])],
        }));
        const contextBlock = await buildContextBlock();
        if (controller.signal.aborted) {
            // Stopped during the fetch — undo the optimistic bubbles.
            mutate(sid, s => ({ ...s, entries: s.entries.filter(e => e.id !== userEntry.id && e.id !== soloAiEntry.id) }));
            chatStore.endRun(sid);
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
            const systemPrompt = systemPromptFor(bot ? seatPersonaPrompt(bot) : undefined);
            const canSeeImages = isVisionModel(soloProvider.selectedModel);
            // Solo answers now carry the seat label too, so returning to a
            // session shows WHICH model said each line (the renderer the
            // panel seats already use).
            mutate(sid, s => ({ ...s, entries: s.entries.map(en => (en.id === aiEntry.id ? { ...en, speaker: `${soloProvider.id}:${soloProvider.selectedModel}` } : en)) }));
            const userContent: string | ContentPart[] = imageAttachment && canSeeImages
                ? [{ type: 'text', text: userText }, { type: 'image_url', image_url: { url: imageAttachment.payload } }]
                : imageAttachment
                    ? `${userText}\n\n[The user attached a chart screenshot but this model cannot see images.]`
                    : userText;
            const messages: ChatMessage[] = [
                { role: 'system', content: systemPrompt },
                ...history.slice(-10).flatMap(e =>
                    e.text.trim() ? [{ role: e.role === 'user' ? 'user' : 'assistant', content: e.text } as ChatMessage] : []),
                { role: 'user', content: userContent },
            ];
            try {
                await runSeatTurn({ sid, entryId: aiEntry.id, config: soloProvider, messages, mailboxSeat: '' });
            } catch (e) {
                const message = e instanceof Error ? e.message : String(e);
                mutate(sid, s => ({ ...s, entries: s.entries.map(en => en.id === aiEntry.id && !en.text ? { ...en, text: `The chart copilot could not answer: ${message}`, streaming: false } : en) }));
            } finally {
                mutate(sid, s => ({ ...s, entries: s.entries.map(en => (en.id === aiEntry.id ? { ...en, streaming: false } : en)) }));
                chatStore.endRun(sid);
                maybeReviewSessions(supervisorCfg);
            }
            return;
        }

        // ── PANEL: up to 5 models, one request, cross-talk + synthesis ─────
        const seats = panelSeats(session, formatModelDisplayName);
        if (seats.length < 2) {
            // Say it out loud — a bare return left the user staring at their
            // own message (and leaked the run controller armed above). The
            // user bubble is already painted (optimistic), so just append the
            // notice.
            mutate(sid, s => ({
                ...s,
                entries: [...s.entries, {
                    id: newId('n'), role: 'ai' as const, text: '',
                    tools: ['This panel has fewer than 2 usable seats — add models in the panel picker above.'],
                    notice: true,
                }],
            }));
            chatStore.endRun(sid);
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
                const seatModel = session.panelModels?.find(m => `${m.providerId}:${m.modelId}` === seat.id);
                const seatConfig = seatModel ? configForSeat(seatModel.providerId, seatModel.modelId) : null;
                if (!seatConfig) {
                    // The seat's provider/model vanished from Settings — say so
                    // in the transcript; a silent skip looked like a hang.
                    // Once per seat (the synthesis pass would repeat it).
                    spoken.push(seat.id);
                    if (!unavailableNotified.has(seat.id)) {
                        unavailableNotified.add(seat.id);
                        mutate(sid, s => ({ ...s, entries: [...s.entries, {
                            id: newId('n'), role: 'ai' as const, text: '', streaming: false, notice: true,
                            speaker: seat.id,
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
                    speaker: seat.id,
                };
                mutate(sid, s => ({ ...s, entries: [...s.entries, aiEntry] }));
                const messages: ChatMessage[] = [
                    { role: 'system', content: systemPromptFor(`You are "${seat.name}" on a ${seats.length}-model chart panel. Seats: ${seats.map(x => x.name).join(', ')}.`) },
                    { role: 'user', content: userMsg },
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
                    // friendly error), not just "failed to answer".
                    seatFailed = true;
                    const msg = e instanceof Error ? e.message : String(e);
                    mutate(sid, s => ({ ...s, entries: s.entries.map(en => (en.id === aiEntry.id && !en.text ? { ...en, text: `(this seat failed to answer: ${msg})`, streaming: false } : en)) }));
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
            chatStore.endRun(sid);
            maybeReviewSessions(supervisorCfg);
        }
    }, [activeId, attachments, bots, buildContextBlock, busy, configForSeat, maybeReviewSessions, provider, runSeatTurn, sessions, systemPromptFor]);

    /** "Run full analysis" — the ensemble pipeline launched from this chat;
     *  its verdict comes back as an AI entry in the same transcript. */
    const runFullAnalysis = useCallback(async (): Promise<void> => {
        const text = draft.trim();
        if (!text || busy || !onRunAnalysis) return;
        setDraft('');
        const sentAttachments = attachments;
        setAttachments([]);
        const images = sentAttachments.filter(a => a.kind === 'image').map(a => ({ name: a.name, dataURL: a.payload }));
        const fileNote = sentAttachments.filter(a => a.kind === 'file')
            .map(a => `\n\n[ATTACHED FILE — ${a.name}]\n${a.payload.slice(0, MAX_FILE_CHARS)}`)
            .join('');
        const sid = activeId;
        const userEntry: LiveEntry = { id: newId('u'), role: 'user', text: text + fileNote, tools: [], image: images[0]?.dataURL };
        const aiEntry: LiveEntry = { id: newId('a'), role: 'ai', text: 'Running the full ensemble analysis — hybrid data pull, debate, verdict…', tools: [], streaming: true };
        mutate(sid, s => ({ ...s, title: titleFromMessage(text), updatedAt: Date.now(), entries: [...s.entries, userEntry, aiEntry] }));
        const controller = new AbortController();
        chatStore.beginRun(sid, controller);
        try {
            const answer = await onRunAnalysis(text + fileNote, images);
            if (controller.signal.aborted) return;
            mutate(sid, s => ({ ...s, entries: s.entries.map(e => (e.id === aiEntry.id ? { ...e, text: answer || 'The analysis produced no summary.', streaming: false } : e)) }));
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            mutate(sid, s => ({ ...s, entries: s.entries.map(e => (e.id === aiEntry.id ? { ...e, text: `The analysis run failed: ${message}`, streaming: false } : e)) }));
        } finally {
            chatStore.endRun(sid);
        }
    }, [activeId, attachments, busy, draft, onRunAnalysis]);

    /** Run one queued harness signal (a level-watch price event) as a model
     *  turn: a notice row shows the event, then the model warns the user.
     *  The signal text is synthesized as the user message — it never renders
     *  as a user bubble. Modelled on runFullAnalysis: it arms its own
     *  controller and bypasses the composer's busy/empty guards (the queue
     *  lives in chatStore, so a hit that lands mid-run or mid-unmount is
     *  never dropped — the drain effect below flushes it when idle). */
    const runHarnessTurn = useCallback(async (signalText: string): Promise<void> => {
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
        // TRIGGER …]) so the user sees a readable ⚡ line, not the raw envelope.
        const noticeLine = `⚡ ${signalText.split('\n')[0].replace(/^\[[^\]]*\]\s*/, '').trim()}`;
        const noticeEntry: LiveEntry = { id: newId('n'), role: 'ai', text: '', tools: [noticeLine], notice: true };
        const aiEntry: LiveEntry = { id: newId('a'), role: 'ai', text: '', tools: [], streaming: true };
        mutate(sid, s => ({ ...s, updatedAt: Date.now(), entries: [...s.entries, noticeEntry, aiEntry] }));
        const controller = new AbortController();
        chatStore.beginRun(sid, controller);
        const contextBlock = await buildContextBlock();
        if (controller.signal.aborted) {
            mutate(sid, s => ({ ...s, entries: s.entries.filter(e => e.id !== aiEntry.id) }));
            chatStore.endRun(sid);
            return;
        }
        const messages: ChatMessage[] = [
            { role: 'system', content: systemPromptFor(bot ? seatPersonaPrompt(bot) : undefined) },
            ...session.entries.slice(-10).flatMap(e =>
                e.text.trim() && !e.notice ? [{ role: e.role === 'user' ? 'user' : 'assistant', content: e.text } as ChatMessage] : []),
            { role: 'user', content: `${contextBlock}\n\n${signalText}` },
        ];
        try {
            await runSeatTurn({ sid, entryId: aiEntry.id, config, messages, mailboxSeat: '' });
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            mutate(sid, s => ({ ...s, entries: s.entries.map(en => (en.id === aiEntry.id && !en.text ? { ...en, text: `The harness warning failed: ${message}`, streaming: false } : en)) }));
        } finally {
            mutate(sid, s => ({ ...s, entries: s.entries.map(en => (en.id === aiEntry.id ? { ...en, streaming: false } : en)) }));
            chatStore.endRun(sid);
        }
    }, [bots, buildContextBlock, configForSeat, provider, runSeatTurn, systemPromptFor]);

    // Flush queued harness signals when the session goes idle. takeHarness-
    // Signals emits, so this re-runs with an empty queue and settles.
    useEffect(() => {
        if (busy || snap.signals.length === 0) return;
        const texts = chatStore.takeHarnessSignals();
        if (texts.length > 0) void runHarnessTurn(texts.join('\n\n'));
    }, [busy, snap.signals, runHarnessTurn]);

    // ── Session management ──────────────────────────────────────────────────
    const addSession = useCallback((kind: 'solo' | 'panel' = 'solo', botId?: string): void => {
        // A new session starts bound to the chart + composer state on screen,
        // so coming back to it restores exactly this setup (send re-stamps on
        // every turn; bot-bound sessions take their model from the bot).
        const id = chatStore.addSession({
            kind,
            botId,
            symbol,
            interval,
            effort,
            ...(kind === 'solo' && !botId && selectedChatModel ? { soloModel: selectedChatModel } : {}),
        });
        setShowNewMenu(false);
        if (kind === 'panel') setPanelPickerFor(id);
    }, [symbol, interval, effort, selectedChatModel]);

    const removeSession = useCallback((id: string): void => {
        chatStore.removeSession(id);
    }, []);

    /** Panel seat management: add (max 5) / remove a model. */
    const setPanelModels = useCallback((sid: string, models: Array<{ providerId: string; modelId: string }>): void => {
        mutate(sid, s => ({ ...s, panelModels: models.slice(0, PANEL_MAX_MODELS) }));
    }, []);

    const addPanelSeat = useCallback((value: string): void => {
        if (!panelPickerFor) return;
        const [providerId, modelId] = value.includes('::') ? value.split('::') : [provider?.id ?? '', value];
        if (!modelId) return;
        const session = sessions.find(s => s.id === panelPickerFor);
        const current = session?.panelModels ?? [];
        if (current.some(m => m.modelId === modelId)) return;
        setPanelModels(panelPickerFor, [...current, { providerId: providerId || provider?.id || '', modelId }]);
    }, [panelPickerFor, provider, sessions, setPanelModels]);

    // ── Attachments ─────────────────────────────────────────────────────────
    const attachFiles = (files: FileList | null): void => {
        if (!files) return;
        Array.from(files).slice(0, MAX_ATTACHMENTS - attachments.length).forEach(file => {
            const reader = new FileReader();
            reader.onload = () => {
                const payload = String(reader.result ?? '');
                if (!payload) return;
                setAttachments(prev => prev.length >= MAX_ATTACHMENTS ? prev : [...prev, {
                    id: newId('at'),
                    kind: file.type.startsWith('image/') ? 'image' : 'file',
                    name: file.name,
                    payload,
                }]);
            };
            if (file.type.startsWith('image/')) reader.readAsDataURL(file);
            else reader.readAsText(file);
        });
    };

    const captureChart = (): void => {
        const png = onCaptureChart?.() ?? null;
        if (!png) return;
        setAttachments(prev => [...prev, { id: newId('shot'), kind: 'image', name: 'chart.png', payload: png }]);
    };

    const ready = !!provider && (activeSession.kind !== 'panel' || (activeSession.panelModels?.length ?? 0) >= 2);

    // Past Conversations palette rows: newest first, title-filtered, capped
    // at 8 until "Show N more…" (the reference's exact behavior).
    const historyFiltered = [...sessions]
        .filter(s => !historyQuery.trim() || s.title.toLowerCase().includes(historyQuery.trim().toLowerCase()))
        .sort((a, b) => b.updatedAt - a.updatedAt);
    const historyRows = historyShowAll ? historyFiltered : historyFiltered.slice(0, 8);
    const historyHidden = historyFiltered.length - historyRows.length;

    if (collapsed) {
        return (
            <div className="flex h-10 w-full shrink-0 flex-row items-center gap-3 border-l border-white/[0.06] bg-zinc-900/40 px-3 lg:h-full lg:w-10 lg:flex-col lg:py-3" data-testid="trade-chat-rail">
                <button type="button" onClick={onToggleCollapsed} title="Expand Chart AI" aria-label="Expand Chart AI"
                    className="rounded-control p-1.5 text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100">
                    <PanelRightOpen className="h-4 w-4" />
                </button>
                <span className="select-none text-[10px] font-bold uppercase tracking-widest text-zinc-500 lg:[writing-mode:vertical-rl]">Chart AI</span>
                <span className={`h-2 w-2 rounded-full ${busy ? 'animate-pulse bg-cyan-400' : live ? 'bg-emerald-500' : 'bg-zinc-500'}`} />
                <SupervisorIndicator compact onOpen={() => setSupervisorOpen(true)} />
            </div>
        );
    }

    return (
        <div className="relative flex h-full min-h-0 flex-col border-l border-white/[0.06] bg-zinc-900/40" data-testid="trade-chat-panel">
            {/* Header — the reference's Agent-panel cluster: identity left,
                + / history / ⋯ / × right, nothing else. Sessions are reached
                through the Past Conversations palette, not a tab strip. */}
            <div className="flex shrink-0 items-center gap-2 border-b border-white/[0.06] px-4 py-2.5">
                <span className={`h-2 w-2 shrink-0 rounded-full ${busy ? 'animate-pulse bg-cyan-400' : live ? 'bg-emerald-500' : 'bg-zinc-500'}`} aria-label={live ? 'live market feed connected' : 'market feed polling'} />
                <span className="text-[13px] font-semibold text-zinc-100">Chart AI</span>
                <span className="truncate text-[11px] text-zinc-500" title={activeSession.title}>{activeSession.title}</span>
                <div className="ml-auto flex shrink-0 items-center gap-0.5">
                    <SupervisorIndicator onOpen={() => setSupervisorOpen(true)} />
                    <button type="button" onClick={() => addSession('solo')} aria-label="New chat" title="New chat"
                        className="rounded-control p-1.5 text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-100">
                        <Plus className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={() => { setHistoryOpen(v => !v); setHistoryQuery(''); setHistorySel(0); setHistoryShowAll(false); }}
                        aria-label="Past conversations" aria-expanded={historyOpen} title="Past conversations"
                        className={`rounded-control p-1.5 transition-colors hover:bg-white/[0.06] hover:text-zinc-100 ${historyOpen ? 'bg-white/[0.06] text-zinc-100' : 'text-zinc-500'}`}>
                        <History className="h-4 w-4" />
                    </button>
                    <div className="relative">
                        <button type="button" onClick={() => setShowNewMenu(v => !v)} aria-label="Customization" aria-expanded={showNewMenu} title="Customization"
                            className={`rounded-control p-1.5 transition-colors hover:bg-white/[0.06] hover:text-zinc-100 ${showNewMenu ? 'bg-white/[0.06] text-zinc-100' : 'text-zinc-500'}`}>
                            <MoreHorizontal className="h-4 w-4" />
                        </button>
                        {showNewMenu && (
                            <>
                                <div className="fixed inset-0 z-20" aria-hidden onClick={() => setShowNewMenu(false)} />
                                <div className="absolute right-0 top-9 z-30 max-h-96 w-56 overflow-y-auto rounded-xl border border-white/10 bg-zinc-900 p-1 shadow-xl" data-testid="chat-new-menu">
                                    {isPanel && (
                                        <button type="button" onClick={() => { setShowNewMenu(false); setPanelPickerFor(activeId); }}
                                            className="block w-full rounded-lg px-2 py-1.5 text-left text-[11px] text-zinc-300 hover:bg-white/[0.06]">
                                            Panel models <span className="text-zinc-600">· {activeSession.panelModels?.length ?? 0}/{PANEL_MAX_MODELS}</span>
                                        </button>
                                    )}
                                    <button type="button" onClick={() => { setShowNewMenu(false); onToggleExpanded?.(); }}
                                        className="block w-full rounded-lg px-2 py-1.5 text-left text-[11px] text-zinc-300 hover:bg-white/[0.06]">
                                        {expanded ? 'Shrink back' : 'Expand over chart'}
                                    </button>
                                    <div className="my-1 border-t border-white/[0.06]" />
                                    <p className="px-2 py-0.5 text-[9px] uppercase tracking-widest text-zinc-600">Start</p>
                                    <button type="button" onClick={() => addSession('panel')} className="block w-full rounded-lg px-2 py-1.5 text-left text-[11px] text-zinc-300 hover:bg-white/[0.06]">
                                        New panel <span className="text-zinc-600">· up to {PANEL_MAX_MODELS} models</span>
                                    </button>
                                    <button type="button" onClick={() => { setShowNewMenu(false); setShowNewBot(true); }}
                                        data-testid="new-agent-option"
                                        className="block w-full rounded-lg px-2 py-1.5 text-left text-[11px] text-zinc-300 hover:bg-white/[0.06]">
                                        New agent <span className="text-zinc-600">· create a roster bot</span>
                                    </button>
                                    {renderCoachSurface && (
                                        <button type="button" onClick={() => { setShowNewMenu(false); const existing = sessions.find(s => s.kind === 'coach'); if (existing) { chatStore.setActiveId(existing.id); return; } chatStore.addSession({ kind: 'coach', title: 'Coach inbox' }); }}
                                            className="block w-full rounded-lg px-2 py-1.5 text-left text-[11px] text-zinc-300 hover:bg-white/[0.06]">
                                            Coach inbox <span className="text-zinc-600">· approvals</span>
                                        </button>
                                    )}
                                    {renderGroupSurface && groups.length > 0 && groups.slice(0, 6).map(g => (
                                        <button key={g.id} type="button"
                                            onClick={() => { setShowNewMenu(false); const existing = sessions.find(s => s.groupId === g.id); if (existing) { chatStore.setActiveId(existing.id); return; } chatStore.addSession({ kind: 'group', title: g.name, groupId: g.id }); }}
                                            className="block w-full truncate rounded-lg px-2 py-1 text-left text-[11px] text-zinc-400 hover:bg-white/[0.06]">
                                            {g.name} <span className="text-zinc-600">· room</span>
                                        </button>
                                    ))}
                                    {bots.length > 0 && bots.slice(0, 6).map(b => (
                                        <button key={b.id} type="button" onClick={() => addSession('solo', b.id)}
                                            className="block w-full truncate rounded-lg px-2 py-1 text-left text-[11px] text-zinc-400 hover:bg-white/[0.06]">
                                            {b.name} <span className="text-zinc-600">· as bot</span>
                                        </button>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>
                    <button type="button" onClick={onToggleCollapsed} aria-label="Collapse Chart AI" title="Collapse"
                        className="rounded-control p-1.5 text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-100">
                        <X className="h-4 w-4" />
                    </button>
                </div>
            </div>

            {/* Past Conversations palette — the reference's history command:
                search box, "Recent" rows with relative times, keyboard nav. */}
            {supervisorOpen && <SupervisorPanel onClose={() => setSupervisorOpen(false)} />}
            {historyOpen && (
                <div className="absolute inset-0 z-40 flex items-start justify-center bg-black/50 px-6 pt-20" data-testid="chat-history-backdrop" onClick={() => setHistoryOpen(false)}>
                    <div className="w-full max-w-sm overflow-hidden rounded-2xl border border-white/10 bg-zinc-900 shadow-2xl" data-testid="chat-history" onClick={e => e.stopPropagation()}>
                        <input
                            autoFocus
                            value={historyQuery}
                            onChange={e => { setHistoryQuery(e.target.value); setHistorySel(0); }}
                            onKeyDown={e => {
                                if (e.key === 'Escape') setHistoryOpen(false);
                                else if (e.key === 'ArrowDown') { e.preventDefault(); setHistorySel(i => Math.min(i + 1, historyRows.length - 1)); }
                                else if (e.key === 'ArrowUp') { e.preventDefault(); setHistorySel(i => Math.max(i - 1, 0)); }
                                else if (e.key === 'Enter') { const s = historyRows[historySel]; if (s) { chatStore.setActiveId(s.id); setHistoryOpen(false); } }
                            }}
                            placeholder="Search all conversations…"
                            aria-label="Search all conversations"
                            className="w-full border-b border-white/[0.06] bg-transparent px-4 py-3 text-[12px] text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
                        />
                        <div className="max-h-72 overflow-y-auto custom-scrollbar px-1 pb-1">
                            <p className="px-3 py-1 text-[10px] uppercase tracking-widest text-zinc-600">Recent</p>
                            {historyRows.length === 0 && <p className="px-3 py-2 text-[11px] text-zinc-600">No conversations match.</p>}
                            {historyRows.map((s, i) => (
                                <div key={s.id} className={`group flex items-center gap-2 rounded-lg px-3 py-2 ${i === historySel ? 'bg-white/[0.06]' : 'hover:bg-white/[0.04]'}`}>
                                    <button type="button"
                                        onClick={() => { chatStore.setActiveId(s.id); setHistoryOpen(false); }}
                                        onMouseEnter={() => setHistorySel(i)}
                                        className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left">
                                        <span className={`truncate text-[12px] ${s.id === activeId ? 'font-semibold text-zinc-100' : 'text-zinc-300'}`}>{s.kind === 'panel' ? '◆ ' : ''}{s.title}</span>
                                        <span className="shrink-0 text-[10px] text-zinc-600">{relTime(s.updatedAt)}</span>
                                    </button>
                                    {sessions.length > 1 && (
                                        <button type="button" onClick={() => removeSession(s.id)} aria-label={`Delete session ${s.title}`}
                                            className="shrink-0 text-zinc-600 opacity-0 transition-opacity group-hover:opacity-100 hover:text-rose-400">
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                    )}
                                </div>
                            ))}
                            {historyHidden > 0 && (
                                <button type="button" onClick={() => setHistoryShowAll(true)}
                                    className="w-full px-3 py-2 text-left text-[11px] text-zinc-500 transition-colors hover:text-zinc-200">
                                    Show {historyHidden} more…
                                </button>
                            )}
                        </div>
                        <div className="flex items-center justify-between border-t border-white/[0.06] px-4 py-2 text-[10px] text-zinc-600">
                            <span>↑↓ to navigate</span>
                            <span>↵ to select</span>
                        </div>
                    </div>
                </div>
            )}

            {/* Panel seat editor (while a panel is still short of 2 seats). */}
            {panelPickerFor && (
                <div className="shrink-0 space-y-1.5 border-b border-white/[0.06] bg-zinc-900/70 px-3 py-2" data-testid="panel-picker">
                    <p className="text-[10px] uppercase tracking-widest text-zinc-500">Panel seats ({sessions.find(s => s.id === panelPickerFor)?.panelModels?.length ?? 0}/{PANEL_MAX_MODELS}) — pick up to {PANEL_MAX_MODELS} models; they answer together and talk to each other</p>
                    <div className="flex flex-wrap items-center gap-1.5">
                        {(sessions.find(s => s.id === panelPickerFor)?.panelModels ?? []).map((m: { providerId: string; modelId: string }) => (
                            <span key={m.modelId} className="flex items-center gap-1 rounded-full border border-white/10 bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-200">
                                {formatModelDisplayName(m.modelId)}
                                <button type="button" aria-label={`Remove ${m.modelId}`}
                                    onClick={() => setPanelModels(panelPickerFor, (sessions.find(s => s.id === panelPickerFor)?.panelModels ?? []).filter((x: { providerId: string; modelId: string }) => x.modelId !== m.modelId))}
                                    className="text-zinc-500 hover:text-rose-400"><X className="h-2.5 w-2.5" /></button>
                            </span>
                        ))}
                        {(sessions.find(s => s.id === panelPickerFor)?.panelModels?.length ?? 0) < PANEL_MAX_MODELS && (
                            <ModelPicker providers={providers} value="" mode="provider-model" onChange={addPanelSeat} compact
                                disabledValues={new Set((sessions.find(s => s.id === panelPickerFor)?.panelModels ?? []).map((m: { providerId: string; modelId: string }) => `${m.providerId}::${m.modelId}`))}
                                placeholder="+ add model" />
                        )}
                        <button type="button" onClick={() => setPanelPickerFor(null)}
                            className="rounded-full bg-zinc-700 px-2.5 py-1 text-[10px] font-semibold text-zinc-100 hover:bg-zinc-600">
                            Done
                        </button>
                    </div>
                </div>
            )}

            {/* Coach inbox / group room: the roster surfaces the dock embeds
                (App owns the wiring) instead of the chat transcript. */}
            {(activeSession.kind === 'coach' || activeSession.kind === 'group') && (
                <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar" data-testid={`chat-${activeSession.kind}-surface`}>
                    {activeSession.kind === 'coach'
                        ? renderCoachSurface?.()
                        : renderGroupSurface?.(activeSession.groupId ?? '')}
                </div>
            )}
            {activeSession.kind !== 'coach' && activeSession.kind !== 'group' && (
            <>
            <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto custom-scrollbar px-4 py-4">
                {entries.length === 0 && !panelPickerFor && (
                    <div className="flex h-full flex-col items-center justify-center gap-3 px-2 text-center">
                        <p className="text-[11px] leading-5 text-zinc-500">
                            The model sees this chart live — a fresh code-calculated packet rides every message, it can pull the book, the full hybrid data or the exact screen state (including your drawings), take chart screenshots you attach, and grow itself: memory notes, skill proposals and new tools from this chat.
                        </p>
                        <div className="flex flex-wrap justify-center gap-1.5">
                            {QUICK_PROMPTS.map(q => (
                                <button key={q} type="button" disabled={!ready} onClick={() => void send(q)}
                                    className="rounded-full border border-white/[0.07] bg-zinc-800 px-2.5 py-1 text-[11px] text-zinc-300 transition-colors hover:border-white/15 hover:text-zinc-100 disabled:opacity-40">
                                    {q}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
                {entries.map(e => (
                    <div key={e.id} className="chat-fade-in" data-testid={`chat-entry-${e.role}`}>
                        {e.role === 'user' ? (
                            <div className="flex flex-col items-end gap-1">
                                {e.image && (
                                    <img src={e.image} alt="attached" className="max-h-40 rounded-lg border border-white/10 object-contain" />
                                )}
                                {e.text && e.text !== '(chart screenshot)' && (
                                    <div className="group/msg flex max-w-[85%] items-start gap-1">
                                        <CopyChip text={e.text} className="mt-2" />
                                        <p className="min-w-0 rounded-bubble bg-zinc-800 px-3 py-2 text-[12px] leading-5 text-zinc-100">{e.text}</p>
                                    </div>
                                )}
                            </div>
                        ) : e.notice ? (
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500" data-testid="chat-notice">
                                {e.tools[0] ?? 'Harness event'}
                            </p>
                        ) : (
                            <div className="group/msg space-y-1">
                                {e.speaker && (
                                    <p className="font-mono text-[9px] uppercase tracking-widest text-zinc-500">{formatModelDisplayName(e.speaker.split(':')[1] ?? e.speaker)}</p>
                                )}
                                {e.reasoning ? (
                                    // The thinking timer runs only during the REASONING phase —
                                    // once the answer text starts, thinking is over even though
                                    // the entry is still streaming (the timer-counting-forever bug).
                                    <ReasoningRow thinking={e.reasoning} running={!!e.streaming && !e.text} />
                                ) : e.streaming && !e.text ? (
                                    <p className="flex items-center text-[11px] text-zinc-500" data-testid="thinking-placeholder">
                                        Tip: {tipForSeed(e.id)}
                                        <span className="reasoning-row-dots" aria-hidden="true"><span /><span /><span /></span>
                                    </p>
                                ) : null}
                                <ToolActivityRow lines={e.tools} running={!!e.streaming && !e.text} />
                                {e.actions && e.actions.length > 0 && <ToolActionsRow actions={e.actions} />}
                                <div className="text-[12px] leading-5 text-zinc-200">
                                    {e.text
                                        ? <FadingText text={e.text} streaming={!!e.streaming} />
                                        : null}
                                </div>
                                {e.text && !e.streaming && (
                                    <div className="flex items-center gap-2">
                                        <CopyChip text={e.text} />
                                    </div>
                                )}
                                {e.proposal && !proposalState[e.id] && (
                                    <div className="mt-1 rounded-xl border border-white/10 bg-zinc-800/70 p-2.5" data-testid="trade-proposal-card">
                                        <div className="flex items-center gap-2">
                                            <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${e.proposal.direction === 'Long' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'}`}>{e.proposal.direction}</span>
                                            <span className="font-mono text-[12px] font-bold text-zinc-100">{e.proposal.symbol}</span>
                                            <span className="ml-auto text-[10px] uppercase tracking-wider text-zinc-500">{e.proposal.confidence} confidence</span>
                                        </div>
                                        <div className="mt-1.5 grid grid-cols-3 gap-1 font-mono text-[11px] tabular-nums">
                                            <span className="text-zinc-400">Entry <span className="text-zinc-100">{e.proposal.entry}</span></span>
                                            <span className="text-zinc-400">SL <span className="text-rose-400">{e.proposal.stopLoss}</span></span>
                                            <span className="text-zinc-400">TP <span className="text-emerald-400">{e.proposal.takeProfits.join(' / ')}</span></span>
                                        </div>
                                        {e.proposal.rationale && <p className="mt-1.5 text-[11px] leading-4 text-zinc-400">{e.proposal.rationale}</p>}
                                        <div className="mt-2 flex items-center gap-1.5">
                                            {onLogProposedTrade && (
                                                <button type="button"
                                                    onClick={() => { onLogProposedTrade(e.proposal!); setProposalState(prev => ({ ...prev, [e.id]: 'logged' })); }}
                                                    className="rounded-control bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-emerald-500">
                                                    Log this trade
                                                </button>
                                            )}
                                            <button type="button"
                                                onClick={() => setProposalState(prev => ({ ...prev, [e.id]: 'dismissed' }))}
                                                className="rounded-control border border-white/10 px-2.5 py-1 text-[11px] text-zinc-400 transition-colors hover:bg-white/[0.06] hover:text-zinc-200">
                                                Cancel
                                            </button>
                                        </div>
                                    </div>
                                )}
                                {e.proposal && proposalState[e.id] === 'logged' && (
                                    <p className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-400">✓ Logged as an open trade — the harness will score it against the outcome.</p>
                                )}
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {/* Composer — the reference's layout: a workspace-style section
                header (symbol · panel seats · bot · packet age), then one
                rounded card holding the input and its toolbar, then a plain
                sentence-case disclaimer. Generous padding, no hard divider. */}
            <div className="shrink-0 px-3 pb-3 pt-1">
                {modelIssue && provider && (
                    <div className="mb-1.5 flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px] leading-4 text-amber-300" data-testid="model-fallback-warning">
                        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span className="min-w-0 flex-1">
                            {modelIssue} Answering with <strong className="font-semibold">{provider.name} · {formatModelDisplayName(provider.selectedModel)}</strong> — re-pick a model in the dropdown.
                        </span>
                    </div>
                )}
                <div className="flex shrink-0 items-center gap-2 px-1 pb-2 pt-1">
                    <span className="truncate text-[12px] font-semibold text-zinc-200">{symbol.replace(/USDT$/, '/USDT')}</span>
                    {isPanel && (
                        <button type="button" onClick={() => setPanelPickerFor(panelPickerFor === activeId ? null : activeId)}
                            aria-expanded={panelPickerFor === activeId} title="Add / remove panel models (up to 5)"
                            className="rounded-full border border-white/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-zinc-400 transition-colors hover:border-white/25 hover:text-zinc-100">
                            panel · {activeSession.panelModels?.length ?? 0}/{PANEL_MAX_MODELS}
                        </button>
                    )}
                    {boundBot && (
                        <span className="truncate rounded-full border border-white/10 px-1.5 py-0.5 text-[9px] font-semibold text-zinc-400">{boundBot.name}</span>
                    )}
                    <span className="ml-auto shrink-0 font-mono text-[10px] text-zinc-600" title={contextAt ? `Live packet fetched ${new Date(contextAt).toISOString()}` : 'No packet yet'}>
                        {contextAt ? `ctx ${phtClock(contextAt)} PHT` : `${symbol} · ${interval}`}
                    </span>
                </div>
                {attachments.length > 0 && (
                    <div className="mb-1.5 flex flex-wrap gap-1.5">
                        {attachments.map(a => (
                            <span key={a.id} className="flex items-center gap-1 rounded-lg border border-white/10 bg-zinc-800 py-1 pl-1 pr-1.5 text-[10px] text-zinc-300">
                                {a.kind === 'image'
                                    ? <img src={a.payload} alt={a.name} className="h-8 w-12 rounded object-cover" />
                                    : <FileText className="h-3 w-3 text-zinc-500" />}
                                <span className="max-w-[120px] truncate">{a.name}</span>
                                <button type="button" aria-label={`Remove ${a.name}`} onClick={() => setAttachments(prev => prev.filter(x => x.id !== a.id))}
                                    className="text-zinc-500 hover:text-rose-400"><X className="h-3 w-3" /></button>
                            </span>
                        ))}
                    </div>
                )}
                <div className="rounded-2xl border border-white/10 bg-zinc-800/70 px-3 py-2.5 shadow-lg">
                    <textarea
                        rows={1}
                        value={draft}
                        disabled={!ready}
                        onChange={ev => setDraft(ev.target.value)}
                        onKeyDown={ev => {
                            if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); void send(draft); }
                        }}
                        placeholder={ready ? 'Ask anything…' : isPanel ? 'Add at least 2 panel models above' : 'Configure a provider in Settings first'}
                        className="max-h-28 min-h-[24px] w-full resize-none bg-transparent text-[13px] leading-5 text-zinc-100 placeholder:text-zinc-600 focus:outline-none disabled:opacity-50"
                    />
                    <div className="mt-2 flex items-center gap-1.5">
                        <input type="file" multiple accept="image/*,.md,.txt,.csv,.json" ref={fileInputRef} className="hidden"
                            onChange={ev => { attachFiles(ev.target.files); ev.target.value = ''; }} />
                        {/* Reference layout: ONE + button opens everything that
                            can ride the message — uploads AND the chart shot. */}
                        <div className="relative">
                            <button type="button" onClick={() => setShowAttachMenu(v => !v)} disabled={!ready}
                                title="Attach to this message" aria-label="Attach to this message" aria-expanded={showAttachMenu}
                                className="rounded-full p-1.5 text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-200 disabled:opacity-40">
                                <Plus className="h-4 w-4" />
                            </button>
                            {showAttachMenu && (
                                <>
                                    <div className="fixed inset-0 z-20" aria-hidden onClick={() => setShowAttachMenu(false)} />
                                    <div className="absolute bottom-9 left-0 z-30 w-48 rounded-xl border border-white/10 bg-zinc-900 p-1 shadow-xl" data-testid="attach-menu">
                                        <button type="button" onClick={() => { setShowAttachMenu(false); fileInputRef.current?.click(); }}
                                            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] text-zinc-300 hover:bg-white/[0.06]">
                                            <FileText className="h-3.5 w-3.5 text-zinc-500" /> Upload files &amp; images
                                        </button>
                                        <button type="button" onClick={() => { setShowAttachMenu(false); captureChart(); }}
                                            disabled={!onCaptureChart} title={onCaptureChart ? undefined : 'Chart not ready'}
                                            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] text-zinc-300 transition-colors hover:bg-white/[0.06] disabled:opacity-40">
                                            <Camera className="h-3.5 w-3.5 text-zinc-500" /> Screenshot chart
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                        {onRunAnalysis && draft.trim() && !isPanel && (
                            <button type="button" onClick={() => void runFullAnalysis()} disabled={busy}
                                title="Run the full ensemble analysis (hybrid data + debate + verdict) on this request"
                                className="rounded-full border border-white/[0.07] px-2 py-1 text-[10px] font-semibold text-zinc-400 transition-colors hover:border-white/20 hover:text-zinc-100 disabled:opacity-40">
                            Full analysis
                            </button>
                        )}
                        <div className="relative ml-auto flex items-center gap-1">
                            {!isPanel && (
                                <ModelPicker providers={providers} value={selectedChatModel} onChange={changeSoloModel} mode="provider-model" compact />
                            )}
                            <button type="button" onClick={() => setShowEffortMenu(v => !v)} aria-label="Thinking effort"
                                className="flex items-center gap-1 rounded-full border border-white/[0.07] px-2 py-1 text-[10px] font-semibold text-zinc-400 transition-colors hover:border-white/20 hover:text-zinc-100">
                                <Brain className="h-3.5 w-3.5" />
                                {effort === 'auto' ? 'Auto' : effort === 'off' ? 'Off' : effort[0].toUpperCase() + effort.slice(1)}
                                <ChevronDown className="h-2.5 w-2.5" />
                            </button>
                            {showEffortMenu && (
                                <div className="absolute bottom-8 right-0 z-30 w-28 rounded-xl border border-white/10 bg-zinc-900 p-1 shadow-xl" data-testid="effort-menu">
                                    {EFFORT_CHOICES.map(c => (
                                        <button key={c.id} type="button"
                                            onClick={() => { changeEffort(c.id); setShowEffortMenu(false); }}
                                            className={`block w-full rounded-lg px-2 py-1 text-left text-[11px] transition-colors hover:bg-white/[0.06] ${effort === c.id ? 'text-zinc-100' : 'text-zinc-500'}`}>
                                            {c.label}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                        <button
                            type="button"
                            onClick={() => (busy ? chatStore.abortActive() : void send(draft))}
                            disabled={!ready && !busy}
                            aria-label={busy ? 'Stop' : 'Send'}
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-zinc-900 transition-colors hover:bg-white disabled:opacity-40"
                        >
                            {busy ? <StopIcon className="h-3 w-3" fill="currentColor" /> : <SendIcon className="h-4 w-4" />}
                        </button>
                    </div>
                </div>
                <p className="mt-2 px-2 text-[10px] text-zinc-600">
                    August may make mistakes · analysis, not financial advice
                </p>
            </div>
            </>
            )}
            {/* New agent: the roster's create dialog, launched from this dock.
                Creating saves the bot and opens its bound session immediately. */}
            {showNewBot && (
                <NewBotDialog
                    open
                    onClose={() => setShowNewBot(false)}
                    providers={providers}
                    onCreate={draft => {
                        const bot: AgentBot = { ...draft, id: `bot-${Date.now()}`, createdAt: new Date().toISOString() };
                        saveBot(bot);
                        setShowNewBot(false);
                        chatStore.addSession({ botId: bot.id });
                    }}
                />
            )}
        </div>
    );
};

/** Hover-copy chip for a message bubble (user + model). Reports "Copied"
 *  inline for ~1.4s; hidden until the bubble is hovered (or keyboard-focused)
 *  so the transcript stays clean. */
const CopyChip: React.FC<{ text: string; className?: string }> = ({ text, className = '' }) => {
    const [copied, setCopied] = useState(false);
    return (
        <button type="button"
            onClick={() => { void copyText(text).then(ok => { if (ok) { setCopied(true); window.setTimeout(() => setCopied(false), 1400); } }); }}
            aria-label="Copy message" title={copied ? 'Copied' : 'Copy this message'}
            className={`flex items-center gap-1 rounded-control px-1.5 py-0.5 text-[10px] text-zinc-500 opacity-0 transition-opacity hover:bg-white/[0.06] hover:text-zinc-200 focus:opacity-100 group-hover/msg:opacity-100 ${className}`.trim()}>
            {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
    );
};

/** Streams in with a smooth reveal + fade as text lands (the reference's
 *  rendering feel): freshly-appended text fades in, settled text is static. */
const FadingText: React.FC<{ text: string; streaming: boolean }> = ({ text, streaming }) => {
    const shown = useSmoothStreamText(text, streaming);
    return (
        <div className={streaming ? 'stream-fade' : undefined}>
            <MarkdownContent content={shown} className="!text-[12px] [&_p]:my-1 [&_li]:text-[12px]" />
        </div>
    );
};

export default React.memo(TradeChatPanel);
