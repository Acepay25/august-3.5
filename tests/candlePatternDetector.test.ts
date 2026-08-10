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
    it('detects a double top anchored at the most recent swing high', () => {
        // Local-swing extraction needs the two neighbors on each side to
        // be LOWER than the swing-high candidate. We design 8 completed
        // candles + 1 incomplete dummy, with swing highs at recentFirst[2]
        // (price 110, the NEWER swing) and recentFirst[5] (price 110.3, the
        // OLDER swing). Delta 0.27% < 0.3%.
        // (Layout is from MOST RECENT first, so recentFirst[0] must NOT
        // have a higher high than the swing highs.)
        const series: Kline[] = [
            // 0: oldest
            k(107, 109, 106, 108.5, 0),
            k(107, 109, 106, 108.5, 60_000),
            k(108, 110.3, 105, 105.5, 120_000), // recentFirst[5] = swing high B (110.3)
            k(108, 109, 105, 108.5, 180_000),
            k(105.5, 105.9, 104, 104.5, 240_000),
            k(108, 110, 105, 109, 300_000),     // recentFirst[2] = swing high A (110)
            k(107, 107, 106, 106.5, 360_000),
            k(107, 107, 106, 106.5, 420_000),   // recentFirst[0] (most recent)
            k(107, 107, 106, 106.5, 480_000)   // incomplete — excluded
        ];
        const scan = scanCandlePatterns(series, 30);
        const dt = scan.patterns.filter(p => p.name === 'double_top');
        expect(dt.length).toBeGreaterThan(0);
        expect(dt[0].direction).toBe('bearish');
        // Anchored at the MOST RECENT of the two swing highs — with the
        // swing lists read backwards this reported recentFirst[5] (the
        // older swing) instead.
        expect(dt[0].index).toBe(2);
        expect(scan.recentSwingHigh).toBe(110);
    });

    it('counts a lower-high as lowerHighs (not higherHighs)', () => {
        // The OLDER swing (recentFirst[5]) is at 112 and the NEWER swing
        // (recentFirst[2]) at 110 — in time order 112 → 110, i.e. declining
        // highs. The trend-structure counts must reflect that direction.
        const series: Kline[] = [
            k(107, 109, 106, 108.5, 0),
            k(107, 109, 106, 108.5, 60_000),
            k(108, 112, 105, 105.5, 120_000),   // recentFirst[5] = swing high B (112, OLDER)
            k(108, 109, 105, 108.5, 180_000),
            k(105.5, 105.9, 104, 104.5, 240_000),
            k(108, 110, 105, 109, 300_000),     // recentFirst[2] = swing high A (110, NEWER)
            k(107, 107, 106, 106.5, 360_000),
            k(107, 107, 106, 106.5, 420_000),
            k(107, 107, 106, 106.5, 480_000)   // incomplete — excluded
        ];
        const scan = scanCandlePatterns(series, 30);
        expect(scan.higherHighs).toBe(0);
        expect(scan.lowerHighs).toBe(1);
        // recentSwingHigh = the most recent pivot (110), not the window max (112).
        expect(scan.recentSwingHigh).toBe(110);
    });

    it('counts a genuine higher-high (newer swing above older) as higherHighs', () => {
        // Swapped vs the previous test: the NEWER swing (recentFirst[2]) is
        // now the higher one (112) — a real higher-high in time order.
        const series: Kline[] = [
            k(107, 109, 106, 108.5, 0),
            k(107, 109, 106, 108.5, 60_000),
            k(108, 110, 105, 105.5, 120_000),   // recentFirst[5] = swing high B (110, OLDER)
            k(108, 109, 105, 108.5, 180_000),
            k(105.5, 105.9, 104, 104.5, 240_000),
            k(108, 112, 105, 109, 300_000),     // recentFirst[2] = swing high A (112, NEWER)
            k(107, 107, 106, 106.5, 360_000),
            k(107, 107, 106, 106.5, 420_000),
            k(107, 107, 106, 106.5, 480_000)   // incomplete — excluded
        ];
        const scan = scanCandlePatterns(series, 30);
        expect(scan.higherHighs).toBe(1);
        expect(scan.lowerHighs).toBe(0);
        expect(scan.recentSwingHigh).toBe(112);
    });

    it('anchors BOS to the MOST RECENT swing high, not the oldest in the window', () => {
        // Two swing highs: an older one at 110 (recentFirst[6]) and a newer
        // one at 105 (recentFirst[3]). The most recent close (105.8) sits
        // ABOVE the recent swing (105) but BELOW the old one (110) — a real
        // break of the recent structure. Reading the swing list backwards
        // compared against 110 and missed the BOS entirely.
        const series: Kline[] = [
            k(107.0, 108.0, 106.5, 107.5, 0),       // recentFirst[8]
            k(107.5, 108.5, 107.0, 108.0, 60_000),   // recentFirst[7]
            k(108.5, 110.0, 108.0, 109.5, 120_000),  // recentFirst[6] = swing high 110 (OLD)
            k(103.6, 104.0, 103.3, 103.7, 180_000),  // recentFirst[5]
            k(103.8, 104.2, 103.5, 103.9, 240_000),  // recentFirst[4]
            k(104.0, 105.0, 103.6, 104.2, 300_000),  // recentFirst[3] = swing high 105 (NEW)
            k(104.3, 104.7, 104.1, 104.4, 360_000),  // recentFirst[2]
            k(104.2, 104.6, 104.0, 104.4, 420_000),  // recentFirst[1]
            k(105.4, 106.2, 105.0, 105.8, 480_000),  // recentFirst[0] — close 105.8
            k(105.8, 106.0, 105.2, 105.6, 540_000)   // incomplete — excluded
        ];
        const scan = scanCandlePatterns(series, 30);
        const bos = scan.patterns.filter(p => p.name === 'bullish_bos');
        expect(bos.length).toBe(1);
        expect(bos[0].index).toBe(0);
        expect(bos[0].priceLevel).toBe(105);
        // The break follows declining highs — CHoCH fires alongside BOS.
        expect(scan.patterns.some(p => p.name === 'bullish_cho_ch')).toBe(true);
        expect(scan.recentSwingHigh).toBe(105);
    });

    it('detects a bullish SFP when the low sweeps the recent swing low and closes back above', () => {
        const series: Kline[] = [
            k(100.6, 100.9, 100.5, 100.7, 0),       // recentFirst[7]
            k(100.7, 101.0, 100.6, 100.9, 60_000),   // recentFirst[6]
            k(100.4, 100.8, 100.4, 100.5, 120_000),  // recentFirst[5]
            k(100.5, 100.9, 100.3, 100.6, 180_000),  // recentFirst[4]
            k(100.8, 101.2, 100.0, 100.4, 240_000),  // recentFirst[3] = swing low 100.0
            k(100.6, 101.0, 100.1, 100.7, 300_000),  // recentFirst[2]
            k(100.5, 100.9, 100.2, 100.6, 360_000),  // recentFirst[1]
            k(100.2, 101.0, 99.5, 100.6, 420_000),   // recentFirst[0] — low 99.5 sweeps 100.0, close 100.6
            k(100.6, 100.8, 100.4, 100.6, 480_000)   // incomplete — excluded
        ];
        const scan = scanCandlePatterns(series, 30);
        const sfp = scan.patterns.filter(p => p.name === 'bullish_sfp');
        expect(sfp.length).toBe(1);
        expect(sfp[0].index).toBe(0);
        expect(sfp[0].priceLevel).toBe(100);
    });

    it('detects a bearish SFP when the high sweeps the recent swing high and closes back below', () => {
        const series: Kline[] = [
            k(100.6, 100.8, 100.4, 100.6, 0),       // recentFirst[7]
            k(100.7, 100.9, 100.5, 100.8, 60_000),   // recentFirst[6]
            k(100.3, 100.6, 100.1, 100.4, 120_000),  // recentFirst[5]
            k(100.4, 100.7, 100.2, 100.5, 180_000),  // recentFirst[4]
            k(100.3, 101.0, 100.0, 100.5, 240_000),  // recentFirst[3] = swing high 101.0
            k(100.6, 100.9, 100.3, 100.7, 300_000),  // recentFirst[2]
            k(100.5, 100.8, 100.2, 100.6, 360_000),  // recentFirst[1]
            k(100.8, 101.6, 100.2, 100.4, 420_000),  // recentFirst[0] — high 101.6 sweeps 101.0, close 100.4
            k(100.4, 100.6, 100.1, 100.5, 480_000)   // incomplete — excluded
        ];
        const scan = scanCandlePatterns(series, 30);
        const sfp = scan.patterns.filter(p => p.name === 'bearish_sfp');
        expect(sfp.length).toBe(1);
        expect(sfp[0].index).toBe(0);
        expect(sfp[0].priceLevel).toBe(101);
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

describe('scanCandlePatterns — three-candle timing order', () => {
    it('detects a morning star completing at the most recent candle (bearish → small → bullish)', () => {
        // Candle order in buildSeries is OLDEST first; the last completed
        // candle is the newest. Morning star = big bearish, small body,
        // big bullish closing into the first candle's body.
        const series = buildSeries([
            [99.5, 100, 99.2, 99.8],    // context
            [99.8, 100.2, 99.5, 100.1], // context
            [100, 100.2, 97.8, 98],     // prev: big bearish (body [98, 100])
            [98.1, 98.6, 97.9, 98.2],   // mid: small body
            [98.3, 100.8, 98.2, 100.5], // curr: big bullish, close 100.5 > prev mid 99
            [100.5, 100.7, 100.2, 100.4] // incomplete — excluded
        ]);
        const scan = scanCandlePatterns(series, 30);
        const ms = scan.patterns.filter(p => p.name === 'morning_star');
        expect(ms.length).toBe(1);
        expect(ms[0].index).toBe(0);
        expect(ms[0].direction).toBe('bullish');
    });

    it('does NOT call the mirror shape a morning star — it is an evening star', () => {
        // The reversed triple (bullish → small → bearish) must fire the
        // bearish pattern, never the bullish one — pins the newest-first
        // (curr, mid, prev) binding so a refactor cannot silently flip it.
        const series = buildSeries([
            [99.5, 100, 99.2, 99.8],    // context
            [99.8, 100.2, 99.5, 100.1], // context
            [98, 100.2, 97.8, 100],     // prev: big bullish (body [98, 100])
            [99.9, 100.4, 99.5, 100.1], // mid: small body
            [99.8, 100.1, 97.5, 97.9],  // curr: big bearish, close 97.9 < prev mid 99
            [97.9, 98.1, 97.6, 97.8]    // incomplete — excluded
        ]);
        const scan = scanCandlePatterns(series, 30);
        expect(scan.patterns.some(p => p.name === 'evening_star')).toBe(true);
        expect(scan.patterns.some(p => p.name === 'morning_star')).toBe(false);
    });

    it('detects textbook three white soldiers (opens inside prior bodies, rising closes)', () => {
        const series = buildSeries([
            [99.5, 99.9, 99.0, 99.2],   // context (bearish — must not extend the pattern)
            [99.4, 99.8, 99.0, 99.3],   // context (bearish)
            [100, 102.4, 99.8, 102],    // prev: bullish (body [100, 102])
            [101.2, 103.8, 101, 103.5], // mid: opens inside prev body
            [102.8, 105.5, 102.6, 105.2],// curr: opens inside mid body, closes highest
            [105.2, 105.4, 104.9, 105.1] // incomplete — excluded
        ]);
        const scan = scanCandlePatterns(series, 30);
        const soldiers = scan.patterns.filter(p => p.name === 'three_white_soldiers');
        expect(soldiers.length).toBe(1);
        expect(soldiers[0].index).toBe(0);
    });

    it('does NOT fire three white soldiers on a loose 3-bar uptrend (opens gapped out)', () => {
        // The regression for the dead `|| true` condition: three strong
        // bullish candles with rising closes but opens OUTSIDE the previous
        // bodies must not qualify — the old code fired on any 3-bar uptrend.
        const series = buildSeries([
            [99.5, 99.9, 99.0, 99.2],   // context (bearish — must not extend the pattern)
            [99.4, 99.8, 99.0, 99.3],   // context (bearish)
            [100, 102.3, 99.9, 102],    // prev: bullish
            [105, 107.2, 104.8, 107],   // mid: opens ABOVE prev close (gap)
            [110, 112.1, 109.9, 112],   // curr: opens ABOVE mid close (gap)
            [112, 112.2, 111.7, 111.9]  // incomplete — excluded
        ]);
        const scan = scanCandlePatterns(series, 30);
        expect(scan.patterns.some(p => p.name === 'three_white_soldiers')).toBe(false);
    });

    it('detects textbook three black crows (opens inside prior bodies, falling closes)', () => {
        const series = buildSeries([
            [101, 101.4, 100.6, 101.1], // context
            [101.1, 101.5, 100.8, 101.2],// context
            [100, 100.2, 97.8, 98],     // prev: bearish (body [98, 100])
            [98.6, 98.9, 96.2, 96.4],   // mid: opens inside prev body
            [96.8, 97.1, 94.6, 94.8],   // curr: opens inside mid body, closes lowest
            [94.8, 95, 94.5, 94.7]      // incomplete — excluded
        ]);
        const scan = scanCandlePatterns(series, 30);
        const crows = scan.patterns.filter(p => p.name === 'three_black_crows');
        expect(crows.length).toBe(1);
        expect(crows[0].index).toBe(0);
    });

    it('does NOT fire three black crows on a loose 3-bar downtrend (gapped opens)', () => {
        const series = buildSeries([
            [101, 101.4, 100.6, 101.1], // context
            [101.1, 101.5, 100.8, 101.2],// context
            [100, 100.2, 97.8, 98],     // prev: bearish
            [94, 94.2, 92, 92.2],       // mid: opens BELOW prev body (gap)
            [90, 90.1, 88, 88.2],       // curr: opens BELOW mid body (gap)
            [88.2, 88.4, 87.9, 88.1]    // incomplete — excluded
        ]);
        const scan = scanCandlePatterns(series, 30);
        expect(scan.patterns.some(p => p.name === 'three_black_crows')).toBe(false);
    });

    it('detects three inside up / down (harami + confirmation)', () => {
        // Up: bearish → small bullish inside it → close above the first open.
        const up = buildSeries([
            [99.5, 100, 99.2, 99.8],    // context
            [99.8, 100.2, 99.5, 100.1], // context
            [100, 100.5, 97.8, 98],     // prev: bearish (body [98, 100])
            [98.5, 98.9, 98.2, 98.7],   // mid: small bullish inside prev
            [99.5, 100.9, 99.3, 100.7], // curr: closes above prev open 100
            [100.7, 100.9, 100.4, 100.6] // incomplete — excluded
        ]);
        const upScan = scanCandlePatterns(up, 30);
        expect(upScan.patterns.some(p => p.name === 'three_inside_up')).toBe(true);

        // Down: bullish → small bearish inside it → close below the first open.
        const down = buildSeries([
            [99.5, 100, 99.2, 99.8],    // context
            [99.8, 100.2, 99.5, 100.1], // context
            [98, 102, 97.8, 100],       // prev: bullish (body [98, 100])
            [99.5, 99.9, 99.2, 99.4],   // mid: small bearish inside prev
            [98.8, 99.2, 97.3, 97.6],   // curr: closes below prev open 98
            [97.6, 97.8, 97.3, 97.5]    // incomplete — excluded
        ]);
        const downScan = scanCandlePatterns(down, 30);
        expect(downScan.patterns.some(p => p.name === 'three_inside_down')).toBe(true);
    });

    it('detects bullish and bearish fair value gaps (3-candle unfilled zones)', () => {
        const up = buildSeries([
            [99.5, 100, 99.2, 99.8],    // context
            [99.8, 101.0, 99.5, 100.1], // context (high 101.0 — blocks an extra FVG)
            [100, 100.5, 99.5, 100.3],  // prev: high 100.5
            [100.8, 101.5, 100.6, 101.2],// mid
            [101.9, 102.6, 101.8, 102.4],// curr: low 101.8 > prev high 100.5 → gap
            [102.4, 102.6, 102.1, 102.3] // incomplete — excluded
        ]);
        const upScan = scanCandlePatterns(up, 30);
        const upFvg = upScan.patterns.filter(p => p.name === 'bullish_fvg');
        expect(upFvg.length).toBe(1);
        // The untraded zone is [prev.high, mid.low] — the middle candle
        // created the gap (mid.low 100.6 > prev.high 100.5), so the anchor is
        // the middle candle's low, not the current candle's.
        expect(upFvg[0].priceLevel).toBe((100.5 + 100.6) / 2);

        const down = buildSeries([
            [103, 103.4, 102.4, 103.1], // context
            [103.1, 103.5, 101.5, 103.2],// context (low 101.5 — no gap below)
            [102.4, 102.6, 102.0, 102.3], // prev: low 102.0
            [101.5, 101.7, 100.9, 101.2], // mid: high 101.7 < prev low 102.0 → gap zone [101.7, 102.0]
            [100.5, 100.9, 99.8, 100.6],  // curr: high 100.9 < prev low 102.0 → still unfilled
            [100.6, 100.8, 100.1, 100.3]  // incomplete — excluded
        ]);
        const downScan = scanCandlePatterns(down, 30);
        const downFvg = downScan.patterns.filter(p => p.name === 'bearish_fvg');
        expect(downFvg.length).toBe(1);
        expect(downFvg[0].priceLevel).toBe((101.7 + 102.0) / 2);
    });
});

describe('scanCandlePatterns — additional classical patterns', () => {
    it('detects a spinning top (small body, wicks both sides) as neutral', () => {
        const series = buildSeries([
            [100, 101.5, 99.5, 100.9],  // context
            [100.9, 101.8, 100.2, 101.4],// context
            [100, 102.5, 97.5, 101],    // spinning top: body 1/5=20%, upper 30%, lower 50%
            [101, 101.2, 100.7, 100.9]  // incomplete — excluded
        ]);
        const scan = scanCandlePatterns(series, 30);
        const tops = scan.patterns.filter(p => p.name === 'spinning_top');
        expect(tops.length).toBe(1);
        expect(tops[0].direction).toBe('neutral');
    });

    it('detects bullish and bearish belt holds (open at the extreme, big body)', () => {
        const bull = buildSeries([
            [99, 99.6, 98.8, 99.5],
            [99.5, 100.1, 99.2, 100],
            [100, 102.5, 99.9, 101.8],  // opens at low, body 69% of range
            [101.8, 102, 101.5, 101.7]  // incomplete — excluded
        ]);
        const bullScan = scanCandlePatterns(bull, 30);
        expect(bullScan.patterns.some(p => p.name === 'bullish_belt_hold')).toBe(true);
        expect(bullScan.patterns.some(p => p.name === 'bullish_marubozu')).toBe(false);

        const bear = buildSeries([
            [101, 101.4, 100.6, 101.1],
            [101.1, 101.5, 100.8, 101.2],
            [101.8, 101.9, 99.3, 100],  // opens at high, body 69% of range
            [100, 100.2, 99.7, 99.9]    // incomplete — excluded
        ]);
        const bearScan = scanCandlePatterns(bear, 30);
        expect(bearScan.patterns.some(p => p.name === 'bearish_belt_hold')).toBe(true);
    });

    it('reads hammer vs hanging man from the prior trend (same shape, opposite meaning)', () => {
        // Hammer shape: long lower wick, small body at the top of the range,
        // upper wick ≥ 25% so the stricter pin bar does not claim it.
        // [100, 104, 94, 101.5]: lower 60.6%, body 15.2%, upper 25.3%.
        const hammerShape = [100, 104, 94, 101.5] as [number, number, number, number];

        // After a downtrend → bullish hammer.
        const downFirst = buildSeries([
            [100.6, 100.9, 99.8, 100],
            [100, 100.4, 99.2, 99.4],
            [99.4, 99.8, 98.9, 99.1],
            hammerShape,
            [101.5, 101.7, 101.2, 101.4] // incomplete — excluded
        ]);
        const downScan = scanCandlePatterns(downFirst, 30);
        expect(downScan.patterns.some(p => p.name === 'hammer')).toBe(true);
        expect(downScan.patterns.some(p => p.name === 'hanging_man')).toBe(false);

        // After an uptrend → bearish hanging man, not hammer.
        const upFirst = buildSeries([
            [99, 99.6, 98.8, 99.5],
            [99.5, 100.2, 99.3, 100.1],
            [100.1, 100.8, 99.9, 100.6],
            hammerShape,
            [101.5, 101.7, 101.2, 101.4] // incomplete — excluded
        ]);
        const upScan = scanCandlePatterns(upFirst, 30);
        expect(upScan.patterns.some(p => p.name === 'hanging_man')).toBe(true);
        expect(upScan.patterns.some(p => p.name === 'hammer')).toBe(false);
    });

    it('detects an inverted hammer after a downtrend (shooting-star geometry, bullish)', () => {
        // Shooting-star shape: [100, 130, 99, 106] — upper 77%, body 19%.
        const series = buildSeries([
            [101, 101.4, 100.6, 101.1],
            [100.6, 101, 99.8, 100],
            [100, 100.4, 99.2, 99.4],
            [99.4, 99.8, 98.9, 99.1],
            [100, 130, 99, 106],        // inverted hammer (after downtrend)
            [106, 106.2, 105.7, 105.9]  // incomplete — excluded
        ]);
        const scan = scanCandlePatterns(series, 30);
        expect(scan.patterns.some(p => p.name === 'inverted_hammer')).toBe(true);
        expect(scan.patterns.some(p => p.name === 'bearish_shooting_star')).toBe(false);
    });

    it('detects bullish and bearish harami (small body nested in the prior body)', () => {
        const bull = buildSeries([
            [99.5, 100, 99.2, 99.8],
            [99.8, 100.2, 99.5, 100.1],
            [100, 100.5, 97.5, 98],     // prev: big bearish (body 66% of range)
            [98.5, 98.9, 98.2, 98.7],   // curr: small bullish fully inside
            [98.7, 99, 98.4, 98.6]      // incomplete — excluded
        ]);
        const bullScan = scanCandlePatterns(bull, 30);
        expect(bullScan.patterns.some(p => p.name === 'bullish_harami')).toBe(true);

        const bear = buildSeries([
            [99.5, 100, 99.2, 99.8],
            [99.8, 100.2, 99.5, 100.1],
            [98, 102, 97.8, 100],       // prev: big bullish (body 47% of range)
            [99.5, 99.9, 99.2, 99.4],   // curr: small bearish fully inside
            [99.4, 99.6, 99.1, 99.3]    // incomplete — excluded
        ]);
        const bearScan = scanCandlePatterns(bear, 30);
        expect(bearScan.patterns.some(p => p.name === 'bearish_harami')).toBe(true);
    });

    it('detects a piercing line (bullish) and dark cloud cover (bearish)', () => {
        const piercing = buildSeries([
            [99.5, 100, 99.2, 99.8],
            [99.8, 100.2, 99.5, 100.1],
            [100, 100.5, 97.8, 98],     // prev: bearish (body [98, 100])
            [97.5, 100.3, 97.3, 99.6],  // curr: opens below prev close, closes > mid 99
            [99.6, 99.8, 99.3, 99.5]    // incomplete — excluded
        ]);
        const piercingScan = scanCandlePatterns(piercing, 30);
        expect(piercingScan.patterns.some(p => p.name === 'piercing_line')).toBe(true);

        const darkCloud = buildSeries([
            [99.5, 100, 99.2, 99.8],
            [99.8, 100.2, 99.5, 100.1],
            [98, 102, 97.8, 100],       // prev: bullish (body [98, 100])
            [100.5, 100.8, 98.4, 98.6], // curr: opens above prev close, closes < mid 99
            [98.6, 98.8, 98.3, 98.5]    // incomplete — excluded
        ]);
        const darkCloudScan = scanCandlePatterns(darkCloud, 30);
        expect(darkCloudScan.patterns.some(p => p.name === 'dark_cloud_cover')).toBe(true);
    });
});
