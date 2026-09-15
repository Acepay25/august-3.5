import { describe, it, expect } from 'vitest';
import { sanitizeLevelOrdering } from '../utils/levelOrder';

// The shared direction-aware TP/SL ordering gate (Tier-0 #7, deep-dive
// 2026-09-15). Canonical rules: Long → sl < entry <= tp1 <= tp2 <= tp3;
// Short mirrors. Repairs mirror levels across the entry so the model's
// stated risk/reward MAGNITUDES survive a flipped side.

describe('sanitizeLevelOrdering — Long', () => {
  it('accepts a correctly ordered plan without touching it', () => {
    const r = sanitizeLevelOrdering('Long', 95000, 94000, [96000, 97000, 98000]);
    expect(r.ok).toBe(true);
    expect(r.fixes).toEqual([]);
    expect(r.correctedStopLoss).toBe(94000);
    expect(r.correctedTakeProfits).toEqual([96000, 97000, 98000]);
  });

  it('mirrors a stop ABOVE entry to below entry', () => {
    const r = sanitizeLevelOrdering('Long', 95000, 95500, [96000]);
    expect(r.ok).toBe(false);
    expect(r.correctedStopLoss).toBe(94500);
    expect(r.correctedTakeProfits).toEqual([96000]);
    expect(r.fixes).toHaveLength(1);
    expect(r.fixes[0]).toMatch(/wrong side/i);
    expect(r.fixes[0]).toMatch(/mirrored to 94500/);
  });

  it('mirrors targets BELOW entry to above entry', () => {
    const r = sanitizeLevelOrdering('Long', 95000, 94000, [94000, 93000]);
    expect(r.ok).toBe(false);
    expect(r.correctedStopLoss).toBe(94000);
    expect(r.correctedTakeProfits).toEqual([96000, 97000]);
    expect(r.fixes.some((f) => /take-profit 94000/i.test(f))).toBe(true);
  });

  it('re-sorts a scrambled TP ladder ascending without mirroring valid legs', () => {
    const r = sanitizeLevelOrdering('Long', 95000, 94000, [97000, 96000, 98000]);
    expect(r.ok).toBe(false);
    expect(r.correctedTakeProfits).toEqual([96000, 97000, 98000]);
    expect(r.correctedStopLoss).toBe(94000);
    expect(r.fixes).toHaveLength(1);
    expect(r.fixes[0]).toMatch(/re-sorted/i);
  });

  it('combines mirror + re-sort for a fully inverted plan', () => {
    // The deep-dive repro: Long with SL above entry AND TP below entry.
    const r = sanitizeLevelOrdering('Long', 95000, 95500, [94000]);
    expect(r.ok).toBe(false);
    expect(r.correctedStopLoss).toBe(94500);
    expect(r.correctedTakeProfits).toEqual([96000]);
    expect(r.fixes).toHaveLength(2);
  });

  it('tolerates missing legs (null stop, null targets)', () => {
    expect(sanitizeLevelOrdering('Long', 95000, null, [96000, null, 97000]).ok).toBe(true);
    const r = sanitizeLevelOrdering('Long', 95000, null, [null, null, 93000]);
    expect(r.ok).toBe(false); // TP3 below entry on a long
    expect(r.correctedTakeProfits).toEqual([null, null, 97000]);
    expect(r.correctedStopLoss).toBeNull();
  });

  it('flags a stop exactly on entry as unrepairable', () => {
    const r = sanitizeLevelOrdering('Long', 95000, 95000, [96000]);
    expect(r.ok).toBe(false);
    expect(r.correctedStopLoss).toBe(95000); // left as-is, NOT fabricated
    expect(r.fixes[0]).toMatch(/zero risk distance/i);
  });

  it('round-trips float mirror math without noise', () => {
    const r = sanitizeLevelOrdering('Long', 95000, 95499.9, [96000]);
    expect(r.correctedStopLoss).toBe(94500.1);
  });
});

describe('sanitizeLevelOrdering — Short mirrors the Long rules', () => {
  it('accepts a correctly ordered short', () => {
    const r = sanitizeLevelOrdering('Short', 95000, 96000, [94000, 93000, 92000]);
    expect(r.ok).toBe(true);
    expect(r.fixes).toEqual([]);
  });

  it('mirrors a stop BELOW entry to above entry', () => {
    const r = sanitizeLevelOrdering('Short', 95000, 94500, [94000]);
    expect(r.ok).toBe(false);
    expect(r.correctedStopLoss).toBe(95500);
    expect(r.fixes[0]).toMatch(/mirrored to 95500/);
  });

  it('mirrors targets ABOVE entry to below entry and sorts descending', () => {
    const r = sanitizeLevelOrdering('Short', 95000, 96000, [96000, 97000]);
    expect(r.ok).toBe(false);
    expect(r.correctedTakeProfits).toEqual([94000, 93000]);
  });
});

describe('sanitizeLevelOrdering — passthrough cases', () => {
  it('Neutral has nothing to validate', () => {
    const r = sanitizeLevelOrdering('Neutral', 95000, 95500, [94000]);
    expect(r.ok).toBe(true);
    expect(r.fixes).toEqual([]);
  });

  it('unusable entry passes through untouched', () => {
    for (const entry of [0, -1, NaN, null, undefined]) {
      const r = sanitizeLevelOrdering('Long', entry as number | null, 95500, [94000]);
      expect(r.ok).toBe(true);
      expect(r.correctedStopLoss).toBe(95500);
    }
  });

  it('does not mutate the input array', () => {
    const tps = [97000, 96000];
    sanitizeLevelOrdering('Long', 95000, 94000, tps);
    expect(tps).toEqual([97000, 96000]);
  });
});
