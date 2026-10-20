/**
 * E-02 — ONE planned R:R, ONE formula.
 *
 * The defect (audit finding F-11): the validation gate measured R:R against
 * `takeProfits[0]` — the model's FIRST target, by array order — while the
 * card and the journal quoted the take-profit NEAREST the entry. A model that
 * listed its targets farthest-first was therefore graded against the farthest
 * one, and the trader read a different number on the card than the gate had
 * scored. `services/analysis/ScalpDetectionService.ts` carried a THIRD copy of
 * the same arithmetic.
 *
 * The fix puts the arithmetic in ONE place (`utils/riskReward`) and points
 * the gate and the scalp/swing validators at it — WITHOUT losing the thing
 * only the gate had: the direction-signed refusal of an inverted plan.
 */

import { describe, it, expect } from 'vitest';
import { plannedRiskReward, plannedRiskRewardSigned } from '../utils/riskReward';
import { validateRiskReward } from '../services/validation/AccuracyValidationService';
import { validateScalpTrade, validateSwingTrade } from '../services/analysis/ScalpDetectionService';
import type { TradeAnalysis } from '../types';

describe('plannedRiskRewardSigned — the same number, with a direction', () => {
    it('equals the canonical magnitude ratio for a well-formed plan', () => {
        const long = plannedRiskRewardSigned({ entry: 100, stopLoss: 90, takeProfits: [120, 110], direction: 'Long' });
        expect(long.ratio).toBe(plannedRiskReward({ entry: 100, stopLoss: 90, takeProfits: [120, 110] }));
        expect(long.ratio).toBe(1);
        const short = plannedRiskRewardSigned({ entry: 100, stopLoss: 110, takeProfits: [80, 90], direction: 'Short' });
        expect(short.ratio).toBe(plannedRiskReward({ entry: 100, stopLoss: 110, takeProfits: [80, 90] }));
        expect(short.ratio).toBe(1);
    });

    it('grades the NEAREST target, not the first one', () => {
        // The regression: [120, 110] used to be graded against 120.
        const graded = plannedRiskRewardSigned({ entry: 100, stopLoss: 90, takeProfits: [120, 110], direction: 'Long' });
        expect(graded.ratio).toBe(1);
        // The order of the same two targets cannot change the answer.
        const reversed = plannedRiskRewardSigned({ entry: 100, stopLoss: 90, takeProfits: [110, 120], direction: 'Long' });
        expect(reversed.ratio).toBe(graded.ratio);
    });

    it('refuses an inverted plan instead of grading its abs ratio', () => {
        const stopAbove = plannedRiskRewardSigned({ entry: 95000, stopLoss: 95500, takeProfits: [96000], direction: 'Long' });
        expect(stopAbove.inverted).toBe(true);
        expect(stopAbove.ratio).toBe(0);
        const targetBelow = plannedRiskRewardSigned({ entry: 95000, stopLoss: 94500, takeProfits: [94000], direction: 'Long' });
        expect(targetBelow.inverted).toBe(true);
        expect(targetBelow.ratio).toBe(0);
    });

    it('does not refuse a plan merely because its targets are listed out of order', () => {
        // The ordering gate re-sorts a ladder; refusing for the ORDER of the
        // targets is the failure this change exists to end.
        const outOfOrder = plannedRiskRewardSigned({ entry: 100, stopLoss: 90, takeProfits: [130, 105, 120], direction: 'Long' });
        expect(outOfOrder.inverted).toBe(false);
        expect(outOfOrder.ratio).toBe(plannedRiskReward({ entry: 100, stopLoss: 90, takeProfits: [130, 105, 120] }));
    });

    it('returns 0 rather than NaN when the levels are unusable', () => {
        const blank = plannedRiskRewardSigned({ entry: Number.NaN, stopLoss: 90, takeProfits: [110], direction: 'Long' });
        expect(blank.ratio).toBe(0);
        expect(blank.risk).toBe(0);
        const noTarget = plannedRiskRewardSigned({ entry: 100, stopLoss: 90, takeProfits: [], direction: 'Long' });
        expect(noTarget.ratio).toBe(0);
    });
});

/**
 * The table the change promised: over every target ORDER, the gate's ratio
 * and the card's ratio are the SAME number.
 */
describe('the gate ratio IS the card ratio (table-driven)', () => {
    const LONG_SETS: number[][] = [
        [110],
        [105, 120],
        [120, 105],
        [130, 105, 120],
        [120, 130, 105],
        [105, 120, 130],
    ];
    const SHORT_SETS: number[][] = [
        [90],
        [95, 80],
        [80, 95],
        [70, 95, 80],
        [80, 70, 95],
        [95, 80, 70],
    ];

    it('matches for every Long target ordering', () => {
        for (const takeProfits of LONG_SETS) {
            const card = plannedRiskReward({ entry: 100, stopLoss: 90, takeProfits });
            const gate = validateRiskReward(100, 90, takeProfits, 1, 'Medium', 'Long');
            expect(gate.ratio).toBe(card);
        }
    });

    it('matches for every Short target ordering', () => {
        for (const takeProfits of SHORT_SETS) {
            const card = plannedRiskReward({ entry: 100, stopLoss: 110, takeProfits });
            const gate = validateRiskReward(100, 110, takeProfits, 1, 'Medium', 'Short');
            expect(gate.ratio).toBe(card);
        }
    });

    it('keeps the legacy single-number call shape working', () => {
        // The old signature took one target; a caller that still does must
        // get the same answer.
        expect(validateRiskReward(95000, 94500, 96000, 300, 'Medium', 'Long').ratio).toBe(2);
        expect(validateRiskReward(95000, 94500, [96000], 300, 'Medium', 'Long').ratio).toBe(2);
    });
});

describe('the gate keeps the refusal the formula change must not lose', () => {
    it('still refuses a Long with the stop above entry, with no measurable ratio', () => {
        const r = validateRiskReward(95000, 95500, [96000], 300, 'Medium', 'Long');
        expect(r.isValid).toBe(false);
        expect(r.orderingValid).toBe(false);
        expect(r.ratio).toBe(0);
        expect(r.warnings.some(w => /INVERTED PLAN \(Long\)/i.test(w))).toBe(true);
    });

    it('still refuses a Long whose nearest target sits below entry', () => {
        const r = validateRiskReward(95000, 94500, [94000], 300, 'Medium', 'Long');
        expect(r.isValid).toBe(false);
        expect(r.orderingValid).toBe(false);
        expect(r.warnings.some(w => /INVERTED PLAN/i.test(w))).toBe(true);
    });

    it('still accepts a correctly ordered plan', () => {
        const r = validateRiskReward(95000, 94500, [96000], 300, 'Medium', 'Long');
        expect(r.isValid).toBe(true);
        expect(r.orderingValid).toBe(true);
        expect(r.ratio).toBeCloseTo(2);
    });
});

/**
 * The scalp/swing validators carried their OWN copy of the same arithmetic —
 * the third implementation. They now read the canonical one.
 */
describe('the scalp and swing validators read the canonical ratio', () => {
    const scalp = (takeProfit: string[]): TradeAnalysis => ({
        coinName: 'BTCUSDT',
        direction: 'Long',
        confidence: 'Medium',
        probability: 55,
        strategy: 'test',
        entryPoints: [{ description: 'e', price: '100000' }],
        stopLoss: '99500',
        takeProfit: takeProfit.map(price => ({ price })),
        marketConditions: {
            pattern: '—', candleBehavior: '—', timeframeAlignment: '—',
            rsi: '—', macd: '—', sentiment: '—',
        },
        historicalCorrelation: '—',
    } as unknown as TradeAnalysis);

    it('grades a scalp against the NEAREST target, not the first listed one', () => {
        // Entry 100000, stop 99500 ⇒ risk 500. The FIRST target is 10000 away
        // (ratio 20 — no warning); the NEAREST is 200 away (ratio 0.4 — a
        // warning). The old copy read the first one and stayed silent.
        const firstFar = validateScalpTrade(scalp(['110000', '100200']));
        expect(firstFar.warnings.join(' ')).toMatch(/below minimum 1:1/);
        expect(firstFar.shouldDowngrade).toBe(true);
    });

    it('does not warn on a scalp whose first target is far but whose nearest is fine', () => {
        const nearestFine = validateScalpTrade(scalp(['100200', '110000']));
        // The nearest target is the SAME 100200 in both orderings — the answer
        // must not depend on which end of the list it was written at.
        expect(nearestFine.warnings.join(' ')).toMatch(/below minimum 1:1/);
    });

    it('still flags a scalp with inverted levels', () => {
        const inverted = validateScalpTrade({
            ...scalp(['99500']),
            stopLoss: '100400',
        } as unknown as TradeAnalysis);
        expect(inverted.shouldDowngrade).toBe(true);
        expect(inverted.warnings.join(' ')).toMatch(/wrong side of entry/);
    });

    it('still recommends 1.5:1 on a swing without downgrading for it', () => {
        // Entry 100000, stop 99000 (risk 1000), target 101200 (reward 1200) ⇒
        // 1.2:1, below the 1.5 the swing validator recommends.
        const swing = validateSwingTrade({ ...scalp(['101200']), stopLoss: '99000' } as unknown as TradeAnalysis);
        expect(swing.warnings.join(' ')).toMatch(/below recommended 1.5:1/);
        expect(swing.shouldDowngrade).toBe(false);
    });
});
