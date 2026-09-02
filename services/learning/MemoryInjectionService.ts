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
    /** §8.5c: actual chars of this block that made it into the prompt —
     *  the per-source cost half of budget economics. Absent on legacy
     *  records (cost falls back to the block-class average). */
    chars?: number;
    /** §8.3a adherence linkage: TRUE when the verdict actually CITED this
     *  skill (followed), FALSE when it was injected and ignored
     *  (overridden), undefined on legacy records / non-skill sources —
     *  callers must treat undefined as UNKNOWN and keep the old behavior. */
    cited?: boolean;
}

export interface MemoryInjectionRecord {
    ts: string;
    stage: string;
    audience: string;
    coin?: string;
    sources: InjectedSource[];
    /** §8.5a: true when this run was an ε-holdout run (skill injection
     *  withheld, so matched skills' outcomes belong to the CONTROL group). */
    holdout?: boolean;
    /** §8.3a: the originating run's id (the user message that triggered it).
     *  Trades carry the same id via runStats, so evidence attribution joins
     *  on THIS — exact, immune to log-time drift — instead of a time window
     *  (a window from trade.timestamp looks the WRONG way: the run that
     *  shaped the trade predates the log click). */
    runId?: string;
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
 * §8.3a three-state adherence join outcomes (see skillAdherenceForRun).
 * The evidence path gives full credit to followed + injected-unknown, routes
 * overridden to the amendment counter, and CONTROL to controlIds.
 */
export type SkillAdherence = 'followed' | 'overridden' | 'injected-unknown' | 'not-injected';

/**
 * §8.3a three-state adherence join for one skill, scoped to the run that
 * produced the trade. The join is EXACT (runId = the user message that
 * triggered the run, persisted on both the injection record and the trade):
 * a time window anchored on trade.timestamp cannot work — the run that
 * shaped the trade PREDATES the log click, so "records since the trade"
 * looked at later, unrelated runs and mislabeled every followed skill as
 * CONTROL.
 *   'followed'        — injected in this run AND cited by the verdict
 *   'overridden'      — injected in this run and NOT cited (ignored)
 *   'injected-unknown'— injected, but no citation annotation exists (legacy
 *                       records / opening-stage-only injection)
 *   'not-injected'    — this run recorded injections but none carried it (CONTROL)
 *   null              — no telemetry for this run at all (UNKNOWN → full credit)
 */
export const skillAdherenceForRun = async (
    username: string,
    skillFileName: string,
    runId?: string,
): Promise<SkillAdherence | null> => {
    if (!runId) return null; // legacy trade without run linkage — UNKNOWN
    const recs = await getRecentMemoryInjections(username);
    const scoped = recs.filter(r => r.runId === runId);
    if (scoped.length === 0) return null; // predates runId persistence — UNKNOWN
    let injected = false;
    let cited: boolean | null = null;
    for (const r of scoped) {
        for (const s of r.sources) {
            if (s.path !== `skills/${skillFileName}`) continue;
            injected = true;
            if (s.cited === true) cited = true;
            else if (s.cited === false && cited !== true) cited = false;
        }
    }
    if (!injected) return 'not-injected';
    if (cited === true) return 'followed';
    if (cited === false) return 'overridden';
    return 'injected-unknown';
};

/**
 * §8.3a citation stamp — called once at verdict commit with the final
 * verdict's own text. For every skill source in the NEWEST verdict-stage
 * record that carries it, set `cited` by a deterministic textual join:
 * the verdict echoes the skill's file stem, its title words, or a majority
 * of the significant words of its IF clause. Opening-stage records are
 * never stamped (an analyst seeing a skill is not the moderator citing it),
 * so unannotated verdicts keep the conservative 'injected-unknown' credit.
 */
export const annotateVerdictCitations = async (
    username: string,
    verdictText: string,
    runId?: string,
): Promise<void> => {
    try {
        // The verdict-stage record is written fire-and-forget by retrieval;
        // wait (briefly) for THIS run's record to land before stamping, so a
        // slow Preferences write can't make us annotate the PREVIOUS run.
        let recs = await getRecentMemoryInjections(username);
        if (runId) {
            for (let i = 0; i < 10; i++) {
                if (recs.some(r => r.runId === runId && r.stage === 'verdict')) break;
                await new Promise(res => setTimeout(res, 100));
                recs = await getRecentMemoryInjections(username);
            }
        }
        if (recs.length === 0) return;
        const text = (verdictText || '').toLowerCase();
        const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
        const verdictNorm = norm(text);
        const verdictWords = new Set(verdictNorm.split(' ').filter(w => w.length > 3));
        const cites = (slug: string): boolean => {
            const stem = slug.replace(/\.md$/i, '').toLowerCase();
            if (stem && text.toLowerCase().includes(stem)) return true;
            const title = norm(stem.replace(/[-_]/g, ' '));
            const titleWords = title.split(' ').filter(w => w.length > 3);
            if (titleWords.length >= 2 && titleWords.every(w => verdictWords.has(w))) return true;
            return false;
        };
        // Newest-first: only the first verdict-stage record per slug is stamped.
        // With a runId, ONLY that run's record is a candidate (exact join).
        const seen = new Set<string>();
        let changed = false;
        for (const r of recs) {
            if (r.stage !== 'verdict') continue;
            if (runId && r.runId !== runId) continue;
            for (const s of r.sources) {
                if (s.kind !== 'skill' || !s.path.startsWith('skills/')) continue;
                const slug = s.path.slice('skills/'.length);
                if (!slug || seen.has(slug)) continue;
                seen.add(slug);
                s.cited = cites(slug);
                changed = true;
            }
        }
        if (!changed) return;
        const key = `${KEY_PREFIX}${(username || 'default').trim() || 'default'}`;
        await setPreferenceObject(key, recs.slice(0, MAX_RECORDS));
    } catch {
        // Telemetry must never break the verdict commit.
    }
};
