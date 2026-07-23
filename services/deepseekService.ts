
// ... existing imports ...
import OpenAI from "openai";
import { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { Message, TradeOutcome, GroundingChunk, MessageRole, LoggedTrade, StrategySearchResult, TradeAnalysis, TradeSummary, GlobalMemory, AccuracySubMode } from '../types';
import { robustJsonParse, extractAndParseJson } from '../utils/jsonUtils';
import { sanitizeAIResponse, sanitizeJSONString } from '../utils/sanitizers';
import { truncateTextToTokens, sanitizeTradeAnalysis } from '../utils/analysisUtils';
import { MASTER_ANALYSIS_PROMPT, DEVILS_ADVOCATE_PROMPT, INVALIDATION_THESIS_PROMPT, CORRELATION_AWARENESS_PROMPT, LENS_MODE_BASE_PROMPT, MEMORY_COMPRESSOR_PROMPT, GLOBAL_MEMORY_MANAGER_PROMPT, AI_PROVIDER_MEMORY_ENFORCEMENT_PROMPT } from '../constants/prompts';
import { constructOptimizedContext } from '../utils/memoryUtils';
import { parseLiveMarketData } from '../utils/liveMarketParser';
import { Capacitor } from '@capacitor/core';

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';

// Check if running in Capacitor (native APK)
const isCapacitor = (): boolean => {
    try {
        return Capacitor.isNativePlatform();
    } catch {
        return false;
    }
};

// Native HTTP call for Capacitor (bypasses CORS)
const nativeDeepSeekCall = async (
    modelName: string,
    messages: Array<{ role: string; content: any }>,
    options: { response_format?: { type: string }; max_tokens?: number } = {}
): Promise<any> => {
    console.log(`[DeepSeek Native] Calling model: ${modelName}`);
    console.log(`[DeepSeek Native] Endpoint: ${DEEPSEEK_BASE_URL}/chat/completions`);

    try {
        const response = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
            },
            body: JSON.stringify({
                model: modelName,
                messages,
                ...options,
            }),
        });

        console.log(`[DeepSeek Native] Response status: ${response.status}`);

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[DeepSeek Native] Error response: ${errorText}`);

            // Parse error for specific issues
            if (response.status === 401) {
                throw new Error(`DeepSeek API authentication failed (401). Your API key may be invalid or expired.`);
            }
            if (response.status === 402) {
                throw new Error(`DeepSeek API payment required (402). Your account balance may be insufficient.`);
            }
            if (response.status === 429) {
                throw new Error(`DeepSeek API rate limit exceeded (429). Please wait and try again.`);
            }

            throw new Error(`DeepSeek API error (${response.status}): ${errorText}`);
        }

        return response.json();
    } catch (error: any) {
        // Enhanced error logging for debugging
        console.error(`[DeepSeek Native] Request failed:`, error);
        console.error(`[DeepSeek Native] Error name: ${error.name}`);
        console.error(`[DeepSeek Native] Error message: ${error.message}`);
        console.error(`[DeepSeek Native] Error stack: ${error.stack}`);

        // Check for specific network errors
        if (error.message?.includes('Failed to fetch') || error.name === 'TypeError') {
            throw new Error(`DeepSeek connection failed (network error). Check your internet connection. Details: ${error.message}`);
        }
        throw error;
    }
};

// Create OpenAI-compatible client for browser (with CORS limitations)
const getClient = (): OpenAI => {
    if (!DEEPSEEK_API_KEY) throw new Error("DEEPSEEK_API_KEY is not set in environment");
    return new OpenAI({
        baseURL: DEEPSEEK_BASE_URL,
        apiKey: DEEPSEEK_API_KEY,
        dangerouslyAllowBrowser: true,
        timeout: 60000,
        maxRetries: 2,
    });
};

// Universal API call that uses native fetch in Capacitor, OpenAI SDK in browser
const callDeepSeek = async (
    modelName: string,
    messages: ChatCompletionMessageParam[],
    options: { response_format?: { type: string }; max_tokens?: number } = {}
): Promise<{ choices: Array<{ message: { content: string | null } }> }> => {
    if (isCapacitor()) {
        console.log('[DeepSeek] Using native HTTP (Capacitor)');
        return nativeDeepSeekCall(modelName, messages as any, options);
    } else {
        console.log('[DeepSeek] Using OpenAI SDK (Browser)');
        const client = getClient();
        return client.chat.completions.create({
            model: modelName,
            messages,
            ...options as any,
        });
    }
};

export const summarizeChartImage = async (image: File, chartNumber: number, modelName: string): Promise<{ uiSummary: string; fullSummary: string }> => {
    console.error("DeepSeek's summarizeChartImage was called, but this is incorrect. Vision models should be used for all image processing.");
    return Promise.resolve({
        uiSummary: `Chart ${chartNumber} | Error | N/A`,
        fullSummary: `Chart ${chartNumber} Analysis Error: DeepSeek does not support vision analysis. Please switch to a vision-capable model (Gemini, Zhipu, or Llama).`
    });
};

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
    if (images.length > 0) {
        throw new Error(`Image analysis is not supported for the DeepSeek provider in this app. Please switch to a vision-capable model.`);
    }

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

    // CRITICAL: Create Pattern Memory and Recent Insights contexts BEFORE systemPrompt
    // These must be defined first so they can be used in systemPrompt (matching Gemini/OpenRouter)
    const patternMemoryContext = finalTradeSummary
        ? `\n\n**📊 PATTERN MEMORY (SYNTHESIS) - MANDATORY REFERENCE:**\nThe following is a synthesis of your recent trading performance and patterns. You MUST reference this data for Section 4 (Pattern Matching):\n${finalTradeSummary}\n`
        : "\n\n**📊 PATTERN MEMORY:** No synthesis available yet.\n";

    // CRITICAL: Inject Recent Insights (Individual Trades) - Labeled to match UI
    const recentInsightsContext = recentInsights
        ? `\n\n**📊 RECENT INSIGHTS (INDIVIDUAL) - MANDATORY REFERENCE:**\nThe following are specific recent trades for detailed comparison:\n${recentInsights}\n`
        : "\n\n**📊 RECENT INSIGHTS:** No recent trade insights available.\n";

    const frameworksList = activeFrameworks.map((fw, index) => `${index + 1}. **${fw}**`).join('\n');
    const imageSummaryContext = imageSummaries.length > 0 ? `**VISION - DETAILED CHART ANALYSIS**...\n${imageSummaries.join('\n\n---\n\n')}` : "No chart data provided.";
    const deepAnalysisInstruction = deepenAnalysis ? `**DEEP ANALYSIS REQUIRED**...` : '';

    const userOverride = customInstructions
        ? `\n\n**USER BEHAVIOR OVERRIDE:**\nThe user has provided specific instructions for how you must respond, calculate, and reason. These instructions take precedence over default tone/style settings:\n"${customInstructions}"\n`
        : "";

    // Use LENS_MODE_BASE_PROMPT when rolePrompt is active, otherwise use full MASTER_ANALYSIS_PROMPT
    const basePrompt = rolePrompt ? LENS_MODE_BASE_PROMPT : MASTER_ANALYSIS_PROMPT;

    const systemPrompt = `${rolePrompt ? '🎭 **SPECIALIZED ANALYST ROLE ACTIVE**\n\n' + rolePrompt + '\n\n---\n\n' : ''}${basePrompt}

      ${userOverride}

      ${marketDataOverride}

      ${rolePrompt ? '' : DEVILS_ADVOCATE_PROMPT}

      ${rolePrompt ? '' : INVALIDATION_THESIS_PROMPT}

      ${rolePrompt ? '' : CORRELATION_AWARENESS_PROMPT}

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
      3. If R:R >= 1.2, proceed. Calculate and include the potential profit percentage for each Take Profit target.
      4. Calculate and include the potential loss percentage in the \`stopLossPercentage\` field.
      5. Extract the Coin Name (e.g. BTCUSDT, ETH, SOL) from the analysis.

      **SYNTHESIS & OUTPUT (STRICT JSON):**
      
      ${rolePrompt ? '' : `
      **FORMATTING RULE:** Your 'thoughtProcess' MUST follow the Structure of Sections 1-8. Use a numbered list (1-8) matching the MASTER PROMPT sections exactly (e.g. "1. Multi-Timeframe Structure...", "2. Price Action Type...", "7. Numeric Chart Analysis...", "8. Full Trade Setup...").
      `}

      Your entire response MUST be a single, valid JSON object with two top-level keys: "thoughtProcess" and "analysis". Adhere strictly to the provided JSON structure.
      ${rolePrompt ? '' : `
      - Put the full text output (Sections 1-8) into the "thoughtProcess" field.
      - Extract the trade details into the "analysis" field based on Section 7.
      `}

      **RESPONSE JSON Structure:**
      {
        "thoughtProcess": "Your detailed thought process string goes here (Sections 1-8)...",
        "analysis": {
            "coinName": "BTCUSDT", 
            "direction": "Long | Short", 
            "confidence": "High | Medium | Low | Avoid", 
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

    // Special handling for Live Market Data injection
    const isLiveMarketData = prompt.includes("**LIVE MARKET DATA**");
    const isHybridIntelligenceData = prompt.includes("HYBRID INTELLIGENCE") || prompt.includes("VERIFIED MARKET DATA");
    const formattedPrompt = (isLiveMarketData || isHybridIntelligenceData)
        ? `User's request:\n${prompt}\n\n`
        : `User's request: "${prompt}"\n\n`;

    // Use the patternMemoryContext and recentInsightsContext already defined above
    const userMessageText = `${formattedPrompt}${imageSummaryContext}\n\n${patternMemoryContext}\n\n${recentInsightsContext}\n\n${memoryContext}`;

    // Retry logic for transient connection errors
    let completion;
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            // Use native HTTP in Capacitor, OpenAI SDK in browser
            completion = await callDeepSeek(
                modelName,
                [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userMessageText }
                ],
                { response_format: { type: "json_object" }, max_tokens: 4096 }
            );
            break; // Success, exit retry loop
        } catch (error: any) {
            lastError = error;
            console.warn(`DeepSeek API attempt ${attempt} failed:`, error.message || error);

            // Don't retry on rate limits or auth errors
            if (error.status === 401 || error.status === 403 || error.message?.includes('401') || error.message?.includes('403')) {
                throw new Error(`DeepSeek authentication error: ${error.message}`);
            }
            if (error.status === 429 || error.message?.includes('429')) {
                throw new Error(`DeepSeek rate limit exceeded. Please wait and try again.`);
            }

            // Retry on connection/timeout errors
            if (attempt < 3) {
                await new Promise(resolve => setTimeout(resolve, 2000 * attempt)); // Exponential backoff
            }
        }
    }

    if (!completion) {
        throw new Error(`DeepSeek connection error after 3 attempts: ${lastError?.message || 'Unknown error'}`);
    }

    const responseText = completion.choices[0].message.content;
    if (!responseText) throw new Error("Received an empty response from the AI.");

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
        console.error("DeepSeek analysis JSON parsing failed:", error, "Response:", responseText);
        throw new Error("Failed to parse the trading analysis from the AI response.");
    }
};

export const getQuickResponse = async (prompt: string, history: Message[], modelName: string, systemInstruction?: string): Promise<string> => {
    const messages: ChatCompletionMessageParam[] = history.map(m => ({
        role: m.role === MessageRole.AI ? 'assistant' : 'user',
        content: m.text
    }));

    messages.unshift({ role: 'system', content: systemInstruction || 'You are a helpful and concise AI assistant specializing in futures trading concepts. Answer user questions clearly.' });
    messages.push({ role: 'user', content: prompt });

    const completion = await callDeepSeek(modelName, messages, { max_tokens: 1024 });
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
    const { correctedEntry, correctedStopLoss, correctedTakeProfit } = feedback;
    let analysisPrompt: string;

    const postTradeContext = postTradeImageSummaries && postTradeImageSummaries.length > 0 ? `**⚠️ VERIFIED TRADE OUTCOME DATA (HIGHEST PRIORITY):**\n---\n${postTradeImageSummaries.join('\n\n---\n\n')}\n---\n` : ``;
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
    const completion = await callDeepSeek(modelName, [{ role: 'user', content: analysisPrompt }]);
    return sanitizeAIResponse(completion.choices[0].message.content || "Post-mortem analysis failed.");
};

export const searchStrategies = async (query: string, activeFrameworks: string[], modelName: string): Promise<StrategySearchResult[]> => {
    const frameworksList = activeFrameworks.join(', ');
    const prompt = `You are a search engine for a predefined list of trading strategies. Your entire knowledge base is limited to ONLY the following frameworks: [${frameworksList}].
    
    The user is searching for: "${query}".

    Your task is to:
    1. Find the frameworks from your knowledge base that are the most relevant to the user's query.
    2. For each relevant framework, provide a concise description and rationale.
    3. If no frameworks are relevant, return an empty array.
    4. You are strictly forbidden from suggesting or describing any strategy that is not in the provided list.
    5. Your output must be a single, valid JSON array of objects with keys "name", "description", and "rationale".`;

    const completion = await callDeepSeek(
        modelName,
        [{ role: "user", content: prompt }],
        { response_format: { type: "json_object" } }
    );

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
        console.error("Failed to parse DeepSeek strategy search results:", e);
        return [];
    }
};

export const discoverStrategies = async (chatHistory: Message[], activeFrameworks: string[], modelName: string): Promise<StrategySearchResult[]> => {
    const frameworksList = activeFrameworks.join(', ');
    const historyText = chatHistory.length > 0
        ? chatHistory.slice(-5).map(m => `${m.role}: ${m.text} ${m.imageSummaries?.join('\n') || ''}`).join('\n\n')
        : '';

    const prompt = historyText
        ? `You are an AI assistant that suggests relevant trading strategies from a predefined list based on a conversation. Your entire knowledge base is limited to ONLY the following frameworks: [${frameworksList}].

          Here is the recent conversation history:
          ---
          ${historyText}
          ---

          Your task is to suggest up to 3 of the most relevant frameworks from your knowledge base.`
        : `You are an AI assistant that helps users explore their trading strategy playbook. Your entire knowledge base is limited to ONLY the following frameworks: [${frameworksList}].

          Your task is to pick 3 interesting, powerful, or complementary strategies from the list and provide a concise description and a rationale for why a trader might use it.`;

    const finalPrompt = `${prompt}
    
    You are strictly forbidden from suggesting any strategy that is not in the provided list. Your output must be a valid JSON array of objects with keys "name", "description", and "rationale".`;

    const completion = await callDeepSeek(
        modelName,
        [{ role: "user", content: finalPrompt }],
        { response_format: { type: "json_object" } }
    );

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
        console.error("Failed to parse DeepSeek strategy discovery results:", e);
        return [];
    }
};

export const getStrategyDescription = async (strategyName: string, modelName: string): Promise<string> => {
    const prompt = `Provide a concise, one-paragraph explanation of the "${strategyName}" trading strategy.`;
    const completion = await callDeepSeek(modelName, [{ role: 'user', content: prompt }]);
    return sanitizeAIResponse(completion.choices[0].message.content || "Failed to retrieve strategy description.");
};

export const summarizeTrade = async (trade: LoggedTrade, modelName: string): Promise<string> => {
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

    const completion = await callDeepSeek(modelName, [{ role: 'user', content: prompt }]);
    return sanitizeAIResponse(completion.choices[0].message.content || "Summary generation failed.");
};

export const generateFinalSummary = async (summaries: TradeSummary[], modelName: string, charLimit: number = 4000): Promise<string> => {
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

    const completion = await callDeepSeek(modelName, [{ role: 'user', content: prompt }]);
    return sanitizeAIResponse(completion.choices[0].message.content || "Final summary generation failed.");
};

// Memory compression for chat history
export const compressChatHistory = async (messages: Message[], currentSummary: string = ""): Promise<string> => {
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

    const completion = await callDeepSeek('deepseek-chat', [{ role: 'user', content: prompt }], { max_tokens: 2048 });
    return sanitizeAIResponse(completion.choices[0].message.content || "Memory compression failed.");
};

// Update global memory with trade insights
export const updateGlobalMemory = async (recentTrades: LoggedTrade[], currentMemory?: GlobalMemory): Promise<GlobalMemory> => {
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

    const completion = await callDeepSeek('deepseek-chat', [{ role: 'user', content: prompt }], { response_format: { type: 'json_object' }, max_tokens: 2048 });

    const responseText = completion.choices[0].message.content || "{}";
    try {
        return JSON.parse(responseText);
    } catch {
        console.error("DeepSeek updateGlobalMemory JSON parse failed:", responseText);
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
