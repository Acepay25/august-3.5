/**
 * Skill birth certificates (plan §8.2a).
 *
 * A skill that carries no falsifiable claim cannot be confirmed or retired on
 * principle — the ladder degenerates to threshold magic. This module owns the
 * claim shape, its frontmatter round-trip, the deterministic default claim
 * derived from the evidence cluster that spawned the skill, and the verdict
 * that tests the claim against realized FOLLOWED evidence.
 *
 * Pure functions: no notebook writes, no LLM, no network.
 */

export interface SkillPredictionScope {
    coin?: string;
    family?: string;
    regime?: string;
}

export interface SkillPrediction {
    /** Minimum win-rate delta claimed (percentage points, 1..50). */
    expectedLiftPts: number;
    /** Trades over which the claim must hold. */
    horizonTrades: number;
    /** The claim is only tested inside this scope. */
    scope: SkillPredictionScope;
}

const clampInt = (n: number, lo: number, hi: number): number =>
    Math.min(hi, Math.max(lo, Math.round(Number.isFinite(n) ? n : lo)));

/** Normalize anything into a valid prediction, or null when there is no claim. */
export const sanitizePrediction = (raw: unknown): SkillPrediction | null => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const r = raw as Record<string, unknown>;
    const lift = typeof r.expectedLiftPts === 'number' ? r.expectedLiftPts : NaN;
    const horizon = typeof r.horizonTrades === 'number' ? r.horizonTrades : NaN;
    if (!Number.isFinite(lift) || !Number.isFinite(horizon)) return null;
    const scopeRaw = r.scope && typeof r.scope === 'object' && !Array.isArray(r.scope)
        ? r.scope as Record<string, unknown>
        : {};
    const str = (v: unknown): string | undefined =>
        typeof v === 'string' && v.trim() ? v.trim().slice(0, 40) : undefined;
    return {
        expectedLiftPts: clampInt(lift, 1, 50),
        horizonTrades: clampInt(horizon, 5, 50),
        scope: {
            coin: str(scopeRaw.coin),
            family: str(scopeRaw.family),
            regime: str(scopeRaw.regime),
        },
    };
};

/**
 * Deterministic default claim from the cluster that spawned the skill:
 * "the win rate on this scope moves at least 10pp from the cluster's own
 * baseline, measured over 10 trades." The worth gate may tighten it; nothing
 * may leave it off.
 */
export const defaultPrediction = (scope: SkillPredictionScope): SkillPrediction => ({
    expectedLiftPts: 10,
    horizonTrades: 10,
    scope: {
        coin: scope.coin?.toUpperCase().replace(/USDT?$/, ''),
        family: scope.family,
        regime: scope.regime,
    },
});

/** Frontmatter serialization: one compact JSON line. */
export const serializePrediction = (p: SkillPrediction): string =>
    `prediction: ${JSON.stringify(p)}`;

/** Frontmatter parse (the `pick()` line is already extracted by the caller). */
export const parsePredictionLine = (raw: string | undefined): SkillPrediction | null => {
    if (!raw) return null;
    const trimmed = raw.trim();
    if (!trimmed.startsWith('{')) return null;
    try {
        return sanitizePrediction(JSON.parse(trimmed));
    } catch {
        return null;
    }
};

export interface ClaimTestEvidence {
    wins: number;
    losses: number;
}

export interface ClaimVerdict {
    met: boolean;
    /** True when the horizon has not been reached yet — keep waiting. */
    pending: boolean;
    followedWinRate: number | null;
    /** The bar the claim is judged against. */
    bar: number;
    reason: string;
}

/**
 * Test a skill against its OWN claim (replaces the generic hurts/helps
 * question at the scheduler). The bar differs by kind:
 *   repeat — the followed win rate must clear the baseline (50%) plus the
 *            claimed lift.
 *   avoid  — the setups the skill steered AWAY from must win LESS than
 *            baseline minus the claimed lift (a working avoid shrinks the
 *            win rate of what it suppressed).
 * Below the horizon the verdict is `pending` — a claim is not refuted early.
 */
export const evaluateClaim = (
    kind: 'repeat' | 'avoid',
    prediction: SkillPrediction,
    evidence: ClaimTestEvidence,
): ClaimVerdict => {
    const sample = evidence.wins + evidence.losses;
    const followedWinRate = sample > 0 ? evidence.wins / sample : null;
    const lift = prediction.expectedLiftPts / 100;
    const bar = kind === 'avoid'
        ? Math.max(0, 0.5 - lift)
        : Math.min(1, 0.5 + lift);
    if (sample < prediction.horizonTrades) {
        return {
            met: false,
            pending: true,
            followedWinRate,
            bar,
            reason: `claim horizon not reached (${sample}/${prediction.horizonTrades} followed trades)`,
        };
    }
    const met = kind === 'avoid'
        ? (followedWinRate ?? 1) <= bar
        : (followedWinRate ?? 0) >= bar;
    return {
        met,
        pending: false,
        followedWinRate,
        bar,
        reason: met
            ? `claim met: ${Math.round((followedWinRate ?? 0) * 100)}% vs bar ${Math.round(bar * 100)}% over ${sample} followed trades`
            : `claim unmet: ${Math.round((followedWinRate ?? 0) * 100)}% vs bar ${Math.round(bar * 100)}% over ${sample} followed trades`,
    };
};
