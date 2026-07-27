/**
 * LLMRuleExtractionService.ts
 * 
 * Uses an LLM to extract structured "IF/THEN" invalidation rules from post-mortem text.
 * Follows the MemoryService pattern of reusing existing provider wrappers.
 */

import { getQuickResponse } from '../providers/GenericProviderService';
import { ProviderConfig } from '../../types/provider';
import { extractAndParseJson } from '../../utils/jsonUtils';

export interface ExtractedRule {
    condition: string;
    action: string;
    category: 'entry' | 'exit' | 'risk' | 'pattern' | 'regime' | 'general';
    confidence: number; // 0-100 derived from LLM's certainty
}

/**
 * Prompt to guide the LLM in extracting rules
 */
const generateExtractionPrompt = (postMortemText: string, tradeDetails: string): string => {
    return `
You are a Trading Rule Extractor. Your goal is to convert a post-mortem analysis into specific, actionable IF/THEN rules.

**SOURCE MATERIAL:**
Trade Context: ${tradeDetails}
Post-Mortem: "${postMortemText}"

**OBJECTIVE:**
Extract 1-3 highly specific rules that would prevent this loss or missed opportunity in the future.
Rules must be in the format: "IF [specific technical/market condition], THEN [specific action]".

**RULES FOR EXTRACTION:**
1.  **Conditions** must be objective (e.g., "IF RSI > 70 and Volatility is Low", not "IF market looks weak").
2.  **Actions** must be execution-related (e.g., "THEN wait for 15m candle close", "THEN reduce position size by 50%").
3.  **Category** must be one of: entry, exit, risk, pattern, regime, general.
4.  **Confidence**: How confident are you that this rule is derived directly from the text? (0-100).

**OUTPUT FORMAT:**
Return ONLY a valid JSON array of objects. No markdown formatting.
[
  {
    "condition": "Price hits daily resistance AND volume is declining",
    "action": "wait for a bearish engulfing candle before shorting",
    "category": "entry",
    "confidence": 90
  }
]
`;
};

/**
 * Generic response fetcher that routes to the correct provider service
 */
const getLLMResponse = async (
    config: ProviderConfig,
    prompt: string
): Promise<string> => {
    const systemInstruction = "You are a JSON-only rule extraction engine.";

    try {
        return await getQuickResponse(config, prompt, systemInstruction);
    } catch (error) {
        console.error(`[LLMRuleExtraction] Error extracting rules:`, error);
        throw error;
    }
};

/**
 * Main function to extract rules using LLM
 */
export const extractRulesWithLLM = async (
    postMortemText: string,
    tradeDetails: string = "",
    config: ProviderConfig
): Promise<ExtractedRule[]> => {
    if (!postMortemText || postMortemText.length < 20) return [];

    const prompt = generateExtractionPrompt(postMortemText, tradeDetails);

    try {
        const responseText = await getLLMResponse(config, prompt);
        const parsed = extractAndParseJson(responseText);

        if (Array.isArray(parsed)) {
            // Validate structure
            return parsed.filter((r: any) =>
                r.condition && typeof r.condition === 'string' &&
                r.action && typeof r.action === 'string'
            ).map((r: any) => ({
                condition: r.condition,
                action: r.action,
                category: r.category || 'general',
                confidence: typeof r.confidence === 'number' ? r.confidence : 80
            }));
        }

        return [];
    } catch (error) {
        console.error('[LLMRuleExtraction] Failed to extract rules:', error);
        return [];
    }
};
