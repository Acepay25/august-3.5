// ... existing imports ...
import { GoogleGenAI, Schema, Type, GenerateContentResponse } from "@google/genai";
import { TradeAnalysis, Message, GroundingChunk, GlobalMemory, AccuracySubMode, TradeOutcome } from '../../../types';
import { extractAndParseJson, extractLastJson } from '../../../utils/jsonUtils';
import { sanitizeAIResponse, sanitizeJSONString } from '../../../utils/sanitizers';
import { sanitizeTradeAnalysis, truncateTextToTokens } from '../../../utils/analysisUtils';
import { ACCURACY_MODE_PROMPT, MASTER_ANALYSIS_PROMPT, PURE_AI_MODE_PROMPT, RISK_MANAGEMENT_RULES, TRADING_FAMILIES_PROMPT } from '../../../constants/prompts';
import { constructOptimizedContext } from '../../../utils/memoryUtils';
import { parseLiveMarketData } from '../../../utils/liveMarketParser';

const getAiClient = (): GoogleGenAI => {
    if (!process.env.GEMINI_API_KEY) {
        throw new Error("Gemini API key is missing.");
    }
    return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
};

// ... (schema and fileToGenerativePart and extractTextFromResponse helpers remain the same) ...
const tradeAnalysisSchema: Schema = {
    type: Type.OBJECT,
    properties: {
        thoughtProcess: { type: Type.STRING, description: "Detailed Analysis" },
        analysis: {
            type: Type.OBJECT,
            properties: {
                coinName: { type: Type.STRING },
                direction: { type: Type.STRING, enum: ["Long", "Short", "Neutral"] },
                confidence: { type: Type.STRING, enum: ["High", "Medium", "Low", "Avoid"] },
                probability: { type: Type.NUMBER },
                strategy: { type: Type.STRING },
                activeStrategies: { type: Type.ARRAY, items: { type: Type.STRING } },
                entryPoints: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { price: { type: Type.STRING }, description: { type: Type.STRING } } } },
                stopLoss: { type: Type.STRING },
                stopLossPercentage: { type: Type.STRING },
                takeProfit: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { price: { type: Type.STRING }, percentage: { type: Type.STRING } } } },
                historicalCorrelation: { type: Type.STRING },
                marketConditions: {
                    type: Type.OBJECT,
                    properties: {
                        pattern: { type: Type.STRING },
                        candleBehavior: { type: Type.STRING },
                        timeframeAlignment: { type: Type.STRING },
                        rsi: { type: Type.STRING },
                        macd: { type: Type.STRING },
                        sentiment: { type: Type.STRING },
                        prices: {
                            type: Type.OBJECT,
                            description: "Map of timeframe (e.g. '5m', '1h') to current price string",
                            properties: {
                                "5m": { type: Type.STRING },
                                "15m": { type: Type.STRING },
                                "1h": { type: Type.STRING },
                                "4h": { type: Type.STRING }
                            },
                            required: ["5m", "15m", "1h", "4h"]
                        }
                    },
                    required: ["pattern", "candleBehavior", "timeframeAlignment", "rsi", "macd", "sentiment", "prices"]
                },
                detectedPatternFamily: { type: Type.STRING },
                detectedPatterns: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            name: { type: Type.STRING },
                            timeframe: { type: Type.STRING },
                            type: { type: Type.STRING, enum: ["Bullish", "Bearish", "Neutral"] },
                            confidence: { type: Type.STRING },
                            description: { type: Type.STRING }
                        },
                        required: ["name", "timeframe", "type", "confidence", "description"]
                    },
                    required: []
                },
                keyLevels: {
                    type: Type.OBJECT,
                    properties: {
                        support: { type: Type.ARRAY, items: { type: Type.STRING } },
                        resistance: { type: Type.ARRAY, items: { type: Type.STRING } }
                    },
                    required: ["support", "resistance"]
                }
            },
            required: ["coinName", "direction", "confidence", "probability", "strategy", "activeStrategies", "entryPoints", "stopLoss", "takeProfit", "marketConditions", "detectedPatterns", "keyLevels"]
        }
    },
    required: ["thoughtProcess", "analysis"]
};

const fileToGenerativePart = async (file: File) => {
    const base64EncodedDataPromise = new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
        reader.readAsDataURL(file);
    });
    return {
        inlineData: { data: await base64EncodedDataPromise, mimeType: file.type },
    };
};

const extractTextFromResponse = (response: GenerateContentResponse): string => {
    let fullText = '';
    if (response.candidates && response.candidates[0] && response.candidates[0].content && response.candidates[0].content.parts) {
        for (const part of response.candidates[0].content.parts) {
            if (part.text) {
                fullText += part.text;
            }
        }
    }
    if (!fullText && response.text) {
        try { fullText = response.text; } catch (e) { }
    }
    return fullText;
};

export const analyzeTradingView = async (
    prompt: string,
    images: File[],
    imageSummaries: string[],
    chatHistory: Message[],
    finalTradeSummary: string | null,
    modelName: string,
    activeFrameworks: string[],
    deepenAnalysis: boolean, // Ignored, always deep in accuracy mode
    globalMemory?: GlobalMemory,
    threadSummary?: string,
    subMode: AccuracySubMode = 'original',
    customInstructions?: string,
    isPlaybookEnabledInPureAI?: boolean,
    isFamiliesEnabledInPureAI?: boolean,
    isMemoryEnabledInPureAI?: boolean
): Promise<{ analysis: TradeAnalysis; thoughtProcess: string; sources: GroundingChunk[] }> => {
    const ai = getAiClient();
    const imageParts = await Promise.all(images.map(fileToGenerativePart));
    const hasImages = images.length > 0;

    // --- LIVE MARKET DATA PARSING & INJECTION ---
    const parsedMarketData = parseLiveMarketData(prompt);
    let marketDataOverride = "";
    if (parsedMarketData) {
        marketDataOverride = `
    **VERIFIED LIVE MARKET TELEMETRY (HIGHEST PRIORITY):**
    Use this exact data for your analysis and JSON output. Do NOT output "N/A" for these fields.
    
    - **Prices:** ${JSON.stringify(parsedMarketData.prices)}
    - **Detected Patterns:** ${JSON.stringify(parsedMarketData.patterns)}
    - **Key Zones:** ${JSON.stringify(parsedMarketData.keyZones)}
    
    **MANDATORY:** You MUST populate the 'detectedPatterns', 'keyLevels', and 'marketConditions.prices' fields in your JSON response with this data.
        `;
    }
    // --------------------------------------------

    const memoryToUse = (subMode === 'pure_ai' && !isMemoryEnabledInPureAI) ? undefined : globalMemory;
    const memoryContext = constructOptimizedContext(chatHistory, threadSummary, memoryToUse);
    const frameworksList = activeFrameworks.map((fw, index) => `${index + 1}. **${fw}**`).join('\n');
    const imageSummaryContext = imageSummaries.length > 0 ? `**PRE-PROCESSED VISION ANALYSIS**...\n${imageSummaries.join('\n\n---\n\n')}` : "No chart data provided.";

    const userOverride = customInstructions
        ? `\n\n**USER BEHAVIOR OVERRIDE:**\nThe user has provided specific instructions for how you must respond, calculate, and reason. These instructions take precedence over default tone/style settings:\n"${customInstructions}"\n`
        : "";

    // Enhanced Vision Instruction
    const visionDeepDive = hasImages
        ? `**ENHANCED VISION ANALYTICS PROTOCOL:**
           - You have direct access to the high-fidelity chart images. 
           - **OCR & TEXT:** Perform a pixel-perfect scan to read all text labels, indicator settings (e.g. RSI 14), timestamps, and price axes.
           - **MICRO-STRUCTURE:** Extract PRECISE price levels, wick behaviors, and hidden liquidity pools from the visual data.
           - **CONTEXT:** If this is a trading terminal screenshot, extract any visible PnL, leverage, or account data.
           - Visually confirm the "Market Classification Family" based on candle structure.`
        : '';

    let systemPrompt = "";

    if (subMode === 'pure_ai') {
        // Strictly hide playbook if disabled
        const playbookContext = isPlaybookEnabledInPureAI
            ? `**PLAYBOOK REFERENCE (ENABLED BY USER):**\nAlthough this is Pure AI Mode, the user has enabled access to the following frameworks as a reference:\n${frameworksList}\nYou may use these if they align with your reasoning.`
            : "";

        const familiesContext = isFamiliesEnabledInPureAI
            ? `**MARKET CLASSIFICATION FAMILIES (ENABLED BY USER):**\nAlthough this is Pure AI Mode, the user has explicitly requested that you classify the setup into one of the following Families:\n${TRADING_FAMILIES_PROMPT}\nYou MUST assign a 'detectedPatternFamily' (Family A, B, C, or Omega) based on your reasoning.`
            : "";

        const memoryContextPrompt = isMemoryEnabledInPureAI
            ? `\n\n**PATTERN MEMORY REFERENCE (ENABLED BY USER):**\nAlthough this is Pure AI Mode, the user has enabled access to your historical Pattern Memory. You may use this as a reference to identify recurring patterns from the user's past trades.\n`
            : "";

        systemPrompt = `${PURE_AI_MODE_PROMPT}

      ${visionDeepDive}

      ${userOverride}

      ${marketDataOverride}

      ${playbookContext}

      ${familiesContext}
      
      ${memoryContextPrompt}

      ${RISK_MANAGEMENT_RULES}

      **SYNTHESIS & OUTPUT:**
      Your entire response MUST be a single, valid JSON object with two keys: "thoughtProcess" and "analysis". 
      Adhere strictly to the provided JSON structure.
      - Put the full text output into the "thoughtProcess" field.
      - Extract the trade details into the "analysis" field.
    `;
    } else {
        systemPrompt = `${ACCURACY_MODE_PROMPT}

      ${MASTER_ANALYSIS_PROMPT}

      ${visionDeepDive}

      ${userOverride}

      ${marketDataOverride}

      **CONTEXTUAL DATA:**
      **PLAYBOOK: CORE TRADING FRAMEWORKS**
      ${frameworksList}

      **CRITICAL: PATTERN MEMORY INTEGRATION (SECTION 4):**
      Use the **PATTERN MEMORY** and **RECENT INSIGHTS** provided below for user-specific patterns. Do NOT use Layer 3 Global Memory for past trade references.
      
      ${RISK_MANAGEMENT_RULES}

      **SYNTHESIS & OUTPUT:**
      Your entire response MUST be a single, valid JSON object with two keys: "thoughtProcess" and "analysis". 
      Adhere strictly to the provided JSON structure.
      - Put the full text output (Sections 1-8) into the "thoughtProcess" field.
      - Extract the trade details into the "analysis" field based on Section 7.
    `;
    }

    const isLiveMarketData = prompt.includes("**LIVE MARKET DATA**");
    const isHybridIntelligenceData = prompt.includes("HYBRID INTELLIGENCE") || prompt.includes("VERIFIED MARKET DATA");
    const formattedPrompt = (isLiveMarketData || isHybridIntelligenceData)
        ? `User's request:\n${prompt}\n\n`
        : `User's request: "${prompt}"\n\n`;

    const userPromptContent = `System Instructions:\n${systemPrompt}\n\n${formattedPrompt}${imageSummaryContext}\n\n${memoryContext}\n\nNow, generate the complete JSON output.`;

    let config: any = {};
    // Don't use Google Search when we have images, live market data, or hybrid intelligence data
    // (Also, Google Search + JSON response mode is not supported by Gemini)
    // IMPORTANT: tools and responseMimeType: "application/json" are mutually exclusive!
    if (hasImages || isLiveMarketData || isHybridIntelligenceData) {
        config = {
            responseMimeType: "application/json",
            responseSchema: tradeAnalysisSchema,
            tools: undefined // Explicitly disable tools to prevent conflict
        };
    } else {
        // For non-image requests without live data, we still need JSON output
        // so we cannot use googleSearch tools here
        config = {
            responseMimeType: "application/json",
            responseSchema: tradeAnalysisSchema,
            tools: undefined // Cannot use tools with JSON mode
        };
    }

    const response = await ai.models.generateContent({
        model: modelName,
        contents: { parts: [...imageParts, { text: userPromptContent }] },
        config: config,
    });

    let responseText = '';
    try {
        responseText = extractTextFromResponse(response);
        const parsedResponse = extractAndParseJson(responseText);
        const thoughtProcess = sanitizeAIResponse(parsedResponse.thoughtProcess || "No thought process provided.");

        const analysis = sanitizeTradeAnalysis(parsedResponse.analysis);
        const sources = !(hasImages || isLiveMarketData || isHybridIntelligenceData) ? (response.candidates?.[0]?.groundingMetadata?.groundingChunks || []).map((chunk: any) => ({ web: { uri: chunk.web?.uri || '', title: chunk.web?.title || 'Untitled' } })) : [];

        return { analysis, thoughtProcess, sources };

    } catch (error) {
        console.error("Gemini Accuracy Mode analysis JSON parsing failed:", error, "Invalid response:", responseText);
        throw new Error("Failed to parse the trading analysis from the AI response. Please try again.");
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
    const ai = getAiClient();
    const { correctedEntry, correctedStopLoss, correctedTakeProfit } = feedback;
    let analysisPrompt: string;

    const postTradeContext = postTradeImageSummaries?.length ? `**⚠️ VERIFIED TRADE OUTCOME DATA (HIGHEST PRIORITY):**\n---\n${postTradeImageSummaries.join('\n\n---\n\n')}\n---\n` : '';
    const tradeHistoryContext = finalTradeSummary ? `**PATTERN MEMORY LIBRARY (Historical Context):**\n${truncateTextToTokens(finalTradeSummary)}` : "No past trades logged.";
    const groundingDirective = postTradeImageSummaries?.length ? `**CRITICAL DIRECTIVE:** The 'VERIFIED TRADE OUTCOME DATA' section above contains the **ACTUAL EXIT PRICE** where the trade closed (SL or TP hit). You MUST use this exact price for all P&L calculations and analysis.` : '';

    const learningDirective = `**PATTERN RECOGNITION (ACCURACY MODE):** You must consult the 'Pattern Memory Library' provided above. Determine if the cause of this trade result aligns with a recurring pattern from the history. If it does, emphasize this pattern in your conclusion.`;

    const extendedSLZoneContext = `**IMPORTANT - 150% EXTENDED SL ZONE LOGIC:**
This system uses an "Extended SL Zone" where the initial Stop Loss is a SOFT limit:
- Original SL Distance = |Entry - StopLoss|
- Extended SL = SL + 50% of original distance (total 150% risk from entry)
- If price touches original SL but stays within 150% zone and then hits TP → WIN (not a loss!)
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

    if (outcome === TradeOutcome.ENTRY_NOT_HIT) {
        const userFeedbackBlock = correctedEntry ? `**USER FEEDBACK: CORRECTED ENTRY** The user provided a corrected entry: **${correctedEntry}**. Analyze why this was a better level.` : '';
        analysisPrompt = `A trade was not executed because the entry was not hit. Analyze why and formulate an actionable rule.
          PREVIOUS ANALYSIS: ${JSON.stringify(previousMessage.analysis, null, 2)}
          ACTUAL OUTCOME: ${outcome}
          ${postTradeContext}
          ${userFeedbackBlock}
          ${tradeHistoryContext}
          ${groundingDirective}
          ${learningDirective}
          Your task: Explain the market divergence from the expected entry. If post-trade screenshots are available, provide a narrative of what happened *instead* of hitting the entry. Conclude with a quantifiable IF/THEN rule to improve future entries.`;
    } else {
        const feedbackBlock = `**USER FEEDBACK (TRADE OUTCOME):**
${correctedStopLoss ? `- Corrected SL: ${correctedStopLoss}` : ''}
${correctedTakeProfit ? `- Final TP: ${correctedTakeProfit}` : ''}`;

        const detailedAnalysisTask = `
**TASK: FORENSIC POST-MORTEM (BE PRECISE, LOW VERBOSITY)**

1. **Price Action Cause (REQUIRED)**
- State the EXACT candle or pattern that decided the outcome (timeframe + name).
  Example: "15m Bearish Engulfing at range high", "1H Shooting Star rejection".
- Identify the key structural level involved (VWAP, HTF level, range high/low, Fib, open).

2. **Pattern Memory Check**
- Compare this trade against the Pattern Memory Library.
- Answer clearly:
  • Match found? (Yes / No)
  • If yes: name the recurring pattern.

3. **Adjustment Rule (MANDATORY)**
- Output ONE strict IF/THEN rule that would have prevented or improved the outcome.
- Rule must be actionable and testable.

═══════════════════════════════════════
📋 CONCLUSION (STRICT FORMAT)
═══════════════════════════════════════
• Outcome: WIN or LOSS
• Root Cause: One sentence (technical, not emotional)
• Confidence Impact: HIGHER / SAME / LOWER
• IF/THEN Rule: One line only
═══════════════════════════════════════`;

        const simpleAnalysisTask = `Your task: Re-evaluate the context, critique the risk parameters (especially with user feedback), and formulate a single, precise, quantifiable IF/THEN learning rule.`;

        const task = detailedAnalysisTask; // Always use detailed forensic analysis for Accuracy Mode

        analysisPrompt = `A trade was executed with the outcome: ${outcome}.
          PREVIOUS ANALYSIS: ${JSON.stringify(previousMessage.analysis, null, 2)}
          ${postTradeContext}
          ${feedbackBlock}
          ${tradeHistoryContext}
          ${groundingDirective}
          ${learningDirective}
          ${extendedSLZoneContext}
          ${task}`;
    }
    const response = await ai.models.generateContent({ model: modelName, contents: { parts: [{ text: analysisPrompt }] } });
    return sanitizeAIResponse(extractTextFromResponse(response));
};
