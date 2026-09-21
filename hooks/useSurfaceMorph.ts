/**
 * useSurfaceMorph — the Chart AI → Agents transition.
 *
 * The dock and the Agents pane show the SAME conversation (utils/agentThreads
 * is the single thread model, and both mount it), so jumping between them read
 * as a page swap when it is really one panel moving. App measures the dock
 * while Chart is still on screen, hands that box down, and this FLIPs the
 * incoming pane from it into its own bounds — translate + scale on the
 * compositor, so nothing reflows and no animation library is needed.
 *
 * Skipped when the trader asked for stillness: the OS
 * prefers-reduced-motion signal, or the desk's own idle-motion switch (the
 * `.desk-idle-motion-off` body class services/desk/idleMotion maintains).
 */

import { useLayoutEffect, type RefObject } from 'react';

export interface MorphRect {
    left: number;
    top: number;
    width: number;
    height: number;
}

/** Above the .12–.18s chrome window on purpose: this is a surface change, not
 *  a hover, and anything shorter reads as a flicker rather than a move. */
export const MORPH_DURATION_MS = 260;

/** The Chart AI dock wherever the trade layout currently keeps it — the
 *  drag-resized panel, or the narrow rail it collapses to. */
const DOCK_SELECTOR = '[data-testid="trade-dock"], [data-testid="trade-dock-rail"]';

/** Where the dock sits right now — the box the next surface grows out of.
 *  Null when there is no dock on screen (a different surface). */
export const captureChartAiRect = (): MorphRect | null => {
    if (typeof document === 'undefined') return null;
    const el = document.querySelector<HTMLElement>(DOCK_SELECTOR);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return { left: r.left, top: r.top, width: r.width, height: r.height };
};

const motionAllowed = (): boolean => {
    try {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
        if (document.body.classList.contains('desk-idle-motion-off')) return false;
    } catch {
        // No matchMedia (jsdom) — treat as stillness rather than inventing motion.
        return false;
    }
    return true;
};

/**
 * Animate `ref` in from `from`. The caller owns `from` and is expected to
 * refresh or clear it on every navigation, so a stale box cannot replay on a
 * later, unrelated visit to this surface.
 */
export const useSurfaceMorphIn = (
    ref: RefObject<HTMLElement | null>,
    from: MorphRect | null,
): void => {
    useLayoutEffect(() => {
        if (!from) return;
        const el = ref.current;
        // jsdom has no Element.animate, and a pane that never painted has no
        // geometry to flip from.
        if (!el || typeof el.animate !== 'function' || !motionAllowed()) return;
        const to = el.getBoundingClientRect();
        if (!to.width || !to.height) return;
        const anim = el.animate(
            [
                {
                    transform: `translate(${from.left - to.left}px, ${from.top - to.top}px)`
                        + ` scale(${from.width / to.width}, ${from.height / to.height})`,
                    transformOrigin: 'top left',
                    opacity: 0.45,
                },
                { transform: 'none', transformOrigin: 'top left', opacity: 1 },
            ],
            { duration: MORPH_DURATION_MS, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
        );
        return () => anim.cancel();
    }, [ref, from]);
};
