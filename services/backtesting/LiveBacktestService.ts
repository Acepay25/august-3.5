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

import { LoggedTrade, TradeAnalysis, TradeOutcome } from '../../types';
import { MarketRegime } from '../analysis/TechnicalAnalysisService';
import { parsePrice } from '../../utils/analysisUtils';
import { baseOf } from '../../utils/symbol';

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
    /** Leveraged ROE percent, or NULL when the trade has no measurable
     *  magnitude (calculatePnlPercent returned null). Previously a `?? 0`
     *  placeholder — and SetupMemoryService copied that 0 into the journal
     *  summary the model reads, so unmeasured trades printed "WIN (0.0%)":
     *  a fabricated number presented as evidence. Nulls must render as
     *  "magnitude unmeasured" and stay out of any derived stats. */
    pnlPercent: number | null;
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
const normalizeRegime = (regime: string): string => {
    const r = (regime || '').toLowerCase();
    if (r.includes('trend')) return 'trending';
    // NOTE: 'ranging'.includes('range') is FALSE — the literal normalized
    // forms need their own stems ('rang', 'volat') or regime matching never
    // fires for already-normalized labels.
    if (r.includes('rang') || r.includes('consolidat')) return 'ranging';
    if (r === 'volatile' || r.includes('volat') || r.includes('chop')) return 'volatile';
    if (r === 'compression' || r.includes('compression')) return 'compression';
    return 'unknown';
};

const familyKey = (family: string): string | null => {
    const f = (family || '').toLowerCase();
    if (/\bfamily\s*omega\b/.test(f) || f.includes('omega')) return 'omega';
    if (/\bfamily\s*a\b/.test(f) || f.includes('exhaustion') || f.includes('trap')) return 'a';
    if (/\bfamily\s*b\b/.test(f) || f.includes('reversal')) return 'b';
    if (/\bfamily\s*c\b/.test(f) || f.includes('continuation')) return 'c';
    return null;
};

const extractRegime = (trade: LoggedTrade): string => {
    // Prefer the persisted regime (now written at log time). Either way the
    // value is NORMALIZED to the shared buckets ('trending'/'ranging'/…) —
    // matches used to carry RAW legacy labels ('strong_trend_up') while the
    // current-regime lookup and the prompt's "← Current" marker used the
    // normalized buckets, so the regime breakdown NEVER joined and the
    // regime context was silently absent.
    if (trade.marketRegime) return normalizeRegime(trade.marketRegime);

    // Fallback: try to extract from analysis text
    const pattern = trade.analysis?.marketConditions?.pattern?.toLowerCase() || '';
    return normalizeRegime(pattern);
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
    // How many INDEPENDENT dimensions matched — same-coin ALONE must not
    // count as a "similar setup": an opposite-direction trade on the same
    // coin is not evidence for this setup's win rate.
    let matchedDimensions = 0;
    const historicalAnalysis = historical.analysis;

    if (!historicalAnalysis) return 0;

    // Same coin: +40 points
    if (current.coinName && historicalAnalysis.coinName) {
        if (current.coinName.toUpperCase() === historicalAnalysis.coinName.toUpperCase()) {
            score += 40;
            matchedDimensions++;
        } else {
            // Same base asset (e.g., both BTC pairs): +15 points. Anchored so a
            // USDC pair no longer parses to "C" (the old unanchored strip bug).
            const currentBase = baseOf(current.coinName);
            const historicalBase = baseOf(historicalAnalysis.coinName);
            if (currentBase === historicalBase) {
                score += 15;
                matchedDimensions++;
            }
        }
    }

    // Same direction: +30 points
    if (current.direction === historicalAnalysis.direction) {
        score += 30;
        matchedDimensions++;
    }

    // Same pattern family: +20 points
    if (current.detectedPatternFamily && historicalAnalysis.detectedPatternFamily) {
        const currentFamily = current.detectedPatternFamily.toLowerCase();
        const historicalFamily = historicalAnalysis.detectedPatternFamily.toLowerCase();

        if (currentFamily === historicalFamily) {
            score += 20;
            matchedDimensions++;
        } else {
            const cf = familyKey(currentFamily);
            const hf = familyKey(historicalFamily);
            if (cf && cf === hf) {
                score += 15;
                matchedDimensions++;
            }
        }
    }

    // Same regime: +10 points
    if (currentRegime) {
        const historicalRegime = extractRegime(historical);
        if (normalizeRegime(currentRegime) === normalizeRegime(historicalRegime) && normalizeRegime(currentRegime) !== 'unknown') {
            score += 10;
            matchedDimensions++;
        }
    }

    // Same-coin-only trades (+40, one dimension) must not pass as "similar"
    // — require at least two independent matching dimensions.
    return matchedDimensions >= 2 ? score : 0;
};

/**
 * Calculate PnL percent from a logged trade — in ONE unit: the leveraged
 * percent of invested margin (ROE, "+200" = +200% on the margin posted),
 * which is exactly what LoggedTrade.pnlPercent stores.
 *
 * Previously this blended incompatible units into the same avgWin/avgLoss/EV
 * prompt injection: leveraged ROE (pnlPercent), dollar return on investment
 * (pnlAmount/investmentAmount — coincidentally also ROE-ish only when the
 * investment IS the margin), RAW unleveraged price percent from the level
 * estimate, plus fabricated +2/−1 "defaults" that the model read as measured
 * history. Now: real numbers in one unit only; a trade with no computable
 * PnL returns null and is EXCLUDED from the averages (its WIN/LOSS still
 * counts toward win rate).
 */
const calculatePnlPercent = (trade: LoggedTrade): number | null => {
    // Prefer the autopilot-verified leveraged percent when available — it was
    // computed from the actual resolution price (TP/SL hit), so level-based
    // re-estimation below would skew the backtest stats.
    if (typeof trade.pnlPercent === 'number' && isFinite(trade.pnlPercent)) {
        return trade.pnlPercent;
    }

    if (trade.pnlAmount && trade.investmentAmount && trade.investmentAmount > 0) {
        return (trade.pnlAmount / trade.investmentAmount) * 100;
    }

    // Level-based estimate, expressed in the SAME ROE unit: the raw price
    // move scaled by the leverage the trade actually used
    // (ROE% ≈ price move % × leverage).
    const leverage = Number.isFinite(trade.leverage) && (trade.leverage ?? 0) > 0
        ? (trade.leverage as number)
        : 1;
    const analysis = trade.analysis;
    if (!analysis) return null;

    const entry = parsePrice(analysis.entryPoints?.[0]?.price || '') || 0;
    const sl = parsePrice(analysis.stopLoss || '') || 0;
    const tp = parsePrice(analysis.takeProfit?.[0]?.price || '') || 0;

    if (entry > 0) {
        const dirSign = analysis.direction === 'Long' ? 1 : -1;
        if (trade.outcome === 'WIN' && tp > 0) {
            return ((tp - entry) / entry) * 100 * dirSign * leverage;
        } else if (trade.outcome === 'LOSS' && sl > 0) {
            return ((sl - entry) / entry) * 100 * dirSign * leverage;
        }
    }

    // No fabricated ±2/−1 fallback: an unmeasurable trade contributes nothing
    // rather than a plausible-looking lie.
    return null;
};

// =============================================================================
// MAIN FUNCTIONS
// =============================================================================

/**
 * Find and analyze similar historical trades.
 *
 * options.asOfMs — point-in-time cutoff (epoch ms) for simulated/older runs:
 * only trades LOGGED by it enter the sample. Caveat kept honest: the outcome
 * of a logged trade was written when it settled (no settle timestamp is
 * stored), so a trade logged just before the cutoff may carry an outcome
 * confirmed after it — keep a healthy margin between asOf and the simulated
 * moment. Omitted ⇒ live behavior, unchanged.
 */
export const backtestSimilarSetups = (
    currentAnalysis: TradeAnalysis,
    tradeLog: LoggedTrade[],
    currentRegime?: MarketRegime,
    options?: { asOfMs?: number }
): LiveBacktestResult => {
    const asOfMs = options?.asOfMs;
    // Filter to completed trades (and, under a cutoff, trades logged by it)
    const completedTrades = tradeLog.filter(t =>
        (t.outcome === 'WIN' || t.outcome === 'LOSS')
        && (asOfMs === undefined || (Date.parse(t.timestamp) <= asOfMs))
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

    // Convert to BacktestMatch — computing the single-unit PnL once per
    // trade. `null` means "no real PnL evidence"; the trade still counts for
    // win rate but is excluded from avgWin/avgLoss/EV (no fabricated numbers).
    const withPnl = matchingTrades.map(({ trade, similarity }) => ({
        trade,
        similarity,
        pnl: calculatePnlPercent(trade)
    }));
    const matches: BacktestMatch[] = withPnl.map(({ trade, pnl }) => ({
        tradeId: trade.id,
        coin: trade.analysis?.coinName || 'Unknown',
        direction: trade.analysis?.direction || 'Unknown',
        pattern: trade.analysis?.detectedPatternFamily || trade.analysis?.marketConditions?.pattern || 'Unknown',
        regime: extractRegime(trade),
        outcome: trade.outcome as 'WIN' | 'LOSS',
        // null = genuinely unmeasured, NOT a fabricated 0 — UI/journal
        // renderers must treat null as "magnitude unmeasured". Averages
        // below already filter nulls via `withPnl`.
        pnlPercent: pnl,
        timestamp: trade.timestamp,
        confidence: trade.analysis?.confidence || 'Unknown'
    }));

    // Calculate statistics
    const totalMatches = matches.length;
    const wins = matches.filter(m => m.outcome === 'WIN');

    const winRate = totalMatches > 0 ? (wins.length / totalMatches) * 100 : 0;
    const winPnls = withPnl.filter(x => x.trade.outcome === 'WIN' && x.pnl !== null).map(x => x.pnl as number);
    const lossPnls = withPnl.filter(x => x.trade.outcome === 'LOSS' && x.pnl !== null).map(x => x.pnl as number);
    const avgWinPercent = winPnls.length > 0
        ? winPnls.reduce((sum, p) => sum + p, 0) / winPnls.length
        : 0;
    const avgLossPercent = lossPnls.length > 0
        ? Math.abs(lossPnls.reduce((sum, p) => sum + p, 0) / lossPnls.length)
        : 0;
    // How many matches had NO real PnL evidence — drives an honest warning.
    const missingPnlCount = withPnl.filter(x => x.pnl === null).length;

    // Expected Value
    const expectedValue = calculateExpectedValue(winRate / 100, avgWinPercent, avgLossPercent);

    // Regime breakdown — built from the PnL-carrying rows so avgPnl only
    // averages REAL numbers (placeholder zeros never pollute it).
    const regimeRows = withPnl.map(x => ({
        regime: extractRegime(x.trade),
        outcome: x.trade.outcome as 'WIN' | 'LOSS',
        pnl: x.pnl
    }));
    const regimes = [...new Set(regimeRows.map(r => r.regime))];
    const regimeBreakdown: RegimeBreakdown[] = regimes.map(regime => {
        const regimeTrades = regimeRows.filter(r => r.regime === regime);
        const regimeWins = regimeTrades.filter(r => r.outcome === 'WIN');
        const regimePnls = regimeTrades.filter(r => r.pnl !== null).map(r => r.pnl as number);
        return {
            regime,
            winRate: regimeTrades.length > 0 ? (regimeWins.length / regimeTrades.length) * 100 : 0,
            count: regimeTrades.length,
            avgPnl: regimePnls.length > 0 ? regimePnls.reduce((sum, p) => sum + p, 0) / regimePnls.length : 0
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

    // Current regime stats — normalize the raw hybrid regime ('strong_trend_up',
    // 'volatile_chop'…) to the breakdown keys ('trending', 'volatile'…); the
    // old substring compare never matched and the context was silently absent.
    const currentRegimeStats = currentRegime
        ? regimeBreakdown.find(r => r.regime === normalizeRegime(currentRegime))
        : undefined;

    // === SESSION BREAKDOWN ===
    const allSessions: TradingSession[] = ['Asian', 'London', 'Overlap', 'New York'];
    const sessionBreakdown: SessionBreakdown[] = allSessions.map(session => {
        const sessionTrades = withPnl.filter(x => getSessionFromTimestamp(x.trade.timestamp) === session);
        const sessionWins = sessionTrades.filter(x => x.trade.outcome === 'WIN');
        const sessionPnls = sessionTrades.filter(x => x.pnl !== null).map(x => x.pnl as number);
        return {
            session,
            winRate: sessionTrades.length > 0 ? (sessionWins.length / sessionTrades.length) * 100 : 0,
            count: sessionTrades.length,
            avgPnl: sessionPnls.length > 0
                ? sessionPnls.reduce((sum, p) => sum + p, 0) / sessionPnls.length
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
        warning = ` Insufficient historical data (${totalMatches} matches). Results may not be statistically significant.`;
    } else if (winPnls.length + lossPnls.length === 0) {
        warning = ` No recorded PnL magnitudes for the matched trades — win rate is real but avg win/loss/EV are not measurable.`;
    } else if (missingPnlCount > 0 && missingPnlCount >= totalMatches / 2) {
        warning = ` PnL magnitudes missing for ${missingPnlCount}/${totalMatches} matches — avg win/loss/EV are computed from the measurable subset only.`;
    } else if (expectedValue < 0) {
        warning = ` NEGATIVE EXPECTED VALUE (${expectedValue.toFixed(2)}%). This setup type has historically lost money.`;
    } else if (winRate < 40) {
        warning = ` Low historical win rate (${winRate.toFixed(1)}%). Consider reducing position size.`;
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
 **HISTORICAL BACKTEST:**
Insufficient historical data (${result.totalMatches} similar trades found).
Unable to provide statistical validation.
`;
    }

    const evSign = result.expectedValue >= 0 ? '+' : '';
    let injection = `
═══════════════════════════════════════════════════════════════
 **HISTORICAL BACKTEST: SIMILAR SETUPS FOUND**
═══════════════════════════════════════════════════════════════

**Matched Trades:** ${result.totalMatches} historical trades

 **PERFORMANCE SUMMARY:**
- Win Rate: ${result.winRate.toFixed(1)}%
- Avg Win: ${result.avgWinPercent.toFixed(2)}%
- Avg Loss: -${result.avgLossPercent.toFixed(2)}%
- **Expected Value: ${evSign}${result.expectedValue.toFixed(2)}% per trade**
`;

    // Regime breakdown
    if (result.regimeBreakdown.length > 0) {
        injection += `
 **REGIME BREAKDOWN:**
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

    // Best/worst outcome — only from matches with REAL, non-zero PnL
    // evidence (nulls are unmeasured and must never read as a ±0% outcome).
    if (result.matchedTrades.length > 0) {
        const measurable = result.matchedTrades.filter(
            (m): m is BacktestMatch & { pnlPercent: number } => m.pnlPercent !== null
        );
        const best = measurable
            .filter(t => t.outcome === 'WIN' && t.pnlPercent > 0)
            .sort((a, b) => b.pnlPercent - a.pnlPercent)[0];
        const worst = measurable
            .filter(t => t.outcome === 'LOSS' && t.pnlPercent < 0)
            .sort((a, b) => a.pnlPercent - b.pnlPercent)[0];

        if (best) {
            injection += ` Best Outcome: +${best.pnlPercent.toFixed(1)}% (${best.coin})\n`;
        }
        if (worst) {
            injection += ` Worst Outcome: ${worst.pnlPercent.toFixed(1)}% (${worst.coin})\n`;
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
    const evEmoji = result.expectedValue >= 0 ? '' : '';

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
