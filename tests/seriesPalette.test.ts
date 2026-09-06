import { describe, it, expect } from 'vitest';
import { SERIES_PALETTE, seriesColor } from '../utils/seriesPalette';

// The series palette's two invariants: positional stability (series N wears
// color N on every chart) and the reservation — rose/red means LOSS and
// emerald/green means WIN on every status surface, so no series may borrow
// them. Teal is excluded too (reads as green at 2px).

describe('seriesColor', () => {
    it('is positional and stable', () => {
        expect(seriesColor(0)).toBe(SERIES_PALETTE[0]);
        expect(seriesColor(3)).toBe(SERIES_PALETTE[3]);
        expect(seriesColor(0)).toBe(seriesColor(0));
    });

    it('wraps instead of going out of range (and never on a negative)', () => {
        expect(seriesColor(SERIES_PALETTE.length)).toBe(SERIES_PALETTE[0]);
        expect(seriesColor(SERIES_PALETTE.length + 2)).toBe(SERIES_PALETTE[2]);
        expect(seriesColor(-1)).toBe(SERIES_PALETTE[SERIES_PALETTE.length - 1]);
    });
});

describe('SERIES_PALETTE reservation rule', () => {
    it('never contains a red, rose, green, or emerald tone', () => {
        const banned = ['#ef4444', '#f87171', '#fb7185', '#f43f5e', '#22c55e', '#4ade80', '#34d399', '#10b981', '#4cca8f'];
        for (const color of SERIES_PALETTE) {
            expect(banned).not.toContain(color.toLowerCase());
        }
    });

    it('excludes teal (reads as green at line width)', () => {
        for (const color of SERIES_PALETTE) {
            expect(color.toLowerCase()).not.toBe('#2dd4bf');
            expect(color.toLowerCase()).not.toBe('#14b8a6');
        }
    });

    it('has enough distinct slots for a full bench of seats', () => {
        expect(SERIES_PALETTE.length).toBeGreaterThanOrEqual(8);
        expect(new Set(SERIES_PALETTE).size).toBe(SERIES_PALETTE.length);
    });
});
