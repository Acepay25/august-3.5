/**
 * NavRail — Antigravity's left panel: an activity bar of surface icons
 * (VS Code-style). Clicking a surface switches views; clicking the active
 * icon toggles its side panel. The active icon carries the brand gradient
 * indicator.
 * At the bottom: Settings button and User Profile trigger with a floating
 * context menu (Settings, Profile, Changelog, Switch User) matching the
 * reference design.
 */

import React, { useState, useRef, useEffect } from 'react';
import {
    ActivityIcon,
    FileTextIcon,
    SparklesIcon,
    BotIcon,
    SettingsIcon,
} from '../shared/Icons';
import { User, Settings, History, LogOut, GraduationCap } from 'lucide-react';
import Tip from '../ui/Tip';
import type { AppSurface } from '../../hooks/useSurface';

/** Live activity on a surface: `active` pulses an amber dot, `count` upgrades
 *  it to a numeric pill. Both are announced through the button's accessible
 *  name rather than a separate live region — the dot is decoration. */
export interface NavBadge {
    active?: boolean;
    count?: number;
    /** Sentence completing "Agents — …" for screen readers and the tooltip. */
    detail: string;
}

interface NavRailProps {
    surface: AppSurface;
    onSelect: (surface: AppSurface) => void;
    /** Clicking the ALREADY-active surface calls this instead of onSelect —
     *  the surfaces with a sidebar (trade) toggle it open/closed. */
    onToggleSidebar: () => void;
    onOpenSettings: (tab?: string) => void;
    onOpenVersionHistory?: () => void;
    onSwitchUser?: () => void;
    username?: string;
    badges?: Partial<Record<AppSurface, NavBadge>>;
}

/** `shortcut` mirrors the real bindings in App.tsx's key handler
 *  (Alt+1..5 for surfaces, Ctrl/Cmd+, for Settings) — Alt rather than Ctrl
 *  because Ctrl+number is the browser/Electron tab switch. */
const ITEMS: Array<{
    id: AppSurface;
    label: string;
    shortcut: string;
    Icon: React.FC<{ className?: string }>;
}> = [
    { id: 'trade', label: 'Trade', shortcut: 'Alt+1', Icon: ActivityIcon },
    { id: 'journal', label: 'Journal', shortcut: 'Alt+2', Icon: FileTextIcon },
    { id: 'studio', label: 'Studio', shortcut: 'Alt+3', Icon: SparklesIcon },
    { id: 'agents', label: 'Agents', shortcut: 'Alt+4', Icon: BotIcon },
    { id: 'learn', label: 'Learn', shortcut: 'Alt+5', Icon: GraduationCap },
];

/** Surfaces with a collapsible sidebar of their own. */
const HAS_PANEL: ReadonlySet<AppSurface> = new Set(['trade']);

const NavRail: React.FC<NavRailProps> = ({
    surface,
    onSelect,
    onToggleSidebar,
    onOpenSettings,
    onOpenVersionHistory,
    onSwitchUser,
    username,
    badges,
}) => {
    const initial = (username || '?').trim().charAt(0).toUpperCase();
    const [userMenuOpen, setUserMenuOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);

    // Close user menu on click outside or escape
    useEffect(() => {
        if (!userMenuOpen) return;
        const handleDown = (e: MouseEvent) => {
            if (
                menuRef.current &&
                !menuRef.current.contains(e.target as Node) &&
                buttonRef.current &&
                !buttonRef.current.contains(e.target as Node)
            ) {
                setUserMenuOpen(false);
            }
        };
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setUserMenuOpen(false);
        };
        document.addEventListener('mousedown', handleDown);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('mousedown', handleDown);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [userMenuOpen]);

    return (
        <nav
            aria-label="Surfaces"
            data-testid="nav-rail"
            className="relative flex w-12 shrink-0 flex-col items-center gap-1 border-r border-white/[0.06] bg-zinc-900 py-2 z-30"
        >
            {ITEMS.map(({ id, label, shortcut, Icon }) => {
                const active = surface === id;
                // Only Trade has a sidebar to collapse. Advertising "toggle
                // panel" on the others was a lie — the click flipped the trade
                // sidebar state behind a surface that could not show it.
                const toggleable = active && HAS_PANEL.has(id);
                const badge = badges?.[id];
                const badgeCount = badge?.count && badge.count > 0 ? badge.count : 0;
                const showBadge = !!badge && (badgeCount > 0 || !!badge.active);
                return (
                    <Tip
                        key={id}
                        side="right"
                        label={toggleable ? `${label} — toggle panel` : badge ? `${label} · ${badge.detail}` : label}
                        shortcut={shortcut}
                    >
                        <button
                            type="button"
                            aria-label={`${badge ? `${label}. ${badge.detail}` : label}${toggleable ? ' — toggle panel' : ''}${shortcut ? `, shortcut ${shortcut}` : ''}`}
                            aria-current={active ? 'page' : undefined}
                            onClick={() => (toggleable ? onToggleSidebar() : onSelect(id))}
                            className={`relative flex h-10 w-10 items-center justify-center rounded-xl transition-colors duration-100 ease-[cubic-bezier(0.2,0,0,1)] focus-visible:outline-none ${
                                active ? 'text-zinc-100' : 'text-zinc-500 hover:bg-white/[0.05] hover:text-zinc-200'
                            }`}
                        >
                            {active && (
                                <span
                                    aria-hidden
                                    className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-gradient-to-b from-brand-start via-brand-mid to-brand-end shadow-[0_0_8px_rgba(235,83,255,0.4)]"
                                />
                            )}
                            <Icon className="h-[18px] w-[18px]" />
                            {showBadge && (badgeCount > 0 ? (
                                <span
                                    aria-hidden
                                    className={`absolute right-0.5 top-0.5 flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-amber-500 px-1 font-mono text-[9px] font-bold leading-none text-zinc-950 ring-2 ring-zinc-900 ${badge?.active ? 'animate-pulse' : ''}`}
                                >
                                    {badgeCount > 99 ? '99+' : badgeCount}
                                </span>
                            ) : (
                                <span aria-hidden className="absolute right-2 top-2 h-2 w-2 animate-pulse rounded-full bg-amber-400 ring-2 ring-zinc-900" />
                            ))}
                        </button>
                    </Tip>
                );
            })}
            <div className="mt-auto flex flex-col items-center gap-2 relative">
                <Tip side="right" label="Settings" shortcut="Ctrl+,">
                    <button
                        type="button"
                        aria-label="Settings, shortcut Ctrl+,"
                        onClick={() => onOpenSettings()}
                        className="flex h-10 w-10 items-center justify-center rounded-xl text-zinc-500 transition-colors hover:bg-white/[0.05] hover:text-zinc-200"
                    >
                        <SettingsIcon className="h-[18px] w-[18px]" />
                    </button>
                </Tip>

                {/* User Avatar Button */}
                <button
                    ref={buttonRef}
                    type="button"
                    title={username ? `${username} — Account menu` : 'Account menu'}
                    aria-label="Account menu"
                    aria-expanded={userMenuOpen}
                    onClick={() => setUserMenuOpen(prev => !prev)}
                    className="relative flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-zinc-800 text-[10px] font-semibold text-zinc-300 transition-transform hover:scale-105 hover:border-white/25 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500"
                >
                    {initial}
                    <span className="sr-only">{username || 'User account'}</span>
                </button>

                {/* Floating User Context Menu (Reference Image 3) */}
                {userMenuOpen && (
                    <div
                        ref={menuRef}
                        role="menu"
                        aria-label="Account menu"
                        className="absolute bottom-0 left-12 ml-2 z-50 w-56 rounded-xl border border-white/10 bg-zinc-900/95 p-1.5 shadow-2xl backdrop-blur-md animate-fade-in text-xs text-zinc-300"
                    >
                        {/* Profile Header */}
                        <div className="flex items-center gap-2.5 px-2.5 py-2 border-b border-white/[0.06] mb-1">
                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/10 bg-zinc-800 text-xs font-bold text-zinc-100">
                                {initial}
                            </span>
                            <div className="min-w-0 flex-1">
                                <p className="truncate font-semibold text-zinc-100">{username || 'Trader'}</p>
                                <p className="truncate text-[10px] text-zinc-500">Active Profile</p>
                            </div>
                        </div>

                        {/* Menu Actions */}
                        <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                                setUserMenuOpen(false);
                                onOpenSettings('profile');
                            }}
                            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-white/[0.06] hover:text-zinc-100 transition-colors"
                        >
                            <User className="h-3.5 w-3.5 text-zinc-400" />
                            <span>Profile</span>
                        </button>

                        <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                                setUserMenuOpen(false);
                                onOpenSettings('general');
                            }}
                            className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left hover:bg-white/[0.06] hover:text-zinc-100 transition-colors"
                        >
                            <div className="flex items-center gap-2.5">
                                <Settings className="h-3.5 w-3.5 text-zinc-400" />
                                <span>Settings</span>
                            </div>
                            <kbd className="font-mono text-[9px] text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded border border-white/5">Ctrl+,</kbd>
                        </button>

                        {onOpenVersionHistory && (
                            <button
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                    setUserMenuOpen(false);
                                    onOpenVersionHistory();
                                }}
                                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-white/[0.06] hover:text-zinc-100 transition-colors"
                            >
                                <History className="h-3.5 w-3.5 text-zinc-400" />
                                <span>System Intelligence</span>
                            </button>
                        )}

                        <div className="my-1 border-t border-white/[0.06]" />

                        {onSwitchUser && (
                            <button
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                    setUserMenuOpen(false);
                                    onSwitchUser();
                                }}
                                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-rose-400 hover:bg-rose-500/10 hover:text-rose-300 transition-colors"
                            >
                                <LogOut className="h-3.5 w-3.5" />
                                <span>Switch Profile</span>
                            </button>
                        )}
                    </div>
                )}
            </div>
        </nav>
    );
};

export default React.memo(NavRail);
