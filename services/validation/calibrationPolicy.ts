/**
 * calibrationPolicy — the calibration DECISION layer.
 *
 * Split out of the former 1,614-line `ConfidenceCalibrationService.ts`, which was
 * three services wearing one filename. Every function body below is byte-identical
 * to the file it came from; only the module boundary moved.
 *
 * Turns calibration state into an adjustment: Bayesian confidence, calibration
 * drift, streaks, today's session state, the aggregate penalty and dangerous
 * factor combinations. Sits above the store, below the prompt builders:
 *
 *     calibrationPrompts → calibrationPolicy → calibrationStore
 *
 * Several of these objects carry a `promptInjection` / `aiPrompt` string. They
 * stay here, beside the decision that produced them: the prompt layer returns
 * prompt TEXT, so pulling the field out would have required this layer to import
 * the prompt layer — a cycle. The prompt builders read these fields instead.
 *
 * The numbered section banners (1–6) are the pre-split file's own numbering; 7
 * and 8 travelled with the prompt builders.
 *
 * PUBLIC SURFACE IS EXACTLY WHAT IS CONSUMED. `getBayesianConfidenceAdjustment`
 * is called by the prompt layer, so it is exported. The five decision TYPES
 * (`CalibrationDrift`, `BayesianAdjustment`, `SessionCalibrationState`,
 * `DangerousCombination`, `ProviderAccuracyContext`) and `getCalibrationDrift`
 * are named by nothing outside this file — they are this module's return
 * shapes, so they stay declared but are no longer exported. In the old
 * single-file layout every symbol had to be reachable by name, which is how a
 * public surface grows to describe a file rather than a feature.
 * `getConfidenceAccuracy` was a second spelling of `getCalibrationDrift(...).status`
 * and was called by nothing at all; it is deleted rather than un-exported,
 * because un-exporting dead code only hides it from the compiler.
 */

import { ConfidenceCalibration, AIProvider } from '../../types';
import {
    MIN_TRADES_FOR_CALIBRATION,
    CALIBRATION_DRIFT_THRESHOLD_PTS,
    STREAK_THRESHOLD,
    MAX_STREAK_PENALTY,
    STREAK_PENALTY_PER_TRADE,
    SESSION_THRESHOLDS,
    MAX_SESSION_PENALTY,
    BAYESIAN_PRIOR,
    BAYESIAN_MIN_SAMPLES_HIGH_CONFIDENCE,
    BAYESIAN_MIN_SAMPLES_MEDIUM_CONFIDENCE,
    EXPECTED_WIN_RATES,
    DANGEROUS_COMBINATION_THRESHOLD,
    MIN_SAMPLES_FOR_CORRELATION
} from '../../constants/calibrationConstants';
import { utcDayStart } from './SessionGuardService';
import {
    ConfidenceLevel,
    getSampleSize,
    getCalibratedWinRate,
    getWinRateByCoin,
    getWinRateByPattern,
    getWinRateByRegime,
    getWinRateByProvider,
    getProviderAccuracyComparison
} from './calibrationStore';

/** Drift verdict for one analysis: declared probability vs historical reality. */
interface CalibrationDrift {
    status: 'accurate' | 'overconfident' | 'underconfident' | 'insufficient_data';
    /** The AI's declared probability for this trade (%), or NaN-ish input as-is. */
    declared: number;
    /** Historical win rate (%) of the confidence bucket, or null when unknown. */
    actual: number | null;
    /** declared − actual in points (positive = overconfident), or null when unknown. */
    delta: number | null;
    /** Number of logged outcomes behind `actual`. */
    sampleSize: number;
}

/**
 * Full calibration-drift signal for a single analysis: compares the AI's
 * declared probability against the historical win rate of the confidence
 * bucket, with the signed delta (points) and the sample size behind it.
 *
 * - `overconfident`: declared runs > CALIBRATION_DRIFT_THRESHOLD_PTS above
 *   reality ("running hot") — treat the setup as lower than advertised.
 * - `underconfident`: declared runs > threshold below reality ("running
 *   cold") — the setup may be better than the AI's own rating suggests.
 * - `accurate`: within threshold, or insufficient data to judge.
 *
 * Guards: no calibration, sample below MIN_TRADES_FOR_CALIBRATION, and a
 * missing/zero/NaN declared probability all return `insufficient_data`
 * (a 0 default means "not provided", not a 0% forecast).
 */
export const getCalibrationDrift = (
    calibration: ConfidenceCalibration | undefined,
    confidence: ConfidenceLevel,
    declaredProbability: number
): CalibrationDrift => {
    const sampleSize = getSampleSize(calibration, confidence);
    if (sampleSize < MIN_TRADES_FOR_CALIBRATION) {
        return { status: 'insufficient_data', declared: declaredProbability, actual: null, delta: null, sampleSize };
    }

    const actual = getCalibratedWinRate(calibration, confidence);
    if (actual === null || !isFinite(declaredProbability) || declaredProbability <= 0) {
        return { status: 'insufficient_data', declared: declaredProbability, actual, delta: null, sampleSize };
    }

    const delta = declaredProbability - actual;
    if (Math.abs(delta) <= CALIBRATION_DRIFT_THRESHOLD_PTS) {
        return { status: 'accurate', declared: declaredProbability, actual, delta, sampleSize };
    }
    return {
        status: delta > 0 ? 'overconfident' : 'underconfident',
        declared: declaredProbability,
        actual,
        delta,
        sampleSize,
    };
};

/**
 * Get Bayesian Calibrated Confidence
 * Adjusts raw confidence based on historical provider performance.
 * 
 * @param calibration - The full calibration stats
 * @param provider - The AI provider name (e.g., 'Gemini', 'OpenAI')
 * @param currentConfidence - The raw confidence level ('High', 'Medium', 'Low')
 * @param rawProbabilityPercent - The raw % probability output by the AI (e.g., 85)
 * @returns Calibrated probability percentage (0-100)
 */
export const getBayesianCalibratedConfidence = (
    calibration: ConfidenceCalibration | undefined,
    provider: string,
    currentConfidence: ConfidenceLevel,
    rawProbabilityPercent: number
): number => {
    // 1. Cold Start / Insufficient Data: Return raw value
    if (!calibration || !calibration.granular?.byProvider) {
        return rawProbabilityPercent;
    }

    const providerStats = calibration.granular.byProvider[provider];
    if (!providerStats || providerStats.total < MIN_TRADES_FOR_CALIBRATION) {
        return rawProbabilityPercent;
    }

    // 2. Calculate Prior: P(Win) for this Provider
    // "How often does this specific AI win effectively?"
    const prior = providerStats.wins / providerStats.total;

    // 3. Calculate Likelihood: P(Confidence|Win) -> approximated by historical win rate of this confidence level
    // "When this AI says 'High', how often is it actually right?"
    // Note: Ideally we'd use P(High|Win), but P(Win|High) is a reasonable proxy for likelihood in this context
    // if we treat the confidence level itself as the observation.
    // Let's refine: Likelihood = P(Observed 'High' | Win)
    // Actually, a simpler Bayesian update:
    // Posteror = (Likelihood * Prior) / Evidence
    // Where Likelihood ~ rawProbabilityPercent/100 (The AI's self-assessment)
    // But AI self-assessment is notoriously uncalibrated.

    // Better Approach:
    // Use the *historical accuracy* of this specific confidence level as the primary weight.
    // If 'High' historically means 55% win rate, we drag the 85% raw probability down towards 55%.

    const confKey = currentConfidence.toLowerCase() as 'high' | 'medium' | 'low';
    const globalStats = calibration[confKey]; // stats for this confidence level (aggregated)
    // Ideally we'd use provider-specific confidence stats, but we might lack granularity.
    // Let's stick to the granular provider win rate (Prior) acting as a gravity well.

    // Bayesian Weighting Implementation:
    // We treat the "Prior" (Historical Provider Accuracy) as a weight against the "New Evidence" (Current Trade Analysis).
    // Formula: Calibrated = (RawProb * k1 + Prior * k2) / (k1 + k2)
    // Where k2 grows with number of historical samples.

    const weightCurrent = 10; // Fixed weight for current analysis
    const weightHistory = Math.min(providerStats.total, 50); // Cap history weight to avoid fossilization

    const historicalWinRatePixels = prior * 100;

    // Weighted Average (a simplified Bayesian update for continuous variables)
    const calibrated = ((rawProbabilityPercent * weightCurrent) + (historicalWinRatePixels * weightHistory)) / (weightCurrent + weightHistory);

    return Math.round(calibrated);
};

// =============================================================================
// AI-FOCUSED CALIBRATION ENHANCEMENTS
// These functions directly impact AI reasoning and confidence adjustments
// =============================================================================

// =============================================================================
// 1. STREAK DETECTION & PENALTY SYSTEM
// =============================================================================

interface StreakInfo {
    currentStreak: number;           // Positive = wins, negative = losses
    streakType: 'hot' | 'cold' | 'neutral';
    streakLength: number;            // Absolute length
    penalty: number;                 // Points to subtract from confidence (0-20)
    mandatoryConfidenceCap: ConfidenceLevel | null;
    promptInjection: string;         // Mandatory instruction for AI
}

/**
 * Detects the current win/loss streak from recent entries.
 * Returns streak info with penalties and mandatory AI instructions.
 */
export const detectStreak = (
    calibration: ConfidenceCalibration | undefined
): StreakInfo => {
    const neutral: StreakInfo = {
        currentStreak: 0,
        streakType: 'neutral',
        streakLength: 0,
        penalty: 0,
        mandatoryConfidenceCap: null,
        promptInjection: ''
    };

    if (!calibration?.entries || calibration.entries.length === 0) {
        return neutral;
    }

    // Sort entries by timestamp descending (most recent first)
    const sortedEntries = [...calibration.entries].sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    // Count consecutive outcomes from most recent
    let streak = 0;
    const firstOutcome = sortedEntries[0].outcome;

    for (const entry of sortedEntries) {
        if (entry.outcome === firstOutcome) {
            streak += (firstOutcome === 'WIN' ? 1 : -1);
        } else {
            break;
        }
    }

    const streakLength = Math.abs(streak);
    const streakType = streak > 0 ? 'hot' : streak < 0 ? 'cold' : 'neutral';

    // Calculate penalty for cold streaks
    let penalty = 0;
    let mandatoryConfidenceCap: ConfidenceLevel | null = null;
    let promptInjection = '';

    if (streakType === 'cold' && streakLength >= STREAK_THRESHOLD) {
        // Calculate penalty: base + additional per trade beyond threshold
        const extraTrades = streakLength - STREAK_THRESHOLD;
        penalty = Math.min(
            STREAK_PENALTY_PER_TRADE * (1 + extraTrades),
            MAX_STREAK_PENALTY
        );

        // Determine mandatory cap
        if (streakLength >= 5) {
            mandatoryConfidenceCap = 'Low';
            // The cap is enforced APP-SIDE (mandatoryConfidenceCap) — the
            // model must NOT be told to cap its own estimate from the USER's
            // trading history (correlation without causation; it used to bias
            // the probability estimate and then entrench itself in the same
            // calibration stats). The prompt gets factual context + an
            // explicit anti-bias instruction instead.
            promptInjection = ` USER JOURNAL CONTEXT: ${streakLength} consecutive losses in the user's log.
IMPORTANT: this is the USER's trading history, not market evidence. It must NOT change your probability estimate or confidence grade — assess this setup on its own evidence. (The app applies its own caution separately.)`;
        } else if (streakLength >= STREAK_THRESHOLD) {
            mandatoryConfidenceCap = 'Medium';
            promptInjection = ` USER JOURNAL CONTEXT: ${streakLength} consecutive losses in the user's log.
IMPORTANT: do not let the user's recent results change your confidence — judge this setup on its own evidence. (The app applies its own caution separately.)`;
        }
    } else if (streakType === 'hot' && streakLength >= STREAK_THRESHOLD) {
        // Hot streak doesn't add penalty but informs AI
        promptInjection = ` HOT STREAK: ${streakLength} consecutive wins.
NOTE: While confidence is justified, maintain discipline.
Do not let winning streak lead to overconfidence or larger position sizes.`;
    }

    return {
        currentStreak: streak,
        streakType,
        streakLength,
        penalty,
        mandatoryConfidenceCap,
        promptInjection
    };
};

// =============================================================================
// 2. BAYESIAN CONFIDENCE ADJUSTMENT
// =============================================================================

interface BayesianAdjustment {
    posteriorWinRate: number;        // Bayesian-adjusted win rate (0-100)
    credibleInterval: { lower: number; upper: number };
    uncertainty: 'low' | 'medium' | 'high';
    confidenceCap: ConfidenceLevel | null;
    promptInjection: string;
}

/**
 * Calculate Bayesian-adjusted win rate with credible intervals.
 * Uses Beta-Binomial model with weak priors.
 */
export const getBayesianConfidenceAdjustment = (
    calibration: ConfidenceCalibration | undefined,
    confidence: ConfidenceLevel
): BayesianAdjustment => {
    const defaultResult: BayesianAdjustment = {
        posteriorWinRate: 50,
        credibleInterval: { lower: 0, upper: 100 },
        uncertainty: 'high',
        confidenceCap: null,
        promptInjection: ''
    };

    if (!calibration) return defaultResult;

    const key = confidence.toLowerCase() as 'high' | 'medium' | 'low' | 'avoid';
    const stats = calibration[key];

    if (stats.total === 0) return defaultResult;

    // Beta posterior: Beta(alpha + wins, beta + losses)
    const alpha = BAYESIAN_PRIOR.ALPHA + stats.wins;
    const beta = BAYESIAN_PRIOR.BETA + stats.losses;

    // Posterior mean
    const posteriorWinRate = Math.round((alpha / (alpha + beta)) * 100);

    // Approximate 90% credible interval using normal approximation
    // (valid for n > 10)
    const variance = (alpha * beta) / ((alpha + beta) ** 2 * (alpha + beta + 1));
    const stdDev = Math.sqrt(variance);
    const z90 = 1.645; // 90% CI

    const lower = Math.max(0, Math.round((alpha / (alpha + beta) - z90 * stdDev) * 100));
    const upper = Math.min(100, Math.round((alpha / (alpha + beta) + z90 * stdDev) * 100));

    // Determine uncertainty level
    let uncertainty: 'low' | 'medium' | 'high';
    if (stats.total >= BAYESIAN_MIN_SAMPLES_HIGH_CONFIDENCE) {
        uncertainty = 'low';
    } else if (stats.total >= BAYESIAN_MIN_SAMPLES_MEDIUM_CONFIDENCE) {
        uncertainty = 'medium';
    } else {
        uncertainty = 'high';
    }

    // Determine if we should cap confidence due to uncertainty
    let confidenceCap: ConfidenceLevel | null = null;
    let promptInjection = '';

    if (uncertainty === 'high' && confidence === 'High') {
        confidenceCap = 'Medium';
        promptInjection = ` BAYESIAN UNCERTAINTY: Only ${stats.total} "${confidence}" trades recorded.
Bayesian estimate: ${posteriorWinRate}% (90% CI: ${lower}%-${upper}%).
Due to HIGH UNCERTAINTY, cap confidence at MEDIUM until more data is collected.`;
    } else if (posteriorWinRate < EXPECTED_WIN_RATES[confidence.toUpperCase() as keyof typeof EXPECTED_WIN_RATES]) {
        const expected = EXPECTED_WIN_RATES[confidence.toUpperCase() as keyof typeof EXPECTED_WIN_RATES];
        promptInjection = ` CALIBRATION WARNING: "${confidence}" trades have ${posteriorWinRate}% Bayesian win rate (expected: ${expected}%+).
90% CI: ${lower}%-${upper}% (n=${stats.total}).
Consider downgrading confidence or improving trade selection for this confidence level.`;
    }

    return {
        posteriorWinRate,
        credibleInterval: { lower, upper },
        uncertainty,
        confidenceCap,
        promptInjection
    };
};

// =============================================================================
// 3. SESSION-BASED REAL-TIME CALIBRATION
// =============================================================================

interface SessionCalibrationState {
    todayWins: number;
    todayLosses: number;
    todayTotal: number;
    todayStreak: number;             // Positive = wins, negative = losses
    sessionPerformance: 'good' | 'neutral' | 'poor' | 'critical';
    penalty: number;
    mandatoryAction: 'none' | 'warn' | 'cap_confidence' | 'suggest_stop';
    promptInjection: string;
}

/**
 * Get today's trading session performance and determine if action is needed.
 */
export const getSessionCalibrationState = (
    calibration: ConfidenceCalibration | undefined
): SessionCalibrationState => {
    const defaultState: SessionCalibrationState = {
        todayWins: 0,
        todayLosses: 0,
        todayTotal: 0,
        todayStreak: 0,
        sessionPerformance: 'neutral',
        penalty: 0,
        mandatoryAction: 'none',
        promptInjection: ''
    };

    if (!calibration?.entries || calibration.entries.length === 0) {
        return defaultState;
    }

    // Get today's start — UTC midnight, the same day boundary the session
    // guard and discipline analytics bucket by. Local midnight disagreed with
    // them for every user west of UTC after 00:00 UTC: a 23:00 EST loss
    // streak read as "0 losses today" here while the guard's banner said
    // stand-down.
    const today = utcDayStart();

    // Filter to today's entries
    const todayEntries = calibration.entries.filter(
        e => new Date(e.timestamp) >= today
    ).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    if (todayEntries.length === 0) {
        return defaultState;
    }

    const todayWins = todayEntries.filter(e => e.outcome === 'WIN').length;
    const todayLosses = todayEntries.filter(e => e.outcome === 'LOSS').length;
    const todayTotal = todayEntries.length;

    // Calculate today's streak (consecutive outcomes from most recent)
    let todayStreak = 0;
    const firstOutcome = todayEntries[0].outcome;
    for (const entry of todayEntries) {
        if (entry.outcome === firstOutcome) {
            todayStreak += (firstOutcome === 'WIN' ? 1 : -1);
        } else {
            break;
        }
    }

    // Determine session performance
    let sessionPerformance: 'good' | 'neutral' | 'poor' | 'critical';
    let mandatoryAction: 'none' | 'warn' | 'cap_confidence' | 'suggest_stop';
    let penalty = 0;
    let promptInjection = '';

    if (todayLosses >= SESSION_THRESHOLDS.CRITICAL) {
        sessionPerformance = 'critical';
        mandatoryAction = 'suggest_stop';
        penalty = MAX_SESSION_PENALTY;
        promptInjection = ` USER SESSION CONTEXT: ${todayWins}W-${todayLosses}L today.
IMPORTANT: this is the USER's session performance, not market evidence — it must NOT change your probability estimate or confidence grade. Assess the setup on its own evidence. (The app applies its own session caution separately.)`;
    } else if (todayLosses >= SESSION_THRESHOLDS.POOR || todayStreak <= -SESSION_THRESHOLDS.POOR) {
        sessionPerformance = 'poor';
        mandatoryAction = 'cap_confidence';
        penalty = Math.round(MAX_SESSION_PENALTY * 0.6);
        promptInjection = ` USER SESSION CONTEXT: ${todayWins}W-${todayLosses}L today (streak: ${todayStreak}).
IMPORTANT: this is the USER's session performance, not market evidence — it must NOT change your probability estimate or confidence grade. Assess the setup on its own evidence.`;
    } else if (todayWins > 0 && todayLosses === 0) {
        sessionPerformance = 'good';
        mandatoryAction = 'none';
        promptInjection = ` Good session: ${todayWins}W-${todayLosses}L today.
Maintain discipline. Do not suggest larger positions due to winning streak.`;
    } else {
        sessionPerformance = 'neutral';
        mandatoryAction = todayLosses > 0 ? 'warn' : 'none';
        if (todayLosses > 0) {
            promptInjection = ` Session status: ${todayWins}W-${todayLosses}L today.
Exercise standard caution. Monitor for deteriorating conditions.`;
        }
    }

    return {
        todayWins,
        todayLosses,
        todayTotal,
        todayStreak,
        sessionPerformance,
        penalty,
        mandatoryAction,
        promptInjection
    };
};

// =============================================================================
// 4. DYNAMIC CONFIDENCE PENALTY CALCULATION
// =============================================================================

interface CalibrationPenalty {
    basePenalty: number;             // From win rate vs expected
    streakPenalty: number;           // From cold streak
    sessionPenalty: number;          // From poor session
    dimensionPenalties: {            // Per-dimension penalties
        coin?: number;
        pattern?: number;
        regime?: number;
        provider?: number;
    };
    totalPenalty: number;            // Sum (capped at 50)
    reasoning: string[];             // Explanations for AI
    adjustedConfidence: ConfidenceLevel;
}

/**
 * Calculate total calibration penalty to apply to confidence score.
 * This is the main function that aggregates all penalty sources.
 */
export const calculateCalibrationPenalty = (
    calibration: ConfidenceCalibration | undefined,
    proposedConfidence: ConfidenceLevel,
    context?: {
        coin?: string;
        pattern?: string;
        regime?: 'trending' | 'ranging' | 'volatile';
        provider?: AIProvider;
    }
): CalibrationPenalty => {
    const reasoning: string[] = [];
    const dimensionPenalties: CalibrationPenalty['dimensionPenalties'] = {};

    // 1. Base penalty from historical accuracy
    let basePenalty = 0;
    if (calibration) {
        const winRate = getCalibratedWinRate(calibration, proposedConfidence);
        const expected = EXPECTED_WIN_RATES[proposedConfidence.toUpperCase() as keyof typeof EXPECTED_WIN_RATES];

        if (winRate !== null && winRate < expected) {
            const shortfall = expected - winRate;
            basePenalty = Math.round(shortfall * 0.3); // 0.3 points per % shortfall
            reasoning.push(`"${proposedConfidence}" trades have ${winRate}% win rate (expected ${expected}%): -${basePenalty} pts`);
        }
    }

    // 2. Streak penalty
    const streakInfo = detectStreak(calibration);
    const streakPenalty = streakInfo.penalty;
    if (streakPenalty > 0) {
        reasoning.push(`Cold streak (${streakInfo.streakLength} losses): -${streakPenalty} pts`);
    }

    // 3. Session penalty
    const sessionState = getSessionCalibrationState(calibration);
    const sessionPenalty = sessionState.penalty;
    if (sessionPenalty > 0) {
        reasoning.push(`Poor session (${sessionState.todayWins}W-${sessionState.todayLosses}L): -${sessionPenalty} pts`);
    }

    // 4. Dimension-specific penalties
    if (calibration?.granular && context) {
        // Coin penalty
        if (context.coin) {
            const coinRate = getWinRateByCoin(calibration, context.coin);
            if (coinRate !== null && coinRate < DANGEROUS_COMBINATION_THRESHOLD) {
                dimensionPenalties.coin = 10;
                reasoning.push(`Poor ${context.coin} performance (${coinRate}%): -10 pts`);
            }
        }

        // Pattern penalty
        if (context.pattern) {
            const patternRate = getWinRateByPattern(calibration, context.pattern);
            if (patternRate !== null && patternRate < DANGEROUS_COMBINATION_THRESHOLD) {
                dimensionPenalties.pattern = 10;
                reasoning.push(`Poor "${context.pattern}" pattern (${patternRate}%): -10 pts`);
            }
        }

        // Regime penalty
        if (context.regime) {
            const regimeRate = getWinRateByRegime(calibration, context.regime);
            if (regimeRate !== null && regimeRate < DANGEROUS_COMBINATION_THRESHOLD) {
                dimensionPenalties.regime = 10;
                reasoning.push(`Poor ${context.regime} market performance (${regimeRate}%): -10 pts`);
            }
        }

        // Provider penalty
        if (context.provider) {
            const providerRate = getWinRateByProvider(calibration, context.provider);
            if (providerRate !== null && providerRate < DANGEROUS_COMBINATION_THRESHOLD) {
                dimensionPenalties.provider = 5;
                reasoning.push(`${context.provider} below average (${providerRate}%): -5 pts`);
            }
        }
    }

    // Calculate total penalty (capped at 50)
    const dimensionTotal = Object.values(dimensionPenalties).reduce((sum, p) => sum + (p || 0), 0);
    const totalPenalty = Math.min(50, basePenalty + streakPenalty + sessionPenalty + dimensionTotal);

    // Map penalty to adjusted confidence
    let adjustedConfidence = proposedConfidence;
    if (totalPenalty >= 40) {
        adjustedConfidence = 'Avoid';
    } else if (totalPenalty >= 25) {
        adjustedConfidence = 'Low';
    } else if (totalPenalty >= 15 && proposedConfidence === 'High') {
        adjustedConfidence = 'Medium';
    }

    // Override with mandatory caps from streak/session
    if (streakInfo.mandatoryConfidenceCap) {
        const capOrder: ConfidenceLevel[] = ['High', 'Medium', 'Low', 'Avoid'];
        const capIdx = capOrder.indexOf(streakInfo.mandatoryConfidenceCap);
        const currentIdx = capOrder.indexOf(adjustedConfidence);
        if (currentIdx < capIdx) {
            adjustedConfidence = streakInfo.mandatoryConfidenceCap;
        }
    }

    if (sessionState.mandatoryAction === 'cap_confidence' && adjustedConfidence === 'High') {
        adjustedConfidence = 'Medium';
    } else if (sessionState.mandatoryAction === 'suggest_stop' && adjustedConfidence !== 'Avoid') {
        adjustedConfidence = 'Low';
    }

    return {
        basePenalty,
        streakPenalty,
        sessionPenalty,
        dimensionPenalties,
        totalPenalty,
        reasoning,
        adjustedConfidence
    };
};

// =============================================================================
// 5. CROSS-DIMENSIONAL CORRELATION DETECTION
// =============================================================================

interface DangerousCombination {
    isDangerous: boolean;
    combination: string;
    historicalWinRate: number;
    sampleSize: number;
    penalty: number;
    mandatoryDowngrade: ConfidenceLevel | null;
    aiPrompt: string;
}

/**
 * Detect dangerous combinations of factors that historically lead to losses.
 * Analyzes cross-dimensional patterns.
 */
export const detectDangerousCombinations = (
    calibration: ConfidenceCalibration | undefined,
    context: {
        coin?: string;
        pattern?: string;
        regime?: 'trending' | 'ranging' | 'volatile';
        confidence: ConfidenceLevel;
    }
): DangerousCombination => {
    const defaultResult: DangerousCombination = {
        isDangerous: false,
        combination: '',
        historicalWinRate: 0,
        sampleSize: 0,
        penalty: 0,
        mandatoryDowngrade: null,
        aiPrompt: ''
    };

    if (!calibration?.granularEntries || calibration.granularEntries.length < MIN_SAMPLES_FOR_CORRELATION) {
        return defaultResult;
    }

    // Filter entries matching the current context
    let matchingEntries = calibration.granularEntries;
    const factors: string[] = [];

    if (context.coin) {
        matchingEntries = matchingEntries.filter(e => e.coin === context.coin);
        factors.push(context.coin);
    }
    if (context.pattern) {
        matchingEntries = matchingEntries.filter(e => e.pattern === context.pattern);
        factors.push(context.pattern);
    }
    if (context.regime) {
        matchingEntries = matchingEntries.filter(e => e.regime === context.regime);
        factors.push(context.regime);
    }
    if (context.confidence) {
        matchingEntries = matchingEntries.filter(e => e.confidence === context.confidence);
        factors.push(`${context.confidence} confidence`);
    }

    // Need at least MIN_SAMPLES_FOR_CORRELATION matching entries
    if (matchingEntries.length < MIN_SAMPLES_FOR_CORRELATION) {
        return defaultResult;
    }

    // Calculate win rate for this combination
    const wins = matchingEntries.filter(e => e.outcome === 'WIN').length;
    const winRate = Math.round((wins / matchingEntries.length) * 100);

    if (winRate >= DANGEROUS_COMBINATION_THRESHOLD) {
        return defaultResult;
    }

    // This combination is dangerous
    const combination = factors.join(' + ');
    const penalty = Math.round((DANGEROUS_COMBINATION_THRESHOLD - winRate) * 0.5);

    let mandatoryDowngrade: ConfidenceLevel | null = null;
    if (winRate < 35) {
        mandatoryDowngrade = 'Avoid';
    } else if (winRate < 45 && context.confidence === 'High') {
        mandatoryDowngrade = 'Medium';
    }

    return {
        isDangerous: true,
        combination,
        historicalWinRate: winRate,
        sampleSize: matchingEntries.length,
        penalty,
        mandatoryDowngrade,
        aiPrompt: ` DANGEROUS COMBINATION DETECTED:
"${combination}" has only ${winRate}% win rate (n=${matchingEntries.length}).
${mandatoryDowngrade ? `MANDATORY: Downgrade confidence to ${mandatoryDowngrade} or lower.` : 'Consider downgrading confidence.'}
This specific combination of factors has historically performed poorly.`
    };
};

// =============================================================================
// 6. PROVIDER ACCURACY ROUTING
// =============================================================================

interface ProviderAccuracyContext {
    rankings: { provider: string; winRate: number; sampleSize: number }[];
    mostAccurate: string | null;
    leastAccurate: string | null;
    accuracySpread: number;          // Difference between best and worst
    promptInjection: string;
}

/**
 * Get provider accuracy rankings for ensemble moderator context.
 */
export const getProviderAccuracyContext = (
    calibration: ConfidenceCalibration | undefined
): ProviderAccuracyContext => {
    const defaultResult: ProviderAccuracyContext = {
        rankings: [],
        mostAccurate: null,
        leastAccurate: null,
        accuracySpread: 0,
        promptInjection: ''
    };

    if (!calibration?.granular?.byProvider) {
        return defaultResult;
    }

    const rankings = getProviderAccuracyComparison(calibration);

    if (rankings.length === 0) {
        return defaultResult;
    }

    // Filter to those with valid win rates
    const validRankings = rankings.filter(r => r.winRate !== null) as { provider: string; winRate: number; total: number }[];

    if (validRankings.length === 0) {
        return defaultResult;
    }

    const mostAccurate = validRankings[0].provider;
    const leastAccurate = validRankings[validRankings.length - 1].provider;
    const accuracySpread = validRankings[0].winRate - validRankings[validRankings.length - 1].winRate;

    let promptInjection = '';
    if (validRankings.length >= 2 && accuracySpread >= 10) {
        const rankingStr = validRankings.slice(0, 4).map(
            r => `${r.provider}: ${r.winRate}% (n=${r.total})`
        ).join(', ');

        promptInjection = ` PROVIDER ACCURACY RANKING:
${rankingStr}

INSTRUCTION FOR MODERATOR: Weight ${mostAccurate}'s analysis more heavily (${validRankings[0].winRate}% accuracy).
Be skeptical of ${leastAccurate}'s recommendations (${validRankings[validRankings.length - 1].winRate}% accuracy).
When providers disagree, favor the more historically accurate provider.`;
    }

    return {
        rankings: validRankings.map(r => ({
            provider: r.provider,
            winRate: r.winRate,
            sampleSize: r.total
        })),
        mostAccurate,
        leastAccurate,
        accuracySpread,
        promptInjection
    };
};

