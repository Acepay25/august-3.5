/**
 * Provider fitness — one 0..1 score per provider that combines outcome
 * performance (rolling win rate, cold streak) with process quality
 * (preflight pass rate, recorded by the lens preflight gate).
 *
 * Consumers:
 *   - autoAssignLenses (AnalystLensService) drops providers whose fitness is
 *     at/below FITNESS_FILTER_THRESHOLD with enough evidence behind it, so an
 *     underperformer is demoted from the NEXT auto-assigned roster.
 *   - mid-debate replacement offers sort candidates fittest-first.
 *
 * Providers with fewer than MIN_FITNESS_SAMPLES outcome trades score the
 * neutral 0.5 — never punished on thin evidence. All reads are best-effort:
 * a broken performance store degrades to neutral, never throws.
 */

import { getPreferenceObject, setPreferenceObject } from '../infrastructure/PreferencesService';
import { getRollingWindowStats } from '../backtesting/ModelPerformanceService';
import { getActiveUsername } from '../../utils/activeUser';

const KEY_PREFIX = 'preflight_results_v1_';
/** Rolling cap on stored preflight results (per user, across providers). */
const MAX_PREFLIGHT_RESULTS = 200;
/** Below this many outcome trades the score is the neutral default. */
export const MIN_FITNESS_SAMPLES = 5;
/** Non-neutral scores at/below this demote the provider from auto-rosters. */
export const FITNESS_FILTER_THRESHOLD = 0.3;
/** Each consecutive recent loss shaves this off the outcome component. */
const COLD_STREAK_PENALTY = 0.05;
/** Cold-streak penalty saturates here (4 losses). */
const MAX_COUNTED_COLD_STREAK = 4;
/** Weight of outcome performance vs. preflight process quality. */
const OUTCOME_WEIGHT = 0.7;

export interface PreflightResult {
    providerId: string;
    passed: boolean;
    at: string;
}

export interface ProviderFitness {
    providerId: string;
    /** 0..1, higher is fitter. 0.5 while evidence is thin. */
    score: number;
    /** Outcome trades behind the score. */
    samples: number;
    /** True when the score is the neutral default (samples < MIN_FITNESS_SAMPLES). */
    neutral: boolean;
    components: {
        /** Rolling win rate 0..1 (null when no outcome data). */
        winRate: number | null;
        /** Consecutive recent losses. */
        coldStreak: number;
        /** Preflight pass rate 0..1 (null when no preflight data). */
        preflightPassRate: number | null;
        /** Preflight results behind the pass rate. */
        preflightSamples: number;
    };
}

const keyFor = (username: string): string =>
    `${KEY_PREFIX}${(username || 'default').trim() || 'default'}`;

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

/**
 * Record one preflight gate outcome for a provider. Best-effort: telemetry
 * must never break the analysis path, so every failure is swallowed.
 */
export const recordPreflightResult = async (
    username: string,
    providerId: string,
    passed: boolean,
): Promise<void> => {
    try {
        const results = (await getPreferenceObject<PreflightResult[]>(keyFor(username))) ?? [];
        results.push({ providerId, passed, at: new Date().toISOString() });
        await setPreferenceObject(keyFor(username), results.slice(-MAX_PREFLIGHT_RESULTS));
    } catch { /* telemetry is best-effort */ }
};

/** Pass rate 0..1 for one provider, or null when it has no preflight data. */
export const getPreflightPassRate = async (
    username: string,
    providerId: string,
): Promise<{ rate: number | null; total: number }> => {
    try {
        const results = (await getPreferenceObject<PreflightResult[]>(keyFor(username))) ?? [];
        const mine = results.filter(r => r.providerId === providerId);
        if (mine.length === 0) return { rate: null, total: 0 };
        const passed = mine.filter(r => r.passed).length;
        return { rate: passed / mine.length, total: mine.length };
    } catch {
        return { rate: null, total: 0 };
    }
};

/**
 * Compute one provider's fitness. `username` defaults to the active user
 * (preflight results are per-user; rolling outcome stats are global).
 */
export const getProviderFitness = async (
    providerId: string,
    username?: string,
): Promise<ProviderFitness> => {
    let winRate: number | null = null;
    let coldStreak = 0;
    let samples = 0;
    try {
        const stats = getRollingWindowStats(providerId);
        samples = stats.last20Total;
        if (stats.last20Total > 0) winRate = stats.last20WinRate / 100;
        coldStreak = stats.coldStreakCount;
    } catch { /* performance store unavailable — stay neutral */ }

    let passRate: number | null = null;
    let preflightSamples = 0;
    try {
        const pf = await getPreflightPassRate(username ?? getActiveUsername(), providerId);
        passRate = pf.rate;
        preflightSamples = pf.total;
    } catch { /* preflight store unavailable */ }

    const components: ProviderFitness['components'] = {
        winRate,
        coldStreak,
        preflightPassRate: passRate,
        preflightSamples,
    };

    if (samples < MIN_FITNESS_SAMPLES) {
        return { providerId, score: 0.5, samples, neutral: true, components };
    }

    const outcome = clamp01(
        (winRate ?? 0.5) - Math.min(coldStreak, MAX_COUNTED_COLD_STREAK) * COLD_STREAK_PENALTY,
    );
    // Preflight quality is neutral (0.5) until the gate has data — providers
    // are never punished for a gate that has not watched them yet.
    const process = passRate ?? 0.5;
    const score = clamp01(OUTCOME_WEIGHT * outcome + (1 - OUTCOME_WEIGHT) * process);
    return { providerId, score, samples, neutral: false, components };
};

/**
 * Split providers into fit (keep) and unfit (non-neutral score at/below the
 * threshold). Never returns an empty keep list — when everyone is unfit the
 * original order is kept, because an empty roster is worse than a weak one.
 */
export const filterUnfitProviders = async <T extends { id: string }>(
    providers: T[],
    username?: string,
): Promise<{ kept: T[]; dropped: T[] }> => {
    if (providers.length <= 1) return { kept: providers, dropped: [] };
    let fitness: ProviderFitness[];
    try {
        fitness = await Promise.all(providers.map(p => getProviderFitness(p.id, username)));
    } catch {
        return { kept: providers, dropped: [] };
    }
    const byId = new Map(fitness.map(f => [f.providerId, f]));
    const kept: T[] = [];
    const dropped: T[] = [];
    for (const p of providers) {
        const f = byId.get(p.id);
        if (f && !f.neutral && f.score <= FITNESS_FILTER_THRESHOLD) dropped.push(p);
        else kept.push(p);
    }
    if (kept.length === 0) return { kept: providers, dropped: [] };
    return { kept, dropped };
};

/** Sort providers fittest-first (unknown/neutral scores keep their order). */
export const sortByFitness = async <T extends { id: string }>(
    providers: T[],
    username?: string,
): Promise<T[]> => {
    if (providers.length <= 1) return [...providers];
    let fitness: ProviderFitness[];
    try {
        fitness = await Promise.all(providers.map(p => getProviderFitness(p.id, username)));
    } catch {
        return [...providers];
    }
    const byId = new Map(fitness.map(f => [f.providerId, f]));
    return [...providers].sort((a, b) => (byId.get(b.id)?.score ?? 0.5) - (byId.get(a.id)?.score ?? 0.5));
};
