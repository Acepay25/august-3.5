/**
 * Benchmark-relative alpha (skill vs tide).
 *
 * A "WIN" that only happened because the whole market ran up is not skill —
 * it is beta. This module measures what every downstream statistic silently
 * assumes: did the call beat simply HOLDING the benchmark (BTC, or ETH for
 * ETH pairs) over the SAME window? alphaPct = realized trade return − buy-and-
 * hold benchmark return, so a positive alpha means the timing/selection added
 * value the tide did not. It is computed at settlement and stored on the trade;
 * nothing here re-scores the panel (that is the follow-up the plan defers).
 */

import { fetchOHLCVFromTime, Kline } from '../services/analysis/MarketDataService';
import type { BenchmarkAlpha } from '../types/trade';

export type { BenchmarkAlpha };

/**
 * Which benchmark a symbol should be measured against. ETH-family pairs
 * (ETHUSDT, ETHUSD, ETHPERP) hold ETH; everything else is measured against
 * BTC — the market's default tide. Deliberately a tiny rule, not a table.
 */
export const benchmarkForSymbol = (symbol: string): string => {
    const s = (symbol || '').toUpperCase();
    if (s.startsWith('ETH')) return 'ETHUSDT';
    return 'BTCUSDT';
};

/** Pure buy-and-hold return over the benchmark's close-to-close (percent). */
export const benchmarkReturnPct = (entryClose: number, exitClose: number): number => {
    if (!Number.isFinite(entryClose) || !Number.isFinite(exitClose) || entryClose <= 0) return NaN;
    return ((exitClose - entryClose) / entryClose) * 100;
};

/** Pure alpha: trade realized return minus the benchmark hold over the same window. */
export const computeAlphaPct = (tradePct: number, benchmarkPct: number): number => {
    if (!Number.isFinite(tradePct) || !Number.isFinite(benchmarkPct)) return NaN;
    return tradePct - benchmarkPct;
};

/** Pick the benchmark close at/just-before a target time from sorted candles. */
const closeAtOrBefore = (klines: Kline[], timeMs: number): number | null => {
    let best: Kline | null = null;
    for (const k of klines) {
        if (k.time <= timeMs) best = k;
        else break;
    }
    return best ? best.close : null;
};

/**
 * Settle a resolved trade against the benchmark. Fetches the benchmark's
 * candles for the trade's entry→exit window and returns the alpha block. Any
 * failure (no data, short window) returns an `unavailableReason` — it must
 * never fabricate an alpha (that is the whole point of measuring honestly).
 */
export const settleBenchmarkAlpha = async (params: {
    symbol: string;
    entryTimeMs: number;
    exitTimeMs: number;
    tradePct: number;
}): Promise<BenchmarkAlpha> => {
    const { symbol, entryTimeMs, exitTimeMs, tradePct } = params;
    const benchmarkSymbol = benchmarkForSymbol(symbol);
    const windowMs = exitTimeMs - entryTimeMs;
    if (!Number.isFinite(entryTimeMs) || !Number.isFinite(exitTimeMs) || windowMs <= 0) {
        return { benchmarkSymbol, benchmarkPct: 0, tradePct, alphaPct: NaN, windowMs: Math.max(0, windowMs), unavailableReason: 'invalid window' };
    }
    try {
        // 1h gives a ≥2-candle read for even a short scalp window; a 1m series
        // over days would be huge, so pick the timeframe by span.
        const timeframe = windowMs >= 3 * 86_400_000 ? '4h' : windowMs >= 6 * 3_600_000 ? '1h' : '15m';
        const klines = await fetchOHLCVFromTime(benchmarkSymbol, timeframe, entryTimeMs, exitTimeMs);
        if (!klines || klines.length < 2) {
            return { benchmarkSymbol, benchmarkPct: 0, tradePct, alphaPct: NaN, windowMs, unavailableReason: 'insufficient benchmark candles' };
        }
        const benchEntry = closeAtOrBefore(klines, entryTimeMs) ?? klines[0].close;
        const benchExit = closeAtOrBefore(klines, exitTimeMs) ?? klines[klines.length - 1].close;
        const benchmarkPct = benchmarkReturnPct(benchEntry, benchExit);
        if (!Number.isFinite(benchmarkPct)) {
            return { benchmarkSymbol, benchmarkPct: 0, tradePct, alphaPct: NaN, windowMs, unavailableReason: 'benchmark return NaN' };
        }
        return { benchmarkSymbol, benchmarkPct, tradePct, alphaPct: computeAlphaPct(tradePct, benchmarkPct), windowMs };
    } catch (e) {
        return {
            benchmarkSymbol, benchmarkPct: 0, tradePct, alphaPct: NaN, windowMs,
            unavailableReason: `benchmark fetch failed: ${e instanceof Error ? e.message : String(e)}`,
        };
    }
};

/**
 * Is a settled trade "skill" (beat the tide)? Null-safe: undefined when the
 * alpha is missing, so a thin/absent benchmark never counts as either.
 */
export const beatTheTide = (alpha: BenchmarkAlpha | undefined): boolean | null => {
    if (!alpha || !Number.isFinite(alpha.alphaPct)) return null;
    return alpha.alphaPct > 0;
};
