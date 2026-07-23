// ... existing imports ...
import OpenAI from "openai";
import { Message, GroundingChunk, TradeAnalysis, GlobalMemory, AccuracySubMode, TradeOutcome } from '../../../../types';
import { extractAndParseJson } from '../../../../utils/jsonUtils';
import { sanitizeAIResponse } from '../../../../utils/sanitizers';
import { sanitizeTradeAnalysis, truncateTextToTokens } from '../../../../utils/analysisUtils';
import { ACCURACY_MODE_PROMPT, MASTER_ANALYSIS_PROMPT, PURE_AI_MODE_PROMPT, RISK_MANAGEMENT_RULES, TRADING_FAMILIES_PROMPT } from '../../../../constants/prompts';
import { constructOptimizedContext } from '../../../../utils/memoryUtils';
import { parseLiveMarketData } from '../../../../utils/liveMarketParser';

const GROQ_BASE_URL = 'https://api.groq.com/openai/v1/';

const getClient = (): OpenAI => {
    const GROQ_API_KEY = process.env.GROQ_API_KEY;
    if (!GROQ_API_KEY) throw new Error("GROQ_API_KEY is not set in environment");
    return new OpenAI({ baseURL: GROQ_BASE_URL, apiKey: GROQ_API_KEY, dangerouslyAllowBrowser: true });
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
    subMode: AccuracySubMode = 'original',
    customInstructions?: string,
    isPlaybookEnabledInPureAI?: boolean,
    isFamiliesEnabledInPureAI?: boolean,
    isMemoryEnabledInPureAI?: boolean
): Promise<{ analysis: TradeAnalysis; thoughtProcess: string; sources: GroundingChunk[] }> => {

    const groq = getClient();
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

        **ROLE:** Trend & Continuation Specialist (Pure Reasoning Mode).
        
        **SYNTHESIS & OUTPUT (STRICT JSON):**
        Your entire response MUST be a single, valid JSON object with two keys: "thoughtProcess" and "analysis".
        **Output ONLY valid JSON. No markdown.**`;
    } else {
        systemPrompt = `${ACCURACY_MODE_PROMPT}

        ${MASTER_ANALYSIS_PROMPT}

        ${visionDeepDive}

        ${userOverride}

        ${marketDataOverride}

        **CONTEXTUAL DATA:**
        **PLAYBOOK: CORE TRADING FRAMEWORKS**
        ${frameworksList}
        
        **CRITICAL: PATTERN MEMORY INTEGRATION**
        Use the **PATTERN MEMORY** and **RECENT INSIGHTS** provided below for user-specific patterns. Do NOT use Layer 3 Global Memory for past trade references.
        
        ${RISK_MANAGEMENT_RULES}

        **ROLE:** Continuation & Trend Specialist. Focus on EMA alignment, Trend strength, and Risk ratios.

        **SYNTHESIS & OUTPUT (STRICT JSON):**
        Your entire response MUST be a single, valid JSON object with two keys: "thoughtProcess" and "analysis".
        **Output ONLY valid JSON. No markdown.**`;
    }

    // Detect if Hybrid Intelligence data is present in the prompt
    const isHybridIntelligenceData = prompt.includes("HYBRID INTELLIGENCE") || prompt.includes("VERIFIED MARKET DATA");

    // Format prompt differently when Hybrid data is present - don't wrap in quotes
    const userPromptText = isHybridIntelligenceData
        ? `${prompt}\n\n${imageSummaryContext}\n\n${memoryContext}\n\nOUTPUT VALID JSON ONLY.`
        : `User's request: "${prompt}"\n\n${imageSummaryContext}\n\n${memoryContext}\n\nOUTPUT VALID JSON ONLY.`;

    // Use passed modelName
    const completion = await groq.chat.completions.create({
        model: modelName,
        messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPromptText }
        ],
        response_format: { type: "json_object" },
    });

    const responseText = completion.choices[0].message.content;
    if (!responseText) throw new Error("Received an empty response from the AI.");

    try {
        const responseJson = extractAndParseJson(responseText);
        const thoughtProcess = sanitizeAIResponse(responseJson.thoughtProcess || "No thought process provided.");
        let analysis: TradeAnalysis = sanitizeTradeAnalysis(responseJson.analysis);

        return { analysis, thoughtProcess, sources: [] };
    } catch (error) {
        console.error("Groq Accuracy Mode parsing failed:", error);
        throw new Error("Failed to parse the trading analysis from the AI response.");
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
    const groq = getClient();
    const { correctedEntry, correctedStopLoss, correctedTakeProfit } = feedback;
    let analysisPrompt: string;

    const postTradeContext = postTradeImageSummaries?.length ? `**⚠️ VERIFIED TRADE OUTCOME DATA (HIGHEST PRIORITY):**\n---\n${postTradeImageSummaries.join('\n\n---\n\n')}\n---\n` : '';
    const tradeHistoryContext = finalTradeSummary ? `**PATTERN MEMORY LIBRARY (Historical Context):**\n${truncateTextToTokens(finalTradeSummary)}` : "No past trades logged.";
    const groundingDirective = postTradeImageSummaries?.length ? `**CRITICAL DIRECTIVE:** The 'VERIFIED TRADE OUTCOME DATA' section above contains the **ACTUAL EXIT PRICE** where the trade closed (SL or TP hit). You MUST use this exact price for all P&L calculations and analysis.` : '';

    const learningDirective = `**PATTERN RECOGNITION (ACCURACY MODE):** You must consult the 'Pattern Memory Library'. Determine if the cause of this trade result aligns with a recurring pattern. If it does, emphasize this pattern.`;

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
    const completion = await groq.chat.completions.create({
        model: modelName,
        messages: [{ role: 'user', content: analysisPrompt }],
        max_tokens: 2048 // Increased to prevent cutoff
    });
    return sanitizeAIResponse(completion.choices[0].message.content || "Post-mortem analysis failed.");
};