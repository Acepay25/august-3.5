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

import { getPreferenceArray, setPreferenceObject } from '../infrastructure/PreferencesService';
import { withSerializedPref } from '../infrastructure/serializedPrefs';

export interface InjectedSource {
    path: string;
    kind: string;
    /** Actual chars of this block that made it into the prompt —
     *  the per-source cost half of budget economics. Absent on legacy
     *  records (cost falls back to the block-class average). */
    chars?: number;
    /** Identity of the exact rendered block, for blocks whose TEXT varies while
     *  their `path` stays fixed (the recent-form brief differs by audience and
     *  by window). Lets a stored decision be traced to the context it saw. */
    fingerprint?: string;
}

export interface MemoryInjectionRecord {
    ts: string;
    stage: string;
    audience: string;
    coin?: string;
    sources: InjectedSource[];
    /** True when this run was an ε-holdout run (skill injection
     *  withheld, so matched skills' outcomes belong to the CONTROL group). */
    holdout?: boolean;
    /** The originating run's id (the user message that triggered it).
     *  Trades carry the same id via runStats, so evidence attribution joins
     *  on THIS — exact, immune to log-time drift — instead of a time window
     *  (a window from trade.timestamp looks the WRONG way: the run that
     *  shaped the trade predates the log click). */
    runId?: string;
}

const KEY_PREFIX = 'memory_injections_v1_';
/** Newest-first; oldest records fall off. A few hundred runs is plenty for attribution.
 *  Exported because `memoryHealth` has to say exactly how wide the window is that
 *  its "no hit recorded" signal is measured against. */
export const MAX_INJECTION_RECORDS = 400;

const keyFor = (username: string): string =>
    `${KEY_PREFIX}${(username || 'default').trim() || 'default'}`;

/** Runtime shape check for a stored record — junk blobs must not flow into
 *  skillAdherenceForRun's `for (const s of r.sources)` (see getPreferenceArray). */
const isInjectionRecord = (item: unknown): item is MemoryInjectionRecord => {
    const r = item as MemoryInjectionRecord | null;
    return !!r && typeof r === 'object'
        && typeof r.ts === 'string'
        && typeof r.stage === 'string'
        && Array.isArray(r.sources);
};

export const recordMemoryInjection = async (
    username: string,
    record: Omit<MemoryInjectionRecord, 'ts'>,
): Promise<void> => {
    const key = keyFor(username);
    // Serialized read-modify-write: per-stage/seat recorders run
    // concurrently, and an unguarded read→append→write loses whichever
    // append interleaved — a lost verdict record misroutes the followed
    // trade into CONTROL and starves the skill of credit.
    const write = withSerializedPref(key, async () => {
        const prev = await getRecentMemoryInjections(username);
        const next = [
            { ...record, ts: new Date().toISOString() },
            ...prev,
        ].slice(0, MAX_INJECTION_RECORDS);
        await setPreferenceObject(key, next);
    });
    // P1-5: publish the in-flight write so the verdict-citation stamp can
    // AWAIT the exact write it depends on instead of sleeping in 100 ms polls
    // hoping the record landed. That race is the whole reason the poll existed:
    // the verdict commit runs before retrieval's fire-and-forget write reaches
    // Preferences.
    const handoff = record.runId ? pendingKey(username, record.runId, record.stage) : null;
    if (handoff) {
        pendingWrites.set(handoff, write);
        // The entry is a handoff for a caller that is already waiting; leaving
        // it would pin a resolved promise per run for the session.
        void write.catch(() => undefined).then(() => {
            if (pendingWrites.get(handoff) === write) pendingWrites.delete(handoff);
        });
    }
    try {
        await write;
    } catch {
        // Telemetry must never break prompt assembly.
    }
};

/** In-flight injection writes, keyed by user+run+stage. See
 *  `awaitInjectionRecord` for why this exists instead of a disk poll. */
const pendingWrites = new Map<string, Promise<void>>();

const pendingKey = (username: string, runId: string, stage: string): string =>
    `${username}|${runId}|${stage}`;

/**
 * Wait for THIS run's injection write to land, without polling disk.
 *
 * Returns as soon as the in-flight write for that exact (user, run, stage)
 * settles — which in the common case is already true, because retrieval
 * records the verdict slice while the moderator is still streaming. The
 * bounded fallback only covers the case where the write has not STARTED yet
 * (a caller racing ahead of retrieval): it re-checks the persisted records a
 * few times, far less eagerly than the 10×100 ms sleep this replaced.
 */
export const awaitInjectionRecord = async (
    username: string,
    runId: string | undefined,
    stage: string,
    /** How many times to re-check when no write is in flight yet. */
    attempts = 5,
): Promise<MemoryInjectionRecord[]> => {
    if (runId) {
        const inflight = pendingWrites.get(pendingKey(username, runId, stage));
        if (inflight) {
            await inflight.catch(() => undefined);
            return getRecentMemoryInjections(username);
        }
    }
    let recs = await getRecentMemoryInjections(username);
    if (!runId) return recs;
    for (let i = 0; i < attempts; i++) {
        if (recs.some(r => r.runId === runId && r.stage === stage)) return recs;
        // The write may have been registered between checks.
        const inflight = pendingWrites.get(pendingKey(username, runId, stage));
        if (inflight) {
            await inflight.catch(() => undefined);
            return getRecentMemoryInjections(username);
        }
        await new Promise(res => setTimeout(res, 50));
        recs = await getRecentMemoryInjections(username);
    }
    return recs;
};

export const getRecentMemoryInjections = async (
    username: string,
): Promise<MemoryInjectionRecord[]> => {
    try {
        return await getPreferenceArray<MemoryInjectionRecord>(keyFor(username), isInjectionRecord);
    } catch {
        return [];
    }
};

/**
 * Three-state adherence join outcomes (see skillAdherenceForRun).
 * The evidence path gives full credit to followed + injected-unknown, routes
 * overridden to the amendment counter, and CONTROL to controlIds.
 */
export type SkillAdherence = 'followed' | 'overridden' | 'injected-unknown' | 'not-injected';

/**
 * Three-state adherence join for one skill, scoped to the run that
 * produced the trade. The join is EXACT (runId = the user message that
 * triggered the run, persisted on both the injection record and the trade):
 * a time window anchored on trade.timestamp cannot work — the run that
 * shaped the trade PREDATES the log click, so "records since the trade"
 * looked at later, unrelated runs and mislabeled every followed skill as
 * CONTROL.
 *   'followed'        — legacy value; the citation annotator is deleted
 *   'overridden'      — legacy value; the citation annotator is deleted
 *   'injected-unknown'— injected, but no citation annotation exists. This is
 *                       every new record (the live path is Message.injectedSkills)
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
    for (const r of scoped) {
        for (const s of r.sources) {
            if (s.path !== `skills/${skillFileName}`) continue;
            injected = true;
        }
    }
    if (!injected) return 'not-injected';
    // No citation field is written any more. A record that still carries an old
    // `cited` value on disk is read as unknown, deliberately: live attribution
    // runs through Message.injectedSkills → settlement reflection, and
    // resurrecting the dead annotator's heuristic would misroute credit again.
    return 'injected-unknown';
};



/**
 * (The verdict-citation annotator that lived here was REMOVED 2026-10-28: it had
 * no production caller, and its input — `verdict`-stage injection records — is
 * written by no live path since the debate engine left. Attribution on the path
 * that runs today is carried by `Message.injectedSkills`, stamped by the seat
 * prompt builder, and read by the settlement reflection
 * (services/learning/settlementReflection.ts) into the skill ledger. A function
 * that guesses which skills a verdict followed cannot be the basis of counted
 * evidence if nothing ever calls it; leaving it here implied verdicts were
 * annotated. Docs: the 2026-10-27 audit M-6.)
 */

