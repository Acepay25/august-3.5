import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Kline } from '../services/analysis/MarketDataService';
import type { TradeAnalysis } from '../types';

// validateTradeOutcome fetches 4 kline tiers via fetchOHLCVFromTime; only the
// 1m tier is scripted, the rest return nothing.
const { fetchOHLCVFromTimeMock } = vi.hoisted(() => ({
  fetchOHLCVFromTimeMock: vi.fn(),
}));

vi.mock('../services/analysis/MarketDataService', () => ({
  fetchOHLCVFromTime: fetchOHLCVFromTimeMock,
}));

import { validateTradeOutcome } from '../services/backtesting/BacktestingService';

// --- Fixtures ---------------------------------------------------------------

const BASE_TIME = Date.UTC(2026, 0, 1, 0, 0, 0);

const makeAnalysis = (overrides: Partial<TradeAnalysis> = {}): TradeAnalysis => ({
  coinName: 'BTCUSDT',
  direction: 'Long',
  tradeType: 'swing',
  confidence: 'Medium',
  probability: 60,
  grade: 'C',
  strategy: 'Trend continuation',
  activeStrategies: [],
  entryPoints: [{ description: 'Key support retest', price: '95000' }],
  stopLoss: '94000',
  takeProfit: [
    { price: '96000', percentage: '100%' },
    { price: '97000', percentage: '200%' },
  ],
  marketConditions: { pattern: '', candleBehavior: '', timeframeAlignment: '', rsi: '', macd: '', sentiment: '' },
  historicalCorrelation: '',
  validityDurationMinutes: 330,
  createdAt: new Date(BASE_TIME).toISOString(),
  ...overrides,
});

/** [open, high, low, close] per candle, starting at `start`. */
const candles = (start: number, ohlc: Array<[number, number, number, number]>): Kline[] =>
  ohlc.map(([open, high, low, close], i) => ({
    time: start + i * 60_000,
    open,
    high,
    low,
    close,
    volume: 100,
  }));

let scripted1m: Array<[number, number, number, number]> = [];

beforeEach(() => {
  fetchOHLCVFromTimeMock.mockReset();
  scripted1m = [];
  fetchOHLCVFromTimeMock.mockImplementation(
    async (_symbol: string, interval: string, startTime: number) =>
      interval === '1m' ? candles(startTime, scripted1m) : []
  );
});

// Long fixture: entry 95000, SL 94000 (extended zone 93500), TP1 96000, TP2 97000.
// Candles are scripted as raw OHLC arrays.

describe('validateTradeOutcome — engine parity with simulateFromAnalysisTime/AutoCaptureService', () => {
  it('resolves same-candle SL+TP as LOSS (stop filled before TP)', async () => {
    // Candle 0 dips through entry (95000); candle 1 touches BOTH SL (94000)
    // and TP1 (96000) — the resting stop fills first.
    scripted1m = [
      [95200, 95300, 94900, 95100], // entry triggered
      [95500, 96200, 93900, 95600], // SL + TP1 same candle
      [95600, 95800, 95000, 95400], // later filler
    ];
    const result = await validateTradeOutcome(makeAnalysis(), 'BTCUSDT', new Date(BASE_TIME).toISOString());
    expect(result.outcome).toBe('LOSS');
    expect(result.hitTarget).toBe('SL');
    expect(result.slTouched).toBe(true);
    // The TP was touched by the same candle (recorded for the transcript) but
    // never realized — the stop filled first.
    expect(result.tpHits).toHaveLength(1);
    expect(result.tpHits[0].level).toBe('TP1');
  });

  it('resolves an SL wick followed by a LATER TP as WIN (recovery)', async () => {
    scripted1m = [
      [95200, 95300, 94900, 95100], // entry triggered
      [95000, 95100, 93950, 94500], // SL wick (touches 94000, holds 150% zone)
      [94500, 96200, 94300, 96000], // TP1 on a later candle
      [96000, 96100, 95500, 95800], // trailing completed candle
    ];
    const result = await validateTradeOutcome(makeAnalysis(), 'BTCUSDT', new Date(BASE_TIME).toISOString());
    expect(result.outcome).toBe('WIN');
    expect(result.hitTarget).toBe('TP1');
    expect(result.slTouched).toBe(true); // recovery case recorded
  });

  it('resolves a 150% extended-SL breach as LOSS even when a TP is touched', async () => {
    scripted1m = [
      [95200, 95300, 94900, 95100], // entry triggered
      [95500, 96200, 93400, 94000], // TP1 AND extended SL (93500) — hard stop wins
      [94000, 94200, 93600, 93800], // trailing completed candle
    ];
    const result = await validateTradeOutcome(makeAnalysis(), 'BTCUSDT', new Date(BASE_TIME).toISOString());
    expect(result.outcome).toBe('LOSS');
    expect(result.hitTarget).toBe('SL');
    expect(result.tpHits).toHaveLength(0);
  });

  it('resolves a plain SL touch with no TP as LOSS', async () => {
    scripted1m = [
      [95200, 95300, 94900, 95100], // entry triggered
      [95100, 95200, 93950, 94500], // SL touched, no TP, stays in 150% zone
      [94500, 94700, 94200, 94300],
    ];
    const result = await validateTradeOutcome(makeAnalysis(), 'BTCUSDT', new Date(BASE_TIME).toISOString());
    expect(result.outcome).toBe('LOSS');
    expect(result.hitTarget).toBe('SL');
  });

  it('resolves a clean TP as WIN with the highest hit level', async () => {
    scripted1m = [
      [95200, 95300, 94900, 95100], // entry triggered
      [95100, 97100, 95000, 96900], // TP1 + TP2
      [96900, 97000, 96500, 96700], // trailing completed candle
    ];
    const result = await validateTradeOutcome(makeAnalysis(), 'BTCUSDT', new Date(BASE_TIME).toISOString());
    expect(result.outcome).toBe('WIN');
    expect(result.hitTarget).toBe('TP2');
    expect(result.tpHits.map(t => t.level)).toEqual(['TP1', 'TP2']);
  });

  it('leaves the trade OPEN when neither SL nor TP is touched', async () => {
    scripted1m = [
      [95200, 95300, 94900, 95100], // entry triggered
      [94500, 95800, 94400, 95500], // within range — no SL/TP
      [94500, 95800, 94400, 95500],
    ];
    const result = await validateTradeOutcome(makeAnalysis(), 'BTCUSDT', new Date(BASE_TIME).toISOString());
    expect(result.outcome).toBe('OPEN');
    expect(result.slTouched).toBe(false);
  });

  it('does not count TP2 after a breakeven exit following TP1', async () => {
    scripted1m = [
      [95200, 95300, 94900, 95100], // entry triggered
      [95100, 96100, 95050, 95900], // TP1 → stop moves to breakeven
      [95900, 96000, 94950, 95200], // breakeven exit (dips to entry)
      [95200, 97200, 95100, 97000], // later TP2 rally — never realized
    ];
    const result = await validateTradeOutcome(makeAnalysis(), 'BTCUSDT', new Date(BASE_TIME).toISOString());
    expect(result.outcome).toBe('WIN');
    expect(result.hitTarget).toBe('TP1'); // TP2 gated by breakeven exit
    expect(result.tpHits).toHaveLength(1);
  });

  it('flags a mismatch when the user reported WIN but price shows LOSS', async () => {
    scripted1m = [
      [95200, 95300, 94900, 95100],
      [95500, 96200, 93900, 95600], // same-candle SL+TP → LOSS
      [95600, 95800, 95000, 95400], // trailing completed candle
    ];
    const result = await validateTradeOutcome(
      makeAnalysis(), 'BTCUSDT', new Date(BASE_TIME).toISOString(), 'WIN'
    );
    expect(result.outcome).toBe('LOSS');
    expect(result.isMismatch).toBe(true);
  });

  it('flags a mismatch when the user reported LOSS but price shows WIN', async () => {
    scripted1m = [
      [95200, 95300, 94900, 95100],
      [95100, 96100, 95000, 95900], // clean TP1
      [95900, 96000, 95500, 95700], // trailing completed candle
    ];
    const result = await validateTradeOutcome(
      makeAnalysis(), 'BTCUSDT', new Date(BASE_TIME).toISOString(), 'LOSS'
    );
    expect(result.outcome).toBe('WIN');
    expect(result.isMismatch).toBe(true);
  });

  it('stays consistent when the user outcome matches the price verdict', async () => {
    scripted1m = [
      [95200, 95300, 94900, 95100],
      [95100, 96100, 95000, 95900], // clean TP1
      [95900, 96000, 95500, 95700], // trailing completed candle
    ];
    const result = await validateTradeOutcome(
      makeAnalysis(), 'BTCUSDT', new Date(BASE_TIME).toISOString(), 'WIN'
    );
    expect(result.outcome).toBe('WIN');
    expect(result.isMismatch).toBe(false);
  });

  it('applies SL-first semantics to short positions', async () => {
    const shortAnalysis = makeAnalysis({
      direction: 'Short',
      entryPoints: [{ description: 'Key resistance', price: '95000' }],
      stopLoss: '96000',
      takeProfit: [{ price: '94000', percentage: '100%' }],
    });
    // Candle 0 high touches entry (95000); candle 1 touches BOTH SL (96000)
    // and TP1 (94000) — stop fills first → LOSS.
    scripted1m = [
      [94800, 95000, 94700, 94900], // entry triggered
      [94900, 96100, 93900, 95000], // SL + TP1 same candle
      [95000, 95200, 94600, 94800], // trailing completed candle
    ];
    const result = await validateTradeOutcome(shortAnalysis, 'BTCUSDT', new Date(BASE_TIME).toISOString());
    expect(result.outcome).toBe('LOSS');
    expect(result.hitTarget).toBe('SL');
    // TP1 was touched by the same candle (recorded) but the stop filled first.
    expect(result.tpHits).toHaveLength(1);
    expect(result.tpHits[0].level).toBe('TP1');
  });
});
