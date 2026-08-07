import { describe, it, expect, vi, afterEach } from 'vitest';
import { calculateRuinRisk, MonteCarloResult } from '../services/analysis/MonteCarloService';

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

afterEach(() => {
  vi.restoreAllMocks();
});

describe('calculateRuinRisk — fixed-fractional sizing', () => {
  it('uses riskPerTrade: all-loss sequences draw down exactly (1-f)^100 of the account', () => {
    // Math.random() = 1 → isWin (1 < 0.5) is always false → every trade loses.
    vi.spyOn(Math, 'random').mockReturnValue(1);

    // riskPerTrade = (1000 / 10000) * (3/100) * 1 = 0.003
    // 100 consecutive losses → equity = 10000 * (1 - 0.003)^100 ≈ 7405
    // drawdown = 1 - 0.7405 ≈ 0.2595 → 25% bucket hit, 50%/75% not.
    const result = calculateRuinRisk(10000, 1000, 1, mcResult);

    expect(result.prob25pctDrawdown).toBe(100);
    expect(result.prob50pctDrawdown).toBe(0);
    expect(result.prob75pctDrawdown).toBe(0);
    expect(result.expectedEquityAfter100).toBe(7405);
  });

  it('is account-aware: doubling the risk fraction roughly doubles the drawdown', () => {
    vi.spyOn(Math, 'random').mockReturnValue(1);

    // riskPerTrade = (2000 / 10000) * 0.03 = 0.006
    // equity = 10000 * (1 - 0.006)^100 ≈ 5478 → drawdown ≈ 0.452
    const result = calculateRuinRisk(10000, 2000, 1, mcResult);

    expect(result.prob25pctDrawdown).toBe(100);
    expect(result.prob50pctDrawdown).toBe(0); // 0.452 < 0.5
    expect(result.expectedEquityAfter100).toBe(5478);
  });

  it('returns sane ranges for a mixed outcome stream', () => {
    // Alternating wins/losses with a fixed seed — the probabilities must stay
    // in 0-100 and the buckets must be monotonic (25 ≥ 50 ≥ 75).
    let calls = 0;
    vi.spyOn(Math, 'random').mockImplementation(() => {
      calls++;
      return calls % 2 === 0 ? 0.2 : 0.8; // 0.2 < 0.5 → win; 0.8 → loss
    });

    const result = calculateRuinRisk(10000, 500, 1, mcResult);

    expect(result.prob25pctDrawdown).toBeGreaterThanOrEqual(result.prob50pctDrawdown);
    expect(result.prob50pctDrawdown).toBeGreaterThanOrEqual(result.prob75pctDrawdown);
    expect(result.prob25pctDrawdown).toBeGreaterThanOrEqual(0);
    expect(result.prob25pctDrawdown).toBeLessThanOrEqual(100);
    expect(result.expectedEquityAfter100).toBeGreaterThan(0);
  });
});
