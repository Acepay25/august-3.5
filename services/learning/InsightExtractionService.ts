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
    loadAttributedInsights
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

/**
 * Extract insights from post-mortem and attribute them to specific providers.
 * This allows tracking which AI models produce the most valuable insights.
 */
export function extractInsightsWithAttribution(
    postMortemText: string,
    trade: LoggedTrade,
    providerContributions: { provider: AIProvider | string; text: string }[]
): AttributedInsight[] {
    const attributedInsights: AttributedInsight[] = [];

    // First, try to extract insights from each provider's contribution
    for (const { provider, text } of providerContributions) {
        if (!text || text.length < MIN_INSIGHT_LENGTH) continue;

        const insights = extractInsightsFromText(text);

        for (const insightText of insights) {
            // Determine category and scope
            const { category, scope } = categorizeInsight(insightText, trade);

            const attributed = addAttributedInsight({
                insight: insightText,
                sourceProvider: provider,
                category,
                scope,
                tradeId: trade.id,
            });

            attributedInsights.push(attributed);
        }
    }

    // Also extract from the combined post-mortem if no provider contributions
    if (providerContributions.length === 0 && postMortemText) {
        const insights = extractInsightsFromText(postMortemText);

        for (const insightText of insights) {
            const { category, scope } = categorizeInsight(insightText, trade);

            const attributed = addAttributedInsight({
                insight: insightText,
                sourceProvider: 'moderator',
                category,
                scope,
                tradeId: trade.id,
            });

            attributedInsights.push(attributed);
        }
    }

    console.log(`[InsightExtraction] Extracted ${attributedInsights.length} attributed insights`);
    return attributedInsights;
}

/**
 * Extract insight text using patterns (internal helper)
 */
function extractInsightsFromText(text: string): string[] {
    const insights: string[] = [];
    const seenInsights = new Set<string>();

    // Patterns for lessons
    const lessonPatterns = [
        /key lesson[:\s]+([^.]+\.)/gi,
        /lesson[:\s]+([^.]+\.)/gi,
        /takeaway[:\s]+([^.]+\.)/gi,
        /next time[,\s]+([^.]+\.)/gi,
        /should have[:\s]+([^.]+\.)/gi,
        /mistake was[:\s]+([^.]+\.)/gi,
        /improvement[:\s]+([^.]+\.)/gi,
        /rule[:\s]+if[^.]+then[^.]+\./gi,
        /if \[.+\], then \[.+\]/gi,
    ];

    for (const pattern of lessonPatterns) {
        pattern.lastIndex = 0;
        let match;

        while ((match = pattern.exec(text)) !== null) {
            const insightText = match[1] ? match[1].trim() : match[0].trim();

            if (insightText.length >= MIN_INSIGHT_LENGTH && insightText.length <= 300) {
                const normalized = insightText.toLowerCase();
                if (!seenInsights.has(normalized)) {
                    seenInsights.add(normalized);
                    insights.push(insightText);
                }
            }
        }
    }

    return insights.slice(0, 5); // Max 5 insights per text block
}

/**
 * Categorize an insight by its scope (global, coin, pattern, regime, family)
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
