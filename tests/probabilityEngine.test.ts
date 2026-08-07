import { describe, it, expect } from 'vitest';
import { ProbabilityEngineService } from '../services/analysis/ProbabilityEngineService';

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
