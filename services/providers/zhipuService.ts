// ... existing imports ...
import OpenAI from "openai";
import { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { Message, TradeOutcome, GroundingChunk, MessageRole, LoggedTrade, StrategySearchResult, TradeAnalysis, TradeSummary, GlobalMemory, AccuracySubMode } from '../../types';
import { robustJsonParse, extractAndParseJson } from '../../utils/jsonUtils';
import { sanitizeAIResponse, sanitizeJSONString } from '../../utils/sanitizers';
import { truncateTextToTokens, sanitizeTradeAnalysis } from '../../utils/analysisUtils';
import { MASTER_ANALYSIS_PROMPT, DEVILS_ADVOCATE_PROMPT, INVALIDATION_THESIS_PROMPT, CORRELATION_AWARENESS_PROMPT, LENS_MODE_BASE_PROMPT, AI_PROVIDER_MEMORY_ENFORCEMENT_PROMPT } from '../../constants/prompts';
import { constructOptimizedContext } from '../../utils/memoryUtils';
import { parseLiveMarketData } from '../../utils/liveMarketParser';

const ZHIPU_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4/';

const getClient = (): OpenAI => {
    const ZHIPU_API_KEY = process.env.ZHIPU_API_KEY;
    if (!ZHIPU_API_KEY) {
        throw new Error("ZHIPU_API_KEY is not set in environment");
    }
    return new OpenAI({
        baseURL: ZHIPU_BASE_URL,
        apiKey: ZHIPU_API_KEY,
        dangerouslyAllowBrowser: true,
        timeout: 45000, // 45 second timeout for faster failure
    });
};

// Retry helper with exponential backoff for rate limit errors and empty responses
const withRetry = async <T>(
    fn: () => Promise<T>,
    maxRetries: number = 3,
    baseDelay: number = 2000,
    operationName: string = 'Zhipu API call'
): Promise<T> => {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const result = await fn();

            // Check for empty response (which may be a soft rate limit on free tier)
            const completion = result as any;
            if (completion?.choices?.[0]?.message?.content === null ||
                completion?.choices?.[0]?.message?.content === undefined ||
                completion?.choices?.[0]?.message?.content === '') {
                if (attempt < maxRetries) {
                    const delay = baseDelay * Math.pow(2, attempt);
                    console.warn(`[Zhipu] ${operationName} returned empty response (attempt ${attempt + 1}/${maxRetries + 1}). Retrying in ${delay / 1000}s...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }
            }

            return result;
        } catch (error: any) {
            lastError = error;

            // Check if it's a retriable error (429 rate limit or empty response)
            const is429 = error?.status === 429 ||
                error?.message?.includes('429') ||
                error?.message?.includes('Too many') ||
                error?.message?.includes('rate limit') ||
                error?.message?.includes('empty response');

            if (!is429 || attempt === maxRetries) {
                throw error;
            }

            // Exponential backoff: 2s, 4s, 8s, etc.
            const delay = baseDelay * Math.pow(2, attempt);
            console.warn(`[Zhipu] ${operationName} hit rate limit (attempt ${attempt + 1}/${maxRetries + 1}). Retrying in ${delay / 1000}s...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    throw lastError || new Error('Retry failed after max attempts');
};

const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
};

export const summarizeChartImage = async (image: File, chartNumber: number, modelName: string): Promise<{ uiSummary: string; fullSummary: string }> => {
    try {
        const zhipu = getClient();
        const base64Image = await fileToBase64(image);

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

        const completion = await zhipu.chat.completions.create({
            model: modelName,
            messages: [{
                role: 'user',
                content: [
                    { type: 'text', text: prompt },
                    { type: 'image_url', image_url: { url: `data:${image.type};base64,${base64Image}` } }
                ]
            }],
            max_tokens: 1024,
        });

        const fullSummary = completion.choices[0].message.content?.trim() || `Analysis failed for Chart ${chartNumber}.`;

        const timeframeMatch = fullSummary.match(/Timeframe:\s*(.*?)(?:\n|$)/i);
        const priceMatch = fullSummary.match(/(?:Current )?Price:\s*(.*?)(?:\n|$)/i);
        const patternMatch = fullSummary.match(/Pattern Detected:\s*(.*?)(?:\n|$)/i);

        const timeframe = timeframeMatch ? timeframeMatch[1].trim().replace(/['"]/g, '') : 'N/A';
        let price = priceMatch ? priceMatch[1].trim().replace(/['"]/g, '') : 'N/A';
        let pattern = patternMatch ? patternMatch[1].trim().replace(/['"]/g, '') : '';

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
        console.error("Error in Zhipu summarizeChartImage:", error);
        return {
            uiSummary: `Chart ${chartNumber} | Error | N/A`,
            fullSummary: `Chart ${chartNumber} Vision Analysis Failed: ${(error as Error).message}`
        };
    }
};

// ... (rest of file remains the same)
export const analyzeTradingView = async (
    prompt: string,
    images: File[],
    imageSummaries: string[],
    chatHistory: Message[],
    finalTradeSummary: string | null,
    recentInsights: string | null, // New param
    modelName: string,
    activeFrameworks: string[],
    deepenAnalysis: boolean,
    globalMemory?: GlobalMemory,
    threadSummary?: string,
    subMode?: AccuracySubMode, // Ignored in standard service
    customInstructions?: string, // New Param
    isPlaybookEnabledInPureAI?: boolean, // Ignored in standard service
    isFamiliesEnabledInPureAI?: boolean, // Ignored in standard service
    isMemoryEnabledInPureAI?: boolean, // Ignored in standard service
    rolePrompt?: string // Analyst Lens: specialized role prompt prefix
): Promise<{ analysis: TradeAnalysis; thoughtProcess: string; sources: GroundingChunk[] }> => {
    const isVisionModel = modelName.includes('v');
    if (!isVisionModel && images.length > 0) {
        console.warn(`Zhipu model ${modelName} is not a vision model, but images were provided. Analyzing based on text summaries only.`);
    }

    const zhipu = getClient();
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

    const frameworksList = activeFrameworks.map((fw, i) => `${i + 1}. **${fw}**`).join('\n');
    const imageSummaryContext = imageSummaries.length > 0 ? `**PRE-PROCESSED VISION ANALYSIS** ... ${imageSummaries.join('\n\n')}` : "No chart data provided.";
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

      ${AI_PROVIDER_MEMORY_ENFORCEMENT_PROMPT}

      ${userOverride}

      ${marketDataOverride}

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
      3. If R:R >= 1.2, proceed. Calculate and include profit percentages for TPs.
      4. Calculate and include the stop loss percentage.
      5. Extract the Coin Name (e.g. BTCUSDT, ETH, SOL) from the analysis.

      **SYNTHESIS & OUTPUT (STRICT JSON):**
      
      ${rolePrompt ? '' : `**FORMATTING RULE:** Your 'thoughtProcess' MUST follow the Structure of Sections 1-8. Use a numbered list (1-8) matching the MASTER PROMPT sections exactly (e.g. "1. Multi-Timeframe Structure...", "2. Price Action Type...", "7. Numeric Chart Analysis...", "8. Full Trade Setup...").`}

      Your entire response MUST be a single, valid JSON object with two keys: "thoughtProcess" and "analysis". 
      **DO NOT include any text, markdown, or explanations outside the JSON block.**
      **The output must be parsable by JSON.parse() immediately.**

      **RESPONSE JSON Structure:**
      {
        "thoughtProcess": "Your detailed thought process string goes here (Sections 1-8)...",
        "analysis": { 
            "coinName": "BTCUSDT", 
            "direction": "Long", 
            "confidence": "Medium", 
            "probability": 65, 
            "strategy": "...", 
            "activeStrategies": ["..."], 
            "entryPoints": [{ "price": "...", "description": "..." }], 
            "stopLoss": "...", 
            "stopLossPercentage": "...", 
            "takeProfit": [{ "price": "...", "percentage": "..." }], 
            "historicalCorrelation": "...", 
            "marketConditions": { "pattern": "...", "candleBehavior": "...", "timeframeAlignment": "...", "rsi": "...", "macd": "...", "sentiment": "..." },
            "detectedPatternFamily": "Family A | Family B | Family C | Family Omega"
        }
      }
    `;

    // Special handling for Live Market Data injection
    const isLiveMarketData = prompt.includes("**LIVE MARKET DATA**");
    const formattedPrompt = isLiveMarketData
        ? `User's request:\n${prompt}\n\n`
        : `User's request: "${prompt}"\n\n`;

    const userPromptContent = `${formattedPrompt}${imageSummaryContext}\n\n${patternMemoryContext}\n\n${recentInsightsContext}\n\n${memoryContext}\n\nGENERATE JSON ONLY.`;

    const messages: ChatCompletionMessageParam[] = [{ role: 'system', content: systemPrompt }];
    const userContent: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [{ type: 'text', text: userPromptContent }];

    // Using visual capabilities for accuracy mode if images exist
    if (hasImages) {
        for (const image of images) {
            const base64Image = await fileToBase64(image);
            userContent.push({ type: 'image_url', image_url: { url: `data:${image.type};base64,${base64Image}` } });
        }
    }
    messages.push({ role: 'user', content: userContent });

    // Use retry logic for rate limit handling
    const completion = await withRetry(
        () => zhipu.chat.completions.create({
            model: modelName,
            messages,
            max_tokens: 2048,
            temperature: 0.3,
        }),
        3, // max retries
        2000, // base delay 2s
        `analyzeTradingStrategy (${modelName})`
    );
    const responseText = completion.choices[0].message.content;
    if (!responseText) throw new Error("Received an empty response from Zhipu AI.");

    try {
        // First, try to extract JSON using the standard method
        let responseJson;
        try {
            responseJson = extractAndParseJson(responseText);
        } catch (extractError) {
            // Fallback: Try to find JSON in the response more aggressively
            console.warn('[Zhipu] Standard JSON extraction failed, trying fallback...', extractError);

            // Try to find JSON block between ```json and ```
            const jsonBlockMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/);
            if (jsonBlockMatch) {
                responseJson = JSON.parse(jsonBlockMatch[1]);
            } else {
                // Try to find raw JSON object
                const jsonMatch = responseText.match(/\{[\s\S]*"analysis"[\s\S]*\}/);
                if (jsonMatch) {
                    responseJson = JSON.parse(jsonMatch[0]);
                } else {
                    throw extractError;
                }
            }
        }

        const thoughtProcess = sanitizeAIResponse(responseJson.thoughtProcess || "No thought process provided.");
        let analysis: TradeAnalysis = sanitizeTradeAnalysis(responseJson.analysis);
        if (!analysis) throw new Error("Zhipu AI response JSON did not contain 'analysis' object.");

        analysis.activeStrategies = Array.isArray(analysis.activeStrategies) ? analysis.activeStrategies : [];
        analysis.stopLoss = sanitizeJSONString(analysis.stopLoss);
        analysis.takeProfit = Array.isArray(analysis.takeProfit) ? analysis.takeProfit.map(tp => ({ price: sanitizeJSONString(String(tp.price || '')), percentage: sanitizeJSONString(String(tp.percentage || '')) })).filter(tp => tp.price) : [];
        analysis.entryPoints = Array.isArray(analysis.entryPoints) ? analysis.entryPoints.map(ep => ({ description: sanitizeJSONString(String(ep.description || '')), price: sanitizeJSONString(String(ep.price || '')) })).filter(ep => ep.description) : [];
        analysis.createdAt = new Date().toISOString();

        return { analysis, thoughtProcess, sources: [] };
    } catch (error) {
        console.error("Zhipu AI analysis JSON parsing failed:", error, "Response:", responseText?.substring(0, 500));
        throw new Error(`Failed to parse trading analysis from Zhipu AI. Model: ${modelName}`);
    }
};

export const getQuickResponse = async (prompt: string, history: Message[], modelName: string, systemInstruction?: string): Promise<string> => {
    const zhipu = getClient();
    const messages: ChatCompletionMessageParam[] = history.map(m => ({ role: m.role === MessageRole.AI ? 'assistant' : 'user', content: m.text }));
    messages.unshift({ role: 'system', content: systemInstruction || 'You are a helpful and concise AI assistant specializing in futures trading.' });
    messages.push({ role: 'user', content: prompt });

    const completion = await withRetry(
        () => zhipu.chat.completions.create({ model: modelName, messages, max_tokens: 1024 }),
        3, 2000, `getQuickResponse (${modelName})`
    );
    return sanitizeAIResponse(completion.choices[0].message.content || "Sorry, I could not generate a response.");
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
    const zhipu = getClient();
    const { correctedEntry, correctedStopLoss, correctedTakeProfit } = feedback;
    let analysisPrompt: string;

    const postTradeContext = postTradeImageSummaries?.length ? `**⚠️ VERIFIED TRADE OUTCOME DATA (HIGHEST PRIORITY):**\n---\n${postTradeImageSummaries.join('\n\n---\n\n')}\n---\n` : '';
    const tradeHistoryContext = finalTradeSummary ? `**PATTERN MEMORY LIBRARY (Historical Context):**\n${truncateTextToTokens(finalTradeSummary)}` : "No past trades logged.";

    // CRITICAL FIX: Always include TP/SL reference, not just when screenshots are provided
    const origEntry = previousMessage.analysis?.entryPoints?.[0]?.price || 'N/A';
    const origSL = previousMessage.analysis?.stopLoss || 'N/A';
    const origTP1 = previousMessage.analysis?.takeProfit?.[0]?.price || 'N/A';
    const origTP2 = previousMessage.analysis?.takeProfit?.[1]?.price || '';
    const origTP3 = previousMessage.analysis?.takeProfit?.[2]?.price || '';
    const tradeDirection = previousMessage.analysis?.direction || 'N/A';

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
        const userFeedbackBlock = correctedEntry ? `**USER FEEDBACK: CORRECTED ENTRY** The user provided a corrected entry: ${correctedEntry}. Analyze why this was a better level.` : '';
        analysisPrompt = `A trade was not executed because the entry was not hit. Analyze why and formulate an actionable rule.\nPREVIOUS ANALYSIS: ${JSON.stringify(previousMessage.analysis, null, 2)}\nACTUAL OUTCOME: ${outcome}\n${postTradeContext}\n${userFeedbackBlock}\n${tradeHistoryContext}\n${groundingDirective}\n${learningDirective}\nYour task: Explain the market divergence from the expected entry. If post-trade screenshots are available, provide a narrative of what happened *instead* of hitting the entry. Conclude with a quantifiable IF/THEN rule to improve future entries.`;
    } else {
        const feedbackBlock = `**USER FEEDBACK ON TRADE OUTCOME:**\n${correctedStopLoss ? `- **Corrected SL:** ${correctedStopLoss}` : ''}\n${correctedTakeProfit ? `- **Final TP:** ${correctedTakeProfit}` : ''}`;

        const detailedAnalysisTask = `
          **YOUR TASK:** Conduct a detailed post-mortem.
          1.  **Narrative Analysis (MANDATORY):** Based *only* on the visual evidence from the 'POST-TRADE CONTEXT' screenshots, provide a detailed, step-by-step narrative of how the market moved after the trade was called.
              -   **Initial Reaction**: Describe price action immediately following the potential entry point.
              -   **Key Developments**: Identify new patterns, support/resistance flips, or indicator signals that appeared in the post-trade charts.
              -   **Climax**: Explain the price action that led to the final outcome (hitting SL/TP).
              -   **Conclusion**: Summarize why the market behaved as it did, referencing visual evidence.
          2.  **Critique & Learning:** Based on your narrative, critique the original plan's entry, SL, and TP. Then, formulate a single, precise, quantifiable IF/THEN learning rule to apply to future trades.`;

        const simpleAnalysisTask = `Your task: Re-evaluate, critique risk parameters, and formulate a single, precise, quantifiable IF/THEN learning rule.`;

        const task = postTradeImageSummaries?.length ? detailedAnalysisTask : simpleAnalysisTask;

        analysisPrompt = `A trade was executed with the outcome: ${outcome}. Conduct a post-mortem.\nPREVIOUS ANALYSIS: ${JSON.stringify(previousMessage.analysis, null, 2)}\n${postTradeContext}\n${feedbackBlock}\n${tradeHistoryContext}\n${groundingDirective}\n${learningDirective}\n${extendedSLZoneContext}\n${task}`;
    }

    const completion = await withRetry(
        () => zhipu.chat.completions.create({ model: modelName, messages: [{ role: 'user', content: analysisPrompt }] }),
        3, 2000, `conductPostMortem (${modelName})`
    );
    return sanitizeAIResponse(completion.choices[0].message.content || "Post-mortem analysis failed.");
};

export const summarizeTrade = async (trade: LoggedTrade, modelName: string): Promise<string> => {
    // ... (unchanged)
    const zhipu = getClient();

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
    const completion = await withRetry(
        () => zhipu.chat.completions.create({
            model: modelName,
            messages: [{ role: 'user', content: prompt }]
        }),
        3, 2000, `summarizeTrade (${modelName})`
    );
    return sanitizeAIResponse(completion.choices[0].message.content || "Summary generation failed.");
};

export const generateFinalSummary = async (summaries: TradeSummary[], modelName: string, charLimit: number = 4000): Promise<string> => {
    // ... (unchanged)
    const zhipu = getClient();
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

    const completion = await zhipu.chat.completions.create({
        model: modelName,
        messages: [{ role: 'user', content: prompt }]
    });
    return sanitizeAIResponse(completion.choices[0].message.content || "Final summary generation failed.");
};

// Memory compression for chat history
export const compressChatHistory = async (messages: Message[], currentSummary: string = ""): Promise<string> => {
    const zhipu = getClient();
    const messagesText = messages.map(m => `${m.role}: ${m.text}`).join('\n\n');

    const prompt = `
You are the **Memory Compressor**.
Your job is to condense a chat history into a highly efficient "Layer 2 Summary".

**RULES:**
1. **Preserve Key Data:** Keep trade setups, outcomes, specific coin names, and leverage used.
2. **Discard Fluff:** Remove greetings, small talk, and redundant confirmations.
3. **Track Decisions:** Note why a trade was taken or skipped.
4. **Maintain Chronology:** Keep the flow of events logical.
5. **Update Strategy:** If the user gave a specific instruction (e.g., "Don't use RSI anymore"), highlight it.

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

    const completion = await zhipu.chat.completions.create({
        model: 'glm-4',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 2048
    });
    return sanitizeAIResponse(completion.choices[0].message.content || "Memory compression failed.");
};

// Update global memory with trade insights
export const updateGlobalMemory = async (recentTrades: LoggedTrade[], currentMemory?: GlobalMemory): Promise<GlobalMemory> => {
    const zhipu = getClient();
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
You are the **Global Memory Manager**.
Your job is to update the long-term "Layer 3" memory bank based on a batch of new trade logs.

**TASK:**
1. **Update Stats:** Increment total trades.
2. **Pattern Recognition:** Analyze the new trades. Add patterns to 'aiPatternMemory'.
3. **User Preferences:** Update leverage or favorite assets.
4. **Corrections:** Extract lessons and add to 'globalCorrections'.

**EXISTING GLOBAL MEMORY:**
${currentMemoryJson}

**RECENT TRADES (LAYER 2 DATA):**
${tradeSummaries}

**INSTRUCTIONS:**
Generate the updated Global Memory JSON object.

Return ONLY valid JSON, no additional text.
    `;

    const completion = await zhipu.chat.completions.create({
        model: 'glm-4',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 2048
    });

    const responseText = completion.choices[0].message.content || "{}";
    try {
        return extractAndParseJson(responseText);
    } catch {
        console.error("Zhipu updateGlobalMemory JSON parse failed:", responseText);
        return currentMemory || {} as GlobalMemory;
    }
};