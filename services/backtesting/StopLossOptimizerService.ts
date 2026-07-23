/**
 * StopLossOptimizerService
 * Tracks historical SL behavior and suggests optimal placement based on YOUR data
 * 
 * Key insight: Many losses are "missed wins" where a slightly wider SL would have
 * kept the trade alive to hit TP. This service analyzes your historical data to
 * suggest optimal SL multipliers.
 */

import { LoggedTrade, TradeOutcome } from '../../types';

// ============================================================================
// TYPES
// ============================================================================

export interface SLOptimization {
    // Overall recommendation
    recommendedMultiplier: number;      // e.g., 1.3 = use 130% of standard SL distance
    currentDefault: number;             // What ATR multiplier is typically used (1.0)

    // Key metrics
    totalAnalyzed: number;
    missedWinCount: number;
    missedWinRate: number;              // % of losses that were missed wins
    avgMissedWinExtraDistance: number;  // How much wider SL was needed on average (%)

    extendedZoneBreachRate: number;     // How often trades hit 150% zone

    // Kelly Metrics
    kellyScoreOriginal: number;
    kellyScoreOptimized: number;
    optimalPositionSize: number;        // Recommended fractional Kelly size (e.g. 0.3 for 30% risk)

    // Context-specific recommendations
    byFamily: Record<string, { multiplier: number; sampleSize: number; missedWinRate: number }>;
    byCoin: Record<string, { multiplier: number; sampleSize: number; missedWinRate: number }>;
    byDirection: {
        long: { multiplier: number; sampleSize: number; missedWinRate: number };
        short: { multiplier: number; sampleSize: number; missedWinRate: number };
    };

    // Confidence in recommendation
    confidence: 'high' | 'medium' | 'low';  // Based on sample size

    // AI prompt injection
    promptInjection: string;
}

export interface SLOptimizationData {
    slWasTouched: boolean;             // Did price touch original SL?
    extendedZoneBreached: boolean;     // Exceeded 150% zone?
    missedWinDueToTightSL: boolean;    // Would have won with wider SL?
    maxAdverseExcursion: number;       // Max price movement against position (%)
    minSlDistanceNeeded?: number;      // If missed win, what SL % would have saved it
    atrMultiplierUsed: number;         // ATR multiplier of original SL
}

// ============================================================================
// CONSTANTS
// ============================================================================

const MIN_TRADES_FOR_RECOMMENDATION = 5;
const MIN_TRADES_FOR_HIGH_CONFIDENCE = 20;
const MIN_TRADES_FOR_CONTEXT_SPECIFIC = 3;

// ============================================================================
// CORE FUNCTIONS
// ============================================================================

/**
 * Calculate Kelly Score
 * f* = (p * b - q) / b
 */
function calculateKellyScore(winRate: number, rRatio: number): number {
    if (rRatio <= 0) return 0;
    const p = winRate;
    const q = 1 - p;
    return Math.max(0, (p * rRatio - q) / rRatio);
}

/**
 * Calculate optimal SL based on historical trade data
 */
export const calculateOptimalSL = (
    trades: LoggedTrade[],
    context?: { coin?: string; family?: string; direction?: 'Long' | 'Short' }
): SLOptimization => {
    // Filter to trades with SL optimization data
    const tradesWithData = trades.filter(t =>
        t.slOptimizationData &&
        (t.outcome === TradeOutcome.WIN || t.outcome === TradeOutcome.LOSS)
    );

    if (tradesWithData.length < MIN_TRADES_FOR_RECOMMENDATION) {
        return getDefaultOptimization(tradesWithData.length);
    }

    // Calculate missed wins
    const losses = tradesWithData.filter(t => t.outcome === TradeOutcome.LOSS);
    const missedWins = losses.filter(t => t.slOptimizationData?.missedWinDueToTightSL);
    const missedWinRate = losses.length > 0 ? (missedWins.length / losses.length) * 100 : 0;

    // Calculate average extra distance needed
    let avgExtraDistance = 0;
    if (missedWins.length > 0) {
        const extraDistances = missedWins
            .filter(t => t.slOptimizationData?.minSlDistanceNeeded)
            .map(t => {
                const originalDistance = parseSlDistance(t);
                const neededDistance = t.slOptimizationData!.minSlDistanceNeeded!;
                return neededDistance - originalDistance;
            });

        if (extraDistances.length > 0) {
            avgExtraDistance = extraDistances.reduce((a, b) => a + b, 0) / extraDistances.length;
        }
    }

    // Calculate extended zone breach rate
    const extendedBreaches = losses.filter(t => t.slOptimizationData?.extendedZoneBreached);
    const extendedZoneBreachRate = losses.length > 0
        ? (extendedBreaches.length / losses.length) * 100
        : 0;

    // Calculate recommended multiplier using Kelly Criterion
    let recommendedMultiplier = 1.0;

    // Baseline metrics (Current Performance)
    const totalWins = tradesWithData.filter(t => t.outcome === TradeOutcome.WIN).length;
    const currentWinRate = totalWins / tradesWithData.length;
    // Estimate current R:R (defaulting to 2.0 if unknown, ideally tracked)
    const currentRR = 2.0;

    // Optimized metrics (If we used wider SL)
    // New wins = Current Wins + Missed Wins
    const potentialWins = totalWins + missedWins.length;
    const potentialWinRate = potentialWins / tradesWithData.length;

    // If we widen SL, R:R decreases proportionally
    // e.g., 1.5x SL means R:R becomes 2.0 / 1.5 = 1.33
    const avgMultiplierNeeded = 1.0 + (avgExtraDistance / 100);
    const optimizedMultiplier = Math.max(1.0, avgMultiplierNeeded * 1.1); // Add 10% buffer
    const potentialRR = currentRR / optimizedMultiplier;

    // Compare Kelly Scores
    const kellyOriginal = calculateKellyScore(currentWinRate, currentRR);
    const kellyOptimized = calculateKellyScore(potentialWinRate, potentialRR);

    // Decision Logic: Switch if Kelly score improves by at least 10%
    if (kellyOptimized > kellyOriginal * 1.1) {
        recommendedMultiplier = Math.min(1.5, optimizedMultiplier); // Cap at 1.5x
    }

    // Calculate optimal position size (Half-Kelly for safety)
    const optimalKellyContext = kellyOptimized > kellyOriginal ? kellyOptimized : kellyOriginal;
    const safePositionSize = optimalKellyContext * 0.5; // Standard practice: Half-Kelly

    // Calculate context-specific recommendations
    const byFamily = calculateByDimension(tradesWithData, 'family');
    const byCoin = calculateByDimension(tradesWithData, 'coin');
    const byDirection = {
        long: calculateForDirection(tradesWithData, 'Long'),
        short: calculateForDirection(tradesWithData, 'Short')
    };

    // Apply context filter if provided
    if (context) {
        if (context.family && byFamily[context.family]) {
            const familyRec = byFamily[context.family];
            if (familyRec.sampleSize >= MIN_TRADES_FOR_CONTEXT_SPECIFIC) {
                recommendedMultiplier = familyRec.multiplier;
            }
        }
        if (context.coin && byCoin[context.coin]) {
            const coinRec = byCoin[context.coin];
            if (coinRec.sampleSize >= MIN_TRADES_FOR_CONTEXT_SPECIFIC) {
                recommendedMultiplier = coinRec.multiplier;
            }
        }
    }

    // Determine confidence
    let confidence: 'high' | 'medium' | 'low' = 'low';
    if (tradesWithData.length >= MIN_TRADES_FOR_HIGH_CONFIDENCE) {
        confidence = 'high';
    } else if (tradesWithData.length >= MIN_TRADES_FOR_RECOMMENDATION) {
        confidence = 'medium';
    }

    return {
        recommendedMultiplier,
        currentDefault: 1.0,
        totalAnalyzed: tradesWithData.length,
        missedWinCount: missedWins.length,
        missedWinRate,
        avgMissedWinExtraDistance: avgExtraDistance,
        extendedZoneBreachRate,
        byFamily,
        byCoin,
        byDirection,
        confidence,
        kellyScoreOriginal: kellyOriginal,
        kellyScoreOptimized: kellyOptimized,
        optimalPositionSize: safePositionSize,
        promptInjection: generateSLOptimizationPrompt({
            recommendedMultiplier,
            missedWinRate,
            avgMissedWinExtraDistance: avgExtraDistance,
            totalAnalyzed: tradesWithData.length,
            confidence,
            kellyImprovement: kellyOptimized > kellyOriginal ? ((kellyOptimized / kellyOriginal - 1) * 100) : 0,
            optimalPositionSize: safePositionSize
        })
    };
};

/**
 * Track SL outcome when a trade is logged
 * Call this when recording trade outcome with price data
 */
export const trackSLOutcome = (
    trade: LoggedTrade,
    priceData: {
        minPrice: number;   // Lowest price during trade (for longs)
        maxPrice: number;   // Highest price during trade (for shorts)
    }
): SLOptimizationData | undefined => {
    if (!trade.analysis?.entryPoints?.[0]?.price || !trade.analysis?.stopLoss) {
        return undefined;
    }

    const entry = parseFloat(trade.analysis.entryPoints[0].price.replace(/[^0-9.-]/g, ''));
    const stopLoss = parseFloat(trade.analysis.stopLoss.replace(/[^0-9.-]/g, ''));
    const direction = trade.analysis.direction;

    if (!entry || !stopLoss) return undefined;

    const slDistance = Math.abs(entry - stopLoss);
    const slDistancePercent = (slDistance / entry) * 100;
    const extendedSL = direction === 'Long'
        ? entry - (slDistance * 1.5)
        : entry + (slDistance * 1.5);

    // Calculate max adverse excursion
    const adversePrice = direction === 'Long' ? priceData.minPrice : priceData.maxPrice;
    const maxAdverseExcursion = Math.abs((adversePrice - entry) / entry) * 100;

    // Determine if SL was touched
    const slWasTouched = direction === 'Long'
        ? priceData.minPrice <= stopLoss
        : priceData.maxPrice >= stopLoss;

    // Determine if extended zone was breached
    const extendedZoneBreached = direction === 'Long'
        ? priceData.minPrice <= extendedSL
        : priceData.maxPrice >= extendedSL;

    // Determine if this was a missed win
    const takeProfit1 = trade.analysis.takeProfit?.[0]?.price;
    let hitTP = false;
    if (takeProfit1) {
        const tp = parseFloat(takeProfit1.replace(/[^0-9.-]/g, ''));
        hitTP = direction === 'Long'
            ? priceData.maxPrice >= tp
            : priceData.minPrice <= tp;
    }

    const missedWinDueToTightSL = slWasTouched && !extendedZoneBreached && hitTP &&
        trade.outcome === TradeOutcome.LOSS;

    // Calculate minimum SL distance needed if missed win
    let minSlDistanceNeeded: number | undefined;
    if (missedWinDueToTightSL) {
        const worstPoint = direction === 'Long' ? priceData.minPrice : priceData.maxPrice;
        const neededDistance = Math.abs(worstPoint - entry);
        minSlDistanceNeeded = (neededDistance / entry) * 100 * 1.1; // Add 10% buffer
    }

    return {
        slWasTouched,
        extendedZoneBreached,
        missedWinDueToTightSL,
        maxAdverseExcursion,
        minSlDistanceNeeded,
        atrMultiplierUsed: 1.0 // Default, can be enhanced to track actual multiplier
    };
};

/**
 * Generate warning for TradeValidationGate
 */
export const generateSLOptimizationWarning = (opt: SLOptimization): string | null => {
    if (opt.missedWinRate <= 15) return null;

    if (opt.missedWinRate > 30) {
        return `📊 HIGH MISSED WIN RATE: ${opt.missedWinRate.toFixed(0)}% of losses could have been wins. Widen SL by ${((opt.recommendedMultiplier - 1) * 100).toFixed(0)}%.`;
    }

    return `⚠️ MODERATE MISSED WINS: ${opt.missedWinRate.toFixed(0)}% of losses were missed wins. SL may be too tight.`;
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function getDefaultOptimization(currentSampleSize: number): SLOptimization {
    return {
        recommendedMultiplier: 1.0,
        currentDefault: 1.0,
        totalAnalyzed: currentSampleSize,
        missedWinCount: 0,
        missedWinRate: 0,
        avgMissedWinExtraDistance: 0,
        extendedZoneBreachRate: 0,
        byFamily: {},
        byCoin: {},
        byDirection: {
            long: { multiplier: 1.0, sampleSize: 0, missedWinRate: 0 },
            short: { multiplier: 1.0, sampleSize: 0, missedWinRate: 0 }
        },
        confidence: 'low',
        kellyScoreOriginal: 0,
        kellyScoreOptimized: 0,
        optimalPositionSize: 0,
        promptInjection: `**📊 SL OPTIMIZATION: Insufficient data (${currentSampleSize}/${MIN_TRADES_FOR_RECOMMENDATION} trades needed)**\nUsing default 1x ATR stop loss. Log more trades to get personalized recommendations.`
    };
}

function parseSlDistance(trade: LoggedTrade): number {
    const entry = parseFloat(trade.analysis?.entryPoints?.[0]?.price?.replace(/[^0-9.-]/g, '') || '0');
    const sl = parseFloat(trade.analysis?.stopLoss?.replace(/[^0-9.-]/g, '') || '0');
    if (!entry || !sl) return 0;
    return Math.abs((sl - entry) / entry) * 100;
}

function calculateByDimension(
    trades: LoggedTrade[],
    dimension: 'family' | 'coin'
): Record<string, { multiplier: number; sampleSize: number; missedWinRate: number }> {
    const groups: Record<string, LoggedTrade[]> = {};

    for (const trade of trades) {
        const key = dimension === 'family'
            ? trade.analysis?.detectedPatternFamily
            : trade.analysis?.coinName;
        if (!key) continue;

        if (!groups[key]) groups[key] = [];
        groups[key].push(trade);
    }

    const result: Record<string, { multiplier: number; sampleSize: number; missedWinRate: number }> = {};

    for (const [key, groupTrades] of Object.entries(groups)) {
        if (groupTrades.length < MIN_TRADES_FOR_CONTEXT_SPECIFIC) continue;

        const losses = groupTrades.filter(t => t.outcome === TradeOutcome.LOSS);
        const missedWins = losses.filter(t => t.slOptimizationData?.missedWinDueToTightSL);
        const missedWinRate = losses.length > 0 ? (missedWins.length / losses.length) * 100 : 0;

        let multiplier = 1.0;
        if (missedWinRate > 30) multiplier = 1.3;
        else if (missedWinRate > 15) multiplier = 1.15;

        result[key] = { multiplier, sampleSize: groupTrades.length, missedWinRate };
    }

    return result;
}

function calculateForDirection(
    trades: LoggedTrade[],
    direction: 'Long' | 'Short'
): { multiplier: number; sampleSize: number; missedWinRate: number } {
    const filtered = trades.filter(t => t.analysis?.direction === direction);
    if (filtered.length < MIN_TRADES_FOR_CONTEXT_SPECIFIC) {
        return { multiplier: 1.0, sampleSize: filtered.length, missedWinRate: 0 };
    }

    const losses = filtered.filter(t => t.outcome === TradeOutcome.LOSS);
    const missedWins = losses.filter(t => t.slOptimizationData?.missedWinDueToTightSL);
    const missedWinRate = losses.length > 0 ? (missedWins.length / losses.length) * 100 : 0;

    let multiplier = 1.0;
    if (missedWinRate > 30) multiplier = 1.3;
    else if (missedWinRate > 15) multiplier = 1.15;

    return { multiplier, sampleSize: filtered.length, missedWinRate };
}

function generateSLOptimizationPrompt(data: {
    recommendedMultiplier: number;
    missedWinRate: number;
    avgMissedWinExtraDistance: number;
    totalAnalyzed: number;

    confidence: 'high' | 'medium' | 'low';
    kellyImprovement?: number;
    optimalPositionSize?: number;
}): string {
    const emoji = data.missedWinRate > 30 ? '❌' :
        data.missedWinRate > 15 ? '⚠️' : '✅';

    if (data.recommendedMultiplier > 1.0) {
        return `
${emoji} **DYNAMIC SL OPTIMIZATION (Compounding Growth Focus)**
Based on ${data.totalAnalyzed} trades (${data.confidence} confidence):

📊 **Analysis:**
- Current Missed Wins: ${data.missedWinRate.toFixed(1)}% of losses
- Kelly Growth Improvement: +${data.kellyImprovement?.toFixed(1) || 0}% w/ wider SL

🎯 **RECOMMENDATION: Use ${(data.recommendedMultiplier * 100).toFixed(0)}% of Standard SL Distance**
- Why: Mathematical growth rate is higher despite lower R:R.
- **Optimal Sizing:** Risk ${(data.optimalPositionSize! * 100).toFixed(1)}% of capital (Half-Kelly).

⚠️ **ACTION:** Widen SL by ${((data.recommendedMultiplier - 1) * 100).toFixed(0)}% and adjust size.
`;
    }

    return `
✅ **DYNAMIC SL OPTIMIZATION (Based on ${data.totalAnalyzed} trades)**
Your current SL placement is effective. Missed win rate: ${data.missedWinRate.toFixed(1)}%.
Continue using standard 1x ATR stop loss distance.
`;
}
