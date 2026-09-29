import { describe, it, expect } from 'vitest';
import { detectChartPatterns, patternStatus } from '../utils/patternDetection';
import { Kline } from '../types';

/**
 * The swing-geometry layer and the three-touch rule.
 *
 * History: `detectChartPatterns` had run only behind the LiveMarket panel, so
 * the debate seats reasoned about structure from eight printed OHLC rows while
 * a finished triangle detector sat one import away. Its `confidence` numbers
 * are hand-set constants, so the honest confidence signal is how many pivot
 * extremes the shape rests on — two pivots define a line, a third touch is
 * what says the market respects it.
 *
 * Every series here is built from named pivots, so a detector that stopped
 * finding them (or started finding shapes that are not there) fails the test
 * rather than quietly returning [].
 */

const SEG = 16;

/** Candles following the polyline through `anchors`, one pivot extreme per
 *  anchor. `SEG` bars per leg keeps every interior anchor a valid pivot under
 *  findPivots' 5-left / 3-right window, and keeps neighbouring highs and lows
 *  strictly separated so only the anchor itself can be flagged. `legs`
 *  overrides individual leg lengths — the double-top detector only counts a
 *  pattern that resolved within 15 bars of the last touch, so its closing leg
 *  has to be short. */
const throughPivots = (anchors: number[], legs?: number[]): Kline[] => {
    const prices: number[] = [];
    for (let a = 0; a < anchors.length - 1; a++) {
        const from = anchors[a];
        const to = anchors[a + 1];
        const leg = legs?.[a] ?? SEG;
        for (let s = 0; s < leg; s++) prices.push(from + (to - from) * (s / leg));
    }
    prices.push(anchors[anchors.length - 1]);
    return prices.map((p, i) => ({
        time: i,
        open: prices[Math.max(0, i - 1)],
        high: p + 0.1,
        low: p - 0.1,
        close: p,
        volume: 10,
    }));
};

/** Two equal highs 32 bars apart, then a short drop: a textbook double top,
 *  and exactly two pivots to draw it from. */
const DOUBLE_TOP = throughPivots([100, 130, 110, 130.5, 128], [SEG, SEG, SEG, 6]);
/** Lower highs 150/140/133 against higher lows 110/120/126: a symmetrical
 *  triangle. Its top line is reached only AT its defining pivots — price
 *  dives well below it between them — so the honest count is two, and the
 *  shape is an ASSUMPTION. (The old comment here claimed "three touches on
 *  each edge"; that was the hard-coded literal, not the geometry.) */
const COILING = throughPivots([100, 150, 110, 140, 120, 133, 126, 131]);
/** A flat 150 ceiling revisited three times over rising lows 120/130/140: the
 *  flat edge is genuinely touched three times, so this one MEASURES as
 *  confirmed.
 *
 *  The trailing 145 leg is load-bearing, not decoration. findPivots ignores the
 *  first `leftBars` and last `rightBars` bars, so a zigzag's opening low and
 *  closing low are never pivots — a seven-anchor shape yields EITHER three
 *  interior highs and two lows, or the reverse, and never both, so the
 *  triangle branch (which needs three of each) would not run at all. The
 *  eighth anchor moves the counts into the interior. Without a fixture like
 *  this the "confirmed" branch had no coverage once counts became
 *  measurements. */
const RESISTED = throughPivots([110, 150, 120, 150, 130, 150, 140, 145]);

describe('detectChartPatterns — geometry', () => {
    it('finds the double top across two equal swing highs', () => {
        const names = detectChartPatterns(DOUBLE_TOP).map(p => p.name);
        expect(names).toContain('Double Top');
    });

    it('finds the symmetrical triangle in converging swings, and only that', () => {
        const found = detectChartPatterns(COILING);
        expect(found.map(p => p.name)).toEqual(['Symmetrical Triangle']);
    });

    it('refuses to read geometry from a window too short to hold pivots', () => {
        // The detector needs 50 bars: 5-left/3-right pivots plus enough swing
        // points to call a shape. An empty result here means "not looked at",
        // which is why the caller feeds it the full fetched history.
        expect(detectChartPatterns(throughPivots([100, 130, 110, 130.5, 128]).slice(0, 49)))
            .toEqual([]);
    });
});

describe('the three-touch rule', () => {
    it('counts the pivots each shape actually rests on', () => {
        const doubleTop = detectChartPatterns(DOUBLE_TOP).find(p => p.name === 'Double Top');
        const triangle = detectChartPatterns(COILING).find(p => p.name === 'Symmetrical Triangle');
        expect(doubleTop?.touches).toBe(2);
        // MEASURED, and the answer is two. Between its defining pivots the
        // coiling price sits far below the top line, so the line was only ever
        // reached twice. This test used to expect 3 — which was possible only
        // because every branch returned the literal 3 the moment the shape
        // matched, and so could never have told the two cases apart.
        expect(triangle?.touches).toBe(2);
        // A line the market really did defend three times measures three.
        const resisted = detectChartPatterns(RESISTED).find(p => p.name === 'Ascending Triangle');
        expect(resisted?.touches).toBe(3);
    });

    it('labels a two-touch line an assumption and a three-touch line confirmed', () => {
        const [doubleTop] = detectChartPatterns(DOUBLE_TOP);
        const [coiling] = detectChartPatterns(COILING);
        const [resisted] = detectChartPatterns(RESISTED);
        // The discrimination is the point: confidence is hand-set, so a 0.8
        // double top would otherwise outrank a shape that was actually
        // touched a third time. Both of these are now MEASURED counts, so the
        // two cases below are genuinely different geometry rather than two
        // literals that happened to differ.
        expect(patternStatus(doubleTop)).toBe('assumption');
        // The coiling triangle's top line is reached only at its own pivots,
        // so it is an ASSUMPTION — it used to be reported "confirmed" on the
        // strength of a literal.
        expect(patternStatus(coiling)).toBe('assumption');
        expect(patternStatus(resisted)).toBe('confirmed');
    });

    it('does not call a shape confirmed by its own confidence number', () => {
        // Guards against the label being derived from `confidence` — the 0.8
        // double top is the case where the two disagree.
        const [doubleTop] = detectChartPatterns(DOUBLE_TOP);
        expect(doubleTop.confidence).toBeGreaterThan(0.7);
        expect(patternStatus(doubleTop)).toBe('assumption');
    });

    it('carries the anchors the shape rests on, in data space', () => {
        // The model could not draw a structure the code had already found,
        // because the pivots were computed and then thrown away into a
        // formatted sentence.
        const [doubleTop] = detectChartPatterns(DOUBLE_TOP);
        expect(doubleTop.anchors?.length).toBe(2);
        for (const a of doubleTop.anchors ?? []) {
            expect(Number.isFinite(a.price)).toBe(true);
            expect(Number.isFinite(a.index)).toBe(true);
            // A time is what makes the anchor placeable without guessing which
            // bar it was.
            expect(Number.isFinite(a.time)).toBe(true);
        }
        const [resisted] = detectChartPatterns(RESISTED);
        expect(resisted.anchors?.length).toBeGreaterThanOrEqual(6);
    });
});
