
import { HybridDataPacket } from './HybridIntelligenceService';
import { LoggedTrade, LevelProbabilities, ProbabilityReasoning, TradeOutcome } from '../../types';

/**
 * Service responsible for calculating trade probabilities using deterministic algorithms.
 * Implements the "Hybrid Similarity + Bayesian Model".
 */

interface FeatureVector {
    rsi: number;
    adx: number;
    macdHist: number;
    fundingRate: number;
    regime: string; // MarketRegime: 'strong_trend_up' | 'ranging' | 'volatile_chop' | ...
}

interface SimilarityMatch {
    trade: LoggedTrade;
    score: number; // 0-1 (1 = identical)
    distance: number;
}

export const ProbabilityEngineService = {

    /**
     * Main entry point: Calculate probabilities for a trade based on its snapshot and history.
     */
    calculateAlgoProbabilities(
        snapshot: HybridDataPacket | any, // Use any for now if strict type fails
        loggedTrades: LoggedTrade[],
        direction: 'Long' | 'Short' | 'Neutral'
    ): LevelProbabilities {

        // 1. Extract Features
        const features = extractFeatures(snapshot);

        // 2. Similarity Search (Method 2)
        const matches = findSimilarTrades(features, loggedTrades, direction);

        // 3. Baseline Probability (Prior)
        const prior = calculatePriorFromMatches(matches);

        // 4. Bayesian Adjustments (Method 3)
        const multipliers = calculateLikelihoodMultipliers(snapshot, features, direction);

        // 5. Final Calculation
        const finalProb = applyBayesianUpdate(prior.winRate, multipliers);
        const slProb = 100 - finalProb; // Simple inverse for SL

        // 6. Construct Reasoning
        const reasoningText = generateReasoningText(prior, matches, multipliers);

        return {
            slProbability: slProb,
            tp1Probability: finalProb, // Base target
            tp2Probability: Math.max(0, finalProb - 15), // Decay for TP2
            tp3Probability: Math.max(0, finalProb - 30), // Decay for TP3
            slReasoning: {
                indicatorBasis: "Derived from inverse of TP probability",
                volatilityFactor: "N/A",
                patternMemoryInfluence: "N/A",
                aiAdjustments: "N/A"
            },
            // Legacy/Compat
            reasoning: {
                sl: { indicatorBasis: "Inv(TP)", volatilityFactor: "N/A", patternMemoryInfluence: "N/A", aiAdjustments: "N/A" },
                tp1: { indicatorBasis: "Algo Engine", volatilityFactor: "N/A", patternMemoryInfluence: "N/A", aiAdjustments: reasoningText }
            },
            tpProbabilities: [
                { level: 1, probability: finalProb, reasoning: { indicatorBasis: "Bayesian + Similarity", volatilityFactor: "N/A", patternMemoryInfluence: `${matches.length} matches`, aiAdjustments: reasoningText } },
                { level: 2, probability: Math.max(0, finalProb - 15), reasoning: { indicatorBasis: "Decay Model", volatilityFactor: "N/A", patternMemoryInfluence: "N/A", aiAdjustments: "Linear decay" } },
                { level: 3, probability: Math.max(0, finalProb - 30), reasoning: { indicatorBasis: "Decay Model", volatilityFactor: "N/A", patternMemoryInfluence: "N/A", aiAdjustments: "Linear decay" } }
            ],
            calculationMode: 'Algo'
        };
    }
};

/**
 * Extracts a numeric feature vector from the market snapshot.
 */
function extractFeatures(snapshot: any): FeatureVector {
    if (!snapshot) return getDefaultFeatures();

    const tf = '4h'; // Primary timeframe for feature matching
    const indicators = snapshot.indicators?.[tf] || snapshot.indicators?.['1h'];

    // Safety check
    if (!indicators) return getDefaultFeatures();

    return {
        // Real indicator shapes (TechnicalAnalysisService): RSI lives at
        // indicators.rsi.rsi14, MACD at indicators.macd.histogram, and ADX is
        // NOT part of TechnicalIndicators — it lives on RegimeAnalysis
        // (snapshot.regime.adx). The old reads always fell back to the
        // defaults, so similarity matching degenerated to a pure confluence
        // prior. BTC dominance is not part of the snapshot at all (it lives
        // only in CorrelationRiskService), so it is not a feature here.
        rsi: indicators.rsi?.rsi14 ?? 50,
        adx: snapshot.regime?.adx ?? 25,
        macdHist: indicators.macd?.histogram ?? 0,
        fundingRate: snapshot.fundingRate || 0,
        // RegimeAnalysis: { regime: MarketRegime, trendDirection, ... } —
        // the string lives at .regime (primaryRegime kept as a legacy fallback).
        regime: snapshot.regime?.regime || snapshot.regime?.primaryRegime || 'ranging'
    };
}

function getDefaultFeatures(): FeatureVector {
    return { rsi: 50, adx: 25, macdHist: 0, fundingRate: 0, regime: 'ranging' };
}

/**
 * Finds top K similar trades based on Euclidean distance of features.
 */
function findSimilarTrades(target: FeatureVector, history: LoggedTrade[], direction: string): SimilarityMatch[] {
    const validHistory = history.filter(t => t.analysis && t.outcome !== TradeOutcome.PENDING && t.analysis.direction === direction && t.marketSnapshot);

    // If no snapshot history, fallback to simple filtering? 
    // For now, we only match trades that HAVE snapshots.
    if (validHistory.length === 0) return [];

    const matches: SimilarityMatch[] = validHistory.map(trade => {
        const histFeatures = extractFeatures(trade.marketSnapshot);
        const dist = euclideanDistance(target, histFeatures);
        // Score: 1 / (1 + distance)
        return { trade, score: 1 / (1 + dist), distance: dist };
    });

    // Sort by score desc (closest first) and take top 10
    return matches.sort((a, b) => b.score - a.score).slice(0, 10);
}

function euclideanDistance(a: FeatureVector, b: FeatureVector): number {
    // Normalization factors (approximate variability)
    const wRSI = 1 / 20;
    const wADX = 1 / 20;
    const wMACD = 1 / 50; // Hist can be large

    return Math.sqrt(
        Math.pow((a.rsi - b.rsi) * wRSI, 2) +
        Math.pow((a.adx - b.adx) * wADX, 2) +
        Math.pow((a.macdHist - b.macdHist) * wMACD, 2)
    );
}

/**
 * Calculates base win-rate from similar matches.
 */
function calculatePriorFromMatches(matches: SimilarityMatch[]): { winRate: number, matchCount: number, avgScore: number } {
    if (matches.length === 0) return { winRate: 55, matchCount: 0, avgScore: 0 }; // Default baseline

    const wins = matches.filter(m => m.trade.outcome === TradeOutcome.WIN).length;
    return {
        winRate: (wins / matches.length) * 100,
        matchCount: matches.length,
        avgScore: matches.reduce((acc, m) => acc + m.score, 0) / matches.length
    };
}

/**
 * Calculates Bayesian multipliers based on evidences.
 */
function calculateLikelihoodMultipliers(snapshot: any, features: FeatureVector, direction: string): { name: string, val: number }[] {
    const multipliers: { name: string, val: number }[] = [];

    if (!snapshot) return multipliers;

    // 1. Confluence Score
    const confluence = snapshot.confluence?.score || 50;
    if (confluence > 80) multipliers.push({ name: 'High Confluence', val: 1.15 });
    else if (confluence < 40) multipliers.push({ name: 'Low Confluence', val: 0.85 });

    // 2. Regime Alignment
    // snapshot.regime is a RegimeAnalysis { regime: MarketRegime,
    // trendDirection: 'bullish'|'bearish'|'neutral', ... }. The old read of
    // `primaryRegime` was always undefined, so the 0.90 'Regime Conflict'
    // multiplier fired on nearly every trade and 'Regime Aligned' was
    // unreachable. Chop/compression regimes are NOT a conflict either —
    // only an opposing trend direction is.
    const regimeAnalysis = snapshot.regime;
    const regimeLabel: string = regimeAnalysis?.regime ?? regimeAnalysis?.primaryRegime ?? 'ranging';
    const trendDirection: string | undefined = regimeAnalysis?.trendDirection;
    const regimeIsTrendUp = regimeLabel.includes('trend_up');
    const regimeIsTrendDown = regimeLabel.includes('trend_down');

    if (direction === 'Long' && (trendDirection === 'bullish' || regimeIsTrendUp)) {
        multipliers.push({ name: 'Regime Aligned', val: 1.10 });
    } else if (direction === 'Short' && (trendDirection === 'bearish' || regimeIsTrendDown)) {
        multipliers.push({ name: 'Regime Aligned', val: 1.10 });
    } else if (
        (direction === 'Long' && (trendDirection === 'bearish' || regimeIsTrendDown)) ||
        (direction === 'Short' && (trendDirection === 'bullish' || regimeIsTrendUp))
    ) {
        multipliers.push({ name: 'Regime Conflict', val: 0.90 });
    }
    // ranging / volatile_chop / compression / neutral trend → no regime multiplier

    // 3. Volume Delta (CVD — AdvancedVolumeAnalysis.cvd is a single number,
    // not a per-timeframe delta map)
    const cvd = snapshot.advancedVolume?.cvd || 0;
    const cvdAligned = (direction === 'Long' && cvd > 0) || (direction === 'Short' && cvd < 0);
    if (cvdAligned) multipliers.push({ name: 'Vol Delta Support', val: 1.05 });

    return multipliers;
}

function applyBayesianUpdate(prior: number, multipliers: { name: string, val: number }[]): number {
    let p = prior;
    multipliers.forEach(m => {
        p = p * m.val;
    });
    // Clamp
    return Math.min(99, Math.max(1, Math.round(p)));
}

function generateReasoningText(prior: any, matches: any, multipliers: any): string {
    let text = `Algo Base: ${prior.winRate.toFixed(1)}% derived from ${prior.matchCount} similar historical trades (Avg Sim: ${(prior.avgScore * 100).toFixed(0)}%).`;

    if (multipliers.length > 0) {
        text += `\nAdjustments: ` + multipliers.map((m: any) => `${m.name} (${m.val}x)`).join(', ') + `.`;
    }

    if (prior.matchCount < 3) {
        text += `\n Low Data Warning: Baseline is mostly generic due to lack of similar history.`;
    }

    return text;
}
