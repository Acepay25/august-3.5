/**
 * PersonalizedPromptService
 * Generates dynamic, personalized prompt injections based on user trading history.
 * 
 * Works with SelfLearningService to inject:
 * - Meta-learnings about user's strengths/weaknesses
 * - Setup-specific warnings
 * - Calibrated confidence notes
 */

import { LoggedTrade, TradeAnalysis, InsightKnowledgeBase } from '../types';
import {
    computeLearningProfile,
    getSetupSpecificStats,
    generateLearningContext,
    PersonalizedLearningProfile
} from './SelfLearningService';
import { generateLearningPromptInjection } from './LearningPromptService';

/**
 * Comprehensive personalized context for AI analysis
 */
export interface PersonalizedContext {
    // Core learning profile
    profile: PersonalizedLearningProfile;

    // Setup-specific stats if applicable
    setupStats: { winRate: number; note: string } | null;

    // Prompt injection text
    promptInjection: string;

    // Warnings for current setup
    warnings: string[];
}

/**
 * Extract coin name from user prompt
 */
const extractCoinFromPrompt = (prompt: string): string | null => {
    // Match patterns like BTCUSDT, ETH, BTC/USDT, etc.
    const match = prompt.match(/\b([A-Z]{2,10})(USDT?|USD)?(?:\/USDT?)?\b/i);
    return match ? match[1].toUpperCase() : null;
};

/**
 * Extract direction hint from user prompt or analysis
 */
const extractDirectionFromPrompt = (prompt: string): 'Long' | 'Short' | null => {
    const lowerPrompt = prompt.toLowerCase();
    if (lowerPrompt.includes('long') || lowerPrompt.includes('buy') || lowerPrompt.includes('bullish')) {
        return 'Long';
    }
    if (lowerPrompt.includes('short') || lowerPrompt.includes('sell') || lowerPrompt.includes('bearish')) {
        return 'Short';
    }
    return null;
};

/**
 * Generate comprehensive personalized context for AI prompts
 */
export const generatePersonalizedContext = (
    userPrompt: string,
    trades: LoggedTrade[],
    knowledgeBase?: InsightKnowledgeBase
): PersonalizedContext => {
    // Compute the learning profile
    const profile = computeLearningProfile(trades);

    // Extract current setup context from the prompt
    const coin = extractCoinFromPrompt(userPrompt);
    const direction = extractDirectionFromPrompt(userPrompt);

    // Get setup-specific stats if we have enough context
    const setupStats = coin ? getSetupSpecificStats(trades, { coin, direction: direction || undefined }) : null;

    // Generate warnings
    const warnings: string[] = [];

    // Warn about historically losing setups
    if (coin) {
        const coinWorse = profile.worstSetups.find(s =>
            s.description.toLowerCase().includes(coin.toLowerCase())
        );
        if (coinWorse) {
            warnings.push(`⚠️ Historical Warning: Your ${coinWorse.description} setups have only ${coinWorse.winRate}% win rate`);
        }
    }

    // Warn about overconfident AI
    const highConf = profile.confidenceAccuracy.find(c => c.level === 'High');
    if (highConf && highConf.count >= 5 && highConf.winRate < 55) {
        warnings.push(`⚠️ Calibration Warning: "High" confidence trades only win ${highConf.winRate}%—be skeptical of high confidence calls`);
    }

    // Combine learning context with existing learning prompt injection
    let promptInjection = generateLearningContext(profile, { coin: coin || undefined, direction: direction || undefined });

    // Add legacy learning injection (mistake patterns, adaptive learning, etc.)
    const legacyInjection = generateLearningPromptInjection(
        coin || undefined,
        undefined, // pattern
        direction || 'Neutral',
        undefined, // regime
        trades,
        knowledgeBase
    );

    if (legacyInjection) {
        promptInjection += '\n' + legacyInjection;
    }

    // Add setup-specific note if available
    if (setupStats) {
        promptInjection += `\n📊 **SETUP-SPECIFIC CALIBRATION:**\n${setupStats.note}\n`;
    }

    return {
        profile,
        setupStats: setupStats ? { winRate: setupStats.winRate, note: setupStats.note } : null,
        promptInjection,
        warnings
    };
};

/**
 * Generate a concise personalized injection for standard prompts
 */
export const generatePersonalizedInjection = (
    trades: LoggedTrade[],
    currentCoin?: string,
    currentDirection?: 'Long' | 'Short' | 'Neutral'
): string => {
    const profile = computeLearningProfile(trades);

    if (profile.totalAnalyzedTrades < 3) {
        return ''; // Not enough data
    }

    let injection = '';

    // Quick stats header
    injection += `\n📊 **PERSONALIZED STATS (${profile.totalAnalyzedTrades} trades analyzed):**\n`;
    injection += `- Overall Win Rate: ${profile.overallWinRate}%\n`;

    // Current coin performance if relevant
    if (currentCoin) {
        const coinStat = profile.bestCoins.find(c =>
            c.coin.toUpperCase() === currentCoin.toUpperCase()
        );
        if (coinStat) {
            const emoji = coinStat.winRate >= 60 ? '🟢' : coinStat.winRate >= 45 ? '🟡' : '🔴';
            injection += `- ${currentCoin} Performance: ${emoji} ${coinStat.winRate}% win rate (n=${coinStat.count})\n`;
        }

        // Check for worst setups involving this coin
        const worstMatch = profile.worstSetups.find(s =>
            s.description.toLowerCase().includes(currentCoin.toLowerCase())
        );
        if (worstMatch) {
            injection += `⚠️ WARNING: ${worstMatch.description} historically loses (${worstMatch.winRate}% WR)\n`;
        }
    }

    // Confidence calibration warning if applicable
    const highConf = profile.confidenceAccuracy.find(c => c.level === 'High');
    if (highConf && highConf.count >= 5) {
        if (highConf.winRate < 55) {
            injection += `⚠️ CALIBRATION: "High" confidence = ${highConf.winRate}% actual WR—adjust expectations!\n`;
        } else if (highConf.winRate >= 70) {
            injection += `✅ CALIBRATION: "High" confidence is reliable at ${highConf.winRate}% WR\n`;
        }
    }

    // Top strength
    if (profile.bestPatterns.length > 0) {
        const best = profile.bestPatterns[0];
        if (best.winRate >= 65) {
            injection += `💪 STRENGTH: ${best.pattern} patterns work well for this user (${best.winRate}% WR)\n`;
        }
    }

    return injection;
};

/**
 * Check if a setup should trigger a warning
 */
export const shouldWarnAboutSetup = (
    trades: LoggedTrade[],
    coin?: string,
    pattern?: string,
    direction?: string
): { shouldWarn: boolean; reason?: string } => {
    const profile = computeLearningProfile(trades);

    // Not enough data to warn
    if (profile.totalAnalyzedTrades < 5) {
        return { shouldWarn: false };
    }

    // Check worst setups
    for (const setup of profile.worstSetups) {
        const desc = setup.description.toLowerCase();

        if (coin && desc.includes(coin.toLowerCase())) {
            if (direction && desc.includes(direction.toLowerCase())) {
                return {
                    shouldWarn: true,
                    reason: `${setup.description} has poor performance (${setup.winRate}% WR, n=${setup.count})`
                };
            }
        }
    }

    // Check coin performance
    if (coin) {
        const coinStat = profile.bestCoins.find(c =>
            c.coin.toUpperCase() === coin.toUpperCase()
        );
        if (coinStat && coinStat.winRate < 40 && coinStat.count >= 5) {
            return {
                shouldWarn: true,
                reason: `You typically lose on ${coin} trades (${coinStat.winRate}% WR)`
            };
        }
    }

    return { shouldWarn: false };
};
