/**
 * severityInsights — R-severity and provider-attributed insight generation
 * (moved out of InsightExtractionService when the regex miner was deleted in
 * The store-unification batch: regex mining rewards fluent writing, not
 * correct writing, and the prompt-injection layer built on it was dead code).
 *
 * These generators write through the attributed-insight store API in
 * PatternMemorySynthesisService, which since persists to the trader
 * notebook (distilled/ memory files) — the notebook paths the plan asked the
 * post-mortem job to be re-pointed at.
 */

import { LoggedTrade, AttributedInsight } from '../../types';
import { AIProvider } from '../../types/enums';
import {
    addAttributedInsight,
    upsertAttributedInsight,
    loadAttributedInsights,
    markInsightUsed,
    calculateAggregatedStats,
    calculatePnlR,
    SetupContext,
} from './PatternMemorySynthesisService';
import { extractLessonFromPostMortem } from './MemoryFilesService';

/** Minimum insight text length to be considered valuable */
const MIN_INSIGHT_LENGTH = 20;

// ========================= R-SEVERITY INSIGHT GENERATOR =========================

/**
 * Severity thresholds (in R multiples). A loss has to bleed this much
 * before it generates a "this damage is severity, not frequency" insight.
 * Tuned conservatively so we don't pollute the insight store with
 * every minor loss — the point is to surface the *unusual* depth.
 */
const SEVERITY_DEEP_LOSS_R = -1.5;        // Single trade that bleeds at least this much
const SEVERITY_CUMULATIVE_R = -3.0;       // Cumulative R across recent similar trades
const SEVERITY_AVG_BLEEDER_R = -1.0;      // Average per-loss R for a "bleeder" pattern

export type SeverityInsightKind = 'deep_single_loss' | 'cumulative_bleed' | 'bleeder_avg';

export interface SeverityInsight {
    /** Synthetic insight id derived from trade id + kind for idempotency. */
    id: string;
    tradeId: string;
    kind: SeverityInsightKind;
    pnlR: number;
    text: string;
    /** Structured context used for retrieval / scope. */
    context: {
        coin?: string;
        pattern?: string;
        family?: string;
        direction?: 'Long' | 'Short';
        regime?: string;
    };
    createdAt: string;
}

/**
 * Build the severity-insight text for a single loss. The text is concrete
 * (specific R value, specific damage framing) so the moderator prompt can
 * quote it without the model having to infer magnitude.
 */
function buildSeverityInsightText(
    pnlR: number,
    kind: SeverityInsightKind,
    trade: LoggedTrade
): string {
    const ctx: string[] = [];
    if (trade.analysis?.detectedPatternFamily) {
        ctx.push(trade.analysis.detectedPatternFamily);
    }
    if (trade.analysis?.coinName) {
        ctx.push(trade.analysis.coinName);
    }
    if (trade.analysis?.direction && trade.analysis.direction !== 'Neutral') {
        ctx.push(trade.analysis.direction);
    }
    const ctxStr = ctx.length > 0 ? ` (${ctx.join(' ')})` : '';

    const rStr = `${pnlR >= 0 ? '+' : ''}${pnlR}R`;

    switch (kind) {
        case 'deep_single_loss':
            return `Single ${rStr} loss${ctxStr} — the SL placement is letting trades run to deep loss, not the pattern itself. Review stop placement.`;
        case 'cumulative_bleed':
            return `Cumulative R-loss ${rStr} across recent similar trades${ctxStr} — frequency is shallow, severity is the failure mode.`;
        case 'bleeder_avg':
            return `Bleeder pattern: average per-loss ${rStr}${ctxStr} — losses are wider than -1R each. Either tighten the stop or shrink the size.`;
    }
}

/**
 * Build the structured context for a severity insight, using the trade's
 * analysis fields. Used by retrieval / scope.
 */
function buildSeverityContext(trade: LoggedTrade): SeverityInsight['context'] {
    return {
        coin: trade.analysis?.coinName,
        pattern: trade.analysis?.marketConditions?.pattern,
        family: trade.analysis?.detectedPatternFamily,
        direction: trade.analysis?.direction === 'Long' || trade.analysis?.direction === 'Short'
            ? trade.analysis.direction
            : undefined,
        regime: trade.marketRegime,
    };
}

/**
 * Generate a severity insight for a closed trade.
 *
 * Idempotent: the same trade + same kind always produces the same id,
 * so re-running the post-mortem job does not duplicate insights. Returns
 * null when the trade is not severe enough to deserve a severity signal
 * (a -0.5R loss should not pollute the store with severity insights).
 */
export function extractSeverityInsightFromTrade(trade: LoggedTrade): SeverityInsight | null {
    if (!trade || trade.outcome !== 'LOSS') return null;

    const pnlR = calculatePnlR(trade);
    if (pnlR === undefined || !isFinite(pnlR)) return null;
    // Too shallow to deserve a severity signal: the guard used the DEEP
    // threshold (-1.5R), which made the bleeder branch below unreachable —
    // a -1.0R..-1.5R average loss generated nothing despite the intended
    // -1.0R bleeder threshold. (A -0.5R loss still stays out.)
    if (pnlR > SEVERITY_AVG_BLEEDER_R) return null;

    const kind: SeverityInsightKind = pnlR <= SEVERITY_DEEP_LOSS_R
        ? 'deep_single_loss'
        : 'bleeder_avg';

    // Idempotency: include kind so a single deep loss is one insight,
    // not three (deep + bleeder + cumulative) for the same trade.
    const id = `severity-${trade.id}-${kind}`;

    return {
        id,
        tradeId: trade.id,
        kind,
        pnlR,
        text: buildSeverityInsightText(pnlR, kind, trade),
        context: buildSeverityContext(trade),
        createdAt: new Date().toISOString(),
    };
}

/**
 * Generate a cumulative-bleed insight for a *cluster* of similar losing
 * trades. This is the "few-but-deep" or "shallow-frequency-but-deep"
 * pattern that the gate's severity-aware HALT branch is designed to
 * catch — and the moderator prompt needs the cumulative number quoted
 * back at the user so they can see the magnitude framing, not just
 * the count.
 *
 * Pass the aggregated stats from `calculateAggregatedStats`. Returns
 * null when the cluster isn't deep enough to deserve an insight.
 */
export function extractCumulativeBleedInsight(
    cluster: {
        trades: LoggedTrade[];
        stats: { sumLossR: number; lossesWithR: number; avgR: number; sampleSize: number; winRate: number };
    },
    setup?: SetupContext
): SeverityInsight | null {
    const { stats, trades } = cluster;
    if (stats.sumLossR > SEVERITY_CUMULATIVE_R) return null;
    if (stats.lossesWithR < 2) return null;
    if (trades.length === 0) return null;

    // Neutral carries no directional signal — treat it as absent so the
    // insight stays scoped to actual directional setups.
    const direction = setup?.direction === 'Long' || setup?.direction === 'Short'
        ? setup.direction
        : undefined;

    const ctx: string[] = [];
    if (setup?.family) ctx.push(setup.family);
    if (setup?.coin) ctx.push(setup.coin);
    if (direction) ctx.push(direction);
    if (setup?.pattern) ctx.push(setup.pattern);
    const ctxStr = ctx.length > 0 ? ` (${ctx.join(' ')})` : '';

    const rStr = `${stats.sumLossR}R`;
    const id = `severity-cluster-${setup?.coin || 'unknown'}-${setup?.family || 'unknown'}-${direction || 'any'}`;

    return {
        id,
        tradeId: trades[0].id,
        kind: 'cumulative_bleed',
        pnlR: stats.sumLossR,
        text: `Cumulative R-loss ${rStr} across ${stats.lossesWithR} similar losses${ctxStr} (avg ${stats.avgR}R, win rate ${stats.winRate}%). Frequency is shallow, severity is the failure mode.`,
        context: {
            coin: setup?.coin,
            pattern: setup?.pattern,
            family: setup?.family,
            direction,
        },
        createdAt: new Date().toISOString(),
    };
}

/**
 * Persist a `SeverityInsight` to the attributed-insight store (the trader
 * notebook's distilled/ facts) so it flows into the moderator's
 * pattern-memory prompt and gate enforcement context. The synthetic provider
 * id keeps it clearly distinguishable from human/LLM-sourced insights for
 * the byProvider view.
 *
 * Idempotent: the severity id is derived from the trade/setup
 * (`severity-${trade.id}-${kind}` / `severity-cluster-${coin}-${family}-...`),
 * so re-running the post-mortem job updates the existing row (fresh R
 * magnitude) instead of piling up duplicates. User feedback fields
 * (timesUsed / timesHelpful / wasValidated / qualityScore) survive updates.
 */
export function recordSeverityInsight(insight: SeverityInsight): AttributedInsight {
    const store = loadAttributedInsights();
    const existingIndex = store.findIndex(i => i.id === insight.id);

    const base = {
        insight: insight.text,
        sourceProvider: 'pattern-memory-severity-detector',
        category: insight.context.family ? 'family'
            : insight.context.coin ? 'coin'
            : insight.context.pattern ? 'pattern'
            : insight.context.regime ? 'regime'
            : 'global',
        scope: insight.context.family || insight.context.coin || insight.context.pattern || insight.context.regime,
        tradeId: insight.tradeId,
    } as Pick<AttributedInsight, 'insight' | 'sourceProvider' | 'category' | 'scope' | 'tradeId'>;

    if (existingIndex >= 0) {
        const updated: AttributedInsight = { ...store[existingIndex], ...base };
        return upsertAttributedInsight(updated);
    }

    return addAttributedInsight({ ...base, id: insight.id });
}

/**
 * Build a `SetupContext` from a closed trade so cluster extraction reuses
 * the same similarity/aggregation machinery as the pattern-memory gate.
 */
export function buildSetupContextFromTrade(
    trade: LoggedTrade
): Omit<SetupContext, 'direction'> & { direction?: 'Long' | 'Short' } {
    const direction = trade.analysis?.direction;
    return {
        coin: trade.analysis?.coinName,
        direction: direction === 'Long' || direction === 'Short' ? direction : undefined,
        pattern: trade.analysis?.marketConditions?.pattern,
        family: trade.analysis?.detectedPatternFamily,
        regime: trade.marketRegime,
    };
}

/**
 * Derive the cumulative-bleed insight for a just-closed trade against its
 * full trade history. This is the post-mortem side of the gate's
 * `sumLossR <= -4 && lossesWithR >= 2` HALT branch: the gate sees the
 * cluster BEFORE the trade, this fires AFTER it so the "this setup has now
 * bled N R" figure stays fresh.
 *
 * The current trade is merged into the cluster by id (replacing any stale
 * copy already in history) so the just-closed loss is counted exactly once
 * regardless of whether the profile save has flushed.
 */
export function extractCumulativeBleedInsightForTrade(
    trade: LoggedTrade,
    allTrades: LoggedTrade[]
): SeverityInsight | null {
    if (!trade.analysis) return null;

    const setup = buildSetupContextFromTrade(trade);
    const merged = [trade, ...allTrades.filter(t => t.id !== trade.id)];
    const stats = calculateAggregatedStats(setup, merged);

    return extractCumulativeBleedInsight({ trades: merged, stats }, setup);
}

/**
 * Get all attributed insights summary for UI display
 */
export function getAttributedInsightsSummary(): {
    totalInsights: number;
    byProvider: Record<string, { count: number; avgQuality: number }>;
    byCategory: Record<string, number>;
    topInsights: AttributedInsight[];
} {
    const insights = loadAttributedInsights();

    // By provider
    const byProvider: Record<string, { total: number; quality: number; count: number }> = {};
    // By category
    const byCategory: Record<string, number> = {};

    for (const insight of insights) {
        const provider = typeof insight.sourceProvider === 'string'
            ? insight.sourceProvider
            : AIProvider[insight.sourceProvider] || 'Unknown';

        if (!byProvider[provider]) {
            byProvider[provider] = { total: 0, quality: 0, count: 0 };
        }
        byProvider[provider].total++;
        byProvider[provider].quality += insight.qualityScore;
        byProvider[provider].count++;

        byCategory[insight.category] = (byCategory[insight.category] || 0) + 1;
    }

    // Calculate averages
    const byProviderResult: Record<string, { count: number; avgQuality: number }> = {};
    for (const [provider, data] of Object.entries(byProvider)) {
        byProviderResult[provider] = {
            count: data.count,
            avgQuality: data.count > 0 ? Math.round(data.quality / data.count) : 50,
        };
    }

    // Top insights by quality
    const topInsights = [...insights]
        .sort((a, b) => b.qualityScore - a.qualityScore)
        .slice(0, 10);

    return {
        totalInsights: insights.length,
        byProvider: byProviderResult,
        byCategory,
        topInsights,
    };
}
