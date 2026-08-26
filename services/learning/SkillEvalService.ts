/**
 * SkillEvalService — with-skill vs without-skill A/B evaluation
 * (inspired by Claude Code's skill-creator evals).
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
 *  Review fix (ROUND-39): uses the STRICT matcher — the audit must measure
 *  the same population production enforcement acts on (S1). */
export const selectEvalTrades = (meta: SkillMeta, trades: LoggedTrade[]): LoggedTrade[] => {
    return trades
        .filter(t => (t.outcome === TradeOutcome.WIN || t.outcome === TradeOutcome.LOSS) && t.analysis)
        .filter(t => skillStrictlyMatchesSetup(meta, {
            coin: t.analysis?.coinName,
            direction: t.analysis?.direction === 'Long' || t.analysis?.direction === 'Short'
                ? t.analysis.direction
                : undefined,
            family: t.analysis?.detectedPatternFamily,
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
    // S6 (ROUND-39): helps/hurts need enough directional signal to trust.
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
    return {
        fileId,
        name: file.name,
        cases: pairs,
        flips,
        alignedFlips,
        misalignedFlips,
        verdict,
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
    meta.evalVerdict = result.verdict;
    meta.evalDetail = `${result.alignedFlips}/${result.flips}`;
    meta.lastEvalAt = new Date().toISOString();
    meta.modifiedAt = meta.lastEvalAt;
    // Zep-style ledger (ROUND-34): an eval demotion is exactly the kind of
    // belief change that must stay queryable for replay audits.
    if (result.verdict === 'hurts' && meta.status === 'confirmed') {
        stampStatusTransition(meta, 'candidate', `eval hurts (${meta.evalDetail})`);
        meta.status = 'candidate';
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
