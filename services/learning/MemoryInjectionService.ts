/**
 * MemoryInjectionService — a bounded, per-user log of what retrieval ACTUALLY
 * injected into prompts, as opposed to what merely matched a setup.
 *
 * Before this log existed, skill evidence and lift were attributed by setup
 * match alone: a skill could be credited or blamed for trades it never
 * influenced (budgets, audience filters and stage gating mean a matching
 * skill is often not injected at all). getMemoryFilesContext records every
 * real injection here (fire-and-forget), and the effectiveness review +
 * dashboard consume the records so "skills appear here once injected" is
 * literally true.
 */

import { getPreferenceObject, setPreferenceObject } from '../infrastructure/PreferencesService';

export interface InjectedSource {
    path: string;
    kind: string;
}

export interface MemoryInjectionRecord {
    ts: string;
    stage: string;
    audience: string;
    coin?: string;
    sources: InjectedSource[];
}

const KEY_PREFIX = 'memory_injections_v1_';
/** Newest-first; oldest records fall off. A few hundred runs is plenty for attribution. */
const MAX_RECORDS = 400;

export const recordMemoryInjection = async (
    username: string,
    record: Omit<MemoryInjectionRecord, 'ts'>,
): Promise<void> => {
    try {
        const key = `${KEY_PREFIX}${(username || 'default').trim() || 'default'}`;
        const prev = await getPreferenceObject<MemoryInjectionRecord[]>(key);
        const next = [
            { ...record, ts: new Date().toISOString() },
            ...(Array.isArray(prev) ? prev : []),
        ].slice(0, MAX_RECORDS);
        await setPreferenceObject(key, next);
    } catch {
        // Telemetry must never break prompt assembly.
    }
};

export const getRecentMemoryInjections = async (
    username: string,
): Promise<MemoryInjectionRecord[]> => {
    try {
        const key = `${KEY_PREFIX}${(username || 'default').trim() || 'default'}`;
        const recs = await getPreferenceObject<MemoryInjectionRecord[]>(key);
        return Array.isArray(recs) ? recs : [];
    } catch {
        return [];
    }
};

/**
 * TRUE when `skillFileName` appears in any injection record newer than
 * `sinceMs` (or ever, when omitted). NULL when the user's log is EMPTY —
 * no telemetry yet means UNKNOWN, not "never injected": callers must give
 * full credit on null so tiering cannot starve before telemetry exists.
 */
export const skillInjectedSince = async (
    username: string,
    skillFileName: string,
    sinceMs?: number,
): Promise<boolean | null> => {
    const recs = await getRecentMemoryInjections(username);
    if (recs.length === 0) return null;
    const cutoff = sinceMs ? new Date(Date.now() - sinceMs).toISOString() : null;
    return recs.some(r =>
        (!cutoff || r.ts >= cutoff)
        && r.sources.some(s => s.path === `skills/${skillFileName}`)
    );
};
