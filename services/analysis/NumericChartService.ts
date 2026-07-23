/**
 * NumericChartService - Feature-based + State-Based Chart Representation
 * 
 * Transforms OHLCV candlestick data into structured numeric representation
 * that AI providers and moderators can use to understand chart structure
 * without visual images.
 */

import { Kline } from './MarketDataService';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Per-candle analysis with enhanced features
 */
export interface ChartBar {
    index: number;                              // 0 = most recent
    time: string;                               // Human-readable timestamp
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;

    // Body analysis
    bodySize: number;                           // Body as % of total range
    bodyPercent: number;                        // Close vs Open as %
    direction: 'bullish' | 'bearish' | 'doji';

    // Wick analysis (enhanced)
    upperWickRatio: number;                     // Upper wick / total range (0-1)
    lowerWickRatio: number;                     // Lower wick / total range (0-1)
    wickBias: 'upper' | 'lower' | 'balanced';   // Dominant wick direction

    // Volume analysis (enhanced)
    volumeRelative: number;                     // Relative to 20-bar average
    volumeTrend: 'rising' | 'flat' | 'falling'; // Volume direction
    volumeSpike: boolean;                       // >2x average
}

/**
 * Structured pattern representation (not just a string)
 */
export interface ChartPattern {
    type: 'consecutive' | 'engulfing' | 'inside' | 'hammer' | 'doji_star' | 'pinbar' | 'none';
    direction?: 'bullish' | 'bearish';
    strength: number;                           // 0-1 confidence
    barsInvolved: number;                       // How many bars form this pattern
}

/**
 * Market state snapshot with enhanced granularity
 */
export interface ChartState {
    // Trend (enhanced with maturity)
    trend: 'strong_uptrend' | 'uptrend' | 'ranging' | 'downtrend' | 'strong_downtrend';
    trendMaturity: 'early' | 'mid' | 'late';

    // Momentum
    momentum: 'accelerating' | 'steady' | 'decelerating' | 'reversing';

    // Volatility
    volatility: 'high' | 'normal' | 'low';

    // Position in range
    rangePosition: 'near_high' | 'upper_half' | 'mid' | 'lower_half' | 'near_low';

    // Market Regime
    marketRegime: 'trend' | 'range' | 'compression' | 'breakout';

    // Pattern (structured)
    recentPattern: ChartPattern;

    // Confidence (0-1)
    stateConfidence: number;

    // State Change Detection
    stateShift: 'none' | 'trend_change' | 'volatility_expansion' | 'momentum_loss' | 'regime_shift';
}

/**
 * Complete numeric chart data package
 */
export interface NumericChartData {
    timeframe: string;
    barsAnalyzed: number;
    bars: ChartBar[];                           // Last 10 bars summarized
    state: ChartState;
    keyLevels: {
        recentHigh: number;
        recentLow: number;
        averageClose: number;
        swingHigh?: number;
        swingLow?: number;
    };
    summary: string;                            // One-line summary for quick reference
}

// ============================================================================
// CHART BAR ANALYSIS
// ============================================================================

/**
 * Analyze a single candle bar
 */
export const analyzeBar = (
    kline: Kline,
    index: number,
    avgVolume: number,
    prevVolumes: number[]
): ChartBar => {
    const range = kline.high - kline.low;
    const body = Math.abs(kline.close - kline.open);
    const upperWick = kline.high - Math.max(kline.open, kline.close);
    const lowerWick = Math.min(kline.open, kline.close) - kline.low;

    // Body analysis
    const bodySize = range > 0 ? (body / range) * 100 : 0;
    const bodyPercent = kline.open > 0 ? ((kline.close - kline.open) / kline.open) * 100 : 0;

    // Direction
    let direction: ChartBar['direction'] = 'doji';
    if (bodyPercent > 0.05) direction = 'bullish';
    else if (bodyPercent < -0.05) direction = 'bearish';

    // Wick ratios
    const upperWickRatio = range > 0 ? upperWick / range : 0;
    const lowerWickRatio = range > 0 ? lowerWick / range : 0;

    // Wick bias
    let wickBias: ChartBar['wickBias'] = 'balanced';
    if (upperWickRatio > lowerWickRatio * 1.5) wickBias = 'upper';
    else if (lowerWickRatio > upperWickRatio * 1.5) wickBias = 'lower';

    // Volume analysis
    const volumeRelative = avgVolume > 0 ? kline.volume / avgVolume : 1;
    const volumeSpike = volumeRelative > 2;

    // Volume trend (compare to recent bars)
    let volumeTrend: ChartBar['volumeTrend'] = 'flat';
    if (prevVolumes.length >= 3) {
        const recentAvg = prevVolumes.slice(0, 3).reduce((a, b) => a + b, 0) / 3;
        const olderAvg = prevVolumes.slice(3, 6).reduce((a, b) => a + b, 0) / Math.min(3, prevVolumes.slice(3, 6).length || 1);
        if (recentAvg > olderAvg * 1.2) volumeTrend = 'rising';
        else if (recentAvg < olderAvg * 0.8) volumeTrend = 'falling';
    }

    return {
        index,
        time: new Date(kline.time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
        open: kline.open,
        high: kline.high,
        low: kline.low,
        close: kline.close,
        volume: kline.volume,
        bodySize: Math.round(bodySize),
        bodyPercent: Math.round(bodyPercent * 100) / 100,
        direction,
        upperWickRatio: Math.round(upperWickRatio * 100) / 100,
        lowerWickRatio: Math.round(lowerWickRatio * 100) / 100,
        wickBias,
        volumeRelative: Math.round(volumeRelative * 100) / 100,
        volumeTrend,
        volumeSpike
    };
};

// ============================================================================
// PATTERN DETECTION
// ============================================================================

/**
 * Detect candlestick patterns from recent bars
 */
export const detectPattern = (bars: ChartBar[]): ChartPattern => {
    if (bars.length < 2) {
        return { type: 'none', strength: 0, barsInvolved: 0 };
    }

    const [current, prev, prev2, prev3] = bars;

    // Consecutive pattern (3+ same direction)
    if (bars.length >= 3) {
        const directions = bars.slice(0, 4).map(b => b.direction);
        const bullishCount = directions.filter(d => d === 'bullish').length;
        const bearishCount = directions.filter(d => d === 'bearish').length;

        if (bullishCount >= 3) {
            return {
                type: 'consecutive',
                direction: 'bullish',
                strength: Math.min(bullishCount / 4, 1),
                barsInvolved: bullishCount
            };
        }
        if (bearishCount >= 3) {
            return {
                type: 'consecutive',
                direction: 'bearish',
                strength: Math.min(bearishCount / 4, 1),
                barsInvolved: bearishCount
            };
        }
    }

    // Engulfing pattern
    if (prev && current.bodySize > prev.bodySize * 1.5) {
        if (current.direction === 'bullish' && prev.direction === 'bearish') {
            if (current.close > prev.open && current.open < prev.close) {
                return {
                    type: 'engulfing',
                    direction: 'bullish',
                    strength: 0.8,
                    barsInvolved: 2
                };
            }
        }
        if (current.direction === 'bearish' && prev.direction === 'bullish') {
            if (current.close < prev.open && current.open > prev.close) {
                return {
                    type: 'engulfing',
                    direction: 'bearish',
                    strength: 0.8,
                    barsInvolved: 2
                };
            }
        }
    }

    // Inside bar
    if (prev && current.high < prev.high && current.low > prev.low) {
        return {
            type: 'inside',
            strength: 0.6,
            barsInvolved: 2
        };
    }

    // Hammer / Pinbar
    if (current.lowerWickRatio > 0.6 && current.bodySize < 30) {
        return {
            type: 'hammer',
            direction: 'bullish',
            strength: 0.7,
            barsInvolved: 1
        };
    }
    if (current.upperWickRatio > 0.6 && current.bodySize < 30) {
        return {
            type: 'pinbar',
            direction: 'bearish',
            strength: 0.7,
            barsInvolved: 1
        };
    }

    // Doji star
    if (current.direction === 'doji' && prev && prev.bodySize > 50) {
        return {
            type: 'doji_star',
            direction: prev.direction === 'bullish' ? 'bearish' : 'bullish',
            strength: 0.65,
            barsInvolved: 2
        };
    }

    return { type: 'none', strength: 0, barsInvolved: 0 };
};

// ============================================================================
// TREND & STATE ANALYSIS
// ============================================================================

/**
 * Classify trend direction and maturity
 */
export const classifyTrend = (bars: ChartBar[]): {
    trend: ChartState['trend'];
    maturity: ChartState['trendMaturity'];
    momentum: ChartState['momentum'];
} => {
    if (bars.length < 5) {
        return { trend: 'ranging', maturity: 'mid', momentum: 'steady' };
    }

    // Calculate price changes
    const closes = bars.map(b => b.close);
    const change5 = (closes[0] - closes[4]) / closes[4] * 100;
    const change10 = bars.length >= 10 ? (closes[0] - closes[9]) / closes[9] * 100 : change5;

    // Count consecutive directions
    let consecutiveUp = 0;
    let consecutiveDown = 0;
    for (const bar of bars) {
        if (bar.direction === 'bullish') {
            if (consecutiveDown > 0) break;
            consecutiveUp++;
        } else if (bar.direction === 'bearish') {
            if (consecutiveUp > 0) break;
            consecutiveDown++;
        } else {
            break;
        }
    }

    // Determine trend
    let trend: ChartState['trend'] = 'ranging';
    if (change5 > 2 && consecutiveUp >= 3) trend = 'strong_uptrend';
    else if (change5 > 0.5 && consecutiveUp >= 2) trend = 'uptrend';
    else if (change5 < -2 && consecutiveDown >= 3) trend = 'strong_downtrend';
    else if (change5 < -0.5 && consecutiveDown >= 2) trend = 'downtrend';

    // Determine maturity
    let maturity: ChartState['trendMaturity'] = 'mid';
    const trendBars = Math.max(consecutiveUp, consecutiveDown);
    if (trendBars <= 3) maturity = 'early';
    else if (trendBars >= 7) maturity = 'late';

    // Determine momentum
    let momentum: ChartState['momentum'] = 'steady';
    const recentBodies = bars.slice(0, 3).map(b => Math.abs(b.bodyPercent));
    const olderBodies = bars.slice(3, 6).map(b => Math.abs(b.bodyPercent));
    const recentAvgBody = recentBodies.reduce((a, b) => a + b, 0) / recentBodies.length;
    const olderAvgBody = olderBodies.length > 0 ? olderBodies.reduce((a, b) => a + b, 0) / olderBodies.length : recentAvgBody;

    if (recentAvgBody > olderAvgBody * 1.3) momentum = 'accelerating';
    else if (recentAvgBody < olderAvgBody * 0.7) momentum = 'decelerating';

    // Check for reversal
    if (bars[0].direction !== bars[1].direction && bars[0].direction !== bars[2].direction) {
        if (Math.abs(bars[0].bodyPercent) > Math.abs(bars[1].bodyPercent) * 1.5) {
            momentum = 'reversing';
        }
    }

    return { trend, maturity, momentum };
};

/**
 * Detect market regime
 */
export const detectMarketRegime = (bars: ChartBar[]): ChartState['marketRegime'] => {
    if (bars.length < 10) return 'range';

    // Calculate range compression
    const ranges = bars.slice(0, 10).map(b => b.high - b.low);
    const avgRange = ranges.reduce((a, b) => a + b, 0) / ranges.length;
    const recentRange = ranges.slice(0, 3).reduce((a, b) => a + b, 0) / 3;

    // Compression: ranges getting smaller
    if (recentRange < avgRange * 0.6) {
        return 'compression';
    }

    // Breakout: sudden range expansion
    if (recentRange > avgRange * 1.8 && bars[0].volumeSpike) {
        return 'breakout';
    }

    // Trend vs Range
    const { trend } = classifyTrend(bars);
    if (trend.includes('trend')) {
        return 'trend';
    }

    return 'range';
};

/**
 * Detect state changes from previous analysis
 */
export const detectStateShift = (
    currentTrend: ChartState['trend'],
    currentMomentum: ChartState['momentum'],
    currentVolatility: ChartState['volatility'],
    bars: ChartBar[]
): ChartState['stateShift'] => {
    if (bars.length < 5) return 'none';

    // Trend change: recent bar reverses established direction
    const directions = bars.slice(0, 5).map(b => b.direction);
    const bullishFirst3 = directions.slice(0, 3).filter(d => d === 'bullish').length;
    const bearishFirst3 = directions.slice(0, 3).filter(d => d === 'bearish').length;
    const bullishLast2 = directions.slice(3, 5).filter(d => d === 'bullish').length;
    const bearishLast2 = directions.slice(3, 5).filter(d => d === 'bearish').length;

    if ((bullishFirst3 >= 2 && bearishLast2 >= 2) || (bearishFirst3 >= 2 && bullishLast2 >= 2)) {
        return 'trend_change';
    }

    // Volatility expansion
    if (bars[0].volumeSpike && (bars[0].high - bars[0].low) > (bars[1].high - bars[1].low) * 2) {
        return 'volatility_expansion';
    }

    // Momentum loss
    if (currentMomentum === 'decelerating' || currentMomentum === 'reversing') {
        return 'momentum_loss';
    }

    return 'none';
};

// ============================================================================
// MAIN GENERATION FUNCTIONS
// ============================================================================

/**
 * Generate complete numeric chart data from OHLCV candles
 */
export const generateNumericChartData = (
    klines: Kline[],
    timeframe: string
): NumericChartData => {
    if (klines.length === 0) {
        return {
            timeframe,
            barsAnalyzed: 0,
            bars: [],
            state: {
                trend: 'ranging',
                trendMaturity: 'mid',
                momentum: 'steady',
                volatility: 'normal',
                rangePosition: 'mid',
                marketRegime: 'range',
                recentPattern: { type: 'none', strength: 0, barsInvolved: 0 },
                stateConfidence: 0.5,
                stateShift: 'none'
            },
            keyLevels: {
                recentHigh: 0,
                recentLow: 0,
                averageClose: 0
            },
            summary: 'No data available'
        };
    }

    // Sort by time descending (most recent first)
    const sortedKlines = [...klines].sort((a, b) => b.time - a.time);

    // Calculate average volume for relative comparison
    const avgVolume = sortedKlines.reduce((sum, k) => sum + k.volume, 0) / sortedKlines.length;
    const volumes = sortedKlines.map(k => k.volume);

    // Analyze each bar (last 10 for detailed view)
    const bars: ChartBar[] = sortedKlines.slice(0, 10).map((k, i) =>
        analyzeBar(k, i, avgVolume, volumes.slice(0, i))
    );

    // Detect patterns and trends
    const pattern = detectPattern(bars);
    const { trend, maturity, momentum } = classifyTrend(bars);
    const regime = detectMarketRegime(bars);

    // Calculate volatility
    const atr = sortedKlines.slice(0, 14).reduce((sum, k) => sum + (k.high - k.low), 0) / 14;
    const avgPrice = sortedKlines[0].close;
    const atrPercent = (atr / avgPrice) * 100;
    let volatility: ChartState['volatility'] = 'normal';
    if (atrPercent > 2) volatility = 'high';
    else if (atrPercent < 0.5) volatility = 'low';

    // Range position
    const recentHigh = Math.max(...sortedKlines.slice(0, 20).map(k => k.high));
    const recentLow = Math.min(...sortedKlines.slice(0, 20).map(k => k.low));
    const range = recentHigh - recentLow;
    const currentPrice = sortedKlines[0].close;
    const positionInRange = range > 0 ? (currentPrice - recentLow) / range : 0.5;

    let rangePosition: ChartState['rangePosition'] = 'mid';
    if (positionInRange > 0.85) rangePosition = 'near_high';
    else if (positionInRange > 0.6) rangePosition = 'upper_half';
    else if (positionInRange < 0.15) rangePosition = 'near_low';
    else if (positionInRange < 0.4) rangePosition = 'lower_half';

    // State shift detection
    const stateShift = detectStateShift(trend, momentum, volatility, bars);

    // Calculate state confidence
    let confidence = 0.7;
    if (pattern.strength > 0.7) confidence += 0.1;
    if (bars.slice(0, 3).every(b => b.direction === bars[0].direction)) confidence += 0.1;
    if (regime === 'trend') confidence += 0.1;
    if (stateShift !== 'none') confidence -= 0.15;
    confidence = Math.max(0.3, Math.min(1, confidence));

    // Find swing points
    let swingHigh: number | undefined;
    let swingLow: number | undefined;
    for (let i = 1; i < sortedKlines.length - 1 && i < 20; i++) {
        const k = sortedKlines[i];
        if (!swingHigh && k.high > sortedKlines[i - 1].high && k.high > sortedKlines[i + 1].high) {
            swingHigh = k.high;
        }
        if (!swingLow && k.low < sortedKlines[i - 1].low && k.low < sortedKlines[i + 1].low) {
            swingLow = k.low;
        }
    }

    // Average close
    const averageClose = sortedKlines.slice(0, 20).reduce((sum, k) => sum + k.close, 0) / Math.min(20, sortedKlines.length);

    // Generate summary
    const barsSummary = bars.slice(0, 5).map(b =>
        b.direction === 'bullish' ? '↑' : b.direction === 'bearish' ? '↓' : '→'
    ).join('');

    const summary = `${timeframe} ${trend.replace('_', ' ')} (${maturity}) | ${regime} | ${barsSummary} | Vol: ${volatility}`;

    return {
        timeframe,
        barsAnalyzed: sortedKlines.length,
        bars,
        state: {
            trend,
            trendMaturity: maturity,
            momentum,
            volatility,
            rangePosition,
            marketRegime: regime,
            recentPattern: pattern,
            stateConfidence: Math.round(confidence * 100) / 100,
            stateShift
        },
        keyLevels: {
            recentHigh,
            recentLow,
            averageClose: Math.round(averageClose * 100) / 100,
            swingHigh,
            swingLow
        },
        summary
    };
};

/**
 * Generate AI-readable prompt injection from chart data
 * Now includes 5m timeframe for swing trade precision
 */
export const generateChartPromptInjection = (
    data5m: NumericChartData,
    data15m: NumericChartData,
    data1h: NumericChartData,
    data4h: NumericChartData
): string => {
    const formatTimeframe = (data: NumericChartData): string => {
        const { state, keyLevels, bars } = data;

        // Direction arrows for recent bars
        const barArrows = bars.slice(0, 5).map(b =>
            b.direction === 'bullish' ? '↑' : b.direction === 'bearish' ? '↓' : '→'
        ).join('');

        // Wick analysis
        const wickInfo = bars.slice(0, 3).map(b => b.wickBias).filter(w => w !== 'balanced');
        const dominantWick = wickInfo.length > 0 ? wickInfo[0] : 'balanced';

        // Volume info
        const volumeSpikes = bars.filter(b => b.volumeSpike).length;
        const volumeTrend = bars[0]?.volumeTrend || 'flat';

        // Pattern info
        const patternStr = state.recentPattern.type !== 'none'
            ? `${state.recentPattern.direction || ''} ${state.recentPattern.type} (str: ${state.recentPattern.strength.toFixed(1)})`
            : 'none detected';

        return `
**${data.timeframe.toUpperCase()} CHART:**
├─ Regime: ${state.marketRegime.toUpperCase()} | Trend: ${state.trend.replace('_', ' ').toUpperCase()} (${state.trendMaturity})
├─ Momentum: ${state.momentum} | Volatility: ${state.volatility} | Position: ${state.rangePosition.replace('_', ' ')}
├─ Confidence: ${(state.stateConfidence * 100).toFixed(0)}% | State Shift: ${state.stateShift.replace('_', ' ')}
├─ Pattern: ${patternStr}
├─ Last 5 bars: ${barArrows} | Wick bias: ${dominantWick} | Vol trend: ${volumeTrend}${volumeSpikes > 0 ? ` (${volumeSpikes} spikes)` : ''}
└─ Levels: High $${keyLevels.recentHigh.toLocaleString()} | Low $${keyLevels.recentLow.toLocaleString()}${keyLevels.swingHigh ? ` | SwingH $${keyLevels.swingHigh.toLocaleString()}` : ''}${keyLevels.swingLow ? ` | SwingL $${keyLevels.swingLow.toLocaleString()}` : ''}`;
    };

    return `
═══════════════════════════════════════════════════════════════
📊 NUMERIC CHART REPRESENTATION (Feature-based + State-based)
═══════════════════════════════════════════════════════════════
The following provides a structured view of price action across timeframes.
Use this to understand chart structure without visual images.

${formatTimeframe(data4h)}

${formatTimeframe(data1h)}

${formatTimeframe(data15m)}

${formatTimeframe(data5m)}

**MULTI-TIMEFRAME ALIGNMENT:**
- 4H Trend: ${data4h.state.trend.replace('_', ' ')} | 1H Trend: ${data1h.state.trend.replace('_', ' ')} | 15M Trend: ${data15m.state.trend.replace('_', ' ')} | 5M Trend: ${data5m.state.trend.replace('_', ' ')}
- HTF Alignment: ${data4h.state.trend === data1h.state.trend ? '✅ 4H-1H aligned' : '⚠️ 4H-1H divergence'}
- LTF Alignment: ${data15m.state.trend === data5m.state.trend ? '✅ 15M-5M aligned' : '⚠️ 15M-5M divergence'}

💡 **USE THIS DATA TO:**
- Validate entry timing based on trend maturity
- Check for momentum confirmation across timeframes
- Identify high-probability setups (aligned trends, breakout regimes)
- Use 5M data for precise SWING TRADE entry timing
- Avoid late entries in mature trends
═══════════════════════════════════════════════════════════════
`;
};

