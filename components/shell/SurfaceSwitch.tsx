/**
 * The surface switch — Claude's title-bar chat / `</>` pair, widened to this
 * app's four screens.
 *
 * It replaces the destination ROWS that used to stand in the sidebar. Those rows
 * were the thing the redesign was asked to remove, and the earlier passes only
 * renamed them (Learn → Knowledge, Approvals and Skills demoted to tabs), so the
 * same list survived with better labels. In the reference there is no surface
 * list in the sidebar at all: the sidebar holds conversations and Customize, and
 * the mode switch lives in the title bar beside the back/forward chrome. This is
 * that control.
 *
 * It reads `SURFACE_ITEMS` rather than declaring its own list, so a surface added
 * for the keyboard chords (Alt+1..5) appears here automatically — the drift this
 * repo keeps hitting is a second copy of the destination set.
 *
 * Pressed state, not `.seg-thumb`: the doctrine bans the sliding thumb on a
 * container because it resolves against the nearest positioned ancestor and
 * inflates to fill the surface (docs/ui-doctrine.md).
 */
import React from 'react';
import { SURFACE_ITEMS } from './SurfaceMenuList';
import type { AppSurface } from '../../hooks/useSurface';

interface SurfaceSwitchProps {
    surface: AppSurface;
    onSelect: (surface: AppSurface) => void;
    /** Live activity on a surface, so the count the rows used to carry is not
     *  lost when the rows go. */
    badges?: Partial<Record<AppSurface, { count?: number; detail: string }>>;
}

const SurfaceSwitch: React.FC<SurfaceSwitchProps> = ({ surface, onSelect, badges }) => (
    <div
        role="group"
        aria-label="Screens"
        className="flex shrink-0 items-center gap-0.5 rounded-control border border-zinc-800 p-0.5"
    >
        {SURFACE_ITEMS.map(({ id, label, shortcut, Icon }) => {
            const current = id === surface;
            const badge = badges?.[id];
            return (
                <button
                    key={id}
                    type="button"
                    onClick={current ? undefined : () => onSelect(id)}
                    aria-current={current ? 'page' : undefined}
                    aria-label={badge
                        ? `${label}. ${badge.detail}, shortcut ${shortcut}`
                        : `${label}, shortcut ${shortcut}`}
                    title={badge
                        ? `${label} — ${badge.detail} · ${shortcut}`
                        : `${label} · ${shortcut}`}
                    data-testid={`surface-switch-${id}`}
                    className={`hit-target relative rounded-control p-1 transition-colors ${
                        current
                            ? 'bg-zinc-800 text-zinc-100'
                            : 'text-zinc-500 hover:bg-white/[0.05] hover:text-zinc-200'
                    }`}
                >
                    <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                    {badge?.count ? (
                        /* The count has to survive the rows' removal — it is the
                           only signal that a screen is waiting on you. It rides
                           the glyph as a dot-plus-number rather than a wide pill,
                           because this control sits in a title bar that also has
                           to fit at 430px. */
                        <span
                            aria-hidden
                            className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-amber-500 px-0.5 font-mono text-ui-2xs font-bold leading-none text-zinc-950"
                        >
                            {badge.count > 9 ? '9+' : badge.count}
                        </span>
                    ) : null}
                </button>
            );
        })}
    </div>
);

export default React.memo(SurfaceSwitch);
