/**
 * CandlePatternDetector - Lightweight classical pattern recognition over a
 * rolling window of OHLCV candles.
 *
 * This is the "what a human trader would see on the chart" layer that
 * bridges the raw kline feed and the AI prompt. The detector intentionally
 * trades a bit of nuance for cheap, explainable rules so the model can
 * reason about *which* pattern fired and *where* (index in the window).
 *
 * Scope (the standard classical set a human trader would name on a chart):
 *   - single-candle: pin bar, hammer, hanging man, shooting star,
 *                    inverted hammer, doji, spinning top, marubozu,
 *                    belt hold
 *   - two-candle:    bullish / bearish engulfing, tweezer top / bottom,
 *                    bullish / bearish harami, piercing line,
 *                    dark cloud cover
 *   - three-candle:  morning star, evening star, three white soldiers,
 *                    three black crows, three inside up / down,
 *                    bullish / bearish fair value gap (FVG)
 *   - structure:     double top, double bottom, higher-high / higher-low
 *                    trend, lower-high / lower-low trend, BOS (break of
 *                    structure), CHoCH (change of character), SFP
 *                    (sweep of liquidity / failed break) on the recent swing
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

/**
 * Net direction of the up-to-5 candles *before* `idx` in the recent-first
 * window. Some one-candle shapes (hammer vs hanging man, shooting star vs
 * inverted hammer) are the same geometry with opposite meaning depending on
 * the trend that preceded them — a human reads them in context.
 */
function priorTrendOf(window: Kline[], idx: number): 'bullish' | 'bearish' | 'neutral' {
    const prior = window.slice(idx + 1, idx + 6); // older candles follow the current one
    if (prior.length === 0) return 'neutral';
    let up = 0;
    let down = 0;
    for (const k of prior) {
        if (k.close > k.open) up++;
        else if (k.close < k.open) down++;
    }
    if (up > down) return 'bullish';
    if (down > up) return 'bearish';
    return 'neutral';
}

function detectSingleCandlePatterns(
    c: Kline,
    idx: number,
    priorTrend: 'bullish' | 'bearish' | 'neutral'
): DetectedCandlePattern[] {
    const out: DetectedCandlePattern[] = [];
    const r = c.high - c.low;
    if (r === 0) return out;

    const body = Math.abs(c.close - c.open);
    const bodyRatio = (body / r) * 100;
    const upper = upperWickPct(c);
    const lower = lowerWickPct(c);

    // Doji family: tiny body. The wick placement decides the subtype —
    // gravestone (long upper, no lower), dragonfly (long lower, no upper),
    // long-legged (both), plain doji otherwise. A doji never also fires the
    // body-based patterns below (hammer, belt hold, marubozu…).
    if (bodyRatio < 10) {
        if (upper > 60 && lower < 10) {
            out.push({
                name: 'gravestone_doji',
                index: idx,
                direction: 'bearish',
                strength: 0.7,
                priceLevel: c.close,
                note: 'Doji with a long upper wick — sellers rejected the high; bearish-leaning indecision.'
            });
        } else if (lower > 60 && upper < 10) {
            out.push({
                name: 'dragonfly_doji',
                index: idx,
                direction: 'bullish',
                strength: 0.7,
                priceLevel: c.close,
                note: 'Doji with a long lower wick — buyers rejected the low; bullish-leaning indecision.'
            });
        } else if (upper > 40 && lower > 40) {
            out.push({
                name: 'long_legged_doji',
                index: idx,
                direction: 'neutral',
                strength: 0.6,
                priceLevel: c.close,
                note: 'Doji with long wicks on both sides — extreme indecision, wide range.'
            });
        } else {
            out.push({
                name: 'doji',
                index: idx,
                direction: 'neutral',
                strength: bodyRatio < 5 ? 0.85 : 0.65,
                priceLevel: c.close,
                note: 'Indecision candle — body is tiny relative to total range.'
            });
        }
        return out;
    }

    // High wave: small body with LONG wicks on both sides — volatile
    // indecision, the stronger cousin of the spinning top.
    if (bodyRatio < 25 && upper > 40 && lower > 40) {
        out.push({
            name: 'high_wave',
            index: idx,
            direction: 'neutral',
            strength: 0.6,
            priceLevel: c.close,
            note: 'Small body with long wicks on both sides — volatile indecision.'
        });
    }

    // Spinning top: small body with wicks on both sides — indecision, but
    // with a real body (doji already returned above). Not when the stricter
    // high wave already fired (both wicks > 40%).
    if (bodyRatio < 25 && lower > 25 && upper > 25 && !(upper > 40 && lower > 40)) {
        out.push({
            name: 'spinning_top',
            index: idx,
            direction: 'neutral',
            strength: 0.55,
            priceLevel: c.close,
            note: 'Small body with wicks on both sides — indecision.'
        });
    }

    // Pin bar: long lower wick, small body, body sitting at the TOP of the
    // range (close in the upper half). The wick thresholds already imply the
    // body position (lower > 60 ⇒ the body bottom sits above 60% of the
    // range), but the clause is stated explicitly so the invariant survives
    // future threshold edits.
    if (lower > 60 && bodyRatio < 35 && upper < 25 && (c.close - c.low) / r > 0.55) {
        out.push({
            name: 'bullish_pin_bar',
            index: idx,
            direction: 'bullish',
            strength: lower > 75 ? 0.9 : 0.75,
            priceLevel: c.low,
            note: `Lower wick ${lower.toFixed(0)}% of range — buyers rejected the low.`
        });
    }

    // Shooting star: long upper wick, small body, body sitting at the BOTTOM
    // of the range (implied by upper > 60, stated explicitly for the same
    // reason as the pin bar). After a downtrend the same geometry is an
    // inverted hammer instead, so this fires only outside bearish context.
    if (priorTrend !== 'bearish' && upper > 60 && bodyRatio < 35 && lower < 25 && (c.high - c.close) / r > 0.55) {
        out.push({
            name: 'bearish_shooting_star',
            index: idx,
            direction: 'bearish',
            strength: upper > 75 ? 0.9 : 0.75,
            priceLevel: c.high,
            note: `Upper wick ${upper.toFixed(0)}% of range — sellers rejected the high.`
        });
    }

    // Inverted hammer: the shooting-star geometry after a downtrend — same
    // shape, opposite meaning (bullish reversal instead of bearish rejection).
    if (priorTrend === 'bearish' && upper > 60 && bodyRatio < 35 && lower < 25 && (c.high - c.close) / r > 0.55) {
        out.push({
            name: 'inverted_hammer',
            index: idx,
            direction: 'bullish',
            strength: 0.65,
            priceLevel: c.high,
            note: `Upper wick ${upper.toFixed(0)}% of range after a downtrend — sellers failed to follow through.`
        });
    }

    // Hammer / hanging man: small body at the top of the range, long lower
    // wick. Same geometry; the prior trend decides whether the low-test is a
    // bullish hammer (after a downtrend) or a bearish hanging man (after an
    // uptrend). Skipped when the stricter pin bar already fired (same shape).
    if (lower > 50 && bodyRatio < 40 && (c.close - c.low) / r > 0.55 && !out.find(p => p.name === 'bullish_pin_bar')) {
        if (priorTrend === 'bullish') {
            out.push({
                name: 'hanging_man',
                index: idx,
                direction: 'bearish',
                strength: 0.65,
                priceLevel: c.low,
                note: 'Hammer shape after an uptrend — buyers absorbed the dip, but upside momentum is at risk.'
            });
        } else {
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

    // Belt hold: the candle opens at/near the extreme and the body fills most
    // of the range — a strong opening commitment. (Body ≤ 88% keeps marubozu
    // the dominant "full-body" label.) Direction is mandatory: a bullish belt
    // hold OPENS AT ITS LOW, a bearish one AT ITS HIGH. Without the check a
    // bullish candle with a small upper wick fired "bearish_belt_hold", and a
    // candle with both wicks <10% fired both patterns simultaneously — two
    // contradictory signals in the same prompt.
    if (isBullish(c) && bodyRatio > 60 && bodyRatio <= 88 && lower < 10 && upper < 30) {
        out.push({
            name: 'bullish_belt_hold',
            index: idx,
            direction: 'bullish',
            strength: 0.7,
            priceLevel: c.close,
            note: 'Opened at the low and closed near the high — buying commitment from the open.'
        });
    }
    if (isBearish(c) && bodyRatio > 60 && bodyRatio <= 88 && upper < 10 && lower < 30) {
        out.push({
            name: 'bearish_belt_hold',
            index: idx,
            direction: 'bearish',
            strength: 0.7,
            priceLevel: c.close,
            note: 'Opened at the high and closed near the low — selling commitment from the open.'
        });
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

    // Bullish harami: prev bearish with a large body, curr bullish with a
    // small body fully inside the prev body — selling momentum pausing.
    if (isBearish(prev) && isBullish(curr)) {
        const prevTop = Math.max(prev.open, prev.close);
        const prevBottom = Math.min(prev.open, prev.close);
        const prevRange = prev.high - prev.low;
        const currTop = Math.max(curr.open, curr.close);
        const currBottom = Math.min(curr.open, curr.close);
        if (
            prevRange > 0 &&
            (prevTop - prevBottom) / prevRange > 0.4 &&
            currTop <= prevTop && currBottom >= prevBottom &&
            (currTop - currBottom) < (prevTop - prevBottom) * 0.7
        ) {
            out.push({
                name: 'bullish_harami',
                index: idx,
                direction: 'bullish',
                strength: 0.65,
                priceLevel: curr.close,
                note: 'Small bullish candle nested inside the prior bearish body — selling momentum paused.'
            });
        }
    }

    // Bearish harami: mirror
    if (isBullish(prev) && isBearish(curr)) {
        const prevTop = Math.max(prev.open, prev.close);
        const prevBottom = Math.min(prev.open, prev.close);
        const prevRange = prev.high - prev.low;
        const currTop = Math.max(curr.open, curr.close);
        const currBottom = Math.min(curr.open, curr.close);
        if (
            prevRange > 0 &&
            (prevTop - prevBottom) / prevRange > 0.4 &&
            currTop <= prevTop && currBottom >= prevBottom &&
            (currTop - currBottom) < (prevTop - prevBottom) * 0.7
        ) {
            out.push({
                name: 'bearish_harami',
                index: idx,
                direction: 'bearish',
                strength: 0.65,
                priceLevel: curr.close,
                note: 'Small bearish candle nested inside the prior bullish body — buying momentum paused.'
            });
        }
    }

    // Piercing line: prev bearish, curr bullish opens below prev close and
    // closes more than halfway into prev body (but below prev open).
    if (isBearish(prev) && isBullish(curr)) {
        const prevMid = (prev.open + prev.close) / 2;
        if (curr.open < prev.close && curr.close > prevMid && curr.close < prev.open) {
            out.push({
                name: 'piercing_line',
                index: idx,
                direction: 'bullish',
                strength: 0.7,
                priceLevel: curr.close,
                note: 'Bullish candle closed more than halfway into the prior bearish body.'
            });
        }
    }

    // Dark cloud cover: mirror of the piercing line.
    if (isBullish(prev) && isBearish(curr)) {
        const prevMid = (prev.open + prev.close) / 2;
        if (curr.open > prev.close && curr.close < prevMid && curr.close > prev.open) {
            out.push({
                name: 'dark_cloud_cover',
                index: idx,
                direction: 'bearish',
                strength: 0.7,
                priceLevel: curr.close,
                note: 'Bearish candle closed more than halfway into the prior bullish body.'
            });
        }
    }

    // Harami cross: a DOJI fully inside the prior large body — the strongest
    // form of a harami (momentum stalling into pure indecision). Direction
    // follows the prior trend like the regular harami.
    if (Math.abs(bodyPct(curr)) < 0.1 && Math.abs(bodyPct(prev)) > 0.5) {
        const prevTop = Math.max(prev.open, prev.close);
        const prevBottom = Math.min(prev.open, prev.close);
        if (curr.high <= prevTop && curr.low >= prevBottom) {
            out.push({
                name: 'harami_cross',
                index: idx,
                direction: isBearish(prev) ? 'bullish' : 'bearish',
                strength: 0.7,
                priceLevel: curr.close,
                note: isBearish(prev)
                    ? 'Doji nested inside a large bearish body — selling momentum stalled.'
                    : 'Doji nested inside a large bullish body — buying momentum stalled.'
            });
        }
    }

    // Kicking: a real gap against the prior move, then a strong opposite
    // marubozu. Rare on crypto (needs a genuine gap) but a decisive signal.
    if (Math.abs(bodyPct(prev)) > 0.8 && Math.abs(bodyPct(curr)) > 0.8) {
        if (isBearish(prev) && isBullish(curr) && curr.low > prev.high) {
            out.push({
                name: 'kicking_bullish',
                index: idx,
                direction: 'bullish',
                strength: 0.85,
                priceLevel: curr.close,
                note: 'Bearish marubozu gapped up into a bullish marubozu — decisive reversal.'
            });
        }
        if (isBullish(prev) && isBearish(curr) && curr.high < prev.low) {
            out.push({
                name: 'kicking_bearish',
                index: idx,
                direction: 'bearish',
                strength: 0.85,
                priceLevel: curr.close,
                note: 'Bullish marubozu gapped down into a bearish marubozu — decisive reversal.'
            });
        }
    }

    // Meeting lines: opposite colors closing at the SAME level — the prior
    // direction was rejected exactly at that price.
    const closeDelta = Math.abs(curr.close - prev.close) / (prev.close || 1) * 100;
    if (closeDelta < 0.15) {
        if (isBearish(prev) && isBullish(curr)) {
            out.push({
                name: 'meeting_lines_bullish',
                index: idx,
                direction: 'bullish',
                strength: 0.65,
                priceLevel: curr.close,
                note: 'Bullish candle closed at the prior bearish close — support defended at that level.'
            });
        } else if (isBullish(prev) && isBearish(curr)) {
            out.push({
                name: 'meeting_lines_bearish',
                index: idx,
                direction: 'bearish',
                strength: 0.65,
                priceLevel: curr.close,
                note: 'Bearish candle closed at the prior bullish close — resistance defended at that level.'
            });
        }
    }

    // Thrusting line: a WEAK piercing — the bull closes INTO the prior
    // bearish body but BELOW its midpoint (piercing requires above).
    if (isBearish(prev) && isBullish(curr)) {
        const prevMid = (prev.open + prev.close) / 2;
        if (curr.open < prev.close && curr.close > prev.close && curr.close < prevMid) {
            out.push({
                name: 'thrusting_line',
                index: idx,
                direction: 'bullish',
                strength: 0.6,
                priceLevel: curr.close,
                note: 'Bullish candle thrust into the prior bearish body but below its midpoint — weak recovery.'
            });
        }
    }

    return out;
}

// ---------------------------------------------------------------------------
// THREE-CANDLE PATTERNS
// ---------------------------------------------------------------------------

/**
 * Candles arrive newest-first: `curr` is the most recent candle, `prev` the
 * oldest of the three (the sequence start). Patterns "complete" at `curr`, so
 * the reported index is the recent-first index of `curr` — the same anchor
 * convention the two-candle detector uses.
 */
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

    // Three white soldiers: three consecutive strong bullish candles, each
    // opening within the *previous* candle's body, each closing near its
    // high, with rising closes.
    if (isBullish(prev) && isBullish(mid) && isBullish(curr)) {
        const strongBodies = [prev, mid, curr].every(k => Math.abs(bodyPct(k)) > 0.3);
        const closesNearHigh = [prev, mid, curr].every(k => upperWickPct(k) < 30);
        const opensInsidePrevious =
            mid.open >= Math.min(prev.open, prev.close) && mid.open <= Math.max(prev.open, prev.close) &&
            curr.open >= Math.min(mid.open, mid.close) && curr.open <= Math.max(mid.open, mid.close);
        const risingCloses = curr.close > mid.close && mid.close > prev.close;
        if (strongBodies && closesNearHigh && opensInsidePrevious && risingCloses) {
            out.push({
                name: 'three_white_soldiers',
                index: idx,
                direction: 'bullish',
                strength: 0.8,
                priceLevel: curr.close,
                note: 'Three strong bullish candles, each opening within the prior body and closing near its high.'
            });
        }
    }

    // Three black crows: mirror of the soldiers — each opens within the
    // previous body, closes near its low, with falling closes.
    if (isBearish(prev) && isBearish(mid) && isBearish(curr)) {
        const strongBodies = [prev, mid, curr].every(k => Math.abs(bodyPct(k)) > 0.3);
        const closesNearLow = [prev, mid, curr].every(k => lowerWickPct(k) < 30);
        const opensInsidePrevious =
            mid.open >= Math.min(prev.open, prev.close) && mid.open <= Math.max(prev.open, prev.close) &&
            curr.open >= Math.min(mid.open, mid.close) && curr.open <= Math.max(mid.open, mid.close);
        const fallingCloses = curr.close < mid.close && mid.close < prev.close;
        if (strongBodies && closesNearLow && opensInsidePrevious && fallingCloses) {
            out.push({
                name: 'three_black_crows',
                index: idx,
                direction: 'bearish',
                strength: 0.8,
                priceLevel: curr.close,
                note: 'Three strong bearish candles, each opening within the prior body and closing near its low.'
            });
        }
    }

    // Three inside up: bearish → small bullish candle nested inside it →
    // bullish candle closing above the first candle's open. Reversal after a
    // pause (harami + confirmation).
    if (isBearish(prev) && isBullish(mid) && isBullish(curr)) {
        const prevTop = Math.max(prev.open, prev.close);
        const prevBottom = Math.min(prev.open, prev.close);
        const midTop = Math.max(mid.open, mid.close);
        const midBottom = Math.min(mid.open, mid.close);
        if (midTop <= prevTop && midBottom >= prevBottom && curr.close > prev.open) {
            out.push({
                name: 'three_inside_up',
                index: idx,
                direction: 'bullish',
                strength: 0.75,
                priceLevel: curr.close,
                note: 'Small bullish candle inside the bearish body, then a close above it — reversal.'
            });
        }
    }

    // Three inside down: mirror.
    if (isBullish(prev) && isBearish(mid) && isBearish(curr)) {
        const prevTop = Math.max(prev.open, prev.close);
        const prevBottom = Math.min(prev.open, prev.close);
        const midTop = Math.max(mid.open, mid.close);
        const midBottom = Math.min(mid.open, mid.close);
        if (midTop <= prevTop && midBottom >= prevBottom && curr.close < prev.open) {
            out.push({
                name: 'three_inside_down',
                index: idx,
                direction: 'bearish',
                strength: 0.75,
                priceLevel: curr.close,
                note: 'Small bearish candle inside the bullish body, then a close below it — reversal.'
            });
        }
    }

    // Fair value gap: the MIDDLE candle leaves an untraded imbalance zone
    // above the oldest candle's high (bullish FVG) — [prev.high, mid.low] is
    // unfilled liquidity the market often returns to. Requiring the middle
    // candle to create the gap (mid.low > prev.high) AND the newest candle to
    // not have filled it yet (curr.low > prev.high): the old code only tested
    // the newest candle, so zones the middle candle had already traded
    // through were reported as "unfilled".
    if (mid.low > prev.high && curr.low > prev.high) {
        out.push({
            name: 'bullish_fvg',
            index: idx,
            direction: 'bullish',
            strength: 0.6,
            priceLevel: (prev.high + mid.low) / 2,
            note: `Unfilled gap zone between ${prev.high} and ${mid.low} — bullish fair value gap.`
        });
    }
    if (mid.high < prev.low && curr.high < prev.low) {
        out.push({
            name: 'bearish_fvg',
            index: idx,
            direction: 'bearish',
            strength: 0.6,
            priceLevel: (mid.high + prev.low) / 2,
            note: `Unfilled gap zone between ${mid.high} and ${prev.low} — bearish fair value gap.`
        });
    }

    // Abandoned baby: gap, doji, gap — the market jumped OVER a doji. Rare
    // (needs two real gaps) but one of the strongest reversal patterns.
    if (Math.abs(bodyPct(mid)) < 0.1) {
        if (isBearish(prev) && mid.high < prev.low && isBullish(curr) && curr.low > mid.high) {
            out.push({
                name: 'abandoned_baby_bullish',
                index: idx,
                direction: 'bullish',
                strength: 0.9,
                priceLevel: curr.close,
                note: 'Gap down, doji, gap up — sellers abandoned the move, buyers took over.'
            });
        }
        if (isBullish(prev) && mid.low > prev.high && isBearish(curr) && curr.high < mid.low) {
            out.push({
                name: 'abandoned_baby_bearish',
                index: idx,
                direction: 'bearish',
                strength: 0.9,
                priceLevel: curr.close,
                note: 'Gap up, doji, gap down — buyers abandoned the move, sellers took over.'
            });
        }
    }

    // Tri-star: three dojis with drifting closes — extreme indecision
    // resolving in the direction of the drift.
    if ([prev, mid, curr].every(c => Math.abs(bodyPct(c)) < 0.1)) {
        if (curr.close > mid.close && mid.close > prev.close) {
            out.push({
                name: 'tri_star_bullish',
                index: idx,
                direction: 'bullish',
                strength: 0.6,
                priceLevel: curr.close,
                note: 'Three dojis with rising closes — indecision drifting bullish.'
            });
        } else if (curr.close < mid.close && mid.close < prev.close) {
            out.push({
                name: 'tri_star_bearish',
                index: idx,
                direction: 'bearish',
                strength: 0.6,
                priceLevel: curr.close,
                note: 'Three dojis with falling closes — indecision drifting bearish.'
            });
        }
    }

    // Upside gap two crows: after a strong bull, two bears gap up then fade —
    // the second closes below the first but still above the original bull's
    // close. Sellers stepping in right after the gap.
    if (isBullish(prev) && isBearish(mid) && isBearish(curr)) {
        const firstCrowTop = Math.max(mid.open, mid.close);
        const firstCrowBottom = Math.min(mid.open, mid.close);
        const gapUp = mid.low > prev.high;
        const secondOpensInside = curr.open >= firstCrowBottom && curr.open <= firstCrowTop;
        const fadesBelowFirst = curr.close < mid.close;
        const holdsAboveBull = curr.close > prev.close;
        if (gapUp && secondOpensInside && fadesBelowFirst && holdsAboveBull) {
            out.push({
                name: 'upside_gap_two_crows',
                index: idx,
                direction: 'bearish',
                strength: 0.7,
                priceLevel: curr.close,
                note: 'Two bearish candles gapped up after strength and faded into the gap — bearish warning.'
            });
        }
    }

    // Stick sandwich: bull, bear, bull — the middle bear closes AT the first
    // bull's open, then buyers return and close above again. The dip was bought.
    if (isBullish(prev) && isBearish(mid) && isBullish(curr)) {
        const sandwichClose = Math.abs(mid.close - prev.open) / (prev.open || 1) * 100;
        if (sandwichClose < 0.15 && curr.close > prev.close) {
            out.push({
                name: 'stick_sandwich',
                index: idx,
                direction: 'bullish',
                strength: 0.7,
                priceLevel: curr.close,
                note: 'Middle bearish candle closed at the first bullish open, then buyers returned — the dip was bought.'
            });
        }
    }

    return out;
}

// ---------------------------------------------------------------------------
// FOUR-CANDLE PATTERNS
// ---------------------------------------------------------------------------

/**
 * Candles arrive newest-first: c0 is the most recent candle, c3 the oldest
 * of the four. Patterns "complete" at c0; the reported index is c0's
 * recent-first index.
 */
function detectFourCandlePatterns(
    c0: Kline,
    c1: Kline,
    c2: Kline,
    c3: Kline,
    idx: number
): DetectedCandlePattern[] {
    const out: DetectedCandlePattern[] = [];

    // Three-line strike: three strong same-direction candles with rising
    // (bullish) / falling (bearish) closes, then ONE strong opposite candle
    // that closes BEYOND the first candle's open — the counter-move was
    // absorbed and the trend resumes. Continuation pattern.
    if (isBullish(c3) && isBullish(c2) && isBullish(c1) && isBearish(c0)) {
        const rising = c1.close > c2.close && c2.close > c3.close;
        const strikeBody = Math.abs(bodyPct(c0)) > 0.5;
        if (rising && strikeBody && c0.close < c3.open) {
            out.push({
                name: 'three_line_strike_bullish',
                index: idx,
                direction: 'bullish',
                strength: 0.75,
                priceLevel: c0.close,
                note: 'Three rising bullish candles, then a bearish candle closing below the first open — the pullback was absorbed.'
            });
        }
    }
    if (isBearish(c3) && isBearish(c2) && isBearish(c1) && isBullish(c0)) {
        const falling = c1.close < c2.close && c2.close < c3.close;
        const strikeBody = Math.abs(bodyPct(c0)) > 0.5;
        if (falling && strikeBody && c0.close > c3.open) {
            out.push({
                name: 'three_line_strike_bearish',
                index: idx,
                direction: 'bearish',
                strength: 0.75,
                priceLevel: c0.close,
                note: 'Three falling bearish candles, then a bullish candle closing above the first open — the bounce failed.'
            });
        }
    }

    return out;
}

// ---------------------------------------------------------------------------
// FIVE-CANDLE PATTERNS
// ---------------------------------------------------------------------------

/**
 * Candles arrive newest-first: c0 is the most recent (the final confirming
 * candle), c4 the oldest (the first candle of the pattern).
 */
function detectFiveCandlePatterns(
    c0: Kline,
    c1: Kline,
    c2: Kline,
    c3: Kline,
    c4: Kline,
    idx: number
): DetectedCandlePattern[] {
    const out: DetectedCandlePattern[] = [];

    // Rising three methods: strong bull, THREE small bearish candles that
    // pull back WITHIN the first candle's range, then a strong bull closing
    // above the first close. The pause was a consolidation — trend resumes.
    if (isBullish(c4) && isBullish(c0)) {
        const firstBody = Math.abs(bodyPct(c4));
        const pullbacks = [c3, c2, c1].every(c => isBearish(c) && Math.abs(bodyPct(c)) < firstBody * 0.6);
        const pullbacksInside = [c3, c2, c1].every(c => c.high <= c4.high && c.low >= c4.low);
        const finalBody = Math.abs(bodyPct(c0)) > 0.5;
        if (firstBody > 0.5 && pullbacks && pullbacksInside && finalBody && c0.close > c4.close) {
            out.push({
                name: 'rising_three_methods',
                index: idx,
                direction: 'bullish',
                strength: 0.75,
                priceLevel: c0.close,
                note: 'Strong bullish candle, three small bearish pullbacks inside its range, then a strong close above — trend resumed.'
            });
        }
    }

    // Falling three methods: mirror.
    if (isBearish(c4) && isBearish(c0)) {
        const firstBody = Math.abs(bodyPct(c4));
        const pullbacks = [c3, c2, c1].every(c => isBullish(c) && Math.abs(bodyPct(c)) < firstBody * 0.6);
        const pullbacksInside = [c3, c2, c1].every(c => c.high <= c4.high && c.low >= c4.low);
        const finalBody = Math.abs(bodyPct(c0)) > 0.5;
        if (firstBody > 0.5 && pullbacks && pullbacksInside && finalBody && c0.close < c4.close) {
            out.push({
                name: 'falling_three_methods',
                index: idx,
                direction: 'bearish',
                strength: 0.75,
                priceLevel: c0.close,
                note: 'Strong bearish candle, three small bullish pullbacks inside its range, then a strong close below — downtrend resumed.'
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
 *
 * Runs over the recent-first window, so the result lists are ordered
 * newest→oldest: `highs[0]` is the most recent swing high, and the index
 * on each point is a recent-first candle index (0 = most recent candle).
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

    // Swings arrive newest-first (see extractLocalSwings), so [0] is the
    // most recent swing and the first entries are what the model needs to
    // reason about HH/HL vs LH/LL. Index 0 = most recent candle throughout.
    const lastHighs = swings.highs.slice(0, 3);
    const lastLows = swings.lows.slice(0, 3);

    // Double top: the two most recent swing highs within 0.3% of each other
    if (lastHighs.length >= 2) {
        const a = lastHighs[0];
        const b = lastHighs[1];
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
        const a = lastLows[0];
        const b = lastLows[1];
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
        const lastHigh = lastHighs[0].price;
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
        const lastLow = lastLows[0].price;
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

    // CHoCH (change of character): the break happens *after* a sequence of
    // declining swing highs (bullish) / rising swing lows (bearish) — the
    // trend structure flipped, not just a new extreme.
    if (lastHighs.length >= 2 && lastHighs[0].price < lastHighs[1].price && lastCandle.close > lastHighs[0].price) {
        out.push({
            name: 'bullish_cho_ch',
            index: 0,
            direction: 'bullish',
            strength: 0.7,
            priceLevel: lastHighs[0].price,
            note: 'Close broke the most recent swing high after declining highs — change of character.'
        });
    }
    if (lastLows.length >= 2 && lastLows[0].price > lastLows[1].price && lastCandle.close < lastLows[0].price) {
        out.push({
            name: 'bearish_cho_ch',
            index: 0,
            direction: 'bearish',
            strength: 0.7,
            priceLevel: lastLows[0].price,
            note: 'Close broke the most recent swing low after rising lows — change of character.'
        });
    }

    // SFP (sweep of liquidity / failed break): the wick pierces the recent
    // swing level but the close returns inside — the break failed.
    if (lastLows.length > 0) {
        const lastLow = lastLows[0].price;
        if (lastCandle.low < lastLow && lastCandle.close > lastLow) {
            out.push({
                name: 'bullish_sfp',
                index: 0,
                direction: 'bullish',
                strength: 0.7,
                priceLevel: lastLow,
                note: `Low ${lastCandle.low} swept below swing low ${lastLow} but closed back above — failed break.`
            });
        }
    }
    if (lastHighs.length > 0) {
        const lastHigh = lastHighs[0].price;
        if (lastCandle.high > lastHigh && lastCandle.close < lastHigh) {
            out.push({
                name: 'bearish_sfp',
                index: 0,
                direction: 'bearish',
                strength: 0.7,
                priceLevel: lastHigh,
                note: `High ${lastCandle.high} swept above swing high ${lastHigh} but closed back below — failed break.`
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

    // Swings arrive newest-first; each entry is compared against the OLDER
    // swing that follows it in the list, so a newer swing above an older one
    // counts as a higher high — the time direction matches the chart.
    for (let i = 1; i < swings.highs.length; i++) {
        if (swings.highs[i - 1].price > swings.highs[i].price) higherHighs++;
        else if (swings.highs[i - 1].price < swings.highs[i].price) lowerHighs++;
    }
    for (let i = 1; i < swings.lows.length; i++) {
        if (swings.lows[i - 1].price > swings.lows[i].price) higherLows++;
        else if (swings.lows[i - 1].price < swings.lows[i].price) lowerLows++;
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

    // Single-candle patterns on every bar (prior-trend context is computed
    // from the older candles that follow the bar in the recent-first window)
    recentFirst.forEach((c, i) => {
        patterns.push(...detectSingleCandlePatterns(c, i, priorTrendOf(recentFirst, i)));
    });

    // Two-candle patterns
    for (let i = 0; i < windowSize - 1; i++) {
        patterns.push(...detectTwoCandlePatterns(recentFirst[i], recentFirst[i + 1], i));
    }

    // Three-candle patterns
    for (let i = 0; i < windowSize - 2; i++) {
        patterns.push(...detectThreeCandlePatterns(recentFirst[i], recentFirst[i + 1], recentFirst[i + 2], i));
    }

    // Four-candle patterns (three-line strike)
    for (let i = 0; i < windowSize - 3; i++) {
        patterns.push(...detectFourCandlePatterns(recentFirst[i], recentFirst[i + 1], recentFirst[i + 2], recentFirst[i + 3], i));
    }

    // Five-candle patterns (rising / falling three methods)
    for (let i = 0; i < windowSize - 4; i++) {
        patterns.push(...detectFiveCandlePatterns(recentFirst[i], recentFirst[i + 1], recentFirst[i + 2], recentFirst[i + 3], recentFirst[i + 4], i));
    }

    // Structure patterns need local swings; extraction runs over the same
    // recent-first array (swing lists come back newest-first).
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
        ? swings.highs[0].price
        : undefined;
    const recentSwingLow = swings.lows.length > 0
        ? swings.lows[0].price
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
