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
    fetchRecentLiquidations
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
    calculateMomentum
} from './TechnicalAnalysisService';

import {
    classifyPattern,
    ClassificationResult,
    PatternFamily
} from './PatternClassificationService';

import { getSessionContext, generateSessionSummary, SessionContext } from './SessionService';
import { ConfidenceCalibration } from '../types';
import {
    generateCalibrationPromptInjection,
    generateGranularCalibrationPrompt,
    generateEnhancedCalibrationPromptInjection,
    getProviderAccuracyContext,
    generateSessionCalibrationPrompt,
    ConfidenceLevel
} from './ConfidenceCalibrationService';

import { generateValidationPromptInjection, generateCorrelationRiskPrompt } from './AccuracyValidationService';
import { calculateCorrelationRisk } from './CorrelationRiskService';
import {
    INVALIDATION_THESIS_PROMPT,
    CORRELATION_AWARENESS_PROMPT
} from '../constants/prompts';
import {
    runSimulation,
    generateMonteCarloPromptInjection,
    MonteCarloResult,
    SimulationConfig
} from './MonteCarloService';

import {
    generateLearningRulesPrompt,
    LearningRulesStorage
} from './LearningRulesService';

import {
    NumericChartData,
    generateNumericChartData,
    generateChartPromptInjection
} from './NumericChartService';

/**
 * Enhanced Hybrid Data Packet with all new data sources
 */
export interface HybridDataPacket {
    symbol: string;
    marketData: MarketData;

    // Core Technical Indicators (per timeframe)
    indicators: {
        '5m': TechnicalIndicators;
        '15m': TechnicalIndicators;
        '1h': TechnicalIndicators;
        '4h': TechnicalIndicators;
    };

    // Legacy key levels (for backwards compatibility)
    keyLevels: {
        support: number[];
        resistance: number[];
    };

    confluence: ConfluenceResult;
    fundingRate: number;
    fundingRateSentiment: 'bullish' | 'bearish' | 'neutral';
    dataTimestamp: string;

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
        '5m': VWAPData;
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
    chartRepresentation?: {
        '5m': NumericChartData;  // Added for swing trade precision
        '15m': NumericChartData;
        '1h': NumericChartData;
        '4h': NumericChartData;
    };

    // ========== PATTERN CLASSIFICATION ==========
    // ML-based classification of the setup
    patternClassification: ClassificationResult;

    // ========== CANDLE HISTORY ANALYSIS ==========
    // Last 20 completed candles per timeframe (excludes current incomplete candle)
    candleHistory: {
        '5m': CandleHistory;
        '15m': CandleHistory;
        '1h': CandleHistory;
        '4h': CandleHistory;
    };
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
 * @param candleCount - Number of candles to analyze (default: 20)
 * @returns CandleHistory object
 */
const analyzeCandleHistory = (klines: any[], candleCount: number = 20): CandleHistory => {
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

    // Calculate core TA for each timeframe
    const indicators5m = calculateIndicators(snapshot.klines['5m']);
    const indicators15m = calculateIndicators(snapshot.klines['15m']);
    const indicators1h = calculateIndicators(snapshot.klines['1h']);
    const indicators4h = calculateIndicators(snapshot.klines['4h']);

    // Legacy key levels (for backwards compatibility)
    const keyLevels = calculateKeyLevels(snapshot.klines['4h']);

    // Calculate multi-timeframe confluence score
    const confluence = calculateConfluenceScore({
        '5m': indicators5m,
        '15m': indicators15m,
        '1h': indicators1h,
        '4h': indicators4h
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
    const vwap5m = calculateVWAP(snapshot.klines['5m']);
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

    // Candle History Analysis (last 20 completed candles per timeframe)
    // NOTE: Each timeframe uses its OWN kline data, not shared
    const candleHistory = {
        '5m': analyzeCandleHistory(snapshot.klines['5m']),
        '15m': analyzeCandleHistory(snapshot.klines['15m']),
        '1h': analyzeCandleHistory(snapshot.klines['1h']),
        '4h': analyzeCandleHistory(snapshot.klines['4h'])
    };



    console.log(`  - Candle History: 5m=${candleHistory['5m'].summary}, 1h=${candleHistory['1h'].summary}`);

    // Create partial packet for classification (circular dependency workaround)
    const partialData: any = {
        symbol: snapshot.marketData.symbol,
        marketData: snapshot.marketData,
        indicators: { '5m': indicators5m, '15m': indicators15m, '1h': indicators1h, '4h': indicators4h },
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
            '5m': indicators5m,
            '15m': indicators15m,
            '1h': indicators1h,
            '4h': indicators4h
        },
        keyLevels,
        confluence,
        fundingRate: snapshot.fundingRate,
        fundingRateSentiment,
        dataTimestamp: new Date().toISOString(),

        // Enhanced data
        derivatives,
        advancedVolume,
        regime,
        enhancedKeyLevels,
        vwap: {
            '5m': vwap5m,
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
            '5m': generateNumericChartData(snapshot.klines['5m'], '5m'),  // Added for swing trade precision
            '15m': generateNumericChartData(snapshot.klines['15m'], '15m'),
            '1h': generateNumericChartData(snapshot.klines['1h'], '1h'),
            '4h': generateNumericChartData(snapshot.klines['4h'], '4h')
        },
        // Candle History
        candleHistory
    };
};

/**
 * Generate AI prompt injection for hybrid data
 * This is the structured data block that gets injected into AI prompts
 */
export const generateHybridPromptInjection = (data: HybridDataPacket): string => {
    const fundingDisplay = (data.fundingRate * 100).toFixed(4);
    const confluenceEmoji = data.confluence.direction === 'bullish' ? '🟢' :
        data.confluence.direction === 'bearish' ? '🔴' : '⚪';

    const sentimentEmoji = data.derivatives.overallSentiment === 'very_bullish' ? '🟢🟢' :
        data.derivatives.overallSentiment === 'bullish' ? '🟢' :
            data.derivatives.overallSentiment === 'very_bearish' ? '🔴🔴' :
                data.derivatives.overallSentiment === 'bearish' ? '🔴' : '⚪';

    const regimeEmoji = data.regime.regime.includes('trend_up') ? '📈' :
        data.regime.regime.includes('trend_down') ? '📉' :
            data.regime.regime === 'compression' ? '🔄' :
                data.regime.regime === 'volatile_chop' ? '⚡' : '↔️';

    return `
═══════════════════════════════════════════════════════════════
🤖 HYBRID INTELLIGENCE V2: ENHANCED MARKET DATA
═══════════════════════════════════════════════════════════════
**Symbol:** ${data.symbol}
**Data Timestamp:** ${data.dataTimestamp}
**Source:** Binance API (Real-Time)

📊 **MARKET OVERVIEW:**
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
- 💡 ${data.regime.recommendation}

🧬 **PATTERN FAMILY (ML CLASSIFICATION):**
- Detected: **${data.patternClassification.family.toUpperCase()}** (Confidence: ${(data.patternClassification.confidence * 100).toFixed(0)}%)
- Reasoning: ${data.patternClassification.reasoning.join('; ')}
- Scores: A=${data.patternClassification.scores.familyA} | B=${data.patternClassification.scores.familyB} | C=${data.patternClassification.scores.familyC} | Ω=${data.patternClassification.scores.familyOmega}

${sentimentEmoji} **DERIVATIVES SENTIMENT:**
- Open Interest: $${(data.derivatives.openInterestValue / 1000000).toFixed(2)}M
- Long/Short Ratio: ${data.derivatives.longShortRatio.ratio.toFixed(2)} (${data.derivatives.longShortRatio.sentiment.replace('_', ' ')})
- Top Traders: ${data.derivatives.topTraderRatio.ratio.toFixed(2)} (${data.derivatives.topTraderRatio.sentiment.replace('_', ' ')})
- Taker Buy/Sell: ${data.derivatives.takerBuySell.ratio.toFixed(2)} (${data.derivatives.takerBuySell.pressure.replace('_', ' ')})
- Overall: ${data.derivatives.overallSentiment.replace('_', ' ').toUpperCase()} (Score: ${data.derivatives.sentimentScore})

📖 **ORDER BOOK DEPTH:**
- Spread: $${data.orderBook.spread.toFixed(2)} (${data.orderBook.spreadPercent.toFixed(3)}%)
- Bid Depth (1%): $${(data.orderBook.bidDepth / 1000000).toFixed(2)}M | Ask Depth: $${(data.orderBook.askDepth / 1000000).toFixed(2)}M
- Depth Imbalance: ${(data.orderBook.depthImbalance * 100).toFixed(1)}% (${data.orderBook.dominantSide.toUpperCase()})
${data.orderBook.buyWalls.length > 0 ? `- Buy Walls: ${data.orderBook.buyWalls.slice(0, 2).map(w => `$${w.price} ($${(w.usdValue / 1000000).toFixed(2)}M)`).join(' | ')}` : '- Buy Walls: None detected'}
${data.orderBook.sellWalls.length > 0 ? `- Sell Walls: ${data.orderBook.sellWalls.slice(0, 2).map(w => `$${w.price} ($${(w.usdValue / 1000000).toFixed(2)}M)`).join(' | ')}` : '- Sell Walls: None detected'}
${data.orderBook.wallDistance.nearestBuyWall ? `- Nearest Buy Wall: $${data.orderBook.wallDistance.nearestBuyWall.price} (${data.orderBook.wallDistance.nearestBuyWall.distance.toFixed(2)}% below)` : ''}
${data.orderBook.wallDistance.nearestSellWall ? `- Nearest Sell Wall: $${data.orderBook.wallDistance.nearestSellWall.price} (${data.orderBook.wallDistance.nearestSellWall.distance.toFixed(2)}% above)` : ''}

🔥 **RECENT LIQUIDATIONS (1H):**
- Long Liquidations: $${(data.liquidations.recentLongLiquidations / 1000000).toFixed(2)}M
- Short Liquidations: $${(data.liquidations.recentShortLiquidations / 1000000).toFixed(2)}M
- Total: $${(data.liquidations.totalRecentLiquidations / 1000000).toFixed(2)}M (${data.liquidations.liquidationPressure.toUpperCase()} pressure)
- Dominant: ${data.liquidations.dominantLiquidations.toUpperCase()}
- 💡 ${data.liquidations.sentiment}

📊 **ADVANCED VOLUME ANALYSIS:**
- Relative Volume: ${data.advancedVolume.relativeVolume}x (${data.advancedVolume.trend})
- OBV Trend: ${data.advancedVolume.obvTrend.toUpperCase()} | Divergence: ${data.advancedVolume.obvDivergence.toUpperCase()}
- CVD: ${data.advancedVolume.cvdTrend.replace('_', ' ').toUpperCase()}
- Volume POC: $${data.advancedVolume.volumeProfile.poc} (Price ${data.advancedVolume.volumeProfile.priceVsPOC} POC)
- Volume Bias: ${data.advancedVolume.volumeWeightedBias.toUpperCase()}

🔄 **MULTI-TIMEFRAME CONFLUENCE (MTF):**
- ${confluenceEmoji} Score: ${data.confluence.score}/100 — ${data.confluence.direction.toUpperCase()} (${data.confluence.strength})
- Aligned: ${data.confluence.alignment.slice(0, 4).join(', ') || 'None'}
- Conflicts: ${data.confluence.conflicts.slice(0, 2).join(', ') || 'None'}
${data.confluence.score >= 70 ? '⚡ STRONG BULLISH CONFLUENCE' :
            data.confluence.score <= 30 ? '⚡ STRONG BEARISH CONFLUENCE' :
                '⚠️ Mixed signals - Exercise caution'}

☁️ **ICHIMOKU CLOUD (4H):**
- Signal: ${data.ichimoku['4h'].signal.replace('_', ' ').toUpperCase()}
- Cloud Color: ${data.ichimoku['4h'].cloudColor.toUpperCase()}
- Price vs Cloud: ${data.ichimoku['4h'].priceVsCloud.toUpperCase()}
- TK Cross: ${data.ichimoku['4h'].tkCross.toUpperCase()}
- Cloud: $${data.ichimoku['4h'].cloudBottom} - $${data.ichimoku['4h'].cloudTop}

📉 **VWAP (1H):**
- VWAP: $${data.vwap['1h'].vwap}
- Position: ${data.vwap['1h'].pricePosition.replace(/_/g, ' ').toUpperCase()}
- Bands: $${data.vwap['1h'].lowerBand2} | $${data.vwap['1h'].lowerBand1} | VWAP | $${data.vwap['1h'].upperBand1} | $${data.vwap['1h'].upperBand2}

🚀 **MOMENTUM (1H/4H):**
- 1H ROC: 5p=${data.momentum['1h'].roc5}% | 10p=${data.momentum['1h'].roc10}% | 20p=${data.momentum['1h'].roc20}%
- 1H State: ${data.momentum['1h'].momentum.replace(/_/g, ' ').toUpperCase()} (Score: ${data.momentum['1h'].momentumScore})
- 1H Divergence: RSI=${data.momentum['1h'].rsiDivergence?.toUpperCase() || 'NONE'} | MACD=${data.momentum['1h'].macdDivergence?.toUpperCase() || 'NONE'}
- 4H ROC: 5p=${data.momentum['4h'].roc5}% | 10p=${data.momentum['4h'].roc10}%
- 4H Divergence: RSI=${data.momentum['4h'].rsiDivergence?.toUpperCase() || 'NONE'} | MACD=${data.momentum['4h'].macdDivergence?.toUpperCase() || 'NONE'}

📈 **TECHNICAL ANALYSIS (CODE-CALCULATED):**

${generateTASummary(data.indicators['4h'], '4H Timeframe')}

${generateTASummary(data.indicators['1h'], '1H Timeframe')}

${generateTASummary(data.indicators['15m'], '15M Timeframe')}

${generateTASummary(data.indicators['5m'], '5M Timeframe')}

🎯 **ENHANCED KEY LEVELS:**
**Pivot Points (4H):**
- R3: $${data.enhancedKeyLevels.pivotPoints.daily.r3} | R2: $${data.enhancedKeyLevels.pivotPoints.daily.r2} | R1: $${data.enhancedKeyLevels.pivotPoints.daily.r1}
- PP: $${data.enhancedKeyLevels.pivotPoints.daily.pp}
- S1: $${data.enhancedKeyLevels.pivotPoints.daily.s1} | S2: $${data.enhancedKeyLevels.pivotPoints.daily.s2} | S3: $${data.enhancedKeyLevels.pivotPoints.daily.s3}

**Fibonacci (${data.enhancedKeyLevels.fibLevels.trend.toUpperCase()} trend):**
${data.enhancedKeyLevels.fibLevels.levels.filter(l => ['0.382', '0.5', '0.618'].includes(l.ratio)).map(l => `- ${l.ratio}: $${l.price}`).join('\n')}

**Resistance:** ${data.enhancedKeyLevels.resistance.slice(0, 3).map(r => `$${r.price} (${r.source})`).join(' | ')}
**Support:** ${data.enhancedKeyLevels.support.slice(0, 3).map(s => `$${s.price} (${s.source})`).join(' | ')}

${generateSessionSummary(data.session)}

🕯️ **CANDLE HISTORY (Last 20 Completed):**
- 5m (Entry Confirmation):  ${data.candleHistory['5m'].sequence.join('')} (${data.candleHistory['5m'].summary}) ${data.candleHistory['5m'].dominantTrend === 'bullish' ? '📈' : data.candleHistory['5m'].dominantTrend === 'bearish' ? '📉' : '↔️'}
- 15m (Market Structure): ${data.candleHistory['15m'].sequence.join('')} (${data.candleHistory['15m'].summary}) ${data.candleHistory['15m'].dominantTrend === 'bullish' ? '📈' : data.candleHistory['15m'].dominantTrend === 'bearish' ? '📉' : '↔️'}
- 1h (Key Levels):  ${data.candleHistory['1h'].sequence.join('')} (${data.candleHistory['1h'].summary}) ${data.candleHistory['1h'].dominantTrend === 'bullish' ? '📈' : data.candleHistory['1h'].dominantTrend === 'bearish' ? '📉' : '↔️'}
- 4h (Key Levels):  ${data.candleHistory['4h'].sequence.join('')} (${data.candleHistory['4h'].summary}) ${data.candleHistory['4h'].dominantTrend === 'bullish' ? '📈' : data.candleHistory['4h'].dominantTrend === 'bearish' ? '📉' : '↔️'}

📐 **TIMEFRAME PURPOSE GUIDE:**
- 4H & 1H: Use for key price levels and overall direction
- 15m: Use for market structure (BOS, CHoCH, HH/HL, LH/LL)
- 5m: Use for entry confirmation and timing

💡 **Candle History Insight:**
${(() => {
            const bullish4h = data.candleHistory['4h'].dominantTrend === 'bullish';
            const bearish4h = data.candleHistory['4h'].dominantTrend === 'bearish';
            const bullish1h = data.candleHistory['1h'].dominantTrend === 'bullish';
            const bearish1h = data.candleHistory['1h'].dominantTrend === 'bearish';
            const bullish15m = data.candleHistory['15m'].dominantTrend === 'bullish';
            const bearish15m = data.candleHistory['15m'].dominantTrend === 'bearish';
            const bullish5m = data.candleHistory['5m'].dominantTrend === 'bullish';
            const bearish5m = data.candleHistory['5m'].dominantTrend === 'bearish';

            let insight = '';

            // HTF alignment
            if (bullish4h && bullish1h) {
                insight += '🟢 HTF BULLISH: Both 4H and 1H show strong bullish candle dominance. Favor long setups.';
            } else if (bearish4h && bearish1h) {
                insight += '🔴 HTF BEARISH: Both 4H and 1H show strong bearish candle dominance. Favor short setups.';
            } else if ((bullish4h && bearish1h) || (bearish4h && bullish1h)) {
                insight += '⚠️ HTF DIVERGENCE: 4H vs 1H disagree. Possible reversal or consolidation.';
            } else {
                insight += '↔️ HTF NEUTRAL: No clear HTF candle trend dominance.';
            }

            // LTF entry context
            insight += '\n';
            if (bullish15m && bullish5m) {
                insight += '🟢 LTF ENTRY FAVORABLE: 15m structure and 5m confirmation both bullish.';
            } else if (bearish15m && bearish5m) {
                insight += '🔴 LTF ENTRY FAVORABLE: 15m structure and 5m confirmation both bearish.';
            } else if ((bullish15m && bearish5m) || (bearish15m && bullish5m)) {
                insight += '⚠️ LTF MIXED: 15m and 5m disagree. Wait for alignment before entry.';
            } else {
                insight += '↔️ LTF NEUTRAL: No clear LTF trend. Be cautious with entry timing.';
            }

            return insight;
        })()}

⚠️ **CRITICAL INSTRUCTIONS:**
1. Use EXACT prices and indicator values - they are CODE-CALCULATED.
2. Consider REGIME (${data.regime.regime}) when choosing strategy: ${data.regime.tradingBias}
3. Check DERIVATIVES sentiment (${data.derivatives.overallSentiment}) for positioning bias.
4. OBV Divergence "${data.advancedVolume.obvDivergence}" is a ${data.advancedVolume.obvDivergence !== 'none' ? 'KEY SIGNAL' : 'non-factor'}.
5. Session is ${data.session.sessionName} - volatility expectation: ${data.session.volatilityExpectation}.
6. Use Pivot/Fib levels for precise entry, SL, and TP placement.
7. MTF Confluence Score ${data.confluence.score}/100 indicates ${data.confluence.strength} signal strength.
8. **🕯️ CANDLE HISTORY (MANDATORY CITATION):** You MUST cite the Candle History data above in your analysis:
   - Cite 4H/1H counts for key level direction (e.g., "4H shows ${data.candleHistory['4h'].summary}")
   - Cite 15m for market structure proof
   - Cite 5m for entry confirmation reasoning
   - If proposing direction AGAINST dominant HTF candle trend, you MUST provide strong justification.

🛡️ **ACCURACY VALIDATION REQUIREMENTS:**
8. **R:R MINIMUM:** High confidence = 2:1, Medium = 1.5:1, Low = 1.2:1
9. **ATR STOP RULE:** Stop loss MUST be >= 1x ATR ($${data.indicators['1h'].atr}) from entry
10. **VOLUME CHECK:** ${data.advancedVolume.trend === 'low' ? '⚠️ LOW VOLUME - Cap confidence at Medium for breakouts' : '✅ Volume adequate'}
11. **CONFLUENCE RULE:** ${data.confluence.score >= 65 || data.confluence.score <= 35 ? '✅ Strong confluence - High confidence possible' : '⚠️ Weak/mixed confluence - Cap at Medium confidence'}
12. **DIVERGENCE CHECK:** ${data.momentum['1h'].rsiDivergence !== 'none' || data.momentum['4h'].rsiDivergence !== 'none' ? '✅ DIVERGENCE DETECTED - Increases reversal confidence' : 'No major divergence'}

📊 **REGIME TRADING RULES (ADX: ${data.regime.adx}):**
${data.regime.adx > 25 ? `- STRONG TREND: Trade WITH the trend only. Counter-trend = AVOID.
- If ${data.regime.trendDirection === 'bullish' ? 'proposing SHORT' : 'proposing LONG'}: You MUST downgrade confidence to LOW or AVOID.` :
            data.regime.adx < 15 ? `- RANGING MARKET: Use mean-reversion strategy. Breakout trades will likely fail.
- If proposing breakout trade: Add warning about low ADX range-bound price action.` :
                `- WEAK TREND: Confirmation required. Counter-trend only at major structure levels.`}

😈 **DEVIL'S ADVOCATE (MANDATORY):**
Before finalizing, you MUST provide:
1. Three reasons this trade could FAIL
2. The specific price action that invalidates the setup
3. Crowded trade warning if funding rate > 0.01% or L/S ratio extreme

${data.chartRepresentation ? generateChartPromptInjection(
                    data.chartRepresentation['5m'],  // Added for swing trade precision  
                    data.chartRepresentation['15m'],
                    data.chartRepresentation['1h'],
                    data.chartRepresentation['4h']
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
🎯 ACCURACY ENHANCEMENT PROTOCOLS
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
        // Debug: Log the raw input
        console.log('[MonteCarloForSetup] Raw input:', {
            direction: analysis.direction,
            entryPoints: analysis.entryPoints,
            stopLoss: analysis.stopLoss,
            takeProfit: analysis.takeProfit
        });

        // Extract numeric values from analysis - UPDATED to handle ranges
        const parsePrice = (str: string | undefined): number | null => {
            if (!str) return null;

            // Handle ranges like "3210 - 3220"
            if (str.includes('-')) {
                const parts = str.split('-').map(p => parseFloat(p.replace(/[^0-9.]/g, '')));
                const validParts = parts.filter(p => !isNaN(p));
                if (validParts.length === 2) {
                    return (validParts[0] + validParts[1]) / 2; // Return average
                }
                if (validParts.length > 0) return validParts[0];
            }

            const cleaned = str.replace(/[^0-9.]/g, '');
            const num = parseFloat(cleaned);
            return isNaN(num) ? null : num;
        };

        const entry = parsePrice(analysis.entryPoints?.[0]?.price);
        const stopLoss = parsePrice(analysis.stopLoss);

        // Extract take profits
        const tps = (analysis.takeProfit || [])
            .map(tp => parsePrice(tp.price))
            .filter((p): p is number => p !== null);

        // Debug: Log parsed values
        console.log('[MonteCarloForSetup] Parsed values:', {
            entry,
            stopLoss,
            tps,
            rawEntryPrice: analysis.entryPoints?.[0]?.price,
            rawStopLoss: analysis.stopLoss,
            rawTakeProfits: analysis.takeProfit?.map(tp => tp.price)
        });

        // Validate we have required data
        if (!entry || !stopLoss || tps.length === 0) {
            console.log('[MonteCarloForSetup] Insufficient trade data - entry:', entry, 'stopLoss:', stopLoss, 'tps:', tps);
            return null;
        }

        const direction = (analysis.direction?.toLowerCase().includes('long') ||
            analysis.direction?.toLowerCase().includes('buy'))
            ? 'Long' as const
            : 'Short' as const;

        // Get ATR from hybrid data - average all available timeframes for balanced volatility
        const availableAtrs = [
            hybridData.indicators?.['5m']?.atr,
            hybridData.indicators?.['15m']?.atr,
            hybridData.indicators?.['1h']?.atr,
            hybridData.indicators?.['4h']?.atr
        ].filter((v): v is number => v !== undefined && v > 0);

        let atr: number;
        let atrSource: string;

        if (availableAtrs.length > 0) {
            // Average all available ATRs
            atr = availableAtrs.reduce((sum, val) => sum + val, 0) / availableAtrs.length;
            atrSource = `avg of ${availableAtrs.length} TF`;
        } else {
            // Fallback: Calculate ATR from stop loss distance
            const slDistance = Math.abs(entry - stopLoss);
            atr = slDistance * 2; // Assume SL is ~0.5 ATR
            atrSource = 'fallback from SL';
            console.log('[MonteCarloForSetup] Using fallback ATR from SL distance:', atr);
        }

        // Debug: Log simulation parameters
        console.log('[MonteCarloForSetup] Simulation params:', {
            entry,
            stopLoss,
            tps,
            direction,
            atr,
            atrSource,
            availableAtrs,
            hybridIndicators: Object.keys(hybridData.indicators || {}),
            trendBias: hybridData.regime?.trendDirection
        });

        // Determine trend bias from regime
        let trendBias = 0;
        if (hybridData.regime?.trendDirection === 'bullish') {
            trendBias = direction === 'Long' ? 0.3 : -0.3;
        } else if (hybridData.regime?.trendDirection === 'bearish') {
            trendBias = direction === 'Short' ? 0.3 : -0.3;
        }

        // Run simulation
        const result = runSimulation({
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
        });

        console.log(`[MonteCarloForSetup] Simulation complete: WinRate=${result.winRate}%, EV=${result.expectedValue}%`);

        return result;
    } catch (error) {
        console.error('[MonteCarloForSetup] Simulation failed:', error);
        return null;
    }
};

/**
 * Generate Monte Carlo prompt injection for AI context
 * Use this to add simulation results to AI prompts
 */
export const getMonteCarloInjection = (result: MonteCarloResult): string => {
    return generateMonteCarloPromptInjection(result);
};

