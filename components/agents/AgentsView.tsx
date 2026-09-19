/**
 * AgentsView — the Agents surface as a chat, not a roster that bounces you
 * somewhere else (WS-6).
 *
 * Three regions, mirroring the reference: a conversation rail, a main pane,
 * and one pill composer. What it does NOT do is fork anything:
 *
 *  - the rows are built from the SAME `messages` array the Chart AI dock reads
 *    (`utils/agentThreads` is the single thread model), so a conversation
 *    opened here and on the Trade surface is one conversation, not two copies;
 *  - Chat mode sends through `runUserBotTurn`, the same bot transport the DM
 *    mailbox uses;
 *  - Analyze mode hands the text to `handleSendMessage` — the real pipeline,
 *    so the ensemble debate, desk tools and memory run exactly as they do from
 *    the dock, and the verdict that comes back is an ordinary message in the
 *    same array, which is why it renders inline here without a second
 *    renderer.
 *
 * Rooms delegate to App's existing GroupChatView element rather than
 * reimplementing the round runner.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, Bot, ChevronDown, Pencil, Pin, Plus, Search, Sparkles, Timer, Trash2, Users } from 'lucide-react';
import type { AgentBot, AgentGroup } from '../../services/agents/agentRoster';
import { groupDisplayName } from '../../services/agents/agentRoster';
import type { AutomationConfig } from '../../types/automation';
import {
    markThreadOpened, previewTextFor, threadForProvider, unreadCount,
    type AgentThreadOpenedMap, type ThreadSelection,
} from '../../utils/agentThreads';
import { MessageRole } from '../../types/enums';
import type { Message } from '../../types/message';
import StatusPill from '../ui/StatusPill';

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
    /** Analyze mode: the real Chart AI pipeline (App's handleSendMessage). */
    onAnalyze: (prompt: string) => void;
    /** App renders the existing room view; this surface only hosts it. */
    renderGroup?: (group: AgentGroup) => React.ReactNode;
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
    /** Current provider/model chip in the composer. */
    modelLabel?: string;
    onOpenModels?: () => void;
    /** Focus this same thread in the Chart AI dock — the two surfaces show
     *  one conversation, and this is how you hop between them. */
    onOpenInDock?: () => void;
    onHydratePins?: (pins: string[]) => void;
}

const PIN_KEY = (user: string): string => `agent_pins_v1_${user}`;

const loadPins = (user: string): string[] => {
    try { return JSON.parse(localStorage.getItem(PIN_KEY(user)) || '[]') as string[]; } catch { return []; }
};

const relTime = (iso: string | null | undefined): string => {
    if (!iso) return '';
    const ms = Date.now() - Date.parse(iso);
    if (!Number.isFinite(ms) || ms < 0) return '';
    const m = Math.round(ms / 60000);
    if (m < 1) return 'now';
    if (m < 60) return `${m}m`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h}h`;
    return `${Math.round(h / 24)}d`;
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
    /** Routines disclosure trigger, rendered when the bot has schedules. */
    routinesToggle?: React.ReactNode;
    children?: React.ReactNode;
    Icon: React.FC<{ className?: string }>;
    onClick: () => void;
}> = ({ active, title, preview, time, unread, working, pinned, attention, onPin, manage, routinesToggle, children, Icon, onClick }) => (
    <div className={`group relative ${active ? 'bg-zinc-800/70' : 'hover:bg-zinc-800/30'} rounded-control`}>
        <div className="flex items-start gap-2 px-2 py-1.5">
            <button type="button" onClick={onClick} data-testid="agent-row" className="flex min-w-0 flex-1 items-start gap-2 text-left">
                <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                    working ? 'border-amber-500/40 text-amber-300' : active ? 'border-zinc-600 text-zinc-200' : 'border-zinc-800 text-zinc-500'
                }`}>
                    <Icon className="h-3 w-3" />
                </span>
                <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1">
                        <span className="truncate text-[12px] font-semibold text-zinc-200">{title}</span>
                        {attention && (
                            <span title={attention} data-testid="row-attention"
                                className="shrink-0 text-[9px] font-bold text-amber-400">⚠</span>
                        )}
                    </span>
                    <span className="block truncate text-[11px] text-zinc-500">{preview || 'No messages yet'}</span>
                </span>
            </button>
            <span className="flex shrink-0 flex-col items-end gap-1 pt-0.5">
                <span className="flex items-center gap-1">
                    {time && <span className="font-mono text-[9px] text-zinc-600">{time}</span>}
                    {!!unread && (
                        <span className="rounded-full bg-zinc-700 px-1.5 font-mono text-[9px] tabular-nums text-zinc-200">
                            {unread > 9 ? '9+' : unread}
                        </span>
                    )}
                    {onPin && (
                        <button type="button" onClick={onPin} aria-label={pinned ? `Unpin ${title}` : `Pin ${title}`}
                            className={`rounded p-0.5 transition-opacity ${
                                pinned ? 'text-zinc-400 opacity-100' : 'text-zinc-600 opacity-0 group-hover:opacity-100'
                            }`}>
                            <Pin className="h-3 w-3" />
                        </button>
                    )}
                    <span className="opacity-0 transition-opacity group-hover:opacity-100">{manage}</span>
                </span>
                {routinesToggle}
            </span>
        </div>
        {children}
    </div>
);

// ─── Verdict card, inline ───────────────────────────────────────────────────

const VerdictLine: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
    <div className="flex items-baseline justify-between gap-3">
        <span className="text-[10px] uppercase tracking-wider text-zinc-600">{label}</span>
        <span className="font-mono text-[11px] tabular-nums text-zinc-200">{value}</span>
    </div>
);

const InlineVerdict: React.FC<{ m: Message }> = ({ m }) => {
    const a = m.analysis;
    if (!a) return null;
    const up = a.direction === 'Long';
    const down = a.direction === 'Short';
    return (
        <div className="mt-1.5 w-full max-w-sm rounded-bubble border border-zinc-800/80 bg-zinc-900 p-2.5"
            data-testid="inline-verdict">
            <div className="mb-1.5 flex items-center gap-2">
                <StatusPill tone={up ? 'up' : down ? 'down' : 'neutral'} kicker>
                    {a.direction ?? 'No trade'}
                </StatusPill>
                <span className="truncate text-[12px] font-semibold text-zinc-100">{a.coinName ?? 'setup'}</span>
                {a.confidence && <span className="ml-auto font-mono text-[10px] text-zinc-500">{a.confidence}</span>}
            </div>
            <VerdictLine label="entry" value={a.entryPoints?.[0]?.price ?? '—'} />
            <VerdictLine label="stop" value={a.stopLoss ?? '—'} />
            <VerdictLine label="target" value={a.takeProfit?.[0]?.price ?? '—'} />
            {typeof a.probability === 'number' && <VerdictLine label="probability" value={`${a.probability}%`} />}
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
    lastOpenedMap = {}, modelLabel, onOpenModels, onOpenInDock,
    attentionMap, botRoutines, onRunRoutine, onDeleteBot, onDeleteGroup, onEditGroup,
}) => {
    const [pins, setPins] = useState<string[]>(() => loadPins(username));
    const [query, setQuery] = useState('');
    const [text, setText] = useState('');
    const [mode, setMode] = useState<'chat' | 'analyze'>('chat');
    const [busy, setBusy] = useState(false);
    const [openRoutines, setOpenRoutines] = useState<string | null>(null);
    const scroller = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        try { localStorage.setItem(PIN_KEY(username), JSON.stringify(pins)); } catch { /* private mode */ }
    }, [pins, username]);

    const togglePin = useCallback((id: string): void => {
        setPins(p => (p.includes(id) ? p.filter(x => x !== id) : [id, ...p].slice(0, 8)));
    }, []);

    const q = query.trim().toLowerCase();
    const matches = useCallback((name: string): boolean => !q || name.toLowerCase().includes(q), [q]);

    const botRows = useMemo<BotRow[]>(() => bots
        .filter(b => matches(b.name))
        .map(b => {
            const thread = threadForProvider(messages, b.providerId, b.modelId);
            const last = thread[thread.length - 1] ?? null;
            return {
                bot: b,
                preview: last ? previewTextFor(last) : '',
                time: last?.createdAt ?? null,
                unread: unreadCount(messages, b.providerId, lastOpenedMap[b.providerId], b.modelId),
            };
        })
        .sort((a, b) => (b.time ?? '').localeCompare(a.time ?? '')),
    [bots, messages, lastOpenedMap, matches]);

    const groupRows = useMemo(() => groups
        .filter(g => matches(groupDisplayName(g, bots))), [groups, bots, matches]);

    const pinnedBots = botRows.filter(r => pins.includes(r.bot.id));
    const otherBots = botRows.filter(r => !pins.includes(r.bot.id));

    const activeBot = selection.kind === 'bot' ? bots.find(b => b.id === selection.botId) ?? null : null;
    const activeGroup = selection.kind === 'group' ? groups.find(g => g.id === selection.groupId) ?? null : null;
    const thread = useMemo(
        () => (activeBot ? threadForProvider(messages, activeBot.providerId, activeBot.modelId) : []),
        [activeBot, messages],
    );

    useEffect(() => {
        const el = scroller.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [thread.length]);

    const send = useCallback(async (): Promise<void> => {
        const prompt = text.trim();
        if (!prompt || busy) return;
        setText('');
        if (mode === 'analyze') { onAnalyze(prompt); return; }
        if (!activeBot) { onAnalyze(prompt); return; }
        setBusy(true);
        try { await onSendBotTurn(activeBot, prompt); } finally { setBusy(false); }
    }, [text, busy, mode, onAnalyze, activeBot, onSendBotTurn]);

    /** A bot row with everything the standalone roster rail used to own:
     *  pin, the ⚠ fix hint, the routines disclosure, delete. */
    const renderBotRow = (r: BotRow): React.ReactNode => {
        const routines = botRoutines?.[r.bot.id] ?? [];
        const open = openRoutines === r.bot.id;
        return (
            <Row key={r.bot.id}
                active={selection.kind === 'bot' && selection.botId === r.bot.id}
                title={r.bot.name} preview={r.preview} time={relTime(r.time)} unread={r.unread}
                working={workingBotId === r.bot.id} pinned={pins.includes(r.bot.id)}
                attention={attentionMap?.[r.bot.id]} Icon={Bot}
                onPin={() => togglePin(r.bot.id)}
                onClick={() => selectThread({ kind: 'bot', botId: r.bot.id })}
                manage={onDeleteBot && (
                    <button type="button" aria-label={`Delete ${r.bot.name}`}
                        onClick={() => onDeleteBot(r.bot.id)}
                        className="rounded p-0.5 text-zinc-600 transition-colors hover:text-rose-300">
                        <Trash2 className="h-3 w-3" />
                    </button>
                )}
                routinesToggle={routines.length > 0 ? (
                    <button type="button" onClick={() => setOpenRoutines(open ? null : r.bot.id)}
                        aria-expanded={open} data-testid="row-routines"
                        className="flex items-center gap-1 rounded-full border border-zinc-800 px-1.5 py-0.5 text-[9px] text-zinc-500 transition-colors hover:text-zinc-300">
                        <Timer className="h-2.5 w-2.5" />{routines.length}
                        <ChevronDown className={`h-2.5 w-2.5 transition-transform ${open ? 'rotate-180' : ''}`} />
                    </button>
                ) : undefined}>
                {open && (
                    <ul className="space-y-1 px-2 pb-2 pl-9">
                        {routines.map(cfg => (
                            <li key={cfg.id} className="flex items-baseline gap-2">
                                <span className="min-w-0 flex-1 truncate text-[10px] text-zinc-400" title={cfg.name}>
                                    {cfg.name}
                                    <span className="ml-1 font-mono text-[9px] text-zinc-600">
                                        {cfg.schedule?.cron ?? '—'}
                                    </span>
                                </span>
                                {onRunRoutine && (
                                    <button type="button" onClick={() => onRunRoutine(cfg)}
                                        className="shrink-0 rounded-control border border-zinc-800 px-1.5 py-0.5 text-[9px] text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200">
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

    const selectThread = useCallback((t: ThreadSelection): void => {
        onSelect(t);
        if (t.kind === 'bot') {
            const b = bots.find(x => x.id === t.botId);
            if (b) markThreadOpened(lastOpenedMap, b.providerId);
        }
    }, [onSelect, bots, lastOpenedMap]);

    return (
        <div className="flex h-full min-h-0" data-testid="agents-view">
            {/* ── Rail ── */}
            <aside className="flex w-[min(20rem,42vw)] shrink-0 flex-col border-r border-zinc-800/80 bg-zinc-900"
                data-testid="agents-rail">
                <div className="flex shrink-0 items-center gap-1.5 p-2">
                    <button type="button" onClick={onNewBot} data-testid="rail-new"
                        className="flex items-center gap-1 rounded-control border border-zinc-700 px-2 py-1 text-[11px] font-semibold text-zinc-200 transition-colors hover:bg-zinc-800">
                        <Plus className="h-3 w-3" /> New
                    </button>
                    <div className="relative ml-auto min-w-0 flex-1">
                        <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-600" />
                        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search"
                            aria-label="Search conversations" data-testid="rail-search"
                            className="w-full rounded-control border border-zinc-800 bg-zinc-950 py-1 pl-7 pr-2 text-[11px] text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-zinc-600" />
                    </div>
                </div>

                <div className="flex shrink-0 gap-1 px-2 pb-2">
                    <button type="button" onClick={onNewBot}
                        className="flex items-center gap-1 rounded-full border border-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400 transition-colors hover:text-zinc-200">
                        <Bot className="h-3 w-3" /> Agents
                    </button>
                    <button type="button" onClick={onNewGroup}
                        className="flex items-center gap-1 rounded-full border border-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400 transition-colors hover:text-zinc-200">
                        <Users className="h-3 w-3" /> Rooms
                    </button>
                    <button type="button" onClick={() => selectThread({ kind: 'coach' })}
                        aria-label="Coach — awaiting your decision"
                        className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] transition-colors ${
                            coachCount > 0 ? 'border-amber-500/30 text-amber-300' : 'border-zinc-800 text-zinc-400 hover:text-zinc-200'
                        }`} data-testid="rail-coach">
                        <Sparkles className="h-3 w-3" /> Coach{coachCount > 0 ? ` · ${coachCount}` : ''}
                    </button>
                </div>

                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-2 pb-3 custom-scrollbar">
                    {pinnedBots.length > 0 && (
                        <section>
                            <h4 className="px-1 pb-1 text-[10px] font-bold uppercase tracking-wider text-zinc-600">Pinned</h4>
                            {pinnedBots.map(renderBotRow)}
                        </section>
                    )}

                    <section>
                        <h4 className="px-1 pb-1 text-[10px] font-bold uppercase tracking-wider text-zinc-600">
                            Chats and tasks
                        </h4>
                        {otherBots.length === 0 && groupRows.length === 0 && (
                            <p className="px-1 py-3 text-[11px] leading-5 text-zinc-600">
                                No agents yet. Create one and it appears here with its own thread.
                            </p>
                        )}
                        {otherBots.map(renderBotRow)}
                        {groupRows.map(g => (
                            <Row key={g.id} active={selection.kind === 'group' && selection.groupId === g.id}
                                title={groupDisplayName(g, bots)} preview={`${g.memberIds.length} seats`} Icon={Users}
                                onClick={() => selectThread({ kind: 'group', groupId: g.id })}
                                manage={(onEditGroup || onDeleteGroup) && (
                                    <>
                                        {onEditGroup && (
                                            <button type="button" aria-label={`Edit ${groupDisplayName(g, bots)}`}
                                                onClick={() => onEditGroup(g.id)} data-testid="rail-edit-group"
                                                className="rounded p-0.5 text-zinc-600 transition-colors hover:text-zinc-300">
                                                <Pencil className="h-3 w-3" />
                                            </button>
                                        )}
                                        {onDeleteGroup && (
                                            <button type="button" aria-label={`Delete ${groupDisplayName(g, bots)}`}
                                                onClick={() => onDeleteGroup(g.id)} data-testid="rail-delete-group"
                                                className="rounded p-0.5 text-zinc-600 transition-colors hover:text-rose-300">
                                                <Trash2 className="h-3 w-3" />
                                            </button>
                                        )}
                                    </>
                                )} />
                        ))}
                    </section>
                </div>

                <div className="flex shrink-0 items-center gap-2 border-t border-zinc-800/80 px-3 py-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-zinc-800 font-mono text-[10px] uppercase text-zinc-300">
                        {username.slice(0, 1) || '·'}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-300">{username}</span>
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" title="desk online" />
                </div>
            </aside>

            {/* ── Main pane ── */}
            <section className="flex min-w-0 flex-1 flex-col bg-[#0b0b0a]">
                {activeGroup && renderGroup ? (
                    <div className="flex min-h-0 flex-1 flex-col">{renderGroup(activeGroup)}</div>
                ) : (
                    <>
                        {(activeBot || onOpenInDock) && (
                            <div className="flex shrink-0 items-center gap-2 border-b border-zinc-800/80 px-4 py-2">
                                <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-zinc-200">
                                    {activeBot ? `@${activeBot.name}` : 'Chart AI'}
                                </span>
                                {onOpenInDock && (
                                    <button type="button" onClick={onOpenInDock} data-testid="open-in-dock"
                                        className="shrink-0 rounded-control border border-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200">
                                        Open in Chart AI
                                    </button>
                                )}
                            </div>
                        )}
                        <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto custom-scrollbar">
                            {thread.length === 0 ? (
                                <div className="chat-hero-grid flex h-full flex-col items-center justify-center px-6 text-center">
                                    <Sparkles className="mb-3 h-7 w-7 text-zinc-500" />
                                    <h2 className="font-serif text-2xl text-zinc-100">{greeting(username || 'trader')}</h2>
                                    <p className="mt-1 max-w-sm text-[12px] leading-5 text-zinc-500">
                                        {activeBot
                                            ? `@${activeBot.name} reads its own notes and the shared notebook on every turn.`
                                            : 'Pick an agent on the left, or ask the desk directly — Analyze runs the full Chart AI pipeline.'}
                                    </p>
                                </div>
                            ) : (
                                <div className="chat-column space-y-3 py-4">
                                    {thread.map(m => (
                                        <div key={m.id} className={`flex flex-col ${m.role === MessageRole.USER ? 'items-end' : 'items-start'}`}>
                                            <span className="mb-0.5 font-mono text-[9px] uppercase tracking-wider text-zinc-600">
                                                {m.role === MessageRole.USER ? username : activeBot?.name ?? 'desk'}
                                                {' · '}{relTime(m.createdAt)}
                                            </span>
                                            <div className={`max-w-[85%] rounded-bubble px-3 py-2 text-[13px] leading-5 ${
                                                m.role === MessageRole.USER
                                                    ? 'bg-zinc-800 text-zinc-100'
                                                    : 'border border-zinc-800/80 bg-zinc-900 text-zinc-200'
                                            }`}>
                                                {(m.text || '').trim() || (m.analysis ? 'Analysis' : '…')}
                                                {m.role !== MessageRole.USER && <InlineVerdict m={m} />}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* ── Composer pill ── */}
                        <div className="shrink-0 px-4 pb-4">
                            <div className="chat-column rounded-2xl border border-zinc-800 bg-zinc-900 p-2 focus-within:border-zinc-600">
                                <textarea value={text}
                                    onChange={e => setText(e.target.value)}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); }
                                    }}
                                    rows={2} placeholder={placeholder} aria-label="Message"
                                    className="w-full resize-none bg-transparent px-1.5 py-1 text-[13px] leading-5 text-zinc-100 outline-none placeholder:text-zinc-600" />
                                <div className="mt-1 flex items-center gap-2 px-1">
                                    <div className="seg-thumb flex items-center rounded-control border border-zinc-800 p-0.5"
                                        role="group" aria-label="Send mode">
                                        {(['chat', 'analyze'] as const).map(m => (
                                            <button key={m} type="button" onClick={() => setMode(m)}
                                                aria-pressed={mode === m} data-testid={`mode-${m}`}
                                                className={`rounded-[5px] px-2 py-0.5 text-[10px] font-semibold capitalize transition-colors ${
                                                    mode === m ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
                                                }`}>
                                                {m}
                                            </button>
                                        ))}
                                    </div>
                                    {modelLabel && (
                                        <button type="button" onClick={onOpenModels} data-testid="composer-model"
                                            className="flex min-w-0 items-center gap-1 rounded-full border border-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400 transition-colors hover:text-zinc-200">
                                            <span className="truncate">{modelLabel}</span>
                                            <ChevronDown className="h-3 w-3 shrink-0" />
                                        </button>
                                    )}
                                    <button type="button" onClick={() => void send()} disabled={!text.trim() || busy}
                                        aria-label="Send" data-testid="composer-send"
                                        className="ml-auto flex h-7 w-7 items-center justify-center rounded-full bg-zinc-100 text-zinc-900 transition-opacity hover:opacity-90 disabled:opacity-30">
                                        <ArrowUp className="h-4 w-4" />
                                    </button>
                                </div>
                            </div>
                            <p className="mx-auto mt-1.5 max-w-3xl text-center text-[10px] text-zinc-600">
                                Chat talks to the agent · Analyze runs the full Chart AI pipeline
                            </p>
                        </div>
                    </>
                )}
            </section>
        </div>
    );
};

export default React.memo(AgentsView);
