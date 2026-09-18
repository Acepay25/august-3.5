import { describe, it, expect } from 'vitest';
import { computeTradeExcursions } from '../services/backtesting/outcomeEngine';
import {
    countTradeOutcome,
    halveCounts,
    serializeSkill,
    parseSkillMarkdown,
    skillExpectancyR,
    EXPECTANCY_MIN_R_SAMPLE,
    type SkillMeta,
} from '../services/learning/SkillMemoryService';
import type { Kline } from '../types/message';

// Two hazards these guard:
//  1. `TradeScanResult.maxDrawdown` accumulates past the exit on purpose (the
//     scan must still see later TP prints and the 150% breach), so it is NOT a
//     per-trade MAE. Excursions must stop at the candle the position died on.
//  2. The skill expectancy ledger may only sum R that was actually measured.
//     A stand-in for a missing R collapses netR into `wins - losses` and
//     quietly reinstates the binary grading expectancy exists to replace.

const bar = (over: Partial<Kline> = {}): Kline => ({
    time: 0, open: 100, high: 100, low: 100, close: 100, volume: 1, ...over,
});

const meta = (over: Partial<SkillMeta> = {}): SkillMeta => ({
    status: 'candidate',
    kind: 'repeat',
    wins: 0,
    losses: 0,
    consecutiveLosses: 0,
    tradeIds: [],
    body: '**Trigger:** t\n**Procedure:** do it.',
    ...over,
} as SkillMeta);

describe('computeTradeExcursions', () => {
    // Long, entry 100. Entry fills at index 1, stop-out resolves at index 3.
    // Indices 4-5 hold a violent move the trader never held a position through.
    const tape = [
        bar({ low: 10, high: 12 }),        // 0 pre-entry
        bar({ low: 98, high: 102 }),       // 1 entry candle
        bar({ low: 95, high: 105 }),       // 2
        bar({ low: 90, high: 101 }),       // 3 exit — worst adverse while live
        bar({ low: 20, high: 180 }),       // 4 post-exit
        bar({ low: 5, high: 200 }),        // 5 post-exit
    ];

    it('stops accumulating at the exit candle', () => {
        expect(computeTradeExcursions(tape, 1, 3, 100, true)).toEqual({
            maePercent: 10, mfePercent: 5,
        });
    });

    it('would report 95% MAE if unbounded — proving the bound carries the test', () => {
        const unbounded = computeTradeExcursions(tape, 1, 5, 100, true);
        expect(unbounded?.maePercent).toBe(95);
        expect(unbounded?.mfePercent).toBe(100);
    });

    it('ignores candles before the entry fill', () => {
        expect(computeTradeExcursions(tape, 2, 3, 100, true)?.maePercent).toBe(10);
    });

    it('orients both excursions for a short', () => {
        const shorts = [
            bar({ low: 98, high: 102 }),   // 0 entry
            bar({ low: 97, high: 110 }),   // 1 adverse 10, favorable 3
            bar({ low: 99, high: 104 }),   // 2 exit
            bar({ low: 1, high: 300 }),    // 3 post-exit, must not count
        ];
        expect(computeTradeExcursions(shorts, 0, 2, 100, false)).toEqual({
            maePercent: 10, mfePercent: 3,
        });
    });

    it('floors at zero when the position never went adverse or favorable', () => {
        const flat = [bar({ low: 100, high: 100 })];
        expect(computeTradeExcursions(flat, 0, 0, 100, true)).toEqual({
            maePercent: 0, mfePercent: 0,
        });
    });

    it('refuses an unmeasurable request instead of inventing a number', () => {
        expect(computeTradeExcursions(tape, 1, 3, 0, true)).toBeNull();
        expect(computeTradeExcursions(tape, 1, 3, NaN, true)).toBeNull();
        expect(computeTradeExcursions(tape, 1.5, 3, 100, true)).toBeNull();
        expect(computeTradeExcursions([], 0, 0, 100, true)).toBeNull();
    });
});

describe('skill expectancy ledger', () => {
    it('does not fabricate R when the trade had none', () => {
        const m = meta();
        countTradeOutcome(m, true);
        countTradeOutcome(m, false);
        countTradeOutcome(m, true, undefined);
        countTradeOutcome(m, false, NaN);
        expect({ wins: m.wins, losses: m.losses, netR: m.netR, rSampled: m.rSampled }).toEqual({
            wins: 2, losses: 2, netR: undefined, rSampled: undefined,
        });
        // The point of the assertion: 2W/2L must NOT read as +0R over 4 samples.
        expect(skillExpectancyR(m)).toBeUndefined();
    });

    it('sums only measured R and counts its own sample separately', () => {
        const m = meta({ tradeIds: ['a', 'b', 'c'] });
        countTradeOutcome(m, true, 3.5);
        countTradeOutcome(m, false);          // no R — W/L moves, ledger does not
        countTradeOutcome(m, false, -1.2);
        expect(m.wins).toBe(1);
        expect(m.losses).toBe(2);
        expect(m.netR).toBeCloseTo(2.3, 10);
        expect(m.rSampled).toBe(2);
    });

    it('withholds expectancy below the cold-start bar', () => {
        const thin = meta({ netR: 4, rSampled: EXPECTANCY_MIN_R_SAMPLE - 1 });
        expect(skillExpectancyR(thin)).toBeUndefined();
        const ready = meta({ netR: 3.2, rSampled: EXPECTANCY_MIN_R_SAMPLE });
        expect(skillExpectancyR(ready)).toBeCloseTo(0.4, 10);
    });

    it('omits the pair from the ledger when nothing was measured', () => {
        const written = serializeSkill(meta({ wins: 3, losses: 1 }), 'unproven');
        expect(written).not.toContain('netR:');
        expect(written).not.toContain('rSampled:');
    });

    it('round-trips measured expectancy through the markdown frontmatter', () => {
        const source = meta({ wins: 6, losses: 2, netR: 3.6, rSampled: 9 });
        const restored = parseSkillMarkdown(serializeSkill(source, 'proven'))!;
        expect(restored.netR).toBeCloseTo(3.6, 10);
        expect(restored.rSampled).toBe(9);
        expect(skillExpectancyR(restored)).toBeCloseTo(0.4, 10);
    });

    it('decays the expectancy pair with the evidence it was earned from', () => {
        const m = meta({ wins: 16, losses: 16, netR: 8, rSampled: 16 });
        expect(skillExpectancyR(m)).toBeCloseTo(0.5, 10);
        halveCounts(m, 1);
        expect({ wins: m.wins, losses: m.losses, netR: m.netR, rSampled: m.rSampled }).toEqual({
            wins: 8, losses: 8, netR: 4, rSampled: 8,
        });
        // Halving both keeps the quoted average honest while authority shrinks…
        expect(skillExpectancyR(m)).toBeCloseTo(0.5, 10);
        // …and one more halving drops it below the cold-start bar, so a
        // decayed skill stops being able to quote a number it no longer earns.
        halveCounts(m, 1);
        expect(skillExpectancyR(m)).toBeUndefined();
    });

    it('keeps the quoted average put when an ODD sample halves', () => {
        // The even case above hides this: flooring `rSampled` while dividing
        // `netR` by 2 shifts the ratio, so an odd record would decay INTO a
        // better-looking number just as its authority was cut in half.
        // 19 → 9 stays above the cold-start bar, so the getter is comparable.
        const m = meta({ wins: 16, losses: 16, netR: 8, rSampled: 19 });
        const earned = skillExpectancyR(m)!;
        expect(earned).toBeCloseTo(8 / 19, 2);
        halveCounts(m, 1);
        expect(m.rSampled).toBe(9);
        // Pre-fix this read 0.44 — the decay invented two tenths of an R.
        expect(skillExpectancyR(m)).toBe(earned);
    });

    it('drops the pair outright rather than leaving a lone zero', () => {
        const m = meta({ wins: 2, losses: 1, netR: 1, rSampled: 1 });
        halveCounts(m, 1);
        expect(m.rSampled).toBeUndefined();
        expect(m.netR).toBeUndefined();
        expect(skillExpectancyR(m)).toBeUndefined();
    });
});
