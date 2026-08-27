/**
 * Phase 4 — level / pattern keyword sets.
 *
 * The preflight gate rejects lens responses whose DATA line contains no
 * number, no level keyword, and no pattern keyword. The keyword sets are
 * the single source of truth — exported so tests, the gate itself, and
 * any downstream summarizer share the same vocabulary.
 */

export const LEVEL_OR_VALUE = /(\d+(\.\d+)?|support|resistance|FVG|order[\s-]?block|BOS|CHoCH|break(?:out)?|close|cross|reclaim|sweep|stop|target|entry|fill|wick|doji|candle|bar|HTF|LTF|ATR|RSI|MACD|EMA|SMA|ADX|volume)/i;

export const PATTERN = /(head[\s-]?and[\s-]?shoulders|triangle|wedge|flag|pennant|range|trending|consolidat|breakout|engulfing|hammer|doji|star|reversal|continuation|sweep|liquidity|trend|momentum|divergence|reclaim|retest|failed[\s-]?break|double[\s-]?top|double[\s-]?bottom|cup[\s-]?and[\s-]?handle)/i;

/** A DATA line is "specific" when it contains a number, level keyword, or
 *  pattern keyword. The gate rejects DATA lines that match none of these.
 *  The minimum length (10 chars) keeps a single keyword token like "level"
 *  from passing on its own; the regex match is the real signal. */
export const isSpecificData = (data: string): boolean => {
    if (!data) return false;
    const trimmed = data.trim();
    if (trimmed.length < 10) return false;
    return LEVEL_OR_VALUE.test(trimmed) || PATTERN.test(trimmed);
};
