/**
 * AdaptiveLearningService
 * Analyzes past trades to provide contextual learning feedback for AI prompts.
 * 
 * Features:
 * - Find similar trades by coin, pattern, direction, and regime
 * - Extract lessons from similar trade outcomes
 * - Generate prompt injections with historical performance data
 */

import { LoggedTrade, TradeAnalysis, TradeOutcome, TradeLessons } from '../../types';

// Minimum trades needed before showing adaptive feedback
const MIN_TRADES_FOR_FEEDBACK = 5;
// Maximum similar trades to analyze
const MAX_SIMILAR_TRADES = 10;

/**
 * Calculate similarity score between current setup and a historical trade
 * Higher score = more similar
 */
function calculateSimilarity(
    currentCoin: string | undefined,
    currentPattern: string | undefined,
    currentDirection: 'Long' | 'Short' | 'Neutral',
    currentRegime: string | undefined,
    historicalTrade: LoggedTrade
): number {
    let score = 0;
    const analysis = historicalTrade.analysis;

    // Coin match (highest weight - 40 points)
    if (currentCoin && analysis.coinName) {
        const normCurrent = currentCoin.toUpperCase().replace('USDT', '').replace('USD', '');
        const normHistorical = analysis.coinName.toUpperCase().replace('USDT', '').replace('USD', '');
        if (normCurrent === normHistorical) {
            score += 40;
        }
    }

    // Pattern/Family match (high weight - 30 points)
    if (currentPattern && analysis.detectedPatternFamily) {
        if (currentPattern.toLowerCase() === analysis.detectedPatternFamily.toLowerCase()) {
            score += 30;
        } else if (
            currentPattern.toLowerCase().includes(analysis.detectedPatternFamily.toLowerCase()) ||
            analysis.detectedPatternFamily.toLowerCase().includes(currentPattern.toLowerCase())
        ) {
            score += 15; // Partial match
        }
    }

    // Direction match (medium weight - 20 points)
    if (currentDirection === analysis.direction) {
        score += 20;
    }

    // Regime match (lower weight - 10 points)
    // Try to extract regime from market conditions
    if (currentRegime && analysis.marketConditions) {
        const mcPattern = analysis.marketConditions.pattern?.toLowerCase() || '';
        if (
            (currentRegime === 'trending' && (mcPattern.includes('trend') || mcPattern.includes('breakout'))) ||
            (currentRegime === 'ranging' && (mcPattern.includes('range') || mcPattern.includes('consolidat'))) ||
            (currentRegime === 'volatile' && (mcPattern.includes('volatile') || mcPattern.includes('choppy')))
        ) {
            score += 10;
        }
    }

    return score;
}

/**
 * Find trades similar to the current setup
 */
export function findSimilarTrades(
    currentCoin: string | undefined,
    currentPattern: string | undefined,
    currentDirection: 'Long' | 'Short' | 'Neutral',
    currentRegime: string | undefined,
    tradeLog: LoggedTrade[]
): LoggedTrade[] {
    // Only consider trades with definitive outcomes
    const completedTrades = tradeLog.filter(
        t => t.outcome === TradeOutcome.WIN || t.outcome === TradeOutcome.LOSS
    );

    if (completedTrades.length < MIN_TRADES_FOR_FEEDBACK) {
        return [];
    }

    // Calculate similarity scores
    const scoredTrades = completedTrades.map(trade => ({
        trade,
        score: calculateSimilarity(currentCoin, currentPattern, currentDirection, currentRegime, trade)
    }));

    // Filter out trades with 0 similarity (no match at all)
    const relevantTrades = scoredTrades.filter(st => st.score > 0);

    // Sort by score descending and take top trades
    return relevantTrades
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_SIMILAR_TRADES)
        .map(st => st.trade);
}

/**
 * Extract lessons from similar trades
 */
export function extractLessonsFromSimilarTrades(similarTrades: LoggedTrade[]): TradeLessons | null {
    if (similarTrades.length === 0) {
        return null;
    }

    const wins = similarTrades.filter(t => t.outcome === TradeOutcome.WIN);
    const losses = similarTrades.filter(t => t.outcome === TradeOutcome.LOSS);
    const winRate = Math.round((wins.length / similarTrades.length) * 100);

    // Analyze failure reasons from post-mortems
    const commonFailures: string[] = [];
    const successPatterns: string[] = [];

    // Extract insights from losing trades with post-mortems
    for (const loss of losses) {
        if (loss.postMortem) {
            const pm = loss.postMortem.toLowerCase();
            // Look for common failure patterns
            if (pm.includes('early') || pm.includes('premature')) {
                if (!commonFailures.includes('Premature entry before confirmation')) {
                    commonFailures.push('Premature entry before confirmation');
                }
            }
            if (pm.includes('stop') && (pm.includes('tight') || pm.includes('close'))) {
                if (!commonFailures.includes('Stop loss too tight')) {
                    commonFailures.push('Stop loss too tight');
                }
            }
            if (pm.includes('trend') && (pm.includes('against') || pm.includes('counter'))) {
                if (!commonFailures.includes('Trading against the trend')) {
                    commonFailures.push('Trading against the trend');
                }
            }
            if (pm.includes('volume') && (pm.includes('low') || pm.includes('lack'))) {
                if (!commonFailures.includes('Insufficient volume confirmation')) {
                    commonFailures.push('Insufficient volume confirmation');
                }
            }
            if (pm.includes('overleverage') || pm.includes('too much leverage')) {
                if (!commonFailures.includes('Overleveraged position')) {
                    commonFailures.push('Overleveraged position');
                }
            }
        }
    }

    // Extract success patterns from winning trades
    for (const win of wins) {
        if (win.postMortem) {
            const pm = win.postMortem.toLowerCase();
            if (pm.includes('confirm') || pm.includes('wait')) {
                if (!successPatterns.includes('Waited for confirmation')) {
                    successPatterns.push('Waited for confirmation');
                }
            }
            if (pm.includes('pullback') || pm.includes('retest')) {
                if (!successPatterns.includes('Entered on pullback/retest')) {
                    successPatterns.push('Entered on pullback/retest');
                }
            }
            if (pm.includes('confluence') || pm.includes('multiple')) {
                if (!successPatterns.includes('Multiple confluence factors aligned')) {
                    successPatterns.push('Multiple confluence factors aligned');
                }
            }
        }
    }

    return {
        similarCount: similarTrades.length,
        winCount: wins.length,
        lossCount: losses.length,
        winRate,
        commonFailures: commonFailures.slice(0, 3), // Top 3 failures
        successPatterns: successPatterns.slice(0, 3) // Top 3 success patterns
    };
}

/**
 * Generate AI prompt injection with adaptive learning feedback
 * This provides historical context to help AI make better recommendations
 */
export function generateAdaptiveFeedbackInjection(
    currentCoin: string | undefined,
    currentPattern: string | undefined,
    currentDirection: 'Long' | 'Short' | 'Neutral',
    currentRegime: string | undefined,
    tradeLog: LoggedTrade[]
): string {
    // Find similar trades
    const similarTrades = findSimilarTrades(
        currentCoin,
        currentPattern,
        currentDirection,
        currentRegime,
        tradeLog
    );

    if (similarTrades.length === 0) {
        return ''; // No relevant historical data
    }

    const lessons = extractLessonsFromSimilarTrades(similarTrades);
    if (!lessons) {
        return '';
    }

    // Build the prompt injection
    const parts: string[] = [];
    parts.push('📚 **LEARNING FROM YOUR TRADE HISTORY**');
    parts.push('');

    // Setup description
    const setupDesc: string[] = [];
    if (currentCoin) setupDesc.push(currentCoin);
    if (currentPattern) setupDesc.push(currentPattern);
    if (currentDirection !== 'Neutral') setupDesc.push(currentDirection);

    const setupStr = setupDesc.length > 0 ? setupDesc.join(' ') : 'similar';

    // Performance summary
    const perfEmoji = lessons.winRate >= 60 ? '✅' : lessons.winRate >= 45 ? '⚠️' : '❌';
    parts.push(`${perfEmoji} **Your ${setupStr} setups:** ${lessons.winCount}W / ${lessons.lossCount}L (${lessons.winRate}% win rate from ${lessons.similarCount} trades)`);

    // Common failures
    if (lessons.commonFailures.length > 0) {
        parts.push('');
        parts.push('**Common failure reasons in similar trades:**');
        for (const failure of lessons.commonFailures) {
            parts.push(`  ⚠️ ${failure}`);
        }
    }

    // Success patterns
    if (lessons.successPatterns.length > 0) {
        parts.push('');
        parts.push('**What worked in winning trades:**');
        for (const pattern of lessons.successPatterns) {
            parts.push(`  ✓ ${pattern}`);
        }
    }

    // Instruction for AI
    parts.push('');
    parts.push('**INSTRUCTION:** Factor this historical data into your analysis. If win rate is low, be more conservative with confidence. Warn about common failure patterns.');

    return parts.join('\n');
}

/**
 * Extract context from analysis for matching
 */
export function extractContextFromAnalysis(analysis: TradeAnalysis): {
    coin: string | undefined;
    pattern: string | undefined;
    direction: 'Long' | 'Short' | 'Neutral';
    regime: string | undefined;
} {
    // Try to determine regime from market conditions
    let regime: string | undefined;
    if (analysis.marketConditions) {
        const pattern = analysis.marketConditions.pattern?.toLowerCase() || '';
        if (pattern.includes('trend') || pattern.includes('breakout')) {
            regime = 'trending';
        } else if (pattern.includes('range') || pattern.includes('consolidat')) {
            regime = 'ranging';
        } else if (pattern.includes('volatile') || pattern.includes('choppy')) {
            regime = 'volatile';
        }
    }

    return {
        coin: analysis.coinName,
        pattern: analysis.detectedPatternFamily,
        direction: analysis.direction,
        regime
    };
}

/**
 * Convenience function to generate feedback from an analysis object
 */
export function generateFeedbackFromAnalysis(
    analysis: TradeAnalysis,
    tradeLog: LoggedTrade[]
): string {
    const context = extractContextFromAnalysis(analysis);
    return generateAdaptiveFeedbackInjection(
        context.coin,
        context.pattern,
        context.direction,
        context.regime,
        tradeLog
    );
}
