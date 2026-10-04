/**
 * htfPhase — what the higher timeframe is DOING right now.
 *
 * Every other level detector in this repo answers a spatial question: where is
 * price relative to a past bar's extremes (smcStructure, enhanced key levels,
 * DOL). None answers the temporal one a seat asks before it commits a setup —
 * is the 4h bar expanding, sweeping, or just sitting inside the previous bar?
 * This classifies the bar being built against the last CLOSED bar on the same
 * frame into nine states, then folds any number of frames into one weighted
 * bias so three answers can disagree without three paragraphs of prose.
 *
 * The state table and the weighting are the design of "HTF Fractal Bars
 * [Herman]" by helmans13, published open-source on TradingView under the
 * Mozilla Public License 2.0 (https://mozilla.org/MPL/2.0/). The arithmetic is
 * reimplemented against this repo's `Kline`; no Pine lines are copied. The
 * notice stays because the nine states are that author's design, not ours.
 *
 * Two deliberate departures from the script:
 * - Its acceptance buffer is `ticks × syminfo.mintick`, which has no meaning
 *   here (no symbol spec in a pure function). It is a percentage of price
 *   instead, defaulting to 0 — which reproduces its own default exactly.
 * - It reads the CHART frame's `close` as the reference price, because on
 *   TradingView the forming HTF candle's close and the chart's last tick are
 *   the same number. `price` is therefore an explicit input; callers holding a
 *   live mark should pass it rather than trust the forming candle's close.
 *
 * Pure: no chart, no React, no I/O. Total: a window too short to have a
 * previous bar, or one carrying a non-finite field, reads code 9 (`n/a`) and is
 * DROPPED from the weighting rather than being assigned a direction it did not
 * earn. A seat must never be told the 1d is bullish because its candles were
 * missing.
 */

import { Kline } from '../types';

export type HtfPhaseCode = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

/** The nine states. ▲/▼ is the direction the state votes for, not a forecast. */
export const HTF_PHASE_LABELS: Record<HtfPhaseCode, string> = {
    1: 'Expansion ▲',
    2: 'Low swept ▲',
    3: 'Outside ▲',
    4: 'Expansion ▼',
    5: 'High swept ▼',
    6: 'Outside ▼',
    7: 'Inside ·',
    8: 'Outside ·',
    9: 'n/a',
};

export interface HtfPhase {
    code: HtfPhaseCode;
    label: string;
    /** +1 bullish vote, -1 bearish vote, 0 abstain (the three neutral states). */
    dir: -1 | 0 | 1;
}

/** Codes 1-3 vote bullish, 4-6 bearish, 7/8/9 abstain. */
export const phaseDirection = (code: HtfPhaseCode): -1 | 0 | 1 =>
    code >= 1 && code <= 3 ? 1 : code >= 4 && code <= 6 ? -1 : 0;

const na = (): HtfPhase => ({ code: 9, label: HTF_PHASE_LABELS[9], dir: 0 });

const isPrice = (v: number): boolean => Number.isFinite(v) && v > 0;

export interface ClassifyOptions {
    /** Acceptance buffer as a PERCENT of the reference price. 0 = a close must
     *  simply clear the previous bar's extreme. Symmetric on both sides. */
    bufferPct?: number;
    /** The live price to test against the previous bar. Defaults to the last
     *  bar's close — pass the mark price when you have one. */
    price?: number;
}

/**
 * Classify the LAST bar in `bars` against the one before it. The caller's
 * array must end with the bar being classified, so for a frame whose vendor
 * returns the forming candle last (every Binance path in this repo does) that
 * is the live bar; for a closed-only window it is the most recently closed bar,
 * which is the same reading one bar later and still worth asking.
 */
export const classifyBar = (bars: readonly Kline[], opts: ClassifyOptions = {}): HtfPhase => {
    if (!Array.isArray(bars) || bars.length < 2) return na();
    const prev = bars[bars.length - 2];
    const live = bars[bars.length - 1];
    if (!prev || !live) return na();
    if (![prev.high, prev.low, live.high, live.low].every(Number.isFinite)) return na();
    const raw = opts.price;
    const px = typeof raw === 'number' && isPrice(raw) ? raw : live.close;
    if (!isPrice(px)) return na();

    const pct = Number.isFinite(opts.bufferPct) ? Math.max(0, opts.bufferPct ?? 0) : 0;
    const buf = (pct / 100) * px;

    // Strict on both sides: an equal extreme did not TAKE anything, it tied it.
    const tookHigh = live.high > prev.high;
    const tookLow = live.low < prev.low;
    const above = px > prev.high + buf;
    const below = px < prev.low - buf;

    let code: HtfPhaseCode;
    if (tookHigh && tookLow) code = above ? 3 : below ? 6 : 8;
    else if (tookHigh) code = above ? 1 : 5;
    else if (tookLow) code = below ? 4 : 2;
    else code = 7;

    return { code, label: HTF_PHASE_LABELS[code], dir: phaseDirection(code) };
};

export interface HtfPhaseEntry {
    /** Label for the row — the timeframe string the caller fetched it on. */
    timeframe: string;
    bars: readonly Kline[];
    /** Overrides the position-based weight. A weight of 0 mutes the frame. */
    weight?: number;
}

export interface HtfPhaseRow {
    timeframe: string;
    weight: number;
    code: HtfPhaseCode;
    label: string;
    dir: -1 | 0 | 1;
}

export type HtfBias = 'bullish' | 'bearish' | 'conflict' | 'neutral' | 'insufficient';

export interface HtfPhaseRead {
    rows: HtfPhaseRow[];
    /** Frames that produced a state at all (code != 9). */
    active: number;
    bullish: number;
    bearish: number;
    /** Σ weight×dir. Its sign is the bias; its size is only meaningful next to `weightSum`. */
    score: number;
    weightSum: number;
    /** 100·|score|/weightSum — how lopsided the frames are. Null when nothing weighted. */
    agreementPct: number | null;
    bias: HtfBias;
    /** True when fewer than two frames answered: the bias is not usable yet. */
    usable: boolean;
}

export interface AgreementOptions extends ClassifyOptions {
    /** Weight of the FIRST frame; each later frame takes weight+1 unless it
     *  supplies its own. Ascending-timeframe input order is the contract. */
    baseWeight?: number;
}

/**
 * Fold N frames into one bias. Entries MUST be ordered ascending by timeframe
 * (15m, 1h, 4h, 1d) because the default weight is the position: the script this
 * mirrors weights 1/2/3 so the slowest frame carries the most, and a caller who
 * shuffles the array gets the opposite answer from the same data.
 */
export const htfPhaseAgreement = (
    entries: readonly HtfPhaseEntry[],
    opts: AgreementOptions = {},
): HtfPhaseRead => {
    const base = Number.isFinite(opts.baseWeight) ? Math.max(0, opts.baseWeight ?? 1) : 1;
    const rows: HtfPhaseRow[] = (Array.isArray(entries) ? entries : []).map((e, i) => {
        const p = e?.bars ? classifyBar(e.bars, opts) : na();
        const weight = typeof e?.weight === 'number' && Number.isFinite(e.weight)
            ? Math.max(0, e.weight)
            : base + i;
        return { timeframe: String(e?.timeframe ?? `#${i + 1}`), weight, ...p };
    });

    const counted = rows.filter(r => r.code !== 9);
    let score = 0;
    let weightSum = 0;
    for (const r of counted) {
        weightSum += r.weight;
        score += r.weight * r.dir;
    }
    const bullish = counted.filter(r => r.dir > 0).length;
    const bearish = counted.filter(r => r.dir < 0).length;
    const usable = counted.length >= 2 && weightSum > 0;

    let bias: HtfBias;
    if (!usable) bias = 'insufficient';
    else if (score > 0) bias = 'bullish';
    else if (score < 0) bias = 'bearish';
    else bias = bullish > 0 && bearish > 0 ? 'conflict' : 'neutral';

    return {
        rows,
        active: counted.length,
        bullish,
        bearish,
        score,
        weightSum,
        agreementPct: weightSum > 0 ? (100 * Math.abs(score)) / weightSum : null,
        bias,
        usable,
    };
};

/** Rows the weighted bias rests on, newest weight last. Empty read says so. */
export const formatHtfPhaseBlock = (read: HtfPhaseRead): string => {
    if (read.rows.length === 0) return 'HTF bar state: no frames supplied.';
    const detail = read.rows.map(r => `${r.timeframe} ${r.label}(w${r.weight})`).join(' · ');
    if (!read.usable) {
        return `HTF bar state: ${detail} — BIAS UNUSABLE (needs 2+ frames with a state; this is not a neutral read)`;
    }
    const agree = read.agreementPct === null ? '—' : `${read.agreementPct.toFixed(0)}%`;
    return `HTF bar state: ${detail} · net ${read.bias.toUpperCase()} (score ${read.score > 0 ? '+' : ''}${read.score}/${read.weightSum}, agreement ${agree}, ${read.bullish} bull vs ${read.bearish} bear)`;
};
