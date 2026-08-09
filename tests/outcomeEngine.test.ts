import { describe, it, expect } from 'vitest';
import type { Kline } from '../services/analysis/MarketDataService';
import { scanTradeOutcome, resolveOutcomeFromScan, formatDurationMs } from '../services/backtesting/outcomeEngine';

// The shared outcome engine is the single source of truth for trade verdicts
// (validateTradeOutcome, simulateFromAnalysisTime and AutoCaptureService all
// route through it). These tests pin the canonical semantics so the three
// engines can never drift apart again.

/** [open, high, low, close] per candle, starting at `start` (1m spacing). */
const candles = (start: number, ohlc: Array<[number, number, number, number]>): Kline[] =>
  ohlc.map(([open, high, low, close], i) => ({
    time: start + i * 60_000,
    open,
    high,
    low,
    close,
    volume: 100,
  }));

const T = Date.UTC(2026, 0, 1, 0, 0, 0);
// Long: entry 95000, SL 94000 (extended zone 93500), TP1 96000, TP2 97000.
const LONG = { entry: 95000, sl: 94000, tps: [96000, 97000, 0], isLong: true };

describe('scanTradeOutcome + resolveOutcomeFromScan — canonical semantics', () => {
  it('resolves same-candle SL+TP as LOSS (resting stop fills first)', () => {
    const scan = scanTradeOutcome(candles(T, [
      [95200, 95300, 94900, 95100], // entry triggered (low dips to 94900)
      [95500, 96200, 93900, 95600], // SL (94000) + TP1 (96000) same candle
    ]), LONG.entry, LONG.sl, LONG.tps, LONG.isLong);
    expect(scan.entryTriggered).toBe(true);
    expect(scan.slTouched).toBe(true);
    expect(scan.tpHits.map(h => h.level)).toEqual(['TP1']);
    const resolution = resolveOutcomeFromScan(scan);
    expect(resolution.outcome).toBe('LOSS');
    expect(resolution.hitTarget).toBe('SL');
  });

  it('resolves an SL wick followed by a LATER TP as WIN (recovery)', () => {
    const scan = scanTradeOutcome(candles(T, [
      [95200, 95300, 94900, 95100], // entry
      [95000, 95100, 93950, 94500], // SL wick (holds 150% zone)
      [94500, 96200, 94300, 96000], // TP1 later
    ]), LONG.entry, LONG.sl, LONG.tps, LONG.isLong);
    expect(resolveOutcomeFromScan(scan)).toMatchObject({ outcome: 'WIN', hitTarget: 'TP1' });
    expect(scan.slTouched).toBe(true);
  });

  it('resolves a 150% extended-SL breach as LOSS even when a TP is touched', () => {
    const scan = scanTradeOutcome(candles(T, [
      [95200, 95300, 94900, 95100], // entry
      [95500, 96200, 93400, 94000], // TP1 AND extended SL (93500) — hard stop wins
    ]), LONG.entry, LONG.sl, LONG.tps, LONG.isLong);
    const resolution = resolveOutcomeFromScan(scan);
    expect(resolution.outcome).toBe('LOSS');
    expect(resolution.hitTarget).toBe('SL');
    expect(scan.extendedSlExceeded).toBe(true);
  });

  it('resolves a plain SL touch with no TP as LOSS', () => {
    const scan = scanTradeOutcome(candles(T, [
      [95200, 95300, 94900, 95100], // entry
      [95100, 95200, 93950, 94500], // SL touched, no TP, within zone
    ]), LONG.entry, LONG.sl, LONG.tps, LONG.isLong);
    expect(resolveOutcomeFromScan(scan)).toMatchObject({ outcome: 'LOSS', hitTarget: 'SL' });
  });

  it('resolves a clean TP as WIN at the highest hit level', () => {
    const scan = scanTradeOutcome(candles(T, [
      [95200, 95300, 94900, 95100], // entry
      [95100, 97100, 95000, 96900], // TP1 + TP2
    ]), LONG.entry, LONG.sl, LONG.tps, LONG.isLong);
    expect(resolveOutcomeFromScan(scan)).toMatchObject({ outcome: 'WIN', hitTarget: 'TP2' });
    expect(scan.tpHits.map(h => h.level)).toEqual(['TP1', 'TP2']);
  });

  it('leaves the trade OPEN when neither SL nor TP is touched', () => {
    const scan = scanTradeOutcome(candles(T, [
      [95200, 95300, 94900, 95100], // entry
      [94500, 95800, 94400, 95500], // within range
    ]), LONG.entry, LONG.sl, LONG.tps, LONG.isLong);
    expect(resolveOutcomeFromScan(scan)).toMatchObject({ outcome: 'OPEN', hitTarget: 'NONE' });
  });

  it('does not count TP2 after a breakeven exit following TP1', () => {
    const scan = scanTradeOutcome(candles(T, [
      [95200, 95300, 94900, 95100], // entry
      [95100, 96100, 95050, 95900], // TP1 → stop moves to breakeven
      [95900, 96000, 94950, 95200], // breakeven exit (dips to entry)
      [95200, 97200, 95100, 97000], // later TP2 rally — never realized
    ]), LONG.entry, LONG.sl, LONG.tps, LONG.isLong);
    const resolution = resolveOutcomeFromScan(scan);
    expect(resolution.outcome).toBe('WIN');
    expect(resolution.hitTarget).toBe('TP1');
    expect(scan.tpHits).toHaveLength(1);
    expect(scan.breakevenHit).toBe(true);
  });

  it('disarms the 150% zone after TP1 (breakeven manages the remainder)', () => {
    // TP1 hit, then a deep drop BELOW the extended zone: the position was
    // already scaled out at TP1 — this must stay a WIN, not flip to LOSS.
    const scan = scanTradeOutcome(candles(T, [
      [95200, 95300, 94900, 95100], // entry
      [95100, 96100, 95050, 95900], // TP1
      [95900, 96000, 93000, 93500], // deep drop below extended zone (93500)
    ]), LONG.entry, LONG.sl, LONG.tps, LONG.isLong);
    const resolution = resolveOutcomeFromScan(scan);
    expect(resolution.outcome).toBe('WIN');
    expect(resolution.hitTarget).toBe('TP1');
    expect(scan.extendedSlExceeded).toBe(false);
  });

  it('excludes the final (forming) candle when requested', () => {
    // Outcome only exists on the LAST candle — with exclusion it reads OPEN.
    const raw = candles(T, [
      [95200, 95300, 94900, 95100], // entry
      [95100, 96100, 95000, 95900], // TP1 (last candle = forming)
    ]);
    const withExclusion = scanTradeOutcome(raw, LONG.entry, LONG.sl, LONG.tps, LONG.isLong, { excludeFormingCandle: true });
    expect(withExclusion.tpHits).toHaveLength(0);
    expect(resolveOutcomeFromScan(withExclusion).outcome).toBe('OPEN');
    const without = scanTradeOutcome(raw, LONG.entry, LONG.sl, LONG.tps, LONG.isLong);
    expect(resolveOutcomeFromScan(without).outcome).toBe('WIN');
  });

  it('respects startIndex (multi-entry callers already resolved the trigger)', () => {
    const raw = candles(T, [
      [95200, 95300, 94900, 95100], // NOT an entry for the passed price (below)
      [95500, 96100, 95000, 95900], // startIndex 1 = entry; TP1 same candle
    ]);
    const scan = scanTradeOutcome(raw, 96000, 94000, [96100, 0, 0], true, { startIndex: 1 });
    expect(scan.entryTriggeredAtIndex).toBe(1);
    expect(resolveOutcomeFromScan(scan)).toMatchObject({ outcome: 'WIN', hitTarget: 'TP1' });
  });

  it('mirrors all semantics for short positions', () => {
    // Short: entry 95000, SL 96000 (extended zone 96500), TP1 94000.
    const scan = scanTradeOutcome(candles(T, [
      [94800, 95000, 94700, 94900], // entry (high touches 95000)
      [94900, 96100, 93900, 95000], // SL (96000) + TP1 (94000) same candle
    ]), 95000, 96000, [94000, 0, 0], false);
    expect(resolveOutcomeFromScan(scan)).toMatchObject({ outcome: 'LOSS', hitTarget: 'SL' });
  });

  it('reports entry not triggered', () => {
    const scan = scanTradeOutcome(candles(T, [
      [95200, 95300, 95100, 95200], // never dips to 95000
    ]), LONG.entry, LONG.sl, LONG.tps, LONG.isLong);
    expect(scan.entryTriggered).toBe(false);
    expect(resolveOutcomeFromScan(scan).outcome).toBe('OPEN');
  });
});

describe('formatDurationMs', () => {
  it('formats hours and minutes', () => {
    expect(formatDurationMs(0)).toBe('0m');
    expect(formatDurationMs(30 * 60_000)).toBe('30m');
    expect(formatDurationMs(2 * 3_600_000 + 15 * 60_000)).toBe('2h 15m');
  });
});
