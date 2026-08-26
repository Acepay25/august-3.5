
import { TradeAnalysis, Message, TradeOutcome, AccuracySubMode, LoggedTrade, AnalystLensConfig, AnalystRole, AnalystConsensus } from '../../types';
import { ProviderConfig } from '../../types/provider';
import { ChatMessage, warmProviderConnection } from './GenericProviderService';
import { streamChatWithDeskTools, resolveDefaultSymbol, clearDeskToolCache, ARBITER_ALLOWED_TOOLS } from '../analysis/DeskToolsService';
import { createDebateMailbox, synthesizeReplyToLine, formatDmEventLine } from '../analysis/DebateMailbox';
import { buildVerdictEvidencePack, deriveSetupQueryFromPrompt } from '../learning/EvidencePackService';
import { persuasionProfile } from '../analysis/convictionDrift';
import type { HermesBot } from '../../types/bot';
import { TASK_BUDGETS } from './taskBudgets';
import { getPrompt } from '../infrastructure/PromptOverrideService';

import { extractAndParseJson, extractLastJson } from '../../utils/jsonUtils';
import {
    MODERATOR_SYSTEM_PROMPT_V2,
    PURE_AI_MODERATOR_PROMPT,
    TRADING_FAMILIES_PROMPT,
    STRESS_TEST_PROTOCOL,
    EXTENDED_SL_ZONE_DEBATE_CONTEXT,
    MODERATOR_VERIFICATION_ENFORCEMENT_PROMPT,
    PROBABILITY_ESTIMATION_PROMPT,
    MODERATOR_FINAL_AUTHORITY_PROTOCOL,
    DEBATE_RESPONSE_PROMPT,
    MODERATOR_FINAL_VERDICT_PROMPT,
    MODERATOR_FINAL_VERDICT_PROMPT_COMPACT,
    MODERATOR_CLARIFICATION_QUESTIONS_PROMPT,
    ANALYST_CLARIFICATION_RESPONSE_PROMPT,
    MODERATOR_CLARIFICATION_JUDGMENT_PROMPT,
    DEBATE_CONFIDENCE_GOAL,
    DEBATE_QUALITY_MANDATE,
    REFINEMENT_LOOP_SCRIPT,
    GATE_CAP_CHALLENGE,
    GATE_CAP_CRITICAL,
    MONTE_CARLO_RECONCILIATION_PROMPT,
    CHART_VALIDATION_QUESTIONS,
    MTF_ALIGNMENT_CHECK_PROMPT,
    CHART_CONTRADICTION_CRITICAL,
    DUAL_SCENARIO_CRITICAL,
    RED_TEAM_QUESTION,
    FINAL_RESOLUTION_PROMPT,
    VALIDITY_WINDOW_PROMPT,
    VALIDITY_GUIDELINES
} from '../../constants/prompts';
import { CLARIFICATION_DONE_MARKER, CLARIFICATION_MARKERS_RE, CONVICTION_RETRY_MARKER, MODERATOR_RETRY_MARKER, replacementTimeoutText } from '../../constants/debateMarkers';
import { DUAL_SCENARIO_JSON_SCHEMA, MASTER_TRADE_PLAN_MARKDOWN } from '../../constants/schemas';
import { parseLiveMarketData } from '../../utils/liveMarketParser';
import { truncateTextToTokens, parsePrice, parseMarkdownTradePlan } from '../../utils/analysisUtils';
import { extractDebateLevels, formatDebateLevelsTable, summarizeFinalPositions } from '../../utils/debateLevels';
import { getCalibrationSummaries } from '../../services/backtesting/ModelPerformanceService';
import { stripLeakedScratchpad } from '../../utils/thinkingSplit';
import { buildRebuttalDiffPacket } from '../../utils/debateDiff';
import { compactDebateEpisode } from '../../utils/debateEpisodes';
import { debatePreStep } from '../../utils/debatePreStep';
import type { DebateRunEvent } from '../../types';
import { generateEnhancedDebateContext, EnhancedDebateContext } from '../ui/EnhancedDebateService';
import { MarketRegime } from '../analysis/TechnicalAnalysisService';
import {
    synthesizePatternMemory,
    generateSynthesizedPromptInjection,
    loadAttributedInsights,
    SetupContext,
    generatePatternMemoryEnforcementContext
} from '../learning/PatternMemorySynthesisService';
import {
    calculateConfluenceScore,
    generateConfluencePromptInjection,
    getConfluenceInsight,
} from '../analysis/TimeframeConfluenceService';
import {
    ANALYST_ROLE_DEFINITIONS,
    getRoleForProvider,
    getLensPromptForStyle,
} from '../ui/AnalystLensService';
import { generateWeightedVotingContext } from '../backtesting/ModelPerformanceService';
import type { GateOutput } from '../validation/GateKeeperService';
import GlobalLearningService from '../learning/GlobalLearningService';
import { getBayesianCalibratedConfidence, ConfidenceLevel } from '../validation/ConfidenceCalibrationService';
import { ConfidenceCalibration } from '../../types';
import { HARNESS_TIMEFRAME_LABEL } from '../../constants/harnessDataContract';

// =============================================================================
// DUAL SCENARIO EVALUATION PROTOCOL
// =============================================================================

/**
 * Protocol that forces analysts to evaluate both bullish and bearish scenarios
 * before selecting a direction. This reduces directional bias and improves
 * decision transparency.
 */
const SCENARIO_EVALUATION_PROTOCOL = `
##  MANDATORY DUAL SCENARIO EVALUATION PROTOCOL

**BEFORE selecting a direction, you MUST explicitly evaluate BOTH scenarios:**

###  BULLISH SCENARIO
- **Trigger:** What level must price break ABOVE to confirm bullish?
- **Confirmation:** What candle close / volume spike validates this?
- **Primary Target:** Upside price target
- **Invalidation:** Where does this bullish thesis FAIL?

###  BEARISH SCENARIO  
- **Trigger:** What level must price break BELOW to confirm bearish?
- **Confirmation:** What candle close / volume spike validates this?
- **Primary Target:** Downside price target
- **Invalidation:** Where does this bearish thesis FAIL?

###  DOMINANT SCENARIO SELECTION
After evaluating BOTH scenarios:
1. Compare evidence: Trend alignment, volume, Pattern Memory, Family classification
2. **Select ONE** as the trade plan with explicit reasoning
3. If neither dominates → Output "NEUTRAL / Wait for Breakout"

**MODERATOR ENFORCEMENT:**
- You MUST reject any final verdict that doesn't include BOTH scenarios with specific price levels
- The JSON output MUST include a "dualScenarioAnalysis" field with both scenarios

**OUTPUT FORMAT FOR dualScenarioAnalysis:**
\`\`\`json
${DUAL_SCENARIO_JSON_SCHEMA}
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
export const AI_CORE_SKILL_INJECTION = `
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
- " UNKNOWN: [specific missing data]"
- " INSUFFICIENT DATA: Cannot determine [X] because [reason]"
- " LOW CONFIDENCE: [claim] is uncertain because [evidence gap]"

Do NOT guess or hallucinate. Say "unknown" when you don't know.

---

**SKILL 3: FAILURE CONDITION AWARENESS (MANDATORY)**
Before finalizing any output, verify you are NOT doing these:
-  Confidently wrong answers (high confidence without evidence)
-  Fabricated details (invented price levels, patterns, or data)
-  Ignoring constraints (user rules, scope, mode restrictions)
-  Over-verbosity without value (filler text, repetition)
-  Providing solutions outside the requested scope

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
    analystsResults: { analysis: TradeAnalysis, thoughtProcess: string, finalOutput?: string }[]
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

${gateResult.warnings.length > 0 ? `**GATE WARNINGS:**\n${gateResult.warnings.map(w => ` ${w}`).join('\n')}` : ''}
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



// Moderator system message — helps OpenRouter free models follow complex instructions.
const MODERATOR_SYSTEM_MESSAGE = `You are an expert trading debate moderator. Your PRIMARY OBJECTIVE is to extract concrete trade values from the analysts' discussion.

CRITICAL RULES:
1. ALWAYS provide specific numeric prices for Entry, Stop Loss, and Take Profit - NEVER output "N/A" or "Not Available"
2. If analysts provide prices in their analysis, USE THOSE EXACT PRICES
3. If prices are unclear, ESTIMATE based on the discussion context
4. The FINAL TRADE PLAN must contain real price values, not placeholders
5. Every trade setup needs: direction, entry price, stop loss price, take profit price(s)
6. Desk tools are available on this turn — call search / derivatives / session tools when a live lookup would improve the verdict

You must complete the ENTIRE response including the **FINAL TRADE PLAN** markdown block at the end.`;

const fillPromptPlaceholders = (template: string, vars: Record<string, string>): string =>
    Object.entries(vars).reduce((acc, [key, value]) => acc.replaceAll(`{{${key}}}`, value), template);

/**
 * Stream the moderator analysis from any configured provider via the generic client.
 * `config` is the moderator provider's ProviderConfig; `model` overrides config.selectedModel
 * (kept for backward-compat with the per-conversation moderator model selection).
 */
const getModeratorAnalysisStream = async function* (
    config: ProviderConfig,
    model: string,
    prompt: string,
    signal?: AbortSignal,
    onReasoning?: (reasoning: string) => void,
    defaultSymbol?: string | null,
    onToolEvent?: (line: string) => void,
    /** Journal access for the `recall` desk tool: the arbiter
     *  must be able to check its own trade history, not just the analysts. */
    trades?: LoggedTrade[],
    /** Debate mailbox — lets the Moderator DM a seat directly and
     *  read whatever the seats sent them during the debate. */
    mailbox?: import('../analysis/DebateMailbox').DebateMailbox,
    onMailSent?: (info: { from: string; to: string; text: string; round: number }) => void,
    /** Which debate round the moderator turn belongs
     *  to — DM receipts used to print "(Round 0)" in the verdict transcript. */
    mailboxRound?: number,
): AsyncGenerator<string> {
    const effectiveConfig: ProviderConfig = { ...config, selectedModel: model || config.selectedModel };
    const messages: ChatMessage[] = [
        { role: 'system', content: MODERATOR_SYSTEM_MESSAGE },
        { role: 'user', content: prompt },
    ];
    try {
        // maxTokens guards reasoning-heavy moderators against truncating the
        // response mid-JSON (which previously surfaced as a Neutral card).
        // 12288: the debate prose + the final JSON plan share one stream, and
        // the context grew (notebook files, similar setups, regime weighting)
        // — 8192 truncates the plan at the end when the moderator writes long
        // rebuttal prose.
        for await (const chunk of streamChatWithDeskTools(effectiveConfig, messages, {
            temperature: 0.1,
            maxTokens: 12288,
            signal,
            onReasoning,
            onToolEvent,
            defaultSymbol: defaultSymbol ?? resolveDefaultSymbol(prompt),
            // The arbiter keeps the memory+context desk:
            // order-book noise must not outweigh argument quality at the
            // binding stage. Data tools stay available to analyst seats.
            allowedTools: [...ARBITER_ALLOWED_TOOLS],
            // The arbiter gets the same journal access as the seats it judges
            // (W1 fix): without this its recall desk tool returned nothing.
            trades,
            afterToolsNudge: 'Tool results are above. Continue the moderator turn now. If this is the final verdict, end with the labeled FINAL TRADE PLAN markdown. No JSON, no tool tags.',
            // The Moderator can DM seats (e.g. a targeted challenge
            // before the verdict) and read messages addressed to them.
            mailbox,
            mailboxSeat: 'Moderator',
            mailboxRound: mailboxRound ?? 0,
            onMailSent: info => onMailSent?.(info),
        })) {
            if (chunk) yield chunk;
        }
    } catch (e: any) {
        console.error("Moderator stream error:", e);
        // Aborted by the user — propagate so the caller can distinguish
        // cancellation from a provider error instead of an error marker.
        if (e?.name === 'AbortError' || e?.code === 'ABORT_ERR' || e?.name === 'TimeoutError') {
            throw e;
        }
        // For rate limit errors, throw to be handled by outer catch block
        if (e.status === 429 || e.message?.includes('429') || e.message?.includes('Rate limit')) {
            throw e;
        }
        // For other errors, yield an error marker that App.tsx can detect
        yield `\n<MODERATOR_ERROR>${e.message}</MODERATOR_ERROR>\n`;
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
    analystProviders: string[],
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
    const styleName = tradingStyle === 'scalp' ? 'SCALP' : 'SWING';
    const styleTimeframes = tradingStyle === 'scalp' ? '1m/5m/15m' : '15m/1H/4H/Daily';
    const styleMinRR = tradingStyle === 'scalp' ? '1.5:1' : '1.2:1';
    const styleSL = tradingStyle === 'scalp' ? '0.5-1x ATR (tight)' : '1-2x ATR (standard)';

    // MINIMAL: Bare essentials only (~15 lines)
    if (verbosity === 'minimal') {
        return `
**🎭 LENS MODE** **${styleName}** | TFs: ${styleTimeframes} | Min R:R: ${styleMinRR}
Roles: ${macroAnalyst ? `${macroAnalyst}` : ''} ${techAnalyst ? `${techAnalyst}` : ''} ${riskAnalyst ? `${riskAnalyst}` : ''}
 MANDATORY: End with the **FINAL TRADE PLAN** markdown block (Coin, Direction, Entry, Stop Loss, Take Profit 1/2, Confidence, Probability).
`;
    }

    // MEDIUM: Condensed (~40 lines)
    if (verbosity === 'medium') {
        return `
**🎭 ANALYST LENS MODE ACTIVE** **${styleName} TRADING**

**TRADING STYLE:** ${styleName} MODE
- Timeframes: ${styleTimeframes}
- Min R:R Required: ${styleMinRR}
- Stop Loss: ${styleSL}

**ROLE ASSIGNMENTS:**
${roleLines.join('\n')}

**EVALUATION RULES:**
1.  ${macroAnalyst || 'Macro Analyst'}: Authoritative on TIMING, volatility regime, and session analysis
2.  ${techAnalyst || 'Technical Analyst'}: Authoritative on PATTERNS, SMC levels, and entry zones  
3.  ${riskAnalyst || 'Risk Analyst'}: Authoritative on R:R validation and FAILURE SCENARIOS

**STYLE-SPECIFIC QUESTIONS (ASK EACH ANALYST):**
${tradingStyle === 'scalp' ? `
${macroAnalyst ? `-  ${macroAnalyst}: "Is this a kill zone? What's the expected move duration for a quick scalp?"` : ''}
${techAnalyst ? `-  ${techAnalyst}: "What's the LTF pattern? Is there a 1m/5m setup within the HTF structure?"` : ''}
${riskAnalyst ? `-  ${riskAnalyst}: "Is R:R ≥1.5? Is the SL tight enough (≤1x ATR)? What's the max hold time?"` : ''}
` : `
${macroAnalyst ? `-  ${macroAnalyst}: "Is NOW the right time? What's the volatility regime and trend strength?"` : ''}
${techAnalyst ? `-  ${techAnalyst}: "What pattern/Family are we trading? Where are SMC levels and invalidation?"` : ''}
${riskAnalyst ? `-  ${riskAnalyst}: "What's the R:R? Top 3 failure scenarios? Can this trade run for hours/days?"` : ''}
`}

**CONFLICT RESOLUTION:**
- Direction conflicts → Weight Macro Analyst
- Entry level conflicts → Weight Risk Analyst
- Risk Grade D/F → Mark trade CONDITIONAL or AVOID

**MANDATORY:** After debate, you MUST end with the complete **FINAL TRADE PLAN** markdown block (Coin, Direction, Entry, Stop Loss, Take Profit 1/2, Confidence, Probability, Strategy).
`;
    }

    // FULL: Complete detailed context (~100 lines)
    return `
**🎭 ANALYST LENS MODE ACTIVE — SPECIALIZED ROLE-BASED EVALUATION**
**TRADING STYLE: ${styleName}**

**STYLE PARAMETERS:**
- Focus Timeframes: ${styleTimeframes}
- Minimum R:R: ${styleMinRR}
- Stop Loss Range: ${styleSL}
- ${tradingStyle === 'scalp' ? 'Quick execution, don\'t overstay, target immediate moves' : 'Let trades develop, target swing moves with the trend'}

 **CRITICAL: You are moderating a ROLE-BASED ensemble where each analyst has a SPECIALIZED domain.**
Each analyst's output follows a STRUCTURED FORMAT specific to their role. You MUST evaluate each analyst according to their domain expertise.

**ROLE ASSIGNMENTS:**
${roleLines.join('\n')}

---

##  NUMERIC CHART DATA (MANDATORY USAGE)
You have structured chart data for 15m/1h/4h timeframes. Each analyst MUST reference this data:

**🌊 Macro Analyst:** Use chart REGIME and TREND MATURITY to validate timing.
**📊 Technical Analyst:** Use chart PATTERNS and WICK BIAS to confirm structure.
**🛡️ Risk Analyst:** Use STATE CONFIDENCE and VOLUME TREND to grade risk.

**MANDATORY QUESTIONS USING CHART DATA:**
- "The 1H chart shows [regime] with [maturity] maturity. Is this early enough to enter?"
- "Wick bias is [direction] — does this support your direction thesis?"
- "State confidence is [X%]. Should we reduce position size if below 0.8?"

---

##  ROLE-BASED EVALUATION PROTOCOL (MANDATORY)

###  MACRO ANALYST EVALUATION (${macroAnalyst || 'Assigned Analyst'})
Evaluate these sections from the Macro Analyst:
- **MACRO TREND ANALYSIS** — Multi-timeframe trend assessment
- **VOLATILITY REGIME** — ATR/volatility reflected in SL recommendations
- **LIQUIDITY MAP** — Liquidity sweep risks identified
- **MACRO RECOMMENDATION** — Is the macro bias justified?

**Key Question:** "Is NOW the right TIME to trade?"

###  TECHNICAL ANALYST EVALUATION (${techAnalyst || 'Assigned Analyst'})
Evaluate these sections from the Technical Analyst:
- **PATTERN IDENTIFICATION** — Pattern correctly identified and classified
- **SMART MONEY CONCEPTS** — OBs, FVGs, and BOS properly mapped
- **INDICATOR DASHBOARD** — Multi-timeframe indicator alignment
- **TECHNICAL RECOMMENDATION** — Entry zone and invalidation justified

**Key Question:** "WHAT pattern are we trading and is it valid?"

###  RISK SPECIALIST EVALUATION (${riskAnalyst || 'Assigned Analyst'})
Evaluate these sections from the Risk Specialist:
- **RISK/REWARD CALCULATOR** — Is the R:R ≥ 1.2?
- **ENTRY TIMING OPTIMIZATION** — LTF execution trigger identified
- **FAILURE SCENARIOS** — 3 failure paths identified
- **FINAL RISK RECOMMENDATION** — Risk Grade (A/B/C/D/F)

**Key Question:** "HOW do we execute safely and WHAT can go wrong?"


---

##  ROLE-SPECIFIC MANDATORY QUESTIONS

**You MUST ask each analyst these role-specific questions during the debate:**

${macroAnalyst ? `###  Questions for ${macroAnalyst} (Macro & Volatility):
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

${techAnalyst ? `###  Questions for ${techAnalyst} (Technical):
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

${riskAnalyst ? `###  Questions for ${riskAnalyst} (Risk & Execution):
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

##  SYNTHESIS RULES FOR LENS MODE

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

##  QUALITY GATE — PERSISTENT QUESTIONING PROTOCOL

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

##  STRICT QUALITY GATE (MODERATOR ENFORCEMENT)

You are the **FINAL GATEKEEPER**. Your job is to ensure ONLY the best possible setup is produced.

**AUTOMATIC REJECTION TRIGGERS:**
-  Any analyst provides vague price levels ("around $X", "near support")
-  R:R ratio is not explicitly calculated with numbers
-  Pattern Memory was not referenced (missing " PATTERN MEMORY CHECK")
-  Confidence is "High" but no Pattern Memory evidence supports it
-  Analysts agree too easily without citing evidence (Echo Chamber)
-  Key levels or invalidation points are missing

**MANDATORY CHALLENGES FROM MODERATOR:**
When you detect weak analysis, you MUST challenge:
1. "PROVE IT: Cite the exact Pattern Memory entry that supports this claim."
2. "JUSTIFY: Why is this R:R acceptable given the historical win rate?"
3. "DEFEND: Another analyst challenged your [claim]. Respond with evidence or revise."
4. "VERIFY: What is the EXACT price for entry/SL/TP? No ranges allowed."

---

##  ROLE-SPECIFIC MODERATOR QUESTIONS

After each analyst presents, you MUST ask their role-specific question:

**MACRO & VOLATILITY ANALYST (${macroAnalyst}):**
> "What specific macro event or volatility regime supports your timing? Why is NOW the right moment, and why not wait for clearer confirmation?"

**TECHNICAL ANALYST (${techAnalyst}):**
> "What EXACT pattern and Family classification are you trading? Why is this structure valid on THIS timeframe, and why not a lower-probability alternative?"

**RISK & EXECUTION SPECIALIST (${riskAnalyst}):**
> "What is the precise R:R ratio and Risk Grade? Why is this acceptable given Pattern Memory outcomes, and why not reduce size or pass?"

---

##  POST-PRESENTATION CHALLENGE PROTOCOL

After EVERY analyst presentation, apply this two-part challenge:

1. **"WHY?"** — "Justify your primary claim with specific, verifiable evidence."
2. **"WHY NOT?"** — "Why is the OPPOSITE bias (Long→Short or Short→Long) NOT valid here? What would invalidate your thesis?"

**The analyst MUST answer BOTH questions before proceeding.**

---

##  ANALYST INTERVENTION RULE

If ANY analyst believes the moderator made a flawed judgment or prematurely accepted weak evidence, that analyst MUST intervene:

> " INTERVENTION: I challenge the moderator's conclusion because [specific reason]. Evidence: [cite Pattern Memory entry or exact price level]. The moderator should reconsider before finalizing."

**The moderator MUST address interventions before issuing the final verdict.**

---

##  RIGOROUS DEFENSE REQUIREMENT

All parties (moderator AND analysts) MUST defend their positions until:
- Consensus is evidence-based (not assumption-based)
- All disagreements are resolved with data
- The BEST possible setup emerges

**If defense fails:**
- Downgrade confidence by one level
- If still undefended → Mark as "AVOID - Insufficient Evidence"

**PATTERN MEMORY ENFORCEMENT:**
- Each analyst MUST include: " PATTERN MEMORY CHECK: [Found/Not Found] similar setup"
- If found: "Historical outcome: [X wins / Y losses]"
- If NOT referenced: **Demand it before proceeding**

**FINAL VERDICT RULES:**
- If ANY analyst cannot defend their claim when challenged → Downgrade confidence
- If Pattern Memory shows losses for similar setups → Mark as "CONDITIONAL"
- If debate quality is low (vague answers, no citations) → Output "AVOID - Insufficient Evidence"
- Only output HIGH confidence if ALL analysts agree with evidence

---

##  LENS MODE FINAL VERDICT FORMAT

Your verdict MUST address all three domains:

**MACRO CHECK (${macroAnalyst}):** Macro Bias, Volatility Regime, Timing
**TECHNICAL CHECK (${techAnalyst}):** Pattern, Family, Entry Zone, Invalidation
**RISK CHECK (${riskAnalyst}):** R:R, Risk Grade, Failure Scenarios, Position Size

**FINAL DECISION:** [Synthesized verdict]

---

 **CRITICAL REMINDER:** After the debate, you MUST end with a complete **FINAL TRADE PLAN** markdown block (Coin, Direction, Entry, Stop Loss, Take Profit 1/2, Confidence, Probability, Strategy, Pattern Family, Support/Resistance).
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
    analystsResults: { analysis: TradeAnalysis, thoughtProcess?: string, finalOutput?: string }[],
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
            return typeof entry === 'string' ? parsePrice(entry) : entry;
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
 * Build the persisted consensus breakdown for the explainability panel:
 * each analyst's structured call (direction/entry/SL/TP/confidence/probability)
 * plus the pre-debate divergence analysis. Attached to the verdict analysis
 * by the pipeline (app-computed, never AI-generated) so the final call can be
 * audited against its own inputs — in the live card, history, and journal.
 */
/** Minimal analyst shape buildAnalystConsensus needs (RealDebateAnalyst
 *  satisfies it; tests may pass lighter fixtures). */
type ConsensusAnalyst = {
    provider: { config: { id: string }; name: string; thoughtsKey?: string };
    result: { analysis: TradeAnalysis };
};

export const buildAnalystConsensus = (
    analysts: ConsensusAnalyst[]
): AnalystConsensus | undefined => {
    if (analysts.length < 1) return undefined;
    const entries: AnalystConsensus['entries'] = analysts.map((a) => {
        const analysis = a.result.analysis;
        return {
            // thoughtsKey (provider::model) is the unique identity — two lens
            // roles on one provider previously collided under config.id, so
            // the panel showed the first role's call for both.
            providerId: a.provider.config.id,
            thoughtsKey: a.provider.thoughtsKey,
            displayName: a.provider.name,
            direction: analysis.direction,
            entry: analysis.entryPoints?.[0]?.price ? String(analysis.entryPoints[0].price) : undefined,
            stopLoss: analysis.stopLoss || undefined,
            takeProfit: analysis.takeProfit?.[0]?.price ? String(analysis.takeProfit[0].price) : undefined,
            confidence: analysis.confidence,
            probability: typeof analysis.probability === 'number' ? analysis.probability : undefined,
        };
    });
    const divergence = analyzePreDebateDivergence(
        analysts.map((a) => a.result),
        analysts.map((a) => a.provider.name)
    );
    return {
        entries,
        divergence: {
            score: divergence.score,
            isEchoChamber: divergence.isEchoChamber,
            divergenceType: divergence.divergenceType,
            details: divergence.details,
        },
    };
};

const noTrade = (direction?: string, confidence?: string): boolean =>
    confidence === 'Avoid' || direction === 'Neutral' || direction === 'Avoid';

export const attachVerdictCitations = (
    consensus: AnalystConsensus,
    verdict: TradeAnalysis,
): AnalystConsensus => {
    const citations = consensus.entries.map(entry => {
        const aligned = noTrade(verdict.direction, verdict.confidence)
            ? noTrade(entry.direction, entry.confidence)
            : (entry.direction || '').toLowerCase() === (verdict.direction || '').toLowerCase();
        return {
            displayName: entry.displayName,
            aligned,
            note: aligned
                ? `Tracked in verdict (${entry.direction || '—'})`
                : `Dissented ${entry.direction || '—'} vs ${verdict.direction}`,
        };
    });
    return { ...consensus, citations };
};

/** If nobody aligned with a directional call, the merge is an average — force Neutral. */
export const enforceCitedVerdict = <T extends { direction?: string; confidence?: string; originalConfidence?: string; validationWarnings?: string[] }>(
    verdict: T,
    consensus?: AnalystConsensus | null,
    keptName?: string | null,
): T => {
    if (noTrade(verdict.direction, verdict.confidence)) return verdict;
    const named = (keptName || '').trim().toLowerCase();
    if (named) {
        const cited = consensus?.citations?.some(c => c.aligned && c.displayName.toLowerCase() === named);
        if (cited || !consensus?.citations?.length) return verdict;
    }
    if (consensus?.citations?.some(c => c.aligned)) return verdict;
    return {
        ...verdict,
        originalConfidence: verdict.originalConfidence ?? verdict.confidence,
        direction: 'Neutral',
        confidence: 'Avoid',
        validationWarnings: [
            ...(verdict.validationWarnings ?? []),
            'Verdict had no cited analyst — forced Neutral (moderator must quote, not average).',
        ],
    };
};

/**
 * Generate a concise divergence summary for the moderator prompt.
 */
export const generateDivergenceContext = (
    analystsResults: { analysis: TradeAnalysis, thoughtProcess: string, finalOutput?: string }[],
    analystNames: string[]
): string => {
    const analysis = analyzePreDebateDivergence(analystsResults, analystNames);

    if (analysis.score === 0 && !analysis.isEchoChamber) {
        return '';
    }

    let context = `
        **🔍 PRE - DEBATE DIVERGENCE ANALYSIS **

            Divergence Score: ${analysis.score}/100 ${analysis.isEchoChamber ? ' LOW (Echo Chamber Risk)' : analysis.score > 50 ? ' HIGH' : ' MODERATE'}

${analysis.details.map(d => `- ${d}`).join('\n')}
    `;

    if (analysis.dissentProtocol) {
        context += '\n' + analysis.dissentProtocol;
    }

    return context.trim();
};

/**
 * Build a compact Bayesian calibration block for the moderator: each analyst's
 * RAW probability vs their history-calibrated probability (keyed by provider
 * ID — display names almost never match the byProvider map). Only analysts
 * with a numeric probability AND a meaningful shift (>5 points) are listed;
 * returns '' when there is no calibration data or nothing shifted.
 *
 * This is the LIVE-path equivalent of the calibration that used to live only
 * in the (dead) two/three-way debate generators — the real debate and the
 * accuracy-mode simulation never saw it, so historical accuracy never
 * influenced a moderator verdict.
 */
const buildCalibrationContext = (
    analysts: { name: string; providerId?: string; result: { analysis: TradeAnalysis } }[],
): string => {
    const calibrationData = GlobalLearningService.getCalibration();
    if (!calibrationData) return '';

    const lines: string[] = [];
    for (const analyst of analysts) {
        const rawProb = analyst.result.analysis.probability;
        if (typeof rawProb !== 'number' || isNaN(rawProb)) continue;
        const calibratedProb = getBayesianCalibratedConfidence(
            calibrationData,
            analyst.providerId || analyst.name,
            analyst.result.analysis.confidence as ConfidenceLevel,
            rawProb,
        );
        if (Math.abs(calibratedProb - rawProb) > 5) {
            lines.push(`- **${analyst.name}**: ${Math.round(rawProb)}% → ${Math.round(calibratedProb)}% (Bayesian calibrated from historical accuracy)`);
        }
    }
    if (lines.length === 0) return '';

    return `\n\n**BAYESIAN CONFIDENCE CALIBRATION (from the user's trade history):**\n${lines.join('\n')}\nPrefer the calibrated values as the more reliable probability reference.`;
};

/**
 * Accuracy-mode verification pass — the counterpart of the standard mode's
 * clarification loop. The autoplayed debate produces ONE moderator stream;
 * this second, focused call reviews the debate + the proposed plan and either
 * confirms it (<ACCURACY_CONFIRMED>) or returns a corrected plan
 * (<ACCURACY_ADJUST> + complete JSON). Fail-safe: any error degrades to
 * 'confirmed' so the moderator's plan is never discarded.
 */
export const verifyAccuracyPlan = async (
    moderatorConfig: ProviderConfig,
    moderatorModel: string,
    debateContent: string,
    planJson: string,
    signal?: AbortSignal,
    hybridContext?: string,
    trades?: LoggedTrade[],
): Promise<{ verdict: 'confirmed' | 'adjusted'; note: string; planJson?: string }> => {
    const prompt = `
**ROLE: ENSEMBLE DEBATE MODERATOR — ACCURACY VERIFICATION PASS**

The autoplayed debate below produced the attached trade plan. Before the plan is final:
1. Re-check the plan against the debate for contradictions, hallucinated price levels, or unsupported confidence.
2. Re-check the confidence against the anti-hallucination rule (>=70% requires all 7 conditions) and any Gate confidence cap.
3. If the plan is sound, output EXACTLY this and nothing else:
<ACCURACY_CONFIRMED>
4. If any level or the confidence needs correcting, output <ACCURACY_ADJUST> followed by the COMPLETE corrected plan as a single valid JSON object (same schema as the original), and NOTHING else.

${hybridContext ? `**LIVE CHART & PATTERN CONTEXT (VERIFIED):**
${hybridContext}
` : ''}
**THE DEBATE:**
${debateContent.slice(0, 8000)}

**THE PROPOSED PLAN (JSON):**
${planJson.slice(0, 6000)}
`;
    let text = '';
    try {
        for await (const chunk of getModeratorAnalysisStream(
            moderatorConfig, moderatorModel, prompt, signal,
            undefined, undefined, undefined,
            trades,
        )) {
            if (chunk) text += chunk;
        }
    } catch (e: any) {
        const isAbort = e?.name === 'AbortError' || e?.code === 'ABORT_ERR' || e?.name === 'TimeoutError';
        if (isAbort) throw e;
        console.warn('[AccuracyVerification] Pass failed; keeping the original plan:', e?.message || e);
        return { verdict: 'confirmed', note: '' };
    }

    // A provider failure arrives as a <MODERATOR_ERROR> marker instead of a
    // throw — treat it as a failed pass (keep the original plan, clean note)
    // so the raw marker never leaks into the chat bubble.
    if (/<MODERATOR_ERROR>/i.test(text)) {
        console.warn('[AccuracyVerification] Pass errored; keeping the original plan.');
        return { verdict: 'confirmed', note: '' };
    }

    if (/<ACCURACY_ADJUST>/i.test(text)) {
        try {
            const adjustedPlan = parseMarkdownTradePlan(text);
            if (adjustedPlan) {
                // Human note only — the raw corrected markdown must not become
                // the chat bubble text (the model was told to output the plan
                // after the marker and nothing else).
                return { verdict: 'adjusted', note: 'Plan adjusted by the accuracy pass.', planJson: text };
            }
        } catch {
            // fall through to the clean note below — never discard the plan
        }
        // Marker present but no parseable plan: return a clean note instead
        // of the raw body (which may contain a half-emitted plan) so the
        // malformed payload never leaks into the chat bubble.
        return { verdict: 'confirmed', note: 'Plan verified by the accuracy pass.' };
    }
    const note = text.replace(/<ACCURACY_(?:ADJUST|CONFIRMED)>/gi, '').trim();
    return { verdict: 'confirmed', note: note || 'Plan verified by the accuracy pass.' };
};

export const conductDebate = (
    analystsResults: { analysis: TradeAnalysis, thoughtProcess: string, finalOutput?: string }[],
    analystNames: string[],
    userPrompt: string,
    finalTradeSummary: string | null,
    subMode: AccuracySubMode = 'original',
    customInstructions: string | undefined,
    moderatorConfig: ProviderConfig,
    moderatorModel: string = '',
    isFamiliesEnabledInPureAI?: boolean,
    isMemoryEnabledInPureAI?: boolean,
    gateResult?: GateOutput | null, // Gate result for reconciliation
    tradeSummaries?: { id: string; summaryText: string; timestamp: string }[], // Recent Insights
    learningContext?: string, // NEW: Unified learning context from UnifiedLearningBuilder
    signal?: AbortSignal, // Cancellation for the moderator stream
    onReasoning?: (reasoning: string) => void,
    /** Provider IDs per analyst (calibration is keyed by provider ID). */
    analystProviders?: string[],
    /** Full chart/pattern context (hybrid data + user strategies) so the
     *  moderator sees the same chart the analysts see, not just the
     *  truncated user request. */
    hybridContext?: string,
    /** Analyst Lens config — the accuracy-mode moderator must see the same
     *  role context the standard-mode moderator gets (the old call dropped
     *  it, so Lenses + Accuracy ran with zero personas). */
    lensConfig?: AnalystLensConfig
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
        // Feed the moderator the analyst's prose reasoning (thoughtProcess),
        // not the machine JSON — the real-debate path already does this, and
        // the JSON form omits how the analyst actually reasoned.
        const analystProse = res.thoughtProcess || res.finalOutput || JSON.stringify(res.analysis);
        analystsInput += `\n**${analystNames[index].toUpperCase()} INITIAL ANALYSIS**:\n${truncateTextToTokens(analystProse, 800)}\n`;
    });

    // Dynamic Construction of Dialogue Instructions based on active analysts
    let dialogueInstructions = "";
    analystNames.forEach(name => {
        dialogueInstructions += `   - **${name}:** [Analysis based on role]\n`;
    });

    let systemPrompt: string;
    if (subMode === 'pure_ai') {
        systemPrompt = getPrompt('debate.moderator_pure_ai', PURE_AI_MODERATOR_PROMPT);

        if (isFamiliesEnabledInPureAI) {
            systemPrompt += `\n\n**IMPORTANT EXCEPTION:**\nThe user has explicitly ENABLED "Market Classification Families" for this Pure AI session.\nEven though this is Pure AI mode, you MUST classify the final trade setup into one of the following Families:\n${getPrompt('analysis.families', TRADING_FAMILIES_PROMPT)}\nEnsure the JSON output's 'detectedPatternFamily' field is set to 'Family A', 'Family B', 'Family C', or 'Family Omega'.\n`;
        }
    } else {
        systemPrompt = getPrompt('debate.moderator_autoplay', MODERATOR_SYSTEM_PROMPT_V2);
    }

    // Replace placeholders
    systemPrompt = systemPrompt.replace('{{ANALYSTS}}', analystNames.join(', '));
    systemPrompt = systemPrompt.replace('{{DIALOGUE_INSTRUCTIONS}}', dialogueInstructions);

    // Analyst Lens context for the accuracy-mode moderator — the analysts
    // received role prompts (GenericAnalysisService), so the moderator must
    // know who is who and what each role covers (was silently missing).
    if (lensConfig?.enabled && analystProviders && analystProviders.length > 0) {
        const lensContext = generateLensContext(
            analystNames,
            analystProviders,
            lensConfig,
            'full',
            lensConfig.tradingStyle === 'auto' ? 'swing' : lensConfig.tradingStyle
        );
        if (lensContext) systemPrompt += `\n\n${lensContext}`;
    }

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

    // --- PRE-DEBATE DIVERGENCE + BAYESIAN CALIBRATION ---
    // Same live-path treatment as conductRealDebate: echo-chamber warnings and
    // historical-accuracy calibration reach the moderator instead of only
    // existing in the (dead) two/three-way generators.
    const divergenceContext = generateDivergenceContext(analystsResults, analystNames);
    const calibrationContext = buildCalibrationContext(
        analystsResults.map((res, index) => ({
            name: analystNames[index] || `Analyst ${index + 1}`,
            providerId: analystProviders?.[index],
            result: res,
        })),
    );

    const finalPrompt = `
${systemPrompt}

${userOverride}

${marketDataOverride}

${hybridContext ? `\n**LIVE CHART & PATTERN CONTEXT (VERIFIED):**
${hybridContext}
` : ''}
${gateReconciliationContext}

${AI_CORE_SKILL_INJECTION}

${getPrompt('debate.probability_estimation', PROBABILITY_ESTIMATION_PROMPT)}

${learningContext || ''}

${divergenceContext}

${calibrationContext}

${getPrompt('debate.stress_test', STRESS_TEST_PROTOCOL)}

**SIMULATION INPUT DATA:**
User Request: "${safeUserPrompt}"
Global History: ${tradeHistoryContext}

${recentInsightsBlock}

${analystsInput}

**ACTION:**
Start the simulation now. Begin with <DEBATE_START>.
`;

    return getModeratorAnalysisStream(moderatorConfig, moderatorModel, finalPrompt, signal, onReasoning);
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
    analyst1Result: { analysis: TradeAnalysis, thoughtProcess: string, finalOutput?: string },
    analyst2Result: { analysis: TradeAnalysis, thoughtProcess: string, finalOutput?: string },
    analyst1Name: string,
    analyst2Name: string,
    userPrompt: string,
    finalTradeSummary: string | null,
    moderatorConfig: ProviderConfig,
    moderatorModel: string,
    customInstructions?: string,
    monteCarloResults?: { provider: string, result: any }[],
    lensConfig?: AnalystLensConfig,
    analystProviders?: string[],
    activeFrameworks?: string[],
    tradeSummaries?: { id: string; summaryText: string; timestamp: string }[],
    gateResult?: GateOutput | null, // Gate result for reconciliation
    learningContext?: string, // NEW: Unified learning context
    enabledProviders?: string[], // NEW: for weighted voting
    trades?: LoggedTrade[], // NEW: trade history for weighted voting
    signal?: AbortSignal, // Cancellation for the moderator stream
    onReasoning?: (reasoning: string) => void
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

    const tradeHistoryContext = finalTradeSummary ? `This is your Pattern Memory Library (a pre-processed summary of recent trades)...\n${truncateTextToTokens(finalTradeSummary, 3000)}` : "No past trades logged.";

    // --- BAYESIAN CONFIDENCE CALIBRATION ---
    // Fetch historical calibration data to adjust confidence scores
    // Live calibration (GlobalLearningService) — the raw
    // PREF_KEYS.CONFIDENCE_CALIBRATION preference is written by
    // ModelPerformanceService with a different shape, so reading it here
    // produced garbage. The singleton is the persisted source of truth.
    const calibrationData = GlobalLearningService.getCalibration();

    // Apply calibration to analyst results
    const calibratedAnalysts = [
        { name: analyst1Name, providerId: analystProviders?.[0], result: analyst1Result },
        { name: analyst2Name, providerId: analystProviders?.[1], result: analyst2Result }
    ].map(item => {
        const rawConf = item.result.analysis.confidence as ConfidenceLevel;
        const rawProb = item.result.analysis.probability || 0;

        let calibratedProb = rawProb;
        let calibrationNote = "";

        if (calibrationData) {
            calibratedProb = getBayesianCalibratedConfidence(
                calibrationData,
                // byProvider is keyed by PROVIDER ID (see
                // syncConfidenceCalibrationFromTradeLog); display names almost
                // never match, so calibration silently never applied. Prefer
                // the id, fall back to the display name.
                item.providerId || item.name,
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

    // --- WEIGHTED VOTING CONTEXT ---
    // Generate per-model performance context so the moderator weights stronger models higher
    const currentFamily2 = analyst1Result.analysis.detectedPatternFamily || '';
    const weightedVotingContext2 = enabledProviders && enabledProviders.length > 0
        ? generateWeightedVotingContext(enabledProviders, currentFamily2)
        : '';

    const moderatorSystemPrompt = `You are a Master Strategist moderating a high-stakes trading debate between ${analyst1Name} and ${analyst2Name}.


      ${userOverride}

      ${lensContext}

      ${marketDataOverride}

      ${confluenceContext}


      ${gateReconciliationContext}

      ${weightedVotingContext2}

      ${AI_CORE_SKILL_INJECTION}

      ${learningContext || ''}

      ${getPrompt('debate.stress_test', STRESS_TEST_PROTOCOL)}

      ${SCENARIO_EVALUATION_PROTOCOL}

      ${getPrompt('debate.verification', MODERATOR_VERIFICATION_ENFORCEMENT_PROMPT)}

      ${getPrompt('debate.probability_estimation', PROBABILITY_ESTIMATION_PROMPT)}

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
      - Use format: " FACT CHECK: [Analyst] claimed [X], but [my data shows Y]. Evidence: [specific proof]"
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

       **MANDATORY PATTERN MEMORY CHECK FOR ALL ANALYSTS:**
      Every analyst MUST answer: "Which of the Recent Insights is most similar to this setup, and what was the outcome?"
      ` : `
      During the debate, analysts MUST cover ALL of these analysis sections:
      - **Section 1: Multi-Timeframe Structure** - ${HARNESS_TIMEFRAME_LABEL} bias alignment
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
      ${getPrompt('analysis.families', TRADING_FAMILIES_PROMPT)}

      **MANDATORY RISK/REWARD RULE (ABSOLUTE):**
      - **R:R < 1.2 = MAX CONFIDENCE 54% (Grade D)**. NO EXCEPTIONS.
      - **R:R < 1.5 = MAX CONFIDENCE 69% (Grade C)**.
      - If the consensus setup is < 1.2 RR, you MUST mark the final verdict as **CONDITIONAL** on a better entry price.

      **CONSOLIDATED 7-ROUND DEBATE PROTOCOL:**
      
      **TRADE SETUP GRADE SCALE → CONFIDENCE MAPPING (MANDATORY):**
      | Grade | Confidence % | Criteria |
      |-------|--------------|----------|
      | **A** | 70%+ | R:R ≥ 2.0, the evidence supports a High confidence call, HTF+LTF aligned, Pattern Memory MATCH, Volume confirmed |
      | **B** | 55-69% | R:R ≥ 1.5, the evidence supports Medium confidence, with no unresolved hard conflict |
      | **C** | 40-54% | R:R ≥ 1.2, Some sections weak, Unclear invalidation |
      | **D** | 40-54% | R:R < 1.2, Missing sections, HTF conflict, Pattern Memory FAIL |
      | **F** | <40% / AVOID | No clear setup, High risk, Multiple red flags |
      
      **⚠️ ANTI-HALLUCINATION RULE (CRITICAL):**
      - You MUST NOT assign confidence ≥70% unless ALL of the following are TRUE:
        1. All required sections (or Lens roles) were thoroughly discussed and verified
        2. At least 3 timeframes align with the direction
        3. R:R ratio is mathematically calculated and ≥1.2
        4. Specific price levels for Entry/SL/TP are stated
        5. Pattern Memory was checked (match or no-match stated)
        6. **SL/TP Probabilities were estimated and justified**
      - If ANY of these are missing, cap confidence at 69% (Grade C) maximum
      - Hallucinated confidence = SYSTEM FAILURE. Be honest.
      
      ${DEBATE_CONFIDENCE_GOAL}
      
      ${DEBATE_QUALITY_MANDATE}
      
      1.  **<DEBATE_START>** (Start immediately with this tag)
      
      2.  **ROUND 1: ${lensConfig?.enabled ? 'THESIS PRESENTATION (SPECIALIZED LENS ROLES)' : 'THESIS PRESENTATION (ALL 8 SECTIONS REQUIRED)'}**
           ${lensConfig?.enabled ? `
          Each analyst presents their specialized thesis based on their ASSIGNED ROLE only:
          *   ${analyst1Name} (${lensConfig.assignments?.find(a => a.assignedProvider === (analystProviders?.[0] || analyst1Name.toLowerCase()))?.role || 'Analyst'}): [Present analysis focused strictly on your domain]
          *   ${analyst2Name} (${lensConfig.assignments?.find(a => a.assignedProvider === (analystProviders?.[1] || analyst2Name.toLowerCase()))?.role || 'Analyst'}): [Present analysis focused strictly on your domain]
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
      
      3.5 **ROUND 3: REFINEMENT LOOP (CONDITIONAL — REQUIRED IF GRADE < A/B)**
          *   **TRIGGER:** If the current consensus is Grade C, D, or F (Low/Medium confidence, weak R:R, unclear invalidation):
          *   Moderator: ${REFINEMENT_LOOP_SCRIPT}
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
          *   Moderator (if confidence > Gate Cap): ${GATE_CAP_CHALLENGE}
          *   ${GATE_CAP_CRITICAL}
      
      5.  **ROUND 5: NUMERIC CHART ANALYSIS (MANDATORY)**
          *   Moderator: ${CHART_VALIDATION_QUESTIONS}
          *   ${analyst1Name}: Chart validation (max 60 words) — must reference trend, regime, pattern
          *   ${analyst2Name}: Chart validation (max 60 words) — agree/disagree (respond concisely)
          *   Moderator: ${MTF_ALIGNMENT_CHECK_PROMPT}
          *   ${CHART_CONTRADICTION_CRITICAL}
      
      5.5 **ROUND 5.5: DUAL SCENARIO EVALUATION (MANDATORY - DO NOT SKIP)**
          *   Moderator: "⚖️ MANDATORY: Before proceeding, BOTH analysts must evaluate the ALTERNATIVE scenario."
          *   Moderator to ${analyst1Name}: "You favor [direction]. Define the OPPOSITE scenario: What trigger, confirmation, target, and invalidation would make the opposite direction correct?"
          *   ${analyst1Name}: Defines opposite scenario with specific price levels (max 60 words)
          *   Moderator to ${analyst2Name}: "Same question - define the scenario you're NOT taking. What would prove you wrong?"
          *   ${analyst2Name}: Defines opposite scenario with specific price levels (max 60 words)
          *   Moderator: "Now COMPARE: Which scenario has stronger evidence? Why is [selected direction] more likely than [opposite]?"
          *   ${DUAL_SCENARIO_CRITICAL}
      
      6.  **ROUND 6: STATISTICAL REALITY CHECK (MONTE CARLO & AI PROBABILITY)**
          *   Moderator: "${MONTE_CARLO_RECONCILIATION_PROMPT}"
          *   ${analyst1Name}: Statistical reconciliation (max 50 words)
          *   ${analyst2Name}: Statistical reconciliation (max 50 words)

      7.  **ROUND 7: FINAL RESOLUTION** (If disagreement persists)
          *   If analysts STILL disagree on DIRECTION or KEY LEVELS:
              - Moderator: ${FINAL_RESOLUTION_PROMPT}
              - ${analyst1Name}: Final defense (max 60 words)
              - ${analyst2Name}: Final defense (max 60 words)
          *   **If consensus reached in Round 2, skip to Round 8.**

      8.  **ROUND 8: RED TEAM STRESS TEST**
          *   Moderator (Devil's Advocate): ${RED_TEAM_QUESTION}
          *   ${analyst1Name}: Failure scenario (max 40 words)
          *   ${analyst2Name}: Failure scenario (max 40 words)
      
      9.  **ROUND 9: SETUP VALIDITY WINDOW (MANDATORY)**
          *   Moderator: ${VALIDITY_WINDOW_PROMPT}
          *   ${analyst1Name}: Propose validity (e.g., "4h 30m because...") (max 40 words)
          *   ${analyst2Name}: Agree/disagree with counter-reasoning (max 40 words)
          *   Moderator: Synthesize and state final validity in format "Xh Ym"
          
          **VALIDITY GUIDELINES:**
          ${VALIDITY_GUIDELINES}
      
      10.  **</DEBATE_END>**

      11.  **MODERATOR FINAL VERDICT (REQUIRED & STRUCTURED)**
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

      12.  **FINAL TRADE PLAN (MARKDOWN — LAST THING IN YOUR RESPONSE)**
          
          *   Only AFTER the complete text verdict, output the final trade plan as MARKDOWN — labeled bullet lines, NO JSON anywhere.
          *   **CRITICAL:** The plan block must be the ABSOLUTE LAST THING in your response.
          *   **CRITICAL:** Use actual price values, not "..." placeholders.
          *   **CRITICAL:** Keep every field on ONE line — the harness parses these labels.
          
          **EXACT FORMAT REQUIRED:**
${MASTER_TRADE_PLAN_MARKDOWN}

      **FORMATTING RULES:**
      *   Use strict "Speaker:" format (e.g. "${analyst1Name}:", "Moderator:", "Moderator to ${analyst1Name}:").
      *   Do NOT bold speaker names.
      *   Ensure each analyst gets their OWN dedicated turn - do not combine responses.
      *   Keep individual responses concise (max 120 words each) to fit all turns.

      **INPUT DATA:**
      Request: "${truncateTextToTokens(userPrompt, 1500)}"
      History: ${tradeHistoryContext}
      ${mcContext}

      **${analyst1Name.toUpperCase()} INITIAL OUTPUT**: ${truncateTextToTokens(analyst1Result.finalOutput || analyst1Result.thoughtProcess, 1000)} ${calibratedAnalysts[0].calibrationNote}
      **${analyst2Name.toUpperCase()} INITIAL OUTPUT**: ${truncateTextToTokens(analyst2Result.finalOutput || analyst2Result.thoughtProcess, 1000)} ${calibratedAnalysts[1].calibrationNote}

      
      Start with <DEBATE_START> now.`;

    yield* getModeratorAnalysisStream(moderatorConfig, moderatorModel, moderatorSystemPrompt, signal, onReasoning);
};

export const conductThreeWayDebate = async function* (
    analyst1Result: { analysis: TradeAnalysis, thoughtProcess: string, finalOutput?: string },
    analyst2Result: { analysis: TradeAnalysis, thoughtProcess: string, finalOutput?: string },
    analyst3Result: { analysis: TradeAnalysis, thoughtProcess: string, finalOutput?: string },
    analyst1Name: string,
    analyst2Name: string,
    analyst3Name: string,
    userPrompt: string,
    finalTradeSummary: string | null,
    moderatorConfig: ProviderConfig,
    moderatorModel: string,
    customInstructions?: string,
    trades?: LoggedTrade[],
    enabledProviders?: string[],
    monteCarloResults?: { provider: string, result: any }[],
    lensConfig?: AnalystLensConfig,
    analystProviders?: string[],
    activeFrameworks?: string[],
    tradeSummaries?: { id: string; summaryText: string; timestamp: string }[],
    gateResult?: GateOutput | null, // Gate result for reconciliation
    learningContext?: string, // NEW: Unified learning context
    signal?: AbortSignal, // Cancellation for the moderator stream
    onReasoning?: (reasoning: string) => void
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
    const tradeHistoryContext = finalTradeSummary ? `This is your Pattern Memory Library (a pre-processed summary of recent trades)...\n${truncateTextToTokens(finalTradeSummary, 3000)}` : "No past trades logged.";

    // --- BAYESIAN CONFIDENCE CALIBRATION ---
    // Live calibration (GlobalLearningService) — the raw
    // PREF_KEYS.CONFIDENCE_CALIBRATION preference is written by
    // ModelPerformanceService with a different shape, so reading it here
    // produced garbage. The singleton is the persisted source of truth.
    const calibrationData = GlobalLearningService.getCalibration();

    const calibratedAnalysts = [
        { name: analyst1Name, providerId: analystProviders?.[0], result: analyst1Result },
        { name: analyst2Name, providerId: analystProviders?.[1], result: analyst2Result },
        { name: analyst3Name, providerId: analystProviders?.[2], result: analyst3Result }
    ].map(item => {
        const rawConf = item.result.analysis.confidence as ConfidenceLevel;
        const rawProb = item.result.analysis.probability || 0;

        let calibratedProb = rawProb;
        let calibrationNote = "";

        if (calibrationData) {
            calibratedProb = getBayesianCalibratedConfidence(
                calibrationData,
                // byProvider is keyed by PROVIDER ID — see conductTwoWayDebate.
                item.providerId || item.name,
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

            // Map analyst display names to dynamic provider ids
            const nameToProvider: Record<string, string> = {};
            [analyst1Name, analyst2Name, analyst3Name].forEach((name, idx) => {
                const id = analystProviders?.[idx];
                if (id) nameToProvider[name] = id;
            });

            const enhanced = generateEnhancedDebateContext(
                analyses,
                trades,
                enabledProviders,
                'ranging' as MarketRegime, // Default regime
                currentCoin,
                currentPattern,
                null,
                nameToProvider
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


${gateReconciliationContext}

${AI_CORE_SKILL_INJECTION}

${learningContext || ''}

${getPrompt('debate.stress_test', STRESS_TEST_PROTOCOL)}

${SCENARIO_EVALUATION_PROTOCOL}

${getPrompt('debate.verification', MODERATOR_VERIFICATION_ENFORCEMENT_PROMPT)}

${getPrompt('debate.probability_estimation', PROBABILITY_ESTIMATION_PROMPT)}

${mcContext}

Your role is to remain COMPLETELY UNBIASED while eliminating ambiguity, extracting the strongest logic, and producing a final, trade-ready verdict.
**CRITICAL: Each AI provider gets their own dedicated turn. Never combine or skip analyst responses.**

---------------------------------------------------------
 OBJECTIVE:
Orchestrate a rigorous, multi-turn debate where EACH analyst gets their own turn in every round. If analysts disagree, they must be given additional turns to respond and defend their positions.

 **CRITICAL: UNBIASED MODERATOR PROTOCOL**
- You must NOT favor any analyst over another
- Question ALL THREE parties with EQUAL rigor
- If disagreement persists, give EACH analyst a dedicated rebuttal turn
- Continue probing until genuine consensus OR clear irreconcilable divergence
- Your role is to EXTRACT TRUTH, not to pick a winner

**⚠️ CROSS-PROVIDER FACT-CHECKING (MANDATORY):**
Every analyst MUST actively verify and challenge other analysts' claims:
- If an analyst detects MISLEADING INFORMATION from another provider, they MUST flag it immediately
- Use format: " FACT CHECK: [Analyst] claimed [X], but [my data shows Y]. Evidence: [specific proof]"
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

 **MANDATORY PATTERN MEMORY CHECK FOR ALL ANALYSTS:**
Every analyst MUST answer: "Which of the Recent Insights is most similar to this setup, and what was the outcome?"
` : `
During the debate, analysts MUST cover ALL of these analysis sections:
- **Section 1: Multi-Timeframe Structure** - ${HARNESS_TIMEFRAME_LABEL} bias alignment
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
Strictly enforce "Market Classification Families" (A, B, C, Omega).
- Ask EACH participant: "What Family does this belong to? Prove it."
- Require evidence from ALL analysts, not just one.

**FAMILY DEFINITIONS:**
${getPrompt('analysis.families', TRADING_FAMILIES_PROMPT)}

 **MANDATORY RISK/REWARD RULE:**
An actionable trade should offer R:R of at least 1:1.2. If RR < 1.2, mark it **CONDITIONAL** or **AVOID**; never force levels into a no-trade verdict.
---------------------------------------------------------

##  CONSOLIDATED 7-ROUND DEBATE PROTOCOL

**TRADE SETUP GRADE SCALE → CONFIDENCE MAPPING (MANDATORY):**
| Grade | Confidence % | Criteria |
|-------|--------------|----------|
| **A** | 70%+ | R:R ≥ 2.0, the evidence supports a High confidence call, HTF+LTF aligned, Pattern Memory MATCH, Volume confirmed |
| **B** | 55-69% | R:R ≥ 1.5, the evidence supports Medium confidence, with no unresolved hard conflict |
| **C** | 40-54% | R:R ≥ 1.2, Some sections weak, Unclear invalidation |
| **D** | 40-54% | R:R < 1.2, Missing sections, HTF conflict, Pattern Memory FAIL |
| **F** | <40% / AVOID | No clear setup, High risk, Multiple red flags |

**⚠️ ANTI-HALLUCINATION RULE (CRITICAL):**
- You MUST NOT assign confidence ≥70% unless ALL of the following are TRUE:
  1. All required sections (or Lens roles) were thoroughly discussed and verified
  6. Numeric Chart Analysis was completed (trend maturity, regime, pattern validation)
  2. At least 3 timeframes align with the direction
  3. R:R ratio is mathematically calculated and ≥1.2
  4. Specific price levels for Entry/SL/TP are stated
  5. Pattern Memory was checked (match or no-match stated)
  7. **SL/TP Probabilities were estimated and justified**
- If ANY of these are missing, cap confidence at 69% (Grade C) maximum
- Hallucinated confidence = SYSTEM FAILURE. Be honest.

${DEBATE_CONFIDENCE_GOAL}

${DEBATE_QUALITY_MANDATE}

### 1. Start Debate
Begin immediately with:
<DEBATE_START>

---

### 2. ROUND 1 — ${lensConfig?.enabled ? 'THESIS PRESENTATION (SPECIALIZED LENS ROLES)' : 'THESIS PRESENTATION (ALL 8 SECTIONS REQUIRED)'}
${lensConfig?.enabled ? `
Each analyst presents their specialized thesis based on their ASSIGNED ROLE only:
**${analyst1Name} (${lensConfig.assignments?.find(a => a.assignedProvider === (analystProviders?.[0] || analyst1Name.toLowerCase()))?.role || 'Analyst'}):** [Present analysis focused strictly on your domain]
**${analyst2Name} (${lensConfig.assignments?.find(a => a.assignedProvider === (analystProviders?.[1] || analyst2Name.toLowerCase()))?.role || 'Analyst'}):** [Present analysis focused strictly on your domain]
**${analyst3Name} (${lensConfig.assignments?.find(a => a.assignedProvider === (analystProviders?.[2] || analyst3Name.toLowerCase()))?.role || 'Analyst'}):** [Present analysis focused strictly on your domain]
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
**Moderator:** ${REFINEMENT_LOOP_SCRIPT}
**${analyst1Name}:** Provides specific upgrade conditions (max 50 words)
**${analyst2Name}:** Confirms or proposes alternative (max 50 words)
**${analyst3Name}:** Final synthesis on upgrade path (max 50 words)
**LOOP:** Repeat questioning until Grade A/B is achieved OR trade is marked AVOID.

---

${gateResult ? `
### 4. ROUND 3 — GATE SCAN RECONCILIATION (MANDATORY)
**Moderator:** "The Two-Stage Gate Scan has analyzed this symbol BEFORE this debate. Here are the findings:
- Confidence Cap: ${Math.round((gateResult.confidenceCap ?? 1) * 100)}%
- Penalties Applied: ${[
                    gateResult.confidencePenalties?.dataIntegrity ? `data integrity ${Math.round(gateResult.confidencePenalties.dataIntegrity * 100)}%` : '',
                    gateResult.confidencePenalties?.patternMemory ? `pattern memory ${Math.round(gateResult.confidencePenalties.patternMemory * 100)}%` : '',
                    gateResult.confidencePenalties?.htfConflict ? `HTF conflict ${Math.round(gateResult.confidencePenalties.htfConflict * 100)}%` : '',
                    gateResult.confidencePenalties?.volumeContext ? `volume ${Math.round(gateResult.confidencePenalties.volumeContext * 100)}%` : '',
                ].filter(Boolean).join(', ') || 'None'}
- Family Bias: ${gateResult.familyBias?.reasoning?.join('; ') || 'None'}
- Warnings: ${gateResult.warnings?.length ? gateResult.warnings.join('; ') : 'None'}

${analyst1Name}, explain how your thesis aligns with OR addresses these Gate findings."
**${analyst1Name}:** Responds to Gate findings (max 60 words)
**${analyst2Name}:** Agrees/disagrees, addresses Gate findings (max 60 words)
**${analyst3Name}:** Final perspective on Gate alignment (max 60 words)
` : `
### 4. ROUND 3 — GATE SCAN (SKIPPED)
**Moderator:** "No Gate Scan data is available for this run. Do NOT invent gate findings — proceed to the statistical review."
`}
**Moderator (if any confidence exceeds Gate cap):** ${GATE_CAP_CHALLENGE}
${GATE_CAP_CRITICAL}

---

### 5. ROUND 4 — STATISTICAL REALITY CHECK (MONTE CARLO & AI PROBABILITY)
**Moderator:** "${MONTE_CARLO_RECONCILIATION_PROMPT}"
**${analyst1Name}:** Statistical reconciliation (max 40 words)
**${analyst2Name}:** Statistical reconciliation (max 40 words)
**${analyst3Name}:** Statistical reconciliation (max 40 words)

---

### 5.5 ROUND 4.5 — NUMERIC CHART ANALYSIS (MANDATORY)
**Moderator:** ${CHART_VALIDATION_QUESTIONS}
**${analyst1Name}:** Chart validation (max 50 words) — must reference trend, regime, pattern
**${analyst2Name}:** Chart validation (max 50 words) — agree/disagree with chart interpretation
**${analyst3Name}:** Chart validation (max 50 words) — synthesize chart data consensus
**Moderator:** ${MTF_ALIGNMENT_CHECK_PROMPT}
${CHART_CONTRADICTION_CRITICAL}

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
${DUAL_SCENARIO_CRITICAL}

---

### 6. ROUND 5 — FINAL RESOLUTION (Only if disagreement persists)
If analysts STILL disagree on DIRECTION or KEY LEVELS:
- Moderator: ${FINAL_RESOLUTION_PROMPT}
- **${analyst1Name}:** Final defense (max 50 words)
- **${analyst2Name}:** Final defense (max 50 words)
- **${analyst3Name}:** Final defense (max 50 words)

**If consensus reached in Round 2, skip to Round 6.**

---

### 7. ROUND 6 — RED TEAM STRESS TEST
**Moderator (Devil's Advocate):** ${RED_TEAM_QUESTION}
**${analyst1Name}:** Failure scenario (max 40 words)
**${analyst2Name}:** Failure scenario (max 40 words)
**${analyst3Name}:** Failure scenario (max 40 words)

---

### 8. ROUND 7 — SETUP VALIDITY WINDOW (MANDATORY)
**Moderator:** ${VALIDITY_WINDOW_PROMPT}
**${analyst1Name}:** Propose validity (e.g., "4h 30m because...") (max 40 words)
**${analyst2Name}:** Agree/disagree with counter-reasoning (max 40 words)
**${analyst3Name}:** Final proposal with synthesis (max 40 words)
**Moderator:** State final validity in format "Xh Ym"

**VALIDITY GUIDELINES:**
${VALIDITY_GUIDELINES}

---

### 9. End Debate
Close with:
</DEBATE_END>

##  10. MODERATOR FINAL VERDICT (REQUIRED)
Immediately after </DEBATE_END>, write:

### **Moderator Final Verdict:**

**CRITICAL:** Your verdict must reflect the WEIGHT OF EVIDENCE from all 3 analysts, not just the majority.

**Direction:** [Long / Short / Neutral]
**Entry Zone:** [Specific Price Range, or omit for Avoid]
**Stop Loss:** [Specific Price, or omit for Avoid]
**Take Profit:** [Target 1, Target 2, or omit for Avoid]
**Estimated R:R:** [Value, or N/A for Avoid]
**Confidence:** [High/Medium/Low/Avoid] (Probability: XX%)
**Validity Window:** [Xh Ym] — [Brief reasoning why this duration]

**Detailed Analysis:**
[Synthesize: 1) Which evidence was most compelling, 2) How disagreements were resolved, 3) Family Classification, 4) Pattern Memory alignment. Do not stop mid-sentence.]

---

##  11. FINAL TRADE PLAN (MARKDOWN — LAST THING IN YOUR RESPONSE)

Only **after** writing the complete text verdict, output the final trade plan as MARKDOWN — labeled bullet lines, NO JSON anywhere.
- The plan block must be the ABSOLUTE LAST thing in your response
- Use actual price values, not "..." placeholders
- Keep every field on ONE line — the harness parses these labels

**EXACT FORMAT REQUIRED:**
${MASTER_TRADE_PLAN_MARKDOWN}

---

##  FORMATTING RULES
- Use strict **Speaker:** format (e.g., "Moderator:", "Moderator to ${analyst1Name}:", "${analyst1Name}:").
- Do **NOT** bold speaker names.
- Ensure EACH analyst gets their OWN dedicated turn - do not combine responses.
- Keep individual responses concise (max 100 words each) to fit all turns.

**⚠️ CRITICAL: DUAL SCENARIO IS PART OF THE VERDICT PROSE**
The "Dual Scenario Analysis" (bullish trigger/confirmation/target/invalidation vs bearish) must appear in your verdict PROSE — both scenarios with concrete levels, and which one you selected and why. A missing scenario or vague levels will be treated as an incomplete verdict.

**⚠️ CRITICAL: INVALIDATION CRITERIA ARE MANDATORY**
The plan's **Invalidation** line must state 2-4 conditions that kill the selected setup. Your plan will be treated as incomplete if:
- The array is missing or empty
- No "price" category criterion with a concrete level is present

---

##  INPUT DATA
Request: "${truncateTextToTokens(userPrompt, 1500)}"

History:  
${tradeHistoryContext}

**${analyst1Name.toUpperCase()} INITIAL OUTPUT:**
${truncateTextToTokens(analyst1Result.finalOutput || analyst1Result.thoughtProcess, 1500)} ${calibratedAnalysts[0].calibrationNote}

**${analyst2Name.toUpperCase()} INITIAL OUTPUT:**
${truncateTextToTokens(analyst2Result.finalOutput || analyst2Result.thoughtProcess, 1500)} ${calibratedAnalysts[1].calibrationNote}

**${analyst3Name.toUpperCase()} INITIAL OUTPUT:**
${truncateTextToTokens(analyst3Result.finalOutput || analyst3Result.thoughtProcess, 1500)} ${calibratedAnalysts[2].calibrationNote}

Start with <DEBATE_START> now.
`;


    yield* getModeratorAnalysisStream(moderatorConfig, moderatorModel, moderatorSystemPrompt, signal, onReasoning);
};

// =============================================================================
// REAL INTER-MODEL DEBATE
// =============================================================================

/**
 * Number of genuine rebuttal rounds that run after the opening statements.
 * Each round calls every analyst AGAIN on its own provider (in parallel), so
 * the analysts actually respond to each other instead of one moderator
 * autoplaying the entire transcript.
 */
export const REAL_DEBATE_RESPONSE_ROUNDS = 2;
/**
 * Protocol A/B lane: which debate protocol this run uses.
 *  - 'standard'  — current behavior: 2 rebuttal rounds, devil rotation on,
 *                  clarification cycles allowed (MAX_CLARIFICATION_CYCLES).
 *  - 'extended'  — one extra rebuttal round for harder setups.
 *  - 'efficient' — devil round only when the floor disagrees; no clarifications.
 * The chosen protocol rides runStats.promptVersion so outcomes can be
 * attributed per-protocol alongside the prompt-lane A/B.
 */
export type DebateProtocol = 'standard' | 'extended' | 'efficient';
/**
 * Protocol assignment is DETERMINISTIC — hashed from the
 * setup (symbol + prompt + roster), so the same trade idea always runs the
 * same structure. The old Math.random() draw made verdicts on identical
 * setups incomparable, silently changed debate length run-to-run, and made
 * engine tests flake (call-count assertions needed a Math.random pin).
 * Distribution is preserved in aggregate: a uniform hash over the key space
 * still lands ~60/20/20 across many DIFFERENT setups, while any single
 * setup stays reproducible. `rate` keeps the API for tests.
 */
export const assignDebateProtocol = (
    rate = 0.2,
    seed?: string,
): DebateProtocol => {
    const key = seed ?? lastProtocolSeedRef.key;
    // No seed (engine tests, direct generator calls) → the CONTROL lane,
    // deterministically. Only seeded real debates spread across lanes.
    if (!key) {
        lastDebateProtocol = 'standard';
        return 'standard';
    }
    let h = 2166136261 >>> 0;
    const text = `${key}|${Math.floor(Date.now() / DEBATE_PROTOCOL_EPOCH_MS)}`;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
    }
    const r = (h % 1000) / 1000;
    const p: DebateProtocol = r < rate ? 'extended' : r < rate * 2 ? 'efficient' : 'standard';
    lastDebateProtocol = p;
    return p;
};
/** The most recently assigned protocol (read by the pipeline for runStats). */
let lastDebateProtocol: DebateProtocol = 'standard';
export const getLastDebateProtocol = (): DebateProtocol => lastDebateProtocol;
/**
 * Per-debate protocol seed. conductRealDebate calls setProtocolSeed()
 * with the setup identity before assigning; when unset the assignment falls
 * back to a time-bucketed key (still deterministic within an epoch hour).
 */
export const DEBATE_PROTOCOL_EPOCH_MS = 60 * 60_000;
const lastProtocolSeedRef: { key: string } = { key: '' };
export const setProtocolSeed = (seed: string): void => {
    lastProtocolSeedRef.key = seed;
};

/** Wall-clock budget for the whole real debate — see conductRealDebate. */
export const DEBATE_DEFAULT_TIMEOUT_MS = 8 * 60_000;

/**
 * Maximum number of moderator clarification cycles that run AFTER the rebuttal
 * rounds (1-3) and BEFORE the verdict. Each cycle = moderator questions →
 * analyst answers → moderator satisfaction judgment. The first cycle always
 * runs; repeats are capped here (3 total = 1 initial + up to 2 extra rounds).
 * After the cap the moderator must proceed to the verdict regardless.
 */
export const MAX_CLARIFICATION_CYCLES = 3;

/** An analyst participating in the real debate — the provider is needed to re-call it between rounds. */
export interface RealDebateAnalyst {
    provider: { config: ProviderConfig; name: string; model: string; thoughtsKey: string };
    result: { thoughtProcess: string; finalOutput: string; analysis: TradeAnalysis };
}

/**
 * Recover the public opening statement from an analyst result WITHOUT ever
 * flooring the raw chain-of-thought. `finalOutput` is already peeled during
 * the analysis phase; when it is empty we fall back to the thoughtProcess
 * and peel a leaked scratchpad so only a genuine public answer (if any)
 * reaches the floor. The leftover thinking is returned so callers can route
 * it to the reasoning side-channel instead of the visible reply.
 */
export const openingFromResult = (result: { finalOutput?: string; thoughtProcess?: string }): { opening: string; thinking: string } => {
    const finalOutput = (result.finalOutput || '').trim();
    const thought = (result.thoughtProcess || '').trim();
    if (finalOutput) return { opening: finalOutput, thinking: thought };
    if (thought) {
        const recovered = stripLeakedScratchpad(thought);
        if (recovered.visible.trim()) {
            return { opening: recovered.visible.trim(), thinking: recovered.leaked.trim() || thought };
        }
    }
    return { opening: 'No opening statement provided.', thinking: thought };
};

/** How long the debate waits for the user to pick a replacement analyst before continuing without one. */
export const DEBATE_REPLACEMENT_WAIT_MS = 60_000;

/** Outcome of a bounded replacement wait. */
export type ReplacementWaitResult<T> =
    | { status: 'resolved'; value: T }
    | { status: 'timedOut' };

/**
 * Resolve `promise` unless the caller aborts (rejects with AbortError) or the
 * wait budget elapses (resolves `{ status: 'timedOut' }`). Used to suspend the
 * debate while the UI asks the user for a mid-debate analyst replacement
 * without holding the round open forever. The consumer's pending promise is
 * NOT cancelled on timeout — the generator emits a timeout marker so the
 * consumer abandons the wait itself (a late user click must never inject a
 * phantom analyst into a debate that already moved on).
 */
export const awaitReplacementWithTimeout = async <T>(
    promise: Promise<T>,
    signal: AbortSignal | undefined,
    timeoutMs: number,
): Promise<ReplacementWaitResult<T>> => {
    return new Promise<ReplacementWaitResult<T>>((resolve, reject) => {
        let settled = false;
        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        const onAbort = (): void => {
            if (settled) return;
            settled = true;
            if (timeoutId) clearTimeout(timeoutId);
            const err = new Error('Aborted');
            err.name = 'AbortError';
            reject(err);
        };
        if (timeoutMs > 0) {
            timeoutId = setTimeout(() => {
                if (settled) return;
                settled = true;
                if (signal) signal.removeEventListener('abort', onAbort);
                resolve({ status: 'timedOut' });
            }, timeoutMs);
        }
        if (signal) {
            if (signal.aborted) {
                onAbort();
                return;
            }
            signal.addEventListener('abort', onAbort, { once: true });
        }
        promise.then(
            (value) => {
                if (settled) return;
                settled = true;
                if (timeoutId) clearTimeout(timeoutId);
                if (signal) signal.removeEventListener('abort', onAbort);
                resolve({ status: 'resolved', value });
            },
            (err) => {
                if (settled) return;
                settled = true;
                if (timeoutId) clearTimeout(timeoutId);
                if (signal) signal.removeEventListener('abort', onAbort);
                reject(err);
            },
        );
    });
};

/**
 * Streaming event emitted by conductRealDebate. `text` is a DELTA chunk —
 * the consumer accumulates it per (speaker, round). Rounds:
 * 1 = opening statements, 2..REAL_DEBATE_RESPONSE_ROUNDS+1 = rebuttals,
 * then clarification cycles (question round + answer round each), and the
 * LAST round = moderator verdict (speaker 'Moderator').
 */
export interface RealDebateTurnEvent {
    speaker: string;
    round: number;
    text: string;
    /** Native CoT for THIS turn only (reasoning side-channel). */
    reasoning?: string;
    /** When the underlying provider call was LAUNCHED (first delta carries
     *  it) — lets the consumer compute real time-to-first-token. */
    startedAt?: string;
}

/**
 * Build a "live price refresh" context block for a debate round. When the
 * live feed knows TODAY's price, the round's prompt tells the model the
 * market may have moved since the original snapshot so it weighs the
 * current price against the setup levels instead of arguing over a stale
 * price. Returns '' when no live price is available (graceful no-op).
 * Pure — exported for tests.
 */
export const buildLivePriceRefreshBlock = (price: number | null | undefined, label: string): string => {
    if (!price || !isFinite(price) || price <= 0) return '';
    return (
        `\n\n**LIVE PRICE REFRESH (${label}):** $${price.toLocaleString('en-US', { maximumFractionDigits: 2 })} — ` +
        `the market may have moved since the original snapshot; weigh TODAY's price against the setup levels in your response.`
    );
};


// Machine-readable markers emitted by the clarification phase. The questions
// call may short-circuit with <CLARIFICATION_DONE>; the (internal) judgment
// call outputs one of the SATISFIED/UNSATISFIED markers.
import { turnAddressedTo } from '../../utils/debateReplyTo';

const CLARIFICATION_MARKERS = CLARIFICATION_MARKERS_RE; // single home: constants/debateMarkers

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Who is on the Floor this turn — stops models treating harness/Moderator text as a new trader request. */
const buildFloorOrientation = (opts: {
    selfName: string;
    otherAnalysts: string[];
    turn: 'rebuttal' | 'clarification';
    round: number;
}): string => {
    const others = opts.otherAnalysts.filter(Boolean).join(', ') || 'none';
    const thisTurn = opts.turn === 'clarification'
        ? `This turn: the **Moderator** (Master Strategist) is asking **you (${opts.selfName})**. Reply to the Moderator. Do not treat the Moderator as the trader.`
        : `This turn: Round ${opts.round} rebuttal among analysts. Address the other seats' claims. The Moderator is not speaking this turn.`;
    return [
        '**FLOOR ORIENTATION:**',
        `- You are **${opts.selfName}**, an analyst on the August Floor.`,
        `- Other analysts: ${others}.`,
        '- **Moderator** = Master Strategist (another Floor speaker). **Trader** = the person who submitted the original chart/request in Round 1.',
        '- The chat "user" role is August\'s debate harness — not the trader and not the Moderator.',
        `- ${thisTurn}`,
        '- Never start from "the user is asking" or "analyze user input". A Moderator question is not a new trading request. The only trader speech after Round 1 is a **USER STEERING** note, if present.',
        '- ROUTING: end your turn with ONE line "REPLY-TO: <names or all>" naming exactly who should read it (Moderator and/or specific analysts). Seats you do not name will NOT see this turn. Use "REPLY-TO: all" for floor-wide statements.',
    ].join('\n');
};

/**
 * Extract the clarifying question addressed to a specific analyst. The
 * moderator prefixes each question with a speaker label (provider name or
 * lens role short name, e.g. "**Macro:**"). The section terminates only at
 * the NEXT known speaker's label — the old lookahead stopped at ANY line
 * ending in a colon, truncating questions that mention levels
 * ("Target: 94k"), and it didn't know lens short names (every analyst then
 * fell back to the whole question block).
 */
/**
 * Confidence auction (B3): extract each seat's sealed `CONVICTION: <0-100>`
 * line from its final rebuttal and build the moderator-facing distribution
 * block. Only the Moderator sees all convictions together; seats never see
 * each other's. Returns '' when no seat reported a conviction.
 */
export const buildConvictionAuctionBlock = (roundTexts: Record<string, string[]>, names: string[], finalRound: number): string => {
    const rows: { name: string; value: number }[] = [];
    for (const name of names) {
        const text = roundTexts[name]?.[finalRound] || '';
        const m = text.match(/CONVICTION:\s*(\d{1,3})/i);
        if (!m) continue;
        const v = Math.min(100, Math.max(0, parseInt(m[1], 10)));
        rows.push({ name, value: v });
    }
    if (rows.length === 0) return '';
    const values = rows.map(r => r.value);
    const spread = Math.max(...values) - Math.min(...values);
    const lines = rows.map(r => `- ${r.name}: ${r.value}/100`);
    return [
        "**SEALED CONVICTION AUCTION (each seat's private 0-100 conviction in its own stance):**",
        ...lines,
        spread <= 10
            ? `Tight distribution (spread ${spread}) — the floor genuinely agrees.`
            : `Wide distribution (spread ${spread}) — the floor does NOT agree. If you side with an outlier, you MUST explain why it outranks the pack.`,
    ].join('\n');
};

/**
 * Seat-trust weighting: the moderator sees each seat's historical
 * calibration (Brier score, overconfidence gap) and its average sealed
 * conviction from stored debates. Seats with proven track records get
 * explicitly flagged as more trustworthy; overconfident seats get a
 * discount instruction. Data comes from the trade log — no new plumbing.
 */
export const buildSeatTrustBlock = (
    names: string[],
    providerIdBySeat: Record<string, string | undefined>,
    trades?: { debateTurns?: { speaker: string; text: string }[]; moderatorProvider?: string }[],
): string => {
    let calibrations: ReturnType<typeof getCalibrationSummaries>;
    try {
        calibrations = getCalibrationSummaries();
    } catch {
        return '';
    }
    if (calibrations.length === 0) return '';

    // Average sealed conviction per seat from stored debate transcripts.
    // The protocol asks for exactly ONE sealed line per turn — when a seat's
    // prose quotes another conviction, keep only their final line so quoted
    // mentions don't inflate the average.
    const conv = new Map<string, { total: number; count: number }>();
    for (const t of trades ?? []) {
        for (const turn of t.debateTurns ?? []) {
            if (turn.speaker === 'Moderator' || turn.speaker === 'System') continue;
            let v: number | null = null;
            for (const m of turn.text.matchAll(/CONVICTION:\s*(\d{1,3})/gi)) {
                v = Math.min(100, Math.max(0, parseInt(m[1], 10)));
            }
            if (v === null) continue;
            const cur = conv.get(turn.speaker) ?? { total: 0, count: 0 };
            cur.total += v;
            cur.count += 1;
            conv.set(turn.speaker, cur);
        }
    }

    const rows: string[] = [];
    for (const name of names) {
        const providerId = providerIdBySeat[name];
        const cal = calibrations.find(c => c.provider === providerId || c.provider === name);
        const c = conv.get(name);
        const bits: string[] = [];
        if (cal && cal.samples > 0) {
            bits.push(`Brier ${cal.brierScore !== null ? cal.brierScore.toFixed(3) : 'n/a'} over ${cal.samples} trades (${cal.verdict}${cal.highGap !== null ? `, High gap ${cal.highGap > 0 ? '+' : ''}${cal.highGap.toFixed(0)}%` : ''})`);
        }
        if (c && c.count > 0) {
            bits.push(`avg sealed conviction ${Math.round(c.total / c.count)}/100 across ${c.count} debates`);
            // Persuasion profile: does this seat ever MOVE when challenged?
            const prof = persuasionProfile(trades ?? [], name);
            if (prof.disposition === 'movable') {
                const dir = prof.avgDelta > 0 ? 'hardens' : prof.avgDelta < 0 ? 'yields' : 'mixed';
                bits.push(`moved in ${prof.movedDebates}/${prof.debates} debates (${dir}, avg ${prof.avgDelta > 0 ? '+' : ''}${prof.avgDelta.toFixed(0)}) — weight their FINAL conviction over their first`);
            } else if (prof.disposition === 'rigid' && prof.debates >= 2) {
                bits.push(`rigid: never moved across ${prof.debates} debates — first impression is their final answer`);
            }
        }
        if (bits.length === 0) continue;
        rows.push(`- ${name}: ${bits.join(' · ')}`);
    }
    if (rows.length === 0) return '';

    return [
        '**SEAT TRUST RECORD (historical calibration — weight accordingly):**',
        ...rows,
        'Seats with low Brier scores and calibrated verdicts have earned more weight; overconfident seats (large positive High gap) should be discounted when they dissent from better-calibrated peers.',
    ].join('\n');
};

/**
 * Loss priming (B4): surface this setup's historical failures as a
 * first-person recollection so analysts argue from remembered losses instead
 * of discovering them at verdict time. Returns '' when there are no similar
 * losing trades.
 */
const buildLossPrimingBlock = (
    trades?: { outcome?: string; keyLesson?: string; coin?: string; direction?: string; timestamp?: string }[],
): string => {
    if (!trades || trades.length === 0) return '';
    const losses = trades.filter(t => t.outcome === 'LOSS').slice(0, 3);
    if (losses.length === 0) return '';
    const lines = losses.map(t =>
        `- ${t.timestamp ? new Date(t.timestamp).toLocaleDateString() : 'recently'}: ${t.coin ?? 'this setup'} ${t.direction ?? ''} lost${t.keyLesson ? ` — lesson: ${t.keyLesson.slice(0, 120)}` : ''}`
    );
    return [
        '**YOUR OWN LOSSES ON SETUPS LIKE THIS (recall before you answer):**',
        ...lines,
        'You have been here before and it cost you. Address what went wrong last time — or explain concretely why this instance is different.',
    ].join('\n');
};

const getAnalystClarificationQuestion = (questionText: string, targetAliases: string[], allSpeakerLabels: string[]): string => {
    const targetAlt = targetAliases.map(escapeRegExp).join('|');
    const allAlt = allSpeakerLabels.map(escapeRegExp).join('|');
    const match = questionText.match(new RegExp(
        `(?:^|\\n)\\s*\\*{0,2}(?:${targetAlt})\\*{0,2}\\s*:\\s*([\\s\\S]*?)(?=\\n\\s*\\*{0,2}(?:${allAlt})\\*{0,2}\\s*:|$)`,
        'i'
    ));
    return (match?.[1] || questionText).trim();
};

/**
 * Builds a compact transcript of every turn up to (and including) maxRound
 * as NAC-style episodes (committed handoffs), not raw turns. The live chat
 * still stores full text; only later model calls receive this weave.
 * Levels snapshot stays derived from the latest full turn per speaker.
 */
const buildDebateTranscript = (
    names: string[],
    roundTexts: Record<string, string[]>,
    maxRound: number,
    _perTurnTokens = 100,
    totalTokens = 1500
): string => {
    const lines: string[] = [];
    for (let r = 1; r <= maxRound; r++) {
        const moderatorText = roundTexts['Moderator']?.[r]?.replace(CLARIFICATION_MARKERS, '').trim();
        if (moderatorText) lines.push(compactDebateEpisode('Moderator', r, moderatorText));
        for (const name of names) {
            const text = roundTexts[name]?.[r];
            if (text) lines.push(compactDebateEpisode(name, r, text));
        }
    }
    const full = lines.join('\n\n') || 'The debate produced no transcript.';
    const levelRows = names.map(name => {
        let last = '';
        for (let r = maxRound; r >= 1; r--) {
            const text = roundTexts[name]?.[r];
            if (text) { last = text; break; }
        }
        return last ? extractDebateLevels(name, last) : null;
    }).filter((row): row is NonNullable<typeof row> => row !== null);
    const levelsTable = formatDebateLevelsTable(levelRows);
    const withLevels = levelsTable
        ? `${full}\n\n**LEVELS SNAPSHOT (do not invent a parallel tape):**\n${levelsTable}`
        : full;
    // Tail-first truncation: when the transcript exceeds the budget, drop the
    // OLDEST turns (the earliest rounds are listed first) instead of
    // head-truncating mid-turn — the moderator needs the most recent rounds
    // (especially the latest clarification answers) the most.
    const maxChars = totalTokens * 4;
    if (withLevels.length <= maxChars) return withLevels;
    let kept = '';
    for (let i = lines.length - 1; i >= 0; i--) {
        const candidate = kept ? `${lines[i]}\n\n${kept}` : lines[i];
        if (candidate.length > maxChars) break;
        kept = candidate;
    }
    const truncated = `...[Earlier debate rounds truncated to fit context memory]...\n\n${kept}`;
    return levelsTable
        ? `${truncated}\n\n**LEVELS SNAPSHOT (do not invent a parallel tape):**\n${levelsTable}`
        : truncated;
};

/**
 * Run a REAL multi-round debate:
 * 1. Round 1 — opening statements taken from each analyst's own final output
 *    (no extra API calls).
 * 2. Rounds 2..N — every analyst is called AGAIN on its own provider, in
 *    parallel within a round, and asked to rebut the others' latest positions.
 *    A failed/rate-limited analyst is skipped for the remaining rounds; the
 *    debate continues with whoever is left.
 * 3. Clarification loop — the moderator reviews the transcript and asks each
 *    analyst targeted clarifying questions; the analysts answer (60-100 words);
 *    a short internal judgment call decides whether the concerns are resolved.
 *    Unsatisfied → one more cycle, capped at MAX_CLARIFICATION_CYCLES.
 * 4. Final — the moderator (moderatorConfig + moderatorModel) receives the
 *    full transcript plus the usual context blocks (gate reconciliation,
 *    Monte Carlo, lens roles, learning context, recent insights, market
 *    telemetry) and streams the verdict + </DEBATE_END> + the **FINAL TRADE
 *    PLAN** markdown block contract that the pipeline parses into the final
 *    trade card.
 * `onSpeakerStatus` is invoked with (speaker, round, active) around every
 * stream so the UI can show exactly which models are currently generating.
 */

/**
 * Stream a provider call with ONE bounded retry for transient failures
 * (429 / 5xx / network) that occur BEFORE any content was emitted. A
 * rate-limited request must not permanently drop an analyst mid-debate —
 * the drop path removes them and forces a replacement pick for what is
 * often a momentary blip. Failures AFTER partial output are not retried:
 * the caller's drop path purges the partial transcript, and re-streaming
 * from scratch would duplicate the visible text.
 */
async function streamWithTransientRetry(
    runOnce: () => AsyncGenerator<string, void, unknown>,
    onEmit: (delta: string) => void,
    label: string,
): Promise<void> {
    let emittedAny = false;
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
        if (attempt > 0) await new Promise(r => setTimeout(r, 2000));
        try {
            for await (const chunk of runOnce()) {
                if (chunk) { emittedAny = true; onEmit(chunk); }
            }
            return;
        } catch (e: any) {
            const isAbort = e?.name === 'AbortError' || e?.code === 'ABORT_ERR' || e?.name === 'TimeoutError';
            const transient = !isAbort && !emittedAny && (
                e?.status === 429 || e?.status === 502 || e?.status === 503 || e?.status === 504 ||
                /network|econnrefused|failed to fetch|fetch failed|socket hang up/i.test(e?.message || '')
            );
            lastError = e;
            if (!transient) throw e;
            console.warn(`[RealDebate] ${label} attempt ${attempt + 1} failed transiently (${e?.status ?? e?.message ?? e}); retrying once.`);
        }
    }
    throw lastError;
}

export const conductRealDebate = async function* (
    analysts: RealDebateAnalyst[],
    userPrompt: string,
    finalTradeSummary: string | null,
    moderatorConfig: ProviderConfig,
    moderatorModel: string,
    customInstructions?: string,
    monteCarloResults?: { provider: string; result: any }[],
    lensConfig?: AnalystLensConfig,
    analystProviders?: string[],
    activeFrameworks?: string[],
    tradeSummaries?: { id: string; summaryText: string; timestamp: string }[],
    gateResult?: GateOutput | null,
    learningContext?: string,
    signal?: AbortSignal,
    onReasoning?: (reasoning: string) => void,
    onAnalystReasoning?: (speaker: string, reasoning: string, round?: number) => void,
    onSpeakerStatus?: (speaker: string, round: number, active: boolean) => void,
    hybridContext?: string,
    /** Wall-clock budget for the whole debate (rebuttals + clarification
     *  cycles). On expiry the debate skips remaining rounds and proceeds
     *  straight to the moderator verdict. */
    timeoutMs?: number,
    /** Mid-debate analyst replacement. Invoked once per analyst that drops
     *  (stream failure) BEFORE the next phase runs; the debate suspends while
     *  the returned promise is pending so the consumer can ask the user for a
     *  fresh provider. Resolve with a fully-formed analyst record to inject it
     *  (it joins the remaining rebuttals/clarifications/verdict), or null to
     *  continue without. The abort signal interrupts the wait. */
    onReplacementRequested?: (droppedName: string, round: number) => Promise<RealDebateAnalyst | null>,
    /** How long the debate waits for the replacement choice (defaults to
     *  DEBATE_REPLACEMENT_WAIT_MS). Test seams pass a small value. */
    replacementTimeoutMs?: number,
    /** Live-price provider invoked at each round boundary (rebuttals,
     *  clarification, verdict). Return TODAY's price or null/undefined when
     *  unknown — the refresh line is then omitted and the debate runs as
     *  before. Analysts re-anchor on the current price between rounds
     *  instead of arguing over a stale snapshot. */
    getLivePrice?: () => number | null,
    /** Drain queued user notes sent while this debate was running. */
    getSteeringNotes?: () => string,
    /** Per-seat steering: a note addressed to ONE seat. Invoked
     *  when that seat's next turn is built; the note rides only its prompt. */
    getSeatSteeringNote?: (seatName: string) => string,
    /** Per-seat stop: the user benched this seat. The seat
     *  leaves the roster (existing partial text is purged by the drop path)
     *  and remaining rounds continue without it. */
    shouldDropSeat?: (seatName: string) => boolean,
    /** Append-only run log (pipeline persists on the message). */
    onRunEvent?: (event: DebateRunEvent) => void,
    /** Pattern-memory gate for the pre-step waterfall. */
    memoryGate?: { gateResult?: string; reason?: string; skillVeto?: string } | null,
    /** Crash-resume: skip completed rounds and seed transcript. */
    resumeState?: { lastCompletedRound: number; seedRoundTexts?: Record<string, string[]>; laneDrafts?: Record<string, { round: number; text: string }> },
    /** When true, skip remaining rebuttals (USD budget). */
    shouldSkipRemaining?: () => boolean,
    /** Live desk-tool visibility — fires when a seat calls/finishes a tool so
     *  the Floor can show chips instead of a silent bot. */
    onToolEvent?: (speaker: string, round: number, line: string) => void,
    /** Debate template (Risk-only pass): skip rebuttals, straight to verdict. */
    forceSkipRebuttals?: boolean,
    botByThoughtsKey?: Record<string, HermesBot>,
    /** Pre-fetched market snapshot injected to all seats to avoid N× tool calls. */
    centralizedSnapshot?: string,
    /** This setup's similar closed trades (for loss priming). Compact rows —
     *  outcome/keyLesson only, no full post-mortems. */
    similarTrades?: { outcome?: string; keyLesson?: string; coin?: string; direction?: string; timestamp?: string }[],
    /** Full closed-trade log — powers the `recall` notebook desk tool. */
    fullTradesForRecall?: LoggedTrade[],
): AsyncGenerator<RealDebateTurnEvent, void, unknown> {

    if (analysts.length < 2) {
        throw new Error(`Real debate requires at least 2 analysts (${analysts.length} provided).`);
    }

    // Fresh desk-tool cache per debate — the 30s TTL dedupes calls WITHIN a
    // run, but a new run must never read the previous run's market snapshot.
    clearDeskToolCache();

    // Per-stream timeouts multiply with retries; without a global budget a
    // stuck analyst can hold a round open for minutes. Deadline bounds the
    // whole debate so the user always gets a verdict.
    const deadline = Date.now() + (timeoutMs ?? DEBATE_DEFAULT_TIMEOUT_MS);

    const emitLog = (kind: DebateRunEvent['kind'], detail: string, round?: number, speaker?: string): void => {
        onRunEvent?.({ at: new Date().toISOString(), kind, detail, round, speaker });
    };
    const takeSteering = (round: number): string => {
        const note = (getSteeringNotes?.() || '').trim();
        if (!note) return '';
        emitLog('steer', note.slice(0, 280), round);
        return note;
    };
    /** Route a moderator stream's chain-of-thought to BOTH the global
     *  moderator channel (Floor caption / thought bubble) AND the moderator's
     *  current turn (transcript Thinking row). Without the per-turn route the
     *  transcript only revealed the moderator's thinking after the turn
     *  finished — the questions appeared to be "sent without thinking". */
    const moderatorReasoningFor = (round: number) => (reasoning: string): void => {
        onReasoning?.(reasoning);
        onAnalystReasoning?.('Moderator', reasoning, round);
    };

    const names = analysts.map(a => a.provider.name);
    const activeAnalystNames = new Set(names);
    // Mutable roster: grows when a mid-debate replacement joins. Everything
    // that re-invokes analysts (rebuttal rounds, clarifications, verdict
    // context) reads THIS, never the original `analysts` array — a replacement
    // provider must be re-callable and visible to the moderator.
    const debateRoster: RealDebateAnalyst[] = [...analysts];
    // Debate mailbox: real send_message / read_message tool calls.
    // The Moderator is addressable too — DMs to them ride into the verdict
    // context via the transcript builder below.
    const debateMailbox = createDebateMailbox([...names, 'Moderator']);
    // Per-round deliveries already surfaced as System "DM" lines in the
    // transcript (dedupe — a message is announced exactly once).
    const announcedDms = new Set<unknown>();
    // Analysts whose stream failed mid-debate — their partial text is purged
    // from the transcript and a visible notice is emitted. Late deltas from a
    // dropped seat are discarded for the rest of the debate.
    const droppedNames = new Set<string>();
    // Speaker labels the moderator may use when addressing analysts: provider
    // names plus lens role short names (Macro / Technical / Risk). Used to
    // split the clarification question block per analyst. Rebuilt when a
    // replacement joins so its labels anchor its own section.
    const buildSpeakerLabels = (): string[] => {
        const labels = debateRoster.flatMap((a) => {
            const own = [a.provider.name];
            if (lensConfig?.enabled) {
                const role = getRoleForProvider(`${a.provider.config.id}::${a.provider.model}`, lensConfig.assignments);
                const shortName = role !== AnalystRole.UNASSIGNED ? ANALYST_ROLE_DEFINITIONS[role].shortName : '';
                if (shortName) own.push(shortName);
            }
            return own;
        });
        labels.push('Moderator');
        return labels;
    };
    let speakerLabels = buildSpeakerLabels();
    // Per-analyst TARGET aliases — only the analyst's OWN labels may anchor
    // its section (the old code included every other analyst's labels, so an
    // unaddressed analyst grabbed the first section and answered the wrong
    // question).
    const targetAliasesFor = (name: string): string[] => {
        const aliases = [name];
        if (lensConfig?.enabled) {
            const analyst = debateRoster.find(a => a.provider.name === name);
            if (analyst) {
                const role = getRoleForProvider(`${analyst.provider.config.id}::${analyst.provider.model}`, lensConfig.assignments);
                const shortName = role !== AnalystRole.UNASSIGNED ? ANALYST_ROLE_DEFINITIONS[role].shortName : '';
                if (shortName) aliases.push(shortName);
            }
        }
        return aliases;
    };
    // Per-speaker text per round (1-based index). Rebuttal deltas accumulate.
    const roundTexts: Record<string, string[]> = { Moderator: [] };
    analysts.forEach(a => { roundTexts[a.provider.name] = []; });
    if (resumeState?.seedRoundTexts) {
        for (const [speaker, rounds] of Object.entries(resumeState.seedRoundTexts)) {
            roundTexts[speaker] = [...(rounds || [])];
        }
    }
    if (resumeState?.laneDrafts) {
        for (const [speaker, draft] of Object.entries(resumeState.laneDrafts)) {
            if (!roundTexts[speaker]) roundTexts[speaker] = [];
            if (draft.text) roundTexts[speaker][draft.round] = draft.text;
        }
    }
    const lastDone = resumeState?.lastCompletedRound ?? 0;

    // Pre-debate divergence from the analysts' own results (the round-1
    // openings are derived from exactly these). When the openings strongly
    // agree there is nothing for the clarification cycle to resolve — skipping
    // it saves a full moderator-questions + parallel-answers + judgment round.
    // Echo-chamber risk is handled separately by the synthetic-dissent protocol.
    const openingDivergence = analyzePreDebateDivergence(
        analysts.map(a => a.result),
        names,
    );
    // Clarification is worth its cost only when the openings actually disagree
    // (direction/confidence/entry spread). Full agreement skips a whole
    // moderator-questions + parallel-answers + judgment round. Echo-chamber
    // risk (score < 15) is deliberately NOT a reason to run clarification —
    // it is handled by the synthetic-dissent protocol injected into the
    // moderator's verdict prompt instead.
    const clarificationWorthRunning = openingDivergence.score >= 20
        || openingDivergence.divergenceType === 'direction'
        || openingDivergence.divergenceType === 'multiple';

    /** Inject a replacement analyst that joins the debate from the next phase.
     *  Its position is seeded at `dropRound` (its fresh analysis, streamed as
     *  a visible turn) so the next rebuttal round / clarification treats it as
     *  an established speaker — same semantics as round-1 openings. */
    const injectReplacement = (replacement: RealDebateAnalyst, dropRound: number): void => {
        const name = replacement.provider.name;
        names.push(name);
        activeAnalystNames.add(name);
        roundTexts[name] = [];
        const { opening } = openingFromResult(replacement.result);
        roundTexts[name][dropRound] = opening;
        debateRoster.push(replacement);
        if (analystProviders) analystProviders.push(replacement.provider.config.id);
        speakerLabels = buildSpeakerLabels();
    };

    /** Offer the user a replacement for a dropped analyst and inject the pick.
     *  On wait timeout the consumer's offer is still pending — emit a marker
     *  so it abandons the wait (a late click must never inject a phantom
     *  analyst into a debate that already moved on). */

    // --- ROUND 1: OPENING STATEMENTS (free — each analyst's own final output) ---
    if (lastDone < 1) {
        for (const analyst of analysts) {
            const { opening, thinking } = openingFromResult(analyst.result);
            roundTexts[analyst.provider.name][1] = opening;
            onSpeakerStatus?.(analyst.provider.name, 1, true);
            if (thinking) onAnalystReasoning?.(analyst.provider.name, thinking, 1);
            yield { speaker: analyst.provider.name, round: 1, text: opening };
            onSpeakerStatus?.(analyst.provider.name, 1, false);
        }
    } else {
        emitLog('resume', `Resuming after round ${lastDone}`, lastDone);
        yield { speaker: 'System', round: lastDone, text: `Resuming debate after round ${lastDone}.` };
    }

    // Consensus shortcut: when openings already agree tightly, the final rebuttal adds little — skip it and go to verdict sooner.
    let totalRounds = REAL_DEBATE_RESPONSE_ROUNDS + 1;
    // Protocol lane: 'extended' adds a rebuttal round;
    // 'efficient' drops clarifications + conditional devil round. The chosen
    // protocol is announced on the run log and hashed into the pipeline's
    // promptVersion so outcomes attribute per-protocol.
    // The protocol seed is set by the ORCHESTRATOR (pipeline) via
    // setProtocolSeed() before the generator runs — direct engine calls
    // (tests) stay unseeded and deterministically take the control lane.
    const debateProtocol = assignDebateProtocol();
    if (debateProtocol === 'extended') totalRounds += 1;
    emitLog('episode', `Protocol lane: ${debateProtocol} (${totalRounds - 1} response rounds).`);
    try {
        const dirs = analysts.map(a => (a.result.analysis.direction || '').toLowerCase());
        const sameDir = dirs.length >= 2 && dirs.every(d => d === dirs[0] && (d === 'long' || d === 'short'));
        const entries = analysts.map(a => {
            const raw = a.result.analysis.entryPoints?.[0]?.price;
            const n = typeof raw === 'string' ? parsePrice(raw as string) : (raw as number);
            return Number.isFinite(n) ? Number(n) : NaN;
        }).filter(n => !isNaN(n)) as number[];
        let spreadPct: number | null = null;
        if (entries.length >= 2) {
            const sorted = [...entries].sort((a, b) => a - b);
            const median = sorted[Math.floor(sorted.length / 2)];
            if (median > 0) spreadPct = ((sorted[sorted.length - 1] - sorted[0]) / median) * 100;
        }
        if (openingDivergence.score < 15 && sameDir && spreadPct !== null && spreadPct <= 0.8) {
            totalRounds = Math.max(2, totalRounds - 1);
            emitLog('episode', `Openings tightly aligned (spread ${spreadPct.toFixed(2)}%) — trimming one rebuttal round.`, 2);
        }
    } catch { /* best-effort shortcut */ }

    // Level discipline: if any opening lacks Entry/SL/TP1, flag it so the first rebuttal asks for it.
    let missingLevelsNotice = '';
    try {
        const missing = analysts.filter(a => {
            const an = a.result.analysis;
            return !an.entryPoints?.[0]?.price || !an.stopLoss || !an.takeProfit?.[0]?.price;
        }).map(a => a.provider.name);
        if (missing.length > 0) {
            missingLevelsNotice = `Missing levels: ${missing.join(', ')} — include Entry/SL/TP1 in your rebuttal.`;
        }
    } catch { /* ignore */ }

    // --- REBUTTAL ROUNDS 2..N ---
    const pre = debatePreStep(memoryGate);
    if (pre.inject) {
        emitLog('pre_step', pre.inject.slice(0, 280), 2);
        yield { speaker: 'System', round: 2, text: pre.inject };
    }
    const skipRebuttals = pre.action === 'skip_to_verdict' || lastDone >= totalRounds || Boolean(forceSkipRebuttals);
    const rebuttalStart = Math.max(2, lastDone + 1);
    // Warm the moderator's connection while the analysts rebut — the verdict
    // call then reuses the pooled socket and skips DNS/TCP/TLS handshake
    // latency. Best-effort, no-op on Electron/localhost.
    warmProviderConnection(moderatorConfig);
    // ─── REBUTTAL PUMP (per-seat speculative scheduling) ───────────────────
    // Each seat's round N+1 fires the moment that seat's round-N turn
    // settles — a fast seat no longer idles waiting for the slowest seat
    // before starting its next rebuttal. A rebuttal's input is the diff
    // packet against whatever peer positions exist at launch time (peers
    // still writing are simply absent from the packet), so the pump stays
    // correct without a round barrier. Drops, replacements, steering, and
    // budget checks keep their previous semantics.
    const pendingDrops: { name: string; round: number }[] = [];
    const seatRound = new Map<string, number>();
    for (const name of activeAnalystNames) seatRound.set(name, Math.max(1, lastDone));
    let budgetNoticeEmitted = false;
    const budgetExhausted = (): boolean => {
        if (budgetNoticeEmitted) return true;
        if (Date.now() > deadline) {
            budgetNoticeEmitted = true;
            return true;
        }
        if (shouldSkipRemaining?.()) {
            emitLog('budget', 'USD cost cap reached — skipping remaining rebuttals.');
            budgetNoticeEmitted = true;
            return true;
        }
        return false;
    };

    const buildRebuttalTask = (analyst: RealDebateAnalyst, round: number, steeringNote: string, seatNote = '') => {
        const ownPosition = roundTexts[analyst.provider.name]?.[round - 1];
        // Addressed routing: a seat only reads turns sent TO it
        // (or floor-wide); turns addressed elsewhere stay out of its prompt.
        const otherOpenings = debateRoster
            .filter(o => o.provider.name !== analyst.provider.name && roundTexts[o.provider.name]?.[round - 1])
            .filter(o => turnAddressedTo(roundTexts[o.provider.name][round - 1], analyst.provider.name))
            .map(o => ({ name: o.provider.name, text: roundTexts[o.provider.name][round - 1] }));
        const others = otherOpenings.length > 0
            ? buildRebuttalDiffPacket(analyst.provider.name, ownPosition, otherOpenings)
            : 'No other analyst has spoken yet.';

        // ── Devil's advocate rotation (B1) ──
        // One seat per debate is ASSIGNED the contra position for its first
        // rebuttal, regardless of its own read — kills premature agreement.
        // Seeded from the prompt hash so it rotates per setup, not per run.
        // The existing synthetic-dissent protocol still covers full echo
        // chambers; this guarantees exactly one structured counter-voice even
        // when divergence is moderate.
        // 'efficient' lane: skip the devil assignment when openings
        // already disagree — the counter-case exists without forcing one.
        const floorAgrees = (() => {
            const dirs = debateRoster.map(a => (a.result.analysis.direction || '').toLowerCase());
            return dirs.length >= 2 && dirs.every(d => d === dirs[0]);
        })();
        if (debateProtocol === 'efficient' && floorAgrees) {
            // fall through with no devil seat: devilName stays undefined below
        }
        const devilSeatIndex = (() => {
            let h = 0;
            for (let i = 0; i < userPrompt.length; i++) h = (h * 31 + userPrompt.charCodeAt(i)) >>> 0;
            return h % Math.max(debateRoster.length, 1);
        })();
        const devilName = (debateProtocol === 'efficient' && floorAgrees)
            ? undefined
            : debateRoster[devilSeatIndex]?.provider.name;
        const isDevilSeat = analyst.provider.name === devilName && round === rebuttalStart;

        // The lens persona must survive into the rebuttal rounds —
        // a generic "expert trading analyst" instruction let
        // specialists drift to general analysis mid-debate.
        const bot = botByThoughtsKey?.[analyst.provider.thoughtsKey];
        const rolePrefix = bot?.systemPromptOverride
            ? `${bot.systemPromptOverride}${bot.personality ? `\n\n${bot.personality}` : ''}`
            : lensConfig?.enabled
                ? getLensPromptForStyle(
                    analyst.provider.thoughtsKey,
                    lensConfig.assignments,
                    lensConfig.tradingStyle === 'auto' ? 'swing' : lensConfig.tradingStyle
                )
                : '';
        const otherAnalystNames = debateRoster
            .map(o => o.provider.name)
            .filter(n => n !== analyst.provider.name);
        const systemPrompt = (rolePrefix ? `${rolePrefix}\n\n` : '')
            + fillPromptPlaceholders(getPrompt('debate.rebuttal', DEBATE_RESPONSE_PROMPT), {
                NAME: analyst.provider.name,
                ROUND: String(round),
                OTHERS: otherAnalystNames.join(', ') || 'none',
            }) + '\n\nIf another analyst made a strong point, address them by name (@Name).';
        // Only inject market snapshot on the first rebuttal round to avoid re-paying the token cost every round.
        const snapshotBlock = round === 2 && centralizedSnapshot ? `\n\n${centralizedSnapshot}` : '';
        // Snapshot the live price at launch so the rebuttal sees the current
        // market (each seat launches at its own settle time).
        const livePriceBlock = buildLivePriceRefreshBlock(getLivePrice?.() ?? null, `before Round ${round}`);
        const snapshotRows = debateRoster
            .filter(o => roundTexts[o.provider.name]?.[round - 1])
            .filter(o => turnAddressedTo(roundTexts[o.provider.name][round - 1], analyst.provider.name))
            .map(o => extractDebateLevels(o.provider.name, roundTexts[o.provider.name][round - 1]));
        const levelsSnap = formatDebateLevelsTable(snapshotRows);
        const userContent =
            `${buildFloorOrientation({
                selfName: analyst.provider.name,
                otherAnalysts: otherAnalystNames,
                turn: 'rebuttal',
                round,
            })}\n\n` +
            `${others}\n\n` +
            (levelsSnap ? `**LEVELS SNAPSHOT:**\n${levelsSnap}\n\n` : '') +
            (buildLossPrimingBlock(similarTrades) ? buildLossPrimingBlock(similarTrades) + `\n\n` : '') +
            (isDevilSeat
                ? "**DEVIL'S ADVOCATE ASSIGNMENT (this round only):** You are assigned the CONTRA position for this round. Argue the strongest honest case AGAINST the emerging floor consensus - what invalidates it, where it fails, who is on the wrong side of the levels. You may concede afterwards, but this round your job is the counter-case. Do not strawman: use real levels and timeframes.\n\n"
                : '') +
            (round === rebuttalStart + 1
                ? '**EVIDENCE ROUND:** Cite ONE concrete data point already on the table (a level, volume figure, funding rate, session context) that most supports OR most threatens your stance. No new analysis - just the evidence and why it matters in one or two sentences, then your updated Levels line.\n\n'
                : '') +
            (round === totalRounds
                ? '**FINAL CONVICTION LINE (required):** START your reply with exactly one line: CONVICTION: <0-100> - your private numeric conviction in your own stance after this debate. This is sealed: other seats never see it, only the Moderator sees all convictions together at the verdict. Put it BEFORE your arguments so it can never be cut off.\n\n'
                : '') +
            `Respond now with your rebuttal for Round ${round}.` +
            (steeringNote ? `\n\n**USER STEERING (queued mid-debate — follow this):**\n${steeringNote}` : '') +
            (seatNote ? `\n\n**USER STEERING — DIRECTED AT YOU (${analyst.provider.name}) ONLY:**\n${seatNote}` : '') +
            (missingLevelsNotice ? `\n\n${missingLevelsNotice}` : '') +
            snapshotBlock + livePriceBlock;

        const messages: ChatMessage[] = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent },
        ];

        return {
            name: analyst.provider.name,
            round,
            run: async (emit: (delta: string) => void) => {
                // Local accumulation of THIS turn's emission — the pump
                // queue merges asynchronously, so checking roundTexts here
                // would race the drain loop.
                let localTurnText = '';
                const emitAndTrack = (delta: string): void => {
                    localTurnText += delta;
                    emit(delta);
                };
                // Bounded retry: a transient 429/network blip before
                // any output must not permanently drop the analyst
                // (the drop path asks the user to pick a replacement).
                const runOnce = () => streamChatWithDeskTools(analyst.provider.config, messages, {
                    temperature: 0.35,
                    signal,
                    trades: fullTradesForRecall,
                    maxTokens: TASK_BUDGETS.rebuttal,
                    onReasoning: (reasoning: string) => onAnalystReasoning?.(analyst.provider.name, reasoning, round),
                    onToolEvent: (line: string) => {
                        emitLog('tool', line, round, analyst.provider.name);
                        onToolEvent?.(analyst.provider.name, round, line);
                    },
                    defaultSymbol: resolveDefaultSymbol(userPrompt),
                    afterToolsNudge: 'Tool results are above. Write your rebuttal Floor turn now. No JSON, no tool tags.',
                    allowedTools: botByThoughtsKey?.[analyst.provider.thoughtsKey]?.enabledTools,
                    // Without live hybrid market data, the first
                    // round forces one real grounding lookup — a seat must not
                    // argue from zero data when the debate is already running
                    // blind. With hybrid data present the seat keeps full
                    // discretion (auto).
                    requireFirstToolRound: !hybridContext,
                    // Floor messaging: real tool-call DMs between seats.
                    mailbox: debateMailbox,
                    mailboxSeat: analyst.provider.name,
                    mailboxRound: round,
                    onMailSent: info => {
                        // Announce each delivery once as a System line —
                        // the DM body itself stays private to recipient.
                        const key = `${info.from}>${info.to}@${info.round}:${info.text}`;
                        if (announcedDms.has(key)) return;
                        announcedDms.add(key);
                        const dm = debateMailbox.all().find(m =>
                            m.from === info.from && m.toLabel === info.to
                            && m.round === info.round && m.text === info.text);
                        if (dm) {
                            emitLog('tool', formatDmEventLine(dm), round, info.from);
                            pumpPush({ kind: 'delta', name: 'System', round, text: formatDmEventLine(dm) });
                        }
                    },
                });
                await streamWithTransientRetry(runOnce, emitAndTrack, `${analyst.provider.name} Round ${round} rebuttal`);
                // Conviction insurance: the final-round seat MUST produce a
                // sealed CONVICTION for the auction. A truncated/ignored line is
                // retried ONCE with a pointed nudge — the auction silently lost
                // seats before, and nothing downstream ever flagged it.
                if (round === totalRounds && !signal?.aborted) {
                    const produced = /CONVICTION:\s*\d{1,3}/i.test(localTurnText);
                    if (!produced) {
                        console.warn(`[RealDebate] ${analyst.provider.name} missed the CONVICTION line on the final round — retrying once.`);
                        emitLog('tool', `${analyst.provider.name} missing CONVICTION — retrying once`, round, analyst.provider.name);
                        // The cutoff marker tells the consumer to REPLACE this
                        // seat's turn text with the retry reply (no concat).
                        pumpPush({ kind: 'delta', name: analyst.provider.name, round, text: `\n${CONVICTION_RETRY_MARKER}\n` });
                        messages.push({
                            role: 'user',
                            content:
                                `Your reply was cut off before the required conviction line. ` +
                                `As your ENTIRE reply, output only: "CONVICTION: <0-100>" — your numeric conviction in your own stance.`,
                        });
                        await streamWithTransientRetry(
                            runOnce,
                            emit,
                            `${analyst.provider.name} conviction retry`,
                        );
                    }
                }
            },
        };
    };

    type PumpItem =
        | { kind: 'delta'; name: string; round: number; text: string; startedAt?: string }
        | { kind: 'done'; name: string; round: number }
        | { kind: 'drop'; name: string; round: number };
    const pumpQueue: PumpItem[] = [];
    let pumpNotify: (() => void) | null = null;
    const pumpPush = (item: PumpItem): void => {
        pumpQueue.push(item);
        if (pumpNotify) { const n = pumpNotify; pumpNotify = null; n(); }
    };
    const inflight = new Set<string>();

    const launchSeat = (analyst: RealDebateAnalyst, round: number): void => {
        const steeringNote = takeSteering(round);
        if (steeringNote) pumpPush({ kind: 'delta', name: 'System', round, text: `User steering: ${steeringNote}` });
        // Per-seat steering: a note addressed to THIS seat rides only its
        // own prompt — the rest of the floor never sees it.
        const seatNote = getSeatSteeringNote?.(analyst.provider.name) || '';
        if (seatNote) pumpPush({ kind: 'delta', name: 'System', round, text: `Steering → ${analyst.provider.name}: ${seatNote.slice(0, 200)}` });
        emitLog('round', `Rebuttal round ${round}`, round, analyst.provider.name);
        inflight.add(analyst.provider.name);
        onSpeakerStatus?.(analyst.provider.name, round, true);
        const task = buildRebuttalTask(analyst, round, steeringNote, seatNote);
        // TTFT metric: the launch timestamp rides the FIRST delta so the
        // consumer can measure real time-to-first-token per turn.
        const startedAt = new Date().toISOString();
        let firstDelta = true;
        task.run(delta => {
            pumpPush({ kind: 'delta', name: analyst.provider.name, round, text: delta, startedAt: firstDelta ? startedAt : undefined });
            firstDelta = false;
        })
            .then(() => {
                // Bridge: messages sent via send_message tool calls
                // become a routed REPLY-TO line on the settled turn — the
                // addressing filters (turnAddressedTo) and the side panel's
                // tool-style reply rows read exactly this marker.
                const recipients = debateMailbox.recipientsFor(analyst.provider.name, round);
                const line = synthesizeReplyToLine(roundTexts[analyst.provider.name]?.[round] || '', recipients);
                if (line) {
                    roundTexts[analyst.provider.name][round] = (roundTexts[analyst.provider.name]?.[round] || '') + line;
                    pumpPush({ kind: 'delta', name: analyst.provider.name, round, text: line });
                }
            })
            .catch((e: any) => {
                const isAbort = e?.name === 'AbortError' || e?.code === 'ABORT_ERR' || e?.name === 'TimeoutError';
                if (!isAbort) {
                    console.warn(`[RealDebate] ${analyst.provider.name} failed Round ${round}:`, e?.message || e);
                    // Analyst drops out of the debate — remaining rounds continue.
                    activeAnalystNames.delete(analyst.provider.name);
                    seatRound.delete(analyst.provider.name);
                    // Purge any partial text already accumulated this round so
                    // the clarification/verdict transcripts never treat a
                    // failed turn as a complete position.
                    if (roundTexts[analyst.provider.name]) delete roundTexts[analyst.provider.name][round];
                    droppedNames.add(analyst.provider.name);
                    pumpPush({ kind: 'drop', name: analyst.provider.name, round });
                }
            })
            .finally(() => {
                inflight.delete(analyst.provider.name);
                onSpeakerStatus?.(analyst.provider.name, round, false);
                pumpPush({ kind: 'done', name: analyst.provider.name, round });
            });
    };

    const scheduleReadySeats = (): void => {
        for (const analyst of debateRoster) {
            const name = analyst.provider.name;
            if (!activeAnalystNames.has(name) || droppedNames.has(name) || inflight.has(name)) continue;
            // Per-seat stop: the user benched this seat between rounds.
            if (shouldDropSeat?.(name)) {
                const currentRound = seatRound.get(name) ?? 0;
                activeAnalystNames.delete(name);
                droppedNames.add(name);
                emitLog('drop', `${name} stopped by user`, currentRound, name);
                pumpPush({ kind: 'delta', name: 'System', round: currentRound, text: `${name} was stopped by the user — the debate continues without them.` });
                continue;
            }
            const current = seatRound.get(name) ?? 0;
            const next = current + 1;
            if (next < rebuttalStart || next > totalRounds) continue;
            if (!roundTexts[name]?.[next - 1] || roundTexts[name]?.[next]) continue;
            if (budgetExhausted()) continue;
            seatRound.set(name, next);
            launchSeat(analyst, next);
        }
    };

    // Drop notices + the bounded replacement wait run between pump drains so
    // the debate visibly suspends while the user picks a replacement.
    const drainDrops = async function* (): AsyncGenerator<RealDebateTurnEvent> {
        while (pendingDrops.length > 0) {
            const { name, round } = pendingDrops.shift()!;
            yield { speaker: 'System', round, text: `${name} dropped out during Round ${round} (provider stream failed) — the debate continues without them.` };
            emitLog('drop', `${name} dropped`, round, name);
            if (!onReplacementRequested) continue;
            if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
            const waitResult = await awaitReplacementWithTimeout(
                onReplacementRequested(name, round),
                signal,
                replacementTimeoutMs ?? DEBATE_REPLACEMENT_WAIT_MS,
            );
            if (waitResult.status === 'timedOut') {
                // Consumer's offer is still pending — emit the marker so
                // it abandons the wait; a late click must never inject a
                // phantom analyst into a debate that already moved on.
                yield { speaker: 'System', round, text: replacementTimeoutText(name) };
                continue;
            }
            const replacement = waitResult.value;
            if (replacement && !activeAnalystNames.has(replacement.provider.name)) {
                injectReplacement(replacement, round);
                seatRound.set(replacement.provider.name, round);
                yield { speaker: 'System', round, text: `${name} was replaced by ${replacement.provider.name} — ${replacement.provider.name} joins the debate from Round ${round + 1}.` };
                const { opening, thinking } = openingFromResult(replacement.result);
                if (thinking) onAnalystReasoning?.(replacement.provider.name, thinking, round);
                if (opening) yield { speaker: replacement.provider.name, round, text: opening };
            }
        }
    };

    if (!skipRebuttals) {
        scheduleReadySeats();
        while (inflight.size > 0 || pumpQueue.length > 0 || pendingDrops.length > 0) {
            if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
            if (pumpQueue.length === 0) {
                if (pendingDrops.length > 0) {
                    yield* drainDrops();
                    scheduleReadySeats();
                    continue;
                }
                if (inflight.size === 0) break;
                await new Promise<void>(resolve => { pumpNotify = resolve; });
                continue;
            }
            const item = pumpQueue.shift()!;
            if (item.kind === 'drop') {
                pendingDrops.push({ name: item.name, round: item.round });
                continue;
            }
            if (item.kind === 'done') {
                // A settled seat immediately schedules its next rebuttal —
                // the pump never waits for the slowest seat.
                scheduleReadySeats();
                continue;
            }
            if (item.name === 'System') {
                yield { speaker: 'System', round: item.round, text: item.text };
                continue;
            }
            // Deltas arriving after the drop are discarded (partial text was
            // already purged in the catch) — nothing further is yielded.
            if (droppedNames.has(item.name)) continue;
            // The conviction-retry marker CUTOFFS the truncated attempt —
            // the seat's round text is replaced by the retry reply, not
            // concatenated with it.
            const markerIdx = item.text.indexOf(CONVICTION_RETRY_MARKER);
            if (markerIdx >= 0) {
                const before = item.text.slice(0, markerIdx).trim();
                const after = item.text.slice(markerIdx + CONVICTION_RETRY_MARKER.length).trim();
                roundTexts[item.name][item.round] = before || '';
                if (before) yield { speaker: item.name, round: item.round, text: before };
                if (after) {
                    roundTexts[item.name][item.round] = (roundTexts[item.name][item.round] || '') + after;
                    yield { speaker: item.name, round: item.round, text: after };
                }
                continue;
            }
            roundTexts[item.name][item.round] = (roundTexts[item.name][item.round] || '') + item.text;
            yield { speaker: item.name, round: item.round, text: item.text, startedAt: item.startedAt };
        }
        if (budgetNoticeEmitted) {
            const noticeRound = Math.max(rebuttalStart, Math.min(totalRounds, Math.max(1, ...[...seatRound.values()])));
            yield {
                speaker: 'System',
                round: noticeRound,
                text: shouldSkipRemaining?.()
                    ? 'Debate cost cap reached — skipping remaining rebuttal rounds and proceeding to the verdict.'
                    : 'Debate time budget reached — skipping remaining rebuttal rounds and proceeding to the verdict.',
            };
            // Seats cut off before the final round never got to declare a
            // sealed conviction. If they declared one in an EARLIER round,
            // surface it to the arbiter — their last-known stance should not
            // vanish from the conviction auction just because time ran out.
            for (const name of activeAnalystNames) {
                if (roundTexts[name]?.[totalRounds]?.match(/CONVICTION:\s*\d{1,3}/i)) continue;
                let lastConviction: { round: number; value: number } | null = null;
                for (let r = totalRounds - 1; r >= 1; r--) {
                    const m = roundTexts[name]?.[r]?.match(/CONVICTION:\s*(\d{1,3})/i);
                    if (m) {
                        lastConviction = { round: r, value: Math.min(100, Math.max(0, parseInt(m[1], 10))) };
                        break;
                    }
                }
                if (lastConviction) {
                    yield {
                        speaker: 'System',
                        round: noticeRound,
                        text: `${name} was cut off by the debate budget before the final round — their last sealed conviction (Round ${lastConviction.round}): CONVICTION: ${lastConviction.value}.`,
                    };
                }
            }
        }
    }

    // --- CLARIFICATION LOOP ---
    // After the rebuttal rounds and BEFORE the verdict, the moderator reviews
    // the full transcript and asks each analyst 1-2 targeted clarifying
    // questions; the analysts answer (60-100 words) on their own providers
    // in parallel; a short internal judgment call decides whether the
    // concerns are resolved. Unsatisfied → one more cycle, capped at
    // MAX_CLARIFICATION_CYCLES (1 initial + up to 2 repeats). On cycle 3 no
    // judgment runs — the moderator must proceed to the verdict regardless.
    //
    // Round numbering stays dense/dynamic: questions round, answers round,
    // judgment round (when present). The verdict's `finalRound` is computed
    // after the loop so the transcript builder can include all turns.
    let lastRebuttalRound = skipRebuttals ? Math.max(1, lastDone) : totalRounds;

    const skipClarification = lastDone > totalRounds + 1;
    // Smarter skip #2: even when the OPENINGS diverged, the rebuttal rounds
    // may have converged the floor (same direction + tight entry spread).
    // Nothing is left to clarify — go straight to the verdict.
    const finalPositions = summarizeFinalPositions(roundTexts, names);
    const floorConverged = finalPositions.convergedDirection
        && finalPositions.entrySpreadPct !== null
        && finalPositions.entrySpreadPct <= 0.5;
    if (!skipRebuttals && !skipClarification && clarificationWorthRunning && floorConverged) {
        emitLog('episode', `Floor converged during rebuttals (entry spread ${finalPositions.entrySpreadPct!.toFixed(2)}%) — skipping clarification.`, lastRebuttalRound);
        yield { speaker: 'System', round: lastRebuttalRound, text: `Floor converged during rebuttals (entry spread ${finalPositions.entrySpreadPct!.toFixed(2)}%) — skipping clarification and proceeding to the verdict.` };
    }
    const runClarification = clarificationWorthRunning && !floorConverged;
    if (!skipRebuttals && !skipClarification && !clarificationWorthRunning) {
        emitLog('episode', `Openings aligned (divergence ${openingDivergence.score}) — skipping clarification.`, lastRebuttalRound);
        yield { speaker: 'System', round: lastRebuttalRound, text: `Openings aligned (divergence score ${openingDivergence.score}) — skipping clarification and proceeding to the verdict.` };
    }
    // Appended to the verdict prompt when clarification cycles exhaust
    // without a satisfaction judgment (see the cap branch below).
    let verdictAddendum = '';
    for (let cycle = 1; cycle <= MAX_CLARIFICATION_CYCLES; cycle++) {
        // 'efficient' lane: no clarification cycles at all.
        if (debateProtocol === 'efficient') break;
        if (skipRebuttals || skipClarification || !runClarification) break;
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

        // Global budget: skip clarification and proceed to the verdict.
        if (Date.now() > deadline) {
            yield { speaker: 'System', round: lastRebuttalRound, text: 'Debate time budget reached — skipping remaining clarification rounds and proceeding to the verdict.' };
            break;
        }

        // -- MODERATOR QUESTIONS (streamed once, ~100 tokens/turn cap) --
        const questionRound = lastRebuttalRound + 1;
        const steerQ = takeSteering(questionRound);
        if (steerQ) {
            yield { speaker: 'System', round: questionRound, text: `User steering: ${steerQ}` };
        }
        const priorQATranscript = buildDebateTranscript(names, roundTexts, lastRebuttalRound, 100, 1500);
        const questionSystemPrompt = getPrompt('debate.clarification_questions', MODERATOR_CLARIFICATION_QUESTIONS_PROMPT).replace('{{ANALYSTS}}', names.join(', '));
        const questionUserContent =
            `**THE DEBATE TRANSCRIPT (rounds 1-${lastRebuttalRound}):**\n${priorQATranscript}` +
            (steerQ ? `\n\n**USER STEERING (queued mid-debate — follow this):**\n${steerQ}` : '') +
            buildLivePriceRefreshBlock(getLivePrice?.() ?? null, 'before the clarification questions');
        onSpeakerStatus?.('Moderator', questionRound, true);
        let questionText = '';
        try {
            for await (const chunk of getModeratorAnalysisStream(
                moderatorConfig, moderatorModel,
                `${questionSystemPrompt}\n\n${questionUserContent}`,
                signal,
                moderatorReasoningFor(questionRound),
                resolveDefaultSymbol(userPrompt),
                (line: string) => {
                    emitLog('tool', line, questionRound, 'Moderator');
                    onToolEvent?.('Moderator', questionRound, line);
                },
                undefined,
                // The Moderator reads seat DMs and may DM back.
                debateMailbox,
                info => {
                    emitLog('tool', formatDmEventLine({
                        from: info.from, toKey: info.to.toLowerCase(), toLabel: info.to, text: info.text, round: questionRound,
                    }), questionRound, 'Moderator');
                    onToolEvent?.('Moderator', questionRound, formatDmEventLine({
                        from: info.from, toKey: info.to.toLowerCase(), toLabel: info.to, text: info.text, round: questionRound,
                    }));
                },
                // DM receipts carry the real debate round.
                questionRound,
            )) {
                if (chunk) {
                    questionText += chunk;
                    yield { speaker: 'Moderator', round: questionRound, text: chunk };
                }
            }
        } catch (e: any) {
            const isAbort = e?.name === 'AbortError' || e?.code === 'ABORT_ERR' || e?.name === 'TimeoutError';
            if (isAbort) throw e;
            console.warn('[RealDebate] Clarification questions call failed; proceeding to verdict.', e?.message || e);
            onSpeakerStatus?.('Moderator', questionRound, false);
            // Reserve the question round: partial text may already have been
            // streamed to the consumer — the verdict must NOT share its round
            // or the two merge into one bubble (consumer keys by round::speaker).
            lastRebuttalRound = questionRound;
            break;
        }
        onSpeakerStatus?.('Moderator', questionRound, false);
        // Moderator wrapper failures arrive as an error marker rather than a
        // thrown exception. Skip clarification and proceed to the verdict.
        if (/<MODERATOR_ERROR>/i.test(questionText)) {
            console.warn('[RealDebate] Clarification questions returned an error marker; proceeding to verdict.');
            lastRebuttalRound = questionRound;
            break;
        }
        // Store the moderator turn AFTER marker-stripping so the transcript
        // doesn't leak <CLARIFICATION_DONE> into the verdict prompt.
        roundTexts.Moderator[questionRound] = questionText.replace(CLARIFICATION_MARKERS, '').trim();

        // Short-circuit: moderator has no follow-up → skip answers + judgment.
        // Reserve the question round for the verdict so the questions turn
        // (which may carry visible prose before the marker) and the verdict can
        // never collide on the same round.
        if (questionText.toUpperCase().includes(CLARIFICATION_DONE_MARKER)) {
            lastRebuttalRound = questionRound;
            break;
        }

        // -- ANALYST ANSWERS (parallel, each on its own provider) --
        const answerRound = questionRound + 1;
        lastRebuttalRound = answerRound;
        const liveAnalysts = debateRoster.filter(a => activeAnalystNames.has(a.provider.name));
        const clarificationTranscript = buildDebateTranscript(
            names,
            roundTexts,
            questionRound,
            100,
            1500,
        );
        const answerTasks = liveAnalysts.map((analyst) => {
            const otherAnalystNames = liveAnalysts
                .map(o => o.provider.name)
                .filter(n => n !== analyst.provider.name);
            const moderatorQuestion = getAnalystClarificationQuestion(
                questionText,
                targetAliasesFor(analyst.provider.name),
                speakerLabels,
            );
            const answerSystemPrompt = fillPromptPlaceholders(
                getPrompt('debate.clarification_answer', ANALYST_CLARIFICATION_RESPONSE_PROMPT),
                {
                    NAME: analyst.provider.name,
                    OTHERS: otherAnalystNames.join(', ') || 'none',
                    QUESTION: moderatorQuestion,
                },
            );
            const answerUserContent =
                `${buildFloorOrientation({
                    selfName: analyst.provider.name,
                    otherAnalysts: otherAnalystNames,
                    turn: 'clarification',
                    round: answerRound,
                })}\n\n` +
                `**MODERATOR → ${analyst.provider.name} (answer this speaker — not a new trader request):**\n${moderatorQuestion}\n\n` +
                `**FLOOR TRANSCRIPT (context only):**\n${clarificationTranscript}\n\n` +
                `Respond now with your answer for Round ${answerRound}.` +
                buildLivePriceRefreshBlock(getLivePrice?.() ?? null, 'before the clarification answers');
            const messages: ChatMessage[] = [
                { role: 'system', content: answerSystemPrompt },
                { role: 'user', content: answerUserContent },
            ];
            return {
                name: analyst.provider.name,
                run: async (emit: (delta: string) => void) => {
                    // Bounded retry — same transient-failure semantics as the
                    // rebuttal rounds (see streamWithTransientRetry).
                    await streamWithTransientRetry(
                        () => streamChatWithDeskTools(analyst.provider.config, messages, {
                            temperature: 0.3,
                            signal,
                            trades: fullTradesForRecall,
                            maxTokens: TASK_BUDGETS.clarification,
                            onReasoning: (reasoning: string) => onAnalystReasoning?.(analyst.provider.name, reasoning, answerRound),
                            onToolEvent: (line: string) => {
                                emitLog('tool', line, answerRound, analyst.provider.name);
                                onToolEvent?.(analyst.provider.name, answerRound, line);
                            },
                            defaultSymbol: resolveDefaultSymbol(userPrompt),
                            afterToolsNudge: 'Tool results are above. Answer the Moderator now. No JSON, no tool tags.',
                            // Mail may have arrived since the seat's
                            // last turn — inbox notice + send/read available.
                            mailbox: debateMailbox,
                            mailboxSeat: analyst.provider.name,
                            mailboxRound: answerRound,
                            onMailSent: info => {
                                const key = `${info.from}>${info.to}@${info.round}:${info.text}`;
                                if (announcedDms.has(key)) return;
                                announcedDms.add(key);
                                emitLog('tool', formatDmEventLine({
                                    from: info.from, toKey: info.to.toLowerCase(), toLabel: info.to, text: info.text, round: info.round,
                                }), answerRound, info.from);
                            },
                        }),
                        emit,
                        `${analyst.provider.name} clarification answer`,
                    );
                },
            };
        });

        for (const task of answerTasks) {
            onSpeakerStatus?.(task.name, answerRound, true);
        }
        const answerQueue: { name: string; delta: string }[] = [];
        let answerNotify: (() => void) | null = null;
        let answerFinished = 0;
        const answerTotal = answerTasks.length;
        const answerPush = (name: string, delta: string) => {
            answerQueue.push({ name, delta });
            if (answerNotify) { const n = answerNotify; answerNotify = null; n(); }
        };
        const droppedThisCycle = new Set<string>();
        for (const task of answerTasks) {
            task.run(delta => answerPush(task.name, delta))
                .catch((e: any) => {
                    const isAbort = e?.name === 'AbortError' || e?.code === 'ABORT_ERR' || e?.name === 'TimeoutError';
                    if (!isAbort) {
                        console.warn(`[RealDebate] ${task.name} clarification answer failed:`, e?.message || e);
                        // Drop-out semantics mirror the rebuttal rounds.
                        activeAnalystNames.delete(task.name);
                        if (roundTexts[task.name]) delete roundTexts[task.name][answerRound];
                        droppedNames.add(task.name);
                        droppedThisCycle.add(task.name);
                    }
                })
                .finally(() => {
                    answerFinished++;
                    answerPush('__done__', '');
                });
        }
        while (answerFinished < answerTotal || answerQueue.length > 0) {
            if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
            if (answerQueue.length === 0) {
                await new Promise<void>(resolve => { answerNotify = resolve; });
                continue;
            }
            const item = answerQueue.shift()!;
            if (item.name === '__done__') continue;
            if (droppedThisCycle.has(item.name)) continue;
            roundTexts[item.name][answerRound] = (roundTexts[item.name][answerRound] || '') + item.delta;
            yield { speaker: item.name, round: answerRound, text: item.delta };
        }
        for (const task of answerTasks) {
            onSpeakerStatus?.(task.name, answerRound, false);
        }
        for (const name of droppedThisCycle) {
            yield { speaker: 'System', round: answerRound, text: `${name} dropped out while answering the clarification question (provider stream failed).` };
        }
        // Same replacement hook as the rebuttal rounds: an analyst that dies
        // during clarification can be swapped for a fresh one that participates
        // in any remaining clarification cycles and the verdict.
        if (onReplacementRequested && droppedThisCycle.size > 0) {
            for (const droppedName of droppedThisCycle) {
                if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
                const waitResult = await awaitReplacementWithTimeout(
                    onReplacementRequested(droppedName, answerRound),
                    signal,
                    replacementTimeoutMs ?? DEBATE_REPLACEMENT_WAIT_MS,
                );
                if (waitResult.status === 'timedOut') {
                    yield { speaker: 'System', round: answerRound, text: replacementTimeoutText(droppedName) };
                    continue;
                }
                const replacement = waitResult.value;
                if (replacement && !activeAnalystNames.has(replacement.provider.name)) {
                    injectReplacement(replacement, answerRound);
                    yield { speaker: 'System', round: answerRound, text: `${droppedName} was replaced by ${replacement.provider.name}.` };
                    const { opening, thinking } = openingFromResult(replacement.result);
                    if (thinking) onAnalystReasoning?.(replacement.provider.name, thinking, answerRound);
                    if (opening) yield { speaker: replacement.provider.name, round: answerRound, text: opening };
                }
            }
        }

        // -- Cap: on cycle 3 there is no judgment — proceed to verdict --
        if (cycle === MAX_CLARIFICATION_CYCLES) {
            // The moderator never judged this last cycle, so residual
            // concerns are unknown. Flag it so the verdict is written with
            // honest uncertainty instead of silently dropped dissatisfaction.
            const unresolvedBlock = [
                '**UNRESOLVED CONCERNS:** the clarification budget ran out after your last round of questions without a satisfaction judgment.',
                'The analysts\' latest answers may still leave open questions. In the verdict:',
                '- state explicitly which concerns REMAIN open (or that none do), and',
                '- widen uncertainty on the affected plan fields rather than presenting false precision.',
                'Do not re-ask questions — rule with what is on the table.',
            ].join('\n');
            verdictAddendum = `${verdictAddendum}\n\n${unresolvedBlock}`;
            break;
        }

        // -- MODERATOR JUDGMENT (short internal call) --
        const judgmentRound = answerRound;
        const judgmentTranscript = buildDebateTranscript(
            names,
            roundTexts,
            answerRound,
            100,
            1500,
        );
        onSpeakerStatus?.('Moderator', judgmentRound, true);
        let judgmentText = '';
        let satisfied = true;
        try {
            for await (const chunk of getModeratorAnalysisStream(
                moderatorConfig, moderatorModel,
                `${getPrompt('debate.clarification_judgment', MODERATOR_CLARIFICATION_JUDGMENT_PROMPT)}\n\n**THE CYCLE Q&A:**\n${judgmentTranscript}`,
                signal,
                undefined,
                resolveDefaultSymbol(userPrompt),
                (line: string) => {
                    emitLog('tool', line, judgmentRound, 'Moderator');
                    onToolEvent?.('Moderator', judgmentRound, line);
                },
            )) {
                if (chunk) judgmentText += chunk;
            }
        } catch (e: any) {
            const isAbort = e?.name === 'AbortError' || e?.code === 'ABORT_ERR' || e?.name === 'TimeoutError';
            if (isAbort) throw e;
            console.warn('[RealDebate] Clarification judgment call failed; treating as satisfied.', e?.message || e);
        } finally {
            onSpeakerStatus?.('Moderator', judgmentRound, false);
        }
        // Judgment is internal: it affects control flow but never becomes a
        // visible transcript turn or consumes a round number.
        // Fail-safe: ambiguous/empty judgment → treat as satisfied, proceed.
        const upper = judgmentText.toUpperCase();
        if (upper.includes('UNSATISFIED')) {
            satisfied = false;
        }
        if (satisfied) {
            break;
        }
        // else: loop again for another cycle
    }

    // --- FINAL: MODERATOR VERDICT ---
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    // Include every visible analyst and moderator turn in chronological order.
    // The per-turn 100-token cap is unchanged; the total cap is raised so all
    // clarification cycles fit before the verdict.
    const transcriptBlock = buildDebateTranscript(names, roundTexts, lastRebuttalRound, 100, 2400);
    const steerVerdict = takeSteering(lastRebuttalRound + 1);
    if (steerVerdict) {
        yield { speaker: 'System', round: lastRebuttalRound + 1, text: `User steering: ${steerVerdict}` };
    }
    emitLog('verdict', 'Moderator verdict', lastRebuttalRound + 1, 'Moderator');

    // --- CONTEXT BLOCKS (reused from the simulated-debate machinery) ---
    let mcContext = "No Monte Carlo simulation data available.";
    if (monteCarloResults && monteCarloResults.length > 0) {
        mcContext = "**MONTE CARLO STATISTICAL VALIDATION:**\n";
        monteCarloResults.forEach(mc => {
            if (mc.result) {
                mcContext += `- ${mc.provider}: Win Rate ${mc.result.winRate}%, EV ${mc.result.expectedValue}R, Max DD ${mc.result.maxDrawdownAvg}%\n`;
            }
        });
    }

    const tradeHistoryContext = finalTradeSummary
        ? `**PATTERN MEMORY LIBRARY (pre-processed recent trade summary):**\n${truncateTextToTokens(finalTradeSummary, 750)}`
        : "No past trades logged.";

    let recentInsightsBlock = '';
    if (tradeSummaries && tradeSummaries.length > 0) {
        const top5 = tradeSummaries.slice(0, 5);
        recentInsightsBlock = `\n**RECENT INSIGHTS FOR PATTERN MATCHING (Top ${top5.length}):**\n`;
        top5.forEach((insight, idx) => {
            const date = new Date(insight.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            recentInsightsBlock += `${idx + 1}. [${date}] ${insight.summaryText.slice(0, 200)}...\n`;
        });
    }

    const parsedMarketData = parseLiveMarketData(userPrompt);
    let marketDataOverride = '';
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

    const userOverride = customInstructions
        ? `\n\n**USER BEHAVIOR OVERRIDE:**\nThe user has provided specific instructions for how you must respond, calculate, and reason. These instructions take precedence over default tone/style settings:\n"${truncateTextToTokens(customInstructions, 125)}"\n`
        : '';

    const effectiveTradingStyle = lensConfig?.tradingStyle === 'auto' ? 'swing' : (lensConfig?.tradingStyle || 'swing');
    const lensContext = generateLensContext(
        names,
        analystProviders || [],
        lensConfig,
        'medium',
        effectiveTradingStyle as 'swing' | 'scalp'
    );

    // Seat-trust weighting: historical calibration per seat.
    const providerIdBySeat: Record<string, string | undefined> = {};
    for (const seat of debateRoster) providerIdBySeat[seat.provider.name] = seat.provider.config.id;

    const moderatorPrompt = [
        getPrompt('debate.final_verdict', MODERATOR_FINAL_VERDICT_PROMPT).replace('{{ANALYSTS}}', names.join(', ')),
        // Verdict evidence pack: proactive journal evidence —
        // cluster stats, similar trades, matched skills, doctrine header — so
        // the binding verdict does not depend on remembering to call recall.
        (() => {
            try {
                return buildVerdictEvidencePack(deriveSetupQueryFromPrompt(userPrompt), fullTradesForRecall).promptBlock;
            } catch { return ''; }
        })(),
        `\n\n**THE DEBATE TRANSCRIPT (EPISODES):**\n${transcriptBlock}`,
        // Direct messages: the private side-channel is evidence for
        // the arbiter — who messaged whom often explains a stance shift that
        // the public transcript alone doesn't.
        (() => {
            const all = debateMailbox.all();
            if (all.length === 0) return '';
            const lines = all.map(m => `- ${m.from} → ${m.toLabel} (Round ${m.round}): ${m.text}`);
            return `\n\n**DIRECT MESSAGES EXCHANGED DURING THE DEBATE:**\n${lines.join('\n')}`;
        })(),
        // Final-stance divergence summary — recomputed AFTER clarification so
        // the moderator sees where each seat LANDED, not just the openings.
        `\n\n${summarizeFinalPositions(roundTexts, names).block}`,
        buildConvictionAuctionBlock(roundTexts, names, lastRebuttalRound) ? `\n\n${buildConvictionAuctionBlock(roundTexts, names, lastRebuttalRound)}` : '',
        buildSeatTrustBlock(names, providerIdBySeat, fullTradesForRecall as never) ? `\n\n${buildSeatTrustBlock(names, providerIdBySeat, fullTradesForRecall as never)}` : '',
        `\n\n**TRADING REQUEST:**\n${truncateTextToTokens(userPrompt, 350)}`,
        steerVerdict ? `\n\n**USER STEERING (queued mid-debate — follow this):**\n${steerVerdict}` : '',
        // Honest-uncertainty instructions when clarification ran out of
        // budget without a satisfaction judgment.
        verdictAddendum.trim() ? verdictAddendum : '',
        marketDataOverride,
        generateGateReconciliationContext(gateResult ?? null, []),
        // Live-path divergence + calibration: previously these only existed in
        // the dead two/three-way debate generators, so the real debate's
        // moderator never saw echo-chamber warnings or historical accuracy.
        // The full roster (original + mid-debate replacements) is used so the
        // names↔results alignment is exact.
        generateDivergenceContext(debateRoster.map(a => a.result), names),
        buildCalibrationContext(debateRoster.map(a => ({ name: a.provider.name, providerId: a.provider.config.id, result: a.result }))),
        buildLivePriceRefreshBlock(getLivePrice?.() ?? null, 'before the final verdict'),
        mcContext,
        lensContext,
        learningContext ? `\n\n**LEARNING CONTEXT (from the user's trading history):**\n${truncateTextToTokens(learningContext, 500)}` : '',
        recentInsightsBlock,
        userOverride,
        tradeHistoryContext,
        hybridContext ? `\n\n**HYBRID INTELLIGENCE MARKET DATA (VERIFIED LIVE):**\n${hybridContext}` : '',
    ].filter(Boolean).join('\n');

    // Compact fallback used for ONE automatic retry when the first moderator
    // attempt errors or produces no JSON plan (long prompts are the usual
    // culprit on reasoning-heavy models). The chart context still rides along
    // so the retry is not blind.
    const compactModeratorPrompt = [
        getPrompt('debate.final_verdict_compact', MODERATOR_FINAL_VERDICT_PROMPT_COMPACT).replace('{{ANALYSTS}}', names.join(', ')),
        `\n\n**THE DEBATE TRANSCRIPT (EPISODES):**\n${transcriptBlock}`,
        hybridContext ? `\n\n**HYBRID INTELLIGENCE MARKET DATA (VERIFIED LIVE):**\n${truncateTextToTokens(hybridContext, 1500)}` : '',
    ].join('\n');

    const finalRound = lastRebuttalRound + 1;
    const attempts = [moderatorPrompt, compactModeratorPrompt];
    for (let attempt = 0; attempt < attempts.length; attempt++) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        onSpeakerStatus?.('Moderator', finalRound, true);
        let moderatorText = '';
        let streamFailed = false;
        try {
            for await (const chunk of getModeratorAnalysisStream(moderatorConfig, moderatorModel, attempts[attempt], signal, moderatorReasoningFor(finalRound), resolveDefaultSymbol(userPrompt), (line: string) => {
                emitLog('tool', line, finalRound, 'Moderator');
                onToolEvent?.('Moderator', finalRound, line);
            }, undefined, debateMailbox, info => {
                // Moderator DMs surface as tool events + a System line.
                const dmLine = formatDmEventLine({
                    from: info.from, toKey: info.to.toLowerCase(), toLabel: info.to, text: info.text, round: finalRound,
                });
                emitLog('tool', dmLine, finalRound, 'Moderator');
                onToolEvent?.('Moderator', finalRound, dmLine);
            }, finalRound)) {
                if (chunk) {
                    moderatorText += chunk;
                    yield { speaker: 'Moderator', round: finalRound, text: chunk };
                }
            }
        } catch (e: any) {
            const isAbort = e?.name === 'AbortError' || e?.code === 'ABORT_ERR' || e?.name === 'TimeoutError';
            if (isAbort) throw e;
            // A thrown stream error (network, provider 5xx) is a failed attempt
            // too — previously it skipped the compact-prompt retry entirely.
            console.warn(`[RealDebate] Moderator attempt ${attempt + 1} threw:`, e?.message || e);
            streamFailed = true;
        } finally {
            onSpeakerStatus?.('Moderator', finalRound, false);
        }
        // Retry only when the attempt clearly failed: a thrown error, an error
        // marker, or no FINAL TRADE PLAN markdown block anywhere in the
        // response. The moderator call is always a fresh streamChatRequest
        // with its own prompt — never a reused analyst result, even when the
        // same model fills both roles. The plan labels must be PRESENT: a
        // truncated response with an opening label but no values would skip
        // the compact-prompt retry and send a broken plan to the parser.
        const hasMarkdownPlan = !streamFailed && (
            /\*\*FINAL TRADE PLAN\*\*/i.test(moderatorText)
            || /(?:^|\n)\s*-\s*\*\*?(?:Coin|Direction|Entry|Stop Loss|Take Profit)\*\*?\s*[:：]/i.test(moderatorText)
            || /(?:^|\n)\s*(?:Coin|Direction|Entry|Stop Loss)\s*[:：]/i.test(moderatorText)
        );
        const hasErrorMarker = !streamFailed && /<MODERATOR_ERROR>/.test(moderatorText);
        if (hasMarkdownPlan && !hasErrorMarker) break;
        if (attempt === attempts.length - 1) break;
        console.warn(`[RealDebate] Moderator attempt ${attempt + 1} failed (markdownPlan=${hasMarkdownPlan}, errorMarker=${hasErrorMarker}); retrying with compact prompt.`);
        // Reset the consumer's accumulated text for this round before the
        // retry streams — otherwise the failed attempt's partial prose
        // concatenates with the successful verdict in one bubble.
        yield { speaker: 'Moderator', round: finalRound, text: `\n${MODERATOR_RETRY_MARKER}\n` };
    }
};

export const conductTwoWayPostMortemDebate = (
    originalMessage: Message,
    outcome: TradeOutcome,
    analyst1PM: string,
    analyst2PM: string,
    analyst1Name: string,
    analyst2Name: string,
    finalTradeSummary: string | null,
    moderatorConfig: ProviderConfig,
    moderatorModel: string,
    postTradeImageSummaries?: string[],
    trades?: LoggedTrade[], // NEW: Pass trades for synthesis
    signal?: AbortSignal, // Cancellation for the moderator stream
    onReasoning?: (reasoning: string) => void // Captures the moderator's chain of thought (harness-style thinking blocks)
): AsyncGenerator<string, void, unknown> => {

    const imageContext = postTradeImageSummaries?.length ? `** VERIFIED TRADE OUTCOME DATA (HIGHEST PRIORITY):**\n${postTradeImageSummaries.join('\n---\n')}` : `No post-trade data was provided.`;

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

    const extendedSLZoneContext = getPrompt('postmortem.extended_sl_zone', EXTENDED_SL_ZONE_DEBATE_CONTEXT);

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

    **PROBABILITY ASSESSMENT:** Include a prose assessment of the probability that the SL and TP levels would have been hit — no JSON structure.

    ${getPrompt('debate.moderator_authority', MODERATOR_FINAL_AUTHORITY_PROTOCOL)}

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

     CONCLUSION (MANDATORY – END WITH THIS FORMAT)

     CONCLUSION

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

    return getModeratorAnalysisStream(moderatorConfig, moderatorModel, moderatorPrompt, signal, onReasoning, undefined, undefined, trades);
};

/**
 * On-demand probability recalculation for existing trade analyses.
 * Forces the AI to identify TPs and output the new dynamic array format.
 */
export const recalculateProbabilities = async function* (
    analysis: TradeAnalysis,
    moderatorConfig: ProviderConfig,
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
        
        ${getPrompt('debate.probability_estimation', PROBABILITY_ESTIMATION_PROMPT)}

        **CRITICAL:** 
        1. Parse the "takeProfit" array in the ORIGINAL ANALYSIS to see how many TPs exist.
        2. Output ONLY a valid JSON object matching the "levelProbabilities" schema.
        3. Do NOT include any other text outside the JSON block.
        4. If you wrap the JSON in a field, use "levelProbabilities" as the top-level key.
    `;

    yield* getModeratorAnalysisStream(moderatorConfig, moderatorModel, prompt);
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
    moderatorConfig: ProviderConfig,
    moderatorModel: string,
    postTradeImageSummaries?: string[],
    signal?: AbortSignal, // Cancellation for the moderator stream
    onReasoning?: (reasoning: string) => void // Captures the moderator's chain of thought (harness-style thinking blocks)
): AsyncGenerator<string, void, unknown> => {

    const imageContext = postTradeImageSummaries?.length ? `** VERIFIED TRADE OUTCOME DATA (HIGHEST PRIORITY):**\n${postTradeImageSummaries.join('\n---\n')}` : `No post-trade data was provided.`;
    const tradeHistoryContext = finalTradeSummary ? `**PATTERN MEMORY LIBRARY (Historical Context):**\n${truncateTextToTokens(finalTradeSummary, 1500)}` : "No past trades logged.";

    const extendedSLZoneContext = getPrompt('postmortem.extended_sl_zone', EXTENDED_SL_ZONE_DEBATE_CONTEXT);

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

    **PROBABILITY ASSESSMENT:** Include a prose assessment of the probability that the SL and TP levels would have been hit — no JSON structure.

    ${getPrompt('debate.moderator_authority', MODERATOR_FINAL_AUTHORITY_PROTOCOL)}

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

     CONCLUSION (MANDATORY – END WITH THIS FORMAT)

     CONCLUSION

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

    return getModeratorAnalysisStream(moderatorConfig, moderatorModel, moderatorPrompt, signal, onReasoning);
};
