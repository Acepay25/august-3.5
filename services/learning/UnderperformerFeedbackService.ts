/**
 * UnderperformerFeedbackService
 * Monitors lowest-performing AI models and injects corrective feedback into their prompts.
 * 
 * Features:
 * 1. Identify the worst-performing model from enabled providers
 * 2. Generate corrective prompt injection for underperforming models
 * 3. Track feedback injection status to avoid redundant injections
 */

import { AIProvider } from '../../types';
import {
    getRollingWindowStats,
    getSituationalExpertise,
    identifyLowestPerformer,
    RollingWindowStats,
    SituationalExpertise
} from '../backtesting/ModelPerformanceService';

// Configuration
const MIN_TRADES_FOR_FEEDBACK = 5;        // Minimum trades before injecting feedback
const WIN_RATE_THRESHOLD = 45;            // Below this win rate triggers feedback
const COLD_STREAK_THRESHOLD = 3;          // Consecutive losses to trigger feedback
const FEEDBACK_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes between feedbacks

// Track last feedback injection per provider
const lastFeedbackTime: Record<string, number> = {};

/**
 * Check if a model should receive corrective feedback
 */
export const shouldInjectFeedback = (provider: AIProvider): boolean => {
    const stats = getRollingWindowStats(provider);

    // Not enough data
    if (stats.last20Total < MIN_TRADES_FOR_FEEDBACK) {
        return false;
    }

    // Check cooldown
    const lastTime = lastFeedbackTime[provider] || 0;
    if (Date.now() - lastTime < FEEDBACK_COOLDOWN_MS) {
        return false;
    }

    // Trigger conditions:
    // 1. On cold streak (3+ consecutive losses)
    // 2. Win rate below threshold
    const triggerColdStreak = stats.coldStreakCount >= COLD_STREAK_THRESHOLD;
    const triggerLowWinRate = stats.last20WinRate < WIN_RATE_THRESHOLD;

    const shouldInject = triggerColdStreak || triggerLowWinRate;

    if (shouldInject) {
        console.log(`[UnderperformerFeedback] ${provider} qualifies for feedback:`, {
            coldStreak: stats.coldStreakCount,
            winRate: stats.last20WinRate,
            triggerColdStreak,
            triggerLowWinRate
        });
    }

    return shouldInject;
};

/**
 * Generate feedback prompt injection for underperforming model
 */
export const generateUnderperformerFeedback = (
    provider: AIProvider,
    stats?: RollingWindowStats,
    expertise?: SituationalExpertise
): string => {
    // Get stats if not provided
    const rollingStats = stats || getRollingWindowStats(provider);
    const situationalExpertise = expertise || getSituationalExpertise(provider);

    // Record feedback time
    lastFeedbackTime[provider] = Date.now();

    // Build feedback message
    let feedback = `
═══════════════════════════════════════════════════════════════════════
⚠️ PERFORMANCE CALIBRATION NOTICE - CRITICAL ⚠️
═══════════════════════════════════════════════════════════════════════

Your recent trading predictions have shown a declining accuracy pattern.
This notice is injected to recalibrate your analysis approach.

📊 CURRENT PERFORMANCE METRICS:
- Win Rate (Last ${rollingStats.last20Total} trades): ${rollingStats.last20WinRate.toFixed(1)}%
- Wins: ${rollingStats.last20Wins} | Losses: ${rollingStats.last20Total - rollingStats.last20Wins}
`;

    // Add cold streak warning
    if (rollingStats.coldStreakCount >= COLD_STREAK_THRESHOLD) {
        feedback += `
🔴 COLD STREAK ALERT: ${rollingStats.coldStreakCount} consecutive losses
   You MUST break this pattern by being MORE CONSERVATIVE.
`;
    }

    // Add situational weakness
    const reversalWR = situationalExpertise.reversalStats.winRate;
    const continuationWR = situationalExpertise.continuationStats.winRate;

    if (situationalExpertise.reversalStats.total >= 3 && reversalWR < 40) {
        feedback += `
⚠️ SITUATIONAL WEAKNESS: Reversal/Trap Patterns
   Your reversal trade predictions have ${reversalWR.toFixed(0)}% win rate.
   For reversal/trap patterns, you MUST provide EXTRA CAUTION.
`;
    }

    if (situationalExpertise.continuationStats.total >= 3 && continuationWR < 40) {
        feedback += `
⚠️ SITUATIONAL WEAKNESS: Continuation Patterns
   Your continuation trade predictions have ${continuationWR.toFixed(0)}% win rate.
   For continuation patterns, you MUST provide EXTRA CAUTION.
`;
    }

    feedback += `
═══════════════════════════════════════════════════════════════════════
🎯 MANDATORY ADJUSTMENTS FOR THIS ANALYSIS:
═══════════════════════════════════════════════════════════════════════

1. CONFIDENCE REDUCTION
   - Reduce your expressed confidence by ONE TIER
   - If you would say "High", say "Medium" instead
   - If you would say "Medium", say "Low" instead

2. RISK/REWARD STRICTNESS
   - REQUIRE minimum 1:2 R:R for any trade suggestion
   - Calculate ATR-based stops precisely
   - Do NOT suggest trades with tight stops in volatile conditions

3. DEVIL'S ADVOCATE EXPANSION
   - Provide AT LEAST 3 failure scenarios
   - Include specific price levels where the trade invalidates
   - Consider hidden liquidity traps and stop hunts

4. MULTI-TIMEFRAME REQUIREMENT
   - For HIGH confidence: Require 4/4 timeframes aligned
   - For MEDIUM confidence: Require 3/4 timeframes aligned
   - If alignment is poor, suggest AVOID

5. CONSERVATIVE ENTRY PRICING
   - Suggest entries at better prices (pullbacks)
   - Avoid chasing breakouts
   - Wait for confirmation before entry

═══════════════════════════════════════════════════════════════════════
⚡ REMEMBER: The goal is ACCURATE predictions, not confident ones.
   A correct AVOID saves more than an incorrect HIGH.
═══════════════════════════════════════════════════════════════════════

`;

    console.log(`[UnderperformerFeedback] Generated feedback for ${provider}, length: ${feedback.length}`);

    return feedback;
};

/**
 * Generate moderator warning about underperforming models in debate
 */
export const generateModeratorUnderperformerWarning = (
    enabledProviders: AIProvider[]
): string => {
    const lowestPerformer = identifyLowestPerformer(enabledProviders);

    if (!lowestPerformer || !lowestPerformer.isSignificantlyWorse) {
        return '';
    }

    const stats = getRollingWindowStats(lowestPerformer.provider);

    let warning = `
⚠️ **MODERATOR ALERT: UNDERPERFORMER DETECTED**
`;

    warning += `${lowestPerformer.provider.toUpperCase()} is significantly underperforming:
- Recent Win Rate: ${lowestPerformer.winRate.toFixed(1)}%
- Recent Losses: ${lowestPerformer.recentLosses} consecutive
`;

    if (stats.isDemoted) {
        warning += `- Status: **DEMOTED** (cold streak penalty active)
`;
    }

    warning += `
**Moderator Instructions:**
1. Scrutinize ${lowestPerformer.provider.toUpperCase()}'s analysis more heavily
2. Require stronger evidence from this model before accepting its conclusions
3. Weight this model's opinion LESS in final consensus
4. If this model disagrees with better-performing models, favor the others

`;

    console.log(`[UnderperformerFeedback] Generated moderator warning for ${lowestPerformer.provider}`);

    return warning;
};

/**
 * Get underperformer status for all enabled providers
 */
export const getUnderperformerStatus = (
    enabledProviders: AIProvider[]
): {
    provider: AIProvider;
    shouldInject: boolean;
    stats: RollingWindowStats;
    expertise: SituationalExpertise;
}[] => {
    return enabledProviders.map(provider => ({
        provider,
        shouldInject: shouldInjectFeedback(provider),
        stats: getRollingWindowStats(provider),
        expertise: getSituationalExpertise(provider)
    }));
};

/**
 * Reset feedback cooldown for a provider (use after significant improvement)
 */
export const resetFeedbackCooldown = (provider: AIProvider): void => {
    delete lastFeedbackTime[provider];
    console.log(`[UnderperformerFeedback] Reset cooldown for ${provider}`);
};

/**
 * Check if any provider needs feedback and return the feedback if so
 * This is a convenience function for use in AI services
 */
export const getUnderperformerFeedbackIfNeeded = (
    provider: AIProvider
): string | null => {
    if (!shouldInjectFeedback(provider)) {
        return null;
    }

    return generateUnderperformerFeedback(provider);
};
