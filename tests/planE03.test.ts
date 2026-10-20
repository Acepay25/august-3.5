/**
 * E-03 — the cost model, in R.
 *
 * The app had NO cost model at all: every `realizedR`, every win rate, every
 * calibration bucket and the whole skill ledger were GROSS (audit finding
 * F-13). The gates allow the loosest trade the app will take — R:R 1.2 at Low,
 * a scalp stop of ≤ 1 % — and a 0.10 % round trip against a 1 % stop is 0.10 R:
 * at a 50 % win rate and R:R 1.2 the gross expectancy is +0.10 R and the round
 * trip consumes exactly that. The breakeven win rate moves from 45.5 % to
 * 50.0 %.
 *
 * The APPROVED parameters (owner, 2026-10-20): **5 bps taker / 2 bps maker,
 * ZERO slippage, with a visible "slippage not modeled" label.** The slippage
 * is a LABEL, never a silent zero — so `slippageModeled` is typed as the
 * literal `false` and rides every cost-dependent result.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    FEE_TAKER_BPS,
    FEE_MAKER_BPS,
    SLIPPAGE_BPS,
    SLIPPAGE_NOT_MODELED_LABEL,
    roundTripCostR,
    netRiskReward,
    breakEvenWinRate,
    stopDistancePercent,
    netEdgeR,
} from '../utils/netRiskReward';

afterEach(() => { vi.restoreAllMocks(); });

describe('the approved fee tier', () => {
    it('is 5 bps taker, 2 bps maker and NO slippage', () => {
        expect(FEE_TAKER_BPS).toBe(5);
        expect(FEE_MAKER_BPS).toBe(2);
        expect(SLIPPAGE_BPS).toBe(0);
    });

    it('labels the slippage rather than implying it was zero', () => {
        expect(SLIPPAGE_NOT_MODELED_LABEL).toBe('slippage not modeled');
        const net = netRiskReward({ grossR: 1, stopDistancePct: 1 });
        expect(net.label).toContain(SLIPPAGE_NOT_MODELED_LABEL);
        expect(net.slippageModeled).toBe(false);
    });
});

describe('roundTripCostR', () => {
    it('charges the round trip against the risk distance', () => {
        // 10 bps round trip against a 1 % stop = 0.10 R.
        expect(roundTripCostR({ feeBpsPerSide: 5, slippageBps: 0, stopDistancePct: 1 }).costR).toBe(0.1);
        // The same fee against a 2 % stop is half the R.
        expect(roundTripCostR({ feeBpsPerSide: 5, slippageBps: 0, stopDistancePct: 2 }).costR).toBe(0.05);
        // The maker tier is cheaper on the same stop.
        expect(roundTripCostR({ feeBpsPerSide: 2, slippageBps: 0, stopDistancePct: 1 }).costR).toBe(0.04);
    });

    it('defaults to the taker tier', () => {
        expect(roundTripCostR({ stopDistancePct: 1 }).costR)
            .toBe(roundTripCostR({ feeBpsPerSide: FEE_TAKER_BPS, slippageBps: 0, stopDistancePct: 1 }).costR);
    });

    it('answers "unknown" rather than a misleading zero', () => {
        const noStop = roundTripCostR({ feeBpsPerSide: 5, slippageBps: 0, stopDistancePct: 0 });
        expect(noStop.costR).toBeNull();
        expect(noStop.known).toBe(false);
        expect(noStop.unknown).toBe('stop-distance');

        const negativeStop = roundTripCostR({ feeBpsPerSide: 5, slippageBps: 0, stopDistancePct: -1 });
        expect(negativeStop.costR).toBeNull();
        expect(negativeStop.unknown).toBe('stop-distance');

        const badFee = roundTripCostR({ feeBpsPerSide: Number.NaN, slippageBps: 0, stopDistancePct: 1 });
        expect(badFee.costR).toBeNull();
        expect(badFee.unknown).toBe('fee');
    });

    it('never stores a slippage-modelled claim', () => {
        // Passing a slippage number does NOT make the model claim it modelled
        // slippage — it has no model for it, and saying otherwise is the lie
        // the label exists to prevent.
        const withSlippage = roundTripCostR({ feeBpsPerSide: 5, slippageBps: 3, stopDistancePct: 1 });
        expect(withSlippage.slippageModeled).toBe(false);
        expect(withSlippage.costR).toBe(0.13);
    });
});

describe('netRiskReward', () => {
    it('subtracts the cost from the gross R', () => {
        const net = netRiskReward({ grossR: 1, stopDistancePct: 1 });
        expect(net.grossR).toBe(1);
        expect(net.costR).toBe(0.1);
        expect(net.netR).toBe(0.9);
        expect(net.known).toBe(true);
    });

    it('charges the cost on a LOSS too', () => {
        // You paid the fees and got stopped: a −1 R loss at a 0.1 R cost is
        // −1.1, not −1.
        const net = netRiskReward({ grossR: -1, stopDistancePct: 1 });
        expect(net.netR).toBe(-1.1);
    });

    it('answers "unknown" when the gross R is not a number', () => {
        const net = netRiskReward({ grossR: Number.NaN, stopDistancePct: 1 });
        expect(net.netR).toBeNull();
        expect(net.known).toBe(false);
        expect(net.unknown).toBe('gross-r');
    });

    it('answers "unknown" when the stop distance is not measurable', () => {
        const net = netRiskReward({ grossR: 1, stopDistancePct: 0 });
        expect(net.netR).toBeNull();
        expect(net.known).toBe(false);
        expect(net.unknown).toBe('stop-distance');
    });
});

describe('breakEvenWinRate', () => {
    it('is the no-cost 1/(1+r) when there is no cost', () => {
        // 1.2:1 with no cost breaks even at 45.45 %.
        expect(breakEvenWinRate({ rewardRatio: 1.2, costR: null })).toBeCloseTo(45.4545, 3);
    });

    it('rises with the cost', () => {
        // A 0.10 R cost against a 1.2:1 plan: (1 + 0.1) / (1 + 1.2) = 50 %.
        expect(breakEvenWinRate({ rewardRatio: 1.2, costR: 0.1 })).toBeCloseTo(50, 4);
        expect(breakEvenWinRate({ rewardRatio: 1.2, costR: 0.2 })!)
            .toBeGreaterThan(breakEvenWinRate({ rewardRatio: 1.2, costR: 0.1 })!);
    });

    it('answers "unknown" for an unusable ratio', () => {
        expect(breakEvenWinRate({ rewardRatio: Number.NaN, costR: 0.1 })).toBeNull();
        expect(breakEvenWinRate({ rewardRatio: -1, costR: 0.1 })).toBeNull();
    });
});

describe('netEdgeR — the minEdge arithmetic (E-43)', () => {
    it('charges the round trip on BOTH sides and answers in R', () => {
        // 44 % at 0.5R on a 1 % stop: cost 0.10R, win +0.40R, loss −1.10R.
        const edge = netEdgeR({ winProbability: 0.44, rewardRatio: 0.5, stopDistancePct: 1 });
        expect(edge.known).toBe(true);
        expect(edge.costR).toBe(0.1);
        expect(edge.netWinR).toBe(0.4);
        expect(edge.netLossR).toBe(-1.1);
        expect(edge.netEdgeR).toBeCloseTo(-0.44, 4);
        expect(edge.label).toContain(SLIPPAGE_NOT_MODELED_LABEL);
    });

    it('a plan at 72 % with 3R on a 5 % stop is positive', () => {
        const edge = netEdgeR({ winProbability: 0.72, rewardRatio: 3, stopDistancePct: 5 });
        expect(edge.netEdgeR).toBeGreaterThan(0);
        expect(edge.netEdgeR).toBeCloseTo(1.86, 2);
    });

    it('answers "unknown" for an unmeasurable stop or probability', () => {
        expect(netEdgeR({ winProbability: 0.5, rewardRatio: 2, stopDistancePct: 0 }).known).toBe(false);
        expect(netEdgeR({ winProbability: Number.NaN, rewardRatio: 2, stopDistancePct: 1 }).known).toBe(false);
        expect(netEdgeR({ winProbability: 1.5, rewardRatio: 2, stopDistancePct: 1 }).known).toBe(false);
    });
});

describe('stopDistancePercent', () => {
    it('measures the stop as a percent of price', () => {
        expect(stopDistancePercent(100, 95)).toBe(5);
        expect(stopDistancePercent(100, 105)).toBe(5);
    });

    it('is 0 for unusable levels — a gap, never a guess', () => {
        expect(stopDistancePercent(0, 95)).toBe(0);
        expect(stopDistancePercent(100, 0)).toBe(0);
        expect(stopDistancePercent(Number.NaN, 95)).toBe(0);
    });
});

describe('the cost model is PURE', () => {
    it('reads no storage of any kind', () => {
        const get = vi.spyOn(Storage.prototype, 'getItem');
        const set = vi.spyOn(Storage.prototype, 'setItem');
        netRiskReward({ grossR: 1, stopDistancePct: 1 });
        roundTripCostR({ stopDistancePct: 1 });
        breakEvenWinRate({ rewardRatio: 1.2, costR: 0.1 });
        expect(get).not.toHaveBeenCalled();
        expect(set).not.toHaveBeenCalled();
    });
});
