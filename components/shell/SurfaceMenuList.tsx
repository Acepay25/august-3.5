/**
 * SurfaceMenuList — the five surfaces, now reached from the header's hamburger
 * instead of the always-visible icon rail. One row per surface: icon, name,
 * keyboard shortcut and live badge, with the active row carrying the brand
 * gradient bar the rail used to wear.
 *
 * Below the surfaces sit the two rail leftovers that have no other home:
 * Approvals (one drawer, counted) and Switch profile.
 */

import React from 'react';
import {
    ActivityIcon,
    FileTextIcon,
    SparklesIcon,
    BotIcon,
} from '../shared/Icons';
import { GraduationCap, Inbox, LogOut } from 'lucide-react';
import type { AppSurface } from '../../hooks/useSurface';

/** Live activity on a surface: `active` pulses an amber dot, `count` upgrades
 *  it to a numeric pill. Both are announced through the row's accessible name
 *  rather than a separate live region — the dot is decoration. */
export interface NavBadge {
    active?: boolean;
    count?: number;
    /** Sentence completing "Agents — …" for screen readers and the tooltip. */
    detail: string;
}

/** `shortcut` mirrors the real bindings in App.tsx's key handler
 *  (Alt+1..5 for surfaces) — Alt rather than Ctrl because Ctrl+number is the
 *  browser/Electron tab switch. Exported so the hamburger button can name the
 *  surface it currently stands for without a second copy of the list. */
export const SURFACE_ITEMS: Array<{
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

export const surfaceLabel = (id: AppSurface): string =>
    SURFACE_ITEMS.find(i => i.id === id)?.label ?? 'Trade';

interface SurfaceMenuListProps {
    surface: AppSurface;
    onSelect: (surface: AppSurface) => void;
    onOpenApprovals?: () => void;
    approvalsCount?: number;
    onSwitchUser?: () => void;
    badges?: Partial<Record<AppSurface, NavBadge>>;
}

const Badge: React.FC<{ badge: NavBadge }> = ({ badge }) => {
    const count = badge.count && badge.count > 0 ? badge.count : 0;
    return count > 0 ? (
        <span className={`shrink-0 rounded-full bg-amber-500 px-1.5 font-mono text-[9px] font-bold leading-[14px] text-zinc-950 ${badge.active ? 'animate-pulse' : ''}`}>
            {count > 99 ? '99+' : count}
        </span>
    ) : (
        <span aria-hidden className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-amber-400" />
    );
};

const SurfaceMenuList: React.FC<SurfaceMenuListProps> = ({
    surface,
    onSelect,
    onOpenApprovals,
    approvalsCount,
    onSwitchUser,
    badges,
}) => (
    <nav aria-label="Surfaces" data-testid="surface-menu" className="shrink-0 px-2 pt-3 pb-1">
        {SURFACE_ITEMS.map(({ id, label, shortcut, Icon }) => {
            const active = surface === id;
            const badge = badges?.[id];
            return (
                <button
                    key={id}
                    type="button"
                    onClick={() => onSelect(id)}
                    aria-current={active ? 'page' : undefined}
                    /* aria-label replaces the row's content for assistive tech,
                       so the shortcut has to be spelled out here — the visible
                       <kbd> would otherwise exist for the mouse only. */
                    aria-label={badge ? `${label}. ${badge.detail}, shortcut ${shortcut}` : `${label}, shortcut ${shortcut}`}
                    className={`relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors duration-[120ms] ease-[var(--ease-snappy)] ${
                        active ? 'text-zinc-100' : 'text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100'
                    }`}
                >
                    {active && (
                        <span
                            aria-hidden
                            className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-gradient-to-b from-brand-start via-brand-mid to-brand-end shadow-[0_0_8px_rgba(235,83,255,0.4)]"
                        />
                    )}
                    <Icon className="h-4 w-4 shrink-0 text-zinc-500" />
                    <span className="flex-1 truncate">{label}</span>
                    {badge && <Badge badge={badge} />}
                    <kbd className="shrink-0 rounded border border-white/5 bg-zinc-800 px-1.5 py-0.5 font-mono text-[9px] text-zinc-500">{shortcut}</kbd>
                </button>
            );
        })}

        {(onOpenApprovals || onSwitchUser) && <div className="my-2 border-t border-white/[0.06]" />}

        {onOpenApprovals && (
            <button
                type="button"
                data-testid="nav-approvals"
                onClick={onOpenApprovals}
                aria-label={approvalsCount ? `Approvals, ${approvalsCount} waiting` : 'Approvals'}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-zinc-400 transition-colors hover:bg-white/[0.06] hover:text-zinc-100"
            >
                <Inbox className="h-4 w-4 shrink-0 text-zinc-500" />
                <span className="flex-1">Approvals</span>
                {!!approvalsCount && (
                    <span className="shrink-0 rounded-full bg-amber-500 px-1.5 font-mono text-[9px] font-bold leading-[14px] text-zinc-950">
                        {approvalsCount > 99 ? '99+' : approvalsCount}
                    </span>
                )}
            </button>
        )}

        {onSwitchUser && (
            <button
                type="button"
                data-testid="nav-switch-user"
                onClick={onSwitchUser}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-rose-400 transition-colors hover:bg-rose-500/10 hover:text-rose-300"
            >
                <LogOut className="h-4 w-4 shrink-0" />
                <span className="flex-1">Switch profile</span>
            </button>
        )}
    </nav>
);

export default React.memo(SurfaceMenuList);
