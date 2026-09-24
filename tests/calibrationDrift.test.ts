import { describe, it, expect } from 'vitest';
import {
  getCalibrationDrift,
  getConfidenceAccuracy,
  getCalibratedWinRate,
  initializeCalibration,
  updateCalibration,
  updateGranularCalibration,
} from '../services/validation/ConfidenceCalibrationService';
import { MAX_TRADE_AGE_DAYS } from '../constants/calibrationConstants';
import { TradeOutcome } from '../types';
import type { ConfidenceCalibration, GranularCalibrationEntry } from '../types';

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

const entry = (over: Partial<GranularCalibrationEntry> & { timestamp: string }): GranularCalibrationEntry => ({
  confidence: 'High',
  outcome: 'WIN',
  coin: 'BTCUSDT',
  ...over,
});

describe('granularEntries are bounded by the same horizon as base entries', () => {
  const now = Date.now();
  const iso = (daysAgo: number): string => new Date(now - daysAgo * 86_400_000).toISOString();

  it('prunes granular history older than MAX_TRADE_AGE_DAYS on every settled write', () => {
    const loaded: ConfidenceCalibration = {
      ...initializeCalibration(),
      entries: [],
      granularEntries: [
        entry({ timestamp: iso(MAX_TRADE_AGE_DAYS + 30) }), // ancient → dropped
        entry({ timestamp: iso(MAX_TRADE_AGE_DAYS + 1), outcome: 'LOSS' }), // just past → dropped
        entry({ timestamp: iso(10) }), // inside the horizon → kept
      ],
    };
    const out = updateGranularCalibration(loaded, entry({ timestamp: iso(0) }));
    // Pre-fix this array grew UNBOUNDED (base `entries` were pruned to 90d,
    // granularEntries never were) and every scan paid O(n) on it.
    expect(out.granularEntries).toHaveLength(2);
    const horizon = now - MAX_TRADE_AGE_DAYS * 86_400_000;
    expect(out.granularEntries!.every(e => Date.parse(e.timestamp) >= horizon)).toBe(true);
    expect(out.granularEntries!.some(e => e.timestamp === iso(10))).toBe(true);
    expect(out.granularEntries!.some(e => e.timestamp === iso(0))).toBe(true);
  });

  it('drops junk rows with a missing/unparseable timestamp (matches base entries)', () => {
    const loaded: ConfidenceCalibration = {
      ...initializeCalibration(),
      granularEntries: [{ marker: 'REAL-HISTORY-ENTRY' } as unknown as GranularCalibrationEntry],
    };
    const out = updateGranularCalibration(loaded, entry({ timestamp: iso(0) }));
    // Legacy rule kept unknown-age rows forever — exactly the unbounded
    // leak the prune exists to close (they can never satisfy the cutoff
    // comparison, so they rode every settled write). The base `entries`
    // prune drops them; granular entries now follow the same semantics.
    expect(out.granularEntries).toHaveLength(1);
    expect(JSON.stringify(out.granularEntries)).not.toContain('REAL-HISTORY-ENTRY');
    expect(out.granularEntries![0].timestamp).toBe(iso(0));
  });
});

/**
 * The aggregate buckets used to be INCREMENTED and never decremented, while
 * `entries` aged out at MAX_TRADE_AGE_DAYS. Every real consumer read the
 * buckets — the drift verdict, the confidence penalty, the Health tab, and the
 * block injected into EVERY analysis prompt. Executed before the fix: 30 High
 * wins from 120 days ago plus 10 recent High losses reported "High: 75% win
 * rate, n=40, STRONG" in the prompt while the correctly-computed decayed
 * reader said 0%. A model told its edge is intact years after it decayed.
 */
describe('calibration aggregates follow the decay horizon', () => {
    const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();

    it('drops out-of-horizon trades from the aggregate, not just from entries', () => {
        const stale: ConfidenceCalibration = {
            ...initializeCalibration(),
            // 30 old High wins, all beyond the horizon.
            entries: Array.from({ length: 30 }, () => ({
                timestamp: iso(MAX_TRADE_AGE_DAYS + 30),
                confidence: 'High' as const,
                outcome: 'WIN' as const,
            })),
            // 3 recent High losses.
            high: { wins: 30, losses: 0, total: 30 },
        };

        const out = updateCalibration(stale, 'High', TradeOutcome.LOSS);

        // The stale 30 wins are GONE from the aggregate…
        expect((out.entries ?? []).every(e => new Date(e.timestamp).getTime()
            >= Date.now() - MAX_TRADE_AGE_DAYS * 86_400_000)).toBe(true);
        expect(out.high!.wins).toBe(0);
        expect(out.high!.total).toBeGreaterThan(0);
        // …so the bucket now reflects only what survives the horizon.
        expect(out.high!.wins).toBeLessThan(out.high!.total);
    });

    it('a stale history cannot keep a provider reading as calibrated', () => {
        const stale: ConfidenceCalibration = {
            ...initializeCalibration(),
            entries: Array.from({ length: 30 }, () => ({
                timestamp: iso(MAX_TRADE_AGE_DAYS + 30),
                confidence: 'High' as const,
                outcome: 'WIN' as const,
            })),
            high: { wins: 30, losses: 0, total: 30 },
        };
        const out = updateCalibration(stale, 'High', TradeOutcome.LOSS);
        const rate = getCalibratedWinRate(out, 'High');
        // Whatever the verdict, it is computed from a bounded population —
        // never 100% from a 120-day-old record.
        expect(rate === null || rate < 100).toBe(true);
    });
});
