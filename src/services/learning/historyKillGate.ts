/**
 * historyKillGate — the "throw it out before it ships" check for a crafted
 * trigger (the reference research loop's kill rate, made deterministic).
 *
 * A skill's trigger is prose plus an optional `predicate` — candle math the
 * desk can re-check in code. Prose cannot be replayed; a predicate can. This
 * asks ONE question of a predicate against the tape it was earned on: does it
 * fire on a minority of bars, and do those bars move at least 1R (ATR-based)
 * within the forward window more often than a random bar does?
 *
 * It is deliberately DIRECTION-AGNOSTIC. A skill's prose carries the
 * direction; the trigger's job is to precede an actionable move at all. A
 * predicate that fires on most bars, or on bars indistinguishable from the
 * baseline, is a description of the chart, not a trigger — and is killed
 * rather than shipped as a rule that was never earned.
 *
 * Pure: candles in, verdict out. No fetch, no lookahead — entry is the NEXT
 * bar's open and the window is strictly forward.
 */
import { buildPredicateSeries, evaluatePredicateAt, parsePredicate } from '../analysis/skillPredicate';

export interface KillCandle {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number;
}

export interface KillGateOptions {
    /** Forward bars a fired trigger has to produce its move in. */
    horizonBars?: number;
    /** Fires below this are not evidence either way. */
    minFires?: number;
    /** How much better than the unconditional rate a trigger must be. */
    minLift?: number;
    /** A "trigger" that fires on more of the tape than this is the tape. */
    fireShareCap?: number;
    /** Bars skipped so the indicators have warmed up. */
    warmupBars?: number;
}

export const KILL_GATE_DEFAULTS: Required<KillGateOptions> = {
    horizonBars: 20,
    minFires: 8,
    minLift: 1.25,
    fireShareCap: 0.6,
    warmupBars: 30,
};

export interface KillGateVerdict {
    verdict: 'keep' | 'kill' | 'insufficient' | 'invalid';
    reason: string;
    fired: number;
    sample: number;
    hitRate: number | null;
    baseline: number | null;
    lift: number | null;
}

const round = (v: number): number => Math.round(v * 1000) / 1000;

export const historyKillGate = (
    predicate: string,
    candles: readonly KillCandle[],
    opts: KillGateOptions = {},
): KillGateVerdict => {
    const cfg = { ...KILL_GATE_DEFAULTS, ...opts };
    const empty = (verdict: KillGateVerdict['verdict'], reason: string): KillGateVerdict => ({
        verdict, reason, fired: 0, sample: 0, hitRate: null, baseline: null, lift: null,
    });
    const parsed = parsePredicate(predicate);
    if (!parsed.ok) return empty('invalid', parsed.error);
    const bars = candles as KillCandle[];
    if (bars.length < cfg.warmupBars + cfg.horizonBars + 2) {
        return empty('insufficient', `only ${bars.length} candles — not enough for a forward test`);
    }
    const series = buildPredicateSeries(bars);
    const lastEligible = bars.length - cfg.horizonBars - 1;
    let sample = 0;
    let baselineHits = 0;
    let fired = 0;
    let firedHits = 0;
    for (let i = cfg.warmupBars; i <= lastEligible; i += 1) {
        const atr = series.fields.atr14[i];
        const entry = bars[i + 1].open;
        if (!Number.isFinite(atr) || atr <= 0 || !Number.isFinite(entry) || entry <= 0) continue;
        let best = 0;
        for (let j = i + 1; j <= i + cfg.horizonBars; j += 1) {
            best = Math.max(best, Math.abs(bars[j].high - entry), Math.abs(entry - bars[j].low));
        }
        const hit = best / atr >= 1;
        sample += 1;
        if (hit) baselineHits += 1;
        const state = evaluatePredicateAt(parsed.ast, series, i);
        if (state.status !== 'fired') continue;
        fired += 1;
        if (hit) firedHits += 1;
    }
    const baseline = sample > 0 ? baselineHits / sample : null;
    const hitRate = fired > 0 ? firedHits / fired : null;
    const lift = hitRate !== null && baseline !== null && baseline > 0 ? hitRate / baseline : null;
    const verdict: KillGateVerdict = {
        verdict: 'insufficient', reason: '', fired, sample,
        hitRate: hitRate === null ? null : round(hitRate),
        baseline: baseline === null ? null : round(baseline),
        lift: lift === null ? null : round(lift),
    };
    if (fired < cfg.minFires) {
        return { ...verdict, verdict: 'insufficient', reason: `fired on ${fired} of ${sample} bars — too few to judge` };
    }
    if (fired / sample > cfg.fireShareCap) {
        return { ...verdict, verdict: 'kill', reason: `fires on ${Math.round((fired / sample) * 100)}% of bars — that is the tape, not a trigger` };
    }
    if (baseline !== null && hitRate !== null && hitRate < baseline * cfg.minLift) {
        return {
            ...verdict, verdict: 'kill',
            reason: `${Math.round(hitRate * 100)}% of fires saw a 1R move vs ${Math.round(baseline * 100)}% of all bars (lift ${lift === null ? '—' : lift.toFixed(2)})`,
        };
    }
    return {
        ...verdict, verdict: 'keep',
        reason: `${Math.round((hitRate ?? 0) * 100)}% of ${fired} fires saw a 1R move vs ${Math.round((baseline ?? 0) * 100)}% of all bars`,
    };
};
