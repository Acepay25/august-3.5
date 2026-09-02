/**
 * AgentRosterRail — the Hermes "BOTS" pane, copied: a header with a
 * "+" menu (New Bot / New Group Chat), one row per bot (avatar, name,
 * relative time, latest-message preview), group rows with stacked
 * avatars, a pinned Team row (the ensemble debate room), and a big
 * "+ New Agent" button docked at the bottom.
 *
 * Bots are named teammates (services/agents/agentRoster.ts) bound to
 * a provider model — NOT the raw provider list. The active-now chip
 * strip appears above the roster while a bot is working.
 */

import React from 'react';
import { Trash2, SlidersHorizontal, Bot as BotIcon, Users, Swords, GraduationCap, ChevronDown, Repeat } from 'lucide-react';
import { BotAvatar, PixelAvatarFigure } from './BotAvatar';
import type { AgentBot, AgentGroup, AgentTeam } from '../../services/agents/agentRoster';
import { groupDisplayName } from '../../services/agents/agentRoster';
import type { AutomationConfig } from '../../types/automation';
import { nextCronTime, humanizeCron } from '../../services/automation/cronParser';
import { MessageRole } from '../../types/enums';
import { Message } from '../../types/message';
import type { TeamSlot } from '../../utils/teamRoster';
import {
    previewTextFor,
    ThreadSelection,
    threadForGroup,
    threadForProvider,
    unreadCount,
    unreadInSlice,
} from '../../utils/agentThreads';

export interface AgentRosterRailProps {
    bots: AgentBot[];
    groups: AgentGroup[];
    /** Full conversation, for previews. */
    messages: Message[];
    selection: ThreadSelection;
    /** The Settings-derived roster — powers the pinned Team row ONLY
     *  while the trader has no teams of their own. */
    teamMembers?: TeamSlot[];
    /** User-created teams. When any exist they replace the pinned row:
     *  the Team IS one of these, and activating one points the harness
     *  at exactly its seats. */
    teams?: { team: AgentTeam; slots: TeamSlot[] }[];
    /** The team the harness currently runs. */
    activeTeamId?: string | null;
    onSelectTeam: () => void;
    /** Activate a team: it becomes the harness configuration. */
    onActivateTeam?: (teamId: string) => void;
    /** Open the edit dialog for a team. */
    onEditTeam?: (teamId: string) => void;
    /** Delete a team (App confirms). */
    onDeleteTeam?: (teamId: string) => void;
    onSelectBot: (botId: string) => void;
    onSelectGroup: (groupId: string) => void;
    /** Delete a named bot (App confirms; groups holding it update). */
    onDeleteBot?: (botId: string) => void;
    /** Delete a group room (App confirms). */
    onDeleteGroup?: (groupId: string) => void;
    /** Manage the Settings-derived seats (legacy, no-teams mode only). */
    onManageTeam?: () => void;
    onNewBot: () => void;
    onNewGroup: () => void;
    onNewTeam?: () => void;
    /** Coach thread (§10.1): the learning loop's inbox as a conversation. */
    onSelectCoach?: () => void;
    /** Pending drafts + proposals waiting on the trader (badge count). */
    coachCount?: number;
    /** Bot id currently working (active-now strip + pulse). */
    workingBotId?: string | null;
    /** Per-thread last-opened ISO timestamps (keyed by bot.id / group.id)
     *  — drives the unread count badges (plan §10.1). Absent = never opened. */
    lastOpenedMap?: Record<string, string>;
    /** G3 (plan botmode-scan): botId → one-line fix hint when the bot
     *  cannot do its job (missing provider/key/model, auth, quota, bench).
     *  The row shows a ⚠ badge with the hint as tooltip. */
    attentionMap?: Record<string, string>;
    /** G5 (plan botmode-scan): routines scoped to a bot, keyed by botId.
     *  When a bot has routines, its row gains a Routines disclosure with
     *  the schedule, next fire, and Run-now affordance. */
    botRoutines?: Record<string, AutomationConfig[]>;
    /** Run a routine immediately (Run now in the disclosure). */
    onRunRoutine?: (config: AutomationConfig) => void;
}

/** Monochrome unread-count badge (plan §10.1) — a count, never a colored dot. */
const UnreadBadge: React.FC<{ count: number }> = ({ count }) => {
    if (count <= 0) return null;
    return (
        <span
            data-testid="roster-unread-badge"
            className="ml-auto shrink-0 rounded-full border border-zinc-600 px-1.5 py-px text-[9px] font-bold tabular-nums leading-tight text-zinc-300"
        >
            {count > 9 ? '9+' : count}
        </span>
    );
};

const formatRelative = (iso: string | null): string => {
    if (!iso) return '';
    const ms = Date.now() - Date.parse(iso);
    if (Number.isNaN(ms)) return '';
    if (ms < 60_000) return 'now';
    if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
    if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
    if (ms < 7 * 86_400_000) return `${Math.floor(ms / 86_400_000)}d ago`;
    return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
};

const lastOf = (slice: Message[]): Message | null => (slice.length > 0 ? slice[slice.length - 1] : null);

/** G5 (plan botmode-scan): a bot's Routines disclosure — one row per
 *  bot-scoped automation (name, humanized schedule, next fire) with a
 *  Run-now affordance. Only rendered when the bot actually has routines;
 *  monochrome, dense, stopPropagation so the bot row stays selected. */
const RoutineDisclosure: React.FC<{
    routines: AutomationConfig[];
    onRun: (config: AutomationConfig) => void;
}> = ({ routines, onRun }) => {
    const [open, setOpen] = React.useState(false);
    if (routines.length === 0) return null;
    return (
        <div className="px-2 pb-1.5" data-testid="routine-disclosure">
            <button
                type="button"
                onClick={e => { e.stopPropagation(); setOpen(v => !v); }}
                aria-expanded={open}
                data-testid="routine-disclosure-toggle"
                className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-[10px] font-bold uppercase tracking-widest text-zinc-500 transition-colors hover:bg-zinc-800/60 hover:text-zinc-300"
            >
                <Repeat className="h-3 w-3" />
                Routines ({routines.length})
                <ChevronDown className={`ml-auto h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
            {open && (
                <ul className="mt-0.5 space-y-0.5">
                    {routines.map(r => {
                        const next = r.enabled ? nextCronTime(r.schedule.cron, new Date()) : null;
                        return (
                            <li key={r.id} className="flex items-center gap-2 rounded-md px-1.5 py-1 text-[11px] text-zinc-400">
                                <span className="min-w-0 flex-1 truncate" title={`${r.name} — ${humanizeCron(r.schedule.cron)}`}>
                                    {r.name}
                                    <span className="block truncate text-[9px] font-mono text-zinc-600">
                                        {next
                                            ? `next ${next.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`
                                            : (r.enabled ? humanizeCron(r.schedule.cron) : 'paused / off')}
                                    </span>
                                </span>
                                <button
                                    type="button"
                                    onClick={e => { e.stopPropagation(); onRun(r); }}
                                    disabled={!r.enabled}
                                    data-testid={`routine-run-${r.id}`}
                                    title={r.enabled ? 'Run now' : 'Enable the routine first'}
                                    className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-zinc-500 transition-colors hover:bg-zinc-700 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                    Run
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
};

/** Hover trash — fades in over the row's timestamp while hovered
 *  (Claude-sidebar pattern). A sibling of the row button, so nested-
 *  button validity stays clean; stopPropagation keeps the row from
 *  selecting when the trader is only deleting. */
const RowDelete: React.FC<{ label: string; testId: string; onPress: () => void }> = ({ label, testId, onPress }) => (
    <button
        type="button"
        onClick={e => { e.stopPropagation(); onPress(); }}
        aria-label={label}
        data-testid={testId}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-zinc-500 opacity-0 transition-opacity hover:bg-zinc-700 hover:text-rose-300 focus-visible:opacity-100 group-hover/row:opacity-100"
    >
        <Trash2 className="h-3.5 w-3.5" />
    </button>
);

export const AgentRosterRail: React.FC<AgentRosterRailProps> = ({
    bots,
    groups,
    messages,
    selection,
    teamMembers,
    teams,
    activeTeamId,
    onSelectTeam,
    onActivateTeam,
    onEditTeam,
    onDeleteTeam,
    onSelectBot,
    onSelectGroup,
    onDeleteBot,
    onDeleteGroup,
    onManageTeam,
    onNewBot,
    onNewGroup,
    onNewTeam,
    onSelectCoach,
    coachCount,
    workingBotId,
    lastOpenedMap,
    attentionMap,
    botRoutines,
    onRunRoutine,
}) => {
    const [query, setQuery] = React.useState('');
    const [menuOpen, setMenuOpen] = React.useState(false);
    const q = query.trim().toLowerCase();
    const userTeams = teams ?? [];
    const visibleTeams = React.useMemo(
        () => (q ? userTeams.filter(({ team }) => (team.name ?? 'Team').toLowerCase().includes(q)) : userTeams),
        [userTeams, q],
    );
    // Message search (plan §10.1): threads are derived views over ONE flat
    // message array, so searching messages is a filter over that array —
    // no index, no new store. A bot/group row stays visible when its NAME
    // matches or its thread contains a message whose text matches.
    const threadMatchesQuery = (slice: Message[]): boolean =>
        q.length >= 2 && slice.some(m => (m.text || '').toLowerCase().includes(q));
    const visibleBots = React.useMemo(
        () => (q
            ? bots.filter(b =>
                b.name.toLowerCase().includes(q)
                || (b.title ?? '').toLowerCase().includes(q)
                || threadMatchesQuery(threadForProvider(messages, b.providerId, b.modelId)))
            : bots),
        [bots, q, messages],
    );
    const visibleGroups = React.useMemo(
        () => (q
            ? groups.filter(g =>
                groupDisplayName(g, bots).toLowerCase().includes(q)
                || threadMatchesQuery(threadForGroup(messages, g.memberIds
                    .map(id => bots.find(b => b.id === id))
                    .filter((b): b is AgentBot => Boolean(b))
                    .map(m => ({ providerId: m.providerId, modelId: m.modelId })))))
            : groups),
        [groups, bots, q, messages],
    );
    // The Team row is the LIVE ensemble roster: stacked identity discs
    // for each configured seat, subtitle = the seat labels (deduped —
    // three seats on one provider read "Kilocode ×3", not a stutter).
    // Nothing about it is hardcoded — change the team in Settings and
    // the row follows. The Team is harness configuration: it is
    // managed via the gear affordance, never deleted.
    const team = teamMembers ?? [];
    const teamLabels = [...new Set(team.map(m => m.label))];
    const teamSubtitle = messages.length > 0
        ? previewTextFor(messages[messages.length - 1])
        : team.length > 0
            ? teamLabels.length < team.length
                ? `${teamLabels.join(' · ')} ×${team.length}`
                : teamLabels.join(' · ')
            : 'No analysts configured — Settings → Models';

    const rowBase = 'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors';
    const rowActive = 'bg-zinc-800';
    const rowIdle = 'hover:bg-zinc-800/50';

    return (
        <aside
            data-testid="agent-roster-rail"
            aria-label="Bots"
            className="relative z-10 hidden w-72 shrink-0 flex-col border-r border-white/[0.06] bg-zinc-900/50 lg:flex"
        >
            {/* Header — BOTS + the "+" menu (New Bot / New Group Chat) */}
            <div className="flex items-center justify-between px-4 pb-2 pt-4">
                <span className="text-[11px] font-bold uppercase tracking-widest text-zinc-400">Bots</span>
                <div className="relative">
                    <button
                        type="button"
                        onClick={() => setMenuOpen(v => !v)}
                        aria-label="New bot or group"
                        aria-expanded={menuOpen}
                        data-testid="bots-add"
                        className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                    >
                        +
                    </button>
                    {menuOpen && (
                        <div
                            className="absolute right-0 top-full z-20 mt-1 w-44 overflow-hidden rounded-lg border border-white/10 bg-zinc-900 shadow-xl"
                            role="menu"
                        >
                            <button
                                type="button"
                                role="menuitem"
                                onClick={() => { setMenuOpen(false); onNewBot(); }}
                                data-testid="menu-new-bot"
                                className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-[13px] font-medium text-zinc-200 hover:bg-zinc-800"
                            >
                                <BotIcon className="h-3.5 w-3.5 shrink-0 text-zinc-500" /> New Bot
                            </button>
                            <button
                                type="button"
                                role="menuitem"
                                onClick={() => { setMenuOpen(false); onNewGroup(); }}
                                data-testid="menu-new-group"
                                className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-[13px] font-medium text-zinc-200 hover:bg-zinc-800"
                            >
                                <Users className="h-3.5 w-3.5 shrink-0 text-zinc-500" /> New Group Chat
                            </button>
                            {onNewTeam && (
                                <button
                                    type="button"
                                    role="menuitem"
                                    onClick={() => { setMenuOpen(false); onNewTeam(); }}
                                    data-testid="menu-new-team"
                                    className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-[13px] font-medium text-zinc-200 hover:bg-zinc-800"
                                >
                                    <Swords className="h-3.5 w-3.5 shrink-0 text-zinc-500" /> New Team
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Search */}
            <div className="px-3 pb-2">
                <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-zinc-900 px-3 py-2">
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 text-zinc-500" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <circle cx="11" cy="11" r="7" />
                        <path d="m20 20-3.5-3.5" />
                    </svg>
                    <input
                        type="text"
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        placeholder="Search"
                        aria-label="Search bots"
                        data-testid="roster-search"
                        className="w-full bg-transparent text-[13px] text-zinc-200 placeholder-zinc-500 outline-none"
                    />
                </div>
            </div>

            {/* Active now strip */}
            {workingBotId && (
                <div className="status-surface px-3 pb-2" data-testid="active-now">
                    <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-zinc-800 px-2.5 py-1 text-[11px] font-semibold text-zinc-200">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                        {bots.find(b => b.id === workingBotId)?.name ?? 'Bot'} is working
                    </span>
                </div>
            )}

            {/* Roster */}
            <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
                <ul className="space-y-0.5">
                    {/* Pinned legacy Team row — Settings-derived. Only while
                        the trader has no teams of their own; with teams,
                        THEY are the harness. */}
                    {userTeams.length === 0 && (
                    <li className="group/team relative">
                        <button
                            type="button"
                            onClick={onSelectTeam}
                            data-testid="roster-team"
                            data-active={selection.kind === 'team' ? '1' : '0'}
                            className={`${rowBase} ${selection.kind === 'team' ? rowActive : rowIdle}`}
                        >
                            {team.length > 0 ? (
                                <span className="relative flex h-10 w-[52px] shrink-0 items-center">
                                    {team.slice(0, 3).map((m, i) => (
                                        <span key={`${m.label}-${i}`} className={i === 0 ? 'z-10' : '-ml-3'}>
                                            <PixelAvatarFigure role={m.role} size={i === 0 ? 30 : 24} />
                                        </span>
                                    ))}
                                </span>
                            ) : (
                                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-zinc-800 text-[10px] font-bold uppercase tracking-wider text-zinc-300">
                                    Team
                                </span>
                            )}
                            <span className="min-w-0 flex-1">
                                <span className="flex items-baseline gap-2">
                                    <span className="truncate text-[13px] font-semibold text-zinc-100">Team</span>
                                    <span className="ml-auto shrink-0 text-[10px] text-zinc-500 transition-opacity group-hover/team:opacity-0">
                                        {messages.length > 0 ? formatRelative(messages[messages.length - 1]?.createdAt ?? null) : ''}
                                    </span>
                                </span>
                                <span className="mt-0.5 block truncate text-[11px] text-zinc-500">
                                    {teamSubtitle}
                                </span>
                            </span>
                        </button>
                        {onManageTeam && (
                            <button
                                type="button"
                                onClick={e => { e.stopPropagation(); onManageTeam(); }}
                                aria-label="Manage team seats"
                                data-testid="manage-team"
                                title="The Team is the debate harness — add, remove, or re-point its seats in Settings → Models"
                                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-zinc-500 opacity-0 transition-opacity hover:bg-zinc-700 hover:text-zinc-200 focus-visible:opacity-100 group-hover/team:opacity-100"
                            >
                                <SlidersHorizontal className="h-3.5 w-3.5" />
                            </button>
                        )}
                    </li>
                    )}

                    {/* Coach thread (§10.1) — the learning loop's inbox as a
                        conversation: pending skill drafts + queue proposals.
                        Badge = items waiting on the trader. */}
                    {onSelectCoach && (
                    <li className="group/coach relative">
                        <button
                            type="button"
                            onClick={onSelectCoach}
                            data-testid="roster-coach"
                            data-active={selection.kind === 'coach' ? '1' : '0'}
                            title="Coach — drafts and proposals waiting on your decision"
                            className={`${rowBase} ${selection.kind === 'coach' ? rowActive : rowIdle}`}
                        >
                            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-zinc-800 text-zinc-300">
                                <GraduationCap className="h-5 w-5" />
                            </span>
                            <span className="min-w-0 flex-1">
                                <span className="flex items-baseline gap-2">
                                    <span className="truncate text-[13px] font-semibold text-zinc-100">Coach</span>
                                    {(coachCount ?? 0) > 0
                                        ? <UnreadBadge count={coachCount ?? 0} />
                                        : <span className="ml-auto shrink-0 text-[10px] text-zinc-500">in sync</span>}
                                </span>
                                <span className="mt-0.5 block truncate text-[11px] text-zinc-500">
                                    {(coachCount ?? 0) > 0
                                        ? `${coachCount} item${coachCount === 1 ? '' : 's'} need your call`
                                        : 'Nothing waiting — the loop asks before it acts'}
                                </span>
                            </span>
                        </button>
                    </li>
                    )}

                    {/* User teams — each activation points the harness at
                        exactly that team's seats. Hover → edit / delete. */}
                    {visibleTeams.map(({ team, slots }) => {
                        const isHarness = activeTeamId === team.id;
                        const viewing = selection.kind === 'team' && isHarness;
                        const label = team.name?.trim() || 'Team';
                        const seatLabels = [...new Set(slots.map(s => s.label))];
                        const subtitle = seatLabels.length < slots.length
                            ? `${seatLabels.join(' · ')} ×${slots.length}`
                            : seatLabels.join(' · ');
                        return (
                            <li key={team.id} className="group/teamrow relative">
                                <button
                                    type="button"
                                    onClick={() => onActivateTeam?.(team.id)}
                                    data-testid={`roster-team-${team.id}`}
                                    data-active={viewing ? '1' : '0'}
                                    title={isHarness
                                        ? 'Active team — the harness runs these seats'
                                        : 'Activate: the debate harness (hybrid intelligence + trade log) runs this team'}
                                    className={`${rowBase} ${viewing ? rowActive : rowIdle}`}
                                >
                                    <span className="relative flex h-10 w-[52px] shrink-0 items-center">
                                        {slots.slice(0, 3).map((m, i) => (
                                            <span key={`${m.label}-${i}`} className={i === 0 ? 'z-10' : '-ml-3'}>
                                                <PixelAvatarFigure role={m.role} size={i === 0 ? 30 : 24} />
                                            </span>
                                        ))}
                                    </span>
                                    <span className="min-w-0 flex-1">
                                        <span className="flex items-baseline gap-2">
                                            <span className="truncate text-[13px] font-semibold text-zinc-100">{label}</span>
                                            {isHarness && (
                                                <span aria-label="Active team" className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
                                            )}
                                            <span className="ml-auto shrink-0 text-[10px] text-zinc-500 transition-opacity group-hover/teamrow:opacity-0">
                                                {formatRelative(messages[messages.length - 1]?.createdAt ?? null)}
                                            </span>
                                        </span>
                                        <span className="mt-0.5 block truncate text-[11px] text-zinc-500">
                                            {messages.length > 0 && viewing
                                                ? previewTextFor(messages[messages.length - 1])
                                                : subtitle}
                                        </span>
                                    </span>
                                </button>
                                {onEditTeam && (
                                    <button
                                        type="button"
                                        onClick={e => { e.stopPropagation(); onEditTeam(team.id); }}
                                        aria-label={`Edit ${label}`}
                                        data-testid={`edit-team-${team.id}`}
                                        className="absolute right-8 top-1/2 -translate-y-1/2 rounded p-1 text-zinc-500 opacity-0 transition-opacity hover:bg-zinc-700 hover:text-zinc-200 focus-visible:opacity-100 group-hover/teamrow:opacity-100"
                                    >
                                        <SlidersHorizontal className="h-3.5 w-3.5" />
                                    </button>
                                )}
                                {onDeleteTeam && (
                                    <button
                                        type="button"
                                        onClick={e => { e.stopPropagation(); onDeleteTeam(team.id); }}
                                        aria-label={`Delete ${label}`}
                                        data-testid={`delete-team-${team.id}`}
                                        className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-zinc-500 opacity-0 transition-opacity hover:bg-zinc-700 hover:text-rose-300 focus-visible:opacity-100 group-hover/teamrow:opacity-100"
                                    >
                                        <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                )}
                            </li>
                        );
                    })}
                    {userTeams.length > 0 && onNewTeam && (
                        <li>
                            <button
                                type="button"
                                onClick={onNewTeam}
                                data-testid="new-team-button"
                                className="flex w-full items-center gap-2 rounded-lg border border-dashed border-white/10 px-3 py-2 text-left text-[12px] font-medium text-zinc-500 transition-colors hover:border-white/25 hover:text-zinc-300"
                            >
                                + New Team
                            </button>
                        </li>
                    )}

                    {/* Groups — stacked avatars */}
                    {visibleGroups.map(g => {
                        const members = g.memberIds
                            .map(id => bots.find(b => b.id === id))
                            .filter((b): b is AgentBot => Boolean(b));
                        const slice = threadForGroup(messages, members.map(m => ({ providerId: m.providerId, modelId: m.modelId })));
                        const last = lastOf(slice);
                        const active = selection.kind === 'group' && selection.groupId === g.id;
                        const unread = active ? 0 : unreadInSlice(slice, lastOpenedMap?.[g.id]);
                        return (
                            <li key={g.id} className="group/row relative">
                                <button
                                    type="button"
                                    onClick={() => onSelectGroup(g.id)}
                                    data-testid={`roster-group-${g.id}`}
                                    data-active={active ? '1' : '0'}
                                    className={`${rowBase} ${active ? rowActive : rowIdle}`}
                                >
                                    <span className="relative flex h-10 w-[46px] shrink-0 items-center">
                                        {members.slice(0, 2).map((m, i) => (
                                            <span key={m.id} className={i === 0 ? 'z-10' : '-ml-4'}>
                                                <BotAvatar bot={m} size={i === 0 ? 30 : 30} />
                                            </span>
                                        ))}
                                    </span>
                                    <span className="min-w-0 flex-1">
                                        <span className="flex items-baseline gap-2">
                                            <span className="truncate text-[13px] font-semibold text-zinc-100">
                                                {groupDisplayName(g, bots)}
                                            </span>
                                            {unread > 0
                                                ? <UnreadBadge count={unread} />
                                                : <span className="ml-auto shrink-0 text-[10px] text-zinc-500 transition-opacity group-hover/row:opacity-0">
                                                    {formatRelative(last?.createdAt ?? null)}
                                                </span>}
                                        </span>
                                        <span className="mt-0.5 block truncate text-[11px] text-zinc-500">
                                            {last
                                                ? (last.role === MessageRole.USER ? `You: ${previewTextFor(last)}` : previewTextFor(last))
                                                : `${members.length} bots`}
                                        </span>
                                    </span>
                                </button>
                                {onDeleteGroup && (
                                    <RowDelete
                                        label={`Delete ${groupDisplayName(g, bots)}`}
                                        testId={`delete-group-${g.id}`}
                                        onPress={() => onDeleteGroup(g.id)}
                                    />
                                )}
                            </li>
                        );
                    })}

                    {/* Bots */}
                    {visibleBots.map(bot => {
                        const slice = threadForProvider(messages, bot.providerId, bot.modelId);
                        const last = lastOf(slice);
                        const active = selection.kind === 'bot' && selection.botId === bot.id;
                        const unread = active ? 0 : unreadCount(messages, bot.providerId, lastOpenedMap?.[bot.id], bot.modelId);
                        return (
                            <li key={bot.id} className="group/row relative">
                                <button
                                    type="button"
                                    onClick={() => onSelectBot(bot.id)}
                                    data-testid={`roster-bot-${bot.id}`}
                                    data-active={active ? '1' : '0'}
                                    className={`${rowBase} ${active ? rowActive : rowIdle}`}
                                >
                                    <span className="relative shrink-0">
                                        <BotAvatar bot={bot} size={40} working={workingBotId === bot.id} />
                                    </span>
                                    <span className="min-w-0 flex-1">
                                        <span className="flex items-baseline gap-2">
                                            <span className="truncate text-[13px] font-semibold text-zinc-100">{bot.name}</span>
                                            {unread > 0
                                                ? <UnreadBadge count={unread} />
                                                : <span className="ml-auto shrink-0 text-[10px] text-zinc-500 transition-opacity group-hover/row:opacity-0">
                                                    {formatRelative(last?.createdAt ?? null)}
                                                </span>}
                                            {/* G3: needs-attention — the row
                                                says WHY (tooltip), never a
                                                silent failure. Monochrome. */}
                                            {attentionMap?.[bot.id] && (
                                                <span
                                                    data-testid={`roster-attention-${bot.id}`}
                                                    title={attentionMap[bot.id]}
                                                    className="shrink-0 text-[10px] leading-none text-zinc-400"
                                                >
                                                    ⚠
                                                </span>
                                            )}
                                        </span>
                                        <span className="mt-0.5 block truncate text-[11px] text-zinc-500">
                                            {last ? previewTextFor(last) : (bot.title || 'No messages yet')}
                                        </span>
                                    </span>
                                </button>
                                {onDeleteBot && (
                                    <RowDelete
                                        label={`Delete ${bot.name}`}
                                        testId={`delete-bot-${bot.id}`}
                                        onPress={() => onDeleteBot(bot.id)}
                                    />
                                )}
                                {/* G5: this bot's routines — schedule peek + Run now. */}
                                {onRunRoutine && botRoutines?.[bot.id] ? (
                                    <RoutineDisclosure routines={botRoutines[bot.id]} onRun={onRunRoutine} />
                                ) : null}
                            </li>
                        );
                    })}
                    {userTeams.length === 0 && bots.length === 0 && groups.length === 0 && (
                        <li className="px-2.5 py-3 text-[11px] leading-snug text-zinc-500">
                            No bots yet — create one and pick a model for it to think with.
                        </li>
                    )}
                </ul>
            </nav>

            {/* New Agent — docked at the bottom, Hermes-style */}
            <div className="p-3">
                <button
                    type="button"
                    onClick={onNewBot}
                    data-testid="new-agent-button"
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-zinc-800 px-3 py-2.5 text-[13px] font-semibold text-zinc-100 transition-colors hover:bg-zinc-700"
                >
                    + New Agent
                </button>
            </div>
        </aside>
    );
};

export default AgentRosterRail;
