/**
 * SurfaceMenuList — the five surfaces.
 *
 * Rendered twice from one list because the nav rail has two widths and the
 * surface set must not be able to drift between them: at 280px a row shows
 * icon, name, live badge and its shortcut; at 56px the same row collapses to
 * the glyph alone, keeping `aria-current`, the badge dot and an accessible
 * name that still carries the shortcut. The collapsed rows are the SAME
 * buttons, not a parallel icon set — a surface that could render in one width
 * and not the other is exactly the drift a single list prevents.
 *
 * Below the surfaces sit Trade approvals (one drawer, counted) and Switch
 * profile. It is named for what it holds: the drawer is the auto-journal and
 * replace-or-expire queue in utils/approvalInbox, NOT the skill drafts, which
 * wait on Learn → Skill queue. Two inboxes both called "Approvals" is how the
 * list a person is hunting for becomes unfindable.
 */

import React from 'react';
import {ActivityIcon, FileTextIcon, LayersIcon, BotIcon, GraduationCap, Inbox} from '../shared/Icons';
import Tip from '../ui/Tip';

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
    { id: 'studio', label: 'Studio', shortcut: 'Alt+3', Icon: LayersIcon },
    // The surface is called Chat; the id stays `agents` because a dozen gates
    // pin it independently of the label (surfaceMenu.test asserts
    // onSelect('agents'), and agents-view / agents-rail / chart-ai-row are
    // testids across agentsSurface.test, deadControlsGuard and the probe).
    // Renaming the id would churn all of them for no user-visible gain.
    // The RAIL keeps its own "Agents" pill — that names the bot roster, which
    // is a section of this surface, not the surface itself.
    { id: 'agents', label: 'Chat', shortcut: 'Alt+4', Icon: BotIcon },
    { id: 'learn', label: 'Learn', shortcut: 'Alt+5', Icon: GraduationCap },
];

export const surfaceLabel = (id: AppSurface): string =>
    SURFACE_ITEMS.find(i => i.id === id)?.label ?? 'Trade';

interface SurfaceMenuListProps {
    surface: AppSurface;
    onSelect: (surface: AppSurface) => void;
    onOpenApprovals?: () => void;
    approvalsCount?: number;
    badges?: Partial<Record<AppSurface, NavBadge>>;
    /** 56px rail mode: glyph only, no label column and no shortcut column. */
    collapsed?: boolean;
}

const Badge: React.FC<{ badge: NavBadge }> = ({ badge }) => {
    const count = badge.count && badge.count > 0 ? badge.count : 0;
    return count > 0 ? (
        <span className={`shrink-0 rounded-full bg-amber-500 px-1.5 font-mono text-ui-2xs font-bold leading-[14px] text-zinc-950 ${badge.active ? 'animate-pulse' : ''}`}>
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
    badges,
    collapsed = false,
}) => (
    <nav
        aria-label="Surfaces"
        data-testid="surface-menu"
        className={`shrink-0 ${collapsed ? 'px-1.5 pt-2 pb-1' : 'px-2 pt-3 pb-1'}`}
    >
        {SURFACE_ITEMS.map(({ id, label, shortcut, Icon }) => {
            const active = surface === id;
            const badge = badges?.[id];
            /* aria-label replaces the row's content for assistive tech, so the
               shortcut has to be spelled out here — at 280px the visible <kbd>
               would otherwise exist for the mouse only, and in the collapsed
               rail there is no visible content at all. */
            const accessibleName = badge
                ? `${label}. ${badge.detail}, shortcut ${shortcut}`
                : `${label}, shortcut ${shortcut}`;
            const row = (
                <button
                    key={id}
                    type="button"
                    onClick={() => onSelect(id)}
                    aria-current={active ? 'page' : undefined}
                    aria-label={accessibleName}
                    className={`group relative flex w-full items-center rounded-lg transition-colors duration-[120ms] ease-[var(--ease-snappy)] ${
                        collapsed
                            ? 'justify-center px-2 py-2'
                            : 'gap-2.5 px-2.5 py-2 text-left text-ui-caption'
                    } ${active ? 'text-zinc-100' : 'text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100'}`}
                >
                    {active && (
                        <span
                            aria-hidden
                            className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-gradient-to-b from-brand-start via-brand-mid to-brand-end shadow-[0_0_8px_rgba(235,83,255,0.4)]"
                        />
                    )}
                    <span className="relative shrink-0">
                        <Icon className="h-4 w-4 text-zinc-500" />
                        {/* In the rail a badge dot has no row beside it to sit in,
                           so it rides the glyph. Decorative either way — the
                           count is spoken through the row's accessible name. */}
                        {collapsed && badge && (
                            <span className="absolute -right-0.5 -top-0.5 flex h-1.5 w-1.5">
                                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-60" />
                                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber-400" />
                            </span>
                        )}
                    </span>
                    {!collapsed && <span className="flex-1 truncate">{label}</span>}
                    {!collapsed && badge && <Badge badge={badge} />}
                    {!collapsed && (
                        <kbd className="shrink-0 opacity-0 transition-opacity duration-[120ms] group-hover:opacity-100 group-focus-visible:opacity-100 rounded border border-white/5 bg-zinc-800 px-1.5 py-0.5 font-mono text-ui-2xs text-zinc-500">{shortcut}</kbd>
                    )}
                </button>
            );
            /* Tooltip only in the collapsed rail, where the glyph is the only
               thing visible — the anti-tax rule says a tip earns its place when
               hover teaches something the screen does not already show. */
            return collapsed
                ? <Tip key={id} label={label} shortcut={shortcut}>{row}</Tip>
                : row;
        })}

        {onOpenApprovals && <div className="my-2 border-t border-white/[0.06]" />}

        {onOpenApprovals && (
            <button
                type="button"
                data-testid="nav-approvals"
                onClick={onOpenApprovals}
                aria-label={approvalsCount ? `Trade approvals, ${approvalsCount} waiting` : 'Trade approvals'}
                className={`flex w-full items-center rounded-lg py-2 transition-colors hover:bg-white/[0.06] hover:text-zinc-100 ${
                    collapsed ? 'justify-center px-2 text-zinc-400' : 'gap-2.5 px-2.5 text-left text-ui-caption text-zinc-400'
                }`}
            >
                <span className="relative shrink-0">
                    <Inbox className="h-4 w-4 text-zinc-500" />
                    {collapsed && !!approvalsCount && (
                        <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-amber-400" />
                    )}
                </span>
                {!collapsed && <span className="flex-1">Trade approvals</span>}
                {!collapsed && !!approvalsCount && (
                    <span className="shrink-0 rounded-full bg-amber-500 px-1.5 font-mono text-ui-2xs font-bold leading-[14px] text-zinc-950">
                        {approvalsCount > 99 ? '99+' : approvalsCount}
                    </span>
                )}
            </button>
        )}

        {/* Switch profile moved to the account row (NavRail): profile actions
            belong on the profile row, not as a sixth nav entry. */}
    </nav>
);

export default React.memo(SurfaceMenuList);
