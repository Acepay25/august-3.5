/**
 * InsightExtractionService
 * Extracts key learnings from post-mortem analyses and stores them in a knowledge base.
 * 
 * Features:
 * - Parse post-mortem text to extract actionable insights
 * - Store insights with metadata (coin, pattern, direction)
 * - Retrieve relevant insights for current setups
 * - Generate prompt injections with past learnings
 * - Provider attribution for tracking which AI gave which insight
 */

import { LoggedTrade, TradeInsight, InsightKnowledgeBase, AIProvider } from '../../types';
import {
    addAttributedInsight,
    AttributedInsight,
    loadAttributedInsights,
    saveAttributedInsights,
    markInsightUsed,
    calculateAggregatedStats,
    calculatePnlR,
    SetupContext
} from './PatternMemorySynthesisService';

// Maximum insights to store to keep memory manageable
const MAX_STORED_INSIGHTS = 100;
// Maximum insights to show in prompt injection
const MAX_INJECTION_INSIGHTS = 3;
// Minimum insight text length to be considered valuable
const MIN_INSIGHT_LENGTH = 20;


/**
 * Categories for insight extraction
 */
type InsightCategory = TradeInsight['category'];

interface InsightPattern {
    category: InsightCategory;
    patterns: RegExp[];
    extractInsight: (match: RegExpMatchArray, fullText: string) => string | null;
}

/**
 * Patterns to detect and extract insights from post-mortem text
 */
const insightPatterns: InsightPattern[] = [
    {
        category: 'entry_timing',
        patterns: [
            /should have (waited|entered|held off)[^.]*\./gi,
            /next time[^.]*entry[^.]*\./gi,
            /entered too (early|late)[^.]*\./gi,
            /better entry[^.]*would be[^.]*\./gi,
            /lesson[^:]*:[^.]*entry[^.]*\./gi
        ],
        extractInsight: (match, _) => match[0].trim()
    },
    {
        category: 'exit_strategy',
        patterns: [
            /should have (taken profit|closed|exited)[^.]*\./gi,
            /next time[^.]*exit[^.]*\./gi,
            /stop loss[^.]*should[^.]*\./gi,
            /target[^.]*was (too|not)[^.]*\./gi,
            /lesson[^:]*:[^.]*exit[^.]*\./gi
        ],
        extractInsight: (match, _) => match[0].trim()
    },
    {
        category: 'pattern_recognition',
        patterns: [
            /pattern[^.]*was (invalid|false|weak)[^.]*\./gi,
            /should have (noticed|seen)[^.]*\./gi,
            /missed[^.]*signal[^.]*\./gi,
            /(false|failed) breakout[^.]*\./gi,
            /lesson[^:]*:[^.]*pattern[^.]*\./gi
        ],
        extractInsight: (match, _) => match[0].trim()
    },
    {
        category: 'risk_management',
        patterns: [
            /position size[^.]*was (too|should)[^.]*\./gi,
            /leverage[^.]*should[^.]*\./gi,
            /risk[^.]*was (too|not)[^.]*\./gi,
            /should have (reduced|avoided)[^.]*\./gi,
            /lesson[^:]*:[^.]*risk[^.]*\./gi
        ],
        extractInsight: (match, _) => match[0].trim()
    },
    {
        category: 'general',
        patterns: [
            /key (lesson|takeaway|learning)[^:]*:[^.]+\./gi,
            /next time[^:]*:[^.]+\./gi,
            /important to remember[^.]+\./gi,
            /will (avoid|do|remember)[^.]+\./gi,
            /mistake was[^.]+\./gi
        ],
        extractInsight: (match, _) => match[0].trim()
    }
];

/**
 * Extract insights from a post-mortem text
 */
export function extractInsightsFromPostMortem(
    postMortemText: string,
    trade: LoggedTrade
): TradeInsight[] {
    if (!postMortemText || postMortemText.length < MIN_INSIGHT_LENGTH) {
        return [];
    }

    const insights: TradeInsight[] = [];
    const seenInsights = new Set<string>(); // Prevent duplicates

    for (const pattern of insightPatterns) {
        for (const regex of pattern.patterns) {
            // Reset regex state
            regex.lastIndex = 0;
            let match;

            while ((match = regex.exec(postMortemText)) !== null) {
                const insightText = pattern.extractInsight(match, postMortemText);

                if (insightText && insightText.length >= MIN_INSIGHT_LENGTH) {
                    // Normalize for duplicate detection
                    const normalized = insightText.toLowerCase().trim();
                    if (!seenInsights.has(normalized)) {
                        seenInsights.add(normalized);

                        insights.push({
                            id: `insight-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                            category: pattern.category,
                            insight: insightText,
                            sourceTradeId: trade.id,
                            coin: trade.analysis.coinName,
                            pattern: trade.analysis.detectedPatternFamily,
                            direction: trade.analysis.direction === 'Neutral' ? undefined : trade.analysis.direction,
                            createdAt: new Date().toISOString(),
                            useCount: 0
                        });
                    }
                }
            }
        }
    }

    return insights;
}

/**
 * Initialize empty knowledge base
 */
export function initializeKnowledgeBase(): InsightKnowledgeBase {
    return {
        insights: [],
        lastUpdated: new Date().toISOString()
    };
}

/**
 * Store new insights in the knowledge base
 */
export function storeInsights(
    newInsights: TradeInsight[],
    currentKB: InsightKnowledgeBase | undefined
): InsightKnowledgeBase {
    const kb = currentKB ? { ...currentKB } : initializeKnowledgeBase();

    // Add new insights
    const allInsights = [...kb.insights, ...newInsights];

    // If over limit, remove oldest unused insights
    if (allInsights.length > MAX_STORED_INSIGHTS) {
        // Sort by: useCount (ascending), then createdAt (ascending) = oldest unused first
        allInsights.sort((a, b) => {
            if (a.useCount !== b.useCount) {
                return a.useCount - b.useCount;
            }
            return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        });

        // Keep only the most valuable insights
        allInsights.splice(0, allInsights.length - MAX_STORED_INSIGHTS);
    }

    return {
        insights: allInsights,
        lastUpdated: new Date().toISOString()
    };
}

/**
 * Find insights relevant to the current trading setup
 */
export function getRelevantInsights(
    currentCoin: string | undefined,
    currentPattern: string | undefined,
    currentDirection: 'Long' | 'Short' | 'Neutral',
    knowledgeBase: InsightKnowledgeBase | undefined
): TradeInsight[] {
    if (!knowledgeBase || knowledgeBase.insights.length === 0) {
        return [];
    }

    // Score insights by relevance
    const scoredInsights = knowledgeBase.insights.map(insight => {
        let score = 0;

        // Coin match (highest priority)
        if (currentCoin && insight.coin) {
            const normCurrent = currentCoin.toUpperCase().replace(/USDT?$/, '');
            const normInsight = insight.coin.toUpperCase().replace(/USDT?$/, '');
            if (normCurrent === normInsight) {
                score += 30;
            }
        }

        // Pattern match
        if (currentPattern && insight.pattern) {
            if (currentPattern.toLowerCase() === insight.pattern.toLowerCase()) {
                score += 25;
            }
        }

        // Direction match
        if (currentDirection !== 'Neutral' && insight.direction === currentDirection) {
            score += 15;
        }

        // Recency bonus (insights from last 30 days get bonus)
        const insightAge = (Date.now() - new Date(insight.createdAt).getTime()) / (1000 * 60 * 60 * 24);
        if (insightAge <= 30) {
            score += 10;
        } else if (insightAge <= 60) {
            score += 5;
        }

        // Use count bonus (validated insights)
        if (insight.useCount > 0) {
            score += Math.min(insight.useCount * 2, 10);
        }

        return { insight, score };
    });

    // Filter to only relevant insights (score > 0)
    const relevant = scoredInsights.filter(si => si.score > 0);

    // Sort by score descending
    relevant.sort((a, b) => b.score - a.score);

    // Return top insights
    return relevant.slice(0, MAX_INJECTION_INSIGHTS).map(si => si.insight);
}

/**
 * Increment use count for insights that were surfaced
 */
export function markInsightsUsed(
    usedIds: string[],
    knowledgeBase: InsightKnowledgeBase
): InsightKnowledgeBase {
    const updatedInsights = knowledgeBase.insights.map(insight => {
        if (usedIds.includes(insight.id)) {
            return { ...insight, useCount: insight.useCount + 1 };
        }
        return insight;
    });

    return {
        insights: updatedInsights,
        lastUpdated: new Date().toISOString()
    };
}

/**
 * Generate AI prompt injection with relevant insights
 */
export function generateInsightInjection(
    currentCoin: string | undefined,
    currentPattern: string | undefined,
    currentDirection: 'Long' | 'Short' | 'Neutral',
    knowledgeBase: InsightKnowledgeBase | undefined
): string {
    const relevantInsights = getRelevantInsights(
        currentCoin,
        currentPattern,
        currentDirection,
        knowledgeBase
    );

    if (relevantInsights.length === 0) {
        return '';
    }

    const parts: string[] = [];
    parts.push('🧠 **LESSONS FROM YOUR PAST TRADES**');
    parts.push('');

    for (let i = 0; i < relevantInsights.length; i++) {
        const insight = relevantInsights[i];
        const date = new Date(insight.createdAt).toLocaleDateString();
        const context = [insight.coin, insight.pattern, insight.direction]
            .filter(Boolean)
            .join(' ');

        parts.push(`${i + 1}. "${insight.insight}"`);
        parts.push(`   _From ${context} trade on ${date}_`);
    }

    parts.push('');
    parts.push('**INSTRUCTION:** Consider these past learnings when making your analysis. Reference relevant insights if they apply to the current setup.');

    return parts.join('\n');
}

/**
 * Get insights summary for UI display
 */
export function getInsightsSummary(knowledgeBase: InsightKnowledgeBase | undefined): {
    totalInsights: number;
    byCategory: Record<InsightCategory, number>;
    mostUsed: TradeInsight[];
} {
    const empty = {
        totalInsights: 0,
        byCategory: {
            entry_timing: 0,
            exit_strategy: 0,
            pattern_recognition: 0,
            risk_management: 0,
            general: 0
        },
        mostUsed: []
    };

    if (!knowledgeBase || knowledgeBase.insights.length === 0) {
        return empty;
    }

    const byCategory = { ...empty.byCategory };
    for (const insight of knowledgeBase.insights) {
        byCategory[insight.category] = (byCategory[insight.category] || 0) + 1;
    }

    const mostUsed = [...knowledgeBase.insights]
        .filter(i => i.useCount > 0)
        .sort((a, b) => b.useCount - a.useCount)
        .slice(0, 5);

    return {
        totalInsights: knowledgeBase.insights.length,
        byCategory,
        mostUsed
    };
}

// ========================= PROVIDER ATTRIBUTION =========================

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
 * Persist a `SeverityInsight` to the `AttributedInsight` store so it flows
 * into the moderator's pattern-memory prompt and gate enforcement context.
 * The synthetic provider id keeps it clearly distinguishable from
 * human/LLM-sourced insights for the byProvider view.
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
        store[existingIndex] = updated;
        saveAttributedInsights(store);
        return updated;
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
 * Orchestrator used by the post-mortem job: records the single-trade deep
 * loss insight AND the cluster cumulative-bleed insight (when applicable).
 * Returns everything that was recorded so callers can log/report. Both
 * writes are idempotent, so re-running the job never duplicates rows.
 */
export function extractAndRecordSeverityInsights(
    trade: LoggedTrade,
    allTrades: LoggedTrade[]
): SeverityInsight[] {
    const recorded: SeverityInsight[] = [];

    const single = extractSeverityInsightFromTrade(trade);
    if (single) {
        const stored = recordSeverityInsight(single);
        markStoredInsightUsed(stored.id, 'post-mortem job');
        recorded.push(single);
    }

    const cluster = extractCumulativeBleedInsightForTrade(trade, allTrades);
    if (cluster) {
        const stored = recordSeverityInsight(cluster);
        markStoredInsightUsed(stored.id, 'post-mortem job');
        recorded.push(cluster);
    }

    return recorded;
}

/**
 * Usage tracking for insights created by the post-mortem learning loop
 * (severity + provider-attributed): once a row is live in the knowledge
 * base it informs subsequent moderation, so it counts toward the quality
 * ratio (timesHelpful / timesUsed). Side-effect only — never propagates.
 */
function markStoredInsightUsed(insightId: string, site: string): void {
    try {
        markInsightUsed(insightId);
    } catch (e) {
        console.warn(`[InsightExtraction] Failed to mark insight used (${site}):`, e);
    }
}

/**
 * Build the severity-aware context block for the post-mortem generation
 * prompt. Returns '' when the trade's historical cluster shows no real
 * severity signal (sumLossR > -3R or fewer than 2 R-bearing losses) —
 * shallow clusters must not alter the post-mortem framing.
 *
 * The block quotes the same numbers the gate HALT branch and the
 * cumulative-bleed insight use, so the AI writing the post-mortem finally
 * sees the magnitude ("this setup has bled N R") instead of analyzing a
 * single trade in isolation — and is instructed to frame its corrections
 * around R-magnitude, not generic advice.
 */
export function buildSeverityPostMortemContext(
    trade: LoggedTrade,
    allTrades: LoggedTrade[]
): string {
    if (!trade?.analysis) return '';

    const setup = buildSetupContextFromTrade(trade);
    const merged = [trade, ...allTrades.filter(t => t.id !== trade.id)];
    const stats = calculateAggregatedStats(setup, merged);

    if (stats.sumLossR > SEVERITY_CUMULATIVE_R || stats.lossesWithR < 2) return '';

    // Relevant recorded severity lessons, scoped like the gate's insight
    // filter: family / coin / pattern overlap, unscoped (global) always.
    const scopedLessons = loadAttributedInsights().filter(i => {
        if (i.sourceProvider !== 'pattern-memory-severity-detector') return false;
        const scope = (i.scope || '').toLowerCase();
        if (!scope) return true;
        return (setup.family || '').toLowerCase() === scope
            || (setup.coin || '').toLowerCase() === scope
            || (setup.pattern || '').toLowerCase() === scope;
    });
    const quotedLessons = scopedLessons.slice(-3);
    const lessonQuotes = quotedLessons
        .map(i => `"${i.insight}"`)
        .join('\n');

    // Each quoted lesson is genuinely surfaced to the post-mortem model →
    // count it as "used" so the quality ratio (timesHelpful / timesUsed)
    // can move. Side-effect only: usage tracking must never break prompt
    // generation.
    quotedLessons.forEach(l => markStoredInsightUsed(l.id, 'post-mortem quote'));

    const lines = [
        '**🩸 HISTORICAL SEVERITY CONTEXT — THE DAMAGE IS SEVERITY, NOT FREQUENCY:**',
        `Similar setups in the user's trade history have bled **${stats.sumLossR}R** across ${stats.lossesWithR} R-bearing losses (avg ${stats.avgR}R per loss, ${stats.winRate}% win rate, N=${stats.sampleSize}).`,
    ];
    if (lessonQuotes) {
        lines.push(`Recorded severity lessons from past post-mortems:\n${lessonQuotes}`);
    }
    lines.push(
        '**INSTRUCTION:** Frame your corrections around R-magnitude. State how many R this setup has now bled and what must STRUCTURALLY change so the next loss is not another deep-R event. Do not fall back to generic advice.'
    );

    return lines.join('\n');
}

// ========================= PROVIDER ATTRIBUTION =========================

/**
 * Categorize an extracted insight by its scope (coin, family, regime,
 * pattern) so attributed rows reach the right setup scopes in the gate and
 * moderator prompts. Defaults to global.
 */
function categorizeInsight(
    insight: string,
    trade: LoggedTrade
): { category: AttributedInsight['category']; scope?: string } {
    const lowerInsight = insight.toLowerCase();

    // Check for coin-specific markers
    const coinName = trade.analysis?.coinName;
    if (coinName && lowerInsight.includes(coinName.toLowerCase().replace(/usdt?$/, ''))) {
        return { category: 'coin', scope: coinName };
    }

    // Check for family-specific markers
    const family = trade.analysis?.detectedPatternFamily;
    if (family && (lowerInsight.includes('family') || lowerInsight.includes(family.toLowerCase()))) {
        return { category: 'family', scope: family };
    }

    // Check for regime-specific markers
    const regime = trade.marketRegime;
    const regimeTerms = ['trending', 'ranging', 'volatile', 'compression', 'regime'];
    if (regime && regimeTerms.some(term => lowerInsight.includes(term))) {
        return { category: 'regime', scope: regime };
    }

    // Check for pattern-specific markers
    const pattern = trade.analysis?.marketConditions?.pattern;
    if (pattern && lowerInsight.includes(pattern.toLowerCase())) {
        return { category: 'pattern', scope: pattern };
    }

    // Default to global
    return { category: 'global' };
}

/**
 * Idempotent upsert for a provider-attributed insight. The id is derived
 * from trade + provider + position (`provider-${tradeId}-${provider}-${i}`),
 * so re-running the job on the same trade updates the row in place (fresh
 * text/category) instead of duplicating it. User feedback fields
 * (timesUsed / timesHelpful / wasValidated / qualityScore) survive updates.
 */
function recordProviderInsight(
    insightText: string,
    provider: string,
    trade: LoggedTrade,
    index: number
): AttributedInsight {
    const id = `provider-${trade.id}-${provider}-${index}`;
    const { category, scope } = categorizeInsight(insightText, trade);
    const base = { insight: insightText, sourceProvider: provider, category, scope, tradeId: trade.id };

    const store = loadAttributedInsights();
    const existingIndex = store.findIndex(i => i.id === id);
    if (existingIndex >= 0) {
        const updated: AttributedInsight = { ...store[existingIndex], ...base };
        store[existingIndex] = updated;
        saveAttributedInsights(store);
        return updated;
    }
    return addAttributedInsight({ ...base, id });
}

/**
 * Extract + record provider-attributed insights from a trade's per-provider
 * post-mortem contributions (`postMortemByProvider`, captured at generation
 * time in usePostMortem). This is the data half of the Knowledge Base's
 * by-provider view: each extracted lesson is stored with the display name
 * of the AI that actually wrote it, so `getAttributedInsightsSummary` can
 * show per-provider counts and average quality.
 *
 * Runs inside the EXTRACT_INSIGHTS job — everything is best-effort and
 * idempotent. Insights are marked "used" at creation (they are now live in
 * the knowledge base and inform later moderation), mirroring the severity
 * path.
 */
export function extractAndRecordProviderInsights(trade: LoggedTrade): AttributedInsight[] {
    if (!trade?.analysis || !trade.postMortemByProvider) return [];

    const recorded: AttributedInsight[] = [];
    for (const [provider, text] of Object.entries(trade.postMortemByProvider)) {
        if (!provider || !text || text.trim().length < MIN_INSIGHT_LENGTH) continue;

        // Reuse the post-mortem insight extractor for the actual lesson text
        // (deterministic order for a given text), then attribute each hit.
        const extracted = extractInsightsFromPostMortem(text, trade);
        extracted.slice(0, 5).forEach((insight, i) => {
            const stored = recordProviderInsight(insight.insight, provider, trade, i);
            markStoredInsightUsed(stored.id, 'provider attribution');
            recorded.push(stored);
        });
    }
    return recorded;
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
