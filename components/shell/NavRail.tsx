/**
 * NavRail — Minara's arrangement, first column: a slim always-visible icon
 * rail of the app's surfaces, account/settings pinned at the bottom. The
 * active item carries the brand gradient as its indicator (one of the two
 * sanctioned gradient moments, with the wordmark).
 */

import React from 'react';
import {
    MessageSquareIcon,
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
    onOpenSettings: () => void;
    username?: string;
}

const ITEMS: Array<{ id: AppSurface; label: string; Icon: React.FC<{ className?: string }> }> = [
    { id: 'chat', label: 'Chat', Icon: MessageSquareIcon },
    { id: 'trade', label: 'Trade', Icon: ActivityIcon },
    { id: 'journal', label: 'Journal', Icon: FileTextIcon },
    { id: 'studio', label: 'Studio', Icon: SparklesIcon },
    { id: 'agents', label: 'Agents', Icon: BotIcon },
];

const NavRail: React.FC<NavRailProps> = ({ surface, onSelect, onOpenSettings, username }) => {
    const initial = (username || '?').trim().charAt(0).toUpperCase();
    return (
        <nav
            aria-label="Surfaces"
            data-testid="nav-rail"
            className="flex w-16 shrink-0 flex-col items-center gap-1 bg-zinc-900 py-3"
        >
            {ITEMS.map(({ id, label, Icon }) => {
                const active = surface === id;
                return (
                    <button
                        key={id}
                        type="button"
                        title={label}
                        aria-label={label}
                        aria-current={active ? 'page' : undefined}
                        onClick={() => onSelect(id)}
                        className={`relative flex h-11 w-11 items-center justify-center rounded-xl transition-colors duration-100 ease-[cubic-bezier(0.2,0,0,1)] focus-visible:outline-none ${
                            active ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:bg-white/[0.05] hover:text-zinc-200'
                        }`}
                    >
                        {active && (
                            <span
                                aria-hidden
                                className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-gradient-to-b from-brand-start via-brand-mid to-brand-end"
                            />
                        )}
                        <Icon className="h-5 w-5" />
                    </button>
                );
            })}
            <div className="mt-auto flex flex-col items-center gap-2">
                <button
                    type="button"
                    title="Settings"
                    aria-label="Settings"
                    onClick={onOpenSettings}
                    className="flex h-11 w-11 items-center justify-center rounded-xl text-zinc-500 transition-colors hover:bg-white/[0.05] hover:text-zinc-200"
                >
                    <SettingsIcon className="h-5 w-5" />
                </button>
                <span
                    title={username || 'Account'}
                    className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-zinc-800 text-[11px] font-semibold text-zinc-300"
                >
                    {initial}
                </span>
            </div>
        </nav>
    );
};

export default React.memo(NavRail);
