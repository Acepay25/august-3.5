/**
 * PatternMemorySynthesisService
 * 
 * Synthesizes pattern memory for moderator prompts during post-mortem analysis.
 * Provides structured memory format, similarity matching, and provider attribution.
 */

import { LoggedTrade, AIProvider } from '../../types';
import { getPreferenceObject, setPreferenceObject, PREF_KEYS } from '../infrastructure/PreferencesService';
import { parsePrice } from '../../utils/analysisUtils';
// Cyclic-import note: InsightExtractionService imports several helpers from
// this module. The cycle is safe — both sides only reference the other's
// exports inside function bodies, never at module-evaluation time.
import { extractCumulativeBleedInsight, recordSeverityInsight } from './InsightExtractionService';

// ========================= INTERFACES =========================

/**
 * Context for the current trade setup being analyzed
 */
export interface SetupContext {
    coin?: string;
    direction?: 'Long' | 'Short' | 'Neutral';
    pattern?: string;
    family?: string; // Family A/B/C/Omega
    regime?: 'trending' | 'ranging' | 'volatile' | 'compression';
    confidence?: 'High' | 'Medium' | 'Low' | 'Avoid';
    entryPrice?: number;
    timeOfDay?: 'asian' | 'london' | 'newyork' | 'overlap';
}

/**
 * A historical trade with computed similarity score
 */
export interface RelevantTrade {
    tradeId: string;
    coin: string;
    direction: 'Long' | 'Short';
    outcome: 'WIN' | 'LOSS' | 'BREAKEVEN';
    pattern?: string;
    family?: string;
    regime?: 'trending' | 'ranging' | 'volatile' | 'compression';
    keyLesson: string; // Extracted from postMortem
    similarity: number; // 0-100 match score
    date: string;
    pnlR?: number; // P&L in R multiples
}

/**
 * Aggregated statistics for the current setup type
 */
export interface AggregatedStats {
    sampleSize: number;
    winRate: number;
    avgR: number;
    bestR: number;
    worstR: number;
    /**
     * Sum of negative R-multiples from losing trades. Magnitude-aware
     * counterweight to `losses`: 2 trades at -3R is materially worse than
     * 2 trades at -0.5R, even though the count is identical. Used by the
     * severity-aware HALT branch in `generateMandatoryPatternCheck`.
     * Always <= 0; 0 means "no losing trades" or "no R data".
     */
    sumLossR: number;
    /**
     * Number of losses that contributed to `sumLossR` (i.e. losses with
     * a finite, non-zero R). Smaller than `losses` when some losses had
     * missing SL/entry. Used to gate the severity HALT so we don't fire
     * on a single outlier.
     */
    lossesWithR: number;
    regimeBreakdown: Record<string, { wins: number; losses: number; winRate: number }>;
}

/**
 * An insight with provider attribution and validation tracking
 */
export interface AttributedInsight {
    id: string;
    insight: string;
    sourceProvider: AIProvider | string;
    category: 'global' | 'coin' | 'pattern' | 'regime' | 'family';
    scope?: string; // e.g., "BTCUSDT" for coin-specific, "Family C" for family-specific
    qualityScore: number; // 0-100, based on user feedback or outcome correlation
    wasValidated: boolean; // Did following this advice help?
    timesUsed: number;
    timesHelpful: number;
    createdAt: string;
    tradeId: string;
}

/**
 * The complete synthesized pattern memory for moderator injection
 */
export interface PatternMemorySynthesis {
    relevantTrades: RelevantTrade[];
    aggregatedStats: AggregatedStats;
    warnings: string[];
    attributedInsights: AttributedInsight[];
    regimeContext: string;
    synthesisTimestamp: string;
}

// ========================= CONSTANTS =========================

const SIMILARITY_WEIGHTS = {
    coin: 30,
    pattern: 20,
    family: 25,
    regime: 20,
    direction: 15,
    confidence: 10,
    recency: 10, // Bonus for recent trades (last 30 days)
};

const MAX_RELEVANT_TRADES = 3;
const MAX_INSIGHTS_TO_INJECT = 5;

// ========================= SIMILARITY SCORING =========================

/**
 * Calculate similarity score between current setup and a historical trade
 */
export function calculateSimilarity(setup: SetupContext, trade: LoggedTrade): number {
    let score = 0;
    const analysis = trade.analysis;

    // Coin match (highest priority)
    if (setup.coin && analysis?.coinName) {
        const normCurrent = setup.coin.toUpperCase().replace(/USDT?$/, '');
        const normTrade = analysis.coinName.toUpperCase().replace(/USDT?$/, '');
        if (normCurrent === normTrade) {
            score += SIMILARITY_WEIGHTS.coin;
        }
    }

    // Family match (very important)
    if (setup.family && analysis?.detectedPatternFamily) {
        const normSetup = setup.family.toLowerCase().replace(/\s/g, '');
        const normTrade = analysis.detectedPatternFamily.toLowerCase().replace(/\s/g, '');
        if (normSetup === normTrade || normTrade.includes(normSetup) || normSetup.includes(normTrade)) {
            score += SIMILARITY_WEIGHTS.family;
        }
    }

    // Pattern match
    if (setup.pattern && analysis?.marketConditions?.pattern) {
        const normSetup = setup.pattern.toLowerCase();
        const normTrade = analysis.marketConditions.pattern.toLowerCase();
        if (normSetup === normTrade) {
            score += SIMILARITY_WEIGHTS.pattern;
        } else if (normTrade.includes(normSetup) || normSetup.includes(normTrade)) {
            score += SIMILARITY_WEIGHTS.pattern * 0.5; // Partial match
        }
    }

    // Regime match
    if (setup.regime && trade.marketRegime) {
        if (setup.regime === trade.marketRegime) {
            score += SIMILARITY_WEIGHTS.regime;
        } else if (areAdjacentRegimes(setup.regime, trade.marketRegime)) {
            score += SIMILARITY_WEIGHTS.regime * 0.4; // Adjacent regimes
        }
    }

    // Direction match
    if (setup.direction && setup.direction !== 'Neutral' && analysis?.direction) {
        if (setup.direction.toLowerCase() === analysis.direction.toLowerCase()) {
            score += SIMILARITY_WEIGHTS.direction;
        }
    }

    // Confidence match
    if (setup.confidence && analysis?.confidence) {
        if (setup.confidence.toLowerCase() === analysis.confidence.toLowerCase()) {
            score += SIMILARITY_WEIGHTS.confidence;
        }
    }

    // Recency bonus (trades in last 30 days)
    const tradeDate = new Date(trade.timestamp);
    const daysSince = (Date.now() - tradeDate.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince <= 30) {
        score += SIMILARITY_WEIGHTS.recency;
    } else if (daysSince <= 60) {
        score += SIMILARITY_WEIGHTS.recency * 0.5;
    }

    return Math.min(100, score);
}

/**
 * Check if two regimes are adjacent (related)
 */
function areAdjacentRegimes(a: string, b: string): boolean {
    const adjacencyMap: Record<string, string[]> = {
        'trending': ['volatile'],
        'ranging': ['compression'],
        'volatile': ['trending'],
        'compression': ['ranging'],
    };
    return adjacencyMap[a]?.includes(b) || false;
}

/**
 * Extract key lesson from post-mortem text
 */
function extractKeyLesson(postMortem: string | undefined): string {
    if (!postMortem || postMortem.length < 20) return 'No lesson available';

    // Look for explicit lesson markers
    const lessonPatterns = [
        /key lesson[:\s]+([^.]+\.)/i,
        /lesson[:\s]+([^.]+\.)/i,
        /takeaway[:\s]+([^.]+\.)/i,
        /next time[:\s,]+([^.]+\.)/i,
        /should have[:\s]+([^.]+\.)/i,
        /mistake was[:\s]+([^.]+\.)/i,
    ];

    for (const pattern of lessonPatterns) {
        const match = postMortem.match(pattern);
        if (match && match[1]) {
            return match[1].trim().slice(0, 150);
        }
    }

    // Fallback: first meaningful sentence
    const sentences = postMortem.split(/[.!?]+/).filter(s => s.trim().length > 20);
    return sentences[0]?.trim().slice(0, 150) || 'Review full post-mortem for insights';
}

/**
 * Calculate P&L in R multiples
 *
 * Exported so the post-mortem severity-insight generator in
 * `InsightExtractionService` can use the same R-multiple math as the
 * pattern-memory gate (single source of truth — see the comment at the
 * LOSS branch below re: the correctedStopLoss scaling that the old
 * hardcoded -1.0 used to flatten out).
 */
export function calculatePnlR(trade: LoggedTrade): number | undefined {
    const analysis = trade.analysis;
    if (!analysis) return undefined;

    // parsePrice (not parseFloat) — handles comma-formatted prices ("69,000")
    // and timeframe annotations ("94500 4h") without gluing digits together.
    const entry = parsePrice(analysis.entryPoints?.[0]?.price || '');
    const sl = parsePrice(analysis.stopLoss || '');
    const outcome = trade.outcome;

    if (!isFinite(entry) || !isFinite(sl) || entry === sl) return undefined;

    const risk = Math.abs(entry - sl);

    // For wins, estimate based on typical TP (1.5-2R)
    if (outcome === 'WIN') {
        // Check if we have corrected values
        const tp = parsePrice(trade.correctedTakeProfit || analysis.takeProfit?.[0]?.price || '');
        if (isFinite(tp) && entry) {
            const reward = Math.abs(tp - entry);
            return +(reward / risk).toFixed(2);
        }
        return 1.5; // Default estimate for wins
    } else if (outcome === 'LOSS') {
        // A stop-loss exit is -1R against the PLANNED stop; scale by the ACTUAL
        // stop used (correctedStopLoss) so widened stops register as extended
        // losses. The old hardcoded -1.0 made the `worstR <= -1.5` REDUCE_SIZE
        // gate in generateMandatoryPatternCheck unreachable.
        const actualSl = parsePrice(trade.correctedStopLoss || analysis.stopLoss || '');
        if (isFinite(actualSl) && actualSl !== entry && risk > 0) {
            return -Math.abs(entry - actualSl) / risk;
        }
        return -1.0;
    }

    return 0; // Breakeven
}

// ========================= CORE SYNTHESIS =========================

/**
 * Find the most relevant historical trades for the current setup
 */
export function findRelevantTrades(
    setup: SetupContext,
    trades: LoggedTrade[]
): RelevantTrade[] {
    // Filter trades with outcomes
    const completedTrades = trades.filter(t =>
        t.outcome && t.outcome !== 'PENDING' && t.analysis
    );

    // Score each trade
    const scored = completedTrades.map(trade => ({
        trade,
        similarity: calculateSimilarity(setup, trade),
    }));

    // Filter trades with meaningful similarity and sort
    const relevant = scored
        .filter(s => s.similarity > 20)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, MAX_RELEVANT_TRADES);

    // Convert to RelevantTrade format
    return relevant.map(({ trade, similarity }) => ({
        tradeId: trade.id,
        coin: trade.analysis?.coinName || 'Unknown',
        direction: (trade.analysis?.direction as 'Long' | 'Short') || 'Long',
        outcome: trade.outcome as 'WIN' | 'LOSS' | 'BREAKEVEN',
        pattern: trade.analysis?.marketConditions?.pattern,
        family: trade.analysis?.detectedPatternFamily,
        regime: trade.marketRegime,
        keyLesson: extractKeyLesson(trade.postMortem),
        similarity,
        date: new Date(trade.timestamp).toLocaleDateString(),
        pnlR: calculatePnlR(trade),
    }));
}

/**
 * Calculate aggregated statistics for trades similar to the current setup
 */
export function calculateAggregatedStats(
    setup: SetupContext,
    trades: LoggedTrade[]
): AggregatedStats {
    // Filter trades that match at least somewhat
    const relevantTrades = trades.filter(t => {
        if (!t.outcome || t.outcome === 'PENDING' || !t.analysis) return false;

        // At least one matching criterion
        const matchesCoin = setup.coin &&
            t.analysis?.coinName?.toUpperCase().replace(/USDT?$/, '') ===
            setup.coin.toUpperCase().replace(/USDT?$/, '');
        const matchesFamily = setup.family &&
            t.analysis?.detectedPatternFamily?.toLowerCase().includes(setup.family.toLowerCase());
        const matchesRegime = setup.regime && t.marketRegime === setup.regime;
        const matchesDirection = setup.direction &&
            t.analysis?.direction?.toLowerCase() === setup.direction.toLowerCase();

        return matchesCoin || matchesFamily || matchesRegime || matchesDirection;
    });

    if (relevantTrades.length === 0) {
        return {
            sampleSize: 0,
            winRate: 50,
            avgR: 0,
            bestR: 0,
            worstR: 0,
            sumLossR: 0,
            lossesWithR: 0,
            regimeBreakdown: {},
        };
    }

    // Calculate stats
    const wins = relevantTrades.filter(t => t.outcome === 'WIN').length;
    const pnlRs = relevantTrades.map(t => calculatePnlR(t)).filter((r): r is number => r !== undefined);

    // R-weighted severity counterweight: only LOSS outcomes with a finite
    // negative R contribute, so a -0.5R tight-SL loss and a -3R disaster
    // don't look identical to the gate.
    const lossRs = pnlRs.filter(r => r < 0);
    const sumLossR = lossRs.length > 0 ? +(lossRs.reduce((a, b) => a + b, 0)).toFixed(2) : 0;
    const lossesWithR = lossRs.length;

    // Regime breakdown
    const regimeBreakdown: Record<string, { wins: number; losses: number; winRate: number }> = {};
    for (const trade of relevantTrades) {
        const regime = trade.marketRegime || 'unknown';
        if (!regimeBreakdown[regime]) {
            regimeBreakdown[regime] = { wins: 0, losses: 0, winRate: 0 };
        }
        if (trade.outcome === 'WIN') {
            regimeBreakdown[regime].wins++;
        } else {
            regimeBreakdown[regime].losses++;
        }
    }

    // Calculate win rates
    for (const regime of Object.keys(regimeBreakdown)) {
        const { wins, losses } = regimeBreakdown[regime];
        regimeBreakdown[regime].winRate = wins + losses > 0
            ? Math.round((wins / (wins + losses)) * 100)
            : 50;
    }

    return {
        sampleSize: relevantTrades.length,
        winRate: Math.round((wins / relevantTrades.length) * 100),
        avgR: pnlRs.length > 0 ? +(pnlRs.reduce((a, b) => a + b, 0) / pnlRs.length).toFixed(2) : 0,
        bestR: pnlRs.length > 0 ? Math.max(...pnlRs) : 0,
        worstR: pnlRs.length > 0 ? Math.min(...pnlRs) : 0,
        sumLossR,
        lossesWithR,
        regimeBreakdown,
    };
}

/**
 * Generate contextual warnings based on pattern memory
 */
export function generateWarnings(
    setup: SetupContext,
    relevantTrades: RelevantTrade[],
    stats: AggregatedStats
): string[] {
    const warnings: string[] = [];

    // Low sample size warning
    if (stats.sampleSize < 5) {
        warnings.push(`⚠️ Low sample size (${stats.sampleSize} trades). Statistics may not be reliable.`);
    }

    // Low win rate warning
    if (stats.winRate < 40 && stats.sampleSize >= 3) {
        warnings.push(`🔴 Historical win rate for similar setups is only ${stats.winRate}%. Consider reducing size.`);
    }

    // Consecutive losses in similar setups
    const recentLosses = relevantTrades.filter(t => t.outcome === 'LOSS').length;
    if (recentLosses >= 2) {
        warnings.push(`📉 ${recentLosses} of ${relevantTrades.length} most similar trades were losses.`);
    }

    // Regime-specific warning
    if (setup.regime && stats.regimeBreakdown[setup.regime]) {
        const regimeStats = stats.regimeBreakdown[setup.regime];
        if (regimeStats.winRate < 35 && regimeStats.wins + regimeStats.losses >= 3) {
            warnings.push(`⚠️ Poor performance in ${setup.regime} regime (${regimeStats.winRate}% win rate).`);
        }
    }

    // Extended SL breach pattern
    const extendedBreaches = relevantTrades.filter(t =>
        t.outcome === 'LOSS' && t.keyLesson.toLowerCase().includes('extended')
    );
    if (extendedBreaches.length > 0) {
        warnings.push(`💀 Similar setups have hit extended SL zones. Consider wider initial stops.`);
    }

    return warnings;
}

/**
 * Main synthesis function - creates complete pattern memory for moderator
 *
 * When no insights are passed explicitly, load them from the attributed-
 * insight store. The gate and the moderator enforcement context rely on
 * this — otherwise severity insights recorded after a post-mortem would
 * never reach the prompt that's supposed to quote them.
 */
export function synthesizePatternMemory(
    setup: SetupContext,
    trades: LoggedTrade[],
    attributedInsights: AttributedInsight[] = loadAttributedInsights()
): PatternMemorySynthesis {
    const relevantTrades = findRelevantTrades(setup, trades);
    const aggregatedStats = calculateAggregatedStats(setup, trades);
    const warnings = generateWarnings(setup, relevantTrades, aggregatedStats);

    // Filter insights relevant to this setup
    const relevantInsights = filterRelevantInsights(setup, attributedInsights);

    // Generate regime context
    const regimeContext = generateRegimeContext(setup, aggregatedStats);

    return {
        relevantTrades,
        aggregatedStats,
        warnings,
        attributedInsights: relevantInsights,
        regimeContext,
        synthesisTimestamp: new Date().toISOString(),
    };
}

/**
 * Filter insights relevant to the current setup
 */
function filterRelevantInsights(
    setup: SetupContext,
    insights: AttributedInsight[]
): AttributedInsight[] {
    if (!insights || insights.length === 0) return [];

    return insights
        .filter(insight => {
            // Global insights always apply
            if (insight.category === 'global') return true;

            // Coin-specific
            if (insight.category === 'coin' && setup.coin) {
                return insight.scope?.toUpperCase().includes(setup.coin.toUpperCase());
            }

            // Pattern-specific
            if (insight.category === 'pattern' && setup.pattern) {
                return insight.scope?.toLowerCase().includes(setup.pattern.toLowerCase());
            }

            // Regime-specific
            if (insight.category === 'regime' && setup.regime) {
                return insight.scope?.toLowerCase() === setup.regime;
            }

            // Family-specific
            if (insight.category === 'family' && setup.family) {
                return insight.scope?.toLowerCase().includes(setup.family.toLowerCase());
            }

            return false;
        })
        .sort((a, b) => b.qualityScore - a.qualityScore)
        .slice(0, MAX_INSIGHTS_TO_INJECT);
}

/**
 * Generate regime-aware context string
 */
function generateRegimeContext(
    setup: SetupContext,
    stats: AggregatedStats
): string {
    if (!setup.regime) return 'Regime not specified.';

    const regimeStats = stats.regimeBreakdown[setup.regime];

    if (!regimeStats || regimeStats.wins + regimeStats.losses === 0) {
        return `Current regime: ${setup.regime}. No historical data for this regime.`;
    }

    const sampleSize = regimeStats.wins + regimeStats.losses;
    return `Current regime: ${setup.regime}. Historical performance: ${regimeStats.winRate}% win rate over ${sampleSize} trades.`;
}

// ========================= PROMPT GENERATION =========================

/**
 * Generate structured prompt injection for moderator
 */
export function generateSynthesizedPromptInjection(synthesis: PatternMemorySynthesis): string {
    const parts: string[] = [];

    parts.push('🧠 **STRUCTURED PATTERN MEMORY SYNTHESIS**\n');

    // Most similar trades
    if (synthesis.relevantTrades.length > 0) {
        parts.push('**Most Similar Historical Trades:**');
        synthesis.relevantTrades.forEach((trade, i) => {
            const outcome = trade.outcome === 'WIN' ? '✅' : trade.outcome === 'LOSS' ? '❌' : '⚖️';
            parts.push(`${i + 1}. ${outcome} ${trade.coin} ${trade.direction} (${trade.similarity}% match)`);
            parts.push(`   Family: ${trade.family || 'Unknown'} | Regime: ${trade.regime || 'Unknown'}`);
            parts.push(`   Lesson: "${trade.keyLesson}"`);
            if (trade.pnlR !== undefined) {
                parts.push(`   Result: ${trade.pnlR >= 0 ? '+' : ''}${trade.pnlR}R`);
            }
        });
        parts.push('');
    }

    // Aggregated stats
    parts.push('**Historical Statistics for This Setup Type:**');
    parts.push(`• Win Rate: ${synthesis.aggregatedStats.winRate}%`);
    parts.push(`• Sample Size: ${synthesis.aggregatedStats.sampleSize} trades`);
    parts.push(`• Average R: ${synthesis.aggregatedStats.avgR >= 0 ? '+' : ''}${synthesis.aggregatedStats.avgR}R`);
    parts.push(`• Best/Worst: ${synthesis.aggregatedStats.bestR >= 0 ? '+' : ''}${synthesis.aggregatedStats.bestR}R / ${synthesis.aggregatedStats.worstR}R`);
    parts.push(`• Cumulative R-Loss: ${synthesis.aggregatedStats.sumLossR}R across ${synthesis.aggregatedStats.lossesWithR} R-bearing losses`);
    parts.push('');

    // Severity-tagged insights get their own block with priority. These
    // are R-weighted post-mortem conclusions the user has produced; they
    // carry the most actionable signal in the gate so we surface them
    // before the generic attributed-insights list.
    const severityInsights = synthesis.attributedInsights.filter(
        i => i.sourceProvider === 'pattern-memory-severity-detector'
    );
    const genericInsights = synthesis.attributedInsights.filter(
        i => i.sourceProvider !== 'pattern-memory-severity-detector'
    );

    if (severityInsights.length > 0) {
        parts.push('**🩸 SEVERITY INSIGHTS (R-weighted, from your post-mortems):**');
        severityInsights.forEach((insight, i) => {
            parts.push(`${i + 1}. "${insight.insight}"`);
            parts.push(`   Quality: ${insight.qualityScore}/100 | Used: ${insight.timesUsed}x | Helpful: ${insight.timesHelpful}x`);
            // Surfaced to the moderator → counts as "used" so the quality
            // ratio (timesHelpful / timesUsed) can move.
            markInsightUsed(insight.id);
        });
        parts.push('');
    }

    // Regime context
    parts.push(`**Regime Context:** ${synthesis.regimeContext}`);
    parts.push('');

    // Warnings
    if (synthesis.warnings.length > 0) {
        parts.push('**Active Warnings:**');
        synthesis.warnings.forEach(w => parts.push(w));
        parts.push('');
    }

    // Attributed insights (generic — severity is rendered above)
    if (genericInsights.length > 0) {
        parts.push('**Provider-Attributed Insights:**');
        genericInsights.forEach((insight, i) => {
            const provider = typeof insight.sourceProvider === 'string'
                ? insight.sourceProvider
                : AIProvider[insight.sourceProvider] || 'Unknown';
            parts.push(`${i + 1}. [${provider}] "${insight.insight}"`);
            parts.push(`   Quality: ${insight.qualityScore}/100 | Used: ${insight.timesUsed}x | Helpful: ${insight.timesHelpful}x`);
        });
        parts.push('');
    }

    parts.push('**MODERATOR INSTRUCTION:** Use this structured memory to validate or challenge analyst conclusions. Flag trades that match failure patterns.');

    return parts.join('\n');
}

// ========================= STORAGE & RETRIEVAL =========================

// In-memory cache
let _insightsCache: AttributedInsight[] | null = null;
let _isInitialized = false;

/**
 * User-scoped preference key. Insights are learning state — like
 * GlobalLearningService's calibration, they must not leak across profiles.
 */
const insightsPrefKey = (): string => {
    const username = typeof localStorage !== 'undefined'
        ? (localStorage.getItem('last_active_user') || 'default')
        : 'default';
    return `${PREF_KEYS.ATTRIBUTED_INSIGHTS}_${username}`;
};

/**
 * Switch the active user (called from App.loadUserData). Resets the
 * one-shot init guard + cache so the next load reads the new user's data
 * instead of the previous user's in-session cache.
 */
export const setAttributedInsightsUser = (username: string | null): void => {
    _insightsCache = null;
    _isInitialized = false;
    if (username) {
        localStorage.setItem('last_active_user', username);
    }
};

/**
 * Initialize service - load insights into memory
 */
export const initPatternMemoryService = async (): Promise<void> => {
    if (_isInitialized) return;

    try {
        const stored = await getPreferenceObject<AttributedInsight[]>(insightsPrefKey());
        if (stored) {
            _insightsCache = stored;
        } else {
            _insightsCache = [];
        }
        _isInitialized = true;
        console.log('[PatternMemory] Service initialized with cached insights');
    } catch (e) {
        console.error('[PatternMemory] Cached init failed:', e);
        _insightsCache = [];
    }
};

/**
 * Load attributed insights from memory
 */
export function loadAttributedInsights(): AttributedInsight[] {
    if (_insightsCache) return _insightsCache;

    // Fallback for non-initialized state
    try {
        const stored = localStorage.getItem(insightsPrefKey());
        return stored ? JSON.parse(stored) : [];
    } catch (e) {
        console.warn('[PatternMemorySynthesis] Failed to load insights:', e);
        return [];
    }
}

/**
 * Save attributed insights to storage
 */
export function saveAttributedInsights(insights: AttributedInsight[]): void {
    // Keep only most recent 200 insights
    const trimmed = insights.slice(-200);
    _insightsCache = trimmed;

    // Fire and forget
    setPreferenceObject(insightsPrefKey(), trimmed).catch(e =>
        console.warn('[PatternMemorySynthesis] Failed to save insights:', e)
    );
}

/**
 * Add a new attributed insight.
 *
 * `id` is optional: when omitted a random id is generated. Callers that
 * need idempotent writes (e.g. R-severity insights, whose ids are derived
 * from the trade/setup) can pass a stable id so re-running the same job
 * updates the existing row instead of duplicating it — dedupe/update is
 * handled by the caller (see `InsightExtractionService.recordSeverityInsight`).
 */
export function addAttributedInsight(
    insight: Omit<AttributedInsight, 'id' | 'createdAt' | 'wasValidated' | 'timesUsed' | 'timesHelpful' | 'qualityScore'> & { id?: string }
): AttributedInsight {
    const newInsight: AttributedInsight = {
        ...insight,
        id: insight.id ?? `insight-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        createdAt: new Date().toISOString(),
        wasValidated: false,
        timesUsed: 0,
        timesHelpful: 0,
        qualityScore: 50, // Default neutral score
    };

    const insights = loadAttributedInsights();
    insights.push(newInsight);
    saveAttributedInsights(insights);

    console.log(`[PatternMemorySynthesis] Added insight: "${insight.insight.slice(0, 50)}..."`);
    return newInsight;
}

/**
 * Mark an insight as used (surfaced to moderator)
 */
export function markInsightUsed(insightId: string): void {
    const insights = loadAttributedInsights();
    const insight = insights.find(i => i.id === insightId);
    if (insight) {
        insight.timesUsed++;
        saveAttributedInsights(insights);
    }
}

/**
 * Record feedback on an insight's helpfulness
 */
export function recordInsightFeedback(insightId: string, wasHelpful: boolean): void {
    const insights = loadAttributedInsights();
    const insight = insights.find(i => i.id === insightId);
    if (insight) {
        insight.wasValidated = true;
        if (wasHelpful) {
            insight.timesHelpful++;
        }
        // Update quality score based on helpfulness ratio
        if (insight.timesUsed > 0) {
            insight.qualityScore = Math.round((insight.timesHelpful / insight.timesUsed) * 100);
        }
        saveAttributedInsights(insights);
        console.log(`[PatternMemorySynthesis] Insight feedback: ${insightId} - helpful: ${wasHelpful}`);
    }
}

// ========================= MANDATORY PATTERN MEMORY CHECK (STRICT) =========================

/**
 * Pattern Memory Gate Result - determines if trade should be blocked
 */
export interface PatternMemoryGate {
    allowed: boolean;
    gateResult: 'PASS' | 'WARNING' | 'HALT' | 'REDUCE_SIZE';
    reason: string;
    mandatoryQuestions: string[];
    historicalFailures: RelevantTrade[];
    /**
     * Severity insights that were pulled into the gate's reasoning. Empty
     * when none matched the current setup. Surfaced separately from the
     * generic `attributedInsights` block so the moderator can quote the
     * user's own past severity lesson verbatim.
     */
    severityInsights: AttributedInsight[];
}

/**
 * Build a mandatory question that quotes the user's own past severity
 * insight, if any. Returns null when no severity-tagged insight matches
 * the current setup's family/coin/pattern scope.
 *
 * The synthetic provider id `pattern-memory-severity-detector` is the
 * tag `InsightExtractionService.recordSeverityInsight` writes, so we
 * filter on it here without polluting the general insight store.
 */
function buildSeverityMandatoryQuestion(
    setup: SetupContext,
    attributedInsights: AttributedInsight[]
): string | null {
    const severityMatches = attributedInsights.filter(
        i => i.sourceProvider === 'pattern-memory-severity-detector'
    );
    if (severityMatches.length === 0) return null;

    // Prefer the highest-quality match — the one that the user has found
    // most helpful in the past, OR the most recent.
    const best = [...severityMatches].sort((a, b) => {
        if (a.qualityScore !== b.qualityScore) return b.qualityScore - a.qualityScore;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    })[0];

    // This insight is now genuinely surfaced to the moderator (quoted in a
    // mandatory question) — count it so `recordInsightFeedback` can later
    // derive a quality ratio (timesHelpful / timesUsed). Without this the
    // quality score never leaves its default of 50.
    markInsightUsed(best.id);

    return `Your pattern memory records: "${best.insight}" — what is structurally different about THIS trade that breaks the pattern?`;
}

/**
 * Generate mandatory pattern memory check for moderator.
 * This creates STRICT enforcement rules that can halt or modify trades.
 */
export function generateMandatoryPatternCheck(
    setup: SetupContext,
    trades: LoggedTrade[]
): PatternMemoryGate {
    const synthesis = synthesizePatternMemory(setup, trades);
    const { relevantTrades, aggregatedStats, warnings } = synthesis;

    // Count similar losses
    const losses = relevantTrades.filter(t => t.outcome === 'LOSS');
    const lossRate = relevantTrades.length > 0
        ? (losses.length / relevantTrades.length) * 100
        : 0;

    const mandatoryQuestions: string[] = [];
    let gateResult: PatternMemoryGate['gateResult'];
    let reason: string;

    // HALT CONDITIONS (most severe)
    if (aggregatedStats.sampleSize >= 5 && aggregatedStats.winRate < 30) {
        gateResult = 'HALT';
        reason = `📛 HALT: Historical win rate for this setup is only ${aggregatedStats.winRate}% (N=${aggregatedStats.sampleSize}). This is a LOSING pattern.`;
        mandatoryQuestions.push('Why would this trade be different from the historical failures?');
        mandatoryQuestions.push('What specific edge has been identified that was missing before?');
    }

    // Check for 3+ similar losses (frequency-based HALT — unchanged)
    else if (losses.length >= 3) {
        gateResult = 'HALT';
        reason = `📛 HALT: ${losses.length} of the most similar historical trades were LOSSES. Pattern has consistent failure mode.`;
        mandatoryQuestions.push('What fundamental change would make this trade succeed where others failed?');
    }

    // Severity-aware HALT (NEW): catches "few but deep" failures.
    // Dual-dimension — both the magnitude threshold AND a minimum loss
    // count must hold, so a single -10R outlier (small sample) cannot
    // flip the verdict on its own. Frequency and severity are co-equal
    // signals: count catches repeated narrow losses, magnitude catches
    // catastrophic ones.
    else if (aggregatedStats.sumLossR <= -4 && aggregatedStats.lossesWithR >= 2) {
        gateResult = 'HALT';
        reason = `📛 HALT: Cumulative R-loss is ${aggregatedStats.sumLossR}R across ${aggregatedStats.lossesWithR} similar losses (avg ${aggregatedStats.avgR}R). Few-but-deep failure pattern — magnitude and frequency both confirm.`;
        mandatoryQuestions.push('The pattern has not just repeated, it has bled severely. What evidence shows the next attempt will not repeat the same depth of loss?');
        // Surface any matching severity insight from the post-mortem
        // store as an additional mandatory question — quoting the user's
        // own past lesson is more persuasive than generic questions.
        const severityQuestion = buildSeverityMandatoryQuestion(setup, synthesis.attributedInsights);
        if (severityQuestion) mandatoryQuestions.push(severityQuestion);
    }

    // REDUCE SIZE CONDITIONS
    else if (aggregatedStats.winRate < 45 && aggregatedStats.sampleSize >= 3) {
        gateResult = 'REDUCE_SIZE';
        reason = `⚠️ REDUCE SIZE: Below-average win rate of ${aggregatedStats.winRate}% for this setup type.`;
        mandatoryQuestions.push('Is this trade being taken purely on hope rather than evidence?');
    }

    // Check worst historical R
    else if (aggregatedStats.worstR <= -1.5) {
        gateResult = 'REDUCE_SIZE';
        reason = `⚠️ REDUCE SIZE: Similar setups have experienced extended losses (worst: ${aggregatedStats.worstR}R).`;
        mandatoryQuestions.push('Is the stop loss placed beyond the typical extended SL zone?');
    }

    // WARNING CONDITIONS
    else if (losses.length >= 2 || warnings.length >= 2) {
        // Surface avgR so the model can reason about expected value even
        // when the threshold-based rules don't fire. Frequency + magnitude
        // both visible to the moderator.
        const rContext = aggregatedStats.lossesWithR > 0
            ? ` avgR ${aggregatedStats.avgR >= 0 ? '+' : ''}${aggregatedStats.avgR}R, sumLossR ${aggregatedStats.sumLossR}R.`
            : '.';
        gateResult = 'WARNING';
        reason = `⚡ WARNING: ${losses.length} similar losses detected. ${warnings.length} active warnings.${rContext}`;
        mandatoryQuestions.push('Are all warning conditions addressed in the analysis?');
    }

    // PASS - all clear
    else {
        gateResult = 'PASS';
        reason = aggregatedStats.sampleSize >= 3
            ? `✅ PASS: ${aggregatedStats.winRate}% historical win rate (N=${aggregatedStats.sampleSize}).`
            : '✅ PASS: Insufficient historical data to assess (proceed with standard caution).';
    }

    return {
        allowed: gateResult !== 'HALT',
        gateResult,
        reason,
        mandatoryQuestions,
        historicalFailures: losses,
        severityInsights: synthesis.attributedInsights.filter(
            i => i.sourceProvider === 'pattern-memory-severity-detector'
        )
    };
}

/**
 * Generate enforcement context for moderator prompt injection.
 * This is the STRICT version that forces the moderator to address pattern memory.
 */
export function generatePatternMemoryEnforcementContext(
    setup: SetupContext,
    trades: LoggedTrade[]
): string {
    const gate = generateMandatoryPatternCheck(setup, trades);
    const synthesis = synthesizePatternMemory(setup, trades);

    // Severity auto-record (analysis-time): if the historical cluster for
    // this setup is a cumulative bleed (sumLossR <= -3R across 2+ R-bearing
    // losses), record it NOW — pre-trade — so the moderator quotes the
    // user's own "this setup bled N R" lesson while they're still deciding.
    // Shares the exact trigger with the post-mortem job (same
    // extractCumulativeBleedInsight threshold), so the pre-trade warning and
    // the post-trade lesson stay in sync. Self-gating (shallow clusters
    // write nothing) and idempotent (re-runs update in place), and it
    // reuses synthesis.aggregatedStats — no extra aggregation cost.
    try {
        const bleedInsight = extractCumulativeBleedInsight(
            { trades, stats: synthesis.aggregatedStats },
            setup
        );
        if (bleedInsight) {
            recordSeverityInsight(bleedInsight);
            console.log(`[PatternMemory] Auto-recorded cumulative-bleed insight (${bleedInsight.pnlR}R) for ${setup.coin || 'any'}/${setup.family || 'any'}`);
        }
    } catch (e) {
        // The record must never break the enforcement context build.
        console.warn('[PatternMemory] Severity auto-record failed:', e);
    }

    let context = `
**🧠 MANDATORY PATTERN MEMORY CHECK**

${gate.reason}

`;

    // Add historical stats
    context += `**Historical Performance:**
- Sample Size: ${synthesis.aggregatedStats.sampleSize} similar trades
- Win Rate: ${synthesis.aggregatedStats.winRate}%
- Avg R: ${synthesis.aggregatedStats.avgR >= 0 ? '+' : ''}${synthesis.aggregatedStats.avgR}R
- Worst R: ${synthesis.aggregatedStats.worstR}R
- Cumulative Loss: ${synthesis.aggregatedStats.sumLossR}R (across ${synthesis.aggregatedStats.lossesWithR} R-bearing losses)
`;

    // Add similar trades summary
    if (synthesis.relevantTrades.length > 0) {
        context += `\n**Most Similar Historical Trades:**\n`;
        synthesis.relevantTrades.forEach((t, i) => {
            const icon = t.outcome === 'WIN' ? '✅' : t.outcome === 'LOSS' ? '❌' : '⚖️';
            context += `${i + 1}. ${icon} ${t.coin} ${t.direction} (${t.similarity}% match) - "${t.keyLesson.slice(0, 80)}..."\n`;
        });
    }

    // Surface severity-tagged insights with priority. These are the
    // user's own R-weighted post-mortem conclusions ("this setup bled 6R
    // total — damage is severity, not frequency") and they are the most
    // actionable signal the moderator can quote when challenging the
    // analysts.
    if (gate.severityInsights.length > 0) {
        context += `\n**🩸 SEVERITY INSIGHTS (R-weighted, from your own post-mortems):**\n`;
        gate.severityInsights.forEach((insight, i) => {
            context += `${i + 1}. "${insight.insight}" (quality: ${insight.qualityScore}/100)\n`;
            // Surfaced to the moderator → counts as "used" so the quality
            // ratio (timesHelpful / timesUsed) can move.
            markInsightUsed(insight.id);
        });
    }

    // Add mandatory questions
    if (gate.mandatoryQuestions.length > 0) {
        context += `\n**⚠️ MANDATORY QUESTIONS (MUST BE ADDRESSED):**\n`;
        gate.mandatoryQuestions.forEach((q, i) => {
            context += `${i + 1}. ${q}\n`;
        });
    }

    // Add enforcement instructions based on gate result
    context += `\n**MODERATOR ENFORCEMENT:**\n`;
    switch (gate.gateResult) {
        case 'HALT':
            context += `🚫 **DO NOT APPROVE THIS TRADE** unless ALL mandatory questions are satisfactorily answered.
If analysts cannot justify why this trade would succeed where similar setups failed, the final verdict MUST be **AVOID**.`;
            break;
        case 'REDUCE_SIZE':
            context += `📉 **RECOMMEND REDUCED POSITION SIZE** (50% or less of normal).
The final verdict should include an explicit size reduction recommendation.`;
            break;
        case 'WARNING':
            context += `⚡ **PROCEED WITH CAUTION** - Ensure all warnings are acknowledged in the final verdict.`;
            break;
        case 'PASS':
            context += `✅ Pattern memory check passed. Proceed with standard analysis.`;
            break;
    }

    return context.trim();
}
