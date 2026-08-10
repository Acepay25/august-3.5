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
    generateTASummary,
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

import { getSessionContext, generateSessionSummary, SessionContext } from '../infrastructure/SessionService';
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
    generateLearningRulesPrompt,
    LearningRulesStorage
} from '../learning/LearningRulesService';

import {
    NumericChartData,
    generateNumericChartData,
    generateChartPromptInjection
} from './NumericChartService';

/**
 * Enhanced Hybrid Data Packet with all new data sources
 */
/**
 * The timeframe set used across the hybrid payload: 15m (structure + entry),
 * 1h (intraday bias/key levels), 4h (HTF bias), 1d (macro trend/regime anchor).
 * 5m was dropped — it was the noisiest signal in the payload — and 1d added
 * the macro context the injection previously lacked entirely.
 */
export type HybridTimeframe = '15m' | '1h' | '4h' | '1d';

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
}

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
    for (const timeframe of ['15m', '1h', '4h', '1d'] as const) {
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
        liquiditySweeps
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

/**
 * Generate AI prompt injection for hybrid data
 * This is the structured data block that gets injected into AI prompts
 */
export const generateHybridPromptInjection = (data: HybridDataPacket): string => {
    const fundingDisplay = (data.fundingRate * 100).toFixed(4);
    const confluenceEmoji = data.confluence.direction === 'bullish' ? '' :
        data.confluence.direction === 'bearish' ? '' : '';

    const sentimentEmoji = data.derivatives.overallSentiment === 'very_bullish' ? '' :
        data.derivatives.overallSentiment === 'bullish' ? '' :
            data.derivatives.overallSentiment === 'very_bearish' ? '' :
                data.derivatives.overallSentiment === 'bearish' ? '' : '';

    const regimeEmoji = data.regime.regime.includes('trend_up') ? '' :
        data.regime.regime.includes('trend_down') ? '' :
            data.regime.regime === 'compression' ? '' :
                data.regime.regime === 'volatile_chop' ? '' : '↔';

    // Staleness: the model should know when the packet is no longer real-time
    // instead of trusting a blanket "Real-Time" claim.
    const dataAgeMin = Math.max(0, Math.round((Date.now() - new Date(data.dataTimestamp).getTime()) / 60000));
    const sourceLine = dataAgeMin <= 10
        ? `**Source:** Binance API (${dataAgeMin}m ago)`
        : `**Source:** Binance API — DATA IS ${dataAgeMin}m OLD; verify levels against the current price before acting`;
    const qualityLine = data.dataQuality?.status === 'degraded'
        ? `**Data quality:** DEGRADED — unavailable: ${data.dataQuality.unavailableSources.join(', ')}. Do not infer unavailable sources as neutral or balanced.`
        : '**Data quality:** Complete for the requested sources.';

    return `
═══════════════════════════════════════════════════════════════
 HYBRID INTELLIGENCE V2: ENHANCED MARKET DATA
═══════════════════════════════════════════════════════════════
**Symbol:** ${data.symbol}
**Data Timestamp:** ${data.dataTimestamp}
${sourceLine}
${qualityLine}

 **MARKET OVERVIEW:**
- Current Price: $${data.marketData.currentPrice}
- 24H High: $${data.marketData.price24hHigh} | Low: $${data.marketData.price24hLow}
- 24H Change: ${data.marketData.priceChangePercent24h >= 0 ? '+' : ''}${data.marketData.priceChangePercent24h.toFixed(2)}%
- 24H Volume: $${(data.marketData.volume24h / 1000000).toFixed(2)}M
- Funding Rate: ${fundingDisplay}% (${data.fundingRateSentiment.toUpperCase()})

${regimeEmoji} **MARKET REGIME (ADX-Based):**
- Regime: ${data.regime.regime.replace(/_/g, ' ').toUpperCase()}
- ADX: ${data.regime.adx} | +DI: ${data.regime.plusDI} | -DI: ${data.regime.minusDI}
- Trend Direction: ${data.regime.trendDirection.toUpperCase()} (${data.regime.trendStrength})
- Trading Bias: ${data.regime.tradingBias.replace('_', ' ').toUpperCase()}
-  ${data.regime.recommendation}

 **PATTERN FAMILY (ML CLASSIFICATION):**
- Detected: **${data.patternClassification.family.toUpperCase()}** (Confidence: ${(data.patternClassification.confidence * 100).toFixed(0)}%)
- Reasoning: ${data.patternClassification.reasoning.join('; ')}
- Scores: A=${data.patternClassification.scores.familyA} | B=${data.patternClassification.scores.familyB} | C=${data.patternClassification.scores.familyC} | Ω=${data.patternClassification.scores.familyOmega}

${sentimentEmoji} **DERIVATIVES SENTIMENT:**
- Open Interest: $${(data.derivatives.openInterestValue / 1000000).toFixed(2)}M
- Long/Short Ratio: ${data.derivatives.longShortRatio.ratio.toFixed(2)} (${data.derivatives.longShortRatio.sentiment.replace('_', ' ')})
- Top Traders: ${data.derivatives.topTraderRatio.ratio.toFixed(2)} (${data.derivatives.topTraderRatio.sentiment.replace('_', ' ')})
- Taker Buy/Sell: ${data.derivatives.takerBuySell.ratio.toFixed(2)} (${data.derivatives.takerBuySell.pressure.replace('_', ' ')})
- Overall: ${data.derivatives.overallSentiment.replace('_', ' ').toUpperCase()} (Score: ${data.derivatives.sentimentScore})

 **ORDER BOOK DEPTH:**
- Spread: $${data.orderBook.spread.toFixed(2)} (${data.orderBook.spreadPercent.toFixed(3)}%)
- Bid Depth (1%): $${(data.orderBook.bidDepth / 1000000).toFixed(2)}M | Ask Depth: $${(data.orderBook.askDepth / 1000000).toFixed(2)}M
- Depth Imbalance: ${(data.orderBook.depthImbalance * 100).toFixed(1)}% (${data.orderBook.dominantSide.toUpperCase()})
${data.orderBook.buyWalls.length > 0 ? `- Buy Walls: ${data.orderBook.buyWalls.slice(0, 2).map(w => `$${w.price} ($${(w.usdValue / 1000000).toFixed(2)}M)`).join(' | ')}` : '- Buy Walls: None detected'}
${data.orderBook.sellWalls.length > 0 ? `- Sell Walls: ${data.orderBook.sellWalls.slice(0, 2).map(w => `$${w.price} ($${(w.usdValue / 1000000).toFixed(2)}M)`).join(' | ')}` : '- Sell Walls: None detected'}
${data.orderBook.wallDistance.nearestBuyWall ? `- Nearest Buy Wall: $${data.orderBook.wallDistance.nearestBuyWall.price} (${data.orderBook.wallDistance.nearestBuyWall.distance.toFixed(2)}% below)` : ''}
${data.orderBook.wallDistance.nearestSellWall ? `- Nearest Sell Wall: $${data.orderBook.wallDistance.nearestSellWall.price} (${data.orderBook.wallDistance.nearestSellWall.distance.toFixed(2)}% above)` : ''}

 **RECENT LIQUIDATIONS (1H):**
${formatLiquidationsBlock(data.liquidations)}

 **ADVANCED VOLUME ANALYSIS:**
- Relative Volume: ${data.advancedVolume.relativeVolume}x (${data.advancedVolume.trend})
- OBV Trend: ${data.advancedVolume.obvTrend.toUpperCase()} | Divergence: ${data.advancedVolume.obvDivergence.toUpperCase()}
- CVD: ${data.advancedVolume.cvdTrend.replace('_', ' ').toUpperCase()}
- Volume POC: $${data.advancedVolume.volumeProfile.poc} (Price ${data.advancedVolume.volumeProfile.priceVsPOC} POC)
- Profile Shape: ${data.advancedVolume.volumeProfile.shape.replace('_', ' ').toUpperCase()} | Price ${data.advancedVolume.volumeProfile.valueAreaPosition.toUpperCase()} value area ($${data.advancedVolume.volumeProfile.valueAreaLow} - $${data.advancedVolume.volumeProfile.valueAreaHigh}) | 70% area spans ${(data.advancedVolume.volumeProfile.valueAreaSpan * 100).toFixed(0)}% of range
- Volume Bias: ${data.advancedVolume.volumeWeightedBias.toUpperCase()}

 **MULTI-TIMEFRAME CONFLUENCE (MTF):**
- ${confluenceEmoji} Score: ${data.confluence.score}/100 — ${data.confluence.direction.toUpperCase()} (${data.confluence.strength})
- Aligned: ${data.confluence.alignment.slice(0, 4).join(', ') || 'None'}
- Conflicts: ${data.confluence.conflicts.slice(0, 2).join(', ') || 'None'}
${data.confluence.score >= 70 ? ' STRONG BULLISH CONFLUENCE' :
            data.confluence.score <= 30 ? ' STRONG BEARISH CONFLUENCE' :
                ' Mixed signals - Exercise caution'}

 **ICHIMOKU CLOUD (4H):**
- Signal: ${data.ichimoku['4h'].signal.replace('_', ' ').toUpperCase()}
- Cloud Color: ${data.ichimoku['4h'].cloudColor.toUpperCase()}
- Price vs Cloud: ${data.ichimoku['4h'].priceVsCloud.toUpperCase()}
- TK Cross: ${data.ichimoku['4h'].tkCross.toUpperCase()}
- Cloud: $${data.ichimoku['4h'].cloudBottom} - $${data.ichimoku['4h'].cloudTop}

 **VWAP (1H):**
- VWAP: $${data.vwap['1h'].vwap}
- Position: ${data.vwap['1h'].pricePosition.replace(/_/g, ' ').toUpperCase()}
- Bands: $${data.vwap['1h'].lowerBand2} | $${data.vwap['1h'].lowerBand1} | VWAP | $${data.vwap['1h'].upperBand1} | $${data.vwap['1h'].upperBand2}

 **MOMENTUM (1H/4H):**
- 1H ROC: 5p=${data.momentum['1h'].roc5}% | 10p=${data.momentum['1h'].roc10}% | 20p=${data.momentum['1h'].roc20}%
- 1H State: ${data.momentum['1h'].momentum.replace(/_/g, ' ').toUpperCase()} (Score: ${data.momentum['1h'].momentumScore})
- 1H Divergence: RSI=${data.momentum['1h'].rsiDivergence?.toUpperCase() || 'NONE'} | MACD=${data.momentum['1h'].macdDivergence?.toUpperCase() || 'NONE'}
- 4H ROC: 5p=${data.momentum['4h'].roc5}% | 10p=${data.momentum['4h'].roc10}%
- 4H Divergence: RSI=${data.momentum['4h'].rsiDivergence?.toUpperCase() || 'NONE'} | MACD=${data.momentum['4h'].macdDivergence?.toUpperCase() || 'NONE'}

 **TECHNICAL ANALYSIS (CODE-CALCULATED):**

${generateTASummary(data.indicators['1d'], '1D Timeframe')}

${generateTASummary(data.indicators['4h'], '4H Timeframe')}

${generateTASummary(data.indicators['1h'], '1H Timeframe')}

${generateTASummary(data.indicators['15m'], '15M Timeframe')}

 **ENHANCED KEY LEVELS:**
**Pivot Points (4H):**
- R3: $${data.enhancedKeyLevels.pivotPoints.daily.r3} | R2: $${data.enhancedKeyLevels.pivotPoints.daily.r2} | R1: $${data.enhancedKeyLevels.pivotPoints.daily.r1}
- PP: $${data.enhancedKeyLevels.pivotPoints.daily.pp}
- S1: $${data.enhancedKeyLevels.pivotPoints.daily.s1} | S2: $${data.enhancedKeyLevels.pivotPoints.daily.s2} | S3: $${data.enhancedKeyLevels.pivotPoints.daily.s3}

**Fibonacci (${data.enhancedKeyLevels.fibLevels.trend.toUpperCase()} trend, full ladder):**
${formatFibLadder(data.enhancedKeyLevels.fibLevels)}

**Resistance:** ${data.enhancedKeyLevels.resistance.slice(0, 3).map(r => `$${r.price} (${r.source}${r.touchCount > 0 ? `, ${r.touchCount} touch${r.touchCount === 1 ? '' : 'es'}` : ''})`).join(' | ')}
**Support:** ${data.enhancedKeyLevels.support.slice(0, 3).map(s => `$${s.price} (${s.source}${s.touchCount > 0 ? `, ${s.touchCount} touch${s.touchCount === 1 ? '' : 'es'}` : ''})`).join(' | ')}

${generateSessionSummary(data.session)}

 **RECENT LIQUIDITY SWEEPS (last completed candle per TF):**
${data.liquiditySweeps && data.liquiditySweeps.length > 0
            ? data.liquiditySweeps.map(s => `- ${s.timeframe}: ${s.text}`).join('\n')
            : '- None in the last completed candle.'}

 **CANDLE HISTORY (Last 30 Completed):**
- 1d (Macro trend): ${data.candleHistory['1d'].sequence.join('')} (${data.candleHistory['1d'].summary}) ${data.candleHistory['1d'].dominantTrend === 'bullish' ? '' : data.candleHistory['1d'].dominantTrend === 'bearish' ? '' : '↔'}
- 4h (HTF bias):  ${data.candleHistory['4h'].sequence.join('')} (${data.candleHistory['4h'].summary}) ${data.candleHistory['4h'].dominantTrend === 'bullish' ? '' : data.candleHistory['4h'].dominantTrend === 'bearish' ? '' : '↔'}
- 1h (Key Levels):  ${data.candleHistory['1h'].sequence.join('')} (${data.candleHistory['1h'].summary}) ${data.candleHistory['1h'].dominantTrend === 'bullish' ? '' : data.candleHistory['1h'].dominantTrend === 'bearish' ? '' : '↔'}
- 15m (Entry Confirmation): ${data.candleHistory['15m'].sequence.join('')} (${data.candleHistory['15m'].summary}) ${data.candleHistory['15m'].dominantTrend === 'bullish' ? '' : data.candleHistory['15m'].dominantTrend === 'bearish' ? '' : '↔'}

${data.detectedPatterns ? (() => {
            const formatTfPatterns = (tf: HybridTimeframe, role: string): string => {
                const scan = data.detectedPatterns[tf];
                if (!scan || scan.windowSize === 0) {
                    return `- ${tf} (${role}): Insufficient data for pattern detection.`;
                }
                // Show the most recent / highest-strength patterns (top 8 —
                // the detector now covers the full classical set, so the
                // model gets the complete "what a human sees" picture).
                const top = [...scan.patterns]
                    .sort((a, b) => b.strength - a.strength)
                    .slice(0, 8);
                if (top.length === 0) {
                    return `- ${tf} (${role}): No notable patterns in the last ${scan.windowSize} candles.`;
                }
                const lines = top.map(p => {
                    const dirIcon = p.direction === 'bullish' ? '🟢' : p.direction === 'bearish' ? '🔴' : '⚪';
                    const level = p.priceLevel !== undefined ? ` @ $${p.priceLevel}` : '';
                    return `     ${dirIcon} ${p.name} (idx ${p.index}, strength ${(p.strength * 100).toFixed(0)}%)${level} — ${p.note ?? ''}`;
                });
                // Add trend structure line
                const struct = `     Structure: HH=${scan.higherHighs} HL=${scan.higherLows} LH=${scan.lowerHighs} LL=${scan.lowerLows}` +
                    (scan.recentSwingHigh !== undefined ? ` | swingHi=$${scan.recentSwingHigh}` : '') +
                    (scan.recentSwingLow !== undefined ? ` swingLo=$${scan.recentSwingLow}` : '');
                return `- ${tf} (${role}) — last ${scan.windowSize} candles:\n${lines.join('\n')}\n${struct}`;
            };
            return ` **DETECTED CANDLE PATTERNS (last 30 candles per timeframe):**
${formatTfPatterns('1d', 'Macro trend')}
${formatTfPatterns('4h', 'HTF bias')}
${formatTfPatterns('1h', 'Key level reactions')}
${formatTfPatterns('15m', 'Entry timing & structure')}
`;
        })() : ''}

${data.detectedPatterns ? (() => {
            const fmtPrice = (v: number): string => {
                const n = Number(v);
                if (!isFinite(n)) return '?';
                return n >= 1000 ? n.toFixed(0) : n >= 1 ? n.toFixed(2) : n.toFixed(6);
            };
            // The RAW candle data (O/H/L/C) — the "see the chart like a
            // human" layer: wick/body structure, gaps and sweeps are visible
            // in the numbers, not just the green/red sequence above.
            const formatCandleRow = (tf: HybridTimeframe, role: string): string => {
                const scan = data.detectedPatterns![tf];
                if (!scan || !scan.candles || scan.candles.length === 0) {
                    return `- ${tf} (${role}): Insufficient candle data.`;
                }
                const recent = scan.candles.slice(-15);
                const row = recent
                    .map(c => `${fmtPrice(c.open)}/${fmtPrice(c.high)}/${fmtPrice(c.low)}/${fmtPrice(c.close)}`)
                    .join(' | ');
                return `- ${tf} (${role}) — last ${recent.length} candles (O/H/L/C, oldest → newest):\n    ${row}`;
            };
            return ` **CANDLE DATA (RAW OHLC — read like a chart):**
${formatCandleRow('1d', 'Macro trend')}
${formatCandleRow('4h', 'HTF bias')}
${formatCandleRow('1h', 'Key level reactions')}
${formatCandleRow('15m', 'Entry timing & structure')}
`;
        })() : ''}

 **TIMEFRAME PURPOSE GUIDE:**
- 1D: Macro trend and major support/resistance (the weekly context)
- 4H & 1H: Key price levels and intraday direction
- 15m: Market structure (BOS, CHoCH, HH/HL, LH/LL) and entry timing

 **Candle History Insight:**
${formatCandleHistoryInsight(data.candleHistory)}

 **CRITICAL INSTRUCTIONS:**
1. Use EXACT prices and indicator values - they are CODE-CALCULATED.
2. Consider REGIME (${data.regime.regime}) when choosing strategy: ${data.regime.tradingBias}. NOTE: the NUMERIC CHART REPRESENTATION block below uses a separate state-based classifier and may label the same candles RANGING — when they disagree, THIS ADX REGIME IS AUTHORITATIVE for direction and bias; treat chart-representation as context only (trend maturity, momentum, structure).
3. Check DERIVATIVES sentiment (${data.derivatives.overallSentiment}) for positioning bias.
4. OBV Divergence "${data.advancedVolume.obvDivergence}" is a ${data.advancedVolume.obvDivergence !== 'none' ? 'KEY SIGNAL' : 'non-factor'}.
5. Session is ${data.session.sessionName} - volatility expectation: ${data.session.volatilityExpectation}.
6. Use Pivot/Fib levels for precise entry, SL, and TP placement.
7. MTF Confluence Score ${data.confluence.score}/100 indicates ${data.confluence.strength} signal strength.
8. ** CANDLE HISTORY (MANDATORY CITATION):** You MUST cite the Candle History data above in your analysis:
   - Cite 1D/4H counts for macro direction (e.g., "1D shows ${data.candleHistory['1d'].summary}")
   - Cite 1H counts for intraday key-level direction
   - Cite 15m for structure and entry timing reasoning
   - If proposing direction AGAINST dominant HTF candle trend, you MUST provide strong justification.

 **ACCURACY VALIDATION REQUIREMENTS:**
8. **R:R MINIMUM:** High confidence = 2:1, Medium = 1.5:1, Low = 1.2:1
9. **ATR STOP RULE:** Stop loss MUST be >= 1x ATR ($${data.indicators['1h'].atr}) from entry
10. **VOLUME CHECK:** ${data.advancedVolume.trend === 'low' ? ' LOW VOLUME - Cap confidence at Medium for breakouts' : ' Volume adequate'}
11. **CONFLUENCE RULE:** ${data.confluence.score >= 65 || data.confluence.score <= 35 ? ' Strong confluence - High confidence possible' : ' Weak/mixed confluence - Cap at Medium confidence'}
12. **DIVERGENCE CHECK:** ${data.momentum['1h'].rsiDivergence !== 'none' || data.momentum['4h'].rsiDivergence !== 'none' ? ' DIVERGENCE DETECTED - Increases reversal confidence' : 'No major divergence'}

 **REGIME TRADING RULES (ADX: ${data.regime.adx}):**
${data.regime.adx >= 40 ? `- STRONG TREND: Trade WITH the trend only. Counter-trend = AVOID.
- If ${data.regime.trendDirection === 'bullish' ? 'proposing SHORT' : 'proposing LONG'}: You MUST downgrade confidence to LOW or AVOID.` :
            data.regime.adx >= 25 ? `- MODERATE TREND (ADX 25-40): Trade WITH the trend, but require extra confirmation. Counter-trend only at major structure levels.` :
                data.regime.adx < 15 ? `- RANGING MARKET: Use mean-reversion strategy. Breakout trades will likely fail.
- If proposing breakout trade: Add warning about low ADX range-bound price action.` :
                    `- WEAK/NO TREND: No directional edge from ADX. Require confluence from other signals before entry.`}

 **DEVIL'S ADVOCATE (MANDATORY):**
Before finalizing, you MUST provide:
1. Three reasons this trade could FAIL
2. The specific price action that invalidates the setup
3. Crowded trade warning if funding rate > 0.01% or L/S ratio extreme

${data.chartRepresentation ? generateChartPromptInjection(
                    data.chartRepresentation['15m'],
                    data.chartRepresentation['1h'],
                    data.chartRepresentation['4h'],
                    data.chartRepresentation['1d']
                ) : ''}
═══════════════════════════════════════════════════════════════
`;
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
    proposedConfidence?: ConfidenceLevel,
    learningRules?: LearningRulesStorage
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

    // Generate learning rules from post-mortem insights
    let learningRulesInjection = '';
    if (learningRules) {
        learningRulesInjection = generateLearningRulesPrompt(learningRules, {
            coin: granularContext?.coin || data.symbol,
            pattern: granularContext?.pattern,
            direction: data.regime.trendDirection === 'bullish' ? 'Long' as const :
                data.regime.trendDirection === 'bearish' ? 'Short' as const : undefined
        });
    }

    const fullPrompt = `
${baseInjection}

${calibrationInjection}

${sessionInjection}

${learningRulesInjection}

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
    calibration?: ConfidenceCalibration,
    learningRules?: LearningRulesStorage
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
            'High', // Default proposed confidence, will be adjusted by calibration
            learningRules
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

