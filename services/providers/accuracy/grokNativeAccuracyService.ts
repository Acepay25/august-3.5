
import OpenAI from "openai";
import { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { Message, TradeOutcome, TradeAnalysis, GlobalMemory, AccuracySubMode } from '../../../../types';
import { extractAndParseJson } from '../../../../utils/jsonUtils';
import { sanitizeAIResponse, sanitizeJSONString } from '../../../../utils/sanitizers';
import { truncateTextToTokens, sanitizeTradeAnalysis } from '../../../../utils/analysisUtils';
import { ACCURACY_MODE_PROMPT } from '../../../../constants/prompts';
import { constructOptimizedContext } from '../../../../utils/memoryUtils';
import { parseLiveMarketData } from '../../../../utils/liveMarketParser';

import { getApiKey } from '../../infrastructure/PreferencesService';

const GROK_BASE_URL = 'https://api.x.ai/v1';

const getClient = async (): Promise<OpenAI> => {
    const apiKey = await getApiKey('grok');

    return new OpenAI({
        baseURL: GROK_BASE_URL,
        apiKey,
        dangerouslyAllowBrowser: true,
    });
};

const getMaxTokens = (modelName: string, defaultTokens: number): number => {
    if (modelName.includes('mini') || modelName.includes('fast')) {
        return Math.min(defaultTokens, 4096);
    }
    return defaultTokens;
};

export const analyzeTradingView = async (
    prompt: string,
    images: File[],
    imageSummaries: string[],
    chatHistory: Message[],
    finalTradeSummary: string | null,
    modelName: string,
    activeFrameworks: string[],
    deepenAnalysis: boolean,
    globalMemory?: GlobalMemory,
    threadSummary?: string,
    subMode?: AccuracySubMode,
    customInstructions?: string,
    isPlaybookEnabledInPureAI?: boolean,
    isFamiliesEnabledInPureAI?: boolean,
    isMemoryEnabledInPureAI?: boolean
): Promise<{ analysis: TradeAnalysis; thoughtProcess: string; sources: never[] }> => {
    const client = await getClient();
    const hasImages = images.length > 0;

    const parsedMarketData = parseLiveMarketData(prompt);
    let marketDataOverride = "";
    if (parsedMarketData) {
        marketDataOverride = `
    **VERIFIED LIVE MARKET TELEMETRY (HIGHEST PRIORITY):**
    Use this exact data for your analysis and JSON output. Do NOT output "N/A" for these fields.
    
    - **Prices:** ${JSON.stringify(parsedMarketData.prices)}
    - **Detected Patterns:** ${JSON.stringify(parsedMarketData.patterns)}
    - **Key Zones:** ${JSON.stringify(parsedMarketData.keyZones)}
    
    **MANDATORY:** You MUST populate the 'detectedPatterns', 'keyLevels', and 'marketConditions.prices' fields.
        `;
    }

    const memoryContext = constructOptimizedContext(chatHistory, threadSummary, globalMemory);
    const frameworksList = activeFrameworks.map((fw, index) => `${index + 1}. **${fw}**`).join('\n');
    const imageSummaryContext = imageSummaries.length > 0 ? `**PRE-PROCESSED VISION ANALYSIS**...\n${imageSummaries.join('\n\n---\n\n')}` : "No chart data provided.";

    const userOverride = customInstructions
        ? `\n\n**USER BEHAVIOR OVERRIDE:**\nThe user has provided specific instructions:\n"${customInstructions}"\n`
        : "";

    const systemPrompt = `${ACCURACY_MODE_PROMPT}

      ${userOverride}

      ${marketDataOverride}

      **CONTEXTUAL DATA:**
      **PLAYBOOK: CORE TRADING FRAMEWORKS**
      ${frameworksList}

      **SYNTHESIS & OUTPUT (STRICT JSON):**
      Your entire response MUST be a single, valid JSON object with two keys: "thoughtProcess" and "analysis".
      **Output ONLY valid JSON. Do not wrap it in markdown.**
    `;

    const isLiveMarketData = prompt.includes("**LIVE MARKET DATA**");
    const formattedPrompt = isLiveMarketData
        ? `User's request:\n${prompt}\n\n`
        : `User's request: "${prompt}"\n\n`;

    const userPromptText = `${formattedPrompt}${imageSummaryContext}\n\n${memoryContext}\n\nOUTPUT VALID JSON ONLY.`;

    const messages: ChatCompletionMessageParam[] = [{ role: "system", content: systemPrompt }];
    messages.push({ role: "user", content: userPromptText });

    const completion = await client.chat.completions.create({
        model: modelName,
        messages: messages,
        response_format: { type: "json_object" },
        max_tokens: getMaxTokens(modelName, 4096),
    });

    const responseText = completion.choices[0].message.content;
    if (!responseText) throw new Error("Received an empty response from Grok Accuracy Service.");

    try {
        const responseJson = extractAndParseJson(responseText);
        const thoughtProcess = sanitizeAIResponse(responseJson.thoughtProcess || "No thought process provided.");
        let analysis: TradeAnalysis = sanitizeTradeAnalysis(responseJson.analysis);
        if (!analysis) throw new Error("AI response JSON did not contain the 'analysis' object.");

        analysis.activeStrategies = Array.isArray(analysis.activeStrategies) ? analysis.activeStrategies : [];
        analysis.stopLoss = sanitizeJSONString(analysis.stopLoss);
        analysis.takeProfit = Array.isArray(analysis.takeProfit) ? analysis.takeProfit.map(tp => ({ price: sanitizeJSONString(String(tp.price || '')), percentage: sanitizeJSONString(String(tp.percentage || '')) })).filter(tp => tp.price) : [];
        analysis.entryPoints = Array.isArray(analysis.entryPoints) ? analysis.entryPoints.map(ep => ({ description: sanitizeJSONString(String(ep.description || '')), price: sanitizeJSONString(String(ep.price || '')) })).filter(ep => ep.description) : [];
        analysis.createdAt = new Date().toISOString();

        return { analysis, thoughtProcess, sources: [] };
    } catch (error) {
        console.error("Grok Accuracy analysis JSON parsing failed:", error, "Response:", responseText);
        throw new Error("Failed to parse the trading analysis from the Grok Accuracy response.");
    }
};

export const conductPostMortem = async (
    previousMessage: Message,
    outcome: TradeOutcome,
    history: Message[],
    finalTradeSummary: string | null,
    modelName: string,
    feedback: { correctedEntry?: string; correctedStopLoss?: string; correctedTakeProfit?: string; },
    postTradeImageSummaries?: string[]
): Promise<string> => {
    const client = await getClient();
    const { correctedEntry, correctedStopLoss, correctedTakeProfit } = feedback;

    const postTradeContext = postTradeImageSummaries?.length ? `**⚠️ VERIFIED TRADE OUTCOME DATA (HIGHEST PRIORITY):**\n---\n${postTradeImageSummaries.join('\n\n---\n\n')}\n---\n` : '';
    const tradeHistoryContext = finalTradeSummary ? `**PATTERN MEMORY LIBRARY (Historical Context):**\n${truncateTextToTokens(finalTradeSummary)}` : "No past trades logged.";
    const groundingDirective = postTradeImageSummaries?.length ? `**CRITICAL DIRECTIVE:** The 'VERIFIED TRADE OUTCOME DATA' section above contains the **ACTUAL EXIT PRICE** where the trade closed (SL or TP hit). You MUST use this exact price for all P&L calculations and analysis.` : '';
    const learningDirective = `**PATTERN RECOGNITION (ACCURACY MODE):** Consult the 'Pattern Memory Library'. Determine if this outcome aligns with a recurring pattern.`;

    const extendedSLZoneContext = `**IMPORTANT - 150% EXTENDED SL ZONE LOGIC:**
This system uses an "Extended SL Zone" where the initial Stop Loss is a SOFT limit:
- Original SL Distance = |Entry - StopLoss|
- Extended SL = SL + 50% of original distance (total 150% risk from entry)
- If price touches original SL but stays within 150% zone and then hits TP → WIN
- Only if price exceeds the 150% extended threshold → LOSS

**⚠️ CRITICAL: 150% EXTENDED ZONE BREACH = REAL LOSS**
When the stop-loss touches the 150% extended zone boundary, this MUST be treated as a LOSS in real trading:
1. The original SL was hit AND exceeded by 50%
2. This represents a failure of the trade thesis
3. In live trading, this position would have been closed at a significant loss

**MANDATORY IF-THEN RULE ANALYSIS (When 150% Zone Breached):**
You MUST explicitly address BOTH of these questions in your conclusion:
1. **SL Adjustment Question:** Should the initial Stop Loss have been placed wider to accommodate normal volatility, or was the SL placement correct and the market simply moved against the thesis?
2. **Entry Timing Question:** Was the entry price optimal, or should the trade have been entered at a better price point to give more room before hitting the initial SL?

**📌 PATTERN MEMORY STORAGE (CRITICAL):**
The 150% zone breach status is stored in Pattern Memory with the flag 'extendedSLZoneBreach: true'.
When analyzing current trades, ALWAYS check Pattern Memory for trades with this flag to:
- Identify if similar setups previously hit the 150% zone
- Automatically apply stricter SL placement (widen by 20-30%)
- OR require better entry timing (wait for deeper pullback)
- Reference the specific trade IDs and dates when similar 150% breaches occurred

**📌 FUTURE TRADE RECALCULATION ALERT:**
If this trade hit the 150% extended zone, FLAG THIS PATTERN clearly in your IF/THEN rule:
- When similar setups appear in the future, AI providers and moderator MUST:
  a) Check Pattern Memory for 'extendedSLZoneBreach: true' trades with matching conditions
  b) Automatically widen the SL by 20-30% compared to standard calculation
  c) OR require stricter entry conditions (e.g., wait for deeper pullback)`;

    let analysisPrompt: string;

    if (outcome === TradeOutcome.ENTRY_NOT_HIT) {
        const userFeedbackBlock = correctedEntry ? `**USER FEEDBACK: CORRECTED ENTRY** The user provided a corrected entry: **${correctedEntry}**.` : '';
        analysisPrompt = `A trade was not executed because the entry was not hit.
          PREVIOUS ANALYSIS: ${JSON.stringify(previousMessage.analysis, null, 2)}
          ACTUAL OUTCOME: ${outcome}
          ${postTradeContext}
          ${userFeedbackBlock}
          ${tradeHistoryContext}
          ${groundingDirective}
          ${learningDirective}`;
    } else {
        const feedbackBlock = `**USER FEEDBACK (TRADE OUTCOME):**
                    ${correctedStopLoss ? `- Corrected SL: ${correctedStopLoss}` : ''}
                    ${correctedTakeProfit ? `- Final TP: ${correctedTakeProfit}` : ''}`;

        analysisPrompt = `A trade was executed with the outcome: ${outcome}.
          PREVIOUS ANALYSIS: ${JSON.stringify(previousMessage.analysis, null, 2)}
          ${postTradeContext}
          ${feedbackBlock}
          ${tradeHistoryContext}
          ${groundingDirective}
          ${learningDirective}
          ${extendedSLZoneContext}
          
          **TASK: FORENSIC POST-MORTEM**
          1. State the EXACT candle or pattern that decided the outcome.
          2. Compare against Pattern Memory Library.
          3. Output ONE strict IF/THEN rule.`;
    }

    const completion = await client.chat.completions.create({
        model: modelName,
        messages: [{ role: 'user', content: analysisPrompt }],
        max_tokens: getMaxTokens(modelName, 2048)
    });
    return sanitizeAIResponse(completion.choices[0].message.content || "Post-mortem analysis failed.");
};
