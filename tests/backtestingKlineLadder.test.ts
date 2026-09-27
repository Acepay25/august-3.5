/**
 * The hybrid candle ladder is ONE implementation, used by two callers.
 *
 * `simulateFromAnalysisTime` and `validateTradeOutcome` each used to
 * hand-roll the same tier-walking loop (fetch tier → cap it at its limit →
 * start the next tier after the last candle returned → concatenate). A fix to
 * that arithmetic reached only one of the two verdicts, so the simulation and
 * the post-mortem validation of the SAME trade could be computed over
 * different windows.
 *
 * The two ladders are intentionally DIFFERENT — the simulation adds a 5m
 * bridge tier, validation does not — so this pins each sequence exactly
 * rather than asserting they match.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TradeAnalysis } from '../types';

const { fetchOHLCVMock, fetchOHLCVFromTimeMock } = vi.hoisted(() => ({
    fetchOHLCVMock: vi.fn(),
    fetchOHLCVFromTimeMock: vi.fn(),
}));

vi.mock('../services/analysis/MarketDataService', () => ({
    fetchOHLCV: fetchOHLCVMock,
    fetchOHLCVFromTime: fetchOHLCVFromTimeMock,
    // Re-exported as a type by BacktestingService's import list; the mock is
    // runtime-only, so a stub value keeps the module shape valid.
    Kline: class {},
}));

import {
    simulateFromAnalysisTime,
    validateTradeOutcome,
} from '../services/backtesting/BacktestingService';

const BASE_TIME = Date.UTC(2026, 0, 1, 0, 0, 0);

const analysis: TradeAnalysis = {
    coinName: 'BTCUSDT',
    direction: 'Long',
    tradeType: 'swing',
    confidence: 'Medium',
    probability: 60,
    grade: 'C',
    strategy: 'Trend continuation',
    activeStrategies: [],
    entryPoints: [{ description: 'support', price: '95000' }],
    stopLoss: '94000',
    takeProfit: [{ price: '96000', percentage: '100%' }],
    marketConditions: { pattern: '', candleBehavior: '', timeframeAlignment: '', rsi: '', macd: '', sentiment: '' },
    historicalCorrelation: '',
    validityDurationMinutes: 330,
    createdAt: new Date(BASE_TIME).toISOString(),
};

/** One candle `minutes` after BASE_TIME. */
const candle = (minutes: number, close = 95000) => ({
    time: BASE_TIME + minutes * 60_000,
    open: close, high: close, low: close, close, volume: 1,
});

/** The (timeframe, startMs) of each fetch the ladder issued. */
const ladderCalls = (): Array<[string, number]> =>
    fetchOHLCVFromTimeMock.mock.calls.map(c => [c[1], c[2]] as [string, number]);

beforeEach(() => {
    fetchOHLCVFromTimeMock.mockReset();
    fetchOHLCVMock.mockReset();
    // 1m tier scripted, coarser tiers empty (each returns just one candle so
    // the ladder's start-time arithmetic is observable).
    fetchOHLCVFromTimeMock.mockImplementation(async (_s: string, tf: string) => {
        if (tf === '1m') return [candle(1), candle(2)];
        if (tf === '5m') return [candle(60)];
        if (tf === '15m') return [candle(240)];
        if (tf === '1h') return [candle(600)];
        return [];
    });
});

describe('the shared hybrid candle ladder', () => {
    it('simulation walks 1m → 5m → 15m → 1h, each tier starting after the last', async () => {
        await simulateFromAnalysisTime(analysis, 'BTCUSDT', analysis.createdAt!, '1m', 1);

        expect(ladderCalls()).toEqual([
            // BASE_TIME is already on a 1m boundary, so the aligned start is
            // the analysis moment itself.
            ['1m', BASE_TIME],
            // after the last 1m candle (BASE_TIME + 2m) + 1m
            ['5m', BASE_TIME + 3 * 60_000],
            // after the last 5m candle (BASE_TIME + 60m) + 5m
            ['15m', BASE_TIME + 65 * 60_000],
            // after the last 15m candle (BASE_TIME + 240m) + 15m
            ['1h', BASE_TIME + 255 * 60_000],
        ]);
    });

    it('validation walks 1m → 15m → 1h (no 5m bridge) from the same start', async () => {
        await validateTradeOutcome(analysis, 'BTCUSDT', analysis.createdAt!);

        expect(ladderCalls()).toEqual([
            ['1m', BASE_TIME],
            ['15m', BASE_TIME + 3 * 60_000],
            ['1h', BASE_TIME + 255 * 60_000],
        ]);
    });

    it('an EMPTY tier advances the window by its own nominal span, not by re-requesting', async () => {
        // A tier that returns nothing used to be able to stall the ladder (or,
        // in the hand-rolled copies, to re-request the same range), which left
        // the coarser tiers covering a window the 1m data already covered.
        fetchOHLCVFromTimeMock.mockImplementation(async () => []);
        await simulateFromAnalysisTime(analysis, 'BTCUSDT', analysis.createdAt!, '1m', 1);

        expect(ladderCalls()).toEqual([
            ['1m', BASE_TIME],
            ['5m', BASE_TIME + 500 * 60_000],   // 500 × 1m
            ['15m', BASE_TIME + 500 * 60_000 + 250 * 5 * 60_000], // + 250 × 5m
            ['1h', BASE_TIME + 500 * 60_000 + 250 * 5 * 60_000 + 250 * 15 * 60_000],
        ]);
    });
});
