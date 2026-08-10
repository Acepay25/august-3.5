import { describe, it, expect } from 'vitest';
import { scanCandlePatterns } from '../services/analysis/CandlePatternDetector';
import { Kline } from '../services/analysis/MarketDataService';

/**
 * Build a single synthetic candle with sane defaults.
 */
const k = (
    open: number,
    high: number,
    low: number,
    close: number,
    time: number = 0,
    volume: number = 1000
): Kline => ({ time, open, high, low, close, volume });

/**
 * Build a sequence of N candles from a list of [open, high, low, close]
 * tuples. Newest candle must be LAST (matches MarketDataService ordering).
 */
const buildSeries = (rows: Array<[number, number, number, number]>): Kline[] =>
    rows.map(([o, h, l, c], i) => k(o, h, l, c, i * 60_000));

describe('scanCandlePatterns — shape & defaults', () => {
    it('returns an empty scan for empty kline input', () => {
        const scan = scanCandlePatterns([], 30);
        expect(scan.windowSize).toBe(0);
        expect(scan.patterns).toEqual([]);
        expect(scan.bullishCount).toBe(0);
        expect(scan.bearishCount).toBe(0);
        expect(scan.dominantTrend).toBe('neutral');
    });

    it('drops the current (last) incomplete candle from the window', () => {
        // 5 candles, last one is the in-progress tick — we should look at
        // the 4 completed ones, oldest first. So bullishCount + bearishCount
        // must equal windowSize (4), not 5.
        const series = buildSeries([
            [100, 101, 99, 100.5],   // bullish completed
            [100.5, 102, 100, 101.5], // bullish completed
            [101.5, 101.7, 100.2, 100.3], // bearish completed
            [100.3, 100.4, 99, 99.1], // bearish completed
            [99.1, 99.5, 98.8, 99.3]  // current incomplete (excluded)
        ]);
        const scan = scanCandlePatterns(series, 30);
        expect(scan.windowSize).toBe(4);
        expect(scan.bullishCount + scan.bearishCount).toBe(4);
    });
});

describe('scanCandlePatterns — single-candle patterns', () => {
    it('detects a bullish pin bar (long lower wick)', () => {
        // Pin bar: long lower wick, body 10-30% of range, tiny upper wick.
        // Body < 10% would be classified as a doji, so we use ~16% body.
        // open=100, close=104 (body=4), high=105, low=80 (range=25)
        // bodyRatio=16%, upper=4%, lower=80%.
        const series = buildSeries([
            [99, 100, 98, 99.5],     // prior context
            [98.5, 99.5, 98, 99],    // prior context
            [100, 105, 80, 104],     // bullish pin bar (most recent completed)
            [104, 104.5, 103.5, 104] // incomplete tick — excluded
        ]);
        const scan = scanCandlePatterns(series, 30);
        const pins = scan.patterns.filter(p => p.name === 'bullish_pin_bar');
        expect(pins.length).toBeGreaterThan(0);
        expect(pins[0].direction).toBe('bullish');
        expect(pins[0].index).toBe(0);
    });

    it('detects a bearish shooting star (long upper wick)', () => {
        // Shooting star: long upper wick, body 10-35% of range, tiny lower wick.
        // open=100, close=106 (body=6), high=130, low=99 (range=31)
        // bodyRatio=19%, upper=77%, lower=3%.
        const series = buildSeries([
            [101, 103, 100, 102.5],   // context
            [102, 104, 101, 103],     // context
            [100, 130, 99, 106],      // bearish shooting star (most recent)
            [106, 106.5, 105.5, 106]  // incomplete — excluded
        ]);
        const scan = scanCandlePatterns(series, 30);
        const stars = scan.patterns.filter(p => p.name === 'bearish_shooting_star');
        expect(stars.length).toBeGreaterThan(0);
        expect(stars[0].direction).toBe('bearish');
    });

    it('detects a doji when the body is tiny', () => {
        // open=100, close=100.1 (body=0.1), high=105, low=95 (range=10)
        // bodyRatio=1% — clear doji.
        const series = buildSeries([
            [100, 102, 99, 100.5],    // context
            [99.5, 101, 99, 100],     // context
            [100, 105, 95, 100.1],    // doji (most recent)
            [100.1, 100.3, 100, 100.2] // incomplete — excluded
        ]);
        const scan = scanCandlePatterns(series, 30);
        const dojis = scan.patterns.filter(p => p.name === 'doji');
        expect(dojis.length).toBeGreaterThan(0);
        expect(dojis[0].direction).toBe('neutral');
    });
});

describe('scanCandlePatterns — two-candle patterns', () => {
    it('detects bullish engulfing', () => {
        // Engulfing: prev bearish, curr bullish, curr.open <= prev.close,
        // curr.close >= prev.open, |curr body| > 0.8 * |prev body|.
        // prev: open=101, close=100.6 (body 0.4, range 0.7)
        // curr: open=99, close=101.5 (body 2.5, range 3) — body covers prev.
        const series = buildSeries([
            [100, 101, 99, 100.5],     // context
            [101, 101.2, 100.5, 100.6], // prev: bearish
            [99, 101, 98, 101.5],       // curr: bullish engulfing
            [101.5, 102, 101, 101.5]    // incomplete — excluded
        ]);
        const scan = scanCandlePatterns(series, 30);
        const eng = scan.patterns.filter(p => p.name === 'bullish_engulfing');
        expect(eng.length).toBeGreaterThan(0);
    });

    it('detects tweezer bottom (two candles test the same low)', () => {
        // Two-candle detector convention: prev = the older one, curr = the
        // newer one. For tweezer bottom we need prev bearish, curr bullish,
        // and the two lows within 0.15% of each other.
        // prev: open=100.3, close=100.0 (bearish), low=100.0
        // curr: open=100, close=100.2 (bullish), low=100.0
        // lowDelta = 0% < 0.15% → tweezer bottom.
        const series = buildSeries([
            [100.3, 100.8, 99, 100.4],     // context
            [100.3, 100.5, 100.0, 100.0],  // prev: bearish (close 100.0 < open 100.3)
            [100, 100.5, 100.0, 100.2],    // curr: bullish (close 100.2 > open 100)
            [100.2, 100.4, 100, 100.3]     // incomplete — excluded
        ]);
        const scan = scanCandlePatterns(series, 30);
        const tweezers = scan.patterns.filter(p => p.name === 'tweezer_bottom');
        expect(tweezers.length).toBeGreaterThan(0);
    });
});

describe('scanCandlePatterns — structure patterns', () => {
    it('detects a double top when two recent swing highs are within 0.3%', () => {
        // Local-swing extraction needs the two neighbors on each side to
        // be LOWER than the swing-high candidate. We design 8 completed
        // candles + 1 incomplete dummy, with swing highs at recentFirst[2]
        // (price 110) and recentFirst[5] (price 110.3). Delta 0.27% < 0.3%.
        // (Layout is from MOST RECENT first, so recentFirst[0] must NOT
        // have a higher high than the swing highs.)
        const series: Kline[] = [
            // 0: oldest
            k(107, 109, 106, 108.5, 0),
            k(107, 109, 106, 108.5, 60_000),
            k(108, 110.3, 105, 105.5, 120_000), // recentFirst[5] = swing high B (110.3)
            k(108, 109, 105, 108.5, 180_000),
            k(105.5, 105, 104, 104.5, 240_000),
            k(108, 110, 105, 109, 300_000),     // recentFirst[2] = swing high A (110)
            k(107, 107, 106, 106.5, 360_000),
            k(107, 107, 106, 106.5, 420_000),   // recentFirst[0] (most recent)
            k(107, 107, 106, 106.5, 480_000)   // incomplete — excluded
        ];
        const scan = scanCandlePatterns(series, 30);
        const dt = scan.patterns.filter(p => p.name === 'double_top');
        expect(dt.length).toBeGreaterThan(0);
        expect(dt[0].direction).toBe('bearish');
    });

    it('counts HH/HL vs LH/LL for trend structure', () => {
        // Same shape as the double-top test but with a clear higher-high:
        // recentFirst[2] = 110, recentFirst[5] = 112 → higherHighs = 1.
        const series: Kline[] = [
            k(107, 109, 106, 108.5, 0),
            k(107, 109, 106, 108.5, 60_000),
            k(108, 112, 105, 105.5, 120_000),   // recentFirst[5] = swing high B (112)
            k(108, 109, 105, 108.5, 180_000),
            k(105.5, 105, 104, 104.5, 240_000),
            k(108, 110, 105, 109, 300_000),     // recentFirst[2] = swing high A (110)
            k(107, 107, 106, 106.5, 360_000),
            k(107, 107, 106, 106.5, 420_000),
            k(107, 107, 106, 106.5, 480_000)   // incomplete — excluded
        ];
        const scan = scanCandlePatterns(series, 30);
        expect(scan.higherHighs).toBeGreaterThan(0);
    });
});

describe('scanCandlePatterns — dominance and sequence', () => {
    it('classifies dominant trend as bullish when >60% of candles are bullish', () => {
        // 4 completed candles (3 bullish, 1 bearish) + 1 incomplete dummy at end.
        const series = buildSeries([
            [99.2, 100.5, 99, 100.3],   // bullish context
            [101.5, 101.7, 99, 99.2],   // bearish context
            [100.8, 102, 100, 101.5],   // bullish context
            [100, 101, 99, 100.8],      // bullish (most recent)
            [100.8, 101, 100.5, 100.7]  // incomplete — excluded
        ]);
        const scan = scanCandlePatterns(series, 30);
        expect(scan.windowSize).toBe(4);
        expect(scan.bullishCount).toBe(3);
        expect(scan.bearishCount).toBe(1);
        expect(scan.dominantTrend).toBe('bullish');
    });
});
