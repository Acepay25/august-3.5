/**
 * §8.5d — regime-mix drift sentinel (plan §8.5d).
 *
 * Time-based decay is the only staleness axis applyEvidenceDecay has left
 * (§8.3b moved the per-skill regime mismatch out of decay, because
 * "works in trend, fails in chop" is CONDITIONAL not fading). This sentinel
 * catches a DIFFERENT failure: the market's overall regime MIX shifting — the
 * main way a whole skill library goes quietly wrong at once, because a fast
 * shift is invisible to a 30-day age constant.
 *
 * Compare the mix during which a skill's evidence accumulated (regimeStats,
 * §8.3b — normalized to weights) against the market's current 30-day mix
 * (regimeLedger's sync cache). When the L1 distance breaches the threshold,
 * the skill is stale-by-regime (distinct from stale-by-time) and is
 * DOWNWEIGHTED in retrieval ranking until fresh evidence in the current mix
 * moves its own mix back toward the market — the flag is derived live from
 * the data, so it auto-clears the moment the evidence re-converges.
 */

import { getRegimeSummary, marketRegimeToLedger } from '../services/learning/regimeLedger';
import type { SkillMeta } from '../services/learning/SkillMemoryService';

/** L1 distance above which the skill's evidence mix is divergent from the
 *  current market mix (0-2 scale; 0.6 ≈ 60% of the mix shifted). */
export const REGIME_MIX_L1_THRESHOLD = 0.6;
/** Ranking multiplier applied to a stale-by-regime skill. */
export const STALE_BY_REGIME_DOWNWEIGHT = 0.6;

const CURRENT_MIX_WINDOW_DAYS = 30;

export type RegimeMix = Record<string, number>;

/** The market's regime mix over the last 30 days (from the ledger cache),
 *  normalized to weights summing ≤ 1. Null when the ledger has no data. */
export const currentRegimeMix = (coin: string | undefined): RegimeMix | null => {
    if (!coin) return null;
    const s = getRegimeSummary(coin, CURRENT_MIX_WINDOW_DAYS);
    if (!s.currentRegime || s.samples === 0) return null;
    const out: RegimeMix = {};
    for (const [r, pct] of Object.entries(s.distribution)) {
        if (typeof pct === 'number' && pct > 0) out[r] = pct / 100;
    }
    return Object.keys(out).length > 0 ? out : null;
};

/** The skill's evidence mix (from §8.3b regimeStats) as weights. Raw keys are
 *  passed through the ledger's own mapping so 'chop'/'trend' style values
 *  land on the same regime set. Null when the skill has no regime-resolved
 *  evidence at all. */
export const skillEvidenceMixWeights = (
    regimeStats: SkillMeta['regimeStats'] | undefined,
): RegimeMix | null => {
    if (!regimeStats) return null;
    const counts: Record<string, number> = {};
    let total = 0;
    for (const [raw, v] of Object.entries(regimeStats)) {
        const led = marketRegimeToLedger(raw);
        if (!led || !v) continue;
        const n = v.w + v.l;
        if (n <= 0) continue;
        counts[led] = (counts[led] ?? 0) + n;
        total += n;
    }
    if (total <= 0) return null;
    const out: RegimeMix = {};
    for (const [r, n] of Object.entries(counts)) out[r] = n / total;
    return out;
};

/** L1 distance between two normalized mixes (0-2). Null when either side
 *  is empty. */
export const regimeMixL1 = (a: RegimeMix | null, b: RegimeMix | null): number | null => {
    if (!a || !b) return null;
    let d = 0;
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
        d += Math.abs((a[k] ?? 0) - (b[k] ?? 0));
    }
    return d;
};

export const isRegimeMixDivergent = (a: RegimeMix | null, b: RegimeMix | null): boolean => {
    const l1 = regimeMixL1(a, b);
    return l1 !== null && l1 > REGIME_MIX_L1_THRESHOLD;
};

/** Live flag: the skill's evidence mix vs the market's current mix. Derived
 *  on every read — fresh evidence in the current mix re-converges the mixes
 *  and clears the flag automatically. */
export const isStaleByRegime = (
    meta: Pick<SkillMeta, 'regimeStats'>,
    coin: string | undefined,
): boolean => isRegimeMixDivergent(skillEvidenceMixWeights(meta.regimeStats), currentRegimeMix(coin));

/** Ranking multiplier: 1 normally, STALE_BY_REGIME_DOWNWEIGHT when the
 *  skill is stale-by-regime. */
export const regimeRankFactor = (
    meta: Pick<SkillMeta, 'regimeStats'>,
    coin: string | undefined,
): number => (isStaleByRegime(meta, coin) ? STALE_BY_REGIME_DOWNWEIGHT : 1);
