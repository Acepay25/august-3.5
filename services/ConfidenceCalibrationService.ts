/**
 * ConfidenceCalibrationService
 * Tracks AI confidence predictions vs actual trade outcomes
 * Calculates calibrated probabilities based on historical data
 * 
 * ENHANCED VERSION - Includes:
 * - Increased minimum sample size (10 trades for statistical significance)
 * - Time-decay weighting (recent trades count more)
 * - Named constants (no magic numbers)
 */

import {
    ConfidenceCalibration,
    ConfidenceCalibrationStats,
    TradeOutcome,
    CalibrationEntry,
    GranularCalibrationEntry,
    GranularCalibration,
    AIProvider
} from '../types';
import {
    MIN_TRADES_FOR_CALIBRATION,
    MIN_TRADES_FOR_PROMPT_DISPLAY,
    MIN_TRADES_FOR_CALIBRATION_NOTE,
    DECAY_FACTOR,
    MAX_TRADE_AGE_DAYS
} from '../constants/calibrationConstants';

export type ConfidenceLevel = 'High' | 'Medium' | 'Low' | 'Avoid';

/**
 * Initialize empty calibration object
 */
export const initializeCalibration = (): ConfidenceCalibration => ({
    high: { wins: 0, losses: 0, total: 0 },
    medium: { wins: 0, losses: 0, total: 0 },
    low: { wins: 0, losses: 0, total: 0 },
    avoid: { wins: 0, losses: 0, total: 0 },
    lastUpdated: new Date().toISOString()
});

/**
 * Update calibration stats when a trade is logged
 * Now also stores individual timestamped entries for time-decay calculations
 * @param current - Current calibration data
 * @param confidence - AI's predicted confidence level
 * @param outcome - Actual trade outcome (WIN/LOSS)
 * @returns Updated calibration data
 */
export const updateCalibration = (
    current: ConfidenceCalibration | undefined,
    confidence: ConfidenceLevel,
    outcome: TradeOutcome
): ConfidenceCalibration => {
    // Initialize if not present
    const calibration = current ? { ...current } : initializeCalibration();

    // Only track wins and losses (not PENDING, SKIPPED, ENTRY_NOT_HIT)
    if (outcome !== TradeOutcome.WIN && outcome !== TradeOutcome.LOSS) {
        return calibration;
    }

    // Get the key for the confidence level
    const key = confidence.toLowerCase() as 'high' | 'medium' | 'low' | 'avoid';

    // Update aggregate stats
    const stats = { ...calibration[key] };
    stats.total += 1;
    if (outcome === TradeOutcome.WIN) {
        stats.wins += 1;
    } else {
        stats.losses += 1;
    }

    // Create new timestamped entry for time-decay calculations
    const newEntry: CalibrationEntry = {
        timestamp: new Date().toISOString(),
        confidence,
        outcome: outcome === TradeOutcome.WIN ? 'WIN' : 'LOSS'
    };

    // Append to entries array (create if doesn't exist)
    const entries = [...(calibration.entries || []), newEntry];

    // Prune old entries beyond MAX_TRADE_AGE_DAYS to keep storage manageable
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - MAX_TRADE_AGE_DAYS);
    const prunedEntries = entries.filter(e => new Date(e.timestamp) >= cutoffDate);

    return {
        ...calibration,
        [key]: stats,
        entries: prunedEntries,
        lastUpdated: new Date().toISOString()
    };
};

/**
 * Calculate calibrated win rate for a confidence level
 * @param calibration - Calibration data
 * @param confidence - Confidence level to check
 * @returns Win rate as percentage (0-100), or null if insufficient data
 */
export const getCalibratedWinRate = (
    calibration: ConfidenceCalibration | undefined,
    confidence: ConfidenceLevel
): number | null => {
    if (!calibration) return null;

    const key = confidence.toLowerCase() as 'high' | 'medium' | 'low' | 'avoid';
    const stats = calibration[key];

    // Require minimum trades for statistical significance (increased from 3 to 10)
    if (stats.total < MIN_TRADES_FOR_CALIBRATION) return null;

    return Math.round((stats.wins / stats.total) * 100);
};

/**
 * Calculate calibrated win rate with time decay weighting.
 * Recent trades are weighted more heavily than older trades.
 * Uses exponential decay: weight = DECAY_FACTOR ^ days_ago
 * 
 * @param calibration - Calibration data with entries
 * @param confidence - Confidence level to check
 * @returns Win rate as percentage (0-100), or null if insufficient data
 */
export const getCalibratedWinRateWithDecay = (
    calibration: ConfidenceCalibration | undefined,
    confidence: ConfidenceLevel
): number | null => {
    if (!calibration || !calibration.entries || calibration.entries.length === 0) {
        // Fall back to simple win rate if no entries available
        return getCalibratedWinRate(calibration, confidence);
    }

    // Filter entries for this confidence level
    const relevantEntries = calibration.entries.filter(
        e => e.confidence === confidence
    );

    // Require minimum entries for statistical significance
    if (relevantEntries.length < MIN_TRADES_FOR_CALIBRATION) {
        return getCalibratedWinRate(calibration, confidence);
    }

    const now = new Date();
    let weightedWins = 0;
    let totalWeight = 0;

    for (const entry of relevantEntries) {
        const entryDate = new Date(entry.timestamp);
        const daysAgo = Math.floor((now.getTime() - entryDate.getTime()) / (1000 * 60 * 60 * 24));

        // Calculate weight using exponential decay
        const weight = Math.pow(DECAY_FACTOR, daysAgo);

        totalWeight += weight;
        if (entry.outcome === 'WIN') {
            weightedWins += weight;
        }
    }

    if (totalWeight === 0) return null;

    return Math.round((weightedWins / totalWeight) * 100);
};

/**
 * Get sample size for a confidence level
 */
export const getSampleSize = (
    calibration: ConfidenceCalibration | undefined,
    confidence: ConfidenceLevel
): number => {
    if (!calibration) return 0;
    const key = confidence.toLowerCase() as 'high' | 'medium' | 'low' | 'avoid';
    return calibration[key].total;
};

/**
 * Get full calibration stats for display
 */
export const getCalibrationSummary = (
    calibration: ConfidenceCalibration | undefined
): {
    high: { winRate: number | null; total: number };
    medium: { winRate: number | null; total: number };
    low: { winRate: number | null; total: number };
    avoid: { winRate: number | null; total: number };
    totalTrades: number;
} => {
    if (!calibration) {
        return {
            high: { winRate: null, total: 0 },
            medium: { winRate: null, total: 0 },
            low: { winRate: null, total: 0 },
            avoid: { winRate: null, total: 0 },
            totalTrades: 0
        };
    }

    return {
        high: {
            winRate: getCalibratedWinRate(calibration, 'High'),
            total: calibration.high.total
        },
        medium: {
            winRate: getCalibratedWinRate(calibration, 'Medium'),
            total: calibration.medium.total
        },
        low: {
            winRate: getCalibratedWinRate(calibration, 'Low'),
            total: calibration.low.total
        },
        avoid: {
            winRate: getCalibratedWinRate(calibration, 'Avoid'),
            total: calibration.avoid.total
        },
        totalTrades: calibration.high.total + calibration.medium.total + calibration.low.total + calibration.avoid.total
    };
};

export const getConfidenceAccuracy = (
    calibration: ConfidenceCalibration | undefined,
    confidence: ConfidenceLevel,
    aiProbability: number
): 'accurate' | 'overconfident' | 'underconfident' | 'insufficient_data' => {
    const winRate = getCalibratedWinRate(calibration, confidence);

    if (winRate === null) return 'insufficient_data';

    const diff = aiProbability - winRate;

    if (Math.abs(diff) <= 10) return 'accurate';
    if (diff > 10) return 'overconfident';
    return 'underconfident';
};

/**
 * Generate a prompt injection for AI context with calibration data
 * This informs the AI about its historical accuracy at each confidence level
 */
export const generateCalibrationPromptInjection = (
    calibration: ConfidenceCalibration | undefined
): string => {
    if (!calibration) {
        return `
📊 **CONFIDENCE CALIBRATION DATA**
No historical data available yet. As trades are logged, this section will show your actual accuracy for each confidence level.
`;
    }

    const summary = getCalibrationSummary(calibration);
    const totalTrades = summary.totalTrades;

    if (totalTrades < MIN_TRADES_FOR_PROMPT_DISPLAY) {
        return `
📊 **CONFIDENCE CALIBRATION DATA**
Limited data (${totalTrades} trades logged). Minimum ${MIN_TRADES_FOR_CALIBRATION} trades needed per confidence level for reliable calibration.
Continue logging trades to build historical accuracy data.
`;
    }

    const formatLevel = (level: string, stats: { winRate: number | null; total: number }) => {
        if (stats.total < MIN_TRADES_FOR_CALIBRATION) {
            return `| ${level.padEnd(8)} | Insufficient data (n=${stats.total}, need ${MIN_TRADES_FOR_CALIBRATION}) |`;
        }
        const winRateStr = stats.winRate !== null ? `${stats.winRate}%` : 'N/A';
        const indicator = stats.winRate !== null
            ? (stats.winRate >= 70 ? '✅' : stats.winRate >= 50 ? '⚠️' : '❌')
            : '❓';
        return `| ${level.padEnd(8)} | ${winRateStr.padEnd(6)} | n=${stats.total.toString().padEnd(3)} | ${indicator}`;
    };

    // Generate warnings based on calibration
    const warnings: string[] = [];

    if (summary.high.winRate !== null && summary.high.winRate < 60) {
        warnings.push(`⚠️ "High" confidence trades are only ${summary.high.winRate}% accurate. Consider being more selective.`);
    }
    if (summary.medium.winRate !== null && summary.medium.winRate > summary.high.winRate!) {
        warnings.push(`📈 "Medium" confidence (${summary.medium.winRate}%) outperforms "High" (${summary.high.winRate}%). Your high-confidence filter may be too loose.`);
    }
    if (summary.avoid.total > 0 && summary.avoid.winRate !== null && summary.avoid.winRate > 30) {
        warnings.push(`🤔 "Avoid" trades have ${summary.avoid.winRate}% win rate. Consider if some "Avoid" setups are being under-rated.`);
    }

    return `
📊 **CONFIDENCE CALIBRATION DATA (${totalTrades} trades)**

YOUR HISTORICAL ACCURACY BY CONFIDENCE LEVEL:
| Level    | Win Rate | Trades | Status |
|----------|----------|--------|--------|
${formatLevel('High', summary.high)}
${formatLevel('Medium', summary.medium)}
${formatLevel('Low', summary.low)}
${formatLevel('Avoid', summary.avoid)}

${warnings.length > 0 ? `\n**CALIBRATION INSIGHTS:**\n${warnings.join('\n')}\n` : ''}
**INSTRUCTION:** Adjust your confidence ratings based on this historical data.
- If you typically rate trades as "High" but they only win 55%, be more conservative.
- If "Medium" trades win more than "High", your confidence thresholds need recalibration.
- Use this data to make your confidence predictions more accurate over time.
`;
};

/**
 * Get a short calibration note for a specific confidence level
 * Used for inline display in trade recommendations
 */
export const getCalibrationNote = (
    calibration: ConfidenceCalibration | undefined,
    confidence: ConfidenceLevel
): string | null => {
    if (!calibration) return null;

    const summary = getCalibrationSummary(calibration);
    const key = confidence.toLowerCase() as 'high' | 'medium' | 'low' | 'avoid';
    const stats = summary[key];

    if (stats.total < MIN_TRADES_FOR_CALIBRATION_NOTE || stats.winRate === null) {
        return null;
    }

    return `Historical "${confidence}": ${stats.winRate}% win rate (n=${stats.total})`;
};

/**
 * Get recommended confidence adjustment based on calibration
 * Returns null if no adjustment needed, or a suggested level if calibration suggests change
 */
export const getRecommendedConfidenceAdjustment = (
    calibration: ConfidenceCalibration | undefined,
    currentConfidence: ConfidenceLevel,
    aiProbability: number
): {
    suggestedConfidence: ConfidenceLevel | null;
    reason: string | null
} => {
    if (!calibration) {
        return { suggestedConfidence: null, reason: null };
    }

    const summary = getCalibrationSummary(calibration);
    const currentKey = currentConfidence.toLowerCase() as 'high' | 'medium' | 'low' | 'avoid';
    const currentStats = summary[currentKey];

    if (currentStats.total < 5 || currentStats.winRate === null) {
        return { suggestedConfidence: null, reason: null };
    }

    // If AI says "High" but historical high-confidence trades are <50% accurate
    if (currentConfidence === 'High' && currentStats.winRate < 50) {
        return {
            suggestedConfidence: 'Medium',
            reason: `Historical "High" confidence win rate is only ${currentStats.winRate}% - suggesting downgrade to "Medium"`
        };
    }

    // If AI says "High" but probability is much higher than historical accuracy
    if (currentConfidence === 'High' && aiProbability > currentStats.winRate + 20) {
        return {
            suggestedConfidence: 'Medium',
            reason: `AI probability (${aiProbability}%) is ${aiProbability - currentStats.winRate}% higher than historical accuracy (${currentStats.winRate}%)`
        };
    }

    // If "Medium" historically outperforms "High"
    if (currentConfidence === 'High' &&
        summary.medium.winRate !== null &&
        summary.medium.total >= 5 &&
        summary.medium.winRate > currentStats.winRate + 10) {
        return {
            suggestedConfidence: null,
            reason: `Note: "Medium" confidence trades (${summary.medium.winRate}%) historically outperform "High" (${currentStats.winRate}%)`
        };
    }

    return { suggestedConfidence: null, reason: null };
};

/**
 * Calculate Bayesian Posterior Probability
 * 
 * Bayes' Theorem: P(A|B) = (P(B|A) * P(A)) / P(B)
 * - P(A|B): Posterior (Probability of Winning given this Confidence level)
 * - P(B|A): Likelihood (Probability of this Confidence level given a Win)
 * - P(A): Prior (Overall Win Rate of the specific Provider)
 * - P(B): Evidence (Overall Probability of this Confidence level being output)
 * 
 * @param prior - The historical win rate of the provider (0-1)
 * @param likelihood - Estimated accuracy of the current confidence level (0-1)
 * @param evidence - Frequency at which this provider outputs this confidence level (0-1)
 */
export const calculateBayesianProbability = (
    prior: number,
    likelihood: number,
    evidence: number
): number => {
    // Avoid division by zero
    if (evidence <= 0) return 0;

    const posterior = (likelihood * prior) / evidence;

    // Clamp result between 0 and 1
    return Math.min(Math.max(posterior, 0), 1);
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
// GRANULAR CALIBRATION - Per-Coin, Per-Pattern, Per-Timeframe, Per-Regime
// =============================================================================

/**
 * Initialize empty granular calibration structure
 */
export const initializeGranularCalibration = (): GranularCalibration => ({
    byCoin: {},
    byPattern: {},
    byTimeframe: {},
    byRegime: {},
    byProvider: {},
    bySession: {},
    byDayOfWeek: {}
});

/**
 * Detect trading session based on UTC hour
 * - Asian: 00:00-08:00 UTC
 * - London: 08:00-13:00 UTC (before overlap)
 * - Overlap: 13:00-16:00 UTC (London/NY overlap - highest volume)
 * - New York: 16:00-21:00 UTC (after overlap)
 * - Asian: 21:00-24:00 UTC (late night = early Asian)
 */
export const detectTradingSession = (timestamp?: string): 'asian' | 'london' | 'new_york' | 'overlap' => {
    const date = timestamp ? new Date(timestamp) : new Date();
    const utcHour = date.getUTCHours();

    // Overlap period (London + NY both active) - highest volume
    if (utcHour >= 13 && utcHour < 16) {
        return 'overlap';
    }
    // London session (before overlap)
    if (utcHour >= 8 && utcHour < 13) {
        return 'london';
    }
    // New York session (after overlap)
    if (utcHour >= 16 && utcHour < 21) {
        return 'new_york';
    }
    // Asian session (night in US/Europe)
    return 'asian';
};

/**
 * Update granular calibration with a new trade entry
 * Tracks accuracy across multiple dimensions: coin, pattern, timeframe, regime, provider, day of week
 */
export const updateGranularCalibration = (
    current: ConfidenceCalibration | undefined,
    entry: GranularCalibrationEntry
): ConfidenceCalibration => {
    // First update base calibration
    const base = updateCalibration(current, entry.confidence,
        entry.outcome === 'WIN' ? TradeOutcome.WIN : TradeOutcome.LOSS);

    // Initialize granular structure if not present
    const granular: GranularCalibration = base.granular ? { ...base.granular } : initializeGranularCalibration();
    const granularEntries = [...(base.granularEntries || []), entry];

    // Helper to update stats for a dimension
    const updateDimensionStats = (
        dimension: { [key: string]: ConfidenceCalibrationStats },
        key: string | undefined,
        isWin: boolean
    ): { [key: string]: ConfidenceCalibrationStats } => {
        if (!key) return dimension;

        const existing = dimension[key] || { wins: 0, losses: 0, total: 0 };
        return {
            ...dimension,
            [key]: {
                wins: existing.wins + (isWin ? 1 : 0),
                losses: existing.losses + (isWin ? 0 : 1),
                total: existing.total + 1
            }
        };
    };

    const isWin = entry.outcome === 'WIN';

    // Update each dimension - use fallback empty objects for old data that may not have all properties
    granular.byCoin = updateDimensionStats(granular.byCoin || {}, entry.coin, isWin);
    granular.byPattern = updateDimensionStats(granular.byPattern || {}, entry.pattern, isWin);
    granular.byTimeframe = updateDimensionStats(granular.byTimeframe || {}, entry.timeframe, isWin);
    granular.byRegime = updateDimensionStats(granular.byRegime || {}, entry.regime, isWin);

    // Update provider dimension
    if (entry.provider) {
        const providerKey = entry.provider.toString();
        granular.byProvider = updateDimensionStats(granular.byProvider || {}, providerKey, isWin);
    }

    // Update session dimension (auto-detect if not provided)
    const session = entry.session || detectTradingSession(entry.timestamp);
    granular.bySession = updateDimensionStats(granular.bySession || {}, session, isWin);

    // Update Day of Week dimension
    const date = entry.timestamp ? new Date(entry.timestamp) : new Date();
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayName = days[date.getUTCDay()];
    granular.byDayOfWeek = updateDimensionStats(granular.byDayOfWeek || {}, dayName, isWin);

    return {
        ...base,
        granular,
        granularEntries
    };
};

/**
 * Get win rate for a specific coin
 */
export const getWinRateByCoin = (
    calibration: ConfidenceCalibration | undefined,
    coin: string
): number | null => {
    if (!calibration?.granular?.byCoin) return null;

    const stats = calibration.granular.byCoin[coin];
    if (!stats || stats.total < MIN_TRADES_FOR_CALIBRATION) return null;

    return Math.round((stats.wins / stats.total) * 100);
};

/**
 * Get win rate for a specific pattern (e.g., "Family C", "Bull Flag")
 */
export const getWinRateByPattern = (
    calibration: ConfidenceCalibration | undefined,
    pattern: string
): number | null => {
    if (!calibration?.granular?.byPattern) return null;

    const stats = calibration.granular.byPattern[pattern];
    if (!stats || stats.total < MIN_TRADES_FOR_CALIBRATION) return null;

    return Math.round((stats.wins / stats.total) * 100);
};

/**
 * Get win rate for a specific timeframe
 */
export const getWinRateByTimeframe = (
    calibration: ConfidenceCalibration | undefined,
    timeframe: string
): number | null => {
    if (!calibration?.granular?.byTimeframe) return null;

    const stats = calibration.granular.byTimeframe[timeframe];
    if (!stats || stats.total < MIN_TRADES_FOR_CALIBRATION) return null;

    return Math.round((stats.wins / stats.total) * 100);
};

/**
 * Get win rate for a specific market regime
 */
export const getWinRateByRegime = (
    calibration: ConfidenceCalibration | undefined,
    regime: 'trending' | 'ranging' | 'volatile'
): number | null => {
    if (!calibration?.granular?.byRegime) return null;

    const stats = calibration.granular.byRegime[regime];
    if (!stats || stats.total < MIN_TRADES_FOR_CALIBRATION) return null;

    return Math.round((stats.wins / stats.total) * 100);
};

/**
 * Get win rate for a specific AI provider
 */
export const getWinRateByProvider = (
    calibration: ConfidenceCalibration | undefined,
    provider: AIProvider | string
): number | null => {
    if (!calibration?.granular?.byProvider) return null;

    const providerKey = typeof provider === 'string' ? provider : String(provider);
    const stats = calibration.granular.byProvider[providerKey];
    if (!stats || stats.total < MIN_TRADES_FOR_CALIBRATION) return null;

    return Math.round((stats.wins / stats.total) * 100);
};

/**
 * Get win rate for a specific trading session
 */
export const getWinRateBySession = (
    calibration: ConfidenceCalibration | undefined,
    session: 'asian' | 'london' | 'new_york' | 'overlap'
): number | null => {
    if (!calibration?.granular?.bySession) return null;

    const stats = calibration.granular.bySession[session];
    if (!stats || stats.total < MIN_TRADES_FOR_CALIBRATION) return null;

    return Math.round((stats.wins / stats.total) * 100);
};

/**
 * Get win rate for a specific day of the week
 */
export const getWinRateByDay = (
    calibration: ConfidenceCalibration | undefined,
    day: string
): number | null => {
    if (!calibration?.granular?.byDayOfWeek) return null;

    const stats = calibration.granular.byDayOfWeek[day];
    if (!stats || stats.total < MIN_TRADES_FOR_CALIBRATION) return null;

    return Math.round((stats.wins / stats.total) * 100);
};

/**
 * Get all session accuracies for comparison
 */
export const getSessionAccuracyComparison = (
    calibration: ConfidenceCalibration | undefined
): { session: string; winRate: number | null; total: number }[] => {
    if (!calibration?.granular?.bySession) return [];

    const sessionOrder = ['asian', 'london', 'overlap', 'new_york'];
    const sessionLabels: Record<string, string> = {
        asian: '🌏 Asian (00-08 UTC)',
        london: '🇬🇧 London (08-13 UTC)',
        overlap: '🔥 Overlap (13-16 UTC)',
        new_york: '🇺🇸 New York (16-21 UTC)'
    };

    // Safely access bySession with defensive checks for old/incomplete data
    const bySession = calibration.granular?.bySession || {};

    return sessionOrder
        .filter(session => bySession[session])
        .map(session => ({
            session: sessionLabels[session] || session,
            winRate: bySession[session]?.total >= MIN_TRADES_FOR_CALIBRATION
                ? Math.round((bySession[session].wins / bySession[session].total) * 100)
                : null,
            total: bySession[session]?.total || 0
        }));
};

/**
 * Generate session-specific calibration prompt for AI context
 * Informs AI about historical performance across different trading sessions
 */
export const generateSessionCalibrationPrompt = (
    calibration: ConfidenceCalibration | undefined
): string => {
    if (!calibration?.granular?.bySession) return '';

    const sessions = getSessionAccuracyComparison(calibration);
    if (sessions.length === 0) return '';

    const currentSession = detectTradingSession();
    const currentSessionData = calibration.granular?.bySession?.[currentSession];

    let prompt = `\n🕐 **SESSION & TIME ACCURACY DATA**\n`;
    prompt += `Current Session: ${currentSession.toUpperCase()}\n`;

    // Add Day of Week Warning
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const currentDay = days[new Date().getUTCDay()];
    const dayWinRate = getWinRateByDay(calibration, currentDay);

    if (dayWinRate !== null) {
        prompt += `Current Day: ${currentDay.toUpperCase()} (Win Rate: ${dayWinRate}%)\n`;
        if (dayWinRate < 45) {
            prompt += `⚠️ WARNING: ${currentDay} is historically a low win-rate day for you (${dayWinRate}%). Exercise extreme caution.\n`;
        }
    }
    prompt += '\n';

    // Show all session stats
    for (const s of sessions) {
        const indicator = s.winRate !== null
            ? (s.winRate >= 60 ? '✅' : s.winRate >= 45 ? '⚠️' : '❌')
            : '❓';
        prompt += `${indicator} ${s.session}: ${s.winRate !== null ? `${s.winRate}%` : 'N/A'} (n=${s.total})\n`;
    }

    // Add warning if current session has poor performance
    if (currentSessionData && currentSessionData.total >= MIN_TRADES_FOR_CALIBRATION) {
        const currentWinRate = Math.round((currentSessionData.wins / currentSessionData.total) * 100);
        if (currentWinRate < 45) {
            prompt += `\n⚠️ **WARNING:** Your ${currentSession.toUpperCase()} session win rate is ${currentWinRate}%. Consider being more selective or avoiding trades during this session.\n`;
        } else if (currentWinRate >= 60) {
            prompt += `\n✅ **FAVORABLE:** Your ${currentSession.toUpperCase()} session win rate is ${currentWinRate}%. This is historically your stronger session.\n`;
        }
    }

    return prompt;
};

/**
 * Get all provider accuracies for comparison
 */
export const getProviderAccuracyComparison = (
    calibration: ConfidenceCalibration | undefined
): { provider: string; winRate: number | null; total: number }[] => {
    if (!calibration?.granular?.byProvider) return [];

    return Object.entries(calibration.granular.byProvider).map(([provider, stats]) => ({
        provider,
        winRate: stats.total >= MIN_TRADES_FOR_CALIBRATION
            ? Math.round((stats.wins / stats.total) * 100)
            : null,
        total: stats.total
    })).sort((a, b) => (b.winRate ?? 0) - (a.winRate ?? 0));
};

/**
 * Generate a granular calibration prompt for AI context
 * Provides context-specific accuracy data based on current trade parameters
 */
export const generateGranularCalibrationPrompt = (
    calibration: ConfidenceCalibration | undefined,
    context: {
        coin?: string;
        pattern?: string;
        timeframe?: string;
        regime?: 'trending' | 'ranging' | 'volatile'
    }
): string => {
    if (!calibration?.granular) return '';

    const points: string[] = [];

    // Coin-specific accuracy
    if (context.coin) {
        const coinRate = getWinRateByCoin(calibration, context.coin);
        if (coinRate !== null) {
            const stats = calibration.granular.byCoin[context.coin];
            const indicator = coinRate >= 60 ? '✅' : coinRate >= 45 ? '⚠️' : '❌';
            points.push(`${indicator} ${context.coin}: ${coinRate}% win rate (n=${stats.total})`);
        }
    }

    // Pattern-specific accuracy
    if (context.pattern) {
        const patternRate = getWinRateByPattern(calibration, context.pattern);
        if (patternRate !== null) {
            const stats = calibration.granular.byPattern[context.pattern];
            const indicator = patternRate >= 60 ? '✅' : patternRate >= 45 ? '⚠️' : '❌';
            points.push(`${indicator} ${context.pattern}: ${patternRate}% win rate (n=${stats.total})`);
        }
    }

    // Timeframe-specific accuracy
    if (context.timeframe) {
        const tfRate = getWinRateByTimeframe(calibration, context.timeframe);
        if (tfRate !== null) {
            const stats = calibration.granular.byTimeframe[context.timeframe];
            const indicator = tfRate >= 60 ? '✅' : tfRate >= 45 ? '⚠️' : '❌';
            points.push(`${indicator} ${context.timeframe} timeframe: ${tfRate}% win rate (n=${stats.total})`);
        }
    }

    // Regime-specific accuracy
    if (context.regime) {
        const regimeRate = getWinRateByRegime(calibration, context.regime);
        if (regimeRate !== null) {
            const stats = calibration.granular.byRegime[context.regime];
            const indicator = regimeRate >= 60 ? '✅' : regimeRate >= 45 ? '⚠️' : '❌';
            points.push(`${indicator} ${context.regime} market: ${regimeRate}% win rate (n=${stats.total})`);
        }
    }

    if (points.length === 0) return '';

    return `
🎯 **CONTEXT-SPECIFIC CALIBRATION**
${points.join('\n')}

**INSTRUCTIONS:** Use this granular data to refine your confidence. 
If historical accuracy for this specific context is <50%, consider downgrading confidence.
`;
};

/**
 * Get the best performing pattern from calibration data
 */
export const getBestPerformingPatterns = (
    calibration: ConfidenceCalibration | undefined,
    limit: number = 3
): { pattern: string; winRate: number; total: number }[] => {
    if (!calibration?.granular?.byPattern) return [];

    return Object.entries(calibration.granular.byPattern)
        .filter(([_, stats]) => stats.total >= MIN_TRADES_FOR_CALIBRATION)
        .map(([pattern, stats]) => ({
            pattern,
            winRate: Math.round((stats.wins / stats.total) * 100),
            total: stats.total
        }))
        .sort((a, b) => b.winRate - a.winRate)
        .slice(0, limit);
};

/**
 * Get the worst performing patterns (for warnings)
 */
export const getWorstPerformingPatterns = (
    calibration: ConfidenceCalibration | undefined,
    limit: number = 3
): { pattern: string; winRate: number; total: number }[] => {
    if (!calibration?.granular?.byPattern) return [];

    return Object.entries(calibration.granular.byPattern)
        .filter(([_, stats]) => stats.total >= MIN_TRADES_FOR_CALIBRATION)
        .map(([pattern, stats]) => ({
            pattern,
            winRate: Math.round((stats.wins / stats.total) * 100),
            total: stats.total
        }))
        .sort((a, b) => a.winRate - b.winRate)
        .slice(0, limit);
};

// =============================================================================
// AI-FOCUSED CALIBRATION ENHANCEMENTS
// These functions directly impact AI reasoning and confidence adjustments
// =============================================================================

import {
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
} from '../constants/calibrationConstants';

// =============================================================================
// 1. STREAK DETECTION & PENALTY SYSTEM
// =============================================================================

export interface StreakInfo {
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
            promptInjection = `🚨 CRITICAL COLD STREAK: ${streakLength} consecutive losses.
MANDATORY INSTRUCTION: Cap ALL confidence levels at LOW or AVOID.
Do NOT suggest "High" or "Medium" confidence under any circumstances.
Consider recommending the user takes a break from trading.`;
        } else if (streakLength >= STREAK_THRESHOLD) {
            mandatoryConfidenceCap = 'Medium';
            promptInjection = `⚠️ COLD STREAK ALERT: ${streakLength} consecutive losses.
MANDATORY INSTRUCTION: Cap confidence at MEDIUM or lower.
If you would normally suggest "High" confidence, you MUST downgrade to "Medium".
User's recent performance suggests increased caution is required.`;
        }
    } else if (streakType === 'hot' && streakLength >= STREAK_THRESHOLD) {
        // Hot streak doesn't add penalty but informs AI
        promptInjection = `🔥 HOT STREAK: ${streakLength} consecutive wins.
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

export interface BayesianAdjustment {
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
        promptInjection = `📊 BAYESIAN UNCERTAINTY: Only ${stats.total} "${confidence}" trades recorded.
Bayesian estimate: ${posteriorWinRate}% (90% CI: ${lower}%-${upper}%).
Due to HIGH UNCERTAINTY, cap confidence at MEDIUM until more data is collected.`;
    } else if (posteriorWinRate < EXPECTED_WIN_RATES[confidence.toUpperCase() as keyof typeof EXPECTED_WIN_RATES]) {
        const expected = EXPECTED_WIN_RATES[confidence.toUpperCase() as keyof typeof EXPECTED_WIN_RATES];
        promptInjection = `📉 CALIBRATION WARNING: "${confidence}" trades have ${posteriorWinRate}% Bayesian win rate (expected: ${expected}%+).
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

export interface SessionCalibrationState {
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

    // Get today's start (midnight local time)
    const today = new Date();
    today.setHours(0, 0, 0, 0);

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
        promptInjection = `🛑 CRITICAL SESSION ALERT: ${todayWins}W-${todayLosses}L today.
MANDATORY INSTRUCTION: ALL confidence levels capped at LOW.
Strongly recommend user STOPS TRADING for today.
Multiple losses indicate conditions are unfavorable or emotional trading has begun.
If user insists on trading, set confidence to AVOID unless setup is exceptional.`;
    } else if (todayLosses >= SESSION_THRESHOLDS.POOR || todayStreak <= -SESSION_THRESHOLDS.POOR) {
        sessionPerformance = 'poor';
        mandatoryAction = 'cap_confidence';
        penalty = Math.round(MAX_SESSION_PENALTY * 0.6);
        promptInjection = `⚠️ POOR SESSION: ${todayWins}W-${todayLosses}L today (streak: ${todayStreak}).
INSTRUCTION: Cap confidence at MEDIUM. Do not suggest "High" confidence.
User should consider reducing position size or taking a break.`;
    } else if (todayWins > 0 && todayLosses === 0) {
        sessionPerformance = 'good';
        mandatoryAction = 'none';
        promptInjection = `✅ Good session: ${todayWins}W-${todayLosses}L today.
Maintain discipline. Do not suggest larger positions due to winning streak.`;
    } else {
        sessionPerformance = 'neutral';
        mandatoryAction = todayLosses > 0 ? 'warn' : 'none';
        if (todayLosses > 0) {
            promptInjection = `📊 Session status: ${todayWins}W-${todayLosses}L today.
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

export interface CalibrationPenalty {
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

export interface DangerousCombination {
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
        aiPrompt: `🚨 DANGEROUS COMBINATION DETECTED:
"${combination}" has only ${winRate}% win rate (n=${matchingEntries.length}).
${mandatoryDowngrade ? `MANDATORY: Downgrade confidence to ${mandatoryDowngrade} or lower.` : 'Consider downgrading confidence.'}
This specific combination of factors has historically performed poorly.`
    };
};

// =============================================================================
// 6. PROVIDER ACCURACY ROUTING
// =============================================================================

export interface ProviderAccuracyContext {
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

        promptInjection = `📊 PROVIDER ACCURACY RANKING:
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

// =============================================================================
// 7. VOLATILITY-ADJUSTED CALIBRATION
// =============================================================================

/**
 * Generate volatility-aware calibration prompt based on historical performance in different regimes.
 */
export const getVolatilityAdjustedPrompt = (
    calibration: ConfidenceCalibration | undefined,
    currentRegime: 'trending' | 'ranging' | 'volatile'
): string => {
    if (!calibration?.granular?.byRegime) {
        return '';
    }

    const regimeRate = getWinRateByRegime(calibration, currentRegime);
    const regimeStats = calibration.granular.byRegime[currentRegime];

    if (regimeRate === null || !regimeStats || regimeStats.total < MIN_TRADES_FOR_CALIBRATION) {
        return '';
    }

    // Compare to overall performance
    const totalWins = calibration.high.wins + calibration.medium.wins + calibration.low.wins;
    const totalAll = calibration.high.total + calibration.medium.total + calibration.low.total;
    const overallRate = totalAll > 0 ? Math.round((totalWins / totalAll) * 100) : 50;

    const diff = regimeRate - overallRate;
    const regimeLabel = currentRegime.charAt(0).toUpperCase() + currentRegime.slice(1);

    if (diff < -10) {
        return `⚠️ VOLATILITY-ADJUSTED WARNING:
Your accuracy in ${regimeLabel} markets: ${regimeRate}% (vs ${overallRate}% overall).
Current market regime: ${regimeLabel.toUpperCase()}.
You historically underperform by ${Math.abs(diff)}% in this regime.
INSTRUCTION: Consider downgrading confidence or passing on this trade.`;
    } else if (diff > 10) {
        return `✅ REGIME ADVANTAGE:
Your accuracy in ${regimeLabel} markets: ${regimeRate}% (vs ${overallRate}% overall).
You historically outperform by ${diff}% in this regime.
Confidence levels may be slightly more reliable than usual.`;
    }

    return '';
};

// =============================================================================
// 8. MASTER CALIBRATION PROMPT GENERATOR
// =============================================================================

/**
 * Generate comprehensive calibration prompt for AI injection.
 * Combines all calibration insights into a single prompt block.
 */
export const generateEnhancedCalibrationPromptInjection = (
    calibration: ConfidenceCalibration | undefined,
    proposedConfidence: ConfidenceLevel,
    context?: {
        coin?: string;
        pattern?: string;
        regime?: 'trending' | 'ranging' | 'volatile';
        provider?: AIProvider;
    }
): {
    promptInjection: string;
    adjustedConfidence: ConfidenceLevel;
    totalPenalty: number;
} => {
    if (!calibration) {
        return {
            promptInjection: '',
            adjustedConfidence: proposedConfidence,
            totalPenalty: 0
        };
    }

    const parts: string[] = [];

    // 1. Streak info
    const streakInfo = detectStreak(calibration);
    if (streakInfo.promptInjection) {
        parts.push(streakInfo.promptInjection);
    }

    // 2. Session state
    const sessionState = getSessionCalibrationState(calibration);
    if (sessionState.promptInjection) {
        parts.push(sessionState.promptInjection);
    }

    // 3. Bayesian adjustment
    const bayesian = getBayesianConfidenceAdjustment(calibration, proposedConfidence);
    if (bayesian.promptInjection) {
        parts.push(bayesian.promptInjection);
    }

    // 4. Dangerous combinations
    if (context) {
        const dangerous = detectDangerousCombinations(calibration, {
            ...context,
            confidence: proposedConfidence
        });
        if (dangerous.isDangerous) {
            parts.push(dangerous.aiPrompt);
        }
    }

    // 5. Volatility adjustment
    if (context?.regime) {
        const volatilityPrompt = getVolatilityAdjustedPrompt(calibration, context.regime);
        if (volatilityPrompt) {
            parts.push(volatilityPrompt);
        }
    }

    // 6. Calculate total penalty and adjusted confidence
    const penalty = calculateCalibrationPenalty(calibration, proposedConfidence, context);

    // 7. Add base calibration summary
    const baseSummary = generateCalibrationPromptInjection(calibration);
    if (baseSummary && !baseSummary.includes('No historical data')) {
        parts.unshift(baseSummary);
    }

    // 8. Add final adjustment note if confidence was changed
    if (penalty.adjustedConfidence !== proposedConfidence) {
        parts.push(`
📌 CALIBRATION ADJUSTMENT:
Original confidence: ${proposedConfidence}
Adjusted confidence: ${penalty.adjustedConfidence}
Reason: ${penalty.reasoning.join('; ')}
INSTRUCTION: Use the ADJUSTED confidence level in your final recommendation.`);
    }

    return {
        promptInjection: parts.length > 0 ? `
═══════════════════════════════════════════════════════════════
🎯 ENHANCED CALIBRATION INTELLIGENCE
═══════════════════════════════════════════════════════════════

${parts.join('\n\n')}

═══════════════════════════════════════════════════════════════
` : '',
        adjustedConfidence: penalty.adjustedConfidence,
        totalPenalty: penalty.totalPenalty
    };
};

