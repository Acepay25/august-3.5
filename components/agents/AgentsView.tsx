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
import { ArrowUp, ArrowUpDown, Bot, ChevronDown, Ellipsis, MessageSquare, Pencil, PanelLeftClose, PanelLeftOpen, Paperclip, Pin, Plus, Search, Timer, Trash2, Users } from '../shared/Icons';
import { ModelFallbackBanner } from '../trade/panels/ChatComposer';
import type { ProviderConfig } from '../../types/provider';
import { useChatAttachments, type PipelineImage } from '../../hooks/useChatAttachments';
import { runAnalysisAsChatTurn, type AnalysisTurnOutcome } from '../../services/trade/analysisTurn';
import { DISCLAIMER_SHORT } from '../../constants/disclaimer';
import { useSurfaceEnter, type SurfaceEnterDirection } from '../../hooks/useSurfaceEnter';
import * as chatStore from '../../services/trade/chatStore';
import ChatTranscriptRow, { type ChatRowView } from '../shared/ChatTranscriptRow';
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
import VerdictAudit from '../analysis/VerdictAudit';
import { fmtPercent } from '../../utils/formatters';
import { fmtRiskReward } from '../../utils/riskReward';

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
    /** Focus this same thread in the Chart AI dock — the two surfaces show
     *  one conversation, and this is how you hop between them. */
    onOpenInDock?: () => void;
    /** Which edge this surface arrived from, for the Chat ⇄ Chart AI hop. */
    surfaceEnterFrom?: SurfaceEnterDirection;
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

const relTime = (iso: string | null | undefined): string => {
    if (!iso) return '';
    const ms = Date.now() - Date.parse(iso);
    if (!Number.isFinite(ms) || ms < 0) return '';
    return relTimeMs(ms);
};

const relTimeMs = (ms: number): string => {
    if (!ms) return '';
    const m = Math.round((Date.now() - ms) / 60000);
    if (m < 1) return 'now';
    if (m < 60) return `${m}m`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h}h`;
    return `${Math.round(h / 24)}d`;
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
        analysis: m.analysis,
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
    onClick: () => void;
}> = ({ active, title, preview, time, unread, working, pinned, attention, onPin, manage, actions, stat, testId = 'agent-row', routinesToggle, children, Icon, onClick }) => {
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
                    <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                        working ? 'border-amber-500/40 text-amber-300' : active ? 'border-zinc-600 text-zinc-200' : 'border-zinc-800 text-zinc-500'
                    }`}>
                        <Icon className="h-3 w-3" />
                    </span>
                    <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1">
                            <span className="truncate text-ui-sm font-semibold text-zinc-200">{title}</span>
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
                        <span className="block truncate text-ui-dense text-zinc-500">{preview || 'No messages yet'}</span>
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
                        {onPin && (
                            <button type="button" onClick={onPin} aria-label={pinned ? `Unpin ${title}` : `Pin ${title}`}
                                className={`hit-target rounded p-0.5 transition-opacity ${
                                    pinned ? 'text-zinc-400 opacity-100' : 'text-zinc-600 opacity-0 group-hover:opacity-100'
                                }`}>
                                <Pin className="h-3 w-3" />
                            </button>
                        )}
                        <span className="opacity-0 transition-opacity group-hover:opacity-100">{manage}</span>
                        {hasActions && (
                            <button type="button" aria-label={`${title} options`} data-testid="row-menu"
                                onPointerDown={e => e.stopPropagation()}
                                onClick={e => {
                                    const r = e.currentTarget.getBoundingClientRect();
                                    setMenuAt(m => m ? null : { x: r.right - MENU_W, y: r.bottom + 4 });
                                }}
                                className="hit-target rounded p-0.5 text-zinc-600 opacity-0 transition-opacity hover:text-zinc-300 focus-visible:opacity-100 group-hover:opacity-100">
                                <Ellipsis className="h-3 w-3" />
                            </button>
                        )}
                    </span>
                    {routinesToggle}
                </span>
            </div>
            {children}
            {menuAt && actions && actions.length > 0 && createPortal(
                <RowMenu x={menuAt.x} y={menuAt.y} items={actions} onClose={() => setMenuAt(null)} />,
                document.body,
            )}
        </div>
    );
};

// ─── Verdict card, inline ───────────────────────────────────────────────────

const VerdictLine: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
    <div className="flex items-baseline justify-between gap-3">
        <span className="font-mono text-ui-xs uppercase tracking-wider text-zinc-500">{label}</span>
        <span className="font-mono text-ui-dense font-medium tabular-nums text-zinc-100">{value}</span>
    </div>
);

const InlineVerdict: React.FC<{ m: Message }> = ({ m }) => {
    const a = m.analysis;
    if (!a) return null;
    const up = a.direction === 'Long';
    const down = a.direction === 'Short';
    return (
        <div className="mt-2.5 w-full max-w-lg border-t border-zinc-800/80 pt-2.5"
            data-testid="inline-verdict">
            <div className="mb-2 flex items-center gap-2">
                <StatusPill tone={up ? 'up' : down ? 'down' : 'neutral'} kicker>
                    {a.direction ?? 'No trade'}
                </StatusPill>
                <span className="truncate text-ui-caption font-semibold text-zinc-100">{a.coinName ?? 'setup'}</span>
                {a.rrRatio && (
                    <span className="rounded-control border border-white/[0.04] bg-white/[0.04] px-1.5 py-0.5 font-mono text-ui-xs font-medium text-zinc-300">
                        {fmtRiskReward(a.rrRatio, 1)} R:R
                    </span>
                )}
                {a.confidence && <span className="ml-auto font-mono text-ui-xs uppercase tracking-wider text-zinc-500">{a.confidence}</span>}
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-control border border-white/[0.04] bg-white/[0.02] p-2.5">
                <VerdictLine label="entry" value={a.entryPoints?.[0]?.price ?? '—'} />
                <VerdictLine label="stop" value={a.stopLoss ?? '—'} />
                <VerdictLine label="target" value={a.takeProfit?.[0]?.price ?? '—'} />
                {typeof a.probability === 'number' && <VerdictLine label="probability" value={fmtPercent(a.probability, 0)} />}
            </div>
            {/* Progressive disclosure for the forensic audit */}
            <details className="group/audit mt-2" open>
                <summary className="flex cursor-pointer select-none items-center gap-1.5 py-1 font-mono text-ui-2xs uppercase tracking-wider text-zinc-500 transition-colors hover:text-zinc-300 list-none">
                    <ChevronDown className="h-3 w-3 transition-transform group-open/audit:rotate-180" />
                    <span>Inspect debate audit & evidence</span>
                </summary>
                <div className="mt-1.5 border-t border-zinc-800/60 pt-1.5">
                    <VerdictAudit
                        analysis={a}
                        evidencePack={m.evidencePack}
                        runContract={m.runContract}
                        className="mt-1"
                    />
                </div>
            </details>
        </div>
    );
};

// ─── The view ───────────────────────────────────────────────────────────────

interface BotRow {
    bot: AgentBot;
    preview: string;
    time: string | null;
    unread: number;
}

const AgentsView: React.FC<AgentsViewProps> = ({
    username, bots, groups, messages, selection, onSelect, onNewBot, onNewGroup,
    onSendBotTurn, onAnalyze, renderGroup, coachCount, workingBotId,
    lastOpenedMap = {}, modelPicker, modelFallback = null, onOpenInDock, surfaceEnterFrom = null,
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
    // At md+ the rail is a column you can put away to give the thread the
    // width — persisted per profile, like the pins.
    const [collapsed, setCollapsed] = useState<boolean>(() => {
        try { return localStorage.getItem(`agents_rail_collapsed_v1_${username}`) === '1'; } catch { return false; }
    });
    useEffect(() => {
        try { localStorage.setItem(`agents_rail_collapsed_v1_${username}`, collapsed ? '1' : '0'); } catch { /* private mode */ }
    }, [collapsed, username]);
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
    // The ONLY animation on this pane for the Chart AI hop: one right-pinned
    // translateX keyframe that mirrors the hamburger. The WAAPI morph that
    // used to run alongside it is gone — two animations on one element fought,
    // and the scale half read as a pop up instead of a slide.
    // App owns the flag so re-navigating animates again.
    const surfaceEnterClass = useSurfaceEnter(surfaceEnterFrom);
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

    useEffect(() => {
        if (searchFocusNonce) searchRef.current?.focus();
    }, [searchFocusNonce]);

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
                                className="hit-target rounded p-0.5 text-zinc-600 transition-colors hover:text-zinc-300">
                                <Pencil className="h-3 w-3" />
                            </button>
                        )}
                        {onDeleteBot && (
                            <button type="button" aria-label={`Delete ${r.bot.name}`}
                                onClick={() => onDeleteBot(r.bot.id)}
                                className="hit-target rounded p-0.5 text-zinc-600 transition-colors hover:text-rose-300">
                                <Trash2 className="h-3 w-3" />
                            </button>
                        )}
                    </>
                )}
                routinesToggle={routines.length > 0 ? (
                    <button type="button" onClick={() => setOpenRoutines(open ? null : r.bot.id)}
                        aria-expanded={open} data-testid="row-routines"
                        className="flex items-center gap-1 rounded-full border border-zinc-800 px-1.5 py-0.5 text-ui-2xs text-zinc-500 transition-colors hover:text-zinc-300">
                        <Timer className="h-3 w-3" />{routines.length}
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
                                <span className="min-w-0 flex-1 truncate text-ui-xs text-zinc-400" title={cfg.name}>
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

    // The + New menu: one creator, four honest verbs. The old chip row made
    // "Agents" and "Rooms" look like navigation when both only opened create
    // dialogs — and "+ New" was the same NewBotDialog a third time.
    const [newMenuAt, setNewMenuAt] = useState<{ x: number; y: number } | null>(null);
    const [convMenuAt, setConvMenuAt] = useState<{ id: string; x: number; y: number } | null>(null);
    const newMenuItems: RowMenuItem[] = [
        ...(onNewChat ? [{ label: 'New chat', onSelect: () => onNewChat() }] : []),
        { label: 'New agent', onSelect: () => onNewBot() },
        { label: 'New room', onSelect: () => onNewGroup() },
        ...(onOpenCoach ? [{ label: coachCount > 0 ? `Coach inbox (${coachCount})` : 'Coach inbox', onSelect: () => onOpenCoach() }] : []),
    ];

    const selectThread = useCallback((t: ThreadSelection): void => {
        onSelect(t);
        setRailOpen(false); // on mobile the drawer was the point of the tap
        if (t.kind === 'bot') {
            const b = bots.find(x => x.id === t.botId);
            if (b) markThreadOpened(lastOpenedMap, b.providerId);
        }
    }, [onSelect, bots, lastOpenedMap]);

    return (
        <div className={`flex h-full min-h-0 ${surfaceEnterClass}`} data-testid="agents-view">
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
            <aside className={`fixed inset-y-0 left-0 z-40 flex w-72 shrink-0 transform flex-col border-r border-zinc-800/80 bg-zinc-900 transition-transform duration-[150ms] ease-[var(--ease-snappy)] ${
                railOpen ? 'translate-x-0' : 'invisible -translate-x-full md:visible'
            } md:static md:z-auto md:h-full md:min-h-0 md:w-[min(20rem,42vw)] md:translate-x-0 ${
                collapsed ? 'md:hidden' : ''
            }`}
                data-testid="agents-rail">
                <div className="flex shrink-0 items-center gap-1.5 p-2 pb-1.5">
                    <div className="relative min-w-0 flex-1">
                        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
                        <input ref={searchRef} value={query} onChange={e => setQuery(e.target.value)} placeholder="Search conversations..."
                            aria-label="Search conversations" data-testid="rail-search"
                            className="w-full rounded-control border border-zinc-800/80 bg-zinc-950/70 py-1.5 pl-8 pr-7 text-ui-dense text-zinc-200 outline-none placeholder:text-zinc-500 transition-colors focus:border-zinc-700 focus:bg-zinc-950" />
                        {!query && (
                            <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-zinc-800/80 bg-zinc-900/80 px-1 py-0.5 font-mono text-ui-xs leading-none text-zinc-500">
                                /
                            </kbd>
                        )}
                    </div>
                    <button type="button" onClick={() => setCollapsed(true)} data-testid="rail-collapse"
                        aria-label="Collapse conversations" title="Collapse the conversation rail"
                        className="hidden shrink-0 rounded-control border border-zinc-800/80 p-1.5 text-zinc-500 transition-colors hover:border-zinc-700 hover:text-zinc-200 md:block">
                        <PanelLeftClose className="h-3.5 w-3.5" />
                    </button>
                </div>

                <div className="flex shrink-0 items-center px-2 pb-2 pt-0.5">
                    <button type="button" data-testid="rail-new" aria-haspopup="menu" aria-expanded={!!newMenuAt}
                        onPointerDown={e => e.stopPropagation()}
                        onClick={e => {
                            const r = e.currentTarget.getBoundingClientRect();
                            setNewMenuAt(m => m ? null : { x: r.left, y: r.bottom + 4 });
                        }}
                        className="flex items-center gap-1 hit-target rounded-full border border-zinc-700/80 bg-zinc-800/60 px-2 py-0.5 text-ui-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-700 hover:text-white">
                        <Plus className="h-3 w-3" /> New
                        <ChevronDown className={`h-2.5 w-2.5 transition-transform ${newMenuAt ? 'rotate-180' : ''}`} />
                    </button>
                    {newMenuAt && createPortal(
                        <RowMenu x={newMenuAt.x} y={newMenuAt.y} items={newMenuItems} onClose={() => setNewMenuAt(null)} />,
                        document.body,
                    )}
                </div>

                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-2 pb-3 custom-scrollbar">
                    <section data-testid="rail-pinned">
                        <h4 className="px-1 pb-1 text-ui-xs font-bold uppercase tracking-wider text-zinc-600">Pinned</h4>
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
                            <h4 className="text-ui-xs font-bold uppercase tracking-wider text-zinc-600">
                                Chats and tasks
                            </h4>
                            {(activeBots.length > 1 || listedGroups.length > 1) && (
                                <button type="button" data-testid="rail-sort"
                                    onClick={() => setSortByName(v => !v)}
                                    title={sortByName ? 'Sorted by name — click for most recent' : 'Sorted by most recent — click for name'}
                                    aria-label="Sort conversations"
                                    className="ml-auto rounded p-0.5 text-zinc-600 transition-colors hover:text-zinc-300">
                                    <ArrowUpDown className="h-3 w-3" />
                                </button>
                            )}
                        </div>
                        {listedBots.length === 0 && listedGroups.length === 0 && (
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
                                                className="hit-target rounded p-0.5 text-zinc-600 transition-colors hover:text-zinc-300">
                                                <Pencil className="h-3 w-3" />
                                            </button>
                                        )}
                                        {onDeleteGroup && (
                                            <button type="button" aria-label={`Delete ${groupDisplayName(g, bots)}`}
                                                onClick={() => onDeleteGroup(g.id)} data-testid="rail-delete-group"
                                                className="hit-target rounded p-0.5 text-zinc-600 transition-colors hover:text-rose-300">
                                                <Trash2 className="h-3 w-3" />
                                            </button>
                                        )}
                                    </>
                                )} />
                        ))}
                    </section>

                    {onLoadConversation && (
                        <section data-testid="rail-conversations">
                            <h4 className="px-1 pb-1 text-ui-xs font-bold uppercase tracking-wider text-zinc-600">
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
                                                    <MessageSquare className="h-3 w-3" />
                                                </span>
                                                <span className="min-w-0 flex-1">
                                                    <span className="block truncate text-ui-sm font-semibold text-zinc-200">{r.title}</span>
                                                </span>
                                                <span className="shrink-0 pt-0.5 font-mono text-ui-2xs text-zinc-600">
                                                    {relTimeMs(r.atMs)}
                                                </span>
                                            </button>
                                            {(onDeleteConversation || onClearConversation) && !active && (
                                                <button type="button" data-testid="conversation-menu"
                                                    aria-label={`Conversation options: ${r.title.slice(0, 40)}`}
                                                    onPointerDown={e => e.stopPropagation()}
                                                    onClick={e => {
                                                        e.stopPropagation();
                                                        const rect = e.currentTarget.getBoundingClientRect();
                                                        setConvMenuAt(m => m?.id === r.id ? null : { id: r.id, x: rect.right - MENU_W, y: rect.bottom + 4 });
                                                    }}
                                                    className="absolute right-1.5 top-1.5 rounded p-0.5 text-zinc-600 opacity-0 transition-opacity hover:text-zinc-300 focus-visible:opacity-100 group-hover:opacity-100">
                                                    <Ellipsis className="h-3 w-3" />
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

                {/* Identity is the NAV RAIL's row (nav-account: name, initial,
                    Settings). This row repeated it a second time on the same
                    screen. What the pane actually owns is the live signal —
                    is a provider ready for the desk — so that is all it says
                    now, in the pattern the references' status bars use: a dot
                    and five words on one hairline. */}
                <div className="flex shrink-0 items-center gap-1.5 border-t border-zinc-800/80 px-3 py-2">
                    <span data-testid="desk-status" title={providerReady ? 'A provider is configured — the desk can think' : 'No provider ready — configure one in Settings'}
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${providerReady ? 'bg-emerald-500' : 'bg-zinc-600'}`} />
                    <span className="min-w-0 flex-1 truncate text-ui-dense text-zinc-500">{providerReady ? 'Ready' : 'No provider'}</span>
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
                        {/* Unified Top Header Strip: Hermes & Claude Desktop minimalism.
                            Single hairline bar containing identity, instrument picker, timeframe,
                            and dock hop without stacked toolbars. */}
                        <div
                            data-testid="chat-instrument-bar"
                            className="flex shrink-0 items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-2"
                        >
                            <div className="flex min-w-0 items-center gap-2">
                                <button type="button" onClick={() => setRailOpen(true)}
                                    aria-label="Open conversations" data-testid="rail-open"
                                    className="shrink-0 rounded-control border border-zinc-800 p-1 text-zinc-500 transition-colors hover:text-zinc-200 md:hidden">
                                    <Users className="h-3.5 w-3.5" />
                                </button>
                                {collapsed && (
                                    <button type="button" onClick={() => setCollapsed(false)} data-testid="rail-expand"
                                        aria-label="Show conversations" title="Show the conversation rail"
                                        className="hidden shrink-0 rounded-control border border-zinc-800 p-1 text-zinc-500 transition-colors hover:text-zinc-200 md:block">
                                        <PanelLeftOpen className="h-3.5 w-3.5" />
                                    </button>
                                )}
                                <span className="min-w-0 truncate text-ui-sm font-semibold text-zinc-200">
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

                            <div className="flex shrink-0 items-center gap-2">
                                <SymbolPicker
                                    symbols={symbols}
                                    value={sessionSymbol}
                                    onChange={setSessionSymbol}
                                />
                                <div className="hidden sm:flex items-center">
                                    <TimeframeBar
                                        interval={sessionInterval}
                                        onIntervalChange={setSessionInterval}
                                        className="border-b-0 px-0 py-0"
                                    />
                                </div>
                                {onOpenInDock && (
                                    <button type="button" onClick={onOpenInDock} data-testid="open-in-dock"
                                        className="shrink-0 rounded-control border border-zinc-800 px-2 py-1 text-ui-xs text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200">
                                        Open in Chart AI
                                    </button>
                                )}
                            </div>
                        </div>
                        <div className="relative min-h-0 flex-1">
                        <div ref={scroller} onScroll={onScrollerScroll} className="h-full overflow-y-auto custom-scrollbar">
                            {thread.length === 0 ? (
                                <div className="chat-hero-grid flex h-full flex-col items-center justify-center px-6 text-center">
                                    <Bot className="mb-3 h-8 w-8 text-zinc-500" />
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
                                        return (
                                            <ChatTranscriptRow
                                                key={m.id}
                                                row={chatRowFrom(m, username, activeBot?.name ?? 'desk')}
                                                onRetry={onRetryPostMortem ? () => onRetryPostMortem(m.id) : undefined}
                                            >
                                                {!isUser && <InlineVerdict m={m} />}
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
                            <div className="chat-column rounded-2xl border border-white/[0.08] bg-zinc-900/90 shadow-xl backdrop-blur-md p-2.5 transition-colors focus-within:border-zinc-500">
                                <input type="file" multiple accept="image/*" className="hidden"
                                    ref={fileInputRef} data-testid="composer-file"
                                    onChange={e => { attachFiles(e.target.files); e.target.value = ''; }} />
                                {attachments.length > 0 && (
                                    <div className="mb-1.5 flex flex-wrap gap-1 px-1.5" data-testid="composer-attachments">
                                        {attachments.map(a => (
                                            <span key={a.id}
                                                className="flex items-center gap-1 rounded-control border border-zinc-800 bg-zinc-950 py-0.5 pl-1.5 pr-1 text-ui-xs text-zinc-300">
                                                {a.kind === 'image' && (
                                                    <img src={a.payload} alt="" className="h-5 w-5 rounded object-cover" />
                                                )}
                                                <span className="max-w-[9rem] truncate">{a.name}</span>
                                                <button type="button" aria-label={`Remove ${a.name}`}
                                                    onClick={() => removeAttachment(a.id)}
                                                    className="text-zinc-500 transition-colors hover:text-rose-400">×</button>
                                            </span>
                                        ))}
                                    </div>
                                )}
                                <textarea value={text}
                                    onChange={e => setText(e.target.value)}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); }
                                    }}
                                    rows={2} placeholder={placeholder} aria-label="Message"
                                    className="w-full resize-none bg-transparent px-2 py-1 text-ui-caption leading-relaxed text-zinc-100 outline-none placeholder:text-zinc-500" />
                                <div className="mt-1 flex items-center gap-2 px-1">
                                    <button type="button" onClick={openPicker} data-testid="composer-attach"
                                        aria-label="Attach image"
                                        title={activeBot
                                            ? 'Agent replies are text-only — attachments run with the full analysis (no agent selected)'
                                            : 'Attach an image'}
                                        disabled={!!activeBot}
                                        className="rounded-control border border-zinc-800/80 p-1 text-zinc-400 transition-colors hover:bg-white/[0.05] hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-zinc-400">
                                        <Paperclip className="h-3.5 w-3.5" />
                                    </button>
                                    {modelPicker}
                                    <button type="button" onClick={() => void send()} disabled={!text.trim() || busy}
                                        aria-label="Send" data-testid="composer-send"
                                        className="ml-auto flex h-7 w-7 items-center justify-center rounded-full bg-zinc-100 text-zinc-900 transition-opacity hover:opacity-90 disabled:opacity-30">
                                        <ArrowUp className="h-4 w-4" />
                                    </button>
                                </div>
                            </div>
                            <div className="mx-auto mt-2 flex max-w-3xl items-center justify-between px-2 text-ui-2xs text-zinc-600">
                                <span>{activeBot ? `@${activeBot.name} answers here` : 'No agent selected — the full analysis runs'}</span>
                                <span className="hidden sm:inline">{DISCLAIMER_SHORT}</span>
                            </div>
                        </div>
                    </>
                )}
            </section>
        </div>
    );
};

export default React.memo(AgentsView);
