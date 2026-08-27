/**
 * SelfLearningService
 * Meta-learning over trade outcomes: computes the personalized learning
 * profile (strengths/weaknesses, per-dimension win rates, confidence
 * calibration) consumed by the learning dashboard and the debate context.
 */

import { LoggedTrade, TradeOutcome } from '../../types';
import { ConfidenceLevel } from '../validation/ConfidenceCalibrationService';

/**
 * Personalized learning profile computed from trade history
 */
export interface PersonalizedLearningProfile {
    // Best performing setups
    bestCoins: { coin: string; winRate: number; count: number }[];
    bestPatterns: { pattern: string; winRate: number; count: number }[];
    bestTimeframes: { tf: string; winRate: number; count: number }[];
    bestDirections: { direction: string; winRate: number; count: number }[];
    bestRegimes: { regime: string; winRate: number; count: number }[];

    // Worst performing setups
    worstSetups: { description: string; winRate: number; count: number }[];

    // Confidence calibration insights
    confidenceAccuracy: { level: ConfidenceLevel; winRate: number; count: number }[];

    // Overall stats
    totalAnalyzedTrades: number;
    overallWinRate: number;
    lastUpdated: string;
}

// Minimum trades needed for statistical significance
const MIN_TRADES_FOR_STATS = 3;

/**
 * Extract coin name from trade analysis with multiple fallbacks
 * Checks: coinName -> coin -> asset -> entry point descriptions -> 'UNKNOWN'
 */
const extractCoinName = (trade: LoggedTrade): string => {
    const analysis = trade.analysis;
    if (!analysis) return 'UNKNOWN';

    // Primary: coinName field
    if (analysis.coinName) {
        return analysis.coinName.toUpperCase().replace(/USDT?$/, '');
    }

    // Fallback 1: Check for coin or asset fields (some AI responses use these)
    const anyAnalysis = analysis as any;
    if (anyAnalysis.coin) {
        return String(anyAnalysis.coin).toUpperCase().replace(/USDT?$/, '');
    }
    if (anyAnalysis.asset) {
        return String(anyAnalysis.asset).toUpperCase().replace(/USDT?$/, '');
    }
    if (anyAnalysis.symbol) {
        return String(anyAnalysis.symbol).toUpperCase().replace(/USDT?$/, '');
    }

    // Fallback 2: Extract from entry point descriptions
    if (analysis.entryPoints && analysis.entryPoints.length > 0) {
        const entryDesc = analysis.entryPoints[0].description || '';
        const coinMatch = entryDesc.match(/\b([A-Z]{2,10})(USDT?|\/USDT?)?\b/i);
        if (coinMatch && coinMatch[1] && coinMatch[1].length >= 2) {
            return coinMatch[1].toUpperCase();
        }
    }

    // Fallback 3: Extract from strategy text
    if (analysis.strategy) {
        const strategyMatch = analysis.strategy.match(/\b([A-Z]{2,10})(USDT?|\/USDT?)?\b/);
        if (strategyMatch && strategyMatch[1]) {
            return strategyMatch[1].toUpperCase();
        }
    }

    return 'UNKNOWN';
};

/**
 * Extract pattern family from trade analysis with multiple fallbacks
 * Checks: detectedPatternFamily -> patternFamily -> marketConditions.pattern -> strategy keywords
 */
const extractPatternFamily = (trade: LoggedTrade): string => {
    const analysis = trade.analysis;
    if (!analysis) return 'UNKNOWN';

    // Primary: detectedPatternFamily
    if (analysis.detectedPatternFamily) {
        const family = analysis.detectedPatternFamily.trim();
        // Exclude mode-specific placeholder values
        if (!['pure ai pattern', 'pure ai analysis', 'custom', 'unknown family', 'unknown', 'n/a'].includes(family.toLowerCase())) {
            return family;
        }
    }

    // Fallback 1: Check for patternFamily field
    const anyAnalysis = analysis as any;
    if (anyAnalysis.patternFamily) {
        return String(anyAnalysis.patternFamily);
    }

    // Fallback 2: marketConditions.pattern
    if (analysis.marketConditions?.pattern) {
        const pattern = analysis.marketConditions.pattern.trim();
        if (pattern && pattern.toLowerCase() !== 'unknown') {
            return pattern;
        }
    }

    // Fallback 3: Infer from strategy keywords
    if (analysis.strategy) {
        const stratLower = analysis.strategy.toLowerCase();
        if (stratLower.includes('breakout') || stratLower.includes('continuation')) {
            return 'Breakout/Continuation';
        }
        if (stratLower.includes('reversal') || stratLower.includes('bounce')) {
            return 'Reversal';
        }
        if (stratLower.includes('range') || stratLower.includes('support') || stratLower.includes('resistance')) {
            return 'Range/S&R';
        }
        if (stratLower.includes('retest') || stratLower.includes('pullback')) {
            return 'Pullback/Retest';
        }
    }

    // Fallback 4: Check activeStrategies
    if (analysis.activeStrategies && analysis.activeStrategies.length > 0) {
        return analysis.activeStrategies[0];
    }

    return 'UNKNOWN';
};

/**
 * Extract direction from trade analysis with fallbacks
 */
const extractDirection = (trade: LoggedTrade): string => {
    const analysis = trade.analysis;
    if (!analysis) return 'UNKNOWN';

    // Primary: direction field
    if (analysis.direction && analysis.direction !== 'Neutral') {
        return analysis.direction;
    }

    // Fallback: Check strategy text for direction hints
    if (analysis.strategy) {
        const stratLower = analysis.strategy.toLowerCase();
        if (stratLower.includes('long') || stratLower.includes('buy') || stratLower.includes('bullish')) {
            return 'Long';
        }
        if (stratLower.includes('short') || stratLower.includes('sell') || stratLower.includes('bearish')) {
            return 'Short';
        }
    }

    return analysis.direction || 'UNKNOWN';
};

/**
 * Extract market regime from trade analysis
 * Classifies into: TRENDING, RANGING, REVERSAL, VOLATILE, or UNKNOWN
 */
const extractRegime = (trade: LoggedTrade): string => {
    const analysis = trade.analysis;
    if (!analysis) return 'UNKNOWN';

    // Check marketRegime field first (added to LoggedTrade)
    if (trade.marketRegime) {
        return trade.marketRegime.toUpperCase();
    }

    // Check pattern for regime hints
    const pattern = (analysis.marketConditions?.pattern || '').toLowerCase();
    const strategy = (analysis.strategy || '').toLowerCase();
    const combined = `${pattern} ${strategy}`;

    if (combined.includes('trend') || combined.includes('continuation') || combined.includes('breakout')) {
        return 'TRENDING';
    }
    if (combined.includes('range') || combined.includes('compression') || combined.includes('consolidat')) {
        return 'RANGING';
    }
    if (combined.includes('reversal') || combined.includes('counter') || combined.includes('bounce')) {
        return 'REVERSAL';
    }
    if (combined.includes('volatil') || combined.includes('chop')) {
        return 'VOLATILE';
    }

    return 'UNKNOWN';
};

/**
 * Compute personalized learning profile from trade history
 */
export const computeLearningProfile = (trades: LoggedTrade[]): PersonalizedLearningProfile => {
    const relevantTrades = trades.filter(t =>
        t.outcome === TradeOutcome.WIN || t.outcome === TradeOutcome.LOSS
    );

    if (relevantTrades.length === 0) {
        return {
            bestCoins: [],
            bestPatterns: [],
            bestTimeframes: [],
            bestDirections: [],
            bestRegimes: [],
            worstSetups: [],
            confidenceAccuracy: [],
            totalAnalyzedTrades: 0,
            overallWinRate: 0,
            lastUpdated: new Date().toISOString()
        };
    }

    // Aggregate stats by different dimensions using robust extraction functions
    const coinStats = aggregateStats(relevantTrades, extractCoinName);
    const patternStats = aggregateStats(relevantTrades, extractPatternFamily);
    const directionStats = aggregateStats(relevantTrades, extractDirection);
    const confidenceStats = aggregateStats(relevantTrades, t => t.analysis?.confidence || 'UNKNOWN');

    // Detect regime using robust extraction
    const regimeStats = aggregateStats(relevantTrades, extractRegime);

    // Calculate overall win rate
    const wins = relevantTrades.filter(t => t.outcome === TradeOutcome.WIN).length;
    const overallWinRate = Math.round((wins / relevantTrades.length) * 100);

    // Sort and filter for significance
    const sortByWinRate = (a: any, b: any) => b.winRate - a.winRate;
    const filterSignificant = (stats: any[]) => stats.filter(s => s.count >= MIN_TRADES_FOR_STATS);

    // Find worst setups (combinations that consistently lose)
    const worstSetups = findWorstSetups(relevantTrades);

    return {
        bestCoins: filterSignificant(coinStats).sort(sortByWinRate).slice(0, 5),
        bestPatterns: filterSignificant(patternStats).sort(sortByWinRate).slice(0, 5),
        bestTimeframes: [], // Timeframe not always tracked in current schema
        bestDirections: filterSignificant(directionStats).sort(sortByWinRate),
        bestRegimes: filterSignificant(regimeStats).sort(sortByWinRate),
        worstSetups: worstSetups.slice(0, 5),
        confidenceAccuracy: confidenceStats
            // 'UNKNOWN' (trades without a recorded confidence) is not a real
            // ConfidenceLevel — casting it poisons downstream calibration math.
            .filter(c => c.name !== 'UNKNOWN')
            .map(c => ({
            level: c.name as ConfidenceLevel,
            winRate: c.winRate,
            count: c.count
        })),
        totalAnalyzedTrades: relevantTrades.length,
        overallWinRate,
        lastUpdated: new Date().toISOString()
    };
};

/**
 * Aggregate stats by a grouping function
 */
const aggregateStats = (
    trades: LoggedTrade[],
    groupFn: (trade: LoggedTrade) => string
): { name: string; winRate: number; count: number; wins: number }[] => {
    const groups: Record<string, { wins: number; total: number }> = {};

    for (const trade of trades) {
        const key = groupFn(trade);
        if (!groups[key]) groups[key] = { wins: 0, total: 0 };
        groups[key].total++;
        if (trade.outcome === TradeOutcome.WIN) groups[key].wins++;
    }

    return Object.entries(groups).map(([name, stats]) => ({
        name,
        winRate: Math.round((stats.wins / stats.total) * 100),
        count: stats.total,
        wins: stats.wins
    }));
};

/**
 * Find worst performing setup combinations
 * Note: Uses robust extraction to identify coins and patterns
 */
const findWorstSetups = (trades: LoggedTrade[]): { description: string; winRate: number; count: number }[] => {
    // Group by coin + direction + pattern family
    const setupGroups: Record<string, { wins: number; total: number }> = {};

    // Mode-specific pattern values to exclude (not actual pattern families)
    const modePatternValues = ['pure ai pattern', 'pure ai analysis', 'custom', 'unknown family', 'unknown', 'n/a'];

    for (const trade of trades) {
        // Use robust extraction functions
        const coin = extractCoinName(trade);
        const direction = extractDirection(trade);
        const rawFamily = extractPatternFamily(trade);

        // Check if this is a real Family classification or a mode-specific value
        const isRealFamily = rawFamily && !modePatternValues.includes(rawFamily.toLowerCase());
        const family = isRealFamily ? rawFamily : null;

        // Build key: coin + direction (+ family if it's a real one)
        const key = family ? `${coin} + ${direction} + ${family}` : `${coin} + ${direction}`;
        if (!setupGroups[key]) setupGroups[key] = { wins: 0, total: 0 };
        setupGroups[key].total++;
        if (trade.outcome === TradeOutcome.WIN) setupGroups[key].wins++;
    }

    return Object.entries(setupGroups)
        .filter(([_, stats]) => stats.total >= MIN_TRADES_FOR_STATS)
        .map(([description, stats]) => ({
            description,
            winRate: Math.round((stats.wins / stats.total) * 100),
            count: stats.total
        }))
        .filter(s => s.winRate < 50) // Only show losing setups
        .sort((a, b) => a.winRate - b.winRate); // Worst first
};

