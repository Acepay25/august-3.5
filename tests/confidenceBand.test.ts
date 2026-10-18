/**
 * The confidence WORD must not contradict the probability in the same verdict.
 *
 * `downgradeConfidenceForProbability` used to walk one step at a time, so a
 * probability clamped from 88 down to 34 still read "Medium" — the number the
 * gate allowed and the word the seat chose disagreed inside one object, and the
 * trader acted on the word. The label is now a band of the FINAL number, and it
 * still never upgrades: a seat that said Low keeps Low, because the band is a
 * ceiling on the word, not a licence to promote it.
 *
 * The middle cases are the ones that matter, so the table is the test: the
 * old behaviour and the new one agree everywhere except where the old one was
 * wrong, and a change that only moves those rows is the change described.
 */

import { describe, it, expect } from 'vitest';
import { downgradeConfidenceForProbability } from '../utils/analysisUtils';

type Label = 'Low' | 'Medium' | 'High';

describe('the word follows the number, to any depth', () => {
    const cases: Array<[number, Label, Label]> = [
        // Unchanged: one step, or no step at all.
        [88, 'High', 'High'], [70, 'High', 'High'], [69, 'High', 'Medium'],
        [55, 'Medium', 'Medium'], [54, 'Medium', 'Low'],
        // The rows the one-step walk got wrong: a High clamped far below the
        // Medium floor used to stop at Medium.
        [40, 'High', 'Low'], [34, 'High', 'Low'], [12, 'High', 'Low'], [0, 'High', 'Low'],
        // Never upgrades, at either distance.
        [95, 'Low', 'Low'], [95, 'Medium', 'Medium'], [40, 'Low', 'Low'],
    ];
    for (const [probability, given, want] of cases) {
        it(`${given} at ${probability}% reads ${want}`, () => {
            expect(downgradeConfidenceForProbability(probability, given)).toBe(want);
        });
    }

    it('is monotonic: a higher probability never earns a quieter word', () => {
        const rank: Record<string, number> = { Low: 0, Medium: 1, High: 2 };
        for (const given of ['Low', 'Medium', 'High'] as Label[]) {
            let previous = -1;
            for (let p = 0; p <= 100; p += 1) {
                const now = rank[downgradeConfidenceForProbability(p, given)];
                expect(now, `${given} at ${p}% went backwards`).toBeGreaterThanOrEqual(previous);
                previous = now;
            }
        }
    });

    it('never touches a veto', () => {
        // 'Avoid' means "do not take this trade"; a probability says nothing
        // about that, so a low number must not soften it and a high one must
        // not promote it into a confidence level.
        expect(downgradeConfidenceForProbability(5, 'Avoid' as Label)).toBe('Avoid');
        expect(downgradeConfidenceForProbability(99, 'Avoid' as Label)).toBe('Avoid');
    });
});
