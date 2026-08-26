/**
 * HybridIntelligenceService - Orchestrates real data + AI analysis
 * Bridges MarketDataService and TechnicalAnalysisService with AI prompts
 * 
 * ENHANCED VERSION - Includes:
 * - Derivatives data (Open Interest, Long/Short Ratios)
 * - Advanced Volume Analysis (OBV, CVD, Volume Profile)
 * - Market Regime Detection (ADX)
 * - Enhanced Key Levels (Pivots, Fibonacci)
 * - VWAP, Ichimoku, Momentum
 * - Session Context
 * - Confidence Calibration injection
 */

import {
    fetchCompleteMarketSnapshot,
    extractSymbolFromPrompt,
    MarketData,
    DerivativesData,
    fetchDerivativesData,
    OrderBookData,
    LiquidationData,
    fetchOrderBookDepth,
    fetchRecentLiquidations,
    Kline
} from './MarketDataService';

import {
    calculateIndicators,
    calculateKeyLevels,
    calculateConfluenceScore,
    TechnicalIndicators,
    ConfluenceResult,
    // New imports
    AdvancedVolumeAnalysis,
    RegimeAnalysis,
    KeyLevelsEnhanced,
    VWAPData,
    IchimokuData,
    MomentumIndicators,
    calculateAdvancedVolume,
    calculateRegime,
    calculateEnhancedKeyLevels,
    calculateVWAP,
    calculateIchimoku,
    calculateMomentum,
    FibonacciLevels
} from './TechnicalAnalysisService';

import {
    classifyPattern,
    ClassificationResult,
    PatternFamily
} from './PatternClassificationService';

import {
    scanCandlePatterns,
    CandlePatternScan
} from './CandlePatternDetector';

import { parsePrice as canonicalParsePrice } from '../../utils/analysisUtils';

import { getSessionContext, SessionContext } from '../infrastructure/SessionService';
import { ConfidenceCalibration } from '../../types';
import {
    generateCalibrationPromptInjection,
    generateGranularCalibrationPrompt,
    generateEnhancedCalibrationPromptInjection,
    getProviderAccuracyContext,
    generateSessionCalibrationPrompt,
    ConfidenceLevel
} from '../validation/ConfidenceCalibrationService';

import { generateValidationPromptInjection, generateCorrelationRiskPrompt } from '../validation/AccuracyValidationService';
import { calculateCorrelationRisk } from './CorrelationRiskService';
import {
    INVALIDATION_THESIS_PROMPT,
    CORRELATION_AWARENESS_PROMPT
} from '../../constants/prompts';
import {
    runSimulation,
    runSimulationAsync,
    generateMonteCarloPromptInjection,
    MonteCarloResult,
    SimulationConfig
} from './MonteCarloService';



import {
    NumericChartData,
    generateNumericChartData,
    generateChartPromptInjection
} from './NumericChartService';
import { HARNESS_TIMEFRAMES, HarnessTimeframe } from '../../constants/harnessDataContract';

/**
 * Enhanced Hybrid Data Packet with all new data sources
 */
/**
 * The timeframe set used across the hybrid payload: 15m (structure + entry),
 * 1h (intraday bias/key levels), 4h (HTF bias), 1d (macro trend/regime anchor).
 * 5m was dropped — it was the noisiest signal in the payload — and 1d added
 * the macro context the injection previously lacked entirely.
 */
export type HybridTimeframe = HarnessTimeframe;

export interface HybridDataPacket {
    symbol: string;
    marketData: MarketData;

    // Core Technical Indicators (per timeframe)
    indicators: Record<HybridTimeframe, TechnicalIndicators>;

    // Legacy key levels (for backwards compatibility)
    keyLevels: {
        support: number[];
        resistance: number[];
    };

    confluence: ConfluenceResult;
    fundingRate: number;
    fundingRateSentiment: 'bullish' | 'bearish' | 'neutral';
    dataTimestamp: string;
    dataQuality?: {
        status: 'complete' | 'degraded';
        unavailableSources: string[];
        checkedAt: string;
    };

    // ========== NEW ENHANCED DATA ==========

    // Derivatives market data
    derivatives: DerivativesData;

    // Advanced volume analysis (using 1H data as primary)
    advancedVolume: AdvancedVolumeAnalysis;

    // Market regime (using 1H data as primary)
    regime: RegimeAnalysis;

    // Enhanced key levels with multiple sources
    enhancedKeyLevels: KeyLevelsEnhanced;

    // VWAP analysis
    vwap: {
        '1h': VWAPData;
    };

    // Ichimoku Cloud
    ichimoku: {
        '1h': IchimokuData;
        '4h': IchimokuData;
    };

    // Momentum indicators
    momentum: {
        '1h': MomentumIndicators;
        '4h': MomentumIndicators;
    };

    // Trading session context
    session: SessionContext;

    // ========== ORDER FLOW DATA ==========

    // Order Book Depth - Buy/sell walls and liquidity
    orderBook: OrderBookData;

    // Recent Liquidations - Forced position closures
    liquidations: LiquidationData;

    // ========== MONTE CARLO SIMULATION ==========
    // Optional: Only populated when trade setup is detected
    monteCarlo?: MonteCarloResult;

    // ========== NUMERIC CHART REPRESENTATION ==========
    // Feature-based + State-based chart view for AI understanding
    chartRepresentation?: Record<HybridTimeframe, NumericChartData>;

    // ========== PATTERN CLASSIFICATION ==========
    // ML-based classification of the setup
    patternClassification: ClassificationResult;

    // ========== CANDLE HISTORY ANALYSIS ==========
    // Last 30 completed candles per timeframe (excludes current incomplete candle)
    candleHistory: Record<HybridTimeframe, CandleHistory>;

    // ========== DETECTED CANDLE PATTERNS ==========
    // Named classical patterns (pin bar, double top, BOS, …) over the
    // last 30 completed candles per timeframe. This is the "what a human
    // trader would see" layer that lets the model reason about structure
    // it could not derive from indicators alone.
    detectedPatterns: Record<HybridTimeframe, CandlePatternScan>;

    // ========== LIQUIDITY SWEEPS ==========
    // Level-anchored price-action events from the last completed candle per
    // timeframe (wick-through-and-reject, or close-beyond breaks).
    liquiditySweeps: LiquiditySweep[];

    // ========== MARKET CONTEXT ==========
    // The "where are we in the week/month" layer every human trader checks
    // first: current week/month opens + ranges, previous week/month ranges.
    marketContext: MarketContext;

    /** Live 1h candle progress — computed at fetch time (klines are not
     *  carried on the packet, so the injection cannot derive it). */
    live1h?: { open: number; high: number; low: number; price: number; minutesLeft: number; percentTraveled: number };
}

/** A price range derived from a kline window. */
export interface PriceRange {
    open: number;
    high: number;
    low: number;
}

export interface MarketContext {
    week: PriceRange | null;       // current UTC week (Mon 00:00 → now)
    prevWeek: { high: number; low: number } | null;
    month: PriceRange | null;      // current UTC month (1st 00:00 → now)
    prevMonth: { high: number; low: number } | null;
}

/**
 * Build weekly/monthly market context from 1h klines (UTC boundaries).
 * The current candle is included (it is the live candle — its open is the
 * period open when the period started this week/month).
 */
export const buildMarketContext = (klines1h: Kline[], now = new Date()): MarketContext => {
    const dayMs = 86400000;
    const utcDayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const dayOfWeek = (now.getUTCDay() + 6) % 7; // 0 = Monday
    const weekStart = utcDayStart - dayOfWeek * dayMs;
    const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
    const prevMonthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1);

    const range = (start: number, end: number): PriceRange | null => {
        const candles = klines1h.filter(k => k.time >= start && k.time < end);
        if (candles.length === 0) return null;
        return {
            open: candles[0].open,
            high: Math.max(...candles.map(k => k.high)),
            low: Math.min(...candles.map(k => k.low)),
        };
    };
    const rangeHL = (start: number, end: number): { high: number; low: number } | null => {
        const candles = klines1h.filter(k => k.time >= start && k.time < end);
        if (candles.length === 0) return null;
        return {
            high: Math.max(...candles.map(k => k.high)),
            low: Math.min(...candles.map(k => k.low)),
        };
    };

    return {
        week: range(weekStart, now.getTime() + dayMs),
        prevWeek: rangeHL(weekStart - 7 * dayMs, weekStart),
        month: range(monthStart, now.getTime() + dayMs),
        prevMonth: rangeHL(prevMonthStart, monthStart),
    };
};

/**
 * Candle history analysis for a single timeframe
 */
interface CandleHistory {
    sequence: ('🟢' | '🔴')[]; // Bullish/Bearish sequence, oldest first
    bullishCount: number;
    bearishCount: number;
    summary: string;           // "12 Bullish, 8 Bearish"
    dominantTrend: 'bullish' | 'bearish' | 'neutral'; // >55% = dominant
}

/**
 * Analyze the last N completed candles for bullish/bearish pattern
 * @param klines - Kline data array (newest last)
 * @param candleCount - Number of candles to analyze (default: 30)
 * @returns CandleHistory object
 */
const analyzeCandleHistory = (klines: any[], candleCount: number = 30): CandleHistory => {
    // Safety check: if insufficient data, return empty analysis
    if (!klines || klines.length < 2) {
        return {
            sequence: [],
            bullishCount: 0,
            bearishCount: 0,
            summary: 'Insufficient data',
            dominantTrend: 'neutral'
        };
    }

    // Exclude the LAST candle (current incomplete candle)
    // Take up to `candleCount` completed candles before it
    const completedCandles = klines.slice(
        Math.max(0, klines.length - 1 - candleCount),
        klines.length - 1
    );

    let bullishCount = 0;
    let bearishCount = 0;
    const sequence: ('🟢' | '🔴')[] = [];

    for (const candle of completedCandles) {
        const open = parseFloat(candle.open);
        const close = parseFloat(candle.close);

        if (close > open) {
            sequence.push('🟢');
            bullishCount++;
        } else {
            // Treat doji (close === open) as bearish for simplicity
            sequence.push('🔴');
            bearishCount++;
        }
    }

    const total = bullishCount + bearishCount;
    const bullishPercent = total > 0 ? (bullishCount / total) * 100 : 50;

    let dominantTrend: 'bullish' | 'bearish' | 'neutral';
    if (bullishPercent > 60) {
        dominantTrend = 'bullish';
    } else if (bullishPercent < 40) {
        dominantTrend = 'bearish';
    } else {
        dominantTrend = 'neutral';
    }

    return {
        sequence,
        bullishCount,
        bearishCount,
        summary: `${bullishCount} Bullish, ${bearishCount} Bearish`,
        dominantTrend
    };
};

/**
 * Fetch all hybrid intelligence data for a symbol
 */
export const fetchHybridData = async (symbol: string): Promise<HybridDataPacket> => {
    console.log(`[HybridIntelligence] Fetching enhanced data for ${symbol}...`);

    // Fetch market data, klines, and order flow in parallel
    const [snapshot, derivatives, orderBook, liquidations] = await Promise.all([
        fetchCompleteMarketSnapshot(symbol),
        fetchDerivativesData(symbol),
        fetchOrderBookDepth(symbol),
        fetchRecentLiquidations(symbol)
    ]);

    const unavailableSources: string[] = [];
    if (!snapshot.availability.marketData) unavailableSources.push('current market ticker');
    for (const timeframe of HARNESS_TIMEFRAMES) {
        if (!snapshot.availability.klines[timeframe]) unavailableSources.push(`${timeframe} candles`);
    }
    if (!snapshot.availability.fundingRate) unavailableSources.push('funding rate');
    if (derivatives.available === false) unavailableSources.push('derivatives');
    if (orderBook.available === false) unavailableSources.push('order book');
    if (liquidations.available === false) unavailableSources.push('liquidations');

    // Calculate core TA for each timeframe
    const indicators15m = calculateIndicators(snapshot.klines['15m']);
    const indicators1h = calculateIndicators(snapshot.klines['1h']);
    const indicators4h = calculateIndicators(snapshot.klines['4h']);
    const indicators1d = calculateIndicators(snapshot.klines['1d']);

    // Legacy key levels (for backwards compatibility)
    const keyLevels = calculateKeyLevels(snapshot.klines['4h']);

    // Calculate multi-timeframe confluence score
    const confluence = calculateConfluenceScore({
        '15m': indicators15m,
        '1h': indicators1h,
        '4h': indicators4h,
        '1d': indicators1d
    });

    // Interpret funding rate
    const fundingRateSentiment = snapshot.fundingRate > 0.0005 ? 'bullish'
        : snapshot.fundingRate < -0.0005 ? 'bearish'
            : 'neutral';

    // ========== CALCULATE NEW ENHANCED DATA ==========

    // Advanced Volume Analysis (using 1H for primary analysis)
    const advancedVolume = calculateAdvancedVolume(snapshot.klines['1h']);

    // Market Regime (using 1H for primary)
    const regime = calculateRegime(snapshot.klines['1h']);

    // Enhanced Key Levels
    const enhancedKeyLevels = calculateEnhancedKeyLevels(snapshot.klines['4h'], '4h');

    // VWAP
    const vwap1h = calculateVWAP(snapshot.klines['1h']);

    // Ichimoku
    const ichimoku1h = calculateIchimoku(snapshot.klines['1h']);
    const ichimoku4h = calculateIchimoku(snapshot.klines['4h']);

    // Momentum
    const momentum1h = calculateMomentum(snapshot.klines['1h']);
    const momentum4h = calculateMomentum(snapshot.klines['4h']);

    // Session Context
    const session = getSessionContext();

    console.log(`[HybridIntelligence] Enhanced data fetched for ${symbol}`);
    console.log(`  - Confluence: ${confluence.score}/100 ${confluence.direction}`);
    console.log(`  - Regime: ${regime.regime} (ADX: ${regime.adx})`);
    console.log(`  - Derivatives Sentiment: ${derivatives.overallSentiment} (Score: ${derivatives.sentimentScore})`);
    console.log(`  - Order Book: ${orderBook.dominantSide} (Imbalance: ${orderBook.depthImbalance.toFixed(2)})`);
    console.log(`  - Liquidations: ${liquidations.liquidationPressure} pressure`);
    console.log(`  - Session: ${session.sessionName} (${session.suggestedAction})`);

    // Candle History Analysis (last 30 completed candles per timeframe)
    // NOTE: Each timeframe uses its OWN kline data, not shared
    const candleHistory = {
        '15m': analyzeCandleHistory(snapshot.klines['15m']),
        '1h': analyzeCandleHistory(snapshot.klines['1h']),
        '4h': analyzeCandleHistory(snapshot.klines['4h']),
        '1d': analyzeCandleHistory(snapshot.klines['1d'])
    };

    // Detected Candle Patterns (last 30 completed candles per timeframe).
    // Runs the lightweight classical pattern detector over the same window
    // so the prompt can show the model what a human trader would see on
    // the chart: pin bars, double tops, BOS, engulfings, etc.
    const detectedPatterns = {
        '15m': scanCandlePatterns(snapshot.klines['15m'], 30),
        '1h': scanCandlePatterns(snapshot.klines['1h'], 30),
        '4h': scanCandlePatterns(snapshot.klines['4h'], 30),
        '1d': scanCandlePatterns(snapshot.klines['1d'], 30)
    };

    console.log(`  - Candle History: 1d=${candleHistory['1d'].summary}, 4h=${candleHistory['4h'].summary}, 1h=${candleHistory['1h'].summary}`);
    console.log(`  - Detected Patterns: 1d=${detectedPatterns['1d'].patterns.length} patterns, 4h=${detectedPatterns['4h'].patterns.length} patterns`);

    // Liquidity sweeps: did the last completed candle (per timeframe) wick
    // through a key level (24h high/low, recent swing) and reject, or close
    // beyond it? The "liquidity grab" read a human trader makes at a glance.
    // Weekly/monthly context — the "where are we" layer (UTC week/month
    // opens + ranges, previous period ranges) from 1h klines.
    const marketContext = buildMarketContext(snapshot.klines['1h']);

    // Live 1h candle progress (computed here — the packet carries no raw
    // klines, so the injection uses this snapshot).
    const live1hCandle = snapshot.klines['1h'][snapshot.klines['1h'].length - 1];
    const live1h = (() => {
        if (!live1hCandle) return undefined;
        const price = snapshot.marketData.currentPrice;
        const candleEnd = live1hCandle.time + 3600000;
        const minutesLeft = Math.max(0, Math.round((candleEnd - Date.now()) / 60000));
        const range = live1hCandle.high - live1hCandle.low;
        const traveled = range > 0 ? Math.min(100, Math.max(0, ((price - live1hCandle.low) / range) * 100)) : 0;
        return { open: live1hCandle.open, high: live1hCandle.high, low: live1hCandle.low, price, minutesLeft, percentTraveled: traveled };
    })();

    const liquiditySweeps = detectLiquiditySweeps(
        (['15m', '1h', '4h', '1d'] as const).map(tf => ({
            timeframe: tf,
            klines: snapshot.klines[tf],
            levels: [
                { price: snapshot.marketData.price24hHigh, label: '24h high' },
                { price: snapshot.marketData.price24hLow, label: '24h low' },
                ...(detectedPatterns[tf].recentSwingHigh !== undefined
                    ? [{ price: detectedPatterns[tf].recentSwingHigh!, label: 'swing high' }]
                    : []),
                ...(detectedPatterns[tf].recentSwingLow !== undefined
                    ? [{ price: detectedPatterns[tf].recentSwingLow!, label: 'swing low' }]
                    : [])
            ]
        }))
    );
    if (liquiditySweeps.length > 0) {
        console.log(`  - Liquidity Sweeps: ${liquiditySweeps.length} (${liquiditySweeps[0].timeframe}: ${liquiditySweeps[0].type})`);
    }

    // Create partial packet for classification (circular dependency workaround)
    const partialData: any = {
        symbol: snapshot.marketData.symbol,
        marketData: snapshot.marketData,
        indicators: { '15m': indicators15m, '1h': indicators1h, '4h': indicators4h, '1d': indicators1d },
        dataTimestamp: new Date().toISOString(),
        regime,
        advancedVolume,
        momentum: { '1h': momentum1h, '4h': momentum4h }
    };

    // Run Pattern Classification
    const patternClassification = classifyPattern(partialData);
    console.log(`  - Classification: ${patternClassification.family} (${(patternClassification.confidence * 100).toFixed(0)}%)`);

    return {
        symbol: snapshot.marketData.symbol,
        marketData: snapshot.marketData,
        indicators: {
            '15m': indicators15m,
            '1h': indicators1h,
            '4h': indicators4h,
            '1d': indicators1d
        },
        keyLevels,
        confluence,
        fundingRate: snapshot.fundingRate,
        fundingRateSentiment,
        dataTimestamp: new Date().toISOString(),
        dataQuality: {
            status: unavailableSources.length > 0 ? 'degraded' : 'complete',
            unavailableSources,
            checkedAt: new Date().toISOString()
        },

        // Enhanced data
        derivatives,
        advancedVolume,
        regime,
        enhancedKeyLevels,
        vwap: {
            '1h': vwap1h
        },
        ichimoku: {
            '1h': ichimoku1h,
            '4h': ichimoku4h
        },
        momentum: {
            '1h': momentum1h,
            '4h': momentum4h
        },
        session,

        // Pattern Classification
        patternClassification,

        // Order Flow data
        orderBook,
        liquidations,

        // Numeric Chart Representation for AI understanding
        chartRepresentation: {
            '1d': generateNumericChartData(snapshot.klines['1d'], '1d'),
            '4h': generateNumericChartData(snapshot.klines['4h'], '4h'),
            '1h': generateNumericChartData(snapshot.klines['1h'], '1h'),
            '15m': generateNumericChartData(snapshot.klines['15m'], '15m')
        },
        // Candle History
        candleHistory,
        // Detected Candle Patterns (pin bar, double top, BOS, …)
        detectedPatterns,
        // Level-anchored liquidity sweep events (last completed candle per TF)
        liquiditySweeps,
        // Weekly/monthly market context
        marketContext,
        live1h
    };
};

/**
 * A level-anchored price-action event from the last completed candle:
 * either a wick swept through a key level and got rejected, or price closed
 * beyond the level (a genuine break). This is the "liquidity grab" read a
 * human trader makes at a glance.
 */
export interface LiquiditySweep {
    timeframe: HybridTimeframe;
    levelLabel: string;   // '24h high', 'swing low', …
    level: number;
    candleHigh: number;
    candleLow: number;
    close: number;
    type: 'sweep_reject' | 'close_beyond';
    direction: 'bullish' | 'bearish';
    text: string;
}

export interface SweepLevelInput {
    price: number;
    label: string;
}

const fmtPx = (v: number): string => (v >= 1000 ? v.toFixed(0) : v.toFixed(2));

/**
 * Check the last COMPLETED candle of each timeframe against key levels.
 * klines[len-1] is the still-forming live candle — same convention as the
 * rest of the payload. Sweeps require the wick to extend strictly beyond
 * the level (±0.05%) and the close to be back on the other side (rejection),
 * or a close strictly beyond (break). Max `maxPerTf` events per timeframe.
 */
export const detectLiquiditySweeps = (
    entries: { timeframe: HybridTimeframe; klines: Kline[]; levels: SweepLevelInput[] }[],
    maxPerTf = 2
): LiquiditySweep[] => {
    const sweeps: LiquiditySweep[] = [];
    for (const { timeframe, klines, levels } of entries) {
        const candle = klines[klines.length - 2];
        if (!candle) continue;
        let found = 0;
        for (const level of levels) {
            if (!isFinite(level.price) || level.price <= 0) continue;
            const beyond = level.price * 0.0005; // strict-beyond tolerance
            const base = { timeframe, levelLabel: level.label, level: level.price, candleHigh: candle.high, candleLow: candle.low, close: candle.close };

            if (candle.high > level.price + beyond && candle.close < level.price) {
                sweeps.push({
                    ...base,
                    type: 'sweep_reject',
                    direction: 'bearish',
                    text: `wick swept ABOVE ${level.label} ($${fmtPx(level.price)} → high $${fmtPx(candle.high)}) and closed BELOW ($${fmtPx(candle.close)}) — rejection`
                });
                found++;
            } else if (candle.low < level.price - beyond && candle.close > level.price) {
                sweeps.push({
                    ...base,
                    type: 'sweep_reject',
                    direction: 'bullish',
                    text: `wick swept BELOW ${level.label} ($${fmtPx(level.price)} → low $${fmtPx(candle.low)}) and closed ABOVE ($${fmtPx(candle.close)}) — rejection`
                });
                found++;
            } else if (
                candle.close > level.price + beyond &&
                candle.low >= level.price &&
                // A genuine break starts from the level: the candle must have
                // opened at/near it, or any candle trading above a level would
                // report "closed above" forever.
                candle.open <= level.price * (1 + 0.005)
            ) {
                sweeps.push({
                    ...base,
                    type: 'close_beyond',
                    direction: 'bullish',
                    text: `closed ABOVE ${level.label} ($${fmtPx(level.price)}) at $${fmtPx(candle.close)} — break`
                });
                found++;
            } else if (
                candle.close < level.price - beyond &&
                candle.high <= level.price &&
                candle.open >= level.price * (1 - 0.005)
            ) {
                sweeps.push({
                    ...base,
                    type: 'close_beyond',
                    direction: 'bearish',
                    text: `closed BELOW ${level.label} ($${fmtPx(level.price)}) at $${fmtPx(candle.close)} — breakdown`
                });
                found++;
            }
            if (found >= maxPerTf) break;
        }
    }
    return sweeps;
};

/**
 * Format the RECENT LIQUIDATIONS block for the injection.
 * When the source is unavailable, emit explicit N/A instead of fake
 * $0.00M / LOW pressure / BALANCED readings — an LLM weights concrete
 * structured fields over a prose caveat, so the block itself must be honest.
 */
export const formatLiquidationsBlock = (liquidations: LiquidationData): string => {
    if (liquidations.available === false) {
        return '- N/A — source unavailable. Do NOT infer pressure or direction from this field.';
    }
    return `- Long Liquidations: $${(liquidations.recentLongLiquidations / 1000000).toFixed(2)}M
- Short Liquidations: $${(liquidations.recentShortLiquidations / 1000000).toFixed(2)}M
- Total: $${(liquidations.totalRecentLiquidations / 1000000).toFixed(2)}M (${liquidations.liquidationPressure.toUpperCase()} pressure)
- Dominant: ${liquidations.dominantLiquidations.toUpperCase()}
-  ${liquidations.sentiment}`;
};

/**
 * Format the Fibonacci ladder for the injection. The full ladder is shown
 * (including 0, 0.236, 0.786, 1) so every "(fibonacci)" label in the
 * resistance/support lists is accounted for by a visible level.
 */
export const formatFibLadder = (fibLevels: FibonacciLevels): string =>
    fibLevels.levels.map(l => `- ${l.ratio}: $${l.price}`).join('\n');

/**
 * Format the Candle History Insight summary.
 * Each timeframe gets a ↔ marker only when its own dominantTrend is neutral —
 * but a blanket "no trend" summary must never lump in a genuinely skewed
 * timeframe. When one side is neutral and the other is skewed, surface the
 * skew explicitly so the model weighs it.
 * Pairing: HTF = 4h & 1d (macro/direction), LTF = 1h & 15m (bias/entry).
 */
export const formatCandleHistoryInsight = (candleHistory: HybridDataPacket['candleHistory']): string => {
    const h4 = candleHistory['4h'].dominantTrend;
    const d1 = candleHistory['1d'].dominantTrend;
    const h1 = candleHistory['1h'].dominantTrend;
    const m15 = candleHistory['15m'].dominantTrend;

    let insight = '';

    // HTF alignment (4h + 1d)
    if (h4 === 'bullish' && d1 === 'bullish') {
        insight += ' HTF BULLISH: Both 4H and 1D show strong bullish candle dominance. Favor long setups.';
    } else if (h4 === 'bearish' && d1 === 'bearish') {
        insight += ' HTF BEARISH: Both 4H and 1D show strong bearish candle dominance. Favor short setups.';
    } else if ((h4 === 'bullish' && d1 === 'bearish') || (h4 === 'bearish' && d1 === 'bullish')) {
        insight += ' HTF DIVERGENCE: 4H vs 1D disagree. Possible reversal or consolidation.';
    } else if (h4 === 'neutral' && d1 === 'neutral') {
        insight += '↔ HTF NEUTRAL: No clear HTF candle trend dominance.';
    } else {
        const skew4 = h4 !== 'neutral' ? `4h ${h4}-skewed (${candleHistory['4h'].summary})` : '4h neutral';
        const skew1d = d1 !== 'neutral' ? `1d ${d1}-skewed (${candleHistory['1d'].summary})` : '1d neutral';
        insight += ` HTF SKEW: ${skew4}, ${skew1d}. Respect the skewed timeframe for macro direction.`;
    }

    // LTF entry context (1h + 15m)
    insight += '\n';
    if (h1 === 'bullish' && m15 === 'bullish') {
        insight += ' LTF ENTRY FAVORABLE: 1H bias and 15m structure both bullish.';
    } else if (h1 === 'bearish' && m15 === 'bearish') {
        insight += ' LTF ENTRY FAVORABLE: 1H bias and 15m structure both bearish.';
    } else if ((h1 === 'bullish' && m15 === 'bearish') || (h1 === 'bearish' && m15 === 'bullish')) {
        insight += ' LTF MIXED: 1H and 15m disagree. Wait for alignment before entry.';
    } else if (h1 === 'neutral' && m15 === 'neutral') {
        insight += '↔ LTF NEUTRAL: No clear LTF trend. Be cautious with entry timing.';
    } else {
        const skew1 = h1 !== 'neutral' ? `1h ${h1}-skewed (${candleHistory['1h'].summary})` : '1h neutral';
        const skew15 = m15 !== 'neutral' ? `15m ${m15}-skewed (${candleHistory['15m'].summary})` : '15m neutral';
        insight += ` LTF SKEW: ${skew1}, ${skew15}. Respect the skewed timeframe for entry timing.`;
    }

    return insight;
};

const mdRow = (cells: Array<string | number>): string => `| ${cells.map(c => String(c)).join(' | ')} |`;

const mdTable = (headers: string[], rows: Array<Array<string | number>>): string => {
    if (rows.length === 0) return '';
    return [mdRow(headers), mdRow(headers.map(() => '---')), ...rows.map(mdRow)].join('\n');
};

const indicatorRow = (tf: HybridTimeframe, ind: TechnicalIndicators | null | undefined): Array<string | number> => {
    if (!ind) return [tf, '—', '—', '—', '—', '—', '—', '—', '—', '—'];
    return [
        tf,
        fmtPx(ind.currentPrice),
        ind.rsi.rsi14,
        ind.rsiTrend,
        ind.macd.histogram,
        ind.macd.trend,
        ind.ema.ema20,
        ind.ema.ema50,
        ind.ema.ema200,
        `${ind.atr} (${ind.atrPercent}%)`,
        ind.trendStrength.replace(/_/g, ' '),
    ];
};

/**
 * Generate AI prompt injection for hybrid data.
 * Compact labeled tables first (scan-friendly), then supporting series.
 */
export interface HybridInjectionOptions {
    timeframes?: HybridTimeframe[];
    compact?: boolean;
}

export const generateHybridPromptInjection = (data: HybridDataPacket, options?: HybridInjectionOptions): string => {
    const fundingDisplay = (data.fundingRate * 100).toFixed(4);
    const dataAgeMin = Math.max(0, Math.round((Date.now() - new Date(data.dataTimestamp).getTime()) / 60000));
    const sourceNote = dataAgeMin <= 10
        ? `Binance · ${dataAgeMin}m ago`
        : `Binance · STALE ${dataAgeMin}m — verify vs live price`;
    const qualityNote = data.dataQuality?.status === 'degraded'
        ? `degraded (missing: ${data.dataQuality.unavailableSources.join(', ')})`
        : 'complete';

    const tfs: HybridTimeframe[] = options?.timeframes ?? ['1d', '4h', '1h', '15m'];
    const mil = (n: number): string => `$${(n / 1_000_000).toFixed(2)}M`;
    const chg = (n: number): string => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;

    const pp = data.enhancedKeyLevels.pivotPoints.daily;
    const fib = data.enhancedKeyLevels.fibLevels;
    const ichi = data.ichimoku['4h'];
    const vwap = data.vwap['1h'];
    const m1 = data.momentum['1h'];
    const m4 = data.momentum['4h'];
    const av = data.advancedVolume;
    const vp = av.volumeProfile;
            const mc = data.marketContext;

    const fmtOhlc = (v: number): string => {
        if (!Number.isFinite(v)) return '?';
        return v >= 1000 ? v.toFixed(0) : v >= 1 ? v.toFixed(2) : v.toFixed(6);
    };

    const patternRows: Array<Array<string | number>> = [];
    for (const tf of tfs) {
        const scan = data.detectedPatterns?.[tf];
                if (!scan || scan.windowSize === 0) {
            patternRows.push([tf, '—', 'insufficient data', '—', '—', '—']);
            continue;
        }
        const top = [...scan.patterns].sort((a, b) => b.strength - a.strength).slice(0, 5);
                if (top.length === 0) {
            patternRows.push([tf, 'none', `last ${scan.windowSize}`, '—', '—', `HH=${scan.higherHighs} HL=${scan.higherLows} LH=${scan.lowerHighs} LL=${scan.lowerLows}`]);
            continue;
        }
        for (const p of top) {
            patternRows.push([
                tf,
                p.name,
                p.direction,
                `${(p.strength * 100).toFixed(0)}%`,
                p.priceLevel !== undefined ? `$${fmtOhlc(p.priceLevel)}` : '—',
                p.note ?? '',
            ]);
        }
    }

    const ohlcBlocks = tfs.map(tf => {
        const scan = data.detectedPatterns?.[tf];
        if (!scan?.candles?.length) return `**${tf} OHLC:** insufficient`;
        const recent = scan.candles.slice(-8);
        const row = recent.map(c => `${fmtOhlc(c.open)}/${fmtOhlc(c.high)}/${fmtOhlc(c.low)}/${fmtOhlc(c.close)}`).join(' · ');
        return `**${tf}** (O/H/L/C, oldest→newest, last ${recent.length}): ${row}`;
    }).join('\n');

    const weekMonthRows: Array<Array<string | number>> = [];
    if (mc?.week) weekMonthRows.push(['week', fmtPx(mc.week.open), fmtPx(mc.week.high), fmtPx(mc.week.low), mc.prevWeek ? `${fmtPx(mc.prevWeek.low)}–${fmtPx(mc.prevWeek.high)}` : '—']);
    if (mc?.month) weekMonthRows.push(['month', fmtPx(mc.month.open), fmtPx(mc.month.high), fmtPx(mc.month.low), mc.prevMonth ? `${fmtPx(mc.prevMonth.low)}–${fmtPx(mc.prevMonth.high)}` : '—']);

    const adxRule = data.regime.adx >= 40
        ? `ADX ${data.regime.adx} strong trend — trade with ${data.regime.trendDirection} only; counter-trend = no trade.`
        : data.regime.adx >= 25
            ? `ADX ${data.regime.adx} moderate trend — prefer with-trend; counter-trend only at major structure.`
            : data.regime.adx < 15
                ? `ADX ${data.regime.adx} ranging — mean-reversion; treat breakouts as low-probability.`
                : `ADX ${data.regime.adx} weak — require extra confluence.`;

    const sections: string[] = [
        `## Hybrid market packet`,
        mdTable(
            ['Symbol', 'Price', '24h', 'High', 'Low', 'Vol 24h', 'Funding', 'Age', 'Quality'],
            [[
                data.symbol,
                `$${data.marketData.currentPrice}`,
                chg(data.marketData.priceChangePercent24h),
                `$${data.marketData.price24hHigh}`,
                `$${data.marketData.price24hLow}`,
                mil(data.marketData.volume24h),
                `${fundingDisplay}% (${data.fundingRateSentiment})`,
                sourceNote,
                qualityNote,
            ]]
        ),
        `### Regime / family / confluence`,
        mdTable(
            ['ADX regime', 'ADX', '+DI', '-DI', 'Trend', 'Bias', 'Family', 'Fam conf', 'MTF score', 'MTF dir'],
            [[
                data.regime.regime.replace(/_/g, ' '),
                data.regime.adx,
                data.regime.plusDI,
                data.regime.minusDI,
                `${data.regime.trendDirection} (${data.regime.trendStrength})`,
                data.regime.tradingBias.replace(/_/g, ' '),
                data.patternClassification.family,
                `${(data.patternClassification.confidence * 100).toFixed(0)}%`,
                `${data.confluence.score}/100`,
                `${data.confluence.direction} (${data.confluence.strength})`,
            ]]
        ),
        data.regime.recommendation,
        `Family scores: A=${data.patternClassification.scores.familyA} B=${data.patternClassification.scores.familyB} C=${data.patternClassification.scores.familyC} Ω=${data.patternClassification.scores.familyOmega}`,
        `Aligned: ${data.confluence.alignment.slice(0, 4).join('; ') || 'none'}`,
        `Conflicts: ${data.confluence.conflicts.slice(0, 2).join('; ') || 'none'}`,
        `### Indicators (code-calculated)`,
        mdTable(
            ['TF', 'Price', 'RSI14', 'RSI', 'MACD hist', 'MACD', 'EMA20', 'EMA50', 'EMA200', 'ATR', 'Trend'],
            tfs.map(tf => indicatorRow(tf, data.indicators[tf]))
        ),
        `### Key levels`,
        mdTable(
            ['R3', 'R2', 'R1', 'PP', 'S1', 'S2', 'S3'],
            [[pp.r3, pp.r2, pp.r1, pp.pp, pp.s1, pp.s2, pp.s3]]
        ),
        `Fib (${fib.trend} trend)`,
        mdTable(['Ratio', 'Price'], fib.levels.map(l => [l.ratio, `$${l.price}`])),
        mdTable(
            ['Side', 'Price', 'Source', 'Touches'],
            [
                ...data.enhancedKeyLevels.resistance.slice(0, 3).map(r => ['resist', `$${r.price}`, r.source, r.touchCount]),
                ...data.enhancedKeyLevels.support.slice(0, 3).map(s => ['support', `$${s.price}`, s.source, s.touchCount]),
            ]
        ),
        weekMonthRows.length > 0 ? `### Week / month (UTC)` : '',
        weekMonthRows.length > 0 ? mdTable(['Period', 'Open', 'High', 'Low', 'Prev range'], weekMonthRows) : '',
        data.live1h && data.marketData.currentPrice > 0
            ? `Live 1H: open $${fmtPx(data.live1h.open)} → $${fmtPx(data.live1h.price)} · ${data.live1h.minutesLeft}m left · ${data.live1h.percentTraveled.toFixed(0)}% of range`
            : '',
        `### Derivatives / book / liquidations`,
        mdTable(
            ['OI', 'OI 24h', 'L/S', 'Top trader', 'Taker', 'Overall', 'Score'],
            [[
                mil(data.derivatives.openInterestValue),
                typeof data.derivatives.oiChange24h === 'number' ? chg(data.derivatives.oiChange24h) : '—',
                `${data.derivatives.longShortRatio.ratio.toFixed(2)} (${data.derivatives.longShortRatio.sentiment.replace(/_/g, ' ')})`,
                `${data.derivatives.topTraderRatio.ratio.toFixed(2)} (${data.derivatives.topTraderRatio.sentiment.replace(/_/g, ' ')})`,
                `${data.derivatives.takerBuySell.ratio.toFixed(2)} (${data.derivatives.takerBuySell.pressure.replace(/_/g, ' ')})`,
                data.derivatives.overallSentiment.replace(/_/g, ' '),
                data.derivatives.sentimentScore,
            ]]
        ),
        mdTable(
            ['Spread', 'Spread %', 'Bid 1%', 'Ask 1%', 'Imbalance', 'Dominant'],
            [[
                `$${data.orderBook.spread.toFixed(2)}`,
                `${data.orderBook.spreadPercent.toFixed(3)}%`,
                mil(data.orderBook.bidDepth),
                mil(data.orderBook.askDepth),
                `${(data.orderBook.depthImbalance * 100).toFixed(1)}%`,
                data.orderBook.dominantSide,
            ]]
        ),
        data.orderBook.buyWalls.length > 0
            ? `Buy walls: ${data.orderBook.buyWalls.slice(0, 2).map(w => `$${w.price} (${mil(w.usdValue)})`).join(' · ')}`
            : 'Buy walls: none',
        data.orderBook.sellWalls.length > 0
            ? `Sell walls: ${data.orderBook.sellWalls.slice(0, 2).map(w => `$${w.price} (${mil(w.usdValue)})`).join(' · ')}`
            : 'Sell walls: none',
        `Liquidations (1h)`,
        formatLiquidationsBlock(data.liquidations),
        `### Volume / Ichimoku / VWAP / momentum`,
        mdTable(
            ['RVOL', 'OBV', 'OBV div', 'CVD', 'POC', 'vs POC', 'VA', 'VA pos', 'Bias'],
            [[
                `${av.relativeVolume}x (${av.trend})`,
                av.obvTrend,
                av.obvDivergence,
                av.cvdTrend.replace(/_/g, ' '),
                `$${vp.poc}`,
                vp.priceVsPOC,
                `$${vp.valueAreaLow}–$${vp.valueAreaHigh}`,
                vp.valueAreaPosition,
                av.volumeWeightedBias,
            ]]
        ),
        mdTable(
            ['Ichimoku 4H', 'Cloud', 'Price vs cloud', 'TK', 'Cloud lo–hi'],
            [[ichi.signal.replace(/_/g, ' '), ichi.cloudColor, ichi.priceVsCloud, ichi.tkCross, `$${ichi.cloudBottom}–$${ichi.cloudTop}`]]
        ),
        mdTable(
            ['VWAP 1H', 'Position', '-2σ', '-1σ', '+1σ', '+2σ'],
            [[`$${vwap.vwap}`, vwap.pricePosition.replace(/_/g, ' '), `$${vwap.lowerBand2}`, `$${vwap.lowerBand1}`, `$${vwap.upperBand1}`, `$${vwap.upperBand2}`]]
        ),
        mdTable(
            ['TF', 'ROC5', 'ROC10', 'ROC20', 'State', 'Score', 'RSI div', 'MACD div'],
            [
                ['1h', `${m1.roc5}%`, `${m1.roc10}%`, `${m1.roc20}%`, m1.momentum.replace(/_/g, ' '), m1.momentumScore, m1.rsiDivergence || 'none', m1.macdDivergence || 'none'],
                ['4h', `${m4.roc5}%`, `${m4.roc10}%`, '—', m4.momentum.replace(/_/g, ' '), m4.momentumScore, m4.rsiDivergence || 'none', m4.macdDivergence || 'none'],
            ]
        ),
        `### Session`,
        mdTable(
            ['Session', 'UTC window', 'Mins in', 'Mins left', 'Kill zone', 'Vol expect', 'Condition', 'Day'],
            [[
                data.session.sessionName,
                `${data.session.sessionStart}–${data.session.sessionEnd}`,
                data.session.minutesIntoSession,
                data.session.minutesToSessionEnd,
                data.session.isKillZone ? `yes (${data.session.killZoneType})` : 'no',
                data.session.volatilityExpectation,
                data.session.suggestedAction,
                `${data.session.dayOfWeek}${data.session.isWeekend ? ' weekend' : ''}`,
            ]]
        ),
        data.session.warnings.length > 0 ? `Warnings: ${data.session.warnings.join('; ')}` : '',
        `### Sweeps / candles / patterns`,
        data.liquiditySweeps?.length
            ? mdTable(['TF', 'Sweep'], data.liquiditySweeps.map(s => [s.timeframe, s.text]))
            : 'Sweeps: none on last completed candle.',
        mdTable(
            ['TF', 'Sequence', 'Summary', 'Dominant'],
            tfs.map(tf => {
                const h = data.candleHistory?.[tf];
                return [tf, h?.sequence?.join('') || '—', h?.summary || '—', h?.dominantTrend || '—'];
            })
        ),
        options?.compact ? '' : formatCandleHistoryInsight(data.candleHistory),
        mdTable(['TF', 'Pattern', 'Dir', 'Str', 'Level', 'Note'], patternRows),
        options?.compact ? '' : ohlcBlocks,
        `### Read rules`,
        `- Numbers above are code-calculated. Cite a table cell when you name a level.`,
        `- ADX regime is authoritative vs the chart-structure table. ${adxRule}`,
        `- 1H ATR for stops: $${data.indicators['1h']?.atr ?? '—'}. Volume: ${av.trend}. OBV divergence: ${av.obvDivergence}.`,
    ].filter(Boolean);

    if (!options?.compact && data.chartRepresentation) {
        sections.push(generateChartPromptInjection(
                    data.chartRepresentation['15m'],
                    data.chartRepresentation['1h'],
                    data.chartRepresentation['4h'],
                    data.chartRepresentation['1d']
        ));
    }

    return sections.join('\n\n');
};

/**
 * Try to extract symbol and fetch hybrid data from a user prompt
 * Returns null if no symbol found or data fetch fails
 */
export const tryFetchHybridDataFromPrompt = async (
    prompt: string
): Promise<{ data: HybridDataPacket; promptInjection: string } | null> => {
    const symbol = extractSymbolFromPrompt(prompt);

    if (!symbol) {
        console.log('[HybridIntelligence] No symbol detected in prompt');
        return null;
    }

    try {
        const data = await fetchHybridData(symbol);
        const promptInjection = generateHybridPromptInjection(data);
        return { data, promptInjection };
    } catch (error) {
        console.error(`[HybridIntelligence] Failed to fetch data for ${symbol}:`, error);
        return null;
    }
};

/**
 * Generate enhanced AI prompt injection with calibration data
 * Includes validation protocol, historical accuracy data, and accuracy enhancement prompts
 * 
 * ENHANCED VERSION - Now includes:
 * - Correlation risk prompt injection
 * - Granular calibration (per-coin, per-pattern, etc.)
 * - Invalidation thesis requirement
 * - Chain of thought reasoning
 * - Correlation awareness
 * - Streak detection and session awareness
 * - Bayesian confidence adjustments
 * - Provider accuracy routing
 */
export const generateEnhancedHybridPromptInjection = (
    data: HybridDataPacket,
    calibration?: ConfidenceCalibration,
    correlationRiskPrompt?: string,
    granularContext?: { coin?: string; pattern?: string; timeframe?: string; regime?: 'trending' | 'ranging' | 'volatile' },
    proposedConfidence?: ConfidenceLevel
): { prompt: string; adjustedConfidence?: ConfidenceLevel; totalPenalty?: number } => {
    // Get base hybrid data injection
    const baseInjection = generateHybridPromptInjection(data);

    // Determine regime from hybrid data
    const regime = data.regime.regime.includes('trend') ? 'trending' as const :
        data.regime.regime === 'ranging' ? 'ranging' as const : 'volatile' as const;

    // Use enhanced calibration if available (with AI-adjusting features)
    let calibrationInjection = '';
    let adjustedConfidence: ConfidenceLevel | undefined;
    let totalPenalty: number | undefined;

    if (calibration && proposedConfidence) {
        const enhancedResult = generateEnhancedCalibrationPromptInjection(
            calibration,
            proposedConfidence,
            {
                coin: granularContext?.coin || data.symbol,
                pattern: granularContext?.pattern,
                regime: granularContext?.regime || regime
            }
        );
        calibrationInjection = enhancedResult.promptInjection;
        adjustedConfidence = enhancedResult.adjustedConfidence;
        totalPenalty = enhancedResult.totalPenalty;
    } else if (calibration) {
        // Fallback to basic calibration injection
        calibrationInjection = generateCalibrationPromptInjection(calibration);

        // Still add granular context if available
        if (granularContext) {
            const granularInjection = generateGranularCalibrationPrompt(calibration, granularContext);
            calibrationInjection += '\n' + granularInjection;
        }
    }

    // Get provider accuracy context for ensemble weighting
    let providerAccuracyInjection = '';
    if (calibration) {
        const providerContext = getProviderAccuracyContext(calibration);
        if (providerContext.promptInjection) {
            providerAccuracyInjection = providerContext.promptInjection;
        }
    }

    // Get validation protocol
    const validationInjection = generateValidationPromptInjection();

    // Build accuracy enhancement section
    const accuracyEnhancements = `
═══════════════════════════════════════════════════════════════
 ACCURACY ENHANCEMENT PROTOCOLS
═══════════════════════════════════════════════════════════════

${correlationRiskPrompt ? correlationRiskPrompt : CORRELATION_AWARENESS_PROMPT}

${INVALIDATION_THESIS_PROMPT}

${providerAccuracyInjection}
═══════════════════════════════════════════════════════════════
`;

    // Generate session-based accuracy data
    let sessionInjection = '';
    if (calibration) {
        sessionInjection = generateSessionCalibrationPrompt(calibration);
    }

    // Learning rules injection RETIRED: IF/THEN lessons live in
    // skills (evidence-counted + enforced). Keeping a parallel advisory
    // rules prompt double-injected the same facts and drifted from the
    // skill versions. The rules store still runs for outcome attribution.

    const fullPrompt = `
${baseInjection}

${calibrationInjection}

${sessionInjection}

${validationInjection}

${accuracyEnhancements}
`;

    return {
        prompt: fullPrompt,
        adjustedConfidence,
        totalPenalty
    };
};


/**
 * Try to fetch hybrid data with calibration support
 * Enhanced version that includes calibration data, correlation risk, and granular context in the prompt
 */
export const tryFetchHybridDataFromPromptWithCalibration = async (
    prompt: string,
    calibration?: ConfidenceCalibration
): Promise<{
    data: HybridDataPacket;
    promptInjection: string;
    enhancedInjection: string;
    correlationRisk?: ReturnType<typeof calculateCorrelationRisk> extends Promise<infer T> ? T : never;
    adjustedConfidence?: ConfidenceLevel;
    totalPenalty?: number;
} | null> => {
    const symbol = extractSymbolFromPrompt(prompt);

    if (!symbol) {
        console.log('[HybridIntelligence] No symbol detected in prompt');
        return null;
    }

    try {
        // Fetch all data in parallel
        const [data, correlationRisk] = await Promise.all([
            fetchHybridData(symbol),
            calculateCorrelationRisk(symbol).catch(err => {
                console.warn('[HybridIntelligence] Correlation risk fetch failed:', err);
                return null;
            })
        ]);

        const promptInjection = generateHybridPromptInjection(data);

        // Build granular context from market data
        const granularContext = {
            coin: symbol,
            timeframe: '4h', // Primary analysis timeframe
            regime: data.regime.regime.includes('trend') ? 'trending' as const :
                data.regime.regime === 'ranging' ? 'ranging' as const : 'volatile' as const
        };

        // Generate correlation risk prompt if available
        const correlationRiskPrompt = correlationRisk
            ? generateCorrelationRiskPrompt(correlationRisk)
            : undefined;

        // Use enhanced prompt injection that returns additional calibration metadata
        const enhancedResult = generateEnhancedHybridPromptInjection(
            data,
            calibration,
            correlationRiskPrompt,
            granularContext,
            'High' // Default proposed confidence, will be adjusted by calibration
        );

        return {
            data,
            promptInjection,
            enhancedInjection: enhancedResult.prompt,
            correlationRisk: correlationRisk ?? undefined,
            adjustedConfidence: enhancedResult.adjustedConfidence,
            totalPenalty: enhancedResult.totalPenalty
        };
    } catch (error) {
        console.error(`[HybridIntelligence] Failed to fetch data for ${symbol}:`, error);
        return null;
    }
};

/**
 * Run Monte Carlo simulation for a trade setup
 * Extracts entry, SL, and TPs from the analysis and runs 1000 simulations
 * Uses ATR from the provided hybrid data packet for volatility
 */
export const runMonteCarloForSetup = (
    analysis: {
        direction?: string;
        entryPoints?: { price?: string }[];
        stopLoss?: string;
        takeProfit?: { price?: string }[];
    },
    hybridData: HybridDataPacket
): MonteCarloResult | null => {
    try {
        const config = buildMonteCarloConfig(analysis, hybridData);
        return config ? runSimulation(config) : null;
    } catch (error) {
        console.error('[MonteCarloForSetup] Simulation failed:', error);
        return null;
    }
};

/**
 * Run Monte Carlo for a setup in a Web Worker (non-blocking) when workers are
 * available; falls back to the synchronous path. Identical inputs/outputs to
 * runMonteCarloForSetup — the pipeline uses this so 1000 simulations per
 * analyst never block the UI during a debate.
 */
export const runMonteCarloForSetupAsync = async (
    analysis: Parameters<typeof runMonteCarloForSetup>[0],
    hybridData: HybridDataPacket
): Promise<MonteCarloResult | null> => {
    try {
        const config = buildMonteCarloConfig(analysis, hybridData);
        return config ? await runSimulationAsync(config) : null;
    } catch (error) {
        console.error('[MonteCarloForSetup] Async simulation failed:', error);
        return null;
    }
};

/**
 * Parse a trade setup + hybrid data into a SimulationConfig.
 * Shared by the synchronous and worker-backed Monte Carlo paths so the
 * parsing/validation logic exists exactly once.
 */
const buildMonteCarloConfig = (
    analysis: {
        direction?: string;
        entryPoints?: { price?: string }[];
        stopLoss?: string;
        takeProfit?: { price?: string }[];
    },
    hybridData: HybridDataPacket
): SimulationConfig | null => {
        // Debug: Log the raw input
        console.log('[MonteCarloForSetup] Raw input:', {
            direction: analysis.direction,
            entryPoints: analysis.entryPoints,
            stopLoss: analysis.stopLoss,
            takeProfit: analysis.takeProfit
        });

        // Extract numeric values from analysis — canonical parser handles
        // ranges ("3210 - 3220" → midpoint) and annotated prices ("94500 4h");
        // a local copy used to glue annotation digits onto the number.
        const parsePrice = (str: string | undefined): number => {
            if (!str) return NaN;
            return canonicalParsePrice(str);
        };

        const entry = parsePrice(analysis.entryPoints?.[0]?.price);
        const stopLoss = parsePrice(analysis.stopLoss);

        // Extract take profits
        const tps = (analysis.takeProfit || [])
            .map(tp => parsePrice(tp.price))
            .filter((p): p is number => !isNaN(p));

        // Validate we have required data
        if (!entry || !stopLoss || tps.length === 0) {
            console.log('[MonteCarloForSetup] Insufficient trade data - entry:', entry, 'stopLoss:', stopLoss, 'tps:', tps);
            return null;
        }

        const dirLower = (analysis.direction || '').toLowerCase();
        const isLong = dirLower.includes('long') || dirLower.includes('buy');
        const isShort = dirLower.includes('short') || dirLower.includes('sell');

        // Neutral / unknown direction: don't simulate a direction the card
        // never claimed — the old fallback silently simulated every non-long
        // analysis as SHORT.
        if (!isLong && !isShort) {
            console.log('[MonteCarloForSetup] Neutral direction — skipping simulation.');
            return null;
        }
        const direction = isLong ? 'Long' as const : 'Short' as const;

        // Degenerate setups must never be simulated: entry == SL collapses the
        // ATR fallback to 0, producing a zero-volatility deterministic drift
        // that reports a fake ~100% win rate, and an inverted SL (wrong side
        // of entry) "hits" its stop at step 0 with a profit. Reject both.
        const slDistance = Math.abs(entry - stopLoss);
        const slOnCorrectSide = isLong ? stopLoss < entry : stopLoss > entry;
        if (slDistance <= 0 || !slOnCorrectSide) {
            console.log('[MonteCarloForSetup] Degenerate stop loss — skipping simulation.', { entry, stopLoss, direction });
            return null;
        }

        // Get ATR from hybrid data - average all available timeframes for balanced volatility
        const availableAtrs = [
            hybridData.indicators?.['15m']?.atr,
            hybridData.indicators?.['1h']?.atr,
            hybridData.indicators?.['4h']?.atr,
            hybridData.indicators?.['1d']?.atr
        ].filter((v): v is number => v !== undefined && v > 0);

        let atr: number;

        if (availableAtrs.length > 0) {
            // Average all available ATRs
            atr = availableAtrs.reduce((sum, val) => sum + val, 0) / availableAtrs.length;
        } else {
            // Fallback: Calculate ATR from stop loss distance (slDistance is
            // validated nonzero above, so atr stays > 0).
            atr = slDistance * 2; // Assume SL is ~0.5 ATR
            console.log('[MonteCarloForSetup] Using fallback ATR from SL distance:', atr);
        }

        // Determine trend bias from regime
        let trendBias = 0;
        if (hybridData.regime?.trendDirection === 'bullish') {
            trendBias = direction === 'Long' ? 0.3 : -0.3;
        } else if (hybridData.regime?.trendDirection === 'bearish') {
            trendBias = direction === 'Short' ? 0.3 : -0.3;
        }

        return {
            entry,
            stopLoss,
            takeProfits: tps,
            direction,
            atr,
            timeframe: 'Multi-TF',
            trendBias,
            numSimulations: 1000,
            maxSteps: 100,
            marketRegime: hybridData.regime?.regime
        };
    };

/**
 * Generate Monte Carlo prompt injection for AI context
 * Use this to add simulation results to AI prompts
 */
export const getMonteCarloInjection = (result: MonteCarloResult): string => {
    return generateMonteCarloPromptInjection(result);
};
