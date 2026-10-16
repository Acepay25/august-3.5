/**
 * AgentsView — the Chat surface, not a roster that bounces you somewhere
 * else (WS-6). Reached from the nav as "Chat"; the surface id and every
 * testid still say `agents`, because a dozen gates pin them independently of
 * the label.
 *
 * Three regions, mirroring the reference: a conversation rail, a main pane,
 * and one pill composer.
 *
 * ⚠️ THE TWO SURFACES DO NOT SHARE A STORE TODAY. This comment used to claim
 * they did, and the claim was false — it is why "a conversation opened here
 * and on the Trade surface is one conversation" was believed and planned
 * against. The truth, which the render-probe already documented at
 * `render-probe.cjs:487-491`:
 *
 *  - this surface reads App's `messages` (useConversations) and slices it
 *    with `utils/agentThreads`;
 *  - the Chart AI dock reads and writes `services/trade/chatStore.ts`, a
 *    module singleton that survives unmount so a running stream is not
 *    aborted by a surface switch.
 *
 * So a bot thread is the same PERSONA over two different transcripts. The
 * join between them is an id link, not a shared array: the dock appends its
 * own lean entry and keeps the pipeline's rich `Message` id alongside it
 * (`TradeChatPanel.tsx` → `getAnalysisMessage`).
 *
 *  - a send routes on WHAT IS SELECTED, not on a mode switch (there is no
 *    switch any more): a bot answers through `runUserBotTurn`, the same
 *    transport the DM mailbox uses; nothing selected hands the text to
 *    `handleSendMessage` — the real pipeline, so the ensemble debate, desk
 *    tools and memory run exactly as they do from the dock, and the verdict
 *    comes back as an ordinary message in the same array.
 *
 * Rooms delegate to App's existing GroupChatView element rather than
 * reimplementing the round runner.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUp, ArrowUpDown, Bot, ChevronDown, Ellipsis, MessageSquare, Pencil, PanelLeftClose, Paperclip, Pin, Plus, Search, Timer, Trash2, Users } from '../shared/Icons';
import { ModelFallbackBanner } from '../trade/panels/ChatComposer';
import type { ProviderConfig } from '../../types/provider';
import { useChatAttachments, type PipelineImage } from '../../hooks/useChatAttachments';
import { runAnalysisAsChatTurn, type AnalysisTurnOutcome } from '../../services/trade/analysisTurn';
import { DISCLAIMER_SHORT } from '../../constants/disclaimer';
import * as chatStore from '../../services/trade/chatStore';
import ChatTranscriptRow, { type ChatRowView } from '../shared/ChatTranscriptRow';
import { BotAvatar } from '../chat/BotAvatar';
import SymbolPicker from '../trade/SymbolPicker';
import TimeframeBar from '../trade/TimeframeBar';
import type { ChartInterval } from '../trade/TradingChart';
import { useSymbolUniverse } from '../../hooks/useSymbolUniverse';
import { MENU_W, RowMenu, type RowMenuItem } from './RowMenu';
import type { AgentBot, AgentGroup } from '../../services/agents/agentRoster';
import { groupDisplayName } from '../../services/agents/agentRoster';
import type { AutomationConfig } from '../../types/automation';
import type { Conversation } from '../../types';
import type { BotLearningStat } from '../../services/agents/botLearning';
import {
    deskThread, markThreadOpened, previewTextFor, threadForProvider, unreadCount,
    type AgentThreadOpenedMap, type ThreadSelection,
} from '../../utils/agentThreads';
import { MessageRole } from '../../types/enums';
import type { Message } from '../../types/message';
import StatusPill from '../ui/StatusPill';
// The shell's own column width, imported rather than repeated: this surface's
// sidebar and the rail are ONE shell, and two numbers is how the hop started
// jumping between them.
import { NAV_RAIL_EXPANDED_PX } from '../shell/NavRail';
import NavExpandButton from '../shell/NavExpandButton';
import InlineVerdict from '../analysis/InlineVerdict';

interface AgentsViewProps {
    username: string;
    bots: AgentBot[];
    groups: AgentGroup[];
    messages: Message[];
    selection: ThreadSelection;
    onSelect: (t: ThreadSelection) => void;
    onNewBot: () => void;
    onNewGroup: () => void;
    /** Chat mode: the bot's own DM transport (App's mailbox). */
    onSendBotTurn: (bot: AgentBot, prompt: string) => Promise<boolean>;
    /** The SAME pipeline entry the Chart AI dock runs — not a weaker local copy.
     *  It resolves to the verdict text (plus the App-side message id the dock's
     *  Locate button uses) and rejects when a run is already going or no
     *  provider is configured, so both reasons reach the transcript instead of
     *  vanishing into a void-ed promise. */
    onAnalyze: (prompt: string, images: PipelineImage[]) => Promise<AnalysisTurnOutcome>;
    /** App renders the existing room view; this surface only hosts it. */
    renderGroup?: (group: AgentGroup) => React.ReactNode;
    /** Decisions waiting in the Coach inbox — counts the rail's hop pill. */
    coachCount: number;
    workingBotId?: string | null;
    lastOpenedMap?: AgentThreadOpenedMap;
    /** botId → one-line "cannot do its job" hint (the rail's ⚠ badge). */
    attentionMap?: Record<string, string>;
    /** Routines scoped to a bot — the disclosure the old rail carried. */
    botRoutines?: Record<string, AutomationConfig[]>;
    onRunRoutine?: (config: AutomationConfig) => void;
    onDeleteBot?: (botId: string) => void;
    onDeleteGroup?: (groupId: string) => void;
    onEditGroup?: (groupId: string) => void;
    /** Re-runs a post-mortem that failed. The failed candidate is stamped on
     *  the message, so the row only has to name itself. Absent on surfaces
     *  that never run post-mortems — the CTA then does not render. */
    onRetryPostMortem?: (messageId: string) => void;
    /** WS-3.4: what each bot has learned — lessons, skills authored, evidence.
     *  Shown on the active bot's header and as a row badge. */
    botStats?: BotLearningStat[];
    /** Any ready provider at all — the desk's status dot, not a decoration. */
    providerReady?: boolean;
    /** Rename a bot in place (WS-6's row affordances). */
    onRenameBot?: (botId: string, name: string) => void;
    /** Open this bot's debate-seat overrides (prompt, personality, tool
     *  allowlist) — the three fields the pipeline reads off the BotRegistry
     *  record that matches the bot's provider + model. */
    onEditSeatOverrides?: (bot: AgentBot) => void;
    /** Jump to the Coach inbox, which lives on the Learn surface. Without it
     *  the rail shows no Coach pill — a shortcut to a thread this surface no
     *  longer owns would be a dead end wearing a badge. */
    onOpenCoach?: () => void;
    /** Current provider/model chip in the composer. WS-6 asks that it open the
     *  model picker, so App hands in a mounted ModelPicker (which renders its
     *  own trigger labelled with the current selection) rather than a button
     *  that leaves the surface to reach Settings. */
    modelPicker?: React.ReactNode;
    /** Why the stored chat model cannot answer, and what will instead (stage 3
     *  F4b). The Chat surface runs the same solo pick as the dock, so it must
     *  carry the same amber warning — hidden while a bot is selected, because a
     *  bot answers from its own config and the pick is irrelevant to it. */
    modelFallback?: { issue: string; provider: ProviderConfig } | null;
    /** The destinations the rail would otherwise render. Handed in as a node
     *  rather than re-implemented: on this surface the rail is not mounted, so
     *  this column IS the sidebar — and it is the same `SurfaceMenuList`, not a
     *  second copy that can drift from the first. */
    destinationMenu?: React.ReactNode;
    /** The account + Settings row, for the same reason. */
    accountRow?: React.ReactNode;
    /** The shell's status cluster (save state, offline, Activity). Handed in for
     *  the same reason as the destinations: the sidebar now runs the full height
     *  of the window, so this surface renders NO global band, and the controls
     *  that used to live in it need a home in the one title bar this surface
     *  has. Same component the other surfaces' band uses — not a copy. */
    statusCluster?: React.ReactNode;
    /** The screen switch, same reasoning as `statusCluster`: this surface
     *  renders no global band, so the navigation the sidebar rows used to be has
     *  to live in the one title bar this surface has. */
    surfaceSwitch?: React.ReactNode;
    /** The SAME left-column state every other surface drives, handed in rather
     *  than re-derived per profile. This surface used to keep its own collapse
     *  key and its own width, so the Chat ⇄ Chart AI hop restacked the shell:
     *  the sidebar jumped 320→240px and the header's "Expand navigation" drove
     *  a rail that was not mounted here. One state, one width, and the switch
     *  changes only what the column lists — which is what the reference does
     *  between its chat and code modes. */
    railExpanded?: boolean;
    onToggleRailExpanded?: () => void;
    onHydratePins?: (pins: string[]) => void;
    /** The App-side conversations (useConversations). Stage 3 made this rail
     *  the ONE conversation home: these render as their own section here
     *  instead of the nav rail's SESSIONS list. Loading one resets the
     *  selection to the desk pane, which is where its messages render. */
    conversations?: Conversation[];
    activeConversationId?: string | null;
    onLoadConversation?: (id: string) => void;
    onDeleteConversation?: (id: string) => void;
    /** Empty one conversation (keep the row, drop its messages) — the
     *  command palette's "Clear current chat" rehomed onto the row menu. */
    onClearConversation?: (id: string) => void;
    /** Start a new App conversation (the old nav-rail "New chat" row). */
    onNewChat?: () => void;
}

const PIN_KEY = (user: string): string => `agent_pins_v1_${user}`;

const loadPins = (user: string): string[] => {
    try { return JSON.parse(localStorage.getItem(PIN_KEY(user)) || '[]') as string[]; } catch { return []; }
};

/** The ONE duration formatter: elapsed milliseconds → the compact label the
 *  rail prints (`now`, `45m`, `6h`, `8d`).
 *
 *  It takes a DURATION, never a stamp. The bug this replaces subtracted
 *  `Date.now()` twice — `relTime` computed `Date.now() - Date.parse(iso)` and
 *  handed that duration to `relTimeMs`, which subtracted `Date.now()` again,
 *  so an 8-day-old row printed `20731d` (the epoch leaking through). Every
 *  elapsed label on this surface must come from here so there is exactly one
 *  place a duration is turned into text. */
const durationLabel = (ms: number): string => {
    if (!Number.isFinite(ms) || ms < 0) return '';
    const m = Math.round(ms / 60000);
    if (m < 1) return 'now';
    if (m < 60) return `${m}m`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h}h`;
    return `${Math.round(h / 24)}d`;
};

/** Elapsed since an ISO stamp; '' when the stamp is missing or unparseable. */
const relTime = (iso: string | null | undefined): string => {
    if (!iso) return '';
    const at = Date.parse(iso);
    if (!Number.isFinite(at)) return '';
    return durationLabel(Date.now() - at);
};

/** Elapsed since an epoch-ms stamp; '' for no stamp. */
const relTimeMs = (ms: number): string => {
    if (!ms) return '';
    return durationLabel(Date.now() - ms);
};

/** Adapt a pipeline `Message` onto the shared row view, so this surface and
 *  the Chart AI dock render one transcript furniture rather than two.
 *
 *  Everything here is data the pipeline already wrote: per-seat reasoning and
 *  thought traces, the tool side-effects, attached images, the analysis. The
 *  two joins worth naming:
 *
 *  - `reasoningProcesses` and `thoughtProcesses` are separate per-provider
 *    maps, so the traces are joined in provider order rather than guessed at.
 *  - `liveToolEvents` is keyed by speaker and is nulled when the turn settles
 *    (`verdictFinalizer.ts`), so it only exists mid-stream; `toolActions` is
 *    what survives and is what the status rows render.
 */
const chatRowFrom = (m: Message, username: string, deskName: string): ChatRowView => {
    const traces = [
        ...Object.values(m.reasoningProcesses ?? {}),
        ...Object.values(m.thoughtProcesses ?? {}),
    ].filter(t => !!t && t.trim().length > 0);
    return {
        id: m.id,
        role: m.role === MessageRole.USER ? 'user' : 'ai',
        text: m.text || '',
        speaker: m.role === MessageRole.USER ? username : (m.botId ? deskName : 'desk'),
        timeLabel: relTime(m.createdAt),
        // The solo reply stream sets isStreaming; the ensemble run signals
        // through isDebating. Both mean "still working", so both drive the
        // work-in-progress state rather than only the cheap one.
        streaming: !!(m.isStreaming || m.isDebating),
        images: m.images,
        reasoning: traces.length > 0 ? traces.join('\n\n') : undefined,
        toolLines: Object.values(m.liveToolEvents ?? {}).flat(),
        actions: m.toolActions,
        workedMs: typeof m.runStats?.durationMs === 'number' ? m.runStats.durationMs : undefined,
        // A planId-stamped row is the "Logged from Chart AI" RECEIPT of a
        // proposal whose decision card is already on screen — under the answer
        // that proposed it here, and on the dock's proposal card. Its analysis
        // is a copy carried for the journal row and the autopilot, so passing
        // it through here would render the identical ENTRY/STOP/TARGET/
        // PROBABILITY card a second time in the same turn. One fact, one
        // carrier: the card belongs to the answer, not to its receipt.
        analysis: m.planId ? undefined : m.analysis,
        // The harness stamps the failed candidate on the message when a
        // post-mortem throws; the row exposes it so the CTA can offer the re-run.
        postMortemFailed: !!m.postMortemFailedCandidate,
    };
};

/** Time-aware, per the reference's greeting — this surface is otherwise empty
 *  chrome, so the one thing it can say that's true is when you are. */
const greeting = (name: string): string => {
    const h = new Date().getHours();
    const part = h < 5 ? 'still up' : h < 12 ? 'Morning' : h < 18 ? 'Afternoon' : 'Evening';
    return h < 5 ? `Still up, ${name}?` : `${part}, ${name}`;
};

// ─── Rail row ───────────────────────────────────────────────────────────────

const Row: React.FC<{
    active: boolean;
    title: string;
    preview: string;
    time?: string;
    unread?: number;
    working?: boolean;
    pinned?: boolean;
    /** One-line "this bot cannot do its job" hint; the ⚠ carries it as tooltip. */
    attention?: string;
    onPin?: () => void;
    /** Hover actions: edit / delete — the roster affordances the old rail
     *  owned, kept reachable now that this surface replaced its row model. */
    manage?: React.ReactNode;
    /** WS-6 §5's context menu. The same handlers the hover icons carry, plus
     *  pin and routines, so right-clicking a row is not a second-class path. */
    actions?: RowMenuItem[];
    /** Tiny mono count after the name — skills this bot authored. */
    stat?: number;
    /** Row identity for tests — the desk's own row needs its own. */
    testId?: string;
    /** Routines disclosure trigger, rendered when the bot has schedules. */
    routinesToggle?: React.ReactNode;
    children?: React.ReactNode;
    Icon: React.FC<{ className?: string }>;
    /** Identity graphic for this row. A bot's own `BotAvatar` face replaces the
     *  generic outlined glyph — the same mark the thread bylines and the roster
     *  already use, so a bot looks like the same bot in every list. */
    avatar?: React.ReactNode;
    onClick: () => void;
}> = ({ active, title, preview, time, unread, working, pinned, attention, onPin, manage, actions, stat, testId = 'agent-row', routinesToggle, children, Icon, avatar, onClick }) => {
    const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
    const hasActions = !!actions && actions.length > 0;
    return (
        <div className={`group relative ${active ? 'bg-zinc-800/70' : 'hover:bg-zinc-800/30'} rounded-control`}
            onContextMenu={e => {
                // No actions for this row → leave the native menu alone.
                if (!hasActions) return;
                e.preventDefault();
                setMenuAt({ x: e.clientX, y: e.clientY });
            }}>
            <div className="flex items-start gap-2 px-2 py-1.5">
                <button type="button" onClick={onClick} data-testid={testId} className="flex min-w-0 flex-1 items-start gap-2 text-left">
                    {avatar ?? (
                        <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                            working ? 'border-amber-500/40 text-amber-300' : active ? 'border-zinc-600 text-zinc-200' : 'border-zinc-800 text-zinc-500'
                        }`}>
                            <Icon className="h-3 w-3" aria-hidden="true" />
                        </span>
                    )}
                    <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-center gap-1">
                            <span className="min-w-0 truncate text-ui-sm font-semibold text-zinc-200" title={title}>{title}</span>
                            {attention && (
                                <span title={attention} data-testid="row-attention"
                                    className="shrink-0 text-ui-2xs font-bold text-amber-400">⚠</span>
                            )}
                            {!!stat && (
                                <span title={`${stat} skills authored`} data-testid="row-skills"
                                    className="shrink-0 rounded-full border border-zinc-800 px-1 font-mono text-ui-2xs tabular-nums text-zinc-500">
                                    {stat}
                                </span>
                            )}
                        </span>
                        <span className="block truncate text-ui-dense text-zinc-500" title={preview || 'No messages yet'}>{preview || 'No messages yet'}</span>
                    </span>
                </button>
                <span className="flex shrink-0 flex-col items-end gap-1 pt-0.5">
                    <span className="flex items-center gap-1">
                        {time && <span className="font-mono text-ui-2xs text-zinc-600">{time}</span>}
                        {!!unread && (
                            <span className="rounded-full bg-zinc-700 px-1.5 font-mono text-ui-2xs tabular-nums text-zinc-200">
                                {unread > 9 ? '9+' : unread}
                            </span>
                        )}
                    </span>
                    {routinesToggle}
                </span>
                {/* The row's actions lie OVER the row instead of beside it. In
                    flow they cost 150px of a 223px row PERMANENTLY — every one of
                    them invisible until hover — which left 21px for the bot's
                    NAME, the one line that has to be readable. Absolutely
                    positioned, the name gets the whole row and the controls still
                    arrive on hover and on keyboard focus. A pinned row shows its
                    pin at rest, because that state is information, not an action. */}
                {(onPin || manage || hasActions) && (
                    <span className={`absolute right-1 top-1.5 flex items-center gap-1 rounded-control bg-zinc-900/95 px-1 transition-opacity ${
                        pinned ? 'pointer-events-auto opacity-100'
                            : 'pointer-events-none opacity-0 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100'
                    }`}>
                        {onPin && (
                            <button type="button" onClick={onPin} aria-label={pinned ? `Unpin ${title}` : `Pin ${title}`}
                                className={`hit-target rounded-control p-0.5 transition-colors ${
                                    pinned ? 'text-zinc-400' : 'text-zinc-600 hover:text-zinc-200'
                                }`}>
                                <Pin className="h-3 w-3" aria-hidden="true" />
                            </button>
                        )}
                        {manage}
                        {hasActions && (
                            <button type="button" aria-label={`${title} options`} data-testid="row-menu"
                                onPointerDown={e => e.stopPropagation()}
                                onClick={e => {
                                    const r = e.currentTarget.getBoundingClientRect();
                                    setMenuAt(m => m ? null : { x: r.right - MENU_W, y: r.bottom + 4 });
                                }}
                                className="hit-target rounded-control p-0.5 text-zinc-600 transition-colors hover:text-zinc-300">
                                <Ellipsis className="h-3 w-3" aria-hidden="true" />
                            </button>
                        )}
                    </span>
                )}
            </div>
            {children}
            {menuAt && actions && actions.length > 0 && createPortal(
                <RowMenu x={menuAt.x} y={menuAt.y} items={actions} onClose={() => setMenuAt(null)} />,
                document.body,
            )}
        </div>
    );
};


// ─── The view ───────────────────────────────────────────────────────────────

/** Live (<md) viewport flag. Below the column's breakpoint the conversation
 *  list is an off-canvas drawer rather than a column, so the mode switch cannot
 *  live in its header — and a copy in each header would be two controls both
 *  claiming to be the navigation. Same shape as TradeView's `useIsBelowLg`;
 *  guarded for jsdom (no matchMedia → assume wide). */
const useIsBelowMd = (): boolean => {
    const [below, setBelow] = useState<boolean>(() => {
        try { return !window.matchMedia('(min-width: 768px)').matches; } catch { return false; }
    });
    useEffect(() => {
        let mql: MediaQueryList;
        try { mql = window.matchMedia('(min-width: 768px)'); } catch { return; }
        const onChange = (): void => setBelow(!mql.matches);
        onChange();
        mql.addEventListener('change', onChange);
        return () => { mql.removeEventListener('change', onChange); };
    }, []);
    return below;
};

interface BotRow {
    bot: AgentBot;
    preview: string;
    time: string | null;
    unread: number;
}

const AgentsView: React.FC<AgentsViewProps> = ({
    username, bots, groups, messages, selection, onSelect, onNewBot, onNewGroup,
    onSendBotTurn, onAnalyze, renderGroup, coachCount, workingBotId,
    lastOpenedMap = {}, modelPicker, modelFallback = null, destinationMenu, accountRow,
    railExpanded = true, onToggleRailExpanded, statusCluster, surfaceSwitch,
    attentionMap, botRoutines, onRunRoutine, onDeleteBot, onDeleteGroup, onEditGroup, onRetryPostMortem,
    botStats,
    providerReady = false,
    onRenameBot,
    onEditSeatOverrides,
    onOpenCoach,
    conversations = [], activeConversationId = null, onLoadConversation, onDeleteConversation, onClearConversation, onNewChat,
}) => {
    const [pins, setPins] = useState<string[]>(() => loadPins(username));
    const [query, setQuery] = useState('');
    // The field is revealed, not permanent. The reference's sidebar carries a
    // magnifier in the list's header rather than a bordered box that is on
    // screen even while nobody is searching — "lines, not boxes" — and a box
    // that is always there is the one thing that made this column read as a
    // form instead of a list.
    const [searchOpen, setSearchOpen] = useState(false);
    const [text, setText] = useState('');
    // There is no Chat/Analyze switch any more. What a send RUNS is decided by
    // what is selected in the rail: a bot answers in its own persona (its own
    // model, its own memory scope, fast and conversational); nothing selected
    // runs the full analysis pipeline — the market packet, the ensemble
    // debate, desk tools, memory injection, the verdict and its levels, which
    // is exactly what the Chart AI dock does. Both behaviours stay reachable;
    // the toggle was a second way to say something the selection already says.
    const [busy, setBusy] = useState(false);
    // ── The instrument this surface is talking about ──────────────────────
    // The CHAT SESSION is the shared binding: TradeView already stamps the
    // session on every symbol/interval change and adopts it back, so writing
    // here moves the chart, and writing there moves this surface. Choosing a
    // coin therefore genuinely changes the analysis, not just the label —
    // App passes the session's instrument into handleSendMessage as the
    // fallback when the prompt names no coin.
    const snap = useSyncExternalStore(chatStore.subscribe, chatStore.getSnapshot, chatStore.getSnapshot);
    const activeSession = snap.sessions.find(x => x.id === snap.activeId) ?? snap.sessions[0];
    const sessionSymbol = activeSession?.symbol ?? 'BTCUSDT';
    const sessionInterval = (activeSession?.interval ?? '15m') as ChartInterval;
    const symbols = useSymbolUniverse();
    const setSessionSymbol = useCallback((next: string): void => {
        chatStore.mutate(chatStore.getActiveId(), sess => ({ ...sess, symbol: next }));
    }, []);
    const setSessionInterval = useCallback((next: ChartInterval): void => {
        chatStore.mutate(chatStore.getActiveId(), sess => ({ ...sess, interval: next }));
    }, []);
    const [openRoutines, setOpenRoutines] = useState<string | null>(null);
    // Below md the rail is an overlay, not a column — at 320px a permanent
    // 42vw list left no readable transcript.
    const [railOpen, setRailOpen] = useState(false);
    const [sortByName, setSortByName] = useState(false);
    // WS-6: the composer attaches images through the SAME reader the Trade dock
    // uses (hooks/useChatAttachments was lifted out of TradeChatPanel for this).
    const { attachments, fileInputRef, attachFiles, remove: removeAttachment, clear: clearAttachments, openPicker, images: attachedImages } = useChatAttachments();
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const [renameDraft, setRenameDraft] = useState('');
    const scroller = useRef<HTMLDivElement | null>(null);
    // Jump-to-latest (the command palette's "Jump to latest analysis"
    // rehomed): the pill shows only when the trader has scrolled away from
    // the newest row, and one click returns.
    const [showJump, setShowJump] = useState(false);
    const onScrollerScroll = useCallback((): void => {
        const el = scroller.current;
        if (!el) return;
        setShowJump(el.scrollHeight - el.scrollTop - el.clientHeight > 240);
    }, []);
    const jumpToLatest = useCallback((): void => {
        const el = scroller.current;
        if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'auto' });
        setShowJump(false);
    }, []);
    const paneRef = useRef<HTMLElement | null>(null);
    const composerRef = useRef<HTMLTextAreaElement | null>(null);
    const searchRef = useRef<HTMLInputElement | null>(null);
    const [searchFocusNonce, setSearchFocusNonce] = useState(0);

    // `/` focuses the rail search. Nothing else claims it: the app-wide handler
    // that used to looked up #chat-composer, an id deleted in 78bc027.
    useEffect(() => {
        const onKey = (e: KeyboardEvent): void => {
            if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
            const t = e.target as HTMLElement | null;
            if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
            e.preventDefault();
            setRailOpen(true);
            // Focus lands in an effect, not here: below md the closed rail is
            // visibility:hidden, and a hidden subtree refuses focus. Both
            // flushSync and a rAF were measured in a real browser at 531px and
            // still ran before the commit — a bumped nonce guarantees a render
            // (even when railOpen was already true) and effects run after the
            // DOM is updated.
            setSearchFocusNonce(n => n + 1);
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, []);

    // `/` (and the palette) asks for the search field. It is revealed on demand
    // now, so the request has to open it as well as focus it — and focusing
    // happens in the effect below, because the input does not exist until the
    // state change that this one causes has rendered.
    useEffect(() => {
        if (searchFocusNonce) setSearchOpen(true);
    }, [searchFocusNonce]);

    const searching = searchOpen || query.trim().length > 0;
    useEffect(() => {
        if (searching) searchRef.current?.focus();
    }, [searching]);

    const statFor = useCallback((botId: string): BotLearningStat | undefined =>
        botStats?.find(s => s.id === botId), [botStats]);

    useEffect(() => {
        try { localStorage.setItem(PIN_KEY(username), JSON.stringify(pins)); } catch { /* private mode */ }
    }, [pins, username]);

    const togglePin = useCallback((id: string): void => {
        setPins(p => (p.includes(id) ? p.filter(x => x !== id) : [id, ...p].slice(0, 8)));
    }, []);

    const q = query.trim().toLowerCase();
    const matches = useCallback((name: string): boolean => !q || name.toLowerCase().includes(q), [q]);

    const botRowsRaw = useMemo<BotRow[]>(() => bots
        .filter(b => matches(b.name))
        .map(b => {
            const thread = threadForProvider(messages, b.providerId, b.modelId, b.id);
            const last = thread[thread.length - 1] ?? null;
            return {
                bot: b,
                preview: last ? previewTextFor(last) : '',
                time: last?.createdAt ?? null,
                unread: unreadCount(messages, b.providerId, lastOpenedMap[b.providerId], b.modelId, b.id),
            };
        })
        .sort((a, b) => (b.time ?? '').localeCompare(a.time ?? '')),
    [bots, messages, lastOpenedMap, matches]);
    // Shared-history previews: a message with no botId stamp is claimable by
    // every bot on that provider+model (the pre-stamp-history fallback), so
    // the SAME stale text used to render as several bots' previews — phantom
    // conversations. If one preview text appears on more than one row, it is
    // claimed by none of them (the threads still render; this is the LIST
    // preview only). Single-owner previews are untouched.
    const previewCounts = useMemo(() => {
        const counts = new Map<string, number>();
        for (const r of botRowsRaw) {
            if (!r.preview) continue;
            counts.set(r.preview, (counts.get(r.preview) ?? 0) + 1);
        }
        return counts;
    }, [botRowsRaw]);
    const botRows = useMemo<BotRow[]>(() => botRowsRaw
        .map(r => (r.preview && (previewCounts.get(r.preview) ?? 0) > 1 ? { ...r, preview: '' } : r)),
    [botRowsRaw, previewCounts]);

    const groupRows = useMemo(() => groups
        .filter(g => matches(groupDisplayName(g, bots))), [groups, bots, matches]);

    const pinnedIds = new Set(pins);
    const pinnedBots = botRows.filter(r => pinnedIds.has(r.bot.id));
    const otherBots = botRows.filter(r => !pinnedIds.has(r.bot.id));
    const pinnedGroups = groupRows.filter(g => pinnedIds.has(g.id));
    const unpinnedGroups = groupRows.filter(g => !pinnedIds.has(g.id));
    // Bots flagged by attentionMap cannot do their job (dead provider, missing
    // model, no key). At rest they collapsed under one disclosure — the amber
    // ⚠ stays on each row inside it, but no longer shouts from the resting list.
    const [showInactive, setShowInactive] = useState(false);
    const listedBots = sortByName
        ? [...otherBots].sort((a, b) => a.bot.name.localeCompare(b.bot.name)) : otherBots;
    const activeBots = listedBots.filter(r => !attentionMap?.[r.bot.id]);
    const inactiveBots = listedBots.filter(r => !!attentionMap?.[r.bot.id]);
    const listedGroups = sortByName
        ? [...unpinnedGroups].sort((a, b) => groupDisplayName(a, bots).localeCompare(groupDisplayName(b, bots)))
        : unpinnedGroups;
    const deskMessages = useMemo(() => deskThread(messages, bots), [messages, bots]);
    const lastChartMessage = deskMessages[deskMessages.length - 1];

    // App-side conversations, newest first, filtered by the same rail query.
    // The title is the first thing the trader said — the conversation has no
    // separate name field, and a preview IS its identity in every list that
    // shows one.
    const conversationRows = useMemo(() => {
        const rows = conversations.map(conv => {
            const firstUser = (conv.messages || []).find(m => m.role === MessageRole.USER && m.text.trim());
            const last = conv.messages?.[conv.messages.length - 1];
            const lastMs = last?.createdAt ? Date.parse(last.createdAt) : NaN;
            return {
                id: conv.id,
                title: firstUser ? firstUser.text : 'New conversation',
                atMs: Number.isFinite(lastMs) ? lastMs : (conv.timestamp || 0),
            };
        }).filter(r => matches(r.title))
            .sort((a, b) => b.atMs - a.atMs);
        return rows;
    }, [conversations, matches]);
    const [showAllConversations, setShowAllConversations] = useState(false);
    const visibleConversationRows = showAllConversations
        ? conversationRows
        : conversationRows.slice(0, 8);

    const activeBot = selection.kind === 'bot' ? bots.find(b => b.id === selection.botId) ?? null : null;
    const activeGroup = selection.kind === 'group' ? groups.find(g => g.id === selection.groupId) ?? null : null;
    const activeStat = activeBot ? statFor(activeBot.id) : undefined;
    // WS-3.1's scope contract, read off the bot rather than assumed.
    const botIsolated = !!activeBot && (activeBot.memoryScope ?? 'global') !== 'global';
    // The Chart AI pane IS the dock's conversation — the same array, not a
    // copy (WS-6's hard requirement). It used to be [], which made "opening it
    // here and on the Trade surface shows the same conversation" false: the
    // pane was a launcher wearing a transcript. The desk's own slice is
    // deskThread: ensemble/Analyze verdicts and session-model answers land
    // inline, while a bot's DM stays in that bot's row instead of leaking
    // into the desk pane.
    const isChartPane = selection.kind === 'team';
    const thread = useMemo(
        () => (activeBot ? threadForProvider(messages, activeBot.providerId, activeBot.modelId, activeBot.id)
            : isChartPane ? deskMessages : []),
        [activeBot, isChartPane, messages, deskMessages],
    );

    useEffect(() => {
        const el = scroller.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [thread.length]);

    const send = useCallback(async (): Promise<void> => {
        const prompt = text.trim();
        if (!prompt || busy) return;
        setText('');
        // The branch the toggle used to make explicit. A bot selected → the
        // bot's own transport; nothing selected → the full analysis pipeline.
        // A bot turn answers from text, so an attachment is only meaningful on
        // the analysis path and is dropped rather than silently ignored.
        if (!activeBot) {
            const images = attachedImages();
            clearAttachments();
            // The same session the Chart AI dock renders, written by the same
            // helper — so a question asked here shows up there, with its answer,
            // instead of running an entire analysis into a void.
            await runAnalysisAsChatTurn({
                sid: chatStore.getActiveId(),
                text: prompt,
                image: images[0]?.dataURL,
                run: () => onAnalyze(prompt, images),
            });
            return;
        }
        clearAttachments();
        setBusy(true);
        try { await onSendBotTurn(activeBot, prompt); } finally { setBusy(false); }
    }, [text, busy, onAnalyze, activeBot, onSendBotTurn, attachedImages, clearAttachments]);

    /** The ⋯/right-click list for a room: pin plus the two roster handlers App
     *  hands in. Pinned rooms gain edit/delete here that the hover icons never
     *  showed them. */
    const groupActions = (g: AgentGroup): RowMenuItem[] => [
        { label: pinnedIds.has(g.id) ? 'Unpin' : 'Pin', onSelect: () => togglePin(g.id) },
        ...(onEditGroup ? [{ label: 'Edit room', onSelect: () => onEditGroup(g.id) }] : []),
        ...(onDeleteGroup ? [{ label: 'Delete room', onSelect: () => onDeleteGroup(g.id), danger: true }] : []),
    ];

    /** A bot row with everything the standalone roster rail used to own:
     *  pin, the ⚠ fix hint, the routines disclosure, rename, delete. */
    const renderBotRow = (r: BotRow): React.ReactNode => {
        const routines = botRoutines?.[r.bot.id] ?? [];
        const open = openRoutines === r.bot.id;
        return (
            <Row key={r.bot.id}
                active={selection.kind === 'bot' && selection.botId === r.bot.id}
                title={r.bot.name} preview={r.preview} time={relTime(r.time)} unread={r.unread}
                working={workingBotId === r.bot.id} pinned={pins.includes(r.bot.id)}
                attention={attentionMap?.[r.bot.id]}
                stat={statFor(r.bot.id)?.skillsAuthored}
                Icon={Bot}
                avatar={<BotAvatar bot={r.bot} size={20} working={workingBotId === r.bot.id} />}
                onPin={() => togglePin(r.bot.id)}
                onClick={() => selectThread({ kind: 'bot', botId: r.bot.id })}
                actions={[
                    { label: pins.includes(r.bot.id) ? 'Unpin' : 'Pin', onSelect: () => togglePin(r.bot.id) },
                    ...(onRenameBot ? [{
                        label: 'Rename',
                        onSelect: () => { setRenamingId(r.bot.id); setRenameDraft(r.bot.name); },
                    }] : []),
                    ...(onEditSeatOverrides ? [{
                        label: 'Debate overrides',
                        onSelect: () => onEditSeatOverrides(r.bot),
                    }] : []),
                    ...(routines.length > 0 ? [{
                        label: `Routines (${routines.length})`,
                        onSelect: () => setOpenRoutines(open ? null : r.bot.id),
                    }] : []),
                    ...(onDeleteBot ? [{
                        label: 'Delete bot', onSelect: () => onDeleteBot(r.bot.id), danger: true,
                    }] : []),
                ]}
                manage={(onRenameBot || onDeleteBot) && (
                    <>
                        {onRenameBot && (
                            <button type="button" aria-label={`Rename ${r.bot.name}`} data-testid="rail-rename"
                                onClick={() => { setRenamingId(r.bot.id); setRenameDraft(r.bot.name); }}
                                className="hit-target rounded-control p-0.5 text-zinc-600 transition-colors hover:text-zinc-300">
                                <Pencil className="h-3 w-3" aria-hidden="true" />
                            </button>
                        )}
                        {onDeleteBot && (
                            <button type="button" aria-label={`Delete ${r.bot.name}`}
                                onClick={() => onDeleteBot(r.bot.id)}
                                className="hit-target rounded-control p-0.5 text-zinc-600 transition-colors hover:text-rose-300">
                                <Trash2 className="h-3 w-3" aria-hidden="true" />
                            </button>
                        )}
                    </>
                )}
                routinesToggle={routines.length > 0 ? (
                    <button type="button" onClick={() => setOpenRoutines(open ? null : r.bot.id)}
                        aria-expanded={open} data-testid="row-routines"
                        className="flex items-center gap-1 rounded-full border border-zinc-800 px-1.5 py-0.5 text-ui-2xs text-zinc-500 transition-colors hover:text-zinc-300">
                        <Timer className="h-3 w-3" aria-hidden="true" />{routines.length}
                        <ChevronDown className={`h-2.5 w-2.5 transition-transform ${open ? 'rotate-180' : ''}`} />
                    </button>
                ) : undefined}>
                {renamingId === r.bot.id && onRenameBot && (
                    <form className="flex items-center gap-1 px-2 pb-1.5 pl-9"
                        onSubmit={e => {
                            e.preventDefault();
                            const next = renameDraft.trim();
                            if (next) onRenameBot(r.bot.id, next);
                            setRenamingId(null);
                        }}>
                        <input value={renameDraft} onChange={e => setRenameDraft(e.target.value)}
                            aria-label={`Rename ${r.bot.name}`} data-testid="bot-rename-input" autoFocus
                            className="min-w-0 flex-1 rounded-control border border-zinc-700 bg-zinc-950 px-1.5 py-0.5 text-ui-dense text-zinc-200 outline-none focus:border-zinc-600" />
                        <button type="submit"
                            className="shrink-0 rounded-control border border-zinc-700 px-1.5 py-0.5 text-ui-xs text-zinc-300 hover:bg-zinc-800">
                            Save
                        </button>
                    </form>
                )}
                {open && (
                    <ul className="space-y-1 px-2 pb-2 pl-9">
                        {routines.map(cfg => (
                            <li key={cfg.id} className="flex items-baseline gap-2">
                                <span className="min-w-0 flex-1 truncate text-ui-xs text-zinc-400" title={`${cfg.name} · ${cfg.schedule?.cron ?? '—'}`}>
                                    {cfg.name}
                                    <span className="ml-1 font-mono text-ui-2xs text-zinc-600">
                                        {cfg.schedule?.cron ?? '—'}
                                    </span>
                                </span>
                                {onRunRoutine && (
                                    <button type="button" onClick={() => onRunRoutine(cfg)}
                                        className="shrink-0 rounded-control border border-zinc-800 px-1.5 py-0.5 text-ui-2xs text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200">
                                        Run
                                    </button>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </Row>
        );
    };

    const placeholder = activeBot
        ? `Message @${activeBot.name}…`
        : activeGroup ? 'Message the room…' : 'How can I help you today?';

    // Under the composer, and truncated there, so it is also the title there.
    const contextNote = activeBot
        ? `@${activeBot.name} answers here`
        : 'No agent selected — the full analysis runs';

    // The + New menu: one creator, four honest verbs. The old chip row made
    // "Agents" and "Rooms" look like navigation when both only opened create
    // dialogs — and "+ New" was the same NewBotDialog a third time.
    const [newMenuAt, setNewMenuAt] = useState<{ x: number; y: number } | null>(null);
    const [convMenuAt, setConvMenuAt] = useState<{ id: string; x: number; y: number } | null>(null);
    const newMenuItems: RowMenuItem[] = [
        ...(onNewChat ? [{ label: 'New chat', onSelect: () => {
            onNewChat();
            // Two things the creator itself cannot do. The pane has to FOLLOW
            // the conversation that was just made — left where it was, a bot's
            // thread stayed on screen under a "New chat" header and the press
            // read as a no-op. And the blank-reuse path, where "New" correctly
            // hands back the unused blank session rather than minting another
            // empty one, has to land the caret somewhere, or nothing at all
            // appears to happen.
            selectThread({ kind: 'team' });
            composerRef.current?.focus();
        } }] : []),
        { label: 'New agent', onSelect: () => onNewBot() },
        { label: 'New room', onSelect: () => onNewGroup() },
        ...(onOpenCoach ? [{ label: coachCount > 0 ? `Coach inbox (${coachCount})` : 'Coach inbox', onSelect: () => onOpenCoach() }] : []),
    ];

    // One switch, one home. The open column's header is its reference position —
    // the same x the rail-less surfaces use — so the hop does not move it.
    const belowMd = useIsBelowMd();
    const switchInRail = railExpanded && !belowMd;

    const selectThread = useCallback((t: ThreadSelection): void => {
        onSelect(t);
        setRailOpen(false); // on mobile the drawer was the point of the tap
        if (t.kind === 'bot') {
            const b = bots.find(x => x.id === t.botId);
            if (b) markThreadOpened(lastOpenedMap, b.providerId);
        }
    }, [onSelect, bots, lastOpenedMap]);

    return (
        <div className="flex h-full min-h-0" data-testid="agents-view">
            {/* ── Rail — a column at md+, an overlay drawer below ── */}
            {railOpen && (
                <button type="button" aria-label="Close conversations"
                    onClick={() => setRailOpen(false)}
                    className="fixed inset-0 z-30 bg-black/60 md:hidden" data-testid="rail-backdrop" />
            )}
            {/* Deliberately NOT transitioning `visibility`: interpolating it
                delays the hidden state by the transition duration, which both
                leaves a closed drawer tabbable for 150ms and makes the flip
                unmeasurable. The slide-in still animates (visible instantly,
                transform after); the slide-out is not seen. */}
            <aside
                /* One width for both sides of the hop: `w-72` stays the mobile
                   drawer, and md+ takes the shell's own constant through a
                   custom property, because an inline style would otherwise win
                   at every breakpoint and flatten the drawer too. */
                style={{ '--rail-w': `${NAV_RAIL_EXPANDED_PX}px` } as React.CSSProperties}
                className={`fixed inset-y-0 left-0 z-40 flex w-72 shrink-0 transform flex-col border-r border-zinc-800/80 bg-zinc-900 transition-transform duration-[150ms] ease-[var(--ease-snappy)] ${
                    railOpen ? 'translate-x-0' : 'invisible -translate-x-full md:visible'
                } md:static md:z-auto md:h-full md:min-h-0 md:w-[var(--rail-w)] md:translate-x-0 ${
                    railExpanded ? '' : 'md:hidden'
                }`}
                data-testid="agents-rail">
                {/* The column's own header row, and the reference's: the mode
                    switch owns its LEFT edge, at the same x the rail-less
                    surfaces put it, so hopping Chat ⇄ Trade changes the content
                    and not the position of the control that changed it. The
                    put-away toggle keeps the right edge — the SAME toggle the
                    rail renders, so the two columns cannot disagree about
                    whether one is open. */}
                {(switchInRail || onToggleRailExpanded) && (
                    <div className="flex shrink-0 items-center justify-between gap-2 px-2 pb-1 pt-2.5">
                        {switchInRail ? surfaceSwitch : <span aria-hidden />}
                        {onToggleRailExpanded && (
                            <button type="button" onClick={onToggleRailExpanded} data-testid="rail-collapse"
                                aria-label="Collapse conversations" title="Collapse the conversation rail"
                                className="hidden shrink-0 rounded-control p-1.5 text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-200 md:block">
                                <PanelLeftClose className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                        )}
                    </div>
                )}

                <div className="flex shrink-0 items-center px-2 pb-1 pt-0.5">
                    {/* A row, not a pill. The reference's "New" is the first
                        entry in the same borderless list as its destinations,
                        and it is the shape `SurfaceMenuList` already paints — so
                        this copies those classes rather than inventing a fourth
                        control shape for the sidebar. The menu it opens is
                        unchanged; only the box around it went. */}
                    <button type="button" data-testid="rail-new" aria-haspopup="menu" aria-expanded={!!newMenuAt}
                        onPointerDown={e => e.stopPropagation()}
                        onClick={e => {
                            const r = e.currentTarget.getBoundingClientRect();
                            setNewMenuAt(m => m ? null : { x: r.left, y: r.bottom + 4 });
                        }}
                        className="group flex w-full items-center gap-2.5 rounded-control px-2.5 py-2 text-left text-ui-caption text-zinc-400 transition-colors duration-[120ms] ease-[var(--ease-snappy)] hover:bg-white/[0.06] hover:text-zinc-100">
                        <Plus className="h-4 w-4 shrink-0 text-zinc-500" aria-hidden="true" />
                        <span className="flex-1 truncate" title="New">New</span>
                        <ChevronDown className={`h-3 w-3 shrink-0 text-zinc-600 transition-transform ${newMenuAt ? 'rotate-180' : ''}`} aria-hidden="true" />
                    </button>
                    {newMenuAt && createPortal(
                        <RowMenu x={newMenuAt.x} y={newMenuAt.y} items={newMenuItems} onClose={() => setNewMenuAt(null)} />,
                        document.body,
                    )}
                </div>

                {/* Customize, last in the nav group exactly as the reference
                    orders New / Projects / Artifacts / Customize — and the only
                    row left here now that the destinations live in the title
                    bar. Above `New` it read as an orphan against the top edge. */}
                {destinationMenu && (
                    <div className="shrink-0 border-b border-zinc-800/80 pb-1.5" data-testid="sidebar-destinations">
                        {destinationMenu}
                    </div>
                )}

                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-2 pb-3 custom-scrollbar">
                    <section data-testid="rail-pinned">
                        <h4 className="px-1 pb-1 text-ui-sm font-semibold uppercase tracking-widest text-zinc-500">Pinned</h4>
                        {/* WS-6: the desk's own conversation is a first-class row,
                            not only the pane you fall back into. */}
                        <Row active={isChartPane} title="Chart AI" testId="chart-ai-row"
                            preview={lastChartMessage ? previewTextFor(lastChartMessage) : 'Ask the desk — it runs the full analysis'}
                            time={relTime(lastChartMessage?.createdAt ?? null)} Icon={MessageSquare}
                            onClick={() => selectThread({ kind: 'team' })} />
                        {pinnedBots.map(renderBotRow)}
                        {pinnedGroups.map(g => (
                            <Row key={g.id} active={selection.kind === 'group' && selection.groupId === g.id}
                                title={groupDisplayName(g, bots)} preview={`${g.memberIds.length} seats`} Icon={Users}
                                pinned onPin={() => togglePin(g.id)}
                                actions={groupActions(g)}
                                onClick={() => selectThread({ kind: 'group', groupId: g.id })} />
                        ))}
                    </section>

                    <section>
                        <div className="flex items-center gap-1 px-1 pb-1">
                            <h4 className="text-ui-sm font-semibold uppercase tracking-widest text-zinc-500">
                                Bots
                            </h4>
                            {/* The magnifier is the field's handle, exactly where
                                the reference puts it — in the list's header, not
                                as a box permanently above it. */}
                            <button type="button" data-testid="rail-search-toggle"
                                onClick={() => setSearchOpen(v => !v)}
                                aria-expanded={searching}
                                aria-controls="rail-search-field"
                                aria-label="Search conversations"
                                title={searching ? 'Hide the search field' : 'Search conversations (/)'}
                                className={`ml-auto rounded-control p-1.5 transition-colors hover:text-zinc-200 ${
                                    searching ? 'text-zinc-200' : 'text-zinc-600'}`}>
                                <Search className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                            {(activeBots.length > 1 || listedGroups.length > 1) && (
                                <button type="button" data-testid="rail-sort"
                                    onClick={() => setSortByName(v => !v)}
                                    title={sortByName ? 'Sorted by name — click for most recent' : 'Sorted by most recent — click for name'}
                                    aria-label="Sort conversations"
                                    className="rounded-control p-0.5 text-zinc-600 transition-colors hover:text-zinc-300">
                                    <ArrowUpDown className="h-3 w-3" aria-hidden="true" />
                                </button>
                            )}
                            {/* The list's own creator, as the reference's BOTS
                                header carries one. Same handler the `New` menu's
                                "New agent" verb calls — a second entry point, not
                                a second behaviour. */}
                            <button type="button" onClick={onNewBot} data-testid="rail-new-bot"
                                aria-label="New agent" title="New agent"
                                className="rounded-control p-1.5 text-zinc-600 transition-colors hover:text-zinc-200">
                                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                        </div>
                        {searching && (
                            <div id="rail-search-field" className="relative mb-1.5 px-1">
                                <input ref={searchRef} value={query}
                                    onChange={e => setQuery(e.target.value)}
                                    onKeyDown={e => {
                                        if (e.key !== 'Escape') return;
                                        // Hide ≠ close only applies to surfaces;
                                        // an empty field has nothing to keep.
                                        if (query) setQuery('');
                                        else setSearchOpen(false);
                                    }}
                                    placeholder="Search conversations..."
                                    aria-label="Search conversations" data-testid="rail-search"
                                    className="w-full rounded-control border border-zinc-800/80 bg-zinc-950/70 py-1.5 pl-3 pr-7 text-ui-dense text-zinc-200 outline-none placeholder:text-zinc-500 transition-colors focus:border-zinc-700 focus:bg-zinc-950" />
                                {!query && (
                                    <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded-control border border-zinc-800/80 bg-zinc-900/80 px-1 py-0.5 font-mono text-ui-xs leading-none text-zinc-500">
                                        /
                                    </kbd>
                                )}
                            </div>
                        )}
                        {listedBots.length === 0 && (
                            <p className="px-1 py-3 text-ui-dense leading-5 text-zinc-600">
                                No agents yet. Create one and it appears here with its own thread.
                            </p>
                        )}
                        {activeBots.map(renderBotRow)}
                        {inactiveBots.length > 0 && (
                            <>
                                <button type="button" data-testid="rail-inactive-toggle"
                                    onClick={() => setShowInactive(v => !v)}
                                    aria-expanded={showInactive}
                                    className="mt-1 flex w-full items-center gap-1 px-1 py-1 text-ui-dense text-zinc-600 transition-colors hover:text-zinc-400">
                                    <ChevronDown className={`h-3 w-3 transition-transform ${showInactive ? '' : '-rotate-90'}`} />
                                    {inactiveBots.length} inactive agent{inactiveBots.length === 1 ? '' : 's'}
                                </button>
                                {showInactive && inactiveBots.map(renderBotRow)}
                            </>
                        )}
                        </section>

                        {/* Rooms get their own header for the same reason the
                            reference's sidebar splits its lists: a bot row and a
                            room row look identical apart from the icon, so the
                            section name is what tells them apart. */}
                        {listedGroups.length > 0 && (
                        <section data-testid="rail-rooms">
                            <div className="flex items-center gap-1 px-1 pb-1">
                                <h4 className="text-ui-sm font-semibold uppercase tracking-widest text-zinc-500">
                                    Rooms
                                </h4>
                                <button type="button" onClick={onNewGroup} data-testid="rail-new-room"
                                    aria-label="New room" title="New room"
                                    className="ml-auto rounded-control p-1.5 text-zinc-600 transition-colors hover:text-zinc-200">
                                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                                </button>
                            </div>
                            {listedGroups.map(g => (
                            <Row key={g.id} active={selection.kind === 'group' && selection.groupId === g.id}
                                title={groupDisplayName(g, bots)} preview={`${g.memberIds.length} seats`} Icon={Users}
                                pinned={pinnedIds.has(g.id)} onPin={() => togglePin(g.id)}
                                actions={groupActions(g)}
                                onClick={() => selectThread({ kind: 'group', groupId: g.id })}
                                manage={(onEditGroup || onDeleteGroup) && (
                                    <>
                                        {onEditGroup && (
                                            <button type="button" aria-label={`Edit ${groupDisplayName(g, bots)}`}
                                                onClick={() => onEditGroup(g.id)} data-testid="rail-edit-group"
                                                className="hit-target rounded-control p-0.5 text-zinc-600 transition-colors hover:text-zinc-300">
                                                <Pencil className="h-3 w-3" aria-hidden="true" />
                                            </button>
                                        )}
                                        {onDeleteGroup && (
                                            <button type="button" aria-label={`Delete ${groupDisplayName(g, bots)}`}
                                                onClick={() => onDeleteGroup(g.id)} data-testid="rail-delete-group"
                                                className="hit-target rounded-control p-0.5 text-zinc-600 transition-colors hover:text-rose-300">
                                                <Trash2 className="h-3 w-3" aria-hidden="true" />
                                            </button>
                                        )}
                                    </>
                                )} />
                            ))}
                        </section>
                        )}

                    {onLoadConversation && (
                        <section data-testid="rail-conversations">
                            <h4 className="px-1 pb-1 text-ui-sm font-semibold uppercase tracking-widest text-zinc-500">
                                Conversations
                            </h4>
                            {visibleConversationRows.length === 0 ? (
                                <p className="px-1 py-3 text-ui-dense leading-5 text-zinc-600">
                                    No conversations yet. Everything you ask the desk lands here.
                                </p>
                            ) : (
                                visibleConversationRows.map(r => {
                                    const active = r.id === activeConversationId;
                                    return (
                                        <div key={r.id}
                                            className={`group relative rounded-control ${active ? 'bg-zinc-800/70' : 'hover:bg-zinc-800/30'}`}>
                                            <button type="button" data-testid="conversation-row"
                                                onClick={() => onLoadConversation(r.id)}
                                                className="flex w-full items-start gap-2 px-2 py-1.5 text-left">
                                                <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                                                    active ? 'border-zinc-600 text-zinc-200' : 'border-zinc-800 text-zinc-500'
                                                }`}>
                                                    <MessageSquare className="h-3 w-3" aria-hidden="true" />
                                                </span>
                                                <span className="min-w-0 flex-1">
                                                    <span className="block truncate text-ui-sm font-semibold text-zinc-200" title={r.title}>{r.title}</span>
                                                </span>
                                                <span className="shrink-0 pt-0.5 font-mono text-ui-2xs text-zinc-600">
                                                    {relTimeMs(r.atMs)}
                                                </span>
                                            </button>
                                            {(onDeleteConversation || onClearConversation) && !active && (
                                                <button type="button" data-testid="conversation-menu"
                                                    aria-label="Conversation options"
                                                    onPointerDown={e => e.stopPropagation()}
                                                    onClick={e => {
                                                        e.stopPropagation();
                                                        const rect = e.currentTarget.getBoundingClientRect();
                                                        setConvMenuAt(m => m?.id === r.id ? null : { id: r.id, x: rect.right - MENU_W, y: rect.bottom + 4 });
                                                    }}
                                                    className="absolute right-1.5 top-1.5 rounded-control p-0.5 text-zinc-600 opacity-0 transition-opacity hover:text-zinc-300 focus-visible:opacity-100 group-hover:opacity-100">
                                                    <Ellipsis className="h-3 w-3" aria-hidden="true" />
                                                </button>
                                            )}
                                        </div>
                                    );
                                })
                            )}
                            {conversationRows.length > 8 && (
                                <button type="button" data-testid="conversations-show-more"
                                    onClick={() => setShowAllConversations(v => !v)}
                                    className="w-full px-1 py-1.5 text-left text-ui-dense text-zinc-600 transition-colors hover:text-zinc-300">
                                    {showAllConversations ? 'Show less' : `Show all (${conversationRows.length})`}
                                </button>
                            )}
                        </section>
                    )}
                    {convMenuAt && createPortal(
                        <RowMenu
                            x={convMenuAt.x}
                            y={convMenuAt.y}
                            items={[
                                ...(onClearConversation ? [{ label: 'Clear messages', onSelect: () => onClearConversation(convMenuAt.id) }] : []),
                                ...(onDeleteConversation ? [{ label: 'Delete conversation', onSelect: () => onDeleteConversation(convMenuAt.id), danger: true }] : []),
                            ]}
                            onClose={() => setConvMenuAt(null)}
                        />,
                        document.body,
                    )}
                </div>

                {/* Identity, when this column IS the sidebar. It used to live only
                    in the nav rail, and putting it in both places at once is what
                    made two account rows share one screen — so it arrives as a
                    node from App, which knows whether the rail is mounted. */}
                {accountRow}
                {/* What the pane actually owns is the live signal — is a provider
                    ready for the desk — so that is all its own row says, in the
                    pattern the references' status bars use: a dot and five words
                    on one hairline. */}
                <div className="flex shrink-0 items-center gap-1.5 border-t border-zinc-800/80 px-3 py-2">
                    <span data-testid="desk-status" title={providerReady ? 'A provider is configured — the desk can think' : 'No provider ready — configure one in Settings'}
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${providerReady ? 'bg-emerald-500' : 'bg-zinc-600'}`} />
                    <span className="min-w-0 flex-1 truncate text-ui-dense text-zinc-500" title={providerReady ? 'Ready' : 'No provider'}>{providerReady ? 'Ready' : 'No provider'}</span>
                </div>
            </aside>

            {/* ── Main pane ── */}
            <section ref={paneRef} className="flex min-w-0 flex-1 flex-col bg-surface-page">
                {/* The instrument bar. The timeframe row is the SAME component the
                    chart renders, over the same persisted selection, so a
                    choice here is the choice there rather than a second
                    preference that drifts. */}
                {activeGroup && renderGroup ? (
                    <div className="flex min-h-0 flex-1 flex-col">{renderGroup(activeGroup)}</div>
                ) : (
                    <>
                        {/* The chat header: the conversation's name and the
                            switch, on one hairline row — the reference's shape.
                            The instrument and timeframe used to sit here too,
                            which stacked a second toolbar's worth of chrome
                            above an empty thread; they are context for the next
                            message, so they live in the composer now. */}
                        <div
                            data-testid="chat-header"
                            className="flex shrink-0 items-center gap-3 border-b border-white/[0.06] px-4 py-2"
                        >
                            {/* The shell's collapsed-rail button, rendered from
                                the SAME state the column hides under. This
                                surface has no global band now, so without it a
                                put-away rail could only be restored by Alt+1..5. */}
                            {!railExpanded && onToggleRailExpanded && (
                                /* md+ only. Below md this surface already has its
                                   own drawer opener (`rail-open`), and `railExpanded`
                                   reads false at narrow widths by design — so
                                   rendering the shell's column-expand button here
                                   gave a phone two controls that both claim to
                                   open the sidebar and do different things. */
                                <span className="hidden md:flex">
                                    <NavExpandButton onExpand={onToggleRailExpanded} />
                                </span>
                            )}
                            {/* One switch, one home: the open column hosts it at
                                its left edge; when the column is put away (or is
                                an off-canvas drawer on a phone) it moves here so
                                it is never missing, never doubled. */}
                            {!switchInRail && surfaceSwitch}
                                                        <div className="flex min-w-0 flex-1 items-center gap-2">
                                <button type="button" onClick={() => setRailOpen(true)}
                                    aria-label="Open conversations" data-testid="rail-open"
                                    className="shrink-0 rounded-control border border-zinc-800 p-1 text-zinc-500 transition-colors hover:text-zinc-200 md:hidden">
                                    <Users className="h-3.5 w-3.5" aria-hidden="true" />
                                </button>
                                {/* No in-column expand here: the header's
                                    "Expand navigation" is the shell's one
                                    control, and it now reaches this column too.
                                    A second one made the same action live in
                                    two places with two different states. */}
                                <span className="min-w-0 truncate text-ui-sm font-semibold text-zinc-200" title={activeBot
                                        ? `@${activeBot.name}`
                                        /* The desk pane IS the active chat session —
                                            loaded App conversations included — so the
                                            title names the session, not a brand. The
                                            dock row above keeps the "Chart AI" name. */
                                        : (activeSession?.title?.trim() || 'Desk')}>
                                    {activeBot
                                        ? `@${activeBot.name}`
                                        /* The desk pane IS the active chat session —
                                            loaded App conversations included — so the
                                            title names the session, not a brand. The
                                            dock row above keeps the "Chart AI" name. */
                                        : (activeSession?.title?.trim() || 'Desk')}
                                </span>
                                {activeBot && (
                                    <StatusPill
                                        tone={botIsolated ? 'neutral' : 'info'}
                                        kicker
                                        data-testid="bot-notebook-sync"
                                        title={botIsolated
                                            ? 'Isolated: thinks from its own notes. The shared notebook never reaches it and nothing it learns surfaces for others.'
                                            : `Reads the shared notebook every turn and folds its closed trades back in.${activeStat?.lastLessonAt ? ` Last lesson ${activeStat.lastLessonAt}.` : ' No lesson written yet.'}`}
                                        icon={<span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />}
                                    >
                                        {botIsolated ? 'own notes' : 'notebook'}
                                    </StatusPill>
                                )}
                                {activeStat && (
                                    <span className="hidden shrink-0 font-mono text-ui-xs tabular-nums text-zinc-600 xl:inline"
                                        data-testid="bot-learning-stats"
                                        title={activeStat.lastLessonAt ? `newest lesson ${activeStat.lastLessonAt}` : 'no dated lessons'}>
                                        {activeStat.lessons} lessons · {activeStat.skillsAuthored} skills · {activeStat.evidence} evidence
                                    </span>
                                )}
                            </div>
                            {statusCluster}
                        </div>
                        {/* The thread IS this surface. The charted form of the
                            desk is a different screen, reached from the pill
                            above — not a copy of this one with the chart
                            removed, which is what used to render here and made
                            the two states impossible to tell apart. */}
                        <div data-testid="agents-thread-column"
                            className={`flex min-h-0 flex-1 flex-col ${thread.length === 0 ? 'justify-center' : ''}`}>
                        <div className={`${thread.length === 0 ? 'shrink-0' : 'relative min-h-0 flex-1'}`}>
                        {/* `h-full` is load-bearing, not decoration: an
                            overflow-y-auto box with auto height grows to its
                            content and can never scroll. Losing it while adding
                            the horizontal pad made the whole thread unscrollable. */}
                        <div ref={scroller} onScroll={onScrollerScroll} className="h-full overflow-y-auto custom-scrollbar px-4">
                            {thread.length === 0 ? (
                                <div className="flex flex-col items-center justify-center px-6 py-2 text-center">
                                    <Bot className="mb-3 h-8 w-8 text-zinc-500" aria-hidden="true" />
                                    <h2 className="font-serif text-3xl font-normal tracking-tight text-zinc-100">{greeting(username || 'trader')}</h2>
                                    <p className="mt-2 max-w-md text-ui-sm leading-relaxed text-zinc-500">
                                        {activeBot
                                            ? botIsolated
                                                ? `@${activeBot.name} thinks from its own notes only — it is isolated from the shared notebook.`
                                                : `@${activeBot.name} reads its own notes and the shared notebook on every turn.`
                                            : 'Pick an agent on the left and it answers in its own voice — or ask the desk and the full analysis runs.'}
                                    </p>
                                </div>
                            ) : (
                                <div className="chat-column space-y-4 py-6" data-testid="agent-thread">
                                    {thread.map(m => {
                                        const isUser = m.role === MessageRole.USER;
                                        const row = chatRowFrom(m, username, activeBot?.name ?? 'desk');
                                        return (
                                            <ChatTranscriptRow
                                                key={m.id}
                                                row={row}
                                                onRetry={onRetryPostMortem ? () => onRetryPostMortem(m.id) : undefined}
                                            >
                                                {/* The decision card is fed from the ROW MODEL, never from the
                                                    raw message: a "Logged from Chart AI" receipt carries a copy
                                                    of the plan's analysis for the journal row and the autopilot,
                                                    and reading it here drew the identical ENTRY/STOP/TARGET/
                                                    PROBABILITY card a second time in the same turn.
                                                    `chatRowFrom` is the one place that decides. */}
                                                {!isUser && <InlineVerdict analysis={row.analysis}
                                                    evidencePack={m.evidencePack} runContract={m.runContract} />}
                                            </ChatTranscriptRow>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                        {showJump && (
                            <button type="button" data-testid="jump-to-latest" onClick={jumpToLatest}
                                className="absolute bottom-3 right-4 z-10 flex items-center gap-1 rounded-full border border-white/10 bg-zinc-800/95 px-3 py-1 text-ui-dense font-medium text-zinc-200 shadow-lg transition-colors hover:bg-zinc-700">
                                ↓ Latest
                            </button>
                        )}
                        </div>

                        {/* ── Composer pill ── */}
                        <div className="shrink-0 px-4 pb-4">
                            {!activeBot && modelFallback && (
                                <ModelFallbackBanner modelIssue={modelFallback.issue} provider={modelFallback.provider} />
                            )}
                            <div data-testid="chat-composer" className="chat-column rounded-bubble border border-white/[0.08] bg-zinc-900/90 shadow-xl backdrop-blur-md p-2.5 transition-colors focus-within:border-zinc-500">
                                <input type="file" multiple accept="image/*" className="hidden"
                                    ref={fileInputRef} data-testid="composer-file"
                                    onChange={e => { attachFiles(e.target.files); e.target.value = ''; }} />
                                {attachments.length > 0 && (
                                    <div className="mb-1.5 flex flex-wrap gap-1" data-testid="composer-attachments">
                                        {attachments.map(a => (
                                            <span key={a.id}
                                                className="flex items-center gap-1 rounded-control border border-zinc-800 bg-zinc-950 py-0.5 pl-1.5 pr-1 text-ui-xs text-zinc-300">
                                                {a.kind === 'image' && (
                                                    <img src={a.payload} alt="" className="h-5 w-5 rounded-control object-cover" />
                                                )}
                                                <span className="max-w-[9rem] truncate" title={a.name}>{a.name}</span>
                                                <button type="button" aria-label={`Remove ${a.name}`}
                                                    onClick={() => removeAttachment(a.id)}
                                                    className="text-zinc-500 transition-colors hover:text-rose-400">×</button>
                                            </span>
                                        ))}
                                    </div>
                                )}
                                <textarea ref={composerRef} value={text}
                                    onChange={e => setText(e.target.value)}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); }
                                    }}
                                    rows={2} placeholder={placeholder} aria-label="Message"
                                    className="w-full resize-none bg-transparent py-1 text-ui-caption leading-relaxed text-zinc-100 outline-none placeholder:text-zinc-500" />
                                <div className="mt-1 flex items-center gap-2">
                                    <button type="button" onClick={openPicker} data-testid="composer-attach"
                                        aria-label="Attach image"
                                        title={activeBot
                                            ? 'Agent replies are text-only — attachments run with the full analysis (no agent selected)'
                                            : 'Attach an image'}
                                        disabled={!!activeBot}
                                        className="rounded-control border border-zinc-800/80 p-1 text-zinc-400 transition-colors hover:bg-white/[0.05] hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-zinc-400">
                                        <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />
                                    </button>
                                    {/* The instrument this chat is about, moved out
                                        of the header: it is context for the next
                                        message, which is exactly where the
                                        reference puts context. */}
                                    <SymbolPicker
                                        symbols={symbols}
                                        value={sessionSymbol}
                                        onChange={setSessionSymbol}
                                    />
                                    <div className="hidden sm:flex items-center">
                                        <TimeframeBar
                                            interval={sessionInterval}
                                            onIntervalChange={setSessionInterval}
                                            compact
                                            className="border-b-0 px-0 py-0"
                                        />
                                    </div>
                                    <button type="button" onClick={() => void send()} disabled={!text.trim() || busy}
                                        aria-label="Send" data-testid="composer-send"
                                        className="ml-auto flex h-7 w-7 items-center justify-center rounded-full bg-zinc-100 text-zinc-900 transition-opacity hover:opacity-90 disabled:opacity-30">
                                        <ArrowUp className="h-4 w-4" aria-hidden="true" />
                                    </button>
                                </div>
                            </div>
                            {/* Reference footer, two rows: the context note
                                and the model chip share the first (chip owns
                                the bottom-right), the disclaimer gets its own
                                line below — August's disclaimer is longer than
                                Claude's and three items on one row collide.
                                `px-2.5` matches the card's own `p-2.5`: the
                                card and the measure are both 880px and centered,
                                so the footer text sits on the same left edge as
                                the typed text above it rather than 7px inside. */}
                            <div className="mx-auto mt-2 flex w-full max-w-[55rem] items-center justify-between gap-3 px-2.5 text-ui-xs text-zinc-600">
                                <span className="min-w-0 truncate" title={contextNote}>{contextNote}</span>
                                {modelPicker}
                            </div>
                            <div className="mx-auto mt-1 w-full max-w-[55rem] px-2.5 text-ui-xs text-zinc-600">
                                <span className="hidden sm:inline">{DISCLAIMER_SHORT}</span>
                            </div>
                        </div>
                        </div>
                    </>
                )}
            </section>
        </div>
    );
};

export default React.memo(AgentsView);
