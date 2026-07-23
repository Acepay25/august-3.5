/**
 * AccuracyValidationService
 * Central validation layer for enhancing trading analysis accuracy
 * 
 * Provides validation functions for:
 * - Multi-timeframe confluence
 * - Risk/Reward validation with ATR-based stops
 * - Volume confirmation
 * - Market regime awareness
 * - Devil's Advocate analysis
 * - Candle confirmation
 * 
 * ENHANCED VERSION - Includes:
 * - Point-based confidence cascade (cumulative penalties)
 * - Named constants for all thresholds
 */

import { TechnicalIndicators, ConfluenceResult, RegimeAnalysis, AdvancedVolumeAnalysis } from '../analysis/TechnicalAnalysisService';
import { HybridDataPacket } from '../analysis/HybridIntelligenceService';
import { ConfidenceCalibration, CorrelationRiskResult } from '../../types';
import { getCalibrationSummary, getCalibratedWinRateWithDecay } from './ConfidenceCalibrationService';
import {
    calculateCorrelationRisk,
    generateCorrelationWarnings,
    generateCorrelationRiskPrompt
} from '../analysis/CorrelationRiskService';
import {
    CONFIDENCE_BASE_SCORE,
    CONFIDENCE_THRESHOLDS,
    CONFIDENCE_PENALTIES,
    MIN_TRADES_FOR_CALIBRATION
} from '../../constants/calibrationConstants';

// ============================================================================
// TYPES
// ============================================================================

export type ConfidenceLevel = 'High' | 'Medium' | 'Low' | 'Avoid';
export type TradeDirection = 'Long' | 'Short';

export interface ValidationResult {
    isValid: boolean;
    warnings: string[];
    errors: string[];
    adjustedConfidence?: ConfidenceLevel;
    validationScore: number; // 0-100
    /** Point deductions applied (for transparency in debugging) */
    penalties?: { reason: string; points: number }[];
}

export interface RiskRewardValidation {
    isValid: boolean;
    ratio: number;
    minRequired: number;
    stopLossPercent: number;
    atrBasedStopSuggestion: number;
    warnings: string[];
}

export interface DevilsAdvocateResult {
    bearCaseReasons: string[];
    tradeFailureScenarios: string[];
    liquidityTrapWarning: boolean;
    fatigueIndicators: string[];
    overallRiskScore: number; // 0-100, higher = riskier
}

export interface CandleConfirmationResult {
    isConfirmed: boolean;
    warning: string | null;
    suggestedAction: string;
}

// ============================================================================
// CONFIDENCE SCORE HELPERS (Point-based cascade system)
// ============================================================================

/**
 * Converts a confidence score (0-100) to a confidence level.
 * Uses thresholds from calibrationConstants.
 */
export const confidenceScoreToLevel = (score: number): ConfidenceLevel => {
    if (score >= CONFIDENCE_THRESHOLDS.HIGH) return 'High';
    if (score >= CONFIDENCE_THRESHOLDS.MEDIUM) return 'Medium';
    if (score >= CONFIDENCE_THRESHOLDS.LOW) return 'Low';
    return 'Avoid';
};

/**
 * Converts a confidence level to its base score.
 */
export const confidenceLevelToScore = (level: ConfidenceLevel): number => {
    switch (level) {
        case 'High': return CONFIDENCE_BASE_SCORE;
        case 'Medium': return CONFIDENCE_THRESHOLDS.HIGH - 1; // 79
        case 'Low': return CONFIDENCE_THRESHOLDS.MEDIUM - 1;  // 54
        case 'Avoid': return CONFIDENCE_THRESHOLDS.LOW - 1;   // 29
    }
};

/**
 * Applies a penalty to a confidence score.
 * Returns the new score and a record of the penalty applied.
 */
export const applyPenalty = (
    currentScore: number,
    penaltyPoints: number,
    reason: string
): { newScore: number; penalty: { reason: string; points: number } } => {
    const newScore = Math.max(0, currentScore - penaltyPoints);
    return {
        newScore,
        penalty: { reason, points: penaltyPoints }
    };
};

// ============================================================================
// MULTI-TIMEFRAME CONFLUENCE VALIDATION
// ============================================================================


/**
 * Validates that multiple timeframes agree on the trade direction
 * Requires at least 2 timeframes to agree for High confidence
 * Requires at least 3 for trades with large position sizes
 */
export const validateMultiTimeframeConfluence = (
    confluence: ConfluenceResult,
    proposedDirection: TradeDirection,
    proposedConfidence: ConfidenceLevel
): ValidationResult => {
    const warnings: string[] = [];
    const errors: string[] = [];
    let adjustedConfidence = proposedConfidence;

    // Check if confluence agrees with proposed direction
    const confluenceDirection = confluence.direction;
    const expectedDirection = proposedDirection === 'Long' ? 'bullish' : 'bearish';

    if (confluenceDirection !== expectedDirection && confluenceDirection !== 'neutral') {
        errors.push(`⚠️ CONFLUENCE CONFLICT: MTF confluence is ${confluenceDirection.toUpperCase()} but trade is ${proposedDirection}`);
        adjustedConfidence = 'Avoid';
    }

    // Check confluence score requirements based on confidence
    if (proposedConfidence === 'High') {
        if (confluence.score < 65 && proposedDirection === 'Long') {
            warnings.push(`High confidence requires MTF score ≥65 for Long trades (current: ${confluence.score})`);
            adjustedConfidence = 'Medium';
        }
        if (confluence.score > 35 && proposedDirection === 'Short') {
            warnings.push(`High confidence requires MTF score ≤35 for Short trades (current: ${confluence.score})`);
            adjustedConfidence = 'Medium';
        }
    }

    // Check for conflicts
    if (confluence.conflicts.length >= 3) {
        warnings.push(`Multiple conflicting signals detected (${confluence.conflicts.length}). Consider waiting for clarity.`);
        if (adjustedConfidence === 'High') {
            adjustedConfidence = 'Medium';
        }
    }

    // Validate strength
    if (confluence.strength === 'weak' && proposedConfidence !== 'Low' && proposedConfidence !== 'Avoid') {
        warnings.push('Weak MTF confluence detected. Consider reducing position size.');
    }

    const validationScore = Math.abs(confluence.score - 50) * 2; // 0-100 based on distance from neutral

    return {
        isValid: errors.length === 0,
        warnings,
        errors,
        adjustedConfidence,
        validationScore
    };
};

// ============================================================================
// RISK/REWARD VALIDATION
// ============================================================================

/**
 * Validates Risk/Reward ratio with ATR-based stop loss checks
 * - High confidence: Requires R:R >= 2.0
 * - Medium confidence: Requires R:R >= 1.5
 * - Low confidence: Requires R:R >= 1.2
 * - Also validates that stop loss is at least 1x ATR from entry
 */
export const validateRiskReward = (
    entryPrice: number,
    stopLoss: number,
    takeProfit1: number,
    atr: number,
    proposedConfidence: ConfidenceLevel
): RiskRewardValidation => {
    const warnings: string[] = [];

    // Calculate R:R
    const risk = Math.abs(entryPrice - stopLoss);
    const reward = Math.abs(takeProfit1 - entryPrice);
    const ratio = risk > 0 ? reward / risk : 0;

    // Calculate stop loss as percentage
    const stopLossPercent = (risk / entryPrice) * 100;

    // ATR-based stop suggestion (1.5x ATR is commonly used)
    const atrBasedStopSuggestion = atr * 1.5;

    // Minimum R:R requirements by confidence
    const minRatioByConfidence: Record<ConfidenceLevel, number> = {
        'High': 2.0,
        'Medium': 1.5,
        'Low': 1.2,
        'Avoid': 1.0
    };

    const minRequired = minRatioByConfidence[proposedConfidence];

    // Validate R:R
    let isValid = ratio >= minRequired;

    if (ratio < minRequired) {
        warnings.push(`R:R ratio (${ratio.toFixed(2)}) below required minimum (${minRequired}) for ${proposedConfidence} confidence`);
    }

    // Validate stop loss is not too tight (should be at least 1x ATR)
    if (risk < atr) {
        warnings.push(`⚠️ TIGHT STOP: Stop loss (${risk.toFixed(2)}) is tighter than 1x ATR (${atr.toFixed(2)}). High chance of being stopped out by noise.`);
        isValid = false;
    }

    // Warn if stop is excessively wide (more than 3x ATR)
    if (risk > atr * 3) {
        warnings.push(`Wide stop loss (${(risk / atr).toFixed(1)}x ATR). Consider reducing position size.`);
    }

    // Check if stop respects common structure
    if (stopLossPercent > 5) {
        warnings.push(`Stop loss is ${stopLossPercent.toFixed(1)}% from entry - ensure this aligns with key structure levels.`);
    }

    return {
        isValid,
        ratio,
        minRequired,
        stopLossPercent,
        atrBasedStopSuggestion,
        warnings
    };
};

// ============================================================================
// VOLUME CONFIRMATION
// ============================================================================

/**
 * Validates that volume supports the proposed trade direction
 * - Requires volume to be 'normal' or 'high' for trend trades
 * - Checks OBV divergence for reversal warnings
 * - Validates CVD alignment with direction
 */
export const validateVolumeConfirmation = (
    advancedVolume: AdvancedVolumeAnalysis,
    proposedDirection: TradeDirection,
    proposedConfidence: ConfidenceLevel
): ValidationResult => {
    const warnings: string[] = [];
    const errors: string[] = [];
    let adjustedConfidence = proposedConfidence;

    // Check volume trend
    if (advancedVolume.trend === 'low') {
        warnings.push('Low volume detected. Breakouts on low volume often fail (Family A trap pattern).');
        if (proposedConfidence === 'High') {
            adjustedConfidence = 'Medium';
        }
    }

    // Check OBV divergence
    const expectedDivergence = proposedDirection === 'Long' ? 'bullish' : 'bearish';
    const oppositeDivergence = proposedDirection === 'Long' ? 'bearish' : 'bullish';

    if (advancedVolume.obvDivergence === oppositeDivergence) {
        errors.push(`⚠️ DIVERGENCE ALERT: OBV shows ${advancedVolume.obvDivergence} divergence - contradicts ${proposedDirection} trade`);
        adjustedConfidence = 'Low';
    } else if (advancedVolume.obvDivergence === expectedDivergence) {
        // Positive confirmation
        warnings.push(`✅ OBV ${expectedDivergence} divergence supports ${proposedDirection} direction`);
    }

    // Check CVD alignment
    const expectedCVD = proposedDirection === 'Long' ? 'buyers_control' : 'sellers_control';
    const oppositeCVD = proposedDirection === 'Long' ? 'sellers_control' : 'buyers_control';

    if (advancedVolume.cvdTrend === oppositeCVD) {
        warnings.push(`CVD shows ${advancedVolume.cvdTrend.replace('_', ' ')} - opposite to ${proposedDirection} bias`);
        if (proposedConfidence === 'High') {
            adjustedConfidence = 'Medium';
        }
    }

    // Check volume-weighted bias
    const expectedBias = proposedDirection === 'Long' ? 'bullish' : 'bearish';
    if (advancedVolume.volumeWeightedBias !== expectedBias && advancedVolume.volumeWeightedBias !== 'neutral') {
        warnings.push(`Volume-weighted bias is ${advancedVolume.volumeWeightedBias}, not ${expectedBias}`);
    }

    // Calculate validation score
    let score = 50;
    if (advancedVolume.trend === 'high') score += 15;
    if (advancedVolume.trend === 'low') score -= 20;
    if (advancedVolume.obvDivergence === expectedDivergence) score += 15;
    if (advancedVolume.obvDivergence === oppositeDivergence) score -= 25;
    if (advancedVolume.cvdTrend === expectedCVD) score += 10;
    if (advancedVolume.cvdTrend === oppositeCVD) score -= 15;

    return {
        isValid: errors.length === 0,
        warnings,
        errors,
        adjustedConfidence,
        validationScore: Math.max(0, Math.min(100, score))
    };
};

// ============================================================================
// MARKET REGIME AWARENESS
// ============================================================================

/**
 * Validates that the proposed trade aligns with market regime
 * - Avoid counter-trend trades in strong trends
 * - Avoid breakout trades in ranging markets
 * - Suggest appropriate strategy based on regime
 */
export const validateMarketRegime = (
    regime: RegimeAnalysis,
    proposedDirection: TradeDirection,
    tradeType: 'continuation' | 'reversal' | 'breakout' | 'range'
): ValidationResult => {
    const warnings: string[] = [];
    const errors: string[] = [];
    let validationScore = 50;

    // Check for counter-trend trades in strong trends
    if (regime.regime === 'strong_trend_up' && proposedDirection === 'Short') {
        errors.push(`⚠️ COUNTER-TREND WARNING: Shorting in a STRONG UPTREND (ADX: ${regime.adx}). High failure rate.`);
        validationScore -= 30;
    }

    if (regime.regime === 'strong_trend_down' && proposedDirection === 'Long') {
        errors.push(`⚠️ COUNTER-TREND WARNING: Going Long in a STRONG DOWNTREND (ADX: ${regime.adx}). High failure rate.`);
        validationScore -= 30;
    }

    // Check for breakout trades in ranging markets
    if (regime.regime === 'ranging' && tradeType === 'breakout') {
        warnings.push(`Breakout trade in ranging market (ADX: ${regime.adx}). Wait for range resolution or use mean-reversion strategy.`);
        validationScore -= 15;
    }

    // Check for range trades in trending markets
    if ((regime.regime === 'strong_trend_up' || regime.regime === 'strong_trend_down') && tradeType === 'range') {
        warnings.push('Range trading strategy in trending market. Consider trend-following approach instead.');
        validationScore -= 10;
    }

    // Volatile chop warning
    if (regime.regime === 'volatile_chop') {
        warnings.push('⚡ VOLATILE CHOP detected. Reduce position size and use wider stops.');
        validationScore -= 20;
    }

    // Compression phase
    if (regime.regime === 'compression') {
        warnings.push('🔄 Market in COMPRESSION. Breakout imminent - wait for direction confirmation or risk false breakout.');
    }

    // Add regime recommendation
    if (regime.tradingBias === 'avoid') {
        errors.push(`Market regime suggests AVOIDING trades: ${regime.recommendation}`);
        validationScore -= 25;
    }

    // Boost score for aligned trades
    if (regime.tradingBias === 'trend_following' && tradeType === 'continuation') {
        validationScore += 20;
    }
    if (regime.tradingBias === 'mean_reversion' && tradeType === 'range') {
        validationScore += 20;
    }

    return {
        isValid: errors.length === 0,
        warnings,
        errors,
        validationScore: Math.max(0, Math.min(100, validationScore))
    };
};

// ============================================================================
// DEVIL'S ADVOCATE ANALYSIS
// ============================================================================

/**
 * Generates a "Devil's Advocate" analysis - finds reasons NOT to take the trade
 * This helps identify blind spots and potential failure scenarios
 */
export const generateDevilsAdvocateAnalysis = (
    data: HybridDataPacket,
    proposedDirection: TradeDirection,
    proposedEntry: number,
    proposedStopLoss: number
): DevilsAdvocateResult => {
    const bearCaseReasons: string[] = [];
    const tradeFailureScenarios: string[] = [];
    const fatigueIndicators: string[] = [];
    let overallRiskScore = 0;
    let liquidityTrapWarning = false;

    const indicators1h = data.indicators['1h'];
    const indicators4h = data.indicators['4h'];

    // 1. Check RSI extremes
    if (proposedDirection === 'Long' && indicators4h.rsi.rsi14 > 70) {
        bearCaseReasons.push(`RSI(14) at ${indicators4h.rsi.rsi14} on 4H - overbought territory, limited upside`);
        overallRiskScore += 15;
    }
    if (proposedDirection === 'Short' && indicators4h.rsi.rsi14 < 30) {
        bearCaseReasons.push(`RSI(14) at ${indicators4h.rsi.rsi14} on 4H - oversold territory, bounce likely`);
        overallRiskScore += 15;
    }

    // 2. Check MACD momentum fading
    if (proposedDirection === 'Long' && indicators1h.macd.histogram < indicators4h.macd.histogram * 0.8) {
        bearCaseReasons.push('MACD momentum is fading on lower timeframe - continuation may stall');
        overallRiskScore += 10;
    }

    // 3. Check for potential liquidity traps
    const priceFromHigh = ((data.marketData.price24hHigh - data.marketData.currentPrice) / data.marketData.currentPrice) * 100;
    const priceFromLow = ((data.marketData.currentPrice - data.marketData.price24hLow) / data.marketData.currentPrice) * 100;

    if (proposedDirection === 'Long' && priceFromHigh < 1) {
        liquidityTrapWarning = true;
        bearCaseReasons.push(`Price within 1% of 24H high ($${data.marketData.price24hHigh}) - potential liquidity grab zone`);
        tradeFailureScenarios.push('Stop hunt above 24H high followed by reversal');
        overallRiskScore += 20;
    }
    if (proposedDirection === 'Short' && priceFromLow < 1) {
        liquidityTrapWarning = true;
        bearCaseReasons.push(`Price within 1% of 24H low ($${data.marketData.price24hLow}) - potential liquidity grab zone`);
        tradeFailureScenarios.push('Stop hunt below 24H low followed by bounce');
        overallRiskScore += 20;
    }

    // 4. Check funding rate for crowded trades
    if (proposedDirection === 'Long' && data.fundingRate > 0.001) {
        bearCaseReasons.push(`High positive funding (${(data.fundingRate * 100).toFixed(3)}%) - longs are crowded, funding squeeze risk`);
        overallRiskScore += 10;
    }
    if (proposedDirection === 'Short' && data.fundingRate < -0.001) {
        bearCaseReasons.push(`High negative funding (${(data.fundingRate * 100).toFixed(3)}%) - shorts are crowded, squeeze risk`);
        overallRiskScore += 10;
    }

    // 5. Check derivatives sentiment for contrary positioning
    if (proposedDirection === 'Long' && data.derivatives.longShortRatio.sentiment === 'extreme_long') {
        bearCaseReasons.push('Extreme long positioning - contrarian signal suggests short squeeze is less likely');
        overallRiskScore += 10;
    }
    if (proposedDirection === 'Short' && data.derivatives.longShortRatio.sentiment === 'extreme_short') {
        bearCaseReasons.push('Extreme short positioning - squeeze risk is elevated');
        overallRiskScore += 10;
    }

    // 6. Check volume profile position
    if (data.advancedVolume.volumeProfile.priceVsPOC === 'at') {
        bearCaseReasons.push('Price at Volume POC - high friction zone, breakout may fail');
        overallRiskScore += 5;
    }

    // 7. Check for fatigue indicators
    if (data.momentum['4h'].momentum.includes('decelerating')) {
        fatigueIndicators.push(`4H momentum is ${data.momentum['4h'].momentum.replace('_', ' ')}`);
        overallRiskScore += 10;
    }

    if (indicators4h.bollingerBands.percentB > 95 && proposedDirection === 'Long') {
        fatigueIndicators.push('Price at upper Bollinger Band (>95% B) - extension fatigue');
        overallRiskScore += 10;
    }
    if (indicators4h.bollingerBands.percentB < 5 && proposedDirection === 'Short') {
        fatigueIndicators.push('Price at lower Bollinger Band (<5% B) - extension fatigue');
        overallRiskScore += 10;
    }

    // 8. Check Ichimoku for resistance/support
    if (proposedDirection === 'Long' && data.ichimoku['4h'].priceVsCloud === 'below') {
        bearCaseReasons.push('Price below Ichimoku cloud - cloud acts as resistance');
        tradeFailureScenarios.push('Rejection at cloud bottom');
        overallRiskScore += 15;
    }
    if (proposedDirection === 'Short' && data.ichimoku['4h'].priceVsCloud === 'above') {
        bearCaseReasons.push('Price above Ichimoku cloud - cloud acts as support');
        tradeFailureScenarios.push('Bounce from cloud top');
        overallRiskScore += 15;
    }

    // 9. Session timing risk
    if (data.session.volatilityExpectation === 'low' &&
        (data.session.sessionName === 'Asia_Early' || data.session.sessionName === 'Asia_Late')) {
        fatigueIndicators.push('Low volatility Asian session - breakouts less reliable');
        overallRiskScore += 5;
    }

    // Generate failure scenarios based on analysis
    if (liquidityTrapWarning) {
        tradeFailureScenarios.push('Liquidity sweep triggers stop loss before reversal in intended direction');
    }
    tradeFailureScenarios.push(`Invalidation at $${proposedStopLoss} followed by continuation in intended direction (being right direction, wrong entry)`);
    tradeFailureScenarios.push('News event causes flash move against position during low liquidity');

    // Cap risk score at 100
    overallRiskScore = Math.min(100, overallRiskScore);

    return {
        bearCaseReasons,
        tradeFailureScenarios,
        liquidityTrapWarning,
        fatigueIndicators,
        overallRiskScore
    };
};

// ============================================================================
// CANDLE CONFIRMATION
// ============================================================================

/**
 * Checks if the current candle has closed
 * Warns against entering trades on unclosed candles
 */
export const checkCandleConfirmation = (
    dataTimestamp: string,
    timeframe: '5m' | '15m' | '1h' | '4h'
): CandleConfirmationResult => {
    const now = new Date();
    const dataTime = new Date(dataTimestamp);
    const diffMs = now.getTime() - dataTime.getTime();
    const diffMinutes = diffMs / (1000 * 60);

    // Timeframe durations in minutes
    const timeframeDurations: Record<string, number> = {
        '5m': 5,
        '15m': 15,
        '1h': 60,
        '4h': 240
    };

    const duration = timeframeDurations[timeframe];
    const minutesRemaining = duration - (diffMinutes % duration);

    // Warn if less than 20% of candle remaining (high risk of wick manipulation)
    const percentRemaining = (minutesRemaining / duration) * 100;

    if (percentRemaining > 80) {
        return {
            isConfirmed: false,
            warning: `⚠️ ${timeframe} candle just opened (~${Math.round(percentRemaining)}% remaining). Wait for more price action before confirming entry.`,
            suggestedAction: 'Wait for at least 50% of candle to form'
        };
    }

    if (percentRemaining > 20 && percentRemaining <= 80) {
        return {
            isConfirmed: true,
            warning: null,
            suggestedAction: 'Candle development sufficient for analysis'
        };
    }

    // Less than 20% remaining - warn about last-minute wicks
    return {
        isConfirmed: true,
        warning: `${timeframe} candle closing soon (~${Math.round(minutesRemaining)} min). Entry after close recommended to avoid fake wicks.`,
        suggestedAction: 'Consider waiting for candle close confirmation'
    };
};

// ============================================================================
// MASTER VALIDATION FUNCTION
// ============================================================================

/**
 * Master validation function that runs all checks and generates a comprehensive report.
 * 
 * ENHANCED: Uses point-based confidence cascade system instead of discrete adjustments.
 * All validation failures accumulate penalties against a starting score of 100.
 * Final score maps to confidence level via CONFIDENCE_THRESHOLDS.
 */
export const validateTradeSetup = (
    data: HybridDataPacket,
    proposedDirection: TradeDirection,
    proposedConfidence: ConfidenceLevel,
    proposedEntry: number,
    proposedStopLoss: number,
    proposedTakeProfit1: number,
    tradeType: 'continuation' | 'reversal' | 'breakout' | 'range' = 'continuation',
    calibration?: ConfidenceCalibration
): {
    overallValid: boolean;
    finalConfidence: ConfidenceLevel;
    confidenceScore: number;
    validationReport: string;
    devilsAdvocate: DevilsAdvocateResult;
    allWarnings: string[];
    allErrors: string[];
    calibrationNote: string | null;
    penalties: { reason: string; points: number }[];
} => {
    // Run all validations
    const confluenceValidation = validateMultiTimeframeConfluence(
        data.confluence,
        proposedDirection,
        proposedConfidence
    );

    const rrValidation = validateRiskReward(
        proposedEntry,
        proposedStopLoss,
        proposedTakeProfit1,
        data.indicators['1h'].atr,
        proposedConfidence
    );

    const volumeValidation = validateVolumeConfirmation(
        data.advancedVolume,
        proposedDirection,
        proposedConfidence
    );

    const regimeValidation = validateMarketRegime(
        data.regime,
        proposedDirection,
        tradeType
    );

    const devilsAdvocate = generateDevilsAdvocateAnalysis(
        data,
        proposedDirection,
        proposedEntry,
        proposedStopLoss
    );

    const candleCheck = checkCandleConfirmation(data.dataTimestamp, '1h');

    // Aggregate all warnings and errors
    const allWarnings = [
        ...confluenceValidation.warnings,
        ...rrValidation.warnings,
        ...volumeValidation.warnings,
        ...regimeValidation.warnings
    ];

    if (candleCheck.warning) {
        allWarnings.push(candleCheck.warning);
    }

    const allErrors = [
        ...confluenceValidation.errors,
        ...volumeValidation.errors,
        ...regimeValidation.errors
    ];

    // ========================================================================
    // POINT-BASED CONFIDENCE CASCADE (Replaces discrete adjustments)
    // ========================================================================

    // Start with base score based on proposed confidence
    let confidenceScore = confidenceLevelToScore(proposedConfidence);
    const penalties: { reason: string; points: number }[] = [];

    // Helper to apply and track penalties
    const deduct = (points: number, reason: string) => {
        if (points > 0) {
            confidenceScore = Math.max(0, confidenceScore - points);
            penalties.push({ reason, points });
        }
    };

    // Confluence penalties
    if (confluenceValidation.errors.length > 0) {
        deduct(CONFIDENCE_PENALTIES.CONFLUENCE_CONFLICT, 'MTF confluence conflict');
    }
    if (confluenceValidation.adjustedConfidence === 'Medium' && proposedConfidence === 'High') {
        deduct(CONFIDENCE_PENALTIES.WEAK_CONFLUENCE, 'Weak MTF confluence for High confidence');
    }
    if (data.confluence.conflicts.length >= 3) {
        deduct(CONFIDENCE_PENALTIES.CONFLUENCE_MULTIPLE_CONFLICTS, 'Multiple conflicting signals');
    }

    // Risk/Reward penalties
    if (!rrValidation.isValid) {
        deduct(CONFIDENCE_PENALTIES.RR_BELOW_MINIMUM, `R:R below minimum (${rrValidation.ratio.toFixed(2)} < ${rrValidation.minRequired})`);
    }
    if (rrValidation.warnings.some(w => w.includes('TIGHT STOP'))) {
        deduct(CONFIDENCE_PENALTIES.TIGHT_STOP_LOSS, 'Stop loss tighter than 1x ATR');
    }
    if (rrValidation.warnings.some(w => w.includes('Wide stop'))) {
        deduct(CONFIDENCE_PENALTIES.WIDE_STOP_LOSS, 'Wide stop loss (>3x ATR)');
    }

    // Volume penalties
    if (volumeValidation.errors.length > 0) {
        deduct(CONFIDENCE_PENALTIES.OBV_DIVERGENCE, 'OBV divergence against trade');
    }
    if (data.advancedVolume.trend === 'low') {
        deduct(CONFIDENCE_PENALTIES.LOW_VOLUME, 'Low volume detected');
    }
    const expectedCVD = proposedDirection === 'Long' ? 'buyers_control' : 'sellers_control';
    if (data.advancedVolume.cvdTrend !== expectedCVD && data.advancedVolume.cvdTrend !== 'balanced') {
        deduct(CONFIDENCE_PENALTIES.CVD_OPPOSITE, 'CVD trend opposite to direction');
    }

    // Regime penalties
    if (regimeValidation.errors.length > 0) {
        deduct(CONFIDENCE_PENALTIES.COUNTER_TREND_STRONG, 'Counter-trend in strong trend');
    }
    if (data.regime.regime === 'ranging' && tradeType === 'breakout') {
        deduct(CONFIDENCE_PENALTIES.BREAKOUT_IN_RANGE, 'Breakout trade in ranging market');
    }
    if ((data.regime.regime === 'strong_trend_up' || data.regime.regime === 'strong_trend_down') && tradeType === 'range') {
        deduct(CONFIDENCE_PENALTIES.RANGE_IN_TREND, 'Range trade in trending market');
    }
    if (data.regime.regime === 'volatile_chop') {
        deduct(CONFIDENCE_PENALTIES.VOLATILE_CHOP, 'Volatile chop market');
    }
    if (data.regime.tradingBias === 'avoid') {
        deduct(CONFIDENCE_PENALTIES.REGIME_AVOID, 'Regime suggests avoiding trades');
    }

    // Devil's Advocate penalties
    if (devilsAdvocate.overallRiskScore >= 70) {
        deduct(CONFIDENCE_PENALTIES.DEVILS_ADVOCATE_HIGH, `High Devil's Advocate risk (${devilsAdvocate.overallRiskScore}/100)`);
        allWarnings.push(`😈 Devil's Advocate risk score: ${devilsAdvocate.overallRiskScore}/100. Major penalty applied.`);
    } else if (devilsAdvocate.overallRiskScore >= 50) {
        deduct(CONFIDENCE_PENALTIES.DEVILS_ADVOCATE_MODERATE, `Moderate Devil's Advocate risk (${devilsAdvocate.overallRiskScore}/100)`);
        allWarnings.push(`Devil's Advocate risk score: ${devilsAdvocate.overallRiskScore}/100. Penalty applied.`);
    }

    // Calibration impact - use time-decay weighted win rate
    let calibrationNote: string | null = null;
    if (calibration) {
        const summary = getCalibrationSummary(calibration);

        // Use time-decay win rate if available, otherwise fall back to simple
        const decayWinRate = getCalibratedWinRateWithDecay(calibration, proposedConfidence);
        const simpleWinRate = summary[proposedConfidence.toLowerCase() as 'high' | 'medium' | 'low' | 'avoid'].winRate;
        const winRate = decayWinRate ?? simpleWinRate;
        const total = summary[proposedConfidence.toLowerCase() as 'high' | 'medium' | 'low' | 'avoid'].total;

        if (winRate !== null && total >= MIN_TRADES_FOR_CALIBRATION) {
            const hasDecayData = decayWinRate !== null && decayWinRate !== simpleWinRate;
            calibrationNote = `📊 Historical "${proposedConfidence}" trades: ${winRate}% win rate (n=${total})${hasDecayData ? ' [time-weighted]' : ''}`;

            // Penalize if historical accuracy is poor for High confidence
            if (proposedConfidence === 'High' && winRate < 60) {
                deduct(CONFIDENCE_PENALTIES.POOR_HISTORICAL_ACCURACY, `Historical "High" accuracy only ${winRate}%`);
                allWarnings.push(`⚠️ Historical "High" confidence trades only ${winRate}% accurate. Consider recalibrating.`);
            }
        }
    }

    // Convert final score to confidence level
    const finalConfidence = confidenceScoreToLevel(confidenceScore);

    // Calculate overall validity
    const overallValid = allErrors.length === 0 && rrValidation.isValid && devilsAdvocate.overallRiskScore < 70;

    // Generate validation report with penalty breakdown
    const penaltyBreakdown = penalties.length > 0
        ? `\n📉 PENALTIES APPLIED:\n${penalties.map(p => `• -${p.points} pts: ${p.reason}`).join('\n')}`
        : '';

    const validationReport = `
═══ ACCURACY VALIDATION REPORT ═══

📊 CONFLUENCE: ${confluenceValidation.validationScore}/100
💰 RISK/REWARD: ${rrValidation.ratio.toFixed(2)} (min: ${rrValidation.minRequired})
📈 VOLUME: ${volumeValidation.validationScore}/100
🎯 REGIME: ${regimeValidation.validationScore}/100
😈 RISK SCORE: ${devilsAdvocate.overallRiskScore}/100

🎚️ CONFIDENCE SCORE: ${confidenceScore}/100 (High≥${CONFIDENCE_THRESHOLDS.HIGH}, Med≥${CONFIDENCE_THRESHOLDS.MEDIUM}, Low≥${CONFIDENCE_THRESHOLDS.LOW})
${penaltyBreakdown}
${allErrors.length > 0 ? `\n❌ ERRORS:\n${allErrors.map(e => `• ${e}`).join('\n')}` : ''}
${allWarnings.length > 0 ? `\n⚠️ WARNINGS:\n${allWarnings.map(w => `• ${w}`).join('\n')}` : ''}

🎭 DEVIL'S ADVOCATE:
${devilsAdvocate.bearCaseReasons.slice(0, 3).map(r => `• ${r}`).join('\n')}

📌 FINAL CONFIDENCE: ${finalConfidence}${finalConfidence !== proposedConfidence ? ` (adjusted from ${proposedConfidence})` : ''}
${calibrationNote ? `\n${calibrationNote}` : ''}
═══════════════════════════════════
`.trim();

    return {
        overallValid,
        finalConfidence,
        confidenceScore,
        validationReport,
        devilsAdvocate,
        allWarnings,
        allErrors,
        calibrationNote,
        penalties
    };
};

// ============================================================================
// PROMPT GENERATION
// ============================================================================

/**
 * Generates a prompt injection for AI context with all validation rules
 */
export const generateValidationPromptInjection = (): string => {
    return `
🛡️ **ACCURACY VALIDATION PROTOCOL (MANDATORY)**

Before finalizing any trade recommendation, you MUST validate against these criteria:

**1. MULTI-TIMEFRAME CONFLUENCE (Required for High Confidence)**
- At least 2 timeframes must agree on direction for "Medium" confidence
- At least 3 timeframes must agree for "High" confidence  
- Any conflicting major timeframe (4H vs 1H) caps confidence at "Medium"

**2. RISK/REWARD REQUIREMENTS**
| Confidence | Min R:R Required |
|------------|------------------|
| High       | 2.0:1           |
| Medium     | 1.5:1           |
| Low        | 1.2:1           |

- Stop loss MUST be at least 1x ATR from entry (otherwise: "Avoid")
- Stop loss should respect technical structure (key levels, not arbitrary %)

**3. VOLUME CONFIRMATION**
- Low volume breakouts → Cap confidence at "Medium" (Family A trap risk)
- OBV divergence against trade direction → "Low" or "Avoid"
- CVD must align with trade direction for "High" confidence

**4. MARKET REGIME ALIGNMENT**
- Strong Trend (ADX>25): Avoid counter-trend trades
- Ranging Market: Avoid breakout trades, use mean-reversion
- Volatile Chop: Reduce position size, widen stops

**5. DEVIL'S ADVOCATE (MANDATORY)**
Before recommending any trade, list:
• 3 reasons this trade could FAIL
• 1 liquidity trap scenario
• Current crowding risk (funding rate, L/S ratio)

**6. CANDLE CONFIRMATION**
- Warn if entering on unclosed candles
- Suggest waiting for close confirmation on key breakouts
`;
};

/**
 * Generates a Devil's Advocate section for the AI prompt
 */
export const generateDevilsAdvocatePrompt = (direction: TradeDirection): string => {
    return `
😈 **DEVIL'S ADVOCATE ANALYSIS (MANDATORY)**

You MUST complete this section before giving your final recommendation:

**BEAR CASE FOR THIS ${direction.toUpperCase()} TRADE:**
1. [Identify the strongest technical argument AGAINST this trade]
2. [Identify the volume/momentum concern]
3. [Identify the market structure risk]

**HOW THIS TRADE FAILS:**
- Describe the specific price action sequence that would invalidate this setup
- Identify the liquidity zones that could trap this entry
- State what would have to happen for the stop loss to be hit

**CROWDED TRADE CHECK:**
- Is funding rate elevated? (Long with high positive = crowded)
- Is L/S ratio extreme? (Contrarian signal)
- Are retail traders piling in? (Check social sentiment if available)

**RISK SCORE:** ___ / 100 (0 = Very Safe, 100 = Very Risky)

Only after completing this section should you provide your FINAL recommendation.
`;
};

// ============================================================================
// CORRELATION RISK VALIDATION (#6 Enhancement)
// ============================================================================

/**
 * Validates correlation risk for altcoin trades
 * Checks BTC dominance, major levels, and generates warnings
 */
export const validateCorrelationRisk = async (
    symbol: string,
    proposedDirection: TradeDirection
): Promise<{
    correlationRisk: CorrelationRiskResult;
    warnings: string[];
    penaltyPoints: number;
}> => {
    try {
        const correlationRisk = await calculateCorrelationRisk(symbol);
        const warnings = generateCorrelationWarnings(correlationRisk, proposedDirection);

        // Calculate penalty based on risk score
        let penaltyPoints = 0;
        if (correlationRisk.correlationRiskScore >= 50) {
            penaltyPoints = Math.floor(correlationRisk.correlationRiskScore / 5); // 10-20 points for high risk
        } else if (correlationRisk.correlationRiskScore >= 25) {
            penaltyPoints = 5;
        }

        return {
            correlationRisk,
            warnings,
            penaltyPoints
        };
    } catch (error) {
        console.error('[AccuracyValidationService] Correlation risk check failed:', error);
        return {
            correlationRisk: {
                btcDominance: 50,
                btcDominanceTrend: 'stable',
                btcAtMajorLevel: false,
                btcLevelType: 'none',
                btcLevelPrice: null,
                correlationRiskScore: 0,
                warnings: []
            },
            warnings: [],
            penaltyPoints: 0
        };
    }
};

/**
 * Export correlation prompt generator for use in hybrid intelligence
 */
export { generateCorrelationRiskPrompt };

