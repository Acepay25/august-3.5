/**
 * signalAccuracy — the fold that makes the signal ledger mean something.
 *
 * A hit rate alone is not accuracy: every bracket geometry has a hit rate you
 * would get by entering at a RANDOM time. So each resolution carries its own
 * baseline — the SAME risk/reward percentages and the SAME time to expiry,
 * entered at every bar of the same tape, resolved by the same resolver. The
 * signal's hit rate minus that base rate is the only honest "did the read add
 * anything" number this phase can produce.
 *
 * Base rates are computed at settlement (where the tape already is) and stored
 * on the resolution, so the feed needs no network and an old resolution keeps
 * the baseline it was graded against.
 *
 * Deliberate limits, stated so they are not mistaken for completeness:
 *  · the baseline enters at each bar's CLOSE (immediate fill); a signal that
 *    waits for a pullback is compared against an always-in trader, which is
 *    the harder baseline;
 *  · no costs enter the base rate — both sides are gross hit rates;
 *  · the sample floor (`MIN_ACCURACY_FILLS`) is per SIGNAL SET, not per signal;
 *    one resolution's base is descriptive, not a measured edge.
 */

import type { SignalBaseRate, SignalRecord, SignalRow } from '../../types/signal';
import { resolveSignal, SIGNAL_BAR_MS, type SignalCandle } from './signalResolver';

/** Below this many filled signals the scorecard says THIN and the desk must
 *  not claim an edge. 20 is the smallest count where a 10-point lift is not
 *  pure noise at this hit-rate range (0.5 ± ~0.22 at 1σ). */
export const MIN_ACCURACY_FILLS = 20;

export interface SignalScorecard {
    fills: number;
    thin: boolean;
    hitRate: number | null;
    baseRate: number | null;
    /** hitRate − baseRate, probability points. */
    lift: number | null;
    expectancyR: number | null;
    ambiguityRate: number | null;
}

/**
 * What the same levels would have done entering at every bar of this tape.
 * Null when the bracket has no risk/reward distance or no bar resolves with
 * enough future tape to be a sample.
 */
export const baseRateFor = (
    signal: Pick<SignalRecord, 'direction' | 'entry' | 'stop' | 'target' | 'emittedAt' | 'expiresAt'>,
    candles: readonly SignalCandle[],
): SignalBaseRate | null => {
    if (candles.length < 3) return null;
    const riskPct = Math.abs(signal.entry - signal.stop) / signal.entry;
    const rewardPct = Math.abs(signal.target - signal.entry) / signal.entry;
    const duration = signal.expiresAt - signal.emittedAt;
    if (!(riskPct > 0) || !(rewardPct > 0) || !(duration > 0)) return null;
    let samples = 0;
    let wins = 0;
    for (let i = 0; i < candles.length; i += 1) {
        const entry = candles[i].close;
        if (!(entry > 0)) continue;
        const stop = signal.direction === 'long' ? entry * (1 - riskPct) : entry * (1 + riskPct);
        const target = signal.direction === 'long' ? entry * (1 + rewardPct) : entry * (1 - rewardPct);
        const draft = resolveSignal(
            {
                direction: signal.direction,
                entry, stop, target,
                emittedAt: candles[i].time,
                expiresAt: candles[i].time + duration,
            },
            candles,
            [],
            candles[i].time + duration,
        );
        // A null draft means the tape does not extend past this entry's
        // expiry — not a sample. (Entry equals the bar close, so it is always
        // touched by its own bar; a never-triggered result cannot occur.)
        if (!draft) continue;
        samples += 1;
        if (draft.status === 'won') wins += 1;
    }
    if (samples === 0) return null;
    return {
        samples,
        hitRate: wins / samples,
        horizonBars: Math.round(duration / SIGNAL_BAR_MS),
        riskPct,
        rewardPct,
    };
};

const mean = (xs: readonly number[]): number | null =>
    xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;

/** The same fill definition the feed uses: won / (won + lost + expired). */
export const scoreSignals = (rows: readonly SignalRow[]): SignalScorecard => {
    const fills = rows.filter(r => r.status === 'won' || r.status === 'lost' || r.status === 'expired');
    const hitRate = fills.length > 0
        ? fills.filter(r => r.status === 'won').length / fills.length
        : null;
    const bases = fills
        .map(r => r.resolution?.base?.hitRate)
        .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    const baseRate = mean(bases);
    const rs = fills
        .map(r => r.resolution?.outcomeR)
        .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    const ambiguous = fills.filter(r => r.resolution?.ambiguous).length;
    return {
        fills: fills.length,
        thin: fills.length < MIN_ACCURACY_FILLS,
        hitRate,
        baseRate,
        lift: hitRate !== null && baseRate !== null ? hitRate - baseRate : null,
        expectancyR: mean(rs),
        ambiguityRate: fills.length > 0 ? ambiguous / fills.length : null,
    };
};
