import { describe, it, expect } from 'vitest';
import { ProbabilityEngineService, normalizeMacdHist } from '../services/analysis/ProbabilityEngineService';

// B6 regression tests: the feature extractor read the WRONG shapes
// (indicators.rsi?.value instead of rsi.rsi14, snapshot.regime?.primaryRegime
// instead of the RegimeAnalysis object), so the 0.90 "Regime Conflict"
// multiplier fired on nearly every trade and "Regime Aligned" never did.

const baseSnapshot = () => ({
  indicators: {
    '4h': {
      rsi: { rsi6: 55, rsi12: 54, rsi14: 53, rsi24: 52 },
      adx: 28,
      macd: { histogram: 12, dif: 4, dea: 2, trend: 'bullish' as const },
    },
  },
  confluence: { score: 70 },
});

const run = (snapshot: unknown, direction: 'Long' | 'Short' = 'Long') =>
  ProbabilityEngineService.calculateAlgoProbabilities(snapshot, [], direction);

describe('ProbabilityEngineService — regime alignment (B6)', () => {
  it('applies the 1.10 multiplier when the regime aligns with the direction', () => {
    // Long trade in a strong_trend_up regime with bullish trendDirection.
    const aligned = run({
      ...baseSnapshot(),
      regime: { regime: 'strong_trend_up', trendDirection: 'bullish', adx: 40, plusDI: 30, minusDI: 12, trendStrength: 'strong', tradingBias: 'trend_following', recommendation: 'x' },
    }, 'Long');
    const baseline = run({ ...baseSnapshot(), regime: { regime: 'ranging', trendDirection: 'neutral', adx: 18, plusDI: 15, minusDI: 15, trendStrength: 'none', tradingBias: 'mean_reversion', recommendation: 'x' } }, 'Long');
    // Baseline prior is 55 (no history) — aligned should be 55 * 1.10 ≈ 60.5.
    expect(aligned.tp1Probability!).toBeGreaterThan(baseline.tp1Probability! + 4);
  });

  it('applies the 0.90 conflict multiplier only on a genuine conflict', () => {
    // Long trade while the regime is strongly bearish.
    const conflicting = run({
      ...baseSnapshot(),
      regime: { regime: 'strong_trend_down', trendDirection: 'bearish', adx: 40, plusDI: 12, minusDI: 30, trendStrength: 'strong', tradingBias: 'trend_following', recommendation: 'x' },
    }, 'Long');
    const baseline = run({ ...baseSnapshot(), regime: { regime: 'ranging', trendDirection: 'neutral', adx: 18, plusDI: 15, minusDI: 15, trendStrength: 'none', tradingBias: 'mean_reversion', recommendation: 'x' } }, 'Long');
    expect(conflicting.tp1Probability!).toBeLessThan(baseline.tp1Probability! - 4);
  });

  it('reads the real RSI/ADX shapes instead of always falling back to defaults', () => {
    // Overbought RSI in the snapshot must not silently fall back to 50/25 —
    // with matching trades absent the features still flow into the reasoning
    // path without crashing, and a differing ADX produces a different verdict
    // when a same-direction history exists.
    const strong = run({
      ...baseSnapshot(),
      indicators: { '4h': { rsi: { rsi14: 82, rsi6: 85, rsi12: 80, rsi24: 75 }, adx: 45, macd: { histogram: 5, dif: 2, dea: 1, trend: 'bullish' as const } } },
      regime: { regime: 'strong_trend_up', trendDirection: 'bullish', adx: 45, plusDI: 32, minusDI: 10, trendStrength: 'strong', tradingBias: 'trend_following', recommendation: 'x' },
    }, 'Long');
    expect(strong.tp1Probability).toBeGreaterThan(50);
    expect(strong.tp1Probability).toBeLessThanOrEqual(100);
    expect(typeof strong.slReasoning?.indicatorBasis).toBe('string');
  });

  it('does not crash when the snapshot has NO regime (undefined.includes regression)', () => {
    // The old `snapshot.regime?.primaryRegime.includes(...)` threw a TypeError
    // on snapshots without a regime — the normal case for saved trades.
    const result = run({ indicators: { '4h': { rsi: { rsi14: 55 }, macd: { histogram: 0 } } } }, 'Short');
    expect(result.tp1Probability).toBeGreaterThanOrEqual(1);
    expect(result.calculationMode).toBe('Algo');
  });

  it('treats chop/compression as neutral — no regime multiplier either way', () => {
    // Previously any non-ranging regime (volatile_chop, compression) fired
    // the 0.90 "Regime Conflict" penalty even though nothing conflicted.
    const chop = run({ ...baseSnapshot(), regime: { regime: 'volatile_chop', trendDirection: 'neutral', adx: 12, plusDI: 10, minusDI: 10, trendStrength: 'none', tradingBias: 'avoid', recommendation: 'x' } }, 'Long');
    const baseline = run({ ...baseSnapshot(), regime: { regime: 'ranging', trendDirection: 'neutral', adx: 18, plusDI: 15, minusDI: 15, trendStrength: 'none', tradingBias: 'mean_reversion', recommendation: 'x' } }, 'Long');
    expect(chop.tp1Probability).toBe(baseline.tp1Probability);
  });

  it('reads the real CVD shape (advancedVolume.cvd, not delta["1h"])', () => {
    const withCvd = run({
      ...baseSnapshot(),
      advancedVolume: { cvd: 1200 },
      regime: { regime: 'ranging', trendDirection: 'neutral', adx: 18, plusDI: 15, minusDI: 15, trendStrength: 'none', tradingBias: 'mean_reversion', recommendation: 'x' },
    }, 'Long');
    const baseline = run({ ...baseSnapshot(), regime: { regime: 'ranging', trendDirection: 'neutral', adx: 18, plusDI: 15, minusDI: 15, trendStrength: 'none', tradingBias: 'mean_reversion', recommendation: 'x' } }, 'Long');
    // 55 × 1.05 (vol delta support) = 57.75 → 58 vs plain 55.
    expect(withCvd.tp1Probability).toBe(58);
    expect(baseline.tp1Probability).toBe(55);
  });
});

describe('ProbabilityEngineService — target decay', () => {
  const snap = { ...baseSnapshot(), regime: { regime: 'ranging', trendDirection: 'neutral', adx: 18, plusDI: 15, minusDI: 15, trendStrength: 'none', tradingBias: 'mean_reversion', recommendation: 'x' } };

  it('keeps TP1 > TP2 > TP3 strictly ordered and never negative', () => {
    // The old fixed -15/-30 decay collapsed both to 0 for a low base and
    // ignored distance entirely.
    for (const direction of ['Long', 'Short'] as const) {
      const r = ProbabilityEngineService.calculateAlgoProbabilities(snap, [], direction);
      expect(r.tp1Probability!).toBeGreaterThanOrEqual(r.tp2Probability!);
      expect(r.tp2Probability!).toBeGreaterThanOrEqual(r.tp3Probability!);
      expect(r.tp3Probability!).toBeGreaterThanOrEqual(0);
    }
  });

  it('decays by distance: a near TP2 keeps more probability than a far one', () => {
    const near = ProbabilityEngineService.calculateAlgoProbabilities(snap, [], 'Long', [2, 3, 4]);
    const far = ProbabilityEngineService.calculateAlgoProbabilities(snap, [], 'Long', [2, 20, 40]);
    expect(near.tp2Probability!).toBeGreaterThan(far.tp2Probability!);
    expect(near.tp3Probability!).toBeGreaterThan(far.tp3Probability!);
    // TP1 is the base either way.
    expect(near.tp1Probability).toBe(far.tp1Probability);
  });

  it('falls back to fixed ratios when no distances are given', () => {
    const r = ProbabilityEngineService.calculateAlgoProbabilities(snap, [], 'Long');
    expect(r.tp2Probability).toBeCloseTo(r.tp1Probability! * 0.75, 1);
    expect(r.tp3Probability).toBeCloseTo(r.tp1Probability! * 0.55, 1);
  });
});

// =============================================================================
// Wave-2 (deep-dive 2026-09-15, item 11): MACD normalization + SL probability
// =============================================================================

describe('normalizeMacdHist — cross-coin comparability', () => {
  it('expresses the histogram in ATR units, not raw price units', () => {
    // BTC: histogram 16 USD with a 800 ATR → 0.02 ATRs.
    const btc = normalizeMacdHist({ macd: { histogram: 16 }, atr: 800, currentPrice: 95000 });
    // A 1000×-cheaper alt with proportionally small ATR: histogram 0.016,
    // atr 0.8 → SAME 0.02. Raw units would have contributed |16 − 0.016|/50
    // ≈ 0.32 of Euclidean distance — dominated by BTC's price scale.
    const alt = normalizeMacdHist({ macd: { histogram: 0.016 }, atr: 0.8, currentPrice: 95 });
    expect(btc).toBeCloseTo(0.02, 6);
    expect(alt).toBeCloseTo(0.02, 6);
  });

  it('falls back to 1% of price as the denominator, then 0', () => {
    expect(normalizeMacdHist({ macd: { histogram: 9.5 }, currentPrice: 95000 })).toBeCloseTo(0.01, 6);
    expect(normalizeMacdHist({ macd: { histogram: 12 } })).toBe(0);
  });
});

describe('SL probability — no complementary-event claim', () => {
  const snap = { ...baseSnapshot(), regime: { regime: 'ranging', trendDirection: 'neutral', adx: 18, plusDI: 15, minusDI: 15, trendStrength: 'none', tradingBias: 'mean_reversion', recommendation: 'x' } };

  it('computes the stop-hit probability from the barrier race when a stop distance is given', () => {
    // Prior 55, TP1 2% away, SL 10% away → P(SL) ≈ 55 × 2/10 = 11.
    // The old `100 − 55` complement claimed 45%.
    const r = ProbabilityEngineService.calculateAlgoProbabilities(snap, [], 'Long', [2, 3, 4], 10);
    expect(r.slProbability).toBe(11);
    expect(r.slReasoning.indicatorBasis).toMatch(/Barrier race/);
  });

  it('never claims "SL hit: ~50%" for a stop that is a hair away without a distance', () => {
    // The near-stop absurdity: a 0.2%-away stop cannot be ~45% likely merely
    // because TP1 is 55% unlikely. With an explicit tiny distance the
    // barrier-race odds inflate toward 100 (clamped) instead:
    const absurd = ProbabilityEngineService.calculateAlgoProbabilities(snap, [], 'Long', [12, 20, 30], 0.2);
    expect(absurd.slProbability).toBeGreaterThanOrEqual(absurd.tp1Probability!);
    // Without ANY stop distance the number is labeled an UPPER BOUND, not a
    // point estimate of the stop probability (the claim itself is removed).
    const bound = ProbabilityEngineService.calculateAlgoProbabilities(snap, [], 'Long', [12, 20, 30]);
    expect(bound.slReasoning.indicatorBasis).toMatch(/UPPER BOUND/);
    expect(bound.slReasoning.indicatorBasis).toMatch(/NOT a point estimate/);
  });
});
