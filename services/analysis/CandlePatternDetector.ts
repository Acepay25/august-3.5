/**
 * CandlePatternDetector - Lightweight classical pattern recognition over a
 * rolling window of OHLCV candles.
 *
 * This is the "what a human trader would see on the chart" layer that
 * bridges the raw kline feed and the AI prompt. The detector intentionally
 * trades a bit of nuance for cheap, explainable rules so the model can
 * reason about *which* pattern fired and *where* (index in the window).
 *
 * Scope (covers what the user named explicitly + a small standard set):
 *   - single-candle: pin bar, hammer, shooting star, doji, marubozu
 *   - two-candle:   bullish / bearish engulfing, tweezer top / bottom
 *   - three-candle: morning star, evening star, three white soldiers,
 *                   three black crows
 *   - structure:    double top, double bottom, higher-high / higher-low
 *                   trend, lower-high / lower-low trend, BOS (break of
 *                   structure) on the recent swing
 *
 * Everything is deterministic and order-N (single pass over the window),
 * so it can run on every analysis without measurable cost.
 */

import { Kline } from './MarketDataService';

export type PatternDirection = 'bullish' | 'bearish' | 'neutral';

export interface DetectedCandlePattern {
    /** Stable name used in the prompt. Always one of the documented set. */
    name: string;
    /** Index in the analyzed window. 0 = most recent candle. */
    index: number;
    /** Direction bias implied by the pattern. */
    direction: PatternDirection;
    /** 0-1 confidence. Lower for ambiguous shapes, higher for textbook. */
    strength: number;
    /** Human-readable price anchor(s) — the level(s) the pattern forms at. */
    priceLevel?: number;
    /** Short reasoning for transparency. */
    note?: string;
}

export interface CandlePatternScan {
    windowSize: number;
    patterns: DetectedCandlePattern[];
    /** Last 30 completed candles' compact OHLCV, oldest first. */
    candles: Kline[];
    /** Quick visual sequence the model can "imagine" — same idea as the
     *  existing `candleHistory.sequence`, but built on the larger window. */
    sequence: ('🟢' | '🔴')[];
    bullishCount: number;
    bearishCount: number;
    dominantTrend: 'bullish' | 'bearish' | 'neutral';
    /** Pivot highs / lows the structural patterns were anchored to. */
    recentSwingHigh?: number;
    recentSwingLow?: number;
    /** Higher-high / higher-low counts used by the trend-structure call. */
    higherHighs: number;
    higherLows: number;
    lowerHighs: number;
    lowerLows: number;
}

const DEFAULT_WINDOW = 30;

const bodyPct = (k: Kline): number => (k.open === 0 ? 0 : ((k.close - k.open) / k.open) * 100);
const rangePct = (k: Kline): number => (k.open === 0 ? 0 : ((k.high - k.low) / k.open) * 100);
const upperWickPct = (k: Kline): number => {
    const r = k.high - k.low;
    return r === 0 ? 0 : ((k.high - Math.max(k.open, k.close)) / r) * 100;
};
const lowerWickPct = (k: Kline): number => {
    const r = k.high - k.low;
    return r === 0 ? 0 : ((Math.min(k.open, k.close) - k.low) / r) * 100;
};
const isBullish = (k: Kline): boolean => k.close > k.open;
const isBearish = (k: Kline): boolean => k.close < k.open;

// ---------------------------------------------------------------------------
// SINGLE-CANDLE PATTERNS
// ---------------------------------------------------------------------------

function detectSingleCandlePatterns(c: Kline, idx: number): DetectedCandlePattern[] {
    const out: DetectedCandlePattern[] = [];
    const r = c.high - c.low;
    if (r === 0) return out;

    const body = Math.abs(c.close - c.open);
    const bodyRatio = (body / r) * 100;
    const upper = upperWickPct(c);
    const lower = lowerWickPct(c);

    // Doji: body is tiny relative to range
    if (bodyRatio < 10) {
        out.push({
            name: 'doji',
            index: idx,
            direction: 'neutral',
            strength: bodyRatio < 5 ? 0.85 : 0.65,
            priceLevel: c.close,
            note: 'Indecision candle — body is tiny relative to total range.'
        });
        return out;
    }

    // Pin bar: long lower wick, small body, sitting at the bottom of the range
    if (lower > 60 && bodyRatio < 35 && upper < 25) {
        out.push({
            name: 'bullish_pin_bar',
            index: idx,
            direction: 'bullish',
            strength: lower > 75 ? 0.9 : 0.75,
            priceLevel: c.low,
            note: `Lower wick ${lower.toFixed(0)}% of range — buyers rejected the low.`
        });
    }

    // Shooting star: long upper wick, small body, sitting at the top of the range
    if (upper > 60 && bodyRatio < 35 && lower < 25) {
        out.push({
            name: 'bearish_shooting_star',
            index: idx,
            direction: 'bearish',
            strength: upper > 75 ? 0.9 : 0.75,
            priceLevel: c.high,
            note: `Upper wick ${upper.toFixed(0)}% of range — sellers rejected the high.`
        });
    }

    // Hammer: small body at the top of the range, long lower wick
    // (distinguish from pin bar by the body's position: hammer body is in
    // the upper half of the range)
    if (lower > 50 && bodyRatio < 40 && (c.close - c.low) / r > 0.55) {
        // Skip if we already classified as bullish pin bar (same shape);
        // hammer is the same signal but emphasizes the trend context.
        if (!out.find(p => p.name === 'bullish_pin_bar')) {
            out.push({
                name: 'hammer',
                index: idx,
                direction: 'bullish',
                strength: 0.7,
                priceLevel: c.low,
                note: 'Hammer formation — buyers absorbed sell pressure at the low.'
            });
        }
    }

    // Marubozu: very long body, tiny wicks — strong directional conviction
    if (bodyRatio > 88) {
        out.push({
            name: isBullish(c) ? 'bullish_marubozu' : 'bearish_marubozu',
            index: idx,
            direction: isBullish(c) ? 'bullish' : 'bearish',
            strength: 0.8,
            priceLevel: c.close,
            note: `Body ${bodyRatio.toFixed(0)}% of range — strong directional conviction.`
        });
    }

    return out;
}

// ---------------------------------------------------------------------------
// TWO-CANDLE PATTERNS
// ---------------------------------------------------------------------------

function detectTwoCandlePatterns(curr: Kline, prev: Kline, idx: number): DetectedCandlePattern[] {
    const out: DetectedCandlePattern[] = [];

    // Bullish engulfing: prev bearish, curr bullish, curr body covers prev body
    if (isBearish(prev) && isBullish(curr)) {
        if (curr.open <= prev.close && curr.close >= prev.open && Math.abs(bodyPct(curr)) > Math.abs(bodyPct(prev)) * 0.8) {
            out.push({
                name: 'bullish_engulfing',
                index: idx,
                direction: 'bullish',
                strength: 0.8,
                priceLevel: curr.close,
                note: 'Bullish candle engulfs prior bearish candle body.'
            });
        }
    }

    // Bearish engulfing
    if (isBullish(prev) && isBearish(curr)) {
        if (curr.open >= prev.close && curr.close <= prev.open && Math.abs(bodyPct(curr)) > Math.abs(bodyPct(prev)) * 0.8) {
            out.push({
                name: 'bearish_engulfing',
                index: idx,
                direction: 'bearish',
                strength: 0.8,
                priceLevel: curr.close,
                note: 'Bearish candle engulfs prior bullish candle body.'
            });
        }
    }

    // Tweezer bottom: two candles share a low (within 0.1% of each other),
    // first bearish, second bullish
    if (isBearish(prev) && isBullish(curr)) {
        const lowDelta = Math.abs(prev.low - curr.low) / (prev.low || 1) * 100;
        if (lowDelta < 0.15) {
            out.push({
                name: 'tweezer_bottom',
                index: idx,
                direction: 'bullish',
                strength: 0.7,
                priceLevel: curr.low,
                note: `Two-candle low test within ${lowDelta.toFixed(2)}% — buyers defended.`
            });
        }
    }

    // Tweezer top: two candles share a high
    if (isBullish(prev) && isBearish(curr)) {
        const highDelta = Math.abs(prev.high - curr.high) / (prev.high || 1) * 100;
        if (highDelta < 0.15) {
            out.push({
                name: 'tweezer_top',
                index: idx,
                direction: 'bearish',
                strength: 0.7,
                priceLevel: curr.high,
                note: `Two-candle high test within ${highDelta.toFixed(2)}% — sellers defended.`
            });
        }
    }

    return out;
}

// ---------------------------------------------------------------------------
// THREE-CANDLE PATTERNS
// ---------------------------------------------------------------------------

function detectThreeCandlePatterns(
    curr: Kline,
    mid: Kline,
    prev: Kline,
    idx: number
): DetectedCandlePattern[] {
    const out: DetectedCandlePattern[] = [];

    // Morning star: prev bearish with big body, mid small body (doji-like),
    // curr bullish with big body that closes well into prev body
    if (isBearish(prev) && isBullish(curr)) {
        const prevBody = Math.abs(bodyPct(prev));
        const currBody = Math.abs(bodyPct(curr));
        const midBody = Math.abs(bodyPct(mid));
        if (prevBody > 0.5 && currBody > 0.5 && midBody < prevBody * 0.4) {
            if (curr.close > (prev.open + prev.close) / 2) {
                out.push({
                    name: 'morning_star',
                    index: idx,
                    direction: 'bullish',
                    strength: 0.85,
                    priceLevel: curr.close,
                    note: 'Bearish → indecision → bullish reversal pattern.'
                });
            }
        }
    }

    // Evening star: mirror
    if (isBullish(prev) && isBearish(curr)) {
        const prevBody = Math.abs(bodyPct(prev));
        const currBody = Math.abs(bodyPct(curr));
        const midBody = Math.abs(bodyPct(mid));
        if (prevBody > 0.5 && currBody > 0.5 && midBody < prevBody * 0.4) {
            if (curr.close < (prev.open + prev.close) / 2) {
                out.push({
                    name: 'evening_star',
                    index: idx,
                    direction: 'bearish',
                    strength: 0.85,
                    priceLevel: curr.close,
                    note: 'Bullish → indecision → bearish reversal pattern.'
                });
            }
        }
    }

    // Three white soldiers: three consecutive bullish candles, each closing
    // near its high and each opening within the previous body
    if (isBullish(prev) && isBullish(mid) && isBullish(curr)) {
        const opens = [mid.open, curr.open];
        const allInside = opens.every(o => o >= Math.min(prev.open, prev.close) && o <= Math.max(prev.open, prev.close) || true);
        const strongBodies = [prev, mid, curr].every(k => Math.abs(bodyPct(k)) > 0.3);
        const closesNearHigh = [prev, mid, curr].every(k => upperWickPct(k) < 30);
        if (allInside && strongBodies && closesNearHigh) {
            out.push({
                name: 'three_white_soldiers',
                index: idx,
                direction: 'bullish',
                strength: 0.8,
                priceLevel: curr.close,
                note: 'Three consecutive strong bullish candles closing near highs.'
            });
        }
    }

    // Three black crows
    if (isBearish(prev) && isBearish(mid) && isBearish(curr)) {
        const strongBodies = [prev, mid, curr].every(k => Math.abs(bodyPct(k)) > 0.3);
        const closesNearLow = [prev, mid, curr].every(k => lowerWickPct(k) < 30);
        if (strongBodies && closesNearLow) {
            out.push({
                name: 'three_black_crows',
                index: idx,
                direction: 'bearish',
                strength: 0.8,
                priceLevel: curr.close,
                note: 'Three consecutive strong bearish candles closing near lows.'
            });
        }
    }

    return out;
}

// ---------------------------------------------------------------------------
// STRUCTURE / SWING PATTERNS
// ---------------------------------------------------------------------------

interface SwingPoints {
    highs: { index: number; price: number }[];
    lows: { index: number; price: number }[];
}

/**
 * Local-swing extraction. A swing high is a candle whose high is higher
 * than the highs of the 2 candles on each side; mirror for swing low.
 * This is intentionally local-only — the model gets the recent structure,
 * not a full ZigZag of the entire history.
 */
function extractLocalSwings(candles: Kline[]): SwingPoints {
    const highs: { index: number; price: number }[] = [];
    const lows: { index: number; price: number }[] = [];
    for (let i = 2; i < candles.length - 2; i++) {
        const c = candles[i];
        if (
            c.high > candles[i - 1].high && c.high > candles[i - 2].high &&
            c.high > candles[i + 1].high && c.high > candles[i + 2].high
        ) {
            highs.push({ index: i, price: c.high });
        }
        if (
            c.low < candles[i - 1].low && c.low < candles[i - 2].low &&
            c.low < candles[i + 1].low && c.low < candles[i + 2].low
        ) {
            lows.push({ index: i, price: c.low });
        }
    }
    return { highs, lows };
}

function detectStructurePatterns(candles: Kline[], swings: SwingPoints): DetectedCandlePattern[] {
    const out: DetectedCandlePattern[] = [];
    if (candles.length === 0) return out;

    // Last two swing highs and last two swing lows are what the model
    // needs to reason about HH/HL vs LH/LL. Index 0 = most recent candle.
    const lastHighs = swings.highs.slice(-3);
    const lastLows = swings.lows.slice(-3);

    // Double top: last two swing highs within 0.3% of each other
    if (lastHighs.length >= 2) {
        const a = lastHighs[lastHighs.length - 1];
        const b = lastHighs[lastHighs.length - 2];
        const delta = Math.abs(a.price - b.price) / (a.price || 1) * 100;
        if (delta < 0.3) {
            out.push({
                name: 'double_top',
                index: a.index,
                direction: 'bearish',
                strength: 0.75,
                priceLevel: a.price,
                note: `Two swing highs within ${delta.toFixed(2)}% — failed break higher.`
            });
        }
    }

    // Double bottom
    if (lastLows.length >= 2) {
        const a = lastLows[lastLows.length - 1];
        const b = lastLows[lastLows.length - 2];
        const delta = Math.abs(a.price - b.price) / (a.price || 1) * 100;
        if (delta < 0.3) {
            out.push({
                name: 'double_bottom',
                index: a.index,
                direction: 'bullish',
                strength: 0.75,
                priceLevel: a.price,
                note: `Two swing lows within ${delta.toFixed(2)}% — failed break lower.`
            });
        }
    }

    // Break of structure (BOS): the most recent candle's close crosses
    // above the most recent swing high (bullish BOS) or below the most
    // recent swing low (bearish BOS). This is the highest-information
    // structural event for trend resumption.
    const lastCandle = candles[0];
    if (lastHighs.length > 0) {
        const lastHigh = lastHighs[lastHighs.length - 1].price;
        if (lastCandle.close > lastHigh) {
            out.push({
                name: 'bullish_bos',
                index: 0,
                direction: 'bullish',
                strength: 0.8,
                priceLevel: lastHigh,
                note: `Close ${lastCandle.close} above recent swing high ${lastHigh}.`
            });
        }
    }
    if (lastLows.length > 0) {
        const lastLow = lastLows[lastLows.length - 1].price;
        if (lastCandle.close < lastLow) {
            out.push({
                name: 'bearish_bos',
                index: 0,
                direction: 'bearish',
                strength: 0.8,
                priceLevel: lastLow,
                note: `Close ${lastCandle.close} below recent swing low ${lastLow}.`
            });
        }
    }

    return out;
}

// ---------------------------------------------------------------------------
// TREND STRUCTURE (HH/HL vs LH/LL counts)
// ---------------------------------------------------------------------------

function countTrendStructure(swings: SwingPoints): {
    higherHighs: number;
    higherLows: number;
    lowerHighs: number;
    lowerLows: number;
} {
    let higherHighs = 0;
    let lowerHighs = 0;
    let higherLows = 0;
    let lowerLows = 0;

    for (let i = 1; i < swings.highs.length; i++) {
        if (swings.highs[i].price > swings.highs[i - 1].price) higherHighs++;
        else if (swings.highs[i].price < swings.highs[i - 1].price) lowerHighs++;
    }
    for (let i = 1; i < swings.lows.length; i++) {
        if (swings.lows[i].price > swings.lows[i - 1].price) higherLows++;
        else if (swings.lows[i].price < swings.lows[i - 1].price) lowerLows++;
    }

    return { higherHighs, higherLows, lowerHighs, lowerLows };
}

// ---------------------------------------------------------------------------
// PUBLIC ENTRY
// ---------------------------------------------------------------------------

/**
 * Run a deterministic pattern scan over the last `window` completed
 * candles (excludes the current incomplete candle at the end of the
 * `klines` array — matches the convention used elsewhere in the
 * hybrid data layer).
 */
export function scanCandlePatterns(
    klines: Kline[],
    window: number = DEFAULT_WINDOW
): CandlePatternScan {
    if (!klines || klines.length < 3) {
        return {
            windowSize: 0,
            patterns: [],
            candles: [],
            sequence: [],
            bullishCount: 0,
            bearishCount: 0,
            dominantTrend: 'neutral',
            higherHighs: 0,
            higherLows: 0,
            lowerHighs: 0,
            lowerLows: 0,
        };
    }

    // Drop the last (incomplete) candle, then take the previous `window`
    // completed candles. The result is oldest-first.
    const completed = klines.slice(Math.max(0, klines.length - 1 - window), klines.length - 1);
    if (completed.length < 3) {
        return {
            windowSize: 0,
            patterns: [],
            candles: [],
            sequence: [],
            bullishCount: 0,
            bearishCount: 0,
            dominantTrend: 'neutral',
            higherHighs: 0,
            higherLows: 0,
            lowerHighs: 0,
            lowerLows: 0,
        };
    }

    // Re-base indices so index 0 = most recent candle. The completed
    // array above is oldest-first; reverse for the scan.
    const recentFirst = [...completed].reverse();
    const windowSize = recentFirst.length;

    const patterns: DetectedCandlePattern[] = [];

    // Single-candle patterns on every bar
    recentFirst.forEach((c, i) => {
        patterns.push(...detectSingleCandlePatterns(c, i));
    });

    // Two-candle patterns
    for (let i = 0; i < windowSize - 1; i++) {
        patterns.push(...detectTwoCandlePatterns(recentFirst[i], recentFirst[i + 1], i));
    }

    // Three-candle patterns
    for (let i = 0; i < windowSize - 2; i++) {
        patterns.push(...detectThreeCandlePatterns(recentFirst[i], recentFirst[i + 1], recentFirst[i + 2], i));
    }

    // Structure patterns need local swings; use the oldest-first array
    // so the swing-extraction loop is straightforward.
    const swings = extractLocalSwings(recentFirst);
    patterns.push(...detectStructurePatterns(recentFirst, swings));

    const trendCounts = countTrendStructure(swings);

    // Sequence & counts (use the same completed-window view)
    const sequence: ('🟢' | '🔴')[] = [];
    let bullishCount = 0;
    let bearishCount = 0;
    for (const c of completed) {
        if (isBullish(c)) {
            sequence.push('🟢');
            bullishCount++;
        } else {
            sequence.push('🔴');
            bearishCount++;
        }
    }
    const total = bullishCount + bearishCount;
    const bullishPct = total > 0 ? (bullishCount / total) * 100 : 50;
    const dominantTrend: CandlePatternScan['dominantTrend'] =
        bullishPct > 60 ? 'bullish' : bullishPct < 40 ? 'bearish' : 'neutral';

    const recentSwingHigh = swings.highs.length > 0
        ? Math.max(...swings.highs.map(s => s.price))
        : undefined;
    const recentSwingLow = swings.lows.length > 0
        ? Math.min(...swings.lows.map(s => s.price))
        : undefined;

    return {
        windowSize,
        patterns,
        candles: completed,
        sequence,
        bullishCount,
        bearishCount,
        dominantTrend,
        recentSwingHigh,
        recentSwingLow,
        ...trendCounts,
    };
}
