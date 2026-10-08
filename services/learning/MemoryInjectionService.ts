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
import { parseFollowedSkills, normalizeSkillSlug } from '../../utils/followedSkills';

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
    /** Adherence linkage: TRUE when the verdict actually CITED this
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

/** slug (file name, `.md` included) → the skill's IF clause, for arm 3 of
 *  the citation join. Built per annotate call, never cached across calls:
 *  skills are edited between verdicts and a stale clause would stamp the
 *  wrong way. DYNAMIC imports on purpose — SkillMemoryService statically
 *  imports THIS module (`recordMemoryInjection`, `skillAdherenceForRun`),
 *  so importing it statically here would be a cycle. Any failure yields an
 *  empty map: arms 1-2 need no store, so the stamp degrades to the
 *  two-join behavior instead of failing the commit. */
const loadSkillConditions = async (): Promise<Map<string, string>> => {
    const map = new Map<string, string>();
    try {
        const [memoryFiles, skillMemory] = await Promise.all([
            import('./MemoryFilesService'),
            import('./SkillMemoryService'),
        ]);
        for (const file of memoryFiles.getMemoryFiles().files) {
            if (!skillMemory.isSkillFile(file)) continue;
            const condition = skillMemory.parseSkillMarkdown(file.content)?.ifCondition;
            if (condition) map.set(file.name, condition);
        }
    } catch {
        // Citation stamping is telemetry — never fail the verdict commit.
    }
    return map;
};

/**
 * Citation stamp — called once at verdict commit with the final
 * verdict's own text. For every skill source in the NEWEST verdict-stage
 * record that carries it, set `cited` by a deterministic textual join with
 * THREE arms, tried in order by `cites` below:
 *   1. the verdict echoes the skill's file stem;
 *   2. it carries every significant word of the skill's title (the stem
 *      split on - and _);
 *   3. it carries a MAJORITY of the significant words of the skill's
 *      IF clause — at least 3 distinct words AND more than half of them.
 * Arm 3 matters because the honest citation often never names the file: a
 * verdict that FOLLOWS a skill describes its condition in its own words.
 * With only stems and titles, such a verdict was stamped `cited:false` —
 * scored 'overridden', counting against the skill's evidence and queueing
 * amendment proposals against a rule the verdict actually obeyed. The
 * ≥3-word floor stops two generic words ("rising average") from citing a
 * long clause on coincidence.
 * Opening-stage records are never stamped (an analyst seeing a skill is not
 * the moderator citing it), so unannotated verdicts keep the conservative
 * 'injected-unknown' credit.
 */
export const annotateVerdictCitations = async (
    username: string,
    verdictText: string,
    runId?: string,
): Promise<void> => {
    try {
        const key = keyFor(username);
        // P1-5: the moderator now NAMES the skills it followed, so the join is
        // exact for any verdict carrying the line. `null` = the line is absent
        // (an older transcript) and the word-overlap heuristic below stands in.
        const declared = parseFollowedSkills(verdictText || '');
        // P1-5: await the EXACT in-flight write for this run instead of
        // sleeping in ten 100 ms polls hoping the record landed. In the common
        // case retrieval already recorded the verdict slice while the
        // moderator was still streaming, so this returns immediately.
        const recs = await awaitInjectionRecord(username, runId, 'verdict');
        if (recs.length === 0) return;
        const conditionBySlug = await loadSkillConditions();
        const text = (verdictText || '').toLowerCase();
        const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
        const verdictNorm = norm(text);
        const verdictWords = new Set(verdictNorm.split(' ').filter(w => w.length > 3));
        const cites = (slug: string): boolean => {
            // P1-5: the declared line WINS when it is present. A model that
            // named its skills has answered the question; the heuristic below
            // is a guess about a question it already answered, and the guess is
            // what misrouted real evidence.
            if (declared) return declared.includes(normalizeSkillSlug(slug));
            const stem = slug.replace(/\.md$/i, '').toLowerCase();
            if (stem && text.toLowerCase().includes(stem)) return true;
            const title = norm(stem.replace(/[-_]/g, ' '));
            const titleWords = title.split(' ').filter(w => w.length > 3);
            if (titleWords.length >= 2 && titleWords.every(w => verdictWords.has(w))) return true;
            // Arm 3 — the IF clause: a verdict that follows the skill by
            // PARAPHRASING its condition still cites it. Majority of the
            // clause's significant words (≥3 distinct, > half of them); the
            // floor keeps two generic words from citing a long clause.
            const condition = conditionBySlug.get(slug);
            if (!condition) return false;
            const condWords = new Set(norm(condition).split(' ').filter(w => w.length > 3));
            if (condWords.size === 0) return false;
            let matched = 0;
            for (const w of condWords) if (verdictWords.has(w)) matched += 1;
            return matched >= 3 && matched * 2 > condWords.size;
        };
        await withSerializedPref(key, async () => {
            // Re-read INSIDE the lock: the polls above may have raced appends
            // that landed after the last read.
            const current = await getRecentMemoryInjections(username);
            if (current.length === 0) return;
            // Newest-first: only the first verdict-stage record per slug is
            // stamped. With a runId, ONLY that run's record is a candidate
            // (exact join).
            const seen = new Set<string>();
            let changed = false;
            for (const r of current) {
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
            await setPreferenceObject(key, current.slice(0, MAX_INJECTION_RECORDS));
        });
    } catch {
        // Telemetry must never break the verdict commit.
    }
};
