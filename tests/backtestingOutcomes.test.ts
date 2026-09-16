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
  batchBacktest,
  validateWithBacktest,
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

  it('reports ENTERED_OPEN when the entry fills but neither level is reached', async () => {
    // Entry fills on candle 0; every later candle is a neutral filler that
    // touches neither the 94000 stop nor the 96000 target. That is an OPEN
    // position, not a missed entry — the two used to share NOT_TRIGGERED.
    scripted1m = [
      [94950, 95100, 94900, 95000],
      ...Array.from({ length: 12 }, () => filler),
    ];

    const result = await simulateTradeSignal(makeAnalysis(), 'BTCUSDT');
    expect(result.wouldHaveTriggered).toBe(true);
    expect(result.outcome).toBe('ENTERED_OPEN');
    expect(result.hitTarget).toBe('NONE');
    expect(result.simulationDetails).toMatch(/neither SL nor TP/);
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

  it('buckets a REFUSED plan as NOT_TRIGGERED + rejection detail (was ENTERED_OPEN)', async () => {
    // Long with the stop ABOVE entry and the target below it: the shared
    // engine refuses to score it. simulateTradeSignal already mapped that to
    // NOT_TRIGGERED + the reason; this path used to fall through to the OPEN
    // branch and present the phantom plan as a live "ENTERED_OPEN" position.
    scripted1m = [
      [95200, 95300, 94900, 95100], // entry would "fill" here
      [95000, 95500, 93000, 94000], // …and the below-entry "TP" prints here
      ...Array.from({ length: 12 }, () => filler),
    ];
    const inverted = makeAnalysis({
      stopLoss: '95500',
      takeProfit: [{ price: '94000', percentage: '100%' }],
    });
    const result = await sim(inverted);
    expect(result.outcome).toBe('NOT_TRIGGERED');
    expect(result.outcome).not.toBe('ENTERED_OPEN');
    expect(result.hitTarget).toBe('NONE');
    expect(result.simulationDetails).toMatch(/Plan rejected by the outcome engine/i);
    expect(result.simulationDetails).toMatch(/wrong side of the 95000 entry/i);
  });

  it('refuses a zero-distance (tp1 === entry) plan instead of banking a WIN', async () => {
    scripted1m = [
      [94900, 96500, 94850, 95200], // opens executable; prints over "TP1" 95000
      ...Array.from({ length: 12 }, () => filler),
    ];
    const zeroTp = makeAnalysis({ takeProfit: [{ price: '95000', percentage: '0%' }] });
    const result = await sim(zeroTp);
    expect(result.outcome).toBe('NOT_TRIGGERED');
    expect(result.simulationDetails).toMatch(/Plan rejected by the outcome engine/i);
    expect(result.simulationDetails).toMatch(/zero reward distance/i);
  });

  it('starts the fetch at/after the analysis moment — no pre-analysis candles (align look-ahead fix)', async () => {
    // BASE_TIME + 30s sits MID-candle. The old floor aligned the 1m fetch
    // START to BASE_TIME, pulling in a candle that was still FORMING when
    // the analysis was made (up to a minute of look-ahead). Alignment must
    // now CEIL: the first fetched candle opens at BASE_TIME + 60_000.
    const analysis = makeAnalysis({
      createdAt: new Date(BASE_TIME + 30_000).toISOString(),
    });
    scripted1m = [
      [94950, 95100, 94900, 95000],
      ...Array.from({ length: 12 }, () => filler),
    ];
    await simulateFromAnalysisTime(analysis, 'BTCUSDT', analysis.createdAt!, '1m', 1);
    const firstCall = fetchOHLCVFromTimeMock.mock.calls.find(c => c[1] === '1m');
    expect(firstCall).toBeTruthy();
    expect(firstCall![2]).toBe(BASE_TIME + 60_000);
  });
});

// =============================================================================
// simulateTradeSignal — routed through the SHARED outcome engine (item 8)
// =============================================================================

describe('simulateTradeSignal via scanTradeOutcome', () => {
  it('does NOT credit a TP that printed on the ambiguous entry candle', async () => {
    // Long, entry 95000, TP1 96000. Candle 0 OPENS at 95500 (above the
    // entry), wicks UP through 96000 then DROPS to 94800 filling the limit.
    // The fill happened AFTER the TP touch inside that bar — the old local
    // walk banked this as a same-candle WIN (look-ahead). The shared engine
    // gates same-candle TP credit unless the candle opened already
    // executable (open ≤ entry).
    scripted1m = [
      [95500, 96100, 94800, 94900],
      ...Array.from({ length: 12 }, () => filler),
    ];
    const result = await simulateTradeSignal(makeAnalysis(), 'BTCUSDT');
    expect(result.wouldHaveTriggered).toBe(true);
    expect(result.outcome).toBe('ENTERED_OPEN');
    expect(result.hitTarget).toBe('NONE');
  });

  it('fills on a gap THROUGH the entry (old [low,high] overlap missed it)', async () => {
    // Price gaps DOWN below the 95000 entry: the bar trades entirely under
    // it (high 93500 < entry). The old overlap check required
    // high >= entryPrice → never triggered, though a resting buy limit
    // fills at (better than) the level. The canonical engine fills.
    scripted1m = [
      [93000, 93500, 92000, 92800],
      ...Array.from({ length: 12 }, () => filler),
    ];
    const result = await simulateTradeSignal(makeAnalysis(), 'BTCUSDT');
    expect(result.wouldHaveTriggered).toBe(true);
    // Candle opened (93000) already below entry → whole bar post-fill, but
    // the neutral fillers touch neither the 94000 stop nor 96000 target…
    // the stop is ABOVE the fill region → long SL 94000 > current prices →
    // the shared engine refuses this inverted geometry rather than banking
    // phantom outcomes. Either way it must NOT be a WIN.
    expect(result.outcome).not.toBe('WIN');
  });

  it('batchBacktest does not score unresolved ENTERED_OPEN trades as losses', async () => {
    scripted1m = [
      [94950, 95100, 94900, 95000], // entry fills
      [95100, 96100, 95050, 96000], // TP1 hit → analysis A resolves WIN
      ...Array.from({ length: 12 }, () => filler),
    ];
    const winAnalysis = makeAnalysis();
    const openAnalysis = makeAnalysis({
      takeProfit: [{ price: '150000', percentage: '100%' }], // never reached
    });
    const batch = await batchBacktest([winAnalysis, openAnalysis], 'BTCUSDT', '1h');
    expect(batch.results[0].outcome).toBe('WIN');
    expect(batch.results[1].outcome).toBe('ENTERED_OPEN');
    // OLD: winRate = wins / triggered = 1/2 = 50 (the open trade counted as
    // a loss). NEW: only SETTLED trades move the rate → 1/1 = 100, and the
    // open one is reported separately.
    expect(batch.winRate).toBe(100);
    expect(batch.openTrades).toBe(1);
  });

  it('validateWithBacktest reports no-evidence as shouldTake:false + noData:true', async () => {
    // Entry never prints → zero backtest evidence. The old code returned
    // shouldTake:true ("no historical data to invalidate") — absence of
    // disproof as confirmation.
    scripted1m = Array.from({ length: 15 }, () => [96000, 97000, 95500, 96500] as [number, number, number, number]);
    const verdict = await validateWithBacktest(makeAnalysis(), 'BTCUSDT');
    expect(verdict.noData).toBe(true);
    expect(verdict.shouldTake).toBe(false);
  });

  it('validateWithBacktest supports a proven WIN and marks evidence real', async () => {
    scripted1m = [
      [94950, 95100, 94900, 95000],
      [95100, 96100, 95050, 96000],
      ...Array.from({ length: 12 }, () => filler),
    ];
    const verdict = await validateWithBacktest(makeAnalysis(), 'BTCUSDT');
    expect(verdict.shouldTake).toBe(true);
    expect(verdict.noData).toBe(false);
  });
});
