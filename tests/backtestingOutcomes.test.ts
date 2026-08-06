import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Kline } from '../services/analysis/MarketDataService';
import type { TradeAnalysis } from '../types';

// Mock the kline transport so both simulations run against scripted candles
// with NO network calls. simulateTradeSignal uses fetchOHLCV (single tier);
// simulateFromAnalysisTime uses fetchOHLCVFromTime (4 tiers — only the 1m
// tier is scripted, the rest return nothing).
const { fetchOHLCVMock, fetchOHLCVFromTimeMock } = vi.hoisted(() => ({
  fetchOHLCVMock: vi.fn(),
  fetchOHLCVFromTimeMock: vi.fn(),
}));

vi.mock('../services/analysis/MarketDataService', () => ({
  fetchOHLCV: fetchOHLCVMock,
  fetchOHLCVFromTime: fetchOHLCVFromTimeMock,
}));

import {
  simulateTradeSignal,
  simulateFromAnalysisTime,
} from '../services/backtesting/BacktestingService';

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
  fetchOHLCVMock.mockReset();
  fetchOHLCVFromTimeMock.mockReset();
  scripted1m = [];
  // simulateTradeSignal path
  fetchOHLCVMock.mockImplementation(async () => candles(BASE_TIME, scripted1m));
  // simulateFromAnalysisTime path — 1m tier only
  fetchOHLCVFromTimeMock.mockImplementation(
    async (_symbol: string, interval: string, startTime: number) =>
      interval === '1m' ? candles(startTime, scripted1m) : []
  );
});

// Long setup used by most tests: entry 95000, SL 94000 (extended zone 93500),
// TP1 96000, TP2 97000. Neutral fillers never touch any level.
const filler: [number, number, number, number] = [94500, 95800, 94400, 95500];

// =============================================================================
// simulateTradeSignal — entry-candle semantics + NaN guards
// =============================================================================

describe('simulateTradeSignal (lookback walk)', () => {
  it('catches a same-candle entry + SL touch (the entry candle is scanned)', async () => {
    // Candle 0 both fills the entry (low 93900 <= 95000, high 95200 >= 95000)
    // AND breaks the stop (low 93900 <= 94000). The old `continue` skipped
    // this candle's SL check entirely → NOT_TRIGGERED.
    scripted1m = [
      [95200, 95200, 93900, 94100],
      ...Array.from({ length: 12 }, () => filler),
    ];

    const result = await simulateTradeSignal(makeAnalysis(), 'BTCUSDT');
    expect(result.wouldHaveTriggered).toBe(true);
    expect(result.outcome).toBe('LOSS');
    expect(result.hitTarget).toBe('SL');
    expect(result.priceAtExit).toBe(94000);
  });

  it('resolves SL before TP within the same candle (SL-first ordering)', async () => {
    // One candle wicks through both levels — the resting stop fills first.
    scripted1m = [
      [95000, 97000, 93900, 96900],
      ...Array.from({ length: 12 }, () => filler),
    ];

    const result = await simulateTradeSignal(makeAnalysis(), 'BTCUSDT');
    expect(result.outcome).toBe('LOSS');
    expect(result.hitTarget).toBe('SL');
  });

  it('detects a clean TP1 win', async () => {
    scripted1m = [
      [94950, 95100, 94900, 95000], // entry fills
      [95100, 96100, 95050, 96000], // TP1 wicked
      ...Array.from({ length: 12 }, () => filler),
    ];

    const result = await simulateTradeSignal(makeAnalysis(), 'BTCUSDT');
    expect(result.outcome).toBe('WIN');
    expect(result.hitTarget).toBe('TP1');
    expect(result.priceAtExit).toBe(96000);
  });

  it('guards unparsable stop losses (NaN) as invalid', async () => {
    scripted1m = [
      [94950, 95100, 94900, 95000],
      ...Array.from({ length: 12 }, () => filler),
    ];

    const result = await simulateTradeSignal(makeAnalysis({ stopLoss: 'market' }), 'BTCUSDT');
    expect(result.wouldHaveTriggered).toBe(false);
    expect(result.outcome).toBe('NOT_TRIGGERED');
    expect(result.simulationDetails).toContain('Invalid entry or stop loss');
  });

  it('reports NOT_TRIGGERED when the entry is never reached', async () => {
    scripted1m = Array.from({ length: 15 }, () => [96000, 97000, 95500, 96500] as [number, number, number, number]);

    const result = await simulateTradeSignal(makeAnalysis(), 'BTCUSDT');
    expect(result.wouldHaveTriggered).toBe(false);
    expect(result.outcome).toBe('NOT_TRIGGERED');
  });
});

// =============================================================================
// simulateFromAnalysisTime — SL-first ordering, same-candle rule, 150% zone
// =============================================================================

describe('simulateFromAnalysisTime (hybrid 4-tier walk)', () => {
  const sim = (analysis: TradeAnalysis) =>
    simulateFromAnalysisTime(analysis, 'BTCUSDT', analysis.createdAt!, '1m', 100);

  it('classifies a same-candle SL+TP as LOSS at the stop level', async () => {
    // Entry candle wicks through SL (low 93900) and TP1 (high 96100).
    scripted1m = [
      [95000, 96100, 93900, 95500],
      ...Array.from({ length: 12 }, () => filler),
    ];

    const result = await sim(makeAnalysis());
    expect(result.wouldHaveTriggered).toBe(true);
    expect(result.outcome).toBe('LOSS');
    expect(result.hitTarget).toBe('SL');
    expect(result.priceAtExit).toBe(94000);
  });

  it('keeps the recovery WIN when the SL touch and the TP are on different candles', async () => {
    scripted1m = [
      [94950, 95100, 94900, 95000], // entry fills
      [94500, 95000, 93900, 94400], // SL wicked
      [94500, 96100, 94400, 96000], // TP1 hit later — documented recovery
      ...Array.from({ length: 12 }, () => filler),
    ];

    const result = await sim(makeAnalysis());
    expect(result.outcome).toBe('WIN');
    expect(result.hitTarget).toBe('TP1');
    expect(result.priceAtExit).toBe(96000);
  });

  it('reports a plain SL touch with no TP as LOSS (was NOT_TRIGGERED)', async () => {
    scripted1m = [
      [94950, 95100, 94900, 95000], // entry fills
      [94500, 95000, 93900, 94400], // SL wicked, no recovery
      ...Array.from({ length: 12 }, () => filler),
    ];

    const result = await sim(makeAnalysis());
    expect(result.outcome).toBe('LOSS');
    expect(result.hitTarget).toBe('SL');
    expect(result.priceAtExit).toBe(94000);
  });

  it('reports the 150% extended-zone breach at the extended stop price', async () => {
    // Extended zone for this setup: 94000 - (1000 * 0.5) = 93500.
    scripted1m = [
      [94950, 95100, 94900, 95000], // entry fills
      [94500, 95000, 93400, 94000], // hard stop breached at 93500
      ...Array.from({ length: 12 }, () => filler),
    ];

    const result = await sim(makeAnalysis());
    expect(result.outcome).toBe('LOSS');
    expect(result.hitTarget).toBe('SL');
    expect(result.priceAtExit).toBe(93500);
  });

  it('stays NOT_TRIGGERED when the entry never fills', async () => {
    scripted1m = Array.from({ length: 15 }, () => [96000, 97000, 95500, 96500] as [number, number, number, number]);

    const result = await sim(makeAnalysis());
    expect(result.wouldHaveTriggered).toBe(false);
    expect(result.outcome).toBe('NOT_TRIGGERED');
  });
});
