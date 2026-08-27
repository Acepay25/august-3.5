/**
 * SkillEvalService — with-skill vs without-skill A/B evaluation.
 *
 * Question answered per skill: does INJECTING this skill actually change the
 * model's decision on setups it matches — and is the change directionally
 * consistent with the skill's intent?
 *
 * Method: for each historical trade the skill matches, run TWO fresh analyses —
 * one with the skill content handed to the runner and one without — using the
 * SAME provider config. Compare confidence + direction deltas. Deterministic
 * scoring, no LLM grading needed: we measure DECISION FLIPS, not prose quality.
 *
 * The service NEVER mutates the live notebook: both arms are expressed purely
 * through the runner's options, so concurrent analyses can't observe the skill
 * flapping on/off mid-benchmark.
 *
 * Cost model: 2 × N provider calls (N = matched trades, capped). This is a
 * deliberate, user-triggered benchmark — never run automatically mid-loop.
 */

import type { LoggedTrade } from '../../types';
import { TradeOutcome } from '../../types';
import { ProviderConfig } from '../../types/provider';
import {
    getMemoryFiles,
    updateMemoryFileUnlocked,
    withNotebookWriteLock,
} from './MemoryFilesService';
import {
    parseSkillMarkdown,
    serializeSkill,
    titleFromMeta,
    skillMatchesSetup,
    skillStrictlyMatchesSetup,
    stampStatusTransition,
    EVAL_DEMOTE_STREAK,
    MIN_SAMPLE_CONFIRMED,
    type SkillMeta,
} from './SkillMemoryService';

/** Max matched trades to evaluate per skill (cost cap). */
export const SKILL_EVAL_MAX_TRADES = 6;

export interface SkillEvalCase {
    tradeId: string;
    coin?: string;
    direction?: string;
    actualOutcome: 'WIN' | 'LOSS' | 'BREAKEVEN';
}

export interface SkillEvalPair {
    tradeId: string;
    /** Confidence WITHOUT the skill. */
    baselineConfidence?: string;
    /** Direction WITHOUT the skill. */
    baselineDirection?: string;
    /** Confidence WITH the skill. */
    withConfidence?: string;
    /** Direction WITH the skill. */
    withDirection?: string;
}

export interface SkillEvalResult {
    fileId: string;
    name: string;
    cases: SkillEvalPair[];
    /** Setups where injecting the skill changed confidence or direction. */
    flips: number;
    /** Flips that moved TOWARD what the skill wants (avoid → Neutral/Avoid on losers; repeat → higher confidence on winners). */
    alignedFlips: number;
    /** Flips that moved against the skill's intent. */
    misalignedFlips: number;
    verdict: 'helps' | 'mixed' | 'hurts' | 'inconclusive';
    /** Control-group baseline: settled win rate on matched setups
     *  where this skill was NOT injected (controlIds) — the real-world
     *  comparison for the A/B flip verdict. Absent when no control trades have
     *  a WIN/LOSS outcome yet. */
    controlBaseline?: { trades: number; wins: number; winRate: number };
    error?: string;
}

export interface SkillEvalAnalysisOutput {
    confidence?: string;
    direction?: string;
}

/** Everything a runner needs to render the WITH-skill arm itself. */
export interface SkillEvalSkillContext {
    /** Notebook file name, e.g. "btc-short-avoid.md". */
    name: string;
    /** Full stored markdown (frontmatter included). */
    content: string;
    meta: SkillMeta;
}

export type SkillAnalysisRunner = (
    trade: LoggedTrade,
    options: { skillEnabled: boolean; skill?: SkillEvalSkillContext },
) => Promise<SkillEvalAnalysisOutput>;

const outcomeOf = (t: LoggedTrade): SkillEvalCase['actualOutcome'] =>
    t.outcome === TradeOutcome.WIN ? 'WIN' : 'LOSS';

/** Pick the historical trades this skill applies to (newest first, capped).
 *  Uses the STRICT matcher — the audit must measure
 *  the same population production enforcement acts on (S1). Regime flows in
 *  from each trade's persisted `marketRegime` so a skill scoped to one
 *  regime is audited on that regime's trades only. */
export const selectEvalTrades = (meta: SkillMeta, trades: LoggedTrade[]): LoggedTrade[] => {
    return trades
        .filter(t => (t.outcome === TradeOutcome.WIN || t.outcome === TradeOutcome.LOSS) && t.analysis)
        .filter(t => skillStrictlyMatchesSetup(meta, {
            coin: t.analysis?.coinName,
            direction: t.analysis?.direction === 'Long' || t.analysis?.direction === 'Short'
                ? t.analysis.direction
                : undefined,
            family: t.analysis?.detectedPatternFamily,
            regime: t.marketRegime,
        }))
        .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''))
        .slice(0, SKILL_EVAL_MAX_TRADES);
};

const CONF_RANK: Record<string, number> = { Avoid: 0, Low: 1, Medium: 2, High: 3 };

/**
 * Is a flip from `from` to `to` aligned with an AVOID skill? Avoid skills want
 * confidence to DROP or direction to neutralize.
 */
const avoidAligned = (from?: string, to?: string): boolean | undefined => {
    if (!from || !to || from === to) return undefined;
    const f = CONF_RANK[from] ?? 1;
    const t2 = CONF_RANK[to] ?? 1;
    if (t2 < f) return true;   // confidence dropped
    if (t2 > f) return false;  // confidence rose
    return undefined;
};

/** REPEAT skills want confidence to RISE (or stay high) on their setups. */
const repeatAligned = (from?: string, to?: string): boolean | undefined => {
    if (!from || !to || from === to) return undefined;
    const f = CONF_RANK[from] ?? 1;
    const t2 = CONF_RANK[to] ?? 1;
    if (t2 > f) return true;
    if (t2 < f) return false;
    return undefined;
};

/**
 * Run the full eval for one skill file. The runner callback executes ONE
 * analysis turn against a trade; the WITH-skill arm receives the real skill
 * context so the runner decides how to inject it — no shared state involved.
 */
export const evaluateSkill = async (
    fileId: string,
    username: string,
    trades: LoggedTrade[],
    config: ProviderConfig,
    runner: SkillAnalysisRunner,
): Promise<SkillEvalResult> => {
    void config; // runner captures the provider config; kept in signature for callers/diagnostics.
    void username;
    const file = getMemoryFiles().files.find(f => f.id === fileId);
    const base = file ? parseSkillMarkdown(file.content) : null;
    if (!file || !base) {
        return emptyResult(fileId, file?.name ?? fileId, 'skill not found');
    }

    const evalTrades = selectEvalTrades(base, trades);
    if (evalTrades.length === 0) {
        return emptyResult(fileId, file.name, 'no matching historical trades');
    }

    const skill: SkillEvalSkillContext = { name: file.name, content: file.content, meta: base };
    const pairs: SkillEvalPair[] = [];
    let flips = 0;
    let alignedFlips = 0;
    let misalignedFlips = 0;

    for (const t of evalTrades) {
        const baseline = await safeRun(runner, t, false, skill);
        const withSkill = await safeRun(runner, t, true, skill);

        const pair: SkillEvalPair = {
            tradeId: t.id,
            baselineConfidence: baseline.confidence,
            baselineDirection: baseline.direction,
            withConfidence: withSkill.confidence,
            withDirection: withSkill.direction,
        };
        pairs.push(pair);

        const changed = baseline.confidence !== withSkill.confidence
            || baseline.direction !== withSkill.direction;
        if (!changed) continue;
        flips += 1;
        const aligned = base.kind === 'avoid'
            ? avoidAligned(baseline.confidence, withSkill.confidence)
                ?? (withSkill.direction !== baseline.direction ? withSkill.direction === 'Neutral' : undefined)
            : repeatAligned(baseline.confidence, withSkill.confidence)
                ?? (withSkill.direction !== baseline.direction ? baseline.direction === 'Neutral' : undefined);
        if (aligned === true) alignedFlips += 1;
        else if (aligned === false) misalignedFlips += 1;
    }

    let verdict: SkillEvalResult['verdict'] = 'inconclusive';
    // Helps/hurts need enough directional signal to trust.
    // On real samples (>2 pairs) a SINGLE flip is noise — one lucky or
    // unlucky completion used to demote confirmed skills. Tiny scripted
    // samples (1-2 pairs, engine tests) keep single-flip classification:
    // there the pair set IS the whole evidence, not a noisy draw from it.
    const directionalFlipsNeeded = evalTrades.length > 2 ? 2 : 1;
    if (flips > 0) {
        if (misalignedFlips === 0 && alignedFlips >= directionalFlipsNeeded) verdict = 'helps';
        else if (alignedFlips > misalignedFlips && alignedFlips >= directionalFlipsNeeded) verdict = 'helps';
        else if (misalignedFlips > alignedFlips && misalignedFlips >= directionalFlipsNeeded) verdict = 'hurts';
        else verdict = 'mixed';
    }

    // Control-group baseline: controlIds are matched setups where this skill
    // was NOT injected — the natural comparison arm the loop already records.
    // Their settled win rate tells us what the skill's setups did WITHOUT its
    // guidance, so the dashboard can weigh the A/B flip verdict against reality.
    const controlIdSet = new Set(base.controlIds ?? []);
    let controlTrades = 0;
    let controlWins = 0;
    for (const t of trades) {
        if (!controlIdSet.has(t.id)) continue;
        if (t.outcome !== TradeOutcome.WIN && t.outcome !== TradeOutcome.LOSS) continue;
        controlTrades += 1;
        if (t.outcome === TradeOutcome.WIN) controlWins += 1;
    }
    const controlBaseline = controlTrades > 0
        ? { trades: controlTrades, wins: controlWins, winRate: Math.round((controlWins / controlTrades) * 1000) / 1000 }
        : undefined;

    return {
        fileId,
        name: file.name,
        cases: pairs,
        flips,
        alignedFlips,
        misalignedFlips,
        verdict,
        controlBaseline,
    };
};

const safeRun = async (
    runner: SkillAnalysisRunner,
    trade: LoggedTrade,
    skillEnabled: boolean,
    skill: SkillEvalSkillContext,
): Promise<SkillEvalAnalysisOutput> => {
    try {
        return await runner(trade, { skillEnabled, skill });
    } catch {
        return {};
    }
};

const emptyResult = (fileId: string, name: string, error: string): SkillEvalResult => ({
    fileId,
    name,
    cases: [],
    flips: 0,
    alignedFlips: 0,
    misalignedFlips: 0,
    verdict: 'inconclusive',
    error,
});

/**
 * Persist an eval verdict into the skill frontmatter as `evalVerdict:` so the
 * dashboard and the effectiveness review can weigh it.
 *
 * Sequential-evidence gating: a single noisy A/B run must not
 * bench a confirmed skill. A 'hurts' verdict only DEMOTES when the same
 * verdict has now landed on consecutive runs (evalStreak >= 2); otherwise it
 * is recorded as evidence and the streak increments, with the previous
 * verdict's demotion left untouched. Any different verdict resets the
 * streak. 'helps' clears a lingering hurts demotion once its own streak
 * reaches 2 (rehabilitation by repeated confirmation). The bar itself is
 * EVAL_DEMOTE_STREAK, shared with SkillMemoryService so the deriveStatus
 * causal override cannot demote on a single run through the evidence path.
 */
const recordEvalVerdictUnlocked = async (
    fileId: string,
    result: Pick<SkillEvalResult, 'verdict' | 'flips' | 'alignedFlips'>,
    username: string,
): Promise<void> => {
    const file = getMemoryFiles().files.find(f => f.id === fileId);
    const meta = file ? parseSkillMarkdown(file.content) : null;
    if (!file || !meta) return;
    meta.modifiedAt = new Date().toISOString();
    const prevVerdict = meta.evalVerdict;
    const prevEvalAt = meta.lastEvalAt;
    meta.evalVerdict = result.verdict;
    meta.evalDetail = `${result.alignedFlips}/${result.flips}`;
    meta.lastEvalAt = new Date().toISOString();
    // Streak bookkeeping. A re-confirmation stamped AFTER the previous eval
    // (manual promote or evidence crossing the bar) breaks the chain: the
    // demotion gate must re-arm instead of firing on one legacy 'hurts'.
    const reconfirmedSinceLastEval = (() => {
        if (!prevEvalAt || !meta.history?.length) return false;
        const prevEval = Date.parse(prevEvalAt);
        if (!Number.isFinite(prevEval)) return false;
        const last = meta.history[meta.history.length - 1];
        const at = Date.parse(last.validFrom);
        return last.status === 'confirmed' && Number.isFinite(at) && at > prevEval;
    })();
    const continues = prevVerdict === result.verdict
        && (result.verdict === 'helps' || result.verdict === 'hurts')
        && !reconfirmedSinceLastEval;
    if (continues) {
        meta.evalStreak = (meta.evalStreak ?? 1) + 1;
    } else {
        meta.evalStreak = (result.verdict === 'helps' || result.verdict === 'hurts') ? 1 : undefined;
    }
    // Temporal ledger: an eval DEMOTION (streak reached) is exactly the kind
    // of belief change that must stay queryable for replay audits.
    if (
        result.verdict === 'hurts'
        && meta.status === 'confirmed'
        && (meta.evalStreak ?? 0) >= EVAL_DEMOTE_STREAK
    ) {
        stampStatusTransition(meta, 'candidate', `eval hurts ×${meta.evalStreak} (${meta.evalDetail})`);
        meta.status = 'candidate';
    }
    // Promotion by repeated confirmation. Two paths share the same gate
    // (two consecutive 'helps' runs on a candidate):
    //   • REHABILITATION — the candidate was demoted by evals. Restore it
    //     (and only one evals demoted — a candidate demoted by evidence decay
    //     or manual review is not ours to promote back). No sample gate: it
    //     was confirmed before, so it already proved its sample.
    //   • FRESH PROMOTION — a never-confirmed candidate earns its first
    //     promotion. This one IS sample-gated (MIN_SAMPLE_CONFIRMED) so a
    //     skill born yesterday cannot confirm on two lucky A/B runs.
    if (
        result.verdict === 'helps'
        && meta.status === 'candidate'
        && (meta.evalStreak ?? 0) >= EVAL_DEMOTE_STREAK
    ) {
        const last = meta.history?.[meta.history.length - 1];
        const isRehabilitation = last?.status === 'candidate' && /^eval hurts/i.test(last.reason ?? '');
        if (isRehabilitation) {
            stampStatusTransition(meta, 'confirmed', `eval helps ×${meta.evalStreak} (${meta.evalDetail})`);
            meta.status = 'confirmed';
        } else if (meta.wins + meta.losses >= MIN_SAMPLE_CONFIRMED) {
            stampStatusTransition(meta, 'confirmed', `eval helps ×${meta.evalStreak} (${meta.evalDetail}) — promotion`);
            meta.status = 'confirmed';
        }
    }
    await updateMemoryFileUnlocked(fileId, {
        content: serializeSkill(meta, titleFromMeta(meta)),
        enabled: meta.status !== 'retired',
    }, username);
};

/** Serialized public API — see withNotebookWriteLock in MemoryFilesService. */
export const recordEvalVerdict = (
    fileId: string,
    result: Pick<SkillEvalResult, 'verdict' | 'flips' | 'alignedFlips'>,
    username: string,
): Promise<void> =>
    withNotebookWriteLock(() => recordEvalVerdictUnlocked(fileId, result, username));
