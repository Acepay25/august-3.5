/**
 * BacktestingService
 * Simulates trade signals against historical candle data
 * 
 * Features:
 * - Simulate entry/stop-loss/take-profit execution
 * - Calculate max drawdown during trade
 * - Determine if TP1/TP2/TP3 would have been hit
 * - Provide detailed simulation results
 * - Simulate from exact analysis timestamp forward (NEW)
 */

import { TradeAnalysis, BacktestResult } from '../../../types';
import { fetchOHLCV, fetchOHLCVFromTime, Kline } from '../analysis/MarketDataService';

/**
 * Parse price string to number (handles ranges like "3050 - 3060")
 */
const parsePrice = (priceStr: string): number => {
    if (!priceStr) return 0;
    // Remove any non-numeric characters except . and - and whitespace
    // Handle "to" for ranges like "3000 to 3050"
    const lower = priceStr.toLowerCase();

    // Check for "market" or "cmp"
    if (lower.includes('market') || lower.includes('cmp') || lower.includes('current')) {
        return 0; // Signals invalid/unknown price
    }

    const cleaned = priceStr.replace(/[^0-9.\-\s]/g, '');
    // If it's a range with "to" or "-", take the average
    if ((cleaned.includes('-') || lower.includes('to'))) {
        const parts = lower.includes('to') ? lower.split('to') : cleaned.split('-');
        if (parts.length === 2) {
            const p1 = parseFloat(parts[0].replace(/[^0-9.]/g, ''));
            const p2 = parseFloat(parts[1].replace(/[^0-9.]/g, ''));
            if (!isNaN(p1) && !isNaN(p2)) {
                return (p1 + p2) / 2;
            }
        }
    }
    // Single number
    const num = parseFloat(cleaned.replace(/\s+/g, ''));
    return isNaN(num) ? 0 : num;
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
        case 'w': return value * 7 * 24 * 60 * 60 * 1000;
        default: return 60 * 60 * 1000; // Default 1h
    }
};

/**
 * Align timestamp to the start of a candle interval
 */
const alignToIntervalStart = (timestamp: number, intervalMs: number): number => {
    return timestamp - (timestamp % intervalMs);
};

/**
 * Simulate a trade signal against historical data
 */
export const simulateTradeSignal = async (
    analysis: TradeAnalysis,
    symbol: string,
    timeframe: string = '1h',
    lookbackCandles: number = 100
): Promise<BacktestResult> => {
    try {
        // Fetch historical data
        const klines = await fetchOHLCV(symbol, timeframe, lookbackCandles);

        if (klines.length < 10) {
            return {
                wouldHaveTriggered: false,
                outcome: 'NOT_TRIGGERED',
                hitTarget: 'NONE',
                maxDrawdown: 0,
                timeToOutcome: 0,
                priceAtExit: 0,
                simulationDetails: 'Insufficient historical data for backtesting'
            };
        }

        // Parse trade parameters
        const entryPrice = analysis.entryPoints?.[0]?.price
            ? parsePrice(analysis.entryPoints[0].price)
            : 0;
        const stopLoss = parsePrice(analysis.stopLoss);
        const tp1 = analysis.takeProfit?.[0]?.price ? parsePrice(analysis.takeProfit[0].price) : 0;
        const tp2 = analysis.takeProfit?.[1]?.price ? parsePrice(analysis.takeProfit[1].price) : 0;
        const tp3 = analysis.takeProfit?.[2]?.price ? parsePrice(analysis.takeProfit[2].price) : 0;
        const isLong = analysis.direction === 'Long';

        if (entryPrice === 0 || stopLoss === 0) {
            return {
                wouldHaveTriggered: false,
                outcome: 'NOT_TRIGGERED',
                hitTarget: 'NONE',
                maxDrawdown: 0,
                timeToOutcome: 0,
                priceAtExit: 0,
                simulationDetails: 'Invalid entry or stop loss price'
            };
        }

        // Simulate trade execution
        let triggered = false;
        let triggerCandle = 0;
        let maxDrawdown = 0;
        let exitPrice = 0;
        let hitTarget: BacktestResult['hitTarget'] = 'NONE';
        let candlesToOutcome = 0;

        // Look for entry trigger
        for (let i = 0; i < klines.length; i++) {
            const candle = klines[i];

            // Check if entry would be triggered
            if (!triggered) {
                if (isLong) {
                    // For long, price needs to drop to entry (limit order)
                    if (candle.low <= entryPrice && candle.high >= entryPrice) {
                        triggered = true;
                        triggerCandle = i;
                    }
                } else {
                    // For short, price needs to rise to entry (limit order)
                    if (candle.high >= entryPrice && candle.low <= entryPrice) {
                        triggered = true;
                        triggerCandle = i;
                    }
                }
                continue;
            }

            // Trade is active, check for SL/TP
            const candlesSinceTrigger = i - triggerCandle;

            // Calculate drawdown
            if (isLong) {
                const dd = (entryPrice - candle.low) / entryPrice * 100;
                maxDrawdown = Math.max(maxDrawdown, dd);

                // Check stop loss (low touches SL)
                if (candle.low <= stopLoss) {
                    exitPrice = stopLoss;
                    hitTarget = 'SL';
                    candlesToOutcome = candlesSinceTrigger;
                    break;
                }

                // Check take profits (high touches TP)
                if (tp3 > 0 && candle.high >= tp3) {
                    exitPrice = tp3;
                    hitTarget = 'TP3';
                    candlesToOutcome = candlesSinceTrigger;
                    break;
                }
                if (tp2 > 0 && candle.high >= tp2) {
                    exitPrice = tp2;
                    hitTarget = 'TP2';
                    candlesToOutcome = candlesSinceTrigger;
                    break;
                }
                if (tp1 > 0 && candle.high >= tp1) {
                    exitPrice = tp1;
                    hitTarget = 'TP1';
                    candlesToOutcome = candlesSinceTrigger;
                    break;
                }
            } else {
                // Short position
                const dd = (candle.high - entryPrice) / entryPrice * 100;
                maxDrawdown = Math.max(maxDrawdown, dd);

                // Check stop loss (high touches SL)
                if (candle.high >= stopLoss) {
                    exitPrice = stopLoss;
                    hitTarget = 'SL';
                    candlesToOutcome = candlesSinceTrigger;
                    break;
                }

                // Check take profits (low touches TP)
                if (tp3 > 0 && candle.low <= tp3) {
                    exitPrice = tp3;
                    hitTarget = 'TP3';
                    candlesToOutcome = candlesSinceTrigger;
                    break;
                }
                if (tp2 > 0 && candle.low <= tp2) {
                    exitPrice = tp2;
                    hitTarget = 'TP2';
                    candlesToOutcome = candlesSinceTrigger;
                    break;
                }
                if (tp1 > 0 && candle.low <= tp1) {
                    exitPrice = tp1;
                    hitTarget = 'TP1';
                    candlesToOutcome = candlesSinceTrigger;
                    break;
                }
            }
        }

        // Determine outcome
        let outcome: BacktestResult['outcome'] = 'NOT_TRIGGERED';
        if (triggered) {
            if (hitTarget === 'SL') {
                outcome = 'LOSS';
            } else if (hitTarget !== 'NONE') {
                outcome = 'WIN';
            }
        }

        // Generate simulation details
        let details = '';
        if (!triggered) {
            details = `Entry price $${entryPrice.toLocaleString()} was not reached in the last ${lookbackCandles} candles.`;
        } else if (hitTarget === 'NONE') {
            details = `Trade triggered at $${entryPrice.toLocaleString()} but neither SL nor TP was hit within ${lookbackCandles - triggerCandle} candles.`;
        } else if (hitTarget === 'SL') {
            details = `Trade triggered at $${entryPrice.toLocaleString()}, stopped out at $${exitPrice.toLocaleString()} after ${candlesToOutcome} candles. Max drawdown: ${maxDrawdown.toFixed(2)}%`;
        } else {
            details = `Trade triggered at $${entryPrice.toLocaleString()}, hit ${hitTarget} at $${exitPrice.toLocaleString()} after ${candlesToOutcome} candles. Max drawdown: ${maxDrawdown.toFixed(2)}%`;
        }

        return {
            wouldHaveTriggered: triggered,
            outcome,
            hitTarget,
            maxDrawdown: Math.round(maxDrawdown * 100) / 100,
            timeToOutcome: candlesToOutcome,
            priceAtExit: exitPrice,
            simulationDetails: details
        };
    } catch (error) {
        console.error('[BacktestingService] Simulation failed:', error);
        return {
            wouldHaveTriggered: false,
            outcome: 'NOT_TRIGGERED',
            hitTarget: 'NONE',
            maxDrawdown: 0,
            timeToOutcome: 0,
            priceAtExit: 0,
            simulationDetails: `Backtest simulation error: ${error}`
        };
    }
};

/**
 * Individual TP hit information for backtest
 */
export interface BacktestTPHit {
    level: 'TP1' | 'TP2' | 'TP3';
    price: number;
    candleIndex: number;
    candleTime: string;
    timeAfterAnalysis: string;
}

/**
 * Extended backtest result with precise timing information
 */
export interface TimestampedBacktestResult extends BacktestResult {
    analysisTime: string;       // ISO timestamp of analysis
    hitCandleTime?: string;     // Exact ISO timestamp when final TP/SL was hit
    hitCandleIndex?: number;    // Candle index where final hit occurred
    timeToOutcomeReadable?: string;  // Human readable (e.g., "2h 15m")
    candlesEvaluated: number;   // Total candles checked
    tpHits?: BacktestTPHit[];   // All TP levels that were hit
    // Note: With 150% extended SL zone, TPs hit within the zone are recorded as real hits

    // Entry trigger tracking (for validity window checks)
    entryTriggerTime?: string;  // ISO timestamp when entry price was first hit

    // Current R:R tracking for open trades
    currentPrice?: number;       // Latest price from most recent candle
    currentPnlPercent?: number;  // Current unrealized P&L percentage with leverage applied (whole number)
    currentRR?: number;          // Current R:R ratio as whole number (positive = in profit, negative = in loss)
    entryPrice?: number;         // Entry price used for calculations
    slDistance?: number;         // Distance from entry to SL (1R)
    leverage?: number;           // Leverage multiplier used in P&L calculation

    // === ENTRY TIMING OPTIMIZATION ===
    optimalEntry?: {
        price: number;              // Best entry price found within lookback
        time: string;               // ISO timestamp of best entry
        improvement: number;        // % improvement vs AI's suggested entry (positive = better)
        candlesAfterAnalysis: number; // How many candles after analysis
        waitRecommendation: string; // e.g., "Waiting 2 candles would save 0.8%"
    };
}

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
 * Simulate a trade starting from the exact analysis timestamp
 * Fetches candles from analysis time forward and evaluates TP/SL hits
 * 
 * @param analysis - The trade analysis with entry, SL, and TP levels
 * @param symbol - Trading pair (e.g., 'BTCUSDT')
 * @param analysisTimestamp - ISO timestamp when the trade was analyzed
 * @param timeframe - Candle interval (default '1h')
 * @param leverage - Leverage multiplier for P&L calculation (default 1)
 * @param selectedEntryIndices - Optional array of entry indices to check (for multi-entry trades)
 */
export const simulateFromAnalysisTime = async (
    analysis: TradeAnalysis,
    symbol: string,
    analysisTimestamp: string,
    timeframe: string = '1h',
    leverage: number = 1,
    selectedEntryIndices?: number[]
): Promise<TimestampedBacktestResult> => {
    const analysisTime = new Date(analysisTimestamp).getTime();

    console.log(`[BacktestingService] Simulating from ${analysisTimestamp} for ${symbol}`);

    try {
        // 4-Tier Hybrid Fetch: 1m (precision) → 5m (swing bridge) → 15m (medium) → 1h (extended)
        // Total coverage: ~8 hours + ~20 hours + ~2.6 days + ~20 days = ~24 days
        // The 5m tier provides better precision for swing trade entry detection

        // Align start time to 1m candle boundary to include setup candle
        const alignedStartTime = alignToIntervalStart(analysisTime, getIntervalMs('1m'));

        console.log(`[BacktestingService] Hybrid fetch from ${new Date(alignedStartTime).toISOString()}`);

        // Tier 1: 1-minute candles (500 = ~8 hours precision for scalps)
        const klines1m = await fetchOHLCVFromTime(symbol, '1m', alignedStartTime);
        const limited1m = klines1m.slice(0, 500);

        // Tier 2: 5-minute candles (250 = ~20 hours bridge for swing trades)
        const tier2StartTime = limited1m.length > 0
            ? limited1m[limited1m.length - 1].time + getIntervalMs('1m')
            : alignedStartTime + 500 * getIntervalMs('1m');
        const klines5m = await fetchOHLCVFromTime(symbol, '5m', tier2StartTime);
        const limited5m = klines5m.slice(0, 250);

        // Tier 3: 15-minute candles (250 = ~2.6 days medium)
        const tier3StartTime = limited5m.length > 0
            ? limited5m[limited5m.length - 1].time + getIntervalMs('5m')
            : tier2StartTime + 250 * getIntervalMs('5m');
        const klines15m = await fetchOHLCVFromTime(symbol, '15m', tier3StartTime);
        const limited15m = klines15m.slice(0, 250);

        // Tier 4: 1-hour candles (500 = ~20 days extended)
        const tier4StartTime = limited15m.length > 0
            ? limited15m[limited15m.length - 1].time + getIntervalMs('15m')
            : tier3StartTime + 250 * getIntervalMs('15m');
        const klines1h = await fetchOHLCVFromTime(symbol, '1h', tier4StartTime);
        const limited1h = klines1h.slice(0, 500);

        // Merge all tiers (already in chronological order)
        const klines = [...limited1m, ...limited5m, ...limited15m, ...limited1h];

        console.log(`[BacktestingService] Hybrid data: ${limited1m.length}×1m + ${limited5m.length}×5m + ${limited15m.length}×15m + ${limited1h.length}×1h = ${klines.length} total`);

        // Parse trade parameters - support multiple entries
        const allEntryPrices = (analysis.entryPoints || [])
            .map((ep, idx) => ({ price: parsePrice(ep.price || ''), index: idx }))
            .filter(e => e.price > 0);

        // Filter to selected entries if specified, otherwise use all
        const entriesToCheck = selectedEntryIndices && selectedEntryIndices.length > 0
            ? allEntryPrices.filter(e => selectedEntryIndices.includes(e.index))
            : allEntryPrices;

        const stopLoss = parsePrice(analysis.stopLoss);
        const tp1 = analysis.takeProfit?.[0]?.price ? parsePrice(analysis.takeProfit[0].price) : 0;
        const tp2 = analysis.takeProfit?.[1]?.price ? parsePrice(analysis.takeProfit[1].price) : 0;
        const tp3 = analysis.takeProfit?.[2]?.price ? parsePrice(analysis.takeProfit[2].price) : 0;
        const isLong = analysis.direction === 'Long';

        // Log which entries we're checking
        if (entriesToCheck.length > 1) {
            console.log(`[BacktestingService] Checking ${entriesToCheck.length} entry points: ${entriesToCheck.map(e => `Entry${e.index + 1}=$${e.price.toLocaleString()}`).join(', ')}`);
        }

        // Use first entry for now (will update entry detection logic later)
        const entryPrice = entriesToCheck.length > 0 ? entriesToCheck[0].price : 0;

        if (klines.length < 1) {
            // Provide helpful error message based on data availability
            let errorDetails = '';

            // Variables for partial R:R calculation
            let currentPrice: number | undefined;
            let currentPnlPercent: number | undefined;
            let currentRR: number | undefined;
            let slDistanceValue: number | undefined;
            let wouldHaveTriggered = false;

            if (klines.length === 0) {
                errorDetails = `⚠️ No market data available for ${symbol}.\n\n` +
                    `Possible causes:\n` +
                    `• Invalid symbol (${symbol} may not exist on Binance)\n` +
                    `• Network connection issue\n` +
                    `• Analysis is too recent (wait for at least 1 candle)`;

                // Check if entry triggered in the limited data we have
                if (entryPrice > 0) {
                    for (const candle of klines) {
                        // Loose check for trigger - if price range overlaps entry
                        if (isLong) {
                            if (candle.low <= entryPrice) { // High check usually true if low is under
                                wouldHaveTriggered = true;
                                break;
                            }
                        } else {
                            if (candle.high >= entryPrice) {
                                wouldHaveTriggered = true;
                                break;
                            }
                        }
                    }
                }

                // ALWAYS set current price when candles exist (for display)
                if (klines.length > 0) {
                    const lastCandle = klines[klines.length - 1];
                    currentPrice = lastCandle.close;
                }

                // Calculate P&L only if triggered and valid parameters
                if (wouldHaveTriggered && entryPrice > 0 && stopLoss > 0 && currentPrice !== undefined) {
                    slDistanceValue = Math.abs(entryPrice - stopLoss);

                    let currentPnl = 0;
                    let currentRRRaw = 0;

                    if (slDistanceValue > 0) {
                        if (isLong) {
                            currentPnl = currentPrice - entryPrice;
                        } else {
                            currentPnl = entryPrice - currentPrice;
                        }
                        currentRRRaw = currentPnl / slDistanceValue;
                    }
                    // Calculate P&L % with leverage
                    currentPnlPercent = entryPrice > 0 ? Math.round((currentPnl / entryPrice) * 100 * leverage) : 0;
                    currentRR = Math.round(currentRRRaw);
                }
            }

            return {
                wouldHaveTriggered,
                outcome: 'NOT_TRIGGERED',
                hitTarget: 'NONE',
                maxDrawdown: 0,
                timeToOutcome: 0,
                priceAtExit: 0,
                simulationDetails: errorDetails,
                analysisTime: analysisTimestamp,
                candlesEvaluated: klines.length,
                leverage,
                // Include partial R:R data if available
                currentPrice,
                currentPnlPercent,
                currentRR,
                entryPrice,
                slDistance: slDistanceValue
            };
        }

        if (entryPrice === 0 || stopLoss === 0) {
            return {
                wouldHaveTriggered: false,
                outcome: 'NOT_TRIGGERED',
                hitTarget: 'NONE',
                maxDrawdown: 0,
                timeToOutcome: 0,
                priceAtExit: 0,
                simulationDetails: `⚠️ Cannot backtest: Invalid trade parameters.\n\n` +
                    `Entry: ${entryPrice === 0 ? '❌ Missing' : `✅ $${entryPrice.toLocaleString()}`}\n` +
                    `Stop Loss: ${stopLoss === 0 ? '❌ Missing' : `✅ $${stopLoss.toLocaleString()}`}`,
                analysisTime: analysisTimestamp,
                candlesEvaluated: klines.length,
                leverage
            };
        }

        // === ENTRY DETECTION PHASE ===
        // Scan candles to find when price actually reached ANY of the selected entry levels
        // Unified Logic: Price "touches" entry if Entry is within [Low, High] range.
        // This handles:
        // 1. Long Limit (Dip): Price drops to Entry.
        // 2. Long Stop (Breakout): Price rises to Entry.
        // 3. Short Limit (Rally): Price rises to Entry.
        // 4. Short Stop (Breakdown): Price drops to Entry.

        let entryTriggeredAtIndex = -1;
        let entryTriggerTime: string | undefined;
        let triggeredEntryPrice = entryPrice; // Track which entry was hit

        for (let i = 0; i < klines.length; i++) {
            const candle = klines[i];

            // Check ALL selected entries - trigger on first one hit
            for (const entry of entriesToCheck) {
                if (entry.price >= candle.low && entry.price <= candle.high) {
                    entryTriggeredAtIndex = i;
                    entryTriggerTime = new Date(candle.time).toISOString();
                    triggeredEntryPrice = entry.price;
                    console.log(`[BacktestingService] ✅ Entry ${entry.index + 1} triggered at candle ${i} (Price touched $${entry.price.toLocaleString()}), time: ${entryTriggerTime}`);
                    break;
                }
            }
            if (entryTriggeredAtIndex !== -1) break;
        }

        // If entry hasn't been triggered yet, return waiting status WITHOUT PnL
        if (entryTriggeredAtIndex === -1) {
            const lastCandle = klines[klines.length - 1];
            const currentPrice = lastCandle.close;
            const priceDistanceToEntry = isLong
                ? ((currentPrice - entryPrice) / entryPrice * 100).toFixed(2)
                : ((entryPrice - currentPrice) / entryPrice * 100).toFixed(2);
            const isApproaching = parseFloat(priceDistanceToEntry) > 0;

            return {
                wouldHaveTriggered: false,
                outcome: 'NOT_TRIGGERED',
                hitTarget: 'NONE',
                maxDrawdown: 0,
                timeToOutcome: 0,
                priceAtExit: 0,
                simulationDetails: `⏳ WAITING FOR ENTRY | ${klines.length} candles scanned\n` +
                    `   Entry: $${entryPrice.toLocaleString()} | Current: $${currentPrice.toLocaleString()}\n` +
                    `   ${isApproaching ? '📈 Price' : '📉 Price'} is ${Math.abs(parseFloat(priceDistanceToEntry))}% ${isLong ? (isApproaching ? 'above' : 'below') : (isApproaching ? 'below' : 'above')} entry\n` +
                    `   Status: Entry ${isLong ? 'buy' : 'sell'} order has NOT been filled yet`,
                analysisTime: analysisTimestamp,
                candlesEvaluated: klines.length,
                leverage,
                currentPrice, // Show current price even when waiting
                entryPrice
                // NOTE: No currentPnlPercent or currentRR - entry not hit
            };
        }

        // === ENTRY CONFIRMED - START SIMULATION FROM ENTRY CANDLE ===
        const entryTimeAfterAnalysis = formatDuration(klines[entryTriggeredAtIndex].time - analysisTime);
        console.log(`[BacktestingService] Entry triggered at candle #${entryTriggeredAtIndex} (${entryTimeAfterAnalysis} after analysis)`);

        let maxDrawdown = 0;
        let slHitPrice = 0;
        let slHitIndex: number | undefined;
        let slHitTime: string | undefined;
        let slTouched = false; // Track if initial SL was touched
        let extendedSlExceeded = false; // Track if price exceeded 150% SL zone
        const tpHits: BacktestTPHit[] = [];
        let tp1Hit = false, tp2Hit = false, tp3Hit = false;

        // Calculate 150% extended SL zone
        // For Long: Extended SL = SL - (0.5 * SL distance) = 150% of original SL distance from entry
        // For Short: Extended SL = SL + (0.5 * SL distance)
        const slDistance = Math.abs(entryPrice - stopLoss);
        const extendedSlPrice = isLong
            ? stopLoss - (slDistance * 0.5)  // 150% of SL distance below entry for Long
            : stopLoss + (slDistance * 0.5); // 150% of SL distance above entry for Short

        // Iterate through candles STARTING FROM ENTRY - continue scanning even after SL touch until 150% exceeded
        for (let i = entryTriggeredAtIndex; i < klines.length; i++) {
            const candle = klines[i];
            const candleTimeStr = new Date(candle.time).toISOString();
            const timeAfterAnalysis = formatDuration(candle.time - analysisTime);

            if (isLong) {
                const dd = (entryPrice - candle.low) / entryPrice * 100;
                maxDrawdown = Math.max(maxDrawdown, dd);

                // CHECK TPs FIRST - if TP is hit, we skip SL checking entirely for this candle
                // This ensures that if TP is hit first, we don't look for SL
                if (!tp1Hit && tp1 > 0 && candle.high >= tp1) {
                    tp1Hit = true;
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
                    tpHits.push({
                        level: 'TP3',
                        price: tp3,
                        candleIndex: i,
                        candleTime: candleTimeStr,
                        timeAfterAnalysis
                    });
                    break; // All TPs hit - exit loop
                }

                // If any TP was hit on this candle, skip SL checking entirely
                const anyTpHit = tp1Hit || tp2Hit || tp3Hit;
                if (anyTpHit) {
                    continue; // TP hit first, don't check SL
                }

                // Check if price exceeded 150% extended SL zone - hard stop
                if (candle.low <= extendedSlPrice) {
                    slHitPrice = extendedSlPrice;
                    slHitIndex = i;
                    slHitTime = candleTimeStr;
                    extendedSlExceeded = true;
                    break; // Loss exceeded 150% threshold - end scan
                }

                // Check if initial SL was touched (but not exceeded 150%)
                if (!slTouched && candle.low <= stopLoss) {
                    slTouched = true;
                    // DEBUG: Log the exact candle that triggered SL detection
                    console.log(`[BacktestingService] 🔴 SL TOUCHED at candle ${i}:`, {
                        candleTime: candleTimeStr,
                        candleOHLC: { open: candle.open, high: candle.high, low: candle.low, close: candle.close },
                        stopLoss: stopLoss,
                        condition: `candle.low (${candle.low}) <= stopLoss (${stopLoss})`,
                        timeAfterAnalysis: timeAfterAnalysis
                    });
                    // Record for reference but DON'T break - allow recovery
                    if (!slHitIndex) {
                        slHitPrice = stopLoss;
                        slHitIndex = i;
                        slHitTime = candleTimeStr;
                    }
                }
            } else {
                // Short position
                const dd = (candle.high - entryPrice) / entryPrice * 100;
                maxDrawdown = Math.max(maxDrawdown, dd);

                // CHECK TPs FIRST - if TP is hit, we skip SL checking entirely for this candle
                // This ensures that if TP is hit first, we don't look for SL
                if (!tp1Hit && tp1 > 0 && candle.low <= tp1) {
                    tp1Hit = true;
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
                    tpHits.push({
                        level: 'TP3',
                        price: tp3,
                        candleIndex: i,
                        candleTime: candleTimeStr,
                        timeAfterAnalysis
                    });
                    break; // All TPs hit - exit loop
                }

                // If any TP was hit on this candle, skip SL checking entirely
                const anyTpHitShort = tp1Hit || tp2Hit || tp3Hit;
                if (anyTpHitShort) {
                    continue; // TP hit first, don't check SL
                }

                // Check if price exceeded 150% extended SL zone - hard stop
                if (candle.high >= extendedSlPrice) {
                    slHitPrice = extendedSlPrice;
                    slHitIndex = i;
                    slHitTime = candleTimeStr;
                    extendedSlExceeded = true;
                    break; // Loss exceeded 150% threshold - end scan
                }

                // Check if initial SL was touched (but not exceeded 150%)
                if (!slTouched && candle.high >= stopLoss) {
                    slTouched = true;
                    // DEBUG: Log the exact candle that triggered SL detection
                    console.log(`[BacktestingService] 🔴 SL TOUCHED (SHORT) at candle ${i}:`, {
                        candleTime: candleTimeStr,
                        candleOHLC: { open: candle.open, high: candle.high, low: candle.low, close: candle.close },
                        stopLoss: stopLoss,
                        condition: `candle.high (${candle.high}) >= stopLoss (${stopLoss})`,
                        timeAfterAnalysis: timeAfterAnalysis
                    });
                    if (!slHitIndex) {
                        slHitPrice = stopLoss;
                        slHitIndex = i;
                        slHitTime = candleTimeStr;
                    }
                }
            }
        }

        // Determine outcome - TPs take priority if hit before 150% exceeded
        let outcome: BacktestResult['outcome'] = 'NOT_TRIGGERED';
        let hitTarget: BacktestResult['hitTarget'] = 'NONE';
        let hitCandleIndex: number | undefined;
        let hitCandleTime: string | undefined;
        let exitPrice = 0;

        // TPs win if any were hit (even after SL touch, within 150% zone)
        if (tpHits.length > 0) {
            outcome = 'WIN';
            const lastTp = tpHits[tpHits.length - 1];
            hitTarget = lastTp.level;
            hitCandleIndex = lastTp.candleIndex;
            hitCandleTime = lastTp.candleTime;
            exitPrice = lastTp.price;
        } else if (slHitIndex !== undefined && extendedSlExceeded) {
            // SL exceeded 150% - definite LOSS
            outcome = 'LOSS';
            hitTarget = 'SL';
            hitCandleIndex = slHitIndex;
            hitCandleTime = slHitTime;
            exitPrice = slHitPrice;
        }

        // Calculate time to outcome
        let timeToOutcomeReadable: string | undefined;
        if (hitCandleIndex !== undefined && klines[hitCandleIndex]) {
            const hitTime = klines[hitCandleIndex].time;
            timeToOutcomeReadable = formatDuration(hitTime - analysisTime);
        }

        // Calculate total time elapsed since analysis
        const lastCandle = klines[klines.length - 1];
        const totalTimeElapsed = formatDuration(lastCandle.time - analysisTime);

        // Current price for display (always show latest price)
        const currentPrice = lastCandle.close;
        const slDistanceValue = Math.abs(entryPrice - stopLoss); // This is 1R

        // P&L Calculation: Use exitPrice for closed trades (WIN/LOSS), currentPrice for OPEN
        let pnlReferencePrice = currentPrice;
        if (outcome === 'WIN' || outcome === 'LOSS') {
            pnlReferencePrice = exitPrice; // Lock P&L at exit
        }

        let currentPnl = 0;
        let currentRR = 0;

        if (slDistanceValue > 0) {
            if (isLong) {
                currentPnl = pnlReferencePrice - entryPrice;
            } else {
                currentPnl = entryPrice - pnlReferencePrice;
            }
            currentRR = currentPnl / slDistanceValue; // Positive = profit, negative = loss
        }
        // Apply leverage to P&L percentage
        const currentPnlPercent = entryPrice > 0 ? (currentPnl / entryPrice) * 100 * leverage : 0;

        // Generate clear feedback
        let details = '';
        if (hitTarget === 'NONE') {
            const status = slTouched
                ? `SL touched but within 150% zone. Waiting for TP or extended SL break.`
                : `Neither SL nor TP hit. Trade pending.`;
            const rrSign = currentRR >= 0 ? '+' : '';
            const pnlSign = currentPnlPercent >= 0 ? '+' : '';
            // Show R:R as whole number, P&L with leverage
            details = `⏳ TRADE STILL OPEN | ${klines.length} candles since analysis (${totalTimeElapsed} elapsed)\n` +
                `   Entry: $${entryPrice.toLocaleString()} | SL: $${stopLoss.toLocaleString()} | Extended SL: $${extendedSlPrice.toLocaleString()}\n` +
                `   📈 Current: $${currentPrice.toLocaleString()} | P&L: ${pnlSign}${currentPnlPercent.toFixed(0)}% (${leverage}x) | R:R: ${rrSign}${Math.round(currentRR)}R\n` +
                `   Max drawdown: ${maxDrawdown.toFixed(2)}%\n` +
                `   Status: ${status}`;
        } else if (hitTarget === 'SL') {
            details = `❌ STOP LOSS EXCEEDED | Loss exceeded 150% of original SL distance at candle #${hitCandleIndex} (${timeToOutcomeReadable})\n` +
                `   Entry: $${entryPrice.toLocaleString()} → Extended SL at: $${exitPrice.toLocaleString()}\n` +
                `   Max drawdown: ${maxDrawdown.toFixed(2)}%`;
        } else {
            // TP hit - show TPs, and note if SL was touched first
            details = `✅ TARGETS HIT:\n${tpHits.map(t =>
                `   • ${t.level}: $${t.price.toLocaleString()} @ candle #${t.candleIndex} (${t.timeAfterAnalysis})`
            ).join('\n')}\n   Entry: $${entryPrice.toLocaleString()} | Max DD: ${maxDrawdown.toFixed(2)}%`;
            if (slTouched) {
                details += `\n\n📊 **NOTE:** Price touched SL ($${stopLoss.toLocaleString()}) but recovered within 150% zone to hit TP.`;
            }
        }

        // === OPTIMAL ENTRY TIMING ANALYSIS ===
        // Analyze first 10 candles to find the best entry price
        const LOOKBACK_CANDLES = 10; // Analyze first 10 candles after analysis
        let optimalEntry: TimestampedBacktestResult['optimalEntry'];

        if (klines.length > 1) {
            const lookbackEnd = Math.min(LOOKBACK_CANDLES, klines.length);
            const lookbackCandles = klines.slice(0, lookbackEnd);

            if (isLong) {
                // For Long: Best entry = lowest low (buy at best price)
                let bestPrice = lookbackCandles[0].low;
                let bestIndex = 0;
                let bestTime = new Date(lookbackCandles[0].time).toISOString();

                for (let i = 1; i < lookbackCandles.length; i++) {
                    if (lookbackCandles[i].low < bestPrice) {
                        bestPrice = lookbackCandles[i].low;
                        bestIndex = i;
                        bestTime = new Date(lookbackCandles[i].time).toISOString();
                    }
                }

                // Calculate improvement vs AI's suggested entry
                const improvement = entryPrice > 0
                    ? ((entryPrice - bestPrice) / entryPrice) * 100
                    : 0;

                // Always populate optimalEntry for UI display
                optimalEntry = {
                    price: bestPrice,
                    time: bestTime,
                    improvement: Math.round(improvement * 100) / 100,
                    candlesAfterAnalysis: bestIndex,
                    waitRecommendation: improvement > 0.1 && bestIndex > 0
                        ? `Waiting ${bestIndex} candle${bestIndex > 1 ? 's' : ''} would save ${improvement.toFixed(1)}%`
                        : `✓ AI entry was optimal`
                };
            } else {
                // For Short: Best entry = highest high (sell at best price)
                let bestPrice = lookbackCandles[0].high;
                let bestIndex = 0;
                let bestTime = new Date(lookbackCandles[0].time).toISOString();

                for (let i = 1; i < lookbackCandles.length; i++) {
                    if (lookbackCandles[i].high > bestPrice) {
                        bestPrice = lookbackCandles[i].high;
                        bestIndex = i;
                        bestTime = new Date(lookbackCandles[i].time).toISOString();
                    }
                }

                // Calculate improvement vs AI's suggested entry
                const improvement = entryPrice > 0
                    ? ((bestPrice - entryPrice) / entryPrice) * 100
                    : 0;

                // Always populate optimalEntry for UI display
                optimalEntry = {
                    price: bestPrice,
                    time: bestTime,
                    improvement: Math.round(improvement * 100) / 100,
                    candlesAfterAnalysis: bestIndex,
                    waitRecommendation: improvement > 0.1 && bestIndex > 0
                        ? `Waiting ${bestIndex} candle${bestIndex > 1 ? 's' : ''} would save ${improvement.toFixed(1)}%`
                        : `✓ AI entry was optimal`
                };
            }
        }

        console.log(`[BacktestingService] Result: ${details}`);

        return {
            wouldHaveTriggered: true,
            outcome,
            hitTarget,
            maxDrawdown: Math.round(maxDrawdown * 100) / 100,
            timeToOutcome: hitCandleIndex || 0,
            priceAtExit: exitPrice,
            simulationDetails: details,
            analysisTime: analysisTimestamp,
            hitCandleTime,
            hitCandleIndex,
            timeToOutcomeReadable,
            candlesEvaluated: klines.length,
            tpHits: tpHits.length > 0 ? tpHits : undefined,
            // Entry trigger time - for validity window checks
            entryTriggerTime,
            // Current R:R tracking - R:R as whole number, P&L rounded to whole percentage with leverage
            currentPrice,
            currentPnlPercent: Math.round(currentPnlPercent),  // Whole number percentage with leverage
            currentRR: Math.round(currentRR),                   // Whole number R:R
            entryPrice,
            slDistance: slDistanceValue,
            leverage,                                           // Include leverage used in calculation
            // Entry Timing Optimization
            optimalEntry
        };

    } catch (error) {
        console.error('[BacktestingService] Simulation from analysis time failed:', error);

        // Provide helpful error message
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        const isNetworkError = errorMessage.includes('fetch') || errorMessage.includes('network') || errorMessage.includes('Failed to fetch');

        let errorDetails = '';
        if (isNetworkError) {
            errorDetails = `🌐 Network Error\n\n` +
                `Could not fetch market data from Binance.\n\n` +
                `Possible causes:\n` +
                `• Check your internet connection\n` +
                `• Binance may be blocked on your network\n` +
                `• Try again in a few moments`;
        } else {
            errorDetails = `⚠️ Backtest Error\n\n${errorMessage}`;
        }

        return {
            wouldHaveTriggered: false,
            outcome: 'NOT_TRIGGERED',
            hitTarget: 'NONE',
            maxDrawdown: 0,
            timeToOutcome: 0,
            priceAtExit: 0,
            simulationDetails: errorDetails,
            analysisTime: analysisTimestamp,
            candlesEvaluated: 0,
            leverage
        };
    }
};
export const batchBacktest = async (
    analyses: TradeAnalysis[],
    symbol: string,
    timeframe: string = '1h'
): Promise<{
    winRate: number;
    avgRR: number;
    avgDrawdown: number;
    results: BacktestResult[];
}> => {
    const results: BacktestResult[] = [];

    for (const analysis of analyses) {
        const result = await simulateTradeSignal(analysis, symbol, timeframe);
        results.push(result);
    }

    // Calculate statistics
    const triggeredTrades = results.filter(r => r.wouldHaveTriggered);
    const wins = triggeredTrades.filter(r => r.outcome === 'WIN').length;
    const winRate = triggeredTrades.length > 0 ? (wins / triggeredTrades.length) * 100 : 0;
    const avgDrawdown = triggeredTrades.length > 0
        ? triggeredTrades.reduce((sum, r) => sum + r.maxDrawdown, 0) / triggeredTrades.length
        : 0;

    // Calculate average R:R for winning trades
    let totalRR = 0;
    let rrCount = 0;
    for (const result of triggeredTrades) {
        if (result.outcome === 'WIN' && result.priceAtExit) {
            // Find matching analysis to calculate R:R
            const idx = results.indexOf(result);
            if (idx >= 0 && analyses[idx]) {
                const entry = parsePrice(analyses[idx].entryPoints?.[0]?.price || '0');
                const sl = parsePrice(analyses[idx].stopLoss);
                const exit = result.priceAtExit;

                if (entry && sl && exit) {
                    const risk = Math.abs(entry - sl);
                    const reward = Math.abs(exit - entry);
                    if (risk > 0) {
                        totalRR += reward / risk;
                        rrCount++;
                    }
                }
            }
        }
    }
    const avgRR = rrCount > 0 ? totalRR / rrCount : 0;

    return {
        winRate: Math.round(winRate * 10) / 10,
        avgRR: Math.round(avgRR * 100) / 100,
        avgDrawdown: Math.round(avgDrawdown * 100) / 100,
        results
    };
};

/**
 * Generate a quick backtest summary for UI display
 */
export const generateBacktestSummary = (result: BacktestResult): string => {
    if (!result.wouldHaveTriggered) {
        return `⏳ Entry not triggered`;
    }

    const emoji = result.outcome === 'WIN' ? '✅' : result.outcome === 'LOSS' ? '❌' : '⏳';

    if (result.outcome === 'WIN') {
        return `${emoji} Would have hit ${result.hitTarget} in ${result.timeToOutcome} candles (${result.maxDrawdown.toFixed(1)}% max DD)`;
    } else if (result.outcome === 'LOSS') {
        return `${emoji} Would have stopped out in ${result.timeToOutcome} candles (${result.maxDrawdown.toFixed(1)}% max DD)`;
    } else {
        return `⏳ Trade running - neither SL nor TP hit yet`;
    }
};

/**
 * Validate if a trade setup should be taken based on backtest patterns
 */
export const validateWithBacktest = async (
    analysis: TradeAnalysis,
    symbol: string
): Promise<{
    shouldTake: boolean;
    reason: string;
    backtestResult: BacktestResult;
}> => {
    // Run backtest on 4h timeframe for more reliable results
    const result = await simulateTradeSignal(analysis, symbol, '4h', 50);

    // Decision logic
    if (!result.wouldHaveTriggered) {
        return {
            shouldTake: true, // No historical data to invalidate
            reason: 'Entry level not tested in recent history - no backtest data.',
            backtestResult: result
        };
    }

    if (result.outcome === 'LOSS' && result.maxDrawdown > 3) {
        return {
            shouldTake: false,
            reason: `Historical backtest shows LOSS with ${result.maxDrawdown.toFixed(1)}% drawdown. Consider adjusting SL.`,
            backtestResult: result
        };
    }

    if (result.outcome === 'WIN') {
        return {
            shouldTake: true,
            reason: `Historical backtest supports this setup - would have hit ${result.hitTarget}.`,
            backtestResult: result
        };
    }

    return {
        shouldTake: true,
        reason: 'Backtest inconclusive - use other validation methods.',
        backtestResult: result
    };
};

// =========================================================================
// POST-MORTEM TRADE VALIDATION
// Uses ORIGINAL SL (not 150% extended zone) for accurate outcome detection
// =========================================================================

/**
 * Indicators calculated at exit time (historical, not current)
 */
export interface IndicatorsAtExit {
    rsi14: number;
    macdHistogram: number;
    macdDif: number;
    macdDea: number;
    ema20: number;
    ema50: number;
    ema200: number;
    atr: number;
    volumeTrend: 'high' | 'low' | 'normal';
    priceVsEma20: 'above' | 'below';
    priceVsEma50: 'above' | 'below';
}

/**
 * TP hit record for post-mortem validation
 */
export interface PostMortemTPHit {
    level: 'TP1' | 'TP2' | 'TP3';
    price: number;
    candleIndex: number;
    candleTime: string;
    timeAfterEntry: string;
}

/**
 * Complete trade outcome validation result for post-mortem analysis
 */
export interface TradeOutcomeValidation {
    // Entry detection
    entryTriggered: boolean;
    entryTriggerTime?: string;
    entryTriggerCandleIndex?: number;

    // Outcome (using 150% extended SL zone like backtesting)
    outcome: 'WIN' | 'LOSS' | 'OPEN' | 'ENTRY_NOT_HIT';
    hitTarget: 'TP1' | 'TP2' | 'TP3' | 'SL' | 'NONE';
    exitPrice?: number;
    exitTime?: string;
    exitCandleIndex?: number;

    // SL touch tracking (SL was touched but trade continued if within 150% zone)
    slTouched: boolean;
    slTouchTime?: string;
    slTouchPrice?: number;

    // All TP levels hit (in order)
    tpHits: PostMortemTPHit[];

    // Trade metrics
    entryPrice: number;
    stopLoss: number;
    maxDrawdown: number;
    timeToOutcome?: string;
    pnlPercent?: number;
    rrRatio?: number;

    // HISTORICAL indicators at exit time (NOT current)
    indicatorsAtExit?: IndicatorsAtExit;

    // Summary for AI prompt injection
    validationSummary: string;

    // Data metrics for transparency
    candlesEvaluated: number;
    dataRange: string;

    // Mismatch Flag (User says LOSS but price says WIN because TP hit first)
    isMismatch?: boolean;
}

/**
 * Validate trade outcome for post-mortem analysis
 * 
 * Key differences from simulateFromAnalysisTime:
 * 1. Uses 150% extended SL zone (same as backtesting)
 * 2. Once ANY TP is hit, SL tracking STOPS (trade is a WIN)
 * 3. Continues tracking TP2/TP3 after TP1 hit
 * 4. Calculates indicators at EXIT time using historical candles
 * 5. RESPECTS USER'S LOGGED OUTCOME - if user logs LOSS, indicators use SL; if WIN, use TP
 * 
 * @param analysis - The trade analysis with entry, SL, and TP levels
 * @param symbol - Trading pair (e.g., 'BTCUSDT')
 * @param analysisTimestamp - ISO timestamp when the trade was analyzed
 * @param userOutcome - Optional user-logged outcome ('WIN' or 'LOSS') to determine which exit to use for indicators
 */
export const validateTradeOutcome = async (
    analysis: TradeAnalysis,
    symbol: string,
    analysisTimestamp: string,
    userOutcome?: 'WIN' | 'LOSS'
): Promise<TradeOutcomeValidation> => {
    const analysisTime = new Date(analysisTimestamp).getTime();
    console.log(`[PostMortemValidation] Validating trade outcome for ${symbol} from ${analysisTimestamp}${userOutcome ? ` (user logged: ${userOutcome})` : ''}`);

    try {
        // Use same 3-Tier Hybrid Fetch as backtesting
        const alignedStartTime = alignToIntervalStart(analysisTime, getIntervalMs('1m'));

        // Tier 1: 1-minute candles (500 = ~8 hours precision)
        const klines1m = await fetchOHLCVFromTime(symbol, '1m', alignedStartTime);
        const limited1m = klines1m.slice(0, 500);

        // Tier 2: 15-minute candles (250 = ~2.6 days medium)
        const tier2StartTime = limited1m.length > 0
            ? limited1m[limited1m.length - 1].time + getIntervalMs('1m')
            : alignedStartTime + 500 * getIntervalMs('1m');
        const klines15m = await fetchOHLCVFromTime(symbol, '15m', tier2StartTime);
        const limited15m = klines15m.slice(0, 250);

        // Tier 3: 1-hour candles (500 = ~20 days extended)
        const tier3StartTime = limited15m.length > 0
            ? limited15m[limited15m.length - 1].time + getIntervalMs('15m')
            : tier2StartTime + 250 * getIntervalMs('15m');
        const klines1h = await fetchOHLCVFromTime(symbol, '1h', tier3StartTime);
        const limited1h = klines1h.slice(0, 500);

        // Merge all tiers
        const klines = [...limited1m, ...limited15m, ...limited1h];

        console.log(`[PostMortemValidation] Fetched ${limited1m.length}×1m + ${limited15m.length}×15m + ${limited1h.length}×1h = ${klines.length} candles`);

        // Parse trade parameters
        const entryPrice = analysis.entryPoints?.[0]?.price
            ? parsePrice(analysis.entryPoints[0].price)
            : 0;
        const stopLoss = parsePrice(analysis.stopLoss);
        const tp1 = analysis.takeProfit?.[0]?.price ? parsePrice(analysis.takeProfit[0].price) : 0;
        const tp2 = analysis.takeProfit?.[1]?.price ? parsePrice(analysis.takeProfit[1].price) : 0;
        const tp3 = analysis.takeProfit?.[2]?.price ? parsePrice(analysis.takeProfit[2].price) : 0;
        const isLong = analysis.direction === 'Long';

        // Calculate data range for summary
        const dataRange = klines.length > 0
            ? `${new Date(klines[0].time).toISOString()} to ${new Date(klines[klines.length - 1].time).toISOString()}`
            : 'No data';

        // Handle error cases
        if (klines.length < 1) {
            return {
                entryTriggered: false,
                outcome: 'ENTRY_NOT_HIT',
                hitTarget: 'NONE',
                tpHits: [],
                slTouched: false,
                entryPrice,
                stopLoss,
                maxDrawdown: 0,
                validationSummary: `⚠️ No market data available for ${symbol}. Cannot validate trade outcome.`,
                candlesEvaluated: 0,
                dataRange,
                isMismatch: false
            };
        }

        if (entryPrice === 0 || stopLoss === 0) {
            return {
                entryTriggered: false,
                outcome: 'ENTRY_NOT_HIT',
                hitTarget: 'NONE',
                tpHits: [],
                slTouched: false,
                entryPrice,
                stopLoss,
                maxDrawdown: 0,
                validationSummary: `⚠️ Invalid trade parameters. Entry: ${entryPrice}, SL: ${stopLoss}`,
                candlesEvaluated: klines.length,
                dataRange,
                isMismatch: false
            };
        }

        // === ENTRY DETECTION PHASE ===
        let entryTriggeredAtIndex = -1;
        let entryTriggerTime: string | undefined;

        for (let i = 0; i < klines.length; i++) {
            const candle = klines[i];
            if (isLong) {
                if (candle.low <= entryPrice) {
                    entryTriggeredAtIndex = i;
                    entryTriggerTime = new Date(candle.time).toISOString();
                    break;
                }
            } else {
                if (candle.high >= entryPrice) {
                    entryTriggeredAtIndex = i;
                    entryTriggerTime = new Date(candle.time).toISOString();
                    break;
                }
            }
        }

        // Entry not triggered
        if (entryTriggeredAtIndex === -1) {
            return {
                entryTriggered: false,
                outcome: 'ENTRY_NOT_HIT',
                hitTarget: 'NONE',
                tpHits: [],
                slTouched: false,
                entryPrice,
                stopLoss,
                maxDrawdown: 0,
                validationSummary: `⏳ Entry price $${entryPrice.toLocaleString()} was never reached. Trade was not executed.`,
                candlesEvaluated: klines.length,
                dataRange,
                isMismatch: false
            };
        }

        // === ENTRY CONFIRMED - SCAN FOR SL/TP ===
        console.log(`[PostMortemValidation] Entry triggered at candle #${entryTriggeredAtIndex}`);

        let maxDrawdown = 0;
        let slTouched = false;  // Track if initial SL was touched
        let slTouchIndex: number | undefined;
        let slTouchTime: string | undefined;
        let slTouchPrice: number | undefined;
        let extendedSlExceeded = false;  // Track if 150% extended zone was breached
        let slExceededIndex: number | undefined;
        let slExceededTime: string | undefined;
        const tpHits: PostMortemTPHit[] = [];
        let tp1Hit = false, tp2Hit = false, tp3Hit = false;

        // Calculate 150% extended SL zone (same as backtesting)
        const slDistance = Math.abs(entryPrice - stopLoss);
        const extendedSlPrice = isLong
            ? stopLoss - (slDistance * 0.5)  // 150% of SL distance below entry for Long
            : stopLoss + (slDistance * 0.5); // 150% of SL distance above entry for Short

        console.log(`[PostMortemValidation] SL: $${stopLoss}, Extended SL (150%): $${extendedSlPrice}`);

        // Scan from entry candle onwards - continue even after SL touch until 150% exceeded or TP hit
        for (let i = entryTriggeredAtIndex; i < klines.length; i++) {
            const candle = klines[i];
            const candleTimeStr = new Date(candle.time).toISOString();
            const timeAfterEntry = formatDuration(candle.time - klines[entryTriggeredAtIndex].time);

            if (isLong) {
                // Calculate drawdown
                const dd = (entryPrice - candle.low) / entryPrice * 100;
                maxDrawdown = Math.max(maxDrawdown, dd);

                // Check TPs FIRST (same candle: if both TP and SL could hit, TP wins)
                if (!tp1Hit && tp1 > 0 && candle.high >= tp1) {
                    tp1Hit = true;
                    tpHits.push({
                        level: 'TP1',
                        price: tp1,
                        candleIndex: i,
                        candleTime: candleTimeStr,
                        timeAfterEntry
                    });
                    console.log(`[PostMortemValidation] TP1 hit at $${tp1}${slTouched ? ' (after SL touch)' : ''}`);
                }
                if (!tp2Hit && tp2 > 0 && candle.high >= tp2) {
                    tp2Hit = true;
                    tpHits.push({
                        level: 'TP2',
                        price: tp2,
                        candleIndex: i,
                        candleTime: candleTimeStr,
                        timeAfterEntry
                    });
                    console.log(`[PostMortemValidation] TP2 hit at $${tp2}`);
                }
                if (!tp3Hit && tp3 > 0 && candle.high >= tp3) {
                    tp3Hit = true;
                    tpHits.push({
                        level: 'TP3',
                        price: tp3,
                        candleIndex: i,
                        candleTime: candleTimeStr,
                        timeAfterEntry
                    });
                    console.log(`[PostMortemValidation] TP3 hit at $${tp3}`);
                    break; // All TPs hit - stop scanning
                }



                // Check if 150% extended zone exceeded - hard stop LOSS
                if (candle.low <= extendedSlPrice) {
                    extendedSlExceeded = true;
                    slExceededIndex = i;
                    slExceededTime = candleTimeStr;
                    console.log(`[PostMortemValidation] 150% extended SL exceeded at $${extendedSlPrice}`);
                    break;
                }

                // Check if initial SL touched (but within 150% zone - continue tracking)
                if (!slTouched && candle.low <= stopLoss) {
                    slTouched = true;
                    slTouchIndex = i;
                    slTouchTime = candleTimeStr;
                    slTouchPrice = stopLoss;
                    console.log(`[PostMortemValidation] SL touched at $${stopLoss} (continuing within 150% zone)`);
                    // DON'T break - continue scanning for TP or 150% breach
                }
            } else {
                // Short position
                const dd = (candle.high - entryPrice) / entryPrice * 100;
                maxDrawdown = Math.max(maxDrawdown, dd);

                // Check TPs FIRST
                if (!tp1Hit && tp1 > 0 && candle.low <= tp1) {
                    tp1Hit = true;
                    tpHits.push({
                        level: 'TP1',
                        price: tp1,
                        candleIndex: i,
                        candleTime: candleTimeStr,
                        timeAfterEntry
                    });
                    console.log(`[PostMortemValidation] TP1 (SHORT) hit at $${tp1}${slTouched ? ' (after SL touch)' : ''}`);
                }
                if (!tp2Hit && tp2 > 0 && candle.low <= tp2) {
                    tp2Hit = true;
                    tpHits.push({
                        level: 'TP2',
                        price: tp2,
                        candleIndex: i,
                        candleTime: candleTimeStr,
                        timeAfterEntry
                    });
                    console.log(`[PostMortemValidation] TP2 (SHORT) hit at $${tp2}`);
                }
                if (!tp3Hit && tp3 > 0 && candle.low <= tp3) {
                    tp3Hit = true;
                    tpHits.push({
                        level: 'TP3',
                        price: tp3,
                        candleIndex: i,
                        candleTime: candleTimeStr,
                        timeAfterEntry
                    });
                    console.log(`[PostMortemValidation] TP3 (SHORT) hit at $${tp3}`);
                    break;
                }



                // Check if 150% extended zone exceeded - hard stop LOSS
                if (candle.high >= extendedSlPrice) {
                    extendedSlExceeded = true;
                    slExceededIndex = i;
                    slExceededTime = candleTimeStr;
                    console.log(`[PostMortemValidation] 150% extended SL (SHORT) exceeded at $${extendedSlPrice}`);
                    break;
                }

                // Check if initial SL touched (but within 150% zone - continue tracking)
                if (!slTouched && candle.high >= stopLoss) {
                    slTouched = true;
                    slTouchIndex = i;
                    slTouchTime = candleTimeStr;
                    slTouchPrice = stopLoss;
                    console.log(`[PostMortemValidation] SL (SHORT) touched at $${stopLoss} (continuing within 150% zone)`);
                }
            }
        }

        // === DETERMINE OUTCOME (STRICT USER PRIORITY) ===
        let outcome: TradeOutcomeValidation['outcome'] = 'OPEN';
        let hitTarget: TradeOutcomeValidation['hitTarget'] = 'NONE';
        let exitPrice: number | undefined;
        let exitTime: string | undefined;
        let exitCandleIndex: number | undefined;
        let isMismatch = false;

        if (userOutcome === 'LOSS') {
            // User says LOSS: Check for "TP First" scenario which implies Mismatch/User Error

            let tpFirst = false;
            if (tpHits.length > 0) {
                const firstTpTime = new Date(tpHits[0].candleTime).getTime();
                const slTime = slTouched && slTouchTime ? new Date(slTouchTime).getTime() : Infinity;
                const extendedSlTime = extendedSlExceeded && slExceededTime ? new Date(slExceededTime).getTime() : Infinity;

                // If TP hit before BOTH SL types (or SL never hit)
                if (firstTpTime < slTime && firstTpTime < extendedSlTime) {
                    tpFirst = true;
                    console.log(`[PostMortemValidation] User LOSS but TP hit FIRST at ${tpHits[0].candleTime}. Flagging as WIN (Mismatch).`);
                }
            }

            if (tpFirst) {
                // TP hit BEFORE SL. User said LOSS. Likely a mistake or they want to choose.
                // Return WIN (Price Truth) -> App will detect mismatch (User LOSS vs Price WIN).
                outcome = 'WIN';
                isMismatch = true; // Flag for UI to verify
                // Pick the TP that hit first (or last if trailing? Logic says "TP Hit" usually means exit)
                const tp = tpHits[0]; // First TP hit is the "Win" event
                hitTarget = tp.level;
                exitPrice = tp.price;
                exitTime = tp.candleTime;
                exitCandleIndex = tp.candleIndex;
            } else if (extendedSlExceeded && slExceededIndex !== undefined) {
                // Priority 1: 150% Extended SL hit
                outcome = 'LOSS';
                hitTarget = 'SL';
                exitPrice = extendedSlPrice;
                exitTime = slExceededTime;
                exitCandleIndex = slExceededIndex;
                console.log(`[PostMortemValidation] User LOSS: Found 150% SL exceed at ${exitPrice}`);
            } else if (slTouched && slTouchIndex !== undefined) {
                // Priority 2: Original SL touched (even if TP hit earlier - BUT wait, we handled TP first above!)
                // If we get here, it means TP didn't hit, OR TP hit after SL.

                outcome = 'LOSS';
                hitTarget = 'SL';
                exitPrice = slTouchPrice ?? stopLoss; // Use touch price (usually SL level)
                exitTime = slTouchTime;
                exitCandleIndex = slTouchIndex;
                console.log(`[PostMortemValidation] User LOSS: Found Original SL touch at ${exitPrice}`);
            } else {
                // Mismatch: User says LOSS but we didn't find any SL touch (and no TP First)
                console.log(`[PostMortemValidation] User LOSS but no SL touch found. Remaining OPEN.`);
            }
        } else if (userOutcome === 'WIN') {
            // User says WIN: Look for TP events.
            if (tpHits.length > 0) {
                // Found TP hit
                const lastTp = tpHits[tpHits.length - 1]; // Or first? Usually last hit is exit.
                // Actually, usually exit is the LAST TP hit if they trailed?
                // Or FIRST? "If the trade is logged as a win and the TP is hit first"
                // Let's use the HIGHEST TP hit.
                outcome = 'WIN';
                hitTarget = lastTp.level;
                exitPrice = lastTp.price;
                exitTime = lastTp.candleTime;
                exitCandleIndex = lastTp.candleIndex;
                console.log(`[PostMortemValidation] User WIN: Found TP hit (${hitTarget})`);
            } else {
                // Mismatch: User says WIN but no TP found
                console.log(`[PostMortemValidation] User WIN but no TP hit found.`);
            }
        } else {
            // No User Outcome (or undefined/OPEN): Standard Logic
            // TP hit first -> WIN. 150% SL -> LOSS.
            if (tpHits.length > 0) {
                outcome = 'WIN';
                const lastTp = tpHits[tpHits.length - 1];
                hitTarget = lastTp.level;
                exitPrice = lastTp.price;
                exitTime = lastTp.candleTime;
                exitCandleIndex = lastTp.candleIndex;
            } else if (extendedSlExceeded && slExceededIndex !== undefined) {
                outcome = 'LOSS';
                hitTarget = 'SL';
                exitPrice = extendedSlPrice;
                exitTime = slExceededTime;
                exitCandleIndex = slExceededIndex;
            }
        }

        // Calculate P&L and R:R (slDistance already calculated above)
        let pnlPercent: number | undefined;
        let rrRatio: number | undefined;

        if (exitPrice !== undefined && slDistance > 0) {
            const pnl = isLong ? (exitPrice - entryPrice) : (entryPrice - exitPrice);
            pnlPercent = (pnl / entryPrice) * 100;
            rrRatio = pnl / slDistance;
        }

        // Calculate time to outcome
        let timeToOutcome: string | undefined;
        if (exitCandleIndex !== undefined) {
            const exitCandle = klines[exitCandleIndex];
            timeToOutcome = formatDuration(exitCandle.time - klines[entryTriggeredAtIndex].time);
        }

        // === CALCULATE INDICATORS AT EXIT TIME ===
        let indicatorsAtExit: IndicatorsAtExit | undefined;

        if (exitCandleIndex !== undefined && exitCandleIndex >= 20) {
            // Get candles UP TO exit point (not current)
            const candlesForIndicators = klines.slice(0, exitCandleIndex + 1);
            const closes = candlesForIndicators.map(k => k.close);
            const highs = candlesForIndicators.map(k => k.high);
            const lows = candlesForIndicators.map(k => k.low);
            const volumes = candlesForIndicators.map(k => k.volume);

            // Import indicator calculations (inline to avoid circular deps)
            try {
                const { RSI, MACD, EMA, ATR } = await import('technicalindicators');

                const rsi14Values = RSI.calculate({ values: closes, period: 14 });
                const macdValues = MACD.calculate({
                    values: closes,
                    fastPeriod: 12,
                    slowPeriod: 26,
                    signalPeriod: 9,
                    SimpleMAOscillator: false,
                    SimpleMASignal: false
                });
                const ema20Values = EMA.calculate({ values: closes, period: 20 });
                const ema50Values = EMA.calculate({ values: closes, period: 50 });
                const ema200Values = closes.length >= 200 ? EMA.calculate({ values: closes, period: 200 }) : [];
                const atrValues = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 });

                // Volume analysis
                const avgVolume = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
                const currentVolume = volumes[volumes.length - 1];
                const volumeTrend: 'high' | 'low' | 'normal' = currentVolume > avgVolume * 1.5 ? 'high'
                    : currentVolume < avgVolume * 0.5 ? 'low' : 'normal';

                const lastPrice = closes[closes.length - 1];
                const ema20 = ema20Values[ema20Values.length - 1] || 0;
                const ema50 = ema50Values[ema50Values.length - 1] || 0;

                indicatorsAtExit = {
                    rsi14: Math.round((rsi14Values[rsi14Values.length - 1] || 50) * 10) / 10,
                    macdHistogram: Math.round((macdValues[macdValues.length - 1]?.histogram || 0) * 100) / 100,
                    macdDif: Math.round((macdValues[macdValues.length - 1]?.MACD || 0) * 100) / 100,
                    macdDea: Math.round((macdValues[macdValues.length - 1]?.signal || 0) * 100) / 100,
                    ema20: Math.round(ema20 * 100) / 100,
                    ema50: Math.round(ema50 * 100) / 100,
                    ema200: Math.round((ema200Values[ema200Values.length - 1] || 0) * 100) / 100,
                    atr: Math.round((atrValues[atrValues.length - 1] || 0) * 100) / 100,
                    volumeTrend,
                    priceVsEma20: lastPrice > ema20 ? 'above' : 'below',
                    priceVsEma50: lastPrice > ema50 ? 'above' : 'below'
                };

                console.log(`[PostMortemValidation] Indicators at exit:`, indicatorsAtExit);
            } catch (err) {
                console.warn('[PostMortemValidation] Could not calculate indicators:', err);
            }
        }

        // === GENERATE VALIDATION SUMMARY ===
        let validationSummary = '';

        if (outcome === 'WIN') {
            validationSummary = `✅ **PRICE-VALIDATED WIN**\n` +
                `Entry: $${entryPrice.toLocaleString()} triggered at ${entryTriggerTime}\n` +
                `Exit: ${hitTarget} hit at $${exitPrice?.toLocaleString()} (${timeToOutcome})\n` +
                `P&L: ${pnlPercent !== undefined ? (pnlPercent >= 0 ? '+' : '') + pnlPercent.toFixed(2) : 'N/A'}%\n` +
                `R:R: ${rrRatio !== undefined ? (rrRatio >= 0 ? '+' : '') + rrRatio.toFixed(2) : 'N/A'}R\n` +
                `Max Drawdown: ${maxDrawdown.toFixed(2)}%\n` +
                (tpHits.length > 1 ? `TP Progression: ${tpHits.map(t => t.level).join(' → ')}\n` : '');

            // Add note if SL was touched before hitting TP
            if (slTouched) {
                validationSummary += `\n🚨 **NOTE:** Original SL ($${stopLoss.toLocaleString()}) was touched at ${slTouchTime}, but price recovered within 150% zone to hit TP.`;
            }
        } else if (outcome === 'LOSS') {
            validationSummary = `❌ **PRICE-VALIDATED LOSS**\n` +
                `Entry: $${entryPrice.toLocaleString()} triggered at ${entryTriggerTime}\n` +
                `Exit: 150% extended SL exceeded at $${extendedSlPrice.toLocaleString()} (${timeToOutcome})\n` +
                `Original SL: $${stopLoss.toLocaleString()} | Extended SL (150%): $${extendedSlPrice.toLocaleString()}\n` +
                `P&L: ${pnlPercent !== undefined ? pnlPercent.toFixed(2) : 'N/A'}%\n` +
                `R:R: ${rrRatio !== undefined ? rrRatio.toFixed(2) : 'N/A'}R\n` +
                `Max Drawdown: ${maxDrawdown.toFixed(2)}%`;
        } else if (outcome === 'OPEN') {
            const lastCandle = klines[klines.length - 1];
            validationSummary = `⏳ **TRADE STILL OPEN**\n` +
                `Entry: $${entryPrice.toLocaleString()} triggered at ${entryTriggerTime}\n` +
                `Current: $${lastCandle.close.toLocaleString()}\n` +
                `Neither SL ($${stopLoss.toLocaleString()}) nor TP hit yet.\n` +
                `Max Drawdown: ${maxDrawdown.toFixed(2)}%`;

            if (slTouched) {
                validationSummary += `\n🚨 **NOTE:** SL was touched at ${slTouchTime} but price is still within 150% zone.`;
            }
        }

        if (indicatorsAtExit) {
            validationSummary += `\n\n📊 **Indicators at Exit:**\n` +
                `RSI(14): ${indicatorsAtExit.rsi14} | MACD: ${indicatorsAtExit.macdHistogram}\n` +
                `EMA20: $${indicatorsAtExit.ema20} | EMA50: $${indicatorsAtExit.ema50}\n` +
                `ATR: $${indicatorsAtExit.atr} | Volume: ${indicatorsAtExit.volumeTrend}`;
        }

        return {
            entryTriggered: true,
            entryTriggerTime,
            entryTriggerCandleIndex: entryTriggeredAtIndex,
            outcome,
            hitTarget,
            exitPrice,
            exitTime,
            exitCandleIndex,
            slTouched,
            slTouchTime,
            slTouchPrice,
            tpHits,
            entryPrice,
            stopLoss,
            maxDrawdown: Math.round(maxDrawdown * 100) / 100,
            timeToOutcome,
            pnlPercent: pnlPercent !== undefined ? Math.round(pnlPercent * 100) / 100 : undefined,
            rrRatio: rrRatio !== undefined ? Math.round(rrRatio * 100) / 100 : undefined,
            indicatorsAtExit,
            validationSummary,
            candlesEvaluated: klines.length,
            dataRange,
            isMismatch
        };

    } catch (error) {
        console.error('[PostMortemValidation] Validation failed:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        return {
            entryTriggered: false,
            outcome: 'ENTRY_NOT_HIT',
            hitTarget: 'NONE',
            tpHits: [],
            slTouched: false,
            entryPrice: 0,
            stopLoss: 0,
            maxDrawdown: 0,
            validationSummary: `⚠️ Validation failed: ${errorMessage}`,
            candlesEvaluated: 0,
            dataRange: 'Error'
        };
    }
};

