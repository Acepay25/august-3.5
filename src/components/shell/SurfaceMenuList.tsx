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
 * Below the surfaces sit Approvals (one drawer, counted) and Switch profile.
 * This row was renamed "Trade approvals" on the theory that the drawer holds
 * only auto-journal gating — wrong: `collectApprovalItems` also pushes every
 * pending skill draft (`kind: 'skill'`, utils/approvalInbox.ts) with a working
 * Allow button. A label that names half the contents is worse than a general
 * one, because it teaches the reader the other half isn't there. The skill
 * drafts' own home is Learning → Approvals; this row stays honest about
 * being the mixed tray.
 */

import React, { useSyncExternalStore } from 'react';
import {ActivityIcon, FileTextIcon, LayersIcon, BotIcon, GraduationCap} from '../shared/Icons';
import Tip from '../ui/Tip';
import RunBusyBadge from '../chat/RunBusyBadge';
import { subscribe, getSnapshot } from '../../services/trade/chatStore';

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
    // NAMED FOR WHAT IT DOES (owner ruling, 2026-10-29: "Trade does not
    // trade"). The four labels name the function — Analyze, Journal, Agents,
    // Learning — while the ids stay `trade` / `journal` / `agents` / `learn`:
    // dozens of gates pin the ids and their testids independently of the
    // label, and renaming an id would churn all of them for no user-visible
    // gain. A label is a promise; "Trade" promised execution this surface
    // never performs.
    { id: 'trade', label: 'Analyze', shortcut: 'Alt+1', Icon: ActivityIcon },
    { id: 'journal', label: 'Journal', shortcut: 'Alt+2', Icon: FileTextIcon },
    // 'skills' is NOT a surface any more — the Strategy Studio is the Skills
    // SETTINGS tab. Its Alt+3 chord and its LayersIcon survive on the
    // Customize row below, so the muscle memory and the glyph both keep their
    // meaning; only the destination changed. Agents/Learning keep Alt+4/Alt+5
    // rather than sliding up a slot and breaking every chord at once.
    // The id stays `agents` because a dozen gates pin it independently of the
    // label (surfaceMenu.test asserts onSelect('agents'), and agents-view /
    // agents-rail / chart-ai-row are testids across agentsSurface.test,
    // deadControlsGuard and the probe).
    // The RAIL keeps its own "Agents" pill naming the bot roster inside this
    // surface — the same word for the surface and its roster is intended.
    { id: 'agents', label: 'Agents', shortcut: 'Alt+4', Icon: BotIcon },
    // Approvals, Skills, Memory and Health are tabs of this one surface: it
    // governs what the app LEARNED, which is why the label is Learning and no
    // longer Knowledge (a library you browse) or Learn (an action that hid the
    // library entirely).
    { id: 'learn', label: 'Learning', shortcut: 'Alt+5', Icon: GraduationCap },
];

export const surfaceLabel = (id: AppSurface): string =>
    SURFACE_ITEMS.find(i => i.id === id)?.label ?? 'Analyze';

interface SurfaceMenuListProps {
    surface: AppSurface;
    onSelect: (surface: AppSurface) => void;
    /** The Customize row: opens the Learning surface on its Skills tab. Not a
     *  surface id of its own, so it never claims `aria-current="page"` — it is a
     *  route into a tab. */
    onOpenCustomize?: () => void;
    badges?: Partial<Record<AppSurface, NavBadge>>;
    /** 56px rail mode: glyph only, no label column and no shortcut column. */
    collapsed?: boolean;
    /** Render only the non-destination rows. See the note in the component. */
    hideSurfaces?: boolean;
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
    onOpenCustomize,
    badges,
    collapsed = false,
    hideSurfaces = false,
}) => {
    /**
     * Is a conversation still running?
     *
     * A Chat-surface run now survives a conversation switch (E-45: the run
     * belongs to the conversation it was typed in, and a switch moves the
     * view), so a run can be alive in a thread the trader is not looking at.
     * The Chat row says so — otherwise a background answer reads as a hang.
     *
     * A BOOLEAN snapshot: React bails out of the re-render when nothing
     * changed, so the nav does not repaint on every streamed token.
     */
    const chatRunning = useSyncExternalStore(
        subscribe,
        () => Object.keys(getSnapshot().conversationRunning).length > 0,
    );

    return (
    <nav
        aria-label="Surfaces"
        data-testid="surface-menu"
        className={`shrink-0 ${collapsed ? 'px-1.5 pt-2 pb-1' : 'px-2 pt-3 pb-1'}`}
    >
        {/* The destination rows are the tab strip the redesign was asked to
            remove; the title-bar switch replaced them on every surface. The
            Chat sidebar still wants the ONE row that is not a destination —
            Customize — so the list can render without the surfaces instead of
            growing a second, smaller component that would drift from this one. */}
        {!hideSurfaces && SURFACE_ITEMS.map(({ id, label, shortcut, Icon }) => {
            const active = surface === id;
            const badge = badges?.[id];
            /* The busy sentence is spoken through the row's accessible name,
               the same way the badge count is — the dot itself is decoration
               (aria-hidden), and a dot a screen reader cannot read is not an
               announcement. */
            const busy = id === 'agents' && chatRunning;
            /* aria-label replaces the row's content for assistive tech, so the
               shortcut has to be spelled out here — at 280px the visible <kbd>
               would otherwise exist for the mouse only, and in the collapsed
               rail there is no visible content at all. */
            const accessibleName = busy
                ? `${label}. A conversation is still running${badge ? `, ${badge.detail}` : ''}, shortcut ${shortcut}`
                : badge
                ? `${label}. ${badge.detail}, shortcut ${shortcut}`
                : `${label}, shortcut ${shortcut}`;
            const row = (
                <button
                    key={id}
                    type="button"
                    onClick={() => onSelect(id)}
                    aria-current={active ? 'page' : undefined}
                    aria-label={accessibleName}
                    className={`group relative flex w-full items-center rounded-control transition-colors duration-[120ms] ease-[var(--ease-snappy)] ${
                        collapsed
                            ? 'justify-center px-2 py-2'
                            : 'gap-2.5 px-2.5 py-2 text-left text-ui-caption'
                    } ${active ? 'text-zinc-100' : 'text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100'}`}
                >
                    {active && (
                        <span
                            aria-hidden
                            className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-zinc-100"
                        />
                    )}
                    <span className="relative shrink-0">
                        <Icon className="h-4 w-4 text-zinc-500" aria-hidden="true" />
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
                    {!collapsed && <span className="flex-1 truncate" title={label}>{label}</span>}
                    {!collapsed && badge && <Badge badge={badge} />}
                    {/* "Still running" — the dot rides the row, and the sentence
                        is in the row's accessible name above. The colour comes
                        from the run-status vocabulary, never typed here. */}
                    {busy && <RunBusyBadge className="ml-1" aria-hidden="true" />}
                    {!collapsed && (
                        <kbd className="shrink-0 opacity-0 transition-opacity duration-[120ms] group-hover:opacity-100 group-focus-visible:opacity-100 rounded-control border border-white/5 bg-zinc-800 px-1.5 py-0.5 font-mono text-ui-2xs text-zinc-500">{shortcut}</kbd>
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

        {/* No Approvals row. It was a second way into the surface below it, with
            the same count on both, so one screen showed "Approvals 12" twice —
            and the number now rides the Learning row that actually holds the
            queue. */}

        {onOpenCustomize && (
            <button
                type="button"
                data-testid="nav-customize"
                onClick={onOpenCustomize}
                aria-label="Customize, shortcut Alt+3"
                className={`group flex w-full items-center rounded-control py-2 transition-colors hover:bg-white/[0.06] hover:text-zinc-100 ${
                    collapsed ? 'justify-center px-2 text-zinc-400' : 'gap-2.5 px-2.5 text-left text-ui-caption text-zinc-400'
                }`}
            >
                <LayersIcon className="h-4 w-4 shrink-0 text-zinc-500" aria-hidden="true" />
                {!collapsed && <span className="flex-1">Customize</span>}
                {!collapsed && (
                    <kbd className="shrink-0 opacity-0 transition-opacity duration-[120ms] group-hover:opacity-100 group-focus-visible:opacity-100 rounded-control border border-white/5 bg-zinc-800 px-1.5 py-0.5 font-mono text-ui-2xs text-zinc-500">Alt+3</kbd>
                )}
            </button>
        )}

        {/* Switch profile moved to the account row (NavRail): profile actions
            belong on the profile row, not as a sixth nav entry. */}
    </nav>
    );
};

export default React.memo(SurfaceMenuList);
