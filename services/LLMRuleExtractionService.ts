/**
 * LLMRuleExtractionService.ts
 * 
 * Uses an LLM to extract structured "IF/THEN" invalidation rules from post-mortem text.
 * Follows the MemoryService pattern of reusing existing provider wrappers.
 */

import * as geminiService from './geminiService';
import * as openaiService from './openaiService';
import * as deepseekService from './deepseekService';
import * as groqService from './groqService';
import * as openrouterService from './openrouterService';
import * as zhipuService from './zhipuService';
import * as grokNativeService from './grokNativeService';
// Add others if needed, but these are the primaries for reasoning

import { AIProvider } from '../types';
import { extractAndParseJson } from '../utils/jsonUtils';

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
    provider: AIProvider,
    prompt: string,
    modelOverride?: string
): Promise<string> => {
    const systemInstruction = "You are a JSON-only rule extraction engine.";

    // Default models if not specified
    const geminiModel = 'gemini-2.0-flash';
    const openaiModel = 'gpt-4o';
    const deepseekModel = 'deepseek-chat';
    const groqModel = 'llama-3.3-70b-versatile';
    const openrouterModel = 'meta-llama/llama-3.3-70b-instruct:free';
    const zhipuModel = 'glm-4-flash';
    const grokModel = 'grok-2-1212';

    try {
        switch (provider) {
            case AIProvider.GEMINI:
                return await geminiService.getQuickResponse(prompt, [], modelOverride || geminiModel, systemInstruction);
            case AIProvider.OPENAI:
                return await openaiService.getQuickResponse(prompt, [], modelOverride || openaiModel, systemInstruction);
            case AIProvider.DEEPSEEK:
                return await deepseekService.getQuickResponse(prompt, [], modelOverride || deepseekModel, systemInstruction);
            case AIProvider.GROQ:
            case AIProvider.GROQ_NEW:
            case AIProvider.GROQ_ALT2:
                return await groqService.getQuickResponse(prompt, [], modelOverride || groqModel, systemInstruction);
            case AIProvider.OPENROUTER:
                return await openrouterService.getQuickResponse(prompt, [], modelOverride || openrouterModel, systemInstruction);
            case AIProvider.ZHIPU:
                return await zhipuService.getQuickResponse(prompt, [], modelOverride || zhipuModel, systemInstruction);
            case AIProvider.GROK:
                return await grokNativeService.getQuickResponse(prompt, [], modelOverride || grokModel, systemInstruction);
            default:
                console.warn(`[LLMRuleExtraction] Provider ${provider} not explicitly supported, falling back to Gemini.`);
                return await geminiService.getQuickResponse(prompt, [], geminiModel, systemInstruction);
        }
    } catch (error) {
        console.error(`[LLMRuleExtraction] Error with provider ${provider}:`, error);
        // Fallback to Gemini on error if strictly needed, or just rethrow. 
        // For robustness, let's try Gemini as backup if primary fails.
        if (provider !== AIProvider.GEMINI) {
            console.log('[LLMRuleExtraction] Attempting fallback to Gemini...');
            return await geminiService.getQuickResponse(prompt, [], geminiModel, systemInstruction);
        }
        throw error;
    }
};

/**
 * Main function to extract rules using LLM
 */
export const extractRulesWithLLM = async (
    postMortemText: string,
    tradeDetails: string = "",
    provider: AIProvider = AIProvider.GEMINI
): Promise<ExtractedRule[]> => {
    if (!postMortemText || postMortemText.length < 20) return [];

    const prompt = generateExtractionPrompt(postMortemText, tradeDetails);

    try {
        const responseText = await getLLMResponse(provider, prompt);
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
