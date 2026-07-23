
import { HybridDataPacket } from './HybridIntelligenceService';
import { TradeAnalysis } from '../../../types';

/**
 * Pattern Family Enum
 * - Family A: Reversal / Trap / Exhaustion (High RSI, Div, Rejection)
 * - Family B: Structural Reversal (CHoCH, BOS + Confirmation)
 * - Family C: Trend Continuation (Pullback to EMA, healthy trend)
 * - Omega: Momentum Breakout (Volume expansion, Range break)
 */
export type PatternFamily = 'Family A' | 'Family B' | 'Family C' | 'Family Omega' | 'Unclassified';

export interface ClassificationResult {
    family: PatternFamily;
    confidence: number; // 0.0 - 1.0 confidence in this classification
    scores: {
        familyA: number;
        familyB: number;
        familyC: number;
        familyOmega: number;
    };
    reasoning: string[];
}

/**
 * Feature weights for "Lightweight ML" scoring
 * These weights act as the "trained model" coefficients
 */
const WEIGHTS = {
    // Family A (Reversal)
    A: {
        rsiExtreme: 30, // RSI > 70 or < 30
        divergence: 40, // RSI/MACD divergence present
        volumeSpike: 15, // Volume spike at swing
        wickRejection: 15 // Candle wick rejection
    },
    // Family C (Trend Continuation)
    C: {
        trendAlignment: 35, // 4h/1h alignment
        pullbackRSI: 25, // RSI neutral (40-60) during trend
        adxStrength: 25, // ADX > 25
        emaRespect: 15 // Price bouncing off EMA
    },
    // Family Omega (Breakout)
    Omega: {
        volumeExpansion: 40, // Volume > 2x average
        rangeBreak: 30, // Price breaking key level
        momentumSurge: 20, // ROC/Momentum high
        tightConsolidation: 10 // Pre-breakout compression
    }
    // Family B is often a "catch-all" for structural shifts without extreme momentum
};

/**
 * Pattern Classification Service
 * 
 * Uses a weighted scoring system to objectively classify trade setups into families.
 * Replaces hallucinated/random pattern names from LLMs.
 */
export const classifyPattern = (
    data: HybridDataPacket,
    analysis?: TradeAnalysis // Optional: use AI's proposed direction to help context
): ClassificationResult => {

    // Initialize scores
    const scores = {
        familyA: 0,
        familyB: 0,
        familyC: 0,
        familyOmega: 0
    };

    const reasoning: string[] = [];

    // Extract Features
    const ind1h = data.indicators['1h'];
    const ind4h = data.indicators['4h'];
    const rsi1h = ind1h?.rsi?.rsi14 || 50;
    const adx1h = data.regime.adx;
    const volumeRatio = data.advancedVolume.relativeVolume;
    const regime = data.regime.regime; // 'strong_trend_up' | 'ranging' | etc.

    // -------------------------------------------------------------------------
    // SCORING LOGIC - FAMILY A (Reversal/Exhaustion)
    // -------------------------------------------------------------------------
    if (rsi1h > 70 || rsi1h < 30) {
        scores.familyA += WEIGHTS.A.rsiExtreme;
        reasoning.push(`RSI Extreme (${rsi1h.toFixed(0)}) favors Family A`);
    }

    if (data.momentum['1h'].rsiDivergence !== 'none') {
        scores.familyA += WEIGHTS.A.divergence;
        reasoning.push(`RSI Divergence (${data.momentum['1h'].rsiDivergence}) strongly favors Family A`);
    }

    if (volumeRatio > 1.5 && (rsi1h > 70 || rsi1h < 30)) {
        scores.familyA += WEIGHTS.A.volumeSpike; // Climactic volume
        reasoning.push('Climactic volume at extreme favors Family A');
    }

    // -------------------------------------------------------------------------
    // SCORING LOGIC - FAMILY C (Trend Continuation)
    // -------------------------------------------------------------------------
    // Strong trend alignment (ADX > 25 + matching trend direction)
    if (regime.includes('trend')) {
        scores.familyC += WEIGHTS.C.adxStrength;
        // If analysis direction matches trend, big boost
        if (analysis?.direction && regime.includes(analysis.direction === 'Long' ? 'up' : 'down')) {
            scores.familyC += WEIGHTS.C.trendAlignment;
            reasoning.push('Trade aligns with strong regime trend favors Family C');
        }
    }

    // Pullback characteristics: RSI not extreme but trend is strong
    if (regime.includes('trend') && rsi1h > 40 && rsi1h < 60) {
        scores.familyC += WEIGHTS.C.pullbackRSI;
        reasoning.push('Healthy RSI pullback in trend favors Family C');
    }

    // -------------------------------------------------------------------------
    // SCORING LOGIC - FAMILY OMEGA (Breakout)
    // -------------------------------------------------------------------------
    if (volumeRatio > 2.0) {
        scores.familyOmega += WEIGHTS.Omega.volumeExpansion;
        reasoning.push(`Massive volume (${volumeRatio.toFixed(1)}x) favors Omega Breakout`);
    }

    if (regime === 'compression') {
        scores.familyOmega += WEIGHTS.Omega.tightConsolidation; // Breakout from compression
    }

    const momentumScore = Math.abs(data.momentum['1h'].roc5 || 0);
    if (momentumScore > 2.0) { // arbitrary threshold for "surge"
        scores.familyOmega += WEIGHTS.Omega.momentumSurge;
    }

    // -------------------------------------------------------------------------
    // SCORING LOGIC - FAMILY B (Structural Shift)
    // -------------------------------------------------------------------------
    // Family B is often the winner if A, C, and Omega are all low confidence
    // It represents a "market structure shift" or early reversal without extreme exhaustion

    // If not trending, but not extreme RSI... likely a structure shift (ranging market move)
    if (regime === 'ranging' || regime === 'volatile_chop') {
        scores.familyB += 40; // Baseline for ranging
    }

    // CHoCH (Change of Character) logic - hard to detect without swing points
    // We use a proxy: HTF trend is Neutral or Weak, but LTF is strong
    if (!regime.includes('strong') && Math.abs(ind1h?.macd?.histogram || 0) > 0) {
        scores.familyB += 30; // Momentum shifting in weak trend
    }

    // -------------------------------------------------------------------------
    // WINNER DETERMINATION
    // -------------------------------------------------------------------------
    let maxScore = 0;
    let winner: PatternFamily = 'Unclassified';

    // Check A
    if (scores.familyA > maxScore) { maxScore = scores.familyA; winner = 'Family A'; }
    // Check C
    if (scores.familyC > maxScore) { maxScore = scores.familyC; winner = 'Family C'; }
    // Check Omega
    if (scores.familyOmega > maxScore) { maxScore = scores.familyOmega; winner = 'Family Omega'; }
    // Check B (Check last as fallback for lower scores usually, or specific structure)
    if (scores.familyB > maxScore) { maxScore = scores.familyB; winner = 'Family B'; }

    // Confidence Calculation (Score / Max Possible ~100)
    let confidence = Math.min(1.0, maxScore / 80); // Normalize, assume 80 is "very high"

    // Threshold for unclassified
    if (maxScore < 30) {
        winner = 'Unclassified';
        confidence = 0;
    }

    return {
        family: winner,
        confidence: Math.round(confidence * 100) / 100,
        scores,
        reasoning
    };
};
