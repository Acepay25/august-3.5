import { describe, it, expect } from 'vitest';

// SMC structure detectors (Batch 3) — synthetic klines with known geometry:
// every detector gets a series built so the expected read is derivable by
// hand, not fitted to the implementation.

import {
    atr14,
    buildDolTargets,
    buildSmcStructureRead,
    computePremiumDiscount,
    computeSessionCvd,
    detectEqualLevels,
    detectFvg,
    detectOrderBlocks,
    formatSmcStructureBlock,
    projectMeasuredMove,
    seasonalityFlags,
    stopVsAtrCheck,
} from '../utils/smcStructure';
import { Kline } from '../types';

// A candle builder with sane defaults; `overrides` patches any field.
const candle = (
    i: number,
    overrides: Partial<Kline> = {},
): Kline => ({
    time: 1_700_000_000_000 + i * 3_600_000,
    open: 100, high: 101, low: 99, close: 100.5, volume: 1000,
    takerBuyVolume: 500,
    ...overrides,
});

/** Flat series: identical candles — used as the "no signal" substrate. */
const flatSeries = (n: number): Kline[] => Array.from({ length: n }, (_, i) => candle(i));

describe('atr14', () => {
    it('constant-range candles → ATR = the range', () => {
        const ks = flatSeries(20);
        expect(atr14(ks)).toBeCloseTo(2); // high-low = 2 every candle
    });

    it('short series → 0 (honest, never fabricated)', () => {
        expect(atr14(flatSeries(5))).toBe(0);
    });
});

describe('detectEqualLevels', () => {
    it('two swing highs within tolerance pool as equal highs at the cluster max', () => {
        // Substrate of 60 candles, then plant two swing highs at 110 and 110.1
        // separated by several candles.
        const ks = flatSeries(60);
        ks[10] = candle(10, { high: 110, open: 100, close: 100.5 });
        ks[30] = candle(30, { high: 110.1, open: 100, close: 100.5 });
        const read = detectEqualLevels(ks);
        expect(read.equalHighs.length).toBeGreaterThanOrEqual(1);
        const eq = read.equalHighs[0];
        expect(eq.level).toBeCloseTo(110.1); // sweeps must exceed the max
        expect(eq.touches).toBe(2);
        expect(read.lines[0]).toContain('EQ HIGHS');
        expect(read.lines[0]).toContain('buy-side liquidity');
    });

    it('far-apart highs do not pool', () => {
        const ks = flatSeries(60);
        ks[10] = candle(10, { high: 110 });
        ks[30] = candle(30, { high: 130 });
        const read = detectEqualLevels(ks);
        expect(read.equalHighs).toHaveLength(0);
    });

    it('thin data → empty, no lines', () => {
        const read = detectEqualLevels(flatSeries(5));
        expect(read.lines).toEqual([]);
    });
});

describe('detectFvg', () => {
    it('bullish 3-candle gap (a.high < c.low) is detected as BISI', () => {
        // Pattern in the LAST three completed candles (39 is the forming
        // candle, dropped by the detector): 36 ends at high 104, 37 is the
        // displacement up, 38 trades with low 108 — gap [104, 108].
        const ks = flatSeries(40);
        ks[36] = candle(36, { open: 102, high: 104, low: 100, close: 103 });
        ks[37] = candle(37, { open: 104, high: 112, low: 104, close: 111 });
        ks[38] = candle(38, { open: 111, high: 113, low: 108, close: 112 });
        const gaps = detectFvg(ks);
        const g = gaps[0];
        expect(g).toBeDefined();
        expect(g.direction).toBe('bullish');
        expect(g.bottom).toBeCloseTo(104); // candle-a high
        expect(g.top).toBeCloseTo(108);    // candle-c low
        expect(g.midpoint).toBeCloseTo(106);
        expect(g.mitigated).toBe(false);   // nothing follows the pattern
    });

    it('bearish gap (a.low > c.high) is detected as SIBI', () => {
        const ks = flatSeries(40);
        ks[36] = candle(36, { open: 103, high: 104, low: 100, close: 102 });
        ks[37] = candle(37, { open: 100, high: 100, low: 92, close: 93 }); // displacement down
        ks[38] = candle(38, { open: 93, high: 96, low: 91, close: 95 });
        const gaps = detectFvg(ks);
        const g = gaps[0];
        expect(g).toBeDefined();
        expect(g.direction).toBe('bearish');
        expect(g.bottom).toBeCloseTo(96);  // candle-c high
        expect(g.top).toBeCloseTo(100);    // candle-a low
    });

    it('a later candle trading back into the gap marks it mitigated', () => {
        // Coherent story: base → gap up at 30-32 → candles 33-35 hold the
        // high → candle 36 dips to 106, inside the [104, 108] gap. Post-move
        // candles must stay near the new level — teleporting back to the
        // flat base would open its own (newer, first-scanned) gap.
        const ks = flatSeries(40);
        ks[30] = candle(30, { open: 102, high: 104, low: 100, close: 103 });
        ks[31] = candle(31, { open: 104, high: 112, low: 104, close: 111 });
        ks[32] = candle(32, { open: 111, high: 113, low: 108, close: 112 });
        ks[33] = candle(33, { open: 112, high: 113, low: 109, close: 111 });
        ks[34] = candle(34, { open: 111, high: 112, low: 108, close: 110 });
        ks[35] = candle(35, { open: 110, high: 111, low: 109, close: 110 });
        ks[36] = candle(36, { open: 110, high: 111, low: 106, close: 107 });
        ks[37] = candle(37, { open: 107, high: 109, low: 106, close: 108 });
        ks[38] = candle(38, { open: 108, high: 110, low: 107, close: 109 });
        const gaps = detectFvg(ks);
        const g = gaps[0];
        expect(g).toBeDefined();
        expect(g.direction).toBe('bullish');
        expect(g.bottom).toBeCloseTo(104);
        expect(g.top).toBeCloseTo(108);
        expect(g.mitigated).toBe(true);
    });

    it('overlap candles produce no gap', () => {
        const gaps = detectFvg(flatSeries(40));
        expect(gaps).toHaveLength(0);
    });
});

describe('detectOrderBlocks', () => {
    it('last down-candle before a strong up-leg is a bullish OB', () => {
        const ks = flatSeries(40);
        // ATR of the flat series is ~2, so a 3-candle leg spanning >4
        // (2×ATR) qualifies as displacement.
        ks[30] = candle(30, { open: 102, close: 100, high: 102.5, low: 99.5 }); // down candle = OB
        ks[31] = candle(31, { open: 100, close: 104, high: 104.5, low: 99.8 });
        ks[32] = candle(32, { open: 104, close: 105, high: 105.5, low: 103.5 });
        ks[33] = candle(33, { open: 105, close: 106, high: 106.5, low: 104.5 });
        const obs = detectOrderBlocks(ks, 2);
        expect(obs.length).toBeGreaterThanOrEqual(1);
        const ob = obs[0];
        expect(ob.direction).toBe('bullish');
        expect(ob.top).toBeCloseTo(102.5);
        expect(ob.bottom).toBeCloseTo(99.5);
        expect(ob.displacementAtr).toBeGreaterThanOrEqual(2);
    });

    it('no displacement → no OB', () => {
        const obs = detectOrderBlocks(flatSeries(40), 2);
        expect(obs).toHaveLength(0);
    });
});

describe('computePremiumDiscount', () => {
    it('price in the top third of the range is premium', () => {
        const ks = flatSeries(60);
        const pd = computePremiumDiscount(ks, 60, 100.9)!; // 95% up the 99–101 range
        expect(pd.zone).toBe('premium');
        expect(pd.positionPct).toBeCloseTo(95);
        expect(pd.equilibrium).toBeCloseTo(100);
    });

    it('price near the floor is discount', () => {
        const ks = flatSeries(60);
        const pd = computePremiumDiscount(ks, 60, 99.1)!;
        expect(pd.zone).toBe('discount');
        expect(pd.positionPct).toBeCloseTo(5);
    });

    it('defaults to the last completed close when no live price is given', () => {
        const pd = computePremiumDiscount(flatSeries(60))!; // close 100.5 → 75%
        expect(pd.positionPct).toBeCloseTo(75);
        expect(pd.zone).toBe('premium');
    });
});

describe('buildDolTargets', () => {
    it('tested levels are excluded; nearest untested come first, sorted', () => {
        const targets = buildDolTargets(100, [
            { label: 'PDH', price: 103, tested: true },   // excluded
            { label: 'PWH', price: 102, tested: false },
            { label: 'PWL', price: 97, tested: false },
            { label: 'weekly open', price: 100.5, tested: false },
        ]);
        expect(targets.map(t => t.label)).toEqual(['weekly open', 'PWH', 'PWL']);
        expect(targets[0].tier).toBe('T1'); // inside the 97–102 band
    });

    it('the extreme prices of the target set are T2 (external liquidity)', () => {
        const targets = buildDolTargets(100, [
            { label: 'A', price: 90, tested: false },
            { label: 'B', price: 95, tested: false },
            { label: 'C', price: 110, tested: false },
        ]);
        const tiers = Object.fromEntries(targets.map(t => [t.label, t.tier]));
        expect(tiers['A']).toBe('T2');
        expect(tiers['C']).toBe('T2');
        expect(tiers['B']).toBe('T1');
    });
});

describe('computeSessionCvd', () => {
    it('all-taker-buy candles → positive rising CVD', () => {
        const ks = flatSeries(20).map((k, i) => candle(i, {
            volume: 1000,
            takerBuyVolume: 900, // 900 buy − 100 sell = +800/candle
        }));
        const cvd = computeSessionCvd(ks)!;
        // The forming candle (index 19) is dropped — 19 completed × +800.
        expect(cvd.sessionCvd).toBeCloseTo(800 * 19);
        expect(cvd.trend).toBe('rising');
    });

    it('missing takerBuyVolume on any candle → null (never fabricated)', () => {
        const ks = flatSeries(20);
        delete (ks[3] as Partial<Kline>).takerBuyVolume;
        expect(computeSessionCvd(ks)).toBeNull();
    });

    it('bearish divergence: new price high on falling CVD is flagged', () => {
        // Price pushes a new high at the very end while CVD has been falling.
        const ks: Kline[] = [];
        for (let i = 0; i < 20; i++) {
            const base = 100 + i * 0.1;
            ks.push(candle(i, {
                open: base, high: base + 0.5, low: base - 0.5, close: base + 0.4,
                volume: 1000,
                takerBuyVolume: 900, // strong buys early
            }));
        }
        // Late candles: price new high but sells dominate
        ks[18] = { ...ks[18], high: ks[18].high + 2, takerBuyVolume: 100 };
        ks[19] = { ...ks[19], high: ks[19].high + 3, takerBuyVolume: 50 };
        const cvd = computeSessionCvd(ks)!;
        expect(cvd.divergences.some(d => d.startsWith('bearish CVD div'))).toBe(true);
    });
});

describe('projectMeasuredMove', () => {
    it('uptrend leg AB=CD: projection = pullback low + leg range', () => {
        const ks = flatSeries(30);
        // Leg: low 90 (idx 20) → high 110 (idx 24); pullback to 100 (idx 28)
        ks[20] = candle(20, { low: 90, open: 95, close: 97, high: 96 });
        ks[21] = candle(21, { open: 97, high: 102, low: 96, close: 101 });
        ks[22] = candle(22, { open: 101, high: 106, low: 100, close: 105 });
        ks[23] = candle(23, { open: 105, high: 108, low: 104, close: 107 });
        ks[24] = candle(24, { high: 110, open: 107, low: 106, close: 108 });
        ks[25] = candle(25, { open: 108, high: 109, low: 104, close: 105 });
        ks[26] = candle(26, { open: 105, high: 106, low: 102, close: 103 });
        ks[27] = candle(27, { open: 103, high: 104, low: 101, close: 102 });
        ks[28] = candle(28, { low: 100, open: 102, high: 103, close: 102.5 });
        ks[29] = candle(29, { open: 102.5, high: 103.5, low: 101.5, close: 102.8 });
        const mm = projectMeasuredMove(ks);
        expect(mm).not.toBeNull();
        // Leg 90→110 = 20; projection from pullback 100 → 120
        expect(mm!.projection).toBeCloseTo(120);
        expect(mm!.method).toBe('ab=cd');
        expect(mm!.rangeAtr).toBeGreaterThan(0);
    });

    it('no clean swing structure → null', () => {
        expect(projectMeasuredMove(flatSeries(12))).toBeNull();
    });
});

describe('seasonalityFlags', () => {
    it('Monday 02:00 UTC is inside the Monday-Asia-open window', () => {
        const flags = seasonalityFlags(new Date('2026-08-31T02:00:00Z')); // a Monday
        expect(flags.lines.some(l => l.includes('Monday-Asia-open'))).toBe(true);
    });

    it('Wednesday 10:00 UTC has no flags', () => {
        const flags = seasonalityFlags(new Date('2026-09-02T10:00:00Z')); // Wednesday
        expect(flags.lines).toEqual([]);
    });

    it('Saturday gets the weekend-chop warning', () => {
        const flags = seasonalityFlags(new Date('2026-08-29T12:00:00Z')); // Saturday
        expect(flags.lines.some(l => l.includes('Weekend chop'))).toBe(true);
    });

    it('weekday 13:30 UTC gets the pre-open caution', () => {
        const flags = seasonalityFlags(new Date('2026-09-01T13:30:00Z')); // Tuesday
        expect(flags.lines.some(l => l.includes('Pre-open caution'))).toBe(true);
    });
});

describe('stopVsAtrCheck', () => {
    it('stop distance under 0.5×ATR is too-tight', () => {
        // flatSeries ATR = 2 → 0.5×ATR = 1; a 0.5 stop distance is noise-tight
        const r = stopVsAtrCheck(100, 99.5, flatSeries(20));
        expect(r!.verdict).toBe('too-tight');
        expect(r!.stopAtr).toBeCloseTo(0.25);
    });

    it('a 1–4×ATR stop is ok', () => {
        const r = stopVsAtrCheck(100, 96, flatSeries(20)); // 4 distance / 2 ATR = 2
        expect(r!.verdict).toBe('ok');
    });

    it('stop distance over 4×ATR is too-wide', () => {
        const r = stopVsAtrCheck(100, 90, flatSeries(20)); // 10 / 2 = 5
        expect(r!.verdict).toBe('too-wide');
    });

    it('missing entry or SL → null', () => {
        expect(stopVsAtrCheck(undefined, 95, flatSeries(20))).toBeNull();
        expect(stopVsAtrCheck(100, undefined, flatSeries(20))).toBeNull();
    });
});

describe('buildSmcStructureRead + formatSmcStructureBlock', () => {
    it('aggregates every detector into one read', () => {
        const read = buildSmcStructureRead({
            klines1h: flatSeries(60),
            klines4h: flatSeries(60),
            currentPrice: 100,
            dolLevels: [
                { label: 'PWH', price: 102, tested: false },
                { label: 'PWL', price: 97, tested: false },
            ],
            now: new Date('2026-09-02T10:00:00Z'), // quiet Wednesday
        });
        expect(read.equalLevels).toBeDefined();
        expect(read.fvg).toEqual([]);
        expect(read.premiumDiscount).not.toBeNull();
        expect(read.dolTargets.map(t => t.label)).toEqual(['PWH', 'PWL']);
        expect(read.cvd).not.toBeNull(); // synthetic candles carry takerBuyVolume
        expect(read.seasonality.lines).toEqual([]);
    });

    it('the snapshot block always renders the section, with honest empty reads', () => {
        const block = formatSmcStructureBlock(buildSmcStructureRead({
            klines1h: flatSeries(60),
            klines4h: flatSeries(60),
            currentPrice: 100,
            dolLevels: [],
            now: new Date('2026-09-02T10:00:00Z'),
        }), 100);
        expect(block).toContain('### SMC structure');
        expect(block).toContain('no equal highs/lows');
        expect(block).toContain('FVG: none open');
        expect(block).toContain('no displacement-confirmed OB');
        expect(block).toContain('no untested period levels');
        // CVD line present on synthetic data (takerBuyVolume everywhere)
        expect(block).toContain('Session CVD');
    });

    it('active reads render their levels', () => {
        // Coherent bullish story: gap up at 56-58, then hold the high —
        // current price 112 sits at the top of the move.
        const ks1h = flatSeries(60);
        ks1h[56] = candle(56, { open: 102, high: 104, low: 100, close: 103 });
        ks1h[57] = candle(57, { open: 104, high: 112, low: 104, close: 111 });
        ks1h[58] = candle(58, { open: 111, high: 113, low: 108, close: 112 });
        ks1h[59] = candle(59, { open: 112, high: 113.5, low: 110, close: 112.5 }); // forming, dropped
        const block = formatSmcStructureBlock(buildSmcStructureRead({
            klines1h: ks1h,
            klines4h: flatSeries(60),
            currentPrice: 112,
            dolLevels: [{ label: 'PWH', price: 115, tested: false }],
            now: new Date('2026-08-29T12:00:00Z'), // Saturday → weekend flag
        }), 112);
        expect(block).toContain('BISI FVG');
        expect(block).toContain('not a magnet'); // the mandatory caveat
        expect(block).toContain('Weekend chop');
        expect(block).toContain('Draw on liquidity');
    });
});
