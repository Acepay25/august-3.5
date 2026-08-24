import { describe, it, expect } from 'vitest';
import {
    extractConvictions,
    seatConvictionTrajectory,
    persuasionProfile,
} from '../services/analysis/convictionDrift';
import type { DebateTurn } from '../types/message';

const turn = (speaker: string, text: string, round?: number): DebateTurn =>
    ({ speaker, text, round }) as DebateTurn;

describe('conviction drift (ROUND-36 / D2.2)', () => {
    it('extracts the last sealed conviction per turn (quoted numbers ignored)', () => {
        const t = turn('Macro', 'Technical said CONVICTION: 90 but I disagree. CONVICTION: 55', 2);
        expect(extractConvictions(t)).toEqual([55]);
        expect(extractConvictions(turn('Risk', 'no sealed line here', 2))).toEqual([]);
    });

    it('builds an ordered trajectory and delta across rounds', () => {
        const turns = [
            turn('Macro', 'Opening... CONVICTION: 80', 1),
            turn('Technical', 'Opening... CONVICTION: 60', 1),
            turn('Devil', 'Challenge!', 1),
            turn('Macro', 'Rebuttal... CONVICTION: 62', 2),
            turn('Technical', 'Rebuttal... CONVICTION: 75', 2),
        ];
        const macro = seatConvictionTrajectory(turns, 'Macro')!;
        expect(macro.points).toEqual([
            { round: 1, value: 80 },
            { round: 2, value: 62 },
        ]);
        expect(macro.delta).toBe(-18);
        // Technical moved UP (hardened) — devil's advocate stiffened their stance.
        expect(seatConvictionTrajectory(turns, 'Technical')!.delta).toBe(15);
        // Moderator never has convictions.
        expect(seatConvictionTrajectory([turn('Moderator', 'CONVICTION: 50', 3)], 'Moderator')).toBeNull();
        // Single data point → no drift measurable.
        expect(seatConvictionTrajectory([turn('Solo', 'CONVICTION: 70', 1)], 'Solo')).toBeNull();
    });

    it('profiles seats as movable vs rigid across debates', () => {
        const debates = [
            { debateTurns: [turn('A', 'CONVICTION: 80', 1), turn('A', 'CONVICTION: 40', 2)] }, // −20
            { debateTurns: [turn('A', 'CONVICTION: 70', 1), turn('A', 'CONVICTION: 30', 2)] }, // −40
            { debateTurns: [turn('B', 'CONVICTION: 65', 1), turn('B', 'CONVICTION: 65', 2)] }, // 0
        ];
        const a = persuasionProfile(debates as never, 'A');
        expect(a).toMatchObject({ debates: 2, movedDebates: 2, disposition: 'movable' });
        expect(a.avgDelta).toBeCloseTo(-40); // (−40 + −40) / 2

        const b = persuasionProfile(debates as never, 'B');
        expect(b.disposition).toBe('rigid');

        // No data at all → sparse.
        expect(persuasionProfile([], 'C').disposition).toBe('sparse');
    });
});
