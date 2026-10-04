/**
 * useRightPanel — the ONE right-panel contract (Stage 2, C3).
 *
 * Every surface in this app used to invent its own right-hand panel: the Trade
 * Chart AI dock pushes and drag-resizes, Advanced Analytics slides over the top
 * as a fixed overlay, the Journal aside is neither. A trader who learned one of
 * them had to learn three. This hook is the shared behaviour they now agree on:
 *
 *   PRESENTATION  `push` (takes its place beside the content) or `fullscreen`
 *                 (covers it). Below `fullscreenBelow` the window has no room
 *                 for a pushed panel beside a chart, so `push` silently stops
 *                 being an option — the panel goes fullscreen rather than
 *                 squeezing the content to nothing.
 *   HIDE ≠ CLOSE  A closed panel stays MOUNTED. Collapsing the dock must not
 *                 throw away a composer draft or an in-flight turn; see
 *                 tests/rightPanelContract.test.tsx.
 *   WIDTH         Persisted per SURFACE, not globally: the width that suits the
 *                 Trade chart is not the width that suits the Journal.
 *   NO TRANSITION ON RESIZE  A drag that eases is a drag that lags behind the
 *                 pointer, which reads as a broken handle. Transitions are
 *                 suppressed for the duration and restored on release.
 *   TABS          More than one open panel gets capsules in one strip. Panels
 *                 stay mounted behind them, so switching does not reset work.
 *
 * Deliberately NOT here: what a panel CONTAINS. This is geometry and lifecycle
 * only, so a panel cannot grow its own idea of how it should be sized.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/** Below this viewport width a pushed panel has no room beside the content. */
export const RIGHT_PANEL_FULLSCREEN_BELOW = 768;

export type RightPanelPresentation = 'push' | 'fullscreen';

export interface RightPanelDock {
    id: string;
    label: string;
}

export interface UseRightPanelOptions {
    /** Namespaces the persisted width, so each surface keeps its own. */
    surface: string;
    defaultWidth: number;
    minWidth: number;
    maxWidth: number;
    fullscreenBelow?: number;
    /**
     * A pre-Phase-2 width key to adopt on first read, so upgrading does not
     * silently reset the width someone already dragged to. Migrated once; the
     * new key is written immediately so the legacy key is never consulted twice.
     */
    legacyWidthKey?: string;
}

export interface UseRightPanel {
    presentation: RightPanelPresentation;
    /** True while the pointer is dragging the handle — callers drop transitions. */
    isResizing: boolean;
    width: number;
    isOpen: boolean;
    /** Ordered registry of every panel this surface can show. */
    docks: RightPanelDock[];
    /** Ids currently open, in the order they were opened. */
    openIds: string[];
    activeId: string | null;

    register: (dock: RightPanelDock) => void;
    open: (id: string) => void;
    close: (id: string) => void;
    setActive: (id: string) => void;
    resetWidth: () => void;
    /** Commit a width directly. Used when the real layout width differs from the
     *  stored one — an expanded panel sized by flex, for instance — so the next
     *  drag gesture starts from what the user can actually see. */
    setWidth: (px: number) => void;
    startResize: (event: React.PointerEvent) => void;
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

export function useRightPanel(options: UseRightPanelOptions): UseRightPanel {
    const {
        surface, defaultWidth, minWidth, maxWidth,
        fullscreenBelow = RIGHT_PANEL_FULLSCREEN_BELOW,
        legacyWidthKey,
    } = options;

    const widthKey = `right_panel_width_v1_${surface}`;

    const readWidth = useCallback((): number => {
        try {
            const next = Number(localStorage.getItem(widthKey));
            if (Number.isFinite(next) && next >= minWidth && next <= maxWidth) return next;
            if (legacyWidthKey) {
                const legacy = Number(localStorage.getItem(legacyWidthKey));
                if (Number.isFinite(legacy) && legacy >= minWidth && legacy <= maxWidth) {
                    // Adopt it now, so this runs once rather than every mount.
                    try { localStorage.setItem(widthKey, String(legacy)); } catch { /* private mode */ }
                    return legacy;
                }
            }
        } catch { /* private mode */ }
        return defaultWidth;
    }, [widthKey, legacyWidthKey, minWidth, maxWidth, defaultWidth]);

    const [width, setWidthState] = useState<number>(readWidth);
    const [isResizing, setIsResizing] = useState(false);
    const [docks, setDocks] = useState<RightPanelDock[]>([]);
    const [openIds, setOpenIds] = useState<string[]>([]);

    const commitWidth = useCallback((next: number) => {
        const clamped = clamp(Math.round(next), minWidth, maxWidth);
        setWidthState(clamped);
        try { localStorage.setItem(widthKey, String(clamped)); } catch { /* private mode */ }
    }, [minWidth, maxWidth, widthKey]);

    // ── Presentation ──────────────────────────────────────────────────────
    const [viewportWidth, setViewportWidth] = useState(() =>
        (typeof window === 'undefined' ? 1280 : window.innerWidth));
    useEffect(() => {
        const onResize = (): void => setViewportWidth(window.innerWidth);
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);
    const presentation: RightPanelPresentation =
        viewportWidth < fullscreenBelow ? 'fullscreen' : 'push';

    // ── Registry ──────────────────────────────────────────────────────────
    const register = useCallback((dock: RightPanelDock) => {
        setDocks(prev => (prev.some(d => d.id === dock.id) ? prev : [...prev, dock]));
    }, []);

    const open = useCallback((id: string) => {
        // One rule for "bring this panel to the front": if it is already open it
        // moves to the end, if not it opens. The alternative — treating a repeat
        // open as a no-op — leaves a second click looking like nothing happened.
        setOpenIds(prev => (prev.includes(id)
            ? [...prev.filter(x => x !== id), id]
            : [...prev, id]));
    }, []);

    const close = useCallback((id: string) => {
        setOpenIds(prev => {
            const next = prev.filter(x => x !== id);
            // Closing the visible panel must leave a visible one behind, not an
            // empty panel with the strip showing a tab that no longer exists.
            return next;
        });
    }, []);

    const activeId = openIds.length ? openIds[openIds.length - 1] : null;
    // Selecting a capsule and opening a panel are the same operation — both mean
    // "show this one" — so there is one code path and one ordering rule.
    const setActive = open;

    const resetWidth = useCallback(() => commitWidth(defaultWidth), [commitWidth, defaultWidth]);

    // ── Drag resize ───────────────────────────────────────────────────────
    // The width lives in a ref during the drag so a pointermove never waits on
    // a render, and the transition suppression is released only on pointerup —
    // see the note on UseRightPanel.isResizing.
    const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
    // The live listeners, held so unmount can remove the SAME functions that
    // were added. Removing fresh arrow instances is a no-op that leaks the
    // drag, which then keeps resizing a panel that is no longer mounted.
    const listenersRef = useRef<{ move: (e: PointerEvent) => void; up: () => void } | null>(null);

    const startResize = useCallback((event: React.PointerEvent) => {
        event.preventDefault();
        dragRef.current = { startX: event.clientX, startWidth: width };
        setIsResizing(true);

        const onMove = (e: PointerEvent): void => {
            const drag = dragRef.current;
            if (!drag) return;
            // The panel is on the right, so dragging LEFT grows it.
            commitWidth(drag.startWidth + (drag.startX - e.clientX));
        };
        const onUp = (): void => {
            dragRef.current = null;
            listenersRef.current = null;
            setIsResizing(false);
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
        };
        listenersRef.current = { move: onMove, up: onUp };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    }, [width, commitWidth]);

    useEffect(() => () => {
        const l = listenersRef.current;
        if (!l) return;
        window.removeEventListener('pointermove', l.move);
        window.removeEventListener('pointerup', l.up);
        listenersRef.current = null;
        dragRef.current = null;
    }, []);

    return useMemo(() => ({
        presentation, isResizing, width, isOpen: openIds.length > 0,
        docks, openIds, activeId,
        register, open, close, setActive, resetWidth, setWidth: commitWidth, startResize,
    }), [presentation, isResizing, width, docks, openIds, activeId,
        register, open, close, setActive, resetWidth, commitWidth, startResize]);
}