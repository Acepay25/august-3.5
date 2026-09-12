/**
 * candleFormations — pure, code-calculated candle-formation + market-structure
 * read for the desk tools. Feeds get_all_timeframes so the model gets the
 * SAME visual read the user gets from staring at the candles: engulfings,
 * pins, inside bars, exhaustion bars and the swing structure (HH/HL vs LH/LL)
 * over the recent window. No React, no network — unit-testable.
 */

export interface FormationCandle {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
}

/** How many trailing bars the scanner inspects. */
export const FORMATION_WINDOW = 12;

const body = (c: FormationCandle): number => Math.abs(c.close - c.open);
const range = (c: FormationCandle): number => Math.max(c.high - c.low, Number.EPSILON);
const upperWick = (c: FormationCandle): number => c.high - Math.max(c.open, c.close);
const lowerWick = (c: FormationCandle): number => Math.min(c.open, c.close) - c.low;
const isBull = (c: FormationCandle): boolean => c.close >= c.open;

/**
 * Detect named formations over the trailing window. Returns one human line
 * per hit, newest last, e.g. "bullish engulfing at 77,100 (2 bars ago)".
 * Tolerant by design: each rule is independent and a candle may match none.
 */
export const detectCandleFormations = (candles: FormationCandle[]): string[] => {
    const out: string[] = [];
    if (candles.length < 2) return out;
    const scan = candles.slice(-FORMATION_WINDOW);
    const n = scan.length;
    const fmt = (v: number): string => v.toLocaleString('en-US', { maximumFractionDigits: v >= 1000 ? 0 : 2 });
    const ago = (i: number): string => {
        const bars = n - 1 - i;
        return bars === 0 ? 'current bar' : bars === 1 ? '1 bar ago' : `${bars} bars ago`;
    };

    for (let i = 1; i < n; i += 1) {
        const c = scan[i];
        const prev = scan[i - 1];
        const price = fmt(c.close);

        // Engulfing: body of the current bar swallows the previous body,
        // opposite colors, and the current body is not tiny.
        if (isBull(c) && !isBull(prev)
            && c.close >= prev.open && c.open <= prev.close
            && body(c) > body(prev) * 1.1) {
            out.push(`bullish engulfing at ${price} (${ago(i)})`);
        } else if (!isBull(c) && isBull(prev)
            && c.close <= prev.open && c.open >= prev.close
            && body(c) > body(prev) * 1.1) {
            out.push(`bearish engulfing at ${price} (${ago(i)})`);
        }

        // Hammer / shooting star: small body, wick >= 2x body, other wick tiny.
        if (body(c) < range(c) * 0.38) {
            if (lowerWick(c) >= body(c) * 2 && upperWick(c) <= body(c) * 1.2) {
                out.push(`hammer (buy wick) at ${price} (${ago(i)})`);
            } else if (upperWick(c) >= body(c) * 2 && lowerWick(c) <= body(c) * 1.2) {
                out.push(`shooting star (sell wick) at ${price} (${ago(i)})`);
            } else if (body(c) < range(c) * 0.12) {
                out.push(`doji (indecision) at ${price} (${ago(i)})`);
            }
        }

        // Inside bar: current range entirely inside the previous range —
        // contraction before expansion.
        if (c.high <= prev.high && c.low >= prev.low) {
            out.push(`inside bar (contraction) at ${price} (${ago(i)})`);
        }

        // Exhaustion/impulse bar: range >= 1.8x the average of the prior bars.
        const prior = scan.slice(Math.max(0, i - 6), i);
        if (prior.length >= 3) {
            const avgRange = prior.reduce((s, x) => s + range(x), 0) / prior.length;
            if (range(c) >= avgRange * 1.8) {
                out.push(`${isBull(c) ? 'bullish impulse' : 'bearish impulse'} bar at ${price} (${ago(i)})`);
            }
        }
    }
    return out;
};

/**
 * Swing-structure read over the window: compare the last two swing highs and
 * lows (a swing = bar higher than one neighbor on each side). Returns one
 * line like "uptrend structure — higher highs and higher lows" or
 * "range — highs and lows flat" / "not enough swings".
 */
export const describeMarketStructure = (candles: FormationCandle[]): string => {
    if (candles.length < 5) return 'not enough candles for structure';
    const scan = candles.slice(-Math.max(FORMATION_WINDOW + 6, 20));
    const highs: number[] = [];
    const lows: number[] = [];
    for (let i = 1; i < scan.length - 1; i += 1) {
        if (scan[i].high >= scan[i - 1].high && scan[i].high > scan[i + 1].high) highs.push(scan[i].high);
        if (scan[i].low <= scan[i - 1].low && scan[i].low < scan[i + 1].low) lows.push(scan[i].low);
    }
    if (highs.length < 2 || lows.length < 2) return 'not enough swings for structure';
    const higherHighs = highs[highs.length - 1] > highs[highs.length - 2];
    const higherLows = lows[lows.length - 1] > lows[lows.length - 2];
    if (higherHighs && higherLows) return 'uptrend structure — higher highs and higher lows';
    if (!higherHighs && !higherLows) return 'downtrend structure — lower highs and lower lows';
    return 'range/compression — highs and lows disagree';
};
