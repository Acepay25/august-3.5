/**
 * §4.6 — self-improvement loop (Part 16 port; plan §4.6 A→E).
 *
 * Episodes, not conversations: closed-trade post-mortems resolving against
 * ground truth (price resolved). Tier-1 FREE heuristics over everything
 * (deterministic fingerprint + classification); the LLM judge is GATED — the
 * default is extract-only (mine episodes, draft NOTHING) until a judge
 * precision ≥ 0.8 over ≥ 30 hand-labeled episodes is recorded (ruling 1).
 *
 *   A  extractor — post-hoc, read-only: outcome-linked episodes, 180d retention
 *   B  fingerprints + tier-1 scoring (dedupe, recurrence, cause-stability)
 *   C  judge gate — distill only when the precision gate is recorded
 *   D  review queue + pruning — create-drafts into the skill-draft inbox,
 *      amend-trigger/body proposals + demote SUGGESTIONS into the learning
 *      queue; human-gated (a proposal is never an action)
 *   E  measurement — fingerprint↔skill link, recurrence_after_install, zero
 *      recurrence in 30 days = resolved (skill credited); recurrence auto-
 *      drafts a revision proposal (never a silent rewrite).
 *
 * Everything is an offline, read-only pass beside the weekly review — no
 * runtime door opens, no debate seat ever waits on it.
 */

import { getPreferenceObject, setPreferenceObject } from '../infrastructure/PreferencesService';
import { LoggedTrade } from '../../types/trade';
import { TradeOutcome } from '../../types/enums';
import { listSkills, type SkillMeta } from './SkillMemoryService';
import { extractLessonFromPostMortem } from './MemoryFilesService';
import { parseIfThenClauses } from '../../utils/ifThenSkill';
import { queueSkillDraft } from '../../utils/skillDrafts';
import { queueLearningProposal } from '../../utils/learningQueue';
import type { CraftedSkill } from '../../schemas/learning';
import { getRecentMemoryInjections } from './MemoryInjectionService';

export const EPISODE_RETENTION_DAYS = 180;
export const FLAG_MIN_OCCURRENCES = 2;
export const JUDGE_PRECISION_MIN = 0.8;
export const JUDGE_GATE_SAMPLES = 30;
export const RESOLVED_AFTER_DAYS = 30;

// ─── A: episodes ─────────────────────────────────────────────────────────────

export interface LearningEpisode {
    id: string;
    ts: string;
    tradeId?: string;
    coin?: string;
    direction?: string;
    family?: string;
    rootCauseClass?: string;
    outcome: 'win' | 'loss';
    keyLesson: string;
    clause: string;
}

/** Post-hoc, read-only: closed trades with a post-mortem, 180d retention. */
export const extractEpisodes = (trades: LoggedTrade[], now = Date.now()): LearningEpisode[] => {
    const cutoff = now - EPISODE_RETENTION_DAYS * 86_400_000;
    const out: LearningEpisode[] = [];
    for (const t of trades) {
        if (!t.id || !t.timestamp) continue;
        if (Date.parse(t.timestamp) < cutoff) continue;
        if (t.outcome !== TradeOutcome.WIN && t.outcome !== TradeOutcome.LOSS) continue;
        out.push({
            id: `pm:${t.id}`,
            ts: t.timestamp,
            tradeId: t.id,
            coin: t.analysis?.coinName,
            direction: t.analysis?.direction,
            family: t.analysis?.detectedPatternFamily,
            rootCauseClass: t.rootCauseClass ?? undefined,
            outcome: t.outcome === TradeOutcome.WIN ? 'win' : 'loss',
            keyLesson: extractLessonFromPostMortem(t.postMortem ?? ''),
            clause: (parseIfThenClauses(t.postMortem ?? '')[0] ?? {}).ifCondition ?? '',
        });
    }
    return out;
};

// ─── B: fingerprints + tier-1 scoring ───────────────────────────────────────

export interface FailureFingerprint {
    fp: string;
    count: number;
    firstSeen: string;
    lastSeen: string;
    /** Present ⇒ cause-stable (mineable); absent ⇒ unknown:<first-line> bucket. */
    rootCauseClass: string | null;
    stable: boolean;
}

const norm = (s: string | undefined): string =>
    (s || '')
        .toLowerCase()
        .replace(/\b[a-z0-9]{6,}\b/g, ' ')
        .replace(/\b\d+(\.\d+)?\b/g, ' ')
        .replace(/[^a-z0-9 ]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

export const fingerprintOfEpisode = (e: LearningEpisode): string => {
    // The failure class IS the fingerprint's identity — cause-stability is
    // what decides whether the pattern is mineable at all.
    const cause = e.rootCauseClass
        ? norm(e.rootCauseClass)
        : `unknown:${norm(e.keyLesson).slice(0, 40) || 'unclassifiable'}`;
    const lesson = norm(e.keyLesson) || 'no-lesson';
    return [
        cause,
        norm(e.coin ?? ''), norm(e.direction ?? ''), norm(e.family ?? ''),
        norm(e.clause) || lesson,
    ].filter(Boolean).join('|');
};

/** Tier-1 re-bucketing: 2+ occurrences AND a stable cause ⇒ flagged. */
export const fingerprintEpisodes = (episodes: LearningEpisode[]): FailureFingerprint[] => {
    const map = new Map<string, FailureFingerprint>();
    for (const e of episodes) {
        const fp = fingerprintOfEpisode(e);
        const cur = map.get(fp) ?? {
            fp,
            count: 0,
            firstSeen: e.ts,
            lastSeen: e.ts,
            rootCauseClass: e.rootCauseClass ?? null,
            stable: Boolean(e.rootCauseClass),
        };
        cur.count += 1;
        if (e.ts < cur.firstSeen) cur.firstSeen = e.ts;
        if (e.ts > cur.lastSeen) cur.lastSeen = e.ts;
        map.set(fp, cur);
    }
    return [...map.values()];
};

export const isFlagged = (f: FailureFingerprint): boolean =>
    f.stable && f.count >= FLAG_MIN_OCCURRENCES;

// ─── C: judge gate (extract-only until the precision gate is recorded) ──────

const GATE_KEY = 'learning_judge_gate_v1_';

export const recordJudgePrecision = async (
    username: string,
    precision: number,
    samples: number,
): Promise<void> => {
    if (precision < JUDGE_PRECISION_MIN || samples < JUDGE_GATE_SAMPLES) return;
    try {
        await setPreferenceObject(GATE_KEY + username, { precision, samples, recordedAt: new Date().toISOString() });
    } catch { /* best-effort */ }
};

export const isJudgeEnabled = async (username: string): Promise<boolean> => {
    try {
        const g = await getPreferenceObject<{ precision?: number; samples?: number }>(GATE_KEY + username);
        return Boolean(g && typeof g.precision === 'number' && g.precision >= JUDGE_PRECISION_MIN && (g.samples ?? 0) >= JUDGE_GATE_SAMPLES);
    } catch {
        return false;
    }
};

// ─── C/D: classify + queue distill actions (deterministic tier-1) ────────────

export type DistillActionType = 'create' | 'amend-trigger' | 'amend-body' | 'none';

export interface DistillAction {
    type: DistillActionType;
    fp: string;
    targetSlug?: string;
    reason: string;
}

const meaningful = (s: string | undefined): string[] =>
    norm(s).split(' ').filter(t => t.length >= 3);

const overlap = (a: string[], b: string[]): number =>
    [...new Set(a)].filter(x => b.includes(x)).length;

/** Deterministic ladder: no covering skill → create; shallow overlap →
 *  amend-trigger; deep overlap → amend-body. (`skills` = live, confirmed.) */
export const classifyDistillAction = (
    f: FailureFingerprint,
    skills: Array<{ slug: string; meta: SkillMeta }>,
): DistillAction => {
    const ftok = meaningful(f.fp);
    let best: { slug: string; n: number } | null = null;
    for (const s of skills) {
        const n = overlap(ftok, meaningful(s.meta.ifCondition));
        if (!best || n > best.n) best = { slug: s.slug, n };
    }
    if (!best || best.n === 0) return { type: 'create', fp: f.fp, reason: `no covering skill (${f.count} occurrences, ${f.rootCauseClass ?? 'unknown cause'})` };
    if (best.n >= 3) return { type: 'amend-body', fp: f.fp, targetSlug: best.slug, reason: `covered by ${best.slug} but the recurrence say the body (Pitfalls) needs the update` };
    return { type: 'amend-trigger', fp: f.fp, targetSlug: best.slug, reason: `covered by ${best.slug} but the trigger keeps missing this cluster` };
};

/** Deterministic draft substrate for the 'create' action (no LLM needed —
 *  the lesson text + setup produce the artifact the inbox will review). */
export const craftDraftFromEpisode = (e: LearningEpisode, fp: string): CraftedSkill => {
    const when = e.clause || [e.coin, e.family].filter(Boolean).join(' ') || 'the replayed setup';
    const avoid = e.outcome === 'loss';
    return {
        name: `${avoid ? 'Avoid' : 'Repeat'} ${e.coin ?? ''} ${e.family ?? ''}`.trim(),
        kind: avoid ? 'avoid' : 'repeat',
        when,
        inputs: [e.coin ?? '', e.direction ?? '', e.family ?? ''].filter(Boolean),
        steps: [e.keyLesson || 'follow the documented procedure'],
        validate: 'setup matches the fingerprint context',
        output: avoid ? 'skip the trade' : 'execute per the plan',
        approval: 'never auto-size',
        ifCondition: (e.clause || e.keyLesson || `${e.coin} ${e.family} ${fp}`).slice(0, 80),
        thenAction: avoid ? 'skip until the thesis confirms' : 'enter when the confirm candle closes',
    };
};

const DRAFTS_KEY = 'learning_distill_drafts_v1_';

/** One draft per (fingerprint, action, target) — dedupe ledger. */
export const queueDistillDrafts = async (
    username: string,
    actions: DistillAction[],
    episodes: LearningEpisode[],
): Promise<{ drafts: number; proposals: number }> => {
    const key = `${DRAFTS_KEY}:${username}`;
    try {
        const prev = (await getPreferenceObject<string[]>(key)) ?? [];
        const used = new Set(prev);
        let drafts = 0;
        let proposals = 0;
        for (const action of actions) {
            const dedupe = `${action.fp}|${action.type}|${action.targetSlug ?? ''}`;
            if (used.has(dedupe)) continue;
            if (action.type === 'create') {
                const ep = episodes.find(e => fingerprintOfEpisode(e) === action.fp);
                if (!ep) continue;
                queueSkillDraft({ tradeId: ep.tradeId ?? `fp:${action.fp}`, coin: ep.coin, crafted: craftDraftFromEpisode(ep, action.fp) }, username);
            } else if (action.targetSlug) {
                queueLearningProposal({
                    kind: 'rescope',
                    skillSlug: action.targetSlug,
                    text: `Recurring failure fingerprint "${action.fp.slice(0, 60)}" needs a ${action.type.replace('-', ' ')}: ${action.reason}. (${action.type === 'amend-body' ? 'Pitfalls-only until the judge precision gate is recorded.' : ''})`,
                    fingerprint: `distill|${dedupe}`,
                    payload: { fp: action.fp, type: action.type },
                }, username);
            }
            used.add(dedupe);
            if (action.type === 'create') drafts += 1;
            else if (action.targetSlug) proposals += 1;
        }
        await setPreferenceObject(key, [...used].slice(-500));
        return { drafts, proposals };
    } catch {
        return { drafts: 0, proposals: 0 };
    }
};

// ─── D: pruning (demote SUGGESTION — never automatic) ───────────────────────

export const queueDemoteSuggestions = async (
    username: string,
    skills: Array<{ slug: string; meta: SkillMeta }>,
    injections: Awaited<ReturnType<typeof getRecentMemoryInjections>>,
): Promise<number> => {
    const cutoff = Date.now() - RESOLVED_AFTER_DAYS * 86_400_000;
    let queued = 0;
    for (const { slug, meta } of skills) {
        if (meta.status !== 'confirmed') continue;
        const zeroEvidence = (meta.wins + meta.losses) === 0 || !meta.lastEvidenceAt || Date.parse(meta.lastEvidenceAt) < cutoff;
        const hit = injections.some(r => r.sources.some(s => s.path === `skills/${slug}.md`) && r.ts >= new Date(cutoff).toISOString());
        if (zeroEvidence && !hit) {
            const p = queueLearningProposal({
                kind: 'demote',
                skillSlug: slug,
                text: `Skill "${slug}" has zero recorded evidence AND zero injection hits in ${RESOLVED_AFTER_DAYS} days — demote SUGGESTION (never automatic; expel from injection until evidence returns).`,
                fingerprint: `demote|${slug}`,
                payload: { slug },
            }, username);
            if (p) queued += 1;
        }
    }
    return queued;
};

// ─── E: measurement loop ─────────────────────────────────────────────────────

export interface FingerprintMeasurement {
    fp: string;
    skillSlug?: string;
    linkedAt?: string;
    resolvedAt?: string;
    recurredAfterInstall: number;
    lastSeen: string;
}

const MEASURE_KEY = 'learning_measure_v1_';

const loadMeasurements = async (username: string): Promise<FingerprintMeasurement[]> => {
    try {
        const raw = await getPreferenceObject<FingerprintMeasurement[]>(MEASURE_KEY + username);
        return Array.isArray(raw) ? raw : [];
    } catch {
        return [];
    }
};

const saveMeasurements = async (username: string, list: FingerprintMeasurement[]): Promise<void> => {
    try {
        await setPreferenceObject(MEASURE_KEY + username, list.slice(-200));
    } catch { /* best-effort */ }
};

/** Link fingerprints to skills (token overlap ≥2), resolve on zero recurrence,
 *  count recurrence_after_install + auto-draft a revision proposal. */
export const measureFingerprints = async (
    username: string,
    fingerprints: FailureFingerprint[],
    skills: Array<{ slug: string; meta: SkillMeta }>,
): Promise<number> => {
    const list = await loadMeasurements(username);
    const byFp = new Map(list.map(m => [m.fp, m]));
    let revisionProposals = 0;
    for (const f of fingerprints) {
        const cur = byFp.get(f.fp);
        if (!cur) {
            byFp.set(f.fp, {
                fp: f.fp,
                skillSlug: undefined,
                linkedAt: undefined,
                recurredAfterInstall: 0,
                lastSeen: f.lastSeen,
            });
            continue;
        }
        // A fingerprint that was unlinked on a previous pass (no covering
        // skill then) still gets linked once a skill appears — so a skill
        // created by a later distill can be held accountable.
        if (!cur.skillSlug && !cur.resolvedAt) {
            const link = skills.find(s => overlap(meaningful(f.fp), meaningful(s.meta.ifCondition)) >= 2);
            if (link) {
                cur.skillSlug = link.slug;
                cur.linkedAt = new Date().toISOString();
            }
        }
        // Recurrence after a skill was linked: the skill did not prevent it.
        if (cur.skillSlug && !cur.resolvedAt && f.count > 1) {
            cur.recurredAfterInstall += 1;
            cur.lastSeen = f.lastSeen;
            const p = queueLearningProposal({
                kind: 'rescope',
                skillSlug: cur.skillSlug,
                text: `Skill "${cur.skillSlug}" did not prevent recurrence of fingerprint "${f.fp.slice(0, 50)}" (${f.count} occurrences) — amend or retire (human decision).`,
                fingerprint: `recurrence|${f.fp}`,
                payload: { fp: f.fp, count: f.count },
            }, username);
            if (p) revisionProposals += 1;
        } else if (!cur.resolvedAt) {
            // No new occurrence since the link → resolved; credit the skill.
            const since = Date.now() - Date.parse(cur.linkedAt ?? cur.lastSeen);
            if (since >= RESOLVED_AFTER_DAYS * 86_400_000) {
                cur.resolvedAt = new Date().toISOString();
                cur.lastSeen = f.lastSeen;
            }
        }
    }
    await saveMeasurements(username, [...byFp.values()]);
    return revisionProposals;
};

export const loadLearningMetrics = async (username: string): Promise<{
    drafts: number;
    open: number;
    resolved: number;
    recurred: number;
    demoteSuggestions: number;
}> => {
    const m = await loadMeasurements(username);
    const demoteFp = new Set<string>();
    try {
        const raw = await getPreferenceObject<string[]>(`${DRAFTS_KEY}:${username}`);
        (raw ?? []).forEach(k => { if (k.includes('|demote|')) demoteFp.add(k); });
    } catch { /* ignore */ }
    return {
        drafts: m.filter(x => x.skillSlug).length,
        open: m.filter(x => x.skillSlug && !x.resolvedAt).length,
        resolved: m.filter(x => x.resolvedAt).length,
        recurred: m.reduce((s, x) => s + x.recurredAfterInstall, 0),
        demoteSuggestions: demoteFp.size,
    };
};

// ─── The pass: A → B → (judge gate) → D → E ─────────────────────────────────

export interface SelfImprovementResult {
    episodes: number;
    flagged: number;
    judgeEnabled: boolean;
    drafts: number;
    proposals: number;
    revisionProposals: number;
    demoteSuggestions: number;
}

export const runSelfImprovementPass = async (
    username: string,
    trades: LoggedTrade[],
): Promise<SelfImprovementResult> => {
    const episodes = extractEpisodes(trades);
    const fingerprints = fingerprintEpisodes(episodes);
    const flagged = fingerprints.filter(isFlagged);
    const skills = listSkills()
        .filter(({ meta }) => meta.status !== 'retired')
        .map(({ file, meta }) => ({ slug: file.name.replace(/\.md$/i, ''), meta }));
    const judgeEnabled = await isJudgeEnabled(username);

    if (!judgeEnabled) {
        // Extract-only default (ruling 1): mine + score, draft nothing.
        return {
            episodes: episodes.length,
            flagged: flagged.length,
            judgeEnabled: false,
            drafts: 0,
            proposals: 0,
            revisionProposals: 0,
            demoteSuggestions: 0,
        };
    }

    const actions = flagged.map(f => classifyDistillAction(f, skills));
    const { drafts, proposals } = await queueDistillDrafts(username, actions, episodes);
    let injections: Awaited<ReturnType<typeof getRecentMemoryInjections>> = [];
    try {
        injections = await getRecentMemoryInjections(username);
    } catch { /* best-effort */ }
    const demoteSuggestions = await queueDemoteSuggestions(username, skills, injections);
    const revisionProposals = await measureFingerprints(username, fingerprints, skills);

    return {
        episodes: episodes.length,
        flagged: flagged.length,
        judgeEnabled: true,
        drafts,
        proposals,
        revisionProposals,
        demoteSuggestions,
    };
};
