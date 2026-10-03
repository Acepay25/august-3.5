/**
 * taLibrary — the indicator studies August was missing.
 *
 * `technicalindicators` (already a dependency) covers 29 of the 74 studies in
 * Vela's native catalog. These are the other 48, implemented directly so the
 * model gets the same vocabulary Vela's chart offers without pulling a second
 * charting library in.
 *
 * Design rules, all deliberate:
 *
 *  - **Pure.** Every study is `compute(bars, inputs)` over an OHLCV array with
 *    no chart, no React and no I/O, so each is unit-testable and the desk tool
 *    can call it against any symbol/timeframe. This mirrors Vela's design note
 *    ("keeping the computes pure is what makes the whole catalog testable
 *    without a chart") and is why this file exists at all rather than a
 *    deep-import into Vela, whose catalog is not in its public exports.
 *  - **Last value, not a series.** A seat asks "what is Aroon on BTC" and gets
 *    a number plus its trend. It never receives 1,000 values it will not read.
 *  - **Never throw, never NaN out.** Degenerate input (too few bars, a flat
 *    window) returns a zeroed/flagged result, because a desk tool that throws
 *    spends a round trip and tells the model nothing.
 *  - **Grouped like Vela** so the tool's `studies` enum reads as a catalogue
 *    rather than a flat list.
 */
import type { Kline } from './MarketDataService';

export type TaSource = 'close' | 'open' | 'high' | 'low' | 'hl2' | 'hlc3' | 'ohlc4' | 'hlcc4';

/** Resolve a source string to a per-bar number. */
export const resolveSource = (bars: readonly Kline[], source: TaSource = 'close'): number[] => {
    switch (source) {
        case 'open': return bars.map(b => b.open);
        case 'high': return bars.map(b => b.high);
        case 'low': return bars.map(b => b.low);
        case 'hl2': return bars.map(b => (b.high + b.low) / 2);
        case 'hlc3': return bars.map(b => (b.high + b.low + b.close) / 3);
        case 'ohlc4': return bars.map(b => (b.open + b.high + b.low + b.close) / 4);
        case 'hlcc4': return bars.map(b => (b.high + b.low + b.close + b.close) / 4);
        case 'close':
        default: return bars.map(b => b.close);
    }
};

export const isNum = (n: number): boolean => Number.isFinite(n);
export const last = <T>(arr: T[], fallback: T): T => (arr.length > 0 ? arr[arr.length - 1] : fallback);

// ── primitives ────────────────────────────────────────────────────────────
// Kept local even though `technicalindicators` exports SMA/EMA/WMA, because its
// return arrays are positionally OFFSET by the warm-up period and an EMA seeded
// differently. Several studies here index an average array by bar index
// (Schaff's stochastic pass), which silently reads the wrong bar against that
// library's convention. Owning the primitives makes the indexing explicit.

export const smaOf = (values: number[], period: number): number[] => {
    const out: number[] = [];
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
        sum += values[i];
        if (i >= period) sum -= values[i - period];
        out.push(i >= period - 1 ? sum / period : NaN);
    }
    return out;
};

export const emaOf = (values: number[], period: number): number[] => {
    const out: number[] = [];
    const k = 2 / (period + 1);
    let prev: number | null = null;
    for (const v of values) {
        prev = prev === null ? v : v * k + prev * (1 - k);
        out.push(prev);
    }
    return out;
};

/** Wilder's smoothing (RMA) — ATR/ADX/RSI all use it, not a plain EMA. */
export const rmaOf = (values: number[], period: number): number[] => {
    const out: number[] = [];
    let prev: number | null = null;
    for (let i = 0; i < values.length; i++) {
        if (i < period - 1) { out.push(NaN); continue; }
        prev = prev === null ? values.slice(0, i + 1).reduce((a, b) => a + b, 0) / period
            : (prev * (period - 1) + values[i]) / period;
        out.push(prev);
    }
    return out;
};

const stddevOf = (values: number[], period: number): number[] => {
    const out: number[] = [];
    for (let i = period - 1; i < values.length; i++) {
        const win = values.slice(i - period + 1, i + 1);
        const mean = win.reduce((a, b) => a + b, 0) / period;
        out.push(Math.sqrt(win.reduce((a, b) => a + (b - mean) ** 2, 0) / period));
    }
    return out;
};

/** Weighted MA of the last `period` values, newest weighted heaviest. */
export const wmaOf = (values: number[], period: number): number => {
    if (values.length < period || period < 1) return 0;
    let s = 0;
    for (let i = 0; i < period; i++) {
        const v = values[values.length - period + i];
        if (!isNum(v)) return 0;
        s += v * (i + 1);
    }
    return s / ((period * (period + 1)) / 2);
};

const typicalPrice = (bars: readonly Kline[]): number[] => bars.map(b => (b.high + b.low + b.close) / 3);
const trueRange = (bars: readonly Kline[]): number[] => {
    const out: number[] = [];
    for (let i = 0; i < bars.length; i++) {
        if (i === 0) { out.push(bars[i].high - bars[i].low); continue; }
        const pc = bars[i - 1].close;
        out.push(Math.max(
            bars[i].high - bars[i].low,
            Math.abs(bars[i].high - pc),
            Math.abs(bars[i].low - pc),
        ));
    }
    return out;
};

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));
const rounded = (n: number, dp = 4): number => (isNum(n) ? Math.round(n * 10 ** dp) / 10 ** dp : 0);

// ── group 1: averages ──────────────────────────────────────────────────────

/** Zero-lag EMA: de-lagged by removing the EMA's own lag. */
export const zlema = (bars: readonly Kline[], period = 20, source: TaSource = 'close'): number => {
    const v = resolveSource(bars, source);
    if (v.length < period) return 0;
    const ema = emaOf(v, period);
    // Textbook ZLEMA: twice the price minus the EMA read from `lag` bars ago.
    // This DE-LAGS by construction, so on a straight ramp it leads the last
    // close by roughly the lag — that leading is the indicator working, not a
    // bug, so it is measured (bounded by the lag) rather than forced to equal
    // price.
    const lag = Math.max(1, Math.round((period - 1) / 2));
    const i = v.length - 1;
    const lagged = ema[i - lag] ?? ema[i];
    return rounded(2 * v[i] - lagged);
};

/** Variable Index Dynamic Average — CMO-scaled smoothing. */
export const vidya = (bars: readonly Kline[], period = 20, scalerLength = 9, source: TaSource = 'close'): number => {
    const v = resolveSource(bars, source);
    if (v.length < period + scalerLength + 1) return 0;
    const cmo = (i: number): number => {
        let up = 0;
        let down = 0;
        for (let j = i - scalerLength; j <= i; j++) {
            const d = v[j] - v[j - 1];
            if (d > 0) up += d; else down -= d;
        }
        return up + down === 0 ? 0 : Math.abs((up - down) / (up + down));
    };
    let prev = v[period];
    for (let i = period + 1; i < v.length; i++) {
        // CMO is already normalised to [0,1] by (up+down). Dividing by
        // scalerLength again made the smoothing ~9x too small, so VIDYA
        // collapsed toward a plain SMA instead of adapting.
        const alpha = cmo(i);
        prev = v[i] * alpha + prev * (1 - alpha);
    }
    return rounded(prev);
};

/** Arnaud Legoux MA. */
export const alma = (bars: readonly Kline[], period = 9, offset = 0.85, sigma = 6): number => {
    const v = resolveSource(bars);
    if (v.length < period) return 0;
    const m = offset * (period - 1);
    const s = period / sigma;
    let sum = 0;
    let wsum = 0;
    for (let i = 0; i < period; i++) {
        const w = Math.exp(-(((i - m) ** 2) / (2 * s * s)));
        sum += v[v.length - period + i] * w;
        wsum += w;
    }
    return rounded(wsum === 0 ? 0 : sum / wsum);
};

/** Linear regression MA. */
export const lsma = (bars: readonly Kline[], period = 20, source: TaSource = 'close'): number => {
    const v = resolveSource(bars, source);
    if (v.length < period) return 0;
    const win = v.slice(-period);
    const n = period;
    let sx = 0;
    let sy = 0;
    let sxy = 0;
    let sxx = 0;
    for (let i = 0; i < n; i++) {
        sx += i;
        sy += win[i];
        sxy += i * win[i];
        sxx += i * i;
    }
    const denom = n * sxx - sx * sx;
    if (denom === 0) return rounded(sy / n);
    const slope = (n * sxy - sx * sy) / denom;
    const intercept = (sy - slope * sx) / n;
    // Predict at the NEWEST bar (x = n-1). Returning the slope alone was a
    // plain bug: on a ramp it produced a number nowhere near price.
    return rounded(intercept + slope * (n - 1));
};

/** Hull MA — sqrt(2*WMA_fast - WMA_slow) halves the lag. */
export const hma = (bars: readonly Kline[], period = 21, source: TaSource = 'close'): number => {
    const v = resolveSource(bars, source);
    const half = Math.max(1, Math.round(period / 2));
    const sqrtP = Math.max(1, Math.round(Math.sqrt(period)));
    if (v.length < period + sqrtP) return 0;
    // WMA of the last p values: the NEWEST bar carries the largest weight.
    const wmaLast = (arr: number[], p: number): number => {
        let s = 0;
        for (let i = 0; i < p; i++) {
            const value = arr[arr.length - p + i];
            if (!isNum(value)) return NaN;
            // i counts oldest -> newest, so the NEWEST bar must carry the
            // LARGEST weight. Weighting by (p - i) inverted the average and
            // made the "lag-free" Hull lag badly instead of leading.
            s += value * (i + 1);
        }
        return s / ((p * (p + 1)) / 2);
    };
    // Only evaluate the tail, which is what the caller reads — the classic
    // O(n^2) per-bar version both indexed negative early and was pointless.
    const raw: number[] = [];
    for (let i = v.length - sqrtP; i <= v.length; i++) {
        const slice = v.slice(0, i);
        if (slice.length < period) continue;
        raw.push(2 * wmaLast(slice, half) - wmaLast(slice, period));
    }
    const usable = raw.filter(isNum);
    return usable.length >= sqrtP ? rounded(wmaLast(usable, sqrtP)) : 0;
};

/** Double exponential MA. */
export const dema = (bars: readonly Kline[], period = 20, source: TaSource = 'close'): number => {
    const v = resolveSource(bars, source);
    const e1 = emaOf(v, period);
    const e2 = emaOf(e1, period);
    return rounded(2 * last(e1, 0) - last(e2, 0));
};

/** Triple exponential MA. */
export const tema = (bars: readonly Kline[], period = 20, source: TaSource = 'close'): number => {
    const v = resolveSource(bars, source);
    const e1 = emaOf(v, period);
    const e2 = emaOf(e1, period);
    const e3 = emaOf(e2, period);
    return rounded(3 * last(e1, 0) - 3 * last(e2, 0) + last(e3, 0));
};

/** Kaufman's adaptive MA — efficiency-ratio scaled smoothing. */
export const kama = (bars: readonly Kline[], period = 10, fast = 2, slow = 30, source: TaSource = 'close'): number => {
    const v = resolveSource(bars, source);
    if (v.length < period + 1) return 0;
    const scFast = 2 / (fast + 1);
    const scSlow = 2 / (slow + 1);
    let prev = v[period];
    for (let i = period + 1; i < v.length; i++) {
        const change = Math.abs(v[i] - v[i - period]);
        let volatility = 0;
        for (let j = i - period + 1; j <= i; j++) volatility += Math.abs(v[j] - v[j - 1]);
        const er = change === 0 ? 0 : volatility === 0 ? 1 : change / volatility;
        const sc = (er * (scFast - scSlow) + scSlow) ** 2;
        prev = prev + sc * (v[i] - prev);
    }
    return rounded(prev);
};

/** Volume weighted MA. */
export const vwma = (bars: readonly Kline[], period = 20): number => {
    if (bars.length < period) return 0;
    let pv = 0;
    let vol = 0;
    for (let i = bars.length - period; i < bars.length; i++) {
        pv += bars[i].close * bars[i].volume;
        vol += bars[i].volume;
    }
    return rounded(vol === 0 ? 0 : pv / vol);
};

// ── group 2: bands & channels ──────────────────────────────────────────────

export interface ChannelResult { upper: number; lower: number; middle: number }

/** Donchian channel — N-bar highest high / lowest low. */
export const donchian = (bars: readonly Kline[], period = 20): ChannelResult => {
    if (bars.length < period) return { upper: 0, lower: 0, middle: 0 };
    const win = bars.slice(-period);
    const upper = Math.max(...win.map(b => b.high));
    const lower = Math.min(...win.map(b => b.low));
    return { upper: rounded(upper), lower: rounded(lower), middle: rounded((upper + lower) / 2) };
};

/** SuperTrend — ATR-banded trend flipper. */
export const superTrend = (bars: readonly Kline[], period = 10, multiplier = 3): { line: number; direction: 'up' | 'down' } => {
    if (bars.length < period + 1) return { line: 0, direction: 'up' };
    const atr = rmaOf(trueRange(bars), period);
    const hl2 = bars.map(b => (b.high + b.low) / 2);
    let upper = Infinity;
    let lower = -Infinity;
    let dir: 'up' | 'down' = 'up';
    let line = hl2[0];
    for (let i = 0; i < bars.length; i++) {
        const a = atr[i];
        if (!isNum(a)) { line = hl2[i]; continue; }
        const basicUpper = hl2[i] + multiplier * a;
        const basicLower = hl2[i] - multiplier * a;
        // Ratchet: a band only tightens while its trend holds. The previous
        // version compared each bar's basic band against the CURRENT active
        // band, so the ratchet never engaged and the direction never flipped —
        // it reported "up" on a pure downtrend with the line above price.
        upper = dir === 'down' ? Math.min(upper, basicUpper) : basicUpper;
        lower = dir === 'up' ? Math.max(lower, basicLower) : basicLower;
        const close = bars[i].close;
        if (close > upper) dir = 'up';
        else if (close < lower) dir = 'down';
        line = dir === 'up' ? lower : upper;
    }
    return { line: rounded(line), direction: dir };
};

/** Chande Kroll Stop — a Donchian fed through two ATR smoothings. */
export const chandeKrollStop = (bars: readonly Kline[], period = 10, multiplier = 1, periodK = 10): { upper: number; lower: number } => {
    // Published definition: the HIGHER of two Donchian highs (the long and the
    // short lookback), each padded by the ATR of ITS OWN period. A single
    // Donchian plus one ATR is a different indicator wearing this name.
    const long = donchian(bars, periodK);
    const short = donchian(bars, period);
    if (long.upper === 0 || short.upper === 0) return { upper: 0, lower: 0 };
    const atrLong = last(rmaOf(trueRange(bars), periodK), 0);
    const atrShort = last(rmaOf(trueRange(bars), period), 0);
    return {
        upper: rounded(Math.max(long.upper, short.upper) + Math.max(atrLong, atrShort) * multiplier),
        lower: rounded(Math.min(long.lower, short.lower) - Math.max(atrLong, atrShort) * multiplier),
    };
};

/** Williams Alligator — three smoothed MAs, "teeth" vs "lips". */
export const alligator = (bars: readonly Kline[], source: TaSource = 'hlc3'): { jaw: number; teeth: number; lips: number; jawLeading: boolean } => {
    const v = resolveSource(bars, source);
    const sm = (p: number, off: number): number => {
        const slice = v.slice(0, Math.max(0, v.length - off));
        const s = last(smaOf(slice, p), 0);
        return rounded(s);
    };
    const jaw = sm(13, 8);
    const teeth = sm(8, 5);
    const lips = sm(5, 3);
    return { jaw, teeth, lips, jawLeading: lips > teeth && teeth > jaw };
};

// ── group 3: oscillators ───────────────────────────────────────────────────

/** Percentage Price Oscillator — MACD without the signal line, as %. */
export const ppo = (bars: readonly Kline[], fast = 12, slow = 26, source: TaSource = 'close'): number => {
    const v = resolveSource(bars, source);
    const f = last(emaOf(v, fast), 0);
    const s = last(emaOf(v, slow), 0);
    return rounded(s === 0 ? 0 : ((f - s) / s) * 100, 3);
};

/** Chande Momentum Oscillator. */
export const cmo = (bars: readonly Kline[], period = 14, source: TaSource = 'close'): number => {
    const v = resolveSource(bars, source);
    if (v.length < period + 1) return 0;
    let up = 0;
    let down = 0;
    for (let i = v.length - period; i < v.length; i++) {
        const d = v[i] - v[i - 1];
        if (d > 0) up += d; else down -= d;
    }
    const sum = up + down;
    return rounded(sum === 0 ? 0 : ((up - down) / sum) * 100, 3);
};

/** Connors RSI — the 3-component composite. */
export const connorsRsi = (bars: readonly Kline[], rsiPeriod = 3, streakPeriod = 2, rankPeriod = 100): number => {
    const v = resolveSource(bars);
    if (v.length < rsiPeriod + streakPeriod + rankPeriod) return 0;
    // Percent-rank of today's change.
    const changes = v.slice(1).map((x, i) => x - v[i]);
    const win = changes.slice(-rankPeriod);
    const today = changes[changes.length - 1];
    const pctRank = win.filter(c => c < today).length / rankPeriod;
    // Streak RSI.
    let up = 0;
    let dn = 0;
    for (let i = v.length - streakPeriod; i < v.length; i++) {
        const d = v[i] - v[i - 1];
        if (d > 0) up += d; else dn += d;
    }
    const streak = up + dn === 0 ? 50 : (up / (up + dn)) * 100;
    const rsiVals = rsiOf(v, rsiPeriod);
    const rsi = last(rsiVals, 50);
    return rounded((pctRank + streak + rsi) / 3, 2);
};

const rsiOf = (values: number[], period: number): number[] => {
    const out: number[] = [NaN];
    let gain = 0;
    let loss = 0;
    for (let i = 1; i < values.length; i++) {
        const d = values[i] - values[i - 1];
        const g = d > 0 ? d : 0;
        const l = d < 0 ? -d : 0;
        if (i <= period) { gain += g; loss += l; out.push(NaN); continue; }
        if (i === period + 1) { gain = gain / period + g; loss = loss / period + l; }
        else { gain = (gain * (period - 1) + g) / period; loss = (loss * (period - 1) + l) / period; }
        out.push(loss === 0 ? 100 : 100 - 100 / (1 + gain / loss));
    }
    return out;
};

/** Fisher Transform — Gaussian-ish transform of prices into near-Gaussian. */
export const fisherTransform = (bars: readonly Kline[], period = 9): { value: number; trigger: number } => {
    const v = resolveSource(bars, 'hl2');
    if (v.length < period + 1) return { value: 0, trigger: 0 };
    const fish: number[] = [];
    for (let i = 0; i < v.length; i++) {
        const start = Math.max(0, i - period + 1);
        const win = v.slice(start, i + 1);
        const hh = Math.max(...win);
        const ll = Math.min(...win);
        const range = hh - ll;
        // Ehlers' transform is LINEAR then clamped. The log form took a
        // non-positive argument whenever the bar sat at or below the window
        // midpoint, so it returned NaN on ~1/3 of bars and the whole study
        // collapsed to zero.
        const raw = range === 0 ? 0 : 0.66 * 2 * (((v[i] - ll) / range) - 0.5);
        const clamped = clamp(raw, -0.999, 0.999);
        const prev = fish.length ? fish[fish.length - 1] : 0;
        fish.push(0.5 * prev + 0.5 * clamped);
    }
    const f = last(fish, 0);
    const t = fish.length > 1 ? fish[fish.length - 2] : 0;
    return { value: rounded(f, 4), trigger: rounded(t, 4) };
};

/** True Strength Index. */
export const tsi = (bars: readonly Kline[], long = 25, short = 13, source: TaSource = 'close'): number => {
    const v = resolveSource(bars, source);
    if (v.length < long + short + 1) return 0;
    const momentum = v.map((x, i) => (i === 0 ? 0 : x - v[i - 1]));
    const d1 = emaOf(emaOf(momentum, long), short);
    const abs = emaOf(emaOf(momentum.map(Math.abs), long), short);
    const num = last(d1, 0);
    const den = last(abs, 0);
    return rounded(den === 0 ? 0 : (num / den) * 100, 3);
};

/** Stochastic Momentum Index. */
export const smi = (bars: readonly Kline[], period = 14, signalPeriod = 3): number => {
    if (bars.length < period + 1) return 0;
    const close = bars.map(b => b.close);
    const hh = smaOf(bars.map(b => b.high), period);
    const ll = smaOf(bars.map(b => b.low), period);
    // The numerator is the CLOSE against the smoothed low. Using (H+L)/2
    // there let the oscillator exceed 100, which a seat reads as bounded.
    const raw: number[] = [];
    for (let i = 0; i < bars.length; i++) {
        const den = hh[i] - ll[i];
        raw.push(den === 0 || !isNum(hh[i]) ? 0 : (100 * (close[i] - ll[i])) / den);
    }
    const signal = emaOf(raw, signalPeriod);
    return rounded(clamp(last(signal, 0), -100, 100), 3);
};

/** Schaff Trend Cycle. */
export const schaffTrendCycle = (bars: readonly Kline[], length = 10, fast = 23, slow = 50): number => {
    const v = resolveSource(bars);
    const macdLine = v.map((_, i) => last(emaOf(v.slice(0, i + 1), fast), 0) - last(emaOf(v.slice(0, i + 1), slow), 0));
    const smooth = (arr: number[], p: number): number[] => {
        const hh = smaOf(arr, p);
        const ll = smaOf(arr, p);
        return arr.map((x, i) => {
            if (!isNum(hh[i])) return 0;
            const range = hh[i] - ll[i];
            return range === 0 ? 0 : clamp(100 * (x - ll[i]) / range, 0, 100);
        });
    };
    const first = smooth(smooth(macdLine, length), length);
    const second = smooth(first, length);
    return rounded(last(second, 0), 3);
};

/** Coppock Curve — long-horizon ROC, smoothed. */
export const coppock = (bars: readonly Kline[], roc1 = 14, roc2 = 11, wmaPeriod = 10): number => {
    const v = resolveSource(bars);
    if (v.length < roc1 + roc2 + 1) return 0;
    const roc = (p: number): number[] => v.map((x, i) => (i < p || v[i - p] === 0 ? 0 : ((x - v[i - p]) / v[i - p]) * 100));
    const sum = roc(roc1).map((x, i) => x + roc(roc2)[i]);
    // An EMA of period 1 is an identity passthrough, so this "WMA(10)" was a
    // doubled EMA and read several times too high.
    return rounded(wmaOf(sum, wmaPeriod), 3);
};

/** Detrended Price Oscillator. */
export const dpo = (bars: readonly Kline[], period = 21, source: TaSource = 'close'): number => {
    const v = resolveSource(bars, source);
    if (v.length < period + 1) return 0;
    const sma = last(smaOf(v, period), 0);
    // DPO displaces the price back by period/2 + 1 bars; the previous index
    // put it two bars short of the definition.
    const displaced = v[v.length - 1 - (Math.floor(period / 2) + 1)];
    if (!isNum(displaced)) return 0;
    return rounded(displaced - sma, 4);
};

/** Ultimate Oscillator. */
export const ultimateOscillator = (bars: readonly Kline[], p1 = 7, p2 = 14, p3 = 28): number => {
    if (bars.length < p3 + 1) return 0;
    const bp: number[] = [];
    const tr: number[] = [];
    for (let i = 1; i < bars.length; i++) {
        const pc = bars[i - 1].close;
        const tl = Math.min(bars[i].low, pc);
        bp.push(bars[i].close - tl);
        tr.push(Math.max(bars[i].high - tl, bars[i].high - pc, pc - tl) || 1);
    }
    const avg = (p: number): number => {
        const n = Math.min(p, bp.length);
        let b = 0;
        let t = 0;
        for (let i = bp.length - n; i < bp.length; i++) { b += bp[i]; t += tr[i]; }
        return t === 0 ? 0 : b / t;
    };
    return rounded(100 * ((4 * avg(p1)) + (2 * avg(p2)) + avg(p3)) / 7, 3);
};

/** Relative Vigor Index. */
export const relativeVigor = (bars: readonly Kline[], period = 10): number => {
    if (bars.length < period + 1) return 0;
    const num: number[] = [];
    const den: number[] = [];
    for (let i = 1; i < bars.length; i++) {
        const hlc = bars[i].high + bars[i].low + bars[i].close;
        const pc = bars[i - 1].high + bars[i - 1].low + bars[i - 1].close;
        const hl2 = (bars[i].high + bars[i].low) / 2;
        const pch = (pc + bars[i - 1].close) / 2;
        num.push(hlc - pch);
        den.push(Math.abs(hl2 - pch) || 1);
    }
    const n = last(smaOf(num, period), 0);
    const d = last(smaOf(den, period), 0);
    return rounded(d === 0 ? 0 : n / d, 4);
};

/** Relative Volatility Index — RSI applied to stdev, not price. */
export const relativeVolatilityIndex = (bars: readonly Kline[], period = 10, length = 14): number => {
    if (bars.length < period + length + 1) return 0;
    const sd = stddevOf(bars.map(b => b.close), period);
    const usable = sd.filter(isNum);
    const changes = usable.slice(1).map((x, i) => x - usable[i]);
    return rounded(last(rsiOf(changes, length), 50), 2);
};

/** Balance of Power. */
export const balanceOfPower = (bars: readonly Kline[]): number => {
    if (bars.length < 1) return 0;
    const lastBar = bars[bars.length - 1];
    const rng = lastBar.high - lastBar.low;
    return rounded(rng === 0 ? 0 : (lastBar.close - lastBar.open) / rng, 4);
};

export interface ElderRayResult { bullPower: number; bearPower: number }

/** Elder Ray — bull/bear power against the EMA basis. */
export const elderRay = (bars: readonly Kline[], period = 13): ElderRayResult => {
    const b = bars[bars.length - 1];
    if (!b) return { bullPower: 0, bearPower: 0 };
    const v = resolveSource(bars);
    const basis = last(emaOf(v, period), 0);
    return { bullPower: rounded(b.high - basis), bearPower: rounded(b.low - basis) };
};

/** TTM Squeeze — Bollinger inside Keltner = compression. */
export const ttmSqueeze = (bars: readonly Kline[], bbPeriod = 20, bbMult = 2, kcPeriod = 20, kcMult = 1.5): { squeeze: boolean; bbUpper: number; bbLower: number; kcUpper: number; kcLower: number } => {
    const v = resolveSource(bars);
    if (v.length < Math.max(bbPeriod, kcPeriod) + 1) return { squeeze: false, bbUpper: 0, bbLower: 0, kcUpper: 0, kcLower: 0 };
    const sd = last(stddevOf(v, bbPeriod), 0);
    const basis = last(smaOf(v, bbPeriod), 0);
    const bbUpper = basis + bbMult * sd;
    const bbLower = basis - bbMult * sd;
    const atr = last(rmaOf(trueRange(bars), kcPeriod), 0);
    const kcBasis = last(emaOf(v, kcPeriod), 0);
    const kcUpper = kcBasis + kcMult * atr;
    const kcLower = kcBasis - kcMult * atr;
    return { squeeze: bbUpper < kcUpper && bbLower > kcLower, bbUpper: rounded(bbUpper), bbLower: rounded(bbLower), kcUpper: rounded(kcUpper), kcLower: rounded(kcLower) };
};

// ── group 4: trend ─────────────────────────────────────────────────────────

/** Aroon — how recently the high/low was set, as % of the window. */
export const aroon = (bars: readonly Kline[], period = 25): { up: number; down: number; trend: 'up' | 'down' | 'flat' } => {
    if (bars.length < period + 1) return { up: 0, down: 0, trend: 'flat' };
    const win = bars.slice(-(period + 1));
    const highs = win.map(b => b.high);
    const lows = win.map(b => b.low);
    const maxH = Math.max(...highs);
    const minL = Math.min(...lows);
    const sinceHigh = highs.lastIndexOf(maxH);
    const sinceLow = lows.lastIndexOf(minL);
    // Aroon: 100 when the extreme is the NEWEST bar, decaying as it ages. So a
    // high set right now is (period - 0) and one set period bars ago is 0.
    const up = ((period - (highs.length - 1 - sinceHigh)) / period) * 100;
    const down = ((period - (lows.length - 1 - sinceLow)) / period) * 100;
    const trend = Math.abs(up - down) < 5 ? 'flat' : up > down ? 'up' : 'down';
    return { up: rounded(up, 2), down: rounded(down, 2), trend };
};

/** Vortex Indicator — +VI/-VI from the true range split. */
export const vortex = (bars: readonly Kline[], period = 14): { viPlus: number; viMinus: number; trend: 'up' | 'down' } => {
    if (bars.length < period + 1) return { viPlus: 0, viMinus: 0, trend: 'up' };
    const tr = trueRange(bars);
    let sumP = 0;
    let sumM = 0;
    let sumTr = 0;
    for (let i = bars.length - period; i < bars.length; i++) {
        sumP += Math.abs(bars[i].high - bars[i - 1].low);
        sumM += Math.abs(bars[i].low - bars[i - 1].high);
        sumTr += tr[i];
    }
    const vp = sumTr === 0 ? 0 : sumP / sumTr;
    const vm = sumTr === 0 ? 0 : sumM / sumTr;
    return { viPlus: rounded(vp, 4), viMinus: rounded(vm, 4), trend: vp >= vm ? 'up' : 'down' };
};

// ── group 5: volatility ────────────────────────────────────────────────────

/** Historical volatility — stdev of log returns, optionally annualized. */
export const historicalVolatility = (bars: readonly Kline[], period = 20, annualize = true, periodsPerYear = 365): number => {
    if (bars.length < period + 1) return 0;
    const rets: number[] = [];
    for (let i = bars.length - period; i < bars.length; i++) {
        if (bars[i - 1].close > 0) rets.push(Math.log(bars[i].close / bars[i - 1].close));
    }
    if (rets.length < 2) return 0;
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
    const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length);
    return rounded((annualize ? sd * Math.sqrt(periodsPerYear) : sd) * 100, 3);
};

/** Chaikin Volatility — rate of change of the EMA of the high-low range. */
export const chaikinVolatility = (bars: readonly Kline[], period = 10, rocPeriod = 10): number => {
    if (bars.length < period + rocPeriod + 1) return 0;
    const range = bars.map(b => b.high - b.low);
    const ema = emaOf(range, period);
    const now = last(ema, 0);
    const then = ema[ema.length - rocPeriod - 1];
    if (!isNum(then) || then === 0) return 0;
    return rounded(((now - then) / then) * 100, 3);
};

/** Mass Index — the range/EMA bulge that precedes a reversal. */
export const massIndex = (bars: readonly Kline[], period = 9, sumPeriod = 25): number => {
    if (bars.length < period + sumPeriod) return 0;
    const rangeEma = emaOf(bars.map(b => b.high - b.low), period);
    const ratio = rangeEma.map((x, i) => (i === 0 || rangeEma[i - 1] === 0 ? 1 : x / rangeEma[i - 1]));
    return rounded(last(smaOf(ratio, sumPeriod), 0), 4);
};
/** Ulcer Index - depth-and-duration of drawdown, squared for emphasis. */
export const ulcerIndex = (bars: readonly Kline[], period = 14): number => {
    if (bars.length < period + 1) return 0;
    const closes = bars.map(b => b.close);
    let maxClose = closes[0];
    let sum = 0;
    let n = 0;
    for (let i = closes.length - period; i < closes.length; i++) {
        maxClose = Math.max(maxClose, closes[i]);
        if (maxClose === 0) continue;
        const pct = ((closes[i] - maxClose) / maxClose) * 100;
        sum += pct * pct;
        n += 1;
    }
    return rounded(n === 0 ? 0 : Math.sqrt(sum / n), 4);
};

/** Choppiness Index - below 38 trending, above 62 ranging. */
export const choppinessIndex = (bars: readonly Kline[], period = 14): { value: number; regime: 'trending' | 'choppy' | 'neutral' } => {
    if (bars.length < period + 1) return { value: 0, regime: 'neutral' };
    const tr = trueRange(bars);
    const sumTR = tr.slice(-period).reduce((a, b) => a + b, 0);
    const hh = Math.max(...bars.slice(-period).map(b => b.high));
    const ll = Math.min(...bars.slice(-period).map(b => b.low));
    const range = hh - ll;
    if (sumTR === 0 || range === 0) return { value: 0, regime: 'neutral' };
    const value = 100 * Math.log10(sumTR / range) / Math.log10(period);
    const regime = value > 61.8 ? 'choppy' : value < 38.2 ? 'trending' : 'neutral';
    return { value: rounded(value, 2), regime };
};

// -- group 6: volume --

/** Chaikin Oscillator - the MACD of the money flow multiplier. */
export const chaikinOscillator = (bars: readonly Kline[], fast = 3, slow = 10): number => {
    if (bars.length < slow + 2) return 0;
    // Published definition: the fast-minus-slow EMA of the ACCUMULATION/
    // DISTRIBUTION line, where each bar contributes MFM * VOLUME. An earlier
    // version weighted MFM by a bar-to-bar VOLUME RATIO instead — not part of
    // any definition, and on flat volume it silently degenerated to SMA(MFM).
    let running = 0;
    const ad: number[] = [];
    for (const b of bars) {
        const range = b.high - b.low;
        const mfm = range === 0 ? 0 : ((b.close - b.low) - (b.high - b.close)) / range;
        running += mfm * b.volume;
        ad.push(running);
    }
    return rounded(last(emaOf(ad, fast), 0) - last(emaOf(ad, slow), 0), 4);
};

/** Ease of Movement. */
export const easeOfMovement = (bars: readonly Kline[], period = 14, scale = 1000000): number => {
    if (bars.length < period + 1) return 0;
    const dm: number[] = [];
    for (let i = 1; i < bars.length; i++) {
        const move = (bars[i].high + bars[i].low) / 2 - (bars[i - 1].high + bars[i - 1].low) / 2;
        const boxRatio = bars[i].volume / scale / (bars[i].high - bars[i].low || 1);
        dm.push(boxRatio === 0 ? 0 : move / boxRatio);
    }
    return rounded(last(smaOf(dm, period), 0), 4);
};

/** Klinger Volume Oscillator. */
export const klingerOscillator = (bars: readonly Kline[], fast = 34, slow = 55): number => {
    if (bars.length < slow + 1) return 0;
    const vf: number[] = [];
    for (let i = 1; i < bars.length; i++) {
        const trend = bars[i].high + bars[i].low + bars[i].close > bars[i - 1].high + bars[i - 1].low + bars[i - 1].close;
        const rng = bars[i].high - bars[i].low;
        const cmf = rng === 0 ? 0 : (((bars[i].close - bars[i].low) - (bars[i].high - bars[i].close)) / rng) * bars[i].volume;
        vf.push(trend ? cmf : -cmf);
    }
    const f = last(emaOf(vf, fast), 0);
    const s = last(emaOf(vf, slow), 0);
    return rounded(f - s, 4);
};

/** Negative Volume Index - accumulates on down-volume bars. */
export const negativeVolumeIndex = (bars: readonly Kline[]): number => {
    if (bars.length < 2) return 0;
    let nvi = 1000;
    for (let i = 1; i < bars.length; i++) {
        if (bars[i].volume < bars[i - 1].volume && bars[i - 1].close !== 0) {
            nvi += ((bars[i].close - bars[i - 1].close) / bars[i - 1].close) * nvi;
        }
    }
    return rounded(nvi, 2);
};

/** Positive Volume Index. */
export const positiveVolumeIndex = (bars: readonly Kline[]): number => {
    if (bars.length < 2) return 0;
    let pvi = 1000;
    for (let i = 1; i < bars.length; i++) {
        if (bars[i].volume > bars[i - 1].volume && bars[i - 1].close !== 0) {
            pvi += ((bars[i].close - bars[i - 1].close) / bars[i - 1].close) * pvi;
        }
    }
    return rounded(pvi, 2);
};

/** Price Volume Trend. */
export const priceVolumeTrend = (bars: readonly Kline[]): number => {
    if (bars.length < 2) return 0;
    let pvt = 0;
    for (let i = 1; i < bars.length; i++) {
        if (bars[i - 1].close === 0) continue;
        pvt += ((bars[i].close - bars[i - 1].close) / bars[i - 1].close) * bars[i].volume;
    }
    return rounded(pvt, 2);
};

/** Volume Oscillator - fast and slow volume SMAs. */
export const volumeOscillator = (bars: readonly Kline[], fast = 5, slow = 20): { short: number; long: number } => {
    const v = bars.map(b => b.volume);
    return { short: rounded(last(smaOf(v, fast), 0)), long: rounded(last(smaOf(v, slow), 0)) };
};

/** Percentage Volume Oscillator. */
export const percentageVolumeOscillator = (bars: readonly Kline[], fast = 5, slow = 20): number => {
    const f = last(smaOf(bars.map(b => b.volume), fast), 0);
    const s = last(smaOf(bars.map(b => b.volume), slow), 0);
    return rounded(s === 0 ? 0 : ((f - s) / s) * 100, 3);
};

/** Volume Flow Indicator. */
export const volumeFlowIndicator = (bars: readonly Kline[]): number => {
    // A period-1 SMA is an identity, so the previous version always produced
    // exactly 0. Use a real 2-period weighted average.
    if (bars.length < 3) return 0;
    const tp = typicalPrice(bars);
    const v = bars.map(b => b.volume);
    const smaTp = wmaOf(tp, 2);
    const smaV = wmaOf(v, 2);
    if (smaTp === 0 || smaV === 0) return 0;
    return rounded(((tp[tp.length - 1] - smaTp) / smaTp) * ((v[v.length - 1] - smaV) / smaV), 4);
};

/** Intraday Intensity - where in its range the bar closed, times volume. */
export const intradayIntensity = (bars: readonly Kline[]): number => {
    const b = bars[bars.length - 1];
    if (!b) return 0;
    const rng = b.high - b.low;
    return rounded(rng === 0 ? 0 : (100 * (2 * b.close - b.high - b.low)) / rng, 3);
};

// -- group 7: overlays --

export interface PivotResult { pp: number; r1: number; r2: number; r3: number; s1: number; s2: number; s3: number }

/** Classic pivot points from the completed session before the last bar. */
export const pivotPoints = (bars: readonly Kline[]): PivotResult => {
    const prev = bars[bars.length - 2];
    if (!prev) return { pp: 0, r1: 0, r2: 0, r3: 0, s1: 0, s2: 0, s3: 0 };
    const pp = (prev.high + prev.low + prev.close) / 3;
    const range = prev.high - prev.low;
    return {
        pp: rounded(pp),
        r1: rounded(2 * pp - prev.low),
        r2: rounded(pp + range),
        r3: rounded(pp + 2 * range),
        s1: rounded(2 * pp - prev.high),
        s2: rounded(pp - range),
        s3: rounded(pp - 2 * range),
    };
};

/** ZigZag - the last swing point at least `deviation` percent away. */
export const zigzag = (bars: readonly Kline[], deviation = 5): { point: { index: number; price: number }; label: 'high' | 'low'; confirmed: boolean } => {
    // On a series that never reverses by `deviation` there is NO confirmed
    // swing — the previous version returned index 0 labelled 'high', which a
    // seat reads as "the last swing high is the first bar". `confirmed: false`
    // says so instead of inventing a pivot.
    if (bars.length < 3) return { point: { index: bars.length - 1, price: 0 }, label: 'high', confirmed: false };
    const closes = bars.map(b => b.close);
    let lastIndex = 0;
    let lastPrice = closes[0];
    let label: 'high' | 'low' = 'high';
    for (let i = 1; i < closes.length; i++) {
        const move = ((closes[i] - lastPrice) / lastPrice) * 100;
        if (label === 'high' && move <= -deviation) {
            lastIndex = i - 1;
            lastPrice = closes[lastIndex];
            label = 'low';
        } else if (label === 'low' && move >= deviation) {
            lastIndex = i - 1;
            lastPrice = closes[lastIndex];
            label = 'high';
        }
    }
    return { point: { index: lastIndex, price: rounded(lastPrice) }, label, confirmed: lastIndex > 0 || label === 'low' };
};

/** Williams Fractal - the nearest 5-bar swing in the window. */
export const williamsFractal = (bars: readonly Kline[], lookback = 60): { type: 'bullish' | 'bearish' | 'none'; index: number } => {
    const n = Math.min(5, Math.floor(bars.length / 2));
    // The bounds live in the BODY, not the loop header: a header condition that
    // fails at the first candidate TERMINATES the scan, so a window whose tail
    // bars have no room on the right never examined any earlier candidate at all.
    for (let i = bars.length - 2; i >= Math.max(n, bars.length - lookback); i--) {
        if (i + n >= bars.length) continue;
        let isHigh = true;
        let isLow = true;
        for (let j = i - n; j <= i + n; j++) {
            if (bars[j].high >= bars[i].high && j !== i) isHigh = false;
            if (bars[j].low <= bars[i].low && j !== i) isLow = false;
        }
        if (isHigh && !isLow) return { type: 'bearish', index: i };
        if (isLow && !isHigh) return { type: 'bullish', index: i };
    }
    return { type: 'none', index: bars.length - 1 };
};

// -- registry --

export interface TaStudy {
    id: string;
    covers: string;
    run: (bars: readonly Kline[]) => unknown;
}

/**
 * Bars per year for a timeframe, so an annualised study is annualised from
 * the window it was computed on. Crypto trades 365 days.
 */
const periodsPerYearFor = (bars: readonly Kline[]): number => {
    if (bars.length < 3) return 365;
    const span = (bars[bars.length - 1].time - bars[0].time) / (bars.length - 1);
    if (!Number.isFinite(span) || span <= 0) return 365;
    return Math.max(1, Math.round((365 * 24 * 3600) / span));
};

/**
 * The studies, keyed by the `studies` id the desk tool accepts. Grouped the
 * way the Vela catalogue is, so the tool enum reads as a catalogue. Each entry
 * is pure and cannot throw: a study that cannot be computed returns a zeroed
 * result rather than failing the whole call.
 */
export const TA_STUDIES: Record<string, TaStudy> = {
    averages: {
        id: 'averages',
        covers: 'HMA, ZLEMA, VIDYA, ALMA, LSMA, DEMA, TEMA, KAMA, VWMA - lag-free and adaptive averages',
        run: b => ({
            hma: hma(b), zlema: zlema(b), vidya: vidya(b), alma: alma(b), lsma: lsma(b),
            dema: dema(b), tema: tema(b), kama: kama(b), vwma: vwma(b),
        }),
    },
    bands: {
        id: 'bands',
        covers: 'Donchian, SuperTrend, Chande Kroll Stop, Williams Alligator - channel and trend-band studies',
        run: b => ({
            donchian: donchian(b), superTrend: superTrend(b), chandeKrollStop: chandeKrollStop(b), alligator: alligator(b),
        }),
    },
    oscillators: {
        id: 'oscillators',
        covers: 'PPO, CMO, Connors RSI, Fisher, TSI, SMI, Schaff Trend Cycle, Coppock, DPO, Ultimate, RVI, RVol, BoP, Elder Ray, TTM Squeeze',
        run: b => ({
            ppo: ppo(b), cmo: cmo(b), connorsRsi: connorsRsi(b), fisher: fisherTransform(b), tsi: tsi(b),
            smi: smi(b), schaffTrendCycle: schaffTrendCycle(b), coppock: coppock(b), dpo: dpo(b),
            ultimateOscillator: ultimateOscillator(b), relativeVigor: relativeVigor(b),
            relativeVolatilityIndex: relativeVolatilityIndex(b), balanceOfPower: balanceOfPower(b),
            elderRay: elderRay(b), ttmSqueeze: ttmSqueeze(b),
        }),
    },
    trend: {
        id: 'trend',
        covers: 'Aroon and Vortex - directional-strength and directional-movement',
        run: b => ({ aroon: aroon(b), vortex: vortex(b) }),
    },
    volatility: {
        id: 'volatility',
        covers: 'Historical volatility, Chaikin volatility, Mass Index, Ulcer Index, Choppiness Index',
        // Historical volatility is ANNUALISED, and the SAME 365 applied to 5m
        // bars and to daily bars is not a small error — it is a meaningless
        // number. It is computed on the window's own bar spacing instead.
        run: b => {
            // The factor is REPORTED, not recomputed downstream: a second copy of
            // "bars per year" in the tool would disagree whenever the fetched
            // window is not exactly the nominal bar spacing (missing candles),
            // and the note would then describe a different number than the one
            // printed beside it.
            const ppy = periodsPerYearFor(b);
            return {
                historicalVolatility: historicalVolatility(b, 20, true, ppy),
                historicalVolatilityAnnualization: ppy,
                chaikinVolatility: chaikinVolatility(b),
                massIndex: massIndex(b),
                ulcerIndex: ulcerIndex(b),
                choppinessIndex: choppinessIndex(b),
            };
        },
    },
    volumeflow: {
        id: 'volumeflow',
        covers: 'Chaikin Oscillator, Ease of Movement, Klinger, PVI, NVI, PVT, Volume/Pct Volume Oscillator, VFI, Intraday Intensity',
        run: b => ({
            chaikinOscillator: chaikinOscillator(b), easeOfMovement: easeOfMovement(b),
            klingerOscillator: klingerOscillator(b), positiveVolumeIndex: positiveVolumeIndex(b),
            negativeVolumeIndex: negativeVolumeIndex(b), priceVolumeTrend: priceVolumeTrend(b),
            volumeOscillator: volumeOscillator(b), percentageVolumeOscillator: percentageVolumeOscillator(b),
            volumeFlowIndicator: volumeFlowIndicator(b), intradayIntensity: intradayIntensity(b),
        }),
    },
    overlays: {
        id: 'overlays',
        covers: 'Pivot points, ZigZag swing point, Williams Fractal - levels and structure the seat can act on',
        run: b => ({ pivots: pivotPoints(b), zigzag: zigzag(b), fractals: williamsFractal(b) }),
    },
};
