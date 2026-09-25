/**
 * Wave-2 financial/math regressions for TechnicalAnalysisService
 * (deep-dive 2026-09-15, items 1–5):
 *  1. OBV trend labels must be sign-safe (negative baselines inverted them)
 *  2. Stochastic K = 0 (genuine max oversold) must survive as 0, not 50
 *  3. Ichimoku priceVsCloud must compare against the cloud FORMED 26 bars
 *     ago (the cloud overlaid on today's price), not the forward-projected one
 *  4. "Daily" pivot points must aggregate a completed UTC session, and admit
 *     the tf-relative fallback honestly
 *  5. VWAP bands: session-anchor when a day boundary exists, volume-weight
 *     the std deviation, and label the anchor
 */

import { describe, it, expect } from 'vitest';
import {
    calculateAdvancedVolume,
    calculateKeyLevels,
    calculateIndicators,
    calculateIchimoku,
    calculatePivotPoints,
    calculateVWAP,
} from '../services/analysis/TechnicalAnalysisService';
import type { Kline } from '../services/analysis/MarketDataService';

const DAY = 86_400_000;
const MIN15 = 900_000;
const BASE = Date.UTC(2026, 8, 1); // a ms epoch on a day boundary

const kl = (time: number, open: number, high: number, low: number, close: number, volume: number): Kline =>
    ({ time, open, high, low, close, volume });

// =============================================================================
// 1 — OBV sign-safe trend labels
// =============================================================================

describe('calculateAdvancedVolume — OBV trend is sign-safe (item 1)', () => {
    it('does not label a falling negative OBV series as "rising"', () => {
        // Craft OBV so the last-10 window runs from −1000 to −1020: a series
        // FALLING in value. The old `last > first * 1.05` test read
        // −1020 > −1050 as TRUE and called it "rising".
        // Bar 0 seeds OBV = +volume; then engineer the rest.
        let ti = 0;
        const at = (...v: [number, number, number, number, number]): Kline =>
            kl(BASE + (++ti) * MIN15, v[0], v[1], v[2], v[3], v[4]);
        const bars: Kline[] = [
            at(100, 101, 99, 100.5, 200),                                   // obv = 200
            at(100, 100, 98, 98.5, 1200),                                   // down → obv = −1000
            ...Array.from({ length: 8 }, () => at(98.5, 99, 98, 98.5, 10)), // equal closes → OBV frozen
            at(98.5, 98.6, 97, 97.1, 20),                                   // down → obv = −1020
        ];
        const av = calculateAdvancedVolume(bars);
        expect(av.obvTrend).not.toBe('rising');
        expect(av.obvTrend).toBe('flat'); // −20 delta inside the ±5% magnitude deadband
    });

    it('labels a real rise out of negative territory as "rising"', () => {
        let ti = 0;
        const at = (...v: [number, number, number, number, number]): Kline =>
            kl(BASE + (++ti) * MIN15, v[0], v[1], v[2], v[3], v[4]);
        const bars: Kline[] = [
            at(100, 101, 99, 100.5, 200),                                   // obv = 200
            at(100, 100, 98, 98.5, 2200),                                   // obv = −2000
            ...Array.from({ length: 9 }, (_, i) => at(98.5, 100, 98.4, 99.4 + i * 0.2, 300)), // +300×9 → −2000…+700
        ];
        const av = calculateAdvancedVolume(bars);
        expect(av.obvTrend).toBe('rising');
    });
});

// =============================================================================
// 2 — Stochastic K = 0 stays oversold
// =============================================================================

describe('calculateIndicators — stochastic ?? fallback (item 2)', () => {
    it('keeps a genuine K = 0 (maximum oversold) instead of rewriting it to 50', () => {
        // Sustained downtrend: every bar closes at the 14-period low → K = 0.
        const bars: Kline[] = [];
        for (let i = 0; i < 30; i++) {
            const close = 99.5 - i * 0.5;
            bars.push(kl(BASE + i * MIN15, close + 0.5, close + 1, close, close, 100));
        }
        const ind = calculateIndicators(bars);
        expect(ind.stochastic.k).toBe(0);
        expect(ind.rsiTrend).toBe('oversold'); // sanity: the window IS oversold
    });
});

// =============================================================================
// 3 — Ichimoku historical (current-position) cloud
// =============================================================================

describe('calculateIchimoku — priceVsCloud has no look-ahead (item 3)', () => {
    it('compares today\'s close against the cloud formed 26 bars ago', () => {
        // Design: 60 bars. Bars 0..33 sit in a low 68–72 range (the cloud
        // FORMED there ≈ 70). Bars 34..36 spike to 200+ and bars 37..59
        // fade to 80. Today's price (80) is ABOVE the historical cloud (70)
        // but BELOW the forward-projected cloud (~117–139) the old code used.
        const bars: Kline[] = [];
        for (let i = 0; i < 34; i++) bars.push(kl(BASE + i * MIN15, 70, 72, 68, 70, 100));
        for (let i = 34; i <= 36; i++) bars.push(kl(BASE + i * MIN15, 150, 210, 150, 200, 100));
        for (let i = 37; i < 60; i++) {
            const c = 200 - (i - 36) * 8; // fade to 80 by bar 51... clamp below
            const close = Math.max(80, c);
            bars.push(kl(BASE + i * MIN15, close + 4, close + 5, close - 1, close, 100));
        }
        const ichi = calculateIchimoku(bars);
        // Historical cloud (bars formed ≤ index 33) ≈ 70:
        expect(ichi.cloudTop).toBeLessThan(85);
        expect(ichi.priceVsCloud).toBe('above');
        // Forward spans are still reported (they are the plotted-ahead values)
        // and they sit far above price — the old comparison used those and
        // returned 'below'.
        expect((ichi.senkouSpanA + ichi.senkouSpanB) / 2).toBeGreaterThan(ichi.cloudTop);
    });
});

// =============================================================================
// 4 — Daily pivot points from intraday bars
// =============================================================================

describe('calculatePivotPoints — session aggregation (item 4)', () => {

    it('aggregates daily HLC from intraday bars across a day boundary', () => {
        const bars: Kline[] = [];
        // Day 1 (completed session): 96 fifteen-minute bars. Highs peak at
        // 110, lows at 90, the session CLOSES at 95.
        for (let i = 0; i < 96; i++) {
            bars.push(kl(BASE + i * MIN15, 100, 102, 98, 100, 10));
        }
        bars[10] = kl(BASE + 10 * MIN15, 100, 110, 98, 100, 10);    // day-1 high
        bars[20] = kl(BASE + 20 * MIN15, 100, 102, 90, 100, 10);    // day-1 low
        bars[95] = kl(BASE + 95 * MIN15, 100, 101, 95, 95, 10);     // day-1 closing bar (23:45)
        // Day 2 partial: 10 bars around 105 — irrelevant to the pivots.
        for (let i = 96; i < 106; i++) {
            bars.push(kl(BASE + i * MIN15, 105, 106, 104, 105, 10));
        }
        const pp = calculatePivotPoints(bars);
        expect(pp.scope).toBe('daily');
        // Classic floor-trader math on the completed day: H=110, L=90, C=95.
        expect(pp.pp).toBeCloseTo((110 + 90 + 95) / 3, 1);
        expect(pp.r1).toBeCloseTo(2 * ((110 + 90 + 95) / 3) - 90, 1);
        // The old code would have used ONE 15-min bar (H=106, L=104, C=105)
        // — pivots ~105 with a ±2 range. The aggregated daily range is 20.
        expect(pp.r1 - pp.s1).toBeGreaterThan(15);
    });

    it('falls back honestly to tf-relative scope when no day boundary exists', () => {
        const bars: Kline[] = [];
        for (let i = 0; i < 30; i++) {
            bars.push(kl(BASE + i * MIN15, 100, 102, 98, 100, 10)); // all within ONE UTC day
        }
        bars[3].high = 120; bars[4].low = 80;
        const pp = calculatePivotPoints(bars);
        expect(pp.scope).toBe('tf-relative');
        // Aggregates all completed bars (not one bar): the range reflects 80–120.
        expect(pp.pp).toBeCloseTo((120 + 80 + 100) / 3, 0);
    });

    it('labels tf-relative (not daily) when timestamps are unusable', () => {
        const bars: Kline[] = [];
        for (let i = 0; i < 20; i++) bars.push(kl(0, 100, 105, 95, 100, 10)); // time=0 → invalid
        const pp = calculatePivotPoints(bars);
        expect(pp.scope).toBe('tf-relative');
    });

    it('survives an empty window', () => {
        const pp = calculatePivotPoints([]);
        expect(pp.pp).toBe(0);
        expect(pp.scope).toBe('tf-relative');
    });
});

// =============================================================================
// 5 — VWAP session anchoring + weighted deviation
// =============================================================================

describe('calculateVWAP — session anchor (item 5)', () => {

    it('restarts the VWAP at the day boundary and labels the anchor', () => {
        const bars: Kline[] = [];
        // Day 1: price ~10. Day 2 (current session): price ~100.
        for (let i = 0; i < 20; i++) {
            bars.push(kl(BASE + i * MIN15, 10, 10.1, 9.9, 10, 100));
        }
        for (let i = 20; i < 40; i++) {
            const day2 = i - 20; // ≥ 24h later
            bars.push(kl(BASE + DAY + day2 * MIN15, 100, 100.1, 99.9, 100, 100));
        }
        const v = calculateVWAP(bars);
        expect(v.anchor).toBe('session');
        // A window VWAP would sit between 10 and 100 (~55); the session-
        // anchored VWAP must reflect ONLY the current day.
        expect(v.vwap).toBeGreaterThan(99);
        expect(v.vwap).toBeLessThan(101);
    });

    it('labels "window" when no day boundary is present', () => {
        const bars: Kline[] = [];
        for (let i = 0; i < 20; i++) bars.push(kl(BASE + i * MIN15, 100, 101, 99, 100, 100));
        const v = calculateVWAP(bars);
        expect(v.anchor).toBe('window');
    });

    it('weights the std deviation by volume (bands are labeled +/− std dev)', () => {
        // Two quiet typical prices at volume 1 and one far typical price at
        // volume 18. Volume-weighted variance ≈ 4490 → std ≈ 67.0;
        // the old unweighted std over typical prices would be ≈ 43.4.
        const bars: Kline[] = [
            kl(BASE, 10, 10, 10, 10, 1),
            kl(BASE + MIN15, 10, 10, 10, 10, 1),
            kl(BASE + 2 * MIN15, 100, 100, 100, 100, 18),
        ];
        const v = calculateVWAP(bars);
        expect(v.vwap).toBeCloseTo((10 + 10 + 1800) / 20, 5); // 91
        // Volume-weighted std: sqrt((2·81² + 18·9²)/20) ≈ sqrt((13122+1458)/20)= sqrt(729) = 27
        // (recompute: tp−vwap: 10−91 = −81; 100−91 = 9 → (1·6561+1·6561+18·81)/20 = (13122+1458)/20 = 729 → 27)
        expect(v.upperBand1).toBeCloseTo(91 + 27, 0);
        // The old unweighted std: sqrt((81²+81²+9²)/3) = sqrt((6561+6561+81)/3)=sqrt(4401)≈66.3 — clearly different.
        expect(v.upperBand1).not.toBeCloseTo(91 + 66.3, 0);
    });
});

/**
 * Sub-$1 price precision. The live symbol picker returns 527 futures, plenty
 * of them under a dollar, and a fixed 2dp collapsed all of their price-scale
 * values onto the same number: a 0.012 coin reported EMA20 = 0.01, a Bollinger
 * band with upper = middle = lower, and three genuinely distinct swing lows as
 * three identical "support" levels — which reads as three independent pieces
 * of evidence when it is one number printed three times.
 */
describe('sub-$1 price precision', () => {
    const cheapSeries = (base: number, n = 60) => Array.from({ length: n }, (_, i) => {
        const drift = Math.sin(i / 5) * base * 0.05;
        const c = base + drift;
        return { time: 1_700_000_000_000 + i * 60_000, open: c, high: c * 1.002, low: c * 0.998, close: c, volume: 1000 };
    });

    it('does not flatten indicators on a 0.012 coin', () => {
        const ind = calculateIndicators(cheapSeries(0.012) as never);
        expect(ind.currentPrice).toBeGreaterThan(0.01);
        expect(ind.currentPrice).toBeLessThan(0.02);
        // The bug: a 2dp round sent every one of these to 0.01.
        expect(ind.ema.ema20).toBeGreaterThan(0);
        expect(Number(ind.ema.ema20.toFixed(4))).toBeGreaterThan(0);
        // Bollinger upper/middle/lower must not all be the same number.
        const { upper, middle, lower } = ind.bollingerBands;
        expect(new Set([upper, middle, lower]).size).toBeGreaterThan(1);
        expect(upper).toBeGreaterThan(middle);
        expect(middle).toBeGreaterThan(lower);
    });

    it('keeps large prices byte-identical to the old 2dp behaviour', () => {
        // The ratchet must not move the top of the market: 4 significant
        // digits with a 2dp floor means a BTC-sized price rounds as before.
        const ind = calculateIndicators(cheapSeries(84_000) as never);
        expect(ind.currentPrice).toBe(Math.round(ind.currentPrice * 100) / 100);
        expect(ind.ema.ema20).toBe(Math.round(ind.ema.ema20 * 100) / 100);
    });

    it('keeps three distinct swing lows distinct', () => {
        // An explicit zigzag whose three troughs sit at clearly different
        // prices, all below the last close. A 2dp round printed all three as
        // 0.01, so the ladder showed three identical "support" rows — three
        // pieces of apparent evidence that are one number printed three times.
        const lows = [0.0100, 0.0107, 0.0114];
        const bars = [];
        let k = 0;
        for (let i = 0; i < 24; i++) {
            const isTrough = i % 4 === 1;
            const low = isTrough ? lows[k++ % 3] : 0.0129;
            const close = isTrough ? 0.0122 : 0.0131;
            bars.push({
                time: 1_700_000_000_000 + i * 60_000,
                open: close, high: 0.0136, low, close, volume: 10,
            });
        }
        const { support } = calculateKeyLevels(bars as never);
        // Three distinct trough prices, all well under the 0.0131 close.
        expect(new Set(support).size).toBeGreaterThan(1);
        expect(support.every(v => v !== 0.01)).toBe(true);
    });
});
