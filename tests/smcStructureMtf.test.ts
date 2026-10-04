import { describe, it, expect } from 'vitest';

// MTF premium/discount + sweep→reversal confirmation. Both are pinned against
// hand-countable ranges so the arithmetic, not just the shape, is on the hook.

import {
    detectSweepReversals,
    formatMtfPremiumDiscountLine,
    formatSmcStructureBlock,
    premiumDiscountAcross,
    buildSmcStructureRead,
} from '../utils/smcStructure';
import { Kline } from '../types';

const bar = (i: number, o: Partial<Kline> = {}): Kline => ({
    time: 1_700_000_000_000 + i * 3_600_000,
    open: 105, high: 110, low: 100, close: 105, volume: 100,
    ...o,
});

/** `n` candles inside [low,high], plus the forming candle the detectors drop. */
const rangeSeries = (n: number, low: number, high: number, lastClose = 105): Kline[] =>
    Array.from({ length: n }, (_, i) => bar(i, { low, high, close: i === n - 1 ? lastClose : (low + high) / 2 }))
        // one extra candle at the tail: every detector here treats the last
        // element as the forming candle and slices it off.
        .concat([bar(n, { low, high, close: lastClose })]);

describe('premiumDiscountAcross', () => {
    // price 118 against four deliberately different ranges.
    const entries = [
        { timeframe: '15m', klines: rangeSeries(13, 100, 120, 118) },   // 90% up → premium
        { timeframe: '1h', klines: rangeSeries(13, 110, 130, 118) },   // 40% up → equilibrium
        { timeframe: '4h', klines: rangeSeries(13, 110, 150, 118) },   // 20% up → discount
        { timeframe: '1d', klines: rangeSeries(13, 90, 130, 118) },    // 70% up → premium
    ];

    it('measures each frame on its own range and buckets them', () => {
        const r = premiumDiscountAcross(entries, { currentPrice: 118 });
        expect(r.rows.map(x => x.timeframe)).toEqual(['15m', '1h', '4h', '1d']);
        expect(r.rows.map(x => Number(x.pd.positionPct.toFixed(0)))).toEqual([90, 40, 20, 70]);
        expect(r.rows.map(x => x.pd.zone)).toEqual(['premium', 'equilibrium', 'discount', 'premium']);
        expect(r.premium).toEqual(['15m', '1d']);
        expect(r.discount).toEqual(['4h']);
        expect(r.equilibrium).toEqual(['1h']);
        expect(r.consensus).toBe('mixed');
        // (90+40+20+70)/4 — the mean is over POSITION, not over zones.
        expect(r.averagePositionPct).toBeCloseTo(55, 10);
    });

    it('the 40% and 60% boundaries are strict, so a frame ON them reads equilibrium', () => {
        // Range 110–130, so position % = (price − 110)/20 × 100.
        const zone = (price: number): string => premiumDiscountAcross(
            [{ timeframe: 'x', klines: rangeSeries(13, 110, 130) }], { currentPrice: price },
        ).rows[0].pd.zone;

        expect(zone(118)).toBe('equilibrium');    // exactly 40%
        expect(zone(122)).toBe('equilibrium');    // exactly 60%
        expect(zone(117.9)).toBe('discount');     // 39.5%
        expect(zone(122.1)).toBe('premium');      // 60.5%
    });

    it('names a unanimous frame set, which is the whole point of asking four', () => {
        const allPremium = premiumDiscountAcross(
            entries.map(e => ({ timeframe: e.timeframe, klines: rangeSeries(13, 100, 110, 109) })),
            { currentPrice: 109 },
        );
        expect(allPremium.consensus).toBe('all-premium');
        // range 100–110, price 109 → 90% up each — every frame premium.
        expect(allPremium.premium).toHaveLength(4);
    });

    it('flags the frames price has actually left, which a zone cannot show', () => {
        const r = premiumDiscountAcross(
            [{ timeframe: '15m', klines: rangeSeries(13, 100, 110, 105) }],
            { currentPrice: 120 },
        );
        expect(r.rows[0].pd.positionPct).toBeCloseTo(200, 10);
        expect(r.outside).toEqual(['15m']);
        expect(r.consensus).toBe('all-premium');
    });

    it('honours lookback — an old spike outside the window must not widen the range', () => {
        const ks = [bar(0, { high: 500, low: 100, close: 110 }),
            ...Array.from({ length: 11 }, (_, i) => bar(i + 1, { high: 110, low: 100, close: 105 })),
            bar(12, { high: 118, low: 100, close: 118 })];
        // Wide window: the 500 wick dominates, so 118 looks like a bottom.
        expect(premiumDiscountAcross([{ timeframe: '1h', klines: ks }], { currentPrice: 118 })
            .rows[0].pd.zone).toBe('discount');
        // Tight window: only the last 10 completed bars count → 118 is ABOVE the range.
        const tight = premiumDiscountAcross([{ timeframe: '1h', klines: ks }], { currentPrice: 118, lookback: 10 });
        expect(tight.rows[0].pd.rangeHigh).toBe(110);
        expect(tight.rows[0].pd.zone).toBe('premium');
        expect(tight.outside).toEqual(['1h']);
    });

    it('frames it cannot measure are dropped, not zeroed', () => {
        const r = premiumDiscountAcross([
            { timeframe: 'short', klines: rangeSeries(4, 100, 110) },
            { timeframe: 'ok', klines: rangeSeries(13, 100, 120, 118) },
        ], { currentPrice: 118 });
        expect(r.rows.map(x => x.timeframe)).toEqual(['ok']);
        expect(r.consensus).toBe('all-premium');
        expect(premiumDiscountAcross([]).consensus).toBe('none');
        expect(premiumDiscountAcross([]).averagePositionPct).toBe(null);
    });

    it('says what it means in the packet', () => {
        const line = formatMtfPremiumDiscountLine(premiumDiscountAcross(entries, { currentPrice: 118 }));
        expect(line).toContain('15m 90% PREMIUM');
        expect(line).toContain('1h 40% EQ');
        expect(line).toContain('4h 20% DISCOUNT');
        expect(line).toContain('MIXED (2 premium / 1 discount / 1 eq)');
        expect(formatMtfPremiumDiscountLine(premiumDiscountAcross([])))
            .toContain('no frame had a measurable dealing range');
    });
});

/** Six completed candles + the forming one the detector drops. */
const sweepWindow = (extra: Kline[] = []): Kline[] => ([
    bar(0, { open: 94, high: 95, low: 90, close: 94 }),
    bar(1, { open: 94, high: 95, low: 92, close: 94 }),
    bar(2, { open: 93, high: 95, low: 91, close: 93 }),
    bar(3, { open: 95, high: 96, low: 93, close: 95 }),
    // Sweep: takes the 100 level to 104 and closes back under it at 97.
    bar(4, { open: 96, high: 104, low: 96, close: 97 }),
    // Break: closes under the frozen structure line (91) on a 7-point body.
    bar(5, { open: 95, high: 96, low: 88, close: 88 }),
    ...extra,
    bar(6 + extra.length, { open: 88, high: 89, low: 87, close: 88 }),
]);

const OPTS = { atr: 10, minDisplacementAtr: 0.2, structureLookback: 3, scanBars: 50 } as const;

describe('detectSweepReversals — the confirmed path', () => {
    it('takes the level, reclaims it, breaks structure → one confirmed zone', () => {
        const r = detectSweepReversals(sweepWindow(), [{ price: 100, label: 'EQH ×2' }], OPTS);
        expect(r).toHaveLength(1);
        const s = r[0];
        expect(s.side).toBe('bearish');
        expect(s.status).toBe('confirmed');
        expect(s.level).toBe(100);
        expect(s.extreme).toBe(104);
        expect(s.sweepIndex).toBe(4);
        expect(s.confirmIndex).toBe(5);
        expect(s.barsElapsed).toBe(2);
        expect(s.zone).toEqual({ top: 104, bottom: 100 });
        expect(s.text).toContain('BEARISH sweep-reversal');
        expect(s.text).toContain('reversal zone $100.00–$104.00');
        expect(s.text).toContain('invalid beyond $104.00');
    });

    it('freezes the structure line from the bars BEFORE the sweep, never the sweep bar', () => {
        // The sweep candle here prints the window low itself (88). If the
        // confirmation level were measured through the tested bar the goalpost
        // would move onto it and nothing could ever break it.
        const ks = sweepWindow().slice(0, 5);
        ks[4] = bar(4, { open: 96, high: 104, low: 88, close: 87 });
        ks.push(bar(5, { open: 87, high: 88, low: 86, close: 87 }));
        const r = detectSweepReversals(ks, [{ price: 100, label: 'EQH ×2' }], OPTS);
        expect(r[0].confirmationLevel).toBe(91);   // min low of bars 1..3
        expect(r[0].status).toBe('confirmed');
        expect(r[0].confirmIndex).toBe(4);         // same bar as the sweep
        expect(r[0].barsElapsed).toBe(1);
    });

    it('mirrors for a sellside sweep', () => {
        const ks = [
            bar(0, { open: 94, high: 96, low: 92, close: 94 }),
            bar(1, { open: 94, high: 97, low: 93, close: 94 }),
            bar(2, { open: 94, high: 95, low: 93, close: 94 }),
            bar(3, { open: 94, high: 96, low: 94, close: 95 }),
            // Takes the 90 low down to 85 and closes back above it.
            bar(4, { open: 92, high: 93, low: 85, close: 91 }),
            // Closes above the frozen structure line (97 = max high of 1..3).
            bar(5, { open: 92, high: 101, low: 92, close: 100 }),
            bar(6, { open: 100, high: 101, low: 99, close: 100 }),
        ];
        const r = detectSweepReversals(ks, [{ price: 90, label: 'EQL ×2' }], OPTS);
        expect(r[0].side).toBe('bullish');
        expect(r[0].confirmationLevel).toBe(97);
        expect(r[0].extreme).toBe(85);
        expect(r[0].zone).toEqual({ top: 90, bottom: 85 });
        expect(r[0].text).toContain('BULLISH sweep-reversal');
    });
});

describe('detectSweepReversals — thresholds and non-signals', () => {
    it('a level the bars never traded up to is not a sellside sweep — the candidate must start from it', () => {
        // Every low here sits under 100, so an unanchored `low <= level` test
        // would read a sweep of the $100 pool on candles that never went near
        // it. The open must be on the level's far side.
        const ks = [
            bar(0, { open: 94, high: 95, low: 90, close: 94 }),
            bar(1, { open: 94, high: 96, low: 92, close: 94 }),
            bar(2, { open: 94, high: 95, low: 91, close: 93 }),
            bar(3, { open: 93, high: 95, low: 90, close: 92 }),
            bar(4, { open: 92, high: 93, low: 89, close: 90 }),
            bar(5, { open: 90, high: 91, low: 88, close: 89 }),
            bar(6, { open: 89, high: 90, low: 88, close: 89 }),
        ];
        expect(detectSweepReversals(ks, [{ price: 100, label: 'EQH' }], OPTS)).toHaveLength(0);
    });

    it('minPenetrationAtr is in ATR units, so a 0.5×ATR filter rejects a 4-point wick on ATR 10', () => {
        const loose = detectSweepReversals(sweepWindow(), [{ price: 100, label: 'EQH' }], OPTS);
        const strict = detectSweepReversals(
            sweepWindow(), [{ price: 100, label: 'EQH' }], { ...OPTS, minPenetrationAtr: 0.5 });
        expect(loose).toHaveLength(1);
        expect(strict).toHaveLength(0);   // 104 < 100 + 5
    });

    it('a sweep that is never reclaimed stays developing and says which half is missing', () => {
        const ks = [
            bar(0, { open: 94, high: 95, low: 90, close: 94 }),
            bar(1, { open: 94, high: 95, low: 92, close: 94 }),
            bar(2, { open: 93, high: 95, low: 91, close: 93 }),
            bar(3, { open: 95, high: 96, low: 93, close: 95 }),
            // Takes 100 and CLOSES ABOVE it — a break in the making, not a sweep.
            bar(4, { open: 96, high: 104, low: 96, close: 102 }),
            bar(5, { open: 102, high: 103, low: 101, close: 102 }),
            bar(6, { open: 102, high: 103, low: 101, close: 102 }),
        ];
        const r = detectSweepReversals(ks, [{ price: 100, label: 'EQH' }], OPTS);
        expect(r).toHaveLength(1);
        expect(r[0].status).toBe('developing');
        expect(r[0].reclaimed).toBe(false);
        expect(r[0].text).toContain('not reclaimed');
    });

    it('reclaimed but structure intact is developing on the other half', () => {
        const ks = sweepWindow([
            // Price comes back under 100 but never nears 91.
            bar(6, { open: 98, high: 99, low: 97, close: 97 }),
        ]);
        // Rebuild so the break bar does not exist: drop index 5.
        const noBreak = ks.filter((_, i) => i !== 5);
        const r = detectSweepReversals(noBreak, [{ price: 100, label: 'EQH' }], OPTS);
        expect(r[0].status).toBe('developing');
        expect(r[0].reclaimed).toBe(true);
        expect(r[0].structureBroken).toBe(false);
        expect(r[0].text).toContain('structure not broken');
    });

    it('a candidate older than maxBarsToConfirm is dropped, not reported as developing', () => {
        // Same sweep, then 4 bars that never break structure.
        const stale = [
            bar(0, { open: 94, high: 95, low: 90, close: 94 }),
            bar(1, { open: 94, high: 95, low: 92, close: 94 }),
            bar(2, { open: 93, high: 95, low: 91, close: 93 }),
            bar(3, { open: 95, high: 96, low: 93, close: 95 }),
            bar(4, { open: 96, high: 104, low: 96, close: 97 }),
            bar(5, { open: 97, high: 98, low: 95, close: 96 }),
            bar(6, { open: 96, high: 97, low: 94, close: 95 }),
            bar(7, { open: 95, high: 96, low: 93, close: 94 }),
            bar(8, { open: 94, high: 95, low: 92, close: 93 }),
            bar(9, { open: 93, high: 94, low: 91, close: 92 }),
        ];
        expect(detectSweepReversals(stale, [{ price: 100, label: 'EQH' }], { ...OPTS, maxBarsToConfirm: 2 })).toHaveLength(0);
        // With the patience to cover it, the very same window still develops.
        expect(detectSweepReversals(stale, [{ price: 100, label: 'EQH' }], { ...OPTS, maxBarsToConfirm: 20 }))
            .toHaveLength(1);
    });

    it('the confirming candle must have a body — a doji through structure is not displacement', () => {
        const ks = sweepWindow();
        ks[5] = bar(5, { open: 88, high: 96, low: 87, close: 88.5 });   // body 0.5 < 0.2×10
        const r = detectSweepReversals(ks, [{ price: 100, label: 'EQH' }], OPTS);
        expect(r[0].status).toBe('developing');
        expect(r[0].confirmIndex).toBe(null);
    });

    it('no volatility yardstick means no reads, not reads with the filter silently off', () => {
        expect(detectSweepReversals(sweepWindow(), [{ price: 100, label: 'EQH' }], { ...OPTS, atr: 0 }))
            .toHaveLength(0);
        expect(detectSweepReversals(sweepWindow(), [{ price: 100, label: 'EQH' }], { ...OPTS, atr: NaN }))
            .toHaveLength(0);
        // A 6-candle window cannot produce atr14 either.
        expect(detectSweepReversals(sweepWindow(), [{ price: 100, label: 'EQH' }])).toHaveLength(0);
    });

    it('is total on junk input', () => {
        expect(detectSweepReversals([], [{ price: 100, label: 'x' }], OPTS)).toEqual([]);
        expect(detectSweepReversals(sweepWindow(), [], OPTS)).toEqual([]);
        expect(detectSweepReversals(sweepWindow(), [{ price: 0, label: 'x' }, { price: NaN, label: 'y' }], OPTS)).toEqual([]);
        expect(detectSweepReversals(undefined as unknown as Kline[], [{ price: 100, label: 'x' }], OPTS)).toEqual([]);
        // A level far outside the window simply never sweeps.
        expect(detectSweepReversals(sweepWindow(), [{ price: 900, label: 'far' }], OPTS)).toEqual([]);
    });

    it('returns the newest candidate first and respects maxReads', () => {
        const two = sweepWindow([
            bar(6, { open: 88, high: 89, low: 87, close: 88 }),
            bar(7, { open: 88, high: 89, low: 87, close: 88 }),
            bar(8, { open: 88, high: 89, low: 87, close: 88 }),
            bar(9, { open: 88, high: 89, low: 87, close: 88 }),
        ]);
        const r = detectSweepReversals(
            two,
            [{ price: 100, label: 'EQH ×2' }, { price: 96, label: 'EQL ×2' }, { price: 104, label: 'PDH' }],
            { ...OPTS, maxReads: 1 },
        );
        expect(r).toHaveLength(1);
        expect(r[0].sweepIndex).toBeGreaterThanOrEqual(4);
    });
});

describe('the SMC read carries the reversal', () => {
    it('buildSmcStructureRead never throws on a window with no pools', () => {
        const klines = rangeSeries(30, 100, 110, 105);
        const read = buildSmcStructureRead({
            klines1h: klines,
            klines4h: klines,
            currentPrice: 105,
            dolLevels: [{ label: 'PDH', price: 110, tested: true }],
        });
        expect(Array.isArray(read.sweepReversals)).toBe(true);
        const block = formatSmcStructureBlock(read, 105);
        // The negative is stated, because a silent omission reads as a detector
        // that did not run.
        expect(block).toContain('Sweep reversals:');
        expect(block).toContain('none — no swept pool has reclaimed');
    });
});
