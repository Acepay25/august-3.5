/**
 * Dashboard Utilities
 * Calculates statistics for the Win Rate Dashboard from trade log data
 */

import { LoggedTrade, TradeOutcome } from '../types';

export interface OverallStats {
    winRate: number;
    totalTrades: number;
    wins: number;
    losses: number;
    totalPnL: number;
    avgWinSize: number;
    avgLossSize: number;
    profitFactor: number;
}

export interface ConfidenceStats {
    level: 'High' | 'Medium' | 'Low' | 'Avoid';
    wins: number;
    losses: number;
    total: number;
    winRate: number;
}

export interface CoinStats {
    coin: string;
    wins: number;
    losses: number;
    total: number;
    winRate: number;
    pnl: number;
}

export interface FamilyStats {
    family: string;
    wins: number;
    losses: number;
    total: number;
    winRate: number;
}

export interface StreakData {
    currentStreak: { type: 'win' | 'loss' | 'none'; count: number };
    bestWinStreak: number;
    worstLossStreak: number;
}

export interface TrendDataPoint {
    date: string;
    winRate: number;
    trades: number;
}

/**
 * Calculate overall dashboard stats
 */
export const calculateOverallStats = (trades: LoggedTrade[]): OverallStats => {
    const completedTrades = trades.filter(
        t => t.outcome === TradeOutcome.WIN || t.outcome === TradeOutcome.LOSS
    );

    const wins = completedTrades.filter(t => t.outcome === TradeOutcome.WIN).length;
    const losses = completedTrades.filter(t => t.outcome === TradeOutcome.LOSS).length;
    const total = wins + losses;
    const winRate = total > 0 ? Math.round((wins / total) * 100) : 0;

    const totalPnL = trades.reduce((sum, t) => sum + (t.pnlAmount || 0), 0);

    const winningTrades = completedTrades.filter(t => t.outcome === TradeOutcome.WIN && t.pnlAmount);
    const losingTrades = completedTrades.filter(t => t.outcome === TradeOutcome.LOSS && t.pnlAmount);

    const avgWinSize = winningTrades.length > 0
        ? winningTrades.reduce((sum, t) => sum + (t.pnlAmount || 0), 0) / winningTrades.length
        : 0;
    const avgLossSize = losingTrades.length > 0
        ? Math.abs(losingTrades.reduce((sum, t) => sum + (t.pnlAmount || 0), 0) / losingTrades.length)
        : 0;

    const totalWins = winningTrades.reduce((sum, t) => sum + (t.pnlAmount || 0), 0);
    const totalLosses = Math.abs(losingTrades.reduce((sum, t) => sum + (t.pnlAmount || 0), 0));
    const profitFactor = totalLosses > 0 ? Math.round((totalWins / totalLosses) * 100) / 100 : totalWins > 0 ? Infinity : 0;

    return {
        winRate,
        totalTrades: total,
        wins,
        losses,
        totalPnL: Math.round(totalPnL * 100) / 100,
        avgWinSize: Math.round(avgWinSize * 100) / 100,
        avgLossSize: Math.round(avgLossSize * 100) / 100,
        profitFactor: profitFactor === Infinity ? 999 : profitFactor
    };
};

/**
 * Calculate performance by confidence level
 */
export const calculatePerformanceByConfidence = (trades: LoggedTrade[]): ConfidenceStats[] => {
    const levels: ('High' | 'Medium' | 'Low' | 'Avoid')[] = ['High', 'Medium', 'Low', 'Avoid'];

    return levels.map(level => {
        const levelTrades = trades.filter(
            t => t.analysis?.confidence === level &&
                (t.outcome === TradeOutcome.WIN || t.outcome === TradeOutcome.LOSS)
        );

        const wins = levelTrades.filter(t => t.outcome === TradeOutcome.WIN).length;
        const losses = levelTrades.filter(t => t.outcome === TradeOutcome.LOSS).length;
        const total = wins + losses;
        const winRate = total > 0 ? Math.round((wins / total) * 100) : 0;

        return { level, wins, losses, total, winRate };
    });
};

/**
 * Calculate performance by coin
 */
export const calculatePerformanceByCoin = (trades: LoggedTrade[]): CoinStats[] => {
    const coinMap = new Map<string, { wins: number; losses: number; pnl: number }>();

    trades.forEach(trade => {
        const coin = trade.analysis?.coinName || 'Unknown';
        if (trade.outcome !== TradeOutcome.WIN && trade.outcome !== TradeOutcome.LOSS) return;

        const existing = coinMap.get(coin) || { wins: 0, losses: 0, pnl: 0 };
        existing.pnl += trade.pnlAmount || 0;

        if (trade.outcome === TradeOutcome.WIN) {
            existing.wins++;
        } else {
            existing.losses++;
        }

        coinMap.set(coin, existing);
    });

    return Array.from(coinMap.entries())
        .map(([coin, stats]) => ({
            coin,
            wins: stats.wins,
            losses: stats.losses,
            total: stats.wins + stats.losses,
            winRate: stats.wins + stats.losses > 0
                ? Math.round((stats.wins / (stats.wins + stats.losses)) * 100)
                : 0,
            pnl: Math.round(stats.pnl * 100) / 100
        }))
        .sort((a, b) => b.total - a.total);
};

/**
 * Calculate performance by pattern family
 */
export const calculatePerformanceByFamily = (trades: LoggedTrade[]): FamilyStats[] => {
    const families = ['Family A', 'Family B', 'Family C', 'Omega'];

    return families.map(family => {
        const familyTrades = trades.filter(t => {
            const detected = t.analysis?.detectedPatternFamily?.toLowerCase() || '';
            return detected.includes(family.toLowerCase()) &&
                (t.outcome === TradeOutcome.WIN || t.outcome === TradeOutcome.LOSS);
        });

        const wins = familyTrades.filter(t => t.outcome === TradeOutcome.WIN).length;
        const losses = familyTrades.filter(t => t.outcome === TradeOutcome.LOSS).length;
        const total = wins + losses;
        const winRate = total > 0 ? Math.round((wins / total) * 100) : 0;

        return { family, wins, losses, total, winRate };
    });
};

/**
 * Calculate streak data
 */
export const calculateStreakData = (trades: LoggedTrade[]): StreakData => {
    const completedTrades = trades
        .filter(t => t.outcome === TradeOutcome.WIN || t.outcome === TradeOutcome.LOSS)
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    if (completedTrades.length === 0) {
        return {
            currentStreak: { type: 'none', count: 0 },
            bestWinStreak: 0,
            worstLossStreak: 0
        };
    }

    // Current streak (most recent trades)
    let currentType: 'win' | 'loss' = completedTrades[0].outcome === TradeOutcome.WIN ? 'win' : 'loss';
    let currentCount = 0;
    for (const trade of completedTrades) {
        const isWin = trade.outcome === TradeOutcome.WIN;
        if ((isWin && currentType === 'win') || (!isWin && currentType === 'loss')) {
            currentCount++;
        } else {
            break;
        }
    }

    // Best and worst streaks
    let bestWinStreak = 0;
    let worstLossStreak = 0;
    let tempWinStreak = 0;
    let tempLossStreak = 0;

    for (const trade of completedTrades) {
        if (trade.outcome === TradeOutcome.WIN) {
            tempWinStreak++;
            tempLossStreak = 0;
            bestWinStreak = Math.max(bestWinStreak, tempWinStreak);
        } else {
            tempLossStreak++;
            tempWinStreak = 0;
            worstLossStreak = Math.max(worstLossStreak, tempLossStreak);
        }
    }

    return {
        currentStreak: { type: currentType, count: currentCount },
        bestWinStreak,
        worstLossStreak
    };
};

/**
 * Calculate win rate trends over time (grouped by day)
 */
export const calculateRecentTrends = (trades: LoggedTrade[], days: number = 30): TrendDataPoint[] => {
    const now = new Date();
    const cutoffDate = new Date(now);
    cutoffDate.setDate(cutoffDate.getDate() - days);

    const completedTrades = trades.filter(t =>
        (t.outcome === TradeOutcome.WIN || t.outcome === TradeOutcome.LOSS) &&
        new Date(t.timestamp) >= cutoffDate
    );

    // Group by date
    const dateMap = new Map<string, { wins: number; losses: number }>();

    completedTrades.forEach(trade => {
        const date = new Date(trade.timestamp).toISOString().split('T')[0];
        const existing = dateMap.get(date) || { wins: 0, losses: 0 };

        if (trade.outcome === TradeOutcome.WIN) {
            existing.wins++;
        } else {
            existing.losses++;
        }

        dateMap.set(date, existing);
    });

    // Convert to array and calculate cumulative win rate
    const sortedDates = Array.from(dateMap.entries())
        .sort((a, b) => a[0].localeCompare(b[0]));

    let cumulativeWins = 0;
    let cumulativeLosses = 0;

    return sortedDates.map(([date, stats]) => {
        cumulativeWins += stats.wins;
        cumulativeLosses += stats.losses;
        const total = cumulativeWins + cumulativeLosses;

        return {
            date: new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
            winRate: total > 0 ? Math.round((cumulativeWins / total) * 100) : 0,
            trades: stats.wins + stats.losses
        };
    });
};
