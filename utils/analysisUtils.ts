
import { TradeAnalysis, PatternDetail, KeyLevels } from '../types';
import { sanitizeJSONString } from './sanitizers';

const cleanPriceField = (val: any): string => {
    if (!val) return '';
    let str = String(val);

    // Remove content inside parentheses (e.g. " (options strategy)")
    str = str.replace(/\([^)]*\)/g, '');

    // Remove specific jargon words often hallucinated by AI
    const jargon = ['straddle', 'strangle', 'spread', 'condor', 'iron', 'call', 'put', 'option', 'breakeven', 'credit', 'debit', 'halves', 'profit'];
    const regex = new RegExp(`\\b(${jargon.join('|')})\\b`, 'gi');
    str = str.replace(regex, '');

    // Clean up extra whitespace and punctuation left behind
    str = str.replace(/\s+/g, ' ').trim();
    str = str.replace(/^[;,\-\s]+|[;,\-\s]+$/g, ''); // Trim leading/trailing punctuation

    return sanitizeJSONString(str);
};

export const sanitizeTradeAnalysis = (raw: any): TradeAnalysis => {
    // Default safe structure
    const safeAnalysis: TradeAnalysis = {
        coinName: 'Unknown Asset',
        direction: 'Neutral',
        confidence: 'Medium',
        probability: 65, // Default to Medium/65 to prevent 15% bug
        strategy: 'Analysis unavailable',
        activeStrategies: [],
        entryPoints: [],
        stopLoss: '',
        takeProfit: [],
        marketConditions: {
            pattern: 'N/A',
            candleBehavior: 'N/A',
            timeframeAlignment: 'N/A',
            rsi: 'N/A',
            macd: 'N/A',
            sentiment: 'N/A',
            prices: { "5m": "N/A", "15m": "N/A", "1h": "N/A", "4h": "N/A" } // Ensure default prices are always set
        },
        historicalCorrelation: 'N/A',
        createdAt: new Date().toISOString(),
        detectedPatternFamily: undefined,
        detectedPatterns: [],
        keyLevels: { support: [], resistance: [] }, // Ensure default keyLevels are always set
        isUpdate: false,
        updateInterval: undefined
    };

    if (!raw || typeof raw !== 'object') return safeAnalysis;

    const ensureString = (val: any): string => {
        if (val === null || val === undefined) return '';
        if (typeof val === 'string') return sanitizeJSONString(val);
        if (typeof val === 'number') return String(val);
        if (typeof val === 'boolean') return String(val);
        if (typeof val === 'object') {
            // If AI puts an object where a string belongs (common cause of Error #31), try to extract meaningful text
            return val.text || val.message || val.description || val.value || val.price || val.name || JSON.stringify(val);
        }
        return String(val);
    };

    safeAnalysis.coinName = ensureString(raw.coinName || raw.symbol || raw.asset || 'Unknown Asset');

    // Intelligent Direction Mapping
    const rawDirection = ensureString(raw.direction).toLowerCase();
    if (rawDirection.includes('bull') || rawDirection === 'long' || rawDirection.includes('buy')) {
        safeAnalysis.direction = 'Long';
    } else if (rawDirection.includes('bear') || rawDirection === 'short' || rawDirection.includes('sell')) {
        safeAnalysis.direction = 'Short';
    } else {
        safeAnalysis.direction = 'Neutral';
    }

    // Robust Probability Parsing
    let probValue = NaN;
    const rawProb = raw.probability;

    if (typeof rawProb === 'number') {
        probValue = rawProb;
    } else if (typeof rawProb === 'string') {
        const cleanProb = rawProb.replace(/[^0-9.]/g, '');
        if (cleanProb.length > 0) {
            probValue = parseFloat(cleanProb);
        }
    }

    // Treat 0 or negative as missing/invalid to avoid the "always 15%" bug
    // We rely on the fact that a valid probability for a trade should be positive.
    if (!isNaN(probValue) && probValue > 0) {
        // Normalize decimals (e.g. 0.85 -> 85)
        if (probValue <= 1) {
            probValue = probValue * 100;
        }
        // Cap at 100
        if (probValue > 100) probValue = 100;

        safeAnalysis.probability = Math.round(probValue);

        // STRICT CLASSIFICATION based on user rules
        if (safeAnalysis.probability >= 80) {
            safeAnalysis.confidence = 'High';
        } else if (safeAnalysis.probability >= 60) {
            safeAnalysis.confidence = 'Medium';
        } else if (safeAnalysis.probability >= 40) {
            safeAnalysis.confidence = 'Low';
        } else {
            safeAnalysis.confidence = 'Avoid';
            safeAnalysis.probability = 15; // Force 15 if it falls into Avoid bucket
        }
    } else {
        // Fallback Inference: Use confidence string if probability is missing/zero
        const rawConfidence = ensureString(raw.confidence);
        safeAnalysis.confidence = ['High', 'Medium', 'Low', 'Avoid'].includes(rawConfidence) ? (rawConfidence as 'High' | 'Medium' | 'Low' | 'Avoid') : 'Medium';

        switch (safeAnalysis.confidence) {
            case 'High': safeAnalysis.probability = 85; break;
            case 'Medium': safeAnalysis.probability = 65; break;
            case 'Low': safeAnalysis.probability = 45; break;
            case 'Avoid': safeAnalysis.probability = 15; break;
            default: safeAnalysis.probability = 65; break;
        }
    }

    safeAnalysis.strategy = ensureString(raw.strategy);

    safeAnalysis.activeStrategies = Array.isArray(raw.activeStrategies)
        ? raw.activeStrategies.map(ensureString).filter((s: string) => s.length > 0)
        : [];

    if (Array.isArray(raw.entryPoints)) {
        safeAnalysis.entryPoints = raw.entryPoints.map((ep: any) => {
            if (typeof ep === 'string' || typeof ep === 'number') {
                return { price: cleanPriceField(String(ep)), description: '' };
            }
            return {
                price: cleanPriceField(ep?.price),
                description: ensureString(ep?.description)
            };
        }).filter((ep: any) => ep.price && ep.price !== '');
    }

    // Apply strict cleaning to Stop Loss
    safeAnalysis.stopLoss = cleanPriceField(raw.stopLoss);
    safeAnalysis.stopLossPercentage = ensureString(raw.stopLossPercentage);
    safeAnalysis.originalStopLossPercentage = ensureString(raw.originalStopLossPercentage);

    if (Array.isArray(raw.takeProfit)) {
        safeAnalysis.takeProfit = raw.takeProfit.map((tp: any) => {
            if (typeof tp === 'string' || typeof tp === 'number') {
                return { price: cleanPriceField(String(tp)), percentage: '' };
            }
            return {
                price: cleanPriceField(tp?.price),
                percentage: ensureString(tp?.percentage),
                originalPercentage: ensureString(tp?.originalPercentage)
            };
        }).filter((tp: any) => tp.price && tp.price !== '');
    }

    safeAnalysis.historicalCorrelation = ensureString(raw.historicalCorrelation);

    if (raw.marketConditions && typeof raw.marketConditions === 'object') {
        safeAnalysis.marketConditions = {
            pattern: ensureString(raw.marketConditions.pattern || 'N/A'),
            candleBehavior: ensureString(raw.marketConditions.candleBehavior || 'N/A'),
            timeframeAlignment: ensureString(raw.marketConditions.timeframeAlignment || 'N/A'),
            rsi: ensureString(raw.marketConditions.rsi || 'N/A'),
            macd: ensureString(raw.marketConditions.macd || 'N/A'),
            sentiment: ensureString(raw.marketConditions.sentiment || 'N/A'),
            prices: raw.marketConditions.prices && typeof raw.marketConditions.prices === 'object'
                ? Object.fromEntries(Object.entries(raw.marketConditions.prices).map(([k, v]) => [k, ensureString(v)]))
                : { "5m": "N/A", "15m": "N/A", "1h": "N/A", "4h": "N/A" } // Ensure default if missing
        };
    }

    safeAnalysis.createdAt = raw.createdAt || new Date().toISOString();

    // R:R Ratio Extraction - Handle number or string
    if (raw.rrRatio !== undefined && raw.rrRatio !== null) {
        if (typeof raw.rrRatio === 'number') {
            safeAnalysis.rrRatio = raw.rrRatio;
        } else if (typeof raw.rrRatio === 'string') {
            const parsedRR = parseFloat(raw.rrRatio);
            if (!isNaN(parsedRR)) {
                safeAnalysis.rrRatio = parsedRR;
            }
        }
    }

    safeAnalysis.detectedPatternFamily = ensureString(raw.detectedPatternFamily);

    // Fallback if empty, try to extract from marketConditions.pattern or strategy
    if (!safeAnalysis.detectedPatternFamily && safeAnalysis.marketConditions?.pattern) {
        const pat = safeAnalysis.marketConditions.pattern.toUpperCase();
        if (pat.includes('FAMILY A')) safeAnalysis.detectedPatternFamily = 'Family A';
        else if (pat.includes('FAMILY B')) safeAnalysis.detectedPatternFamily = 'Family B';
        else if (pat.includes('FAMILY C')) safeAnalysis.detectedPatternFamily = 'Family C';
        else if (pat.includes('OMEGA')) safeAnalysis.detectedPatternFamily = 'Family Omega';
    }

    // --- NEW FIELDS SANITIZATION ---
    if (Array.isArray(raw.detectedPatterns)) {
        safeAnalysis.detectedPatterns = raw.detectedPatterns.map((p: any) => ({
            name: ensureString(p.name),
            timeframe: ensureString(p.timeframe),
            type: ['Bullish', 'Bearish', 'Neutral'].includes(p.type) ? p.type : 'Neutral',
            confidence: ensureString(p.confidence),
            description: ensureString(p.description)
        }));
    } else {
        safeAnalysis.detectedPatterns = []; // Ensure it's always an array
    }

    if (raw.keyLevels && typeof raw.keyLevels === 'object') {
        safeAnalysis.keyLevels = {
            support: Array.isArray(raw.keyLevels.support) ? raw.keyLevels.support.map(ensureString) : [],
            resistance: Array.isArray(raw.keyLevels.resistance) ? raw.keyLevels.resistance.map(ensureString) : []
        };
    } else {
        safeAnalysis.keyLevels = { support: [], resistance: [] }; // Ensure default if missing
    }

    // PRESERVE UPDATE FLAGS
    if (raw.isUpdate === true || raw.isUpdate === 'true') {
        safeAnalysis.isUpdate = true;
    }
    if (raw.updateInterval) {
        safeAnalysis.updateInterval = ensureString(raw.updateInterval);
    }

    // VALIDITY DURATION - how long the setup remains valid (in minutes)
    if (raw.validityDurationMinutes !== undefined && raw.validityDurationMinutes !== null) {
        const valMinutes = typeof raw.validityDurationMinutes === 'number'
            ? raw.validityDurationMinutes
            : parseInt(String(raw.validityDurationMinutes), 10);
        if (!isNaN(valMinutes) && valMinutes > 0) {
            safeAnalysis.validityDurationMinutes = Math.round(valMinutes);
        }
    }

    // PRESERVE GATE RESULT - sanitize string arrays from AI output
    if (raw.gateResult && typeof raw.gateResult === 'object') {
        const gr = raw.gateResult;
        safeAnalysis.gateResult = {
            ...gr,
            warnings: Array.isArray(gr.warnings) ? gr.warnings.map((w: unknown) => ensureString(w)) : [],
            insights: Array.isArray(gr.insights) ? gr.insights.map((i: unknown) => ensureString(i)) : [],
            reasoning: Array.isArray(gr.reasoning) ? gr.reasoning.map((r: unknown) => ensureString(r)) : [],
        };
    }

    // PRESERVE LEVEL PROBABILITIES (SL/TP hit estimation)
    if (raw.levelProbabilities && typeof raw.levelProbabilities === 'object') {
        const lp = raw.levelProbabilities;
        const defaultReasoning = {
            indicatorBasis: '',
            volatilityFactor: '',
            patternMemoryInfluence: '',
            aiAdjustments: ''
        };

        safeAnalysis.levelProbabilities = {
            slProbability: typeof lp.slProbability === 'number' ? lp.slProbability : 0,
            slReasoning: lp.slReasoning || lp.reasoning?.sl || { ...defaultReasoning },
            tpProbabilities: Array.isArray(lp.tpProbabilities) ? lp.tpProbabilities.map((p: any) => ({
                level: typeof p.level === 'number' ? p.level : 0,
                probability: typeof p.probability === 'number' ? p.probability : 0,
                reasoning: p.reasoning || { ...defaultReasoning }
            })) : [],
            // Legacy fields for backward compatibility
            tp1Probability: typeof lp.tp1Probability === 'number' ? lp.tp1Probability :
                (typeof lp.tpProbabilities?.[0]?.probability === 'number' ? lp.tpProbabilities[0].probability : undefined),
            tp2Probability: typeof lp.tp2Probability === 'number' ? lp.tp2Probability :
                (typeof lp.tpProbabilities?.[1]?.probability === 'number' ? lp.tpProbabilities[1].probability : undefined),
            tp3Probability: typeof lp.tp3Probability === 'number' ? lp.tp3Probability :
                (typeof lp.tpProbabilities?.[2]?.probability === 'number' ? lp.tpProbabilities[2].probability : undefined),
            reasoning: lp.reasoning && typeof lp.reasoning === 'object' ? {
                sl: lp.reasoning.sl || lp.slReasoning || { ...defaultReasoning },
                tp1: lp.reasoning.tp1 || lp.tpProbabilities?.[0]?.reasoning || { ...defaultReasoning },
                tp2: lp.reasoning.tp2 || lp.tpProbabilities?.[1]?.reasoning || undefined,
                tp3: lp.reasoning.tp3 || lp.tpProbabilities?.[2]?.reasoning || undefined
            } : {
                sl: lp.slReasoning || { ...defaultReasoning },
                tp1: lp.tpProbabilities?.[0]?.reasoning || { ...defaultReasoning }
            }
        };
    }

    return safeAnalysis;
};

const parsePrice = (priceStr: string): number => {
    if (!priceStr) return NaN;
    // Remove commas (e.g. 69,000 -> 69000)
    const cleanStr = priceStr.replace(/,/g, '');
    const match = cleanStr.match(/(\d+(?:\.\d+)?)/);
    if (match) {
        return parseFloat(match[0]);
    }
    return NaN;
};

export const recalculateAnalysisMetrics = (analysis: TradeAnalysis, leverage: number): TradeAnalysis => {
    if (!analysis) return sanitizeTradeAnalysis(null);

    const safeAnalysis = sanitizeTradeAnalysis(analysis);
    const newAnalysis = JSON.parse(JSON.stringify(safeAnalysis));

    // Get Base Entry Price
    const entryPriceStr = newAnalysis.entryPoints?.[0]?.price;
    const entryPrice = parsePrice(entryPriceStr);
    const isLong = newAnalysis.direction === 'Long';
    const isShort = newAnalysis.direction === 'Short';

    // Only calculate if we have a valid entry price and direction
    if (!isNaN(entryPrice) && entryPrice > 0 && (isLong || isShort)) {

        // 1. Recalculate Stop Loss Percentage
        const slPriceStr = newAnalysis.stopLoss;
        const slPrice = parsePrice(slPriceStr);

        if (!isNaN(slPrice)) {
            const rawMove = Math.abs(entryPrice - slPrice) / entryPrice;
            const leveragedLoss = rawMove * leverage * 100;
            newAnalysis.stopLossPercentage = `-${leveragedLoss.toFixed(1)}%`;
        } else if (newAnalysis.originalStopLossPercentage) {
            const numericSL = parseFloat(newAnalysis.originalStopLossPercentage);
            if (!isNaN(numericSL)) {
                const leveragedSL = numericSL * leverage;
                newAnalysis.stopLossPercentage = `-${Math.abs(leveragedSL).toFixed(1)}%`;
            }
        }

        // 2. Recalculate Take Profit Percentages
        const validTakeProfits: number[] = [];

        if (Array.isArray(newAnalysis.takeProfit)) {
            newAnalysis.takeProfit = newAnalysis.takeProfit.map((tp: any) => {
                const newTp = { ...tp };
                const tpPrice = parsePrice(newTp.price);

                if (!isNaN(tpPrice)) {
                    validTakeProfits.push(tpPrice);
                    const rawMove = Math.abs(tpPrice - entryPrice) / entryPrice;
                    const leveragedProfit = rawMove * leverage * 100;
                    newTp.percentage = `+${leveragedProfit.toFixed(1)}%`;
                } else {
                    const originalTP = newTp.originalPercentage || newTp.percentage;
                    if (originalTP) {
                        if (!newTp.originalPercentage) {
                            newTp.originalPercentage = originalTP;
                        }
                        const numericTP = parseFloat(originalTP);
                        if (!isNaN(numericTP)) {
                            const leveragedTP = numericTP * leverage;
                            newTp.percentage = `+${Math.abs(leveragedTP).toFixed(1)}%`;
                        }
                    }
                }
                return newTp;
            });
        }

        // 3. Calculate Risk/Reward Ratio (R:R)
        if (!isNaN(slPrice) && validTakeProfits.length > 0) {
            validTakeProfits.sort((a, b) => Math.abs(a - entryPrice) - Math.abs(b - entryPrice));

            const nearestTpPrice = validTakeProfits[0];
            const risk = Math.abs(entryPrice - slPrice);
            const reward = Math.abs(nearestTpPrice - entryPrice);

            if (risk > 0) {
                newAnalysis.rrRatio = parseFloat((reward / risk).toFixed(2));
            }
        }
    }

    return newAnalysis;
};

// Safe default: 4000 tokens (approx 16k chars) is generally safe for Groq/Llama inputs
export const truncateTextToTokens = (text: string, maxTokens: number = 4000): string => {
    if (!text) return "";
    const CHARS_PER_TOKEN = 4;
    const maxChars = maxTokens * CHARS_PER_TOKEN;

    if (text.length <= maxChars) return text;

    console.warn(`Text exceeded ${maxTokens} tokens. Truncating to ${maxChars} chars...`);
    return text.slice(0, maxChars) + "\n...[Truncated to fit context memory]...";
};

/**
 * Truncate a JSON string safely without corrupting the structure.
 *
 * The naive `truncateTextToTokens` does a hard `text.slice(0, maxChars)` which
 * cuts JSON mid-token, producing unparseable output that the moderator cannot read.
 *
 * This function instead:
 * 1. Parses the JSON
 * 2. Truncates long string values (especially `thoughtProcess`)
 * 3. Drops trailing array elements if still over budget
 * 4. Re-serializes — always valid JSON
 *
 * If parsing fails (not JSON), falls back to safe text truncation.
 */
export const truncateJsonSafely = (jsonText: string, maxTokens: number = 4000): string => {
    if (!jsonText) return "";
    const CHARS_PER_TOKEN = 4;
    const maxChars = maxTokens * CHARS_PER_TOKEN;

    if (jsonText.length <= maxChars) return jsonText;

    let parsed: any;
    try {
        parsed = JSON.parse(jsonText);
    } catch {
        // Not valid JSON — fall back to text truncation
        console.warn('[truncateJsonSafely] Input is not valid JSON, falling back to text truncation');
        return truncateTextToTokens(jsonText, maxTokens);
    }

    // Truncate long string values (especially thoughtProcess)
    const MAX_STRING_LEN = 2000;
    const truncateStrings = (obj: any): any => {
        if (typeof obj === 'string') {
            return obj.length > MAX_STRING_LEN
                ? obj.slice(0, MAX_STRING_LEN) + '...[truncated]'
                : obj;
        }
        if (Array.isArray(obj)) {
            // Drop trailing elements if we're still over budget
            let arr = obj.map(truncateStrings);
            const serialized = JSON.stringify(arr);
            if (serialized.length > maxChars && arr.length > 2) {
                // Keep first and last elements, drop middle
                const keepCount = Math.max(2, Math.floor(arr.length * 0.5));
                arr = [...arr.slice(0, keepCount), `...[${arr.length - keepCount} more items truncated]`];
            }
            return arr;
        }
        if (obj && typeof obj === 'object') {
            const result: any = {};
            for (const [key, value] of Object.entries(obj)) {
                result[key] = truncateStrings(value);
            }
            return result;
        }
        return obj;
    };

    try {
        const truncated = truncateStrings(parsed);
        const result = JSON.stringify(truncated);
        if (result.length > maxChars) {
            // Still too long — truncate the final string safely at a JSON boundary
            console.warn(`[truncateJsonSafely] Still ${result.length} chars after structural truncation, doing final cut`);
            return truncateTextToTokens(result, maxTokens);
        }
        return result;
    } catch (e) {
        console.error('[truncateJsonSafely] Failed to re-serialize:', e);
        return truncateTextToTokens(jsonText, maxTokens);
    }
};

/**
 * Clamp a probability value to the Gate's confidence cap.
 *
 * The Gate produces a `confidenceCap` (0-1) based on data integrity, pattern memory,
 * HTF/LTF conflict, and volume context. The moderator can emit any probability,
 * but it should never exceed the gate cap — this enforces that in code.
 *
 * Also applies R:R grade thresholds as a secondary clamp.
 */
export const clampProbabilityToGate = (
    probability: number,
    confidenceCap: number, // 0-1 (e.g., 0.65 = 65%)
    rrRatio?: number
): { probability: number; wasClamped: boolean; reason?: string } => {
    let clamped = probability;
    let wasClamped = false;
    let reason: string | undefined;

    // 1. Gate cap
    const gateCapPercent = confidenceCap * 100;
    if (clamped > gateCapPercent) {
        clamped = gateCapPercent;
        wasClamped = true;
        reason = `Clamped to Gate cap (${gateCapPercent.toFixed(1)}%)`;
    }

    // 2. R:R grade thresholds (only clamp down, never up)
    if (rrRatio !== undefined) {
        if (rrRatio < 1.2 && clamped > 54) {
            clamped = 54;
            wasClamped = true;
            reason = `Clamped to R:R<1.2 threshold (54%)`;
        } else if (rrRatio < 1.5 && clamped > 69) {
            clamped = 69;
            wasClamped = true;
            reason = `Clamped to R:R<1.5 threshold (69%)`;
        }
    }

    return { probability: Math.round(clamped * 10) / 10, wasClamped, reason };
};
