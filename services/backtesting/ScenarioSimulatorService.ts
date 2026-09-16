/**
 * ScenarioSimulatorService
 * 
 * Provides "What If" analysis for trade setups by allowing users to
 * adjust parameters and see real-time impact on R:R, Monte Carlo outcomes,
 * and historical pattern matching.
 */

import { TradeAnalysis, LoggedTrade, TradeOutcome } from '../../types';
import { runSimulationAsync, MonteCarloResult, SimulationConfig } from '../analysis/MonteCarloService';
import { parsePrice } from '../../utils/analysisUtils';
import { sanitizeLevelOrdering } from '../../utils/levelOrder';

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
    /** NOTIONAL position value in USD — what the UI "Position ($)" field
     *  means (a $1000 position is $1000 of BTC exposure; leverage only
     *  determines the margin locked and the ROE-on-margin percentages).
     *  riskUSD/rewardUSD are therefore price-distance × position WITHOUT an
     *  extra leverage factor. */
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

    // USD values — `positionSizeUSD` is the NOTIONAL position value, so the
    // dollar risk/reward is just the price distance × position. The old
    // `× leverage` double-counted it: a 1% stop on a $1000 position at 100x
    // reported $1,000 risk (= the entire notional), which is only true when
    // positionSize means MARGIN — but the UI field says "Position ($)" and
    // every readout divides these numbers by the position. Leverage belongs
    // to the margin-relative percentages below, not to the notional math.
    const riskUSD = (riskPercent / 100) * positionSizeUSD;
    const rewardUSD = (rewardPercent / 100) * positionSizeUSD;

    // Return on the MARGIN locked by the exchange: ROE% ≈ price move % ×
    // leverage (riskUSD / margin; margin = position / leverage).
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
 * A take-profit sitting (within float dust) exactly ON the entry has zero
 * reward distance. sanitizeLevelOrdering FLAGS it — but cannot repair it
 * (the mirror of entry is entry). Left in the ladder, the MC path evaluator
 * checks `stepHigh >= tp1` on the very first step, which always touches the
 * entry price — so every such sim is credited a 0% same-step "TP1 WIN".
 * Shared by the simulator (drops these) and the suggestion generator
 * (announces the drop).
 */
export const isZeroDistanceTarget = (tp: number, entry: number): boolean =>
    Number.isFinite(tp) && tp > 0
    && Math.abs(tp - entry) <= Math.max(entry * 1e-9, Number.EPSILON);

/**
 * Run Monte Carlo simulation for a scenario
 */
export async function runScenarioMonteCarlo(
    config: ScenarioConfig,
    numSimulations: number = 500
): Promise<MonteCarloResult | null> {
    try {
        // Sanitize the level geometry BEFORE feeding the simulator: the "What
        // If" sliders can produce an inverted plan (Long with the stop above
        // entry, or a TP ladder out of order) and runSimulation's abs/zone
        // math cannot tell a below-entry "TP" from a real target. Mirror +
        // re-sort through the canonical level-order gate (same repair the
        // outcome engines and the AI boundary use).
        const ordered = sanitizeLevelOrdering(
            config.direction,
            config.entry,
            config.stopLoss,
            config.takeProfits.map(tp => (Number.isFinite(tp) && tp > 0 ? tp : null))
        );
        if (ordered.fixes.length > 0) {
            console.log('[ScenarioSimulator] Level ordering repaired for MC:', ordered.fixes.join('; '));
        }

        // Beyond the levelOrder flag: DROP zero-distance TPs from the ladder
        // so an unreparable `tp === entry` can never score the instant 0%
        // WIN described on isZeroDistanceTarget. generateSuggestions reports
        // the drop so the result stays honest about what was simulated.
        const takeProfits = ordered.correctedTakeProfits
            .map(tp => tp ?? 0)
            .filter(tp => !isZeroDistanceTarget(tp, config.entry));

        const simConfig: SimulationConfig = {
            entry: config.entry,
            stopLoss: ordered.correctedStopLoss ?? config.stopLoss,
            takeProfits,
            direction: config.direction,
            atr: config.atr || Math.abs(config.entry - config.stopLoss) * 0.5, // Estimate ATR if not provided
            timeframe: '1h',
            numSimulations,
        };

        // Run through the worker (with sync fallback) so the modal never
        // blocks the main thread on every slider change.
        return await runSimulationAsync(simConfig);
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

    // Scenario R:R computed once (was rebuilt per candidate trade).
    const scenarioRR = calculateMetrics(config).rrRatio;

    // Filter to completed trades only (WIN or LOSS)
    const completedTrades = loggedTrades.filter(t =>
        t.outcome === TradeOutcome.WIN || t.outcome === TradeOutcome.LOSS
    );

    for (const trade of completedTrades) {
        const reasons: string[] = [];
        let score = 0;
        // Same rule LiveBacktestService.calculateSimilarity already enforces:
        // a direction-only match (+25) used to clear the ≥25 gate on its own,
        // so "Strong historical edge: X% win rate on similar setups" was just
        // the global win rate re-labeled for ANY Long/Short. Require at least
        // TWO independent matching dimensions before a trade counts as
        // "similar" at all. A DIMENSION is a property OF THE SETUP (coin,
        // pattern family, regime, direction, R:R shape) — not a property of
        // how the user once sized a ticket.
        let matchedDimensions = 0;

        // Same coin bonus
        if (trade.analysis.coinName?.toLowerCase().includes(config.coinName.toLowerCase()) ||
            config.coinName.toLowerCase().includes(trade.analysis.coinName?.toLowerCase() || '')) {
            score += 30;
            reasons.push('Same coin');
            matchedDimensions++;
        }

        // Same direction
        if (trade.analysis.direction === config.direction) {
            score += 25;
            reasons.push('Same direction');
            matchedDimensions++;
        }

        // Same pattern family
        if (config.patternFamily && trade.analysis.detectedPatternFamily) {
            const scenarioFamily = config.patternFamily.toLowerCase();
            const tradeFamily = trade.analysis.detectedPatternFamily.toLowerCase();
            if (scenarioFamily.includes(tradeFamily) || tradeFamily.includes(scenarioFamily)) {
                score += 25;
                reasons.push(`Same family (${trade.analysis.detectedPatternFamily})`);
                matchedDimensions++;
            }
        }

        // Similar R:R range (within 0.5)
        if (trade.analysis.rrRatio) {
            const diff = Math.abs(trade.analysis.rrRatio - scenarioRR);
            if (diff < 0.3) {
                score += 15;
                reasons.push('Similar R:R');
                matchedDimensions++;
            } else if (diff < 0.5) {
                score += 10;
                reasons.push('Close R:R');
                matchedDimensions++;
            }
        }

        // Similar leverage — a TIE-BREAKER weight, NOT a match dimension.
        // Leverage is how an old ticket was sized, not a property of the
        // setup, and counting it as a dimension let the same
        // direction-inflation this gate exists to kill sneak back through:
        // same direction + a loose |Δleverage| < 20 band cleared the ≥2 gate
        // for ANY Long/Long pair traded at similar-ish leverage. It now only
        // nudges the score (ranking / top-N) without helping the match pass.
        if (trade.leverage && Math.abs(trade.leverage - config.leverage) < 20) {
            score += 5;
            reasons.push('Similar leverage');
        }

        if (score >= 25 && matchedDimensions >= 2) {
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

    // Zero-distance target: report the drop runScenarioMonteCarlo performs —
    // the sim ran a DIFFERENT (default) ladder than the one on screen, and
    // silently pretending otherwise would bake the fake-win bug back in as
    // a silent behavior change.
    if (config.takeProfits.some(tp => isZeroDistanceTarget(tp, config.entry))) {
        suggestions.push(
            ' A target sits exactly ON the entry (zero reward distance) — it was dropped from the Monte Carlo ladder instead of scoring an instant 0% "TP1 WIN".'
        );
    }

    // R:R too low
    if (metrics.rrRatio < 1.2) {
        suggestions.push(' R:R below 1.2 - consider tightening entry or widening target');
    }

    // R:R is good
    if (metrics.rrRatio >= 2.0) {
        suggestions.push(' R:R is excellent (2.0+)');
    }

    // Risk too high
    if (metrics.leveragedRiskPercent > 5) {
        suggestions.push(` High leveraged risk (${metrics.leveragedRiskPercent}%) - consider reducing position or leverage`);
    }

    // Historical win rate check
    const historicalStats = calculateHistoricalWinRate(historicalMatches);
    if (historicalStats.total >= 3) {
        if (historicalStats.winRate >= 65) {
            suggestions.push(` Strong historical edge: ${historicalStats.winRate}% win rate on similar setups (${historicalStats.total} trades)`);
        } else if (historicalStats.winRate < 40) {
            suggestions.push(` Weak historical performance: ${historicalStats.winRate}% win rate on similar setups - proceed with caution`);
        }
    }

    // Check for losing streak pattern
    const recentLosses = historicalMatches.filter(m => m.trade.outcome === TradeOutcome.LOSS);
    if (recentLosses.length >= 3) {
        suggestions.push(' Similar setups have recent losing streak - review pattern conditions');
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

// parsePrice imported from utils/analysisUtils — canonical version handles
// ranges ("3050 - 3060"), "to" ranges, and trailing annotations ("94500 4h").

/**
 * Run complete scenario analysis
 */
export async function analyzeScenario(
    config: ScenarioConfig,
    loggedTrades: LoggedTrade[],
    runMonteCarlo: boolean = true
): Promise<ScenarioResult> {
    const metrics = calculateMetrics(config);
    const historicalMatches = findHistoricalMatches(config, loggedTrades);
    const monteCarlo = runMonteCarlo ? await runScenarioMonteCarlo(config) : null;
    const suggestions = generateSuggestions(config, metrics, historicalMatches);

    return {
        config,
        metrics,
        monteCarlo,
        historicalMatches,
        suggestions,
    };
}
