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
 * human's approval in Settings / the Learn surface's Coach tab; visible status rows show
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
import { Activity, Brain, Camera, Check, ChevronDown, Compass, Copy, Crosshair, Eye, FileText, History, LayoutGrid, MoreHorizontal, PanelRightOpen, Pin, Plus, RotateCcw, Sparkles, TriangleAlert, X, Zap } from 'lucide-react';
import { ProviderConfig } from '../../types/provider';
import type { LoggedTrade } from '../../types';
import type { Message } from '../../types/message';
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
import { parseKeyLevels, type MessageLevelLines } from '../../services/trade/keyLevels';
import * as levelWatch from '../../services/trade/levelWatchService';
import { describePlanForModel, staleLevelsAtArm, type WatchPlan } from '../../services/trade/tradePlanLevels';
import * as watchService from '../../services/trade/watchService';
import { parsePriceWatch, parseTimeWake, describeWatchesForModel } from '../../services/trade/chartTriggers';
import { phtClock } from '../../utils/timezone';
import { ensureNotifyPermission } from '../../services/infrastructure/notify';
import { recordSessionForReview, runSessionSkillReview, runThesisResolver, type ReviewableSession } from '../../services/learning/sessionSkillReview';
import { runTraderLearner } from '../../services/learning/traderLearner';
import {
    ensureSupervisorListeners, nudgeSupervisor, setSessionModel,
} from '../../services/learning/skillSupervisor';
import SupervisorPanel from './SupervisorPanel';
import SupervisorIndicator from './panels/SupervisorIndicator';
import ChatAttachmentStrip from './panels/ChatAttachmentStrip';
import { useChatAttachments, type Attachment } from '../../hooks/useChatAttachments';
import ChatHistoryPalette, { relTime } from './panels/ChatHistoryPalette';
import ChatWorkTimeline from './panels/ChatWorkTimeline';
import ComposerWorkspaceRow from './panels/ComposerWorkspaceRow';
import TradeProposalCard, { TradeProposalLoggedRow } from './panels/TradeProposalCard';
import VerdictAudit from '../analysis/VerdictAudit';
import MemoryProvenanceStrip from '../chat/MemoryProvenanceStrip';
import { consumePendingSkillTry } from '../chat/skillDeepLink';
import KeyLevelsCard from './KeyLevelsCard';
import { getActiveUsername } from '../../utils/activeUser';
import { baseOf, quoteOf } from '../../utils/symbol';
import { listSkills } from '../../services/learning/SkillMemoryService';
import { buildProfileMemoryIndex } from '../../services/learning/profileMemory';
import { isPassReply } from '../../services/agents/groupRounds';
import { saveBot } from '../../services/agents/agentRoster';
import {
    titleFromMessage, PANEL_MAX_MODELS, type PanelSeatRef,
} from '../../services/trade/chatSessions';
import * as chatStore from '../../services/trade/chatStore';
import type { LiveEntry, LiveSession } from '../../services/trade/chatStore';
import {
    panelSeats, planPanelTurn, formatRoomTranscript, parsePanelMentions, panelCouldStillBePass, panelSeatKey,
} from '../../services/trade/chatPanel';
import { createDebateMailbox, formatDmEventLine } from '../../services/analysis/DebateMailbox';
import type { ChartSnapshot } from './TradingChart';
import { intervalSeconds, type ChartInterval } from './TradingChart';
import BiasChips from './BiasChips';
import type { AgentBot } from '../../services/agents/agentRoster';
import { resolveAgentContext, SINGLE_AGENT_MEMORY_BUDGET, type ResolvedAgentContext } from '../../services/agents/agentContext';
import { getFirstReadyProvider, isProviderReady, formatModelDisplayName, formatSeatLabel, resolveChatModelSelection, findChatModelOwner, chatModelIdOf } from '../../utils/providerUtils';
import { isVisionModel } from '../../utils/modelUtils';
import { splitThinkingFromOutput } from '../../utils/thinkingSplit';
import { copyText } from '../../utils/clipboard';
import { TASK_BUDGETS } from '../../services/providers/taskBudgets';
import { effortForTask, ReasoningEffort } from '../../services/providers/reasoningControls';
import ModelPicker from '../shared/ModelPicker';
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
    /** Desk-tool drawing surface (draw_on_chart / mark_trade_levels).
     *  `turn` names the RUNNING turn's session/entry/symbol/interval —
     *  persistence must key off IT, never off whichever session the user
     *  happens to be watching when the tool lands (per-turn identity). */
    addModelDrawings?: (drawings: ChartDrawing[], turn?: PanelTurnContext) => void;
    /** Clear only the model's own shapes (clear_chart_drawings scope=model). */
    clearModelDrawings?: (turn?: PanelTurnContext) => void;
    /** Clear model + user shapes (scope=all — only on the user's request). */
    clearAllDrawings?: (turn?: PanelTurnContext) => void;
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
    /** Same, for group rooms. The Coach inbox is not here — it moved to the
     *  Learn surface when the tabs went into the hamburger menu. */
    groupSessionRequest?: { groupId: string; nonce: number };
    /** Launches the FULL ensemble pipeline from this chat (hybrid data in,
     *  debate verdict back as an AI entry). Absent ⇒ the option is hidden.
     *  May resolve with just the verdict text, or with `{ text, messageId }`
     *  — the App-side analysis message id lets the dock stamp the answer
     *  entry with `data-message-id`, so the saved-analyses gallery's Locate
     *  can scroll straight to it. */
    onRunAnalysis?: (prompt: string, images: Array<{ name: string; dataURL: string }>) =>
        Promise<string | { text: string; messageId?: string }>;
    /** Resolve the message id `onRunAnalysis` handed back into the App-side
     *  message, so a settled answer can show what its verdict was built on —
     *  the why-avoid breakdown, the evidence the moderator actually saw, the
     *  stage ladder. Resolved lazily rather than copied into the entry, because
     *  a stored session would otherwise carry a whole `TradeAnalysis` per
     *  answer. Absent ⇒ the audit block does not render. */
    getAnalysisMessage?: (messageId: string) => Message | undefined;
    /** "Log this trade" on a model proposal → App records it as an OPEN
     *  (PENDING) trade the outcome autopilot later scores. Absent ⇒ the Log
     *  button is hidden (no journal attached). */
    onLogProposedTrade?: (proposal: TradeProposal) => void;
    /** Report a presented plan to the harness level-watch (TradeView arms
     *  it; a later price touch comes back as a [HARNESS SIGNAL] turn).
     *  `turn` carries the RUNNING turn's identity (see PanelTurnContext). */
    onPlanPresented?: (plan: WatchPlan, turn?: PanelTurnContext) => void;
    /** A message's Key Levels card pushes its resolved lines here so the
     *  canvas can draw them (toggle / pin / hover states already decided);
     *  null clears. Owned by TradeView — the chart stays the single renderer. */
    onChatLevelsChange?: (payload: MessageLevelLines | null) => void;
    /** Group rooms carried into the dock: the room renders INSIDE the session
     *  tabs (App owns the wiring — the dock only shows the slot). Absent ⇒
     *  those session options are hidden. The Coach inbox is not one of them:
     *  it lives on the Learn surface now. */
    renderGroupSurface?: (groupId: string) => React.ReactNode;
    /** Group rooms available to open as a session (title for the tab). */
    groups?: Array<{ id: string; name: string }>;
    /** Imperative scroll-to-entry bridge for App-level affordances ("Jump to
     *  latest analysis", the saved-analyses gallery's Locate). This dock is
     *  the app's only real transcript scroller, so it hands App a function
     *  that scrolls the entry whose `data-message-id` matches the given id
     *  into view; the cleanup passes null so App never calls into an
     *  unmounted dock. (Replaces the old virtuosoRef, which pointed at a
     *  list this panel never rendered as a Virtuoso.) */
    registerScrollToMessage?: (fn: ((messageId: string) => void) | null) => void;
    /** Dock geometry controls, hoisted to the trade layout (drag handle). */
    collapsed?: boolean;
    onToggleCollapsed?: () => void;
    expanded?: boolean;
    onToggleExpanded?: () => void;
    /** Toggles the 2D debate desk floor projection modal. */
    onToggleDeskScene?: () => void;
    isDeskSceneOpen?: boolean;
    hasDeskSceneMessage?: boolean;
    /** Triggers a fresh discovery of models from configured providers. */
    onRefreshModels?: () => Promise<void>;
    /** Pin / unpin the signal behind an entry. Only entries that carry an
     *  App-side analysis message id can be pinned — a plain chat answer has no
     *  setup to track, and the Pinned list reads the flag off the message. */
    onToggleWatch?: (messageId: string) => void;
    /** Message ids currently pinned, so the chip shows the real state. */
    pinnedMessageIds?: ReadonlySet<string>;
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
];

/** Empty-state starters. The glyph is a category cue so the row scans by
 *  intent; the chip's text is what gets sent, byte-for-byte unchanged. */
const QUICK_PROMPTS: { text: string; Icon: React.FC<{ className?: string }> }[] = [
    { text: 'Read this chart', Icon: Eye },
    { text: 'Key levels?', Icon: Crosshair },
    { text: 'What is the bias?', Icon: Compass },
    { text: 'Order-flow pressure?', Icon: Activity },
    { text: 'Scan chart → skills', Icon: Sparkles },
];

/** Identity of a RUNNING model turn, captured the moment it starts. Every
 *  side-effect of a panel tool (proposal card attach, drawing persistence,
 *  level-watch arming) must resolve WHO IT BELONGS TO from this object —
 *  never from the panel's render-snapshot view state (`activeId`, or a
 *  shared "current entry" ref). A harness turn or a background session's
 *  turn keeps running while the user switches sessions/symbols; keying its
 *  output off the VIEWED session made proposals and drawings land in the
 *  wrong transcript (deep-dive 2026-09-15, per-turn identity class).
 *  Exported so the canvas owner (TradeView) can persist against it too. */
export interface PanelTurnContext {
    /** The session the turn runs in. */
    sid: string;
    /** The streaming AI entry the turn writes into. */
    entryId: string;
    /** The chart the turn started under. */
    symbol: string;
    interval: string;
}

/** Per-entry disposition of a model proposal card ('logged' / 'dismissed').
 *  Lives at MODULE scope keyed by entry id, NOT in component state: the
 *  dock unmounts whenever the user leaves the trade surface, and a remount
 *  reset the flag — a second click on "Log this trade" then logged the
 *  SAME plan a second time. Bounded: proposal cards are rare; drop the
 *  oldest insertions when the cap is reached. */
const PROPOSAL_STATE_MAX = 500;
const proposalDisposition = new Map<string, 'logged' | 'dismissed'>();
const setProposalDisposition = (entryId: string, state: 'logged' | 'dismissed'): void => {
    if (proposalDisposition.size >= PROPOSAL_STATE_MAX) {
        const oldest = proposalDisposition.keys().next();
        if (!oldest.done) proposalDisposition.delete(oldest.value);
    }
    proposalDisposition.set(entryId, state);
};
/** Test hook: forget every recorded proposal disposition. */
export const __clearProposalStateForTests = (): void => { proposalDisposition.clear(); };

/** Composer chip + the empty-state "Scan chart → skills" prompt: the model
 *  reads the WHOLE tape via the scan_chart_skills desk tool and drafts skills
 *  that wait for approval in the Inbox. */
const SCAN_SKILLS_PROMPT = 'Scan the full candle history of this chart with scan_chart_skills: study how the price actually moved (regimes, swings, gaps) and which entries have historically worked, then draft your best IF/THEN skill candidates from what the tape proves. Tell me what you found and what is waiting in the Inbox.';

/** Thinking-budget levels. The words are the whole readout: `auto` is not a
 *  budget but "pick per task", so it stays a peer of the tiers, not a bar
 *  count between Off and Low. */
const EFFORT_CHOICES: { id: ReasoningEffort | 'auto'; label: string }[] = [
    { id: 'off', label: 'Off' },
    { id: 'auto', label: 'Auto' },
    { id: 'low', label: 'Low' },
    { id: 'medium', label: 'Medium' },
    { id: 'high', label: 'High' },
    { id: 'max', label: 'Max' },
];

/** The trigger and the open menu show the same read for the same id — one
 *  lookup keeps them from drifting. */
const effortChoiceOf = (id: ReasoningEffort | 'auto'): typeof EFFORT_CHOICES[number] =>
    EFFORT_CHOICES.find(c => c.id === id) ?? EFFORT_CHOICES[1];

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

const TradeChatPanel: React.FC<TradeChatPanelProps> = ({
    symbol, interval, providers, selectedChatModel, onSelectChatModel, live = false,
    chartLevels, chartDrawings, modelDrawings, addModelDrawings, clearModelDrawings, clearAllDrawings,
    onCaptureChart, getChartSnapshot, bots = [], trades = [], botSessionRequest, groupSessionRequest, onRunAnalysis, getAnalysisMessage, onLogProposedTrade, onPlanPresented,
    onChatLevelsChange,
    renderGroupSurface, groups = [],
    registerScrollToMessage,
    collapsed, onToggleCollapsed, expanded, onToggleExpanded,
    onToggleDeskScene, isDeskSceneOpen, hasDeskSceneMessage,
    onToggleWatch, pinnedMessageIds,
    onRefreshModels,
}) => {
    // Session state lives in the module store (chatStore) so an in-flight
    // answer survives switching to another surface tab and back — the panel
    // unmounts, but the run keeps streaming into the store.
    const snap = useSyncExternalStore(chatStore.subscribe, chatStore.getSnapshot, chatStore.getSnapshot);
    const sessions = snap.sessions;
    const activeId = snap.activeId;
    const [draft, setDraft] = useState('');
    const [contextAt, setContextAt] = useState<number | null>(null);
    // The same reader the Agents composer uses (hooks/useChatAttachments was
    // lifted out of this file so the second surface could reuse it verbatim).
    const {
        attachments, fileInputRef, attachFiles, add: addAttachment,
        remove: removeAttachment, clear: clearAttachments, images: attachedImages,
    } = useChatAttachments();
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
    /** Re-render trigger for the module-scope proposal dispositions (see
     *  proposalDisposition): the disposition itself must SURVIVE a dock
     *  unmount, the state here only makes React repaint the card. */
    const [proposalTick, setProposalTick] = useState(0);
    /** entryId → App-side analysis message id for ensemble runs launched
     *  from this dock (see onRunAnalysis): the answer entry's
     *  `data-message-id` stamp, so the gallery's Locate can scroll to it.
     *  Component-scoped by design — after a dock remount the mapping is
     *  gone and Locate falls back to a no-op scroll (highlight still works). */
    const [analysisMessageIds, setAnalysisMessageIds] = useState<Record<string, string>>({});
    const [panelPickerFor, setPanelPickerFor] = useState<string | null>(null);
    const scrollRef = useRef<HTMLDivElement | null>(null);
    /** Which Key Levels card currently owns the shared chart-levels channel
     *  (message id of the card that last PUSHED). Its unmount may clear the
     *  layer; any other card's clear is dropped — see handleCardLevels. */
    const chatLevelsOwnerRef = useRef<string | null>(null);

    const activeSession = sessions.find(s => s.id === activeId) ?? sessions[0];
    const entries = activeSession.entries;
    const isPanel = activeSession.kind === 'panel';
    const boundBot = activeSession.botId ? bots.find(b => b.id === activeSession.botId) : undefined;
    const busy = !!snap.running[activeId];

    /** The freshest mark for the levels card's Dist column + "last" divider —
     *  read from the canvas snapshot (the markPrice@1s line), never a re-fetch. */
    const getMarkForDist = useCallback((): number | null => {
        const m = getChartSnapshot?.()?.markPrice ?? null;
        return typeof m === 'number' && Number.isFinite(m) && m > 0 ? m : null;
    }, [getChartSnapshot]);

    /** Ownership-arbitrated Key Levels → chart channel. Every Key Levels
     *  card reports (payload, ownerId) through this single dock-owned pipe:
     *  a PUSH always takes ownership (the most-recent card to draw owns the
     *  layer), and a CLEAR only forwards when it comes from the CURRENT
     *  owner — so card A unmounting can no longer null the live lines card
     *  B is still drawing (deep-dive 2026-09-15, KeyLevelsCard). */
    const handleCardLevels = useCallback((payload: MessageLevelLines | null, ownerId?: string): void => {
        if (payload) {
            chatLevelsOwnerRef.current = ownerId ?? null;
            onChatLevelsChange?.(payload);
        } else if (!ownerId || chatLevelsOwnerRef.current === ownerId) {
            chatLevelsOwnerRef.current = null;
            onChatLevelsChange?.(null);
        }
    }, [onChatLevelsChange]);

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
     *  update-don't-duplicate discipline of this environment's memory.
     *
     *  `bot` is resolved through `resolveAgentContext`, the same loader the
     *  desk answers with, so persona and notes cannot be assembled one way at
     *  the chart and another way at the desk — which is how one named agent
     *  ends up knowing less in one place than the other. `roleNote` is about
     *  the ROOM (you are one of N seats), so it stays the caller's. */
    const systemPromptFor = useCallback((bot?: AgentBot, roleNote?: string): string => {
        const skillsBlock = skillsIndexForPrompt();
        const memoryBlock = buildProfileMemoryIndex();
        let agent: ResolvedAgentContext | null = null;
        if (bot) {
            try {
                // One agent answering, so it gets the whole allowance — the
                // debate divides the same total across its roster.
                const knownCoins = [...new Set(
                    (trades ?? [])
                        .map(t => t?.analysis?.coinName)
                        .filter((a): a is string => typeof a === 'string' && a.length >= 2),
                )];
                agent = resolveAgentContext(bot, { coin: symbol, knownCoins }, SINGLE_AGENT_MEMORY_BUDGET);
            } catch {
                agent = null;
            }
        }
        const persona = [agent?.persona, roleNote].filter(Boolean).join('\n\n');
        // Same heading the desk uses (`buildBotSystemPrompt`) — one agent
        // should meet its own notes under one name wherever it is asked.
        const base = `${TRADE_CHAT_SYSTEM_PROMPT}${skillsBlock ? `\n\n${skillsBlock}` : ''}${memoryBlock ? `\n\n${memoryBlock}` : ''}${agent?.notes ? `\n\n## Your private notes\n${agent.notes}` : ''}`;
        return persona ? `${base}\n\n## Your role\n${persona}` : base;
    }, [symbol, trades]);

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
     *  lands where the user is looking.
     *  `turn` is the RUNNING turn's identity (captured by runSeatTurn when
     *  the stream starts) — every attach/persist keys off it, never off
     *  the view state, so a background or harness turn's output lands in
     *  ITS OWN session even after the user switched away. */
    const executePanelTool = useCallback(async (call: DeskToolCall, turn: PanelTurnContext): Promise<DeskToolResult | null> => {
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
        if (name === 'mark_trade_levels') {
            const { drawings, error } = drawingsFromLevelTool(args, { drawnPrice });
            if (error) return receipt(false, `mark_trade_levels rejected: ${error}`);
            addModelDrawings(drawings, turn);
            const listed = drawings.map(d => `${d.label} ${d.points[0].p}`).join(', ');
            return receipt(true, `Marked on the chart: ${listed}. The user sees these lines now.${canvasNote}`);
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
        return receipt(true, `Drew on the chart: ${described || d.kind}. The user sees it now.${canvasNote}`);
    }, [addModelDrawings, clearModelDrawings, clearAllDrawings, getChartSnapshot, onPlanPresented]);

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
    // Composer textarea, so a "Try in chat" skill chip can drop its /slug in
    // and hand focus back to the user (see the august:try-skill listener).
    const composerRef = useRef<HTMLTextAreaElement | null>(null);
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
    // Screener → learn-this-coin: the screener's per-row button dispatches
    // `august:prefill-chat` with the scan-chart-skills token after loading
    // the coin — prefill the composer with the scan prompt (send stays manual).
    useEffect(() => {
        const onPrefill = (ev: Event): void => {
            const token = (ev as CustomEvent<{ token?: string }>).detail?.token;
            if (token === 'scan-chart-skills') setDraft(SCAN_SKILLS_PROMPT);
        };
        window.addEventListener('august:prefill-chat', onPrefill);
        return () => window.removeEventListener('august:prefill-chat', onPrefill);
    }, []);
    // Strategy Studio / learning-queue "Try in chat" (and the skill-citation
    // chips): prepend the skill's /slash-invocation to the composer and focus
    // it, so the user lands on the chat with the skill ready to invoke. Send
    // stays manual. The listener lives here because the Chart AI dock owns the
    // composer now (the old ChatInput that handled this was deleted).
    const applySkillToken = useCallback((slug: string): void => {
        const token = `/${slug.replace(/\.md$/i, '')}`;
        setDraft(prev => {
            const base = prev.trimStart();
            if (base.startsWith(`${token} `) || base === token) return prev; // already invoked
            return base ? `${token} ${base}` : `${token} `;
        });
        const el = composerRef.current;
        if (el) { el.focus(); const end = el.value.length; try { el.setSelectionRange(end, end); } catch { /* detached */ } }
    }, []);
    useEffect(() => {
        // Surfaces render exclusively, so a tap on Studio's "Try in chat" lands
        // while this dock is unmounted and its broadcast reaches nobody. Take
        // what the hand-off parked — that is what makes the button real there.
        const parked = consumePendingSkillTry();
        if (parked) applySkillToken(parked);
        const onTrySkill = (ev: Event): void => {
            const slug = (ev as CustomEvent<{ slug?: string }>).detail?.slug;
            if (!slug) return;
            // Delivered live: drop the parked copy or the next mount re-applies
            // a token the user already saw.
            consumePendingSkillTry();
            applySkillToken(slug);
        };
        window.addEventListener('august:try-skill', onTrySkill);
        return () => window.removeEventListener('august:try-skill', onTrySkill);
    }, [applySkillToken]);
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

    // Follow the bottom while the answer streams — UNLESS the user scrolled
    // up to read. Wheel/touch position wins over the auto-follow: scrolling
    // up unpins (returning near the bottom, or sending a message, re-pins).
    const stickToBottomRef = useRef(true);
    const onChatScroll = useCallback((): void => {
        const el = scrollRef.current;
        if (!el) return;
        stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    }, []);
    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;
        const last = entries[entries.length - 1];
        if (!last || last.role === 'user') stickToBottomRef.current = true;
        if (stickToBottomRef.current) el.scrollTop = el.scrollHeight;
    }, [entries, activeId]);

    // ── Imperative scroll-to-entry bridge (see registerScrollToMessage) ────
    // The dock owns the only real transcript scroller, so App's affordances
    // ("Jump to latest analysis", the gallery's Locate) route the scroll
    // through this registered function instead of a never-attached handle.
    // Entries are stamped `data-entry-id` (the chatStore entry id — what
    // jump-to-latest resolves from the store) and `data-message-id` (the
    // App-side analysis message id when this entry carries one, else the
    // entry id — what the gallery's Locate passes). A miss is a deliberate
    // no-op: the group room renders no transcript, and an analysis
    // card that isn't in THIS dock's session must not yank the user
    // somewhere unrelated.
    useEffect(() => {
        if (!registerScrollToMessage) return;
        registerScrollToMessage((messageId: string): void => {
            const container = scrollRef.current;
            if (!container || !messageId) return;
            const nodes = container.querySelectorAll<HTMLElement>('[data-entry-id]');
            for (const node of Array.from(nodes)) {
                if (node.getAttribute('data-entry-id') === messageId
                    || node.getAttribute('data-message-id') === messageId) {
                    node.scrollIntoView({ block: 'center', behavior: 'smooth' });
                    return;
                }
            }
        });
        return () => { registerScrollToMessage(null); };
    }, [registerScrollToMessage]);

    // The composer's "ctx HH:MM PHT" badge reports when the LAST packet was
    // fetched — a fetch made for a DIFFERENT coin or a DIFFERENT session
    // says nothing about this one. Clear it on any switch so the badge falls
    // back to `SYMBOL · INTERVAL` until the first send under the new setup
    // stamps a real time (the stale previous-coin fetch time was the bug).
    useEffect(() => {
        setContextAt(null);
    }, [symbol, activeId]);

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

    // Group rooms opened from the roster rail.
    const lastGroupRequestRef = useRef(0);
    useEffect(() => {
        if (!groupSessionRequest || groupSessionRequest.nonce === lastGroupRequestRef.current) return;
        lastGroupRequestRef.current = groupSessionRequest.nonce;
        const name = groups.find(g => g.id === groupSessionRequest.groupId)?.name ?? 'Room';
        const existing = sessions.find(s => s.groupId === groupSessionRequest.groupId);
        if (existing) { chatStore.setActiveId(existing.id); return; }
        chatStore.addSession({ kind: 'group', title: name, groupId: groupSessionRequest.groupId });
    }, [groupSessionRequest, groups, sessions]);

    const mutate = (id: string, fn: (s: LiveSession) => LiveSession): void => {
        chatStore.mutate(id, fn);
    };

    /** End a run ONLY if the store still holds THIS run's controller.
     *  chatStore keys controllers by session; a second beginRun (a queued
     *  harness flush racing this run, or a double-submit that slipped
     *  through) REPLACES the entry — and a blind endRun(sid) would then
     *  delete the NEWER run's slot, leaving it un-stoppable while the
     *  finished one's `busy` ghost lingers. Identity check: whoever owns
     *  the slot clears the slot. */
    const endRunOwned = (sid: string, controller: AbortController): void => {
        if (chatStore.getController(sid) === controller) chatStore.endRun(sid);
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
            return buildTradeChatContext({ symbol, interval, packetMarkdown: cached.markdown, fetchedAtMs: cached.atMs, drawingsDescription, onScreenDescription: onScreen, plansDescription: plansBlock, liveMarkPrice, formingCandle });
        }
        try {
            const packet = await fetchHybridData(symbol);
            const markdown = generateHybridPromptInjection(packet, { compact: true });
            const atMs = Date.now();
            setContextAt(atMs);
            packetCache.set(symbol, { markdown, atMs });
            return buildTradeChatContext({ symbol, interval, packetMarkdown: markdown, fetchedAtMs: atMs, drawingsDescription, onScreenDescription: onScreen, plansDescription: plansBlock, liveMarkPrice, formingCandle });
        } catch {
            return buildTradeChatContext({ symbol, interval, packetMarkdown: '', fetchedAtMs: Date.now(), drawingsDescription, onScreenDescription: onScreen, plansDescription: plansBlock, liveMarkPrice, formingCandle });
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
    }, [symbol, interval, effort, chartLevels, allDrawings, executePanelTool, getChartSnapshot]);

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
    }, [provider, sessions, symbol, trades]);

    /** Send a message — or RETRY one: `retryOf` is the id of a previous USER
     *  entry whose answer should be regenerated. The stale answer(s) after
     *  that bubble are dropped and the turn re-runs with the same text/image
     *  and fresh live context. */
    const send = useCallback(async (raw: string, retryOf?: string): Promise<void> => {
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
        const retryIdx = retryEntry ? session.entries.findIndex(e => e.id === retryEntry.id) : -1;
        const history = retryIdx >= 0 ? session.entries.slice(0, retryIdx) : session.entries;
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
            const canSeeImages = isVisionModel(soloProvider.selectedModel);
            // Solo answers carry the seat label, so returning to a session
            // shows who said each line (the renderer the panel seats already
            // use). A bot-bound session names the AGENT, not the slug: the
            // same bot answers at the desk under its name, and one answer
            // claimed by model here and by identity there is two claims.
            mutate(sid, s => ({ ...s, entries: s.entries.map(en => (en.id === aiEntry.id ? { ...en, speaker: bot?.name ?? `${soloProvider.id}:${soloProvider.selectedModel}` } : en)) }));
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
                const messages: ChatMessage[] = [
                    { role: 'system', content: systemPromptFor(seatBot, panelMandate) },
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
    }, [attachments, bots, buildContextBlock, configForSeat, maybeReviewSessions, provider, runSeatTurn, systemPromptFor]);

    /** "Run full analysis" — the ensemble pipeline launched from this chat;
     *  its verdict comes back as an AI entry in the same transcript. */
    const runFullAnalysis = useCallback(async (): Promise<void> => {
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
        const userEntry: LiveEntry = { id: newId('u'), role: 'user', text: text + fileNote, tools: [], image: images[0]?.dataURL, at: Date.now() };
        const aiEntry: LiveEntry = { id: newId('a'), role: 'ai', text: 'Running the full ensemble analysis — hybrid data pull, debate, verdict…', tools: [], streaming: true, at: Date.now() };
        mutate(sid, s => ({ ...s, title: titleFromMessage(text), updatedAt: Date.now(), entries: [...s.entries, userEntry, aiEntry] }));
        const controller = new AbortController();
        chatStore.beginRun(sid, controller);
        try {
            const result = await onRunAnalysis(text + fileNote, images);
            if (controller.signal.aborted) {
                // Stopped mid-run: the early return used to skip the settle,
                // orphaning a streaming:true bubble that then blocked ALL
                // session persistence until reload.
                mutate(sid, s => ({ ...s, entries: s.entries.map(e => (e.id === aiEntry.id ? { ...e, streaming: false, text: e.text || 'The analysis was stopped.' } : e)) }));
                return;
            }
            // The bridge may hand back the App-side message id alongside the
            // verdict text — stamp the entry with it so Locate can scroll here.
            const answer = typeof result === 'string' ? result : result.text;
            const analysisMessageId = typeof result === 'string' ? undefined : result.messageId;
            if (analysisMessageId) {
                setAnalysisMessageIds(prev => ({ ...prev, [aiEntry.id]: analysisMessageId }));
            }
            mutate(sid, s => ({ ...s, entries: s.entries.map(e => (e.id === aiEntry.id ? { ...e, text: answer || 'The analysis produced no summary.', streaming: false } : e)) }));
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            mutate(sid, s => ({ ...s, entries: s.entries.map(e => (e.id === aiEntry.id ? { ...e, text: `The analysis run failed: ${message}`, streaming: false } : e)) }));
        } finally {
            endRunOwned(sid, controller);
        }
    }, [activeId, attachments, draft, onRunAnalysis]);

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
    }, [bots, buildContextBlock, configForSeat, provider, runSeatTurn, systemPromptFor]);

    // Flush queued harness signals when the session goes idle. takeHarness-
    // Signals emits, so this re-runs with an empty queue and settles.
    // KIND GATE: runHarnessTurn streams into the ACTIVE session's transcript
    // — but the group room renders a different surface the dock
    // never shows chat entries in. Draining into one would consume the queue
    // invisibly (the warning vanishes without ever reaching a model turn).
    // With a non-chat session selected the signals HOLD in the store;
    // switching back to a chat session re-fires this effect and drains.
    // The hold notice logs ONCE per episode — `sessions` is a fresh array on
    // every store emit, so an ungated log would spam the console per tick.
    const heldNoticeRef = useRef<string | null>(null);
    useEffect(() => {
        if (busy || snap.signals.length === 0) { heldNoticeRef.current = null; return; }
        const session = sessions.find(s => s.id === activeId) ?? sessions[0];
        if (session && session.kind !== 'solo' && session.kind !== 'panel') {
            if (heldNoticeRef.current !== session.id) {
                heldNoticeRef.current = session.id;
                console.info(`[Chart AI] holding ${snap.signals.length} harness signal(s): the active session is a ${session.kind}, not a chat — it will drain when a chat session is selected.`);
            }
            return;
        }
        heldNoticeRef.current = null;
        const texts = chatStore.takeHarnessSignals();
        if (texts.length > 0) void runHarnessTurn(texts.join('\n\n'));
    }, [busy, snap.signals, runHarnessTurn, activeId, sessions]);

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
    const setPanelModels = useCallback((sid: string, models: PanelSeatRef[]): void => {
        mutate(sid, s => ({ ...s, panelModels: models.slice(0, PANEL_MAX_MODELS) }));
    }, []);

    const addPanelSeat = useCallback((value: string): void => {
        if (!panelPickerFor) return;
        const [providerId, modelId] = value.includes('::') ? value.split('::') : [provider?.id ?? '', value];
        if (!modelId) return;
        const session = sessions.find(s => s.id === panelPickerFor);
        const current = session?.panelModels ?? [];
        const pid = providerId || provider?.id || '';
        // Dedupe on the seat key, not modelId alone: two relays offering one
        // model are distinct seats, and an agent seated on that same model must
        // not displace (or be displaced by) the plain model seat.
        const next: PanelSeatRef = { providerId: pid, modelId };
        if (current.some(m => panelSeatKey(m) === panelSeatKey(next))) return;
        setPanelModels(panelPickerFor, [...current, next]);
    }, [panelPickerFor, provider, sessions, setPanelModels]);

    /** Seat a roster agent on the panel: it answers as itself — persona, its own
     *  provider/model and its own notebook — beside plain model seats. It still
     *  carries the bot's model pair so the seat survives the agent being
     *  deleted from the roster later. */
    const addPanelAgentSeat = useCallback((botId: string): void => {
        if (!panelPickerFor) return;
        const bot = bots.find(b => b.id === botId);
        if (!bot) return;
        const session = sessions.find(s => s.id === panelPickerFor);
        const current = session?.panelModels ?? [];
        const next: PanelSeatRef = { providerId: bot.providerId, modelId: bot.modelId, botId: bot.id };
        if (current.some(m => panelSeatKey(m) === panelSeatKey(next))) return;
        setPanelModels(panelPickerFor, [...current, next]);
    }, [bots, panelPickerFor, sessions, setPanelModels]);

    // ── Attachments ─────────────────────────────────────────────────────────
    // Reading files in is the shared hook's job (see useChatAttachments); the
    // chart snapshot is the one image that never came off the picker.

    const captureChart = (): void => {
        const png = onCaptureChart?.() ?? null;
        if (!png) return;
        addAttachment({ kind: 'image', name: 'chart.png', payload: png });
    };

    const ready = !!provider && (activeSession.kind !== 'panel' || (activeSession.panelModels?.length ?? 0) >= 2);

    // Past Conversations palette rows: newest first, title-filtered, capped
    // at 8 until "Show N more…" (the reference's exact behavior).
    const historyFiltered = [...sessions]
        .filter(s => !historyQuery.trim() || s.title.toLowerCase().includes(historyQuery.trim().toLowerCase()))
        .sort((a, b) => b.updatedAt - a.updatedAt);
    const historyRows = historyShowAll ? historyFiltered : historyFiltered.slice(0, 8);
    const historyHidden = historyFiltered.length - historyRows.length;

    /** Proposal card disposition for one entry — read from the MODULE map
     *  (see proposalDisposition), so the 'logged' state survives a dock
     *  unmount/remount and "Log this trade" can never be clicked twice for
     *  the same plan. proposalTick is the repaint trigger. */
    const proposalStateOf = (id: string): 'logged' | 'dismissed' | undefined => {
        void proposalTick;
        return proposalDisposition.get(id);
    };

    if (collapsed) {
        return (
            <div className="flex h-10 w-full shrink-0 flex-row items-center gap-3 border-l border-white/[0.06] bg-zinc-900/40 px-3 lg:h-full lg:w-10 lg:flex-col lg:py-3" data-testid="trade-chat-rail">
                <button type="button" onClick={onToggleCollapsed} title="Expand Chart AI" aria-label="Expand Chart AI"
                    className="rounded-control p-1.5 text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100">
                    <PanelRightOpen className="h-4 w-4" />
                </button>
                <span className="select-none text-ui-xs font-bold uppercase tracking-widest text-zinc-500 lg:[writing-mode:vertical-rl]">Chart AI</span>
                <span className={`h-2 w-2 rounded-full ${busy ? 'animate-pulse bg-cyan-400' : live ? 'bg-emerald-500' : 'bg-zinc-500'}`} />
                <SupervisorIndicator compact onOpen={() => setSupervisorOpen(true)} />
            </div>
        );
    }

    return (
        <div className="relative flex h-full min-h-0 flex-col border-l border-white/[0.06] bg-zinc-900/40" data-testid="trade-chat-panel">
            {/* Header — the reference's Agent-panel cluster: wordmark left,
                + / history / ⋯ / × right, nothing else. Conversations are
                reached through the Past Conversations palette, not a tab
                strip. */}
            <div className="flex shrink-0 items-center gap-2 border-b border-white/[0.06] px-4 py-2.5">
                <span className={`h-2 w-2 shrink-0 rounded-full ${busy ? 'animate-pulse bg-cyan-400' : live ? 'bg-emerald-500' : 'bg-zinc-500'}`} aria-label={live ? 'live market feed connected' : 'market feed polling'} />
                <span className="text-ui-caption font-semibold text-zinc-100">Chart AI</span>
                <span className="truncate text-ui-dense text-zinc-500" title={activeSession.title}>{activeSession.title}</span>
                {(() => {
                    // The prototype's "Analyzed 2m ago" meta, told honestly:
                    // the session's last real activity, and only once a settled
                    // answer exists to be "answered".
                    const hasAnswer = entries.some(x => x.role === 'ai' && !x.notice && !x.streaming && x.text);
                    if (!hasAnswer) return null;
                    return <span className="hidden shrink-0 text-ui-xs text-zinc-600 sm:inline" data-testid="chat-answered-meta">answered {relTime(activeSession.updatedAt)}</span>;
                })()}
                <div className="ml-auto flex shrink-0 items-center gap-0.5">
                    <SupervisorIndicator onOpen={() => setSupervisorOpen(true)} />
                    {/* The overlay needs a debate message to project, so before
                        the first run this button could only ever do nothing. */}
                    {onToggleDeskScene && (hasDeskSceneMessage || isDeskSceneOpen) && (
                        <button
                            type="button"
                            onClick={onToggleDeskScene}
                            aria-label={isDeskSceneOpen ? 'Close desk view' : 'Open 2D desk view'}
                            title={isDeskSceneOpen ? 'Close 2D debate floor' : 'Open 2D debate floor'}
                            className={`relative rounded-control p-1.5 transition-colors hover:bg-white/[0.06] hover:text-zinc-100 ${
                                isDeskSceneOpen ? 'bg-cyan-500/15 text-cyan-400' : 'text-zinc-500'
                            }`}
                        >
                            <LayoutGrid className="h-4 w-4" />
                            {hasDeskSceneMessage && !isDeskSceneOpen && (
                                <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-cyan-400 ring-2 ring-zinc-900 animate-pulse" />
                            )}
                        </button>
                    )}
                    {(() => {
                        // ⟳ Re-run the last question with FRESH live context —
                        // the prototype's Refresh-analysis button, on real rails.
                        const lastUser = [...entries].reverse().find(x => x.role === 'user' && x.text && x.text !== '(chart screenshot)');
                        return (
                            <button type="button" onClick={() => lastUser && void send('', lastUser.id)} disabled={!ready || busy || !lastUser}
                                aria-label="Re-run last question" title={lastUser ? 'Re-ask the last question with fresh market context' : 'Ask something first'}
                                className="rounded-control p-1.5 text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-100 disabled:opacity-40">
                                <RotateCcw className="h-4 w-4" />
                            </button>
                        );
                    })()}
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
                                            className="block w-full rounded-lg px-2 py-1.5 text-left text-ui-dense text-zinc-300 hover:bg-white/[0.06]">
                                            Panel models <span className="text-zinc-600">· {activeSession.panelModels?.length ?? 0}/{PANEL_MAX_MODELS}</span>
                                        </button>
                                    )}
                                    <button type="button" onClick={() => { setShowNewMenu(false); onToggleExpanded?.(); }}
                                        className="block w-full rounded-lg px-2 py-1.5 text-left text-ui-dense text-zinc-300 hover:bg-white/[0.06]">
                                        {expanded ? 'Shrink back' : 'Expand over chart'}
                                    </button>
                                    <div className="my-1 border-t border-white/[0.06]" />
                                    <p className="px-2 py-0.5 text-ui-2xs uppercase tracking-widest text-zinc-600">Start</p>
                                    <button type="button" onClick={() => addSession('panel')} className="block w-full rounded-lg px-2 py-1.5 text-left text-ui-dense text-zinc-300 hover:bg-white/[0.06]">
                                        New panel <span className="text-zinc-600">· up to {PANEL_MAX_MODELS} models</span>
                                    </button>
                                    <button type="button" onClick={() => { setShowNewMenu(false); setShowNewBot(true); }}
                                        data-testid="new-agent-option"
                                        className="block w-full rounded-lg px-2 py-1.5 text-left text-ui-dense text-zinc-300 hover:bg-white/[0.06]">
                                        New agent <span className="text-zinc-600">· create a roster bot</span>
                                    </button>
                                    {renderGroupSurface && groups.length > 0 && groups.slice(0, 6).map(g => (
                                        <button key={g.id} type="button"
                                            onClick={() => { setShowNewMenu(false); const existing = sessions.find(s => s.groupId === g.id); if (existing) { chatStore.setActiveId(existing.id); return; } chatStore.addSession({ kind: 'group', title: g.name, groupId: g.id }); }}
                                            className="block w-full truncate rounded-lg px-2 py-1 text-left text-ui-dense text-zinc-400 hover:bg-white/[0.06]">
                                            {g.name} <span className="text-zinc-600">· room</span>
                                        </button>
                                    ))}
                                    {bots.length > 0 && bots.slice(0, 6).map(b => (
                                        <button key={b.id} type="button" onClick={() => addSession('solo', b.id)}
                                            className="block w-full truncate rounded-lg px-2 py-1 text-left text-ui-dense text-zinc-400 hover:bg-white/[0.06]">
                                            {b.name} <span className="text-zinc-600">· as bot</span>
                                        </button>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>
                    {/* Collapse is a lg+ affordance: below lg the owner passes no
                        handler (the dock is the session's whole surface), and the
                        old unguarded ✕ was a dead control that also armed the
                        desktop rail when the window later grew (audit R6 #22). */}
                    {onToggleCollapsed && (
                        <button type="button" onClick={onToggleCollapsed} aria-label="Collapse Chart AI" title="Collapse"
                            className="rounded-control p-1.5 text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-100">
                            <X className="h-4 w-4" />
                        </button>
                    )}
                </div>
            </div>

            {/* Past Conversations palette — the reference's history command:
                search box, "Recent" rows with relative times, keyboard nav. */}
            {supervisorOpen && <SupervisorPanel onClose={() => setSupervisorOpen(false)} />}
            {historyOpen && (
                <ChatHistoryPalette
                    rows={historyRows}
                    hidden={historyHidden}
                    sel={historySel}
                    query={historyQuery}
                    activeId={activeId}
                    canDelete={sessions.length > 1}
                    onQueryChange={v => { setHistoryQuery(v); setHistorySel(0); }}
                    onSelChange={setHistorySel}
                    onSelect={id => { chatStore.setActiveId(id); setHistoryOpen(false); }}
                    onDelete={id => removeSession(id)}
                    onShowAll={() => setHistoryShowAll(true)}
                    onClose={() => setHistoryOpen(false)}
                />
            )}

            {/* Panel seat editor (while a panel is still short of 2 seats). */}
            {panelPickerFor && (
                <div className="shrink-0 space-y-1.5 border-b border-white/[0.06] bg-zinc-900/70 px-3 py-2" data-testid="panel-picker">
                    <p className="text-ui-xs uppercase tracking-widest text-zinc-500">Panel seats ({sessions.find(s => s.id === panelPickerFor)?.panelModels?.length ?? 0}/{PANEL_MAX_MODELS}) — pick up to {PANEL_MAX_MODELS} models or agents; they answer together and talk to each other</p>
                    <div className="flex flex-wrap items-center gap-1.5">
                        {(sessions.find(s => s.id === panelPickerFor)?.panelModels ?? []).map((m: PanelSeatRef) => (
                            <span key={panelSeatKey(m)} className="flex items-center gap-1 rounded-full border border-white/10 bg-zinc-800 px-2 py-0.5 text-ui-xs text-zinc-200">
                                {m.botId ? (bots.find(b => b.id === m.botId)?.name ?? formatModelDisplayName(m.modelId)) : formatModelDisplayName(m.modelId)}
                                {m.botId && <span className="text-ui-2xs uppercase tracking-widest text-zinc-500">agent</span>}
                                <button type="button" aria-label={`Remove ${panelSeatKey(m)}`}
                                    onClick={() => setPanelModels(panelPickerFor, (sessions.find(s => s.id === panelPickerFor)?.panelModels ?? []).filter((x: PanelSeatRef) => panelSeatKey(x) !== panelSeatKey(m)))}
                                    className="text-zinc-500 hover:text-rose-400"><X className="h-2.5 w-2.5" /></button>
                            </span>
                        ))}
                        {(sessions.find(s => s.id === panelPickerFor)?.panelModels?.length ?? 0) < PANEL_MAX_MODELS && (
                            <ModelPicker providers={providers} value="" mode="provider-model" onChange={addPanelSeat} compact
                                disabledValues={new Set((sessions.find(s => s.id === panelPickerFor)?.panelModels ?? []).map((m: PanelSeatRef) => `${m.providerId}::${m.modelId}`))}
                                onRefreshModels={onRefreshModels}
                                placeholder="+ add model" />
                        )}
                        {/* Roster agents seat beside models: same panel, but the
                            answer carries the agent's persona, its own model and
                            its own notebook. Hidden when there is no roster. */}
                        {bots.length > 0 && (sessions.find(s => s.id === panelPickerFor)?.panelModels?.length ?? 0) < PANEL_MAX_MODELS && (
                            <span className="flex flex-wrap items-center gap-1" data-testid="panel-agent-picks">
                                <span className="text-ui-2xs uppercase tracking-widest text-zinc-600">agents</span>
                                {bots
                                    .filter(b => !(sessions.find(s => s.id === panelPickerFor)?.panelModels ?? [])
                                        .some((m: PanelSeatRef) => m.botId === b.id))
                                    .map(b => (
                                        <button key={b.id} type="button" data-testid={`panel-agent-${b.id}`}
                                            onClick={() => addPanelAgentSeat(b.id)}
                                            className="rounded-full border border-white/10 bg-zinc-800 px-2 py-0.5 text-ui-xs text-zinc-300 hover:bg-zinc-700">
                                            + {b.name}
                                        </button>
                                    ))}
                            </span>
                        )}
                        <button type="button" onClick={() => setPanelPickerFor(null)}
                            className="rounded-full bg-zinc-700 px-2.5 py-1 text-ui-xs font-semibold text-zinc-100 hover:bg-zinc-600">
                            Done
                        </button>
                    </div>
                </div>
            )}

            {/* Group room: the roster surface the dock embeds (App owns the
                wiring) instead of the chat transcript. The Coach inbox used to
                render here too, behind a Chat | Coach switch; it is the Learn
                surface's own tab now. */}
            {activeSession.kind === 'group' && (
                <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar" data-testid="chat-group-surface">
                    {renderGroupSurface?.(activeSession.groupId ?? '')}
                </div>
            )}
            {activeSession.kind !== 'group' && (
            <>
            {/* The prototype's bias read rides ABOVE the transcript: always
                current, code-calculated — the tape's state, not a chat turn. */}
            <BiasChips symbol={symbol} interval={interval as ChartInterval} />
            <div ref={scrollRef} onScroll={onChatScroll} className="min-h-0 flex-1 space-y-4 overflow-y-auto custom-scrollbar px-4 py-4">
                {entries.length === 0 && !panelPickerFor && (
                    <div className="flex h-full flex-col items-center justify-center gap-3 px-2 text-center">
                        <p className="text-ui-dense leading-5 text-zinc-500">
                            The model sees this chart live — a fresh code-calculated packet rides every message, it can pull the book, the full hybrid data or the exact screen state (including your drawings), take chart screenshots you attach, and grow itself: memory notes, skill proposals and new tools from this chat.
                        </p>
                        <div className="flex flex-wrap justify-center gap-1.5">
                            {QUICK_PROMPTS.map(({ text, Icon }) => (
                                <button key={text} type="button" disabled={!ready} onClick={() => void send(text)}
                                    className="group inline-flex items-center gap-1.5 rounded-full border border-white/[0.07] bg-zinc-800 px-2.5 py-1 text-ui-dense text-zinc-300 transition-colors hover:border-white/15 hover:text-zinc-100 disabled:opacity-40">
                                    <Icon className="h-3 w-3 shrink-0 text-zinc-500 transition-colors group-hover:text-cyan-400" aria-hidden="true" />
                                    {text}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
                {entries.map((e, i) => {
                    // Chips on a USER bubble (retry + copy) only exist once the
                    // generation following that message has stopped — and
                    // "the generation" is EVERY later entry, not just the
                    // adjacent one: a PANEL turn streams seat 2 while seat 1
                    // has already settled, and a retry chip appearing mid-turn
                    // let a click wipe the live room. Same contract as the AI
                    // bubble's copy chip (!streaming).
                    const answerStreaming = entries.slice(i + 1).some(x => x.streaming);
                    // Key-levels protocol: the fenced block the model closes an
                    // analysis with renders as the chart-linked card, never as
                    // raw text — and an OPEN (still-streaming) fence is hidden
                    // from the bubble too, so the protocol never flashes.
                    const aiLevels = e.role === 'ai' && !e.notice ? parseKeyLevels(e.text) : null;
                    const shownText = aiLevels?.hadBlock ? aiLevels.clean : e.text;
                    const analysisId = analysisMessageIds[e.id];
                    // Only a settled answer has a verdict to explain, and only
                    // an entry this dock ran has an id to resolve it from.
                    const verdict = e.streaming || e.notice ? undefined
                        : (analysisId ? getAnalysisMessage?.(analysisId) : undefined);
                    return (
                    <div key={e.id} className="chat-fade-in" data-entry-id={e.id} data-message-id={analysisId ?? e.id} data-testid={`chat-entry-${e.role}`}>
                        {e.role === 'user' ? (
                            <div className="flex flex-col items-end gap-1">
                                {e.image && (
                                    <div className="group/msg flex flex-col items-end gap-0.5">
                                        <img src={e.image} alt="attached" className="max-h-40 rounded-lg border border-white/10 object-contain" />
                                        {!answerStreaming && <RetryChip onRetry={() => void send('', e.id)} />}
                                    </div>
                                )}
                                {e.text && e.text !== '(chart screenshot)' && (
                                    <div className="group/msg flex max-w-[85%] items-start gap-1">
                                        {!answerStreaming && <CopyChip text={e.text} className="mt-2" />}
                                        {!answerStreaming && <RetryChip onRetry={() => void send('', e.id)} className="mt-2" />}
                                        <p className="min-w-0 rounded-bubble bg-zinc-800 px-3 py-2 text-ui-sm leading-5 text-zinc-100">{e.text}</p>
                                    </div>
                                )}
                            </div>
                        ) : e.notice ? (
                            <p className="flex items-center gap-1.5 text-ui-xs font-semibold uppercase tracking-wider text-amber-400" data-testid="chat-notice">
                                <span className="sr-only">⚡ </span>
                                <Zap className="h-3 w-3 shrink-0" />
                                <span>{e.tools[0] ?? 'Harness event'}</span>
                            </p>
                        ) : (
                            <div className="group/msg space-y-1">
                                {e.speaker && (
                                    <p className="font-mono text-ui-2xs uppercase tracking-widest text-zinc-500">{formatSeatLabel(e.speaker.split(':')[1] ?? e.speaker)}</p>
                                )}
                                <ChatWorkTimeline entry={e} />
                                <div className="text-ui-sm leading-5 text-zinc-200">
                                    {shownText
                                        ? <FadingText text={shownText} streaming={!!e.streaming} />
                                        : null}
                                </div>
                                {shownText && !e.streaming && (
                                    <div className="flex items-center gap-2">
                                        <CopyChip text={shownText} />
                                        {onToggleWatch && analysisId && pinnedMessageIds && (
                                            <PinChip pinned={pinnedMessageIds.has(analysisId)}
                                                onToggle={() => onToggleWatch(analysisId)} />
                                        )}
                                    </div>
                                )}
                                {/* The one "what the AI remembered" row. Once the
                                    answer has settled — an open stream is still
                                    pulling injections in, so its window has no
                                    upper bound yet. */}
                                {shownText && !e.streaming && !e.notice && (
                                    <MemoryProvenanceStrip
                                        startedAt={e.at}
                                        nextAt={entries[i + 1]?.at}
                                        messageId={e.id}
                                    />
                                )}
                                {verdict?.analysis && (
                                    <VerdictAudit
                                        analysis={verdict.analysis}
                                        evidencePack={verdict.evidencePack}
                                        runContract={verdict.runContract}
                                        className="mt-1.5"
                                    />
                                )}
                                {aiLevels && aiLevels.levels.length > 0 && !e.streaming && (
                                    <KeyLevelsCard
                                        messageId={e.id}
                                        levels={aiLevels.levels}
                                        symbol={symbol}
                                        getMark={getMarkForDist}
                                        onChatLevels={handleCardLevels}
                                    />
                                )}
                                {e.proposal && !proposalStateOf(e.id) && (
                                    <TradeProposalCard
                                        proposal={e.proposal}
                                        canLog={!!onLogProposedTrade}
                                        onLog={() => {
                                            // Double-log guard: the disposition lives at module
                                            // scope, so it survived even before this fix's second
                                            // half — the map lookup makes a re-click after a dock
                                            // unmount/remount (fresh component, same store entry)
                                            // a NO-OP instead of a second journal row.
                                            if (proposalDisposition.get(e.id)) return;
                                            onLogProposedTrade?.(e.proposal!);
                                            setProposalDisposition(e.id, 'logged');
                                            setProposalTick(t => t + 1);
                                        }}
                                        onCancel={() => { if (proposalDisposition.get(e.id)) return; setProposalDisposition(e.id, 'dismissed'); setProposalTick(t => t + 1); }}
                                    />
                                )}
                                {e.proposal && proposalStateOf(e.id) === 'logged' && <TradeProposalLoggedRow />}
                            </div>
                        )}
                    </div>
                    );
                })}
            </div>

            {/* Composer — the reference's layout: a workspace-style section
                header (symbol · panel seats · bot · packet age), then one
                rounded card holding the input and its toolbar, then a plain
                sentence-case disclaimer. Generous padding, no hard divider. */}
            <div className="shrink-0 px-3 pb-3 pt-1">
                {modelIssue && provider && (
                    <div className="mb-1.5 flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-ui-dense leading-4 text-amber-300" data-testid="model-fallback-warning">
                        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span className="min-w-0 flex-1">
                            {modelIssue} Answering with <strong className="font-semibold">{provider.name} · {formatModelDisplayName(provider.selectedModel)}</strong> — re-pick a model in the dropdown.
                        </span>
                    </div>
                )}
                <ComposerWorkspaceRow
                    symbol={symbol}
                    interval={interval}
                    isPanel={isPanel}
                    panelCount={activeSession.panelModels?.length ?? 0}
                    pickerOpen={panelPickerFor === activeId}
                    onTogglePicker={() => setPanelPickerFor(panelPickerFor === activeId ? null : activeId)}
                    botName={boundBot ? boundBot.name : null}
                    contextAt={contextAt}
                />
                {attachments.length > 0 && (
                    <ChatAttachmentStrip
                        attachments={attachments}
                        onRemove={removeAttachment}
                    />
                )}
                <div className="rounded-2xl border border-white/10 bg-zinc-800/70 px-3 py-2.5 shadow-lg">
                    <textarea
                        ref={composerRef}
                        rows={1}
                        value={draft}
                        disabled={!ready}
                        onChange={ev => setDraft(ev.target.value)}
                        onKeyDown={ev => {
                            if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); void send(draft); }
                        }}
                        placeholder={ready ? 'Ask anything…' : isPanel ? 'Add at least 2 panel models above' : 'Configure a provider in Settings first'}
                        className="max-h-28 min-h-[24px] w-full resize-none bg-transparent text-ui-caption leading-5 text-zinc-100 placeholder:text-zinc-600 focus:outline-none disabled:opacity-50"
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
                                            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-ui-dense text-zinc-300 hover:bg-white/[0.06]">
                                            <FileText className="h-3.5 w-3.5 text-zinc-500" /> Upload files &amp; images
                                        </button>
                                        <button type="button" onClick={() => { setShowAttachMenu(false); captureChart(); }}
                                            disabled={!onCaptureChart} title={onCaptureChart ? undefined : 'Chart not ready'}
                                            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-ui-dense text-zinc-300 transition-colors hover:bg-white/[0.06] disabled:opacity-40">
                                            <Camera className="h-3.5 w-3.5 text-zinc-500" /> Screenshot chart
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                        {/* Always-available growth chip: study the whole tape
                            and draft skills (they wait for approval in the
                            Inbox). Kept out of the + menu so the action is
                            discoverable, like Full analysis. */}
                        <button type="button" onClick={() => void send(SCAN_SKILLS_PROMPT)} disabled={!ready || busy}
                            title="Study every candle in this chart and draft IF/THEN skills from what actually worked — drafts wait for your approval in the Inbox"
                            className="rounded-full border border-white/[0.07] px-2 py-1 text-ui-xs font-semibold text-zinc-400 transition-colors hover:border-white/20 hover:text-zinc-100 disabled:opacity-40">
                        Scan → skills
                        </button>
                        {onRunAnalysis && draft.trim() && !isPanel && (
                            <button type="button" onClick={() => void runFullAnalysis()} disabled={busy}
                                title="Run the full ensemble analysis (hybrid data + debate + verdict) on this request"
                                className="rounded-full border border-white/[0.07] px-2 py-1 text-ui-xs font-semibold text-zinc-400 transition-colors hover:border-white/20 hover:text-zinc-100 disabled:opacity-40">
                            Full analysis
                            </button>
                        )}
                        <div className="relative ml-auto flex items-center gap-1">
                            {!isPanel && (
                                <ModelPicker providers={providers} value={selectedChatModel} onChange={changeSoloModel} mode="provider-model" onRefreshModels={onRefreshModels} compact />
                            )}
                            <button type="button" onClick={() => setShowEffortMenu(v => !v)}
                                aria-label={`Thinking effort: ${effortChoiceOf(effort).label}`}
                                aria-expanded={showEffortMenu} aria-haspopup="menu"
                                title={`Thinking effort: ${effortChoiceOf(effort).label}`}
                                className="flex items-center gap-1.5 rounded-full border border-white/[0.07] px-2 py-1 text-ui-xs font-semibold text-zinc-400 transition-colors hover:border-white/20 hover:text-zinc-100">
                                <Brain className="h-3.5 w-3.5" />
                                {effortChoiceOf(effort).label}
                                <ChevronDown className={`h-2.5 w-2.5 transition-transform duration-150 ease-[var(--ease-snappy)] ${showEffortMenu ? 'rotate-180' : ''}`} />
                            </button>
                            {showEffortMenu && (
                                <>
                                    {/* The invisible-backdrop close the attach menu
                                        already uses: a popover you can leave only by
                                        picking an item is a trap. */}
                                    <div className="fixed inset-0 z-20" aria-hidden onClick={() => setShowEffortMenu(false)} />
                                    <div
                                        className="absolute bottom-8 right-0 z-30 w-36 rounded-xl border border-white/10 bg-zinc-900 p-1 shadow-xl"
                                        data-testid="effort-menu"
                                        role="menu"
                                        aria-label="Thinking effort"
                                        onKeyDown={(e) => { if (e.key === 'Escape') setShowEffortMenu(false); }}
                                    >
                                        {EFFORT_CHOICES.map(c => (
                                            <button
                                                key={c.id}
                                                type="button"
                                                role="menuitemradio"
                                                aria-checked={effort === c.id}
                                                // Focus lands on the current choice — that
                                                // is what makes Escape and Tab reach the menu.
                                                autoFocus={effort === c.id}
                                                onClick={() => { changeEffort(c.id); setShowEffortMenu(false); }}
                                                className={`block w-full rounded-lg px-2 py-1.5 text-left text-ui-dense transition-colors hover:bg-white/[0.06] ${effort === c.id ? 'text-zinc-100' : 'text-zinc-500'}`}
                                            >
                                                {c.label}
                                            </button>
                                        ))}
                                    </div>
                                </>
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
                <p className="mt-2 px-2 text-ui-xs text-zinc-600">
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
/** Hover chip on USER bubbles: re-run the turn from this message — the
 *  stale answer(s) after it are dropped and the model regenerates with
 *  fresh live context. */
const RetryChip: React.FC<{ onRetry: () => void; className?: string }> = ({ onRetry, className = '' }) => (
    <button type="button"
        onClick={onRetry}
        aria-label="Retry this message"
        title="Retry — regenerate the answer"
        className={`flex items-center rounded-control px-1.5 py-0.5 text-ui-xs text-zinc-500 opacity-0 transition-opacity hover:bg-white/[0.06] hover:text-zinc-200 focus:opacity-100 group-hover/msg:opacity-100 ${className}`.trim()}>
        <RotateCcw className="h-3 w-3" />
    </button>
);

const CopyChip: React.FC<{ text: string; className?: string }> = ({ text, className = '' }) => {
    const [copied, setCopied] = useState(false);
    return (
        <button type="button"
            onClick={() => { void copyText(text).then(ok => { if (ok) { setCopied(true); window.setTimeout(() => setCopied(false), 1400); } }); }}
            aria-label="Copy message" title={copied ? 'Copied' : 'Copy this message'}
            className={`flex items-center gap-1 rounded-control px-1.5 py-0.5 text-ui-xs text-zinc-500 opacity-0 transition-opacity hover:bg-white/[0.06] hover:text-zinc-200 focus:opacity-100 group-hover/msg:opacity-100 ${className}`.trim()}>
            {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
    );
};

/** Pin this verdict to the Pinned list. Unlike the copy/retry chips it stays
 *  visible once set: the hover-reveal helps you FIND the control, but hiding a
 *  pinned signal's own state would leave the list unexplainable. */
const PinChip: React.FC<{ pinned: boolean; onToggle: () => void }> = ({ pinned, onToggle }) => (
    <button type="button"
        onClick={onToggle}
        aria-pressed={pinned}
        aria-label={pinned ? 'Unpin this signal' : 'Pin this signal'}
        title={pinned
            ? 'Pinned — tracked in the Pinned list (header tray). Click to remove.'
            : 'Pin this signal to the Pinned list. It tracks the setup; it does not arm a price trigger.'}
        className={`flex items-center gap-1 rounded-control px-1.5 py-0.5 text-ui-xs transition-opacity hover:bg-white/[0.06] focus:opacity-100 ${
            pinned ? 'text-zinc-100' : 'text-zinc-500 opacity-0 hover:text-zinc-200 group-hover/msg:opacity-100'
        }`}>
        <Pin className="h-3 w-3" />
        <span>{pinned ? 'Pinned' : 'Pin'}</span>
    </button>
);

/** Every character the store holds, every render. The reveal used to be a
 *  requestAnimationFrame-driven prefix of the text, which silently withheld
 *  content: measured on a 4,800-char answer, only 1,728 characters were in the
 *  DOM while the window was hidden (rAF fired 0 times in 400ms). The tail was
 *  unrendered and therefore unscrollable, while the Copy chip — handed the
 *  full string — revealed that the model had answered completely. The chunks
 *  arriving from the provider already give the typewriter feel; the fade here
 *  is CSS-only and can never eat text. */
const FadingText: React.FC<{ text: string; streaming: boolean }> = ({ text, streaming }) => (
    <div className={streaming ? 'stream-fade' : undefined}>
        <MarkdownContent content={text} className="!text-ui-sm [&_p]:my-1 [&_li]:text-ui-sm" />
    </div>
);

export default React.memo(TradeChatPanel);
