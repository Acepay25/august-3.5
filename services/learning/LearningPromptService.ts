/**
 * LearningPromptService
 * Central service that combines all AI learning features into a unified prompt injection.
 * Works across all AI providers and modes.
 * 
 * Features:
 * - Combines Adaptive Learning, Mistake Patterns, and Insight Extraction
 * - Generates a single learning context block for AI prompts
 * - Works with all modes: Standard, Accuracy Original, Pure AI
 */

import { LoggedTrade, InsightKnowledgeBase, TradeAnalysis } from '../../types';
import { generateAdaptiveFeedbackInjection, extractContextFromAnalysis } from './AdaptiveLearningService';
import { generateMistakeWarningInjection } from './MistakePatternService';
import { generateInsightInjection } from './InsightExtractionService';

// Minimum trades before enabling learning features
const MIN_TRADES_FOR_LEARNING = 5;

/**
 * Generate a combined learning prompt injection
 * This integrates all three learning features into one cohesive block
 */
export function generateLearningPromptInjection(
    currentCoin: string | undefined,
    currentPattern: string | undefined,
    currentDirection: 'Long' | 'Short' | 'Neutral',
    currentRegime: string | undefined,
    tradeLog: LoggedTrade[],
    knowledgeBase: InsightKnowledgeBase | undefined
): string {
    // Skip if not enough data
    if (!tradeLog || tradeLog.length < MIN_TRADES_FOR_LEARNING) {
        return '';
    }

    const parts: string[] = [];

    // 1. Adaptive Learning Feedback (past similar trade stats)
    const adaptiveFeedback = generateAdaptiveFeedbackInjection(
        currentCoin,
        currentPattern,
        currentDirection,
        currentRegime,
        tradeLog
    );
    if (adaptiveFeedback) {
        parts.push(adaptiveFeedback);
    }

    // 2. Mistake Pattern Warning
    const mistakeWarning = generateMistakeWarningInjection(
        currentCoin,
        currentDirection,
        tradeLog
    );
    if (mistakeWarning) {
        parts.push(mistakeWarning);
    }

    // 3. Insight Extraction (lessons from post-mortems)
    const insightInjection = generateInsightInjection(
        currentCoin,
        currentPattern,
        currentDirection,
        knowledgeBase
    );
    if (insightInjection) {
        parts.push(insightInjection);
    }

    if (parts.length === 0) {
        return '';
    }

    // Combine with header and separator
    return `
═══════════════════════════════════════════════════════════════
🎓 **AI LEARNING CONTEXT** - Based on Your Trading History
═══════════════════════════════════════════════════════════════

${parts.join('\n\n---\n\n')}

═══════════════════════════════════════════════════════════════
`;
}

/**
 * Generate learning injection from prompt text
 * Extracts coin/pattern/direction from the user's prompt
 */
export function generateLearningFromPrompt(
    userPrompt: string,
    tradeLog: LoggedTrade[],
    knowledgeBase: InsightKnowledgeBase | undefined
): string {
    if (!tradeLog || tradeLog.length < MIN_TRADES_FOR_LEARNING) {
        return '';
    }

    // Try to extract coin from prompt
    const coinMatch = userPrompt.toUpperCase().match(/\b([A-Z]{2,10})(USDT?|USD|PERP)?\b/);
    const coin = coinMatch ? coinMatch[0] : undefined;

    // Try to detect direction from prompt
    let direction: 'Long' | 'Short' | 'Neutral' = 'Neutral';
    const promptLower = userPrompt.toLowerCase();
    if (promptLower.includes('long') || promptLower.includes('buy') || promptLower.includes('bullish')) {
        direction = 'Long';
    } else if (promptLower.includes('short') || promptLower.includes('sell') || promptLower.includes('bearish')) {
        direction = 'Short';
    }

    // Try to detect pattern from prompt
    let pattern: string | undefined;
    if (promptLower.includes('family a')) pattern = 'Family A';
    else if (promptLower.includes('family b')) pattern = 'Family B';
    else if (promptLower.includes('family c')) pattern = 'Family C';
    else if (promptLower.includes('family omega')) pattern = 'Family Omega';
    else if (promptLower.includes('breakout')) pattern = 'Breakout';
    else if (promptLower.includes('reversal')) pattern = 'Reversal';

    // Detect regime from prompt
    let regime: string | undefined;
    if (promptLower.includes('trend')) regime = 'trending';
    else if (promptLower.includes('range') || promptLower.includes('consolidat')) regime = 'ranging';
    else if (promptLower.includes('volatile') || promptLower.includes('choppy')) regime = 'volatile';

    return generateLearningPromptInjection(
        coin,
        pattern,
        direction,
        regime,
        tradeLog,
        knowledgeBase
    );
}

/**
 * Generate learning injection from a partial analysis
 * Used when AI has started analysis but we want to inject learning context
 */
export function generateLearningFromAnalysis(
    partialAnalysis: Partial<TradeAnalysis>,
    tradeLog: LoggedTrade[],
    knowledgeBase: InsightKnowledgeBase | undefined
): string {
    if (!tradeLog || tradeLog.length < MIN_TRADES_FOR_LEARNING) {
        return '';
    }

    return generateLearningPromptInjection(
        partialAnalysis.coinName,
        partialAnalysis.detectedPatternFamily,
        partialAnalysis.direction || 'Neutral',
        undefined, // Regime would need to be extracted from market conditions
        tradeLog,
        knowledgeBase
    );
}

/**
 * Check if learning features should be active
 */
export function isLearningEnabled(tradeLog: LoggedTrade[] | undefined): boolean {
    return !!tradeLog && tradeLog.length >= MIN_TRADES_FOR_LEARNING;
}

/**
 * Get a summary of available learning data
 */
export function getLearningDataSummary(
    tradeLog: LoggedTrade[],
    knowledgeBase: InsightKnowledgeBase | undefined
): {
    isEnabled: boolean;
    tradeCount: number;
    insightCount: number;
    status: string;
} {
    const isEnabled = isLearningEnabled(tradeLog);
    const tradeCount = tradeLog?.length || 0;
    const insightCount = knowledgeBase?.insights?.length || 0;

    let status: string;
    if (!isEnabled) {
        status = `Need ${MIN_TRADES_FOR_LEARNING - tradeCount} more trades to enable AI learning`;
    } else if (insightCount === 0) {
        status = 'Learning active. Complete post-mortems to build knowledge base.';
    } else {
        status = `Learning active: ${tradeCount} trades, ${insightCount} insights`;
    }

    return {
        isEnabled,
        tradeCount,
        insightCount,
        status
    };
}
