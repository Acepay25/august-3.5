/**
 * SkillEvalService — with-skill vs without-skill A/B evaluation
 * (inspired by Claude Code's skill-creator evals).
 *
 * Question answered per skill: does INJECTING this skill actually change the
 * model's decision on setups it matches — and is the change directionally
 * consistent with the skill's intent?
 *
 * Method: for each historical trade the skill matches, run TWO fresh analyses —
 * one with the skill injected (temporarily force-enabled) and one suppressed —
 * using the SAME provider config. Compare confidence + direction deltas.
 * Deterministic scoring, no LLM grading needed: we measure DECISION FLIPS,
 * not prose quality.
 *
 * Cost model: 2 × N provider calls (N = matched trades, capped). This is a
 * deliberate, user-triggered benchmark — never run automatically mid-loop.
 */

import type { LoggedTrade } from '../../types';
import { TradeOutcome } from '../../types';
import { ProviderConfig } from '../../types/provider';
import {
    getMemoryFiles,
    updateMemoryFile,
} from './MemoryFilesService';
import {
    parseSkillMarkdown,
    serializeSkill,
    titleFromMeta,
    skillMatchesSetup,
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

export type SkillAnalysisRunner = (
    trade: LoggedTrade,
    options: { skillEnabled: boolean },
) => Promise<SkillEvalAnalysisOutput>;

const outcomeOf = (t: LoggedTrade): SkillEvalCase['actualOutcome'] =>
    t.outcome === TradeOutcome.WIN ? 'WIN' : 'LOSS';

/** Pick the historical trades this skill applies to (newest first, capped). */
export const selectEvalTrades = (meta: SkillMeta, trades: LoggedTrade[]): LoggedTrade[] => {
    const setup = {
        coin: meta.coin,
        direction: meta.direction === 'Long' || meta.direction === 'Short' ? meta.direction : undefined,
        family: meta.family,
        pattern: undefined,
    };
    return trades
        .filter(t => (t.outcome === TradeOutcome.WIN || t.outcome === TradeOutcome.LOSS) && t.analysis)
        .filter(t => skillMatchesSetup(meta, {
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
 * analysis turn against a trade; the service toggles skill visibility around
 * it so the pipeline's normal injection path does the rest.
 */
export const evaluateSkill = async (
    fileId: string,
    username: string,
    trades: LoggedTrade[],
    config: ProviderConfig,
    runner: SkillAnalysisRunner,
): Promise<SkillEvalResult> => {
    void config; // runner captures the provider config; kept in signature for callers/diagnostics.
    const file = getMemoryFiles().files.find(f => f.id === fileId);
    const base = file ? parseSkillMarkdown(file.content) : null;
    if (!file || !base) {
        return emptyResult(fileId, file?.name ?? fileId, 'skill not found');
    }

    const evalTrades = selectEvalTrades(base, trades);
    if (evalTrades.length === 0) {
        return emptyResult(fileId, file.name, 'no matching historical trades');
    }

    const pairs: SkillEvalPair[] = [];
    let flips = 0;
    let alignedFlips = 0;
    let misalignedFlips = 0;

    // Temporarily suppress the skill for baseline runs (restore in finally).
    const originallyEnabled = file.enabled;
    try {
        await updateMemoryFile(fileId, { enabled: false }, username);
        for (const t of evalTrades) {
            const baseline = await safeRun(runner, t, false);
            await updateMemoryFile(fileId, { enabled: originallyEnabled }, username);
            const withSkill = await safeRun(runner, t, true);
            await updateMemoryFile(fileId, { enabled: false }, username);

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
    } catch (e) {
        return {
            ...emptyResult(fileId, file.name, e instanceof Error ? e.message : String(e)),
            cases: pairs,
            flips, alignedFlips, misalignedFlips,
        };
    } finally {
        await updateMemoryFile(fileId, { enabled: originallyEnabled }, username).catch(() => undefined);
    }

    let verdict: SkillEvalResult['verdict'] = 'inconclusive';
    if (flips > 0) {
        if (misalignedFlips === 0 && alignedFlips > 0) verdict = 'helps';
        else if (alignedFlips > misalignedFlips) verdict = 'helps';
        else if (misalignedFlips > alignedFlips) verdict = 'hurts';
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
): Promise<SkillEvalAnalysisOutput> => {
    try {
        return await runner(trade, { skillEnabled });
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
export const recordEvalVerdict = async (
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
    await updateMemoryFile(fileId, {
        content: serializeSkill(meta, titleFromMeta(meta)),
        enabled: meta.status !== 'retired',
    }, username);
};
