/**
 * UnifiedLearningBuilder
 * 
 * Single orchestrator that consolidates ALL 6 learning services into
 * one prompt injection for AI analysts and moderator.
 * 
 * This ensures the AI consistently "remembers" past lessons and applies
 * them to current analysis.
 */

import { LoggedTrade, AIProvider } from '../../types';
import { computeLearningProfile, generateLearningContext, PersonalizedLearningProfile } from './SelfLearningService';
import { generateMistakeWarningInjection } from './MistakePatternService';
import { generateLearningRulesPrompt, LearningRulesStorage, loadLearningRules } from './LearningRulesService';
import { generateInsightInjection } from './InsightExtractionService';
import { generateAdaptiveFeedbackInjection } from './AdaptiveLearningService';
import { generateWeightedVotingContext } from '../backtesting/ModelPerformanceService';

/**
 * Unified learning context output
 */
export interface UnifiedLearningContext {
    forAnalysts: string;    // Full context for analysts
    forModerator: string;   // Condensed for moderator (token-efficient)
    isEmpty: boolean;
    profile?: PersonalizedLearningProfile;
}

/**
 * Build unified learning context from all 6 learning services
 * 
 * @param tradeLog - Historical trades
 * @param currentSetup - Current trading context
 * @param enabledProviders - Enabled AI providers for weighting
 */
export const buildUnifiedLearningContext = (
    tradeLog: LoggedTrade[],
    currentSetup: {
        coin?: string;
        pattern?: string;
        direction?: 'Long' | 'Short' | 'Neutral'
    },
    enabledProviders: AIProvider[]
): UnifiedLearningContext => {
    // Need minimum trades for meaningful learning
    if (tradeLog.length < 3) {
        console.log('[UnifiedLearning] Not enough trades for learning context:', tradeLog.length);
        return { forAnalysts: '', forModerator: '', isEmpty: true };
    }

    const parts: string[] = [];
    let profile: PersonalizedLearningProfile | undefined;

    try {
        // 1. Personalized Learning Profile (SelfLearningService)
        profile = computeLearningProfile(tradeLog);
        const personalContext = generateLearningContext(profile, currentSetup);
        if (personalContext && personalContext.trim()) {
            parts.push(personalContext);
            console.log('[UnifiedLearning] Added personalized context');
        }
    } catch (e) {
        console.error('[UnifiedLearning] Failed to compute learning profile:', e);
    }

    try {
        // 2. Mistake Warnings (MistakePatternService)
        const mistakes = generateMistakeWarningInjection(
            currentSetup.coin,
            currentSetup.direction || 'Neutral',
            tradeLog
        );
        if (mistakes && mistakes.trim()) {
            parts.push(mistakes);
            console.log('[UnifiedLearning] Added mistake warnings');
        }
    } catch (e) {
        console.error('[UnifiedLearning] Failed to generate mistake warnings:', e);
    }

    try {
        // 3. Learning Rules (LearningRulesService)
        const rulesStorage = loadLearningRules();
        const rules = generateLearningRulesPrompt(rulesStorage, {
            coin: currentSetup.coin,
            pattern: currentSetup.pattern,
            direction: currentSetup.direction === 'Neutral' ? undefined : currentSetup.direction
        });
        if (rules && rules.trim()) {
            parts.push(rules);
            console.log('[UnifiedLearning] Added', rulesStorage.rules.length, 'learning rules');
        }
    } catch (e) {
        console.error('[UnifiedLearning] Failed to generate learning rules:', e);
    }

    try {
        // 4. Insight Injection (InsightExtractionService)
        const insights = generateInsightInjection(
            currentSetup.coin,
            currentSetup.pattern,
            currentSetup.direction || 'Neutral',
            undefined // knowledgeBase - loaded internally
        );
        if (insights && insights.trim()) {
            parts.push(insights);
            console.log('[UnifiedLearning] Added insight injection');
        }
    } catch (e) {
        console.error('[UnifiedLearning] Failed to generate insights:', e);
    }

    try {
        // 5. Adaptive Feedback (AdaptiveLearningService)
        const adaptive = generateAdaptiveFeedbackInjection(
            currentSetup.coin,
            currentSetup.pattern,
            currentSetup.direction || 'Neutral',
            undefined, // regime
            tradeLog
        );
        if (adaptive && adaptive.trim()) {
            parts.push(adaptive);
            console.log('[UnifiedLearning] Added adaptive feedback');
        }
    } catch (e) {
        console.error('[UnifiedLearning] Failed to generate adaptive feedback:', e);
    }

    // 6. Model Weighting (ModelPerformanceService) - for moderator only
    let weighting = '';
    try {
        weighting = generateWeightedVotingContext(enabledProviders, currentSetup.pattern);
        if (weighting && weighting.trim()) {
            console.log('[UnifiedLearning] Added model weighting context');
        }
    } catch (e) {
        console.error('[UnifiedLearning] Failed to generate model weighting:', e);
    }

    if (parts.length === 0) {
        console.log('[UnifiedLearning] No learning context generated');
        return { forAnalysts: '', forModerator: '', isEmpty: true };
    }

    // Build full context for analysts
    const fullContext = `
═══════════════════════════════════════════════════════════════
🧠 AI LEARNING CONTEXT — Based on ${tradeLog.length} Historical Trades
═══════════════════════════════════════════════════════════════

${parts.join('\n\n')}

═══════════════════════════════════════════════════════════════
⚠️ You MUST reference this learning context in your analysis.
If proposing a setup similar to past LOSSES, provide explicit justification.
═══════════════════════════════════════════════════════════════
`;

    // Build condensed context for moderator (token efficient)
    const worstSetups = profile?.worstSetups?.slice(0, 2) || [];
    const moderatorContext = `
**🧠 LEARNING SUMMARY (${tradeLog.length} trades analyzed):**
- Overall Win Rate: ${profile?.overallWinRate?.toFixed(1) || 'N/A'}%
${worstSetups.map(s => `- ⚠️ AVOID: ${s.description} (${s.winRate.toFixed(0)}% win rate)`).join('\n')}
${weighting}

**MODERATOR INSTRUCTION:** Verify analysts addressed learning context before assigning high confidence.
`;

    console.log('[UnifiedLearning] Built context with', parts.length, 'sections');

    return {
        forAnalysts: fullContext,
        forModerator: moderatorContext,
        isEmpty: false,
        profile
    };
};

/**
 * Quick check if learning context is available
 */
export const hasLearningData = (tradeLog: LoggedTrade[]): boolean => {
    return tradeLog.length >= 3;
};
