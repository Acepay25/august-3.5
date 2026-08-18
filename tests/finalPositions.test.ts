import { describe, it, expect } from 'vitest';
import { summarizeFinalPositions } from '../utils/debateLevels';

describe('summarizeFinalPositions', () => {
    it('uses each seat\'s LATEST turn only', () => {
        const summary = summarizeFinalPositions({
            Moderator: [],
            Technical: [
                'Direction: Long. Entry 100. Stop loss 90.',
                'Direction: Short. Entry 102. Stop loss 108.',
            ],
            Macro: ['Direction: Short. Entry 103. Stop loss 109.'],
        }, ['Technical', 'Macro', 'Moderator']);
        expect(summary.rows).toHaveLength(2);
        const tech = summary.rows.find(r => r.speaker === 'Technical');
        expect(tech?.direction).toBe('Short');
        expect(tech?.entry).toBe('102');
        expect(summary.convergedDirection).toBe(true);
    });

    it('computes the entry spread as % of median', () => {
        const summary = summarizeFinalPositions({
            A: ['Direction: Long. Entry 100. Stop loss 90.'],
            B: ['Direction: Long. Entry 102. Stop loss 90.'],
        }, ['A', 'B']);
        // spread = (102-100)/102 * 100 ≈ 1.96%
        expect(summary.entrySpreadPct).not.toBeNull();
        expect(summary.entrySpreadPct!).toBeCloseTo(1.96, 1);
        expect(summary.block).toContain('entry spread');
    });

    it('flags non-convergence when directions disagree', () => {
        const summary = summarizeFinalPositions({
            A: ['Direction: Long. Entry 100. Stop loss 90.'],
            B: ['Direction: Short. Entry 100. Stop loss 110.'],
        }, ['A', 'B']);
        expect(summary.convergedDirection).toBe(false);
        expect(summary.block).toContain('A: Long');
        expect(summary.block).toContain('B: Short');
    });

    it('ignores Moderator/System and seats with no text', () => {
        const summary = summarizeFinalPositions({
            Moderator: ['Direction: Long. Entry 1. Stop loss 0.5.'],
            System: ['Direction: Short. Entry 1. Stop loss 2.'],
            A: [],
            B: ['Direction: Long. Entry 100. Stop loss 90.'],
        }, ['Moderator', 'System', 'A', 'B']);
        expect(summary.rows).toHaveLength(1);
        expect(summary.rows[0].speaker).toBe('B');
        // Only one declared seat — convergence needs ≥2.
        expect(summary.convergedDirection).toBe(false);
        expect(summary.entrySpreadPct).toBeNull();
    });
});
