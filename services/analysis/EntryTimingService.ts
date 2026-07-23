/**
 * EntryTimingService
 * Scores entry quality and suggests optimized entry when score is low
 * 
 * APPROACH: Evaluate the AI's proposed entry, suggest better entries if available,
 * but DO NOT modify the AI's original recommendation - just warn the user.
 */

import { HybridDataPacket } from './HybridIntelligenceService';
import { TradeAnalysis } from '../../types';

// ============================================================================
// TYPES
// ============================================================================

export interface EntryTimingResult {
    score: number;                    // 0-100
    timing: 'optimal' | 'good' | 'acceptable' | 'early' | 'late' | 'risky';

    // Component scores (each 0-20)
    components: {
        keyLevelProximity: number;    // Near S/R, VWAP, POC, Pivot?
        candleConfirmation: number;   // Confirmation pattern present?
        momentumAlignment: number;    // Momentum aligned with direction?
        atrDistance: number;          // Within optimal ATR distance?
        volumeConfirmation: number;   // Volume spike at entry zone?
    };

    // Warnings and suggestions
    warnings: string[];

    // Suggested better entry (when score < 50)
    suggestedEntry: {
        price: number;
        reason: string;               // "VWAP confluence at $97,200"
        levelType: string;            // "VWAP", "S1 Pivot", etc.
        distanceFromAI: number;       // % difference from AI's entry
    } | null;

    // Nearest key level to AI's proposed entry
    nearestKeyLevel: {
        type: 'support' | 'resistance' | 'vwap' | 'poc' | 'pivot';
        price: number;
        distance: number;             // % distance from entry
        name: string;                 // "S1 Pivot" or "4H Support"
    } | null;

    // Limit Order Simulation (New)
    limitOrderSimulation?: {
        fillProbability: number;      // 0-100%
        expectedWaitTime: number;     // Hours used for calc
        fomoRisk: 'High' | 'Medium' | 'Low'; // Risk of missing original entry
    };

    // Nearest key level to AI's proposed entry
}

interface KeyLevel {
    price: number;
    type: 'support' | 'resistance' | 'vwap' | 'poc' | 'pivot';
    name: string;
    strength: number;                 // 1-3, confluence = higher strength
}

// ============================================================================
// CONSTANTS
// ============================================================================

// Distance thresholds (% from entry to key level)
const OPTIMAL_KEY_LEVEL_DISTANCE = 0.3;   // Within 0.3% = optimal
const GOOD_KEY_LEVEL_DISTANCE = 0.6;      // Within 0.6% = good
const MAX_KEY_LEVEL_DISTANCE = 1.0;       // Beyond 1% = no bonus

// ATR-based entry distance (optimal is within 0.5 ATR of key level)
const OPTIMAL_ATR_DISTANCE = 0.5;
const MAX_ATR_DISTANCE = 1.5;

// Score threshold for suggesting alternative entry
const SUGGEST_ENTRY_THRESHOLD = 50;

// ============================================================================
// CORE FUNCTIONS
// ============================================================================

/**
 * Calculate entry timing score for a trade setup
 */
export const calculateEntryTimingScore = (
    analysis: TradeAnalysis,
    hybridData: HybridDataPacket
): EntryTimingResult => {
    const warnings: string[] = [];
    const components = {
        keyLevelProximity: 0,
        candleConfirmation: 0,
        momentumAlignment: 0,
        atrDistance: 0,
        volumeConfirmation: 0
    };

    // Parse entry price
    const entryPrice = parseFloat(
        analysis.entryPoints?.[0]?.price?.replace(/[^0-9.-]/g, '') || '0'
    );
    const currentPrice = hybridData.marketData.currentPrice;
    const atr = hybridData.indicators['1h'].atr;
    const direction = analysis.direction;

    if (!entryPrice || entryPrice <= 0) {
        return {
            score: 0,
            timing: 'risky',
            components,
            warnings: ['No valid entry price found'],
            suggestedEntry: null,
            nearestKeyLevel: null
        };
    }

    // Collect all key levels
    const keyLevels = collectKeyLevels(hybridData, direction);

    // 1. KEY LEVEL PROXIMITY (0-20 points)
    const keyLevelResult = checkKeyLevelProximity(entryPrice, keyLevels);
    components.keyLevelProximity = keyLevelResult.score;
    if (keyLevelResult.warning) warnings.push(keyLevelResult.warning);

    // 2. CANDLE CONFIRMATION (0-20 points)
    const candleResult = checkCandleConfirmation(hybridData, direction);
    components.candleConfirmation = candleResult.score;
    if (candleResult.warning) warnings.push(candleResult.warning);

    // 3. MOMENTUM ALIGNMENT (0-20 points)
    const momentumResult = checkMomentumAlignment(hybridData, direction);
    components.momentumAlignment = momentumResult.score;
    if (momentumResult.warning) warnings.push(momentumResult.warning);

    // 4. ATR DISTANCE (0-20 points)
    const atrResult = checkATRDistance(entryPrice, currentPrice, atr);
    components.atrDistance = atrResult.score;
    if (atrResult.warning) warnings.push(atrResult.warning);

    // 5. VOLUME CONFIRMATION (0-20 points)
    const volumeResult = checkVolumeConfirmation(hybridData, direction);
    components.volumeConfirmation = volumeResult.score;
    if (volumeResult.warning) warnings.push(volumeResult.warning);

    // Calculate total score
    const totalScore = Object.values(components).reduce((a, b) => a + b, 0);

    // Determine timing quality
    let timing: EntryTimingResult['timing'];
    if (totalScore >= 80) timing = 'optimal';
    else if (totalScore >= 65) timing = 'good';
    else if (totalScore >= 50) timing = 'acceptable';
    else if (totalScore >= 35) timing = 'early';
    else timing = 'risky';

    // Generate suggested entry if score is low
    let suggestedEntry: EntryTimingResult['suggestedEntry'] = null;
    if (totalScore < SUGGEST_ENTRY_THRESHOLD) {
        suggestedEntry = findBetterEntry(entryPrice, keyLevels, direction, currentPrice);
    }

    return {
        score: totalScore,
        timing,
        components,
        warnings,
        suggestedEntry,
        limitOrderSimulation: suggestedEntry ? simulateLimitOrder(
            currentPrice,
            suggestedEntry.price,
            atr,
            // Simple trend proxy (can be enhanced with ADX)
            components.momentumAlignment > 15 ? 0.5 : components.momentumAlignment < 10 ? -0.5 : 0
        ) : undefined,
        nearestKeyLevel: keyLevelResult.nearestLevel
    };
};

// ============================================================================
// KEY LEVEL COLLECTION
// ============================================================================

function collectKeyLevels(data: HybridDataPacket, direction: string | undefined): KeyLevel[] {
    const levels: KeyLevel[] = [];

    // Support/Resistance from enhanced key levels
    data.enhancedKeyLevels.support.forEach(s =>
        levels.push({
            price: s.price,
            type: 'support',
            name: `${s.source} Support`,
            strength: s.source.includes('4h') ? 3 : s.source.includes('1h') ? 2 : 1
        })
    );
    data.enhancedKeyLevels.resistance.forEach(r =>
        levels.push({
            price: r.price,
            type: 'resistance',
            name: `${r.source} Resistance`,
            strength: r.source.includes('4h') ? 3 : r.source.includes('1h') ? 2 : 1
        })
    );

    // VWAP (high strength - important level)
    levels.push({
        price: data.vwap['1h'].vwap,
        type: 'vwap',
        name: 'VWAP',
        strength: 3
    });

    // Volume POC (high strength)
    levels.push({
        price: data.advancedVolume.volumeProfile.poc,
        type: 'poc',
        name: 'Volume POC',
        strength: 3
    });

    // Pivot Points
    const pivots = data.enhancedKeyLevels.pivotPoints.daily;
    levels.push({ price: pivots.pp, type: 'pivot', name: 'Pivot Point', strength: 2 });
    levels.push({ price: pivots.s1, type: 'support', name: 'S1 Pivot', strength: 2 });
    levels.push({ price: pivots.s2, type: 'support', name: 'S2 Pivot', strength: 1 });
    levels.push({ price: pivots.r1, type: 'resistance', name: 'R1 Pivot', strength: 2 });
    levels.push({ price: pivots.r2, type: 'resistance', name: 'R2 Pivot', strength: 1 });

    // Ichimoku cloud edges (if price is near cloud)
    if (data.ichimoku?.['4h']) {
        const ich = data.ichimoku['4h'];
        levels.push({ price: ich.cloudTop, type: 'resistance', name: 'Cloud Top (4H)', strength: 2 });
        levels.push({ price: ich.cloudBottom, type: 'support', name: 'Cloud Bottom (4H)', strength: 2 });
    }

    return levels;
}

// ============================================================================
// COMPONENT CHECKS
// ============================================================================

function checkKeyLevelProximity(entryPrice: number, levels: KeyLevel[]) {
    // Find nearest level
    let nearestLevel: EntryTimingResult['nearestKeyLevel'] = null;
    let minDistance = Infinity;

    for (const level of levels) {
        const distance = Math.abs((entryPrice - level.price) / entryPrice) * 100;
        if (distance < minDistance) {
            minDistance = distance;
            nearestLevel = {
                price: level.price,
                type: level.type,
                distance,
                name: level.name
            };
        }
    }

    // Score based on distance
    let score = 0;
    let warning: string | null = null;

    if (minDistance <= OPTIMAL_KEY_LEVEL_DISTANCE) {
        score = 20;
    } else if (minDistance <= GOOD_KEY_LEVEL_DISTANCE) {
        score = 15;
    } else if (minDistance <= MAX_KEY_LEVEL_DISTANCE) {
        score = 10;
    } else {
        score = 5;
        warning = `Entry is ${minDistance.toFixed(2)}% from nearest key level (${nearestLevel?.name})`;
    }

    return { score, warning, nearestLevel };
}

function checkCandleConfirmation(data: HybridDataPacket, direction: string | undefined) {
    const ind15m = data.indicators['15m'];
    const ind1h = data.indicators['1h'];

    let score = 10; // Base score
    let warning: string | null = null;

    // Check RSI alignment - RSI is nested object with rsi14 etc.
    if (direction === 'Long') {
        if (ind1h.rsi.rsi14 > 30 && ind1h.rsi.rsi14 < 70) score += 5;
        if (ind15m.macd.histogram > 0) score += 5;
        if (ind1h.rsi.rsi14 < 30) {
            score += 5; // Oversold = good for long entry
        }
    } else if (direction === 'Short') {
        if (ind1h.rsi.rsi14 > 30 && ind1h.rsi.rsi14 < 70) score += 5;
        if (ind15m.macd.histogram < 0) score += 5;
        if (ind1h.rsi.rsi14 > 70) {
            score += 5; // Overbought = good for short entry
        }
    }

    score = Math.min(20, score);

    if (score < 15) {
        warning = 'Weak candle confirmation - consider waiting for clearer signal';
    }

    return { score, warning };
}

function checkMomentumAlignment(data: HybridDataPacket, direction: string | undefined) {
    const mom1h = data.momentum['1h'];
    let score = 10;
    let warning: string | null = null;

    // momentum is 'accelerating_up' | 'decelerating_up' | 'accelerating_down' | 'decelerating_down' | 'neutral'
    if (direction === 'Long') {
        if (mom1h.momentum === 'accelerating_up') score = 20;
        else if (mom1h.momentum === 'decelerating_up') score = 15;
        else if (mom1h.momentum === 'neutral') score = 10;
        else {
            score = 5;
            warning = 'Momentum against Long direction';
        }
    } else if (direction === 'Short') {
        if (mom1h.momentum === 'accelerating_down') score = 20;
        else if (mom1h.momentum === 'decelerating_down') score = 15;
        else if (mom1h.momentum === 'neutral') score = 10;
        else {
            score = 5;
            warning = 'Momentum against Short direction';
        }
    }

    return { score, warning };
}

function checkATRDistance(entryPrice: number, currentPrice: number, atr: number) {
    const distance = Math.abs(entryPrice - currentPrice);
    const atrRatio = distance / atr;

    let score = 0;
    let warning: string | null = null;

    if (atrRatio <= OPTIMAL_ATR_DISTANCE) {
        score = 20;
    } else if (atrRatio <= 1.0) {
        score = 15;
    } else if (atrRatio <= MAX_ATR_DISTANCE) {
        score = 10;
    } else {
        score = 5;
        warning = `Entry is ${atrRatio.toFixed(1)} ATR from current price - may miss entry`;
    }

    return { score, warning };
}

function checkVolumeConfirmation(data: HybridDataPacket, direction: string | undefined) {
    const volume = data.advancedVolume;
    let score = 10;
    let warning: string | null = null;

    // Check volume trend - values are 'high' | 'low' | 'normal'
    if (volume.trend === 'high') {
        score += 5;
    } else if (volume.trend === 'low') {
        score -= 5;
        warning = 'Low volume - entry may lack momentum';
    }

    // Check CVD alignment - values are 'buyers_control' | 'sellers_control' | 'balanced'
    if (direction === 'Long' && volume.cvdTrend === 'buyers_control') {
        score += 5;
    } else if (direction === 'Short' && volume.cvdTrend === 'sellers_control') {
        score += 5;
    }

    return { score: Math.max(0, Math.min(20, score)), warning };
}

// ============================================================================
// BETTER ENTRY SUGGESTION
// ============================================================================

function findBetterEntry(
    aiEntry: number,
    keyLevels: KeyLevel[],
    direction: string | undefined,
    currentPrice: number
): EntryTimingResult['suggestedEntry'] {

    // For LONG: Find strong support levels below AI entry but above current price (or slightly below)
    // For SHORT: Find strong resistance levels above AI entry but below current price (or slightly above)

    const candidateLevels: (KeyLevel & { distanceFromAI: number })[] = [];

    for (const level of keyLevels) {
        const distanceFromAI = ((level.price - aiEntry) / aiEntry) * 100;
        const distanceFromCurrent = Math.abs((level.price - currentPrice) / currentPrice) * 100;

        // Only consider levels within reasonable range (5% from AI entry, 3% from current)
        if (Math.abs(distanceFromAI) > 5 || distanceFromCurrent > 3) continue;

        if (direction === 'Long') {
            // For longs, prefer support levels at or below AI entry
            if (level.type === 'support' || level.type === 'vwap' || level.type === 'poc') {
                if (level.price <= aiEntry * 1.001) { // Allow tiny tolerance
                    candidateLevels.push({ ...level, distanceFromAI });
                }
            }
        } else if (direction === 'Short') {
            // For shorts, prefer resistance levels at or above AI entry
            if (level.type === 'resistance' || level.type === 'vwap' || level.type === 'poc') {
                if (level.price >= aiEntry * 0.999) {
                    candidateLevels.push({ ...level, distanceFromAI });
                }
            }
        }
    }

    if (candidateLevels.length === 0) return null;

    // Sort by strength (descending), then by distance from current price
    candidateLevels.sort((a, b) => {
        if (b.strength !== a.strength) return b.strength - a.strength;
        const distA = Math.abs(a.price - currentPrice);
        const distB = Math.abs(b.price - currentPrice);
        return distA - distB;
    });

    const best = candidateLevels[0];

    // Only suggest if it's meaningfully different from AI entry (> 0.2% difference)
    if (Math.abs(best.distanceFromAI) < 0.2) return null;

    return {
        price: best.price,
        reason: `${best.name} at $${best.price.toFixed(2)}`,
        levelType: best.name,
        distanceFromAI: best.distanceFromAI
    };
}


// ============================================================================
// LIMIT ORDER SIMULATION
// ============================================================================

/**
 * Estimate probability of fill using Gaussian decay
 * P(Fill) = exp(-k * (distance / (volatility * sqrt(time))))
 */
function simulateLimitOrder(
    currentPrice: number,
    targetPrice: number,
    atr: number,
    trendStrength: number // -1 to 1 (positive = trend against pullback)
): EntryTimingResult['limitOrderSimulation'] {
    const timeToWait = 4; // Assume 4 hour window for limit order
    const distance = Math.abs(currentPrice - targetPrice);

    // Volatility expands with square root of time
    const projectedRange = atr * Math.sqrt(timeToWait);

    // Adjust for trend bias
    // IF waiting for pullback (Limit Below current in Uptrend), trend makes it harder
    let trendFactor = 1.0;
    if (trendStrength > 0.3) trendFactor = 0.8; // Harder to fill
    else if (trendStrength < -0.3) trendFactor = 1.2; // Easier if trend is weak/reversing

    const effectiveRange = projectedRange * trendFactor;

    // Calibrated decay constant
    const k = 1.2;

    const probability = Math.min(99, Math.max(1,
        Math.exp(-k * (distance / effectiveRange)) * 100
    ));

    let fomoRisk: 'High' | 'Medium' | 'Low' = 'Low';
    if (probability < 30) fomoRisk = 'High';
    else if (probability < 60) fomoRisk = 'Medium';

    return {
        fillProbability: probability,
        expectedWaitTime: timeToWait,
        fomoRisk
    };
}

// ============================================================================
// PROMPT INJECTION
// ============================================================================

export const generateEntryTimingPromptInjection = (result: EntryTimingResult): string => {
    const emoji = result.score >= 70 ? '✅' :
        result.score >= 50 ? '⚠️' : '❌';

    let output = `
${emoji} **ENTRY TIMING SCORE: ${result.score}/100 (${result.timing.toUpperCase()})**

📊 Component Breakdown:
- Key Level Proximity: ${result.components.keyLevelProximity}/20
- Candle Confirmation: ${result.components.candleConfirmation}/20
- Momentum Alignment: ${result.components.momentumAlignment}/20
- ATR Distance: ${result.components.atrDistance}/20
- Volume Confirmation: ${result.components.volumeConfirmation}/20
`;

    if (result.nearestKeyLevel) {
        output += `\n📍 Nearest Key Level: ${result.nearestKeyLevel.name} at $${result.nearestKeyLevel.price} (${result.nearestKeyLevel.distance.toFixed(2)}% away)`;
    }

    if (result.warnings.length > 0) {
        output += `\n\n⚠️ Warnings:\n${result.warnings.map(w => `- ${w}`).join('\n')}`;
    }

    // SUGGESTED BETTER ENTRY (key feature)
    if (result.suggestedEntry) {
        const direction = result.suggestedEntry.distanceFromAI < 0 ? 'lower' : 'higher';
        const sim = result.limitOrderSimulation;

        output += `
\n💡 **BETTER ENTRY AVAILABLE:**
Consider entry at **$${result.suggestedEntry.price.toFixed(2)}** (${result.suggestedEntry.reason})
- Improvement: ${Math.abs(result.suggestedEntry.distanceFromAI).toFixed(2)}% ${direction} than AI.
`;

        if (sim) {
            const probIcon = sim.fillProbability > 60 ? '✅' : sim.fillProbability > 30 ? '⚠️' : '❌';
            output += `- Fill Probability: ${probIcon} ${sim.fillProbability.toFixed(0)}% (within ${sim.expectedWaitTime}h)
- FOMO Risk: **${sim.fomoRisk}** (Chance of missing trade completely)`;

            if (sim.fillProbability < 30) {
                output += `\n⚠️ **WARNING:** Low probability of fill. You might miss the trade if you wait.`;
            }
        }
    }

    // Entry timing rule
    output += `\n**ENTRY TIMING RULE:**\n`;
    if (result.score < 50) {
        output += `❌ Entry timing is POOR. ${result.suggestedEntry ? `Consider the suggested entry at $${result.suggestedEntry.price.toFixed(2)} instead.` : 'Consider waiting for better setup.'}`;
    } else if (result.score < 70) {
        output += '⚠️ Entry timing is ACCEPTABLE but not optimal. Proceed with caution.';
    } else {
        output += '✅ Entry timing is GOOD. Proceed with trade.';
    }

    return output;
};

/**
 * Generate a compact warning for TradeValidationGate
 */
export const generateEntryTimingWarning = (result: EntryTimingResult): string | null => {
    if (result.score >= 50) return null;

    let warning = `📍 ENTRY TIMING: Score ${result.score}/100 (${result.timing})`;

    if (result.suggestedEntry) {
        warning += ` - Better entry: $${result.suggestedEntry.price.toFixed(2)} (${result.suggestedEntry.levelType})`;
    } else if (result.nearestKeyLevel) {
        warning += ` - Wait for ${result.nearestKeyLevel.name} at $${result.nearestKeyLevel.price}`;
    }

    return warning;
};
