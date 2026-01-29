// ... existing imports ...
import { GoogleGenAI, GenerateContentResponse, Type, GroundingChunk as GeminiGroundingChunk, Schema } from "@google/genai";
import { TradeAnalysis, Message, TradeOutcome, GroundingChunk, MessageRole, LoggedTrade, StrategySearchResult, DebateTurn, EntryPoint, TakeProfitTarget, MarketConditions, TradeSummary, GlobalMemory, AccuracySubMode } from '../types';
import { robustJsonParse, extractAndParseJson, extractLastJson } from '../utils/jsonUtils';
import { sanitizeAIResponse, sanitizeJSONString } from '../utils/sanitizers';
import { sanitizeTradeAnalysis, truncateTextToTokens } from '../utils/analysisUtils';
import { MASTER_ANALYSIS_PROMPT, MEMORY_COMPRESSOR_PROMPT, GLOBAL_MEMORY_MANAGER_PROMPT, DEVILS_ADVOCATE_PROMPT, INVALIDATION_THESIS_PROMPT, CORRELATION_AWARENESS_PROMPT, LENS_MODE_BASE_PROMPT, AI_PROVIDER_MEMORY_ENFORCEMENT_PROMPT } from '../constants/prompts';
import { constructOptimizedContext } from '../utils/memoryUtils';
import { parseLiveMarketData } from '../utils/liveMarketParser';

// ... (existing helper functions: getAiClient, fileToGenerativePart, mapGroundingChunks, extractTextFromResponse remain the same) ...
const getAiClient = (): GoogleGenAI => {
    if (!process.env.GEMINI_API_KEY) {
        throw new Error("GEMINI_API_KEY is not set in environment");
    }
    return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
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

const mapGroundingChunks = (chunks?: GeminiGroundingChunk[]): GroundingChunk[] => {
    if (!chunks) return [];
    return chunks
        .filter(chunk => chunk.web)
        .map(chunk => ({
            web: {
                uri: chunk.web!.uri || '',
                title: chunk.web!.title || 'Untitled',
            }
        }));
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
        try {
            fullText = response.text;
        } catch (e) {
        }
    }
    return fullText;
};

export const summarizeChartImage = async (image: File, chartNumber: number, modelName: string): Promise<{ uiSummary: string; fullSummary: string }> => {
    try {
        const ai = getAiClient();
        const imagePart = await fileToGenerativePart(image);

        const prompt = `You are a state-of-the-art Computer Vision & OCR engine for financial markets.
        **MODE: ENHANCED VISION STRUCTURING ENABLED**
        Your task is to analyze Chart ${chartNumber}, discard irrelevant OCR noise, and produce a highly structured data report.

        **STRICT OUTPUT FORMAT:**

        1. Chart Metadata
        Timeframe: [Value]
        Asset: [Value]
        Exchange: [Value]
        Chart Type: [Value]

        2. Price & Trend
        Current Price: [Value]
        24h High: [Value]
        24h Low: [Value]
        Trend Summary: [Value]

        3. Indicators
        Moving Averages
        MA5: [Value]
        MA10: [Value]
        MA20: [Value]
        MA30: [Value]
        MA60: [Value]
        MA200: [Value]

        EMA
        EMA5: [Value]
        EMA13: [Value]
        EMA20: [Value]
        EMA200: [Value]

        Bollinger Bands
        BOLL Middle: [Value]
        BOLL Upper: [Value]
        BOLL Lower: [Value]

        Volume
        Volume: [Value]
        Volume Trend: [Value]

        RSI
        RSI1: [Value]
        RSI2: [Value]
        RSI3: [Value]

        MACD
        MACD DIF: [Value]
        MACD DEA: [Value]
        MACD Histogram: [Value]

        Stochastic
        Stoch K: [Value]
        Stoch D: [Value]
        Stoch J: [Value]

        4. Market Structure
        Immediate Resistance: [Value]
        Immediate Support: [Value]
        Strong Support Zones: [Value]
        Trend Context: [Value]

        5. Candle Pattern Recognition
        Latest Candle: [Value] (e.g., Doji, Hammer, Marubozu)
        Pattern Detected: [Value] (e.g., Bullish Engulfing, Morning Star, None)
        Candle Position: [Value] (e.g., At Support, In Consolidation)
        Remaining Time: [Value]

        6. Chart Narrative
        Narrative: [A 2-3 sentence description of what is happening in the chart. Describe the current price action, trend behavior, and any notable patterns or formations visible. Example: "Price is consolidating near resistance after a strong bullish move. The last 3 candles show indecision with small bodies and long wicks, suggesting a potential reversal or breakout."]

        **INSTRUCTIONS:**
        - Extract exact numbers where visible.
        - Look specifically for the specific candlestick shape of the last 1-3 candles.
        - If a field is not visible or applicable, write "N/A".
        - Do not mix sections.
        - Keep descriptions concise.
        `;

        const response = await ai.models.generateContent({
            model: modelName,
            contents: {
                parts: [imagePart, { text: prompt }]
            },
        });

        const fullSummary = extractTextFromResponse(response).trim();

        // Robust Regex for Extraction
        const timeframeMatch = fullSummary.match(/Timeframe:\s*(.*?)(?:\n|$)/i);
        const priceMatch = fullSummary.match(/(?:Current )?Price:\s*(.*?)(?:\n|$)/i);
        const patternMatch = fullSummary.match(/Pattern Detected:\s*(.*?)(?:\n|$)/i);

        const timeframe = timeframeMatch ? timeframeMatch[1].trim().replace(/['"]/g, '') : 'N/A';
        let price = priceMatch ? priceMatch[1].trim().replace(/['"]/g, '') : 'N/A';
        let pattern = patternMatch ? patternMatch[1].trim().replace(/['"]/g, '') : '';

        // Ensure price has symbol and looks correct
        if (price !== 'N/A') {
            const numericPrice = price.replace(/[^0-9.]/g, '');
            if (numericPrice) {
                price = `₮${numericPrice}`;
            } else {
                price = 'N/A';
            }
        }

        if (pattern === 'N/A' || pattern === 'None') pattern = '';

        // Explicitly format: Chart X | Timeframe | Price | Pattern
        let uiSummary = `Chart ${chartNumber} | ${timeframe} | ${price}`;
        if (pattern) {
            uiSummary += ` | ${pattern}`;
        }

        return { uiSummary, fullSummary };
    } catch (error) {
        console.error("Error in summarizeChartImage:", error);
        return {
            uiSummary: `Chart ${chartNumber} | Error | N/A`,
            fullSummary: `Chart ${chartNumber} Vision Analysis Failed: ${(error as Error).message}`
        };
    }
};

const tradeAnalysisSchema: Schema = {
    type: Type.OBJECT,
    // ... (rest of file remains unchanged)
    properties: {
        thoughtProcess: { type: Type.STRING, description: "Detailed Sections 1-8 of the analysis" },
        analysis: {
            type: Type.OBJECT,
            properties: {
                coinName: { type: Type.STRING },
                direction: { type: Type.STRING, enum: ["Long", "Short", "Neutral"] },
                confidence: { type: Type.STRING, enum: ["High", "Medium", "Low", "Avoid"] },
                probability: { type: Type.NUMBER },
                strategy: { type: Type.STRING },
                activeStrategies: { type: Type.ARRAY, items: { type: Type.STRING } },
                entryPoints: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            price: { type: Type.STRING },
                            description: { type: Type.STRING }
                        }
                    }
                },
                stopLoss: { type: Type.STRING },
                stopLossPercentage: { type: Type.STRING },
                takeProfit: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            price: { type: Type.STRING },
                            percentage: { type: Type.STRING }
                        }
                    }
                },
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
                detectedPatternFamily: { type: Type.STRING, enum: ["Family A", "Family B", "Family C", "Family Omega", "Unknown"] },
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

export const analyzeTradingView = async (
    prompt: string,
    images: File[],
    imageSummaries: string[],
    chatHistory: Message[],
    finalTradeSummary: string | null,
    recentInsights: string | null, // New param for distinct Recent Insights
    modelName: string,
    activeFrameworks: string[],
    deepenAnalysis: boolean,
    globalMemory?: GlobalMemory, // New param
    threadSummary?: string, // New param
    subMode?: AccuracySubMode, // Ignored in standard service
    customInstructions?: string, // New Param
    isPlaybookEnabledInPureAI?: boolean, // Ignored in standard service
    isFamiliesEnabledInPureAI?: boolean, // Ignored in standard service
    isMemoryEnabledInPureAI?: boolean, // Ignored in standard service
    rolePrompt?: string // Analyst Lens: specialized role prompt prefix
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

    const memoryContext = constructOptimizedContext(chatHistory, threadSummary, globalMemory);

    // CRITICAL: Inject Pattern Memory (Synthesis) - Labeled to match UI
    const patternMemoryContext = finalTradeSummary
        ? `\n\n**📊 PATTERN MEMORY (SYNTHESIS) - MANDATORY REFERENCE:**\nThe following is a synthesis of your recent trading performance and patterns. You MUST reference this data for Section 4 (Pattern Matching):\n${finalTradeSummary}\n`
        : "\n\n**📊 PATTERN MEMORY:** No synthesis available yet.\n";

    // CRITICAL: Inject Recent Insights (Individual Trades) - Labeled to match UI
    const recentInsightsContext = recentInsights
        ? `\n\n**📊 RECENT INSIGHTS (INDIVIDUAL) - MANDATORY REFERENCE:**\nThe following are specific recent trades for detailed comparison:\n${recentInsights}\n`
        : "\n\n**📊 RECENT INSIGHTS:** No recent trade insights available.\n";

    const frameworksList = activeFrameworks.map((fw, index) => `${index + 1}. **${fw}**`).join('\n');
    const imageSummaryContext = imageSummaries.length > 0 ? `**PRE-PROCESSED VISION ANALYSIS**...\n${imageSummaries.join('\n\n---\n\n')}` : "No chart data provided.";
    const deepAnalysisInstruction = deepenAnalysis ? `**DEEP ANALYSIS REQUIRED**...` : '';

    // Enhanced Vision Instruction
    const visionDeepDive = hasImages
        ? `**ENHANCED VISION ANALYTICS PROTOCOL:**
           - You have direct access to the high-fidelity chart images. 
           - **OCR & TEXT:** Perform a pixel-perfect scan to read all text labels, indicator settings (e.g. RSI 14), timestamps, and price axes.
           - **MICRO-STRUCTURE:** Extract PRECISE price levels, wick behaviors, and hidden liquidity pools from the visual data.
           - **CONTEXT:** If this is a trading terminal screenshot, extract any visible PnL, leverage, or account data.
           - Visually confirm the "Market Classification Family" based on candle structure.`
        : '';

    const userOverride = customInstructions
        ? `\n\n**USER BEHAVIOR OVERRIDE:**\nThe user has provided specific instructions for how you must respond, calculate, and reason. These instructions take precedence over default tone/style settings:\n"${customInstructions}"\n`
        : "";

    // Use LENS_MODE_BASE_PROMPT when rolePrompt is active, otherwise use full MASTER_ANALYSIS_PROMPT
    const basePrompt = rolePrompt ? LENS_MODE_BASE_PROMPT : MASTER_ANALYSIS_PROMPT;

    const systemPrompt = `${rolePrompt ? '🎭 **SPECIALIZED ANALYST ROLE ACTIVE**\n\n' + rolePrompt + '\n\n---\n\n' : ''}${basePrompt}

      ${rolePrompt ? '' : visionDeepDive}

      ${rolePrompt ? '' : DEVILS_ADVOCATE_PROMPT}

      ${rolePrompt ? '' : INVALIDATION_THESIS_PROMPT}

      ${rolePrompt ? '' : CORRELATION_AWARENESS_PROMPT}

      ${userOverride}

      ${marketDataOverride}

      ${AI_PROVIDER_MEMORY_ENFORCEMENT_PROMPT}

      **CONTEXTUAL DATA:**
      **PLAYBOOK: CORE TRADING FRAMEWORKS**
      ${frameworksList}

      **ANALYTICAL PROCESS OVERRIDE:**
      ${rolePrompt ? '' : `You must perform the analysis exactly as defined in the MASTER PROMPT sections 1-8.`}
      ${deepAnalysisInstruction}
      
      **CRITICAL: PATTERN MEMORY INTEGRATION (SECTION 4):**
      Use the **PATTERN MEMORY** and **RECENT INSIGHTS** provided below as your source of truth for user-specific patterns and corrections. Do NOT use Layer 3 Global Memory for past trade references.
      
      ${patternMemoryContext}
      ${recentInsightsContext}
      
      **MANDATORY RULE: RISK/REWARD & STOP-LOSS PERCENTAGE VALIDATION**
      1. **Minimum R:R Requirement:** The potential win must be at least 1.2x larger than the potential loss (Ratio >= 1:1.2).
      2. **Conditional Logic:** If the current setup yields an R:R < 1.2, you must mark the trade as **CONDITIONAL**. Set \`confidence\` to 'Avoid' (or 'Low') and explicitly explain in the \`strategy\` field that a better entry price is required to satisfy the 1:1.2 Risk/Reward rule.
      3. If R:R >= 1.2, proceed. Calculate profit percentages for each Take Profit target.
      4. Calculate and include the stop loss percentage in the \`stopLossPercentage\` field.
      5. Extract the Coin Name (e.g. BTCUSDT, ETH, SOL) from the analysis.

      **SYNTHESIS & OUTPUT:**
      Your entire response MUST be a single, valid JSON object with two keys: "thoughtProcess" and "analysis". 
      ${hasImages ? '**IMPORTANT:** Use the strict JSON schema provided. Do not output Markdown code blocks. Output RAW JSON.' : 'Adhere strictly to the provided JSON structure. Do not output Markdown.'}
      ${rolePrompt ? '' : `
      - Put the full text output (Sections 1-8) into the "thoughtProcess" field.
      - Extract the trade details into the "analysis" field based on Section 7.
      `}
    `;

    // Special handling for Live Market Data injection - remove quotes if it was raw data
    const isLiveMarketData = prompt.includes("**LIVE MARKET DATA**");
    const isHybridIntelligenceData = prompt.includes("HYBRID INTELLIGENCE") || prompt.includes("VERIFIED MARKET DATA");
    const formattedPrompt = (isLiveMarketData || isHybridIntelligenceData)
        ? `User's request:\n${prompt}\n\n`
        : `User's request: "${prompt}"\n\n`;

    const userPromptContent = `System Instructions:\n${systemPrompt}\n\n${formattedPrompt}${imageSummaryContext}\n\n${recentInsightsContext}\n\n${memoryContext}\n\nNow, generate the complete JSON output.`;

    let config: any = {};
    if (hasImages || isLiveMarketData || isHybridIntelligenceData) {
        config = {
            responseMimeType: "application/json",
            responseSchema: tradeAnalysisSchema,
            tools: undefined // Explicitly disable tools to prevent conflict with JSON mode
        };
    } else {
        config = {
            tools: [{ googleSearch: {} }]
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
        // Sources are only available if tools (Google Search) were used
        const sources = !(hasImages || isLiveMarketData || isHybridIntelligenceData) ? mapGroundingChunks(response.candidates?.[0]?.groundingMetadata?.groundingChunks) : [];

        return { analysis, thoughtProcess, sources };

    } catch (error) {
        console.error("Gemini analysis JSON parsing failed:", error, "Invalid response:", responseText);
        throw new Error("Failed to parse the trading analysis from the AI response. Please try again.");
    }
};

export const getQuickResponse = async (prompt: string, history: Message[], modelName: string, systemInstruction?: string): Promise<string> => {
    // ... (unchanged)
    const ai = getAiClient();
    const contents = history.map(m => ({
        role: m.role === MessageRole.USER ? 'user' : 'model',
        parts: [{ text: m.text }]
    }));

    const defaultSystemPrompt = 'You are a helpful AI assistant for futures trading. Answer concisely.';
    contents.unshift({ role: 'user', parts: [{ text: systemInstruction || defaultSystemPrompt }] });
    contents.push({ role: 'user', parts: [{ text: prompt }] });

    const finalContents = [];
    if (contents.length > 0) {
        let currentRole = contents[0].role;
        let currentParts = [...contents[0].parts];
        for (let i = 1; i < contents.length; i++) {
            if (contents[i].role === currentRole) {
                currentParts.push(...contents[i].parts);
            } else {
                finalContents.push({ role: currentRole, parts: currentParts });
                currentRole = contents[i].role;
                currentParts = [...contents[i].parts];
            }
        }
        finalContents.push({ role: currentRole, parts: currentParts });
    }

    const response = await ai.models.generateContent({ model: modelName, contents: finalContents });
    return sanitizeAIResponse(extractTextFromResponse(response));
};

export const compressChatHistory = async (messages: Message[], currentSummary: string = ""): Promise<string> => {
    // ... (unchanged)
    const ai = getAiClient();
    const messagesText = messages.map(m => `${m.role}: ${m.text}`).join('\n\n');

    const prompt = `
${MEMORY_COMPRESSOR_PROMPT}

**PREVIOUS SUMMARY (LAYER 2):**
${currentSummary || "None"}

**NEW CONTENT TO COMPRESS:**
${messagesText}

**INSTRUCTIONS:**
Merge the new content into the previous summary. 
Keep it chronological. 
Discard redundant details.
Return ONLY the new compressed summary text.
    `;

    const response = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: { parts: [{ text: prompt }] } });
    return sanitizeAIResponse(extractTextFromResponse(response));
};

export const updateGlobalMemory = async (recentTrades: LoggedTrade[], currentMemory?: GlobalMemory): Promise<GlobalMemory> => {
    // ... (unchanged)
    const ai = getAiClient();
    const tradeSummaries = recentTrades.map(t => JSON.stringify({
        tradeId: t.id,
        asset: t.analysis.coinName,
        direction: t.analysis.direction,
        outcome: t.outcome,
        leverage: t.leverage,
        family: t.analysis.detectedPatternFamily || t.analysis.marketConditions.pattern,
        postMortemReason: t.postMortem ? t.postMortem.substring(0, 100) + "..." : "N/A",
        timestamp: t.timestamp
    })).join('\n');

    const currentMemoryJson = currentMemory ? JSON.stringify(currentMemory, null, 2) : "null";

    const prompt = `
${GLOBAL_MEMORY_MANAGER_PROMPT}

**EXISTING GLOBAL MEMORY:**
${currentMemoryJson}

**RECENT TRADES (LAYER 2 DATA):**
${tradeSummaries}

**INSTRUCTIONS:**
Generate the updated Global Memory JSON object.
    `;

    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: { parts: [{ text: prompt }] },
        config: { responseMimeType: 'application/json' }
    });

    const responseText = extractTextFromResponse(response);
    return extractLastJson(responseText);
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
    // ... (unchanged)
    const ai = getAiClient();
    const { correctedEntry, correctedStopLoss, correctedTakeProfit } = feedback;
    let analysisPrompt: string;

    const postTradeContext = postTradeImageSummaries?.length ? `**⚠️ VERIFIED TRADE OUTCOME DATA (HIGHEST PRIORITY):**\n---\n${postTradeImageSummaries.join('\n\n---\n\n')}\n---\n` : '';
    const tradeHistoryContext = finalTradeSummary ? `**PATTERN MEMORY LIBRARY (Historical Context):**\n${truncateTextToTokens(finalTradeSummary)}` : "No past trades logged.";

    // CRITICAL FIX: Always include TP/SL reference, not just when screenshots are provided
    // Extract original trade levels for mandatory reference
    const origEntry = previousMessage.analysis?.entryPoints?.[0]?.price || 'N/A';
    const origSL = previousMessage.analysis?.stopLoss || 'N/A';
    const origTP1 = previousMessage.analysis?.takeProfit?.[0]?.price || 'N/A';
    const origTP2 = previousMessage.analysis?.takeProfit?.[1]?.price || '';
    const origTP3 = previousMessage.analysis?.takeProfit?.[2]?.price || '';
    const tradeDirection = previousMessage.analysis?.direction || 'N/A';

    // Always-on directive for TP/SL reference
    const tpSlReferenceDirective = `
**🎯 MANDATORY TRADE LEVEL REFERENCE (USE FOR ALL CALCULATIONS):**
You MUST evaluate this trade outcome based on the ORIGINAL trade levels below, NOT the current market price:
- **Entry**: ${origEntry}
- **Stop Loss**: ${origSL}
- **Take Profit 1**: ${origTP1}${origTP2 ? `\n- **Take Profit 2**: ${origTP2}` : ''}${origTP3 ? `\n- **Take Profit 3**: ${origTP3}` : ''}
- **Direction**: ${tradeDirection}

**OUTCOME EVALUATION RULE:**
- WIN = Price hit one of the Take Profit levels (TP1/TP2/TP3) listed above
- LOSS = Price hit the Stop Loss level listed above
- The CURRENT market price is IRRELEVANT to the outcome - only use it to track what happened AFTER the trade closed

**⚠️ CRITICAL:** When calculating P&L, risk/reward ratios, and analyzing the trade outcome, you MUST use the TP or SL price where the trade EXITED, not where price is now.
`;

    const groundingDirective = postTradeImageSummaries?.length
        ? `**CRITICAL DIRECTIVE:** The 'VERIFIED TRADE OUTCOME DATA' section above contains the **ACTUAL EXIT PRICE** where the trade closed (SL or TP hit). You MUST use this exact price for all P&L calculations and analysis. Do NOT use current market price - use the verified hit price from the TRADE OUTCOME section.`
        : tpSlReferenceDirective;

    const learningDirective = `**PATTERN RECOGNITION:** You must consult the 'Pattern Memory Library' provided above. Determine if the cause of this trade result aligns with a recurring pattern from the history. If it does, emphasize this pattern in your conclusion.`;

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

**⚠️ SPECIAL CASE: MISSED WIN DUE TO TIGHT STOP LOSS:**
When the ORIGINAL stop-loss is hit, price does NOT reach the 150% extended zone, and then reverses to hit TP:
1. This is still classified as a **LOSS** (because the SL was triggered in live trading)
2. However, this MUST be flagged as a **"MISSED WIN DUE TO TIGHT SL"**
3. The trade COULD have been profitable with a wider stop loss

**MANDATORY CORRECTED SL ANALYSIS (When Missed Win Detected):**
You MUST:
1. Calculate the **exact minimum SL distance** that would have kept the trade alive
2. Propose a **corrected optimal SL** (typically 10-20% wider than the minimum)
3. Explain the **rationale** based on:
   - Market volatility at the time (ATR considerations)
   - Key structural levels that should have been used as SL anchors
   - Whether a better entry would have naturally provided more SL room

**MANDATORY IF-THEN RULE ANALYSIS (When 150% Zone Breached):**
You MUST explicitly address BOTH of these questions in your conclusion:
1. **SL Adjustment Question:** Should the initial Stop Loss have been placed wider to accommodate normal volatility, or was the SL placement correct and the market simply moved against the thesis?
2. **Entry Timing Question:** Was the entry price optimal, or should the trade have been entered at a better price point to give more room before hitting the initial SL?

**📌 PATTERN MEMORY STORAGE (CRITICAL):**
The 150% zone breach status is stored in Pattern Memory with the flag 'extendedSLZoneBreach: true'.
The missed win status is stored in Pattern Memory with the flag 'missedWinTightSL: true'.
When analyzing current trades, ALWAYS check Pattern Memory for trades with these flags to:
- Identify if similar setups previously hit the 150% zone or were missed wins
- Automatically apply stricter SL placement (widen by 20-30%)
- OR require better entry timing (wait for deeper pullback)
- Reference the specific trade IDs and dates when similar issues occurred

**📌 FUTURE TRADE RECALCULATION ALERT:**
If this trade hit the 150% extended zone or is a missed win, FLAG THIS PATTERN clearly in your IF/THEN rule:
- When similar setups appear in the future, AI providers and moderator MUST:
  a) Check Pattern Memory for 'extendedSLZoneBreach: true' or 'missedWinTightSL: true' trades with matching conditions
  b) Automatically widen the SL by 20-30% compared to standard calculation
  c) OR require stricter entry conditions (e.g., wait for deeper pullback)`;

    if (outcome === TradeOutcome.ENTRY_NOT_HIT) {
        const userFeedbackBlock = correctedEntry ? `**USER FEEDBACK: CORRECTED ENTRY** The user provided a corrected entry: **${correctedEntry}**.` : '';
        analysisPrompt = `**Role:**
You are an advanced trade post-analysis engine focused on execution review and learning optimization.

**Task:**
Perform a mandatory **ENTRY_NOT_HIT** analysis for a trading setup that did not trigger, identifying whether the setup was valid, whether the directional bias was correct, and what execution or timing factors caused the miss.

**Context:**
This analysis applies **only** to trades where the entry price was not hit. The goal is to extract actionable learning rules to reduce future missed opportunities without changing the original strategy intent.

**PREVIOUS ANALYSIS:**
${JSON.stringify(previousMessage.analysis, null, 2)}

**ACTUAL OUTCOME:** ${outcome}

${postTradeContext}

${userFeedbackBlock}

${tradeHistoryContext}

${groundingDirective}

**Instructions:**
Answer **all** of the following **MANDATORY ENTRY_NOT_HIT ANALYSIS QUESTIONS** clearly and objectively:

1. **Setup Validity Check**
   * Was the original setup objectively valid based on the defined pattern/strategy rules?

2. **Direction Accuracy**
   * Did price eventually move in the predicted direction?
   * Explicitly confirm whether the projected TP level would have been hit.

3. **Entry Type Analysis**
   * Identify the reason the entry was missed:
     * Limit order miss
     * Trader hesitation
     * No valid trigger condition

4. **Market Context at Entry Time**
   * Describe what was occurring at the exact moment price approached the intended entry (structure, volatility, momentum, liquidity behavior).

5. **Opportunity Cost Assessment**
   * If direction was correct, quantify the missed move (e.g., percentage move, R multiple, or distance to TP after near-entry).

**Critical Learning Output (REQUIRED):**
* Generate **one clear IF / THEN rule** that directly addresses **only one** of the following improvement areas:
  * Better entry placement strategy
  * Alternative entry types (market vs limit)
  * Entry anticipation techniques
  * Setup recognition timing improvements

**Classification Rule:**
* If the setup was **VALID** and the direction was **CORRECT**, explicitly flag the case as:
  **"MISSED OPPORTUNITY"**
  and mark it for future pattern learning and probability adjustment.

**Output Format:**
* Sectioned responses matching the numbered questions
* A clearly labeled **IF / THEN Learning Rule**
* Final classification label (MISSED OPPORTUNITY or NOT MISSED OPPORTUNITY)

**Tone / Style:**
Analytical, precise, execution-focused, and rule-driven.`;
    } else if (outcome === TradeOutcome.WIN) {
        // ============ WIN-SPECIFIC POST-MORTEM PROMPT ============
        const feedbackBlock = `**USER FEEDBACK (TRADE OUTCOME):**
${correctedStopLoss ? `- Corrected SL: ${correctedStopLoss}` : ''}
${correctedTakeProfit ? `- Final TP: ${correctedTakeProfit}` : ''}`;

        analysisPrompt = `**Role:**
You are an advanced trade post-analysis engine focused on **SUCCESS REPLICATION** and pattern banking.

**Task:**
Perform a mandatory **WIN ANALYSIS** to extract replicable success factors, validate the decision-making process, and bank this pattern for future probability enhancement.

**Context:**
This analysis applies to trades that reached their profit target. The goal is to identify EXACTLY what made this trade work so it can be systematically replicated.

**PREVIOUS ANALYSIS:**
${JSON.stringify(previousMessage.analysis, null, 2)}

**ACTUAL OUTCOME:** ${outcome} ✅

${postTradeContext}

${feedbackBlock}

${tradeHistoryContext}

${groundingDirective}

**Instructions:**
Answer **all** of the following **MANDATORY WIN ANALYSIS QUESTIONS** clearly and objectively:

1. **Entry Quality Assessment**
   * Was the entry timing optimal, early, or late relative to the move?
   * Rate entry precision: EXCELLENT / GOOD / ACCEPTABLE
   * If not optimal, calculate exact price improvement possible.

2. **Setup Confirmation Signals**
   * List the EXACT technical signals that confirmed this setup (candle patterns, indicator readings, structure breaks).
   * Which signal was the PRIMARY trigger vs supporting confluence?

3. **Risk Management Review**
   * Was the Stop Loss ever threatened? If yes, by how much (in % or pips)?
   * Was the R:R ratio achieved as planned or better/worse?
   * Calculate the final R multiple achieved.

4. **Pattern Family Validation**
   * Confirm the detected pattern family (A/B/C/Omega) was correctly identified.
   * Does this win STRENGTHEN confidence in this family's reliability?

5. **Replication Checklist**
   * Extract 3-5 SPECIFIC conditions that MUST be present to replicate this success.
   * Format as a checklist: ☐ Condition 1, ☐ Condition 2, etc.

**Critical Learning Output (REQUIRED):**
* Generate **one clear IF / THEN rule** that captures the WINNING FORMULA:
  * Format: "IF [specific conditions present] THEN [take trade with X confidence]"
  * This rule should be BANKABLE for future similar setups.

**Pattern Banking:**
* Flag this trade for **PATTERN MEMORY STORAGE** with tag: "CONFIRMED_WIN_PATTERN"
* Include: Family, Timeframe, Key levels, Trigger candle type

**Output Format:**
* Sectioned responses matching the numbered questions
* A clearly labeled **WINNING IF/THEN Rule**
* Replication Checklist
* Pattern Banking summary

**Tone / Style:**
Celebratory but analytical. Focus on what to REPEAT, not what to avoid.`;

    } else {
        // ============ LOSS-SPECIFIC POST-MORTEM PROMPT ============
        const feedbackBlock = `**USER FEEDBACK (TRADE OUTCOME):**
${correctedStopLoss ? `- Corrected SL: ${correctedStopLoss}` : ''}
${correctedTakeProfit ? `- Final TP: ${correctedTakeProfit}` : ''}`;

        analysisPrompt = `**Role:**
You are an advanced trade post-analysis engine focused on **LOSS PREVENTION** and failure pattern recognition.

**Task:**
Perform a mandatory **LOSS FORENSIC ANALYSIS** to identify the root cause of failure, detect warning signs that were missed, and create defensive rules to prevent recurrence.

**Context:**
This analysis applies to trades that hit Stop Loss or exceeded risk limits. The goal is BRUTAL HONESTY about what went wrong and how to prevent it.

**PREVIOUS ANALYSIS:**
${JSON.stringify(previousMessage.analysis, null, 2)}

**ACTUAL OUTCOME:** ${outcome} ❌

${postTradeContext}

${feedbackBlock}

${tradeHistoryContext}

${groundingDirective}

${extendedSLZoneContext}

**Instructions:**
Answer **all** of the following **MANDATORY LOSS ANALYSIS QUESTIONS** clearly and objectively:

1. **Failure Point Identification**
   * State the EXACT candle/bar that invalidated the trade (timeframe + pattern name).
   * At what price and time did the thesis officially fail?
   * Was this a SUDDEN move or GRADUAL deterioration?

2. **Warning Signs Autopsy**
   * List ANY warning signs that appeared BEFORE the SL was hit.
   * Were there divergences, volume anomalies, or structure breaks that were ignored?
   * Rate pre-loss warnings: CLEAR / SUBTLE / NONE

3. **Stop Loss Evaluation**
   * Was the SL too tight, correctly placed, or irrelevant (thesis was wrong)?
   * If SL was tight: Calculate the MINIMUM SL that would have survived.
   * Check: Did price reverse and hit TP AFTER hitting SL? (MISSED WIN flag)

4. **Entry Timing Critique**
   * Was entry premature (before confirmation) or too late (chasing)?
   * Would a DIFFERENT entry price have resulted in a win?
   * If yes, calculate the optimal entry that would have worked.

5. **Pattern Family Reliability Check**
   * Does this loss WEAKEN confidence in this pattern family?
   * Are there now multiple losses with this same family? (Check Pattern Memory)
   * Should this family require STRICTER entry conditions going forward?

6. **Market Context Blame Assessment**
   * Was this loss due to: (a) Bad setup selection, (b) Bad execution, (c) Unpredictable market event?
   * Assign blame percentage: Setup __% | Execution __% | Market __%.

**Critical Learning Output (REQUIRED):**
* Generate **one clear IF / THEN rule** that would have PREVENTED this loss:
  * Format: "IF [warning condition present] THEN [avoid trade / tighten SL / wait for X]"
  * This rule should be a DEFENSIVE filter for future trades.

**Special Flags:**
* If SL was hit but price later reached TP: Flag as **"MISSED WIN - TIGHT SL"**
* If 150% extended SL zone was breached: Flag as **"EXTENDED ZONE BREACH"**
* If similar loss pattern exists in memory: Flag as **"RECURRING FAILURE PATTERN"**

**Output Format:**
* Sectioned responses matching the numbered questions
* A clearly labeled **DEFENSIVE IF/THEN Rule**
* Special flags if applicable
* Blame assessment summary

**Tone / Style:**
Brutally honest, forensic, and solution-oriented. No excuses, only lessons.`;
    }
    const response = await ai.models.generateContent({ model: modelName, contents: { parts: [{ text: analysisPrompt }] } });
    return sanitizeAIResponse(extractTextFromResponse(response));
};

export const searchStrategies = async (query: string, activeFrameworks: string[], modelName: string): Promise<StrategySearchResult[]> => {
    // ... (unchanged)
    const ai = getAiClient();
    const frameworksList = activeFrameworks.join(', ');
    const prompt = `You are a search engine for a predefined list of trading strategies. Your entire knowledge base is limited to ONLY the following frameworks: [${frameworksList}].
    
    The user is searching for: "${query}".

    Your task is to:
    1. Find the frameworks from your knowledge base that are the most relevant to the user's query.
    2. For each relevant framework, provide a concise description.
    3. If no frameworks are relevant, return an empty array.
    4. You are strictly forbidden from suggesting or describing any strategy that is not in the provided list.`;

    const response = await ai.models.generateContent({
        model: modelName,
        contents: { parts: [{ text: prompt }] },
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        name: { type: Type.STRING, description: "The name of the strategy from the provided list." },
                        description: { type: Type.STRING, description: "A concise description of the strategy." },
                        rationale: { type: Type.STRING, description: "Why this strategy is relevant to the user's query." },
                    },
                    required: ["name", "description", "rationale"]
                }
            }
        }
    });

    try {
        const responseText = extractTextFromResponse(response);
        const parsed = JSON.parse(responseText);
        const results = Array.isArray(parsed) ? parsed : [];
        return results.filter((result: StrategySearchResult) =>
            activeFrameworks.some(fw => fw.toLowerCase() === result.name.toLowerCase())
        );
    } catch (e) {
        console.error("Failed to parse strategy search results:", e);
        return [];
    }
};

export const discoverStrategies = async (chatHistory: Message[], activeFrameworks: string[], modelName: string): Promise<StrategySearchResult[]> => {
    // ... (unchanged)
    const ai = getAiClient();
    const historyText = chatHistory.length > 0
        ? chatHistory.slice(-5).map(m => `${m.role}: ${m.text} ${m.imageSummaries?.join('\n') || ''}`).join('\n\n')
        : '';

    const prompt = `You are an expert trading strategy research assistant. Your task is to search the web to discover new, effective futures trading strategies.
    
    ${historyText ? `Base your search on the following recent conversation context:\n---\n${historyText}\n---` : 'The user has not provided a specific context. Search for generally powerful or popular futures trading strategies.'}
    
    Search for up to 3 distinct strategies. For each strategy, provide a name, a concise description, and a rationale for why it might be useful.
    
    Your final output MUST be a single, valid JSON array of objects, wrapped in a markdown code block. Do not include any other text, greetings, or explanations outside of the markdown block.
    
    Example Response:
    \`\`\`json
    [
      {
        "name": "Ichimoku Cloud Breakout",
        "description": "A strategy that identifies trades when the price breaks out of the Kumo (Cloud), often signaling a strong new trend.",
        "rationale": "This is relevant because the user's chart shows consolidating price action near a key resistance level, making it a candidate for a strong breakout."
      }
    ]
    \`\`\`
    `;

    const response = await ai.models.generateContent({
        model: modelName,
        contents: { parts: [{ text: prompt }] },
        config: {
            tools: [{ googleSearch: {} }],
        }
    });

    try {
        const responseText = extractTextFromResponse(response);
        const parsedResponse = extractAndParseJson(responseText);
        const results = Array.isArray(parsedResponse) ? parsedResponse : (parsedResponse.strategies || parsedResponse.results || []);
        return results as StrategySearchResult[];
    } catch (e) {
        console.error("Failed to parse strategy discovery results:", e, "Response text:", response.text);
        return [];
    }
};

export const getStrategyDescription = async (strategyName: string, modelName: string): Promise<string> => {
    // ... (unchanged)
    const ai = getAiClient();
    const prompt = `Provide a concise, one-paragraph explanation of the "${strategyName}" trading strategy.`;
    const response = await ai.models.generateContent({ model: modelName, contents: { parts: [{ text: prompt }] } });
    return sanitizeAIResponse(extractTextFromResponse(response));
};

export const summarizeTrade = async (trade: LoggedTrade, modelName: string): Promise<string> => {
    // ... (unchanged)
    const ai = getAiClient();

    // Create a sanitized copy of the trade to avoid sending heavy base64 image data
    const tradeForAnalysis = {
        ...trade,
        postMortemImages: trade.postMortemImages ? `[${trade.postMortemImages.length} screenshots available]` : undefined,
    };

    const prompt = `You are a trade analysis summarizer. Given the full data of a logged trade, create a concise summary.

**MANDATORY FIELDS TO INCLUDE:**
1. **Trade Outcome**: WIN, LOSS, or ENTRY_NOT_HIT
2. **Missed Win Flag**: If outcome is LOSS but the trade would have hit TP with a wider SL, include "[MISSED WIN - TIGHT SL]"
3. **Extended SL Zone Status**: If the 150% extended SL zone was breached, include "[150% ZONE BREACH]"
4. **Direction**: LONG or SHORT
5. **Confidence Level**: The AI's original confidence rating (High/Medium/Low/Avoid)
6. **Pattern Family**: Include the detected pattern family if available
7. **Primary Strategy**: The main strategy used
8. **Entry/SL/TP**: Entry price, Stop Loss, and final Take Profit

**CRITICAL - POST-MORTEM SUMMARY (MANDATORY):**
You MUST include a 2-3 sentence summary (67 words MAX) of the post-mortem analysis that captures:
- What happened and why
- The key lesson learned
- **MANDATORY**: One clear IF/THEN rule extracted from the post-mortem (e.g., "IF [condition] THEN [action]")

**FORMAT:** Dense, data-rich paragraph. No conversational language. Max 200 words total. CRITICAL: You MUST complete all sentences - never cut off mid-sentence or mid-word.

**Example Outputs:**
"WIN: LONG (High Confidence) | Family A | Momentum Breakout. Entry: 4350, SL: 4320, TP: 4450. Post-mortem: 1H 20 EMA retest confirmed entry perfectly. Pattern played out as predicted with strong follow-through. IF momentum aligns with EMA retest THEN take full position confidently."

"LOSS [MISSED WIN - TIGHT SL]: SHORT (Medium Confidence) | Family B | Bearish Engulfing. Entry: 2150, SL: 2160, TP: 2100. Post-mortem: SL hit by 5 pips then price reversed to hit TP. Volatility underestimated during consolidation. IF tight consolidation detected THEN widen SL by 15-20%."

**Trade data to summarize:**
${JSON.stringify(tradeForAnalysis, null, 2)}
    `;
    const response = await ai.models.generateContent({ model: modelName, contents: { parts: [{ text: prompt }] } });
    return sanitizeAIResponse(extractTextFromResponse(response));
};

export const generateFinalSummary = async (summaries: TradeSummary[], modelName: string, charLimit: number = 4000): Promise<string> => {
    // ... (unchanged)
    const ai = getAiClient();
    const summariesText = summaries.map(s => `- ${s.summaryText}`).join('\n');
    const tradeCount = summaries.length;

    const prompt = `You are an expert Pattern Recognition Engine. Your task is to analyze a database of historical trading logs to identify statistical patterns and behavioral trends.

**CONTEXT:**
The following data represents a log of ${tradeCount} past trades (Recent Insights). This is for **educational pattern analysis** to identify what worked and what didn't.

**MANDATORY ANALYSIS SECTIONS:**

1. **Executive Summary**: Overall win rate, total trades, key performance metrics.

2. **Missed Win Analysis** [CRITICAL]:
   - Count trades marked "[MISSED WIN - TIGHT SL]"
   - Calculate: What % of losses were missed wins due to tight SL?
   - Identify: Which pattern families or strategies had the most missed wins?
   - Recommendation: Suggest SL adjustment percentage for recurring issues

3. **150% Extended SL Zone Breach Analysis**:
   - Count trades marked "[150% ZONE BREACH]"
   - Pattern analysis: Were these valid setups with bad timing or flawed thesis?
   - Recommendation: Entry timing adjustments or SL placement rules

4. **Pattern Family Performance**:
   - Family A win rate vs overall
   - Family B win rate vs overall
   - Family C win rate vs overall
   - Family Omega win rate vs overall
   - Identify best and worst performing families

5. **Confidence Level Calibration**:
   - High confidence trade win rate
   - Medium confidence trade win rate
   - Low confidence trade win rate
   - Are confidence levels well-calibrated to outcomes?

6. **Winning Patterns**: Recurring setups that lead to wins
7. **Failure Patterns**: Recurring mistakes and loss patterns
8. **Actionable Rules**: 3-5 specific IF/THEN rules derived from the data
9. **Critical Adjustment**: The single most impactful change to implement immediately

**CONSTRAINT:** Output must be ~${charLimit} characters, one continuous text block.
**SAFETY:** No financial advice. Focus on behavioral analysis and statistical outcomes.

**HISTORICAL TRADE LOGS:**
${summariesText}
    `;

    const response = await ai.models.generateContent({ model: modelName, contents: { parts: [{ text: prompt }] } });
    return sanitizeAIResponse(extractTextFromResponse(response));
};