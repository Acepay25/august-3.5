/**
 * SkillEvalScheduler — fully-automated skill benchmarking.
 *
 * The harness runs evals ITSELF; the user never clicks anything. After every
 * trade-log sync, one due skill (if any) is evaluated with a cost-capped A/B
 * run against the user's configured provider. The verdict is stamped into the
 * skill frontmatter and — when it says 'hurts' — deriveStatus demotes a
 * confirmed skill back to candidate on the next evidence pass.
 *
 * Due policy (all must hold):
 *   • skill is enabled, confirmed, never retired
 *   • at least EVAL_MIN_TRADES_BETWEEN closed trades since its last eval
 *   • not evaluated in the last EVAL_COOLDOWN_HOURS
 *   • enough matching historical trades exist to make a run meaningful
 *
 * Cost model: ONE skill per sync, 2 × ≤SKILL_EVAL_MAX_TRADES calls. With a
 * handful of skills this fires rarely; heavy users can tune via constants.
 *
 * Best-effort by design: any failure defers silently and retries on a later
 * sync. Never blocks the pipeline.
 */

import type { LoggedTrade } from '../../types';
import { TradeOutcome } from '../../types';
import { ProviderConfig } from '../../types/provider';
import { getMemoryFiles } from './MemoryFilesService';
import {
    parseSkillMarkdown,
    isSkillFile,
    skillBody,
    skillMatchesSetup,
    type SkillMeta,
} from './SkillMemoryService';
import {
    evaluateSkill,
    recordEvalVerdict,
    selectEvalTrades,
    SKILL_EVAL_MAX_TRADES,
} from './SkillEvalService';
import { getMemoryFilesContext, SKILL_BLOCK_MAX } from './MemoryRetrievalService';

/** Minimum closed trades since a skill's last eval before it becomes due again. */
export const EVAL_MIN_TRADES_BETWEEN = 10;
/** Cooldown between eval runs (any skill) — hours. */
export const EVAL_COOLDOWN_HOURS = 24;
/** Minimum matched historical trades required to bother evaluating. */
export const EVAL_MIN_MATCHED_TRADES = 3;
/**
 * Hard cap on automated evals per session. Each run costs up to
 * 2 × SKILL_EVAL_MAX_TRADES provider calls; this bounds worst-case spend.
 */
export const MAX_AUTO_EVALS_PER_SESSION = 2;

let sessionEvalsRun = 0;

export const resetAutoEvalBudget = (): void => {
    sessionEvalsRun = 0;
};

/** Test/diagnostic hook: force the per-session eval counter. */
export const setSessionEvalsRun = (n: number): void => {
    sessionEvalsRun = n;
};

export interface AutoEvalRunnerParams {
    /** The analysis callback used for both arms of each A/B pair. */
    runner: import('./SkillEvalService').SkillAnalysisRunner;
    config: ProviderConfig;
    username: string;
}

/** Is this skill due for an automated eval? */
export const isSkillDueForEval = (
    meta: SkillMeta,
    trades: LoggedTrade[],
): boolean => {
    // Confirmed skills are audited routinely. A skill benched by a 'hurts'
    // eval also becomes due again once the gates below pass, so a fresh eval
    // can overturn the demotion.
    const auditable = meta.status === 'confirmed'
        || (meta.evalVerdict === 'hurts' && meta.status === 'candidate');
    if (!auditable) return false;

    // Enough matching history?
    const matched = selectEvalTrades(meta, trades);
    if (matched.length < Math.min(EVAL_MIN_MATCHED_TRADES, SKILL_EVAL_MAX_TRADES)) return false;

    // Trades-since-last-eval gate.
    if (meta.lastEvalAt) {
        const t0 = Date.parse(meta.lastEvalAt);
        if (Number.isFinite(t0)) {
            const since = trades.filter(t =>
                (t.outcome === TradeOutcome.WIN || t.outcome === TradeOutcome.LOSS)
                && Date.parse(t.timestamp || '') > t0
            ).length;
            if (since < EVAL_MIN_TRADES_BETWEEN) return false;
            // Fresh-cooldown gate.
            const hours = (Date.now() - t0) / 3_600_000;
            if (hours < EVAL_COOLDOWN_HOURS) return false;
        }
    }
    return true;
};

/**
 * Pick the single most-due confirmed skill: oldest lastEvalAt first (never
 * evaluated sorts first), then largest sample size.
 */
export const pickDueSkill = (
    trades: LoggedTrade[],
): { fileId: string; name: string } | null => {
    if (sessionEvalsRun >= MAX_AUTO_EVALS_PER_SESSION) return null;
    let best: { fileId: string; name: string; key: number } | null = null;
    for (const file of getMemoryFiles().files) {
        if (!file.enabled || !isSkillFile(file)) continue;
        const meta = parseSkillMarkdown(file.content);
        if (!meta || !isSkillDueForEval(meta, trades)) continue;
        // Rank: never-evaluated first, then oldest eval, then biggest sample.
        const t0 = meta.lastEvalAt ? Date.parse(meta.lastEvalAt) : 0;
        const ageKey = Number.isFinite(t0) ? t0 : -1;
        const key = ageKey * 1000 + (meta.wins + meta.losses);
        if (!best || key < best.key) best = { fileId: file.id, name: file.name, key };
    }
    return best ? { fileId: best.fileId, name: best.name } : null;
};

/**
 * Run one scheduled auto-eval end-to-end: evaluate, stamp the verdict, log.
 * Called from the trade-sync path after syncClosedTradeToNotebook completes.
 */
export const runDueSkillEval = async (
    trades: LoggedTrade[],
    username: string,
    params: AutoEvalRunnerParams,
): Promise<{ ran: boolean; verdict?: string; skill?: string }> => {
    try {
        const due = pickDueSkill(trades);
        if (!due) return { ran: false };

        const result = await evaluateSkill(due.fileId, username, trades, params.config, params.runner);
        await recordEvalVerdict(due.fileId, result, username);
        sessionEvalsRun += 1;

        console.log(
            `[SkillEvalScheduler] ${due.name}: ${result.verdict}` +
            ` (${result.alignedFlips}/${result.flips} aligned flips)` +
            (result.error ? ` [${result.error}]` : '')
        );
        return { ran: true, verdict: result.verdict, skill: due.name };
    } catch (e) {
        console.warn('[SkillEvalScheduler] auto-eval deferred:', e instanceof Error ? e.message : e);
        return { ran: false };
    }
};

/** Exposed for tests / diagnostics. */
export const findMatchingSetupForSkill = (meta: SkillMeta, trade: LoggedTrade): boolean =>
    skillMatchesSetup(meta, {
        coin: trade.analysis?.coinName,
        direction: trade.analysis?.direction === 'Long' || trade.analysis?.direction === 'Short'
            ? trade.analysis.direction
            : undefined,
        family: trade.analysis?.detectedPatternFamily,
    });


// ─── Default runner (harness-provided, zero user setup) ─────────────────────

/**
 * Build a SkillAnalysisRunner from the user's own provider + prompt pipeline:
 * re-analyzes the stored trade context with and without the REAL skill body
 * injected (same formatting as verdict-stage retrieval: header, evidence
 * freshness, provenance, ${SYMBOL}-substituted markdown). Images are omitted
 * — historical trades rarely keep chart screenshots, and the decision-
 * relevant context is textual.
 */
export const buildDefaultRunner = (
    config: ProviderConfig,
    username?: string,
): import('./SkillEvalService').SkillAnalysisRunner => {
    void config; // captured lazily per call below
    return async (trade, { skillEnabled, skill }) => {
        // Lazy imports break the cycle: GenericAnalysisService → … → this file.
        const { analyzeTradingView } = await import('../providers/GenericAnalysisService');
        const { resolveMemoryConfig } = await import('./MemoryModelService');
        const {
            substituteSkillContext,
            evidenceFreshness,
            getMemoryFilesContext,
        } = await import('./MemoryRetrievalService');

        const cfg = await resolveMemoryConfig(username);
        if (!cfg) return {};

        const a = trade.analysis ?? {};
        // BOTH arms are the PRODUCTION context —
        // doctrine + budgeted notebook slices. The treatment arm appends the
        // skill body; the baseline arm builds the same context with
        // excludeSkillName so the skill under test is genuinely absent (eval
        // trades match the skill by design, so an unfiltered baseline still
        // contained it). recordInjections:false keeps synthetic arms out of
        // the attribution telemetry.
        const query = {
            coin: a.coinName,
            direction: a.direction === 'Long' || a.direction === 'Short' ? a.direction : undefined,
            family: a.detectedPatternFamily,
            regime: trade.marketRegime,
        };
        const productionContext = getMemoryFilesContext(query, [], 'analyst', 'opening', {
            ...(skill ? { excludeSkillName: skill.name } : {}),
            recordInjections: false,
            contextWindowTokens: cfg.contextWindowTokens,
        });
        let skillNote: string;
        if (skillEnabled && skill) {
            // The treatment arm injects the PROCEDURE, never the raw file:
            // the frontmatter (25-35 YAML lines on real skills) used to eat
            // the whole budget and truncate the procedure — an arm
            // contaminated by bookkeeping YAML is not what production
            // injection ever sends, so the A/B verdict measured the wrong
            // treatment. Same skillBody() rule as the retrieval slices, and
            // now the SAME cap: this arm used to carry a private 700-char
            // budget while verdict-stage injection sent 400, so the eval
            // judged a bigger treatment than the trader ever received.
            const body = substituteSkillContext(skillBody(skill.content), query);
            const capped = body.length > SKILL_BLOCK_MAX ? `${body.slice(0, SKILL_BLOCK_MAX).trimEnd()}\n…` : body;
            // Same provenance source as the verdict slice: the monotonic
            // counter, not the tail-20 id list.
            const evidenceTotal = skill.meta.evidenceCount ?? skill.meta.tradeIds.length;
            const provenance = evidenceTotal > 0
                ? `learned from ${evidenceTotal} logged trade(s)`
                : '';
            skillNote = [
                'YOUR NOTEBOOK MEMORY for this exact setup (weigh it heavily):',
                `[skills/${skill.name} · ${skill.meta.status} · ${skill.meta.wins}W/${skill.meta.losses}L]`,
                [evidenceFreshness(skill.meta), provenance].filter(Boolean).join(' · '),
                capped,
            ].join('\n');
        } else {
            skillNote = productionContext || 'Run from your general expertise only.';
        }
        // ── PARITY: the CODE-CHECKED SKILL TRIGGERS note ──
        // Production evaluates each skill's own code trigger and hands every
        // seat this note before the debate starts (useAnalysisPipeline →
        // evaluateSkillPredicates), and a live AVOID trigger also caps the
        // verdict — the cap's sentence rides inside the note itself. An eval
        // arm without it would measure an intervention production never
        // applies: the eval's whole job is to judge what the trader actually
        // gets. Same replay rules as a backtest run — judged only on bars
        // that had CLOSED by the trade's own timestamp — and deliberately no
        // runId, so the ε-holdout can never blank out measurement. The note
        // goes to BOTH arms: it is shared context, not the treatment.
        let predicateNote = '';
        try {
            const { evaluateSkillPredicates } = await import('./skillPredicateGate');
            const rawCoin = (a.coinName ?? '').trim();
            const asOfMs = Date.parse(trade.timestamp ?? '');
            if (rawCoin && Number.isFinite(asOfMs)) {
                const gate = await evaluateSkillPredicates({
                    coin: /USDT?$/i.test(rawCoin) ? rawCoin.toUpperCase() : `${rawCoin.toUpperCase()}USDT`,
                    direction: a.direction === 'Long' || a.direction === 'Short' ? a.direction : undefined,
                    asOfMs,
                });
                predicateNote = gate.note;
            }
        } catch {
            // Best-effort, exactly as production: no tape ⇒ no note, arms
            // stand as they were before predicates existed.
        }

        const promptParts = [
            `Analyze this ${a.coinName ?? 'crypto'} ${a.direction ?? ''} setup as of ${trade.timestamp ?? 'the logged time'}.`,
            `Entry ${a.entryPoints?.[0]?.price ?? 'n/a'}, stop ${a.stopLoss ?? 'n/a'}, target ${a.takeProfit?.[0]?.price ?? 'n/a'}.`,
        ];
        if (productionContext && skillEnabled && skill) promptParts.push(productionContext);
        promptParts.push(skillNote);
        if (predicateNote) promptParts.push(predicateNote);
        promptParts.push('Respond with your confidence level (High/Medium/Low/Avoid), direction (Long/Short/Neutral) and a one-paragraph rationale.');
        const prompt = promptParts.join(' ');

        try {
            const { analysis } = await analyzeTradingView(cfg, {
                prompt,
                images: [],
                imageSummaries: [],
                chatHistory: [],
                finalTradeSummary: null,
                recentInsights: null,
                activeFrameworks: [],
                deepenAnalysis: false,
                temperature: 0.2,
            });
            return {
                confidence: typeof analysis.confidence === 'string' ? analysis.confidence : undefined,
                direction: typeof analysis.direction === 'string' ? analysis.direction : undefined,
                review: analysis.verdictReview ? true : undefined,
            };
        } catch (e) {
            console.warn('[SkillEvalScheduler] runner call failed:', e instanceof Error ? e.message : e);
            return {};
        }
    };
};

/**
 * Convenience entry used by the trade-sync path: builds the default runner
 * and runs at most one due eval.
 */
export const runDueSkillEvalWithDefaultRunner = async (
    trades: LoggedTrade[],
    username: string,
    config: ProviderConfig,
): Promise<{ ran: boolean; verdict?: string; skill?: string }> =>
    runDueSkillEval(trades, username, {
        runner: buildDefaultRunner(config, username),
        config,
        username,
    });
