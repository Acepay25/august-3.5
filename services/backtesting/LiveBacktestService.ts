/**
 * LiveBacktestService
 * Automatically backtests similar historical setups when AI suggests a trade.
 * 
 * Features:
 * 1. Pattern matching against trade history
 * 2. Win rate calculation by regime/pattern
 * 3. Expected Value (EV) calculation
 * 4. Prompt injection with historical context
 */

import { LoggedTrade, TradeAnalysis, TradeOutcome } from '../../../types';
import { MarketRegime } from '../analysis/TechnicalAnalysisService';

// =============================================================================
// TYPES
// =============================================================================

export interface BacktestMatch {
    tradeId: string;
    coin: string;
    direction: string;
    pattern: string;
    regime: string;
    outcome: 'WIN' | 'LOSS';
    pnlPercent: number;
    timestamp: string;
    confidence: string;
}

export interface RegimeBreakdown {
    regime: string;
    winRate: number;
    count: number;
    avgPnl: number;
}

// === TRADING SESSION TYPES ===
export type TradingSession = 'Asian' | 'London' | 'New York' | 'Overlap';

export interface SessionBreakdown {
    session: TradingSession;
    winRate: number;
    count: number;
    avgPnl: number;
}

export interface LiveBacktestResult {
    matchedTrades: BacktestMatch[];
    totalMatches: number;
    winRate: number;
    avgWinPercent: number;
    avgLossPercent: number;
    expectedValue: number;            // (winRate × avgWin) - (lossRate × avgLoss)
    regimeBreakdown: RegimeBreakdown[];
    patternBreakdown: {
        pattern: string;
        winRate: number;
        count: number;
    }[];
    directionBreakdown: {
        direction: string;
        winRate: number;
        count: number;
    }[];
    warning?: string;                 // If EV is negative or insufficient data
    currentRegimeStats?: RegimeBreakdown;

    // === SESSION PERFORMANCE BREAKDOWN ===
    sessionBreakdown: SessionBreakdown[];
    bestSession?: TradingSession;
    worstSession?: TradingSession;
}

// =============================================================================
// CONFIGURATION
// =============================================================================

const MIN_MATCHES_FOR_STATS = 3;
const MIN_MATCHES_FOR_CONFIDENCE = 5;

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Extract regime from trade (fallback to 'unknown' if not stored)
 */
const extractRegime = (trade: LoggedTrade): string => {
    // Try to extract from analysis or use default
    const pattern = trade.analysis?.marketConditions?.pattern?.toLowerCase() || '';

    if (pattern.includes('trend') || pattern.includes('continuation')) {
        return 'trending';
    }
    if (pattern.includes('range') || pattern.includes('consolidat')) {
        return 'ranging';
    }
    if (pattern.includes('volatile') || pattern.includes('chop')) {
        return 'volatile';
    }

    return 'unknown';
};

/**
 * Get trading session from timestamp (UTC-based)
 * 
 * Sessions:
 * - Asian: 00:00-08:00 UTC (Tokyo, Sydney, Singapore)
 * - London: 08:00-13:00 UTC (before NY overlap)
 * - Overlap: 13:00-17:00 UTC (London + NY peak volatility)
 * - New York: 17:00-21:00 UTC (after London close)
 * 
 * Note: After 21:00 UTC is considered "Asian" (late/early session)
 */
const getSessionFromTimestamp = (timestamp: string): TradingSession => {
    const hour = new Date(timestamp).getUTCHours();

    if (hour >= 0 && hour < 8) return 'Asian';
    if (hour >= 8 && hour < 13) return 'London';
    if (hour >= 13 && hour < 17) return 'Overlap';
    if (hour >= 17 && hour < 21) return 'New York';
    return 'Asian'; // 21:00-23:59 is late Asian
};

/**
 * Calculate similarity score between current analysis and historical trade
 */
const calculateSimilarity = (
    current: TradeAnalysis,
    historical: LoggedTrade,
    currentRegime?: MarketRegime
): number => {
    let score = 0;
    const historicalAnalysis = historical.analysis;

    if (!historicalAnalysis) return 0;

    // Same coin: +40 points
    if (current.coinName && historicalAnalysis.coinName) {
        if (current.coinName.toUpperCase() === historicalAnalysis.coinName.toUpperCase()) {
            score += 40;
        } else {
            // Same base asset (e.g., both BTC pairs): +15 points
            const currentBase = current.coinName.replace(/USDT|USD|PERP/gi, '');
            const historicalBase = historicalAnalysis.coinName.replace(/USDT|USD|PERP/gi, '');
            if (currentBase === historicalBase) {
                score += 15;
            }
        }
    }

    // Same direction: +30 points
    if (current.direction === historicalAnalysis.direction) {
        score += 30;
    }

    // Same pattern family: +20 points
    if (current.detectedPatternFamily && historicalAnalysis.detectedPatternFamily) {
        const currentFamily = current.detectedPatternFamily.toLowerCase();
        const historicalFamily = historicalAnalysis.detectedPatternFamily.toLowerCase();

        if (currentFamily === historicalFamily) {
            score += 20;
        } else if (
            (currentFamily.includes('a') && historicalFamily.includes('a')) ||
            (currentFamily.includes('b') && historicalFamily.includes('b')) ||
            (currentFamily.includes('c') && historicalFamily.includes('c')) ||
            (currentFamily.includes('omega') && historicalFamily.includes('omega'))
        ) {
            score += 15;
        }
    }

    // Same regime: +10 points
    if (currentRegime) {
        const historicalRegime = extractRegime(historical);
        if (currentRegime.includes(historicalRegime) || historicalRegime.includes(currentRegime)) {
            score += 10;
        }
    }

    return score;
};

/**
 * Calculate PnL percent from trade
 */
const calculatePnlPercent = (trade: LoggedTrade): number => {
    if (trade.pnlAmount && trade.investmentAmount && trade.investmentAmount > 0) {
        return (trade.pnlAmount / trade.investmentAmount) * 100;
    }

    // Estimate based on trade setup
    const analysis = trade.analysis;
    if (!analysis) return trade.outcome === 'WIN' ? 2 : -1;

    const entry = parseFloat(analysis.entryPoints?.[0]?.price?.replace(/[^0-9.]/g, '') || '0');
    const sl = parseFloat(analysis.stopLoss?.replace(/[^0-9.]/g, '') || '0');
    const tp = parseFloat(analysis.takeProfit?.[0]?.price?.replace(/[^0-9.]/g, '') || '0');

    if (entry > 0) {
        if (trade.outcome === 'WIN' && tp > 0) {
            return ((tp - entry) / entry) * 100 * (analysis.direction === 'Long' ? 1 : -1);
        } else if (trade.outcome === 'LOSS' && sl > 0) {
            return ((sl - entry) / entry) * 100 * (analysis.direction === 'Long' ? 1 : -1);
        }
    }

    // Default estimates
    return trade.outcome === 'WIN' ? 2 : -1;
};

// =============================================================================
// MAIN FUNCTIONS
// =============================================================================

/**
 * Find and analyze similar historical trades
 */
export const backtestSimilarSetups = (
    currentAnalysis: TradeAnalysis,
    tradeLog: LoggedTrade[],
    currentRegime?: MarketRegime
): LiveBacktestResult => {
    // Filter to completed trades
    const completedTrades = tradeLog.filter(t =>
        t.outcome === 'WIN' || t.outcome === 'LOSS'
    );

    // Score each trade by similarity
    const scoredTrades = completedTrades.map(trade => ({
        trade,
        similarity: calculateSimilarity(currentAnalysis, trade, currentRegime)
    }));

    // Filter to trades with minimum similarity
    const matchingTrades = scoredTrades
        .filter(s => s.similarity >= 30)
        .sort((a, b) => b.similarity - a.similarity);

    // Convert to BacktestMatch
    const matches: BacktestMatch[] = matchingTrades.map(({ trade }) => ({
        tradeId: trade.id,
        coin: trade.analysis?.coinName || 'Unknown',
        direction: trade.analysis?.direction || 'Unknown',
        pattern: trade.analysis?.detectedPatternFamily || trade.analysis?.marketConditions?.pattern || 'Unknown',
        regime: extractRegime(trade),
        outcome: trade.outcome as 'WIN' | 'LOSS',
        pnlPercent: calculatePnlPercent(trade),
        timestamp: trade.timestamp,
        confidence: trade.analysis?.confidence || 'Unknown'
    }));

    // Calculate statistics
    const totalMatches = matches.length;
    const wins = matches.filter(m => m.outcome === 'WIN');
    const losses = matches.filter(m => m.outcome === 'LOSS');

    const winRate = totalMatches > 0 ? (wins.length / totalMatches) * 100 : 0;
    const avgWinPercent = wins.length > 0
        ? wins.reduce((sum, m) => sum + m.pnlPercent, 0) / wins.length
        : 0;
    const avgLossPercent = losses.length > 0
        ? Math.abs(losses.reduce((sum, m) => sum + m.pnlPercent, 0) / losses.length)
        : 0;

    // Expected Value
    const expectedValue = calculateExpectedValue(winRate / 100, avgWinPercent, avgLossPercent);

    // Regime breakdown
    const regimes = [...new Set(matches.map(m => m.regime))];
    const regimeBreakdown: RegimeBreakdown[] = regimes.map(regime => {
        const regimeTrades = matches.filter(m => m.regime === regime);
        const regimeWins = regimeTrades.filter(m => m.outcome === 'WIN');
        return {
            regime,
            winRate: regimeTrades.length > 0 ? (regimeWins.length / regimeTrades.length) * 100 : 0,
            count: regimeTrades.length,
            avgPnl: regimeTrades.reduce((sum, m) => sum + m.pnlPercent, 0) / (regimeTrades.length || 1)
        };
    });

    // Pattern breakdown
    const patterns = [...new Set(matches.map(m => m.pattern))];
    const patternBreakdown = patterns.map(pattern => {
        const patternTrades = matches.filter(m => m.pattern === pattern);
        const patternWins = patternTrades.filter(m => m.outcome === 'WIN');
        return {
            pattern,
            winRate: patternTrades.length > 0 ? (patternWins.length / patternTrades.length) * 100 : 0,
            count: patternTrades.length
        };
    });

    // Direction breakdown
    const directions = ['Long', 'Short'];
    const directionBreakdown = directions.map(direction => {
        const dirTrades = matches.filter(m => m.direction === direction);
        const dirWins = dirTrades.filter(m => m.outcome === 'WIN');
        return {
            direction,
            winRate: dirTrades.length > 0 ? (dirWins.length / dirTrades.length) * 100 : 0,
            count: dirTrades.length
        };
    }).filter(d => d.count > 0);

    // Current regime stats
    const currentRegimeStats = currentRegime
        ? regimeBreakdown.find(r => currentRegime.includes(r.regime) || r.regime.includes(currentRegime))
        : undefined;

    // === SESSION BREAKDOWN ===
    const allSessions: TradingSession[] = ['Asian', 'London', 'Overlap', 'New York'];
    const sessionBreakdown: SessionBreakdown[] = allSessions.map(session => {
        const sessionTrades = matches.filter(m => getSessionFromTimestamp(m.timestamp) === session);
        const sessionWins = sessionTrades.filter(m => m.outcome === 'WIN');
        return {
            session,
            winRate: sessionTrades.length > 0 ? (sessionWins.length / sessionTrades.length) * 100 : 0,
            count: sessionTrades.length,
            avgPnl: sessionTrades.length > 0
                ? sessionTrades.reduce((sum, m) => sum + m.pnlPercent, 0) / sessionTrades.length
                : 0
        };
    }).filter(s => s.count > 0);

    // Find best and worst sessions (minimum 2 trades for significance)
    const significantSessions = sessionBreakdown.filter(s => s.count >= 2);
    const bestSession = significantSessions.length > 0
        ? significantSessions.reduce((best, s) => s.winRate > best.winRate ? s : best).session
        : undefined;
    const worstSession = significantSessions.length > 0
        ? significantSessions.reduce((worst, s) => s.winRate < worst.winRate ? s : worst).session
        : undefined;

    // Warnings
    let warning: string | undefined;
    if (totalMatches < MIN_MATCHES_FOR_STATS) {
        warning = `⚠️ Insufficient historical data (${totalMatches} matches). Results may not be statistically significant.`;
    } else if (expectedValue < 0) {
        warning = `⚠️ NEGATIVE EXPECTED VALUE (${expectedValue.toFixed(2)}%). This setup type has historically lost money.`;
    } else if (winRate < 40) {
        warning = `⚠️ Low historical win rate (${winRate.toFixed(1)}%). Consider reducing position size.`;
    }

    return {
        matchedTrades: matches.slice(0, 10), // Limit to 10 for UI
        totalMatches,
        winRate: Math.round(winRate * 10) / 10,
        avgWinPercent: Math.round(avgWinPercent * 100) / 100,
        avgLossPercent: Math.round(avgLossPercent * 100) / 100,
        expectedValue: Math.round(expectedValue * 100) / 100,
        regimeBreakdown,
        patternBreakdown,
        directionBreakdown,
        warning,
        currentRegimeStats,
        // Session breakdown
        sessionBreakdown,
        bestSession,
        worstSession
    };
};

/**
 * Calculate expected value
 */
export const calculateExpectedValue = (
    winRate: number,      // As decimal (0-1)
    avgWin: number,       // Percentage
    avgLoss: number       // Percentage (positive number)
): number => {
    const lossRate = 1 - winRate;
    return (winRate * avgWin) - (lossRate * avgLoss);
};

/**
 * Generate prompt injection with backtest context
 */
export const generateBacktestPromptInjection = (result: LiveBacktestResult): string => {
    if (result.totalMatches < MIN_MATCHES_FOR_STATS) {
        return `
📜 **HISTORICAL BACKTEST:**
Insufficient historical data (${result.totalMatches} similar trades found).
Unable to provide statistical validation.
`;
    }

    const evSign = result.expectedValue >= 0 ? '+' : '';
    let injection = `
═══════════════════════════════════════════════════════════════
📜 **HISTORICAL BACKTEST: SIMILAR SETUPS FOUND**
═══════════════════════════════════════════════════════════════

**Matched Trades:** ${result.totalMatches} historical trades

📊 **PERFORMANCE SUMMARY:**
- Win Rate: ${result.winRate.toFixed(1)}%
- Avg Win: ${result.avgWinPercent.toFixed(2)}%
- Avg Loss: -${result.avgLossPercent.toFixed(2)}%
- **Expected Value: ${evSign}${result.expectedValue.toFixed(2)}% per trade**
`;

    // Regime breakdown
    if (result.regimeBreakdown.length > 0) {
        injection += `
📈 **REGIME BREAKDOWN:**
`;
        for (const regime of result.regimeBreakdown) {
            const marker = result.currentRegimeStats?.regime === regime.regime ? ' ← Current' : '';
            injection += `- ${regime.regime}: ${regime.winRate.toFixed(0)}% (n=${regime.count})${marker}\n`;
        }
    }

    // Warning
    if (result.warning) {
        injection += `
${result.warning}
`;
    }

    // Best/worst outcome
    if (result.matchedTrades.length > 0) {
        const best = result.matchedTrades
            .filter(t => t.outcome === 'WIN')
            .sort((a, b) => b.pnlPercent - a.pnlPercent)[0];
        const worst = result.matchedTrades
            .filter(t => t.outcome === 'LOSS')
            .sort((a, b) => a.pnlPercent - b.pnlPercent)[0];

        if (best) {
            injection += `✅ Best Outcome: +${best.pnlPercent.toFixed(1)}% (${best.coin})\n`;
        }
        if (worst) {
            injection += `❌ Worst Outcome: ${worst.pnlPercent.toFixed(1)}% (${worst.coin})\n`;
        }
    }

    injection += `
═══════════════════════════════════════════════════════════════

**Use this historical data to validate your confidence level.**
`;

    return injection;
};

/**
 * Generate summary for UI display
 */
export const generateBacktestSummary = (result: LiveBacktestResult): string => {
    const evSign = result.expectedValue >= 0 ? '+' : '';
    const evEmoji = result.expectedValue >= 0 ? '✅' : '⚠️';

    return `
╔═══════════════════════════════════════════════════════════════╗
║           HISTORICAL BACKTEST (${result.totalMatches} similar trades)           ║
╠═══════════════════════════════════════════════════════════════╣
║ Win Rate: ${result.winRate.toFixed(1)}%                                          ║
║ Avg Win: +${result.avgWinPercent.toFixed(2)}% | Avg Loss: -${result.avgLossPercent.toFixed(2)}%               ║
║ ${evEmoji} Expected Value: ${evSign}${result.expectedValue.toFixed(2)}% per trade                  ║
╠═══════════════════════════════════════════════════════════════╣
${result.regimeBreakdown.map(r => `║ ${r.regime}: ${r.winRate.toFixed(0)}% win rate (${r.count} trades)${r.regime === result.currentRegimeStats?.regime ? ' ←' : ''}        ║`).join('\n')}
╚═══════════════════════════════════════════════════════════════╝
`;
};

/**
 * Quick check if there's enough historical data for meaningful backtest
 */
export const hasEnoughHistoricalData = (
    currentAnalysis: TradeAnalysis,
    tradeLog: LoggedTrade[]
): boolean => {
    const result = backtestSimilarSetups(currentAnalysis, tradeLog);
    return result.totalMatches >= MIN_MATCHES_FOR_CONFIDENCE;
};
