/**
 * The surface switch — the v2 design's tab strip: text tabs riding the
 * topbar's full height, the active one marked by an ink underline on the bar's
 * bottom hairline. The brand gradient that used to be that marker was retired
 * (owner ruling, 2026-10-27), so the strip is monochrome and the active tab is
 * named by weight and by `aria-current`, not by colour.
 *
 * It replaces the destination ROWS that used to stand in the sidebar. Those rows
 * were the thing the redesign was asked to remove, and the earlier passes only
 * renamed them (Learn → Knowledge, Approvals and Skills demoted to tabs; then
 * the 2026-10-29 ruling named all four for their function — Analyze, Journal,
 * Agents, Learning — because "Trade" promised execution the surface never
 * performs), so the same list survived with better labels. In the reference there is no surface
 * list in the sidebar at all: the sidebar holds conversations and Customize, and
 * navigation lives in the topbar. This is that control.
 *
 * It reads `SURFACE_ITEMS` rather than declaring its own list, so a surface added
 * for the keyboard chords (Alt+1..5) appears here automatically — the drift this
 * repo keeps hitting is a second copy of the destination set.
 *
 * Pressed state, not `.seg-thumb`: the doctrine bans the sliding thumb on a
 * container because it resolves against the nearest positioned ancestor and
 * inflates to fill the surface (docs/product/ux/charter.md).
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
    <nav role="group" aria-label="Screens" className="flex min-w-0 items-stretch self-stretch overflow-x-auto">
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
                    className={`hit-target relative flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 text-ui-sm font-medium transition-colors duration-150 ease-[var(--ease-snappy)] ${
                        current
                            ? 'text-zinc-100'
                            : 'text-zinc-500 hover:text-zinc-300'
                    }`}
                >
                    <Icon className={`h-3.5 w-3.5 ${current ? 'text-zinc-200' : 'text-zinc-500'}`} aria-hidden="true" />
                    <span className="hidden md:inline">{label}</span>
                    {badge?.count ? (
                        /* The count has to survive the rows' removal — it is the
                           only signal that a screen is waiting on you. It rides
                           the glyph as a dot-plus-number rather than a wide pill,
                           because this control sits in a topbar that also has
                           to fit at 430px. */
                        <span
                            aria-hidden
                            className="absolute right-1 top-2.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-amber-500 px-0.5 font-mono text-ui-2xs font-bold leading-none text-zinc-950"
                        >
                            {badge.count > 9 ? '9+' : badge.count}
                        </span>
                    ) : null}
                    {current && (
                        /* The active marker. It was the brand gradient — the one
                           place besides the wordmark the design reserved it for —
                           and the gradient was retired on 2026-10-27, so the
                           marker is ink now: same position, same job, no hue. */
                        <span
                            aria-hidden="true"
                            className="absolute inset-x-3 bottom-0 h-0.5 rounded-t-full bg-zinc-100"
                        />
                    )}
                </button>
            );
        })}
    </nav>
);

export default React.memo(SurfaceSwitch);
