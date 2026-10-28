
import { Kline } from '../types';

export interface DetectedPattern {
    name: string;
    type: 'bullish' | 'bearish' | 'neutral';
    confidence: number; // 0 to 1
    description: string;
    significance: string;
    /** Measured touches on the line the pattern rests on — see
     *  countTouchesOnLine. MEASURED, not asserted. */
    touches: number;
    /**
     * The pivots this pattern rests on, in data space.
     *
     * These were always computed — findPivots returns {price, index} for every
     * swing — and then thrown away into a formatted sentence, so a "Head and
     * Shoulders" reached the model as the string "Shoulders at ~62150.00" with
     * no neckline, no time, and nothing a drawing could be built from. The
     * model could not draw a structure the code had already found.
     *
     * `time` is the bar's own timestamp in unix seconds, so an anchor can be
     * placed without the model guessing which bar it was.
     */
    anchors?: PatternAnchor[];
    /**
     * The line the pattern actually rests on — the two points whose touches
     * were counted. For a head-and-shoulders that is the neckline, for a
     * double top the resistance, for a triangle the flat edge.
     *
     * Separate from `anchors` because anchors are every pivot, and a triangle
     * groups them BY SIDE — joining its first anchor to its last would draw a
     * line from a high to a low that nobody described. This is the claim, and
     * it is what `draw_detected` draws.
     */
    line?: { a: PatternAnchor; b: PatternAnchor };
}

export interface PatternAnchor {
    price: number;
    /** Index into the kline array the pattern was detected on. */
    index: number;
    /** Unix seconds, from the kline. */
    time: number;
}

/**
 * How many times the market actually reached a line drawn between two pivots.
 *
 * The three-touch rule is a CLAIM about geometry, and it was previously a
 * literal: every branch hard-coded `touches: 3` (2 for double tops) the moment
 * the shape matched, so `patternStatus()` printed "confirmed" for a triangle
 * whose edges nobody counted. A confirmation that is not measured is worse than
 * no confirmation, because the packet then tells the model it is looking at a
 * confirmed setup.
 *
 * Counts distinct VISITS: price pinned to a level for twenty consecutive bars
 * is one touch, not twenty, so a run of bars is a single visit and a new one
 * requires the market to leave the line first. Bars only need to REACH the
 * line within `tolPct` — the market respecting a level rarely prints exactly
 * on it.
 *
 * Deliberately NOT smcStructure's `pool`: that counts clustered swing EXTREMES
 * (how many pivots share a level), which answers a different question. This
 * walks the candles against an arbitrary line, which is what a trendline or
 * neckline needs and what a pivot cluster cannot express.
 */
export const countTouchesOnLine = (
    klines: Kline[],
    a: { price: number; index: number },
    b: { price: number; index: number },
    tolPct: number,
    side: 'high' | 'low',
): number => {
    const i0 = Math.min(a.index, b.index);
    const i1 = Math.max(a.index, b.index);
    if (i1 <= i0) return 0;
    const anchored = a.index <= b.index ? a : b;
    const slope = (b.price - a.price) / (i1 - i0);
    const band = tolPct / 100;
    let touches = 0;
    // A touch is a VISIT, not a bar. Price pinned to a level for twenty bars
    // is the market respecting that level once; counting it twenty times would
    // make every flat ceiling "confirmed", which is the mirror image of the bug
    // this function exists to remove. A new visit needs the market to leave the
    // line first, so the state is the previous bar's verdict, not a bar gap.
    let inVisit = false;
    for (let i = i0; i <= i1; i++) {
        const k = klines[i];
        if (!k) continue;
        const linePrice = anchored.price + slope * (i - anchored.index);
        if (!Number.isFinite(linePrice) || linePrice <= 0) continue;
        const reaches = side === 'high'
            ? k.high >= linePrice * (1 - band)
            : k.low <= linePrice * (1 + band);
        if (!reaches) { inVisit = false; continue; }
        if (inVisit) continue;
        inVisit = true;
        touches++;
    }
    return touches;
};

/** Tolerance for "the market reached this line", in percent. */
const TOUCH_TOL_PCT = 0.35;

/** The anchors a pattern rests on, in the order they were detected. */
const anchorsOf = (klines: Kline[], pivots: { price: number; index: number }[]): PatternAnchor[] =>
    pivots
        .filter(p => klines[p.index] !== undefined)
        .map(p => ({ price: p.price, index: p.index, time: klines[p.index]!.time }));

/** One pivot as a drawable anchor. */
const anchorOf = (klines: Kline[], p: { price: number; index: number }): PatternAnchor =>
    ({ price: p.price, index: p.index, time: klines[p.index]?.time ?? 0 });

/**
 * The three-touch rule: two pivots define a line, but they do not *confirm*
 * one — a third touch is what separates a level the market respects from two
 * random wicks that happen to line up. Reported so a 2-touch reading can be
 * labeled an assumption instead of a setup.
 */
const TOUCHES_TO_CONFIRM = 3;

export const patternStatus = (pattern: DetectedPattern): 'confirmed' | 'assumption' =>
    pattern.touches >= TOUCHES_TO_CONFIRM ? 'confirmed' : 'assumption';

export interface KeyZones {
    support: number[];
    resistance: number[];
}

/** A swing the detector found, in data space. `index` is a bar offset into
 *  the array the detector was given, so it must be read against THAT array. */
export interface Pivot {
    price: number;
    index: number;
}

// Helper to find local pivots (highs and lows)
// A pivot high is a bar higher than 'n' bars to the left and 'n' bars to the right
//
// EXPORTED (was module-private) so a level the model names can be snapped onto
// the swing it was describing. The whole point of draw_detected was that a model
// restating a price from memory is a digit out; this extends the same idea to
// an arbitrary hline, and it needs the pivots the detector already computes
// instead of a second swing finder that would find different ones.
// Reads only .high and .low, so it takes that subset rather than a full Kline —
// which is what lets the chart snapshot's narrower candle shape feed it without
// a cast.
export const findPivots = (klines: readonly { high: number; low: number }[], leftBars: number = 5, rightBars: number = 2) => {
    const highs: Pivot[] = [];
    const lows: Pivot[] = [];

    for (let i = leftBars; i < klines.length - rightBars; i++) {
        const current = klines[i];
        
        // Check High
        let isHigh = true;
        for (let j = 1; j <= leftBars; j++) if (klines[i - j].high > current.high) isHigh = false;
        for (let j = 1; j <= rightBars; j++) if (klines[i + j].high > current.high) isHigh = false;
        if (isHigh) highs.push({ price: current.high, index: i });

        // Check Low
        let isLow = true;
        for (let j = 1; j <= leftBars; j++) if (klines[i - j].low < current.low) isLow = false;
        for (let j = 1; j <= rightBars; j++) if (klines[i + j].low < current.low) isLow = false;
        if (isLow) lows.push({ price: current.low, index: i });
    }
    return { highs, lows };
};

export const detectKeyZones = (klines: Kline[]): KeyZones => {
    const { highs, lows } = findPivots(klines, 10, 5); // Use wider pivots for zones
    const currentPrice = klines[klines.length - 1].close;
    
    // Cluster Logic: Group pivots that are close to each other (within 0.5%)
    const clusterLevels = (levels: number[]) => {
        if (levels.length === 0) return [];
        const sorted = levels.sort((a, b) => a - b);
        const clusters: number[] = [];
        let currentCluster: number[] = [sorted[0]];
        
        for (let i = 1; i < sorted.length; i++) {
            const prev = currentCluster[currentCluster.length - 1];
            const diff = (sorted[i] - prev) / prev;
            
            if (diff < 0.005) { // 0.5% tolerance
                currentCluster.push(sorted[i]);
            } else {
                // Push average of previous cluster
                const avg = currentCluster.reduce((a, b) => a + b, 0) / currentCluster.length;
                clusters.push(parseFloat(avg.toFixed(2)));
                currentCluster = [sorted[i]];
            }
        }
        // Push last cluster
        const avg = currentCluster.reduce((a, b) => a + b, 0) / currentCluster.length;
        clusters.push(parseFloat(avg.toFixed(2)));
        
        return clusters;
    };

    const resistanceRaw = highs.map(h => h.price).filter(p => p >= currentPrice * 0.99); // Relevant resistance
    const supportRaw = lows.map(l => l.price).filter(p => p <= currentPrice * 1.01); // Relevant support

    return {
        // Resistance cluster values are ascending; slice(0,5) = nearest 5 above price.
        // (slice(-5) would select the 5 farthest levels.)
        resistance: clusterLevels(resistanceRaw).slice(0, 5), // Top 5 nearest
        support: clusterLevels(supportRaw).slice(-5) // Top 5 nearest (ascending -> last 5 are closest)
    };
};

export const detectChartPatterns = (klines: Kline[]): DetectedPattern[] => {
    const patterns: DetectedPattern[] = [];
    const { highs, lows } = findPivots(klines, 5, 3); // Tuned for 15m/1h charts
    const recentHighs = highs.slice(-5); // Look at last 5 pivot highs
    const recentLows = lows.slice(-5);   // Look at last 5 pivot lows

    if (klines.length < 50) return patterns;


    // 1. DETECT HEAD AND SHOULDERS (Bearish)
    // Logic: Left Shoulder (LS), Head (H), Right Shoulder (RS). H > LS, H > RS. LS ~= RS.
    if (recentHighs.length >= 3) {
        const [ls, head, rs] = recentHighs.slice(-3);
        
        const isHeadHighest = head.price > ls.price && head.price > rs.price;
        const shouldersLevel = Math.abs(ls.price - rs.price) / ls.price < 0.03; // Within 3%
        const notTooFar = (klines.length - rs.index) < 20; // Pattern is recent

        if (isHeadHighest && shouldersLevel && notTooFar) {
            patterns.push({
                name: 'Head and Shoulders',
                type: 'bearish',
                confidence: 0.85,
                description: `Shoulders at ~${ls.price.toFixed(2)}, Head at ${head.price.toFixed(2)}`,
                significance: 'Major Bearish Reversal',
                // The neckline runs shoulder-to-shoulder, so that is the line
                // whose touches decide whether this is a setup or an assumption.
                touches: countTouchesOnLine(klines, ls, rs, TOUCH_TOL_PCT, 'high'),
                anchors: anchorsOf(klines, [ls, head, rs]),
                // The neckline: shoulder to shoulder.
                line: { a: anchorOf(klines, ls), b: anchorOf(klines, rs) },
            });
        }
    }

    // 2. DETECT INVERSE HEAD AND SHOULDERS (Bullish)
    if (recentLows.length >= 3) {
        const [ls, head, rs] = recentLows.slice(-3);
        
        const isHeadLowest = head.price < ls.price && head.price < rs.price;
        const shouldersLevel = Math.abs(ls.price - rs.price) / ls.price < 0.03;
        const notTooFar = (klines.length - rs.index) < 20;

        if (isHeadLowest && shouldersLevel && notTooFar) {
            patterns.push({
                name: 'Inverse Head & Shoulders',
                type: 'bullish',
                confidence: 0.85,
                description: `Shoulders at ~${ls.price.toFixed(2)}, Head at ${head.price.toFixed(2)}`,
                significance: 'Major Bullish Reversal',
                touches: countTouchesOnLine(klines, ls, rs, TOUCH_TOL_PCT, 'low'),
                anchors: anchorsOf(klines, [ls, head, rs]),
                line: { a: anchorOf(klines, ls), b: anchorOf(klines, rs) },
            });
        }
    }

    // 3. DETECT DOUBLE TOP (Bearish)
    // Logic: Two recent highs at similar price levels.
    if (recentHighs.length >= 2) {
        const [peak1, peak2] = recentHighs.slice(-2);
        const priceDiff = Math.abs(peak1.price - peak2.price) / peak1.price;
        const timeDiff = peak2.index - peak1.index;
        const notTooFar = (klines.length - peak2.index) < 15;

        if (priceDiff < 0.015 && timeDiff > 5 && notTooFar) { // Within 1.5%
            patterns.push({
                name: 'Double Top',
                type: 'bearish',
                confidence: 0.8,
                description: `Resistance zone detected at ~${peak1.price.toFixed(2)}`,
                significance: 'Bearish Reversal',
                // Measured on the resistance between the two peaks. The old
                // literal 2 meant the packet could call a double top
                // "confirmed" on the strength of the detection alone.
                touches: countTouchesOnLine(klines, peak1, peak2, TOUCH_TOL_PCT, 'high'),
                anchors: anchorsOf(klines, [peak1, peak2]),
                line: { a: anchorOf(klines, peak1), b: anchorOf(klines, peak2) },
            });
        }
    }

    // 4. DETECT DOUBLE BOTTOM (Bullish)
    if (recentLows.length >= 2) {
        const [trough1, trough2] = recentLows.slice(-2);
        const priceDiff = Math.abs(trough1.price - trough2.price) / trough1.price;
        const timeDiff = trough2.index - trough1.index;
        const notTooFar = (klines.length - trough2.index) < 15;

        if (priceDiff < 0.015 && timeDiff > 5 && notTooFar) {
            patterns.push({
                name: 'Double Bottom',
                type: 'bullish',
                confidence: 0.8,
                description: `Support zone detected at ~${trough1.price.toFixed(2)}`,
                significance: 'Bullish Reversal',
                touches: countTouchesOnLine(klines, trough1, trough2, TOUCH_TOL_PCT, 'low'),
                anchors: anchorsOf(klines, [trough1, trough2]),
                line: { a: anchorOf(klines, trough1), b: anchorOf(klines, trough2) },
            });
        }
    }

    // 5. DETECT TRIANGLES (Ascending/Descending)
    // Simplified logic: Analyze slope of recent 3 highs and recent 3 lows
    if (recentHighs.length >= 3 && recentLows.length >= 3) {
        // Slopes — kept as PIVOTS, not just prices, so each line can be walked
        // against the candles and the pattern can carry real anchors.
        const hp = recentHighs.slice(-3);
        const lp = recentLows.slice(-3);
        const h1 = hp[0].price, h2 = hp[1].price, h3 = hp[2].price;

        const l1 = lp[0].price, l2 = lp[1].price, l3 = lp[2].price;

        // Check for Lower Highs (Bearish Trendline)
        const lowerHighs = h2 < h1 * 0.998 && h3 < h2 * 0.998;
        // Check for Flat Highs (Resistance)
        const flatHighs = Math.abs(h1 - h2) / h1 < 0.005 && Math.abs(h2 - h3) / h2 < 0.005;

        // Check for Higher Lows (Bullish Trendline)
        const higherLows = l2 > l1 * 1.002 && l3 > l2 * 1.002;
        // Check for Flat Lows (Support)
        const flatLows = Math.abs(l1 - l2) / l1 < 0.005 && Math.abs(l2 - l3) / l2 < 0.005;

        // A triangle is judged on the edge that CARRIES its claim. An ascending
        // triangle's claim is its flat ceiling; a descending one's is its flat
        // floor; a symmetrical one has no flat edge, so the weaker of the two
        // converging lines is the honest answer.
        //
        // NOT the minimum across both edges. That rule was the old comment's
        // ("a triangle is only as valid as its least-touched edge"), and it is
        // unfalsifiable: a RISING base has two pivots by construction and can
        // never reach three, so taking the minimum would cap every ascending
        // and descending triangle at "assumption" no matter how flat and
        // repeatedly-tested its ceiling was. Only a symmetrical triangle is
        // actually judged on both.
        const edgeTouches = (a: { price: number; index: number }, b: { price: number; index: number }, side: 'high' | 'low'): number =>
            countTouchesOnLine(klines, a, b, TOUCH_TOL_PCT, side);
        const topTouches = Math.max(edgeTouches(hp[0], hp[2], 'high'), edgeTouches(hp[1], hp[2], 'high'));
        const baseTouches = Math.max(edgeTouches(lp[0], lp[2], 'low'), edgeTouches(lp[1], lp[2], 'low'));
        const triAnchors = anchorsOf(klines, [...hp, ...lp]);

        if (flatHighs && higherLows) {
            patterns.push({
                name: 'Ascending Triangle',
                type: 'bullish',
                confidence: 0.75,
                description: 'Flat resistance with higher lows.',
                significance: 'Bullish Continuation',
                // The claim is the flat ceiling, so that is the line.
                touches: topTouches,
                anchors: triAnchors,
                line: { a: anchorOf(klines, hp[0]), b: anchorOf(klines, hp[2]) },
            });
        } else if (lowerHighs && flatLows) {
            patterns.push({
                name: 'Descending Triangle',
                type: 'bearish',
                confidence: 0.75,
                description: 'Flat support with lower highs.',
                significance: 'Bearish Continuation',
                // The claim is the flat floor, so that is the line.
                touches: baseTouches,
                anchors: triAnchors,
                line: { a: anchorOf(klines, lp[0]), b: anchorOf(klines, lp[2]) },
            });
        } else if (lowerHighs && higherLows) {
             patterns.push({
                name: 'Symmetrical Triangle',
                type: 'neutral',
                confidence: 0.7,
                description: 'Price coiling with lower highs and higher lows.',
                significance: 'Breakout Imminent',
                // No flat edge — both lines carry it, so the weaker decides,
                // and the line reported is that same weaker edge.
                touches: Math.min(topTouches, baseTouches),
                anchors: triAnchors,
                line: topTouches <= baseTouches
                    ? { a: anchorOf(klines, hp[0]), b: anchorOf(klines, hp[2]) }
                    : { a: anchorOf(klines, lp[0]), b: anchorOf(klines, lp[2]) },
            });
        }
    }

    return patterns;
};

/** How far a named price may sit from a swing and still be treated as naming
 *  that swing. 0.3% is the same ballpark as the touch tolerance the detector
 *  already uses, so "near" means the same thing throughout this module. */
export const SNAP_TOLERANCE_PCT = 0.3;

/**
 * Snap a price the model NAMED onto the swing it was describing.
 *
 * A seat reading "support at 62150" off a chart that printed 62147.3 is not
 * wrong by a trading decision — it is wrong by a transcription. The model cannot
 * see the digits, so it can only ever be approximately right, and the gap
 * between "approximately" and "exactly" is what makes a level miss by a tick
 * and read as an unrespected line.
 *
 * So the code measures the level instead. The model supplies intent — "support
 * here" — and the chart supplies the price.
 *
 * Returns the original price untouched when nothing is within tolerance. That
 * is the important case: a level the market genuinely has no structure at
 * should stay where the model put it rather than being snapped onto whatever
 * happens to be nearest. Snapping is for recovering a transcription, not for
 * inventing a level the chart does not support.
 */
export const snapPriceToStructure = (
    price: number,
    // Deliberately the subset this actually reads rather than Kline: the chart
    // snapshot's candles are a narrower shape than the full Kline, and widening
    // the input to force a match would have meant either a cast or carrying
    // fields nobody here touches. A Kline satisfies this; so does a snapshot
    // candle.
    klines: readonly { high: number; low: number }[],
    tolerancePct: number = SNAP_TOLERANCE_PCT,
    pivotOptions: { leftBars?: number; rightBars?: number } = {},
): { price: number; snapped: boolean; pivot: Pivot | null } => {
    if (!Number.isFinite(price) || price <= 0 || klines.length === 0) {
        return { price, snapped: false, pivot: null };
    }
    const { highs, lows } = findPivots(
        klines,
        pivotOptions.leftBars ?? 5,
        pivotOptions.rightBars ?? 2,
    );
    let best: Pivot | null = null;
    let bestPct = Infinity;
    for (const p of [...highs, ...lows]) {
        const pct = Math.abs((p.price - price) / price) * 100;
        if (pct <= tolerancePct && pct < bestPct) { bestPct = pct; best = p; }
    }
    // No swing nearby: keep the model's number and say so, rather than snapping.
    if (!best) return { price, snapped: false, pivot: null };
    return { price: best.price, snapped: true, pivot: best };
};
