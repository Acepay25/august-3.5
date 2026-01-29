/**
 * ScalpDetectionService - Auto-detection and validation for scalp trades
 * 
 * Features:
 * - Auto-detects trade type based on SL%, strategy keywords, and validity window
 * - Provides scalp-specific validation rules
 * - Calculates scalp-specific risk parameters
 */

import { TradeAnalysis, LoggedTrade, TradeOutcome } from '../types';

// ============================================================================
// TYPES
// ============================================================================

export type TradeType = 'scalp' | 'swing';

export interface ScalpDetectionResult {
    detectedType: TradeType;
    confidence: 'high' | 'medium' | 'low';
    reasons: string[];
    suggestedValidityMinutes: number;
}

export interface ScalpValidationResult {
    isValid: boolean;
    warnings: string[];
    shouldDowngrade: boolean;
}

// ============================================================================
// DETECTION THRESHOLDS
// ============================================================================

const SCALP_THRESHOLDS = {
    // SL percentage threshold - below this is considered scalp
    maxSlPercentage: 1.0,

    // Validity window threshold - below this is considered scalp
    maxValidityMinutes: 30,

    // R:R minimum for scalps (can be lower than swings)
    minScalpRR: 1.0,

    // R:R minimum for swings
    minSwingRR: 1.5,

    // Strategy keywords that indicate scalp
    scalpKeywords: ['scalp', 'quick', 'fast', 'micro', '1m', '5m', 'momentum'],

    // Strategy keywords that indicate swing
    swingKeywords: ['swing', 'position', 'macro', 'daily', '4h', '1d', 'weekly']
};

// ============================================================================
// DETECTION FUNCTIONS
// ============================================================================

/**
 * Auto-detects whether a trade is a scalp or swing based on multiple factors.
 * Returns detection result with confidence and reasons.
 */
export const detectTradeType = (analysis: TradeAnalysis): ScalpDetectionResult => {
    const reasons: string[] = [];
    let scalpScore = 0;
    let swingScore = 0;

    // Factor 1: SL Percentage
    if (analysis.stopLossPercentage) {
        const slPercent = parseFloat(analysis.stopLossPercentage.replace(/[^0-9.-]/g, ''));
        if (!isNaN(slPercent)) {
            if (slPercent <= SCALP_THRESHOLDS.maxSlPercentage) {
                scalpScore += 3;
                reasons.push(`Tight SL (${slPercent}% ≤ ${SCALP_THRESHOLDS.maxSlPercentage}%)`);
            } else if (slPercent > 2.0) {
                swingScore += 2;
                reasons.push(`Wide SL (${slPercent}% > 2%)`);
            }
        }
    }

    // Factor 2: Validity Duration
    if (analysis.validityDurationMinutes !== undefined) {
        if (analysis.validityDurationMinutes <= SCALP_THRESHOLDS.maxValidityMinutes) {
            scalpScore += 2;
            reasons.push(`Short validity (${analysis.validityDurationMinutes}min)`);
        } else if (analysis.validityDurationMinutes > 120) {
            swingScore += 2;
            reasons.push(`Long validity (${analysis.validityDurationMinutes}min)`);
        }
    }

    // Factor 3: Strategy Keywords
    const strategyLower = (analysis.strategy || '').toLowerCase();

    for (const keyword of SCALP_THRESHOLDS.scalpKeywords) {
        if (strategyLower.includes(keyword)) {
            scalpScore += 2;
            reasons.push(`Strategy contains "${keyword}"`);
            break;
        }
    }

    for (const keyword of SCALP_THRESHOLDS.swingKeywords) {
        if (strategyLower.includes(keyword)) {
            swingScore += 2;
            reasons.push(`Strategy contains "${keyword}"`);
            break;
        }
    }

    // Factor 4: Pattern timeframe (if available)
    if (analysis.detectedPatterns && analysis.detectedPatterns.length > 0) {
        const timeframes = analysis.detectedPatterns.map(p => p.timeframe.toLowerCase());
        if (timeframes.some(tf => ['1m', '5m', '15m'].includes(tf))) {
            scalpScore += 1;
            reasons.push('Pattern on short timeframe');
        }
        if (timeframes.some(tf => ['4h', '1d', 'daily', 'weekly'].includes(tf))) {
            swingScore += 1;
            reasons.push('Pattern on higher timeframe');
        }
    }

    // Determine result
    const detectedType: TradeType = scalpScore > swingScore ? 'scalp' : 'swing';
    const scoreDiff = Math.abs(scalpScore - swingScore);
    const confidence: 'high' | 'medium' | 'low' =
        scoreDiff >= 3 ? 'high' :
            scoreDiff >= 1 ? 'medium' : 'low';

    // Suggested validity based on type
    const suggestedValidityMinutes = detectedType === 'scalp' ? 20 : 330;

    return {
        detectedType,
        confidence,
        reasons,
        suggestedValidityMinutes
    };
};

/**
 * Validates a scalp trade with scalp-specific rules.
 * Returns validation result with warnings specific to scalp trading.
 */
export const validateScalpTrade = (
    analysis: TradeAnalysis,
    sessionInfo?: { currentSession: string; isWeekend: boolean }
): ScalpValidationResult => {
    const warnings: string[] = [];
    let shouldDowngrade = false;

    // Parse entry and SL for R:R calculation
    const entryPrice = parseFloat(
        analysis.entryPoints[0]?.price?.replace(/[^0-9.-]/g, '') || '0'
    );
    const slPrice = parseFloat(
        analysis.stopLoss?.replace(/[^0-9.-]/g, '') || '0'
    );
    const tp1Price = parseFloat(
        analysis.takeProfit?.[0]?.price?.replace(/[^0-9.-]/g, '') || '0'
    );

    // Rule 1: Scalp-specific R:R check (relaxed to 1:1)
    if (entryPrice > 0 && slPrice > 0 && tp1Price > 0) {
        const isLong = analysis.direction === 'Long';
        const risk = isLong ? entryPrice - slPrice : slPrice - entryPrice;
        const reward = isLong ? tp1Price - entryPrice : entryPrice - tp1Price;

        if (risk > 0 && reward > 0) {
            const rrRatio = reward / risk;
            if (rrRatio < SCALP_THRESHOLDS.minScalpRR) {
                warnings.push(`⚡ SCALP R:R ${rrRatio.toFixed(2)}:1 below minimum 1:1`);
                shouldDowngrade = true;
            }
        }
    }

    // Rule 2: Session check - scalps are risky in off-hours
    if (sessionInfo) {
        if (sessionInfo.currentSession === 'off_hours') {
            warnings.push('⚡ SCALP WARNING: Off-hours - wider spreads, slippage risk');
            shouldDowngrade = true;
        }

        if (sessionInfo.isWeekend) {
            warnings.push('⚡ SCALP AVOID: Weekend scalping is extremely risky');
            shouldDowngrade = true;
        }
    }

    // Rule 3: High confidence scalps need very tight SL
    if (analysis.confidence === 'High' && analysis.stopLossPercentage) {
        const slPercent = parseFloat(analysis.stopLossPercentage.replace(/[^0-9.-]/g, ''));
        if (!isNaN(slPercent) && slPercent > 0.8) {
            warnings.push(`⚡ SCALP: High confidence but SL ${slPercent}% is loose for a scalp`);
        }
    }

    return {
        isValid: warnings.length === 0,
        warnings,
        shouldDowngrade
    };
};

/**
 * Validates a swing trade with swing-specific rules.
 */
export const validateSwingTrade = (
    analysis: TradeAnalysis
): ScalpValidationResult => {
    const warnings: string[] = [];
    let shouldDowngrade = false;

    // Parse prices
    const entryPrice = parseFloat(
        analysis.entryPoints[0]?.price?.replace(/[^0-9.-]/g, '') || '0'
    );
    const slPrice = parseFloat(
        analysis.stopLoss?.replace(/[^0-9.-]/g, '') || '0'
    );
    const tp1Price = parseFloat(
        analysis.takeProfit?.[0]?.price?.replace(/[^0-9.-]/g, '') || '0'
    );

    // Rule 1: Swing requires minimum 1.5:1 R:R
    if (entryPrice > 0 && slPrice > 0 && tp1Price > 0) {
        const isLong = analysis.direction === 'Long';
        const risk = isLong ? entryPrice - slPrice : slPrice - entryPrice;
        const reward = isLong ? tp1Price - entryPrice : entryPrice - tp1Price;

        if (risk > 0 && reward > 0) {
            const rrRatio = reward / risk;
            if (rrRatio < SCALP_THRESHOLDS.minSwingRR) {
                warnings.push(`📊 SWING: R:R ${rrRatio.toFixed(2)}:1 below recommended ${SCALP_THRESHOLDS.minSwingRR}:1`);
            }
        }
    }

    // Rule 2: Swing trades should have longer validity
    if (analysis.validityDurationMinutes !== undefined && analysis.validityDurationMinutes < 60) {
        warnings.push(`📊 SWING: Short validity window (${analysis.validityDurationMinutes}min) - consider extending`);
    }

    return {
        isValid: warnings.length === 0,
        warnings,
        shouldDowngrade
    };
};

// ============================================================================
// STATISTICS FUNCTIONS
// ============================================================================

/**
 * Calculates performance statistics segmented by trade type.
 */
export const getTradeTypeStats = (trades: LoggedTrade[]): {
    scalp: { wins: number; losses: number; winRate: number; avgPnL: number };
    swing: { wins: number; losses: number; winRate: number; avgPnL: number };
} => {
    const scalpTrades = trades.filter(t =>
        t.tradeType === 'scalp' || t.analysis.tradeType === 'scalp'
    );
    const swingTrades = trades.filter(t =>
        t.tradeType === 'swing' || t.analysis.tradeType === 'swing' ||
        (!t.tradeType && !t.analysis.tradeType) // Default to swing for legacy trades
    );

    const calcStats = (tradeList: LoggedTrade[]) => {
        const wins = tradeList.filter(t => t.outcome === TradeOutcome.WIN).length;
        const losses = tradeList.filter(t => t.outcome === TradeOutcome.LOSS).length;
        const total = wins + losses;
        const winRate = total > 0 ? (wins / total) * 100 : 0;

        const pnlSum = tradeList.reduce((sum, t) => sum + (t.pnlAmount || 0), 0);
        const avgPnL = total > 0 ? pnlSum / total : 0;

        return { wins, losses, winRate, avgPnL };
    };

    return {
        scalp: calcStats(scalpTrades),
        swing: calcStats(swingTrades)
    };
};

/**
 * Applies auto-detected trade type to an analysis if not already set.
 * Respects manual overrides.
 */
export const applyTradeTypeToAnalysis = (analysis: TradeAnalysis): TradeAnalysis => {
    // Skip if manually overridden
    if (analysis.tradeTypeManualOverride && analysis.tradeType) {
        return analysis;
    }

    const detection = detectTradeType(analysis);

    return {
        ...analysis,
        tradeType: detection.detectedType,
        // Update validity if not already set
        validityDurationMinutes: analysis.validityDurationMinutes ?? detection.suggestedValidityMinutes
    };
};
