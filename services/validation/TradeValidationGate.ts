/**
 * TradeValidationGate - Central validation orchestrator
 * 
 * Runs all validation checks before a trade recommendation is finalized.
 * Acts as a final quality gate to ensure accuracy and prevent mistakes.
 * 
 * Features:
 * - Pre-trade validation pipeline
 * - Automatic confidence adjustment
 * - Warning/error aggregation
 * - Output validation
 * - Pattern memory matching
 * - Crowded trade detection
 * - Session risk assessment
 * - Structured Learning Rule enforcement
 * - Core Configuration validation
 */

import {
    validateMultiTimeframeConfluence,
    validateRiskReward,
    validateVolumeConfirmation,
    validateMarketRegime,
    generateDevilsAdvocateAnalysis,
    checkCandleConfirmation,
    ConfidenceLevel,
    TradeDirection,
    ValidationResult,
    DevilsAdvocateResult
} from './AccuracyValidationService';
import { HybridDataPacket } from '../analysis/HybridIntelligenceService';
import { TradeAnalysis, ConfidenceCalibration, LoggedTrade, TradeOutcome, AIProvider } from '../../types';
import {
    getCalibrationSummary,
    getCalibratedWinRate,
    calculateCalibrationPenalty,
    detectStreak,
    getSessionCalibrationState,
    detectDangerousCombinations,
    ConfidenceLevel as CalibrationConfidenceLevel
} from './ConfidenceCalibrationService';
import {
    calculateEntryTimingScore,
    generateEntryTimingWarning,
    EntryTimingResult
} from '../analysis/EntryTimingService';
import {
    calculateOptimalSL,
    generateSLOptimizationWarning,
    SLOptimization
} from '../backtesting/StopLossOptimizerService';
import {
    detectTradeType,
    validateScalpTrade,
    validateSwingTrade,
    TradeType,
    ScalpDetectionResult
} from '../analysis/ScalpDetectionService';
import {
    PATTERN_MEMORY_WARNING_THRESHOLD,
    PATTERN_MEMORY_DOWNGRADE_THRESHOLD,
    FUNDING_RATE_WARNING_THRESHOLD,
    FUNDING_RATE_DOWNGRADE_THRESHOLD,
    LS_RATIO_EXTREME_LONG_THRESHOLD,
    LS_RATIO_EXTREME_SHORT_THRESHOLD,
    DEVILS_ADVOCATE_HIGH_RISK_THRESHOLD,
    DEVILS_ADVOCATE_MEDIUM_RISK_THRESHOLD,
    ENTRY_TIMING_POOR_THRESHOLD,
    RR_VALIDATION_PASS_SCORE,
    RR_VALIDATION_FAIL_SCORE,
    SESSION_CLOSING_SOON_MINUTES,
    CALIBRATION_MIN_TRADES,
    HIGH_CONFIDENCE_MIN_WIN_RATE,
    TIMEFRAME_REQUIREMENTS,
    MAX_CONFLICTS_FOR_HIGH_CONFIDENCE
} from './ValidationConstants';
import { StructuredRule } from '../../types';
import { validateAllRules } from '../learning/RuleEngineService';


// ============================================================================
// TYPES
// ============================================================================

export interface TradeValidationInput {
    analysis: TradeAnalysis;
    hybridData: HybridDataPacket | null;
    calibration?: ConfidenceCalibration;
    tradeHistory?: LoggedTrade[];
    learningRules?: StructuredRule[]; // New: Injected structured rules
}

export interface TradeValidationOutput {
    isValid: boolean;
    originalConfidence: ConfidenceLevel;
    adjustedConfidence: ConfidenceLevel;
    confidenceWasAdjusted: boolean;

    // All warnings and errors
    warnings: string[];
    errors: string[];

    // Detailed validation results
    validationScores: {
        confluence: number;
        riskReward: number;
        volume: number;
        regime: number;
        devilsAdvocate: number;
    };

    // Devil's Advocate analysis
    devilsAdvocate?: DevilsAdvocateResult;

    // Calibration note (if available)
    calibrationNote: string | null;

    // Pattern matching (if available)
    patternMatchWarning: string | null;

    // Session warnings
    sessionWarnings: string[];

    // Crowded trade warning
    crowdedTradeWarning: string | null;

    // Entry Timing Score (new)
    entryTiming: EntryTimingResult | null;

    // SL Optimization (new)
    slOptimization: SLOptimization | null;

    // Trade type detection (scalp vs swing)
    detectedTradeType: TradeType;
    tradeTypeDetection: ScalpDetectionResult | null;

    // Full validation report
    validationReport: string;
}

// ============================================================================
// OUTPUT VALIDATION
// ============================================================================

/**
 * Validates that an AI analysis output has all required fields with valid values.
 * Returns an array of error messages for any missing/invalid fields.
 */
export const validateAnalysisOutput = (analysis: TradeAnalysis): string[] => {
    const errors: string[] = [];

    // Check direction
    if (!analysis.direction || !['Long', 'Short', 'Neutral'].includes(analysis.direction)) {
        errors.push('Missing or invalid direction (must be Long, Short, or Neutral)');
    }

    // Check confidence
    if (!analysis.confidence || !['High', 'Medium', 'Low', 'Avoid'].includes(analysis.confidence)) {
        errors.push('Missing or invalid confidence level');
    }

    // Check entry points
    if (!analysis.entryPoints || analysis.entryPoints.length === 0) {
        errors.push('No entry points provided');
    } else {
        analysis.entryPoints.forEach((ep, idx) => {
            if (!ep.price || ep.price === 'N/A' || ep.price === '') {
                errors.push(`Entry point ${idx + 1} has no valid price`);
            }
        });
    }

    // Check stop loss
    if (!analysis.stopLoss || analysis.stopLoss === 'N/A' || analysis.stopLoss === '') {
        errors.push('No stop loss provided');
    }

    // Check take profit (at least 1 target required)
    if (!analysis.takeProfit || analysis.takeProfit.length === 0) {
        errors.push('No take profit targets provided');
    } else {
        if (!analysis.takeProfit[0].price || analysis.takeProfit[0].price === 'N/A') {
            errors.push('Take profit 1 has no valid price');
        }
    }

    // Check probability is a valid number
    if (analysis.probability === undefined || analysis.probability === null || isNaN(analysis.probability)) {
        errors.push('Invalid probability value');
    } else if (analysis.probability < 0 || analysis.probability > 100) {
        errors.push('Probability must be between 0 and 100');
    }

    // Check coin name
    if (!analysis.coinName || analysis.coinName === 'N/A' || analysis.coinName === '') {
        errors.push('No coin/asset name detected');
    }

    return errors;
};

// ============================================================================
// PATTERN MEMORY MATCHING
// ============================================================================

/**
 * Compares current setup to historical losses to identify similar failing patterns.
 * Returns a warning if similarity > 70% with a loss.
 */
export const matchPatternMemory = (
    analysis: TradeAnalysis,
    tradeHistory: LoggedTrade[]
): { warning: string | null; matchedTrade: LoggedTrade | null; similarity: number } => {
    if (!tradeHistory || tradeHistory.length === 0) {
        return { warning: null, matchedTrade: null, similarity: 0 };
    }

    // Filter to only losses
    const losses = tradeHistory.filter(t => t.outcome === TradeOutcome.LOSS);

    if (losses.length === 0) {
        return { warning: null, matchedTrade: null, similarity: 0 };
    }

    let bestMatch: LoggedTrade | null = null;
    let highestSimilarity = 0;

    for (const loss of losses) {
        let similarityScore = 0;
        let totalChecks = 0;

        // Check direction match
        totalChecks++;
        if (loss.analysis.direction === analysis.direction) {
            similarityScore += 15;
        }

        // Check pattern family match
        totalChecks++;
        if (loss.analysis.detectedPatternFamily && analysis.detectedPatternFamily) {
            if (loss.analysis.detectedPatternFamily === analysis.detectedPatternFamily) {
                similarityScore += 25;
            }
        }

        // Check confidence level match
        totalChecks++;
        if (loss.analysis.confidence === analysis.confidence) {
            similarityScore += 10;
        }

        // Check RSI condition match
        totalChecks++;
        const lossRsi = loss.analysis.marketConditions?.rsi?.toLowerCase() || '';
        const currentRsi = analysis.marketConditions?.rsi?.toLowerCase() || '';
        if (lossRsi && currentRsi) {
            if (lossRsi.includes('overbought') && currentRsi.includes('overbought')) {
                similarityScore += 15;
            } else if (lossRsi.includes('oversold') && currentRsi.includes('oversold')) {
                similarityScore += 15;
            }
        }

        // Check sentiment match
        totalChecks++;
        if (loss.analysis.marketConditions?.sentiment === analysis.marketConditions?.sentiment) {
            similarityScore += 10;
        }

        // Check strategy match
        totalChecks++;
        if (loss.analysis.strategy && analysis.strategy) {
            const lossStrat = loss.analysis.strategy.toLowerCase();
            const currentStrat = analysis.strategy.toLowerCase();
            if (lossStrat.includes('breakout') && currentStrat.includes('breakout')) {
                similarityScore += 15;
            } else if (lossStrat.includes('reversal') && currentStrat.includes('reversal')) {
                similarityScore += 15;
            } else if (lossStrat.includes('continuation') && currentStrat.includes('continuation')) {
                similarityScore += 15;
            }
        }

        // Normalize to 100
        const normalizedSimilarity = (similarityScore / 90) * 100;

        if (normalizedSimilarity > highestSimilarity) {
            highestSimilarity = normalizedSimilarity;
            bestMatch = loss;
        }
    }

    // Only warn if similarity >= warning threshold
    if (highestSimilarity >= PATTERN_MEMORY_WARNING_THRESHOLD && bestMatch) {
        return {
            warning: `⚠️ PATTERN MEMORY ALERT: This setup is ${highestSimilarity.toFixed(0)}% similar to a previous LOSS (${bestMatch.analysis.coinName} ${bestMatch.analysis.direction}, ${new Date(bestMatch.timestamp).toLocaleDateString()}). Consider reducing confidence.`,
            matchedTrade: bestMatch,
            similarity: highestSimilarity
        };
    }

    return { warning: null, matchedTrade: null, similarity: highestSimilarity };
};

// ============================================================================
// CROWDED TRADE DETECTION
// ============================================================================

/**
 * Detects crowded trades using funding rate and Long/Short ratio.
 */
export const detectCrowdedTrade = (
    hybridData: HybridDataPacket,
    proposedDirection: TradeDirection
): { isCrowded: boolean; warning: string | null; shouldDowngrade: boolean } => {
    const warnings: string[] = [];
    let shouldDowngrade = false;

    // Check funding rate
    if (proposedDirection === 'Long' && hybridData.fundingRate > FUNDING_RATE_WARNING_THRESHOLD) {
        warnings.push(`High positive funding (${(hybridData.fundingRate * 100).toFixed(3)}%) - Longs are crowded`);
        if (hybridData.fundingRate > FUNDING_RATE_DOWNGRADE_THRESHOLD) {
            shouldDowngrade = true;
        }
    }

    if (proposedDirection === 'Short' && hybridData.fundingRate < -FUNDING_RATE_WARNING_THRESHOLD) {
        warnings.push(`High negative funding (${(hybridData.fundingRate * 100).toFixed(3)}%) - Shorts are crowded`);
        if (hybridData.fundingRate < -FUNDING_RATE_DOWNGRADE_THRESHOLD) {
            shouldDowngrade = true;
        }
    }

    // Check Long/Short ratio
    const lsRatio = hybridData.derivatives.longShortRatio.ratio;

    if (proposedDirection === 'Long' && lsRatio > LS_RATIO_EXTREME_LONG_THRESHOLD) {
        warnings.push(`L/S Ratio ${lsRatio.toFixed(2)} - Extreme long positioning, contrarian signal`);
        shouldDowngrade = true;
    }

    if (proposedDirection === 'Short' && lsRatio < LS_RATIO_EXTREME_SHORT_THRESHOLD) {
        warnings.push(`L/S Ratio ${lsRatio.toFixed(2)} - Extreme short positioning, squeeze risk`);
        shouldDowngrade = true;
    }

    return {
        isCrowded: warnings.length > 0,
        warning: warnings.length > 0 ? `🚨 CROWDED TRADE: ${warnings.join('; ')}` : null,
        shouldDowngrade
    };
};

// ============================================================================
// SESSION RISK VALIDATION
// ============================================================================

/**
 * Validates session-specific risks for the proposed trade.
 */
export const validateSessionRisk = (
    hybridData: HybridDataPacket,
    tradeType: string
): { warnings: string[]; shouldDowngrade: boolean } => {
    const warnings: string[] = [];
    let shouldDowngrade = false;
    const session = hybridData.session;

    // Weekend warning
    if (session.isWeekend) {
        warnings.push('⚠️ WEEKEND: Low liquidity, avoid new positions');
        shouldDowngrade = true;
    }

    // Weekly close warning
    if (session.isWeeklyClose) {
        warnings.push('⚠️ Weekly close approaching - position sizing caution');
    }

    // Monthly close warning
    if (session.isMonthlyClose) {
        warnings.push('⚠️ Monthly close - potential rebalancing flows');
    }

    // Asia session + breakout = low reliability
    if ((session.currentSession === 'asia' || session.sessionName.includes('Asia')) &&
        tradeType.toLowerCase().includes('breakout')) {
        warnings.push('⚠️ Breakout in Asia session - lower reliability due to low liquidity');
    }

    // Off-hours warning
    if (session.currentSession === 'off_hours') {
        warnings.push('⚠️ Off-hours trading - wider spreads, lower liquidity');
        shouldDowngrade = true;
    }

    // Close to daily close (within configured minutes)
    if (session.minutesToSessionEnd <= SESSION_CLOSING_SOON_MINUTES && session.currentSession !== 'off_hours') {
        warnings.push('⚠️ Session closing soon - potential end-of-session manipulation');
    }

    return { warnings, shouldDowngrade };
};

// ============================================================================
// MULTI-TIMEFRAME ALIGNMENT VALIDATION
// ============================================================================

/**
 * Validates that the required number of timeframes align for the given confidence level.
 * - High: 3+ timeframes
 * - Medium: 2+ timeframes
 * - Low: 1+ timeframe
 */
export const validateTimeframeAlignment = (
    confluence: { alignment: string[]; conflicts: string[] },
    proposedConfidence: ConfidenceLevel
): { isValid: boolean; warning: string | null; adjustedConfidence: ConfidenceLevel | null } => {
    const alignedCount = confluence.alignment.length;
    const conflictCount = confluence.conflicts.length;

    const requirements = TIMEFRAME_REQUIREMENTS;

    const required = requirements[proposedConfidence];

    if (alignedCount < required) {
        // Downgrade confidence
        let newConfidence: ConfidenceLevel = proposedConfidence;

        if (alignedCount >= 3) newConfidence = 'High';
        else if (alignedCount >= 2) newConfidence = 'Medium';
        else if (alignedCount >= 1) newConfidence = 'Low';
        else newConfidence = 'Avoid';

        if (newConfidence !== proposedConfidence) {
            return {
                isValid: false,
                warning: `MTF alignment insufficient: ${alignedCount} TFs aligned (${proposedConfidence} requires ${required}+). Downgrading to ${newConfidence}.`,
                adjustedConfidence: newConfidence
            };
        }
    }

    // Check for too many conflicts
    if (conflictCount >= MAX_CONFLICTS_FOR_HIGH_CONFIDENCE && proposedConfidence === 'High') {
        return {
            isValid: false,
            warning: `${conflictCount} conflicting signals detected. Downgrading from High to Medium.`,
            adjustedConfidence: 'Medium'
        };
    }

    return { isValid: true, warning: null, adjustedConfidence: null };
};

// ============================================================================
// STRUCTURED RULE VALIDATION
// ============================================================================



// ============================================================================
// MAIN VALIDATION GATE
// ============================================================================

/**
 * Main validation gate - runs all checks and returns comprehensive results.
 */
export const runValidationGate = (
    input: TradeValidationInput
): TradeValidationOutput => {
    const { analysis, hybridData, calibration, tradeHistory, learningRules } = input;

    const warnings: string[] = [];
    const errors: string[] = [];
    const sessionWarnings: string[] = [];

    // Track original confidence
    const originalConfidence = analysis.confidence as ConfidenceLevel;
    let adjustedConfidence = originalConfidence;

    // Initialize scores
    const validationScores = {
        confluence: 50,
        riskReward: 50,
        volume: 50,
        regime: 50,
        devilsAdvocate: 50
    };

    // ====== STEP 1: OUTPUT VALIDATION ======
    const outputErrors = validateAnalysisOutput(analysis);
    if (outputErrors.length > 0) {
        errors.push(...outputErrors.map(e => `❌ ${e}`));
    }

    // ====== STEP 2: SKIP IF NO HYBRID DATA ======
    if (!hybridData) {
        // Can only do basic validation without hybrid data
        const patternMatch = tradeHistory ? matchPatternMemory(analysis, tradeHistory) : { warning: null, matchedTrade: null, similarity: 0 };

        const report = `
═══ VALIDATION GATE REPORT (LIMITED) ═══
⚠️ Hybrid Intelligence data not available - limited validation only.

${errors.length > 0 ? `❌ ERRORS:\n${errors.join('\n')}` : '✅ No critical errors detected'}
${warnings.length > 0 ? `\n⚠️ WARNINGS:\n${warnings.join('\n')}` : ''}
${patternMatch.warning ? `\n🔍 PATTERN MEMORY:\n${patternMatch.warning}` : ''}

📌 CONFIDENCE: ${adjustedConfidence}
═════════════════════════════════════════
`.trim();

        // Detect trade type even without hybrid data
        const tradeTypeDetection = detectTradeType(analysis);

        return {
            isValid: errors.length === 0,
            originalConfidence,
            adjustedConfidence,
            confidenceWasAdjusted: false,
            warnings,
            errors,
            validationScores,
            calibrationNote: null,
            patternMatchWarning: patternMatch.warning,
            sessionWarnings: [],
            crowdedTradeWarning: null,
            entryTiming: null,
            slOptimization: null,
            detectedTradeType: tradeTypeDetection.detectedType,
            tradeTypeDetection,
            validationReport: report
        };
    }

    // ====== STEP 3: FULL VALIDATION WITH HYBRID DATA ======
    // Check if direction is tradeable (not Neutral)
    const analysisDirection = analysis.direction;
    const isTradeableDirection = analysisDirection === 'Long' || analysisDirection === 'Short';

    // Parse numeric values
    const entryPrice = parseFloat(analysis.entryPoints[0]?.price?.replace(/[^0-9.-]/g, '') || '0');
    const stopLoss = parseFloat(analysis.stopLoss?.replace(/[^0-9.-]/g, '') || '0');
    const takeProfit1 = parseFloat(analysis.takeProfit[0]?.price?.replace(/[^0-9.-]/g, '') || '0');
    const atr = hybridData.indicators['1h'].atr;

    // Determine trade type from strategy
    let tradeType: 'continuation' | 'reversal' | 'breakout' | 'range' = 'continuation';
    const strategyLower = analysis.strategy?.toLowerCase() || '';
    if (strategyLower.includes('breakout')) tradeType = 'breakout';
    else if (strategyLower.includes('reversal')) tradeType = 'reversal';
    else if (strategyLower.includes('range')) tradeType = 'range';

    // 3.1 Multi-Timeframe Confluence
    if (isTradeableDirection) {
        const direction = analysisDirection as TradeDirection;
        const confluenceResult = validateMultiTimeframeConfluence(
            hybridData.confluence,
            direction,
            adjustedConfidence
        );
        validationScores.confluence = confluenceResult.validationScore;
        warnings.push(...confluenceResult.warnings);
        errors.push(...confluenceResult.errors);
        if (confluenceResult.adjustedConfidence && isLowerConfidence(confluenceResult.adjustedConfidence, adjustedConfidence)) {
            adjustedConfidence = confluenceResult.adjustedConfidence;
        }

        // 3.1b MTF Alignment check
        const alignmentResult = validateTimeframeAlignment(hybridData.confluence, adjustedConfidence);
        if (alignmentResult.warning) {
            warnings.push(alignmentResult.warning);
        }
        if (alignmentResult.adjustedConfidence && isLowerConfidence(alignmentResult.adjustedConfidence, adjustedConfidence)) {
            adjustedConfidence = alignmentResult.adjustedConfidence;
        }
    }

    // 3.2 Risk/Reward Validation
    if (entryPrice > 0 && stopLoss > 0 && takeProfit1 > 0 && atr > 0) {
        const rrResult = validateRiskReward(entryPrice, stopLoss, takeProfit1, atr, adjustedConfidence);
        validationScores.riskReward = rrResult.isValid ? RR_VALIDATION_PASS_SCORE : RR_VALIDATION_FAIL_SCORE;
        warnings.push(...rrResult.warnings);

        if (!rrResult.isValid && adjustedConfidence !== 'Avoid') {
            // Downgrade by one level
            if (adjustedConfidence === 'High') adjustedConfidence = 'Medium';
            else if (adjustedConfidence === 'Medium') adjustedConfidence = 'Low';
            else adjustedConfidence = 'Avoid';
        }
    }

    // 3.3 Volume Confirmation
    if (isTradeableDirection) {
        const direction = analysisDirection as TradeDirection;
        const volumeResult = validateVolumeConfirmation(
            hybridData.advancedVolume,
            direction,
            adjustedConfidence
        );
        validationScores.volume = volumeResult.validationScore;
        warnings.push(...volumeResult.warnings);
        errors.push(...volumeResult.errors);

        // HARD RULE: Low volume + High confidence = Force to Medium
        if (hybridData.advancedVolume.trend === 'low' && adjustedConfidence === 'High') {
            adjustedConfidence = 'Medium';
            warnings.push('📉 VOLUME RULE: Low volume detected - confidence capped at Medium');
        }

        if (volumeResult.adjustedConfidence && isLowerConfidence(volumeResult.adjustedConfidence, adjustedConfidence)) {
            adjustedConfidence = volumeResult.adjustedConfidence;
        }
    }



    // 3.4 Market Regime Validation
    if (isTradeableDirection) {
        const direction = analysisDirection as TradeDirection;
        const regimeResult = validateMarketRegime(hybridData.regime, direction, tradeType);
        validationScores.regime = regimeResult.validationScore;
        warnings.push(...regimeResult.warnings);
        errors.push(...regimeResult.errors);
    }

    // 3.5 Devil's Advocate Analysis
    let devilsAdvocate: DevilsAdvocateResult | undefined;
    if (isTradeableDirection && entryPrice > 0 && stopLoss > 0) {
        const direction = analysisDirection as TradeDirection;
        devilsAdvocate = generateDevilsAdvocateAnalysis(hybridData, direction, entryPrice, stopLoss);
        validationScores.devilsAdvocate = 100 - devilsAdvocate.overallRiskScore;

        // Apply Devil's Advocate risk impact
        if (devilsAdvocate.overallRiskScore >= DEVILS_ADVOCATE_HIGH_RISK_THRESHOLD) {
            if (adjustedConfidence !== 'Avoid') {
                adjustedConfidence = 'Low';
                warnings.push(`😈 Devil's Advocate risk score: ${devilsAdvocate.overallRiskScore}/100. HIGH RISK - Confidence set to Low.`);
            }
        } else if (devilsAdvocate.overallRiskScore >= DEVILS_ADVOCATE_MEDIUM_RISK_THRESHOLD && adjustedConfidence === 'High') {
            adjustedConfidence = 'Medium';
            warnings.push(`😈 Devil's Advocate risk score: ${devilsAdvocate.overallRiskScore}/100. Confidence downgraded to Medium.`);
        }
    }

    // 3.6 Candle Confirmation
    const candleCheck = checkCandleConfirmation(hybridData.dataTimestamp, '1h');
    if (candleCheck.warning) {
        warnings.push(candleCheck.warning);

        // Downgrade if candle just opened and confidence is High
        if (!candleCheck.isConfirmed && adjustedConfidence === 'High') {
            adjustedConfidence = 'Medium';
            warnings.push('🕯️ CANDLE RULE: Unconfirmed candle - confidence capped at Medium');
        }
    }

    // 3.7 Crowded Trade Detection
    let crowdedTradeWarning: string | null = null;
    if (isTradeableDirection) {
        const direction = analysisDirection as TradeDirection;
        const crowdedResult = detectCrowdedTrade(hybridData, direction);
        crowdedTradeWarning = crowdedResult.warning;
        if (crowdedResult.warning) {
            warnings.push(crowdedResult.warning);
        }
        if (crowdedResult.shouldDowngrade && adjustedConfidence === 'High') {
            adjustedConfidence = 'Medium';
        }
    }

    // 3.8 Session Risk Validation
    const sessionResult = validateSessionRisk(hybridData, tradeType);
    sessionWarnings.push(...sessionResult.warnings);
    warnings.push(...sessionResult.warnings);
    if (sessionResult.shouldDowngrade && adjustedConfidence === 'High') {
        adjustedConfidence = 'Medium';
    }

    // 3.9 Pattern Memory Matching
    let patternMatchWarning: string | null = null;
    if (tradeHistory && tradeHistory.length > 0) {
        const patternMatch = matchPatternMemory(analysis, tradeHistory);
        patternMatchWarning = patternMatch.warning;
        if (patternMatch.warning) {
            warnings.push(patternMatch.warning);
            // Downgrade by one level
            if (patternMatch.similarity >= PATTERN_MEMORY_DOWNGRADE_THRESHOLD && adjustedConfidence !== 'Avoid') {
                if (adjustedConfidence === 'High') adjustedConfidence = 'Medium';
                else if (adjustedConfidence === 'Medium') adjustedConfidence = 'Low';
            }
        }
    }

    // 3.10 Entry Timing Score (NEW)
    let entryTiming: EntryTimingResult | null = null;
    if (isTradeableDirection) {
        entryTiming = calculateEntryTimingScore(analysis, hybridData);

        // Add warning if score is poor
        const entryWarning = generateEntryTimingWarning(entryTiming);
        if (entryWarning) {
            warnings.push(entryWarning);
        }

        // Downgrade confidence if entry timing is very poor
        if (entryTiming.score < ENTRY_TIMING_POOR_THRESHOLD && adjustedConfidence === 'High') {
            adjustedConfidence = 'Medium';
            warnings.push('🎯 ENTRY TIMING RULE: Poor entry timing - confidence capped at Medium');
        }
    }

    // 3.11 SL Optimization Check (NEW)
    let slOptimization: SLOptimization | null = null;
    if (tradeHistory && tradeHistory.length >= 5) {
        slOptimization = calculateOptimalSL(tradeHistory, {
            coin: analysis.coinName,
            family: analysis.detectedPatternFamily,
            direction: analysisDirection as 'Long' | 'Short'
        });

        // Add warning if missed win rate is high
        const slWarning = generateSLOptimizationWarning(slOptimization);
        if (slWarning) {
            warnings.push(slWarning);
        }
    }

    // 3.12 Calibration Note
    let calibrationNote: string | null = null;
    if (calibration) {
        const summary = getCalibrationSummary(calibration);
        const levelKey = adjustedConfidence.toLowerCase() as 'high' | 'medium' | 'low' | 'avoid';
        const levelStats = summary[levelKey];

        if (levelStats.winRate !== null && levelStats.total >= CALIBRATION_MIN_TRADES) {
            calibrationNote = `📊 Historical "${adjustedConfidence}" trades: ${levelStats.winRate}% win rate (n=${levelStats.total})`;

            // Warn if historical performance is poor
            if (adjustedConfidence === 'High' && levelStats.winRate < HIGH_CONFIDENCE_MIN_WIN_RATE) {
                warnings.push(`⚠️ Historical "High" confidence trades only ${levelStats.winRate}% accurate. Consider recalibrating.`);
            }
        }
    }

    // 3.11 Enhanced Calibration Penalty System (NEW)
    // Uses streak detection, session state, and cross-correlation
    if (calibration && hybridData && isTradeableDirection) {
        const coin = analysis.coinName || hybridData.symbol;
        const pattern = analysis.detectedPatternFamily;
        const regime = hybridData.regime.regime.includes('trend') ? 'trending' as const :
            hybridData.regime.regime === 'ranging' ? 'ranging' as const : 'volatile' as const;

        // Calculate total calibration penalty
        const calibrationPenalty = calculateCalibrationPenalty(
            calibration,
            adjustedConfidence as CalibrationConfidenceLevel,
            { coin, pattern, regime }
        );

        // Add penalty reasoning to warnings
        if (calibrationPenalty.totalPenalty > 0) {
            calibrationPenalty.reasoning.forEach(reason => {
                warnings.push(`📊 ${reason}`);
            });
        }

        // Apply calibration-based confidence adjustment
        if (calibrationPenalty.adjustedConfidence !== adjustedConfidence) {
            const oldConf = adjustedConfidence;
            adjustedConfidence = calibrationPenalty.adjustedConfidence;
            warnings.push(`🎯 CALIBRATION ADJUSTMENT: ${oldConf} → ${adjustedConfidence} (penalty: ${calibrationPenalty.totalPenalty} pts)`);
        }

        // Check for dangerous combinations
        const dangerous = detectDangerousCombinations(calibration, {
            coin,
            pattern,
            regime,
            confidence: adjustedConfidence as CalibrationConfidenceLevel
        });

        if (dangerous.isDangerous) {
            warnings.push(dangerous.aiPrompt.split('\n')[0]); // First line of warning
            if (dangerous.mandatoryDowngrade &&
                isLowerConfidence(dangerous.mandatoryDowngrade, adjustedConfidence)) {
                adjustedConfidence = dangerous.mandatoryDowngrade;
            }
        }

        // Check streak and session alerts
        const streakInfo = detectStreak(calibration);
        const sessionState = getSessionCalibrationState(calibration);

        if (streakInfo.streakType === 'cold' && streakInfo.streakLength >= 3) {
            warnings.push(`🥶 COLD STREAK: ${streakInfo.streakLength} consecutive losses`);
        }

        if (sessionState.sessionPerformance === 'critical') {
            warnings.push(`🛑 CRITICAL SESSION: ${sessionState.todayWins}W-${sessionState.todayLosses}L today - consider stopping`);
        } else if (sessionState.sessionPerformance === 'poor') {
            warnings.push(`⚠️ POOR SESSION: ${sessionState.todayWins}W-${sessionState.todayLosses}L today`);
        }
    }


    // 3.12 Centralized Rule Engine (CORE, STRUCTURED & INVALIDATION)
    // Run this last to catch anything else and enforce safety rails
    if (isTradeableDirection) {
        const ruleValidation = validateAllRules(analysis, hybridData, learningRules);

        warnings.push(...ruleValidation.warnings);
        errors.push(...ruleValidation.errors);

        if (ruleValidation.adjustedConfidence && isLowerConfidence(ruleValidation.adjustedConfidence, adjustedConfidence)) {
            adjustedConfidence = ruleValidation.adjustedConfidence;
        }

        if (ruleValidation.promptInjection) {
            warnings.push('⚠️ Invalidation Rules: ' + ruleValidation.promptInjection);
        }
    }



    // ====== STEP 4: GENERATE REPORT ======
    const confidenceWasAdjusted = adjustedConfidence !== originalConfidence;

    const report = `
═══════════════════════════════════════════════════════════════
🛡️ TRADE VALIDATION GATE REPORT
═══════════════════════════════════════════════════════════════

📊 VALIDATION SCORES:
- Confluence: ${validationScores.confluence}/100
- Risk/Reward: ${validationScores.riskReward}/100
- Volume: ${validationScores.volume}/100
- Regime: ${validationScores.regime}/100
- Devil's Advocate: ${validationScores.devilsAdvocate}/100

${errors.length > 0 ? `\n❌ ERRORS (${errors.length}):\n${errors.map(e => `  ${e}`).join('\n')}` : ''}

${warnings.length > 0 ? `\n⚠️ WARNINGS (${warnings.length}):\n${warnings.map(w => `  • ${w}`).join('\n')}` : '✅ No warnings'}

${devilsAdvocate ? `
😈 DEVIL'S ADVOCATE (Risk Score: ${devilsAdvocate.overallRiskScore}/100):
${devilsAdvocate.bearCaseReasons.slice(0, 3).map(r => `  • ${r}`).join('\n')}
${devilsAdvocate.liquidityTrapWarning ? '  🚨 LIQUIDITY TRAP WARNING ACTIVE' : ''}
` : ''}

${calibrationNote ? `\n📈 CALIBRATION:\n  ${calibrationNote}` : ''}

${patternMatchWarning ? `\n🔍 PATTERN MEMORY:\n  ${patternMatchWarning}` : ''}

───────────────────────────────────────────────────────────────
📌 FINAL CONFIDENCE: ${adjustedConfidence}${confidenceWasAdjusted ? ` (adjusted from ${originalConfidence})` : ''}
✅ VALIDATION: ${errors.length === 0 ? 'PASSED' : 'FAILED'}
═══════════════════════════════════════════════════════════════
`.trim();

    // Detect trade type and run type-specific validation
    const tradeTypeDetection = detectTradeType(analysis);
    const detectedTradeType = tradeTypeDetection.detectedType;

    // Scalp vs Swing specific validation
    if (detectedTradeType === 'scalp') {
        const scalpValidation = validateScalpTrade(analysis, {
            currentSession: hybridData.session.currentSession,
            isWeekend: hybridData.session.isWeekend
        });
        warnings.push(...scalpValidation.warnings);
        if (scalpValidation.shouldDowngrade && adjustedConfidence === 'High') {
            adjustedConfidence = 'Medium';
            warnings.push('⚡ SCALP RULE: Conditions unfavorable - confidence capped');
        }
    } else {
        const swingValidation = validateSwingTrade(analysis);
        warnings.push(...swingValidation.warnings);
    }

    return {
        isValid: errors.length === 0,
        originalConfidence,
        adjustedConfidence,
        confidenceWasAdjusted,
        warnings,
        errors,
        validationScores,
        devilsAdvocate,
        calibrationNote,
        patternMatchWarning,
        sessionWarnings,
        crowdedTradeWarning,
        entryTiming,
        slOptimization,
        detectedTradeType,
        tradeTypeDetection,
        validationReport: report
    };
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Returns true if newConf is a lower confidence level than currentConf
 */
const isLowerConfidence = (newConf: ConfidenceLevel, currentConf: ConfidenceLevel): boolean => {
    const order: Record<ConfidenceLevel, number> = {
        'High': 0,
        'Medium': 1,
        'Low': 2,
        'Avoid': 3
    };
    return order[newConf] > order[currentConf];
};

/**
 * Quick validation check - returns true if trade should be allowed
 */
export const quickValidate = (analysis: TradeAnalysis): boolean => {
    const errors = validateAnalysisOutput(analysis);
    return errors.length === 0;
};
