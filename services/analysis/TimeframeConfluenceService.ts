/**
 * TimeframeConfluenceService
 * 
 * Scores trade setups by timeframe alignment and tracks historical win rate
 * by confluence score. Higher confluence typically correlates with higher win rate.
 */

import { LoggedTrade, TradeAnalysis } from '../../types';
import { getPreferenceObject, setPreferenceObject, PREF_KEYS } from '../infrastructure/PreferencesService';

// ========================= INTERFACES =========================

export interface TimeframeAlignment {
    timeframe: '5m' | '15m' | '1h' | '4h' | '1d';
    direction: 'bullish' | 'bearish' | 'neutral';
    strength: number; // 0-100
    indicators: {
        ema?: 'bullish' | 'bearish' | 'neutral';
        rsi?: 'bullish' | 'bearish' | 'neutral' | 'overbought' | 'oversold';
        macd?: 'bullish' | 'bearish' | 'neutral';
        structure?: 'bullish' | 'bearish' | 'neutral';
    };
}

export interface ConfluenceScore {
    score: number; // 0-100
    alignedTimeframes: number; // Count of timeframes agreeing with direction
    totalTimeframes: number;
    direction: 'Long' | 'Short';
    breakdown: TimeframeAlignment[];
    recommendation: 'strong' | 'moderate' | 'weak' | 'conflicting';
}

export interface ConfluenceHistoricalStats {
    byScore: Record<string, { wins: number; losses: number; winRate: number }>;
    avgWinningScore: number;
    avgLosingScore: number;
    optimalThreshold: number; // Minimum score for best win rate
}

// ========================= CONSTANTS =========================

const TIMEFRAMES = ['5m', '15m', '1h', '4h', '1d'] as const;

// In-memory cache
let _confluenceCache: ConfluenceHistoricalStats | null = null;
let _isInitialized = false;

/**
 * Initialize service - load stats into memory
 */
export const initConfluenceService = async (): Promise<void> => {
    if (_isInitialized) return;

    try {
        const stored = await getPreferenceObject<ConfluenceHistoricalStats>(PREF_KEYS.CONFLUENCE_STATS);
        if (stored) {
            _confluenceCache = stored;
        } else {
            // Default stats
            _confluenceCache = {
                byScore: {},
                avgWinningScore: 0,
                avgLosingScore: 0,
                optimalThreshold: 60,
            };
        }
        _isInitialized = true;
        console.log('[Confluence] Service initialized with cached stats');
    } catch (e) {
        console.error('[Confluence] Cached init failed:', e);
        _confluenceCache = {
            byScore: {},
            avgWinningScore: 0,
            avgLosingScore: 0,
            optimalThreshold: 60,
        };
    }
};

// ========================= SCORING FUNCTIONS =========================

/**
 * Calculate confluence score from analysis
 */
export function calculateConfluenceScore(
    analysis: TradeAnalysis,
    direction: 'Long' | 'Short'
): ConfluenceScore {
    const tradeBias: 'bullish' | 'bearish' = direction === 'Long' ? 'bullish' : 'bearish';
    const breakdown: TimeframeAlignment[] = [];
    const marketConditions = analysis.marketConditions;
    const prices = marketConditions?.prices || {};

    // The AI's stated timeframe alignment ("3 of 4 bullish") is the only
    // per-timeframe structural signal available. It must not be combined
    // with the per-timeframe weight loop — the old code pre-set the score
    // from the text AND added weights on top (scores could reach 200), and
    // derived every timeframe's direction from the analysis direction
    // itself, making "alignment" circular. RSI and MACD contribute
    // independent market-data agreement instead.
    const timeframeAlignmentStr = marketConditions?.timeframeAlignment || '';
    const alignmentMatch = timeframeAlignmentStr.match(/(\d+)\s*of\s*(\d+)/i);
    let alignedCount = 0;
    let alignmentRatio = 0;
    if (alignmentMatch) {
        alignedCount = parseInt(alignmentMatch[1], 10);
        const total = parseInt(alignmentMatch[2], 10);
        if (total > 0) alignmentRatio = alignedCount / total;
    }

    // RSI agreement (0..1): overbought (>70) favors shorts, oversold (<30)
    // favors longs; the value in between gives a mild directional read.
    const rsiStr = marketConditions?.rsi || '';
    const rsiValue = parseFloat(rsiStr);
    let rsiAgreement = 0.5; // missing/unparsable RSI → neutral
    if (!isNaN(rsiValue)) {
        if (rsiValue > 70) rsiAgreement = direction === 'Short' ? 1 : 0;
        else if (rsiValue < 30) rsiAgreement = direction === 'Long' ? 1 : 0;
        else if (rsiValue > 50) rsiAgreement = 0.5 + ((rsiValue - 50) / 50) * 0.5;
        else rsiAgreement = 0.5 - ((50 - rsiValue) / 50) * 0.5;
    }

    // MACD agreement (0..1)
    const macdStr = (marketConditions?.macd || '').toLowerCase();
    let macdAgreement = 0.5; // missing MACD → neutral
    if (macdStr.includes('bullish') || macdStr.includes('cross up')) macdAgreement = tradeBias === 'bullish' ? 1 : 0;
    else if (macdStr.includes('bearish') || macdStr.includes('cross down')) macdAgreement = tradeBias === 'bearish' ? 1 : 0;

    // Single coherent formula: 60% structural alignment, 20% RSI, 20% MACD.
    // Clamped to 0-100.
    const totalScore = alignmentRatio * 60 + rsiAgreement * 20 + macdAgreement * 20;
    const normalizedScore = Math.max(0, Math.min(100, Math.round(totalScore)));

    // Per-timeframe breakdown (informational — no consumer branches on it).
    // Without per-timeframe indicator data the direction can't be honestly
    // attributed per timeframe, so entries stay neutral unless the stated
    // alignment is strong; strength mirrors the stated alignment.
    for (const tf of TIMEFRAMES) {
        const priceKey = tf as keyof typeof prices;
        breakdown.push({
            timeframe: tf,
            direction: prices[priceKey] !== undefined && alignmentRatio >= 0.75 ? tradeBias : 'neutral',
            strength: Math.round(alignmentRatio * 100),
            indicators: {
                rsi: !isNaN(rsiValue)
                    ? (rsiValue > 70 ? 'overbought' : rsiValue < 30 ? 'oversold' : tradeBias)
                    : undefined,
                macd: macdAgreement > 0.5 ? tradeBias : macdAgreement < 0.5 ? (tradeBias === 'bullish' ? 'bearish' : 'bullish') : undefined,
            }
        });
    }

    // Determine recommendation
    let recommendation: 'strong' | 'moderate' | 'weak' | 'conflicting';
    if (normalizedScore >= 75) recommendation = 'strong';
    else if (normalizedScore >= 50) recommendation = 'moderate';
    else if (normalizedScore >= 25) recommendation = 'weak';
    else recommendation = 'conflicting';

    return {
        score: normalizedScore,
        alignedTimeframes: alignedCount || Math.round((normalizedScore / 100) * TIMEFRAMES.length),
        totalTimeframes: TIMEFRAMES.length,
        direction,
        breakdown,
        recommendation,
    };
}

/**
 * Generate prompt injection for confluence context
 */
export function generateConfluencePromptInjection(score: ConfluenceScore): string {
    const parts: string[] = [];

    parts.push(` **TIMEFRAME CONFLUENCE SCORE: ${score.score}/100** (${score.recommendation.toUpperCase()})`);
    parts.push(`• ${score.alignedTimeframes} of ${score.totalTimeframes} timeframes align with ${score.direction}`);

    if (score.recommendation === 'strong') {
        parts.push(` HIGH CONFLUENCE: Multiple timeframes confirm direction. Higher probability setup.`);
    } else if (score.recommendation === 'moderate') {
        parts.push(` MODERATE CONFLUENCE: Mixed signals across timeframes. Proceed with caution.`);
    } else if (score.recommendation === 'weak') {
        parts.push(` LOW CONFLUENCE: Few timeframes support this direction. Consider waiting for alignment.`);
    } else {
        parts.push(` CONFLICTING SIGNALS: Timeframes are mixed. High risk of chop.`);
    }

    return parts.join('\n');
}

// ========================= HISTORICAL TRACKING =========================

/**
 * Load historical confluence stats
 */
/**
 * Load historical confluence stats
 */
export function loadConfluenceStats(): ConfluenceHistoricalStats {
    if (_confluenceCache) return _confluenceCache;

    // Fallback for non-initialized state
    try {
        const stored = localStorage.getItem(PREF_KEYS.CONFLUENCE_STATS);
        if (stored) {
            _confluenceCache = JSON.parse(stored);
            return _confluenceCache!;
        }
    } catch (e) {
        console.warn('[Confluence] Failed to load stats:', e);
    }

    return {
        byScore: {},
        avgWinningScore: 0,
        avgLosingScore: 0,
        optimalThreshold: 60,
    };
}

/**
 * Save confluence stats
 */
/**
 * Save confluence stats
 */
function saveConfluenceStats(stats: ConfluenceHistoricalStats): void {
    _confluenceCache = stats;
    // Fire and forget
    setPreferenceObject(PREF_KEYS.CONFLUENCE_STATS, stats).catch(e =>
        console.warn('[Confluence] Failed to save stats:', e)
    );
}

/**
 * Track confluence outcome for a completed trade
 */
export function trackConfluenceOutcome(
    confluenceScore: number,
    outcome: 'WIN' | 'LOSS'
): void {
    const stats = loadConfluenceStats();

    // Bucket scores into ranges (0-20, 20-40, 40-60, 60-80, 80-100)
    const bucket = `${Math.floor(confluenceScore / 20) * 20}-${Math.floor(confluenceScore / 20) * 20 + 20}`;

    if (!stats.byScore[bucket]) {
        stats.byScore[bucket] = { wins: 0, losses: 0, winRate: 0 };
    }

    if (outcome === 'WIN') {
        stats.byScore[bucket].wins++;
    } else {
        stats.byScore[bucket].losses++;
    }

    // Recalculate win rate
    const total = stats.byScore[bucket].wins + stats.byScore[bucket].losses;
    stats.byScore[bucket].winRate = total > 0
        ? Math.round((stats.byScore[bucket].wins / total) * 100)
        : 0;

    // Recalculate averages and optimal threshold
    let totalWinScore = 0, winCount = 0;
    let totalLoseScore = 0, loseCount = 0;

    for (const [range, data] of Object.entries(stats.byScore)) {
        const midpoint = parseInt(range.split('-')[0], 10) + 10;
        totalWinScore += midpoint * data.wins;
        winCount += data.wins;
        totalLoseScore += midpoint * data.losses;
        loseCount += data.losses;
    }

    stats.avgWinningScore = winCount > 0 ? Math.round(totalWinScore / winCount) : 0;
    stats.avgLosingScore = loseCount > 0 ? Math.round(totalLoseScore / loseCount) : 0;

    // Find optimal threshold (bucket with best win rate and > 3 samples)
    let bestWinRate = 0;
    let bestThreshold = 60;
    for (const [range, data] of Object.entries(stats.byScore)) {
        const total = data.wins + data.losses;
        if (total >= 3 && data.winRate > bestWinRate) {
            bestWinRate = data.winRate;
            bestThreshold = parseInt(range.split('-')[0], 10);
        }
    }
    stats.optimalThreshold = bestThreshold;

    saveConfluenceStats(stats);
    console.log(`[Confluence] Tracked ${outcome} at score ${confluenceScore}, bucket ${bucket}`);
}

/**
 * Get confluence insight for moderator
 */
export function getConfluenceInsight(currentScore: number): string {
    const stats = loadConfluenceStats();

    const parts: string[] = [];

    if (stats.avgWinningScore > 0 && stats.avgLosingScore > 0) {
        parts.push(`**Historical Confluence Insight:**`);
        parts.push(`• Average winning confluence: ${stats.avgWinningScore}/100`);
        parts.push(`• Average losing confluence: ${stats.avgLosingScore}/100`);
        parts.push(`• Optimal threshold: >${stats.optimalThreshold}/100`);

        if (currentScore < stats.optimalThreshold) {
            parts.push(` Current score (${currentScore}) is BELOW optimal threshold (${stats.optimalThreshold}).`);
        } else {
            parts.push(` Current score (${currentScore}) meets optimal threshold.`);
        }
    }

    return parts.join('\n');
}

/**
 * Sync confluence stats from trade log
 */
export function syncConfluenceFromTradeLog(trades: LoggedTrade[]): void {
    // Reset stats
    const stats: ConfluenceHistoricalStats = {
        byScore: {},
        avgWinningScore: 0,
        avgLosingScore: 0,
        optimalThreshold: 60,
    };

    for (const trade of trades) {
        if (!trade.analysis || !trade.outcome || trade.outcome === 'PENDING') continue;

        const direction = trade.analysis.direction as 'Long' | 'Short' | 'Neutral';
        if (!direction || direction === 'Neutral') continue;

        const score = calculateConfluenceScore(trade.analysis, direction);

        // Bucket and track
        const bucket = `${Math.floor(score.score / 20) * 20}-${Math.floor(score.score / 20) * 20 + 20}`;
        if (!stats.byScore[bucket]) {
            stats.byScore[bucket] = { wins: 0, losses: 0, winRate: 0 };
        }

        if (trade.outcome === 'WIN') {
            stats.byScore[bucket].wins++;
        } else if (trade.outcome === 'LOSS') {
            stats.byScore[bucket].losses++;
        }
    }

    // Recalculate win rates and averages
    let totalWinScore = 0, winCount = 0;
    let totalLoseScore = 0, loseCount = 0;

    for (const [range, data] of Object.entries(stats.byScore)) {
        const total = data.wins + data.losses;
        data.winRate = total > 0 ? Math.round((data.wins / total) * 100) : 0;

        const midpoint = parseInt(range.split('-')[0], 10) + 10;
        totalWinScore += midpoint * data.wins;
        winCount += data.wins;
        totalLoseScore += midpoint * data.losses;
        loseCount += data.losses;
    }

    stats.avgWinningScore = winCount > 0 ? Math.round(totalWinScore / winCount) : 0;
    stats.avgLosingScore = loseCount > 0 ? Math.round(totalLoseScore / loseCount) : 0;

    // Find optimal threshold
    let bestWinRate = 0;
    let bestThreshold = 60;
    for (const [range, data] of Object.entries(stats.byScore)) {
        const total = data.wins + data.losses;
        if (total >= 3 && data.winRate > bestWinRate) {
            bestWinRate = data.winRate;
            bestThreshold = parseInt(range.split('-')[0], 10);
        }
    }
    stats.optimalThreshold = bestThreshold;

    saveConfluenceStats(stats);
    console.log('[Confluence] Synced stats from trade log:', stats);
}
