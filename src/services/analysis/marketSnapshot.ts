/**
 * marketSnapshot — the ONE builder for the Live Market data block.
 *
 * History: this payload used to be assembled by six hand-rolled indicator
 * functions living inside `components/market/LiveMarket.tsx` (SMA, EMA, RSI,
 * MACD, Bollinger, KDJ, parabolic SAR, a candle-pattern label). Five of them
 * were a second implementation of something `TechnicalAnalysisService`
 * already computes from the SAME `technicalindicators` primitives — so the
 * two could print different numbers for the same market, which is exactly
 * the drift the repo's canonical-module rules exist to prevent.
 *
 * The split is now:
 *   · RSI(14) / MACD / Bollinger / the MA + EMA sets / volume / ATR
 *       → `calculateIndicators` (the canonical service). No second math.
 *   · the three things that service does NOT expose — the SHORT-period RSIs
 *     (2 and 3, the "is this a reversal scalp or a trend" read), parabolic
 *     SAR, and the last-candle pattern label — computed here, over the same
 *     `technicalindicators` primitives, so the conventions match.
 *
 * The output SHAPE is unchanged and load-bearing: `utils/liveMarketParser`
 * reads `timeframes[tf].price`, `.structural_analysis.detected_patterns` and
 * `.structural_analysis.key_zones.{support,resistance}`, and
 * `GenericAnalysisService` keys its "this is live market data" formatting off
 * the `**LIVE MARKET DATA**` fence `formatLiveMarketPrompt` writes. Do not
 * reshape it without updating both consumers.
 */

import { RSI, PSAR } from 'technicalindicators';
import { calculateIndicators } from './TechnicalAnalysisService';
import { detectChartPatterns, detectKeyZones, type DetectedPattern } from '../../utils/patternDetection';
import type { Kline } from './MarketDataService';

/** The MA periods the block has always carried (the canonical service also
 *  computes ma50, which nothing downstream asked for — not re-emitted). */
const MA_PERIODS = [5, 10, 20, 30, 60, 200] as const;
/** The EMA periods the block has always carried (ema9/21/50 are the service's
 *  own extras, not part of this payload). */
const EMA_PERIODS = [5, 13, 20, 200] as const;

export interface LiveMarketSnapshot {
    price: number;
    trend_indicators: {
        candle_pattern: string;
        ma: Record<string, number>;
        ema: Record<string, number>;
        bollinger: { upper: number; lower: number; mid: number };
        sar: number | null;
    };
    momentum_indicators: {
        rsi14: number;
        /** Short-period RSI: 2 and 3 flag exhaustion moves the 14-period
         *  smoothing is too slow to show. Null when there is not enough
         *  history to compute them at all. */
        rsi2: number | null;
        rsi3: number | null;
        macd: { dif: number; dea: number; hist: number };
        kdj: { k: number; d: number; j: number };
        volume: number;
    };
    structural_analysis: {
        detected_patterns: DetectedPattern[];
        key_zones: { support: number[]; resistance: number[] };
    };
}

/** Wilder RSI for the SHORT periods. Same library + same defaults the
 *  canonical service uses for 6/12/14/24, so a 3 reads like the tail of a
 *  14 rather than a different oscillator. Null when `period + 1` closes are
 *  missing — the caller emits the key with a null so "not computed" is never
 *  confused with a real reading. */
const shortRsi = (closes: number[], period: number): number | null => {
    if (closes.length < period + 1) return null;
    const series = RSI.calculate({ values: closes, period });
    const last = series[series.length - 1];
    return typeof last === 'number' && Number.isFinite(last) ? last : null;
};

/** Parabolic SAR (0.02 step / 0.2 max — the standard pair the TradingView
 *  widget this panel used to embed defaulted to, so the number a trader
 *  reads here is the number they read there). */
const parabolicSar = (klines: Kline[], step = 0.02, max = 0.2): number | null => {
    if (klines.length < 20) return null;
    const series = PSAR.calculate({
        high: klines.map(k => k.high),
        low: klines.map(k => k.low),
        step,
        max,
    });
    const last = series[series.length - 1];
    return typeof last === 'number' && Number.isFinite(last) ? last : null;
};

/** One label for the CURRENT candle's formation. Deliberately a
 *  three-way classifier, not a pattern engine: the geometric patterns live
 *  in `utils/patternDetection` and ride the block under
 *  `structural_analysis.detected_patterns`; this is the raw candle read that
 *  sits beside them under `trend_indicators`. */
export const identifyCandlePattern = (klines: Kline[]): string => {
    if (klines.length < 2) return 'Normal';
    const current = klines[klines.length - 1];
    const prev = klines[klines.length - 2];
    const body = Math.abs(current.close - current.open);
    const totalRange = current.high - current.low;
    if (body <= totalRange * 0.1 && totalRange > 0) return 'Doji';
    const isBullish = current.close > current.open;
    const isPrevBearish = prev.close < prev.open;
    if (isBullish && isPrevBearish && current.close > prev.open && current.open < prev.close) return 'Bullish Engulfing';
    if (!isBullish && !isPrevBearish && current.close < prev.open && current.open > prev.close) return 'Bearish Engulfing';
    return 'Normal';
};

/** Build one timeframe's slice of the data block. `klines` must be in
 *  chronological order (what `KlineService.fetchKlines` returns). */
export const buildTimeframeSnapshot = (klines: Kline[]): LiveMarketSnapshot => {
    const ind = calculateIndicators(klines);
    const ma: Record<string, number> = {};
    for (const p of MA_PERIODS) ma[String(p)] = ind.sma[`ma${p}` as keyof typeof ind.sma];
    const ema: Record<string, number> = {};
    for (const p of EMA_PERIODS) ema[String(p)] = ind.ema[`ema${p}` as keyof typeof ind.ema];
    return {
        price: ind.currentPrice,
        trend_indicators: {
            candle_pattern: identifyCandlePattern(klines),
            ma,
            ema,
            bollinger: {
                upper: ind.bollingerBands.upper,
                lower: ind.bollingerBands.lower,
                mid: ind.bollingerBands.middle,
            },
            sar: parabolicSar(klines),
        },
        momentum_indicators: {
            rsi14: ind.rsi.rsi14,
            rsi2: shortRsi(klines.map(k => k.close), 2),
            rsi3: shortRsi(klines.map(k => k.close), 3),
            macd: { dif: ind.macd.dif, dea: ind.macd.dea, hist: ind.macd.histogram },
            // The canonical service's stochastic block already carries J
            // (= 3K − 2D), which is the KDJ line the panel reported.
            kdj: { k: ind.stochastic.k, d: ind.stochastic.d, j: ind.stochastic.j },
            volume: ind.volume.current,
        },
        structural_analysis: {
            detected_patterns: detectChartPatterns(klines),
            key_zones: detectKeyZones(klines),
        },
    };
};

/** The prompt the panel hands back to the chat. The fenced JSON block and
 *  the heading are the two things `utils/liveMarketParser` and
 *  `GenericAnalysisService` match on — see the module header. */
export const formatLiveMarketPrompt = (
    asset: string,
    timeframes: Record<string, LiveMarketSnapshot>
): string => {
    const marketData = {
        asset,
        timestamp: new Date().toISOString(),
        timeframes,
    };
    return `**LIVE MARKET DATA**
\`\`\`json
${JSON.stringify(marketData, null, 2)}
\`\`\`

**INSTRUCTION:**
1. Parse the JSON above. It contains precise indicators, algorithmic pattern detections, and calculated support/resistance zones.
2. Use the 'structural_analysis' section to identify the current market structure (Bullish/Bearish patterns).
3. Use 'key_zones' to find valid entry and stop-loss levels.
4. Formulate a high-precision strategy based on this data.`;
};
