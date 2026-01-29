
import OpenAI from "openai";
import { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { Message, TradeOutcome, GroundingChunk, MessageRole, LoggedTrade, StrategySearchResult, TradeAnalysis, TradeSummary, GlobalMemory, AccuracySubMode } from '../types';
import { robustJsonParse, extractAndParseJson } from '../utils/jsonUtils';
import { sanitizeAIResponse, sanitizeJSONString } from '../utils/sanitizers';
import { truncateTextToTokens, sanitizeTradeAnalysis } from '../utils/analysisUtils';
import { MASTER_ANALYSIS_PROMPT, DEVILS_ADVOCATE_PROMPT, INVALIDATION_THESIS_PROMPT, CORRELATION_AWARENESS_PROMPT, LENS_MODE_BASE_PROMPT, MEMORY_COMPRESSOR_PROMPT, GLOBAL_MEMORY_MANAGER_PROMPT, AI_PROVIDER_MEMORY_ENFORCEMENT_PROMPT } from '../constants/prompts';
import { constructOptimizedContext } from '../utils/memoryUtils';
import { parseLiveMarketData } from '../utils/liveMarketParser';

const GROK_BASE_URL = 'https://api.x.ai/v1';

const getClient = (): OpenAI => {
    const GROK_API_KEY = process.env.GROK_API_KEY;
    if (!GROK_API_KEY) {
        throw new Error("GROK_API_KEY is not set in environment");
    }

    return new OpenAI({
        baseURL: GROK_BASE_URL,
        apiKey: GROK_API_KEY,
        dangerouslyAllowBrowser: true,
    });
};

const getMaxTokens = (modelName: string, defaultTokens: number): number => {
    if (modelName.includes('mini') || modelName.includes('fast')) {
        return Math.min(defaultTokens, 4096);
    }
    return defaultTokens;
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
        const client = getClient();
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
        Narrative: [A 2-3 sentence description of what is happening in the chart.]

        **INSTRUCTIONS:**
        - Extract exact numbers where visible.
        - Look specifically for the specific candlestick shape of the last 1-3 candles.
        - If a field is not visible or applicable, write "N/A".
        - Do not mix sections.
        - Keep descriptions concise.
        `;

        const completion = await client.chat.completions.create({
            model: modelName,
            messages: [{
                role: 'user',
                content: [
                    { type: 'text', text: prompt },
                    { type: 'image_url', image_url: { url: `data:${image.type};base64,${base64Image}` } }
                ]
            }],
            max_tokens: getMaxTokens(modelName, 1024),
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

        let uiSummary = `Chart ${chartNumber} | ${timeframe} | ${price}`;
        if (pattern) {
            uiSummary += ` | ${pattern}`;
        }

        return { uiSummary, fullSummary };
    } catch (error) {
        console.error("Error in Grok summarizeChartImage:", error);
        return {
            uiSummary: `Chart ${chartNumber} | Error | N/A`,
            fullSummary: `Chart ${chartNumber} Vision Analysis Failed: ${(error as Error).message}`
        };
    }
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
    globalMemory?: GlobalMemory,
    threadSummary?: string,
    subMode?: AccuracySubMode,
    customInstructions?: string,
    isPlaybookEnabledInPureAI?: boolean,
    isFamiliesEnabledInPureAI?: boolean,
    isMemoryEnabledInPureAI?: boolean,
    rolePrompt?: string // Analyst Lens: specialized role prompt prefix
): Promise<{ analysis: TradeAnalysis; thoughtProcess: string; sources: GroundingChunk[] }> => {
    const client = getClient();
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
    
    **MANDATORY:** You MUST populate the 'detectedPatterns', 'keyLevels', and 'marketConditions.prices' fields in your JSON response with this data.
        `;
    }

    // Truncate memory context to prevent overflow
    // MODEL LIMITS: Groq ~10k, GPT ~8k. System prompt uses ~3k. Budget ~5k for all context.
    const rawMemoryContext = constructOptimizedContext(chatHistory, threadSummary, globalMemory);
    const memoryContext = truncateTextToTokens(rawMemoryContext, 1500);

    // CRITICAL: Inject Pattern Memory (Synthesis) - Labeled to match UI
    // Limit: 1,000 tokens
    const rawPatternMemory = finalTradeSummary
        ? `\n\n**📊 PATTERN MEMORY (SYNTHESIS) - MANDATORY REFERENCE:**\nThe following is a synthesis of your recent trading performance and patterns. You MUST reference this data for Section 4 (Pattern Matching):\n${finalTradeSummary}\n`
        : "\n\n**📊 PATTERN MEMORY:** No synthesis available yet.\n";
    const patternMemoryContext = truncateTextToTokens(rawPatternMemory, 1000);

    // CRITICAL: Inject Recent Insights (Individual Trades) - Labeled to match UI
    // Limit: 1,000 tokens
    const rawRecentInsights = recentInsights
        ? `\n\n**📊 RECENT INSIGHTS (INDIVIDUAL) - MANDATORY REFERENCE:**\nThe following are specific recent trades for detailed comparison:\n${recentInsights}\n`
        : "\n\n**📊 RECENT INSIGHTS:** No recent trade insights available.\n";
    const recentInsightsContext = truncateTextToTokens(rawRecentInsights, 1000);

    const frameworksList = activeFrameworks.map((fw, index) => `${index + 1}. **${fw}**`).join('\n');

    // Limit image summaries to 1,500 tokens
    const rawImageSummaries = imageSummaries.length > 0 ? `**PRE-PROCESSED VISION ANALYSIS**...\n${imageSummaries.join('\n\n---\n\n')}` : "No chart data provided.";
    const imageSummaryContext = truncateTextToTokens(rawImageSummaries, 1500);

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
      ${rolePrompt ? '' : `**FORMATTING RULE:** Your 'thoughtProcess' MUST follow the Structure of Sections 1-8. Use a numbered list (1-8) matching the MASTER PROMPT sections exactly.`}
      
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

      **SYNTHESIS & OUTPUT (STRICT JSON):**

      Your entire response MUST be a single, valid JSON object with two keys: "thoughtProcess" and "analysis".
      **Output ONLY valid JSON. Do not wrap it in markdown (\`\`\`json). Do not include any preamble or postscript.**

      **RESPONSE JSON Structure:**
      {
        "thoughtProcess": "Your detailed thought process string goes here (Sections 1-8)...",
        "analysis": {
            "coinName": "BTCUSDT", 
            "direction": "Long", 
            "confidence": "High", 
            "probability": 79, 
            "strategy": "...", 
            "activeStrategies": ["..."], 
            "entryPoints": [{"description": "...", "price": "..."}], 
            "stopLoss": "...", 
            "stopLossPercentage": "...", 
            "takeProfit": [{"price": "...", "percentage": "..."}], 
            "historicalCorrelation": "...", 
            "marketConditions": { 
                "pattern": "...", 
                "candleBehavior": "...", 
                "timeframeAlignment": "...", 
                "rsi": "...", 
                "macd": "...", 
                "sentiment": "...",
                "prices": { "5m": "...", "15m": "...", "1h": "...", "4h": "..." }
            },
            "detectedPatternFamily": "Family A | Family B | Family C | Family Omega",
            "detectedPatterns": [{ "name": "...", "timeframe": "...", "type": "Bullish | Bearish | Neutral", "confidence": "...", "description": "..." }],
            "keyLevels": { "support": ["..."], "resistance": ["..."] }
        }
      }
    `;

    const isLiveMarketData = prompt.includes("**LIVE MARKET DATA**");
    const isHybridIntelligenceData = prompt.includes("HYBRID INTELLIGENCE") || prompt.includes("VERIFIED MARKET DATA");
    const formattedPrompt = (isLiveMarketData || isHybridIntelligenceData)
        ? `User's request:\n${prompt}\n\n`
        : `User's request: "${prompt}"\n\n`;

    const userPromptText = `${formattedPrompt}${imageSummaryContext}\n\n${patternMemoryContext}\n\n${recentInsightsContext}\n\n${memoryContext}\n\nOUTPUT VALID JSON ONLY.`;

    const messages: ChatCompletionMessageParam[] = [{ role: "system", content: systemPrompt }];
    const userContent: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [{ type: 'text', text: userPromptText }];

    if (hasImages && images.length > 0) {
        for (const image of images) {
            const base64Image = await fileToBase64(image);
            userContent.push({ type: 'image_url', image_url: { url: `data:${image.type};base64,${base64Image}` } });
        }
    }
    messages.push({ role: "user", content: userContent });

    const completion = await client.chat.completions.create({
        model: modelName,
        messages: messages,
        response_format: { type: "json_object" },
        max_tokens: getMaxTokens(modelName, 4096),
    });

    const responseText = completion.choices[0].message.content;
    if (!responseText) throw new Error("Received an empty response from Grok.");

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
        console.error("Grok analysis JSON parsing failed:", error, "Response:", responseText);
        throw new Error("Failed to parse the trading analysis from the Grok response.");
    }
};

export const getQuickResponse = async (prompt: string, history: Message[], modelName: string, systemInstruction?: string): Promise<string> => {
    const client = getClient();
    const messages: ChatCompletionMessageParam[] = history.map(m => ({
        role: m.role === MessageRole.AI ? 'assistant' : 'user',
        content: m.text
    }));

    messages.unshift({ role: 'system', content: systemInstruction || 'You are a helpful and concise AI assistant specializing in futures trading concepts. Answer user questions clearly.' });
    messages.push({ role: 'user', content: prompt });

    const completion = await client.chat.completions.create({ model: modelName, messages, max_tokens: getMaxTokens(modelName, 1024) });
    return sanitizeAIResponse(completion.choices[0].message.content || "I am sorry, I could not generate a response.");
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
    const client = getClient();
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
        ? `**CRITICAL DIRECTIVE:** The 'VERIFIED TRADE OUTCOME DATA' section above contains the **ACTUAL EXIT PRICE** where the trade closed (SL or TP hit). You MUST use this exact price for all P&L calculations and analysis.`
        : tpSlReferenceDirective;
    const learningDirective = `**PATTERN RECOGNITION (ACCURACY MODE):** You must consult the 'Pattern Memory Library'. Determine if the cause of this trade result aligns with a recurring pattern.`;

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
Perform a mandatory **WIN ANALYSIS** to extract replicable success factors and bank this pattern.

**PREVIOUS ANALYSIS:**
${JSON.stringify(previousMessage.analysis, null, 2)}

**ACTUAL OUTCOME:** ${outcome} ✅

${postTradeContext}

${feedbackBlock}

${tradeHistoryContext}

${groundingDirective}

**Instructions:**
Answer **all** of the following **MANDATORY WIN ANALYSIS QUESTIONS**:

1. **Entry Quality Assessment** - Rate entry precision: EXCELLENT / GOOD / ACCEPTABLE
2. **Setup Confirmation Signals** - List EXACT technical signals that confirmed this setup
3. **Risk Management Review** - Was SL threatened? Calculate final R multiple achieved
4. **Pattern Family Validation** - Does this win STRENGTHEN confidence in this family?
5. **Replication Checklist** - Extract 3-5 SPECIFIC conditions that MUST be present to replicate

**Critical Learning Output (REQUIRED):**
* Generate **one IF / THEN rule** that captures the WINNING FORMULA
* Flag for **PATTERN MEMORY STORAGE** with tag: "CONFIRMED_WIN_PATTERN"

**Tone:** Celebratory but analytical. Focus on what to REPEAT.`;

    } else {
        // ============ LOSS-SPECIFIC POST-MORTEM PROMPT ============
        const feedbackBlock = `**USER FEEDBACK (TRADE OUTCOME):**
${correctedStopLoss ? `- Corrected SL: ${correctedStopLoss}` : ''}
${correctedTakeProfit ? `- Final TP: ${correctedTakeProfit}` : ''}`;

        analysisPrompt = `**Role:**
You are an advanced trade post-analysis engine focused on **LOSS PREVENTION** and failure pattern recognition.

**Task:**
Perform a mandatory **LOSS FORENSIC ANALYSIS** to identify root cause of failure and create defensive rules.

**PREVIOUS ANALYSIS:**
${JSON.stringify(previousMessage.analysis, null, 2)}

**ACTUAL OUTCOME:** ${outcome} ❌

${postTradeContext}

${feedbackBlock}

${tradeHistoryContext}

${groundingDirective}

${extendedSLZoneContext}

**Instructions:**
Answer **all** of the following **MANDATORY LOSS ANALYSIS QUESTIONS**:

1. **Failure Point Identification** - EXACT candle/bar that invalidated the trade
2. **Warning Signs Autopsy** - Rate pre-loss warnings: CLEAR / SUBTLE / NONE
3. **Stop Loss Evaluation** - Was SL too tight? Did price later hit TP? (MISSED WIN flag)
4. **Entry Timing Critique** - Was entry premature or too late?
5. **Pattern Family Reliability Check** - Should this family require STRICTER conditions?
6. **Blame Assessment** - Setup __% | Execution __% | Market __%

**Critical Learning Output (REQUIRED):**
* Generate **one IF / THEN rule** that would have PREVENTED this loss

**Special Flags:**
* If SL hit but price later reached TP: **"MISSED WIN - TIGHT SL"**
* If 150% extended SL zone breached: **"EXTENDED ZONE BREACH"**

**Tone:** Brutally honest, forensic. No excuses, only lessons.`;
    }

    const completion = await client.chat.completions.create({
        model: modelName,
        messages: [{ role: 'user', content: analysisPrompt }],
        max_tokens: getMaxTokens(modelName, 2048)
    });
    return sanitizeAIResponse(completion.choices[0].message.content || "Post-mortem analysis failed.");
};

export const searchStrategies = async (query: string, activeFrameworks: string[], modelName: string): Promise<StrategySearchResult[]> => {
    const client = getClient();
    const frameworksList = activeFrameworks.join(', ');
    const prompt = `You are a search engine for trading strategies. Your knowledge base is limited to: [${frameworksList}].
    
    Search for: "${query}".
    Return a JSON array of objects with keys "name", "description", and "rationale".
    Only include strategies from the provided list.`;

    const completion = await client.chat.completions.create({
        model: modelName,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
    });

    const responseText = completion.choices[0].message.content;
    if (!responseText) return [];

    try {
        const parsed = JSON.parse(responseText);
        const results = Array.isArray(parsed) ? parsed : (parsed.results || parsed.strategies || []);
        return results.filter((result: any) =>
            result.name && typeof result.name === 'string' &&
            activeFrameworks.some(fw => fw.toLowerCase() === result.name.toLowerCase())
        );
    } catch (e) {
        console.error("Failed to parse Grok strategy search results:", e);
        return [];
    }
};

export const discoverStrategies = async (chatHistory: Message[], activeFrameworks: string[], modelName: string): Promise<StrategySearchResult[]> => {
    const client = getClient();
    const frameworksList = activeFrameworks.join(', ');
    const historyText = chatHistory.length > 0
        ? chatHistory.slice(-5).map(m => `${m.role}: ${m.text} ${m.imageSummaries?.join('\n') || ''}`).join('\n\n')
        : '';

    const prompt = `You are an AI that suggests trading strategies from this list: [${frameworksList}].
    
    ${historyText ? `Based on conversation:\n${historyText}\n` : ''}
    
    Pick 3 relevant strategies. Return a JSON array with keys "name", "description", and "rationale".`;

    const completion = await client.chat.completions.create({
        model: modelName,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
    });

    const responseText = completion.choices[0].message.content;
    if (!responseText) return [];

    try {
        const parsed = JSON.parse(responseText);
        const results = Array.isArray(parsed) ? parsed : (parsed.results || parsed.strategies || []);
        return results.filter((result: any) =>
            result.name && typeof result.name === 'string' &&
            activeFrameworks.some(fw => fw.toLowerCase() === result.name.toLowerCase())
        );
    } catch (e) {
        console.error("Failed to parse Grok strategy discovery results:", e);
        return [];
    }
};

export const getStrategyDescription = async (strategyName: string, modelName: string): Promise<string> => {
    const client = getClient();
    const prompt = `Provide a concise, one-paragraph explanation of the "${strategyName}" trading strategy.`;
    const completion = await client.chat.completions.create({ model: modelName, messages: [{ role: 'user', content: prompt }] });
    return sanitizeAIResponse(completion.choices[0].message.content || "Failed to retrieve strategy description.");
};

export const summarizeTrade = async (trade: LoggedTrade, modelName: string): Promise<string> => {
    const client = getClient();
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

    const completion = await client.chat.completions.create({
        model: modelName,
        messages: [{ role: 'user', content: prompt }]
    });
    return sanitizeAIResponse(completion.choices[0].message.content || "Summary generation failed.");
};

export const generateFinalSummary = async (summaries: TradeSummary[], modelName: string, charLimit: number = 4000): Promise<string> => {
    const client = getClient();
    const summariesText = summaries.map(s => `- ${s.summaryText}`).join('\n');
    const tradeCount = summaries.length;

    const prompt = `
You are a Pattern Recognition Engine.

Output a summary using these headings in order:
Executive Summary, Missed Win Analysis, Extended SL Zone Breach Analysis, Pattern Family Performance, Confidence Calibration, Winning Patterns, Failure Patterns, Behavioral Biases, Statistical Tendencies, Actionable Rules, Conclusion

**SPECIAL ATTENTION:**
- Missed Win Analysis: Count "[MISSED WIN - TIGHT SL]" trades, calculate avoidable loss %, recommend SL adjustments
- Extended SL Zone Breach: Count "[150% ZONE BREACH]" trades, analyze if bad entry or failed thesis
- Pattern Family Performance: Compare Family A/B/C/Omega win rates
- Confidence Calibration: Compare High/Medium/Low confidence win rates

Analyze the ${tradeCount} trades below (~${charLimit} chars):

${summariesText}

Return ONLY the structured summary.
`;

    const completion = await client.chat.completions.create({
        model: modelName,
        messages: [{ role: 'user', content: prompt }]
    });
    return sanitizeAIResponse(completion.choices[0].message.content || "Final summary generation failed.");
};

export const compressChatHistory = async (messages: Message[], currentSummary: string = ""): Promise<string> => {
    const client = getClient();
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

    const completion = await client.chat.completions.create({
        model: 'grok-3-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 2048
    });
    return sanitizeAIResponse(completion.choices[0].message.content || "Memory compression failed.");
};

export const updateGlobalMemory = async (recentTrades: LoggedTrade[], currentMemory?: GlobalMemory): Promise<GlobalMemory> => {
    const client = getClient();
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

    const completion = await client.chat.completions.create({
        model: 'grok-3-mini',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        max_tokens: 2048
    });

    const responseText = completion.choices[0].message.content || "{}";
    try {
        return JSON.parse(responseText);
    } catch {
        console.error("Grok updateGlobalMemory JSON parse failed:", responseText);
        return currentMemory || {
            totalTradesAnalyzed: 0,
            familyPerformance: {},
            aiPatternMemory: [],
            userPreferences: { leverageDefault: 10, favoriteAssets: [], preferredSetup: '' },
            globalCorrections: [],
            lastUpdated: new Date().toISOString()
        };
    }
};
