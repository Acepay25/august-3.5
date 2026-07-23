/**
 * SelfLearningService
 * Core orchestrator for processing trade outcomes and extracting lessons.
 * 
 * Features:
 * 1. Lesson extraction from each trade
 * 2. Real-time calibration updates
 * 3. Meta-learning computation (strengths/weaknesses)
 * 4. Setup-specific performance tracking
 */

import { LoggedTrade, TradeOutcome, TradeAnalysis } from '../../types';
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

/**
 * Setup-specific statistics
 */
export interface SetupSpecificStats {
    winRate: number;
    totalTrades: number;
    wins: number;
    losses: number;
    confidence: 'high' | 'medium' | 'low' | 'insufficient';
    note: string;
}

/**
 * Lesson extracted from a trade
 */
export interface TradeLesson {
    type: 'strength' | 'weakness' | 'pattern' | 'warning';
    category: string;
    message: string;
    actionable: string;
}

// Minimum trades needed for statistical significance
const MIN_TRADES_FOR_STATS = 3;
const MIN_TRADES_FOR_HIGH_CONFIDENCE = 10;

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
        confidenceAccuracy: confidenceStats.map(c => ({
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

/**
 * Get setup-specific statistics for the current trade context
 */
export const getSetupSpecificStats = (
    trades: LoggedTrade[],
    currentSetup: { coin?: string; pattern?: string; direction?: string; regime?: string }
): SetupSpecificStats | null => {
    const { coin, pattern, direction, regime } = currentSetup;

    // Find trades matching this exact setup using robust extraction
    const matchingTrades = trades.filter(t => {
        if (t.outcome !== TradeOutcome.WIN && t.outcome !== TradeOutcome.LOSS) return false;

        let matches = true;
        const tradeCoin = extractCoinName(t);
        const tradeDirection = extractDirection(t);
        const tradePattern = extractPatternFamily(t);

        if (coin && tradeCoin !== coin.toUpperCase()) matches = false;
        if (direction && tradeDirection !== direction) matches = false;
        if (pattern && !tradePattern.toLowerCase().includes(pattern.toLowerCase())) matches = false;

        return matches;
    });

    if (matchingTrades.length < MIN_TRADES_FOR_STATS) {
        return null;
    }

    const wins = matchingTrades.filter(t => t.outcome === TradeOutcome.WIN).length;
    const losses = matchingTrades.length - wins;
    const winRate = Math.round((wins / matchingTrades.length) * 100);

    // Determine confidence in the stat
    const confidence: 'high' | 'medium' | 'low' | 'insufficient' =
        matchingTrades.length >= MIN_TRADES_FOR_HIGH_CONFIDENCE ? 'high' :
            matchingTrades.length >= 5 ? 'medium' : 'low';

    // Generate human-readable note
    const setupDesc = [coin, direction, pattern].filter(Boolean).join(' + ');
    const note = winRate >= 60
        ? `🟢 Strong performer! Your ${setupDesc} trades win ${winRate}% (n=${matchingTrades.length})`
        : winRate >= 50
            ? `🟡 Average setup. Your ${setupDesc} win rate is ${winRate}% (n=${matchingTrades.length})`
            : `🔴 Warning! Your ${setupDesc} trades only win ${winRate}% (n=${matchingTrades.length})`;

    return {
        winRate,
        totalTrades: matchingTrades.length,
        wins,
        losses,
        confidence,
        note
    };
};

/**
 * Extract lessons from a completed trade
 */
export const extractLessonsFromTrade = (
    trade: LoggedTrade,
    profile: PersonalizedLearningProfile
): TradeLesson[] => {
    const lessons: TradeLesson[] = [];
    const analysis = trade.analysis;
    if (!analysis) return lessons;

    // Use robust extraction functions
    const coin = extractCoinName(trade);
    const direction = extractDirection(trade);
    const confidence = analysis.confidence || 'Unknown';
    const outcome = trade.outcome;

    // Check if this coin is historically strong or weak
    const coinStat = profile.bestCoins.find(c => c.coin === coin);
    if (coinStat) {
        if (coinStat.winRate >= 60 && outcome === TradeOutcome.WIN) {
            lessons.push({
                type: 'strength',
                category: 'coin',
                message: `${coin} remains a strong coin for you (${coinStat.winRate}% win rate)`,
                actionable: `Continue prioritizing ${coin} setups`
            });
        } else if (coinStat.winRate < 45 && outcome === TradeOutcome.LOSS) {
            lessons.push({
                type: 'warning',
                category: 'coin',
                message: `${coin} continues to underperform (${coinStat.winRate}% win rate)`,
                actionable: `Consider reducing position size or avoiding ${coin}`
            });
        }
    }

    // Check confidence calibration
    const confStat = profile.confidenceAccuracy.find(c => c.level === confidence);
    if (confStat && confStat.count >= 5) {
        if (confidence === 'High' && confStat.winRate < 60) {
            lessons.push({
                type: 'warning',
                category: 'calibration',
                message: `Your "High" confidence trades only win ${confStat.winRate}%`,
                actionable: 'AI may be overconfident - consider stricter entry criteria'
            });
        }
    }

    // Detect pattern-based lessons
    const pattern = analysis.detectedPatternFamily || '';
    const patternStat = profile.bestPatterns.find(p =>
        pattern.toLowerCase().includes(p.pattern.toLowerCase())
    );
    if (patternStat && patternStat.winRate < 40 && outcome === TradeOutcome.LOSS) {
        lessons.push({
            type: 'pattern',
            category: 'pattern',
            message: `${pattern} patterns have low success rate (${patternStat.winRate}%)`,
            actionable: `Be more selective with ${pattern} setups`
        });
    }

    return lessons;
};

/**
 * Generate learning-aware context for AI prompts
 */
export const generateLearningContext = (
    profile: PersonalizedLearningProfile,
    currentSetup?: { coin?: string; pattern?: string; direction?: string }
): string => {
    if (profile.totalAnalyzedTrades < MIN_TRADES_FOR_STATS) {
        return ''; // Not enough data yet
    }

    let context = `
═══════════════════════════════════════════════════════════════
📊 PERSONALIZED LEARNING CONTEXT (Based on ${profile.totalAnalyzedTrades} trades)
═══════════════════════════════════════════════════════════════
`;

    // Overall performance
    context += `\n**Overall Win Rate:** ${profile.overallWinRate}%\n`;

    // Best coins
    if (profile.bestCoins.length > 0) {
        const topCoins = profile.bestCoins.slice(0, 3);
        context += `\n**User's Best Coins:**\n`;
        topCoins.forEach(c => {
            context += `- ${c.coin}: ${c.winRate}% win rate (n=${c.count})\n`;
        });
    }

    // Best patterns
    if (profile.bestPatterns.length > 0) {
        const topPatterns = profile.bestPatterns.slice(0, 3);
        context += `\n**User's Best Patterns:**\n`;
        topPatterns.forEach(p => {
            context += `- ${p.pattern}: ${p.winRate}% win rate (n=${p.count})\n`;
        });
    }

    // Worst setups - CRITICAL WARNINGS
    if (profile.worstSetups.length > 0) {
        context += `\n⚠️ **SETUPS TO AVOID (User historically loses):**\n`;
        profile.worstSetups.slice(0, 3).forEach(s => {
            context += `- ${s.description}: Only ${s.winRate}% win rate (n=${s.count})\n`;
        });
    }

    // Confidence calibration
    const highConf = profile.confidenceAccuracy.find(c => c.level === 'High');
    const medConf = profile.confidenceAccuracy.find(c => c.level === 'Medium');
    if (highConf && highConf.count >= 5) {
        context += `\n**Confidence Calibration:**\n`;
        context += `- High confidence trades: ${highConf.winRate}% actual win rate (n=${highConf.count})\n`;
        if (medConf && medConf.count >= 5) {
            context += `- Medium confidence trades: ${medConf.winRate}% actual win rate (n=${medConf.count})\n`;
        }
        if (highConf.winRate < 55) {
            context += `⚠️ High confidence is OVERCONFIDENT - apply stricter criteria!\n`;
        }
    }

    // Current setup warnings
    if (currentSetup?.coin) {
        const coinWorse = profile.worstSetups.find(s =>
            s.description.includes(currentSetup.coin!.toUpperCase())
        );
        if (coinWorse) {
            context += `\n🚨 **CURRENT SETUP WARNING:** ${coinWorse.description} has poor historical performance (${coinWorse.winRate}%)\n`;
        }
    }

    context += `═══════════════════════════════════════════════════════════════\n`;

    return context;
};
