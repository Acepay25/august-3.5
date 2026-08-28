/**
 * AgentRosterRail — chat mode's left rail: the agents as contacts.
 * A pinned "Team" row (the full ensemble-debate conversation) plus
 * one row per ready provider, each showing a pixel avatar, the last
 * message in that agent's 1:1 thread, a relative timestamp, and an
 * unread dot. Search filters the agent rows.
 *
 * Data comes from utils/agentThreads.ts — the same derivation the
 * thread view uses, so preview and thread can never disagree.
 * Monochrome per the workspace theme: selected state is a lighter
 * zinc fill, unread is a small zinc-200 dot (not a colored badge).
 */

import React from 'react';
import { MessageRole } from '../../types/enums';
import { Message } from '../../types/message';
import { ProviderConfig } from '../../types/provider';
import { buildGridForRole, colorForToken, PIXEL_GRID_H, PIXEL_GRID_W, roleForName } from '../desk/pixelAvatars';
import {
    AgentThreadOpenedMap,
    previewTextFor,
    ThreadSelection,
    threadForProvider,
} from '../../utils/agentThreads';

export interface AgentRosterRailProps {
    providers: ProviderConfig[];
    /** Full conversation, for thread previews + unread counts. */
    messages: Message[];
    selection: ThreadSelection;
    onSelectTeam: () => void;
    onSelectProvider: (providerId: string) => void;
    /** Per-provider last-opened ISO timestamps (unread computation). */
    openedMap: AgentThreadOpenedMap;
    activeUsername: string | null;
}

const formatRelative = (iso: string | null): string => {
    if (!iso) return '';
    const ms = Date.now() - Date.parse(iso);
    if (Number.isNaN(ms)) return '';
    if (ms < 60_000) return 'now';
    if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
    if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`;
    if (ms < 7 * 86_400_000) return `${Math.floor(ms / 86_400_000)}d`;
    return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
};

/** Tiny pixel avatar (16×20 grid at 1.5px) — no seat chrome, no button. */
const MiniAvatar: React.FC<{ name: string; live?: boolean }> = ({ name, live }) => {
    const role = roleForName(name);
    const grid = React.useMemo(() => buildGridForRole(role, 'idle'), [role]);
    const cell = 1.5;
    return (
        <span className="relative block shrink-0" aria-hidden="true" style={{ width: PIXEL_GRID_W * cell, height: PIXEL_GRID_H * cell }}>
            {grid.map((row, r) =>
                row.split('').map((c, ci) => {
                    if (c === '.') return null;
                    return (
                        <span
                            key={`${r}-${ci}`}
                            style={{
                                position: 'absolute',
                                left: ci * cell,
                                top: r * cell,
                                width: cell,
                                height: cell,
                                background: colorForToken(c as Parameters<typeof colorForToken>[0], role),
                            }}
                        />
                    );
                }),
            )}
            {live && (
                <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-emerald-400" />
            )}
        </span>
    );
};

export const AgentRosterRail: React.FC<AgentRosterRailProps> = ({
    providers,
    messages,
    selection,
    onSelectTeam,
    onSelectProvider,
    openedMap,
    activeUsername,
}) => {
    const [query, setQuery] = React.useState('');
    const q = query.trim().toLowerCase();
    const visibleProviders = React.useMemo(
        () => (q ? providers.filter(p => p.name.toLowerCase().includes(q)) : providers),
        [providers, q],
    );

    const rowBase = 'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors';
    const rowActive = 'bg-zinc-800 text-zinc-100';
    const rowIdle = 'text-zinc-300 hover:bg-zinc-800/50';

    const renderUnread = (count: number): React.ReactNode => (
        count > 0 ? (
            <span
                data-testid="roster-unread"
                className="ml-auto shrink-0 rounded-full bg-zinc-200 px-1.5 text-[9px] font-bold leading-4 text-zinc-900"
            >
                {count > 9 ? '9+' : count}
            </span>
        ) : null
    );

    return (
        <aside
            data-testid="agent-roster-rail"
            aria-label="Agents"
            className="hidden w-72 shrink-0 flex-col border-r border-white/[0.06] bg-zinc-900/50 lg:flex"
        >
            {/* Search */}
            <div className="p-3 pb-2">
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
                        aria-label="Search agents"
                        data-testid="roster-search"
                        className="w-full bg-transparent text-[13px] text-zinc-200 placeholder-zinc-500 outline-none"
                    />
                </div>
            </div>

            {/* Roster */}
            <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
                <ul className="space-y-0.5">
                    {/* Team — the pinned full-conversation row */}
                    <li>
                        <button
                            type="button"
                            onClick={onSelectTeam}
                            data-testid="roster-team"
                            data-active={selection.kind === 'team' ? '1' : '0'}
                            className={`${rowBase} ${selection.kind === 'team' ? rowActive : rowIdle}`}
                        >
                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/10 bg-zinc-800 text-[9px] font-bold uppercase tracking-wider text-zinc-300">
                                Team
                            </span>
                            <span className="min-w-0 flex-1">
                                <span className="flex items-baseline gap-2">
                                    <span className="truncate text-[13px] font-semibold">Team</span>
                                    <span className="ml-auto shrink-0 text-[10px] text-zinc-500">
                                        {messages.length > 0 ? formatRelative(messages[messages.length - 1]?.createdAt ?? null) : ''}
                                    </span>
                                </span>
                                <span className="mt-0.5 block truncate text-[11px] text-zinc-500">
                                    {messages.length > 0
                                        ? previewTextFor(messages[messages.length - 1])
                                        : 'Debates and team analysis'}
                                </span>
                            </span>
                        </button>
                    </li>

                    {/* One row per ready provider */}
                    {visibleProviders.map(p => {
                        const active = selection.kind === 'provider' && selection.providerId === p.id;
                        const thread = threadForProvider(messages, p.id);
                        const last = thread.length > 0 ? thread[thread.length - 1] : null;
                        const opened = openedMap[p.id] ?? null;
                        const unread = last
                            ? thread.filter(m => m.role === MessageRole.AI && (!opened || Date.parse(m.createdAt) > Date.parse(opened))).length
                            : 0;
                        return (
                            <li key={p.id}>
                                <button
                                    type="button"
                                    onClick={() => onSelectProvider(p.id)}
                                    data-testid={`roster-agent-${p.id}`}
                                    data-active={active ? '1' : '0'}
                                    className={`${rowBase} ${active ? rowActive : rowIdle}`}
                                >
                                    <MiniAvatar name={p.name} live={p.isEnabled && p.apiKey.trim().length > 0} />
                                    <span className="min-w-0 flex-1">
                                        <span className="flex items-baseline gap-2">
                                            <span className="truncate text-[13px] font-semibold">{p.name}</span>
                                            <span className="ml-auto shrink-0 text-[10px] text-zinc-500">
                                                {formatRelative(last?.createdAt ?? null)}
                                            </span>
                                        </span>
                                        <span className="mt-0.5 block truncate text-[11px] text-zinc-500">
                                            {last ? previewTextFor(last) : 'No messages yet'}
                                        </span>
                                    </span>
                                    {renderUnread(unread)}
                                </button>
                            </li>
                        );
                    })}
                    {providers.length === 0 && (
                        <li className="px-2.5 py-3 text-[11px] leading-snug text-zinc-500">
                            No agents configured — add a provider in Settings to chat 1:1.
                        </li>
                    )}
                </ul>
            </nav>

            {/* Trader identity footer */}
            <div className="border-t border-white/[0.06] p-3">
                <div className="flex items-center gap-2.5">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-[10px] font-bold uppercase text-zinc-300">
                        {(activeUsername || 'You').slice(0, 2)}
                    </span>
                    <span className="min-w-0">
                        <span className="block truncate text-[13px] font-semibold text-zinc-200">
                            {activeUsername || 'You'}
                        </span>
                        <span className="block text-[10px] uppercase tracking-widest text-zinc-500">
                            Trader
                        </span>
                    </span>
                </div>
            </div>
        </aside>
    );
};

export default AgentRosterRail;
