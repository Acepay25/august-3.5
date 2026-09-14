/**
 * regime — the pure math behind the bias chips: EMA seeding + step, Wilder
 * RSI, the agree-or-neutral trend call, session VWAP arithmetic, and the
 * chip-row composition (order + the honest "no data, no chip" rules).
 */

import { describe, it, expect } from 'vitest';
import { ema, rsi, trendBias, sessionVwap, biasChips } from '../services/trade/regime';
import type { Kline } from '../services/analysis/MarketDataService';

const kl = (time: number, close: number, spread = 1, volume = 10): Kline => ({
    time, open: close, high: close + spread, low: close - spread, close, volume,
});
const rising = (n: number, t0 = 0, stepMs = 900_000): Kline[] =>
    Array.from({ length: n }, (_, i) => kl(t0 + i * stepMs, 100 + i));
const falling = (n: number): Kline[] =>
    Array.from({ length: n }, (_, i) => kl(i * 900_000, 200 - i));
const flat = (n: number, price = 100): Kline[] =>
    Array.from({ length: n }, (_, i) => kl(i * 900_000, price));

describe('ema', () => {
    it('seeds with the SMA and walks the tail', () => {
        expect(ema([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5)).toBeCloseTo(8, 10);
    });
    it('null when history is shorter than the period', () => {
        expect(ema([1, 2, 3], 5)).toBeNull();
    });
});

describe('rsi', () => {
    it('100 on a pure advance, 0 on a pure decline', () => {
        expect(rsi(Array.from({ length: 20 }, (_, i) => 100 + i))).toBe(100);
        expect(rsi(Array.from({ length: 20 }, (_, i) => 200 - i))).toBe(0);
    });
    it('null without period+1 closes', () => {
        expect(rsi([1, 2, 3], 14)).toBeNull();
    });
});

describe('trendBias (EMA and RSI must AGREE)', () => {
    it('bullish on a rising tape, bearish on a falling one', () => {
        expect(trendBias(rising(40).map(k => k.close))).toBe('bull');
        expect(trendBias(falling(40).map(k => k.close))).toBe('bear');
    });
    it('flat and thin histories read NEUTRAL, never a coin-flip', () => {
        expect(trendBias(flat(50).map(k => k.close))).toBe('neutral');
        expect(trendBias(flat(10).map(k => k.close))).toBe('neutral');
    });
});

describe('sessionVwap', () => {
    it('volume-weights the typical price', () => {
        const day = [
            { time: 0, open: 0, high: 10, low: 8, close: 9, volume: 1 },
            { time: 1, open: 0, high: 12, low: 10, close: 11, volume: 3 },
        ]; // tps 9 and 11 → (9*1 + 11*3) / 4 = 10.5
        expect(sessionVwap(day)).toBeCloseTo(10.5, 10);
    });
    it('null on empty or zero-volume history', () => {
        expect(sessionVwap([])).toBeNull();
        expect(sessionVwap([kl(0, 100, 1, 0)])).toBeNull();
    });
});

describe('biasChips', () => {
    const DAY = 86_400_000;
    const dailyRise: Kline[] = Array.from({ length: 40 }, (_, i) => kl(i * DAY, 100 + i));

    it('macro first, own-timeframe second, VWAP last', () => {
        const lastDay = dailyRise[dailyRise.length - 1].time;
        const current = Array.from({ length: 60 }, (_, i) => kl(lastDay + 900_000 + i * 900_000, 200));
        const chips = biasChips(current, '15m', dailyRise);
        expect(chips.map(c => c.text)).toEqual(['1D Bullish', '15m Neutral', 'Above VWAP']);
        expect(chips.map(c => c.tone)).toEqual(['bull', 'neutral', 'vwap']);
    });

    it('skips chips whose series is too thin instead of inventing one', () => {
        const lastDay = dailyRise[dailyRise.length - 1].time;
        const thinCurrent = Array.from({ length: 10 }, (_, i) => kl(lastDay + i * 900_000, 200));
        const chips = biasChips(thinCurrent, '15m', dailyRise);
        // No 15m chip (10 bars); 1D and the VWAP (over today's 10 + fallback)
        // stand. Exact chip count: 1D + VWAP = 2.
        expect(chips.map(c => c.text)).toEqual(['1D Bullish', 'Above VWAP']);
    });

    it('Below VWAP when the tape sits under the session average', () => {
        const lastDay = dailyRise[dailyRise.length - 1].time;
        // Morning at 200, then a midday drop to 100: the session VWAP (~183)
        // stays far above the last close.
        const below: Kline[] = [
            ...Array.from({ length: 50 }, (_, i) => kl(lastDay + 900_000 + i * 900_000, 200)),
            ...Array.from({ length: 10 }, (_, i) => kl(lastDay + 900_000 + (50 + i) * 900_000, 100)),
        ];
        const chips = biasChips(below, '15m', dailyRise);
        expect(chips[chips.length - 1].text).toBe('Below VWAP');
        expect(chips[chips.length - 1].tone).toBe('vwap');
    });
});
