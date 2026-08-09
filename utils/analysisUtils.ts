/**
 * Analysis utilities.
 *
 * sanitizeTradeAnalysis is a thin wrapper over the zod-based AI boundary
 * parser in schemas/tradeAnalysis.ts (lenient coercion + semantic fixups).
 * All shape validation and business rules (direction synonyms, probability/
 * confidence coupling, price cleaning, family fallback, legacy bridging)
 * live there and are covered by tests/tradeAnalysisSchema.test.ts.
 */

import { TradeAnalysis } from '../types';
import { parseTradeAnalysis } from '../schemas/tradeAnalysis';

// Shared cleaners, re-exported for consumers (autopilot, metrics).
export { cleanPriceField } from './sanitizers';

/**
 * Sanitize and normalize raw AI analysis output into a valid TradeAnalysis.
 * Never throws — total parse failure yields safe defaults.
 */
export const sanitizeTradeAnalysis = (raw: any): TradeAnalysis => parseTradeAnalysis(raw);

/**
 * Render a raw trade-plan JSON object as readable multi-line text.
 *
 * Used when a model ignores the requested output format and returns a
 * JSON trade plan instead — the card shows this readable summary rather than
 * the raw JSON blob.
 */
export const formatAnalysisForDisplay = (analysis: any): string => {
    if (!analysis || typeof analysis !== 'object') return '';
    const parts: string[] = [];
    if (analysis.coinName) parts.push(`**Coin:** ${analysis.coinName}`);
    if (analysis.direction) parts.push(`**Direction:** ${analysis.direction}`);
    const entries = Array.isArray(analysis.entryPoints)
        ? analysis.entryPoints.map((e: any) => e?.price).filter(Boolean).join(', ')
        : '';
    if (entries) parts.push(`**Entry:** ${entries}`);
    if (analysis.stopLoss) parts.push(`**Stop Loss:** ${analysis.stopLoss}`);
    const tps = Array.isArray(analysis.takeProfit)
        ? analysis.takeProfit.map((t: any) => t?.price).filter(Boolean).join(', ')
        : '';
    if (tps) parts.push(`**Take Profit:** ${tps}`);
    if (typeof analysis.probability === 'number' && !isNaN(analysis.probability)) {
        parts.push(`**Probability:** ${analysis.probability}%`);
    }
    if (analysis.confidence) parts.push(`**Confidence:** ${analysis.confidence}`);
    if (analysis.strategy) parts.push(`**Strategy:** ${analysis.strategy}`);
    if (analysis.keyLevels && typeof analysis.keyLevels === 'object') {
        const sup = Array.isArray(analysis.keyLevels.support) ? analysis.keyLevels.support.join(', ') : '';
        const res = Array.isArray(analysis.keyLevels.resistance) ? analysis.keyLevels.resistance.join(', ') : '';
        if (sup || res) parts.push(`**Key Levels:** Support ${sup || '—'} | Resistance ${res || '—'}`);
    }
    return parts.join('\n');
};

/**
 * Extract a numeric price from a string. Range entries ("3210 - 3220",
 * "3000 to 3050") resolve to their midpoint so entry-relative SL/zone math
 * uses one consistent value — range-unaware copies elsewhere used to differ
 * by import site, silently skewing SL-distance math. Whitespace is preserved
 * so a trailing annotation ("94500 4h") can't glue its digits onto the number
 * (→ 945004).
 */
export const parsePrice = (priceStr: string): number => {
    if (!priceStr) return NaN;
    // Remove commas (e.g. 69,000 -> 69000); whitespace stays intact.
    const cleanStr = priceStr.replace(/,/g, '');
    // The trailing lookahead stops a timeframe-annotated price with a dash
    // ("94500 - 4h") from matching as a range — greedy matching turned it
    // into the midpoint of 94500 and 4.
    const range = cleanStr.match(/(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)(?!\s*[a-zA-Z])/i);
    if (range) {
        return (parseFloat(range[1]) + parseFloat(range[2])) / 2;
    }
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
