import { describe, it, expect } from 'vitest';
import { DebateTurn } from '../types';
import { computeFloorLean } from '../utils/floorLean';

const turn = (speaker: string, text: string, round = 1): DebateTurn => ({
    speaker: speaker as DebateTurn['speaker'],
    text,
    round,
});

describe('computeFloorLean', () => {
    it('returns null lean when no seat has declared', () => {
        const lean = computeFloorLean([turn('Technical', 'Still thinking about this setup.')]);
        expect(lean.declared).toBe(0);
        expect(lean.lean).toBeNull();
    });

    it('tallies the LATEST turn per seat, not the first', () => {
        const lean = computeFloorLean([
            turn('Technical', 'Direction: Long. Entry 100. Stop loss 90.', 1),
            turn('Macro', 'Direction: Short. Entry 100. Stop loss 110.', 1),
            // Technical flips to Short in the rebuttal round.
            turn('Technical', 'Direction: Short. Entry 99. Stop loss 105.', 2),
        ]);
        expect(lean.long).toBe(0);
        expect(lean.short).toBe(2);
        expect(lean.declared).toBe(2);
        expect(lean.lean).toBe('Short');
    });

    it('reports Split on a tie with votes on both sides', () => {
        const lean = computeFloorLean([
            turn('Technical', 'Direction: Long. Entry 100. Stop loss 90.'),
            turn('Macro', 'Direction: Short. Entry 100. Stop loss 110.'),
        ]);
        expect(lean.long).toBe(1);
        expect(lean.short).toBe(1);
        expect(lean.lean).toBe('Split');
    });

    it('counts undeclared seats as neutral and ignores Moderator/System', () => {
        const lean = computeFloorLean([
            turn('Technical', 'Direction: Long. Entry 100. Stop loss 90.'),
            turn('Risk', 'No clear edge here yet.'),
            turn('Moderator', 'Direction: Short. Entry 100. Stop loss 110.'),
            turn('System', 'Direction: Long. Entry 1. Stop loss 0.5.'),
        ]);
        expect(lean.long).toBe(1);
        expect(lean.short).toBe(0);
        expect(lean.neutral).toBe(1);
        expect(lean.declared).toBe(1);
        expect(lean.lean).toBe('Long');
    });

    it('skips empty turns', () => {
        const lean = computeFloorLean([
            turn('Technical', '   '),
            turn('Technical', 'Direction: Long. Entry 100. Stop loss 90.'),
        ]);
        expect(lean.long).toBe(1);
        expect(lean.lean).toBe('Long');
    });
});
