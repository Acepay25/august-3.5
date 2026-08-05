import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Kline } from '../services/analysis/MarketDataService';
import type { TradeAnalysis } from '../types';

// Mock the kline transport so verifyHistoricalOutcome runs against scripted
// candles and NO network calls. Only the 1m tier is scripted; the 15m/1h
// tiers return nothing (the merged array still clears the 10-candle floor).
const { fetchMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
}));

vi.mock('../services/analysis/MarketDataService', () => ({
  fetchFuturesOHLCVFromTime: fetchMock,
}));

import { verifyHistoricalOutcome } from '../services/ui/AutoCaptureService';

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

/** [open, high, low, close] per 1-minute candle, starting at the fetch start. */
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
  fetchMock.mockReset();
  scripted1m = [];
  fetchMock.mockImplementation(async (_symbol: string, interval: string, startTime: number) =>
    interval === '1m' ? candles(startTime, scripted1m) : [],
  );
});

const verify = (analysis: TradeAnalysis) => verifyHistoricalOutcome(analysis, 'BTCUSDT', analysis.createdAt!);

// Long setup used by most tests: entry 95000, SL 94000 (extended zone 93500),
// TP1 96000, TP2 97000. The verifier requires >= 10 candles, so every script
// pads with neutral fillers AFTER the outcome-relevant candles (they never
// touch SL/TP and cannot change the result).

const longFiller: [number, number, number, number] = [94500, 95800, 94400, 95500];
const shortFiller: [number, number, number, number] = [94500, 95500, 94400, 95400];

describe('verifyHistoricalOutcome — win/loss detection (Long)', () => {
  it('detects a clean TP1 hit as TP_HIT', async () => {
    scripted1m = [
      [94950, 95100, 94900, 95000], // entry fills (low 94900 <= 95000)
      [95100, 96100, 95050, 96000], // TP1 wicked (high 96100 >= 96000)
      ...Array.from({ length: 10 }, () => longFiller),
    ];

    const result = await verify(makeAnalysis());
    expect(result.verified).toBe(true);
    expect(result.outcome).toBe('TP_HIT');
    expect(result.hitTarget).toBe('TP1');
    expect(result.priceAtHit).toBe(96000);
    expect(result.tpHits).toHaveLength(1);
    expect(result.slHit).toBeUndefined();
  });

  it('records the highest TP hit when multiple TPs are reached', async () => {
    scripted1m = [
      [94950, 95100, 94900, 95000], // entry fills
      [95100, 96100, 95050, 96000], // TP1
      [96050, 97100, 96000, 97000], // TP2
      ...Array.from({ length: 10 }, () => longFiller),
    ];

    const result = await verify(makeAnalysis());
    expect(result.outcome).toBe('TP_HIT');
    expect(result.hitTarget).toBe('TP2');
    expect(result.tpHits?.map(t => t.level)).toEqual(['TP1', 'TP2']);
  });

  it('resolves as a WIN when the SL is touched but a TP is hit later (TP priority)', async () => {
    scripted1m = [
      [94950, 95100, 94900, 95000], // entry fills
      [94100, 95000, 93900, 94500], // SL touched (low 93900 <= 94000), inside 150% zone
      [94500, 96100, 94400, 96000], // TP1 wicked after the SL touch
      ...Array.from({ length: 10 }, () => longFiller),
    ];

    const result = await verify(makeAnalysis());
    expect(result.outcome).toBe('TP_HIT');
    // SL touch is kept for reference, but the outcome is a win.
    expect(result.slHit?.price).toBe(94000);
    expect(result.verificationDetails).toContain('SL likely too tight');
  });

  it('hard-stops as SL_HIT when the 150% extended zone is breached — even if TP comes later', async () => {
    scripted1m = [
      [94950, 95100, 94900, 95000], // entry fills
      [94100, 95000, 93400, 93800], // extended zone breached (low 93400 <= 93500) → scan ends
      [93800, 97000, 93700, 96900], // would have hit TP2 — never scanned
      ...Array.from({ length: 10 }, () => longFiller),
    ];

    const result = await verify(makeAnalysis());
    expect(result.outcome).toBe('SL_HIT');
    expect(result.hitTarget).toBe('SL');
    // The hard-stop level (extended zone), not the original SL, decided it.
    expect(result.priceAtHit).toBe(93500);
    expect(result.verificationDetails).toContain('STOP LOSS HARD FAIL');
  });

  it('resolves a plain SL touch with no TP as SL_HIT', async () => {
    scripted1m = [
      [94950, 95100, 94900, 95000], // entry fills
      [94100, 95000, 93900, 94500], // SL touched (low 93900 <= 94000)
      ...Array.from({ length: 10 }, () => [94500, 95800, 94400, 95500] as [number, number, number, number]), // floats, never hits TP
    ];

    const result = await verify(makeAnalysis());
    expect(result.outcome).toBe('SL_HIT');
    expect(result.hitTarget).toBe('SL');
    expect(result.priceAtHit).toBe(94000);
  });

  it('returns STILL_OPEN when price stays between entry and TP without touching SL', async () => {
    scripted1m = [
      [94950, 95100, 94900, 95000], // entry fills
      ...Array.from({ length: 12 }, () => [95100, 95800, 95000, 95500] as [number, number, number, number]),
    ];

    const result = await verify(makeAnalysis());
    expect(result.verified).toBe(true);
    expect(result.outcome).toBe('STILL_OPEN');
  });

  it('returns ENTRY_NOT_TRIGGERED when price never reaches the entry', async () => {
    scripted1m = Array.from({ length: 12 }, () => [95100, 95900, 95050, 95500] as [number, number, number, number]);

    const result = await verify(makeAnalysis());
    expect(result.verified).toBe(true);
    expect(result.outcome).toBe('ENTRY_NOT_TRIGGERED');
  });
});

describe('verifyHistoricalOutcome — win/loss detection (Short)', () => {
  // Short setup: entry 95000, SL 96000 (extended zone 96500), TP1 94000.
  const shortAnalysis = makeAnalysis({
    direction: 'Short',
    stopLoss: '96000',
    takeProfit: [{ price: '94000', percentage: '100%' }],
  });

  it('detects a clean TP hit as TP_HIT', async () => {
    scripted1m = [
      [94900, 95100, 94800, 95000], // entry fills (high 95100 >= 95000)
      [94000, 95000, 93900, 94100], // TP1 wicked (low 93900 <= 94000)
      ...Array.from({ length: 10 }, () => shortFiller),
    ];

    const result = await verify(shortAnalysis);
    expect(result.outcome).toBe('TP_HIT');
    expect(result.priceAtHit).toBe(94000);
  });

  it('hard-stops as SL_HIT when the extended zone is breached', async () => {
    scripted1m = [
      [94900, 95100, 94800, 95000], // entry fills
      [95000, 96600, 94900, 96500], // extended zone breached (high 96600 >= 96500)
      ...Array.from({ length: 10 }, () => shortFiller),
    ];

    const result = await verify(shortAnalysis);
    expect(result.outcome).toBe('SL_HIT');
    expect(result.priceAtHit).toBe(96500);
  });

  it('resolves as a WIN when the SL is touched but a TP is hit later', async () => {
    scripted1m = [
      [94900, 95100, 94800, 95000], // entry fills
      [95000, 96100, 94900, 96000], // SL touched (high 96100 >= 96000)
      [94000, 95000, 93900, 94100], // TP1 wicked after the SL touch
      ...Array.from({ length: 10 }, () => shortFiller),
    ];

    const result = await verify(shortAnalysis);
    expect(result.outcome).toBe('TP_HIT');
    expect(result.slHit?.price).toBe(96000);
  });
});

describe('verifyHistoricalOutcome — insufficient data and guards', () => {
  it('returns INSUFFICIENT_DATA when fewer than 10 candles exist', async () => {
    scripted1m = Array.from({ length: 9 }, () => [94950, 95100, 94900, 95000] as [number, number, number, number]);

    const result = await verify(makeAnalysis());
    expect(result.verified).toBe(false);
    expect(result.outcome).toBe('INSUFFICIENT_DATA');
  });

  it('returns INSUFFICIENT_DATA when the analysis has no stop loss', async () => {
    scripted1m = [
      [94950, 95100, 94900, 95000],
      [95100, 96100, 95050, 96000],
      ...Array.from({ length: 10 }, () => [95000, 95800, 94900, 95500] as [number, number, number, number]),
    ];

    const result = await verify(makeAnalysis({ stopLoss: '' }));
    expect(result.verified).toBe(false);
    expect(result.outcome).toBe('INSUFFICIENT_DATA');
  });

  it('returns INSUFFICIENT_DATA when the analysis has no entry points', async () => {
    scripted1m = [
      [94950, 95100, 94900, 95000],
      ...Array.from({ length: 10 }, () => [95000, 95800, 94900, 95500] as [number, number, number, number]),
    ];

    const result = await verify(makeAnalysis({ entryPoints: [] }));
    expect(result.verified).toBe(false);
    expect(result.outcome).toBe('INSUFFICIENT_DATA');
  });
});
