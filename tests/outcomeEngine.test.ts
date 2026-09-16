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

  it('does NOT credit a TP that printed on the fill candle when the limit filled mid-bar (look-ahead)', () => {
    // A 1h bar can wick UP through TP then drop to fill the limit — the touch
    // preceded the fill, so it must not bank a WIN. Entry candle opens ABOVE
    // entry (95300), spikes to 96500 (past TP1 96000), dips to 94900 (fills),
    // then the next bar loses at SL. Old engine: phantom WIN at TP1.
    const scan = scanTradeOutcome(candles(T, [
      [95300, 96500, 94900, 95000], // entry fills mid-bar; TP1 touched (pre-fill)
      [95000, 95050, 93900, 94000], // SL 94000 hit, no revisit of TP
    ]), LONG.entry, LONG.sl, LONG.tps, LONG.isLong);
    expect(scan.tpHits).toHaveLength(0);
    expect(resolveOutcomeFromScan(scan)).toMatchObject({ outcome: 'LOSS', hitTarget: 'SL' });
  });

  it('DOES credit a TP on the entry candle when it opened executable (whole bar post-fill)', () => {
    // Open 94900 ≤ entry 95000 → the limit was fillable at the open, so the
    // entire candle is genuinely post-fill and its TP touch is real.
    const scan = scanTradeOutcome(candles(T, [
      [94900, 96500, 94850, 96000], // open below entry → filled at open, then TP1
    ]), LONG.entry, LONG.sl, LONG.tps, LONG.isLong);
    expect(scan.tpHits.map(h => h.level)).toEqual(['TP1']);
    expect(resolveOutcomeFromScan(scan)).toMatchObject({ outcome: 'WIN', hitTarget: 'TP1' });
  });

  it('gates the same ambiguity for shorts (wick down through TP before the fill)', () => {
    // Short: entry 95000, SL 96000, TP1 94000. Entry candle opens BELOW entry
    // (94800 → not executable at open for a short that fills by rising to it),
    // wicks DOWN to 93500 (past TP1) then up to 95100 (fills). Pre-fill → no win.
    const scan = scanTradeOutcome(candles(T, [
      [94800, 95100, 93500, 95000], // fills mid-bar; TP1 touched pre-fill
      [95000, 96100, 94950, 96000], // SL 96000 hit
    ]), 95000, 96000, [94000, 0, 0], false);
    expect(scan.tpHits).toHaveLength(0);
    expect(resolveOutcomeFromScan(scan)).toMatchObject({ outcome: 'LOSS', hitTarget: 'SL' });
  });

  it('respects startIndex (a pre-filled position is never gated)', () => {
    // Entry candle here opens ABOVE the fill but the caller supplied startIndex
    // (position already established) → TP must still count on that candle.
    const raw = candles(T, [
      [95200, 95300, 94900, 95100],
      [95500, 96500, 95400, 96000], // open 95500 > entry 96000? no; TP1 96100 by high
    ]);
    const scan = scanTradeOutcome(raw, 96000, 94000, [96100, 0, 0], true, { startIndex: 1 });
    expect(resolveOutcomeFromScan(scan)).toMatchObject({ outcome: 'WIN', hitTarget: 'TP1' });
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

// Tier-0 #7 (deep-dive 2026-09-15): an inverted plan (Long stop ABOVE entry,
// "TP" BELOW it) used to print an instant same-candle WIN — the low ≤ entry
// trigger and high ≥ tp both hit on bar one. The engine now refuses to score
// such plans at all (defense-in-depth behind the sanitize-time repair gate).
describe('scanTradeOutcome — inverted-plan refusal (Tier-0 #7)', () => {
  it('gives an inverted Long no same-candle WIN (INVALID, no credit)', () => {
    const scan = scanTradeOutcome(candles(T, [
      [95200, 95300, 94900, 95100], // entry triggers on the low…
      [95000, 95500, 93000, 94000], // …and "TP 94000" (below entry) prints here
    ]), 95000, 95500, [94000, 0, 0], true);
    expect(scan.planInvalid).toBe(true);
    expect(scan.entryTriggered).toBe(false);
    expect(scan.tpHits).toHaveLength(0);
    const resolution = resolveOutcomeFromScan(scan);
    expect(resolution.outcome).toBe('INVALID');
    expect(resolution.hitTarget).toBe('NONE');
    expect(resolution.invalidReason).toMatch(/wrong side of the 95000 entry/i);
  });

  it('gives an inverted Short no instant WIN either', () => {
    // Short with stop BELOW entry and target ABOVE it: every candle's high
    // ≥ tp would have banked a phantom win under abs-masked scanning.
    const scan = scanTradeOutcome(candles(T, [
      [94800, 95100, 94700, 95000],
    ]), 95000, 94500, [96000, 0, 0], false);
    expect(scan.planInvalid).toBe(true);
    const resolution = resolveOutcomeFromScan(scan);
    expect(resolution.outcome).toBe('INVALID');
    expect(resolution.outcome).not.toBe('WIN');
    expect(resolution.outcome).not.toBe('LOSS');
  });

  it('tolerates partially-missing plans (no stop → no inversion to refuse)', () => {
    // Callers legitimately pass 0/absent legs; only PRESENT levels are checked.
    const scan = scanTradeOutcome(candles(T, [
      [95200, 95300, 94900, 95100],
      [95100, 96100, 95050, 95900],
    ]), 95000, 0, [96000, 0, 0], true);
    expect(scan.planInvalid).toBeUndefined();
    expect(resolveOutcomeFromScan(scan).outcome).toBe('WIN');
  });

  it('does not flag clean plans (normal behavior unchanged)', () => {
    const scan = scanTradeOutcome(candles(T, [
      [95200, 95300, 94900, 95100], // entry
      [95100, 96100, 95050, 95900], // clean TP1
    ]), LONG.entry, LONG.sl, LONG.tps, LONG.isLong);
    expect(scan.planInvalid).toBeUndefined();
    expect(scan.planInvalidReason).toBeUndefined();
    expect(resolveOutcomeFromScan(scan)).toMatchObject({ outcome: 'WIN', hitTarget: 'TP1' });
  });

  it('refuses even with startIndex (a pre-filled inverted plan still gets no credit)', () => {
    const scan = scanTradeOutcome(candles(T, [
      [95200, 95300, 94900, 95100],
      [95000, 95500, 93000, 94000],
    ]), 95000, 95500, [94000, 0, 0], true, { startIndex: 1 });
    expect(scan.planInvalid).toBe(true);
    expect(resolveOutcomeFromScan(scan).outcome).toBe('INVALID');
  });

  it('refuses a zero-distance plan (Long tp1 === entry) — INVALID, never a same-candle WIN', () => {
    // `tp >= entry` used to treat a target printed ON the entry as valid, and
    // the scan's `high >= tp1` then banked an instant WIN at zero profit on
    // the fill candle itself. The gate is strict now (tp > entry), so the
    // engine's re-check must refuse to score it.
    const scan = scanTradeOutcome(candles(T, [
      [94900, 96500, 94850, 95200], // opens executable; high blows through "TP1" 95000
      [95200, 96100, 95100, 96000], // and every later candle too
    ]), 95000, 94000, [95000, 0, 0], true);
    expect(scan.planInvalid).toBe(true);
    expect(scan.entryTriggered).toBe(false);
    expect(scan.tpHits).toHaveLength(0);
    const resolution = resolveOutcomeFromScan(scan);
    expect(resolution.outcome).toBe('INVALID');
    expect(resolution.invalidReason).toMatch(/zero reward distance/i);
  });

  it('refuses a zero-distance Short plan (tp1 === entry) mirrored', () => {
    const scan = scanTradeOutcome(candles(T, [
      [95100, 95200, 93900, 94800], // low prints below "TP1" 95000 instantly
    ]), 95000, 96000, [95000, 0, 0], false);
    expect(scan.planInvalid).toBe(true);
    expect(resolveOutcomeFromScan(scan).outcome).toBe('INVALID');
    expect(resolveOutcomeFromScan(scan).outcome).not.toBe('WIN');
  });
});

describe('formatDurationMs', () => {
  it('formats hours and minutes', () => {
    expect(formatDurationMs(0)).toBe('0m');
    expect(formatDurationMs(30 * 60_000)).toBe('30m');
    expect(formatDurationMs(2 * 3_600_000 + 15 * 60_000)).toBe('2h 15m');
  });
});
