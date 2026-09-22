/**
 * The single planned-R:R definition.
 *
 * Before this, three call sites computed it and disagreed:
 *   utils/analysisUtils.ts        nearest target  ÷ stop
 *   services/trade/proposedTrade  takeProfits[0]  ÷ stop   (ARRAY ORDER)
 *   ScenarioSimulatorService      takeProfits[0]  ÷ stop   (ARRAY ORDER)
 * A model emitting targets out of order therefore quoted the FARTHEST target
 * as if it were the first one — the same trade reading 1.8R on the card and
 * 3.1R in the journal.
 */

import { describe, it, expect } from 'vitest';
import {
    firstTargetDistance,
    plannedRiskReward,
    riskRewardDistances,
} from '../utils/riskReward';
import { computeRrRatio } from '../services/trade/proposedTrade';
import { calculateMetrics } from '../services/backtesting/ScenarioSimulatorService';

describe('firstTargetDistance', () => {
    it('takes the target closest to entry regardless of array order', () => {
        // The regression: out-of-order targets used to be read by index 0.
        expect(firstTargetDistance(100, [130, 105, 120])).toBe(5);
        expect(firstTargetDistance(100, [105, 120, 130])).toBe(5);
        // Short side: targets below entry.
        expect(firstTargetDistance(100, [70, 95, 80])).toBe(5);
    });

    it('ignores nullish, non-finite and zero-distance targets', () => {
        expect(firstTargetDistance(100, [null, undefined, NaN, 110])).toBe(10);
        expect(firstTargetDistance(100, [100, 110])).toBe(10);
        expect(firstTargetDistance(100, [])).toBeNull();
        expect(firstTargetDistance(100, [null, undefined])).toBeNull();
    });
});

describe('plannedRiskReward', () => {
    it('is nearest-target distance over stop distance, rounded to 2dp', () => {
        expect(plannedRiskReward({ entry: 100, stopLoss: 98, takeProfits: [105, 120] })).toBe(2.5);
        expect(plannedRiskReward({ entry: 100, stopLoss: 90, takeProfits: [115] })).toBe(1.5);
    });

    it('agrees with itself for the same trade written in either target order', () => {
        const ascending = plannedRiskReward({ entry: 100, stopLoss: 95, takeProfits: [110, 130, 150] });
        const descending = plannedRiskReward({ entry: 100, stopLoss: 95, takeProfits: [150, 130, 110] });
        expect(ascending).toBe(descending);
    });

    it('returns 0 rather than NaN or a negative when levels are unusable', () => {
        expect(plannedRiskReward({ entry: 100, stopLoss: 100, takeProfits: [110] })).toBe(0);
        expect(plannedRiskReward({ entry: 100, stopLoss: Number.NaN, takeProfits: [110] })).toBe(0);
        expect(plannedRiskReward({ entry: 'x' as unknown as number, stopLoss: 95, takeProfits: [110] })).toBe(0);
        expect(plannedRiskReward({ entry: 100, stopLoss: 95, takeProfits: [] })).toBe(0);
        expect(plannedRiskReward({ entry: 100, stopLoss: 95, takeProfits: [100] })).toBe(0);
    });

    it('handles string-shaped inputs coming off the AI boundary', () => {
        expect(plannedRiskReward({ entry: '100' as unknown as number, stopLoss: 95, takeProfits: [110] })).toBe(0);
        // Numbers as `number` are the contract; a numeric STRING is not finite
        // as a number type, so the helper must refuse rather than coerce.
    });
});

describe('computeRrRatio (the proposal tool)', () => {
    it('matches the canonical planned R:R', () => {
        expect(computeRrRatio({
            direction: 'Long', entry: 100, stopLoss: 98, takeProfits: [103, 120],
        })).toBe(1.5);
    });

    it('no longer quotes the farthest target when the model orders them badly', () => {
        const outOfOrder = computeRrRatio({
            direction: 'Long', entry: 100, stopLoss: 90, takeProfits: [300, 105],
        });
        // Old behavior: |300-100| / 10 = 20R from a trade whose first target
        // was 5 away. Canonical: 0.5R.
        expect(outOfOrder).toBe(0.5);
    });
});

describe('riskRewardDistances', () => {    it('exposes the raw distances the ticket needs', () => {
        const d = riskRewardDistances({ entry: 100, stopLoss: 96, takeProfits: [108, 120] });
        expect(d.risk).toBe(4);
        expect(d.reward).toBe(8);
        expect(d.ratio).toBe(2);
    });

    it('reports ratio 0 with no target instead of dividing by nothing', () => {
        const d = riskRewardDistances({ entry: 100, stopLoss: 96, takeProfits: [] });
        expect(d.reward).toBe(0);
        expect(d.ratio).toBe(0);
    });
});

/**
 * The scenario screen keeps a 2R stand-in for "no targets listed". Routing R:R
 * through one helper nearly made that stand-in apply to a target that WAS
 * listed but unusable — inventing a payoff the plan never contained.
 */
describe('calculateMetrics stays on the canonical nearest-target rule', () => {
    const base = {
        coinName: 'BTCUSDT',
        direction: 'Long' as const,
        leverage: 1,
        positionSizeUSD: 1000,
    };

    it('uses the nearest target regardless of the order it was written in', () => {
        const ascending = calculateMetrics({ ...base, entry: 100, stopLoss: 90, takeProfits: [105, 120] });
        const descending = calculateMetrics({ ...base, entry: 100, stopLoss: 90, takeProfits: [120, 105] });
        // risk = |100-90| = 10, nearest target = |105-100| = 5 -> 0.5 either way
        expect(ascending.rrRatio).toBe(0.5);
        expect(descending.rrRatio).toBe(ascending.rrRatio);
    });

    it('keeps the 2R stand-in when no targets were listed', () => {
        const m = calculateMetrics({ ...base, entry: 100, stopLoss: 90, takeProfits: [] });
        expect(m.rrRatio).toBe(2);
    });

    it('does NOT invent 2R for a target that exists but sits on entry', () => {
        const m = calculateMetrics({ ...base, entry: 100, stopLoss: 90, takeProfits: [100] });
        expect(m.rrRatio).toBe(0);
    });
});
