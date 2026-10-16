import { describe, it, expect } from 'vitest';
import { shouldOpenUpward } from '../utils/popoverPlacement';

/**
 * The rule that keeps a composer's popovers inside the window. Both the symbol
 * picker and the timeframe chip sit at the bottom of the screen, where a list
 * that always opens downward runs off the edge and across the disclaimer line —
 * which is what the owner screenshotted.
 */
const VH = 900;
const triggerAt = (top: number, bottom: number) => ({ top, bottom });

const withHeight = (h: number, fn: () => void): void => {
    const original = window.innerHeight;
    Object.defineProperty(window, 'innerHeight', { value: h, configurable: true });
    try { fn(); } finally {
        Object.defineProperty(window, 'innerHeight', { value: original, configurable: true });
    }
};

describe('a popover near the bottom of the window', () => {
    it('opens downward while the space below fits the panel', () => withHeight(VH, () => {
        expect(shouldOpenUpward(triggerAt(100, 140), 300)).toBe(false);
    }));

    it('flips when the panel would run past the window edge and there is room above', () => withHeight(VH, () => {
        // 120px below the trigger, 760px above it, a 300px panel.
        expect(shouldOpenUpward(triggerAt(760, 780), 300)).toBe(true);
    }));

    it('stays down when neither side fits, because the list scrolls anyway', () => withHeight(VH, () => {
        // Trigger in the middle: 450 below, 450 above, panel taller than both.
        expect(shouldOpenUpward(triggerAt(450, 450), 600)).toBe(false);
    }));

    it('is decided against the panel height, not a fixed distance', () => withHeight(VH, () => {
        const r = triggerAt(820, 840);
        expect(shouldOpenUpward(r, 40)).toBe(false);   // a tooltip fits below
        expect(shouldOpenUpward(r, 400)).toBe(true);   // a result list does not
    }));
});
