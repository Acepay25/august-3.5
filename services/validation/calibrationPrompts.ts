/**
 * calibrationPrompts — the calibration PROMPT-TEXT layer.
 *
 * Split out of the former 1,614-line `ConfidenceCalibrationService.ts`, which was
 * three services wearing one filename. Every function body below is byte-identical
 * to the file it came from; only the module boundary moved.
 *
 * Every export here returns prompt text for injection into an AI packet. This is
 * the TOP of the one-way chain and may import the layer below, never the reverse:
 *
 *     calibrationPrompts → calibrationPolicy → calibrationStore
 *
 * The numbered section banners (7–8) are the pre-split file's own numbering.
 */

import { ConfidenceCalibration, AIProvider } from '../../types';
import {
    MIN_TRADES_FOR_CALIBRATION,
    MIN_TRADES_FOR_PROMPT_DISPLAY
} from '../../constants/calibrationConstants';
import {
    detectStreak,
    getSessionCalibrationState,
    getBayesianConfidenceAdjustment,
    detectDangerousCombinations,
    calculateCalibrationPenalty
} from './calibrationPolicy';
import {
    ConfidenceLevel,
    getCalibrationSummary,
    detectTradingSession,
    getSessionAccuracyComparison,
    getWinRateByDay,
    getWinRateByCoin,
    getWinRateByPattern,
    getWinRateByTimeframe,
    getWinRateByRegime
} from './calibrationStore';

/**
 * Generate a prompt injection for AI context with calibration data
 * This informs the AI about its historical accuracy at each confidence level
 */
export const generateCalibrationPromptInjection = (
    calibration: ConfidenceCalibration | undefined,
    provider?: AIProvider | string
): string => {
    if (!calibration) {
        return `
 **CONFIDENCE CALIBRATION DATA**
No historical data available yet. As trades are logged, this section will show your actual accuracy for each confidence level.
`;
    }

    // Per-model calibration: when a provider key is known and that model has
    // enough trades of its own, inject ONLY its stats — the blended table
    // corrected model A with model B's errors.
    const providerKey = provider !== undefined ? String(provider) : undefined;
    const providerStats = providerKey ? calibration.granular?.byProvider?.[providerKey] : undefined;
    if (providerStats && providerStats.total >= MIN_TRADES_FOR_CALIBRATION) {
        const wr = Math.round((providerStats.wins / Math.max(1, providerStats.total)) * 100);
        return `
 **CONFIDENCE CALIBRATION DATA (THIS MODEL — ${providerKey})**

YOUR HISTORICAL ACCURACY (this model's OWN trades):
| Dimension | Win Rate | Trades |
|-----------|----------|--------|
| Overall   | ${wr}%    | n=${providerStats.total} |

**INSTRUCTION:** Adjust your confidence ratings based on THIS model's own
historical accuracy. If your own "High" calls win below expectation, be more
conservative; if they outperform, your thresholds are well-calibrated.
`;
    }

    const summary = getCalibrationSummary(calibration);
    const totalTrades = summary.totalTrades;

    if (totalTrades < MIN_TRADES_FOR_PROMPT_DISPLAY) {
        return `
 **CONFIDENCE CALIBRATION DATA**
Limited data (${totalTrades} trades logged). Minimum ${MIN_TRADES_FOR_CALIBRATION} trades needed per confidence level for reliable calibration.
Continue logging trades to build historical accuracy data.
`;
    }

    const formatLevel = (level: string, stats: { winRate: number | null; total: number }) => {
        if (stats.total < MIN_TRADES_FOR_CALIBRATION) {
            return `| ${level.padEnd(8)} | Insufficient data (n=${stats.total}, need ${MIN_TRADES_FOR_CALIBRATION}) |`;
        }
        const winRateStr = stats.winRate !== null ? `${stats.winRate}%` : 'N/A';
        // Monochrome text indicators (the zinc theme bans emoji): strong /
        // middling / weak calibration at this confidence level.
        const indicator = stats.winRate !== null
            ? (stats.winRate >= 70 ? 'STRONG' : stats.winRate >= 50 ? 'OK' : 'WEAK')
            : '—';
        return `| ${level.padEnd(8)} | ${winRateStr.padEnd(6)} | n=${stats.total.toString().padEnd(3)} | ${indicator}`;
    };

    // Generate warnings based on calibration
    const warnings: string[] = [];

    if (summary.high.winRate !== null && summary.high.winRate < 60) {
        warnings.push(` "High" confidence trades are only ${summary.high.winRate}% accurate. Consider being more selective.`);
    }
    if (summary.medium.winRate !== null && summary.high.winRate !== null && summary.medium.winRate > summary.high.winRate) {
        warnings.push(` "Medium" confidence (${summary.medium.winRate}%) outperforms "High" (${summary.high.winRate}%). Your high-confidence filter may be too loose.`);
    }
    if (summary.avoid.total > 0 && summary.avoid.winRate !== null && summary.avoid.winRate > 30) {
        warnings.push(` "Avoid" trades have ${summary.avoid.winRate}% win rate. Consider if some "Avoid" setups are being under-rated.`);
    }

    return `
 **CONFIDENCE CALIBRATION DATA (${totalTrades} trades)**

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

    let prompt = `\n **SESSION & TIME ACCURACY DATA**\n`;
    prompt += `Current Session: ${currentSession.toUpperCase()}\n`;

    // Add Day of Week Warning
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const currentDay = days[new Date().getUTCDay()];
    const dayWinRate = getWinRateByDay(calibration, currentDay);

    if (dayWinRate !== null) {
        prompt += `Current Day: ${currentDay.toUpperCase()} (Win Rate: ${dayWinRate}%)\n`;
        if (dayWinRate < 45) {
            prompt += ` WARNING: ${currentDay} is historically a low win-rate day for you (${dayWinRate}%). Exercise extreme caution.\n`;
        }
    }
    prompt += '\n';

    // Show all session stats
    for (const s of sessions) {
        const indicator = s.winRate !== null
            ? (s.winRate >= 60 ? '' : s.winRate >= 45 ? '' : '')
            : '';
        prompt += `${indicator} ${s.session}: ${s.winRate !== null ? `${s.winRate}%` : 'N/A'} (n=${s.total})\n`;
    }

    // Add warning if current session has poor performance
    if (currentSessionData && currentSessionData.total >= MIN_TRADES_FOR_CALIBRATION) {
        const currentWinRate = Math.round((currentSessionData.wins / currentSessionData.total) * 100);
        if (currentWinRate < 45) {
            prompt += `\n **WARNING:** Your ${currentSession.toUpperCase()} session win rate is ${currentWinRate}%. Consider being more selective or avoiding trades during this session.\n`;
        } else if (currentWinRate >= 60) {
            prompt += `\n **FAVORABLE:** Your ${currentSession.toUpperCase()} session win rate is ${currentWinRate}%. This is historically your stronger session.\n`;
        }
    }

    return prompt;
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
            const indicator = coinRate >= 60 ? '' : coinRate >= 45 ? '' : '';
            points.push(`${indicator} ${context.coin}: ${coinRate}% win rate (n=${stats.total})`);
        }
    }

    // Pattern-specific accuracy
    if (context.pattern) {
        const patternRate = getWinRateByPattern(calibration, context.pattern);
        if (patternRate !== null) {
            const stats = calibration.granular.byPattern[context.pattern];
            const indicator = patternRate >= 60 ? '' : patternRate >= 45 ? '' : '';
            points.push(`${indicator} ${context.pattern}: ${patternRate}% win rate (n=${stats.total})`);
        }
    }

    // Timeframe-specific accuracy
    if (context.timeframe) {
        const tfRate = getWinRateByTimeframe(calibration, context.timeframe);
        if (tfRate !== null) {
            const stats = calibration.granular.byTimeframe[context.timeframe];
            const indicator = tfRate >= 60 ? '' : tfRate >= 45 ? '' : '';
            points.push(`${indicator} ${context.timeframe} timeframe: ${tfRate}% win rate (n=${stats.total})`);
        }
    }

    // Regime-specific accuracy
    if (context.regime) {
        const regimeRate = getWinRateByRegime(calibration, context.regime);
        if (regimeRate !== null) {
            const stats = calibration.granular.byRegime[context.regime];
            const indicator = regimeRate >= 60 ? '' : regimeRate >= 45 ? '' : '';
            points.push(`${indicator} ${context.regime} market: ${regimeRate}% win rate (n=${stats.total})`);
        }
    }

    if (points.length === 0) return '';

    return `
 **CONTEXT-SPECIFIC CALIBRATION**
${points.join('\n')}

**INSTRUCTIONS:** Use this granular data to refine your confidence. 
If historical accuracy for this specific context is <50%, consider downgrading confidence.
`;
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
        return ` VOLATILITY-ADJUSTED WARNING:
Your accuracy in ${regimeLabel} markets: ${regimeRate}% (vs ${overallRate}% overall).
Current market regime: ${regimeLabel.toUpperCase()}.
You historically underperform by ${Math.abs(diff)}% in this regime.
INSTRUCTION: Consider downgrading confidence or passing on this trade.`;
    } else if (diff > 10) {
        return ` REGIME ADVANTAGE:
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
    const baseSummary = generateCalibrationPromptInjection(calibration, context?.provider);
    if (baseSummary && !baseSummary.includes('No historical data')) {
        parts.unshift(baseSummary);
    }

    // 8. Add final adjustment note if confidence was changed
    if (penalty.adjustedConfidence !== proposedConfidence) {
        parts.push(`
 CALIBRATION ADJUSTMENT:
Original confidence: ${proposedConfidence}
Adjusted confidence: ${penalty.adjustedConfidence}
Reason: ${penalty.reasoning.join('; ')}
INSTRUCTION: Use the ADJUSTED confidence level in your final recommendation.`);
    }

    return {
        promptInjection: parts.length > 0 ? `
═══════════════════════════════════════════════════════════════
 ENHANCED CALIBRATION INTELLIGENCE
═══════════════════════════════════════════════════════════════

${parts.join('\n\n')}

═══════════════════════════════════════════════════════════════
` : '',
        adjustedConfidence: penalty.adjustedConfidence,
        totalPenalty: penalty.totalPenalty
    };
};
