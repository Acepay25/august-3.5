/**
 * skillPredicateGate — asks the skills' code-level triggers against the live
 * tape before a debate spends tokens on them.
 *
 * Retrieval decides which skills are RELEVANT by matching setup dimensions; a
 * predicate decides whether a relevant skill's trigger is actually TRUE on the
 * current bar. The two are different questions, and until now only the first
 * was answered in code — the second was left to a seat reading prose.
 *
 * Cost is one `fetchKlines` per coin+timeframe, which the 30s KlineService
 * cache and its in-flight dedupe make effectively free while the chart for that
 * symbol is on screen. No model call, no desk tool, no new endpoint.
 */

import { listSkills, titleFromMeta, type SkillKind, type SkillMeta } from './SkillMemoryService';
import {
    buildPredicateSeries,
    evaluatePredicateSource,
    lastClosedIndex,
} from '../analysis/skillPredicate';
import type { ScanCandle } from '../trade/setupScan';

/** A fired `avoid` predicate caps verdict confidence here. The number matches
 *  the ceiling the existing prose-based avoid ladder already applies, so the
 *  code gate tightens nothing beyond what the skill already implied — it just
 *  makes the call deterministic instead of hoping a seat honors the sentence. */
export const AVOID_PREDICATE_CEILING = 0.40;

export interface PredicateGateResult {
    /** Skills whose predicate fired on the last closed bar. */
    fired: Array<{ name: string; kind: SkillKind; predicate: string; timeframe: string }>;
    /** How many predicates were judged at all. */
    judged: number;
    /** Predicates that could not be confirmed — quiet, unwarmed indicators, or
     *  a clause that no longer parses. Kept distinct from "safe". */
    inconclusive: number;
    /** Lowest ceiling implied across fired skills; undefined when none fired. */
    ceiling?: number;
    /** Prompt line for the seats. Empty when nothing fired, so a run with no
     *  predicates is byte-identical to one before this feature. */
    note: string;
}

const EMPTY: PredicateGateResult = { fired: [], judged: 0, inconclusive: 0, note: '' };

/** Skills carrying a predicate, scoped to this coin (a coin-less skill applies
 *  to any setup and is kept). */
export const predicateBearingSkills = (skills: SkillMeta[], coin?: string): SkillMeta[] => {
    const wanted = (coin || '').toUpperCase().replace(/USDT?$/, '');
    return skills.filter(s => {
        if (!s.predicate || !s.predicate.trim()) return false;
        if (!s.coin) return true;
        return s.coin.toUpperCase().replace(/USDT?$/, '') === wanted;
    });
};

const describeFired = (kind: SkillKind): string =>
    kind === 'avoid' ? 'AVOID condition is LIVE' : 'repeat condition is LIVE';

/**
 * Evaluate every predicate-bearing skill for one coin. Never throws: a failed
 * fetch simply means that timeframe's gate did not run, which is reported as
 * inconclusive rather than as "conditions clear".
 *
 * Skills are judged on the timeframe they were earned on (`skill.timeframe`,
 * falling back to 1h) — a 15m exhaustion rule read off an hourly bar would be a
 * different condition entirely. One fetch per distinct timeframe, since
 * KlineService already caches and de-dupes in flight.
 */
export async function evaluateSkillPredicates(args: {
    coin: string;
    skills?: SkillMeta[];
    bars?: number;
}): Promise<PredicateGateResult> {
    const pool = predicateBearingSkills(args.skills ?? listSkills().map(s => s.meta), args.coin);
    if (pool.length === 0) return EMPTY;

    const byTimeframe = new Map<string, SkillMeta[]>();
    for (const skill of pool) {
        const tf = skill.timeframe || '1h';
        byTimeframe.set(tf, [...(byTimeframe.get(tf) ?? []), skill]);
    }

    const fired: PredicateGateResult['fired'] = [];
    let inconclusive = 0;

    for (const [timeframe, skills] of byTimeframe) {
        let series;
        try {
            const { fetchKlines } = await import('../analysis/KlineService');
            const klines = await fetchKlines(args.coin, timeframe, args.bars ?? 120);
            const candles: ScanCandle[] = klines.map(k => ({
                time: k.time, open: k.open, high: k.high, low: k.low, close: k.close, volume: k.volume,
            }));
            if (candles.length < 3) throw new Error('not enough history');
            series = buildPredicateSeries(candles);
        } catch {
            // No tape means no gate for this timeframe's skills.
            inconclusive += skills.length;
            continue;
        }
        const at = lastClosedIndex(series);
        for (const skill of skills) {
            const outcome = evaluatePredicateSource(skill.predicate ?? '', series, at);
            if (outcome.status === 'invalid' || outcome.status === 'unknown') {
                inconclusive += 1;
                continue;
            }
            if (outcome.status === 'fired') {
                fired.push({ name: titleFromMeta(skill), kind: skill.kind, predicate: skill.predicate ?? '', timeframe });
            }
        }
    }

    const ceilings = fired.filter(f => f.kind === 'avoid').map(() => AVOID_PREDICATE_CEILING);
    const note = fired.length === 0
        ? ''
        : [
            '**CODE-CHECKED TRIGGERS (evaluated on the last closed candle, not by a model):**',
            ...fired.map(f => `- ${f.name} — ${f.kind} @ ${f.timeframe}: ${f.predicate} → ${describeFired(f.kind)}`),
            ...(ceilings.length > 0
                ? [`An AVOID trigger is live: the verdict cannot exceed ${Math.round(AVOID_PREDICATE_CEILING * 100)}% confidence.`]
                : []),
        ].join('\n');

    return {
        fired,
        judged: pool.length,
        inconclusive,
        ceiling: ceilings.length > 0 ? Math.min(...ceilings) : undefined,
        note,
    };
}
