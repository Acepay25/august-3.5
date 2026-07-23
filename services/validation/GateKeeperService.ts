/**
 * GateKeeperService - Two-Stage Workflow Orchestrator
 * 
 * Implements a Two-Stage architecture for crypto futures analysis:
 * - Stage 1 (Gate Scan): Fast filter with data integrity checks, Pattern Memory matching, and family pre-filtering
 * - Stage 2 (Full Analysis): Deep analysis with Gate constraints applied
 * 
 * The Gate's constraints (allowedFamilies, confidenceCap) become HARD LIMITS in Stage 2,
 * preventing AI hallucination from bypassing safety checks.
 */

import { MarketData, fetchMarketData, fetchOHLCV, Kline } from '../analysis/MarketDataService';
import { TechnicalIndicators, calculateIndicators } from '../analysis/TechnicalAnalysisService';
import {
    synthesizePatternMemory,
    calculateSimilarity,
    PatternMemorySynthesis,
    SetupContext,
    generateSynthesizedPromptInjection
} from '../learning/PatternMemorySynthesisService';
import { LoggedTrade, TradeOutcome } from '../../types';
import { GATE_SCAN_PROMPT, MASTER_ANALYSIS_PROMPT } from '../../constants/prompts';

// ============================================================================
// TYPES
// ============================================================================

export type FamilyType = 'A' | 'B' | 'C' | 'Omega';

export interface GateInput {
    symbol: string;
    marketData: MarketData;
    indicators: {
        '5m': TechnicalIndicators | null;
        '15m': TechnicalIndicators | null;
        '1h': TechnicalIndicators | null;
        '4h': TechnicalIndicators | null;
    };
    tradeHistory: LoggedTrade[];
}

export interface GateOutput {
    symbol: string;
    pass: boolean; // Only false for truly insufficient data
    reason: string;
    allowedFamilies: FamilyType[]; // Always all families - never exclude
    confidenceCap: number; // 0.0 - 1.0, adjusted by penalties
    confidencePenalties: { // Transparent breakdown of why confidence was reduced
        dataIntegrity: number;    // Penalty from missing indicators
        patternMemory: number;    // Penalty from historical loss similarity
        htfConflict: number;      // Penalty from timeframe misalignment
        volumeContext: number;    // Penalty from volume concerns
        rawTotal: number;         // Sum before diminishing returns
        effectiveTotal: number;   // After diminishing returns curve (floor at 0.20)
    };
    familyBias: { // Explainability: why certain families might be favored
        A: number;     // 0.0 = neutral, positive = favored, negative = disfavored
        B: number;
        C: number;
        Omega: number;
        reasoning: string[];
    };
    warnings: string[];
    insights: string[]; // Informational observations (not penalties)
    suggestedDirection?: 'Long' | 'Short' | 'Neutral'; // From Pattern Memory
    patternMemoryNote?: string;
    stage1Timestamp: string;
    processingTimeMs: number;
}

export interface Stage2Input {
    gateOutput: GateOutput;
    symbol: string;
    marketData: MarketData;
    indicators: GateInput['indicators'];
    patternMemory: PatternMemorySynthesis;
}

export interface TwoStageResult {
    symbol: string;
    gateOutput: GateOutput;
    stage2Performed: boolean;
    stage2Prompt?: string; // The constructed Stage 2 prompt with Gate constraints injected
    totalProcessingTimeMs: number;
}

// ============================================================================
// GATE LOGIC (STAGE 1) - PROGRAMMATIC CHECKS
// ============================================================================

/**
 * Run programmatic gate checks without calling an AI.
 * 
 * PHILOSOPHY: Never exclude families, only adjust confidence.
 * "If the market can logically do it, the system should never forbid it — only reduce confidence."
 */
export function runProgrammaticGate(input: GateInput): GateOutput {
    const startTime = Date.now();
    const { symbol, indicators, tradeHistory } = input;

    // ALL families are ALWAYS allowed - no exclusions
    const allowedFamilies: FamilyType[] = ['A', 'B', 'C', 'Omega'];

    // Start with max confidence, apply penalties
    const BASE_CONFIDENCE = 1.0;
    const DIMINISHING_THRESHOLD = 0.35; // After 35%, apply diminishing returns

    // Penalty tracking (transparent breakdown)
    const penalties = {
        dataIntegrity: 0,
        patternMemory: 0,
        htfConflict: 0,
        volumeContext: 0
    };

    // Family bias tracking (for explainability)
    const familyBias = {
        A: 0,
        B: 0,
        C: 0,
        Omega: 0,
        reasoning: [] as string[]
    };

    const warnings: string[] = [];
    const insights: string[] = [];
    let suggestedDirection: 'Long' | 'Short' | 'Neutral' | undefined;
    let patternMemoryNote: string | undefined;

    // ====== CHECK 1: DATA INTEGRITY ======
    const missingTimeframes: string[] = [];
    const timeframes = ['5m', '15m', '1h', '4h'] as const;

    for (const tf of timeframes) {
        if (!indicators[tf]) {
            missingTimeframes.push(tf);
        }
    }

    if (missingTimeframes.length >= 4) {
        // Truly insufficient data - this is the ONLY case where pass = false
        return {
            symbol,
            pass: false,
            reason: 'Insufficient data: All timeframe indicators unavailable',
            allowedFamilies: [],
            confidenceCap: 0,
            confidencePenalties: {
                ...penalties,
                dataIntegrity: 1.0,
                rawTotal: 1.0,
                effectiveTotal: 1.0
            },
            familyBias: { ...familyBias, reasoning: ['No data available'] },
            warnings: ['Cannot proceed without any market data'],
            insights: [],
            stage1Timestamp: new Date().toISOString(),
            processingTimeMs: Date.now() - startTime
        };
    }

    if (missingTimeframes.length > 0) {
        // Scale penalty: 0.05 per missing timeframe
        penalties.dataIntegrity = missingTimeframes.length * 0.05;
        warnings.push(`Missing data for: ${missingTimeframes.join(', ')} (−${(penalties.dataIntegrity * 100).toFixed(0)}%)`);

        // Missing data disfavors Omega (needs multi-TF confirmation)
        if (missingTimeframes.length >= 2) {
            familyBias.Omega -= 0.2;
            familyBias.reasoning.push('Missing timeframes reduce Omega confidence');
        }
    }

    // ====== CHECK 2: PATTERN MEMORY with Time Decay & Regime Awareness ======
    if (tradeHistory && tradeHistory.length > 0) {
        const setupContext: SetupContext = {
            coin: symbol,
            direction: inferDirection(indicators),
            regime: inferRegime(indicators),
        };

        const losses = tradeHistory.filter(t => t.outcome === TradeOutcome.LOSS);
        let highestLossSimilarity = 0;
        let matchedLoss: LoggedTrade | null = null;
        let timeDecayFactor = 1.0;

        for (const loss of losses) {
            const similarity = calculateSimilarity(setupContext, loss);

            // Apply time decay: losses older than 30 days are weighted less
            const daysSinceLoss = (Date.now() - new Date(loss.timestamp).getTime()) / (1000 * 60 * 60 * 24);
            const decay = daysSinceLoss < 30 ? 1.0 : Math.max(0.5, 1.0 - (daysSinceLoss - 30) / 60);

            const weightedSimilarity = similarity * decay;

            if (weightedSimilarity > highestLossSimilarity) {
                highestLossSimilarity = weightedSimilarity;
                matchedLoss = loss;
                timeDecayFactor = decay;
            }
        }

        if (highestLossSimilarity >= 70 && matchedLoss) {
            const lossDirection = matchedLoss.analysis?.direction;
            const lossDate = new Date(matchedLoss.timestamp).toLocaleDateString();

            if (lossDirection === 'Long') {
                suggestedDirection = 'Short';
            } else if (lossDirection === 'Short') {
                suggestedDirection = 'Long';
            }

            // Scale penalty with time decay
            const basePenalty = 0.15 + ((highestLossSimilarity - 70) * 0.002);
            penalties.patternMemory = basePenalty * timeDecayFactor;

            patternMemoryNote = `Historical ${lossDirection} on ${lossDate} failed (${highestLossSimilarity.toFixed(0)}% match${timeDecayFactor < 1 ? `, ${((1 - timeDecayFactor) * 100).toFixed(0)}% decay` : ''}). Consider ${suggestedDirection || 'opposite'} direction.`;
            warnings.push(`Pattern Memory: ${highestLossSimilarity.toFixed(0)}% match (−${(penalties.patternMemory * 100).toFixed(0)}%)`);

            // Update family bias based on failed pattern
            const failedFamily = matchedLoss.analysis?.detectedPatternFamily;
            if (failedFamily?.includes('A')) { familyBias.A -= 0.15; familyBias.reasoning.push('Family A failed in similar setup'); }
            if (failedFamily?.includes('B')) { familyBias.B -= 0.15; familyBias.reasoning.push('Family B failed in similar setup'); }
            if (failedFamily?.includes('C')) { familyBias.C -= 0.15; familyBias.reasoning.push('Family C failed in similar setup'); }
            if (failedFamily?.includes('Omega')) { familyBias.Omega -= 0.15; familyBias.reasoning.push('Family Omega failed in similar setup'); }

        } else if (highestLossSimilarity >= 50) {
            penalties.patternMemory = (0.05 + ((highestLossSimilarity - 50) * 0.002)) * timeDecayFactor;
            warnings.push(`Pattern Memory: ${highestLossSimilarity.toFixed(0)}% match (−${(penalties.patternMemory * 100).toFixed(0)}%)`);
        }
    }

    // ====== CHECK 3: HTF vs LTF CONFLICT ======
    const trend4h = indicators['4h']?.trendStrength;
    const trend15m = indicators['15m']?.trendStrength;

    if (trend4h && trend15m) {
        const is4hStrong = trend4h.includes('strong');
        const isBullish4h = trend4h.includes('bullish');
        const isBearish4h = trend4h.includes('bearish');
        const isBullish15m = trend15m.includes('bullish');
        const isBearish15m = trend15m.includes('bearish');

        const hasConflict = (isBullish4h && isBearish15m) || (isBearish4h && isBullish15m);

        if (hasConflict) {
            if (is4hStrong) {
                penalties.htfConflict = 0.12;
                insights.push('Strong HTF trend vs LTF opposition - possible pullback or reversal');
                // Strong HTF conflict favors Family A (reversal) or Family B
                familyBias.A += 0.1;
                familyBias.B += 0.1;
                familyBias.Omega -= 0.15;
                familyBias.reasoning.push('HTF/LTF conflict favors reversal setups');
            } else {
                penalties.htfConflict = 0.05;
                insights.push('Mild HTF/LTF divergence - watch for continuation or range');
            }
            warnings.push(`HTF/LTF conflict (−${(penalties.htfConflict * 100).toFixed(0)}%)`);
        } else if (is4hStrong && ((isBullish4h && isBullish15m) || (isBearish4h && isBearish15m))) {
            // Strong alignment - favor continuation families
            familyBias.C += 0.15;
            familyBias.Omega += 0.2;
            familyBias.reasoning.push('Strong HTF/LTF alignment favors continuation');
        }
    }

    // ====== CHECK 4: EXHAUSTION PATTERN DETECTION ======
    const rsi1h = indicators['1h']?.rsi?.rsi14;
    const volume1h = indicators['1h']?.volume;

    if (rsi1h && volume1h) {
        const volumeRatio = volume1h.current / volume1h.average;

        if (rsi1h > 80 && volumeRatio > 1.8) {
            insights.push(`Exhaustion signal: RSI ${rsi1h.toFixed(0)} + ${volumeRatio.toFixed(1)}x volume - consider Family A (short)`);
            familyBias.A += 0.2;
            familyBias.reasoning.push('RSI exhaustion signals favor Family A reversal');
        } else if (rsi1h < 20 && volumeRatio > 1.8) {
            insights.push(`Exhaustion signal: RSI ${rsi1h.toFixed(0)} + ${volumeRatio.toFixed(1)}x volume - consider Family A (long)`);
            familyBias.A += 0.2;
            familyBias.reasoning.push('RSI exhaustion signals favor Family A reversal');
        }
    }

    // ====== CHECK 5: VOLUME CONTEXT ======
    if (volume1h) {
        const volumeRatio = volume1h.current / volume1h.average;
        const isNearExtreme = rsi1h && (rsi1h > 70 || rsi1h < 30);

        if (volumeRatio < 0.3 && isNearExtreme) {
            penalties.volumeContext = 0.08;
            warnings.push(`Low volume (${(volumeRatio * 100).toFixed(0)}%) at RSI extreme (−${(penalties.volumeContext * 100).toFixed(0)}%)`);
        } else if (volumeRatio < 0.3) {
            insights.push(`Low volume (${(volumeRatio * 100).toFixed(0)}%) - possible compression/accumulation`);
        }
    }

    // ====== CALCULATE FINAL CONFIDENCE WITH DIMINISHING RETURNS ======
    const rawTotal = penalties.dataIntegrity + penalties.patternMemory + penalties.htfConflict + penalties.volumeContext;

    // Apply diminishing returns after threshold (soft nonlinear curve)
    let effectiveTotal: number;
    if (rawTotal <= DIMINISHING_THRESHOLD) {
        effectiveTotal = rawTotal;
    } else {
        // After threshold: each additional point only counts for 50%
        effectiveTotal = DIMINISHING_THRESHOLD + (rawTotal - DIMINISHING_THRESHOLD) * 0.5;
    }

    const confidenceCap = Math.max(0.20, BASE_CONFIDENCE - effectiveTotal); // Floor at 0.20

    // ====== CONSTRUCT RESULT ======
    const reason = effectiveTotal > 0
        ? `Passed with ${(effectiveTotal * 100).toFixed(0)}% effective reduction (raw: ${(rawTotal * 100).toFixed(0)}%)`
        : 'All checks passed - full confidence';

    return {
        symbol,
        pass: true,
        reason,
        allowedFamilies,
        confidenceCap: Math.round(confidenceCap * 100) / 100,
        confidencePenalties: {
            ...penalties,
            rawTotal: Math.round(rawTotal * 1000) / 1000,
            effectiveTotal: Math.round(effectiveTotal * 1000) / 1000
        },
        familyBias,
        warnings,
        insights,
        suggestedDirection,
        patternMemoryNote,
        stage1Timestamp: new Date().toISOString(),
        processingTimeMs: Date.now() - startTime
    };
}

/**
 * Infer the likely direction from technical indicators
 */
function inferDirection(indicators: GateInput['indicators']): 'Long' | 'Short' | 'Neutral' {
    let bullishCount = 0;
    let bearishCount = 0;

    for (const tf of ['1h', '4h'] as const) {
        const ind = indicators[tf];
        if (ind) {
            if (ind.trendStrength?.includes('bullish')) bullishCount++;
            if (ind.trendStrength?.includes('bearish')) bearishCount++;
        }
    }

    if (bullishCount > bearishCount) return 'Long';
    if (bearishCount > bullishCount) return 'Short';
    return 'Neutral';
}

/**
 * Infer the market regime from technical indicators
 */
function inferRegime(indicators: GateInput['indicators']): 'trending' | 'ranging' | 'volatile' | 'compression' {
    const ind1h = indicators['1h'];
    if (!ind1h) return 'ranging';

    // Check for compression (low ATR + tight Bollinger)
    if (ind1h.atr && ind1h.bollingerBands) {
        const bbWidth = ind1h.bollingerBands.bandwidth;
        if (bbWidth && bbWidth < 0.02) return 'compression';
    }

    // Check for trending (strong RSI + EMA alignment)
    const rsi = ind1h.rsi?.rsi14;
    if (rsi && (rsi > 65 || rsi < 35)) {
        return 'trending';
    }

    // Check for volatility (high ATR)
    if (ind1h.atrPercent && ind1h.atrPercent > 3) {
        return 'volatile';
    }

    return 'ranging';
}

// ============================================================================
// STAGE 2 PROMPT CONSTRUCTION
// ============================================================================

/**
 * Construct the Stage 2 prompt with Gate constraints injected
 */
export function constructStage2Prompt(
    stage2Input: Stage2Input,
    basePrompt: string = MASTER_ANALYSIS_PROMPT
): string {
    const { gateOutput, patternMemory } = stage2Input;
    const penalties = gateOutput.confidencePenalties;

    // Build penalty breakdown (transparent)
    const penaltyDetails = penalties.effectiveTotal > 0 ? `
📊 **Confidence Adjustments:**
${penalties.dataIntegrity > 0 ? `  • Data Integrity: −${(penalties.dataIntegrity * 100).toFixed(0)}%` : ''}
${penalties.patternMemory > 0 ? `  • Pattern Memory: −${(penalties.patternMemory * 100).toFixed(0)}%` : ''}
${penalties.htfConflict > 0 ? `  • HTF Conflict: −${(penalties.htfConflict * 100).toFixed(0)}%` : ''}
${penalties.volumeContext > 0 ? `  • Volume Context: −${(penalties.volumeContext * 100).toFixed(0)}%` : ''}
  • **Effective Total: −${(penalties.effectiveTotal * 100).toFixed(0)}%** (raw: ${(penalties.rawTotal * 100).toFixed(0)}%)
`.trim() : '';

    // Build family bias section
    const familyBiasSection = gateOutput.familyBias.reasoning.length > 0 ? `
🎯 **Family Bias Analysis:**
  • Family A: ${gateOutput.familyBias.A > 0 ? '+' : ''}${(gateOutput.familyBias.A * 100).toFixed(0)}%
  • Family B: ${gateOutput.familyBias.B > 0 ? '+' : ''}${(gateOutput.familyBias.B * 100).toFixed(0)}%
  • Family C: ${gateOutput.familyBias.C > 0 ? '+' : ''}${(gateOutput.familyBias.C * 100).toFixed(0)}%
  • Family Omega: ${gateOutput.familyBias.Omega > 0 ? '+' : ''}${(gateOutput.familyBias.Omega * 100).toFixed(0)}%
  • Reasoning: ${gateOutput.familyBias.reasoning.join('; ')}
`.trim() : '';

    // Build Gate constraints injection
    const gateConstraintsBlock = `
────────────────────────────────────────
🚨 GATE SCAN RESULTS
────────────────────────────────────────
Symbol: ${gateOutput.symbol}
Gate Status: ${gateOutput.pass ? 'PASSED' : 'BLOCKED'}
Confidence Cap: ${(gateOutput.confidenceCap * 100).toFixed(0)}%
Allowed Families: ${gateOutput.allowedFamilies.join(', ')}

${penaltyDetails}
${familyBiasSection}
${gateOutput.suggestedDirection ? `
🧠 **PATTERN MEMORY INSIGHT:**
Suggested Direction: **${gateOutput.suggestedDirection}**
Reason: ${gateOutput.patternMemoryNote || 'Based on historical pattern analysis'}
` : ''}${gateOutput.warnings.length > 0 ? `
⚠️ **Warnings:**
${gateOutput.warnings.map(w => `  • ${w}`).join('\n')}
` : ''}${gateOutput.insights.length > 0 ? `
💡 **Insights:**
${gateOutput.insights.map(i => `  • ${i}`).join('\n')}
` : ''}
**CONSTRAINTS:**
• Confidence Weight ≤ ${(gateOutput.confidenceCap * 100).toFixed(0)}%
${gateOutput.suggestedDirection ? `• PRIORITIZE ${gateOutput.suggestedDirection} direction analysis` : ''}
────────────────────────────────────────

`;

    // Build Pattern Memory injection
    const patternMemoryBlock = generateSynthesizedPromptInjection(patternMemory);

    // Construct full prompt
    return `${gateConstraintsBlock}${basePrompt}\n\n${patternMemoryBlock}`;
}

// ============================================================================
// MAIN WORKFLOW ORCHESTRATION
// ============================================================================

/**
 * Fetch all required data for Gate Scan
 */
export async function fetchGateInputData(
    symbol: string,
    tradeHistory: LoggedTrade[] = []
): Promise<GateInput | null> {
    try {
        // Fetch market data
        const marketData = await fetchMarketData(symbol);
        if (!marketData) {
            console.warn(`[GateKeeper] Failed to fetch market data for ${symbol}`);
            return null;
        }

        // Fetch OHLCV for each timeframe and calculate indicators
        const timeframes = ['5m', '15m', '1h', '4h'] as const;
        const indicators: GateInput['indicators'] = {
            '5m': null,
            '15m': null,
            '1h': null,
            '4h': null
        };

        for (const tf of timeframes) {
            try {
                const klines = await fetchOHLCV(symbol, tf, 100);
                if (klines && klines.length >= 20) {
                    indicators[tf] = calculateIndicators(klines);
                }
            } catch (err) {
                console.warn(`[GateKeeper] Failed to fetch ${tf} data for ${symbol}:`, err);
            }
        }

        return {
            symbol,
            marketData,
            indicators,
            tradeHistory
        };
    } catch (error) {
        console.error(`[GateKeeper] Error fetching gate input data:`, error);
        return null;
    }
}

/**
 * Run the complete Two-Stage Workflow for a single symbol
 * 
 * @param symbol - The crypto symbol to analyze (e.g., "BTCUSDT")
 * @param tradeHistory - Historical logged trades for Pattern Memory
 * @returns TwoStageResult with gate output and optional Stage 2 prompt
 */
export async function runTwoStageWorkflow(
    symbol: string,
    tradeHistory: LoggedTrade[] = []
): Promise<TwoStageResult> {
    const startTime = Date.now();

    console.log(`[GateKeeper] Starting Two-Stage Workflow for ${symbol}`);

    // ====== FETCH DATA ======
    const gateInput = await fetchGateInputData(symbol, tradeHistory);

    if (!gateInput) {
        // Data fetch failed - return failed gate
        const failedGate: GateOutput = {
            symbol,
            pass: false,
            reason: 'Failed to fetch market data',
            allowedFamilies: [],
            confidenceCap: 0,
            confidencePenalties: { dataIntegrity: 1.0, patternMemory: 0, htfConflict: 0, volumeContext: 0, rawTotal: 1.0, effectiveTotal: 1.0 },
            familyBias: { A: 0, B: 0, C: 0, Omega: 0, reasoning: ['No data available'] },
            warnings: ['Network or API error prevented data fetch'],
            insights: [],
            stage1Timestamp: new Date().toISOString(),
            processingTimeMs: Date.now() - startTime
        };

        return {
            symbol,
            gateOutput: failedGate,
            stage2Performed: false,
            totalProcessingTimeMs: Date.now() - startTime
        };
    }

    // ====== STAGE 1: GATE SCAN ======
    const gateOutput = runProgrammaticGate(gateInput);

    console.log(`[GateKeeper] Gate result for ${symbol}: ${gateOutput.pass ? 'PASSED' : 'BLOCKED'} - ${gateOutput.reason}`);

    if (!gateOutput.pass) {
        // Gate failed - do not proceed to Stage 2
        return {
            symbol,
            gateOutput,
            stage2Performed: false,
            totalProcessingTimeMs: Date.now() - startTime
        };
    }

    // ====== STAGE 2: CONSTRUCT FULL ANALYSIS PROMPT ======
    // Synthesize Pattern Memory
    const setupContext: SetupContext = {
        coin: symbol,
        direction: inferDirection(gateInput.indicators),
        regime: inferRegime(gateInput.indicators)
    };

    const patternMemory = synthesizePatternMemory(setupContext, tradeHistory);

    // Construct Stage 2 input
    const stage2Input: Stage2Input = {
        gateOutput,
        symbol,
        marketData: gateInput.marketData,
        indicators: gateInput.indicators,
        patternMemory
    };

    // Construct the Stage 2 prompt with Gate constraints
    const stage2Prompt = constructStage2Prompt(stage2Input);

    console.log(`[GateKeeper] Stage 2 prompt constructed for ${symbol} (${stage2Prompt.length} chars)`);

    return {
        symbol,
        gateOutput,
        stage2Performed: true,
        stage2Prompt,
        totalProcessingTimeMs: Date.now() - startTime
    };
}

/**
 * Quick gate check without full prompt construction
 * Use this when you only need to know if analysis should proceed
 */
export async function quickGateCheck(
    symbol: string,
    tradeHistory: LoggedTrade[] = []
): Promise<GateOutput> {
    const gateInput = await fetchGateInputData(symbol, tradeHistory);

    if (!gateInput) {
        return {
            symbol,
            pass: false,
            reason: 'Failed to fetch market data',
            allowedFamilies: [],
            confidenceCap: 0,
            confidencePenalties: { dataIntegrity: 1.0, patternMemory: 0, htfConflict: 0, volumeContext: 0, rawTotal: 1.0, effectiveTotal: 1.0 },
            familyBias: { A: 0, B: 0, C: 0, Omega: 0, reasoning: ['No data available'] },
            warnings: ['Network or API error prevented data fetch'],
            insights: [],
            stage1Timestamp: new Date().toISOString(),
            processingTimeMs: 0
        };
    }

    return runProgrammaticGate(gateInput);
}

// ============================================================================
// INTEGRATION HELPERS
// ============================================================================

/**
 * Easy integration function: Get Gate analysis for a symbol
 * Returns enhanced prompt constraints if gate passes, or rejection info if not
 * 
 * Usage:
 * ```
 * const gateResult = await getGateAnalysis('BTCUSDT', tradeHistory);
 * if (gateResult.shouldProceed) {
 *     // Use gateResult.promptPrefix in your AI call
 *     const enhancedPrompt = gateResult.promptPrefix + originalPrompt;
 * } else {
 *     console.log('Gate rejected:', gateResult.rejectionReason);
 * }
 * ```
 */
export async function getGateAnalysis(
    symbol: string,
    tradeHistory: LoggedTrade[] = []
): Promise<{
    shouldProceed: boolean;
    gateOutput: GateOutput;
    promptPrefix: string; // Inject this before the AI prompt
    rejectionReason?: string;
}> {
    const gateOutput = await quickGateCheck(symbol, tradeHistory);

    if (!gateOutput.pass) {
        return {
            shouldProceed: false,
            gateOutput,
            promptPrefix: '',
            rejectionReason: gateOutput.reason
        };
    }

    // Build a compact prompt prefix with Gate constraints
    const penalties = gateOutput.confidencePenalties;
    const promptPrefix = `
────────────────────────────────────────
🚨 GATE SCAN: ${gateOutput.symbol}
────────────────────────────────────────
Confidence Cap: ${(gateOutput.confidenceCap * 100).toFixed(0)}%
${penalties.effectiveTotal > 0 ? `Penalties: −${(penalties.effectiveTotal * 100).toFixed(0)}% (data: ${(penalties.dataIntegrity * 100).toFixed(0)}%, memory: ${(penalties.patternMemory * 100).toFixed(0)}%, HTF: ${(penalties.htfConflict * 100).toFixed(0)}%, vol: ${(penalties.volumeContext * 100).toFixed(0)}%)` : 'No penalties applied'}
${gateOutput.suggestedDirection ? `⚠️ Pattern Memory suggests: ${gateOutput.suggestedDirection}` : ''}
${gateOutput.familyBias.reasoning.length > 0 ? `Family Bias: A${gateOutput.familyBias.A > 0 ? '+' : ''}${(gateOutput.familyBias.A * 100).toFixed(0)}%, B${gateOutput.familyBias.B > 0 ? '+' : ''}${(gateOutput.familyBias.B * 100).toFixed(0)}%, C${gateOutput.familyBias.C > 0 ? '+' : ''}${(gateOutput.familyBias.C * 100).toFixed(0)}%, Ω${gateOutput.familyBias.Omega > 0 ? '+' : ''}${(gateOutput.familyBias.Omega * 100).toFixed(0)}%` : ''}
${gateOutput.warnings.slice(0, 3).map(w => `• ${w}`).join('\n')}
${gateOutput.insights.slice(0, 2).map(i => `💡 ${i}`).join('\n')}
────────────────────────────────────────

`;

    return {
        shouldProceed: true,
        gateOutput,
        promptPrefix
    };
}

// ============================================================================
// UTILITY EXPORTS
// ============================================================================

export {
    GATE_SCAN_PROMPT,
    MASTER_ANALYSIS_PROMPT
};

