/**
 * marketSnapshot — the ONE builder for the Live Market data block.
 *
 * The payload used to be assembled by six private indicator functions inside
 * `components/market/LiveMarket.tsx`, five of which were a second
 * implementation of `TechnicalAnalysisService`. These pin the two properties
 * that matter after the dedupe:
 *   · the numbers the panel reports ARE the canonical service's numbers
 *     (a drifted copy is the exact failure this module exists to remove), and
 *   · the JSON SHAPE stays what `utils/liveMarketParser` and
 *     `GenericAnalysisService` parse — that contract is load-bearing and a
 *     silent reshape would break prompt formatting and market-data parsing.
 */

import { describe, it, expect } from 'vitest';
import {
    buildTimeframeSnapshot,
    formatLiveMarketPrompt,
    identifyCandlePattern,
} from '../services/analysis/marketSnapshot';
import { calculateIndicators } from '../services/analysis/TechnicalAnalysisService';
import { parseLiveMarketData } from '../utils/liveMarketParser';
import type { Kline } from '../services/analysis/MarketDataService';

const kline = (i: number, close: number): Kline => ({
    time: 1_700_000_000_000 + i * 3_600_000,
    open: close - 1,
    high: close + 2,
    low: close - 2,
    close,
    volume: 100 + i,
});

/** A gentle uptrend with a little noise — enough history for every indicator
 *  the block emits (RSI 2/3/14, Bollinger 20, MACD 26, MA/EMA 200, PSAR). */
const history = (n: number): Kline[] =>
    Array.from({ length: n }, (_, i) => kline(i, 100 + i * 0.5 + Math.sin(i / 3) * 2));

describe('marketSnapshot delegates to the canonical indicators', () => {
    const klines = history(300);
    const snap = buildTimeframeSnapshot(klines);
    const canonical = calculateIndicators(klines);

    it('reports the canonical RSI(14), MACD and Bollinger values, not a private copy', () => {
        expect(snap.momentum_indicators.rsi14).toBe(canonical.rsi.rsi14);
        expect(snap.momentum_indicators.macd).toEqual({
            dif: canonical.macd.dif,
            dea: canonical.macd.dea,
            hist: canonical.macd.histogram,
        });
        expect(snap.trend_indicators.bollinger).toEqual({
            upper: canonical.bollingerBands.upper,
            lower: canonical.bollingerBands.lower,
            mid: canonical.bollingerBands.middle,
        });
        expect(snap.price).toBe(canonical.currentPrice);
    });

    it('re-keys the canonical MA + EMA sets under the periods the block has always carried', () => {
        expect(snap.trend_indicators.ma).toEqual({
            '5': canonical.sma.ma5, '10': canonical.sma.ma10, '20': canonical.sma.ma20,
            '30': canonical.sma.ma30, '60': canonical.sma.ma60, '200': canonical.sma.ma200,
        });
        expect(snap.trend_indicators.ema).toEqual({
            '5': canonical.ema.ema5, '13': canonical.ema.ema13,
            '20': canonical.ema.ema20, '200': canonical.ema.ema200,
        });
    });

    it('serves KDJ from the canonical stochastic block (J = 3K − 2D, the line the panel always called KDJ)', () => {
        expect(snap.momentum_indicators.kdj).toEqual(canonical.stochastic);
    });

    it('adds the three readings the canonical service does not expose: short RSI, SAR, and the candle label', () => {
        expect(snap.momentum_indicators.rsi2).not.toBeNull();
        expect(snap.momentum_indicators.rsi3).not.toBeNull();
        expect(Number.isFinite(snap.trend_indicators.sar as number)).toBe(true);
        expect(snap.trend_indicators.candle_pattern).toBe(identifyCandlePattern(klines));
    });

    it('leaves the short RSIs null (not zero) when there is no history to compute them from', () => {
        const tiny = buildTimeframeSnapshot(history(2));
        expect(tiny.momentum_indicators.rsi2).toBeNull();
        expect(tiny.momentum_indicators.rsi3).toBeNull();
    });
});

describe('the block still parses as live market data', () => {
    it('the prompt keeps the fence, the per-timeframe price, the patterns and the key zones', () => {
        const prompt = formatLiveMarketPrompt('ETHUSDT', { '15m': buildTimeframeSnapshot(history(300)) });
        expect(prompt).toContain('**LIVE MARKET DATA**');
        // GenericAnalysisService keys its formatting off this exact heading.
        const parsed = parseLiveMarketData(prompt);
        expect(parsed).not.toBeNull();
        expect(parsed?.prices['15m']).toBeDefined();
        expect(parsed?.keyZones).toEqual({ support: expect.any(Array), resistance: expect.any(Array) });
    });
});
