
import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import { TradeAnalysis, AIProvider, Message, TradeOutcome, AccuracySubMode, LoggedTrade, AnalystLensConfig, AnalystRole } from '../types';
import { extractAndParseJson } from '../utils/jsonUtils';
import {
    MODERATOR_SYSTEM_PROMPT_V2,
    PURE_AI_MODERATOR_PROMPT,
    TRADING_FAMILIES_PROMPT,
    STRESS_TEST_PROTOCOL,
    DEVILS_ADVOCATE_PROMPT,
    ENHANCED_ACCURACY_VALIDATION_PROMPT,
    REGIME_TRADING_RULES,
    MODERATOR_VERIFICATION_ENFORCEMENT_PROMPT,
    POST_MORTEM_PATTERN_LEARNING_PROMPT,
    PROBABILITY_ESTIMATION_PROMPT,
    MODERATOR_FINAL_AUTHORITY_PROTOCOL
} from '../constants/prompts';
import { DUAL_SCENARIO_JSON_SCHEMA } from '../constants/schemas';
import { parseLiveMarketData } from '../utils/liveMarketParser';
import { truncateTextToTokens } from '../utils/analysisUtils';
import { generateEnhancedDebateContext, EnhancedDebateContext } from './EnhancedDebateService';
import { MarketRegime } from './TechnicalAnalysisService';
import {
    synthesizePatternMemory,
    generateSynthesizedPromptInjection,
    loadAttributedInsights,
    SetupContext,
    generatePatternMemoryEnforcementContext
} from './PatternMemorySynthesisService';
import {
    calculateConfluenceScore,
    generateConfluencePromptInjection,
    getConfluenceInsight,
} from './TimeframeConfluenceService';
import {
    checkTradeAgainstRules,
    addRulesFromPostMortem,
} from './InvalidationRuleService';
import {
    ANALYST_ROLE_DEFINITIONS,
    getRoleForProvider,
} from './AnalystLensService';
import { generateWeightedVotingContext } from './ModelPerformanceService';
import type { GateOutput } from './GateKeeperService';
import { getApiKey, getPreferenceObject, PREF_KEYS } from './PreferencesService';
import { getBayesianCalibratedConfidence, ConfidenceLevel } from './ConfidenceCalibrationService';
import { ConfidenceCalibration } from '../types';

// =============================================================================
// DUAL SCENARIO EVALUATION PROTOCOL
// =============================================================================

/**
 * Protocol that forces analysts to evaluate both bullish and bearish scenarios
 * before selecting a direction. This reduces directional bias and improves
 * decision transparency.
 */
const SCENARIO_EVALUATION_PROTOCOL = `
## ⚖️ MANDATORY DUAL SCENARIO EVALUATION PROTOCOL

**BEFORE selecting a direction, you MUST explicitly evaluate BOTH scenarios:**

### 📈 BULLISH SCENARIO
- **Trigger:** What level must price break ABOVE to confirm bullish?
- **Confirmation:** What candle close / volume spike validates this?
- **Primary Target:** Upside price target
- **Invalidation:** Where does this bullish thesis FAIL?

### 📉 BEARISH SCENARIO  
- **Trigger:** What level must price break BELOW to confirm bearish?
- **Confirmation:** What candle close / volume spike validates this?
- **Primary Target:** Downside price target
- **Invalidation:** Where does this bearish thesis FAIL?

### 🎯 DOMINANT SCENARIO SELECTION
After evaluating BOTH scenarios:
1. Compare evidence: Trend alignment, volume, Pattern Memory, Family classification
2. **Select ONE** as the trade plan with explicit reasoning
3. If neither dominates → Output "NEUTRAL / Wait for Breakout"

**MODERATOR ENFORCEMENT:**
- You MUST reject any final verdict that doesn't include BOTH scenarios with specific price levels
- The JSON output MUST include a "dualScenarioAnalysis" field with both scenarios

**OUTPUT FORMAT FOR dualScenarioAnalysis:**
\`\`\`json
\`\`\`json
${DUAL_SCENARIO_JSON_SCHEMA}
\`\`\`
\`\`\`
`;

// =============================================================================
// AI CORE SKILL SET — HIGH-ACCURACY MODE
// =============================================================================

/**
 * Core skill set injection that improves AI output quality by enforcing:
 * - Precision communication (no filler)
 * - Explicit unknown protocol (say "unknown" when unsure)
 * - Failure condition awareness (avoid common mistakes)
 * - Verification self-check (validate before output)
 */
const AI_CORE_SKILL_INJECTION = `
**🧠 AI CORE SKILL SET — HIGH-ACCURACY MODE**

**PRIMARY OBJECTIVE:** Produce the most accurate, useful, and high-quality output possible.
Accuracy and usefulness are ALWAYS more important than speed or verbosity.

---

**SKILL 1: PRECISION COMMUNICATION (MANDATORY)**
- Answer exactly what is asked — no unnecessary filler
- Use structured formatting ONLY when it improves clarity
- Prefer clarity over complexity
- Avoid repeating obvious or already-known information
- Every response must be directly usable and actionable

---

**SKILL 2: EXPLICIT UNKNOWN PROTOCOL (MANDATORY)**
When data is insufficient or confidence is low, you MUST explicitly state:
- "⚠️ UNKNOWN: [specific missing data]"
- "⚠️ INSUFFICIENT DATA: Cannot determine [X] because [reason]"
- "⚠️ LOW CONFIDENCE: [claim] is uncertain because [evidence gap]"

Do NOT guess or hallucinate. Say "unknown" when you don't know.

---

**SKILL 3: FAILURE CONDITION AWARENESS (MANDATORY)**
Before finalizing any output, verify you are NOT doing these:
- ❌ Confidently wrong answers (high confidence without evidence)
- ❌ Fabricated details (invented price levels, patterns, or data)
- ❌ Ignoring constraints (user rules, scope, mode restrictions)
- ❌ Over-verbosity without value (filler text, repetition)
- ❌ Providing solutions outside the requested scope

---

**SKILL 4: VERIFICATION SELF-CHECK (MANDATORY)**
Before finalizing your response:
1. Did I answer exactly what was asked?
2. Are all price levels, percentages, and claims verifiable?
3. Did I check Pattern Memory before making historical claims?
4. Is my confidence justified by the evidence presented?
5. Would I bet my own money on this output?

---

**FINAL RULE:** If forced to choose:
> Be correct, honest, and useful — even if the answer is incomplete.
`;

// =============================================================================
// GATE RECONCILIATION CONTEXT FOR MODERATOR
// =============================================================================

/**
 * Generate moderator context that asks the AI to reconcile its confidence with the Gate's cap.
 * This creates a dialectic where the AI must justify any deviation from the Gate's assessment.
 */
export const generateGateReconciliationContext = (
    gateResult: GateOutput | null,
    analystsResults: { analysis: TradeAnalysis, thoughtProcess: string }[]
): string => {
    if (!gateResult) return '';

    const capPercent = (gateResult.confidenceCap * 100).toFixed(0);
    const penalties = gateResult.confidencePenalties;

    // Check if any analyst exceeded the cap
    const exceedingAnalysts = analystsResults
        .map((r, i) => ({
            index: i,
            prob: r.analysis.probability || 0,
            conf: r.analysis.confidence
        }))
        .filter(a => a.prob > gateResult.confidenceCap * 100);

    let reconciliationBlock = `
**🚨 GATE SCAN RECONCILIATION (MANDATORY)**

The **Two-Stage Gate System** has analyzed this symbol BEFORE your analysis and determined:

**GATE ASSESSMENT:**
- **Confidence Cap:** ${capPercent}%
- **Status:** ${gateResult.pass ? 'PASSED' : 'BLOCKED'}
${gateResult.suggestedDirection ? `- **Pattern Memory Suggests:** ${gateResult.suggestedDirection}` : ''}

**PENALTY BREAKDOWN:**
${penalties.dataIntegrity > 0 ? `- Data Integrity: −${(penalties.dataIntegrity * 100).toFixed(0)}%` : ''}
${penalties.patternMemory > 0 ? `- Pattern Memory (similarity to past LOSSES): −${(penalties.patternMemory * 100).toFixed(0)}%` : ''}
${penalties.htfConflict > 0 ? `- HTF/LTF Conflict: −${(penalties.htfConflict * 100).toFixed(0)}%` : ''}
${penalties.volumeContext > 0 ? `- Volume Context: −${(penalties.volumeContext * 100).toFixed(0)}%` : ''}
- **Total Effective Penalty:** −${(penalties.effectiveTotal * 100).toFixed(0)}%

${gateResult.warnings.length > 0 ? `**GATE WARNINGS:**\n${gateResult.warnings.map(w => `⚠️ ${w}`).join('\n')}` : ''}
`;

    // If any analyst exceeded the cap, demand explanation
    if (exceedingAnalysts.length > 0) {
        reconciliationBlock += `
**⚠️ CONFIDENCE CONFLICT DETECTED:**

One or more analysts have output confidence HIGHER than the Gate's cap of ${capPercent}%.

**MODERATOR MUST ASK:**
1. "The Gate detected a ${(penalties.effectiveTotal * 100).toFixed(0)}% penalty based on data integrity, pattern memory similarity to losses, and market context. Why do you believe your confidence of ${exceedingAnalysts[0]?.prob}% is justified despite these warnings?"

2. "The Gate's Pattern Memory shows similarity to historical LOSING trades. What makes THIS setup different enough to warrant higher confidence?"

3. "Are you consciously overriding the Gate's assessment? If so, provide specific evidence that the Gate's penalty factors do NOT apply here."

**FINAL VERDICT RULE:**
- If the analyst provides COMPELLING evidence that overrides the Gate's concerns → Accept their confidence
- If the analyst cannot justify the deviation → Cap confidence at ${capPercent}%
- Document the reconciliation reasoning in the Final Verdict
`;
    } else {
        reconciliationBlock += `
**VALIDATION:**
All analyst confidence levels are within the Gate's cap of ${capPercent}%. No reconciliation required.
`;
    }

    // Add family bias if present
    if (gateResult.familyBias.reasoning.length > 0) {
        reconciliationBlock += `
**FAMILY BIAS FROM GATE:**
${gateResult.familyBias.A !== 0 ? `- Family A: ${gateResult.familyBias.A > 0 ? '+' : ''}${(gateResult.familyBias.A * 100).toFixed(0)}%` : ''}
${gateResult.familyBias.B !== 0 ? `- Family B: ${gateResult.familyBias.B > 0 ? '+' : ''}${(gateResult.familyBias.B * 100).toFixed(0)}%` : ''}
${gateResult.familyBias.C !== 0 ? `- Family C: ${gateResult.familyBias.C > 0 ? '+' : ''}${(gateResult.familyBias.C * 100).toFixed(0)}%` : ''}
${gateResult.familyBias.Omega !== 0 ? `- Family Ω: ${gateResult.familyBias.Omega > 0 ? '+' : ''}${(gateResult.familyBias.Omega * 100).toFixed(0)}%` : ''}
Reasoning: ${gateResult.familyBias.reasoning.slice(0, 2).join('; ')}
`;
    }

    return reconciliationBlock.trim();
};



const getGeminiClient = (): GoogleGenAI => {
    if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set in environment");
    return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
};

const getDeepSeekClient = (): OpenAI => {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) throw new Error("DEEPSEEK_API_KEY is not set in environment");
    return new OpenAI({ baseURL: 'https://api.deepseek.com', apiKey, dangerouslyAllowBrowser: true });
};

const getZhipuClient = (): OpenAI => {
    const apiKey = process.env.ZHIPU_API_KEY;
    if (!apiKey) throw new Error("Zhipu AI API key is missing.");
    return new OpenAI({ baseURL: 'https://open.bigmodel.cn/api/paas/v4/', apiKey, dangerouslyAllowBrowser: true });
};

const getGroqClient = (): OpenAI => {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error("GROQ_API_KEY is not set in environment");
    return new OpenAI({ baseURL: 'https://api.groq.com/openai/v1/', apiKey, dangerouslyAllowBrowser: true });
};

const getGroqNewClient = (): OpenAI => {
    const apiKey = process.env.GROQ_NEW_API_KEY;
    if (!apiKey) throw new Error("GROQ_NEW_API_KEY is not set in environment");
    return new OpenAI({ baseURL: 'https://api.groq.com/openai/v1/', apiKey, dangerouslyAllowBrowser: true });
};

const getGroqAlt2Client = (): OpenAI => {
    const apiKey = process.env.GROQ_ALT2_API_KEY;
    if (!apiKey) throw new Error("GROQ_ALT2_API_KEY is not set in environment");
    return new OpenAI({ baseURL: 'https://api.groq.com/openai/v1/', apiKey, dangerouslyAllowBrowser: true });
};

const getOpenrouterClient = (): OpenAI => {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set in environment");
    return new OpenAI({
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey,
        dangerouslyAllowBrowser: true,
        defaultHeaders: {
            "HTTP-Referer": typeof window !== 'undefined' ? window.location.origin : 'https://august.app',
            "X-Title": "August Trading Assistant"
        }
    });
};

const getOpenaiClient = async (): Promise<OpenAI> => {
    const apiKey = await getApiKey('openai');
    return new OpenAI({
        baseURL: 'https://api.openai.com/v1',
        apiKey,
        dangerouslyAllowBrowser: true,
    });
};

const getGrokClient = async (): Promise<OpenAI> => {
    const apiKey = await getApiKey('grok');
    return new OpenAI({
        baseURL: 'https://api.x.ai/v1',
        apiKey,
        dangerouslyAllowBrowser: true,
    });
};

const getModeratorClient = async (provider: AIProvider): Promise<OpenAI | GoogleGenAI> => {
    switch (provider) {
        case AIProvider.GEMINI: return getGeminiClient();
        case AIProvider.DEEPSEEK: return getDeepSeekClient();
        case AIProvider.ZHIPU: return getZhipuClient();
        case AIProvider.GROQ: return getGroqClient();
        case AIProvider.GROQ_NEW: return getGroqNewClient();
        case AIProvider.GROQ_ALT2: return getGroqAlt2Client();
        case AIProvider.OPENROUTER: return getOpenrouterClient();
        case AIProvider.OPENAI: return await getOpenaiClient();
        case AIProvider.GROK: return await getGrokClient();
        default: throw new Error(`Unsupported moderator provider: ${provider}`);
    }
};



// =============================================================================
// ANALYST LENS CONTEXT GENERATION
// =============================================================================

/**
 * Lens context verbosity levels for progressive retry
 */
export type LensVerbosity = 'full' | 'medium' | 'minimal';

/**
 * Generate moderator context for analyst lens roles.
 * Supports progressive verbosity: starts with full context, reduces on retry if JSON fails.
 * 
 * @param verbosity - 'full' (~100 lines), 'medium' (~40 lines), 'minimal' (~15 lines)
 * @param tradingStyle - 'swing' or 'scalp' to adjust questions appropriately
 */
export const generateLensContext = (
    analystNames: string[],
    analystProviders: AIProvider[],
    lensConfig?: AnalystLensConfig,
    verbosity: LensVerbosity = 'full',
    tradingStyle?: 'swing' | 'scalp' | 'position'
): string => {
    if (!lensConfig?.enabled || analystProviders.length === 0) {
        return '';
    }

    const roleLines: string[] = [];
    let macroAnalyst = '';
    let techAnalyst = '';
    let riskAnalyst = '';

    analystProviders.forEach((provider, index) => {
        const role = getRoleForProvider(provider, lensConfig.assignments);
        if (role !== AnalystRole.UNASSIGNED) {
            const def = ANALYST_ROLE_DEFINITIONS[role];
            const analystName = analystNames[index] || provider;
            roleLines.push(`- **${analystName}** → ${def.emoji} **${def.name}**: ${def.focus}`);

            if (role === AnalystRole.MACRO_VOLATILITY) macroAnalyst = analystName;
            if (role === AnalystRole.TECHNICAL_ANALYST) techAnalyst = analystName;
            if (role === AnalystRole.RISK_EXECUTION) riskAnalyst = analystName;
        }
    });

    if (roleLines.length === 0) {
        return '';
    }

    // Style-specific context
    const styleEmoji = tradingStyle === 'scalp' ? '⚡' : '🔄';
    const styleName = tradingStyle === 'scalp' ? 'SCALP' : 'SWING';
    const styleTimeframes = tradingStyle === 'scalp' ? '1m/5m/15m' : '15m/1H/4H/Daily';
    const styleMinRR = tradingStyle === 'scalp' ? '1.5:1' : '1.2:1';
    const styleSL = tradingStyle === 'scalp' ? '0.5-1x ATR (tight)' : '1-2x ATR (standard)';

    // MINIMAL: Bare essentials only (~15 lines)
    if (verbosity === 'minimal') {
        return `
**🎭 LENS MODE** ${styleEmoji} **${styleName}** | TFs: ${styleTimeframes} | Min R:R: ${styleMinRR}
Roles: ${macroAnalyst ? `🌊${macroAnalyst}` : ''} ${techAnalyst ? `📊${techAnalyst}` : ''} ${riskAnalyst ? `🛡️${riskAnalyst}` : ''}
⚠️ MANDATORY: Output complete JSON_PLAN with coinName, direction, entryPoints, stopLoss, takeProfit.
`;
    }

    // MEDIUM: Condensed (~40 lines)
    if (verbosity === 'medium') {
        return `
**🎭 ANALYST LENS MODE ACTIVE** ${styleEmoji} **${styleName} TRADING**

**TRADING STYLE:** ${styleName} MODE
- Timeframes: ${styleTimeframes}
- Min R:R Required: ${styleMinRR}
- Stop Loss: ${styleSL}

**ROLE ASSIGNMENTS:**
${roleLines.join('\n')}

**EVALUATION RULES:**
1. 🌊 ${macroAnalyst || 'Macro Analyst'}: Authoritative on TIMING, volatility regime, and session analysis
2. 📊 ${techAnalyst || 'Technical Analyst'}: Authoritative on PATTERNS, SMC levels, and entry zones  
3. 🛡️ ${riskAnalyst || 'Risk Analyst'}: Authoritative on R:R validation and FAILURE SCENARIOS

**STYLE-SPECIFIC QUESTIONS (ASK EACH ANALYST):**
${tradingStyle === 'scalp' ? `
${macroAnalyst ? `- 🌊 ${macroAnalyst}: "Is this a kill zone? What's the expected move duration for a quick scalp?"` : ''}
${techAnalyst ? `- 📊 ${techAnalyst}: "What's the LTF pattern? Is there a 1m/5m setup within the HTF structure?"` : ''}
${riskAnalyst ? `- 🛡️ ${riskAnalyst}: "Is R:R ≥1.5? Is the SL tight enough (≤1x ATR)? What's the max hold time?"` : ''}
` : `
${macroAnalyst ? `- 🌊 ${macroAnalyst}: "Is NOW the right time? What's the volatility regime and trend strength?"` : ''}
${techAnalyst ? `- 📊 ${techAnalyst}: "What pattern/Family are we trading? Where are SMC levels and invalidation?"` : ''}
${riskAnalyst ? `- 🛡️ ${riskAnalyst}: "What's the R:R? Top 3 failure scenarios? Can this trade run for hours/days?"` : ''}
`}

**CONFLICT RESOLUTION:**
- Direction conflicts → Weight Macro Analyst
- Entry level conflicts → Weight Risk Analyst
- Risk Grade D/F → Mark trade CONDITIONAL or AVOID

**MANDATORY:** After debate, you MUST output the complete JSON_PLAN block with all required trade details (coinName, direction, entryPoints, stopLoss, takeProfit, confidence, probability, strategy).
`;
    }

    // FULL: Complete detailed context (~100 lines)
    return `
**🎭 ANALYST LENS MODE ACTIVE — SPECIALIZED ROLE-BASED EVALUATION**
${styleEmoji} **TRADING STYLE: ${styleName}**

**STYLE PARAMETERS:**
- Focus Timeframes: ${styleTimeframes}
- Minimum R:R: ${styleMinRR}
- Stop Loss Range: ${styleSL}
- ${tradingStyle === 'scalp' ? 'Quick execution, don\'t overstay, target immediate moves' : 'Let trades develop, target swing moves with the trend'}

⚠️ **CRITICAL: You are moderating a ROLE-BASED ensemble where each analyst has a SPECIALIZED domain.**
Each analyst's output follows a STRUCTURED FORMAT specific to their role. You MUST evaluate each analyst according to their domain expertise.

**ROLE ASSIGNMENTS:**
${roleLines.join('\n')}

---

## 📊 NUMERIC CHART DATA (MANDATORY USAGE)
You have structured chart data for 15m/1h/4h timeframes. Each analyst MUST reference this data:

**🌊 Macro Analyst:** Use chart REGIME and TREND MATURITY to validate timing.
**📊 Technical Analyst:** Use chart PATTERNS and WICK BIAS to confirm structure.
**🛡️ Risk Analyst:** Use STATE CONFIDENCE and VOLUME TREND to grade risk.

**MANDATORY QUESTIONS USING CHART DATA:**
- "The 1H chart shows [regime] with [maturity] maturity. Is this early enough to enter?"
- "Wick bias is [direction] — does this support your direction thesis?"
- "State confidence is [X%]. Should we reduce position size if below 0.8?"

---

## 📋 ROLE-BASED EVALUATION PROTOCOL (MANDATORY)

### 🌊 MACRO ANALYST EVALUATION (${macroAnalyst || 'Assigned Analyst'})
Evaluate these sections from the Macro Analyst:
- **MACRO TREND ANALYSIS** — Multi-timeframe trend assessment
- **VOLATILITY REGIME** — ATR/volatility reflected in SL recommendations
- **LIQUIDITY MAP** — Liquidity sweep risks identified
- **MACRO RECOMMENDATION** — Is the macro bias justified?

**Key Question:** "Is NOW the right TIME to trade?"

### 📊 TECHNICAL ANALYST EVALUATION (${techAnalyst || 'Assigned Analyst'})
Evaluate these sections from the Technical Analyst:
- **PATTERN IDENTIFICATION** — Pattern correctly identified and classified
- **SMART MONEY CONCEPTS** — OBs, FVGs, and BOS properly mapped
- **INDICATOR DASHBOARD** — Multi-timeframe indicator alignment
- **TECHNICAL RECOMMENDATION** — Entry zone and invalidation justified

**Key Question:** "WHAT pattern are we trading and is it valid?"

### 🛡️ RISK SPECIALIST EVALUATION (${riskAnalyst || 'Assigned Analyst'})
Evaluate these sections from the Risk Specialist:
- **RISK/REWARD CALCULATOR** — Is the R:R ≥ 1.2?
- **ENTRY TIMING OPTIMIZATION** — LTF execution trigger identified
- **FAILURE SCENARIOS** — 3 failure paths identified
- **FINAL RISK RECOMMENDATION** — Risk Grade (A/B/C/D/F)

**Key Question:** "HOW do we execute safely and WHAT can go wrong?"


---

## 🎯 ROLE-SPECIFIC MANDATORY QUESTIONS

**You MUST ask each analyst these role-specific questions during the debate:**

${macroAnalyst ? `### 🌊 Questions for ${macroAnalyst} (Macro & Volatility):
${tradingStyle === 'scalp' ? `
1. "Is this a KILL ZONE? What session are we in and is volatility high enough for a quick scalp?"
2. "What's the expected DURATION of this move? Can we capture it in minutes, not hours?"
3. "Are we near any liquidity pools that could sweep us before the scalp completes?"
4. "What micro-session timing factors (news, session overlaps) could affect this 5-15 min trade?"
` : `
1. "Is NOW the right time to trade based on your macro analysis? What session are we in and is it favorable?"
2. "What is the volatility regime? Should we use a wider or tighter SL based on ATR?"
3. "Are there any liquidity zones that could trap this trade before it reaches targets?"
4. "What is your macro invalidation level? At what price does the macro thesis fail?"
`}` : ''}

${techAnalyst ? `### 📊 Questions for ${techAnalyst} (Technical):
${tradingStyle === 'scalp' ? `
1. "What's the LTF (1m/5m) pattern WITHIN the HTF structure? Is it aligned?"
2. "Where is the immediate OB/FVG for this scalp entry? Is there micro-structure confirmation?"
3. "Is there a CLEAR 5m/15m break of structure supporting this scalp direction?"
4. "What's the TIGHT invalidation level? Where does this LTF pattern fail?"
` : `
1. "What EXACT pattern are you trading? Which Family (A/B/C/Omega) does it belong to?"
2. "Where are the key SMC levels—Order Blocks, Fair Value Gaps, and Break of Structure?"
3. "What is the indicator confluence across 15m, 1H, and 4H timeframes?"
4. "What is the pattern invalidation level? Where does this pattern fail?"
`}` : ''}

${riskAnalyst ? `### 🛡️ Questions for ${riskAnalyst} (Risk & Execution):
${tradingStyle === 'scalp' ? `
1. "Show me the R:R calculation. Is it ≥1.5:1 for this scalp? Quick trades need higher R:R."
2. "Is the SL TIGHT enough (0.5-1x ATR)? Scalps can't afford wide stops."
3. "What's the MAX HOLD TIME for this scalp? When do we cut if it doesn't move?"
4. "What's the IMMEDIATE failure scenario in the next 5-15 candles?"
` : `
1. "Show me the R:R calculation. Is it ≥1.2:1? If not, should we adjust entry or skip?"
2. "What are the TOP 3 ways this trade can FAIL? Be specific with price levels."
3. "Is this a crowded trade? What does funding rate and L/S ratio tell us?"
4. "What is your final Risk Grade (A/B/C/D/F) and recommended position size?"
`}` : ''}

---

## ⚖️ SYNTHESIS RULES FOR LENS MODE

1. **Domain Authority:** Each analyst is authoritative ONLY in their domain
2. **Cross-Domain Conflicts:**
   - Macro vs Technical on DIRECTION → Weight Macro
   - Technical vs Risk on ENTRY LEVELS → Weight Risk
   - Risk Grade D or F → Trade is CONDITIONAL or AVOID

3. **Mandatory Risk Gate:**
   - Grade A–B: Full position
   - Grade C: Reduce size 25–50%
   - Grade D: Reduce size 50–75% or CONDITIONAL
   - Grade F: NO TRADE — Risk Specialist veto

---

## 🔴 QUALITY GATE — PERSISTENT QUESTIONING PROTOCOL

**YOU ARE THE SMARTEST ONE IN THE ROOM. DO NOT ACCEPT WEAK SETUPS.**

**If ANY of the following conditions are true, you MUST push back with follow-up questions:**

1. **Confidence is "Low" or "Medium"** → Ask: "What specific confluence would upgrade this to High confidence?"
2. **Risk Grade is C, D, or F** → Ask: "What would need to change for this to be a Grade A or B setup?"
3. **R:R is below minimum** → Ask: "Can we adjust entry or wait for better levels to improve R:R?"
4. **Analysts disagree on direction** → Ask both: "Justify your direction with specific price levels."
5. **No clear invalidation level** → Ask: "At exactly what price is this trade DEAD?"
6. **Pattern not clearly identified** → Ask: "What EXACT pattern from which Family? Show the structure."

**KEEP ASKING UNTIL:**
- Confidence is HIGH
- Risk Grade is A or B
- R:R meets minimum (${styleMinRR} for ${styleName})
- Clear invalidation level is stated
- Pattern is clearly identified with Family classification

**IF SETUP CANNOT BE UPGRADED:**
Mark as **"AVOID"** or **"CONDITIONAL — Wait for [specific condition]"**

---

## 🔒 STRICT QUALITY GATE (MODERATOR ENFORCEMENT)

You are the **FINAL GATEKEEPER**. Your job is to ensure ONLY the best possible setup is produced.

**AUTOMATIC REJECTION TRIGGERS:**
- ❌ Any analyst provides vague price levels ("around $X", "near support")
- ❌ R:R ratio is not explicitly calculated with numbers
- ❌ Pattern Memory was not referenced (missing "📚 PATTERN MEMORY CHECK")
- ❌ Confidence is "High" but no Pattern Memory evidence supports it
- ❌ Analysts agree too easily without citing evidence (Echo Chamber)
- ❌ Key levels or invalidation points are missing

**MANDATORY CHALLENGES FROM MODERATOR:**
When you detect weak analysis, you MUST challenge:
1. "PROVE IT: Cite the exact Pattern Memory entry that supports this claim."
2. "JUSTIFY: Why is this R:R acceptable given the historical win rate?"
3. "DEFEND: Another analyst challenged your [claim]. Respond with evidence or revise."
4. "VERIFY: What is the EXACT price for entry/SL/TP? No ranges allowed."

---

## 🎯 ROLE-SPECIFIC MODERATOR QUESTIONS

After each analyst presents, you MUST ask their role-specific question:

**MACRO & VOLATILITY ANALYST (${macroAnalyst}):**
> "What specific macro event or volatility regime supports your timing? Why is NOW the right moment, and why not wait for clearer confirmation?"

**TECHNICAL ANALYST (${techAnalyst}):**
> "What EXACT pattern and Family classification are you trading? Why is this structure valid on THIS timeframe, and why not a lower-probability alternative?"

**RISK & EXECUTION SPECIALIST (${riskAnalyst}):**
> "What is the precise R:R ratio and Risk Grade? Why is this acceptable given Pattern Memory outcomes, and why not reduce size or pass?"

---

## 🔥 POST-PRESENTATION CHALLENGE PROTOCOL

After EVERY analyst presentation, apply this two-part challenge:

1. **"WHY?"** — "Justify your primary claim with specific, verifiable evidence."
2. **"WHY NOT?"** — "Why is the OPPOSITE bias (Long→Short or Short→Long) NOT valid here? What would invalidate your thesis?"

**The analyst MUST answer BOTH questions before proceeding.**

---

## ⚔️ ANALYST INTERVENTION RULE

If ANY analyst believes the moderator made a flawed judgment or prematurely accepted weak evidence, that analyst MUST intervene:

> "⚠️ INTERVENTION: I challenge the moderator's conclusion because [specific reason]. Evidence: [cite Pattern Memory entry or exact price level]. The moderator should reconsider before finalizing."

**The moderator MUST address interventions before issuing the final verdict.**

---

## 🛡️ RIGOROUS DEFENSE REQUIREMENT

All parties (moderator AND analysts) MUST defend their positions until:
- Consensus is evidence-based (not assumption-based)
- All disagreements are resolved with data
- The BEST possible setup emerges

**If defense fails:**
- Downgrade confidence by one level
- If still undefended → Mark as "AVOID - Insufficient Evidence"

**PATTERN MEMORY ENFORCEMENT:**
- Each analyst MUST include: "📚 PATTERN MEMORY CHECK: [Found/Not Found] similar setup"
- If found: "Historical outcome: [X wins / Y losses]"
- If NOT referenced: **Demand it before proceeding**

**FINAL VERDICT RULES:**
- If ANY analyst cannot defend their claim when challenged → Downgrade confidence
- If Pattern Memory shows losses for similar setups → Mark as "CONDITIONAL"
- If debate quality is low (vague answers, no citations) → Output "AVOID - Insufficient Evidence"
- Only output HIGH confidence if ALL analysts agree with evidence

---

## 🎯 LENS MODE FINAL VERDICT FORMAT

Your verdict MUST address all three domains:

**MACRO CHECK (${macroAnalyst}):** Macro Bias, Volatility Regime, Timing
**TECHNICAL CHECK (${techAnalyst}):** Pattern, Family, Entry Zone, Invalidation
**RISK CHECK (${riskAnalyst}):** R:R, Risk Grade, Failure Scenarios, Position Size

**FINAL DECISION:** [Synthesized verdict]

---

⚠️ **CRITICAL REMINDER:** After the debate, you MUST output a complete <JSON_PLAN> block with:
coinName, direction, entryPoints, stopLoss, takeProfit, confidence, probability, strategy, marketConditions, detectedPatternFamily, keyLevels
`;
};

// =============================================================================
// PRE-DEBATE DIVERGENCE CHECK & ECHO CHAMBER PREVENTION
// =============================================================================

/**
 * Result of pre-debate divergence analysis
 */
export interface DivergenceAnalysis {
    score: number; // 0-100: 0 = complete agreement, 100 = total disagreement
    isEchoChamber: boolean; // True if all analysts agree too quickly
    divergenceType: 'none' | 'direction' | 'confidence' | 'entry' | 'multiple';
    details: string[];
    syntheticDissentRequired: boolean;
    dissentProtocol: string;
}

/**
 * Analyze analyst results before debate to detect echo chambers and calculate divergence.
 * Returns a divergence score and recommended actions for the moderator.
 */
export const analyzePreDebateDivergence = (
    analystsResults: { analysis: TradeAnalysis, thoughtProcess: string }[],
    analystNames: string[]
): DivergenceAnalysis => {
    if (analystsResults.length < 2) {
        return {
            score: 0,
            isEchoChamber: false,
            divergenceType: 'none',
            details: [],
            syntheticDissentRequired: false,
            dissentProtocol: ''
        };
    }

    const details: string[] = [];
    let divergenceScore = 0;
    let divergenceType: DivergenceAnalysis['divergenceType'] = 'none';

    // Check 1: Direction Agreement
    const directions = analystsResults.map(r => r.analysis.direction?.toLowerCase() || 'unknown');
    const uniqueDirections = new Set(directions);
    if (uniqueDirections.size === 1) {
        details.push(`All analysts agree on direction: ${directions[0].toUpperCase()} `);
    } else {
        divergenceScore += 40;
        divergenceType = 'direction';
        details.push(`Direction disagreement: ${directions.join(' vs ')} `);
    }

    // Check 2: Confidence Level Agreement
    const confidences = analystsResults.map(r => r.analysis.confidence?.toLowerCase() || 'medium');
    const uniqueConfidences = new Set(confidences);
    if (uniqueConfidences.size === 1) {
        details.push(`All analysts have ${confidences[0]} confidence`);
    } else {
        divergenceScore += 20;
        if (divergenceType === 'none') divergenceType = 'confidence';
        else divergenceType = 'multiple';
        details.push(`Confidence spread: ${confidences.join(' vs ')} `);
    }

    // Check 3: Entry Price Divergence
    const entries = analystsResults
        .map(r => {
            const entry = r.analysis.entryPoints?.[0]?.price;
            return typeof entry === 'string' ? parseFloat(entry.replace(/[^0-9.]/g, '')) : entry;
        })
        .filter(e => !isNaN(e)) as number[];

    if (entries.length >= 2) {
        const maxEntry = Math.max(...entries);
        const minEntry = Math.min(...entries);
        const entrySpread = maxEntry > 0 ? ((maxEntry - minEntry) / maxEntry) * 100 : 0;

        if (entrySpread > 2) {
            divergenceScore += 25;
            if (divergenceType === 'none') divergenceType = 'entry';
            else divergenceType = 'multiple';
            details.push(`Entry price divergence: ${entrySpread.toFixed(1)}% spread`);
        } else {
            details.push(`Entry prices aligned(within ${entrySpread.toFixed(1)} %)`);
        }
    }

    // Check 4: Probability/Confidence Score Divergence
    const probabilities = analystsResults
        .map(r => r.analysis.probability)
        .filter(p => typeof p === 'number' && !isNaN(p)) as number[];

    if (probabilities.length >= 2) {
        const maxProb = Math.max(...probabilities);
        const minProb = Math.min(...probabilities);
        const probSpread = maxProb - minProb;

        if (probSpread > 20) {
            divergenceScore += 15;
            details.push(`Probability spread: ${minProb}% - ${maxProb}% (${probSpread}pt gap)`);
        }
    }

    // Determine if echo chamber
    const isEchoChamber = divergenceScore < 15;
    const syntheticDissentRequired = isEchoChamber;

    // Generate dissent protocol if needed
    let dissentProtocol = '';
    if (syntheticDissentRequired) {
        const direction = directions[0];
        const oppositeDirection = direction === 'long' ? 'SHORT' : direction === 'short' ? 'LONG' : 'OPPOSITE';

        dissentProtocol = `
        **🚨 ECHO CHAMBER DETECTED - SYNTHETIC DISSENT PROTOCOL ACTIVATED **

            All analysts appear to agree on the trade setup.This is a high - risk scenario where groupthink can lead to blindspots.

** MANDATORY DEVIL'S ADVOCATE ROUND:**
Before proceeding to the final verdict, the moderator MUST:

    1. ** Force Failure Scenario Analysis **: Demand each analyst articulate the #1 reason this trade could FAIL.
2. ** Invert the Thesis **: Ask: "What would need to happen for a ${oppositeDirection} trade to be the correct call instead?"
    3. ** Historical Pattern Check **: Are there Pattern Memory entries where similar unanimous consensus led to losses ?
        4. ** Black Swan Scan **: What macro event(news, liquidation cascade, whale movement) could invalidate this setup in the next 24h ?

** If analysts cannot provide compelling counter - arguments, mark the trade as "HIGH CONVICTION BUT VERIFY" and recommend reduced position size.**
        `;
    }

    return {
        score: Math.min(divergenceScore, 100),
        isEchoChamber,
        divergenceType,
        details,
        syntheticDissentRequired,
        dissentProtocol
    };
};

/**
 * Generate a concise divergence summary for the moderator prompt.
 */
export const generateDivergenceContext = (
    analystsResults: { analysis: TradeAnalysis, thoughtProcess: string }[],
    analystNames: string[]
): string => {
    const analysis = analyzePreDebateDivergence(analystsResults, analystNames);

    if (analysis.score === 0 && !analysis.isEchoChamber) {
        return '';
    }

    let context = `
        **🔍 PRE - DEBATE DIVERGENCE ANALYSIS **

            Divergence Score: ${analysis.score}/100 ${analysis.isEchoChamber ? '⚠️ LOW (Echo Chamber Risk)' : analysis.score > 50 ? '🔥 HIGH' : '➡️ MODERATE'}

${analysis.details.map(d => `- ${d}`).join('\n')}
    `;

    if (analysis.dissentProtocol) {
        context += '\n' + analysis.dissentProtocol;
    }

    return context.trim();
};

const getModeratorAnalysisStream = async function* (provider: AIProvider, model: string, prompt: string): AsyncGenerator<string> {

    const client = await getModeratorClient(provider);

    if (client instanceof GoogleGenAI) {
        try {
            const response = await client.models.generateContentStream({ model, contents: { parts: [{ text: prompt }] } });
            for await (const chunk of response) {
                let text = '';
                if (chunk.candidates && chunk.candidates[0] && chunk.candidates[0].content && chunk.candidates[0].content.parts) {
                    for (const part of chunk.candidates[0].content.parts) {
                        if (part.text) {
                            text += part.text;
                        }
                    }
                }
                if (text) {
                    yield text;
                }
            }
        } catch (e: any) {
            console.error("Accuracy Moderator stream error (Gemini):", e);
            // For rate limit errors, throw to be handled by outer catch block
            if (e.status === 429 || e.message?.includes('429') || e.message?.includes('Rate limit')) {
                throw e;
            }
            // For other errors, yield an error marker that App.tsx can detect
            yield `\n<MODERATOR_ERROR>${e.message}</MODERATOR_ERROR>\n`;
        }
    } else if (client instanceof OpenAI) {
        try {
            // System message helps OpenRouter free models follow complex instructions
            const systemMessage = `You are an expert trading debate moderator. Your PRIMARY OBJECTIVE is to extract concrete trade values from the analysts' discussion.

CRITICAL RULES:
1. ALWAYS provide specific numeric prices for Entry, Stop Loss, and Take Profit - NEVER output "N/A" or "Not Available"
2. If analysts provide prices in their analysis, USE THOSE EXACT PRICES
3. If prices are unclear, ESTIMATE based on the discussion context
4. The JSON_PLAN must contain real price values, not placeholders
5. Every trade setup needs: direction, entry price, stop loss price, take profit price(s)

You must complete the ENTIRE response including the JSON_PLAN block at the end.`;

            const stream = await client.chat.completions.create({
                model: model,
                messages: [
                    { role: 'system', content: systemMessage },
                    { role: 'user', content: prompt }
                ],
                stream: true,
                temperature: 0.1 // Low temperature for strict instruction following
            });
            for await (const chunk of stream) {
                yield chunk.choices[0]?.delta?.content || "";
            }
        } catch (e: any) {
            console.error("Accuracy Moderator stream error (OpenAI/Compat):", e);
            // For rate limit errors, throw to be handled by outer catch block
            if (e.status === 429 || e.message?.includes('429') || e.message?.includes('Rate limit')) {
                throw e;
            }
            // For other errors, yield an error marker that App.tsx can detect
            yield `\n<MODERATOR_ERROR>${e.message}</MODERATOR_ERROR>\n`;
        }
    } else {
        throw new Error("Invalid moderator client type.");
    }
};

export const conductDebate = (
    analystsResults: { analysis: TradeAnalysis, thoughtProcess: string }[],
    analystNames: string[],
    userPrompt: string,
    finalTradeSummary: string | null,
    subMode: AccuracySubMode = 'original',
    customInstructions?: string,
    moderatorProvider: AIProvider = AIProvider.GROQ,
    moderatorModel: string = 'moonshotai/kimi-k2-instruct-0905',
    isFamiliesEnabledInPureAI?: boolean,
    isMemoryEnabledInPureAI?: boolean,
    gateResult?: GateOutput | null, // Gate result for reconciliation
    tradeSummaries?: { id: string; summaryText: string; timestamp: string }[], // Recent Insights
    learningContext?: string // NEW: Unified learning context from UnifiedLearningBuilder
): AsyncGenerator<string, void, unknown> => {

    let tradeHistoryContext = finalTradeSummary ? `Pattern Memory Library (History):\n${truncateTextToTokens(finalTradeSummary, 3000)}` : "No past trades logged.";

    // Logic to disable memory context in Pure AI mode if toggle is off
    if (subMode === 'pure_ai' && !isMemoryEnabledInPureAI) {
        tradeHistoryContext = "Pattern Memory is DISABLED for this Pure AI session. Rely only on provided market data.";
    }

    // --- LIVE MARKET DATA PARSING & INJECTION ---
    const parsedMarketData = parseLiveMarketData(userPrompt);
    let marketDataOverride = "";
    if (parsedMarketData) {
        // Safe stringify with limit
        const safePrices = JSON.stringify(parsedMarketData.prices).slice(0, 1000);
        const safePatterns = JSON.stringify(parsedMarketData.patterns).slice(0, 1000);
        const safeZones = JSON.stringify(parsedMarketData.keyZones).slice(0, 1000);

        marketDataOverride = `
    **VERIFIED LIVE MARKET TELEMETRY (HIGHEST PRIORITY):**
    You MUST incorporate this exact data into your Final Verdict and JSON Output.
    
    - **Prices:** ${safePrices}
    - **Detected Patterns:** ${safePatterns}
    - **Key Zones:** ${safeZones}
        `;
    }
    // --------------------------------------------

    const userOverride = customInstructions
        ? `\n\n**USER BEHAVIOR OVERRIDE:**\nThe user has provided specific instructions for how you must respond, calculate, and reason. These instructions take precedence over default tone/style settings:\n"${truncateTextToTokens(customInstructions, 500)}"\n`
        : "";

    let analystsInput = "";
    analystsResults.forEach((res, index) => {
        analystsInput += `\n**${analystNames[index].toUpperCase()} INITIAL ANALYSIS**:\n${truncateTextToTokens(JSON.stringify(res.analysis), 800)}\n`;
    });

    // Dynamic Construction of Dialogue Instructions based on active analysts
    let dialogueInstructions = "";
    analystNames.forEach(name => {
        dialogueInstructions += `   - **${name}:** [Analysis based on role]\n`;
    });

    let systemPrompt = "";
    if (subMode === 'pure_ai') {
        systemPrompt = PURE_AI_MODERATOR_PROMPT;

        if (isFamiliesEnabledInPureAI) {
            systemPrompt += `\n\n**IMPORTANT EXCEPTION:**\nThe user has explicitly ENABLED "Market Classification Families" for this Pure AI session.\nEven though this is Pure AI mode, you MUST classify the final trade setup into one of the following Families:\n${TRADING_FAMILIES_PROMPT}\nEnsure the JSON output's 'detectedPatternFamily' field is set to 'Family A', 'Family B', 'Family C', or 'Family Omega'.\n`;
        }
    } else {
        systemPrompt = MODERATOR_SYSTEM_PROMPT_V2;
    }

    // Replace placeholders
    systemPrompt = systemPrompt.replace('{{ANALYSTS}}', analystNames.join(', '));
    systemPrompt = systemPrompt.replace('{{DIALOGUE_INSTRUCTIONS}}', dialogueInstructions);

    // --- GATE RECONCILIATION CONTEXT ---
    const gateReconciliationContext = gateResult
        ? generateGateReconciliationContext(gateResult, analystsResults)
        : '';

    // --- RECENT INSIGHTS FOR PATTERN MATCHING ---
    let recentInsightsBlock = '';
    if (tradeSummaries && tradeSummaries.length > 0) {
        const top5 = tradeSummaries.slice(0, 5);
        recentInsightsBlock = `\n**RECENT INSIGHTS FOR PATTERN MATCHING (Top ${top5.length}):**\n`;
        top5.forEach((insight, idx) => {
            const date = new Date(insight.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            recentInsightsBlock += `${idx + 1}. [${date}] ${insight.summaryText.slice(0, 200)}...\n`;
        });
        recentInsightsBlock += `\n**INSTRUCTION:** Compare the current setup to these recent trades. Identify the top 3 most similar trades and discuss their outcomes.\n`;
    }

    const safeUserPrompt = truncateTextToTokens(userPrompt, 1500);

    const finalPrompt = `
${systemPrompt}

${userOverride}

${marketDataOverride}

${gateReconciliationContext}

${AI_CORE_SKILL_INJECTION}

${POST_MORTEM_PATTERN_LEARNING_PROMPT}

${PROBABILITY_ESTIMATION_PROMPT}

${learningContext || ''}

${STRESS_TEST_PROTOCOL}

**SIMULATION INPUT DATA:**
User Request: "${safeUserPrompt}"
Global History: ${tradeHistoryContext}

${recentInsightsBlock}

${analystsInput}

**ACTION:**
Start the simulation now. Begin with <DEBATE_START>.
`;

    return getModeratorAnalysisStream(moderatorProvider, moderatorModel, finalPrompt);
};

/**
 * Sanitizes the analyst output to ensure no internal thought process or hidden fields are leaked to the moderator.
 * This enforces "Context Isolation" where the moderator only sees the final, public proposal.
 */
const sanitizeAnalystOutput = (analysis: TradeAnalysis): TradeAnalysis => {
    return {
        coinName: analysis.coinName,
        direction: analysis.direction,
        entryPoints: analysis.entryPoints,
        stopLoss: analysis.stopLoss,
        takeProfit: analysis.takeProfit,
        confidence: analysis.confidence,
        probability: analysis.probability,
        strategy: analysis.strategy,
        marketConditions: analysis.marketConditions,
        detectedPatternFamily: analysis.detectedPatternFamily,
        detectedPatterns: analysis.detectedPatterns,
        keyLevels: analysis.keyLevels,
        validityDurationMinutes: analysis.validityDurationMinutes,
        rrRatio: analysis.rrRatio
    } as TradeAnalysis;
};


export const conductTwoWayDebate = async function* (
    analyst1Result: { analysis: TradeAnalysis, thoughtProcess: string },
    analyst2Result: { analysis: TradeAnalysis, thoughtProcess: string },
    analyst1Name: string,
    analyst2Name: string,
    userPrompt: string,
    finalTradeSummary: string | null,
    moderatorProvider: AIProvider,
    moderatorModel: string,
    customInstructions?: string,
    monteCarloResults?: { provider: string, result: any }[],
    lensConfig?: AnalystLensConfig,
    analystProviders?: AIProvider[],
    activeFrameworks?: string[],
    tradeSummaries?: { id: string; summaryText: string; timestamp: string }[],
    gateResult?: GateOutput | null, // Gate result for reconciliation
    learningContext?: string // NEW: Unified learning context
): AsyncGenerator<string, void, unknown> {

    // Format Monte Carlo context
    // ... (code truncated - I will rely on context matching to only replace the signature and return)
    // Actually I need to be precise. I will target the signature and the return statement separately.


    // Format Monte Carlo context
    let mcContext = "No Monte Carlo simulation data available.";
    if (monteCarloResults && monteCarloResults.length > 0) {
        mcContext = "**MONTE CARLO STATISTICAL VALIDATION:**\n";
        monteCarloResults.forEach(mc => {
            if (mc.result) {
                mcContext += `- ${mc.provider}: Win Rate ${mc.result.winRate}%, EV ${mc.result.expectedValue}R, Max DD ${mc.result.maxDrawdownAvg}%\n`;
            }
        });
    }

    const tradeHistoryContext = finalTradeSummary ? `This is your Pattern Memory Library (a pre-processed summary of recent trades)...\n${truncateTextToTokens(finalTradeSummary, 3000)}` : "No past trades logged.";

    // --- BAYESIAN CONFIDENCE CALIBRATION ---
    // Fetch historical calibration data to adjust confidence scores
    let calibrationData: ConfidenceCalibration | null = null;
    try {
        calibrationData = await getPreferenceObject<ConfidenceCalibration>(PREF_KEYS.CONFIDENCE_CALIBRATION);
    } catch (e) {
        console.warn('Failed to load calibration data:', e);
    }

    // Apply calibration to analyst results
    const calibratedAnalysts = [
        { name: analyst1Name, result: analyst1Result },
        { name: analyst2Name, result: analyst2Result }
    ].map(item => {
        const rawConf = item.result.analysis.confidence as ConfidenceLevel;
        const rawProb = item.result.analysis.probability || 0;

        let calibratedProb = rawProb;
        let calibrationNote = "";

        if (calibrationData) {
            calibratedProb = getBayesianCalibratedConfidence(
                calibrationData,
                item.name, // Provider/Analyst name
                rawConf,
                rawProb
            );

            if (Math.abs(calibratedProb - rawProb) > 5) {
                calibrationNote = `(Bayesian Calibrated: ${calibratedProb}% based on history)`;
            }
        }

        return {
            ...item,
            calibratedProb,
            calibrationNote
        };
    });


    // --- RECENT INSIGHTS FOR PATTERN MATCHING ---
    let recentInsightsBlock = '';
    if (tradeSummaries && tradeSummaries.length > 0) {
        const top5 = tradeSummaries.slice(0, 5);
        recentInsightsBlock = `\n**RECENT INSIGHTS FOR PATTERN MATCHING (Top ${top5.length}):**\n`;
        top5.forEach((insight, idx) => {
            const date = new Date(insight.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            recentInsightsBlock += `${idx + 1}. [${date}] ${insight.summaryText.slice(0, 200)}...\n`;
        });
        recentInsightsBlock += `\n**INSTRUCTION:** Compare the current setup to these recent trades. Identify the top 3 most similar trades and discuss their outcomes.\n`;
    }

    // --- LIVE MARKET DATA PARSING & INJECTION ---
    const parsedMarketData = parseLiveMarketData(userPrompt);
    let marketDataOverride = "";
    if (parsedMarketData) {
        const safePrices = JSON.stringify(parsedMarketData.prices).slice(0, 1000);
        const safePatterns = JSON.stringify(parsedMarketData.patterns).slice(0, 1000);
        const safeZones = JSON.stringify(parsedMarketData.keyZones).slice(0, 1000);

        const playbookList = activeFrameworks && activeFrameworks.length > 0
            ? activeFrameworks.slice(0, 10).join(', ')
            : 'No active playbook';

        marketDataOverride = `
    **VERIFIED LIVE MARKET TELEMETRY (HIGHEST PRIORITY):**
    You MUST incorporate this exact data into your Final Verdict and JSON Output.
    
    - **Prices:** ${safePrices}
    - **Detected Patterns:** ${safePatterns}
    - **Key Zones:** ${safeZones}
    - **Active Playbook/Strategies:** ${playbookList}
        `;
    }
    // --------------------------------------------

    const userOverride = customInstructions
        ? `\n\n**USER BEHAVIOR OVERRIDE:**\nThe user has provided specific instructions for how you must respond, calculate, and reason. These instructions take precedence over default tone/style settings:\n"${truncateTextToTokens(customInstructions, 500)}"\n`
        : "";

    // --- CONFLUENCE SCORING ---
    let confluenceContext = '';
    const primaryDirection = analyst1Result.analysis.direction as 'Long' | 'Short' | 'Neutral';
    if (primaryDirection && primaryDirection !== 'Neutral') {
        try {
            const confluenceScore = calculateConfluenceScore(analyst1Result.analysis, primaryDirection);
            confluenceContext = generateConfluencePromptInjection(confluenceScore);
            const historicalInsight = getConfluenceInsight(confluenceScore.score);
            if (historicalInsight) confluenceContext += '\n' + historicalInsight;
            console.log('[TwoWayDebate][Confluence] Score:', confluenceScore.score);
        } catch (e) {
            console.error('[TwoWayDebate][Confluence] Error:', e);
        }
    }

    // --- RULE VIOLATION CHECKING ---
    let ruleViolationContext = '';
    try {
        const ruleCheck = checkTradeAgainstRules(analyst1Result.analysis);
        if (ruleCheck.violations.length > 0) {
            ruleViolationContext = ruleCheck.promptInjection;
            console.log('[TwoWayDebate][Rules] Found', ruleCheck.violations.length, 'violations');
        }
    } catch (e) {
        console.error('[TwoWayDebate][Rules] Error:', e);
    }

    // --- ANALYST LENS CONTEXT ---
    // Using 'medium' verbosity by default to prevent token overflow causing JSON parsing failures
    const effectiveTradingStyle = lensConfig?.tradingStyle === 'auto' ? 'swing' : (lensConfig?.tradingStyle || 'swing');
    const lensContext = generateLensContext(
        [analyst1Name, analyst2Name],
        analystProviders || [],
        lensConfig,
        'medium', // Use medium verbosity to balance detail vs token limits
        effectiveTradingStyle as 'swing' | 'scalp'
    );

    // --- GATE RECONCILIATION CONTEXT ---
    // If Gate result is provided, generate context that forces moderator to reconcile confidence differences
    const gateReconciliationContext = gateResult
        ? generateGateReconciliationContext(gateResult, [analyst1Result, analyst2Result])
        : '';

    const moderatorSystemPrompt = `You are a Master Strategist moderating a high-stakes trading debate between ${analyst1Name} and ${analyst2Name}.


      ${userOverride}

      ${lensContext}

      ${marketDataOverride}

      ${confluenceContext}

      ${ruleViolationContext}

      ${gateReconciliationContext}

      ${AI_CORE_SKILL_INJECTION}

      ${POST_MORTEM_PATTERN_LEARNING_PROMPT}

      ${learningContext || ''}

      ${STRESS_TEST_PROTOCOL}

      ${SCENARIO_EVALUATION_PROTOCOL}

      ${MODERATOR_VERIFICATION_ENFORCEMENT_PROMPT}

      ${PROBABILITY_ESTIMATION_PROMPT}

      **OBJECTIVE:**
      Orchestrate a rigorous, multi-turn debate where EACH AI provider gets their own dedicated turn in every round. You must remain completely unbiased - questioning all perspectives equally until the most accurate and validated setup emerges.
      
      **CRITICAL: UNBIASED MODERATOR PROTOCOL**
      - You must NOT favor any analyst over another
      - Question each party with EQUAL rigor
      - If analysts disagree, give EACH a dedicated turn to respond
      - Continue probing until genuine consensus OR clear irreconcilable divergence
      - Your role is to EXTRACT TRUTH, not to pick a winner
      
      **⚠️ CROSS-PROVIDER FACT-CHECKING (MANDATORY):**
      Every analyst MUST actively verify and challenge other analysts' claims:
      - If an analyst detects MISLEADING INFORMATION from another provider, they MUST flag it immediately
      - Use format: "⚠️ FACT CHECK: [Analyst] claimed [X], but [my data shows Y]. Evidence: [specific proof]"
      - Moderator MUST pause and demand clarification when fact-check is raised
      - The analyst who made the original claim MUST respond with evidence or retract
      - Do NOT let any unverified claim pass into the final verdict
      
      **TYPES OF MISLEADING INFORMATION TO FLAG:**
      1. **Price Level Errors** - Wrong support/resistance levels cited
      2. **Indicator Contradictions** - RSI/MACD readings that don't match chart data
      3. **Timeframe Misalignment** - Claiming HTF alignment when LTF conflicts
      4. **Pattern Memory Mismatch** - Referencing patterns that don't exist in history
      5. **Inflated Confidence** - High confidence without supporting evidence
      
      **CRITICAL DIRECTIVE 1: PATTERN MEMORY SUPREMACY**
      The "Pattern Memory Library" (History) is your absolute source of truth. It outweighs generic theory. 
      - If an analyst proposes a setup that statistically leads to losses in the History, you MUST challenge it immediately.
      - If a setup aligns with historical 'Success Signatures', give it higher weight.
      - Your HIGHEST PRIORITY is to validate everything against the Pattern Memory Synthesis.

      **MANDATORY: ALL ANALYSIS AREAS MUST BE DISCUSSED**
      ${lensConfig?.enabled ? `
      **LENS MODE ANALYSIS REQUIREMENTS:**
      During the debate, analysts MUST cover ALL of these role-specific areas:
      - **Macro Evaluation** - Market regime, volatility state, session timing, macro catalysts
      - **Technical Validation** - Pattern type, Family classification (A/B/C/Omega), structure validation
      - **Pattern Memory Check** - Compare to Recent Insights, find similar historical setups
      - **Risk Assessment** - R:R calculation, position sizing, stop loss placement, failure scenarios
      - **AI Probability Estimation** - MANDATORY: Estimate SL/TP probabilities (0-100%) and justify with ATR/volatility/Pattern Memory.
      - **Trade Setup** - Entry zone, SL, TP, R:R, confidence grade
      - **Candle History Citation** - MANDATORY: Cite the bullish/bearish candle counts from Candle History (e.g., "The 4H shows 12 Bullish, 8 Bearish"). Use this as PROOF for directional thesis.

      ⚠️ **MANDATORY PATTERN MEMORY CHECK FOR ALL ANALYSTS:**
      Every analyst MUST answer: "Which of the Recent Insights is most similar to this setup, and what was the outcome?"
      ` : `
      During the debate, analysts MUST cover ALL of these analysis sections:
      - **Section 1: Multi-Timeframe Structure** - 5m/15m/1h/4h bias alignment
      - **Section 2: Price Action Type** - Continuation/Countertrend/Compression/Reversal
      - **Section 3: Family Classification** - Family A/B/C/Omega with evidence
      - **Section 4: Pattern Matching** - Compare to Recent Insights, find top 3 similar trades
      - **Section 5: Continuation vs Countertrend Bias** - Probability percentages
      - **Section 6: Adaptive Probability Model** - Long/Short probability with confidence
      - **Section 7: Numeric Chart Analysis** - Validate thesis against chart data (trend, regime, patterns)
      - **Section 8: Full Trade Setup** - Entry/SL/TP with R:R calculation
      - **Section 9: Candle History Citation** - MANDATORY: Cite the bullish/bearish candle counts from Candle History (e.g., "The 4H shows 12 Bullish, 8 Bearish"). Use this as PROOF for directional thesis.
      `}

      
      ${recentInsightsBlock}

      **CRITICAL DIRECTIVE 2: MARKET CLASSIFICATION ENFORCEMENT**
      You must strictly enforce the "Market Classification Families" (A, B, C, Omega).
      - Challenge BOTH participants: "Which Family is this? Where is the evidence?"
      - Demand clear justification from EACH analyst for their classification.
      
      **FAMILY DEFINITIONS REFERENCE:**
      ${TRADING_FAMILIES_PROMPT}

      **MANDATORY RISK/REWARD RULE (ABSOLUTE):**
      - **R:R < 1.2 = MAX CONFIDENCE 54% (Grade D)**. NO EXCEPTIONS.
      - **R:R < 1.5 = MAX CONFIDENCE 69% (Grade C)**.
      - If the consensus setup is < 1.2 RR, you MUST mark the final verdict as **CONDITIONAL** on a better entry price.

      **CONSOLIDATED 7-ROUND DEBATE PROTOCOL:**
      
      **TRADE SETUP GRADE SCALE → CONFIDENCE MAPPING (MANDATORY):**
      | Grade | Confidence % | Criteria |
      |-------|--------------|----------|
      | **A** | 80-95% | R:R ≥ 2.0, All 7 sections covered, HTF+LTF aligned, Pattern Memory MATCH, Volume confirmed |
      | **B** | 70-79% | R:R ≥ 1.5, 6+ sections covered, Minor HTF conflict only |
      | **C** | 55-69% | R:R ≥ 1.2, Some sections weak, Unclear invalidation |
      | **D** | 40-54% | R:R < 1.2, Missing sections, HTF conflict, Pattern Memory FAIL |
      | **F** | <40% / AVOID | No clear setup, High risk, Multiple red flags |
      
      **⚠️ ANTI-HALLUCINATION RULE (CRITICAL):**
      - You MUST NOT assign confidence ≥70% unless ALL of the following are TRUE:
        1. All 7 sections (or Lens roles) were thoroughly discussed and verified
        2. At least 3 timeframes align with the direction
        3. R:R ratio is mathematically calculated and ≥1.2
        4. Specific price levels for Entry/SL/TP are stated
        5. Pattern Memory was checked (match or no-match stated)
        6. **SL/TP Probabilities were estimated and justified**
      - If ANY of these are missing, cap confidence at 69% (Grade C) maximum
      - Hallucinated confidence = SYSTEM FAILURE. Be honest.
      
      **🎯 GOAL: AIM FOR 70%+ CONFIDENCE:**
      Your objective is to WORK HARD to achieve Grade A/B setups:
      - Ask clarifying questions to fill gaps
      - Demand specific price levels from analysts
      - Verify R:R calculations mathematically
      - Check Pattern Memory alignment
      - If all criteria are met → Award 70%+ confidence honestly
      - If criteria are NOT met → Be honest, stay at Grade C or lower
      
      **QUALITY ENFORCEMENT MANDATE:**
      You are the GATEKEEPER of quality. Do NOT accept vague, generic, or unreliable outputs.
      1. **Quality Checkpoint:** After EACH analyst turn, rate output quality (1-10).
      2. **Persistent Questioning Loop (Low Grade Protocol):**
         - Grade A/B (≥70%) → Proceed to final verdict.
         - Grade C (55-69%) → Ask: "What SPECIFIC evidence would justify 70%+ confidence?"
         - Grade D/F (<55%) → Ask: "Is this trade even viable? What must change?"
         - Continue questioning until upgraded to A/B OR honestly marked AVOID.
      3. **Stop Condition:** Do NOT proceed until you are satisfied (Score > 8) with reliability.
      4. **Honesty Check:**
         - If you cannot justify ≥70% confidence with specific evidence, DO NOT assign it
         - Better to be honest at 65% than hallucinate at 75%
      
      1.  **<DEBATE_START>** (Start immediately with this tag)
      
      2.  **ROUND 1: ${lensConfig?.enabled ? 'THESIS PRESENTATION (SPECIALIZED LENS ROLES)' : 'THESIS PRESENTATION (ALL 8 SECTIONS REQUIRED)'}**
           ${lensConfig?.enabled ? `
          Each analyst presents their specialized thesis based on their ASSIGNED ROLE only:
          *   ${analyst1Name} (${lensConfig.assignments?.find(a => a.assignedProvider === analyst1Name.toLowerCase())?.role || 'Analyst'}): [Present analysis focused strictly on your domain]
          *   ${analyst2Name} (${lensConfig.assignments?.find(a => a.assignedProvider === analyst2Name.toLowerCase())?.role || 'Analyst'}): [Present analysis focused strictly on your domain]
          ` : `
          Each analyst presents their complete thesis covering ALL sections:
          *   ${analyst1Name}: [1. Multi-TF Structure, 2. Price Action Type, 3. Family, 4. Pattern Match, 5. Bias %, 6. Probability, 7. Chart Analysis, 8. Full Setup]
          *   ${analyst2Name}: [Same 8 sections. State AGREE/DISAGREE with ${analyst1Name}]
          `}
      
      3.  **ROUND 2: MODERATOR CHALLENGE & CROSS-EXAMINATION** (All questioning happens here)
          *   Moderator challenges ${analyst1Name}'s weakest point → ${analyst1Name} responds
          *   Moderator challenges ${analyst2Name}'s weakest point → ${analyst2Name} responds
          *   ${analyst1Name} challenges ${analyst2Name} directly → ${analyst2Name} defends
          *   ${analyst2Name} counter-challenges ${analyst1Name} → ${analyst1Name} defends
          *   **Keep each exchange concise (max 80 words each).**
      
      3.  **ROUND 3: REFINEMENT LOOP (CONDITIONAL — REQUIRED IF GRADE < A/B)**
          *   **TRIGGER:** If the current consensus is Grade C, D, or F (Low/Medium confidence, weak R:R, unclear invalidation):
          *   Moderator: "This setup is currently Grade [C/D/F]. I will NOT proceed until it is upgraded. Answer these:"
              - "What SPECIFIC price action would upgrade this to Grade A?"
              - "Is the risk fatal or manageable? How do we mitigate?"
              - "Show me the EXACT invalidation level."
          *   ${analyst1Name}: Provides specific upgrade conditions (max 60 words)
          *   ${analyst2Name}: Confirms or proposes alternative (max 60 words)
          *   **LOOP:** Repeat questioning until Grade A/B is achieved OR trade is marked AVOID.
      
      4.  **ROUND 4: GATE SCAN RECONCILIATION (MANDATORY)**
          *   Moderator: "The Two-Stage Gate Scan has analyzed this symbol BEFORE this debate. Here are the findings:
              - Confidence Cap: [X]%
              - Penalties Applied: [List penalties]
              - Family Bias: [Favored/Disfavored families]
              
              ${analyst1Name}, explain how your thesis aligns with OR addresses these Gate findings."
          *   ${analyst1Name}: Responds to Gate findings (max 60 words)
          *   ${analyst2Name}: Agrees/disagrees, addresses Gate findings (max 60 words)
          *   Moderator (if confidence > Gate Cap): "Your confidence of X% exceeds the Gate's cap of Y%. Justify this NOW with specific evidence, or accept the cap."
          *   **CRITICAL:** If analysts cannot justify exceeding the Gate's cap, the final verdict MUST respect the cap.
      
      5.  **ROUND 5: NUMERIC CHART ANALYSIS (MANDATORY)**
          *   Moderator: "Let's validate your thesis against the Numeric Chart Representation. Reference the chart data:"
              - "What does the trend maturity (early/mid/late) tell us about entry timing?"
              - "Is the market regime (trend/range/compression/breakout) aligned with your strategy?"
              - "Does the wick bias and volume trend support or contradict your direction?"
          *   ${analyst1Name}: Chart validation (max 60 words) — must reference trend, regime, pattern
          *   ${analyst2Name}: Chart validation (max 60 words) — agree/disagree (respond concisely)
          *   Moderator: "MTF Alignment Check: Are 4H-1H aligned? Are 15M-5M aligned? If divergent, reduce confidence."
          *   **CRITICAL:** If chart data contradicts thesis, analysts MUST acknowledge and explain why they proceed.
      
      5.5 **ROUND 5.5: DUAL SCENARIO EVALUATION (MANDATORY - DO NOT SKIP)**
          *   Moderator: "⚖️ MANDATORY: Before proceeding, BOTH analysts must evaluate the ALTERNATIVE scenario."
          *   Moderator to ${analyst1Name}: "You favor [direction]. Define the OPPOSITE scenario: What trigger, confirmation, target, and invalidation would make the opposite direction correct?"
          *   ${analyst1Name}: Defines opposite scenario with specific price levels (max 60 words)
          *   Moderator to ${analyst2Name}: "Same question - define the scenario you're NOT taking. What would prove you wrong?"
          *   ${analyst2Name}: Defines opposite scenario with specific price levels (max 60 words)
          *   Moderator: "Now COMPARE: Which scenario has stronger evidence? Why is [selected direction] more likely than [opposite]?"
          *   **CRITICAL:** The final JSON MUST include "dualScenarioAnalysis" with BOTH bullish and bearish scenarios populated.
      
      6.  **ROUND 6: STATISTICAL REALITY CHECK (MONTE CARLO & AI PROBABILITY)**
          *   Moderator: "Review the Monte Carlo probabilities (Win Rate & Ruin Risk). How do they compare to your estimated AI Probabilities for SL/TP? Reconcile any major divergence."
          *   ${analyst1Name}: Statistical reconciliation (max 50 words)
          *   ${analyst2Name}: Statistical reconciliation (max 50 words)

      7.  **ROUND 7: FINAL RESOLUTION** (If disagreement persists)
          *   If analysts STILL disagree on DIRECTION or KEY LEVELS:
              - Moderator: "Final evidence required from each party."
              - ${analyst1Name}: Final defense (max 60 words)
              - ${analyst2Name}: Final defense (max 60 words)
          *   **If consensus reached in Round 2, skip to Round 8.**

      8.  **ROUND 8: RED TEAM STRESS TEST**
          *   Moderator (Devil's Advocate): "How does this trade FAIL?"
          *   ${analyst1Name}: Failure scenario (max 40 words)
          *   ${analyst2Name}: Failure scenario (max 40 words)
      
      8.  **ROUND 7: SETUP VALIDITY WINDOW (MANDATORY)**
          *   Moderator: "How long does this setup remain valid? Consider: (1) timeframe analyzed, (2) current volatility, (3) proximity to key events, (4) pattern decay rate."
          *   ${analyst1Name}: Propose validity (e.g., "4h 30m because...") (max 40 words)
          *   ${analyst2Name}: Agree/disagree with counter-reasoning (max 40 words)
          *   Moderator: Synthesize and state final validity in format "Xh Ym"
          
          **VALIDITY GUIDELINES:**
          - Scalp / high volatility: 30m - 2h
          - Intraday setups: 2h - 6h
          - Swing / multi-timeframe: 6h - 24h
          - Position trades: 24h - 72h
      
      9.  **</DEBATE_END>**

      7.  **MODERATOR FINAL VERDICT (REQUIRED & STRUCTURED)**
          *   IMMEDIATELY after the </DEBATE_END> tag, write a section titled "Moderator Final Verdict:".
          *   **CRITICAL:** Your verdict must reflect the WEIGHT OF EVIDENCE, not just the majority opinion.
          *   You **MUST** provide the final trade plan in this **EXACT TEXT FORMAT**:

              **Direction:** [Long / Short / No Trade]
              **Entry Zone:** [Specific Price or Range]
              **Stop Loss:** [Specific Price]
              **Take Profit:** [Target 1, Target 2]
              **R:R Ratio:** [e.g. 1:2.5]
              **Confidence:** [High/Medium/Low/Avoid] (Probability: XX%)
              **Validity Window:** [Xh Ym] — [Brief reasoning why this duration]
              
              **Verdict Rationale:**
              [Complete synthesis explaining: 1) Which evidence was most compelling, 2) How disagreements were resolved, 3) Family Classification, 4) Pattern Memory alignment. Do not stop mid-sentence.]

      9.  **JSON PLAN (CRITICAL - FAILURE WILL BREAK THE SYSTEM)**
          
          ⚠️ YOU MUST OUTPUT VALID, COMPLETE JSON OR THE SYSTEM WILL FAIL ⚠️
          
          *   Only AFTER the complete text verdict, output the final JSON wrapped in <JSON_PLAN> and </JSON_PLAN>.
          *   **CRITICAL:** The JSON block must be the ABSOLUTE LAST THING in your response.
          *   **CRITICAL:** Do NOT write any text after </JSON_PLAN>.
          *   **CRITICAL:** Complete the ENTIRE JSON object - do not stop mid-generation.
          *   **CRITICAL:** Use actual price values, not "..." placeholders.
          
          **EXACT EXAMPLE FORMAT:**
          <JSON_PLAN>
          {
              "coinName": "BTCUSDT",
              "direction": "Long",
              "entryPoints": [{ "price": "95000", "description": "Key support retest" }],
              "stopLoss": "94500",
              "takeProfit": [{ "price": "96000", "percentage": "2%" }, { "price": "97000", "percentage": "4%" }],
              "confidence": "High",
              "probability": 75,
              "grade": "B",
              "strategy": "Trend continuation after pullback",
              "historicalCorrelation": "Similar to previous winning setups",
              "marketConditions": { 
                  "pattern": "Bull Flag", 
                  "candleBehavior": "Higher lows forming", 
                  "timeframeAlignment": "3 of 4 bullish", 
                  "rsi": "55", 
                  "macd": "Bullish crossover", 
                  "sentiment": "Neutral",
                  "prices": { "5m": "95100", "15m": "95050", "1h": "95000", "4h": "94800" }
              },
              "detectedPatternFamily": "Family C",
              "detectedPatterns": [{ "name": "Bull Flag", "timeframe": "1h", "type": "Bullish", "confidence": "High", "description": "Consolidation above support" }],
              "keyLevels": { "support": ["94500 (4h)", "94000 (1h)"], "resistance": ["96000 (4h)", "97000 (1h)"] },
              "validityDurationMinutes": 330,
              "dualScenarioAnalysis": {
                  "bullish": { "trigger": "95500", "confirmation": "4H close above with volume", "target": "97000", "invalidation": "94500" },
                  "bearish": { "trigger": "94000", "confirmation": "4H close below", "target": "92000", "invalidation": "95500" },
                  "selectedScenario": "bullish",
                  "selectionReasoning": "HTF trend bullish, volume supports breakout, Pattern Memory shows 70% win rate",
                  "confidenceInSelection": 75
              }
          }
          </JSON_PLAN>

      **FORMATTING RULES:**
      *   Use strict "Speaker:" format (e.g. "${analyst1Name}:", "Moderator:", "Moderator to ${analyst1Name}:").
      *   Do NOT bold speaker names.
      *   Ensure each analyst gets their OWN dedicated turn - do not combine responses.
      *   Keep individual responses concise (max 120 words each) to fit all turns.

      **INPUT DATA:**
      Request: "${truncateTextToTokens(userPrompt, 1500)}"
      History: ${tradeHistoryContext}
      ${mcContext}

      **${analyst1Name.toUpperCase()} INITIAL THOUGHTS**: ${truncateTextToTokens(JSON.stringify(sanitizeAnalystOutput(analyst1Result.analysis)), 1000)} ${calibratedAnalysts[0].calibrationNote}
      **${analyst2Name.toUpperCase()} INITIAL THOUGHTS**: ${truncateTextToTokens(JSON.stringify(sanitizeAnalystOutput(analyst2Result.analysis)), 1000)} ${calibratedAnalysts[1].calibrationNote}

      
      Start with <DEBATE_START> now.`;

    yield* getModeratorAnalysisStream(moderatorProvider, moderatorModel, moderatorSystemPrompt);
};

export const conductThreeWayDebate = async function* (
    analyst1Result: { analysis: TradeAnalysis, thoughtProcess: string },
    analyst2Result: { analysis: TradeAnalysis, thoughtProcess: string },
    analyst3Result: { analysis: TradeAnalysis, thoughtProcess: string },
    analyst1Name: string,
    analyst2Name: string,
    analyst3Name: string,
    userPrompt: string,
    finalTradeSummary: string | null,
    moderatorProvider: AIProvider,
    moderatorModel: string,
    customInstructions?: string,
    trades?: LoggedTrade[],
    enabledProviders?: AIProvider[],
    monteCarloResults?: { provider: string, result: any }[],
    lensConfig?: AnalystLensConfig,
    analystProviders?: AIProvider[],
    activeFrameworks?: string[],
    tradeSummaries?: { id: string; summaryText: string; timestamp: string }[],
    gateResult?: GateOutput | null, // Gate result for reconciliation
    learningContext?: string // NEW: Unified learning context
): AsyncGenerator<string, void, unknown> {

    // Format Monte Carlo context
    let mcContext = "No Monte Carlo simulation data available.";
    if (monteCarloResults && monteCarloResults.length > 0) {
        mcContext = "**MONTE CARLO STATISTICAL VALIDATION:**\n";
        monteCarloResults.forEach(mc => {
            if (mc.result) {
                mcContext += `- ${mc.provider}: Win Rate ${mc.result.winRate}%, EV ${mc.result.expectedValue}R, Max DD ${mc.result.maxDrawdownAvg}%\n`;
            }
        });
    }

    // Increase token limits for less truncation - full debate visibility
    // Increase token limits for less truncation - full debate visibility
    const tradeHistoryContext = finalTradeSummary ? `This is your Pattern Memory Library (a pre-processed summary of recent trades)...\n${truncateTextToTokens(finalTradeSummary, 3000)}` : "No past trades logged.";

    // --- BAYESIAN CONFIDENCE CALIBRATION ---
    let calibrationData: ConfidenceCalibration | null = null;
    try {
        calibrationData = await getPreferenceObject<ConfidenceCalibration>(PREF_KEYS.CONFIDENCE_CALIBRATION);
    } catch (e) {
        console.warn('Failed to load calibration data for 3-way:', e);
    }

    const calibratedAnalysts = [
        { name: analyst1Name, result: analyst1Result },
        { name: analyst2Name, result: analyst2Result },
        { name: analyst3Name, result: analyst3Result }
    ].map(item => {
        const rawConf = item.result.analysis.confidence as ConfidenceLevel;
        const rawProb = item.result.analysis.probability || 0;

        let calibratedProb = rawProb;
        let calibrationNote = "";

        if (calibrationData) {
            calibratedProb = getBayesianCalibratedConfidence(
                calibrationData,
                item.name,
                rawConf,
                rawProb
            );

            if (Math.abs(calibratedProb - rawProb) > 5) {
                calibrationNote = `(Bayesian Calibrated: ${calibratedProb}% based on history)`;
            }
        }

        return {
            ...item,
            calibratedProb,
            calibrationNote
        };
    });


    // --- RECENT INSIGHTS FOR PATTERN MATCHING ---
    let recentInsightsBlock = '';
    if (tradeSummaries && tradeSummaries.length > 0) {
        const top5 = tradeSummaries.slice(0, 5);
        recentInsightsBlock = `\n**RECENT INSIGHTS FOR PATTERN MATCHING (Top ${top5.length}):**\n`;
        top5.forEach((insight, idx) => {
            const date = new Date(insight.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            recentInsightsBlock += `${idx + 1}. [${date}] ${insight.summaryText.slice(0, 200)}...\n`;
        });
        recentInsightsBlock += `\n**INSTRUCTION:** Compare the current setup to these recent trades. Identify the top 3 most similar trades and discuss their outcomes.\n`;
    }

    // Generate enhanced debate context if trades available
    let enhancedContext = '';
    if (trades && trades.length >= 3 && enabledProviders && enabledProviders.length >= 2) {
        try {
            const analyses = [
                { model: analyst1Name, analysis: sanitizeAnalystOutput(analyst1Result.analysis) },
                { model: analyst2Name, analysis: sanitizeAnalystOutput(analyst2Result.analysis) },
                { model: analyst3Name, analysis: sanitizeAnalystOutput(analyst3Result.analysis) }
            ];

            // Extract coin/pattern from analyses
            const currentCoin = analyst1Result.analysis.coinName?.toUpperCase();
            const currentPattern = analyst1Result.analysis.detectedPatternFamily;

            const enhanced = generateEnhancedDebateContext(
                analyses,
                trades,
                enabledProviders,
                'ranging' as MarketRegime, // Default regime
                currentCoin,
                currentPattern
            );

            enhancedContext = enhanced.promptInjection;
            console.log('[EnhancedDebate] Generated context, length:', enhancedContext.length);
        } catch (e) {
            console.error('[EnhancedDebate] Failed to generate enhanced context:', e);
        }
    }

    // --- CONFLUENCE SCORING ---
    let confluenceContext = '';
    const primaryDirection = analyst1Result.analysis.direction as 'Long' | 'Short' | 'Neutral';
    if (primaryDirection && primaryDirection !== 'Neutral') {
        try {
            const confluenceScore = calculateConfluenceScore(analyst1Result.analysis, primaryDirection);
            confluenceContext = generateConfluencePromptInjection(confluenceScore);

            // Add historical insight if available
            const historicalInsight = getConfluenceInsight(confluenceScore.score);
            if (historicalInsight) {
                confluenceContext += '\n' + historicalInsight;
            }

            console.log('[Confluence] Score:', confluenceScore.score, '/', 100, '-', confluenceScore.recommendation);
        } catch (e) {
            console.error('[Confluence] Failed to calculate:', e);
        }
    }

    // --- RULE VIOLATION CHECKING ---
    let ruleViolationContext = '';
    try {
        const ruleCheck = checkTradeAgainstRules(analyst1Result.analysis);
        if (ruleCheck.violations.length > 0) {
            ruleViolationContext = ruleCheck.promptInjection;
            console.log('[Rules] Found', ruleCheck.violations.length, 'violations');
        }
    } catch (e) {
        console.error('[Rules] Failed to check:', e);
    }

    // --- LIVE MARKET DATA PARSING & INJECTION ---
    const parsedMarketData = parseLiveMarketData(userPrompt);
    let marketDataOverride = "";
    if (parsedMarketData) {
        const safePrices = JSON.stringify(parsedMarketData.prices).slice(0, 1000);
        const safePatterns = JSON.stringify(parsedMarketData.patterns).slice(0, 1000);
        const safeZones = JSON.stringify(parsedMarketData.keyZones).slice(0, 1000);

        const playbookList = activeFrameworks && activeFrameworks.length > 0
            ? activeFrameworks.slice(0, 10).join(', ')
            : 'No active playbook';

        marketDataOverride = `
    **VERIFIED LIVE MARKET TELEMETRY (HIGHEST PRIORITY):**
    You MUST incorporate this exact data into your Final Verdict and JSON Output.
    
    - **Prices:** ${safePrices}
    - **Detected Patterns:** ${safePatterns}
    - **Key Zones:** ${safeZones}
    - **Active Playbook/Strategies:** ${playbookList}
        `;
    }
    // --------------------------------------------


    const userOverride = customInstructions
        ? `\n\n**USER BEHAVIOR OVERRIDE:**\nThe user has provided specific instructions for how you must respond, calculate, and reason. These instructions take precedence over default tone/style settings:\n"${truncateTextToTokens(customInstructions, 500)}"\n`
        : "";

    // --- ANALYST LENS CONTEXT ---
    // Using 'medium' verbosity by default to prevent token overflow causing JSON parsing failures
    const effectiveTradingStyle = lensConfig?.tradingStyle === 'auto' ? 'swing' : (lensConfig?.tradingStyle || 'swing');
    const lensContext = generateLensContext(
        [analyst1Name, analyst2Name, analyst3Name],
        analystProviders || [],
        lensConfig,
        'medium', // Use medium verbosity to balance detail vs token limits
        effectiveTradingStyle as 'swing' | 'scalp'
    );

    // --- WEIGHTED VOTING CONTEXT ---
    const currentFamily = analyst1Result.analysis.detectedPatternFamily || '';
    const weightedVotingContext = enabledProviders && enabledProviders.length > 0
        ? generateWeightedVotingContext(enabledProviders, currentFamily)
        : '';

    // --- PRE-DEBATE DIVERGENCE CHECK ---
    const divergenceContext = generateDivergenceContext(
        [analyst1Result, analyst2Result, analyst3Result],
        [analyst1Name, analyst2Name, analyst3Name]
    );

    // --- PATTERN MEMORY ENFORCEMENT (STRICT) ---
    const setupContext: SetupContext = {
        coin: analyst1Result.analysis.coinName,
        direction: analyst1Result.analysis.direction as 'Long' | 'Short' | undefined,
        pattern: analyst1Result.analysis.marketConditions?.pattern,
        family: currentFamily,
        confidence: analyst1Result.analysis.confidence as 'High' | 'Medium' | 'Low' | undefined
    };
    const patternMemoryContext = trades && trades.length > 0
        ? generatePatternMemoryEnforcementContext(setupContext, trades)
        : '';

    // --- GATE RECONCILIATION CONTEXT ---
    // If Gate result is provided, generate context that forces moderator to reconcile confidence differences
    const gateReconciliationContext = gateResult
        ? generateGateReconciliationContext(gateResult, [analyst1Result, analyst2Result, analyst3Result])
        : '';

    const moderatorSystemPrompt = `
You are a **Master Trading Strategist** moderating a high-stakes, tri-analyst trading debate between ${analyst1Name}, ${analyst2Name}, and ${analyst3Name}.

${userOverride}

${lensContext}

${weightedVotingContext}

${divergenceContext}

${patternMemoryContext}

${marketDataOverride}

${enhancedContext}

${confluenceContext}

${ruleViolationContext}

${gateReconciliationContext}

${AI_CORE_SKILL_INJECTION}

${POST_MORTEM_PATTERN_LEARNING_PROMPT}

${learningContext || ''}

${STRESS_TEST_PROTOCOL}

${SCENARIO_EVALUATION_PROTOCOL}

${MODERATOR_VERIFICATION_ENFORCEMENT_PROMPT}

${PROBABILITY_ESTIMATION_PROMPT}

${mcContext}

Your role is to remain COMPLETELY UNBIASED while eliminating ambiguity, extracting the strongest logic, and producing a final, trade-ready verdict.
**CRITICAL: Each AI provider gets their own dedicated turn. Never combine or skip analyst responses.**

---------------------------------------------------------
🎯 OBJECTIVE:
Orchestrate a rigorous, multi-turn debate where EACH analyst gets their own turn in every round. If analysts disagree, they must be given additional turns to respond and defend their positions.

⚠️ **CRITICAL: UNBIASED MODERATOR PROTOCOL**
- You must NOT favor any analyst over another
- Question ALL THREE parties with EQUAL rigor
- If disagreement persists, give EACH analyst a dedicated rebuttal turn
- Continue probing until genuine consensus OR clear irreconcilable divergence
- Your role is to EXTRACT TRUTH, not to pick a winner

**⚠️ CROSS-PROVIDER FACT-CHECKING (MANDATORY):**
Every analyst MUST actively verify and challenge other analysts' claims:
- If an analyst detects MISLEADING INFORMATION from another provider, they MUST flag it immediately
- Use format: "⚠️ FACT CHECK: [Analyst] claimed [X], but [my data shows Y]. Evidence: [specific proof]"
- Moderator MUST pause and demand clarification when fact-check is raised
- The analyst who made the original claim MUST respond with evidence or retract
- Do NOT let any unverified claim pass into the final verdict

**TYPES OF MISLEADING INFORMATION TO FLAG:**
1. **Price Level Errors** - Wrong support/resistance levels cited
2. **Indicator Contradictions** - RSI/MACD readings that don't match chart data
3. **Timeframe Misalignment** - Claiming HTF alignment when LTF conflicts
4. **Pattern Memory Mismatch** - Referencing patterns that don't exist in history
5. **Inflated Confidence** - High confidence without supporting evidence

⚠️ **CRITICAL DIRECTIVE 1: PATTERN MEMORY SUPREMACY**
The **Pattern Memory Library** (History) is the HIGHEST PRIORITY context.
- If any analyst proposes a setup matching a known "Failure Signature", YOU MUST CHALLENGE IT.
- If a setup matches a "Success Signature", prioritize it.

**MANDATORY: ALL ANALYSIS AREAS MUST BE DISCUSSED**
${lensConfig?.enabled ? `
**LENS MODE ANALYSIS REQUIREMENTS:**
During the debate, analysts MUST cover ALL of these role-specific areas:
- **Macro Evaluation** - Market regime, volatility state, session timing, macro catalysts
- **Technical Validation** - Pattern type, Family classification (A/B/C/Omega), structure validation
- **Pattern Memory Check** - Compare to Recent Insights, find similar historical setups
- **Risk Assessment** - R:R calculation, position sizing, stop loss placement, failure scenarios
- **AI Probability Estimation** - MANDATORY: Estimate SL/TP probabilities (0-100%) and justify with ATR/volatility/Pattern Memory.
- **Trade Setup** - Entry zone, SL, TP, R:R, confidence grade
- **Candle History Citation** - MANDATORY: Cite the bullish/bearish candle counts from Candle History (e.g., "The 4H shows 12 Bullish, 8 Bearish"). Use this as PROOF for directional thesis.

⚠️ **MANDATORY PATTERN MEMORY CHECK FOR ALL ANALYSTS:**
Every analyst MUST answer: "Which of the Recent Insights is most similar to this setup, and what was the outcome?"
` : `
During the debate, analysts MUST cover ALL of these analysis sections:
- **Section 1: Multi-Timeframe Structure** - 5m/15m/1h/4h bias alignment
- **Section 2: Price Action Type** - Continuation/Countertrend/Compression/Reversal
- **Section 3: Family Classification** - Family A/B/C/Omega with evidence
- **Section 4: Pattern Matching** - Compare to Recent Insights, find top 3 similar trades
- **Section 5: Continuation vs Countertrend Bias** - Probability percentages
- **Section 6: Adaptive Probability Model** - Long/Short probability with confidence
- **Section 7: Numeric Chart Analysis** - Validate thesis against chart data (trend, regime, patterns)
- **Section 8: Full Trade Setup** - Entry/SL/TP with R:R calculation
- **Section 9: Candle History Citation** - MANDATORY: Cite the bullish/bearish candle counts from Candle History (e.g., "The 4H shows 12 Bullish, 8 Bearish"). Use this as PROOF for directional thesis.
`}


${recentInsightsBlock}

⚠️ **CRITICAL DIRECTIVE 2: MARKET CLASSIFICATION ENFORCEMENT**
Strictly enforce "Market Classification Families" (A, B, C, Omega).
- Ask EACH participant: "What Family does this belong to? Prove it."
- Require evidence from ALL analysts, not just one.

**FAMILY DEFINITIONS:**
${TRADING_FAMILIES_PROMPT}

⚠️ **MANDATORY RISK/REWARD RULE:**
Final trade MUST offer R:R of at least 1:1.2. If RR < 1.2, mark as **CONDITIONAL**.
---------------------------------------------------------

## 📚 CONSOLIDATED 7-ROUND DEBATE PROTOCOL

**TRADE SETUP GRADE SCALE → CONFIDENCE MAPPING (MANDATORY):**
| Grade | Confidence % | Criteria |
|-------|--------------|----------|
| **A** | 80-95% | R:R ≥ 2.0, All 8 sections covered, HTF+LTF aligned, Pattern Memory MATCH, Volume confirmed |
| **B** | 70-79% | R:R ≥ 1.5, 6+ sections covered, Minor HTF conflict only |
| **C** | 55-69% | R:R ≥ 1.2, Some sections weak, Unclear invalidation |
| **D** | 40-54% | R:R < 1.2, Missing sections, HTF conflict, Pattern Memory FAIL |
| **F** | <40% / AVOID | No clear setup, High risk, Multiple red flags |

**⚠️ ANTI-HALLUCINATION RULE (CRITICAL):**
- You MUST NOT assign confidence ≥70% unless ALL of the following are TRUE:
  1. All 8 sections (or Lens roles) were thoroughly discussed and verified
  6. Numeric Chart Analysis was completed (trend maturity, regime, pattern validation)
  2. At least 3 timeframes align with the direction
  3. R:R ratio is mathematically calculated and ≥1.2
  4. Specific price levels for Entry/SL/TP are stated
  5. Pattern Memory was checked (match or no-match stated)
  7. **SL/TP Probabilities were estimated and justified**
- If ANY of these are missing, cap confidence at 69% (Grade C) maximum
- Hallucinated confidence = SYSTEM FAILURE. Be honest.

**🎯 GOAL: AIM FOR 70%+ CONFIDENCE:**
Your objective is to WORK HARD to achieve Grade A/B setups:
- Ask clarifying questions to fill gaps
- Demand specific price levels from analysts
- Verify R:R calculations mathematically
- Check Pattern Memory alignment
- If all criteria are met → Award 70%+ confidence honestly
- If criteria are NOT met → Be honest, stay at Grade C or lower

**QUALITY ENFORCEMENT MANDATE:**
You are the GATEKEEPER of quality. Do NOT accept vague, generic, or unreliable outputs.
1. **Quality Checkpoint:** After EACH analyst turn, rate output quality (1-10).
2. **Persistent Questioning Loop (Low Grade Protocol):**
   - Grade A/B (≥70%) → Proceed to final verdict.
   - Grade C (55-69%) → Ask: "What SPECIFIC evidence would justify 70%+ confidence?"
   - Grade D/F (<55%) → Ask: "Is this trade even viable? What must change?"
   - Continue questioning until upgraded to A/B OR honestly marked AVOID.
3. **Stop Condition:** Do NOT proceed until you are satisfied (Score > 8) with reliability.
4. **Honesty Check:**
   - If you cannot justify ≥70% confidence with specific evidence, DO NOT assign it
   - Better to be honest at 65% than hallucinate at 75%

### 1. Start Debate
Begin immediately with:
<DEBATE_START>

---

### 2. ROUND 1 — ${lensConfig?.enabled ? 'THESIS PRESENTATION (SPECIALIZED LENS ROLES)' : 'THESIS PRESENTATION (ALL 8 SECTIONS REQUIRED)'}
${lensConfig?.enabled ? `
Each analyst presents their specialized thesis based on their ASSIGNED ROLE only:
**${analyst1Name} (${lensConfig.assignments?.find(a => a.assignedProvider === analyst1Name.toLowerCase())?.role || 'Analyst'}):** [Present analysis focused strictly on your domain]
**${analyst2Name} (${lensConfig.assignments?.find(a => a.assignedProvider === analyst2Name.toLowerCase())?.role || 'Analyst'}):** [Present analysis focused strictly on your domain]
**${analyst3Name} (${lensConfig.assignments?.find(a => a.assignedProvider === analyst3Name.toLowerCase())?.role || 'Analyst'}):** [Present analysis focused strictly on your domain]
` : `
Each analyst presents their complete thesis covering ALL sections:
**${analyst1Name}:** [1. Multi-TF Structure, 2. Price Action Type, 3. Family, 4. Pattern Match, 5. Bias %, 6. Probability, 7. Chart Analysis, 8. Full Setup]
**${analyst2Name}:** [Same 8 sections. State AGREE/DISAGREE with ${analyst1Name}]
**${analyst3Name}:** [Same 8 sections. State AGREE/DISAGREE with both]
`}

---

### 3. ROUND 2 — MODERATOR CHALLENGE & CROSS-EXAMINATION (All questioning in this round)
*   Moderator challenges ${analyst1Name}'s weakest point → ${analyst1Name} responds (max 60 words each)
*   Moderator challenges ${analyst2Name}'s weakest point → ${analyst2Name} responds
*   Moderator challenges ${analyst3Name}'s weakest point → ${analyst3Name} responds
*   ${analyst1Name} challenges the thesis they disagree with most → Response
*   ${analyst2Name} counter-challenges → Response
*   ${analyst3Name} synthesizes or sides with strongest evidence

---

### 3.5 ROUND 2.5 — REFINEMENT LOOP (CONDITIONAL — REQUIRED IF GRADE < A/B)
**TRIGGER:** If the current consensus is Grade C, D, or F (Low/Medium confidence, weak R:R, unclear invalidation):
**Moderator:** "This setup is currently Grade [C/D/F]. I will NOT proceed until it is upgraded. Answer these:"
- "What SPECIFIC price action would upgrade this to Grade A?"
- "Is the risk fatal or manageable? How do we mitigate?"
- "Show me the EXACT invalidation level."
**${analyst1Name}:** Provides specific upgrade conditions (max 50 words)
**${analyst2Name}:** Confirms or proposes alternative (max 50 words)
**${analyst3Name}:** Final synthesis on upgrade path (max 50 words)
**LOOP:** Repeat questioning until Grade A/B is achieved OR trade is marked AVOID.

---

### 4. ROUND 3 — GATE SCAN RECONCILIATION (MANDATORY)
**Moderator:** "The Two-Stage Gate Scan has analyzed this symbol BEFORE this debate. Here are the findings:
- Confidence Cap: [X]%
- Penalties Applied: [List any data integrity, pattern memory, HTF conflict, or volume penalties]
- Family Bias: [Which families are favored/disfavored and why]
- Warnings: [Any specific warnings from the Gate]

${analyst1Name}, explain how your thesis aligns with OR addresses these Gate findings."
**${analyst1Name}:** Responds to Gate findings (max 60 words)
**${analyst2Name}:** Agrees/disagrees, addresses Gate findings (max 60 words)
**${analyst3Name}:** Final perspective on Gate alignment (max 60 words)
**Moderator (if any confidence exceeds Gate cap):** "Your confidence of X% exceeds the Gate's cap of Y%. Justify this NOW with specific evidence, or accept the cap."
**CRITICAL:** If analysts cannot justify exceeding the Gate's cap, the final verdict MUST respect the cap.

---

### 5. ROUND 4 — STATISTICAL REALITY CHECK (MONTE CARLO & AI PROBABILITY)
**Moderator:** "Review the Monte Carlo probabilities (Win Rate & Ruin Risk). How do they compare to your estimated AI Probabilities for SL/TP? Reconcile any major divergence."
**${analyst1Name}:** Statistical reconciliation (max 40 words)
**${analyst2Name}:** Statistical reconciliation (max 40 words)
**${analyst3Name}:** Statistical reconciliation (max 40 words)

---

### 5.5 ROUND 4.5 — NUMERIC CHART ANALYSIS (MANDATORY)
**Moderator:** "Let's validate your thesis against the Numeric Chart Representation. Reference the chart data:"
- "What does the trend maturity (early/mid/late) tell us about entry timing?"
- "Is the market regime (trend/range/compression/breakout) aligned with your strategy?"
- "Does the wick bias and volume trend support or contradict your direction?"
**${analyst1Name}:** Chart validation (max 50 words) — must reference trend, regime, pattern
**${analyst2Name}:** Chart validation (max 50 words) — agree/disagree with chart interpretation
**${analyst3Name}:** Chart validation (max 50 words) — synthesize chart data consensus
**Moderator:** "MTF Alignment Check: 4H-1H aligned? 15M-5M aligned? If divergent, reduce confidence."
**CRITICAL:** If chart data contradicts thesis, analysts MUST acknowledge and explain.

---

### 5.6 ROUND 4.6 — DUAL SCENARIO EVALUATION (MANDATORY - DO NOT SKIP)
**Moderator:** "⚖️ MANDATORY: Before final resolution, ALL analysts must evaluate BOTH bullish and bearish scenarios."
- "Define the BULLISH scenario: What trigger, confirmation, target, and invalidation?"
- "Define the BEARISH scenario: What trigger, confirmation, target, and invalidation?"
- "Which scenario has stronger evidence and why?"

**${analyst1Name}:** Presents BOTH scenarios from their domain perspective (max 60 words)
**${analyst2Name}:** Presents BOTH scenarios from their domain perspective (max 60 words)  
**${analyst3Name}:** Synthesizes: "The [selected] scenario dominates because..." (max 60 words)

**Moderator:** "Which scenario wins? Document BOTH in the final JSON."
**CRITICAL:** The final JSON MUST include "dualScenarioAnalysis" with BOTH bullish and bearish scenarios populated with specific price levels.

---

### 6. ROUND 5 — FINAL RESOLUTION (Only if disagreement persists)
If analysts STILL disagree on DIRECTION or KEY LEVELS:
- Moderator: "Final evidence required from each party."
- **${analyst1Name}:** Final defense (max 50 words)
- **${analyst2Name}:** Final defense (max 50 words)
- **${analyst3Name}:** Final defense (max 50 words)

**If consensus reached in Round 2, skip to Round 6.**

---

### 7. ROUND 6 — RED TEAM STRESS TEST
**Moderator (Devil's Advocate):** "How does this trade FAIL?"
**${analyst1Name}:** Failure scenario (max 40 words)
**${analyst2Name}:** Failure scenario (max 40 words)
**${analyst3Name}:** Failure scenario (max 40 words)

---

### 8. ROUND 7 — SETUP VALIDITY WINDOW (MANDATORY)
**Moderator:** "How long does this setup remain valid? Consider: (1) timeframe analyzed, (2) current volatility, (3) proximity to key events, (4) pattern decay rate."
**${analyst1Name}:** Propose validity (e.g., "4h 30m because...") (max 40 words)
**${analyst2Name}:** Agree/disagree with counter-reasoning (max 40 words)
**${analyst3Name}:** Final proposal with synthesis (max 40 words)
**Moderator:** State final validity in format "Xh Ym"

**VALIDITY GUIDELINES:**
- Scalp / high volatility: 30m - 2h
- Intraday setups: 2h - 6h
- Swing / multi-timeframe: 6h - 24h
- Position trades: 24h - 72h

---

### 9. End Debate
Close with:
</DEBATE_END>

## 🧨 8. MODERATOR FINAL VERDICT (REQUIRED)
Immediately after </DEBATE_END>, write:

### **Moderator Final Verdict:**

**CRITICAL:** Your verdict must reflect the WEIGHT OF EVIDENCE from all 3 analysts, not just the majority.

**Direction:** [Long / Short / Avoid]
**Entry Zone:** [Specific Price Range]
**Stop Loss:** [Specific Price]
**Take Profit:** [Target 1, Target 2]
**Estimated R:R:** [Value]
**Confidence:** [High/Medium/Low/Avoid] (Probability: XX%)
**Validity Window:** [Xh Ym] — [Brief reasoning why this duration]

**Detailed Analysis:**
[Synthesize: 1) Which evidence was most compelling, 2) How disagreements were resolved, 3) Family Classification, 4) Pattern Memory alignment. Do not stop mid-sentence.]

---

## 🧩 9. JSON PLAN (CRITICAL - FAILURE WILL BREAK THE SYSTEM)

⚠️ YOU MUST OUTPUT VALID, COMPLETE JSON OR THE SYSTEM WILL FAIL ⚠️

Only **after** writing the complete text verdict, output the structured JSON object.
- The JSON must be wrapped in <JSON_PLAN> and </JSON_PLAN> tags
- The JSON must be the ABSOLUTE LAST thing in your response
- Do NOT write any text after </JSON_PLAN>
- Complete the ENTIRE JSON object - do not stop mid-generation
- Use actual price values, not "..." placeholders

**EXACT EXAMPLE FORMAT:**
<JSON_PLAN>
{
    "coinName": "BTCUSDT",
    "direction": "Long",
    "entryPoints": [{ "price": "95000", "description": "Key support level" }],
    "stopLoss": "94500",
    "takeProfit": [{ "price": "96000", "percentage": "2%" }, { "price": "97000", "percentage": "4%" }],
    "confidence": "High",
    "probability": 75,
    "grade": "B",
    "strategy": "Trend continuation with pullback entry",
    "historicalCorrelation": "Similar to past winning setups",
    "marketConditions": { 
        "pattern": "Bull Flag", 
        "candleBehavior": "Higher lows", 
        "timeframeAlignment": "3 of 4 bullish", 
        "rsi": "55", 
        "macd": "Bullish crossover", 
        "sentiment": "Neutral",
        "prices": { "5m": "95100", "15m": "95050", "1h": "95000", "4h": "94800" }
    },
    "detectedPatternFamily": "Family C",
    "detectedPatterns": [{ "name": "Bull Flag", "timeframe": "1h", "type": "Bullish", "confidence": "High", "description": "Consolidation above support" }],
    "keyLevels": { "support": ["94500 (4h)", "94000 (1h)"], "resistance": ["96000 (4h)", "97000 (1h)"] },
    "validityDurationMinutes": 330,
    "dualScenarioAnalysis": {
        "bullish": { "trigger": "95500", "confirmation": "4H close above with volume", "target": "97000", "invalidation": "94500" },
        "bearish": { "trigger": "94000", "confirmation": "4H close below", "target": "92000", "invalidation": "95500" },
        "selectedScenario": "bullish",
        "selectionReasoning": "HTF trend bullish, volume supports breakout, Pattern Memory shows 70% win rate",
        "confidenceInSelection": 75
    }
}
</JSON_PLAN>

---

## 📝 FORMATTING RULES
- Use strict **Speaker:** format (e.g., "Moderator:", "Moderator to ${analyst1Name}:", "${analyst1Name}:").
- Do **NOT** bold speaker names.
- Ensure EACH analyst gets their OWN dedicated turn - do not combine responses.
- Keep individual responses concise (max 100 words each) to fit all turns.

**⚠️ CRITICAL: DUAL SCENARIO FIELD IS MANDATORY**
The "dualScenarioAnalysis" field in the JSON is NOT OPTIONAL. Your JSON will be REJECTED if:
- Either "bullish" or "bearish" scenario is missing
- Price levels (trigger, target, invalidation) are empty or vague
- "selectionReasoning" doesn't explain why one scenario won

---

## 🧠 INPUT DATA
Request: "${truncateTextToTokens(userPrompt, 1500)}"

History:  
${tradeHistoryContext}

**${analyst1Name.toUpperCase()} INITIAL THOUGHTS:**  
${truncateTextToTokens(JSON.stringify(sanitizeAnalystOutput(analyst1Result.analysis)), 1500)}

**${analyst2Name.toUpperCase()} INITIAL THOUGHTS:**  
${truncateTextToTokens(JSON.stringify(sanitizeAnalystOutput(analyst2Result.analysis)), 1500)}

**${analyst3Name.toUpperCase()} INITIAL THOUGHTS:**  
${truncateTextToTokens(JSON.stringify(analyst3Result.analysis), 1500)}

Start with <DEBATE_START> now.
`;


    yield* getModeratorAnalysisStream(moderatorProvider, moderatorModel, moderatorSystemPrompt);
};

export const conductTwoWayPostMortemDebate = (
    originalMessage: Message,
    outcome: TradeOutcome,
    analyst1PM: string,
    analyst2PM: string,
    analyst1Name: string,
    analyst2Name: string,
    finalTradeSummary: string | null,
    moderatorProvider: AIProvider,
    moderatorModel: string,
    postTradeImageSummaries?: string[],
    trades?: LoggedTrade[] // NEW: Pass trades for synthesis
): AsyncGenerator<string, void, unknown> => {

    const imageContext = postTradeImageSummaries?.length ? `**⚠️ VERIFIED TRADE OUTCOME DATA (HIGHEST PRIORITY):**\n${postTradeImageSummaries.join('\n---\n')}` : `No post-trade data was provided.`;

    // Build structured pattern memory synthesis
    let structuredMemoryContext = "";
    if (trades && trades.length > 0 && originalMessage.analysis) {
        const setupContext: SetupContext = {
            coin: originalMessage.analysis.coinName,
            direction: originalMessage.analysis.direction as 'Long' | 'Short' | 'Neutral',
            pattern: originalMessage.analysis.marketConditions?.pattern,
            family: originalMessage.analysis.detectedPatternFamily,
            confidence: originalMessage.analysis.confidence as 'High' | 'Medium' | 'Low' | 'Avoid',
        };

        const attributedInsights = loadAttributedInsights();
        const synthesis = synthesizePatternMemory(setupContext, trades, attributedInsights);
        structuredMemoryContext = generateSynthesizedPromptInjection(synthesis);
        console.log('[PostMortem] Generated synthesis with', synthesis.relevantTrades.length, 'similar trades');
    }

    // Fallback to legacy summary if no synthesis
    const tradeHistoryContext = structuredMemoryContext ||
        (finalTradeSummary ? `**PATTERN MEMORY LIBRARY (Historical Context):**\n${truncateTextToTokens(finalTradeSummary, 1500)}` : "No past trades logged.");

    const extendedSLZoneContext = `**⚠️ CRITICAL - 150% EXTENDED SL ZONE LOGIC:**
This system uses an "Extended SL Zone" where the initial Stop Loss is a SOFT limit:
- Original SL Distance = |Entry - StopLoss|
- Extended SL = SL + 50% of original distance (total 150% risk from entry)
- If price touches original SL but stays within 150% zone and then hits TP → WIN
- **CRITICAL: If price exceeds the 150% extended threshold → DEFINITIVE LOSS**

When the stop-loss touches the 150% extended zone boundary, this MUST be treated as a REAL LOSS:
1. The original SL was hit AND exceeded by 50%
2. This represents a failure of the trade thesis
3. In live trading, this position would have been closed at a significant loss

**⚠️ SPECIAL CASE: MISSED WIN DUE TO TIGHT STOP LOSS:**
When the ORIGINAL stop-loss is hit, price does NOT reach the 150% extended zone, and then reverses to hit TP:
1. This is still classified as a **LOSS** (because the SL was triggered in live trading)
2. However, this MUST be flagged as a **"MISSED WIN DUE TO TIGHT SL"**
3. The trade COULD have been profitable with a wider stop loss

**MANDATORY CORRECTED SL ANALYSIS (When Missed Win Detected):**
Each analyst MUST:
1. Calculate the **exact minimum SL distance** that would have kept the trade alive
2. Propose a **corrected optimal SL** (typically 10-20% wider than the minimum)
3. Explain the **rationale** based on:
   - Market volatility at the time (ATR considerations)
   - Key structural levels that should have been used as SL anchors
   - Whether a better entry would have naturally provided more SL room

**MODERATOR RESPONSIBILITY (When 150% Zone Breached):**
You MUST ensure the final conclusion addresses:
1. Whether the initial Stop Loss should have been placed wider
2. Whether the entry timing was optimal
3. Store this as 'extendedSLZoneBreach: true' for future pattern memory reference

**MODERATOR RESPONSIBILITY (When Missed Win Detected):**
You MUST:
1. Synthesize all analyst SL correction proposals
2. Calculate a **weighted average corrected SL** based on analyst reasoning
3. Provide a **final recommended SL adjustment percentage** for similar future setups
4. Store flag 'missedWinTightSL: true' for pattern memory`;

    const moderatorPrompt = `
    You are a **Master Trading Strategist** conducting a rigorous 5-round post-mortem debate.
    Trade outcome: **${outcome}**.

    ${extendedSLZoneContext}

    **CRYPTO TERMINOLOGY (MANDATORY):**
    Do NOT use forex terminology like "pips" or "points".
    For crypto, always use:
    - Percentages (%) for price movements and SL/TP distances
    - Dollar amounts ($) for absolute price levels
    Example: "SL was 2.5% too tight" NOT "SL was 50 pips too tight"

    Your objective is to uncover the *real technical cause* of the trade outcome using deep market reasoning and **Historical Pattern Analysis**.

    ${tradeHistoryContext}

    ${PROBABILITY_ESTIMATION_PROMPT}

    ${MODERATOR_FINAL_AUTHORITY_PROTOCOL}

    ------------------------------------------
    DEBATE PROTOCOL (5 ROUNDS)
    ------------------------------------------

    Begin immediately with:
    <DEBATE_START>

    ### **Round 1 — Initial Diagnosis (Root Cause)**
    **${analyst1Name}:** Present your hypothesis for the specific technical root cause of this outcome. Was it execution, analysis, or market randomness?
    **${analyst2Name}:** Agree or Disagree. If you disagree, provide your own root cause hypothesis.

    ### **Round 2 — Evidence & Pattern Memory Check**
    **Moderator (YOU):** "Does this specific setup match any historical pattern in our Pattern Memory? Cite the Evidence."
    **${analyst1Name}:** Cite Pattern Memory (Match/No Match) and Similarity Score if available.
    **${analyst2Name}:** Verify or challenge the citation.

    ### **Round 3 — The "Five Whys" (Deep Dive)**
    **Moderator (YOU):** Drill down. "Why did we make this mistake (or success)? Was it the entry? Why was the entry taken? Was it the analysis? Why was the analysis flawed?"
    **${analyst1Name}:** Answer the 'Why' deeper than surface level.
    **${analyst2Name}:** Dig even deeper into the behavioral or technical failing.

    ### **Round 4 — Lesson Extraction**
    **Moderator (YOU):** "What is the SINGLE most important actionable lesson from this trade?"
    **${analyst1Name}:** Propose the lesson.
    **${analyst2Name}:** Refine it to be more precise.

    ### **Round 5 — Rule Generation**
    **Moderator (YOU):** "Draft a precise IF/THEN rule to prevent this error (or replicate this success) in the future."
    **${analyst1Name}:** Draft Rule.
    **${analyst2Name}:** Optimize the Rule to be mechanical and binary (Yes/No).

    End Debate with:
    </DEBATE_END>

    ------------------------------------------
    FINAL REPORT
    ------------------------------------------

    Immediately after </DEBATE_END>, output a structured report wrapped in:
    <FINAL_REPORT_START>
    ... content ...
    </FINAL_REPORT_END>

    Report Structure (Follow Exactly):

    Root Cause Analysis
    Identify the precise technical reason the trade won or failed.
    Reference exact candle patterns, indicator behavior (RSI/MACD/EMA/Bollinger), and market structure at the decision candle.

    Pattern Memory Alignment
    State clearly whether this setup matches a known Success or Failure Signature from the Pattern Memory Synthesis.
    If yes, name the pattern and cite the similarity score. If no, explicitly say "No close historical match."

    Key Lesson (WITH ATTRIBUTION)
    Extract one actionable lesson. Attribute it to the analyst who identified it:
    Example: "[${analyst1Name}]: Should have waited for volume confirmation."

    Rule Adjustment
    Define one precise IF/THEN rule that can be applied mechanically in future trades.
    Format: IF [exact condition], THEN [exact action]

    📌 CONCLUSION (MANDATORY – END WITH THIS FORMAT)

    📋 CONCLUSION

    • Outcome Summary: WIN or LOSS — one clear sentence
    • Missed Win Flag: YES/NO — If YES, state "Missed Win due to Tight SL"
    • Primary Failure/Success Driver: The single most important technical factor
    • Pattern Confidence Impact: Increase / Maintain / Reduce (state why)
    • Corrected SL Proposal (if Missed Win):
      - Original SL: [price]
      - Optimal SL: [price] (+X% wider)
      - Rationale: [one-line explanation based on analyst synthesis]
    • Insight Attribution: Which analyst provided the most valuable insight?
    • New IF/THEN Rule:
    IF [exact condition], THEN [exact action]


    **INPUT DATA:**
    Original Analysis: ${truncateTextToTokens(JSON.stringify(originalMessage.analysis), 1500)}
    Actual Outcome: ${outcome}
    Visual Context: ${truncateTextToTokens(imageContext, 1000)}

    **${analyst1Name} Initial Post-Mortem:** ${truncateTextToTokens(analyst1PM, 800)}
    **${analyst2Name} Initial Post-Mortem:** ${truncateTextToTokens(analyst2PM, 800)}

    Start with <DEBATE_START> now.`;

    return getModeratorAnalysisStream(moderatorProvider, moderatorModel, moderatorPrompt);
};

/**
 * On-demand probability recalculation for existing trade analyses.
 * Forces the AI to identify TPs and output the new dynamic array format.
 */
export const recalculateProbabilities = async function* (
    analysis: TradeAnalysis,
    moderatorProvider: AIProvider,
    moderatorModel: string,
    snapshot?: any // Optional market snapshot for historical consistency
): AsyncGenerator<string, void, unknown> {

    const snapshotInfo = snapshot
        ? `\n**HISTORICAL MARKET CONTEXT (USE THIS DATA, NOT CURRENT PRICE):**\n${JSON.stringify({
            currentPrice: snapshot.marketData?.currentPrice,
            indicators: snapshot.indicators,
            regime: snapshot.regime,
            confluence: snapshot.confluence
        }, null, 2)}\n`
        : '';

    const prompt = `
        You are an expert trading analyst. Your task is to calculate SL/TP probabilities for an existing trade analysis.
        ${snapshotInfo}
        **ORIGINAL ANALYSIS:**
        ${JSON.stringify(analysis, null, 2)}
        
        ${PROBABILITY_ESTIMATION_PROMPT}

        **CRITICAL:** 
        1. Parse the "takeProfit" array in the ORIGINAL ANALYSIS to see how many TPs exist.
        2. Output ONLY a valid JSON object matching the "levelProbabilities" schema.
        3. Do NOT include any other text outside the JSON block.
        4. If you wrap the JSON in a field, use "levelProbabilities" as the top-level key.
    `;

    yield* getModeratorAnalysisStream(moderatorProvider, moderatorModel, prompt);
};

export const conductThreeWayPostMortemDebate = (
    originalMessage: Message,
    outcome: TradeOutcome,
    analyst1PM: string,
    analyst2PM: string,
    analyst3PM: string,
    analyst1Name: string,
    analyst2Name: string,
    analyst3Name: string,
    finalTradeSummary: string | null,
    moderatorProvider: AIProvider,
    moderatorModel: string,
    postTradeImageSummaries?: string[]
): AsyncGenerator<string, void, unknown> => {

    const imageContext = postTradeImageSummaries?.length ? `**⚠️ VERIFIED TRADE OUTCOME DATA (HIGHEST PRIORITY):**\n${postTradeImageSummaries.join('\n---\n')}` : `No post-trade data was provided.`;
    const tradeHistoryContext = finalTradeSummary ? `**PATTERN MEMORY LIBRARY (Historical Context):**\n${truncateTextToTokens(finalTradeSummary, 1500)}` : "No past trades logged.";

    const extendedSLZoneContext = `**⚠️ CRITICAL - 150% EXTENDED SL ZONE LOGIC:**
This system uses an "Extended SL Zone" where the initial Stop Loss is a SOFT limit:
- Original SL Distance = |Entry - StopLoss|
- Extended SL = SL + 50% of original distance (total 150% risk from entry)
- If price touches original SL but stays within 150% zone and then hits TP → WIN
- **CRITICAL: If price exceeds the 150% extended threshold → DEFINITIVE LOSS**

When the stop-loss touches the 150% extended zone boundary, this MUST be treated as a REAL LOSS:
1. The original SL was hit AND exceeded by 50%
2. This represents a failure of the trade thesis
3. In live trading, this position would have been closed at a significant loss

**⚠️ SPECIAL CASE: MISSED WIN DUE TO TIGHT STOP LOSS:**
When the ORIGINAL stop-loss is hit, price does NOT reach the 150% extended zone, and then reverses to hit TP:
1. This is still classified as a **LOSS** (because the SL was triggered in live trading)
2. However, this MUST be flagged as a **"MISSED WIN DUE TO TIGHT SL"**
3. The trade COULD have been profitable with a wider stop loss

**MANDATORY CORRECTED SL ANALYSIS (When Missed Win Detected):**
Each analyst MUST:
1. Calculate the **exact minimum SL distance** that would have kept the trade alive
2. Propose a **corrected optimal SL** (typically 10-20% wider than the minimum)
3. Explain the **rationale** based on:
   - Market volatility at the time (ATR considerations)
   - Key structural levels that should have been used as SL anchors
   - Whether a better entry would have naturally provided more SL room

**MODERATOR RESPONSIBILITY (When 150% Zone Breached):**
You MUST ensure the final conclusion addresses:
1. Whether the initial Stop Loss should have been placed wider
2. Whether the entry timing was optimal
3. Store this as 'extendedSLZoneBreach: true' for future pattern memory reference

**MODERATOR RESPONSIBILITY (When Missed Win Detected):**
You MUST:
1. Synthesize all analyst SL correction proposals
2. Calculate a **weighted average corrected SL** based on analyst reasoning
3. Provide a **final recommended SL adjustment percentage** for similar future setups
4. Store flag 'missedWinTightSL: true' for pattern memory`;

    const moderatorPrompt = `
    You are a **Master Trading Strategist** conducting a rigorous 5-round post-mortem debate with three analysts.  
    Trade outcome: **${outcome}**.

    ${extendedSLZoneContext}

    **CRYPTO TERMINOLOGY (MANDATORY):**
    Do NOT use forex terminology like "pips" or "points". 
    For crypto, always use:
    - Percentages (%) for price movements and SL/TP distances
    - Dollar amounts ($) for absolute price levels
    Example: "SL was 2.5% too tight" NOT "SL was 50 pips too tight"

    Your objective is to uncover the *real technical cause* of the trade outcome using deep market reasoning and **Historical Pattern Analysis**.

    ${tradeHistoryContext}

    ${PROBABILITY_ESTIMATION_PROMPT}

    ${MODERATOR_FINAL_AUTHORITY_PROTOCOL}

    ------------------------------------------
    DEBATE PROTOCOL (5 ROUNDS)
    ------------------------------------------

    Begin immediately with:
    <DEBATE_START>

    ### **Round 1 — Initial Diagnosis (Root Cause)**
    **${analyst1Name}:** Present your hypothesis for the specific technical root cause of this outcome. Was it execution, analysis, or market randomness?
    **${analyst2Name}:** Agree or Disagree. If you disagree, provide your own root cause hypothesis.
    **${analyst3Name}:** Provide a third perspective. Who is closer to the truth?

    ### **Round 2 — Evidence & Pattern Memory Check**
    **Moderator (YOU):** "Does this specific setup match any historical pattern in our Pattern Memory? Cite the Evidence."
    **${analyst1Name}:** Cite Pattern Memory (Match/No Match) and Similarity Score if available.
    **${analyst2Name}:** Verify or challenge the citation.
    **${analyst3Name}:** Confirm the validity of the historical comparison.

    ### **Round 3 — The "Five Whys" (Deep Dive)**
    **Moderator (YOU):** Drill down. "Why did we make this mistake (or success)? Was it the entry? Why was the entry taken? Was it the analysis? Why was the analysis flawed?"
    **${analyst1Name}:** Answer the 'Why' deeper than surface level.
    **${analyst2Name}:** Dig even deeper into the behavioral or technical failing.
    **${analyst3Name}:** Identify the fundamental "Root Cause" after multiple layers of 'Why'.

    ### **Round 4 — Lesson Extraction**
    **Moderator (YOU):** "What is the SINGLE most important actionable lesson from this trade?"
    **${analyst1Name}:** Propose the lesson.
    **${analyst2Name}:** Critique the lesson (is it too generic?).
    **${analyst3Name}:** Refine it to be precise and actionable.

    ### **Round 5 — Rule Generation**
    **Moderator (YOU):** "Draft a precise IF/THEN rule to prevent this error (or replicate this success) in the future."
    **${analyst1Name}:** Draft Rule.
    **${analyst2Name}:** Critique the rule for loopholes.
    **${analyst3Name}:** Optimize the Rule to be mechanical and binary (Yes/No).

    End Debate with:
    </DEBATE_END>

    ------------------------------------------
    FINAL REPORT
    ------------------------------------------

    Immediately after </DEBATE_END>, output a structured report wrapped in:
    <FINAL_REPORT_START>
    ... content ...
    </FINAL_REPORT_END>

    Report Structure (Follow Exactly):

    Root Cause Analysis
    Identify the precise technical reason the trade won or failed.
    Reference exact candle patterns, indicator behavior (RSI/MACD/EMA/Bollinger), and market structure at the decision candle.

    Pattern Memory Alignment
    State clearly whether this setup matches a known Success or Failure Signature from the Pattern Memory Synthesis.
    If yes, name the pattern and cite the similarity score. If no, explicitly say "No close historical match."

    Key Lesson (WITH ATTRIBUTION)
    Extract one actionable lesson. Attribute it to the analyst who identified it:
    Example: "[${analyst3Name}]: Should have waited for volume confirmation."

    Rule Adjustment
    Define one precise IF/THEN rule that can be applied mechanically in future trades.
    Format: IF [exact condition], THEN [exact action]

    📌 CONCLUSION (MANDATORY – END WITH THIS FORMAT)

    📋 CONCLUSION

    • Outcome Summary: WIN or LOSS — one clear sentence
    • Missed Win Flag: YES/NO — If YES, state "Missed Win due to Tight SL"
    • Primary Failure/Success Driver: The single most important technical factor
    • Pattern Confidence Impact: Increase / Maintain / Reduce (state why)
    • Corrected SL Proposal (if Missed Win):
      - Original SL: [price]
      - Optimal SL: [price] (+X% wider)
      - Rationale: [one-line explanation based on analyst synthesis]
    • Insight Attribution: Which analyst provided the most valuable insight?
    • New IF/THEN Rule:
    IF [exact condition], THEN [exact action]


    **INPUT DATA:**
    Original Analysis: ${truncateTextToTokens(JSON.stringify(originalMessage.analysis), 1500)}
    Actual Outcome: ${outcome}
    Visual Context: ${truncateTextToTokens(imageContext, 1000)}

    **${analyst1Name} Initial Post-Mortem:** ${truncateTextToTokens(analyst1PM, 800)}
    **${analyst2Name} Initial Post-Mortem:** ${truncateTextToTokens(analyst2PM, 800)}
    **${analyst3Name} Initial Post-Mortem:** ${truncateTextToTokens(analyst3PM, 800)}

    Start with <DEBATE_START> now.`;

    return getModeratorAnalysisStream(moderatorProvider, moderatorModel, moderatorPrompt);
};