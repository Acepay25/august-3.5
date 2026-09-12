/**
 * NavRail — Antigravity's left panel, copied: a thin always-visible ACTIVITY
 * BAR of surface icons (VS Code-style), not a hamburger and not a wide tab
 * column. Clicking a surface icon switches the main area; clicking the ACTIVE
 * icon toggles that surface's sidebar panel (on Trade that's the order book) —
 * the same open/close behavior the reference has. The active icon carries the
 * brand gradient indicator (one of the two sanctioned gradient moments) and
 * account/settings stay pinned at the bottom.
 */

import React from 'react';
import {
    ActivityIcon,
    FileTextIcon,
    SparklesIcon,
    BotIcon,
    SettingsIcon,
} from '../shared/Icons';
import type { AppSurface } from '../../hooks/useSurface';

interface NavRailProps {
    surface: AppSurface;
    onSelect: (surface: AppSurface) => void;
    /** Clicking the ALREADY-active surface calls this instead of onSelect —
     *  the surfaces with a sidebar (trade) toggle it open/closed. */
    onToggleSidebar: () => void;
    onOpenSettings: () => void;
    username?: string;
}

const ITEMS: Array<{ id: AppSurface; label: string; Icon: React.FC<{ className?: string }> }> = [
    { id: 'trade', label: 'Trade', Icon: ActivityIcon },
    { id: 'journal', label: 'Journal', Icon: FileTextIcon },
    { id: 'studio', label: 'Studio', Icon: SparklesIcon },
    { id: 'agents', label: 'Agents', Icon: BotIcon },
];

const NavRail: React.FC<NavRailProps> = ({ surface, onSelect, onToggleSidebar, onOpenSettings, username }) => {
    const initial = (username || '?').trim().charAt(0).toUpperCase();
    return (
        <nav
            aria-label="Surfaces"
            data-testid="nav-rail"
            className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-white/[0.06] bg-zinc-900 py-2"
        >
            {ITEMS.map(({ id, label, Icon }) => {
                const active = surface === id;
                return (
                    <button
                        key={id}
                        type="button"
                        title={active ? `${label} — click to toggle the side panel` : label}
                        aria-label={label}
                        aria-current={active ? 'page' : undefined}
                        onClick={() => (active ? onToggleSidebar() : onSelect(id))}
                        className={`relative flex h-10 w-10 items-center justify-center rounded-xl transition-colors duration-100 ease-[cubic-bezier(0.2,0,0,1)] focus-visible:outline-none ${
                            active ? 'text-zinc-100' : 'text-zinc-500 hover:bg-white/[0.05] hover:text-zinc-200'
                        }`}
                    >
                        {active && (
                            <span
                                aria-hidden
                                className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-gradient-to-b from-brand-start via-brand-mid to-brand-end"
                            />
                        )}
                        <Icon className="h-[18px] w-[18px]" />
                    </button>
                );
            })}
            <div className="mt-auto flex flex-col items-center gap-2">
                <button
                    type="button"
                    title="Settings"
                    aria-label="Settings"
                    onClick={onOpenSettings}
                    className="flex h-10 w-10 items-center justify-center rounded-xl text-zinc-500 transition-colors hover:bg-white/[0.05] hover:text-zinc-200"
                >
                    <SettingsIcon className="h-[18px] w-[18px]" />
                </button>
                <span
                    title={username || 'Account'}
                    className="flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-zinc-800 text-[10px] font-semibold text-zinc-300"
                >
                    {initial}
                </span>
            </div>
        </nav>
    );
};

export default React.memo(NavRail);
