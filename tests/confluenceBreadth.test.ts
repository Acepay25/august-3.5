/**
 * Confluence breadth and price-scale precision.
 *
 * Two defects this pins:
 *
 * 1. `calculateConfluenceScore` scored on AGREEMENT ONLY — `maxPoints` was
 *    computed and never used — so one RSI reading on one timeframe produced
 *    score 100 and the label `strong`. ProbabilityEngineService then turns
 *    score > 80 into a 1.15x probability multiplier that reaches the prompt,
 *    i.e. a single indicator silently boosted the model's stated confidence.
 *
 * 2. `atr` and `currentPrice` were rounded to a fixed 2 decimals. On a sub-$10
 *    perpetual that collapsed 0.012 to 0.01 (~17% error) and propagated into
 *    Monte Carlo sigma, regime sizing and stop suggestions.
 */

import { describe, it, expect } from 'vitest';
import {
    calculateConfluenceScore,
    calculateIndicators,
} from '../services/analysis/TechnicalAnalysisService';
import type { TechnicalIndicators } from '../services/analysis/TechnicalAnalysisService';
import type { Kline } from '../services/analysis/MarketDataService';

/** Every field chosen to contribute NO signal: RSI exactly 50, MACD flat,
 *  price exactly on the EMAs, stochastic uncrossed, %B exactly mid-band. */
const neutral = (over: Partial<TechnicalIndicators> = {}): TechnicalIndicators => ({
    rsi: { rsi6: 50, rsi12: 50, rsi14: 50, rsi24: 50 },
    rsiTrend: 'neutral',
    macd: { dif: 0, dea: 0, histogram: 0, trend: 'neutral' },
    ema: { ema5: 100, ema9: 100, ema13: 100, ema20: 100, ema21: 100, ema50: 100, ema200: 100 },
    sma: { ma5: 100, ma10: 100, ma20: 100, ma30: 100, ma50: 100, ma60: 100, ma200: 100 },
    bollingerBands: { upper: 110, middle: 100, lower: 90, bandwidth: 20, percentB: 50 },
    stochastic: { k: 50, d: 50, j: 50 },
    volume: { current: 100, average: 100, trend: 'normal' },
    atr: 1,
    atrPercent: 1,
    currentPrice: 100,
    pricePosition: 'middle',
    trendStrength: 'neutral',
    ...over,
});

/** One genuinely bullish timeframe: RSI in the bullish band, MACD positive,
 *  price above the EMAs, stochastic crossed up, %B in the upper half. */
const bullishTf = (): TechnicalIndicators => neutral({
    rsi: { rsi6: 62, rsi12: 61, rsi14: 60, rsi24: 58 },
    macd: { dif: 1, dea: 0.5, histogram: 0.5, trend: 'bullish' },
    ema: { ema5: 99, ema9: 99, ema13: 99, ema20: 98, ema21: 98, ema50: 95, ema200: 90 },
    bollingerBands: { upper: 110, middle: 100, lower: 90, bandwidth: 20, percentB: 70 },
    stochastic: { k: 65, d: 55, j: 75 },
    currentPrice: 105,
});

const kl = (time: number, open: number, high: number, low: number, close: number, volume: number): Kline =>
    ({ time, open, high, low, close, volume });

describe('calculateConfluenceScore — breadth is required, not just agreement', () => {
    it('a single signal on one timeframe is NOT strong (was: score 100, "strong")', () => {
        const result = calculateConfluenceScore({
            '15m': neutral({ rsi: { rsi6: 50, rsi12: 50, rsi14: 60, rsi24: 50 } }),
            '1h': neutral(),
            '4h': neutral(),
            '1d': neutral(),
        });

        expect(result.direction).toBe('bullish');
        expect(result.score).toBeLessThan(75);
        expect(result.strength).not.toBe('strong');
    });

    it('one bullish timeframe out of four cannot reach the probability multiplier band (>80)', () => {
        // ProbabilityEngineService.ts gates its 1.15x bump at score > 80, so
        // this is the line that decides whether a thin reading inflates the
        // model's stated confidence.
        const result = calculateConfluenceScore({
            '15m': neutral({ rsi: { rsi6: 50, rsi12: 50, rsi14: 60, rsi24: 50 } }),
            '1h': neutral(),
            '4h': neutral(),
            '1d': neutral(),
        });
        expect(result.score).toBeLessThanOrEqual(80);
    });

    it('a lone timeframe is capped at moderate no matter how cleanly it aligns', () => {
        // breadth is trivially 1.0 when only one timeframe is supplied, so the
        // two-timeframe floor on `strong` is what stops this.
        const result = calculateConfluenceScore({ '1h': bullishTf() });
        expect(result.direction).toBe('bullish');
        expect(result.strength).toBe('moderate');
    });

    it('four aligned timeframes earn "strong" and the top of the band', () => {
        const result = calculateConfluenceScore({
            '15m': bullishTf(),
            '1h': bullishTf(),
            '4h': bullishTf(),
            '1d': bullishTf(),
        });
        expect(result.direction).toBe('bullish');
        expect(result.strength).toBe('strong');
        expect(result.score).toBeGreaterThan(85);
    });

    it('is symmetric: a bearish lone timeframe is also not strong', () => {
        const result = calculateConfluenceScore({
            '15m': neutral(),
            '1h': neutral({ rsi: { rsi6: 50, rsi12: 50, rsi14: 40, rsi24: 50 } }),
            '4h': neutral(),
        });
        expect(result.direction).toBe('bearish');
        expect(result.score).toBeGreaterThan(25);
        expect(result.strength).not.toBe('strong');
    });

    it('mixed readings stay near the neutral baseline', () => {
        const bear = neutral({
            rsi: { rsi6: 38, rsi12: 39, rsi14: 40, rsi24: 42 },
            macd: { dif: -1, dea: -0.5, histogram: -0.5, trend: 'bearish' },
            ema: { ema5: 101, ema9: 101, ema13: 101, ema20: 102, ema21: 102, ema50: 105, ema200: 110 },
            bollingerBands: { upper: 110, middle: 100, lower: 90, bandwidth: 20, percentB: 30 },
            stochastic: { k: 35, d: 45, j: 25 },
            currentPrice: 95,
        });
        const result = calculateConfluenceScore({ '15m': bullishTf(), '1h': bear });
        // Two timeframes, one each way: no consensus to report.
        expect(['neutral', 'bullish', 'bearish']).toContain(result.direction);
        expect(result.score).toBeGreaterThan(35);
        expect(result.score).toBeLessThan(65);
    });
});

describe('indicator precision at small price scales', () => {
    const DAY = 86_400_000;

    /** A sub-$10 perpetual with a genuinely small but non-trivial range. */
    const cheapKlines = (): Kline[] => {
        const out: Kline[] = [];
        for (let i = 0; i < 60; i++) {
            // Oscillate around $6.00 with a ~$0.04 true range.
            const mid = 6 + Math.sin(i / 3) * 0.05;
            out.push(kl(
                Date.UTC(2026, 0, 1) + i * DAY,
                mid, mid + 0.02, mid - 0.02, mid + (i % 2 ? 0.01 : -0.01),
                1000 + i,
            ));
        }
        return out;
    };

    it('ATR keeps precision instead of collapsing to a 2-decimal step', () => {
        const ind = calculateIndicators(cheapKlines());
        // A ~$0.04 range must not land on the 0.01 grid: the old round(atr, 2)
        // could only ever report 0.03/0.04/0.05 here.
        expect(ind.atr).toBeGreaterThan(0);
        const decimals = (ind.atr.toString().split('.')[1] ?? '').length;
        expect(decimals).toBeGreaterThan(2);
    });

    it('ATR is still finite and in a sane band relative to price', () => {
        const ind = calculateIndicators(cheapKlines());
        expect(Number.isFinite(ind.atr)).toBe(true);
        expect(ind.atr).toBeLessThan(ind.currentPrice);
    });

    it('large-denomination prices keep the two decimals they had before', () => {
        const klines: Kline[] = [];
        for (let i = 0; i < 60; i++) {
            const mid = 68000 + i * 25;
            klines.push(kl(Date.UTC(2026, 0, 1) + i * DAY, mid, mid + 200, mid - 200, mid + 50, 10));
        }
        const ind = calculateIndicators(klines);
        // 12345.678-style float noise would be a regression; two decimals is
        // the historical behavior for a five-figure price.
        const decimals = (ind.currentPrice.toString().split('.')[1] ?? '').length;
        expect(decimals).toBeLessThanOrEqual(2);
        expect(ind.currentPrice).toBeGreaterThan(60000);
    });
});
