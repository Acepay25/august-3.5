import { describe, it, expect } from 'vitest';
import { getBayesianCalibratedConfidence } from '../services/validation/calibrationPolicy';
import { initializeCalibration } from '../services/validation/calibrationStore';
import type { ConfidenceLevel } from '../services/validation/calibrationStore';
import type { ConfidenceCalibration, GranularCalibration } from '../types';

/**
 * `getBayesianCalibratedConfidence` drags a model's self-rated probability
 * toward the provider's own historical win rate:
 *   calibrated = (raw × 10 + prior% × min(total, 50)) / (10 + min(total, 50))
 * Below 10 provider trades nothing is trusted yet and the raw value is
 * returned untouched. This arithmetic decides what the AI is told its setup is
 * worth, and until now the only file exercising it was `tests/test-bayesian.ts`
 * — which vitest never collects (the include pattern wants `*.test.ts`), has no
 * assertion in it, and appends `services/test_output.txt` if anyone runs it.
 * Every number below is computed by hand from the formula above.
 */

const EMPTY = {};

const calibrationWithProvider = (
  provider: string,
  wins: number,
  total: number
): ConfidenceCalibration => {
  const granular: GranularCalibration = {
    byCoin: EMPTY,
    byPattern: EMPTY,
    byTimeframe: EMPTY,
    byRegime: EMPTY,
    bySession: EMPTY,
    byDayOfWeek: EMPTY,
    byProvider: { [provider]: { wins, losses: total - wins, total } },
  };
  return { ...initializeCalibration(), granular };
};

const ask = (
  calibration: ConfidenceCalibration | undefined,
  raw: number,
  confidence: ConfidenceLevel = 'High'
): number => getBayesianCalibratedConfidence(calibration, 'gemini', confidence, raw);

describe('Bayesian calibrated confidence', () => {
  it('passes the raw value through until the provider has 10 trades', () => {
    expect(ask(undefined, 85)).toBe(85);
    // No granular block at all — the shape an un-migrated store still has.
    expect(ask(initializeCalibration(), 85)).toBe(85);
    // 9 trades is still a cold start; the 10th is the first that counts.
    expect(ask(calibrationWithProvider('gemini', 9, 9), 72)).toBe(72);
    // A provider nobody has recorded never reaches the weighted average —
    // `ask` looks up 'gemini', and this fixture only knows another id.
    expect(ask(calibrationWithProvider('openai', 30, 30), 90)).toBe(90);
  });

  it('pulls an over-rated forecast down to the provider record', () => {
    // prior 10/20 = 50% → (85×10 + 50×20) / 30 = 1850/30 = 61.67 → 62
    expect(ask(calibrationWithProvider('gemini', 10, 20), 85)).toBe(62);
  });

  it('caps history weight at 50 trades so a long record cannot fossilize the number', () => {
    // prior 64/80 = 80%; min(80,50) = 50 → (70×10 + 80×50) / 60 = 4700/60 = 78.33 → 78.
    // Without the cap it would be (700 + 6400) / 90 = 78.9 → 79, so the two
    // branches are genuinely different answers and this pins the capped one.
    expect(ask(calibrationWithProvider('gemini', 64, 80), 70)).toBe(78);
  });

  it('pulls an under-rated forecast up when the provider has been right', () => {
    // prior 30/30 = 100% → (50×10 + 100×30) / 40 = 3500/40 = 87.5 → 88 (rounds half up)
    expect(ask(calibrationWithProvider('gemini', 30, 30), 50)).toBe(88);
  });

  it('treats 0% as a real forecast, unlike the drift classifier', () => {
    // getCalibrationDrift reads a 0 declared probability as "not provided";
    // this function has no such guard, so 0 is averaged as a genuine 0%.
    // prior 20/40 = 50% → (0×10 + 50×40) / 50 = 2000/50 = 40
    expect(ask(calibrationWithProvider('gemini', 20, 40), 0)).toBe(40);
  });

  it('starts weighting at exactly the 10-trade threshold', () => {
    // prior 5/10 = 50%, weightHistory 10 → (80×10 + 50×10) / 20 = 1300/20 = 65
    expect(ask(calibrationWithProvider('gemini', 5, 10), 80)).toBe(65);
  });

  it('is moved by the provider record, not by the confidence label', () => {
    const cal = calibrationWithProvider('gemini', 10, 20);
    // The label is read into `globalStats` and then never used; whatever a
    // future change does with it, these three are equal TODAY and that is what
    // this pins — if it stops being true, this test is the notice.
    expect(ask(cal, 85, 'High')).toBe(62);
    expect(ask(cal, 85, 'Medium')).toBe(62);
    expect(ask(cal, 85, 'Low')).toBe(62);
  });
});
