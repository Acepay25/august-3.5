/**
 * MistakePatternService
 * Analyzes losing trades to detect recurring failure patterns and trading weaknesses.
 * 
 * Features:
 * - Categorize losses by failure type
 * - Detect recurring mistakes across multiple trades
 * - Generate warning prompts for AI
 * - Provide UI-ready weakness summaries
 */

import { LoggedTrade, TradeOutcome, RecurringMistake, TradingWeaknesses } from '../../types';

// Minimum occurrences to be considered a "recurring" mistake
const MIN_RECURRING_COUNT = 3;
// Minimum completed trades before analyzing mistakes
const MIN_TRADES_FOR_ANALYSIS = 5;

/**
 * Mistake categories and their detection patterns
 */
interface MistakeDetector {
    type: RecurringMistake['type'];
    description: string;
    detect: (trade: LoggedTrade) => boolean;
}

const mistakeDetectors: MistakeDetector[] = [
    {
        type: 'timing',
        description: 'Premature entry before confirmation',
        detect: (trade) => {
            const pm = trade.postMortem?.toLowerCase() || '';
            return pm.includes('early') || pm.includes('premature') ||
                pm.includes('too soon') || pm.includes('before confirm');
        }
    },
    {
        type: 'timing',
        description: 'Late entry after move started',
        detect: (trade) => {
            const pm = trade.postMortem?.toLowerCase() || '';
            return pm.includes('late') || pm.includes('chased') ||
                pm.includes('fomo') || pm.includes('after the move');
        }
    },
    {
        type: 'direction',
        description: 'Trading against the trend',
        detect: (trade) => {
            const pm = trade.postMortem?.toLowerCase() || '';
            return pm.includes('against trend') || pm.includes('counter-trend') ||
                pm.includes('counter trend') || pm.includes('wrong direction');
        }
    },
    {
        type: 'risk',
        description: 'Stop loss too tight',
        detect: (trade) => {
            const pm = trade.postMortem?.toLowerCase() || '';
            return (pm.includes('stop') && (pm.includes('tight') || pm.includes('small'))) ||
                pm.includes('wicked out');
        }
    },
    {
        type: 'risk',
        description: 'Overleveraged position',
        detect: (trade) => {
            const pm = trade.postMortem?.toLowerCase() || '';
            return pm.includes('leverage') || pm.includes('oversize') ||
                pm.includes('too big') || pm.includes('position size');
        }
    },
    {
        type: 'setup',
        description: 'Low confluence / weak setup',
        detect: (trade) => {
            const pm = trade.postMortem?.toLowerCase() || '';
            return pm.includes('weak') || pm.includes('low confluence') ||
                pm.includes('forced') || pm.includes('shouldn\'t have');
        }
    },
    {
        type: 'setup',
        description: 'Ignored warning signals',
        detect: (trade) => {
            const pm = trade.postMortem?.toLowerCase() || '';
            return pm.includes('ignored') || pm.includes('warning') ||
                pm.includes('should have seen') || pm.includes('red flag');
        }
    },
    {
        type: 'exit',
        description: 'Moved stop loss (hoping)',
        detect: (trade) => {
            const pm = trade.postMortem?.toLowerCase() || '';
            return pm.includes('moved stop') || pm.includes('hoping') ||
                pm.includes('extended stop') || pm.includes('widened stop');
        }
    },
    {
        type: 'exit',
        description: 'Took profit too early',
        detect: (trade) => {
            const pm = trade.postMortem?.toLowerCase() || '';
            return pm.includes('closed early') || pm.includes('exited too soon') ||
                pm.includes('left money');
        }
    }
];

/**
 * Analyze all losing trades to find recurring mistakes
 */
export function detectRecurringMistakes(tradeLog: LoggedTrade[]): RecurringMistake[] {
    const losses = tradeLog.filter(t => t.outcome === TradeOutcome.LOSS);

    if (losses.length < MIN_TRADES_FOR_ANALYSIS) {
        return [];
    }

    // Track occurrences of each mistake type
    const mistakeOccurrences: Map<string, {
        mistake: MistakeDetector;
        trades: string[]
    }> = new Map();

    for (const loss of losses) {
        for (const detector of mistakeDetectors) {
            if (detector.detect(loss)) {
                const key = `${detector.type}:${detector.description}`;
                const existing = mistakeOccurrences.get(key);
                if (existing) {
                    existing.trades.push(loss.id);
                } else {
                    mistakeOccurrences.set(key, {
                        mistake: detector,
                        trades: [loss.id]
                    });
                }
            }
        }
    }

    // Filter to only recurring mistakes (3+ occurrences)
    const recurringMistakes: RecurringMistake[] = [];

    for (const [_, data] of mistakeOccurrences) {
        if (data.trades.length >= MIN_RECURRING_COUNT) {
            // Determine severity based on frequency relative to total losses
            const frequency = data.trades.length / losses.length;
            let severity: RecurringMistake['severity'];
            if (frequency >= 0.4) {
                severity = 'high';
            } else if (frequency >= 0.25) {
                severity = 'medium';
            } else {
                severity = 'low';
            }

            recurringMistakes.push({
                type: data.mistake.type,
                description: data.mistake.description,
                occurrences: data.trades.length,
                affectedTrades: data.trades,
                severity
            });
        }
    }

    // Sort by severity and occurrence count
    return recurringMistakes.sort((a, b) => {
        const sevOrder = { high: 0, medium: 1, low: 2 };
        if (sevOrder[a.severity] !== sevOrder[b.severity]) {
            return sevOrder[a.severity] - sevOrder[b.severity];
        }
        return b.occurrences - a.occurrences;
    });
}

/**
 * Analyze performance by specific setup characteristics
 */
function analyzeSetupPerformance(tradeLog: LoggedTrade[]): { setup: string; winRate: number; count: number }[] {
    const completedTrades = tradeLog.filter(
        t => t.outcome === TradeOutcome.WIN || t.outcome === TradeOutcome.LOSS
    );

    if (completedTrades.length < MIN_TRADES_FOR_ANALYSIS) {
        return [];
    }

    // Group by coin + direction
    const setupStats: Map<string, { wins: number; total: number }> = new Map();

    for (const trade of completedTrades) {
        const coin = trade.analysis.coinName || 'Unknown';
        const direction = trade.analysis.direction;
        const key = `${coin} ${direction}`;

        const existing = setupStats.get(key) || { wins: 0, total: 0 };
        existing.total += 1;
        if (trade.outcome === TradeOutcome.WIN) {
            existing.wins += 1;
        }
        setupStats.set(key, existing);
    }

    // Convert to array and find worst performers
    const results: { setup: string; winRate: number; count: number }[] = [];

    for (const [setup, stats] of setupStats) {
        if (stats.total >= 3) { // At least 3 trades of this type
            const winRate = Math.round((stats.wins / stats.total) * 100);
            if (winRate < 45) { // Only include underperforming setups
                results.push({ setup, winRate, count: stats.total });
            }
        }
    }

    return results.sort((a, b) => a.winRate - b.winRate).slice(0, 5);
}

/**
 * Get comprehensive trading weaknesses summary
 */
export function getTradingWeaknesses(tradeLog: LoggedTrade[]): TradingWeaknesses {
    const mistakes = detectRecurringMistakes(tradeLog);
    const worstSetups = analyzeSetupPerformance(tradeLog);

    return {
        mistakes,
        worstPerformingSetups: worstSetups,
        lastUpdated: new Date().toISOString()
    };
}

/**
 * Generate AI prompt injection with mistake warnings
 * Warns the AI about the user's recurring mistakes relevant to current setup
 */
export function generateMistakeWarningInjection(
    currentCoin: string | undefined,
    currentDirection: 'Long' | 'Short' | 'Neutral',
    tradeLog: LoggedTrade[]
): string {
    const weaknesses = getTradingWeaknesses(tradeLog);

    if (weaknesses.mistakes.length === 0 && weaknesses.worstPerformingSetups.length === 0) {
        return '';
    }

    const parts: string[] = [];
    parts.push('⚠️ **PERSONAL TRADING WEAKNESS ALERT**');
    parts.push('');

    // Check for relevant underperforming setups
    if (currentCoin && currentDirection !== 'Neutral') {
        const setupKey = `${currentCoin} ${currentDirection}`.toUpperCase();
        const matchingSetup = weaknesses.worstPerformingSetups.find(
            s => s.setup.toUpperCase().includes(currentCoin.toUpperCase())
        );

        if (matchingSetup) {
            parts.push(`❌ **Warning:** Your ${matchingSetup.setup} trades have only ${matchingSetup.winRate}% win rate (${matchingSetup.count} trades)`);
            parts.push('   Consider: Extra confirmation or skip this setup type');
            parts.push('');
        }
    }

    // List high-severity recurring mistakes
    const highSeverity = weaknesses.mistakes.filter(m => m.severity === 'high');
    if (highSeverity.length > 0) {
        parts.push('**Recurring mistakes to avoid:**');
        for (const mistake of highSeverity.slice(0, 3)) {
            parts.push(`  🔴 ${mistake.description} (${mistake.occurrences} occurrences)`);
        }
        parts.push('');
    }

    // Add medium severity if no high severity
    if (highSeverity.length === 0) {
        const medSeverity = weaknesses.mistakes.filter(m => m.severity === 'medium');
        if (medSeverity.length > 0) {
            parts.push('**Mistakes to watch:**');
            for (const mistake of medSeverity.slice(0, 2)) {
                parts.push(`  🟡 ${mistake.description} (${mistake.occurrences} occurrences)`);
            }
            parts.push('');
        }
    }

    if (parts.length <= 2) {
        return ''; // Only header, no actual content
    }

    parts.push('**INSTRUCTION:** Actively check for these patterns in your analysis. If you detect any of these weakness patterns, explicitly warn the user and consider downgrading confidence.');

    return parts.join('\n');
}

/**
 * Get a quick summary string for UI display
 */
export function getMistakeSummaryForUI(tradeLog: LoggedTrade[]): string | null {
    const weaknesses = getTradingWeaknesses(tradeLog);

    if (weaknesses.mistakes.length === 0) {
        return null;
    }

    const topMistake = weaknesses.mistakes[0];
    return `Most common issue: ${topMistake.description} (${topMistake.occurrences}x)`;
}
