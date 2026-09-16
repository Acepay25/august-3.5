import { describe, it, expect } from 'vitest';
import {
  calculateRuinRisk,
  deriveRuinRiskSeed,
  runSimulation,
  MonteCarloResult,
} from '../services/analysis/MonteCarloService';

// Deterministic fixture: the drawdown probabilities must be driven by the
// account-relative riskPerTrade — the old loop applied the absolute
// positionSize and never used the computed risk fraction.
const mcResult: MonteCarloResult = {
  simulations: 1000,
  winRate: 50,
  winCount: 500,
  expectedValue: 2,
  timeframe: '1h',
  probabilities: { tp1Hit: 50, tp2Hit: 30, tp3Hit: 20, slHit: 50, timeout: 0 },
  maxDrawdownAvg: 5,
  timeToOutcomeAvg: 10,
  confidenceInterval: { lower: -3, upper: 4 },
};

// A fixture where NO simulation wins (every resolved path hit the SL) —
// drives the all-loss equity stream deterministically now that the loop runs
// on the seeded PRNG instead of Math.random (the old suite spied on
// Math.random; that spy no longer reaches the loop).
const allLossResult: MonteCarloResult = {
  ...mcResult,
  winRate: 0,
  winCount: 0,
  probabilities: { tp1Hit: 0, tp2Hit: 0, tp3Hit: 0, slHit: 100, timeout: 0 },
};

describe('calculateRuinRisk — fixed-fractional sizing', () => {
  it('uses riskPerTrade: all-loss sequences draw down exactly (1-f)^100 of the account', () => {
    // riskPerTrade = (1000 / 10000) * (3/100) * 1 = 0.003
    // 100 consecutive losses → equity = 10000 * (1 - 0.003)^100 ≈ 7405
    // drawdown = 1 - 0.7405 ≈ 0.2595 → 25% bucket hit, 50%/75% not.
    const result = calculateRuinRisk(10000, 1000, 1, allLossResult);

    expect(result.prob25pctDrawdown).toBe(100);
    expect(result.prob50pctDrawdown).toBe(0);
    expect(result.prob75pctDrawdown).toBe(0);
    expect(result.expectedEquityAfter100).toBe(7405);
  });

  it('is account-aware: doubling the risk fraction roughly doubles the drawdown', () => {
    // riskPerTrade = (2000 / 10000) * 0.03 = 0.006
    // equity = 10000 * (1 - 0.006)^100 ≈ 5478 → drawdown ≈ 0.452
    const result = calculateRuinRisk(10000, 2000, 1, allLossResult);

    expect(result.prob25pctDrawdown).toBe(100);
    expect(result.prob50pctDrawdown).toBe(0); // 0.452 < 0.5
    expect(result.expectedEquityAfter100).toBe(5478);
  });

  it('returns sane ranges for a mixed outcome stream', () => {
    // Seeded stream (no Math.random spy needed) — the probabilities must stay
    // in 0-100 and the buckets must be monotonic (25 ≥ 50 ≥ 75).
    const result = calculateRuinRisk(10000, 500, 1, mcResult);

    expect(result.prob25pctDrawdown).toBeGreaterThanOrEqual(result.prob50pctDrawdown);
    expect(result.prob50pctDrawdown).toBeGreaterThanOrEqual(result.prob75pctDrawdown);
    expect(result.prob25pctDrawdown).toBeGreaterThanOrEqual(0);
    expect(result.prob25pctDrawdown).toBeLessThanOrEqual(100);
    expect(result.expectedEquityAfter100).toBeGreaterThan(0);
  });
});

describe('calculateRuinRisk — seeded determinism', () => {
  it('same inputs → identical results across calls (the loop is no longer bare Math.random)', () => {
    const a = calculateRuinRisk(10000, 1000, 10, mcResult);
    const b = calculateRuinRisk(10000, 1000, 10, mcResult);
    expect(a).toEqual(b);
  });

  it('worker and sync paths run the same function over the same payload — an explicit seed matching the derived one changes nothing', () => {
    // Both execution paths (monteCarlo.worker.ts and the withWorkerTimeout
    // fallback) invoke THIS exported function with the same arguments, so
    // equality here is the worker-vs-sync guarantee.
    const derived = deriveRuinRiskSeed(10000, 1000, 10, mcResult);
    expect(calculateRuinRisk(10000, 1000, 10, mcResult, derived))
      .toEqual(calculateRuinRisk(10000, 1000, 10, mcResult));
  });

  it('the setup identity flows through: different Monte Carlo results give different ruin sims', () => {
    const withSeedA = calculateRuinRisk(10000, 1000, 10, { ...mcResult, seedUsed: 1234 });
    const withSeedB = calculateRuinRisk(10000, 1000, 10, { ...mcResult, seedUsed: 9876 });
    // Different derived seeds sample different equity paths (the aggregate
    // stats may round to nearby values, but they are not one frozen stream).
    expect(withSeedA.expectedEquityAfter100).not.toBe(withSeedB.expectedEquityAfter100);
  });

  it('a full runSimulation → calculateRuinRisk pipeline is reproducible end to end', () => {
    const cfg = {
      entry: 100, stopLoss: 97, takeProfits: [104, 110, 120],
      direction: 'Long' as const, atr: 2, timeframe: '1h', numSimulations: 300,
    };
    const ruinA = calculateRuinRisk(10000, 1500, 20, runSimulation(cfg));
    const ruinB = calculateRuinRisk(10000, 1500, 20, runSimulation(cfg));
    expect(ruinA).toEqual(ruinB);
  });
});

describe('calculateRuinRisk — Kelly uses the RESOLVED subsample', () => {
  it('a 3:1 edge at a long horizon (many timeouts) keeps a positive f* instead of collapsing to 0', () => {
    // 1000 sims: 225 TP, 275 SL, 500 TIMEOUT. Unconditional p = 22.5% with
    // b = avgWin/avgLoss = 6/2 = 3 → (3·0.225 − 0.775)/3 < 0 → the OLD
    // sample-mixed input reported f* = 0 despite the resolved stream being
    // 45% wins at 3:1 (EV +1.6%).
    const longHorizon: MonteCarloResult = {
      simulations: 1000,
      winRate: 22.5,
      winCount: 225,
      resolvedCount: 500,
      expectedValue: 1.6,
      timeframe: '1h',
      avgWinPercent: 6,
      avgLossPercent: 2,
      probabilities: { tp1Hit: 10, tp2Hit: 10, tp3Hit: 5, slHit: 27.5, timeout: 50 },
      maxDrawdownAvg: 5,
      timeToOutcomeAvg: 40,
      confidenceInterval: { lower: -2, upper: 8 },
    };
    const result = calculateRuinRisk(10000, 500, 1, longHorizon);
    // p = 225/500 = 45%, b = 3 → f* = (3·0.45 − 0.55)/3 ≈ 0.2667 → 26.7%
    expect(result.kellyOptimalSize).toBeCloseTo(26.7, 1);
    expect(result.kellyOptimalSize).toBeGreaterThan(0);
  });

  it('legacy results without resolvedCount still derive p from simulations − timeout', () => {
    const legacy: MonteCarloResult = { ...mcResult, resolvedCount: undefined };
    const withLegacy = calculateRuinRisk(10000, 500, 1, legacy);
    const withExplicit = calculateRuinRisk(10000, 500, 1, { ...mcResult, resolvedCount: 1000 });
    expect(withLegacy.kellyOptimalSize).toBe(withExplicit.kellyOptimalSize);
  });
});
