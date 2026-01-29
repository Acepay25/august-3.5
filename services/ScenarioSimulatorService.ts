/**
 * ScenarioSimulatorService
 * 
 * Provides "What If" analysis for trade setups by allowing users to
 * adjust parameters and see real-time impact on R:R, Monte Carlo outcomes,
 * and historical pattern matching.
 */

import { TradeAnalysis, LoggedTrade, TradeOutcome } from '../types';
import { runSimulation, MonteCarloResult, SimulationConfig } from './MonteCarloService';

// =============================================================================
// TYPES
// =============================================================================

export interface ScenarioConfig {
    // Price levels
    entry: number;
    stopLoss: number;
    takeProfits: number[];

    // Trade parameters
    direction: 'Long' | 'Short';
    leverage: number;
    positionSizeUSD: number;

    // Context
    coinName: string;
    patternFamily?: string;
    atr?: number;
}

export interface ScenarioMetrics {
    // Risk/Reward
    rrRatio: number;
    riskPercent: number;
    rewardPercent: number;

    // Dollar values
    riskUSD: number;
    rewardUSD: number;

    // Percentages with leverage
    leveragedRiskPercent: number;
    leveragedRewardPercent: number;
}

export interface ScenarioComparison {
    original: ScenarioMetrics;
    scenario: ScenarioMetrics;

    // Changes
    rrChange: number;           // e.g., +0.5 means R:R improved by 0.5
    rrChangePercent: number;    // e.g., +25% improvement
    riskChange: number;         // Positive = more risk, negative = less risk
    rewardChange: number;       // Positive = more reward
}

export interface HistoricalMatch {
    trade: LoggedTrade;
    similarityScore: number;    // 0-100
    matchReasons: string[];
}

export interface ScenarioResult {
    config: ScenarioConfig;
    metrics: ScenarioMetrics;
    monteCarlo: MonteCarloResult | null;
    historicalMatches: HistoricalMatch[];
    suggestions: string[];
}

// =============================================================================
// CORE FUNCTIONS
// =============================================================================

/**
 * Calculate metrics for a scenario configuration
 */
export function calculateMetrics(config: ScenarioConfig): ScenarioMetrics {
    const { entry, stopLoss, takeProfits, direction, leverage, positionSizeUSD } = config;

    // Calculate distances
    const slDistance = Math.abs(entry - stopLoss);
    const tp1Distance = takeProfits.length > 0 ? Math.abs(takeProfits[0] - entry) : slDistance * 2;

    // Calculate percentages
    const riskPercent = (slDistance / entry) * 100;
    const rewardPercent = (tp1Distance / entry) * 100;

    // R:R Ratio
    const rrRatio = tp1Distance > 0 && slDistance > 0
        ? Math.round((tp1Distance / slDistance) * 100) / 100
        : 0;

    // USD values
    const riskUSD = (riskPercent / 100) * positionSizeUSD * leverage;
    const rewardUSD = (rewardPercent / 100) * positionSizeUSD * leverage;

    // Leveraged percentages
    const leveragedRiskPercent = riskPercent * leverage;
    const leveragedRewardPercent = rewardPercent * leverage;

    return {
        rrRatio,
        riskPercent: Math.round(riskPercent * 100) / 100,
        rewardPercent: Math.round(rewardPercent * 100) / 100,
        riskUSD: Math.round(riskUSD * 100) / 100,
        rewardUSD: Math.round(rewardUSD * 100) / 100,
        leveragedRiskPercent: Math.round(leveragedRiskPercent * 100) / 100,
        leveragedRewardPercent: Math.round(leveragedRewardPercent * 100) / 100,
    };
}

/**
 * Compare original analysis with a modified scenario
 */
export function compareScenarios(
    original: ScenarioConfig,
    scenario: ScenarioConfig
): ScenarioComparison {
    const originalMetrics = calculateMetrics(original);
    const scenarioMetrics = calculateMetrics(scenario);

    const rrChange = scenarioMetrics.rrRatio - originalMetrics.rrRatio;
    const rrChangePercent = originalMetrics.rrRatio > 0
        ? Math.round((rrChange / originalMetrics.rrRatio) * 10000) / 100
        : 0;

    return {
        original: originalMetrics,
        scenario: scenarioMetrics,
        rrChange: Math.round(rrChange * 100) / 100,
        rrChangePercent,
        riskChange: scenarioMetrics.riskPercent - originalMetrics.riskPercent,
        rewardChange: scenarioMetrics.rewardPercent - originalMetrics.rewardPercent,
    };
}

/**
 * Run Monte Carlo simulation for a scenario
 */
export function runScenarioMonteCarlo(
    config: ScenarioConfig,
    numSimulations: number = 500
): MonteCarloResult | null {
    try {
        const simConfig: SimulationConfig = {
            entry: config.entry,
            stopLoss: config.stopLoss,
            takeProfits: config.takeProfits,
            direction: config.direction,
            atr: config.atr || Math.abs(config.entry - config.stopLoss) * 0.5, // Estimate ATR if not provided
            timeframe: '1h',
            numSimulations,
        };

        return runSimulation(simConfig);
    } catch (error) {
        console.error('[ScenarioSimulator] Monte Carlo failed:', error);
        return null;
    }
}

/**
 * Find historical trades that match the scenario parameters
 */
export function findHistoricalMatches(
    config: ScenarioConfig,
    loggedTrades: LoggedTrade[],
    maxResults: number = 5
): HistoricalMatch[] {
    const matches: HistoricalMatch[] = [];

    // Filter to completed trades only (WIN or LOSS)
    const completedTrades = loggedTrades.filter(t =>
        t.outcome === TradeOutcome.WIN || t.outcome === TradeOutcome.LOSS
    );

    for (const trade of completedTrades) {
        const reasons: string[] = [];
        let score = 0;

        // Same coin bonus
        if (trade.analysis.coinName?.toLowerCase().includes(config.coinName.toLowerCase()) ||
            config.coinName.toLowerCase().includes(trade.analysis.coinName?.toLowerCase() || '')) {
            score += 30;
            reasons.push('Same coin');
        }

        // Same direction
        if (trade.analysis.direction === config.direction) {
            score += 25;
            reasons.push('Same direction');
        }

        // Same pattern family
        if (config.patternFamily && trade.analysis.detectedPatternFamily) {
            const scenarioFamily = config.patternFamily.toLowerCase();
            const tradeFamily = trade.analysis.detectedPatternFamily.toLowerCase();
            if (scenarioFamily.includes(tradeFamily) || tradeFamily.includes(scenarioFamily)) {
                score += 25;
                reasons.push(`Same family (${trade.analysis.detectedPatternFamily})`);
            }
        }

        // Similar R:R range (within 0.5)
        if (trade.analysis.rrRatio) {
            const scenarioRR = calculateMetrics(config).rrRatio;
            const diff = Math.abs(trade.analysis.rrRatio - scenarioRR);
            if (diff < 0.3) {
                score += 15;
                reasons.push('Similar R:R');
            } else if (diff < 0.5) {
                score += 10;
                reasons.push('Close R:R');
            }
        }

        // Similar leverage
        if (trade.leverage && Math.abs(trade.leverage - config.leverage) < 20) {
            score += 5;
            reasons.push('Similar leverage');
        }

        if (score >= 25 && reasons.length > 0) {
            matches.push({
                trade,
                similarityScore: Math.min(score, 100),
                matchReasons: reasons,
            });
        }
    }

    // Sort by similarity score and return top matches
    return matches
        .sort((a, b) => b.similarityScore - a.similarityScore)
        .slice(0, maxResults);
}

/**
 * Calculate win rate from historical matches
 */
export function calculateHistoricalWinRate(matches: HistoricalMatch[]): {
    winRate: number;
    wins: number;
    losses: number;
    total: number;
} {
    const wins = matches.filter(m => m.trade.outcome === TradeOutcome.WIN).length;
    const losses = matches.filter(m => m.trade.outcome === TradeOutcome.LOSS).length;
    const total = wins + losses;

    return {
        winRate: total > 0 ? Math.round((wins / total) * 100) : 0,
        wins,
        losses,
        total,
    };
}

/**
 * Generate optimization suggestions based on scenario and historical data
 */
export function generateSuggestions(
    config: ScenarioConfig,
    metrics: ScenarioMetrics,
    historicalMatches: HistoricalMatch[]
): string[] {
    const suggestions: string[] = [];

    // R:R too low
    if (metrics.rrRatio < 1.2) {
        suggestions.push('⚠️ R:R below 1.2 - consider tightening entry or widening target');
    }

    // R:R is good
    if (metrics.rrRatio >= 2.0) {
        suggestions.push('✅ R:R is excellent (2.0+)');
    }

    // Risk too high
    if (metrics.leveragedRiskPercent > 5) {
        suggestions.push(`⚠️ High leveraged risk (${metrics.leveragedRiskPercent}%) - consider reducing position or leverage`);
    }

    // Historical win rate check
    const historicalStats = calculateHistoricalWinRate(historicalMatches);
    if (historicalStats.total >= 3) {
        if (historicalStats.winRate >= 65) {
            suggestions.push(`✅ Strong historical edge: ${historicalStats.winRate}% win rate on similar setups (${historicalStats.total} trades)`);
        } else if (historicalStats.winRate < 40) {
            suggestions.push(`⚠️ Weak historical performance: ${historicalStats.winRate}% win rate on similar setups - proceed with caution`);
        }
    }

    // Check for losing streak pattern
    const recentLosses = historicalMatches.filter(m => m.trade.outcome === TradeOutcome.LOSS);
    if (recentLosses.length >= 3) {
        suggestions.push('⚠️ Similar setups have recent losing streak - review pattern conditions');
    }

    return suggestions;
}

/**
 * Extract scenario config from a TradeAnalysis
 */
export function extractConfigFromAnalysis(
    analysis: TradeAnalysis,
    leverage: number = 100,
    positionSizeUSD: number = 1000
): ScenarioConfig | null {
    try {
        // Parse entry price
        const entryStr = analysis.entryPoints?.[0]?.price || '0';
        const entry = parsePrice(entryStr);
        if (!entry || entry <= 0) return null;

        // Parse stop loss
        const slStr = analysis.stopLoss || '0';
        const stopLoss = parsePrice(slStr);
        if (!stopLoss || stopLoss <= 0) return null;

        // Parse take profits
        const takeProfits: number[] = [];
        for (const tp of analysis.takeProfit || []) {
            const price = parsePrice(tp.price);
            if (price && price > 0) {
                takeProfits.push(price);
            }
        }
        if (takeProfits.length === 0) {
            // Estimate TP based on 2:1 R:R if not provided
            const distance = Math.abs(entry - stopLoss);
            const direction = analysis.direction || 'Long';
            takeProfits.push(direction === 'Long' ? entry + distance * 2 : entry - distance * 2);
        }

        return {
            entry,
            stopLoss,
            takeProfits,
            direction: analysis.direction === 'Short' ? 'Short' : 'Long',
            leverage,
            positionSizeUSD,
            coinName: analysis.coinName || 'Unknown',
            patternFamily: analysis.detectedPatternFamily,
        };
    } catch (error) {
        console.error('[ScenarioSimulator] Failed to extract config:', error);
        return null;
    }
}

/**
 * Parse price string to number (handles ranges like "3050 - 3060")
 */
function parsePrice(priceStr: string): number {
    if (typeof priceStr === 'number') return priceStr;
    if (!priceStr || typeof priceStr !== 'string') return 0;

    // Remove $ and commas
    let cleaned = priceStr.replace(/[$,]/g, '').trim();

    // Handle ranges - take the middle value
    if (cleaned.includes('-')) {
        const parts = cleaned.split('-').map(p => parseFloat(p.trim()));
        if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
            return (parts[0] + parts[1]) / 2;
        }
    }

    // Handle "~" approximate values
    cleaned = cleaned.replace(/[~≈]/g, '');

    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
}

/**
 * Run complete scenario analysis
 */
export function analyzeScenario(
    config: ScenarioConfig,
    loggedTrades: LoggedTrade[],
    runMonteCarlo: boolean = true
): ScenarioResult {
    const metrics = calculateMetrics(config);
    const historicalMatches = findHistoricalMatches(config, loggedTrades);
    const monteCarlo = runMonteCarlo ? runScenarioMonteCarlo(config) : null;
    const suggestions = generateSuggestions(config, metrics, historicalMatches);

    return {
        config,
        metrics,
        monteCarlo,
        historicalMatches,
        suggestions,
    };
}
