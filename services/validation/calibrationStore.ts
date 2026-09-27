/**
 * calibrationStore — the calibration STATE layer.
 *
 * Split out of the former 1,614-line `ConfidenceCalibrationService.ts`, which was
 * three services wearing one filename. Every function body below is byte-identical
 * to the file it came from; only the module boundary moved.
 *
 * Owns the read/write surface of the calibration record: bucket updates,
 * dimension slices, and the summaries derived from them. This is the BOTTOM of
 * the one-way dependency chain
 *
 *     calibrationPrompts → calibrationPolicy → calibrationStore
 *
 * so nothing in this file may import a higher layer.
 *
 * WHY `detectTradingSession` lives here and not in the policy layer: the write
 * path (`updateGranularCalibration`) calls it to bucket an entry by session, so
 * the policy placement would have forced a store → policy back-edge and broken
 * the one-way rule. It reads no calibration state of its own; it is the
 * DST-aware clock the session buckets are built from.
 */

import {
    ConfidenceCalibration,
    ConfidenceCalibrationStats,
    TradeOutcome,
    CalibrationEntry,
    GranularCalibrationEntry,
    GranularCalibration,
    AIProvider
} from '../../types';
import {
    MIN_TRADES_FOR_CALIBRATION,
    DECAY_FACTOR,
    MAX_TRADE_AGE_DAYS
} from '../../constants/calibrationConstants';
import { getEffectiveSessions } from '../infrastructure/SessionService';

export type ConfidenceLevel = 'High' | 'Medium' | 'Low' | 'Avoid';

/**
 * Initialize empty calibration object
 */
export const initializeCalibration = (): ConfidenceCalibration => ({
    high: { wins: 0, losses: 0, total: 0 },
    medium: { wins: 0, losses: 0, total: 0 },
    low: { wins: 0, losses: 0, total: 0 },
    avoid: { wins: 0, losses: 0, total: 0 },
    lastUpdated: new Date().toISOString()
});

/**
 * Update calibration stats when a trade is logged
 * Now also stores individual timestamped entries for time-decay calculations
 * @param current - Current calibration data
 * @param confidence - AI's predicted confidence level
 * @param outcome - Actual trade outcome (WIN/LOSS)
 * @returns Updated calibration data
 */
export const updateCalibration = (
    current: ConfidenceCalibration | undefined,
    confidence: ConfidenceLevel,
    outcome: TradeOutcome
): ConfidenceCalibration => {
    // Initialize if not present
    const calibration = current ? { ...current } : initializeCalibration();

    // Only track wins and losses (not PENDING, SKIPPED, ENTRY_NOT_HIT)
    if (outcome !== TradeOutcome.WIN && outcome !== TradeOutcome.LOSS) {
        return calibration;
    }

    // Get the key for the confidence level
    const key = confidence.toLowerCase() as 'high' | 'medium' | 'low' | 'avoid';

    // Create new timestamped entry for time-decay calculations
    const newEntry: CalibrationEntry = {
        timestamp: new Date().toISOString(),
        confidence,
        outcome: outcome === TradeOutcome.WIN ? 'WIN' : 'LOSS'
    };

    // Append to entries array (create if doesn't exist)
    const entries = [...(calibration.entries || []), newEntry];

    // Prune old entries beyond MAX_TRADE_AGE_DAYS to keep storage manageable
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - MAX_TRADE_AGE_DAYS);
    const prunedEntries = entries.filter(e => new Date(e.timestamp) >= cutoffDate);

    // Rebuild the aggregate from the PRUNED entries — never increment it.
    //
    // The buckets used to be incremented and never decremented, so they were
    // an all-time tally while `entries` aged out at 90 days — and every real
    // consumer read the buckets. Executed: 30 High wins from 120 days ago plus
    // 10 recent High losses reported "High: 75% win rate, n=40, STRONG" in the
    // prompt injected into EVERY analysis, while the correctly-computed decayed
    // reader said 0%. The drift verdict, the confidence penalty and the Health
    // tab all inherited the stale number, and nothing called the correct reader
    // at all. One population now, derived from the surviving entries.
    const stats = { wins: 0, losses: 0, total: 0 };
    for (const e of prunedEntries) {
        if (e.confidence?.toLowerCase() !== key) continue;
        stats.total += 1;
        if (e.outcome === 'WIN') stats.wins += 1;
        else stats.losses += 1;
    }

    return {
        ...calibration,
        [key]: stats,
        entries: prunedEntries,
        lastUpdated: new Date().toISOString()
    };
};

/**
 * Calculate calibrated win rate for a confidence level
 * @param calibration - Calibration data
 * @param confidence - Confidence level to check
 * @returns Win rate as percentage (0-100), or null if insufficient data
 */
export const getCalibratedWinRate = (
    calibration: ConfidenceCalibration | undefined,
    confidence: ConfidenceLevel
): number | null => {
    if (!calibration) return null;

    const key = confidence.toLowerCase() as 'high' | 'medium' | 'low' | 'avoid';
    const stats = calibration[key];

    // Require minimum trades for statistical significance (increased from 3 to 10)
    if (stats.total < MIN_TRADES_FOR_CALIBRATION) return null;

    return Math.round((stats.wins / stats.total) * 100);
};

/**
 * Calculate calibrated win rate with time decay weighting.
 * Recent trades are weighted more heavily than older trades.
 * Uses exponential decay: weight = DECAY_FACTOR ^ days_ago
 * 
 * @param calibration - Calibration data with entries
 * @param confidence - Confidence level to check
 * @returns Win rate as percentage (0-100), or null if insufficient data
 */
export const getCalibratedWinRateWithDecay = (
    calibration: ConfidenceCalibration | undefined,
    confidence: ConfidenceLevel
): number | null => {
    if (!calibration || !calibration.entries || calibration.entries.length === 0) {
        // Fall back to simple win rate if no entries available
        return getCalibratedWinRate(calibration, confidence);
    }

    // Filter entries for this confidence level
    const relevantEntries = calibration.entries.filter(
        e => e.confidence === confidence
    );

    // Require minimum entries for statistical significance
    if (relevantEntries.length < MIN_TRADES_FOR_CALIBRATION) {
        return getCalibratedWinRate(calibration, confidence);
    }

    const now = new Date();
    let weightedWins = 0;
    let totalWeight = 0;

    for (const entry of relevantEntries) {
        const entryDate = new Date(entry.timestamp);
        // Clamp at 0: a future-dated entry (clock skew) would otherwise get a
        // negative daysAgo → DECAY_FACTOR^-n > 1 weight, inflating its influence.
        const daysAgo = Math.max(0, Math.floor((now.getTime() - entryDate.getTime()) / (1000 * 60 * 60 * 24)));

        // Calculate weight using exponential decay
        const weight = Math.pow(DECAY_FACTOR, daysAgo);

        totalWeight += weight;
        if (entry.outcome === 'WIN') {
            weightedWins += weight;
        }
    }

    if (totalWeight === 0) return null;

    return Math.round((weightedWins / totalWeight) * 100);
};

/**
 * Get sample size for a confidence level
 */
export const getSampleSize = (
    calibration: ConfidenceCalibration | undefined,
    confidence: ConfidenceLevel
): number => {
    if (!calibration) return 0;
    const key = confidence.toLowerCase() as 'high' | 'medium' | 'low' | 'avoid';
    return calibration[key].total;
};

/**
 * Get full calibration stats for display
 */
export const getCalibrationSummary = (
    calibration: ConfidenceCalibration | undefined
): {
    high: { winRate: number | null; total: number };
    medium: { winRate: number | null; total: number };
    low: { winRate: number | null; total: number };
    avoid: { winRate: number | null; total: number };
    totalTrades: number;
} => {
    if (!calibration) {
        return {
            high: { winRate: null, total: 0 },
            medium: { winRate: null, total: 0 },
            low: { winRate: null, total: 0 },
            avoid: { winRate: null, total: 0 },
            totalTrades: 0
        };
    }

    return {
        high: {
            winRate: getCalibratedWinRate(calibration, 'High'),
            total: calibration.high.total
        },
        medium: {
            winRate: getCalibratedWinRate(calibration, 'Medium'),
            total: calibration.medium.total
        },
        low: {
            winRate: getCalibratedWinRate(calibration, 'Low'),
            total: calibration.low.total
        },
        avoid: {
            winRate: getCalibratedWinRate(calibration, 'Avoid'),
            total: calibration.avoid.total
        },
        totalTrades: calibration.high.total + calibration.medium.total + calibration.low.total + calibration.avoid.total
    };
};

// =============================================================================
// GRANULAR CALIBRATION - Per-Coin, Per-Pattern, Per-Timeframe, Per-Regime
// =============================================================================

/**
 * Initialize empty granular calibration structure
 */
export const initializeGranularCalibration = (): GranularCalibration => ({
    byCoin: {},
    byPattern: {},
    byTimeframe: {},
    byRegime: {},
    byProvider: {},
    bySession: {},
    byDayOfWeek: {}
});

/**
 * Detect trading session — DST-aware, aligned with the SAME effective
 * boundaries SessionService feeds the model (London opens 07 UTC in summer /
 * 08 in winter, NY 13/14, overlap = NY open until London close). Previously
 * a fixed UTC table that silently mismatched the packet's session labels
 * for half the year. Buckets: london = open→NY open, overlap = NY open→
 * London close, new_york = London close→NY close, asian = everything else.
 */
export const detectTradingSession = (timestamp?: string): 'asian' | 'london' | 'new_york' | 'overlap' => {
    const date = timestamp ? new Date(timestamp) : new Date();
    if (Number.isNaN(date.getTime())) return 'asian';
    const hour = date.getUTCHours();
    const s = getEffectiveSessions(date);
    if (hour >= s.new_york.start && hour < s.london.end) return 'overlap';
    if (hour >= s.london.start && hour < s.new_york.start) return 'london';
    if (hour >= s.london.end && hour < s.new_york.end) return 'new_york';
    return 'asian';
};

/**
 * Update granular calibration with a new trade entry
 * Tracks accuracy across multiple dimensions: coin, pattern, timeframe, regime, provider, day of week
 */
export const updateGranularCalibration = (
    current: ConfidenceCalibration | undefined,
    entry: GranularCalibrationEntry
): ConfidenceCalibration => {
    // First update base calibration
    const base = updateCalibration(current, entry.confidence,
        entry.outcome === 'WIN' ? TradeOutcome.WIN : TradeOutcome.LOSS);

    // Initialize granular structure if not present
    const granular: GranularCalibration = base.granular ? { ...base.granular } : initializeGranularCalibration();
    // Append + PRUNE with the same horizon the base entries use (see
    // updateCalibration). granularEntries used to grow without bound while
    // `entries` capped at MAX_TRADE_AGE_DAYS — every settled write copied
    // the whole array (O(n) allocation) and detectDangerousCombinations
    // re-scanned it O(n) per call. Rows whose timestamp is missing or
    // unparseable are DROPPED, matching the base prune: an unknown-age row
    // can never satisfy ">= cutoff", so KEEPING it re-opened the very
    // unbounded leak this prune closes — junk rows rode every settled
    // write forever.
    const granularCutoffMs = Date.now() - MAX_TRADE_AGE_DAYS * 86_400_000;
    const granularEntries = [...(base.granularEntries || []), entry]
        .filter(e => {
            const t = Date.parse(e.timestamp ?? '');
            return Number.isFinite(t) && t >= granularCutoffMs;
        });

    // Rebuild every dimension aggregate from the PRUNED entries — never
    // increment. The increments made byCoin/byPattern/… an all-time tally
    // while granularEntries aged out at MAX_TRADE_AGE_DAYS, so the same store
    // answered "90-day reality" (base buckets, rebuilt in updateCalibration)
    // or "all-time history" (these getters) depending on which one the caller
    // picked — a coin that was poison a year ago kept subtracting its penalty
    // forever. One population, one horizon, one truth.
    const rebuildDimension = (
        keyOf: (e: GranularCalibrationEntry) => string | undefined
    ): { [key: string]: ConfidenceCalibrationStats } => {
        const out: { [key: string]: ConfidenceCalibrationStats } = {};
        for (const e of granularEntries) {
            const k = keyOf(e);
            if (!k) continue;
            const existing = out[k] || { wins: 0, losses: 0, total: 0 };
            const win = e.outcome === 'WIN';
            out[k] = {
                wins: existing.wins + (win ? 1 : 0),
                losses: existing.losses + (win ? 0 : 1),
                total: existing.total + 1
            };
        }
        return out;
    };

    // Update each dimension - use fallback empty objects for old data that may not have all properties
    granular.byCoin = rebuildDimension(e => e.coin);
    granular.byPattern = rebuildDimension(e => e.pattern);
    granular.byTimeframe = rebuildDimension(e => e.timeframe);
    granular.byRegime = rebuildDimension(e => e.regime);

    // Update provider dimension
    granular.byProvider = rebuildDimension(e => e.provider?.toString());

    // Update session dimension (auto-detect if not provided)
    granular.bySession = rebuildDimension(e => e.session || detectTradingSession(e.timestamp));

    // Update Day of Week dimension
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    granular.byDayOfWeek = rebuildDimension(e => {
        if (!e.timestamp) return undefined;
        const d = new Date(e.timestamp);
        return Number.isNaN(d.getTime()) ? undefined : days[d.getUTCDay()];
    });

    return {
        ...base,
        granular,
        granularEntries
    };
};

/**
 * Get win rate for a specific coin
 */
export const getWinRateByCoin = (
    calibration: ConfidenceCalibration | undefined,
    coin: string
): number | null => {
    if (!calibration?.granular?.byCoin) return null;

    const stats = calibration.granular.byCoin[coin];
    if (!stats || stats.total < MIN_TRADES_FOR_CALIBRATION) return null;

    return Math.round((stats.wins / stats.total) * 100);
};

/**
 * Get win rate for a specific pattern (e.g., "Family C", "Bull Flag")
 */
export const getWinRateByPattern = (
    calibration: ConfidenceCalibration | undefined,
    pattern: string
): number | null => {
    if (!calibration?.granular?.byPattern) return null;

    const stats = calibration.granular.byPattern[pattern];
    if (!stats || stats.total < MIN_TRADES_FOR_CALIBRATION) return null;

    return Math.round((stats.wins / stats.total) * 100);
};

/**
 * Get win rate for a specific timeframe
 */
export const getWinRateByTimeframe = (
    calibration: ConfidenceCalibration | undefined,
    timeframe: string
): number | null => {
    if (!calibration?.granular?.byTimeframe) return null;

    const stats = calibration.granular.byTimeframe[timeframe];
    if (!stats || stats.total < MIN_TRADES_FOR_CALIBRATION) return null;

    return Math.round((stats.wins / stats.total) * 100);
};

/**
 * Get win rate for a specific market regime
 */
export const getWinRateByRegime = (
    calibration: ConfidenceCalibration | undefined,
    regime: 'trending' | 'ranging' | 'volatile'
): number | null => {
    if (!calibration?.granular?.byRegime) return null;

    const stats = calibration.granular.byRegime[regime];
    if (!stats || stats.total < MIN_TRADES_FOR_CALIBRATION) return null;

    return Math.round((stats.wins / stats.total) * 100);
};

/**
 * Get win rate for a specific AI provider
 */
export const getWinRateByProvider = (
    calibration: ConfidenceCalibration | undefined,
    provider: AIProvider | string
): number | null => {
    if (!calibration?.granular?.byProvider) return null;

    const providerKey = typeof provider === 'string' ? provider : String(provider);
    const stats = calibration.granular.byProvider[providerKey];
    if (!stats || stats.total < MIN_TRADES_FOR_CALIBRATION) return null;

    return Math.round((stats.wins / stats.total) * 100);
};

/**
 * Get win rate for a specific day of the week
 */
export const getWinRateByDay = (
    calibration: ConfidenceCalibration | undefined,
    day: string
): number | null => {
    if (!calibration?.granular?.byDayOfWeek) return null;

    const stats = calibration.granular.byDayOfWeek[day];
    if (!stats || stats.total < MIN_TRADES_FOR_CALIBRATION) return null;

    return Math.round((stats.wins / stats.total) * 100);
};

/**
 * Get all session accuracies for comparison
 */
export const getSessionAccuracyComparison = (
    calibration: ConfidenceCalibration | undefined
): { session: string; winRate: number | null; total: number }[] => {
    if (!calibration?.granular?.bySession) return [];

    const sessionOrder = ['asian', 'london', 'overlap', 'new_york'];
    const sessionLabels: Record<string, string> = {
        asian: ' Asian',
        london: ' London (pre-overlap)',
        overlap: ' London/NY Overlap',
        new_york: ' New York (post-London)'
    };

    // Safely access bySession with defensive checks for old/incomplete data
    const bySession = calibration.granular?.bySession || {};

    return sessionOrder
        .filter(session => bySession[session])
        .map(session => ({
            session: sessionLabels[session] || session,
            winRate: bySession[session]?.total >= MIN_TRADES_FOR_CALIBRATION
                ? Math.round((bySession[session].wins / bySession[session].total) * 100)
                : null,
            total: bySession[session]?.total || 0
        }));
};

/**
 * Get all provider accuracies for comparison
 */
export const getProviderAccuracyComparison = (
    calibration: ConfidenceCalibration | undefined
): { provider: string; winRate: number | null; total: number }[] => {
    if (!calibration?.granular?.byProvider) return [];

    return Object.entries(calibration.granular.byProvider).map(([provider, stats]) => ({
        provider,
        winRate: stats.total >= MIN_TRADES_FOR_CALIBRATION
            ? Math.round((stats.wins / stats.total) * 100)
            : null,
        total: stats.total
    })).sort((a, b) => (b.winRate ?? 0) - (a.winRate ?? 0));
};

