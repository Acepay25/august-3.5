/**
 * useSurfaceMorph — the Chart AI → Agents FLIP.
 *
 * jsdom has no Element.animate and no layout, so the stubs here ARE the test:
 * what gets pinned is the rect math (the pane must start exactly where the dock
 * was, not merely near it) and the two stillness signals that suppress it — the
 * OS prefers-reduced-motion one and the desk's own idle-motion switch.
 */

import React, { useRef } from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import {
    captureChartAiRect, useSurfaceMorphIn, MORPH_DURATION_MS, type MorphRect,
} from '../hooks/useSurfaceMorph';

/** Every element reports this box, so the FLIP's `to` is known up front. */
const PANE = { left: 0, top: 0, width: 1000, height: 600 };
/** Where the Chart AI dock sat: the right-hand 400×300 column at x=600. */
const DOCK: MorphRect = { left: 600, top: 100, width: 400, height: 300 };

const rectOf = (r: Partial<MorphRect>): DOMRect => ({
    left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}),
    ...r,
} as DOMRect);

const Harness: React.FC<{ from: MorphRect | null }> = ({ from }) => {
    const ref = useRef<HTMLDivElement | null>(null);
    useSurfaceMorphIn(ref, from);
    return <div ref={ref} data-testid="pane" />;
};

let animate: ReturnType<typeof vi.fn>;
const setReducedMotion = (reduced: boolean): void => {
    window.matchMedia = ((query: string) => ({
        matches: reduced, media: query, onchange: null,
        addListener: () => {}, removeListener: () => {},
        addEventListener: () => {}, removeEventListener: () => {},
        dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
};

const firstFrame = (): { transform: string; opacity: number } => animate.mock.calls[0][0][0];
const options = (): { duration: number; easing: string } => animate.mock.calls[0][1];

/** jsdom's own no-geometry implementations, restored afterwards. */
const originalAnimate = HTMLElement.prototype.animate;
const originalRect = HTMLElement.prototype.getBoundingClientRect;

beforeEach(() => {
    animate = vi.fn(() => ({ cancel: vi.fn(), finished: Promise.resolve() }));
    HTMLElement.prototype.animate = animate as unknown as typeof HTMLElement.prototype.animate;
    HTMLElement.prototype.getBoundingClientRect = () => rectOf(PANE);
    setReducedMotion(false);
});

afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
    document.body.classList.remove('desk-idle-motion-off');
    HTMLElement.prototype.animate = originalAnimate;
    HTMLElement.prototype.getBoundingClientRect = originalRect;
});

describe('the Chart AI → Agents flip', () => {
    it('starts the pane exactly where the dock was', () => {
        render(<Harness from={DOCK} />);
        expect(animate).toHaveBeenCalledTimes(1);
        // translate = from − to, scale = from / to.
        expect(firstFrame().transform).toBe('translate(600px, 100px) scale(0.4, 0.5)');
        expect(firstFrame().opacity).toBeLessThan(1);
        expect(options().duration).toBe(MORPH_DURATION_MS);
        expect(options().easing).toBe('cubic-bezier(0.2, 0, 0, 1)');
    });

    it('does not animate when no dock box was handed down', () => {
        render(<Harness from={null} />);
        expect(animate).not.toHaveBeenCalled();
    });

    it('does not animate on a pane that never painted', () => {
        HTMLElement.prototype.getBoundingClientRect = () => rectOf({ left: 0, top: 0, width: 0, height: 0 });
        render(<Harness from={DOCK} />);
        expect(animate).not.toHaveBeenCalled();
    });

    it('honors the OS reduced-motion signal', () => {
        setReducedMotion(true);
        render(<Harness from={DOCK} />);
        expect(animate).not.toHaveBeenCalled();
    });

    it('honors the desk idle-motion switch', () => {
        document.body.classList.add('desk-idle-motion-off');
        render(<Harness from={DOCK} />);
        expect(animate).not.toHaveBeenCalled();
    });
});

describe('captureChartAiRect', () => {
    const mountDock = (testId: string, r: Partial<MorphRect>): void => {
        document.body.innerHTML = `<div data-testid="${testId}"></div>`;
        const el = document.querySelector(`[data-testid="${testId}"]`) as HTMLElement;
        el.getBoundingClientRect = () => rectOf(r);
    };

    it('reads the dock box the morph grows out of', () => {
        mountDock('trade-dock', { left: 900, top: 40, width: 384, height: 700 });
        expect(captureChartAiRect()).toEqual({ left: 900, top: 40, width: 384, height: 700 });
    });

    it('follows the dock into the rail it collapses to', () => {
        mountDock('trade-dock-rail', { left: 1280, top: 0, width: 40, height: 800 });
        expect(captureChartAiRect()?.width).toBe(40);
    });

    it('is null when no Chart AI is on screen', () => {
        expect(captureChartAiRect()).toBeNull();
    });

    it('is null for a dock with no painted box', () => {
        mountDock('trade-dock', { left: 900, top: 40, width: 0, height: 0 });
        expect(captureChartAiRect()).toBeNull();
    });
});
