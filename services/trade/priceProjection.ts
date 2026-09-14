/**
 * priceProjection — a deterministic "what could come next" cone the models
 * can pull through the project_future_price desk tool.
 *
 * Pure + dependency-free (like setupScan): no React, no network, unit
 * testable. The math is deliberately humble — an ATR cone around a clamped
 * drift line, NOT a prediction:
 * - ATR(14, Wilder) sets the width; the cone grows with sqrt(horizon), the
 *   way random-walk dispersion actually scales.
 * - Drift is the EMA20 slope over the last 5 bars, clamped to half an ATR
 *   per bar so a vertical week cannot draw a vertical future.
 * - Trend is EMA20 vs EMA50 in ATR units (up / down / range).
 *
 * The receipt labels itself a projection with an uncertainty note so the
 * model can show possible paths without stating them as forecasts.
 */

export interface ProjectionCandle {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
}

export type ProjectionTrend = 'up' | 'down' | 'range';

export interface ProjectionPath {
    lastClose: number;
    atr: number;
    driftPerBar: number;
    trend: ProjectionTrend;
    horizon: number;
    /** Base path per bar ahead (index 0 = 1 bar ahead). */
    base: number[];
    /** Base + one ATR-cone half-width per bar ahead. */
    bull: number[];
    /** Base − one ATR-cone half-width per bar ahead. */
    bear: number[];
}

export const PROJECTION_MIN_CANDLES = 20;
export const PROJECTION_MAX_HORIZON = 96;

const round2 = (v: number): number => Math.round(v * 100) / 100;

/** Wilder ATR(14); falls back to the mean true range on short tapes. */
export const averageTrueRange = (candles: ProjectionCandle[], period = 14): number => {
    if (candles.length < 2) return 0;
    const trs: number[] = candles.slice(1).map((c, i) => {
        const prev = candles[i].close;
        return Math.max(c.high - c.low, Math.abs(c.high - prev), Math.abs(c.low - prev));
    });
    if (trs.length <= period) return trs.reduce((s, v) => s + v, 0) / trs.length;
    let atr = trs.slice(0, period).reduce((s, v) => s + v, 0) / period;
    for (let i = period; i < trs.length; i += 1) atr = (atr * (period - 1) + trs[i]) / period;
    return atr;
};

const emaLast = (values: number[], period: number): number => {
    const k = 2 / (period + 1);
    let e = values[0];
    for (let i = 1; i < values.length; i += 1) e = values[i] * k + e * (1 - k);
    return e;
};

const emaSeries = (values: number[], period: number): number[] => {
    const k = 2 / (period + 1);
    const out: number[] = [];
    let e = values[0];
    out.push(e);
    for (let i = 1; i < values.length; i += 1) {
        e = values[i] * k + e * (1 - k);
        out.push(e);
    }
    return out;
};

export const projectPrices = (candles: ProjectionCandle[], horizonBars = 24): ProjectionPath => {
    if (candles.length < PROJECTION_MIN_CANDLES) {
        throw new Error(`project_future_price needs at least ${PROJECTION_MIN_CANDLES} candles (got ${candles.length})`);
    }
    const horizon = Math.min(Math.max(Math.round(horizonBars) || 24, 1), PROJECTION_MAX_HORIZON);
    const closes = candles.map(c => c.close);
    const lastClose = closes[closes.length - 1];
    const atr = averageTrueRange(candles);
    const ema20 = emaSeries(closes, Math.min(20, closes.length));
    const ema50 = emaLast(closes, Math.min(50, closes.length));
    const gap = atr > 0 ? (ema20[ema20.length - 1] - ema50) / atr : 0;
    const trend: ProjectionTrend = gap > 0.1 ? 'up' : gap < -0.1 ? 'down' : 'range';
    // EMA20 slope over the last 5 bars, clamped so a stretched tape cannot
    // project a straight line to the moon.
    const lookback = Math.min(5, ema20.length - 1);
    const rawDrift = (ema20[ema20.length - 1] - ema20[ema20.length - 1 - lookback]) / lookback;
    const cap = atr > 0 ? atr * 0.5 : Math.abs(lastClose) * 0.005;
    const driftPerBar = Math.min(Math.max(rawDrift, -cap), cap);
    const base: number[] = [];
    const bull: number[] = [];
    const bear: number[] = [];
    for (let h = 1; h <= horizon; h += 1) {
        const center = lastClose + driftPerBar * h;
        const half = atr > 0 ? atr * Math.sqrt(h) : Math.abs(lastClose) * 0.005 * Math.sqrt(h);
        base.push(round2(center));
        bull.push(round2(center + half));
        bear.push(round2(Math.max(center - half, 0)));
    }
    return { lastClose: round2(lastClose), atr: round2(atr), driftPerBar: round2(driftPerBar), trend, horizon, base, bull, bear };
};

const fmtPx = (v: number): string =>
    v.toLocaleString('en-US', { maximumFractionDigits: v >= 1000 ? 0 : 2 });

/** Compact machine-readable receipt: 5 checkpoints, never the full path. */
export const projectionToMarkdown = (symbol: string, interval: string, path: ProjectionPath): string => {
    const endBase = path.base[path.base.length - 1];
    const movePct = path.lastClose > 0 ? ((endBase / path.lastClose - 1) * 100).toFixed(2) : '0.00';
    const steps = [1, 2, 3, 4, 5]
        .map(i => Math.min(path.horizon, Math.round((path.horizon * i) / 5)))
        .filter((v, i, a) => a.indexOf(v) === i);
    const lines = [
        `PRICE PROJECTION ${symbol} ${interval} — last ${fmtPx(path.lastClose)}, ATR ${fmtPx(path.atr)}, trend ${path.trend}, drift ${path.driftPerBar >= 0 ? '+' : ''}${fmtPx(path.driftPerBar)}/bar, horizon ${path.horizon} bars:`,
        ...steps.map(h => `+${h} bars: base ${fmtPx(path.base[h - 1])} · bull ${fmtPx(path.bull[h - 1])} · bear ${fmtPx(path.bear[h - 1])}`),
        `Base end ${fmtPx(endBase)} (${Number(movePct) >= 0 ? '+' : ''}${movePct}%) · bull end ${fmtPx(path.bull[path.bull.length - 1])} · bear end ${fmtPx(path.bear[path.bear.length - 1])}.`,
        'Deterministic ATR cone from recent candles, NOT a prediction — the wider the cone, the less certain the path. Quote it as possibilities, never as a forecast.',
    ];
    return lines.join('\n');
};
