import { describe, it, expect } from 'vitest';
import {
  getCalibrationDrift,
  getConfidenceAccuracy,
  initializeCalibration,
} from '../services/validation/ConfidenceCalibrationService';
import type { ConfidenceCalibration } from '../types';

/** Calibration fixture with the given bucket populated; others empty. */
const calibrationWith = (
  bucket: 'high' | 'medium' | 'low' | 'avoid',
  wins: number,
  total: number,
): ConfidenceCalibration => {
  const base = initializeCalibration();
  return {
    ...base,
    [bucket]: { wins, losses: total - wins, total },
    lastUpdated: new Date().toISOString(),
  };
};

describe('getCalibrationDrift', () => {
  it('flags overconfident when declared runs > threshold above reality', () => {
    // 10/14 High wins = 71% historical (rounded)
    const drift = getCalibrationDrift(calibrationWith('high', 10, 14), 'High', 85);
    expect(drift.status).toBe('overconfident');
    expect(drift.declared).toBe(85);
    expect(drift.actual).toBe(71);
    expect(drift.delta).toBe(14);
    expect(drift.sampleSize).toBe(14);
  });

  it('flags underconfident when declared runs > threshold below reality', () => {
    // 7/12 Medium wins = 58% historical
    const drift = getCalibrationDrift(calibrationWith('medium', 7, 12), 'Medium', 40);
    expect(drift.status).toBe('underconfident');
    expect(drift.delta).toBe(-18);
    expect(drift.sampleSize).toBe(12);
  });

  it('reports accurate within the threshold', () => {
    // 9/12 Low wins = 75%; declared 67 → delta -8
    const drift = getCalibrationDrift(calibrationWith('low', 9, 12), 'Low', 67);
    expect(drift.status).toBe('accurate');
  });

  it('treats the threshold boundary (exactly ±10) as accurate', () => {
    // 6/10 High wins = 60%; declared 70 → delta +10
    expect(getCalibrationDrift(calibrationWith('high', 6, 10), 'High', 70).status).toBe('accurate');
    // 6/10 High wins = 60%; declared 50 → delta -10
    expect(getCalibrationDrift(calibrationWith('high', 6, 10), 'High', 50).status).toBe('accurate');
    // 6/10 High wins = 60%; declared 70.1 → delta +10.1
    expect(getCalibrationDrift(calibrationWith('high', 6, 10), 'High', 70.1).status).toBe('overconfident');
  });

  it('returns insufficient_data below the minimum sample size', () => {
    const drift = getCalibrationDrift(calibrationWith('high', 5, 8), 'High', 90);
    expect(drift.status).toBe('insufficient_data');
    expect(drift.actual).toBeNull();
    expect(drift.delta).toBeNull();
    expect(drift.sampleSize).toBe(8);
  });

  it('returns insufficient_data without calibration data', () => {
    expect(getCalibrationDrift(undefined, 'High', 80).status).toBe('insufficient_data');
  });

  it('treats a missing/zero declared probability as insufficient (0 = not provided)', () => {
    // 10/14 High wins — but declared 0 means the analysis carried no %.
    const cal = calibrationWith('high', 10, 14);
    expect(getCalibrationDrift(cal, 'High', 0).status).toBe('insufficient_data');
    expect(getCalibrationDrift(cal, 'High', Number.NaN).status).toBe('insufficient_data');
  });

  it('keeps getConfidenceAccuracy behavior via delegation', () => {
    const hot = calibrationWith('high', 6, 10); // 60% historical
    expect(getConfidenceAccuracy(hot, 'High', 75)).toBe('overconfident');
    expect(getConfidenceAccuracy(hot, 'High', 65)).toBe('accurate');
    expect(getConfidenceAccuracy(hot, 'High', 45)).toBe('underconfident');
    expect(getConfidenceAccuracy(undefined, 'High', 75)).toBe('insufficient_data');
    expect(getConfidenceAccuracy(calibrationWith('high', 3, 5), 'High', 75)).toBe('insufficient_data');
  });
});
