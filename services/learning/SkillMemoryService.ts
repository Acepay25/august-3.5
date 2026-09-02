/**
 * Evidence-gated skills in the trader notebook (skills/*.md).
 *
 * A skill is a procedure with a trigger and a win/loss score. The harness
 * creates one only after a cluster of similar closed trades; each new
 * WIN/LOSS updates the score; weak skills are retired. Analysts retrieve
 * matching skills — they do not get every skill dumped into the prompt.
 */

import { LoggedTrade, MemoryFile, TradeOutcome } from '../../types';
import { ProviderConfig } from '../../types/provider';
import {
    appendDiaryEntry,
    createMemoryFileUnlocked,
    ensureHarnessFoldersUnlocked,
    ensureSkillsArchiveFolderUnlocked,
    extractLessonFromPostMortem,
    getMemoryFiles,
    slugifyName,
    syncRecurringMistakes,
    updateMemoryFileUnlocked,
    withNotebookWriteLock,
} from './MemoryFilesService';
import { formatSkillProcedure, parseIfThenClauses, skillHitRate } from '../../utils/ifThenSkill';
import { maybePinWinningPromptLane } from '../../utils/promptVersionStats';
import { CraftedSkill } from '../../schemas/learning';
import { formatCraftedSkillBody, refineSkillFromLosses } from './SkillCraftService';
import {
    recordWorthGateApproval,
    recordWorthGateConfirm,
    recordRefinementOutcome,
    recordEvalAgreement,
} from './metaCalibration';
import {
    recordTombstone,
    findArchiveTwin,
    queueRevivalProposal,
    retirementReasonFromHistory,
} from './skillGraveyard';
import { isStaleByRegime } from '../../utils/regimeSentinel';
import { listSkillDrafts } from '../../utils/skillDrafts';
import { tradeAdmitsTechnicalStrategyRule } from '../../utils/rootCause';
import { familiesRelate } from '../../utils/patternMatch';
import { recordMemoryInjection, skillAdherenceForRun } from './MemoryInjectionService';
import { resolveMemoryConfig } from './MemoryModelService';
import {
    sanitizePrediction,
    serializePrediction,
    parsePredictionLine,
    defaultPrediction,
    evaluateClaim,
    type SkillPrediction,
} from '../../utils/skillPrediction';
import { ciGatePasses } from '../../utils/skillStatistics';
import { queueLearningProposal } from '../../utils/learningQueue';
import { getSkillLibraryCap } from '../../utils/harnessSettings';

export type SkillStatus = 'candidate' | 'confirmed' | 'retired';
export type SkillKind = 'repeat' | 'avoid';

export interface SkillMeta {
    status: SkillStatus;
    kind: SkillKind;
    /** One-sentence semantic summary (zcode memory pattern): what this skill
     *  claims, in prose. Generated at creation from the worth-gate rationale
     *  (or the IF/THEN pair), consumed by index lines, the recall tool, the
     *  grid subtitle and LLM judges. Absent on legacy skills. */
    description?: string;
    /** Provenance: id of the LOGGED TRADE whose closed-out cluster produced
     *  this skill — the deep-link back to "where did this belief come from".
     *  (Trades carry no link to their originating ensemble message, so the
     *  trade id is the deepest provenance available.) */
    originMessageId?: string;
    /** Set when this coin-scoped skill was absorbed into a coin-less
     *  generalized skill (skillGeneralization). Points at the generalized
     *  skill's file slug. A superseded skill is retired from matching but its
     *  evidence stays queryable — it is the control group for the generalized
     *  belief. */
    supersededBy?: string;
    coin?: string;
    direction?: string;
    family?: string;
    regime?: string;
    wins: number;
    losses: number;
    /** Running count of consecutive LOSS outcomes (reset by any WIN). A
     *  confirmed skill that reaches REFINE_AFTER_CONSECUTIVE_LOSSES gets an
     *  LLM refinement pass instead of silently bleeding. */
    consecutiveLosses: number;
    tradeIds: string[];
    /** Consecutive runs of the SAME eval verdict (helps/hurts). A 'hurts'
     *  demotion requires a streak >= 2 — one noisy A/B run must not bench a
     *  confirmed skill (sequential-evidence gating). Absent ⇒ legacy behavior
     *  (treated as confirmed). */
    evalStreak?: number;
    /** Matched-but-NOT-injected closed-trade ids (tail-capped). These are the
     *  CONTROL group for attribution: setups the skill could have influenced
     *  but provably didn't (no injection record in the window). They never
     *  enter wins/losses. */
    controlIds?: string[];
    /** Counted trade ids whose market regime DIFFERED from the skill's scope
     *  regime (tail-capped). applyEvidenceDecay already discounts these counts;
     *  this list just makes the discount VISIBLE — the dashboard can show "this
     *  belief was applied to a non-scope regime N times" so a skill that only
     *  "works" outside its stated regime is caught. */
    crossRegimeIds?: string[];
    /** ── §8.3a three-state adherence join ──
     *  Matched + injected + CITED by the verdict → counted in wins/losses
     *  (FOLLOWED). Matched + injected + NOT cited → this list (OVERRIDDEN):
     *  the moderator was handed the skill and ignored it, so the outcome
     *  belongs to neither the skill nor the control group. A high override
     *  rate is itself a signal — the amendment queue consumes it. */
    overriddenIds?: string[];
    /** ── §8.3b per-regime evidence splits ──
     *  wins/losses accumulated inside each regime, written alongside the
     *  global counters. When the split diverges (works in one regime, fails
     *  in another) the skill is CONDITIONAL, not fading — re-scope instead
     *  of decay. */
    regimeStats?: Record<string, { w: number; l: number }>;
    /** ── §8.2a birth certificate ──
     *  The falsifiable claim registered at creation. The eval scheduler
     *  tests the skill against THIS instead of a generic hurts/helps
     *  question; the ladder consumes the claim verdict. */
    prediction?: SkillPrediction;
    /** §8.2a: followed-evidence sample size at the last claim test — the
     *  claim is re-tested only when new evidence has landed since. */
    claimTestedEvidence?: number;
    /** ── §8.3c shadow refinement ──
     *  A refined version drafted after a loss streak does NOT swap into the
     *  live slot immediately — it waits here (eval-only) while the prior
     *  version keeps injecting for SHADOW_WINDOW_TRADES matched trades.
     *  The comparison then promotes whichever wins. */
    shadow?: {
        kind: SkillKind;
        ifCondition?: string;
        thenAction?: string;
        body: string;
        name?: string;
        startedAt: string;
        /** Matched trades observed since the shadow opened. */
        seen: number;
        wins: number;
        losses: number;
    };
    /** Total trades EVER counted for this skill. `tradeIds` is a
     *  tail-20 list; without this counter the verdict block's "learned from
     *  N logged trade(s)" understates long-lived skills forever. */
    evidenceCount?: number;
    ifCondition?: string;
    thenAction?: string;
    body: string;
    /** ISO timestamp of the last LLM refinement pass, if any. */
    refinedAt?: string;
    /** ISO timestamp of the most recent counted trade (evidence decay input). */
    lastEvidenceAt?: string;
    /** ISO timestamp of the last content write — freshness signal for readers. */
    modifiedAt?: string;
    /** Invocation control (Agent Skills frontmatter port): which debate
     *  audience may load this skill. Default 'all'. */
    audience?: 'analyst' | 'moderator' | 'all';
    /** Lens scope (Phase 3): which analyst seat this skill is meant for.
     *  Default 'all' (any seat may load it). Used to filter skills per seat
     *  at retrieval so a risk-scoped skill does not bleed into the macro
     *  lens. The lens filter is advisory by default: when the calling code
     *  passes `activeLens` to retrieval, scope-'risk' skills are dropped
     *  from non-risk seat prompts. */
    lensScope?: 'macro' | 'technical' | 'risk' | 'all';
    /** Latest automated A/B verdict (SkillEvalService). 'hurts' demotes a
     *  confirmed skill back to candidate on the next evidence pass. */
    evalVerdict?: 'helps' | 'mixed' | 'hurts' | 'inconclusive';
    /** Aligned/total flips from the latest eval, e.g. "2/3". */
    evalDetail?: string;
    /** ISO timestamp of the last automated eval run. */
    lastEvalAt?: string;
    /** Trigger/action snapshot taken BEFORE the last refinement — the
     *  evidence diff shown in the notebook so a rewrite is auditable. */
    previousVersion?: { kind: SkillKind; ifCondition?: string; thenAction?: string };
    /** Temporal ledger: every status transition is
     *  stamped validFrom → (invalidAt | null). Superseded beliefs are never
     *  deleted — retirement/demotion closes the interval, so replay audits
     *  can reconstruct exactly what was believed at any past moment. */
    history?: Array<{
        status: SkillStatus;
        validFrom: string;
        invalidAt?: string;
        reason?: string;
    }>;
}

export const MIN_CLUSTER_FOR_SKILL = 3;
export const MIN_SAMPLE_CONFIRMED = 5;
export const MIN_SAMPLE_RETIRE = 6;
/**
 * Counted trades a CANDIDATE avoid skill needs before code-side enforcement
 * may size a trade down. Prompt injection already excludes zero-evidence
 * skills; enforcement must not reach further than the model can see, or a
 * freshly-spawned candidate with no record caps confidence on a single match.
 */
export const MIN_SAMPLE_FOR_VETO = 2;
/** Consecutive losses on a CONFIRMED skill before the LLM refinement pass. */
export const REFINE_AFTER_CONSECUTIVE_LOSSES = 3;
/**
 * §8.3c: matched trades the PRIOR version keeps the live injection slot for
 * while a refinement sits in eval-only shadow. A panicked rewrite after a
 * bad-luck streak used to swap in immediately — undetectably replacing a
 * good skill with a worse one. The window is the detection mechanism.
 */
export const SHADOW_WINDOW_TRADES = 10;
/**
 * Refinement also requires the losses to span at least this many hours —
 * three whipsaw losses inside one session is regime noise, not a broken rule
 * (rewrite loops must lag the evidence that triggers them).
 */
export const REFINE_MIN_SPAN_HOURS = 48;

const folderName = (folderId: string): string =>
    getMemoryFiles().folders.find(f => f.id === folderId)?.name ?? '';

export const isSkillFile = (file: MemoryFile): boolean =>
    folderName(file.folderId) === 'skills' && file.name.endsWith('.md');

export const listSkillSlugs = (): string[] =>
    getMemoryFiles().files.filter(isSkillFile).map(f => f.name.replace(/\.md$/i, ''));

export const parseSkillMarkdown = (content: string): SkillMeta | null => {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!match) return null;
    const fm = match[1];
    const body = (match[2] || '').trim();
    const pick = (key: string): string | undefined => {
        const line = fm.match(new RegExp(`^${key}:\\s*(.+)$`, 'mi'));
        const v = line?.[1]?.trim();
        return v && v !== 'undefined' && v !== '' ? v : undefined;
    };
    const num = (key: string): number => {
        // parseFloat, not parseInt: weighted attribution stores
        // half-credit counts like `wins: 0.5` — truncating them back to
        // integers silently erased matched-but-not-injected evidence.
        const n = parseFloat(pick(key) || '0');
        return Number.isFinite(n) ? n : 0;
    };
    const statusRaw = (pick('status') || 'candidate').toLowerCase();
    const status: SkillStatus = statusRaw === 'confirmed' || statusRaw === 'retired' ? statusRaw : 'candidate';
    const kind: SkillKind = (pick('kind') || '').toLowerCase() === 'repeat' ? 'repeat' : 'avoid';
    const tradeIds = (pick('tradeIds') || '').split(',').map(s => s.trim()).filter(Boolean);
    let previousVersion: SkillMeta['previousVersion'];
    const prevRaw = pick('previousVersion');
    if (prevRaw) {
        try {
            const parsed = JSON.parse(prevRaw) as { kind?: string; ifCondition?: string; thenAction?: string };
            previousVersion = {
                kind: parsed.kind === 'repeat' ? 'repeat' : 'avoid',
                ifCondition: typeof parsed.ifCondition === 'string' ? parsed.ifCondition : undefined,
                thenAction: typeof parsed.thenAction === 'string' ? parsed.thenAction : undefined,
            };
        } catch {
            previousVersion = undefined;
        }
    }
    return {
        status,
        kind,
        coin: pick('coin'),
        direction: pick('direction'),
        family: pick('family'),
        regime: pick('regime'),
        wins: num('wins'),
        losses: num('losses'),
        consecutiveLosses: num('consecutiveLosses'),
        tradeIds,
        // Total counted evidence. Falls back to the parsed tradeIds
        // length for pre-existing skills (never larger than the real count —
        // the tail list is an upper bound only until the next write).
        evidenceCount: (() => {
            const raw = parseInt(pick('evidenceCount') || '', 10);
            return Number.isFinite(raw) && raw > 0 ? raw : undefined;
        })(),
        ifCondition: pick('ifCondition'),
        thenAction: pick('thenAction'),
        body,
        refinedAt: pick('refinedAt'),
        modifiedAt: pick('modified'),
        audience: (() => {
            const a = pick('audience');
            return a === 'analyst' || a === 'moderator' ? a : 'all';
        })(),
        lensScope: (() => {
            const s = (pick('lensScope') || '').toLowerCase();
            return s === 'macro' || s === 'technical' || s === 'risk' ? s : 'all';
        })(),
        evalVerdict: (() => {
            const v = (pick('evalVerdict') || '').toLowerCase();
            return v.startsWith('helps') ? 'helps'
                : v.startsWith('mixed') ? 'mixed'
                    : v.startsWith('hurts') ? 'hurts'
                        : v.startsWith('inconclusive') ? 'inconclusive'
                            : undefined;
        })(),
        evalDetail: pick('evalVerdict')?.replace(/^(helps|mixed|hurts|inconclusive)\s*/i, '').replace(/^\(|\)$/g, '') || undefined,
        lastEvalAt: pick('lastEvalAt'),
        // One-sentence semantic summary + debate provenance.
        description: pick('description')?.slice(0, 300) || undefined,
        originMessageId: pick('originMessageId') || undefined,
        supersededBy: pick('supersededBy') || undefined,
        // Sequential-eval streak: consecutive runs of the same
        // verdict. Absent on legacy skills ⇒ treated as confirmed.
        evalStreak: (() => {
            const n = parseInt(pick('evalStreak') || '', 10);
            return Number.isFinite(n) && n > 0 ? n : undefined;
        })(),
        // Control group: matched-but-not-injected trade ids.
        controlIds: (() => {
            const raw = pick('controlIds');
            if (!raw) return undefined;
            const ids = raw.split(',').map(s => s.trim()).filter(Boolean);
            return ids.length > 0 ? ids : undefined;
        })(),
        // §8.3a: injected-but-not-cited (OVERRIDDEN) trade ids.
        overriddenIds: (() => {
            const raw = pick('overriddenIds');
            if (!raw) return undefined;
            const ids = raw.split(',').map(s => s.trim()).filter(Boolean);
            return ids.length > 0 ? ids : undefined;
        })(),
        // §8.3b: per-regime W/L split (JSON map in frontmatter).
        regimeStats: (() => {
            const raw = pick('regimeStats');
            if (!raw) return undefined;
            try {
                const parsed = JSON.parse(raw) as Record<string, { w?: number; l?: number }>;
                if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
                const out: NonNullable<SkillMeta['regimeStats']> = {};
                for (const [k, v] of Object.entries(parsed)) {
                    if (v && Number.isFinite(v.w) && Number.isFinite(v.l)) out[k] = { w: v.w!, l: v.l! };
                }
                return Object.keys(out).length > 0 ? out : undefined;
            } catch {
                return undefined;
            }
        })(),
        // §8.2a: the birth-certificate claim.
        prediction: parsePredictionLine(pick('prediction')) ?? undefined,
        // §8.2a: followed-evidence sample at the last claim test (re-test
        // only when new evidence landed since).
        claimTestedEvidence: (() => {
            const n = parseInt(pick('claimTestedEvidence') || '', 10);
            return Number.isFinite(n) && n >= 0 ? n : undefined;
        })(),
        // §8.3c: the pending shadow refinement (JSON in frontmatter).
        shadow: (() => {
            const raw = pick('shadow');
            if (!raw) return undefined;
            try {
                const parsed = JSON.parse(raw) as SkillMeta['shadow'];
                return parsed && typeof parsed.body === 'string' && parsed.kind ? parsed : undefined;
            } catch {
                return undefined;
            }
        })(),
        // Cross-regime diagnostic: counted trades outside the scope regime.
        crossRegimeIds: (() => {
            const raw = pick('crossRegimeIds');
            if (!raw) return undefined;
            const ids = raw.split(',').map(s => s.trim()).filter(Boolean);
            return ids.length > 0 ? ids : undefined;
        })(),
        lastEvidenceAt: pick('lastEvidenceAt'),
        previousVersion,
        // Temporal ledger: JSON array in frontmatter.
        history: (() => {
            const raw = pick('history');
            if (!raw) return undefined;
            try {
                const parsed = JSON.parse(raw) as SkillMeta['history'];
                return Array.isArray(parsed) && parsed.length > 0 ? parsed : undefined;
            } catch {
                return undefined;
            }
        })(),
    };
};

export const setSkillStatus = async (fileId: string, status: SkillStatus, username?: string): Promise<void> => {
    const file = getMemoryFiles().files.find(f => f.id === fileId);
    if (!file) return;
    const meta = parseSkillMarkdown(file.content);
    if (!meta) return;
    stampStatusTransition(meta, status, status === 'retired' ? 'user-veto' : 'manual');
    meta.status = status;
    await updateMemoryFileUnlocked(fileId, {
        content: serializeSkill(meta, titleFromMeta(meta)),
        enabled: status !== 'retired',
    }, username || 'local');
};

/**
 * Temporal ledger write: close the current interval and
 * open the next one. Superseded beliefs are never erased — a demoted skill's
 * confirmed era stays queryable for replay audits ("what did I believe before
 * this eval?"). No-op when the status is unchanged.
 */
export const stampStatusTransition = (
    meta: SkillMeta,
    next: SkillStatus,
    reason?: string,
): void => {
    if (meta.status === next) return;
    const now = new Date().toISOString();
    const history = meta.history ?? [];
    // Close the currently-open interval.
    if (history.length > 0) {
        const last = history[history.length - 1];
        if (!last.invalidAt) last.invalidAt = now;
    } else if (meta.status) {
        // Backfill the implicit origin interval so the first transition
        // still yields two queryable eras.
        history.push({ status: meta.status, validFrom: meta.lastEvidenceAt || meta.modifiedAt || now });
        const last = history[history.length - 1];
        last.invalidAt = now;
    }
    history.push({ status: next, validFrom: now, reason });
    meta.history = history.slice(-20); // bound the ledger; 20 transitions is plenty
};

/**
 * Replay query: what status did this skill hold at a given moment?
 * Returns the interval whose [validFrom, invalidAt) window contains `at`,
 * or null when the ledger cannot answer (no history, or predates it).
 */
export const skillStatusAt = (meta: SkillMeta, at: string | number): SkillStatus | null => {
    const ts = typeof at === 'number' ? at : Date.parse(at);
    if (!Number.isFinite(ts)) return null;
    for (const entry of meta.history ?? []) {
        const from = Date.parse(entry.validFrom);
        const to = entry.invalidAt ? Date.parse(entry.invalidAt) : Number.POSITIVE_INFINITY;
        if (Number.isFinite(from) && ts >= from && ts < to) return entry.status;
    }
    return null;
};

export const listSkills = (): Array<{ file: MemoryFile; meta: SkillMeta }> =>
    getMemoryFiles().files.filter(isSkillFile).map(file => {
        const meta = parseSkillMarkdown(file.content);
        return meta ? { file, meta } : null;
    }).filter((row): row is { file: MemoryFile; meta: SkillMeta } => Boolean(row));

export const serializeSkill = (meta: SkillMeta, title: string): string => {
    const lines = [
        '---',
        `status: ${meta.status}`,
        `kind: ${meta.kind}`,
        ...(meta.coin ? [`coin: ${meta.coin}`] : []),
        ...(meta.direction ? [`direction: ${meta.direction}`] : []),
        ...(meta.family ? [`family: ${meta.family}`] : []),
        ...(meta.regime ? [`regime: ${meta.regime}`] : []),
        `wins: ${meta.wins}`,
        `losses: ${meta.losses}`,
        `sample: ${meta.wins + meta.losses}`,
        ...(meta.consecutiveLosses > 0 ? [`consecutiveLosses: ${meta.consecutiveLosses}`] : []),
        ...(meta.ifCondition ? [`ifCondition: ${meta.ifCondition.replace(/\n/g, ' ')}`] : []),
        ...(meta.thenAction ? [`thenAction: ${meta.thenAction.replace(/\n/g, ' ')}`] : []),
        ...(meta.refinedAt ? [`refinedAt: ${meta.refinedAt}`] : []),
        ...(meta.lastEvidenceAt ? [`lastEvidenceAt: ${meta.lastEvidenceAt}`] : []),
        `modified: ${meta.modifiedAt ?? new Date().toISOString()}`,
        ...(meta.audience && meta.audience !== 'all' ? [`audience: ${meta.audience}`] : []),
        ...(meta.lensScope && meta.lensScope !== 'all' ? [`lensScope: ${meta.lensScope}`] : []),
        ...(meta.evalVerdict ? [`evalVerdict: ${meta.evalVerdict}${meta.evalDetail ? ` (${meta.evalDetail})` : ''}`] : []),
        ...(meta.lastEvalAt ? [`lastEvalAt: ${meta.lastEvalAt}`] : []),
        ...(meta.description ? [`description: ${meta.description.replace(/\n/g, ' ').slice(0, 300)}`] : []),
        ...(meta.originMessageId ? [`originMessageId: ${meta.originMessageId}`] : []),
        ...(meta.supersededBy ? [`supersededBy: ${meta.supersededBy}`] : []),
        ...(meta.evalStreak ? [`evalStreak: ${meta.evalStreak}`] : []),
        ...(meta.controlIds && meta.controlIds.length > 0 ? [`controlIds: ${meta.controlIds.slice(-20).join(',')}`] : []),
        ...(meta.overriddenIds && meta.overriddenIds.length > 0 ? [`overriddenIds: ${meta.overriddenIds.slice(-20).join(',')}`] : []),
        ...(meta.crossRegimeIds && meta.crossRegimeIds.length > 0 ? [`crossRegimeIds: ${meta.crossRegimeIds.slice(-20).join(',')}`] : []),
        ...(meta.regimeStats ? [`regimeStats: ${JSON.stringify(meta.regimeStats)}`] : []),
        ...(meta.prediction ? [serializePrediction(meta.prediction)] : []),
        ...(meta.claimTestedEvidence !== undefined ? [`claimTestedEvidence: ${meta.claimTestedEvidence}`] : []),
        ...(meta.shadow ? [`shadow: ${JSON.stringify(meta.shadow)}`] : []),
        ...(meta.history && meta.history.length > 0 ? [`history: ${JSON.stringify(meta.history)}`] : []),
        ...(meta.previousVersion ? [`previousVersion: ${JSON.stringify(meta.previousVersion)}`] : []),
        `tradeIds: ${meta.tradeIds.slice(-20).join(',')}`,
        // Monotonic evidence counter — tradeIds is a tail-20 list,
        // so the provenance line must not silently cap at 20.
        `evidenceCount: ${Math.max(meta.evidenceCount ?? 0, meta.tradeIds.length)}`,
        '---',
        '',
        `# ${title}`,
        '',
        meta.body.trim(),
        '',
    ];
    return lines.join('\n');
};

export const skillMatchesSetup = (
    meta: SkillMeta,
    setup: { coin?: string; direction?: string; family?: string; pattern?: string; regime?: string }
): boolean => {
    if (meta.status === 'retired' || meta.supersededBy) return false;
    let hits = 0;
    const coin = setup.coin?.toUpperCase().replace(/USDT?$/, '');
    const skillCoin = meta.coin?.toUpperCase().replace(/USDT?$/, '');
    if (coin && skillCoin && coin === skillCoin) hits += 2;
    if (setup.direction && meta.direction && setup.direction === meta.direction) hits += 2;
    // Negation-aware: "fake-breakout" must NOT match a "breakout" skill.
    const fam = (setup.family || setup.pattern || '').toLowerCase();
    if (fam && meta.family && familiesRelate(fam, meta.family)) hits += 2;
    if (setup.regime && meta.regime && setup.regime === meta.regime) hits += 1;
    return hits >= 2;
};

/**
 * STRICT matcher for ENFORCEMENT paths (vetoes, eval-trade
 * selection). The loose `skillMatchesSetup` scores direction-equality alone
 * as a match (hits=2), so a confirmed avoid for "BTC long" vetoed EVERY Long
 * on EVERY coin. Enforcement requires real setup overlap: the skill must
 * share the coin, OR the pattern family, OR (direction + regime).
 * Retrieval keeps the loose matcher — recall breadth is cheap there.
 */
export const skillStrictlyMatchesSetup = (
    meta: SkillMeta,
    setup: { coin?: string; direction?: string; family?: string; pattern?: string; regime?: string },
): boolean => {
    if (meta.status === 'retired' || meta.supersededBy) return false;
    const coin = setup.coin?.toUpperCase().replace(/USDT?$/, '');
    const skillCoin = meta.coin?.toUpperCase().replace(/USDT?$/, '');
    const sameCoin = Boolean(coin && skillCoin && coin === skillCoin);
    const fam = (setup.family || setup.pattern || '').toLowerCase();
    const sameFamily = Boolean(fam && meta.family && familiesRelate(fam, meta.family));
    const sameDirection = Boolean(setup.direction && meta.direction && setup.direction === meta.direction);
    const sameRegime = Boolean(setup.regime && meta.regime && setup.regime === meta.regime);
    // A skill with NO scoping dimensions at all is a general lesson — it can
    // never strictly enforce.
    const scoped = Boolean(meta.coin || meta.family || meta.direction || meta.regime);
    if (!scoped) return false;
    return sameCoin || sameFamily || (sameDirection && sameRegime);
};

/** How many setup dimensions a skill actually shares — the
 *  ranking weight behind enforcement priority (coin > direction > family). */
const dimsOverlapCount = (
    meta: SkillMeta,
    setup: { coin?: string; direction?: string; family?: string; pattern?: string },
): number => {
    let n = 0;
    const coin = (setup.coin || '').toUpperCase().replace(/USDT?$/, '');
    const skillCoin = (meta.coin || '').toUpperCase().replace(/USDT?$/, '');
    if (coin && skillCoin && coin === skillCoin) n += 1;
    if (setup.direction && meta.direction && setup.direction === meta.direction) n += 1;
    const fam = (setup.family || setup.pattern || '').toLowerCase();
    if (fam && meta.family && familiesRelate(fam, meta.family)) n += 1;
    return Math.max(1, n);
};

/** Evidence-freshness multiplier for enforcement ranking —
 *  mirrors MemoryRetrievalService's decay: 0.75 default when no evidence is
 *  recorded, then exp(-ageDays/120) with NO floor (→ ~0.13 at 240d, ~0.02 at
 *  a year). Ranking weight only — it can never zero out a match entirely. */
const evidenceFreshnessFactor = (meta: SkillMeta): number => {
    if (!meta.lastEvidenceAt) return 0.75;
    const t = Date.parse(meta.lastEvidenceAt);
    if (!Number.isFinite(t)) return 0.75;
    const ageDays = Math.max(0, (Date.now() - t) / 86_400_000);
    return Math.exp(-ageDays / 120);
};

const enabledSkillMeta = (file: MemoryFile): SkillMeta | null => {
    if (!file.enabled || !isSkillFile(file)) return null;
    return parseSkillMarkdown(file.content);
};

/**
 * How long a recorded automated-eval verdict stays authoritative. After this
 * window a 'hurts' demotion expires: the next evidence pass re-derives status
 * from outcomes alone, and the scheduler may re-audit the skill for a fresh
 * verdict.
 */
export const EVAL_VERDICT_STALE_MS = 30 * 86_400_000;

/**
 * Sequential-evidence gating: a status change driven by an automated eval
 * verdict requires the SAME verdict on this many consecutive runs. One noisy
 * A/B run must not bench (or rehabilitate) a skill on its own. Shared with
 * SkillEvalService, which owns the streak bookkeeping; the deriveStatus
 * override below must honor the same bar or it re-introduces the one-run
 * demotion through the evidence path.
 */
export const EVAL_DEMOTE_STREAK = 2;

/**
 * TRUE while an automated-eval 'hurts' verdict still outranks outcome
 * correlation. Undated or unparseable verdicts stay active — conservative,
 * since there is no timestamp from which they could expire.
 */
export const evalDemotionActive = (meta: SkillMeta): boolean => {
    if (meta.evalVerdict !== 'hurts') return false;
    if (!meta.lastEvalAt) return true;
    const t = Date.parse(meta.lastEvalAt);
    if (!Number.isFinite(t)) return true;
    return Date.now() - t < EVAL_VERDICT_STALE_MS;
};

/**
 * §8.3d: the raw ladder (5 samples, 60% win rate) is a FLOOR, not the gate —
 * a 4-1 record at N=5 is statistically indistinguishable from a coin flip.
 * Confirmation additionally requires the Wilson interval of the followed
 * evidence to separate from the control win rate (or, cold-start with no
 * control evidence, to exclude 50% outright at N ≥ 8). Demotion and
 * retirement are unchanged — the CI only gates PROMOTION.
 */
export const confirmationCiGate = (
    meta: SkillMeta,
    control?: { wins: number; losses: number },
): boolean => ciGatePasses(meta.kind, meta.wins, meta.losses, control);

/** §8.3d: control-group evidence for the CI comparison — the settled
 *  outcomes of the skill's controlIds (matched-but-not-injected trades). */
const controlStatsFrom = (
    meta: SkillMeta,
    allTrades?: LoggedTrade[],
): { wins: number; losses: number } | undefined => {
    if (!allTrades || !meta.controlIds || meta.controlIds.length === 0) return undefined;
    const ids = new Set(meta.controlIds);
    let wins = 0, losses = 0;
    for (const t of allTrades) {
        if (!ids.has(t.id)) continue;
        if (t.outcome === TradeOutcome.WIN) wins += 1;
        else if (t.outcome === TradeOutcome.LOSS) losses += 1;
    }
    return wins + losses > 0 ? { wins, losses } : undefined;
};

const deriveStatus = (meta: SkillMeta, control?: { wins: number; losses: number }): SkillStatus => {
    // ── Causal override ──
    // An automated A/B eval that shows the skill HURTS decisions demotes it
    // regardless of outcome correlation — injection-causation outranks
    // co-occurrence. The override expires after EVAL_VERDICT_STALE_MS so a
    // stale verdict cannot bench a skill forever, and it respects the
    // sequential-evidence bar: a SINGLE 'hurts' run (evalStreak 1) must not
    // demote through this path either — otherwise the streak gate in
    // SkillEvalService.recordEvalVerdict would be bypassed on the very next
    // evidence trade.
    if (
        meta.evalVerdict === 'hurts'
        && meta.status === 'confirmed'
        && evalDemotionActive(meta)
        && (meta.evalStreak ?? 0) >= EVAL_DEMOTE_STREAK
    ) return 'candidate';

    // ── §8.2a birth certificate ──
    // The skill's own pre-registered claim, tested against its followed
    // evidence. evaluateClaim is pure arithmetic, so the ladder can consume
    // it directly: a claim that has reached its horizon and FAILED blocks
    // promotion (the skill must meet the bar it promised, not just the
    // generic one); met or pending claims defer to the normal ladder.
    const claim = meta.prediction
        ? evaluateClaim(meta.kind, meta.prediction, { wins: meta.wins, losses: meta.losses })
        : null;
    const claimUnmet = Boolean(claim && !claim.pending && !claim.met);

    const sample = meta.wins + meta.losses;
    const winRate = sample > 0 ? meta.wins / sample : 0;
    if (sample >= MIN_SAMPLE_RETIRE) {
        if (meta.kind === 'repeat' && winRate < 0.4) return 'retired';
        if (meta.kind === 'avoid' && winRate > 0.6) return 'retired';
    }
    if (sample >= MIN_SAMPLE_CONFIRMED) {
        const rawSaysConfirmed = meta.kind === 'repeat'
            ? winRate >= 0.6
            : meta.kind === 'avoid' ? winRate <= 0.4 : false;
        // Raw threshold is the floor; the Wilson CI is the gate. The gate
        // applies to PROMOTION only — a skill already confirmed keeps its
        // status through re-derivation passes (consolidation, merge) and is
        // demoted by the retire band or the eval override above, never by
        // retroactive statistics.
        if (rawSaysConfirmed && !claimUnmet && (meta.status === 'confirmed' || confirmationCiGate(meta, control))) {
            return 'confirmed';
        }
        return 'candidate';
    }
    return 'candidate';
};

export const titleFromMeta = (meta: SkillMeta): string => {
    const bits = [meta.kind === 'avoid' ? 'Avoid' : 'Repeat', meta.coin, meta.direction, meta.family]
        .filter(Boolean);
    return bits.join(' ') || 'Skill';
};

const fileNameFromMeta = (meta: SkillMeta): string => {
    const slug = slugifyName([meta.coin, meta.direction, meta.family, meta.kind].filter(Boolean).join(' '))
        || 'skill';
    return `${slug}.md`;
};

const clusterKey = (trade: LoggedTrade): string => {
    const coin = (trade.analysis?.coinName || 'GEN').toUpperCase().replace(/USDT?$/, '');
    const dir = trade.analysis?.direction === 'Long' || trade.analysis?.direction === 'Short'
        ? trade.analysis.direction
        : 'Neutral';
    const fam = trade.analysis?.detectedPatternFamily || trade.analysis?.marketConditions?.pattern || 'any';
    return `${coin}|${dir}|${fam}`;
};

/**
 * After a closed trade, bump wins/losses on every matching skill. A WIN
 * resets the consecutive-loss streak; a confirmed skill that reaches
 * REFINE_AFTER_CONSECUTIVE_LOSSES gets an LLM refinement pass (tightened
 * trigger) instead of silently bleeding.
 */
const applySkillEvidenceUnlocked = async (trade: LoggedTrade, username: string, allTrades?: LoggedTrade[]): Promise<void> => {
    if (trade.outcome !== TradeOutcome.WIN && trade.outcome !== TradeOutcome.LOSS) return;
    if (!tradeAdmitsTechnicalStrategyRule(trade)) return;
    await ensureHarnessFoldersUnlocked(username);
    const setup = {
        coin: trade.analysis?.coinName,
        direction: trade.analysis?.direction,
        family: trade.analysis?.detectedPatternFamily,
        pattern: trade.analysis?.marketConditions?.pattern,
        regime: trade.marketRegime,
    };
    for (const file of getMemoryFiles().files.filter(isSkillFile)) {
        const meta = parseSkillMarkdown(file.content);
        if (!meta || !file.enabled || !skillMatchesSetup(meta, setup)) continue;
        if (meta.tradeIds.includes(trade.id)) continue;

        // ── Evidence decay ──
        // Authority expires with its evidence: counts >30 days stale are
        // halved before counting this trade. Regime mismatch NO LONGER
        // halves (§8.3b) — "works in trend, fails in chop" is CONDITIONAL,
        // not fading; the per-regime split below routes divergence to a
        // re-scope proposal instead of decay. deriveStatus then naturally
        // demotes genuinely stale skills to candidate.
        applyEvidenceDecay(meta, trade.marketRegime);

        // ── Weighted attribution (§8.3a three-state adherence) ──
        // Full credit ONLY when retrieval actually injected this skill in the
        // run that produced this trade AND the verdict did not override it.
        // The join is EXACT on the originating runId (persisted on both sides)
        // — a time window anchored on trade.timestamp cannot work: the run
        // predates the log click, so "records since the trade" looked at later,
        // unrelated runs and mislabeled every followed skill as CONTROL.
        //   FOLLOWED (injected + cited)      → counts toward wins/losses
        //   OVERRIDDEN (injected + not cited) → separate override counter;
        //     the moderator was handed the skill and ignored it, so the
        //     outcome must not rot the skill's stats (the most common way
        //     skill stats silently decay). A high override rate is itself a
        //     signal — it queues an amendment proposal.
        //   CONTROL (matched, not injected)  → controlIds, the lift baseline.
        // Unknown telemetry (empty log, legacy records without runId/cited)
        // keeps full credit so tiering cannot starve on missing data.
        let adherence: Awaited<ReturnType<typeof skillAdherenceForRun>>;
        try {
            adherence = await skillAdherenceForRun(username, file.name, trade.sourceRunId);
        } catch {
            adherence = null;
        }
        if (adherence === 'not-injected') {
            // CONTROL group: record and move on — never inflate wins/losses
            // with outcomes this skill did not shape.
            const control = meta.controlIds ?? [];
            if (!control.includes(trade.id)) {
                meta.controlIds = [...control, trade.id].slice(-20);
                meta.modifiedAt = new Date().toISOString();
                await updateMemoryFileUnlocked(file.id, {
                    content: serializeSkill(meta, titleFromMeta(meta)),
                    enabled: meta.status !== 'retired',
                }, username);
            }
            continue;
        }
        if (adherence === 'overridden') {
            // OVERRIDDEN: injected and ignored. Never counts toward the
            // skill's record; accumulates the amendment signal instead.
            const over = meta.overriddenIds ?? [];
            if (!over.includes(trade.id)) {
                meta.overriddenIds = [...over, trade.id].slice(-20);
                meta.modifiedAt = new Date().toISOString();
                await updateMemoryFileUnlocked(file.id, {
                    content: serializeSkill(meta, titleFromMeta(meta)),
                    enabled: meta.status !== 'retired',
                }, username);
                if (meta.overriddenIds.length >= OVERRIDE_RATE_FOR_AMENDMENT) {
                    queueLearningProposal({
                        kind: 'rescope',
                        skillSlug: file.name.replace(/\.md$/i, ''),
                        text: `${file.name} was injected and ignored ${meta.overriddenIds.length} times — the trigger or wording needs an amendment pass (the floor keeps routing around it).`,
                        fingerprint: `${file.name}|override`,
                    }, username);
                }
            }
            continue;
        }

        // §8.5b eval-verdict agreement: the first FOLLOWED trade after a
        // helps/hurts verdict era is one agreement sample (once per era).
        if ((meta.evalVerdict === 'helps' || meta.evalVerdict === 'hurts') && meta.lastEvalAt) {
            void recordEvalAgreement(
                username,
                `${file.name}|${meta.lastEvalAt}`,
                (meta.evalVerdict === 'helps') === (trade.outcome === TradeOutcome.WIN),
            );
        }
        if (trade.outcome === TradeOutcome.WIN) {
            meta.wins += 1;
            meta.consecutiveLosses = 0;
        } else {
            meta.losses += 1;
            meta.consecutiveLosses += 1;
        }
        // §8.3b: per-regime split, written alongside the global counters —
        // the substrate that lets a conditional pattern be RE-SCOPED instead
        // of decayed into oblivion.
        if (trade.marketRegime) {
            const stats = { ...(meta.regimeStats ?? {}) };
            const cur = stats[trade.marketRegime] ?? { w: 0, l: 0 };
            stats[trade.marketRegime] = trade.outcome === TradeOutcome.WIN
                ? { w: cur.w + 1, l: cur.l }
                : { w: cur.w, l: cur.l + 1 };
            meta.regimeStats = stats;
            maybeQueueRescopeProposal(file.name, meta, username);
        }
        // §8.3c: a pending shadow refinement observes the same matched
        // trades — its counterfactual window fills while the live version
        // keeps the injection slot. At window close the comparison settles.
        if (meta.shadow) {
            meta.shadow = {
                ...meta.shadow,
                seen: meta.shadow.seen + 1,
                wins: meta.shadow.wins + (trade.outcome === TradeOutcome.WIN ? 1 : 0),
                losses: meta.shadow.losses + (trade.outcome === TradeOutcome.LOSS ? 1 : 0),
            };
            if (meta.shadow.seen >= SHADOW_WINDOW_TRADES) {
                const settled = settleShadow(meta, { wins: meta.shadow.wins, losses: meta.shadow.losses });
                // §8.5b: this refinement settled — one recovery sample.
                void recordRefinementOutcome(username, settled.promoted);
                if (settled.promoted) {
                    meta.previousVersion = {
                        kind: meta.kind,
                        ifCondition: meta.ifCondition,
                        thenAction: meta.thenAction,
                    };
                    meta.kind = meta.shadow.kind;
                    meta.ifCondition = meta.shadow.ifCondition;
                    meta.thenAction = meta.shadow.thenAction;
                    meta.body = meta.shadow.body;
                    meta.shadow = undefined;
                } else if (settled.discarded) {
                    meta.shadow = undefined;
                    try {
                        const { recordHarnessLesson } = await import('./harnessLessons');
                        recordHarnessLesson({
                            kind: 'injection',
                            scope: 'skillGuidance',
                            pattern: `skill-refinement:${file.name.replace(/\.md$/i, '')}`,
                            lesson: settled.lesson ?? 'refinement overfit',
                            evidenceId: trade.id,
                        });
                    } catch { /* lesson store is best-effort */ }
                }
            }
        }
        meta.tradeIds = [...meta.tradeIds, trade.id];
        // Cross-regime diagnostic: this counted trade came from OUTSIDE the
        // skill's scope regime. The evidence still counts (applyEvidenceDecay
        // already halved it), but the ids let review passes see how much of a
        // skill's support was earned in foreign regimes.
        if (trade.marketRegime && meta.regime && trade.marketRegime !== meta.regime) {
            const cross = meta.crossRegimeIds ?? [];
            if (!cross.includes(trade.id)) meta.crossRegimeIds = [...cross, trade.id].slice(-20);
        }
        // Track the freshest evidence and the regime it came from.
        meta.lastEvidenceAt = trade.timestamp ?? new Date().toISOString();
        meta.modifiedAt = new Date().toISOString();
        // Gap-fill only: the FIRST regime a skill is evidenced in is its scope.
        // A later trade in a different regime must not silently re-scope the
        // belief (last-write-wins drift) — cross-regime evidence is already
        // discounted by applyEvidenceDecay, and a genuine re-scope belongs in a
        // refinement pass, not an evidence append.
        if (trade.marketRegime && !meta.regime) meta.regime = trade.marketRegime;
        {
            const derived = deriveStatus(meta, controlStatsFrom(meta, allTrades));
            // A demotion driven by the eval causal override (not by the
            // win-rate math) must read as an EVAL demotion in the temporal
            // ledger — rehabilitation looks for /^eval hurts/ on the last
            // transition and would never find it under a bare 'evidence'.
            const evalOverrideDemotion = derived === 'candidate'
                && meta.status === 'confirmed'
                && meta.evalVerdict === 'hurts'
                && evalDemotionActive(meta)
                && (meta.evalStreak ?? 0) >= EVAL_DEMOTE_STREAK;
            // §8.5b worth-gate precision: a gate-approved skill confirming is
            // one delivery of the gate's promise.
            if (derived === 'confirmed' && meta.status !== 'confirmed') {
                void recordWorthGateConfirm(username, meta.ifCondition);
            }
            // §8.4b: a retire-band transition records WHICH reason, not just
            // 'evidence'. Regime-mix divergence (§8.5d) distinguishes a real
            // shift from a simple evidence dry-up — a conditional library
            // gets re-scoped, not deleted.
            const transitionReason = derived === 'retired'
                ? (isStaleByRegime(meta, trade.analysis?.coinName) ? 'regime-shifted' : 'insufficient-evidence')
                : evalOverrideDemotion
                    ? `eval hurts ×${meta.evalStreak} (evidence)`
                    : 'evidence';
            stampStatusTransition(
                meta,
                derived,
                transitionReason,
            );
            meta.status = derived;
        }
        await updateMemoryFileUnlocked(file.id, {
            content: serializeSkill(meta, titleFromMeta(meta)),
            enabled: meta.status !== 'retired',
        }, username);

        // Refinement gate: 3 consecutive losses AND spread over >=48h.
        if (trade.outcome === TradeOutcome.LOSS
            && meta.status === 'confirmed'
            && meta.consecutiveLosses >= REFINE_AFTER_CONSECUTIVE_LOSSES
            && lossesSpanEnoughHours(allTrades ?? [trade], meta.tradeIds, REFINE_MIN_SPAN_HOURS)) {
            await maybeRefineSkill(file.id, allTrades ?? [trade], username);
        }
    }
};

/** Serialized public API — see withNotebookWriteLock in MemoryFilesService. */
export const applySkillEvidence = (
    trade: LoggedTrade,
    username: string,
    allTrades?: LoggedTrade[],
): Promise<void> =>
    withNotebookWriteLock(() => applySkillEvidenceUnlocked(trade, username, allTrades));

/** Age of the freshest recorded evidence in days (Infinity when unknown). */
const evidenceAgeDays = (meta: SkillMeta): number => {
    if (!meta.lastEvidenceAt) return Infinity;
    const t = Date.parse(meta.lastEvidenceAt);
    return Number.isFinite(t) ? (Date.now() - t) / 86_400_000 : Infinity;
};

/**
 * Halve wins/losses when the skill's evidence is stale (>30 days since the
 * last counted trade). The regime-mismatch halving was REMOVED here (§8.3b):
 * a skill that works in one regime and fails in another is conditional, not
 * fading — regimeStats + the re-scope proposal handle that case without
 * erasing the skill's earned authority. `incomingRegime` is kept in the
 * signature for call-site stability. Mutates `meta` before the new outcome
 * is counted.
 */
export const applyEvidenceDecay = (meta: SkillMeta, incomingRegime?: string): void => {
    void incomingRegime;
    let halvings = 0;
    if (evidenceAgeDays(meta) > EVIDENCE_STALE_DAYS) halvings += 1;
    if (halvings > 0) halveCounts(meta, halvings);
};

export const EVIDENCE_STALE_DAYS = 30;

/** Injected-and-ignored observations that justify an amendment proposal. */
export const OVERRIDE_RATE_FOR_AMENDMENT = 3;

/**
 * §8.3b divergence test: one regime carries ≥3W/≤1L while another carries
 * ≥3L/≤1W. Returns [strongRegime, weakRegime] or null.
 */
export const findRegimeDivergence = (
    stats: Record<string, { w: number; l: number }> | undefined,
): [string, string] | null => {
    if (!stats) return null;
    const strong = Object.entries(stats).filter(([, v]) => v.w >= 3 && v.l <= 1);
    const weak = Object.entries(stats).filter(([, v]) => v.l >= 3 && v.w <= 1);
    if (strong.length === 0 || weak.length === 0) return null;
    // Most-supported vs most-contradicted.
    strong.sort((a, b) => b[1].w - a[1].w);
    weak.sort((a, b) => b[1].l - a[1].l);
    return [strong[0][0], weak[0][0]];
};

/**
 * When the per-regime split diverges, the skill gets SHARPER, not weaker:
 * queue a re-scope proposal ("narrow appliesWhen to <strong regime>") into
 * the learning queue. Deduped by fingerprint — the same divergence is not
 * re-queued every trade.
 */
const maybeQueueRescopeProposal = (fileName: string, meta: SkillMeta, username: string): void => {
    const div = findRegimeDivergence(meta.regimeStats);
    if (!div) return;
    const [strong, weak] = div;
    if (meta.regime === strong) return; // already scoped to the winning regime
    queueLearningProposal({
        kind: 'rescope',
        skillSlug: fileName.replace(/\.md$/i, ''),
        text: `${fileName} wins ${meta.regimeStats![strong]!.w}/${meta.regimeStats![strong]!.w + meta.regimeStats![strong]!.l} in ${strong} but loses ${meta.regimeStats![weak]!.l}/${meta.regimeStats![weak]!.w + meta.regimeStats![weak]!.l} in ${weak} — narrow its scope to ${strong} instead of letting mixed evidence fade it.`,
        fingerprint: `${fileName}|rescope|${strong}`,
    }, username);
};

/** Halve wins/losses n times (floor at 0). Keeps sample math consistent. */
export const halveCounts = (meta: SkillMeta, times: number): void => {
    for (let i = 0; i < times; i++) {
        meta.wins = Math.floor(meta.wins / 2);
        meta.losses = Math.floor(meta.losses / 2);
    }
};

/**
 * True when the last N losing trades for this skill span at least `minHours`
 * between first and last. Whipsaw losses inside one session don't trigger
 * LLM rewrites.
 */
export const lossesSpanEnoughHours = (
    allTrades: LoggedTrade[],
    tradeIds: string[],
    minHours: number,
): boolean => {
    const idSet = new Set(tradeIds);
    const stamps = allTrades
        .filter(t => idSet.has(t.id) && t.outcome === TradeOutcome.LOSS)
        .map(t => Date.parse(t.timestamp || ''))
        .filter(Number.isFinite)
        .sort((a, b) => a - b);
    if (stamps.length < REFINE_AFTER_CONSECUTIVE_LOSSES) return false;
    const window = stamps.slice(-REFINE_AFTER_CONSECUTIVE_LOSSES);
    return (window[window.length - 1] - window[0]) >= minHours * 3_600_000;
};

/**
 * LLM phase of skill refinement — resolves the memory model, feeds the
 * losing post-mortems back to it, and returns the tightened skill (or null
 * when nothing should change). Performs NO notebook writes, so it is safe
 * to run outside the write lock.
 */
const craftRefinement = async (
    meta: SkillMeta,
    allTrades: LoggedTrade[],
    username: string,
): Promise<CraftedSkill | null> => {
    const config = await resolveMemoryConfig(username);
    if (!config) return null;
    const losingTrades = allTrades
        .filter(t => t.outcome === TradeOutcome.LOSS && meta.tradeIds.includes(t.id))
        .slice(-4);
    return refineSkillFromLosses({
        title: titleFromMeta(meta),
        kind: meta.kind,
        ifCondition: meta.ifCondition,
        thenAction: meta.thenAction,
        body: meta.body,
        wins: meta.wins,
        losses: meta.losses,
    }, losingTrades, config);
};

/**
 * Write phase of skill refinement — MUST run under the notebook write lock.
 * Re-reads the skill so evidence that landed during the LLM round-trip is
 * preserved. §8.3c: the refined version does NOT swap into the live slot —
 * it enters an eval-only SHADOW while the prior version keeps the injection
 * slot for SHADOW_WINDOW_TRADES matched trades. A panicked refinement after
 * a bad-luck streak used to replace a good skill with a worse one,
 * undetectably; the shadow window is the detection. Returns false when the
 * file vanished meanwhile.
 */
const applyRefinementUnlocked = async (
    fileId: string,
    refined: CraftedSkill,
    username: string,
): Promise<boolean> => {
    const file = getMemoryFiles().files.find(f => f.id === fileId);
    const latest = file ? parseSkillMarkdown(file.content) : null;
    if (!latest) return false;
    // A second refinement while one is already shadowing replaces the
    // shadow (the newest draft is the better guess), never the live slot.
    latest.shadow = {
        kind: refined.kind,
        ifCondition: refined.ifCondition,
        thenAction: refined.thenAction,
        body: formatCraftedSkillBody(refined),
        name: refined.name,
        startedAt: new Date().toISOString(),
        seen: 0,
        wins: 0,
        losses: 0,
    };
    latest.consecutiveLosses = 0;
    latest.refinedAt = new Date().toISOString();
    latest.modifiedAt = latest.refinedAt;
    await updateMemoryFileUnlocked(fileId, {
        content: serializeSkill(latest, titleFromMeta(latest)),
        enabled: latest.status !== 'retired',
    }, username);
    return true;
};

/**
 * §8.3c shadow verdict at window close. The shadow is never injected, so
 * both versions faced identical outcomes — the only honest comparison is
 * the incumbent's record INSIDE the window: if the live trigger kept
 * losing (worse than the kind's coin-flip band), the tightened refinement
 * earned the slot; if the live version held up, the rewrite was an
 * overfit reaction to bad luck and gets discarded with a P7 lesson.
 */
export const settleShadow = (
    meta: SkillMeta,
    windowEvidence: { wins: number; losses: number },
): { promoted: boolean; discarded: boolean; lesson?: string } => {
    const shadow = meta.shadow;
    if (!shadow || shadow.seen < SHADOW_WINDOW_TRADES) return { promoted: false, discarded: false };
    const sample = windowEvidence.wins + windowEvidence.losses;
    const winRate = sample > 0 ? windowEvidence.wins / sample : 0.5;
    const incumbentStruggled = meta.kind === 'avoid' ? winRate > 0.6 : winRate < 0.4;
    if (incumbentStruggled) {
        return { promoted: true, discarded: false };
    }
    return {
        promoted: false,
        discarded: true,
        lesson: `refinement of a ${meta.kind} skill sat in shadow for ${shadow.seen} matched trades while the live version held ${windowEvidence.wins}W/${windowEvidence.losses}L — the rewrite was not needed (refinement overfit).`,
    };
};

/**
 * Apply a settled shadow under the write lock (public entry for the
 * dashboard / tests): promote or discard exactly as the evidence path's
 * inline settle does, without needing a new trade to close the window.
 */
export const settleSkillShadow = (fileId: string, username: string): Promise<'promoted' | 'discarded' | 'pending'> =>
    withNotebookWriteLock(() => settleShadowUnlocked(fileId, username));

const settleShadowUnlocked = async (
    fileId: string,
    username: string,
): Promise<'promoted' | 'discarded' | 'pending'> => {
    const file = getMemoryFiles().files.find(f => f.id === fileId);
    const meta = file ? parseSkillMarkdown(file.content) : null;
    if (!meta || !meta.shadow) return 'pending';
    const windowEvidence = { wins: meta.shadow.wins, losses: meta.shadow.losses };
    const verdict = settleShadow(meta, windowEvidence);
    if (!verdict.promoted && !verdict.discarded) return 'pending';
    // §8.5b: refinement recovery — a settled shadow is one sample.
    void recordRefinementOutcome(username, verdict.promoted);
    if (verdict.promoted && meta.shadow) {
        meta.previousVersion = {
            kind: meta.kind,
            ifCondition: meta.ifCondition,
            thenAction: meta.thenAction,
        };
        meta.kind = meta.shadow.kind;
        meta.ifCondition = meta.shadow.ifCondition;
        meta.thenAction = meta.shadow.thenAction;
        meta.body = meta.shadow.body;
    } else if (meta.shadow) {
        // Refinement lost the shadow comparison — a lesson about the
        // HARNESS (keyed on the refinement gate, not any provider).
        try {
            const { recordHarnessLesson } = await import('./harnessLessons');
            recordHarnessLesson({
                kind: 'injection',
                scope: 'skillGuidance',
                pattern: `skill-refinement:${fileId}`,
                lesson: verdict.lesson ?? 'refinement overfit',
                evidenceId: fileId,
            });
        } catch { /* lesson store is best-effort */ }
    }
    meta.shadow = undefined;
    meta.modifiedAt = new Date().toISOString();
    await updateMemoryFileUnlocked(fileId, {
        content: serializeSkill(meta, titleFromMeta(meta)),
        enabled: meta.status !== 'retired',
    }, username);
    return verdict.promoted ? 'promoted' : 'discarded';
};

/**
 * Self-improving skills: hand a confirmed skill that keeps losing back to
 * the model with the losing post-mortems so the trigger/procedure is
 * tightened. Best-effort — any failure keeps the existing skill untouched.
 * The refined skill starts a fresh consecutive-loss streak.
 * Called ALREADY UNDER the notebook write lock (evidence-path callers hold
 * it), so both phases run inline here.
 */
const maybeRefineSkill = async (fileId: string, allTrades: LoggedTrade[], username: string): Promise<void> => {
    try {
        const file = getMemoryFiles().files.find(f => f.id === fileId);
        const meta = file ? parseSkillMarkdown(file.content) : null;
        if (!meta) return;
        const refined = await craftRefinement(meta, allTrades, username);
        if (!refined) return;
        await applyRefinementUnlocked(fileId, refined, username);
    } catch (e) {
        console.warn('[SkillMemory] Refinement pass failed (skill kept):', e);
    }
};

/**
 * Act on the worth-gate's 'merge' verdict. Previously the
 * second-most-useful gate outcome was DROPPED silently — overlaps festered
 * until consolidateSkills destroyed the extras. The named target skill is
 * tightened with the same refine pass used for consecutive-loss skills, fed
 * the cluster's losing post-mortems as falsifying evidence (an all-win
 * cluster skips the LLM call — nothing was falsified — and just folds the
 * extra evidence into the target).
 */
const maybeMergeSkillUnlocked = async (
    mergeTarget: string,
    trade: LoggedTrade,
    allTrades: LoggedTrade[],
    username: string,
): Promise<void> => {
    try {
        const key = clusterKey(trade);
        const cluster = allTrades.filter(t =>
            (t.outcome === TradeOutcome.WIN || t.outcome === TradeOutcome.LOSS) && clusterKey(t) === key
        );
        const needle = mergeTarget.trim().toLowerCase().replace(/\.md$/i, '');
        const file = getMemoryFiles().files.filter(isSkillFile).find(f => {
            const stem = f.name.replace(/\.md$/i, '').toLowerCase();
            const m = parseSkillMarkdown(f.content);
            return stem === needle || (m ? titleFromMeta(m).toLowerCase() === needle : false);
        });
        const meta = file ? parseSkillMarkdown(file.content) : null;
        if (!file || !meta) {
            // Target vanished between the gate and now — fall back to create
            // so the gate's work still lands somewhere useful.
            await maybeUpsertSkillUnlocked(trade, allTrades, username);
            return;
        }
        const foldEvidence = (): void => {
            if (!latestMeta.tradeIds.includes(trade.id)) {
                latestMeta.tradeIds = [...latestMeta.tradeIds, trade.id];
                if (trade.outcome === TradeOutcome.WIN) latestMeta.wins += 1;
                else latestMeta.losses += 1;
                latestMeta.consecutiveLosses = trade.outcome === TradeOutcome.LOSS
                    ? latestMeta.consecutiveLosses + 1
                    : 0;
                // Merge-driven transitions ride the temporal ledger like every
                // other path so skillStatusAt replay sees them. Stamp BEFORE
                // assigning: stampStatusTransition no-ops once meta.status
                // already equals the next status.
                const derived = deriveStatus(latestMeta, controlStatsFrom(latestMeta, allTrades));
                stampStatusTransition(latestMeta, derived, 'worth-gate merge');
                latestMeta.status = derived;
            }
        };
        let latestMeta = meta;
        const losers = cluster.filter(t => t.outcome === TradeOutcome.LOSS);
        const config = await resolveMemoryConfig(username);
        if (config && losers.length > 0) {
            const refined = await refineSkillFromLosses({
                title: titleFromMeta(meta),
                kind: meta.kind,
                ifCondition: meta.ifCondition,
                thenAction: meta.thenAction,
                body: meta.body,
                wins: meta.wins,
                losses: meta.losses,
            }, losers.slice(-4), config);
            // Re-read after the LLM round-trip — evidence may have landed meanwhile.
            const latestFile = getMemoryFiles().files.find(f => f.id === file.id);
            const latest = latestFile ? parseSkillMarkdown(latestFile.content) : null;
            if (latest && refined) {
                // §8.3c: merge-driven refinements enter the shadow too —
                // the live trigger keeps its slot until the window settles.
                latest.shadow = {
                    kind: refined.kind,
                    ifCondition: refined.ifCondition,
                    thenAction: refined.thenAction,
                    body: formatCraftedSkillBody(refined),
                    name: refined.name,
                    startedAt: new Date().toISOString(),
                    seen: 0,
                    wins: 0,
                    losses: 0,
                };
                latest.refinedAt = new Date().toISOString();
                latestMeta = latest;
            }
        }
        foldEvidence();
        latestMeta.modifiedAt = new Date().toISOString();
        await updateMemoryFileUnlocked(file.id, {
            content: serializeSkill(latestMeta, titleFromMeta(latestMeta)),
            enabled: latestMeta.status !== 'retired',
        }, username);
        console.log('[SkillMemory] Worth-gate merge applied to', file.name);
    } catch (e) {
        console.warn('[SkillMemory] Worth-gate merge failed:', e);
    }
};

export const maybeMergeSkill = (
    mergeTarget: string,
    trade: LoggedTrade,
    allTrades: LoggedTrade[],
    username: string,
): Promise<void> =>
    withNotebookWriteLock(() => maybeMergeSkillUnlocked(mergeTarget, trade, allTrades, username));

/**
 * User-triggered refinement from the dashboard. Runs the same LLM tighten
 * pass the automatic 3-loss gate uses, on demand — closes the loop for
 * 'refine' recommendations that would otherwise render as dead-end rows.
 * Resolves FALSE when nothing changed (no provider / LLM declined) so the
 * dashboard doesn't toast success on a no-op.
 *
 * The LLM round-trip runs OUTSIDE the notebook write lock — it can take
 * tens of seconds and must not block every other notebook writer (evidence
 * sync, post-mortem ingestion, UI edits). Only the re-read-and-write phase
 * holds the lock.
 */
export const refineSkillNow = async (
    fileId: string,
    allTrades: LoggedTrade[],
    username: string,
): Promise<boolean> => {
    const file = getMemoryFiles().files.find(f => f.id === fileId);
    const meta = file ? parseSkillMarkdown(file.content) : null;
    if (!meta) return false;
    let refined: CraftedSkill | null;
    try {
        refined = await craftRefinement(meta, allTrades, username);
    } catch (e) {
        console.warn('[SkillMemory] On-demand refinement failed (skill kept):', e);
        return false;
    }
    if (!refined) return false;
    const result = refined;
    return withNotebookWriteLock(() => applyRefinementUnlocked(fileId, result, username));
};

/**
 * One-sentence semantic summary for a new skill (zcode memory pattern).
 * Prefers the validated IF/THEN clause; falls back to the extracted lesson.
 * Kept to one line — it feeds index lines and LLM judges, not essays.
 * Returns '' when there is no claim at all (no clause, no lesson) — a
 * scope-only description is content-free, and callers refuse to persist it.
 */
const buildSkillDescription = (
    kind: SkillKind,
    setup: { coin?: string; direction?: string; family?: string; regime?: string },
    ifCondition?: string,
    thenAction?: string,
    lesson?: string,
): string => {
    const scope = [setup.coin, setup.direction, setup.family, setup.regime].filter(Boolean).join(' ');
    const claim = ifCondition && thenAction
        ? `IF ${ifCondition.replace(/\s+/g, ' ').trim()} THEN ${thenAction.replace(/\s+/g, ' ').trim()}`
        : lesson?.replace(/\s+/g, ' ').trim() || '';
    if (!claim) return '';
    const verb = kind === 'avoid' ? 'Avoid:' : 'Repeat:';
    return `${verb} ${claim} — learned from ${scope || 'matching setups'}.`.replace(/\s+/g, ' ').slice(0, 280);
};

/**
 * Create a skill when a similar cluster reaches MIN_CLUSTER_FOR_SKILL and
 * no matching skill exists yet. Evidence-gated — not a free-form LLM spawn.
 */
const maybeUpsertSkillUnlocked = async (
    trade: LoggedTrade,
    allTrades: LoggedTrade[],
    username: string,
    // The worth-gate's JUDGED clauses ride through so the
    // persisted skill matches the artifact that was validated.
    preferredClause?: { ifCondition?: string; thenAction?: string; prediction?: SkillPrediction },
): Promise<MemoryFile | null> => {
    if (trade.outcome !== TradeOutcome.WIN && trade.outcome !== TradeOutcome.LOSS) return null;
    if (!tradeAdmitsTechnicalStrategyRule(trade)) return null;
    await ensureHarnessFoldersUnlocked(username);
    const key = clusterKey(trade);
    const cluster = allTrades.filter(t =>
        (t.outcome === TradeOutcome.WIN || t.outcome === TradeOutcome.LOSS) && clusterKey(t) === key
    );
    if (cluster.length < MIN_CLUSTER_FOR_SKILL) return null;

    const setup = {
        coin: trade.analysis?.coinName,
        direction: trade.analysis?.direction === 'Neutral' ? undefined : trade.analysis?.direction,
        family: trade.analysis?.detectedPatternFamily,
        pattern: trade.analysis?.marketConditions?.pattern,
        regime: trade.marketRegime,
    };
    const existing = getMemoryFiles().files.filter(isSkillFile).some(f => {
        const meta = parseSkillMarkdown(f.content);
        return meta ? skillMatchesSetup(meta, setup) : false;
    });
    if (existing) return null;

    const wins = cluster.filter(t => t.outcome === TradeOutcome.WIN).length;
    const losses = cluster.filter(t => t.outcome === TradeOutcome.LOSS).length;
    // Trailing-loss streak (cluster sorted oldest → newest).
    const ordered = [...cluster].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    let streak = 0;
    for (let i = ordered.length - 1; i >= 0 && ordered[i].outcome === TradeOutcome.LOSS; i--) streak++;
    const kind: SkillKind = losses >= wins ? 'avoid' : 'repeat';
    // Prefer the clauses the worth-gate JUDGED over whatever
    // re-parsing the raw post-mortem produces now — validated ≠ persisted was
    // a silent mismatch before.
    const clause = (preferredClause?.ifCondition || preferredClause?.thenAction)
        ? { ifCondition: preferredClause.ifCondition ?? '', thenAction: preferredClause.thenAction ?? '' }
        : parseIfThenClauses(trade.postMortem ?? '')[0];
    // §8.4a: never silently re-create a retired twin. An archive match drafts
    // a REVIVAL review card instead of a fresh skill — the graveyard is how
    // the system remembers what didn't work.
    if (clause?.ifCondition) {
        const twin = findArchiveTwin(username, clause.ifCondition);
        if (twin) {
            queueRevivalProposal(username, twin);
            return null;
        }
    }
    const lesson = clause
        ? formatSkillProcedure(clause)
        : extractLessonFromPostMortem(trade.postMortem ?? '');
    // No clause AND no extractable lesson = no actual claim about the
    // market. Cluster statistics alone do not form a procedure, and
    // fabricating a boilerplate one here is exactly the junk the
    // worth-gate exists to prevent — refuse to write the skill.
    if (!lesson) return null;
    const meta: SkillMeta = {
        status: 'candidate',
        kind,
        // One-sentence semantic summary (zcode pattern): derived from the
        // clauses when present, else the scope + procedure. The worth-gate's
        // judged clause is the best source — it was validated, not parsed.
        description: buildSkillDescription(kind, setup, clause?.ifCondition, clause?.thenAction, lesson),
        originMessageId: trade.id,
        coin: trade.analysis?.coinName,
        direction: setup.direction,
        family: trade.analysis?.detectedPatternFamily,
        regime: trade.marketRegime,
        wins,
        losses,
        consecutiveLosses: streak,
        tradeIds: cluster.map(t => t.id),
        ifCondition: clause?.ifCondition,
        thenAction: clause?.thenAction,
        // §8.2a birth certificate: the worth-gate's judged claim when it
        // carried one, else the deterministic default from the cluster's
        // scope. Every new skill leaves with a falsifiable prediction.
        prediction: preferredClause?.prediction ?? defaultPrediction({
            coin: setup.coin,
            family: setup.family,
            regime: setup.regime,
        }),
        body: clause
            ? lesson
            : [
                `**Trigger:** ${[setup.coin, setup.direction, setup.family].filter(Boolean).join(' · ') || 'matching setup'}`,
                `**Procedure:** ${lesson}`,
                `**Invalidates:** thesis break or a different regime than ${setup.regime || 'the one that produced this cluster'}.`,
            ].join('\n'),
    };
    meta.status = deriveStatus(meta);

    const folder = getMemoryFiles().folders.find(f => f.name === 'skills');
    if (!folder) return null;
    const content = serializeSkill(meta, titleFromMeta(meta));
    const created = await createMemoryFileUnlocked(folder.id, fileNameFromMeta(meta), content, username, true);
    // §8.5b: the worth-gate judged this clause — count it as a gate approval
    // so weekly meta-calibration can measure how many approvals confirm.
    if (created && preferredClause?.ifCondition) {
        void recordWorthGateApproval(username, preferredClause.ifCondition);
    }
    return created;
};

/** Serialized public API — see withNotebookWriteLock in MemoryFilesService. */
export const maybeUpsertSkill = (
    trade: LoggedTrade,
    allTrades: LoggedTrade[],
    username: string,
    // The worth-gate's JUDGED clauses ride through the locked
    // wrapper so callers can persist the validated artifact.
    preferredClause?: { ifCondition?: string; thenAction?: string; prediction?: SkillPrediction },
): Promise<MemoryFile | null> =>
    withNotebookWriteLock(() => maybeUpsertSkillUnlocked(trade, allTrades, username, preferredClause));

const ingestCraftedSkillUnlocked = async (
    trade: LoggedTrade,
    crafted: CraftedSkill,
    username: string,
): Promise<void> => {
    if (trade.outcome !== TradeOutcome.WIN && trade.outcome !== TradeOutcome.LOSS) return;
    if (!tradeAdmitsTechnicalStrategyRule(trade)) return;
    await ensureHarnessFoldersUnlocked(username);
    const folder = getMemoryFiles().folders.find(f => f.name === 'skills');
    if (!folder) return;
    const setupDir = trade.analysis?.direction === 'Long' || trade.analysis?.direction === 'Short'
        ? trade.analysis.direction
        : undefined;
    const existing = getMemoryFiles().files.filter(isSkillFile).find(f => {
        const meta = parseSkillMarkdown(f.content);
        return meta?.ifCondition?.toLowerCase() === crafted.ifCondition.toLowerCase();
    });
    // §8.4a: retired twin → REVIVAL card, not a duplicate birth.
    const twin = findArchiveTwin(username, crafted.ifCondition);
    if (twin) {
        queueRevivalProposal(username, twin);
        return;
    }
    const kind = crafted.kind;
    if (existing) {
        const meta = parseSkillMarkdown(existing.content);
        if (!meta) return;
        if (!meta.tradeIds.includes(trade.id)) {
            if (trade.outcome === TradeOutcome.WIN) meta.wins += 1;
            else meta.losses += 1;
            meta.tradeIds = [...meta.tradeIds, trade.id];
        }
        meta.kind = kind;
        meta.ifCondition = crafted.ifCondition;
        meta.thenAction = crafted.thenAction;
        // A legacy skill updated through the craft path gains its birth
        // certificate here if it never had one.
        if (!meta.prediction) {
            meta.prediction = crafted.prediction ?? defaultPrediction({
                coin: trade.analysis?.coinName,
                family: trade.analysis?.detectedPatternFamily,
                regime: trade.marketRegime,
            });
        }
        meta.body = formatCraftedSkillBody(crafted);
        meta.status = deriveStatus(meta);
        await updateMemoryFileUnlocked(existing.id, {
            content: serializeSkill(meta, crafted.name || titleFromMeta(meta)),
            enabled: meta.status !== 'retired',
        }, username);
        return;
    }
    const meta: SkillMeta = {
        status: 'candidate',
        kind,
        coin: trade.analysis?.coinName,
        direction: setupDir,
        family: trade.analysis?.detectedPatternFamily,
        regime: trade.marketRegime,
        wins: trade.outcome === TradeOutcome.WIN ? 1 : 0,
        losses: trade.outcome === TradeOutcome.LOSS ? 1 : 0,
        consecutiveLosses: trade.outcome === TradeOutcome.LOSS ? 1 : 0,
        tradeIds: [trade.id],
        ifCondition: crafted.ifCondition,
        thenAction: crafted.thenAction,
        prediction: crafted.prediction ?? defaultPrediction({
            coin: trade.analysis?.coinName,
            family: trade.analysis?.detectedPatternFamily,
            regime: trade.marketRegime,
        }),
        body: formatCraftedSkillBody(crafted),
    };
    meta.status = deriveStatus(meta);
    const slug = slugifyName(crafted.name) || slugifyName([trade.analysis?.coinName, kind].filter(Boolean).join(' ')) || 'skill';
    await createMemoryFileUnlocked(folder.id, `${slug}.md`, serializeSkill(meta, crafted.name || titleFromMeta(meta)), username, true);
};

/** Serialized public API — see withNotebookWriteLock in MemoryFilesService. */
export const ingestCraftedSkill = (
    trade: LoggedTrade,
    crafted: CraftedSkill,
    username: string,
): Promise<void> =>
    withNotebookWriteLock(() => ingestCraftedSkillUnlocked(trade, crafted, username));

/**
 * Ingest a user-approved skill draft that has NO closed trade behind it
 * (verdict-sourced drafts). Starts as a zero-evidence candidate — it must
 * earn wins/losses through applySkillEvidence before it can confirm.
 */
const ingestCraftedSkillFromDraftUnlocked = async (
    crafted: CraftedSkill,
    coin: string | undefined,
    username: string,
): Promise<void> => {
    await ensureHarnessFoldersUnlocked(username);
    const folder = getMemoryFiles().folders.find(f => f.name === 'skills');
    if (!folder) return;
    const existing = getMemoryFiles().files.filter(isSkillFile).find(f => {
        const meta = parseSkillMarkdown(f.content);
        return meta?.ifCondition?.toLowerCase() === crafted.ifCondition.toLowerCase();
    });
    if (existing) return; // already learned — never duplicate a trigger
    const meta: SkillMeta = {
        status: 'candidate',
        kind: crafted.kind,
        coin,
        wins: 0,
        losses: 0,
        consecutiveLosses: 0,
        tradeIds: [],
        ifCondition: crafted.ifCondition,
        thenAction: crafted.thenAction,
        prediction: crafted.prediction ?? defaultPrediction({ coin }),
        body: formatCraftedSkillBody(crafted),
    };
    const slug = slugifyName(crafted.name) || slugifyName([coin, crafted.kind].filter(Boolean).join(' ')) || 'skill';
    await createMemoryFileUnlocked(folder.id, `${slug}.md`, serializeSkill(meta, crafted.name || titleFromMeta(meta)), username, true);
};

/** Serialized public API — see withNotebookWriteLock in MemoryFilesService. */
export const ingestCraftedSkillFromDraft = (
    crafted: CraftedSkill,
    coin: string | undefined,
    username: string,
): Promise<void> =>
    withNotebookWriteLock(() => ingestCraftedSkillFromDraftUnlocked(crafted, coin, username));

const ingestIfThenFromTradeUnlocked = async (trade: LoggedTrade, username: string): Promise<void> => {
    if (trade.outcome !== TradeOutcome.WIN && trade.outcome !== TradeOutcome.LOSS) return;
    if (!tradeAdmitsTechnicalStrategyRule(trade)) return;
    if (listSkillDrafts(username).some(d => d.tradeId === trade.id)) return;
    const clauses = parseIfThenClauses(trade.postMortem ?? '');
    if (clauses.length === 0) return;
    await ensureHarnessFoldersUnlocked(username);
    const folder = getMemoryFiles().folders.find(f => f.name === 'skills');
    if (!folder) return;
    const kind: SkillKind = trade.outcome === TradeOutcome.LOSS ? 'avoid' : 'repeat';
    const setupDir = trade.analysis?.direction === 'Long' || trade.analysis?.direction === 'Short'
        ? trade.analysis.direction
        : undefined;
    for (const clause of clauses) {
        const existing = getMemoryFiles().files.filter(isSkillFile).find(f => {
            const meta = parseSkillMarkdown(f.content);
            return meta?.ifCondition?.toLowerCase() === clause.ifCondition.toLowerCase();
        });
        if (existing) {
            const meta = parseSkillMarkdown(existing.content);
            if (!meta) continue;
            if (!meta.tradeIds.includes(trade.id)) {
                if (trade.outcome === TradeOutcome.WIN) meta.wins += 1;
                else meta.losses += 1;
                meta.tradeIds = [...meta.tradeIds, trade.id];
            }
            meta.thenAction = clause.thenAction;
            meta.modifiedAt = new Date().toISOString();
            meta.body = formatSkillProcedure(clause);
            meta.status = deriveStatus(meta);
            await updateMemoryFileUnlocked(existing.id, {
                content: serializeSkill(meta, titleFromMeta(meta)),
                enabled: meta.status !== 'retired',
            }, username);
            continue;
        }
        const meta: SkillMeta = {
            status: 'candidate',
            kind,
            coin: trade.analysis?.coinName,
            direction: setupDir,
            family: trade.analysis?.detectedPatternFamily,
            regime: trade.marketRegime,
            wins: trade.outcome === TradeOutcome.WIN ? 1 : 0,
            losses: trade.outcome === TradeOutcome.LOSS ? 1 : 0,
            consecutiveLosses: trade.outcome === TradeOutcome.LOSS ? 1 : 0,
            tradeIds: [trade.id],
            ifCondition: clause.ifCondition,
            thenAction: clause.thenAction,
            prediction: defaultPrediction({
                coin: trade.analysis?.coinName,
                family: trade.analysis?.detectedPatternFamily,
                regime: trade.marketRegime,
            }),
            body: formatSkillProcedure(clause),
        };
        meta.status = deriveStatus(meta);
        const slug = slugifyName([trade.analysis?.coinName, kind, clause.ifCondition.slice(0, 40)].filter(Boolean).join(' '))
            || 'if-then';
        await createMemoryFileUnlocked(folder.id, `${slug}.md`, serializeSkill(meta, titleFromMeta(meta)), username, true);
    }
};

/** Serialized public API — see withNotebookWriteLock in MemoryFilesService. */
export const ingestIfThenFromTrade = (trade: LoggedTrade, username: string): Promise<void> =>
    withNotebookWriteLock(() => ingestIfThenFromTradeUnlocked(trade, username));

/**
 * Disable retired skills and merge exact-duplicate triggers (same file stem).
 */
const consolidateSkillsUnlocked = async (username: string): Promise<void> => {
    await ensureHarnessFoldersUnlocked(username);
    const skills = getMemoryFiles().files.filter(isSkillFile);
    const byKey = new Map<string, MemoryFile[]>();
    for (const file of skills) {
        const meta = parseSkillMarkdown(file.content);
        const key = meta
            ? [meta.coin, meta.direction, meta.family, meta.kind].join('|').toLowerCase()
            : file.name;
        const list = byKey.get(key) ?? [];
        list.push(file);
        byKey.set(key, list);
    }
    for (const group of byKey.values()) {
        if (group.length < 2) {
            const meta = parseSkillMarkdown(group[0].content);
            if (meta?.status === 'retired' && group[0].enabled) {
                await updateMemoryFileUnlocked(group[0].id, { enabled: false }, username);
            }
            continue;
        }
        const metas = group.map(f => parseSkillMarkdown(f.content)).filter(Boolean) as SkillMeta[];
        const keep = group[0];
        // The surviving body is the RICHEST one (longest — a
        // refined procedure always beats an original stub), not arbitrarily
        // `metas[0].body`.
        const richest = metas.reduce((a, b) => (b.body.length > a.body.length ? b : a), metas[0]);
        // W/L are re-derived from the DEDUPED union of
        // tradeIds (joined against actual outcomes where possible) — raw
        // summing double-counted trades that sat in two duplicates and
        // inflated the sample that deriveStatus confirms/retires on. We can't
        // re-check each trade's outcome from here, so we scale proportionally:
        // uniqueCount / summedCount applied to the totals.
        const uniqueTrades = new Set(metas.flatMap(m => m.tradeIds));
        const summedSample = metas.reduce((s, m) => s + m.wins + m.losses, 0);
        let mergedWins = metas.reduce((s, m) => s + m.wins, 0);
        let mergedLosses = metas.reduce((s, m) => s + m.losses, 0);
        if (summedSample > uniqueTrades.size && summedSample > 0) {
            const scale = uniqueTrades.size / summedSample;
            mergedWins = Math.round(mergedWins * scale);
            // Wins+losses must sum EXACTLY to the deduped sample size —
            // assign rounding remainder to losses so deriveStatus sees a
            // consistent sample.
            mergedLosses = Math.max(0, uniqueTrades.size - mergedWins);
        }
        const merged: SkillMeta = {
            ...metas[0],
            wins: mergedWins,
            losses: mergedLosses,
            tradeIds: [...uniqueTrades],
            body: richest.body,
            ifCondition: richest.ifCondition || metas[0].ifCondition,
            thenAction: richest.thenAction || metas[0].thenAction,
            // Keep the strongest provenance fields across the group.
            refinedAt: metas.map(m => m.refinedAt).filter(Boolean).sort().at(-1) ?? metas[0].refinedAt,
            evidenceCount: uniqueTrades.size,
        };
        merged.status = deriveStatus(merged);
        await updateMemoryFileUnlocked(keep.id, {
            content: serializeSkill(merged, titleFromMeta(merged)),
            enabled: merged.status !== 'retired',
        }, username);
        // Superseded duplicates are ARCHIVED, not deleted.
        // Deleting broke the ledger doctrine ("superseded beliefs are never
        // deleted") and destroyed replay-audit trails. The skills-archive
        // folder already exists for retired skills; merged dupes join them
        // (disabled, so they drop out of retrieval/evidence/dashboards).
        const archiveFolder = await ensureSkillsArchiveFolderUnlocked(username);
        for (const extra of group.slice(1)) {
            if (archiveFolder) {
                await updateMemoryFileUnlocked(extra.id, {
                    folderId: archiveFolder.id,
                    enabled: false,
                }, username);
            } else {
                // No archive available — disable in place instead of deleting.
                await updateMemoryFileUnlocked(extra.id, { enabled: false }, username);
            }
        }
    }

    // ── Archive sweep (bounds pass) ──
    // Retired skills leave the active skills folder: isSkillFile is
    // folder-based, so archived skills drop out of retrieval, evidence and
    // dashboards while staying in the notebook for the record. Keeps the
    // active skill set bounded instead of growing forever.
    const retired = getMemoryFiles().files.filter(f => {
        if (!isSkillFile(f)) return false;
        const m = parseSkillMarkdown(f.content);
        return m?.status === 'retired';
    });
    if (retired.length > 0) {
        const archive = await ensureSkillsArchiveFolderUnlocked(username);
        if (archive) {
            for (const f of retired) {
                if (f.folderId !== archive.id) {
                    await updateMemoryFileUnlocked(f.id, { folderId: archive.id, enabled: false }, username);
                    // §8.4a: every retirement leaves a graveyard row — the
                    // worth gate reads it so a retired twin is never
                    // re-created without a REVIVAL review card.
                    const m = parseSkillMarkdown(f.content);
                    if (m) {
                        void recordTombstone(username, {
                            slug: f.name.replace(/\.md$/i, ''),
                            reason: retirementReasonFromHistory(m.history?.[m.history.length - 1]?.reason),
                            sampleN: (m.wins || 0) + (m.losses || 0),
                            liftPts: null,
                        });
                    }
                }
            }
        }
    }
};

/** Serialized public API — see withNotebookWriteLock in MemoryFilesService. */
export const consolidateSkills = (username: string): Promise<void> =>
    withNotebookWriteLock(() => consolidateSkillsUnlocked(username));

/**
 * §8.2b comparative worth gate. Confirmed skills are unbounded while the
 * injection budgets are fixed (900/400/600 chars), so every new skill
 * silently taxes every existing skill's chance of being seen — unbounded
 * libraries are how memory systems drown.
 *
 * Below the cap the worth gate answers in isolation, as today. AT the cap it
 * must answer a different question: "is this better than the weakest
 * confirmed skill?" The comparison is favorability — the cluster record the
 * gate just judged (challenger) against the weakest incumbent's realized
 * record (the same quantity MemoryProvenanceService's lift ranks on). A new
 * skill that wins displaces the weakest — but displacement is a SUGGESTION
 * queued for approval (§10.3): the gate proposes, the inbox disposes.
 *
 * Returns 'create' when the caller should proceed with creation (below cap,
 * or at the cap but the challenger beats the weakest incumbent — the winner
 * enters as a candidate while the displacement of the weakest rides the
 * human gate), and 'skip' when the library is full and the challenger lost
 * the comparison (a proposal is still queued — the human may retire the
 * incumbent anyway).
 */
export const favorabilityOf = (m: { kind: SkillKind; wins: number; losses: number }): number => {
    const sample = m.wins + m.losses;
    if (sample === 0) return 0.5;
    const wr = m.wins / sample;
    // An avoid skill "wins" when the setups it steered away from LOST.
    return m.kind === 'avoid' ? 1 - wr : wr;
};

export interface CapChallenger {
    kind: SkillKind;
    wins: number;
    losses: number;
    ifCondition?: string;
    thenAction?: string;
    prediction?: SkillPrediction;
}

export const checkLibraryCapAtGate = (
    challenger: CapChallenger,
    username: string,
): 'create' | 'skip' => {
    const confirmed = listSkills().filter(({ meta }) => meta.status === 'confirmed' && !meta.supersededBy);
    if (confirmed.length < getSkillLibraryCap()) return 'create';
    const weakest = [...confirmed].sort((a, b) => favorabilityOf(a.meta) - favorabilityOf(b.meta))[0];
    if (!weakest) return 'create';
    const chScore = favorabilityOf(challenger);
    const incScore = favorabilityOf(weakest.meta);
    const wins = chScore > incScore;
    const verdictLine = wins
        ? `The new lesson outperforms the weakest incumbent ${weakest.file.name} (${weakest.meta.wins}W/${weakest.meta.losses}L) — displace it to retired (reason: superseded)?`
        : `The new lesson does NOT beat the weakest incumbent ${weakest.file.name} (${weakest.meta.wins}W/${weakest.meta.losses}L) — creation blocked. Retire ${weakest.file.name} anyway to make room?`;
    queueLearningProposal({
        kind: 'displacement',
        skillSlug: weakest.file.name.replace(/\.md$/i, ''),
        text: `Skill library is at its cap (${confirmed.length} confirmed). ${verdictLine}`,
        fingerprint: `cap|${weakest.file.name}|${challenger.ifCondition?.slice(0, 40) ?? ''}`,
        payload: {
            displacedSlug: weakest.file.name.replace(/\.md$/i, ''),
            reason: 'superseded',
            challenger,
        },
    }, username);
    return wins ? 'create' : 'skip';
};

/**
 * Act on an APPROVED displacement proposal: retire the named skill with
 * reason `superseded` (pointing at its successor when the challenger is
 * known) and create the challenger in its place. Called from the learning
 * queue UI — never automatically.
 */
export const applyDisplacementProposal = async (
    displacedSlug: string,
    username: string,
    challenger?: Partial<CapChallenger> & { supersededBy?: string },
): Promise<boolean> => withNotebookWriteLock(async () => {
    await ensureHarnessFoldersUnlocked(username);
    const target = getMemoryFiles().files
        .filter(isSkillFile)
        .find(f => f.name.replace(/\.md$/i, '').toLowerCase() === displacedSlug.replace(/\.md$/i, '').toLowerCase());
    if (!target) return false;
    const meta = parseSkillMarkdown(target.content);
    if (!meta) return false;
    stampStatusTransition(meta, 'retired', 'superseded');
    meta.status = 'retired';
    if (challenger?.supersededBy) meta.supersededBy = challenger.supersededBy;
    meta.modifiedAt = new Date().toISOString();
    await updateMemoryFileUnlocked(target.id, {
        content: serializeSkill(meta, titleFromMeta(meta)),
        enabled: false,
    }, username);
    // The displaced skill moves to the archive so the graveyard dedup (§8.4a)
    // can see it on the next creation pass.
    const archive = await ensureSkillsArchiveFolderUnlocked(username);
    if (archive) {
        await updateMemoryFileUnlocked(target.id, { folderId: archive.id, enabled: false }, username);
    }
    // The docstring promised "create the challenger in its place" — the
    // gate's judged clauses ride in the proposal payload, so approval must
    // actually install them (as a CANDIDATE — it displaced on score, but it
    // still has to earn confirmed). Without this, approving displacement
    // silently loses the challenger the gate compared.
    if (challenger?.ifCondition && challenger?.thenAction) {
        const folder = getMemoryFiles().folders.find(f => f.name === 'skills');
        const dup = folder && getMemoryFiles().files.filter(isSkillFile).find(f => {
            const m = parseSkillMarkdown(f.content);
            return m?.ifCondition?.toLowerCase() === challenger.ifCondition?.toLowerCase();
        });
        if (folder && !dup) {
            const meta: SkillMeta = {
                status: 'candidate',
                kind: challenger.kind ?? 'repeat',
                wins: challenger.wins ?? 0,
                losses: challenger.losses ?? 0,
                consecutiveLosses: 0,
                tradeIds: [],
                ifCondition: challenger.ifCondition,
                thenAction: challenger.thenAction,
                prediction: challenger.prediction,
                body: `Displaces "${displacedSlug}" at the library cap (approved from the learning queue).`,
            };
            const slug = slugifyName(challenger.ifCondition.slice(0, 60)) || `skill-${Date.now()}`;
            await createMemoryFileUnlocked(folder.id, `${slug}.md`, serializeSkill(meta, titleFromMeta(meta)), username, true);
        }
    }
    return true;
});

/**
 * Act on an APPROVED revival proposal (§8.4a): the retired twin comes back
 * as a CANDIDATE (never straight to confirmed — it must re-earn its tier),
 * moved out of the archive back into the live skills folder.
 */
export const applyRevivalProposal = async (
    slug: string,
    username: string,
): Promise<boolean> => withNotebookWriteLock(async () => {
    await ensureHarnessFoldersUnlocked(username);
    const target = getMemoryFiles().files
        .filter(f => f.name.endsWith('.md'))
        .find(f => f.name.replace(/\.md$/i, '').toLowerCase() === slug.replace(/\.md$/i, '').toLowerCase());
    if (!target) return false;
    const meta = parseSkillMarkdown(target.content);
    if (!meta) return false;
    stampStatusTransition(meta, 'candidate', 'revival-approved');
    meta.status = 'candidate';
    meta.supersededBy = undefined;
    meta.modifiedAt = new Date().toISOString();
    await updateMemoryFileUnlocked(target.id, {
        content: serializeSkill(meta, titleFromMeta(meta)),
        folderId: 'skills',
        enabled: true,
    }, username);
    return true;
});

/**
 * Act on an APPROVED demote proposal (§8.4e): a zero-evidence confirmed skill
 * is expelled from injection by dropping it to candidate. Reversible in the
 * grid; never automatic.
 */
export const applyDemoteProposal = async (
    slug: string,
    username: string,
): Promise<boolean> => withNotebookWriteLock(async () => {
    await ensureHarnessFoldersUnlocked(username);
    const target = getMemoryFiles().files
        .filter(isSkillFile)
        .find(f => f.name.replace(/\.md$/i, '').toLowerCase() === slug.replace(/\.md$/i, '').toLowerCase());
    if (!target) return false;
    const meta = parseSkillMarkdown(target.content);
    if (!meta) return false;
    stampStatusTransition(meta, 'candidate', 'demote-approved');
    meta.status = 'candidate';
    meta.modifiedAt = new Date().toISOString();
    await updateMemoryFileUnlocked(target.id, {
        content: serializeSkill(meta, titleFromMeta(meta)),
        enabled: true,
    }, username);
    return true;
});

/**
 * Closed-loop write: diary + mistakes + skill scores. Safe to call from
 * both trade-log and post-mortem (diary entries are de-duplicated by id).
 */
export const syncClosedTradeToNotebook = async (
    trade: LoggedTrade,
    allTrades: LoggedTrade[],
    username: string
): Promise<void> => {
    await appendDiaryEntry(trade, username);
    await syncRecurringMistakes(allTrades, username);
    await applySkillEvidence(trade, username, allTrades);
    await ingestIfThenFromTrade(trade, username);
    try {
        const { evaluateSkillWorth, validateCraftedSkill } = await import('./skillWorthGate');
        await ensureHarnessFoldersUnlocked(username);
        const key = clusterKey(trade);
        const cluster = allTrades.filter(t => (t.outcome === TradeOutcome.WIN || t.outcome === TradeOutcome.LOSS) && clusterKey(t) === key);
        if (cluster.length >= MIN_CLUSTER_FOR_SKILL) {
            const setup = {
                coin: trade.analysis?.coinName,
                direction: trade.analysis?.direction,
                family: trade.analysis?.detectedPatternFamily,
                // Worth-gate matching honors the regime too — a cluster
                // earned in trending markets shouldn't suppress creating a
                // differently-scoped skill for the same coin in chop.
                regime: trade.marketRegime,
            };
            const hasMatch = getMemoryFiles().files.filter(isSkillFile).some(f => {
                const m = parseSkillMarkdown(f.content);
                return m ? skillMatchesSetup(m, setup) : false;
            });
            if (!hasMatch) {
                const config = await resolveMemoryConfig(username);
                if (config) {
                    const { getBotMemoryContext } = await import('../bots/BotMemoryService');
                    const firstBotId = (() => {
                        try {
                            const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(`bots_v1_${username}`) : null;
                            const data = raw ? JSON.parse(raw) as { bots?: Array<{ id: string }> } : null;
                            return data?.bots?.[0]?.id || trade.id;
                        } catch { return trade.id; }
                    })();
                    const botCtx = getBotMemoryContext(firstBotId, setup, 'global');
                    const decision = await evaluateSkillWorth({ coin: setup.coin, direction: setup.direction, family: setup.family, cluster }, botCtx, config);
                    if (decision) {
                        const judgedClause = {
                            ifCondition: decision.ifCondition,
                            thenAction: decision.thenAction,
                            // §8.2a: the gate's claim rides through so the
                            // persisted skill carries the validated artifact.
                            prediction: decision.prediction,
                        };
                        // The create/merge mutations are
                        // read-modify-write cycles over the shared notebook
                        // cache — they MUST hold the write lock. syncClosedTrade-
                        // ToNotebook itself is not locked (its earlier steps use
                        // locked public APIs), so route through the locked
                        // wrappers; the LLM gate call above stays outside the
                        // lock on purpose (slow network I/O must not block
                        // other writers).
                        if (decision.verdict === 'create') {
                            const err = validateCraftedSkill(decision,
                                cluster.filter(t => t.outcome === TradeOutcome.WIN).length,
                                cluster.filter(t => t.outcome === TradeOutcome.LOSS).length);
                            // §8.2b: at the library cap the gate turns
                            // comparative — creation is blocked and a
                            // displacement proposal naming the weakest
                            // incumbent rides the learning queue instead.
                            const capOk = checkLibraryCapAtGate({
                                kind: decision.kind === 'repeat' ? 'repeat' : 'avoid',
                                wins: cluster.filter(t => t.outcome === TradeOutcome.WIN).length,
                                losses: cluster.filter(t => t.outcome === TradeOutcome.LOSS).length,
                                ifCondition: decision.ifCondition,
                                thenAction: decision.thenAction,
                                prediction: decision.prediction,
                            }, username);
                            // The gate judged SPECIFIC clauses —
                            // persist those (validated ≡ persisted), not a fresh
                            // re-parse of the raw post-mortem.
                            if (!err && capOk === 'create') await maybeUpsertSkill(trade, allTrades, username, judgedClause);
                            else if (!err && capOk === 'skip') console.log('[SkillMemory] Library cap reached — displacement proposal queued instead of create.');
                            else console.warn('[SkillMemory] Skill worth-gate rejected crafted skill:', err);
                        } else if (decision.verdict === 'merge' && decision.mergeTarget) {
                            // 'merge' was dead code — the gate's
                            // second-most-useful verdict is now honored: tighten
                            // the named target instead of letting overlaps
                            // fester until destructive consolidation.
                            await maybeMergeSkill(decision.mergeTarget, trade, allTrades, username);
                        }
                        // 'skip' stays skip — the gate said no.
                    }
                } else {
                    // No ready provider = the gate cannot run. Fail CLOSED:
                    // an unjudged skill is exactly what the gate exists to
                    // prevent. The cluster stays eligible — the next closed
                    // trade in it retries the gate once a provider is up.
                    console.warn('[SkillMemory] Skill worth-gate skipped (no ready provider) — skill creation deferred.');
                }
            }
        }
        // Below MIN_CLUSTER_FOR_SKILL there is no evidence to judge — that is
        // not a bypass, just too little data. maybeUpsertSkill would return
        // null anyway, so calling it here only risks a duplicate write path.
    } catch (e) {
        // Gate infrastructure failure (import, provider call, bad JSON).
        // Fail CLOSED for the same reason: never create a skill the gate
        // did not approve. Logged so silent degradation is visible.
        console.warn('[SkillMemory] Skill worth-gate errored — skill creation deferred:', e);
    }
    await consolidateSkills(username);
    maybePinWinningPromptLane(allTrades);
    // Doctrine consolidation: every N newly-closed trades an LLM pass
    // rewrites profile/doctrine.md into settled first-person beliefs.
    // Best-effort + gated on evidence count; never blocks the sync.
    try {
        const { consolidateDoctrine } = await import('./DoctrineConsolidationService');
        const config = await resolveMemoryConfig(username);
        if (config) {
            const res = await consolidateDoctrine(allTrades, username, config);
            if (res.updated) console.log('[Doctrine] Doctrine rewritten from', countClosedTrades(allTrades), 'closed trades.');

            // ── Automated skill evals ──
            // The harness audits its own knowledge: one due skill gets a
            // cost-capped A/B run; a 'hurts' verdict demotes it via
            // deriveStatus. Deliberately NOT awaited — up to a dozen provider
            // calls must never stall the post-mortem chain. The scheduler's
            // own try/catch + session budget make it safe detached.
            try {
                const { runDueSkillEvalWithDefaultRunner } = await import('./SkillEvalScheduler');
                void runDueSkillEvalWithDefaultRunner(allTrades, username, config).catch(e => {
                    console.warn('[SkillEvalScheduler] deferred:', e instanceof Error ? e.message : e);
                });
            } catch (e) {
                console.warn('[SkillEvalScheduler] import failed:', e instanceof Error ? e.message : e);
            }
        }
    } catch { /* doctrine + eval are optional — sync must not fail because of them */ }
};

const countClosedTrades = (trades: LoggedTrade[]): number =>
    trades.filter(t => t.outcome === TradeOutcome.WIN || t.outcome === TradeOutcome.LOSS).length;

/**
 * Code-side skill enforcement so markdown skills actually move the signal,
 * not only the prompt. Confirmed avoid skills veto Long/Short; candidate
 * avoid skills cap High/Medium down to Low once they have at least
 * MIN_SAMPLE_FOR_VETO counted trades of evidence (zero-evidence candidates
 * never reach the model, so they must not reach the trade either).
 */
export type LensScopeForAnalysis = 'macro' | 'technical' | 'risk' | 'all';

/** Map a `ModeratorLens` / `AnalystRole` to its lensScope string. */
export const lensScopeFromRole = (role?: string): LensScopeForAnalysis => {
    if (!role) return 'all';
    const r = role.toLowerCase();
    if (r.includes('macro') || r.includes('volatility')) return 'macro';
    if (r.includes('technical') || r.includes('chart')) return 'technical';
    if (r.includes('risk') || r.includes('execution')) return 'risk';
    return 'all';
};

/** A skill is in-scope for an active lens when its lensScope is 'all' or
 *  matches the active lens. When no active lens is provided, the filter
 *  is permissive (legacy call sites that don't pass an active lens should
 *  keep seeing the same skills as before — the lens filter is opt-in). */
export const skillInScopeForLens = (m: SkillMeta, activeLens?: string): boolean => {
    if (!activeLens) return true;
    const scope = m.lensScope ?? 'all';
    if (scope === 'all') return true;
    return scope === lensScopeFromRole(activeLens);
};

export const applyNotebookSkillsToAnalysis = <T extends {
    coinName?: string;
    direction?: string;
    confidence?: string;
    probability?: number;
    detectedPatternFamily?: string;
    marketConditions?: { pattern?: string };
    originalConfidence?: string;
    riskVeto?: string;
    validationWarnings?: string[];
}>(analysis: T, options?: { regime?: string; activeLens?: string; username?: string }): T => {
    const setup = {
        coin: analysis.coinName,
        direction: analysis.direction,
        family: analysis.detectedPatternFamily,
        pattern: analysis.marketConditions?.pattern,
        // Regime-conditional enforcement: the live hybrid regime
        // activates the strict matcher's direction+regime lane and feeds the
        // ranking overlap. Absent ⇒ same behavior as before (no new lane).
        ...(options?.regime ? { regime: options.regime } : {}),
    };
    // Code-side enforcement now honors the same invocation
    // controls as prompt injection — `audience: moderator` skills no longer
    // veto the analyst card, and matches are ranked (status × overlap ×
    // freshness) instead of taken in file order.
    // Enforcement uses the STRICT matcher — a direction-only
    // match no longer vetoes every coin.
    const ranked = getMemoryFiles().files
        .map(enabledSkillMeta)
        .filter((m): m is SkillMeta => Boolean(m && skillStrictlyMatchesSetup(m, setup)))
        .filter(m => (m.audience ?? 'all') !== 'moderator')
        // Phase 3: lens-scope filter — a 'risk'-scoped skill is dropped
        // when the active lens is the macro seat, and vice versa. Default
        // 'all' skills still pass through unchanged.
        .filter(m => skillInScopeForLens(m, options?.activeLens))
        .map(m => ({
            m,
            score: (m.status === 'confirmed' ? 2 : 1)
                * dimsOverlapCount(m, setup)
                * evidenceFreshnessFactor(m),
        }))
        .sort((a, b) => b.score - a.score || (b.m.wins + b.m.losses) - (a.m.wins + a.m.losses))
        .map(x => x.m);
    if (ranked.length === 0) return analysis;

    const next = { ...analysis };
    const warn = (note: string): void => {
        // Warnings ONLY — validationWarnings is display-safe. Writing
        // into riskVeto made classifyAvoidBasis report a mere size-down as
        // a HARD blocker in the WhyAvoidPanel.
        next.validationWarnings = [...(next.validationWarnings ?? []), note];
    };
    // Enforcement telemetry: code-side enforcement is a decision the harness
    // made, but without a record the enforced skill gets no attribution —
    // applySkillEvidence cannot tell it shaped the trade. Log it like a real
    // injection (skills/<file> path) so attribution, lift and the dashboard
    // see it. Only when a username is supplied: tests and synthetic paths
    // stay silent unless they opt in.
    const recordEnforcement = (metas: SkillMeta[]): void => {
        if (!options?.username || metas.length === 0) return;
        const username = options.username;
        const sources = metas.map(m => ({
            path: `skills/${skillFileNameFor(m) ?? fileNameFromMeta(m)}`,
            kind: 'skill',
        }));
        void recordMemoryInjection(username, {
            stage: 'verdict',
            audience: 'moderator',
            coin: analysis.coinName,
            sources,
        }).catch(() => { /* telemetry is best-effort */ });
    };

    const avoidConfirmed = ranked.find(m => m.kind === 'avoid' && m.status === 'confirmed');
    if (avoidConfirmed && (next.direction === 'Long' || next.direction === 'Short')) {
        next.originalConfidence = next.originalConfidence ?? next.confidence;
        next.confidence = 'Avoid';
        next.direction = 'Neutral';
        if (typeof next.probability === 'number') next.probability = Math.min(next.probability, 15);
        const vetoNote = `NOTEBOOK SKILL VETO: ${titleFromMeta(avoidConfirmed)} — IF ${avoidConfirmed.ifCondition || avoidConfirmed.body.replace(/\s+/g, ' ').slice(0, 120)}`;
        warn(vetoNote);
        // Hard vetoes DO belong in riskVeto — this path genuinely blocks.
        next.riskVeto = [next.riskVeto, vetoNote].filter(Boolean).join(' ');
        recordEnforcement([avoidConfirmed]);
        return next;
    }

    const avoidCandidate = ranked.find(m => m.kind === 'avoid' && m.status === 'candidate'
        && (m.wins + m.losses) >= MIN_SAMPLE_FOR_VETO);
    if (avoidCandidate && (next.direction === 'Long' || next.direction === 'Short')) {
        next.originalConfidence = next.originalConfidence ?? next.confidence;
        if (next.confidence === 'High' || next.confidence === 'Medium') next.confidence = 'Low';
        // Candidate caps stay a WARNING: the setup remains tradeable at
        // reduced size — not a hard avoidance.
        warn(`NOTEBOOK SKILL: candidate avoid ${titleFromMeta(avoidCandidate)} — size down until the cluster confirms or retires.`);
        recordEnforcement([avoidCandidate]);
        return next;
    }

    const repeat = ranked.find(m => m.kind === 'repeat' && m.status === 'confirmed');
    if (repeat) {
        warn(`NOTEBOOK SKILL: confirmed repeat ${titleFromMeta(repeat)} — follow the procedure in skills, do not invent a new tape.`);
        recordEnforcement([repeat]);
    }
    return next;
};

export const listAppliedSkills = (
    analysis: { coinName?: string; direction?: string; detectedPatternFamily?: string; marketConditions?: { pattern?: string } },
    options?: { regime?: string },
): Array<{ title: string; kind: SkillKind; status: SkillStatus; wins: number; losses: number; hitRate: number | null; procedure?: string }> => {
    const setup = {
        coin: analysis.coinName,
        direction: analysis.direction,
        family: analysis.detectedPatternFamily,
        pattern: analysis.marketConditions?.pattern,
        ...(options?.regime ? { regime: options.regime } : {}),
    };
    return getMemoryFiles().files
        .map(enabledSkillMeta)
        .filter((m): m is SkillMeta => Boolean(m && skillMatchesSetup(m, setup)))
        .map(m => ({
            title: titleFromMeta(m),
            kind: m.kind,
            status: m.status,
            wins: m.wins,
            losses: m.losses,
            hitRate: skillHitRate(m.wins, m.losses),
            procedure: m.thenAction || m.ifCondition,
        }));
};

export const confirmedAvoidForSetup = (
    setup: { coin?: string; direction?: string; family?: string; pattern?: string; regime?: string },
): SkillMeta | null => {
    // Strict matching — this result drives the moderator's
    // skip_to_verdict veto, so a "BTC long" avoid must never HALT an ETH
    // long just because the direction matches.
    const matches = getMemoryFiles().files
        .map(enabledSkillMeta)
        .filter((m): m is SkillMeta => Boolean(m && skillStrictlyMatchesSetup(m, setup)));
    return matches.find(m => m.kind === 'avoid' && m.status === 'confirmed') ?? null;
};

/**
 * The ACTUAL file name of the skill a parsed meta came from. Ledgers that
 * key skills by name (veto falsification) must use this, not a slug derived
 * from the title — title-derived slugs drift from fileNameFromMeta's
 * [coin, direction, family, kind] ordering and would never match.
 */
export const skillFileNameFor = (meta: SkillMeta): string | null => {
    for (const file of getMemoryFiles().files.filter(isSkillFile)) {
        const m = parseSkillMarkdown(file.content);
        if (!m) continue;
        if (
            m.kind === meta.kind
            && (m.coin ?? '') === (meta.coin ?? '')
            && (m.direction ?? '') === (meta.direction ?? '')
            && (m.family ?? '') === (meta.family ?? '')
            && (m.ifCondition ?? '') === (meta.ifCondition ?? '')
            && (m.thenAction ?? '') === (meta.thenAction ?? '')
        ) {
            return file.name;
        }
    }
    return null;
};

// ─── Skill effectiveness review ─────────────────────────────────────────────
// Grades every skill on its realized W/L record and recommends an action.
// This closes the loop: skills are enforced in code (applyNotebookSkillsTo-
// Analysis), so their enforcement history must feed back into their status.

// ─── Applying review recommendations ────────────────────────────────────────

const applyReviewRecommendationUnlocked = async (
    fileId: string,
    recommendation: 'promote' | 'demote' | 'retire',
    username: string,
): Promise<boolean> => {
    const file = getMemoryFiles().files.find(f => f.id === fileId);
    const meta = file ? parseSkillMarkdown(file.content) : null;
    if (!file || !meta || meta.status === 'retired') return false;
    // Route through the temporal ledger so dashboard actions
    // stay visible to skillStatusAt replay queries — a manual promote/demote
    // used to be invisible to the audit trail.
    stampStatusTransition(meta, recommendation === 'promote'
        ? 'confirmed'
        : recommendation === 'demote' ? 'candidate' : 'retired', `manual-review:${recommendation}`);
    meta.status = recommendation === 'promote'
        ? 'confirmed'
        : recommendation === 'demote' ? 'candidate' : 'retired';
    meta.modifiedAt = new Date().toISOString();
    await updateMemoryFileUnlocked(fileId, {
        content: serializeSkill(meta, titleFromMeta(meta)),
        enabled: meta.status !== 'retired',
    }, username);
    return true;
};

/**
 * User-applied review action from the dashboard. Evidence keeps the final
 * say — the next applySkillEvidence pass re-derives status from counts, so a
 * manual promote of a stats-weak skill reverts unless outcomes back it up.
 */
export const applyReviewRecommendation = (
    fileId: string,
    recommendation: 'promote' | 'demote' | 'retire',
    username: string,
): Promise<boolean> =>
    withNotebookWriteLock(() => applyReviewRecommendationUnlocked(fileId, recommendation, username));

export interface SkillEffectiveness {
    fileId: string;
    title: string;
    kind: SkillKind;
    status: SkillStatus;
    wins: number;
    losses: number;
    hitRate: number | null;
    consecutiveLosses: number;
    /** What the loop should do next with this skill. */
    recommendation: 'keep' | 'watch' | 'refine' | 'demote' | 'retire' | 'promote';
    rationale: string;
    /** Causal A/B verdict from the automated eval (when one exists). */
    evalVerdict?: SkillMeta['evalVerdict'];
    /** Causal before/after win-rate verdict (when computable). */
    liftVerdict?: 'positive' | 'neutral' | 'negative' | 'insufficient-data';
}

export interface SkillEffectivenessReviewOptions {
    /** Per-skill lift results (MemoryProvenanceService.computeAllSkillLifts), keyed by fileId. */
    liftByFileId?: Record<string, { lift: number | null; verdict: 'positive' | 'neutral' | 'negative' | 'insufficient-data' }>;
    /** Notebook file names ACTUALLY injected since tracking began (MemoryInjectionService). When provided, never-injected skills get an attribution caveat. */
    injectedFileNames?: Set<string>;
}

/**
 * Correlation (W/L counts) decides the base recommendation; causal signals —
 * the automated A/B eval and post-vs-pre lift — override it, because a skill
 * that correlates with wins but causes losses is worse than no skill at all.
 */
export const reviewSkillEffectiveness = (opts: SkillEffectivenessReviewOptions = {}): SkillEffectiveness[] => {
    return getMemoryFiles().files
        .map(file => {
            const meta = enabledSkillMeta(file);
            if (!meta) return null;
            const sample = meta.wins + meta.losses;
            const hitRate = skillHitRate(meta.wins, meta.losses);
            const title = titleFromMeta(meta);
            const lift = opts.liftByFileId?.[file.id];

            let recommendation: SkillEffectiveness['recommendation'] = 'keep';
            let rationale: string;

            if (sample === 0) {
                rationale = 'No closed-trade evidence yet — candidate stays unenforced until it earns a record.';
                recommendation = 'watch';
            } else if (meta.status === 'retired') {
                rationale = `Retired at ${meta.wins}W/${meta.losses}L — kept for the record, not enforced.`;
                recommendation = 'retire';
            } else if (meta.consecutiveLosses >= REFINE_AFTER_CONSECUTIVE_LOSSES && meta.status === 'confirmed') {
                rationale = `${meta.consecutiveLosses} straight losses — trigger/procedure needs an LLM refinement pass.`;
                recommendation = 'refine';
            } else if (sample >= MIN_SAMPLE_RETIRE && meta.kind === 'repeat' && (hitRate ?? 100) < 40) {
                rationale = `Repeat skill winning only ${hitRate}% over ${sample} trades — below the 40% retire bar.`;
                recommendation = 'retire';
            } else if (sample >= MIN_SAMPLE_RETIRE && meta.kind === 'avoid' && (hitRate ?? 0) > 60) {
                rationale = `Avoid skill losing ${hitRate}% of matched trades — the setup is actually tradeable; retire the veto.`;
                recommendation = 'retire';
            } else if (meta.status === 'candidate' && sample >= MIN_SAMPLE_CONFIRMED && (hitRate ?? 0) >= 60) {
                rationale = `Candidate holding ${hitRate}% over ${sample} trades — evidence supports confirming.`;
                recommendation = 'promote';
            } else if (meta.status === 'confirmed' && (hitRate ?? 100) < 50 && sample >= MIN_SAMPLE_CONFIRMED) {
                rationale = `Confirmed but under 50% (${meta.wins}W/${meta.losses}L) — consider demoting to candidate until it recovers.`;
                recommendation = 'demote';
            } else if ((hitRate ?? 0) < 55) {
                rationale = `Hit rate ${hitRate}% over ${sample} trades — keep, monitor next outcomes.`;
                recommendation = 'watch';
            } else {
                rationale = `Healthy at ${hitRate}% (${meta.wins}W/${meta.losses}L).`;
            }

            // ── Causal overrides (injection-causation outranks co-occurrence) ──
            const freshHurts = meta.evalVerdict === 'hurts' && evalDemotionActive(meta);
            if (freshHurts && (recommendation === 'keep' || recommendation === 'promote')) {
                recommendation = meta.status === 'confirmed' ? 'demote' : 'watch';
                rationale = `Automated A/B eval says the skill HURTS decisions${meta.evalDetail ? ` (${meta.evalDetail} flips misaligned)` : ''} — the causal signal outranks the ${hitRate ?? '?'}% outcome correlation.`;
            }
            if (lift?.verdict === 'negative' && (recommendation === 'keep' || recommendation === 'promote')) {
                recommendation = sample >= MIN_SAMPLE_CONFIRMED ? 'demote' : 'watch';
                rationale = `Post-influence win rate is ${lift.lift != null ? Math.round(Math.abs(lift.lift) * 100) : '?'}pp BELOW the pre-skill baseline — setups got worse once this skill started injecting.`;
            }
            if (!freshHurts && lift?.verdict === 'positive' && recommendation === 'watch' && sample > 0) {
                recommendation = 'keep';
                rationale = `${rationale} Lift +${lift.lift != null ? Math.round(lift.lift * 100) : '?'}pp over baseline supports it.`;
            }
            // Attribution caveat: evidence earned purely by setup match, when
            // we know the skill was never actually injected into a prompt.
            if (opts.injectedFileNames && !opts.injectedFileNames.has(file.name)
                && sample > 0 && recommendation === 'promote') {
                recommendation = 'watch';
                rationale = `${rationale} Caveat: never actually injected into a prompt since tracking began — its record is co-occurrence, not influence.`;
            }

            return {
                fileId: file.id,
                title,
                kind: meta.kind,
                status: meta.status,
                wins: Math.round(meta.wins),
                losses: Math.round(meta.losses),
                hitRate,
                consecutiveLosses: meta.consecutiveLosses,
                recommendation,
                rationale,
                ...(meta.evalVerdict ? { evalVerdict: meta.evalVerdict } : {}),
                ...(lift ? { liftVerdict: lift.verdict } : {}),
            };
        })
        .filter((s): s is SkillEffectiveness => s !== null)
        .sort((a, b) => (a.hitRate ?? 2) - (b.hitRate ?? 2)); // weakest first
};
