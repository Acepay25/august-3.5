/**
 * AutoCaptureService
 * Automatically captures current market data when logging a trade outcome.
 * Uses HybridIntelligenceService to fetch the same comprehensive data.
 * 
 * ENHANCED: Now includes historical TP/SL verification with full indicator snapshots
 */

import { TradeAnalysis } from '../types';
import { fetchHybridData, generateHybridPromptInjection, HybridDataPacket } from './HybridIntelligenceService';
import { fetchFuturesOHLCVFromTime, Kline } from './MarketDataService';
import {
    calculateIndicators,
    calculateVWAP,
    calculateIchimoku,
    calculateMomentum,
    calculateRegime,
    TechnicalIndicators,
    VWAPData,
    IchimokuData,
    MomentumIndicators,
    RegimeAnalysis
} from './TechnicalAnalysisService';

/**
 * Snapshot of all indicators at a specific candle
 * Matches Hybrid Intelligence data depth
 */
export interface HistoricalIndicatorSnapshot {
    candleTime: string;           // Exact ISO timestamp of the candle
    candleIndex: number;          // Index in the klines array
    price: number;                // Close price at this candle
    indicators: TechnicalIndicators;
    vwap: VWAPData;
    ichimoku: IchimokuData;
    momentum: MomentumIndicators;
    regime: RegimeAnalysis;
}

/**
 * Individual TP hit information
 */
export interface TPHitInfo {
    level: 'TP1' | 'TP2' | 'TP3';
    price: number;
    candleIndex: number;
    candleTime: string;
    timeAfterAnalysis: string;  // Human readable (e.g., "2h 15m")
}

/**
 * Result of historical outcome verification
 */
export interface HistoricalOutcomeResult {
    verified: boolean;
    outcome: 'TP_HIT' | 'SL_HIT' | 'STILL_OPEN' | 'ENTRY_NOT_TRIGGERED' | 'INSUFFICIENT_DATA';
    hitTarget?: 'TP1' | 'TP2' | 'TP3' | 'SL';
    hitCandleTime?: string;       // Exact timestamp of outcome candle (final/SL)
    priceAtHit?: number;
    candlesFromAnalysis?: number;
    timeToOutcome?: string;       // Human readable (e.g., "2h 15m")
    // Track all TPs that were hit
    tpHits?: TPHitInfo[];         // List of all TP levels hit (in order hit)
    slHit?: {
        price: number;
        candleIndex: number;
        candleTime: string;
        timeAfterAnalysis: string;
    };
    // Note: With 150% extended SL zone, TPs hit within the zone are recorded as real hits
    analysisSnapshot?: HistoricalIndicatorSnapshot;
    outcomeSnapshot?: HistoricalIndicatorSnapshot;
    verificationDetails: string;
}

/**
 * Result of auto-capture operation
 */
export interface AutoCaptureResult {
    success: boolean;
    data?: HybridDataPacket;
    promptInjection?: string;
    comparisonBlock?: string;
    historicalOutcome?: HistoricalOutcomeResult;
    error?: string;
}

/**
 * Parse price string to number (handles ranges like "3050 - 3060")
 */
const parsePrice = (priceStr: string): number => {
    if (!priceStr) return 0;
    const cleaned = priceStr.replace(/[^0-9.\-\s]/g, '');
    if (cleaned.includes('-') && cleaned.split('-').length === 2) {
        const parts = cleaned.split('-').map(p => parseFloat(p.trim()));
        if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
            return (parts[0] + parts[1]) / 2;
        }
    }
    const num = parseFloat(cleaned.replace(/\s+/g, ''));
    return isNaN(num) ? 0 : num;
};

/**
 * Format duration in human-readable form
 */
const formatDuration = (ms: number): string => {
    const minutes = Math.floor(ms / 60000);
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;

    if (hours > 0) {
        return `${hours}h ${remainingMinutes}m`;
    }
    return `${minutes}m`;
};

/**
 * Convert timeframe string to milliseconds
 */
const getIntervalMs = (interval: string): number => {
    const unit = interval.slice(-1);
    const value = parseInt(interval.slice(0, -1)) || 1;
    switch (unit) {
        case 'm': return value * 60 * 1000;
        case 'h': return value * 60 * 60 * 1000;
        case 'd': return value * 24 * 60 * 60 * 1000;
        default: return 60 * 60 * 1000;
    }
};

/**
 * Align timestamp to the start of a candle interval
 */
const alignToIntervalStart = (timestamp: number, intervalMs: number): number => {
    return timestamp - (timestamp % intervalMs);
};

/**
 * Calculate indicator snapshot at a specific candle index
 * Uses all candles up to and including the specified index
 */
const calculateSnapshotAtCandle = (klines: Kline[], candleIndex: number): HistoricalIndicatorSnapshot | null => {
    // Need at least 50 candles for reliable indicator calculation
    if (candleIndex < 50 || candleIndex >= klines.length) {
        return null;
    }

    // Use candles up to and including the target candle
    const klinesUpToCandle = klines.slice(0, candleIndex + 1);
    const targetCandle = klines[candleIndex];

    try {
        const indicators = calculateIndicators(klinesUpToCandle);
        const vwap = calculateVWAP(klinesUpToCandle);
        const ichimoku = calculateIchimoku(klinesUpToCandle);
        const momentum = calculateMomentum(klinesUpToCandle);
        const regime = calculateRegime(klinesUpToCandle);

        return {
            candleTime: new Date(targetCandle.time).toISOString(),
            candleIndex,
            price: targetCandle.close,
            indicators,
            vwap,
            ichimoku,
            momentum,
            regime
        };
    } catch (error) {
        console.error(`[AutoCapture] Failed to calculate snapshot at candle ${candleIndex}:`, error);
        return null;
    }
};

/**
 * Verify historical outcome by checking candles from analysis time forward
 * Identifies exact candle where TP or SL was hit
 * 
 * @param selectedEntryIndices - Optional array of entry indices to check (e.g., [0], [1], or [0,1] for both).
 *                               If not provided, checks ALL entries and triggers if ANY is hit.
 */
export const verifyHistoricalOutcome = async (
    analysis: TradeAnalysis,
    symbol: string,
    analysisTimestamp: string,
    selectedEntryIndices?: number[]
): Promise<HistoricalOutcomeResult> => {
    console.log(`[AutoCapture] Verifying historical outcome for ${symbol} from ${analysisTimestamp}`);

    const analysisTime = new Date(analysisTimestamp).getTime();

    try {
        // ============ 3-TIER HYBRID FETCH ============
        // Tier 1: 1m candles (500) = ~8 hours of precision for recent trades
        // Tier 2: 15m candles (250) = ~2.6 days of medium coverage  
        // Tier 3: 1h candles (250) = ~10 days of extended history
        // Total coverage: ~13 days with decreasing granularity

        // Align start time to 1m candle boundary
        const alignedStartTime = alignToIntervalStart(analysisTime, getIntervalMs('1m'));

        console.log(`[AutoCapture] Hybrid fetch from ${new Date(alignedStartTime).toISOString()}`);

        // Tier 1: 1-minute candles (precision) - from Futures API
        const klines1m = await fetchFuturesOHLCVFromTime(symbol, '1m', alignedStartTime);
        const limited1m = klines1m.slice(0, 500);

        // Tier 2: 15-minute candles (medium) - continue where 1m ends
        const tier2StartTime = limited1m.length > 0
            ? limited1m[limited1m.length - 1].time + getIntervalMs('1m')
            : alignedStartTime + 500 * getIntervalMs('1m');
        const klines15m = await fetchFuturesOHLCVFromTime(symbol, '15m', tier2StartTime);
        const limited15m = klines15m.slice(0, 250);

        // Tier 3: 1-hour candles (extended) - continue where 15m ends
        const tier3StartTime = limited15m.length > 0
            ? limited15m[limited15m.length - 1].time + getIntervalMs('15m')
            : tier2StartTime + 250 * getIntervalMs('15m');
        const klines1h = await fetchFuturesOHLCVFromTime(symbol, '1h', tier3StartTime);
        const limited1h = klines1h.slice(0, 250);

        // Merge all tiers (chronological order) - used for both indicator snapshots and TP/SL detection
        const klines = [...limited1m, ...limited15m, ...limited1h];

        // Track which candle index marks the boundary between timeframes
        const tier1EndIndex = limited1m.length;
        const tier2EndIndex = limited1m.length + limited15m.length;

        console.log(`[AutoCapture] Hybrid data: ${limited1m.length}×1m + ${limited15m.length}×15m + ${limited1h.length}×1h = ${klines.length} total`);
        console.log(`[AutoCapture] TP/SL detection will scan: 1m candles [0-${tier1EndIndex - 1}], then 15m [${tier1EndIndex}-${tier2EndIndex - 1}], then 1h [${tier2EndIndex}-${klines.length - 1}]`);

        if (klines.length < 10) {
            return {
                verified: false,
                outcome: 'INSUFFICIENT_DATA',
                verificationDetails: `Only ${klines.length} candles available since analysis time. Need more data for reliable verification.`
            };
        }

        // Parse trade parameters - support multiple entries
        const allEntryPrices = (analysis.entryPoints || [])
            .map((ep, idx) => ({ price: parsePrice(ep.price || '0'), index: idx }))
            .filter(e => e.price > 0);

        // Filter to selected entries if specified, otherwise use all
        const entriesToCheck = selectedEntryIndices && selectedEntryIndices.length > 0
            ? allEntryPrices.filter(e => selectedEntryIndices.includes(e.index))
            : allEntryPrices;

        const stopLoss = parsePrice(analysis.stopLoss || '0');
        const tp1 = parsePrice(analysis.takeProfit?.[0]?.price || '0');
        const tp2 = parsePrice(analysis.takeProfit?.[1]?.price || '0');
        const tp3 = parsePrice(analysis.takeProfit?.[2]?.price || '0');
        const isLong = analysis.direction === 'Long';

        if (entriesToCheck.length === 0 || stopLoss === 0) {
            return {
                verified: false,
                outcome: 'INSUFFICIENT_DATA',
                verificationDetails: 'Invalid entry or stop loss price in original analysis'
            };
        }

        // Log which entries we're checking
        console.log(`[AutoCapture] Checking ${entriesToCheck.length} entry point(s): ${entriesToCheck.map(e => `Entry${e.index + 1}=$${e.price.toLocaleString()}`).join(', ')}`);

        // Find analysis candle snapshot (using all candles for indicator calculation)
        const analysisSnapshotIndex = Math.min(50, klines.length - 1);
        const analysisSnapshot = calculateSnapshotAtCandle(klines, analysisSnapshotIndex);

        // Track all TP levels hit and SL
        const tpHits: TPHitInfo[] = [];
        let slHit: HistoricalOutcomeResult['slHit'] | undefined;
        let tp1Hit = false, tp2Hit = false, tp3Hit = false;
        let finalOutcomeIndex: number | null = null;
        let highestTpHit: 'TP1' | 'TP2' | 'TP3' | undefined;
        let slTouched = false; // Track if initial SL was touched
        let extendedSlExceeded = false; // Track if price exceeded 150% SL zone

        // Calculate 150% extended SL zone using first entry as reference
        // (Will recalculate with actual triggered entry after detection if different)
        // For Long: Original SL distance = entry - SL, Extended SL = entry - (1.5 * distance) = SL - 0.5 * distance
        // For Short: Original SL distance = SL - entry, Extended SL = entry + (1.5 * distance) = SL + 0.5 * distance
        const firstEntryPrice = entriesToCheck[0].price;
        const slDistance = Math.abs(firstEntryPrice - stopLoss);
        let extendedSlPrice = isLong
            ? stopLoss - (slDistance * 0.5)  // 150% of SL distance below entry for Long
            : stopLoss + (slDistance * 0.5); // 150% of SL distance above entry for Short

        // Helper to determine timeframe of a candle index
        const getTimeframe = (idx: number): string => {
            if (idx < tier1EndIndex) return '1m';
            if (idx < tier2EndIndex) return '15m';
            return '1h';
        };

        // === ENTRY DETECTION PHASE ===
        // Scan candles to find when price reached ANY of the selected entry levels
        // For Long: Entry hits when price goes LOW enough to reach entry (buying the dip)
        // For Short: Entry hits when price goes HIGH enough to reach entry (selling the rally)
        let entryTriggeredAtIndex = -1;
        let entryTriggerTime: string | undefined;
        let triggeredEntryPrice: number | undefined;
        let triggeredEntryIndex: number | undefined;

        for (let i = 0; i < klines.length && entryTriggeredAtIndex === -1; i++) {
            const candle = klines[i];

            // Check ALL selected entries - trigger on first one hit
            for (const entry of entriesToCheck) {
                if (isLong) {
                    // Long entry: price needs to come DOWN to our entry level (or touch it)
                    if (candle.low <= entry.price) {
                        entryTriggeredAtIndex = i;
                        entryTriggerTime = new Date(candle.time).toISOString();
                        triggeredEntryPrice = entry.price;
                        triggeredEntryIndex = entry.index;
                        console.log(`[AutoCapture] ✅ Entry ${entry.index + 1} triggered at candle #${i} (${getTimeframe(i)}) - Low: ${candle.low} <= Entry: ${entry.price}`);
                        break;
                    }
                } else {
                    // Short entry: price needs to go UP to our entry level (or touch it)
                    if (candle.high >= entry.price) {
                        entryTriggeredAtIndex = i;
                        entryTriggerTime = new Date(candle.time).toISOString();
                        triggeredEntryPrice = entry.price;
                        triggeredEntryIndex = entry.index;
                        console.log(`[AutoCapture] ✅ Entry ${entry.index + 1} triggered at candle #${i} (${getTimeframe(i)}) - High: ${candle.high} >= Entry: ${entry.price}`);
                        break;
                    }
                }
            }
        }

        // Use the triggered entry's price for SL/TP calculations
        const entryPrice = triggeredEntryPrice || entriesToCheck[0].price;

        // If entry hasn't been triggered yet, return early with ENTRY_NOT_TRIGGERED
        if (entryTriggeredAtIndex === -1) {
            const lastCandle = klines[klines.length - 1];
            const currentPrice = lastCandle.close;

            // Show distances to all entries being checked
            const entryDistances = entriesToCheck.map(e => {
                const dist = isLong
                    ? ((currentPrice - e.price) / e.price * 100)
                    : ((e.price - currentPrice) / e.price * 100);
                return `Entry${e.index + 1}: $${e.price.toLocaleString()} (${dist >= 0 ? '+' : ''}${dist.toFixed(2)}%)`;
            }).join(', ');

            console.log(`[AutoCapture] ⏳ No entries triggered - Checking: ${entriesToCheck.length} entries, Current: $${currentPrice.toLocaleString()}`);

            return {
                verified: true,
                outcome: 'ENTRY_NOT_TRIGGERED',
                verificationDetails: `⏳ WAITING FOR ENTRY | ${klines.length} candles scanned (${limited1m.length}×1m + ${limited15m.length}×15m + ${limited1h.length}×1h)\n` +
                    `   Entries checked: ${entryDistances}\n` +
                    `   Current: $${currentPrice.toLocaleString()}\n` +
                    `   Status: None of the ${entriesToCheck.length} entry order(s) have been filled yet`
            };
        }

        // === ENTRY CONFIRMED - START SIMULATION FROM ENTRY CANDLE ===
        const entryTimeAfterAnalysis = formatDuration(klines[entryTriggeredAtIndex].time - analysisTime);
        console.log(`[AutoCapture] Entry triggered at candle #${entryTriggeredAtIndex} (${entryTimeAfterAnalysis} after analysis)`);

        // Iterate through ALL candles in sequence: 1m first (500), then 15m (250), then 1h (250)
        // STARTING FROM ENTRY CANDLE - provides ~8 hours precision, then ~2.6 days, then ~10 days of coverage
        for (let i = entryTriggeredAtIndex; i < klines.length; i++) {
            const candle = klines[i];
            const candleTimeStr = new Date(candle.time).toISOString();
            const timeAfterAnalysis = formatDuration(candle.time - analysisTime);


            if (isLong) {
                // Check if price exceeded 150% extended SL zone - hard stop
                if (candle.low <= extendedSlPrice) {
                    if (!slHit) {
                        slHit = {
                            price: extendedSlPrice,
                            candleIndex: i,
                            candleTime: candleTimeStr,
                            timeAfterAnalysis
                        };
                        finalOutcomeIndex = i;
                    }
                    extendedSlExceeded = true;
                    break; // Loss exceeded 150% threshold - end scan
                }

                // Check if initial SL was touched (but not exceeded 150%)
                if (!slTouched && candle.low <= stopLoss) {
                    slTouched = true;
                    // DEBUG: Log the exact candle that triggered SL detection
                    console.log(`[AutoCapture] 🔴 SL TOUCHED at candle ${i}:`, {
                        candleTime: candleTimeStr,
                        candleOHLC: { open: candle.open, high: candle.high, low: candle.low, close: candle.close },
                        stopLoss: stopLoss,
                        condition: `candle.low (${candle.low}) <= stopLoss (${stopLoss})`,
                        timeAfterAnalysis: timeAfterAnalysis
                    });
                    // Record SL touch for reference, but DON'T break - allow recovery
                    if (!slHit) {
                        slHit = {
                            price: stopLoss,
                            candleIndex: i,
                            candleTime: candleTimeStr,
                            timeAfterAnalysis
                        };
                    }
                }

                // Check TPs - these count as REAL hits even after SL touch (within 150% zone)
                if (!tp1Hit && tp1 > 0 && candle.high >= tp1) {
                    tp1Hit = true;
                    highestTpHit = 'TP1';
                    tpHits.push({
                        level: 'TP1',
                        price: tp1,
                        candleIndex: i,
                        candleTime: candleTimeStr,
                        timeAfterAnalysis
                    });
                }
                if (!tp2Hit && tp2 > 0 && candle.high >= tp2) {
                    tp2Hit = true;
                    highestTpHit = 'TP2';
                    tpHits.push({
                        level: 'TP2',
                        price: tp2,
                        candleIndex: i,
                        candleTime: candleTimeStr,
                        timeAfterAnalysis
                    });
                }
                if (!tp3Hit && tp3 > 0 && candle.high >= tp3) {
                    tp3Hit = true;
                    highestTpHit = 'TP3';
                    tpHits.push({
                        level: 'TP3',
                        price: tp3,
                        candleIndex: i,
                        candleTime: candleTimeStr,
                        timeAfterAnalysis
                    });
                    finalOutcomeIndex = i;
                    break; // All TPs hit
                }
            } else {
                // Short position
                // Check if price exceeded 150% extended SL zone - hard stop
                if (candle.high >= extendedSlPrice) {
                    if (!slHit) {
                        slHit = {
                            price: extendedSlPrice,
                            candleIndex: i,
                            candleTime: candleTimeStr,
                            timeAfterAnalysis
                        };
                        finalOutcomeIndex = i;
                    }
                    extendedSlExceeded = true;
                    break; // Loss exceeded 150% threshold - end scan
                }

                // Check if initial SL was touched (but not exceeded 150%)
                if (!slTouched && candle.high >= stopLoss) {
                    slTouched = true;
                    // Record SL touch for reference, but DON'T break - allow recovery
                    if (!slHit) {
                        slHit = {
                            price: stopLoss,
                            candleIndex: i,
                            candleTime: candleTimeStr,
                            timeAfterAnalysis
                        };
                    }
                }

                // Check TPs - these count as REAL hits even after SL touch (within 150% zone)
                if (!tp1Hit && tp1 > 0 && candle.low <= tp1) {
                    tp1Hit = true;
                    highestTpHit = 'TP1';
                    tpHits.push({
                        level: 'TP1',
                        price: tp1,
                        candleIndex: i,
                        candleTime: candleTimeStr,
                        timeAfterAnalysis
                    });
                }
                if (!tp2Hit && tp2 > 0 && candle.low <= tp2) {
                    tp2Hit = true;
                    highestTpHit = 'TP2';
                    tpHits.push({
                        level: 'TP2',
                        price: tp2,
                        candleIndex: i,
                        candleTime: candleTimeStr,
                        timeAfterAnalysis
                    });
                }
                if (!tp3Hit && tp3 > 0 && candle.low <= tp3) {
                    tp3Hit = true;
                    highestTpHit = 'TP3';
                    tpHits.push({
                        level: 'TP3',
                        price: tp3,
                        candleIndex: i,
                        candleTime: candleTimeStr,
                        timeAfterAnalysis
                    });
                    finalOutcomeIndex = i;
                    break; // All TPs hit
                }
            }
        }

        // Determine outcome - NEW LOGIC: TP wins if hit before 150% exceeded
        let outcome: HistoricalOutcomeResult['outcome'];
        let hitTarget: HistoricalOutcomeResult['hitTarget'];
        let priceAtHit: number | undefined;
        let hitCandleTime: string | undefined;
        let candlesFromAnalysis: number | undefined;
        let timeToOutcome: string | undefined;

        // TPs take priority - if any TP was hit (even after SL touch), it's a WIN
        if (tpHits.length > 0) {
            outcome = 'TP_HIT';
            hitTarget = highestTpHit;
            const lastTp = tpHits[tpHits.length - 1];
            priceAtHit = lastTp.price;
            hitCandleTime = lastTp.candleTime;
            candlesFromAnalysis = lastTp.candleIndex;
            timeToOutcome = lastTp.timeAfterAnalysis;
            // If SL was touched but TP was hit, clear slHit for cleaner output
            if (slTouched) {
                // Keep slHit for reference but outcome is WIN
            }
        } else if (slHit && extendedSlExceeded) {
            // SL was exceeded beyond 150% - definite LOSS and failed extended thesis
            outcome = 'SL_HIT';
            hitTarget = 'SL';
            priceAtHit = slHit.price;
            hitCandleTime = slHit.candleTime;
            candlesFromAnalysis = slHit.candleIndex;
            timeToOutcome = slHit.timeAfterAnalysis;
        } else if (slTouched && !extendedSlExceeded) {
            // SL was physically touched (so it's a loss for PnL), BUT price is still inside 150% zone
            // We report this as SL_HIT because the trade failed, but we include context about the 150% zone.
            outcome = 'SL_HIT';
            hitTarget = 'SL';
            if (slHit) {
                priceAtHit = slHit.price;
                hitCandleTime = slHit.candleTime;
                candlesFromAnalysis = slHit.candleIndex;
                timeToOutcome = slHit.timeAfterAnalysis;
            }
        } else {
            outcome = 'STILL_OPEN';
        }

        // Build verification details
        let details = '';
        if (outcome === 'STILL_OPEN') {
            details = `⏳ TRADE STILL OPEN | ${klines.length} candles checked (${limited1m.length}×1m + ${limited15m.length}×15m + ${limited1h.length}×1h). Neither SL nor TP hit.`;
        } else if (outcome === 'SL_HIT') {
            if (extendedSlExceeded) {
                details = `❌ STOP LOSS HARD FAIL | Price broke 150% extended SL zone at candle #${slHit!.candleIndex} (${slHit!.timeAfterAnalysis}). Trade Invalid.`;
            } else {
                // Touched SL but held within 150%
                details = `❌ STOP LOSS HIT (Review Required):\n` +
                    `   • Price touched SL ($${stopLoss.toLocaleString()}) at candle #${slHit?.candleIndex} (${slHit?.timeAfterAnalysis})\n` +
                    `   • Price HELD within the 150% Extended Zone ($${extendedSlPrice.toLocaleString()})\n`;

                if (tpHits.length > 0) {
                    details += `   • ⚠️ AFTER TRIGGERING SL: Price reversed and hit ${tpHits[tpHits.length - 1].level} ($${tpHits[tpHits.length - 1].price.toLocaleString()}) at candle #${tpHits[tpHits.length - 1].candleIndex} (${tpHits[tpHits.length - 1].timeAfterAnalysis}).\n` +
                        `   • ANALYSIS: SL likely too tight. Trade was correct but entry/SL precision failed.`;
                } else {
                    details += `   • Price is currently floating in the 150% zone without hitting TP. Trade Pending.`;
                }
            }

        } else {
            // TP hit WITHOUT touching SL first (Clean Win)
            details = `TARGETS HIT (Clean):\n${tpHits.map(t =>
                `• ${t.level}: $${t.price.toLocaleString()} @ candle #${t.candleIndex} (${t.timeAfterAnalysis})`
            ).join('\n')} Entry: $${entryPrice.toLocaleString()} | Max DD: ${Math.abs((slHit?.price ? (slHit.price - entryPrice) / entryPrice : 0) * 100).toFixed(2)}%`;
        }

        console.log(`[AutoCapture] Outcome: ${details}`);

        // Calculate outcome snapshot
        const outcomeSnapshotIndex = finalOutcomeIndex || (tpHits.length > 0 ? tpHits[tpHits.length - 1].candleIndex : null);
        const outcomeSnapshot = outcomeSnapshotIndex ? calculateSnapshotAtCandle(klines, outcomeSnapshotIndex) : null;

        return {
            verified: true,
            outcome,
            hitTarget,
            hitCandleTime,
            priceAtHit,
            candlesFromAnalysis,
            timeToOutcome,
            tpHits: tpHits.length > 0 ? tpHits : undefined,
            slHit,
            analysisSnapshot: analysisSnapshot || undefined,
            outcomeSnapshot: outcomeSnapshot || undefined,
            verificationDetails: details
        };

    } catch (error) {
        console.error(`[AutoCapture] Historical verification failed:`, error);
        return {
            verified: false,
            outcome: 'INSUFFICIENT_DATA',
            verificationDetails: `Verification error: ${error instanceof Error ? error.message : 'Unknown error'}`
        };
    }
};

/**
 * Generate full indicator comparison block
 */
const generateIndicatorComparisonBlock = (
    analysisSnapshot: HistoricalIndicatorSnapshot,
    outcomeSnapshot: HistoricalIndicatorSnapshot
): string => {
    const a = analysisSnapshot;
    const o = outcomeSnapshot;

    // Helper to format indicator change
    const fmt = (val: number, decimals = 2): string => val?.toFixed(decimals) ?? 'N/A';
    const fmtPrice = (val: number): string => val ? `$${val.toLocaleString()}` : 'N/A';

    // RSI trend interpretation
    const rsiTrend = (rsi: number): string => {
        if (rsi > 70) return 'Overbought';
        if (rsi < 30) return 'Oversold';
        return 'Neutral';
    };

    // MACD trend
    const macdTrend = (hist: number): string => hist >= 0 ? 'Bullish' : 'Bearish';

    return `
═══════════════════════════════════════════════════════════════
📈 FULL INDICATOR COMPARISON (Analysis → Outcome)
═══════════════════════════════════════════════════════════════

🔹 RSI:
   - RSI6: ${fmt(a.indicators.rsi.rsi6)} → ${fmt(o.indicators.rsi.rsi6)} | RSI12: ${fmt(a.indicators.rsi.rsi12)} → ${fmt(o.indicators.rsi.rsi12)}
   - RSI14: ${fmt(a.indicators.rsi.rsi14)} → ${fmt(o.indicators.rsi.rsi14)} | RSI24: ${fmt(a.indicators.rsi.rsi24)} → ${fmt(o.indicators.rsi.rsi24)}
   - Trend: ${rsiTrend(a.indicators.rsi.rsi14)} → ${rsiTrend(o.indicators.rsi.rsi14)}

🔹 EMA:
   - EMA9: ${fmtPrice(a.indicators.ema.ema9)} → ${fmtPrice(o.indicators.ema.ema9)}
   - EMA21: ${fmtPrice(a.indicators.ema.ema21)} → ${fmtPrice(o.indicators.ema.ema21)}
   - EMA50: ${fmtPrice(a.indicators.ema.ema50)} → ${fmtPrice(o.indicators.ema.ema50)}
   - EMA200: ${fmtPrice(a.indicators.ema.ema200)} → ${fmtPrice(o.indicators.ema.ema200)}

🔹 MACD:
   - DIF: ${fmt(a.indicators.macd.dif, 4)} → ${fmt(o.indicators.macd.dif, 4)}
   - DEA: ${fmt(a.indicators.macd.dea, 4)} → ${fmt(o.indicators.macd.dea, 4)}
   - Histogram: ${fmt(a.indicators.macd.histogram, 4)} → ${fmt(o.indicators.macd.histogram, 4)}
   - Trend: ${macdTrend(a.indicators.macd.histogram)} → ${macdTrend(o.indicators.macd.histogram)}

🔹 Bollinger Bands:
   - Upper: ${fmtPrice(a.indicators.bollingerBands.upper)} → ${fmtPrice(o.indicators.bollingerBands.upper)}
   - Middle: ${fmtPrice(a.indicators.bollingerBands.middle)} → ${fmtPrice(o.indicators.bollingerBands.middle)}
   - Lower: ${fmtPrice(a.indicators.bollingerBands.lower)} → ${fmtPrice(o.indicators.bollingerBands.lower)}
   - Bandwidth: ${fmt(a.indicators.bollingerBands.bandwidth)}% → ${fmt(o.indicators.bollingerBands.bandwidth)}%

🔹 Stochastic:
   - K: ${fmt(a.indicators.stochastic.k)} → ${fmt(o.indicators.stochastic.k)}
   - D: ${fmt(a.indicators.stochastic.d)} → ${fmt(o.indicators.stochastic.d)}
   - J: ${fmt(a.indicators.stochastic.j)} → ${fmt(o.indicators.stochastic.j)}

🔹 ATR:
   - Value: ${fmtPrice(a.indicators.atr)} → ${fmtPrice(o.indicators.atr)}
   - Percent: ${fmt(a.indicators.atrPercent)}% → ${fmt(o.indicators.atrPercent)}%

🔹 Volume:
   - Current: ${fmt(a.indicators.volume.current / 1000000)}M → ${fmt(o.indicators.volume.current / 1000000)}M
   - Average: ${fmt(a.indicators.volume.average / 1000000)}M → ${fmt(o.indicators.volume.average / 1000000)}M
   - Trend: ${a.indicators.volume.trend} → ${o.indicators.volume.trend}

🔹 VWAP:
   - Value: ${fmtPrice(a.vwap.vwap)} → ${fmtPrice(o.vwap.vwap)}
   - Position: ${a.vwap.pricePosition.replace(/_/g, ' ')} → ${o.vwap.pricePosition.replace(/_/g, ' ')}
   - Bias: ${a.vwap.bias} → ${o.vwap.bias}

🔹 Ichimoku:
   - Cloud Color: ${a.ichimoku.cloudColor} → ${o.ichimoku.cloudColor}
   - Price vs Cloud: ${a.ichimoku.priceVsCloud} → ${o.ichimoku.priceVsCloud}
   - TK Cross: ${a.ichimoku.tkCross} → ${o.ichimoku.tkCross}
   - Signal: ${a.ichimoku.signal.replace(/_/g, ' ')} → ${o.ichimoku.signal.replace(/_/g, ' ')}

🔹 Momentum:
   - ROC5: ${fmt(a.momentum.roc5)}% → ${fmt(o.momentum.roc5)}%
   - ROC10: ${fmt(a.momentum.roc10)}% → ${fmt(o.momentum.roc10)}%
   - ROC20: ${fmt(a.momentum.roc20)}% → ${fmt(o.momentum.roc20)}%
   - State: ${a.momentum.momentum.replace(/_/g, ' ')} → ${o.momentum.momentum.replace(/_/g, ' ')}

🔹 Regime:
   - Type: ${a.regime.regime.replace(/_/g, ' ')} → ${o.regime.regime.replace(/_/g, ' ')}
   - ADX: ${fmt(a.regime.adx)} → ${fmt(o.regime.adx)}
   - Trend Direction: ${a.regime.trendDirection} → ${o.regime.trendDirection}
   - Trend Strength: ${a.regime.trendStrength} → ${o.regime.trendStrength}
═══════════════════════════════════════════════════════════════`;
};

/**
 * Capture current market snapshot for a symbol
 */
export const captureTradeSnapshot = async (symbol: string): Promise<AutoCaptureResult> => {
    console.log(`[AutoCapture] Capturing market snapshot for ${symbol}...`);

    try {
        const data = await fetchHybridData(symbol);
        const promptInjection = generateHybridPromptInjection(data);

        console.log(`[AutoCapture] Successfully captured data for ${symbol}`);
        console.log(`  - Price: $${data.marketData.currentPrice}`);
        console.log(`  - Regime: ${data.regime.regime}`);
        console.log(`  - Confluence: ${data.confluence.score}/100`);

        return {
            success: true,
            data,
            promptInjection
        };
    } catch (error) {
        console.error(`[AutoCapture] Failed to capture data for ${symbol}:`, error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
};

/**
 * Generate comparison block between original trade setup and outcome
 * Now includes full historical verification and indicator comparison
 * 
 * CRITICAL: When Win/Loss is triggered, uses the ACTUAL TP/SL hit price as the
 * final reference, NOT the current market price. This ensures post-mortem analysis
 * is based on the real exit point, not where price wandered after the trade closed.
 */
export const generateComparisonBlock = (
    originalAnalysis: TradeAnalysis,
    currentData: HybridDataPacket,
    historicalOutcome?: HistoricalOutcomeResult
): string => {
    // Extract original setup details
    const origEntry = originalAnalysis.entryPoints?.[0]?.price || 'N/A';
    const origSL = originalAnalysis.stopLoss || 'N/A';
    const origTP = originalAnalysis.takeProfit?.[0]?.price || 'N/A';
    const origDirection = originalAnalysis.direction;
    const origConfidence = originalAnalysis.confidence;
    const origPattern = originalAnalysis.detectedPatternFamily || originalAnalysis.marketConditions?.pattern || 'N/A';

    const currentPrice = currentData.marketData.currentPrice;
    const entryPrice = parseFloat(origEntry.replace(/[^0-9.]/g, ''));

    // CRITICAL FIX: Determine the FINAL REFERENCE PRICE for post-mortem analysis
    // Priority: 1) historicalOutcome.priceAtHit (actual TP/SL hit), 2) currentPrice (fallback)
    let finalReferencePrice: number;
    let referenceSource: string;

    if (historicalOutcome?.verified && historicalOutcome.priceAtHit) {
        // Trade has concluded - use the actual TP/SL hit price
        finalReferencePrice = historicalOutcome.priceAtHit;
        referenceSource = historicalOutcome.hitTarget || historicalOutcome.outcome;
    } else {
        // Trade still open or no historical data - use current price
        finalReferencePrice = currentPrice;
        referenceSource = 'Current Market';
    }

    // Calculate price change from entry to the FINAL REFERENCE PRICE (not just current)
    let finalPriceChangePercent = 'N/A';
    let currentPriceChangePercent = 'N/A';
    if (!isNaN(entryPrice) && entryPrice > 0) {
        const finalChange = ((finalReferencePrice - entryPrice) / entryPrice * 100).toFixed(2);
        finalPriceChangePercent = `${parseFloat(finalChange) >= 0 ? '+' : ''}${finalChange}%`;

        const currentChange = ((currentPrice - entryPrice) / entryPrice * 100).toFixed(2);
        currentPriceChangePercent = `${parseFloat(currentChange) >= 0 ? '+' : ''}${currentChange}%`;
    }

    // Build historical verification section
    let historicalSection = '';
    if (historicalOutcome?.verified) {
        const outcomeEmoji = historicalOutcome.outcome === 'TP_HIT' ? '✅' :
            historicalOutcome.outcome === 'SL_HIT' ? '❌' : '⏳';

        historicalSection = `
═══════════════════════════════════════════════════════════════
${outcomeEmoji} **HISTORICAL OUTCOME VERIFICATION**
═══════════════════════════════════════════════════════════════
- Result: ${historicalOutcome.hitTarget || historicalOutcome.outcome}
- Hit Price: $${historicalOutcome.priceAtHit?.toLocaleString() || 'N/A'}
- Hit Time: ${historicalOutcome.hitCandleTime || 'N/A'}
- Time to Outcome: ${historicalOutcome.timeToOutcome || 'N/A'}
- Candles Since Analysis: ${historicalOutcome.candlesFromAnalysis || 'N/A'}
- Details: ${historicalOutcome.verificationDetails}
`;

        // Add full indicator comparison if both snapshots available
        if (historicalOutcome.analysisSnapshot && historicalOutcome.outcomeSnapshot) {
            historicalSection += generateIndicatorComparisonBlock(
                historicalOutcome.analysisSnapshot,
                historicalOutcome.outcomeSnapshot
            );
        }
    }

    // Build trade outcome section - this is the KEY data for post-mortem
    // Show ALL TP levels that were hit, with the highest one as the final reference
    let tpProgressSection = '';
    if (historicalOutcome?.tpHits && historicalOutcome.tpHits.length > 0) {
        tpProgressSection = historicalOutcome.tpHits.map((tp, idx) => {
            const isHighest = idx === historicalOutcome.tpHits!.length - 1;
            return `   ${isHighest ? '→' : '•'} ${tp.level}: $${tp.price.toLocaleString()} @ ${tp.timeAfterAnalysis}${isHighest ? ' ← FINAL REFERENCE' : ''}`;
        }).join('\n');
    }

    const tradeOutcomeSection = historicalOutcome?.verified ? `
═══════════════════════════════════════════════════════════════
🎯 **TRADE OUTCOME (USE THIS FOR POST-MORTEM)**
═══════════════════════════════════════════════════════════════
- Final Exit Price: $${finalReferencePrice.toLocaleString()} (${referenceSource})
- P&L from Entry: ${finalPriceChangePercent}
- Exit Timestamp: ${historicalOutcome.hitCandleTime || 'N/A'}
${tpProgressSection ? `- TP Levels Hit:\n${tpProgressSection}` : ''}
⚠️ IMPORTANT: All post-mortem analysis MUST reference the Final Exit Price above,
   NOT the current market price which may have moved significantly since trade close.
` : '';

    return `
═══════════════════════════════════════════════════════════════
📊 **TRADE SETUP VS MARKET COMPARISON**
═══════════════════════════════════════════════════════════════

🔹 **ORIGINAL TRADE SETUP:**
- Entry: ${origEntry}
- Stop Loss: ${origSL}
- Take Profit: ${origTP}
- Direction: ${origDirection}
- Confidence: ${origConfidence}
- Pattern/Family: ${origPattern}
- Strategy: ${originalAnalysis.strategy || 'N/A'}
${tradeOutcomeSection}
🔹 **CURRENT MARKET STATE (for reference only):**
- Current Price: $${currentPrice.toLocaleString()} (vs entry: ${currentPriceChangePercent})
- RSI (1H): ${currentData.indicators['1h'].rsi.rsi14}
- MACD (1H): ${currentData.indicators['1h'].macd.histogram >= 0 ? 'Bullish' : 'Bearish'}
- Regime: ${currentData.regime.regime.replace(/_/g, ' ').toUpperCase()}
- Confluence: ${currentData.confluence.score}/100 (${currentData.confluence.direction})
${historicalSection}
═══════════════════════════════════════════════════════════════
⚠️ **POST-MORTEM ANALYSIS REQUIREMENTS:**
1. What changed between entry and the ACTUAL EXIT (${referenceSource})?
2. Warning signs the AI might have missed BEFORE the exit?
3. Key learnings for future similar setups?
4. Rule adjustment (IF/THEN) for the playbook?
═══════════════════════════════════════════════════════════════
`;
};

/**
 * Extract symbol from trade analysis
 */
export const extractSymbolFromAnalysis = (analysis: TradeAnalysis): string | null => {
    const coinName = analysis.coinName?.toUpperCase().trim();

    if (!coinName) return null;

    // Normalize to USDT pair format
    if (coinName.endsWith('USDT')) {
        return coinName;
    } else if (coinName.endsWith('USD')) {
        return coinName.replace('USD', 'USDT');
    } else {
        return `${coinName}USDT`;
    }
};

/**
 * Auto-capture and generate full comparison for post-mortem
 * Now includes historical TP/SL verification with full indicator snapshots
 * 
 * @param selectedEntryIndices - Optional array of entry indices selected by user (for multi-entry trades)
 */
export const captureForPostMortem = async (
    originalAnalysis: TradeAnalysis,
    analysisTimestamp?: string,
    selectedEntryIndices?: number[]
): Promise<AutoCaptureResult> => {
    const symbol = extractSymbolFromAnalysis(originalAnalysis);

    if (!symbol) {
        return {
            success: false,
            error: 'Could not extract symbol from trade analysis'
        };
    }

    // Fetch current market data
    const result = await captureTradeSnapshot(symbol);

    if (!result.success || !result.data) {
        return result;
    }

    // If we have analysis timestamp, perform historical verification
    let historicalOutcome: HistoricalOutcomeResult | undefined;
    if (analysisTimestamp) {
        historicalOutcome = await verifyHistoricalOutcome(originalAnalysis, symbol, analysisTimestamp, selectedEntryIndices);
        result.historicalOutcome = historicalOutcome;
    }

    // Generate comparison block with historical data
    result.comparisonBlock = generateComparisonBlock(originalAnalysis, result.data, historicalOutcome);

    // Log verification that AI will receive correct TP/SL data
    logPostMortemDataVerification(originalAnalysis, historicalOutcome);

    return result;
};

/**
 * VERIFICATION HELPER: Logs and validates the TP/SL data being sent to AI providers
 * This ensures the AI receives the ACTUAL exit price, not current market price
 * 
 * Call this to confirm what data the AI will see in post-mortem analysis
 */
export interface PostMortemDataSummary {
    verified: boolean;
    originalSetup: {
        entry: string;
        stopLoss: string;
        takeProfit: string[];
        direction: string;
    };
    actualOutcome: {
        hitTarget: string | null;
        exitPrice: number | null;
        hitTime: string | null;
        tpLevelsHit: string[];
    } | null;
    aiWillReceive: string;
}

export const extractPostMortemDataSummary = (
    originalAnalysis: TradeAnalysis,
    historicalOutcome?: HistoricalOutcomeResult
): PostMortemDataSummary => {
    const summary: PostMortemDataSummary = {
        verified: !!historicalOutcome?.verified,
        originalSetup: {
            entry: originalAnalysis.entryPoints?.[0]?.price || 'N/A',
            stopLoss: originalAnalysis.stopLoss || 'N/A',
            takeProfit: originalAnalysis.takeProfit?.map(tp => tp.price) || [],
            direction: originalAnalysis.direction || 'N/A'
        },
        actualOutcome: null,
        aiWillReceive: ''
    };

    if (historicalOutcome?.verified) {
        summary.actualOutcome = {
            hitTarget: historicalOutcome.hitTarget || historicalOutcome.outcome,
            exitPrice: historicalOutcome.priceAtHit || null,
            hitTime: historicalOutcome.hitCandleTime || null,
            tpLevelsHit: historicalOutcome.tpHits?.map(tp => `${tp.level}: $${tp.price}`) || []
        };

        const exitType = historicalOutcome.outcome === 'TP_HIT' ? 'Take Profit' :
            historicalOutcome.outcome === 'SL_HIT' ? 'Stop Loss' : 'Unknown';
        summary.aiWillReceive = `${exitType} hit at $${historicalOutcome.priceAtHit?.toLocaleString()}`;
    } else {
        summary.aiWillReceive = 'NO VERIFIED OUTCOME - AI may use current price (less accurate)';
    }

    return summary;
};

/**
 * Logs verification data to console for debugging
 * Shows exactly what TP/SL data the AI providers will receive
 */
export const logPostMortemDataVerification = (
    originalAnalysis: TradeAnalysis,
    historicalOutcome?: HistoricalOutcomeResult
): void => {
    const summary = extractPostMortemDataSummary(originalAnalysis, historicalOutcome);

    console.log('\n╔═══════════════════════════════════════════════════════════════╗');
    console.log('║ 🔍 POST-MORTEM DATA VERIFICATION - AI WILL RECEIVE:          ║');
    console.log('╠═══════════════════════════════════════════════════════════════╣');
    console.log(`║ Original Setup:                                               ║`);
    console.log(`║   Entry: ${summary.originalSetup.entry.padEnd(52)}║`);
    console.log(`║   SL: ${summary.originalSetup.stopLoss.padEnd(55)}║`);
    console.log(`║   TP: ${(summary.originalSetup.takeProfit[0] || 'N/A').padEnd(55)}║`);
    console.log(`║   Direction: ${summary.originalSetup.direction.padEnd(48)}║`);
    console.log('╠═══════════════════════════════════════════════════════════════╣');

    if (summary.actualOutcome) {
        console.log(`║ ✅ VERIFIED OUTCOME (AI WILL USE THIS):                       ║`);
        console.log(`║   Hit Target: ${(summary.actualOutcome.hitTarget || 'N/A').padEnd(47)}║`);
        console.log(`║   Exit Price: $${(summary.actualOutcome.exitPrice?.toLocaleString() || 'N/A').padEnd(45)}║`);
        console.log(`║   Hit Time: ${(summary.actualOutcome.hitTime || 'N/A').padEnd(49)}║`);
        if (summary.actualOutcome.tpLevelsHit.length > 0) {
            console.log(`║   TP Levels Hit: ${summary.actualOutcome.tpLevelsHit.join(', ').substring(0, 43).padEnd(43)}║`);
        }
    } else {
        console.log(`║ ⚠️ NO VERIFIED OUTCOME - AI will fallback to original data   ║`);
    }

    console.log('╠═══════════════════════════════════════════════════════════════╣');
    console.log(`║ 📤 AI Receives: ${summary.aiWillReceive.substring(0, 44).padEnd(44)}║`);
    console.log('╚═══════════════════════════════════════════════════════════════╝\n');
};
