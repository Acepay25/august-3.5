/**
 * GenericAnalysisService — Consolidated analysis service parameterized by ProviderConfig.
 *
 * Replaces the 9 per-provider main services + 9 accuracy services. All AI calls
 * route through GenericProviderService (no per-provider clients, no process.env keys).
 *
 * `analyzeTradingView` unifies the standard-mode and accuracy-mode prompt paths
 * via composePrompt (contract once + this-turn job + extras).
 */

import { ProviderConfig } from '../../types/provider';
import { Message, GroundingChunk, TradeAnalysis, GlobalMemory, AccuracySubMode, TradeOutcome, LoggedTrade, StrategySearchResult, TradeSummary, MessageRole } from '../../types';
import { extractAndParseJson, extractLastJson } from '../../utils/jsonUtils';
import { sanitizeAIResponse, sanitizeAIResponseLight, sanitizeJSONString } from '../../utils/sanitizers';
import { sanitizeTradeAnalysis, truncateTextToTokens, formatAnalysisForDisplay, parsePrice } from '../../utils/analysisUtils';
import { splitThinkingFromOutput, extractAndStripThinkBlocks, createThinkingStreamGate } from '../../utils/thinkingSplit';
import { buildTradeInsightBrief, compactInsightForPatternMemory } from '../../utils/tradeInsightBrief';
import { parseGlobalMemory, parseStrategySearchResults } from '../../schemas/learning';
import {
    MASTER_ANALYSIS_PROMPT,
    LENS_MODE_BASE_PROMPT, COMPACT_ANALYSIS_PROMPT, ACCURACY_MODE_PROMPT, PURE_AI_MODE_PROMPT,
    RISK_MANAGEMENT_RULES, TRADING_FAMILIES_PROMPT, AI_PROVIDER_MEMORY_ENFORCEMENT_PROMPT,
    ENTRY_NOT_HIT_ANALYSIS_PROMPT, ENTRY_NOT_HIT_ANALYSIS_QUESTIONS,
    HARNESS_CONTRACT_PROMPT,
} from '../../constants/prompts';
import { constructOptimizedContext } from '../../utils/memoryUtils';
import { parseLiveMarketData } from '../../utils/liveMarketParser';
import {
    sendChatRequest, streamChatRequest, ChatMessage, ContentPart, ChatRequestOptions,
} from './GenericProviderService';
import { TASK_BUDGETS } from './taskBudgets';
import { EFFORT_BY_TASK, WireAuditEntry } from './reasoningControls';
import { getPrompt } from '../infrastructure/PromptOverrideService';
import { getMemoryFilesContext } from '../learning/MemoryFilesService';
import { composePrompt } from '../../utils/composePrompt';
import { getHarnessSettings } from '../../utils/harnessSettings';
import {
    DESK_TOOLS_PROMPT,
    TEXT_TOOL_FALLBACK_PROMPT,
    resolveDefaultSymbol,
    streamChatWithDeskTools,
} from '../analysis/DeskToolsService';

import { isVisionModel } from '../../utils/modelUtils';

// ─── Helpers ────────────────────────────────────────────────────────────────

const fileToBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
});

/** Small-context models need aggressively truncated prompts. */
function isSmallContextModel(modelId: string): boolean {
    const m = modelId.toLowerCase();
    return m.includes('kimi') || m.includes('gpt-oss-20b') || m.includes('mistral-7b');
}

/**
 * Remove legacy XML tags and standalone label headers from text destined for
 * display, so historical/cached responses never show format scaffolding.
 */
function stripTagArtifacts(text: string): string {
    return text
        .replace(/<THINKING>[\s\S]*?<\/THINKING>/gi, '')
        .replace(/<FINAL_OUTPUT>[\s\S]*?<\/FINAL_OUTPUT>/gi, '')
        .replace(/<\/?(?:THINKING|FINAL_OUTPUT)>/gi, '')
        .replace(/^\s*(?:\*\*)?(?:THINKING|FINAL OUTPUT|FINAL_OUTPUT)(?:\*\*)?\s*:?\s*$/gim, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

// ─── Analyst structured-plan extraction ─────────────────────────────────────
// Analysts write readable prose (the prompts forbid JSON), but every
// structured consumer downstream — per-analyst Monte Carlo, the consensus
// panel, pre-debate divergence detection, Bayesian calibration, and the
// Gate's confidence-conflict challenge — keys on
// analysis.entryPoints/stopLoss/takeProfit/probability. Before this parser
// existed the pipeline stored a hardcoded Neutral/Low placeholder per
// analyst, silently killing all of those consumers. This mines the fields
// out of the prose: labeled values first (Direction / Entry / Stop Loss /
// Probability), then a TRADE PLAN BLOCK if a model still emits one. Prompts
// no longer mandate that block — a fabricated N/A pad is worse than omitting
// a field.

export interface ParsedTradePlan {
    direction?: 'Long' | 'Short' | 'Neutral';
    entryPoints?: string[];
    stopLoss?: string;
    takeProfit?: string[];
    probability?: number;
    confidence?: 'High' | 'Medium' | 'Low' | 'Avoid';
}

/** Price tokens out of a labeled line: "94,500 – 94,800 (limit)" → ["94,500","94,800"]. */
const priceTokens = (line: string): string[] =>
    (line.match(/\d[\d,]*(?:\.\d+)?/g) || []).filter(t => t !== '');

const firstPriceToken = (line: string): string | undefined => priceTokens(line)[0];

/**
 * Value after a labeled line: the inline capture, or the NEXT line when the
 * label ends with the colon — the lens prompts put the value on the
 * following line ("**Optimal Entry Zone:**\n$93,800 to $94,200").
 */
const labeledValue = (text: string, match: RegExpMatchArray | null, group = 1): string => {
    if (!match) return '';
    const inline = (match[group] ?? '').trim();
    if (inline) return inline;
    const rest = text.slice((match.index ?? 0) + match[0].length);
    return rest.split('\n')[0].trim();
};

export const extractStructuredPlanFromProse = (text: string): ParsedTradePlan => {
    if (!text) return {};
    const plan: ParsedTradePlan = {};

    // --- Direction: labeled forms first ("Direction:", "MACRO BIAS:",
    // "TECHNICAL BIAS:", "VERDICT:", "Bias:"), then explicit ALL-CAPS
    // LONG/SHORT (lens roles write "TECHNICAL BIAS: LONG"). Labels may be
    // markdown-bolded with the COLON INSIDE the markers ("**MACRO
    // VERDICT:** Bullish") — the \*{0,2} bridges on both sides of the colon
    // see through that. Bare lowercase "bullish"/"bearish" in prose is
    // never enough — sentence noise. A label whose line lists competing
    // options ("LONG / SHORT / NO TRADE") means the model echoed the
    // template — no verdict.
    const dirLabel = text.match(/Direction\s*\*{0,2}\s*:\s*\*{0,2}\s*(Long|Short|Neutral|Bullish|Bearish|Buy|Sell)/i)
        || text.match(/(?:MACRO|TECHNICAL|FINAL|TRADE|TOTAL)\s*(?:BIAS|VERDICT|RECOMMENDATION|OUTLOOK)\s*\*{0,2}\s*:\s*\*{0,2}\s*(?:(?:STRONG|WEAK|CONFIRMED)\s+)?(Long|Short|Neutral|Bullish|Bearish|Buy|Sell|NO\s*TRADE)/i)
        || text.match(/(?:Bias|Verdict|Outlook|Thesis|Recommendation)\s*\*{0,2}\s*:\s*\*{0,2}\s*(Long|Short|Neutral|Bullish|Bearish|Buy|Sell|NO\s*TRADE)/i);
    if (dirLabel) {
        const word = dirLabel[1].toLowerCase();
        const mapped = word.includes('long') || word.includes('bull') || word.includes('buy')
            ? 'Long'
            : word.includes('short') || word.includes('bear') || word.includes('sell') ? 'Short' : 'Neutral';
        const labelEnd = (dirLabel.index ?? 0) + dirLabel[0].length;
        const lineEnd = text.indexOf('\n', labelEnd);
        const labelLine = text.slice(labelEnd, lineEnd === -1 ? text.length : lineEnd);
        // Echo detection: the template prints "Long/Short/Neutral" (lowercase,
        // slash-separated) — the old case-sensitive single-word check never
        // caught it, so a literal template echo parsed as a real verdict.
        // A line listing ≥2 distinct options means the model echoed the
        // template, not a decision.
        const optionWords = ['LONG', 'SHORT', 'NEUTRAL', 'NO TRADE'];
        const echoedCount = optionWords.filter(w =>
            new RegExp(w.replace(' ', '\\s+'), 'i').test(labelLine)
        ).length;
        const echoedOptions = echoedCount >= 2;
        if (!echoedOptions) plan.direction = mapped;
    }
    if (!plan.direction) {
        const explicitLong = /\bLONG\b/.test(text);
        const explicitShort = /\bSHORT\b/.test(text);
        if (explicitLong !== explicitShort) plan.direction = explicitLong ? 'Long' : 'Short';
    }

    // --- Entry (single price or zone — both survive parsePrice; the value
    // may sit on the next line, see labeledValue) ---
    const entryLine = text.match(/Entry(?:\s*Zone)?\s*\*{0,2}\s*:\s*\*{0,2}\s*([^\n]*)/i);
    if (entryLine) {
        const entryRaw = labeledValue(text, entryLine);
        if (entryRaw && !/N\/?A/i.test(entryRaw)) {
            const tokens = priceTokens(entryRaw);
            if (tokens.length > 0) {
                plan.entryPoints = [tokens.length > 1 ? `${tokens[0]} - ${tokens[tokens.length - 1]}` : tokens[0]];
            }
        }
    }

    // --- Stop loss ("Stop Loss:", "SL:"; "Stop Loss Percentage:" is
    // deliberately NOT matched — the colon comes after "Percentage"). ---
    const slLine = text.match(/(?:Stop Loss|SL)\s*(?:1)?\s*\*{0,2}\s*:\s*\*{0,2}\s*([^\n]*)/i);
    if (slLine) {
        const slRaw = labeledValue(text, slLine);
        if (slRaw && !/N\/?A/i.test(slRaw)) {
            const sl = firstPriceToken(slRaw);
            if (sl) plan.stopLoss = sl;
        }
    }

    // --- Take profits ("Take Profit 1:", "TP1:") ---
    const tpLines = [...text.matchAll(/(?:Take Profit|TP)\s*(\d)?\s*\*{0,2}\s*:\s*\*{0,2}\s*([^\n]*)/gi)];
    if (tpLines.length > 0) {
        plan.takeProfit = tpLines
            .map(m => {
                const raw = labeledValue(text, m, 2);
                return raw && !/N\/?A/i.test(raw) ? firstPriceToken(raw) : undefined;
            })
            .filter((t): t is string => !!t);
    }

    // --- Probability (the master prompt's "Long Probability %: 65%"; a bare
    // "Probability: 65" too). 1–10 role scales ("MACRO CONFIDENCE: 7") are
    // NOT probabilities and stay unmatched — the schema's confidence path
    // handles those separately. The range-guard rejects a template echo
    // ("<0-100>%") — "100" inside a range must not read as 100%.
    const probMatch = text.match(/Probability\s*\*{0,2}\s*%?\s*:\s*\*{0,2}\s*(?<![-–—])(\d+(?:\.\d+)?)\s*%/i);
    if (probMatch) {
        const p = parseFloat(probMatch[1]);
        if (!isNaN(p) && p > 0 && p <= 100) plan.probability = p;
    }

    // --- Confidence label ("Confidence: High") ---
    const confMatch = text.match(/(?:Confidence|Conviction)\s*\*{0,2}\s*:\s*\*{0,2}\s*(High|Medium|Med|Low|Avoid)/i);
    if (confMatch) {
        // Echo guard: "**Family Confidence:** High / Medium / Low" (a template
        // echo listing multiple options) must not parse as a real label —
        // the old check turned it into confidence='High'.
        const labelEnd = (confMatch.index ?? 0) + confMatch[0].length;
        const lineEnd = text.indexOf('\n', labelEnd);
        const labelLine = text.slice(labelEnd, lineEnd === -1 ? text.length : lineEnd);
        const confOptions = ['HIGH', 'MEDIUM', 'LOW', 'AVOID'];
        const confEchoed = confOptions.filter(w =>
            new RegExp(w, 'i').test(labelLine)
        ).length >= 2;
        if (confEchoed) {
            plan.confidence = undefined;
        } else {
            const c = confMatch[1].toLowerCase();
            plan.confidence = c === 'med' || c === 'medium' ? 'Medium'
                : c === 'high' ? 'High'
                : c === 'low' ? 'Low'
                : c === 'avoid' ? 'Avoid'
                : undefined;
        }
    }

    return plan;
};

// ─── analyzeTradingView ─────────────────────────────────────────────────────

export interface AnalyzeTradingViewParams {
    prompt: string;
    images: File[];
    imageSummaries: string[];
    chatHistory: Message[];
    finalTradeSummary: string | null;       // Pattern Memory (synthesis)
    recentInsights: string | null;          // Recent Insights (individual)
    activeFrameworks: string[];
    deepenAnalysis: boolean;
    globalMemory?: GlobalMemory;
    threadSummary?: string;
    subMode?: AccuracySubMode;
    customInstructions?: string;
    isPlaybookEnabledInPureAI?: boolean;
    isFamiliesEnabledInPureAI?: boolean;
    isMemoryEnabledInPureAI?: boolean;
    rolePrompt?: string;                    // Analyst Lens: specialized role prompt
    /**
     * Summaries of the user's uploaded strategy books (Settings → Strategies),
     * rendered into the system prompt so every analyst persona follows them.
     */
    userStrategies?: string;
    /**
     * User-edited base prompt for Normal mode (Lenses off). Replaces
     * MASTER_ANALYSIS_PROMPT as the standard-mode base while the appended
     * contract sections (rules, formatting, evidence discipline) stay intact.
     */
    systemPromptOverride?: string;
    /**
     * Per-seat independence directive (ensemble openings, Lenses off).
     * Rendered into the SYSTEM prompt near the front — not appended to the
     * user message — so each seat's payload differs from its first bytes.
     * Free-tier gateways dedupe/cache concurrent near-identical prompts keyed
     * on the payload bulk; a differing tail at the end of a long shared user
     * message does not break those cache keys, a differing system head does.
     */
    seatDirective?: string;
    signal?: AbortSignal;
    /**
     * Sampling temperature. Defaults to 0.35 (pro-trader determinism) when
     * omitted. The ensemble raises this per-seat when Lenses are OFF so the
     * three analysts sharing one prompt sample differently instead of
     * collapsing to near-identical output.
     */
    temperature?: number;
    allowedTools?: string[];
    /** Closed-trade journal for the `recall`/`get_setup_history_stats` desk
     *  tools: without it the single-analysis path had desk tools
     *  but no history to recall. */
    trades?: LoggedTrade[];
    onReasoning?: (reasoning: string) => void;
    /** Visible content deltas as they stream — lets the Floor show the
     *  answer (and any untagged thinking) forming live, not just at the end. */
    onPartialOutput?: (chunk: string) => void;
    /** Wire-audit sink (P5) — receives the applied reasoning-route label for
     *  this call so the debate run log can show what the wire received. */
    onWireAudit?: (entry: WireAuditEntry) => void;
}

export async function analyzeTradingView(
    config: ProviderConfig,
    params: AnalyzeTradingViewParams
): Promise<{ analysis: TradeAnalysis; thoughtProcess: string; finalOutput: string; sources: GroundingChunk[] }> {
    const {
        prompt, images, imageSummaries, chatHistory, finalTradeSummary, recentInsights,
        activeFrameworks, globalMemory, threadSummary, subMode, customInstructions,
        isPlaybookEnabledInPureAI, isFamiliesEnabledInPureAI, isMemoryEnabledInPureAI,
        rolePrompt, systemPromptOverride, seatDirective, userStrategies, signal, temperature, onReasoning, onPartialOutput, onWireAudit,
    } = params;

    const modelName = config.selectedModel;
    const hasImages = images.length > 0;
    const isAccuracyMode = subMode !== undefined && subMode !== 'original';
    const isPureAiMode = subMode === 'pure_ai';

    // --- LIVE MARKET DATA PARSING & INJECTION ---
    const parsedMarketData = parseLiveMarketData(prompt);
    let marketDataOverride = "";
    if (parsedMarketData) {
        marketDataOverride = `
    **VERIFIED LIVE MARKET TELEMETRY (HIGHEST PRIORITY):**
    Use this exact data for your analysis. Do NOT output "N/A" for these fields.

    - **Prices:** ${JSON.stringify(parsedMarketData.prices)}
    - **Detected Patterns:** ${JSON.stringify(parsedMarketData.patterns)}
    - **Key Zones:** ${JSON.stringify(parsedMarketData.keyZones)}

    **MANDATORY:** Reference these detected patterns, key zones, and prices in your readable final output.
        `;
    }

    const memoryToUse = (isPureAiMode && !isMemoryEnabledInPureAI) ? undefined : globalMemory;
    const memoryContext = isAccuracyMode
        ? constructOptimizedContext(chatHistory, threadSummary, memoryToUse)
        : truncateTextToTokens(constructOptimizedContext(chatHistory, threadSummary, globalMemory), 800);

    const frameworksList = activeFrameworks.map((fw, index) => `${index + 1}. **${fw}**`).join('\n');
    const userStrategiesBlock = userStrategies
        ? `\n**USER STRATEGIES (from uploaded books — follow these when they apply):**\n${userStrategies}`
        : '';
    const imageSummaryContext = imageSummaries.length > 0
        ? `**PRE-PROCESSED VISION ANALYSIS**...\n${imageSummaries.join('\n\n---\n\n')}`
        : "No chart data provided.";

    const userOverride = customInstructions
        ? `\n\n**USER BEHAVIOR OVERRIDE:**\nThe user has provided specific instructions for how you must respond, calculate, and reason. These instructions take precedence over default tone/style settings:\n"${customInstructions}"\n`
        : "";

    const visionDeepDive = hasImages
        ? `**ENHANCED VISION ANALYTICS PROTOCOL:**
           - You have direct access to the high-fidelity chart images.
           - **OCR & TEXT:** Perform a pixel-perfect scan to read all text labels, indicator settings (e.g. RSI 14), timestamps, and price axes.
           - **MICRO-STRUCTURE:** Extract PRECISE price levels, wick behaviors, and hidden liquidity pools from the visual data.
           - **CONTEXT:** If this is a trading terminal screenshot, extract any visible PnL, leverage, or account data.
           - Visually confirm the "Market Classification Family" based on candle structure.`
        : '';

    // --- BUILD SYSTEM PROMPT ---
    // Contract once, then persona/job, then extras. Nested harness copies are stripped.
    // The seat directive sits directly after the contract so seats diverge from
    // the first bytes of the payload (see AnalyzeTradingViewParams.seatDirective).
    const seatBlock = seatDirective
        ? `**INDEPENDENT SEAT DIRECTIVE**\n\n${seatDirective}`
        : '';
    const roleBlock = rolePrompt
        ? `**SPECIALIZED ANALYST ROLE ACTIVE**\n\n${rolePrompt}`
        : '';
    const playbookBlock = frameworksList
        ? `**PLAYBOOK: CORE TRADING FRAMEWORKS**\n${frameworksList}`
        : '';
    const outputContract = `**OUTPUT:** No JSON, XML, restated instructions, section templates, or TRADE PLAN BLOCK. Public reply: the call (direction + key levels), then only the findings that support it. Name prices in the sentences when you have them (Direction, Entry, Stop Loss, Take Profit, Probability: N%). Name an invalidation price. Use retrieved memory only when it matches this setup.`;
    const deskToolsEnabled = getHarnessSettings().deskToolsEnabled && !isSmallContextModel(modelName);
    const deskToolsNative = deskToolsEnabled && config.apiFormat === 'chat_completions';
    const deskToolsBlock = deskToolsEnabled
        ? `${DESK_TOOLS_PROMPT}${deskToolsNative ? '' : TEXT_TOOL_FALLBACK_PROMPT}`
        : '';

    let systemPrompt: string;
    if (isPureAiMode) {
        const playbookContext = isPlaybookEnabledInPureAI
            ? `**PLAYBOOK REFERENCE (ENABLED BY USER):**\nAlthough this is Pure AI Mode, the user has enabled access to the following frameworks as a reference:\n${frameworksList}\nYou may use these if they align with your reasoning.`
            : '';
        const familiesContext = isFamiliesEnabledInPureAI
            ? `**MARKET CLASSIFICATION FAMILIES (ENABLED BY USER):**\nAlthough this is Pure AI Mode, the user has explicitly requested that you classify the setup into one of the following Families:\n${getPrompt('analysis.families', TRADING_FAMILIES_PROMPT)}\nYou MUST assign a 'detectedPatternFamily' (Family A, B, C, or Omega) based on your reasoning.`
            : '';
        const memoryContextPrompt = isMemoryEnabledInPureAI
            ? `**PATTERN MEMORY REFERENCE (ENABLED BY USER):** Use retrieved history only when it matches this coin, direction, or regime.`
            : '';
        systemPrompt = composePrompt([
            { id: 'contract', text: HARNESS_CONTRACT_PROMPT },
            { id: 'seat', text: seatBlock },
            { id: 'role', text: roleBlock },
            { id: 'job', text: getPrompt('analysis.pure_ai', PURE_AI_MODE_PROMPT) },
            { id: 'vision', text: visionDeepDive },
            { id: 'override', text: userOverride },
            { id: 'playbook', text: playbookContext },
            { id: 'families', text: familiesContext },
            { id: 'memory', text: memoryContextPrompt },
            { id: 'strategies', text: userStrategiesBlock },
            { id: 'desk_tools', text: deskToolsBlock },
            { id: 'risk', text: getPrompt('analysis.risk_rules', RISK_MANAGEMENT_RULES) },
            { id: 'output', text: outputContract },
        ]);
    } else if (isAccuracyMode) {
        systemPrompt = composePrompt([
            { id: 'contract', text: HARNESS_CONTRACT_PROMPT },
            { id: 'seat', text: seatBlock },
            { id: 'role', text: roleBlock },
            { id: 'accuracy', text: getPrompt('analysis.accuracy', ACCURACY_MODE_PROMPT) },
            { id: 'job', text: getPrompt('analysis.master', MASTER_ANALYSIS_PROMPT) },
            { id: 'vision', text: visionDeepDive },
            { id: 'override', text: userOverride },
            { id: 'playbook', text: playbookBlock },
            { id: 'strategies', text: userStrategiesBlock },
            { id: 'memory', text: getPrompt('analysis.memory_enforcement', AI_PROVIDER_MEMORY_ENFORCEMENT_PROMPT) },
            { id: 'desk_tools', text: deskToolsBlock },
            { id: 'risk', text: getPrompt('analysis.risk_rules', RISK_MANAGEMENT_RULES) },
            { id: 'output', text: outputContract },
        ]);
    } else {
        const basePrompt = rolePrompt
            ? getPrompt('analysis.lens', LENS_MODE_BASE_PROMPT)
            : (systemPromptOverride || getPrompt('analysis.master', MASTER_ANALYSIS_PROMPT));
        systemPrompt = composePrompt([
            { id: 'contract', text: HARNESS_CONTRACT_PROMPT },
            { id: 'seat', text: seatBlock },
            { id: 'role', text: roleBlock },
            { id: 'job', text: basePrompt },
            { id: 'vision', text: rolePrompt ? '' : visionDeepDive },
            { id: 'memory', text: getPrompt('analysis.memory_enforcement', AI_PROVIDER_MEMORY_ENFORCEMENT_PROMPT) },
            { id: 'override', text: userOverride },
            { id: 'playbook', text: playbookBlock },
            { id: 'strategies', text: userStrategiesBlock },
            { id: 'desk_tools', text: deskToolsBlock },
            { id: 'risk', text: getPrompt('analysis.risk_rules', RISK_MANAGEMENT_RULES) },
            { id: 'output', text: outputContract },
        ]);
    }


    // --- BUILD USER PROMPT ---
    const isLiveMarketData = prompt.includes("**LIVE MARKET DATA**");
    const isHybridIntelligenceData = prompt.includes("HYBRID INTELLIGENCE") || prompt.includes("VERIFIED MARKET DATA");
    const formattedPrompt = (isLiveMarketData || isHybridIntelligenceData)
        ? `User's request:\n${prompt}\n\n`
        : `User's request: "${prompt}"\n\n`;

    // Standard mode uses pattern memory + recent insights blocks; accuracy mode relies on global memory context.
    let userPromptText: string;
    if (isAccuracyMode) {
        userPromptText = `${formattedPrompt}${marketDataOverride}\n\n${imageSummaryContext}\n\n${memoryContext}\n\nPresent your readable trade proposal.`;
    } else {
        const patternMemoryContext = finalTradeSummary
            ? truncateTextToTokens(`\n\n**PATTERN MEMORY (SYNTHESIS):**\nUse this only if it matches this coin, direction, or regime:\n${finalTradeSummary}\n`, 600)
            : "\n\n** PATTERN MEMORY:** Use the retrieved harness memory in the user request (skills + similar trades). Do not invent a personal track record.\n";
        const recentInsightsContext = recentInsights
            ? truncateTextToTokens(`\n\n**RECENT INSIGHTS:**\nUse matching closed trades only. Ignore unrelated coins/regimes:\n${recentInsights}\n`, 600)
            : "\n\n** RECENT INSIGHTS:** No recent trade insights available.\n";

        if (isSmallContextModel(modelName)) {
            const effectiveSystemPrompt = composePrompt([
                { id: 'contract', text: HARNESS_CONTRACT_PROMPT },
                { id: 'job', text: getPrompt('analysis.compact', COMPACT_ANALYSIS_PROMPT) },
            ]);
            const minimalPattern = patternMemoryContext.length > 400 ? patternMemoryContext.substring(0, 400) + '...[truncated]' : patternMemoryContext;
            const minimalInsights = recentInsightsContext.length > 200 ? recentInsightsContext.substring(0, 200) + '...[truncated]' : recentInsightsContext;
            const minimalImages = imageSummaryContext.length > 500 ? imageSummaryContext.substring(0, 500) + '...[truncated]' : imageSummaryContext;
            systemPrompt = effectiveSystemPrompt;
            userPromptText = `${formattedPrompt}\n\n${marketDataOverride}\n\n${minimalImages}\n\n${minimalPattern}\n\n${minimalInsights}\n\nPresent your readable trade proposal.`;
        } else {
            // Capable models get the LARGER budgets — this was inverted (they
            // were cut harder than the small-context branch, defeating the
            // token-level truncation above). Pattern memory & insights are the
            // highest-value context for the trade proposal.
            const truncatedImages = imageSummaryContext.length > 800 ? imageSummaryContext.substring(0, 800) + '...[truncated for TPM]' : imageSummaryContext;
            const truncatedPattern = patternMemoryContext.length > 600 ? patternMemoryContext.substring(0, 600) + '...[truncated for TPM]' : patternMemoryContext;
            const truncatedInsights = recentInsightsContext.length > 300 ? recentInsightsContext.substring(0, 300) + '...[truncated for TPM]' : recentInsightsContext;
            const truncatedMemory = memoryContext.length > 600 ? memoryContext.substring(0, 600) + '...[truncated for TPM]' : memoryContext;
            userPromptText = `${formattedPrompt}${marketDataOverride}\n\n${truncatedImages}\n\n${truncatedPattern}\n\n${truncatedInsights}\n\n${truncatedMemory}\n\nPresent your readable trade proposal.`;
        }
    }

    // --- BUILD MESSAGES (with optional vision content) ---
    const messages: ChatMessage[] = [{ role: 'system', content: systemPrompt }];

    const canUseVision = isVisionModel(modelName);
    if (canUseVision && hasImages) {
        const parts: ContentPart[] = [{ type: 'text', text: userPromptText }];
        for (const image of images) {
            const base64 = await fileToBase64(image);
            parts.push({ type: 'image_url', image_url: { url: `data:${image.type};base64,${base64}` } });
        }
        messages.push({ role: 'user', content: parts });
    } else {
        if (hasImages && !canUseVision) {
            console.warn(`Model ${modelName} is not vision-capable, but images were provided. Analyzing based on text summaries only.`);
        }
        messages.push({ role: 'user', content: userPromptText });
    }

    // --- CALL THE GENERIC CLIENT (optional desk-tools loop, then stream) ---
    // Temperature: 0.35 default — pro-trader discipline wants determinism
    // when each seat carries a distinct persona. The ensemble passes a
    // per-seat temperature (0.55–0.85) when Lenses are OFF so three seats
    // sharing one prompt still sample independently.
    // P2: the analysis phase IS the opening-statements phase — schedule it
    // at high effort (seat opinions are the debate's raw material).
    const options: ChatRequestOptions = { jsonMode: false, maxTokens: TASK_BUDGETS.analysis, temperature: temperature ?? 0.35, signal, onReasoning, reasoningEffort: EFFORT_BY_TASK.analysis, onWireAudit };
    let responseText = '';
    let reasoningAccumulated = '';
    try {
        for await (const chunk of streamChatWithDeskTools(config, messages, {
            ...options,
            enabled: deskToolsEnabled,
            allowedTools: params.allowedTools,
            trades: params.trades,
            defaultSymbol: resolveDefaultSymbol(prompt, marketDataOverride),
            afterToolsNudge: 'Tool results are above. Write the public Floor reply now from the findings. No JSON, no tool tags.',
            onReasoning: (reasoning: string) => {
                reasoningAccumulated += reasoning;
                options.onReasoning?.(reasoning);
            },
        })) {
            if (chunk) {
                responseText += chunk;
                onPartialOutput?.(chunk);
            }
        }
    } catch (error) {
        console.error(`${config.name} analysis streaming failed:`, error);
        throw error;
    }
    if (!responseText && !reasoningAccumulated) throw new Error("Received an empty response from the AI.");

    try {
        const split = splitThinkingFromOutput(reasoningAccumulated, responseText);
        let thoughtProcess = sanitizeAIResponseLight(split.thinking);
        let finalOutput = sanitizeAIResponseLight(split.output);

        const tryFormatJsonPlan = (raw: string): boolean => {
            try {
                const json = extractAndParseJson(raw);
                if (!json || typeof json !== 'object') return false;
                const jsonThought = typeof json.thoughtProcess === 'string'
                    ? sanitizeAIResponseLight(json.thoughtProcess)
                    : '';
                const analysisObj = json.analysis && typeof json.analysis === 'object' ? json.analysis : json;
                const isTradePlan = typeof analysisObj.coinName === 'string' || typeof analysisObj.direction === 'string';
                if (!thoughtProcess && jsonThought) thoughtProcess = jsonThought;
                if (isTradePlan) {
                    finalOutput = formatAnalysisForDisplay(analysisObj);
                    return true;
                }
            } catch {
                return false;
            }
            return false;
        };

        if (!finalOutput || /^\s*\{/.test(finalOutput) || (!thoughtProcess && /^\s*\{/.test(responseText))) {
            tryFormatJsonPlan(finalOutput || responseText || reasoningAccumulated);
        }
        if (thoughtProcess && finalOutput && thoughtProcess.trim() !== finalOutput.trim()) {
            const recovered = splitThinkingFromOutput(thoughtProcess, finalOutput);
            thoughtProcess = recovered.thinking || thoughtProcess;
            finalOutput = recovered.output || finalOutput;
        }

        // Analysts deliberately do not produce the structured trade plan as
        // JSON — but their prose is mined for the setup fields so the
        // per-analyst Monte Carlo, consensus panel, divergence detection and
        // Bayesian calibration all receive real data instead of the old
        // hardcoded Neutral/Low placeholder (which silently dead-coded every
        // one of those consumers).
        const parsedPlan = extractStructuredPlanFromProse(finalOutput);
        const analysis: TradeAnalysis = sanitizeTradeAnalysis({
            direction: parsedPlan.direction,
            confidence: parsedPlan.confidence,
            probability: parsedPlan.probability,
            entryPoints: parsedPlan.entryPoints?.map(price => ({ price, description: '' })) ?? [],
            stopLoss: parsedPlan.stopLoss,
            takeProfit: parsedPlan.takeProfit?.map(price => ({ price, percentage: '' })) ?? [],
            strategy: finalOutput,
        });

        analysis.activeStrategies = Array.isArray(analysis.activeStrategies) ? analysis.activeStrategies : [];
        analysis.stopLoss = sanitizeJSONString(analysis.stopLoss);
        analysis.takeProfit = Array.isArray(analysis.takeProfit)
            ? analysis.takeProfit.map(tp => ({ price: sanitizeJSONString(String(tp.price || '')), percentage: sanitizeJSONString(String(tp.percentage || '')) })).filter(tp => tp.price)
            : [];
        analysis.entryPoints = Array.isArray(analysis.entryPoints)
            ? analysis.entryPoints.map(ep => ({ description: sanitizeJSONString(String(ep.description || '')), price: sanitizeJSONString(String(ep.price || '')) })).filter(ep => ep.price)
            : [];
        analysis.createdAt = new Date().toISOString();

        return { analysis, thoughtProcess, finalOutput, sources: [] };
    } catch (error) {
        console.error(`${config.name} analysis JSON parsing failed:`, error, "Response:", responseText);
        throw new Error("Failed to parse the trading analysis from the AI response.", { cause: error });
    }
}

// ─── conductPostMortem ──────────────────────────────────────────────────────

export interface ConductPostMortemParams {
    previousMessage: Message;
    outcome: TradeOutcome;
    history: Message[];
    finalTradeSummary: string | null;
    feedback?: { correctedEntry?: string; correctedStopLoss?: string; correctedTakeProfit?: string };
    postTradeImageSummaries?: string[];
    /** R-severity context for the setup's historical cluster (see `buildSeverityPostMortemContext`). */
    severityContext?: string;
    signal?: AbortSignal;
    /** Chain-of-thought side channel (reasoning_content / thinking blocks). */
    onReasoning?: (reasoning: string) => void;
}

export async function conductPostMortem(
    config: ProviderConfig,
    params: ConductPostMortemParams
): Promise<string> {
    const { previousMessage, outcome, feedback, postTradeImageSummaries, signal, severityContext } = params;
    const { correctedEntry, correctedStopLoss, correctedTakeProfit } = feedback ?? {};
    let analysisPrompt: string;

    const postTradeContext = postTradeImageSummaries?.length ? `** VERIFIED TRADE OUTCOME DATA (HIGHEST PRIORITY):**\n---\n${postTradeImageSummaries.join('\n\n---\n\n')}\n---\n` : '';
    const tradeHistoryContext = "Historical context is in the retrieved harness memory block below (similar trades + skills), not a full pattern-memory essay.";
    const severityContextBlock = severityContext ? `\n${severityContext}\n` : '';
    const memoryFilesBlock = (() => {
        const ctx = getMemoryFilesContext({
            coin: previousMessage.analysis?.coinName,
            direction: previousMessage.analysis?.direction,
            family: previousMessage.analysis?.detectedPatternFamily,
            pattern: previousMessage.analysis?.marketConditions?.pattern,
        }, undefined, 'analyst', 'verdict');
        return ctx ? `\n${ctx}\n` : '';
    })();

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
        analysisPrompt = `${getPrompt('postmortem.entry_not_hit', ENTRY_NOT_HIT_ANALYSIS_PROMPT)}

**PREVIOUS ANALYSIS:**
${JSON.stringify(previousMessage.analysis, null, 2)}

**ACTUAL OUTCOME:** ${outcome}

${postTradeContext}

${userFeedbackBlock}

${tradeHistoryContext}

${severityContextBlock}${memoryFilesBlock}${groundingDirective}

${getPrompt('postmortem.entry_not_hit_questions', ENTRY_NOT_HIT_ANALYSIS_QUESTIONS)}`;
    } else if (outcome === TradeOutcome.WIN) {
        const feedbackBlock = `**USER FEEDBACK (TRADE OUTCOME):**
${correctedStopLoss ? `- Corrected SL: ${correctedStopLoss}` : ''}
${correctedTakeProfit ? `- Final TP: ${correctedTakeProfit}` : ''}`;

        analysisPrompt = `**Role:**
You are an advanced trade post-analysis engine focused on **SUCCESS REPLICATION** and pattern banking.

**Task:**
Perform a mandatory **WIN ANALYSIS** to extract replicable success factors, validate the decision-making process, and bank this pattern for future probability enhancement.

**PREVIOUS ANALYSIS:**
${JSON.stringify(previousMessage.analysis, null, 2)}

**ACTUAL OUTCOME:** ${outcome} ✅

${postTradeContext}

${feedbackBlock}

${tradeHistoryContext}

${severityContextBlock}${memoryFilesBlock}${groundingDirective}

**Instructions:**
Answer **all** of the following **MANDATORY WIN ANALYSIS QUESTIONS**:

1. **Entry Quality Assessment** - Rate entry precision: EXCELLENT / GOOD / ACCEPTABLE
2. **Setup Confirmation Signals** - List EXACT technical signals that confirmed this setup
3. **Risk Management Review** - Was SL threatened? Calculate final R multiple achieved
4. **Pattern Family Validation** - Does this win STRENGTHEN confidence in this family?
5. **Replication Checklist** - Extract 3-5 SPECIFIC conditions that MUST be present to replicate
6. **Blame Assessment** - Setup __% | Execution __% | Market __%
   Then write exactly one label: SETUP_EDGE_FAILURE | EXECUTION_ERROR | MACRO_SHOCK
   A lucky fill (execution) or news spike (macro) must NOT become a repeat-this-setup rule.

**Critical Learning Output (REQUIRED):**
* Generate **one IF / THEN rule** that captures the WINNING FORMULA
* Flag for **PATTERN MEMORY STORAGE** with tag: "CONFIRMED_WIN_PATTERN"

**Tone:** Analytical and evidence-based — the same forensic standard as a loss. Wins must be justified by entry-time facts, not hindsight. Focus on what to REPEAT and what could still be improved.`;
    } else {
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

${severityContextBlock}${memoryFilesBlock}${groundingDirective}

${extendedSLZoneContext}

**Instructions:**
Answer **all** of the following **MANDATORY LOSS ANALYSIS QUESTIONS**:

1. **Failure Point Identification** - EXACT candle/bar that invalidated the trade
2. **Warning Signs Autopsy** - Rate pre-loss warnings: CLEAR / SUBTLE / NONE
3. **Stop Loss Evaluation** - Was SL too tight? Did price later hit TP? (MISSED WIN flag)
4. **Entry Timing Critique** - Was entry premature or too late?
5. **Pattern Family Reliability Check** - Should this family require STRICTER conditions?
6. **Blame Assessment** - Setup __% | Execution __% | Market __%
   Then write exactly one label: SETUP_EDGE_FAILURE | EXECUTION_ERROR | MACRO_SHOCK
   Execution (chase, late click, moved SL) and macro shocks (CPI/FOMC/news) must NOT become a setup IF/THEN.

**Critical Learning Output (REQUIRED):**
* Generate **one IF / THEN rule** that would have PREVENTED this loss

**Special Flags:**
* If SL hit but price later reached TP: **"MISSED WIN - TIGHT SL"**
* If 150% extended SL zone breached: **"EXTENDED ZONE BREACH"**

**Tone:** Brutally honest, forensic. No excuses, only lessons.`;
    }

    const result = await sendChatRequest(
        config,
        [{ role: 'user', content: analysisPrompt }],
        // 0.4: a forensic post-mortem must not roll dice on its lesson —
        // the 0.7 default sampled "brutally honest" post-mortems randomly.
        // P2 effort tier (plan §14): structured reporting runs medium.
        { signal, onReasoning: params.onReasoning, maxTokens: TASK_BUDGETS.postMortem, temperature: 0.4, reasoningEffort: EFFORT_BY_TASK.postMortem }
    );
    return sanitizeAIResponse(result || "Post-mortem analysis failed.");
}

// ─── conductTodayReassessment ("What would I do today?") ────────────────────
// A closed trade's post-mortem is hindsight. This re-assesses the SAME setup
// against TODAY's market price and answers forward-looking: would I still take
// it? The model is told the outcome (so it can't pretend ignorance) but the
// verdict must be about the setup's validity NOW, not about the past.

export interface TodayReassessmentParams {
    analysis: TradeAnalysis;
    postMortem: string;
    /** Actual trade outcome — optional; omitted when unknown. */
    outcome?: TradeOutcome;
    currentPrice: number;
    signal?: AbortSignal;
}

export type TodayVerdict = 'YES' | 'NO' | 'MAYBE';

const TODAY_REASSESSMENT_MAX_PM_CHARS = 1500;

/**
 * Build the reassessment prompt. Pure + exported for unit tests.
 */
export const buildTodayReassessmentPrompt = (params: TodayReassessmentParams): string => {
    const { analysis, postMortem, outcome, currentPrice } = params;
    const entry = analysis.entryPoints?.[0]?.price || 'N/A';
    const sl = analysis.stopLoss || 'N/A';
    const tps = (analysis.takeProfit || []).map(tp => tp.price).filter(Boolean);
    const pmExcerpt = (postMortem || '').trim().slice(0, TODAY_REASSESSMENT_MAX_PM_CHARS) || 'No post-mortem available.';
    const priceLine = currentPrice > 0
        ? `**CURRENT MARKET PRICE (TODAY):** $${currentPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
        : '**CURRENT MARKET PRICE:** unavailable right now — reason from the levels alone and say so if you cannot judge.';

    return `**Role:**
You are a forward-looking trading reviewer. You are re-examining a CLOSED trade's setup with fresh eyes TODAY.

**THE RULE:**
- The past outcome is known and useful context, but your verdict must be about whether this setup would be a valid trade **if it appeared in the market TODAY**.
- Do NOT let hindsight decide for you. A losing trade can still be a good setup; a winning trade can still be a bad one.
- Judge using TODAY's price vs the original levels, not the exit.

**ORIGINAL SETUP:**
- Coin: ${analysis.coinName || 'N/A'}
- Direction: ${analysis.direction || 'N/A'}
- Entry: ${entry} | Stop Loss: ${sl}${tps.length ? ` | Take Profits: ${tps.join(', ')}` : ''}
- Confidence: ${analysis.confidence || 'N/A'} (${analysis.probability != null ? analysis.probability + '%' : 'N/A'})
- Strategy: ${analysis.strategy || 'N/A'}

${priceLine}

**ACTUAL OUTCOME (hindsight):** ${outcome ?? 'N/A'}

**POST-MORTEM LESSON (condensed):**
${pmExcerpt}

**ANSWER:**
1. Would you still take this setup TODAY? Give a direct verdict.
2. What has changed since the setup appeared (price location vs entry/SL/TP, structure, edge)?
3. What specific condition would need to change for your answer to flip?

**MANDATORY FORMAT:**
End your response with an explicit verdict tag on its own line:
<TODAY_VERDICT>YES</TODAY_VERDICT>  (or NO / MAYBE)

YES = you would take this exact setup today; NO = you would not; MAYBE = needs a specific confirmation before deciding.`;
};

/** Parse the mandatory verdict tag out of a reassessment response. Pure. */
export const parseTodayReassessment = (text: string): { verdict: TodayVerdict | 'UNKNOWN'; body: string } => {
    const tagMatch = text.match(/<TODAY_VERDICT>\s*(YES|NO|MAYBE)\s*<\/TODAY_VERDICT>/i);
    const verdict = tagMatch ? (tagMatch[1].toUpperCase() as TodayVerdict) : 'UNKNOWN';
    const body = text
        .replace(/<TODAY_VERDICT>\s*(?:YES|NO|MAYBE)\s*<\/TODAY_VERDICT>/gi, '')
        .trim();
    return { verdict, body: body || text.trim() };
};

/**
 * Run a single-provider "what would I do today?" re-assessment.
 * @returns the verdict + the model's reasoning (verdict tag stripped).
 */
export async function conductTodayReassessment(
    config: ProviderConfig,
    params: TodayReassessmentParams
): Promise<{ verdict: TodayVerdict; text: string }> {
    const prompt = buildTodayReassessmentPrompt(params);
    const result = await sendChatRequest(
        config,
        [{ role: 'user', content: prompt }],
        { signal: params.signal }
    );
    // Parse the tag from the RAW response — sanitizeAIResponse strips all
    // <...> HTML tags, which would destroy <TODAY_VERDICT> before we see it.
    const { verdict, body } = parseTodayReassessment(result || '');
    // A missing/ambiguous tag defaults to MAYBE — never invent a hard yes/no
    // the model didn't commit to. Sanitize only the displayed body.
    return { verdict: verdict === 'UNKNOWN' ? 'MAYBE' : verdict, text: sanitizeAIResponse(body) };
}

// ─── getQuickResponse ───────────────────────────────────────────────────────

export async function getQuickResponse(
    config: ProviderConfig,
    prompt: string,
    history: Message[],
    systemInstruction?: string,
    signal?: AbortSignal,
    onReasoning?: (reasoning: string) => void
): Promise<string> {
    const messages: ChatMessage[] = (history || []).map(m => ({
        role: m.role === MessageRole.AI ? 'assistant' : m.role === MessageRole.SYSTEM ? 'system' : 'user',
        content: m.text,
    }));
    messages.unshift({ role: 'system', content: systemInstruction || 'You are a helpful and concise AI assistant specializing in futures trading concepts. Answer user questions clearly.' });
    // Callers pass the current user message as part of `history`; avoid sending the same prompt twice.
    if (messages[messages.length - 1]?.content !== prompt) {
        messages.push({ role: 'user', content: prompt });
    }

    const result = await sendChatRequest(config, messages, { maxTokens: TASK_BUDGETS.chat, signal, onReasoning, reasoningEffort: EFFORT_BY_TASK.chat });
    // Defensive: some apiFormats leave  bodies in the final content.
    // Strip them here (idempotent — chat_completions already peeled them via
    // splitChatContent) and route any leftover to the reasoning side channel
    // so the bubble's Thinking row owns it instead of the visible reply.
    const stripped = extractAndStripThinkBlocks(result || '');
    if (stripped.leaked.trim()) onReasoning?.(stripped.leaked);
    // Chat replies render via MarkdownRenderer — the light sanitizer keeps the
    // model's markdown (bold/lists/code) instead of flattening it to plain text.
    return sanitizeAIResponseLight(stripped.visible || "I am sorry, I could not generate a response.");
}

/**
 * Streaming casual-chat reply (perceived speed). Same contract
 * as getQuickResponse, but visible deltas are pushed to `onChunk` as they
 * arrive so the bubble renders incrementally instead of appearing all at once
 * after completion. Reasoning deltas still flow through `onReasoning`. The
 * transport already routes think-tag bodies to the reasoning side channel, so
 * the accumulated visible text is clean; a final strip is a safety net.
 */
export async function streamQuickResponse(
    config: ProviderConfig,
    prompt: string,
    history: Message[],
    systemInstruction?: string,
    signal?: AbortSignal,
    onReasoning?: (reasoning: string) => void,
    onChunk?: (visibleDelta: string) => void
): Promise<string> {
    const messages: ChatMessage[] = (history || []).map(m => ({
        role: m.role === MessageRole.AI ? 'assistant' : m.role === MessageRole.SYSTEM ? 'system' : 'user',
        content: m.text,
    }));
    messages.unshift({ role: 'system', content: systemInstruction || 'You are a helpful and concise AI assistant specializing in futures trading concepts. Answer user questions clearly.' });
    if (messages[messages.length - 1]?.content !== prompt) {
        messages.push({ role: 'user', content: prompt });
    }

    let visible = '';
    // Double safety net: chat_completions already gates think-tag bodies into
    // the reasoning channel at the transport, but other apiFormats (and the
    // Electron non-streaming path) can still leak them into content. Gating
    // here guarantees the live bubble never shows scratchpad markup.
    const gate = createThinkingStreamGate();
    for await (const chunk of streamChatRequest(config, messages, { maxTokens: TASK_BUDGETS.chat, signal, onReasoning, reasoningEffort: EFFORT_BY_TASK.chat })) {
        if (!chunk) continue;
        const gated = gate.push(chunk);
        if (gated.thinking) onReasoning?.(gated.thinking);
        if (gated.visible) {
            visible += gated.visible;
            onChunk?.(gated.visible);
        }
    }
    const flushed = gate.flush();
    if (flushed.thinking) onReasoning?.(flushed.thinking);
    if (flushed.visible) {
        visible += flushed.visible;
        onChunk?.(flushed.visible);
    }
    const stripped = extractAndStripThinkBlocks(visible || '');
    if (stripped.leaked.trim()) onReasoning?.(stripped.leaked);
    return sanitizeAIResponseLight(stripped.visible || "I am sorry, I could not generate a response.");
}

// ─── summarizeChartImage (vision/OCR) ───────────────────────────────────────

export async function summarizeChartImage(
    config: ProviderConfig,
    image: File,
    chartNumber: number,
    signal?: AbortSignal
): Promise<{ uiSummary: string; fullSummary: string }> {
    try {
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

        const messages: ChatMessage[] = [{
            role: 'user',
            content: [
                { type: 'text', text: prompt },
                { type: 'image_url', image_url: { url: `data:${image.type};base64,${base64Image}` } },
            ],
        }];

        const fullSummary = await sendChatRequest(config, messages, { maxTokens: TASK_BUDGETS.ocr, signal, reasoningEffort: EFFORT_BY_TASK.ocr });

        const timeframeMatch = fullSummary.match(/Timeframe:\s*(.*?)(?:\n|$)/i);
        const priceMatch = fullSummary.match(/(?:Current )?Price:\s*(.*?)(?:\n|$)/i);
        const patternMatch = fullSummary.match(/Pattern Detected:\s*(.*?)(?:\n|$)/i);

        const timeframe = timeframeMatch ? timeframeMatch[1].trim().replace(/['"]/g, '') : 'N/A';
        let price = priceMatch ? priceMatch[1].trim().replace(/['"]/g, '') : 'N/A';
        let pattern = patternMatch ? patternMatch[1].trim().replace(/['"]/g, '') : '';

        if (price !== 'N/A') {
            const numericPrice = parsePrice(price);
            if (!isNaN(numericPrice)) {
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
        console.error(`Error in ${config.name} summarizeChartImage:`, error);
        return {
            uiSummary: `Chart ${chartNumber} | Error | N/A`,
            fullSummary: `Chart ${chartNumber} Vision Analysis Failed: ${(error as Error).message}`
        };
    }
}

// ─── Strategy helpers ───────────────────────────────────────────────────────

export async function searchStrategies(
    config: ProviderConfig,
    query: string,
    activeFrameworks: string[],
    signal?: AbortSignal
): Promise<StrategySearchResult[]> {
    const frameworksList = activeFrameworks.join(', ');
    const prompt = `You are a search engine for a predefined list of trading strategies. Your entire knowledge base is limited to ONLY the following frameworks: [${frameworksList}].

    The user is searching for: "${query}".

    Your task is to:
    1. Find the frameworks from your knowledge base that are the most relevant to the user's query.
    2. For each relevant framework, provide a concise description and rationale.
    3. If no frameworks are relevant, return an empty array.
    4. You are strictly forbidden from suggesting or describing any strategy that is not in the provided list.
    5. Your output must be a single, valid JSON array of objects with keys "name", "description", and "rationale".`;

    const result = await sendChatRequest(config, [{ role: 'user', content: prompt }], { jsonMode: true, signal });
    if (!result) return [];
    try {
        const parsed = extractAndParseJson(result);
        return parseStrategySearchResults(parsed).filter((r) =>
            activeFrameworks.some(fw => fw.toLowerCase() === r.name.toLowerCase())
        );
    } catch (e) {
        console.error(`Failed to parse ${config.name} strategy search results:`, e);
        return [];
    }
}

export async function discoverStrategies(
    config: ProviderConfig,
    chatHistory: Message[],
    activeFrameworks: string[],
    signal?: AbortSignal
): Promise<StrategySearchResult[]> {
    const frameworksList = activeFrameworks.join(', ');
    const historyText = chatHistory.length > 0
        ? chatHistory.slice(-5).map(m => `${m.role}: ${m.text} ${m.imageSummaries?.join('\n') || ''}`).join('\n\n')
        : '';

    const prompt = `You are an AI assistant that suggests relevant trading strategies. Your entire knowledge base is limited to ONLY the following frameworks: [${frameworksList}].

    ${historyText ? `Based on the recent conversation:\n${historyText}\n` : ''}

    Your task is to pick 3 interesting or relevant strategies from the list and provide a concise description and rationale.

    You are strictly forbidden from suggesting any strategy that is not in the provided list. Your output must be a valid JSON array of objects with keys "name", "description", and "rationale".`;

    const result = await sendChatRequest(config, [{ role: 'user', content: prompt }], { jsonMode: true, signal });
    if (!result) return [];
    try {
        const parsed = extractAndParseJson(result) || {};
        const results = Array.isArray(parsed) ? parsed : (parsed.results || parsed.strategies || []);
        return results.filter((r: any) =>
            r.name && typeof r.name === 'string' &&
            activeFrameworks.some(fw => fw.toLowerCase() === r.name.toLowerCase())
        );
    } catch (e) {
        console.error(`Failed to parse ${config.name} strategy discovery results:`, e);
        return [];
    }
}

export async function getStrategyDescription(
    config: ProviderConfig,
    strategyName: string,
    signal?: AbortSignal
): Promise<string> {
    const prompt = `Provide a concise, one-paragraph explanation of the "${strategyName}" trading strategy.`;
    const result = await sendChatRequest(config, [{ role: 'user', content: prompt }], { signal, temperature: 0.25 });
    return sanitizeAIResponse(result || "Failed to retrieve strategy description.");
}

// ─── Memory helpers ─────────────────────────────────────────────────────────

export async function summarizeTrade(
    config: ProviderConfig,
    trade: LoggedTrade,
    signal?: AbortSignal
): Promise<string> {
    const brief = buildTradeInsightBrief(trade);
    const outcome = String(trade.outcome || 'UNKNOWN');

    const prompt = `You are a Master Trading Strategist writing a short post-trade insight — the same forensic standard as a post-mortem debate, in one dense paragraph (not a transcript).

**Outcome to explain: ${outcome}**

Diagnose *why* this trade won, lost, or missed entry. Use only the facts below. Do not invent prices or chart events that are not stated. Prefer crypto % / $ language (never "pips").

**Required contents (max ~180 words, complete sentences):**
1. Header facts: outcome, direction, confidence, family/strategy, entry / SL / TP
2. Causal diagnosis: the technical or execution reason for the outcome (not luck-speak)
3. One IF [condition] THEN [action] rule the desk should apply next time
4. Flags when present: [MISSED WIN - TIGHT SL], [150% ZONE BREACH]

**Trade facts:**
${brief}
`;

    const result = await sendChatRequest(
        config,
        [{ role: 'user', content: prompt }],
        { signal, temperature: 0.25, maxTokens: 700 }
    );
    return sanitizeAIResponse(result || "Summary generation failed.");
}

/**
 * Dedicated moderator pass after the post-mortem debate: a markdown report
 * for the chat + trade journal. Separate from the debate transcript so a
 * missing FINAL_REPORT tag does not leave the journal empty.
 */
export async function writePostMortemMarkdownReport(
    config: ProviderConfig,
    params: {
        outcome: string;
        setupBrief: string;
        analystReports: string;
        debateTranscript: string;
        signal?: AbortSignal;
    }
): Promise<string> {
    const prompt = `You are the Master Strategist writing the official post-mortem report after an ensemble debate about a **${params.outcome}** trade.

Write Markdown only. Do not continue the debate. Do not wrap the answer in XML tags. Do not invent prices or events that are not in the sources. Use crypto % / $ language (never "pips").

Required headings, in this order:

## Outcome
One sentence: WIN / LOSS / ENTRY_NOT_HIT and what happened.

## Root cause
The technical or execution reason this outcome occurred.

## Debate synthesis
What the analysts agreed on, and the one disagreement that mattered (if any).

## Key lesson
One actionable lesson.

## Rule
Exactly one line: IF [condition] THEN [action]

## Conclusion
- Outcome summary
- Missed-win / tight-SL flag (YES/NO)
- Primary driver
- Pattern-confidence impact: Increase / Maintain / Reduce

**Setup:**
${truncateTextToTokens(params.setupBrief, 800)}

**Analyst post-mortems:**
${truncateTextToTokens(params.analystReports, 1800)}

**Debate transcript (for synthesis, not to reprint):**
${truncateTextToTokens(params.debateTranscript, 2500)}
`;

    const result = await sendChatRequest(
        config,
        [{ role: 'user', content: prompt }],
        { signal: params.signal, temperature: 0.2, maxTokens: 2500 }
    );
    return sanitizeAIResponse(result || '');
}

export async function generateFinalSummary(
    config: ProviderConfig,
    summaries: TradeSummary[],
    charLimit: number = 4000,
    signal?: AbortSignal
): Promise<string> {
    const summariesText = summaries.map(s => `- ${compactInsightForPatternMemory(s.summaryText)}`).join('\n');
    const tradeCount = summaries.length;

    const prompt = `
You are a Pattern Recognition Engine.

You MUST output a summary using EXACTLY the following headings and order:

Executive Summary
Missed Win Analysis
Extended SL Zone Breach Analysis
Pattern Family Performance
Confidence Calibration
Winning Patterns
Failure Patterns
Behavioral Biases
Statistical Tendencies
Actionable Rules
Conclusion

**SPECIAL ATTENTION REQUIRED:**
- **Missed Win Analysis**: Count "[MISSED WIN - TIGHT SL]" trades. Calculate what % of losses were avoidable. Recommend SL adjustments.
- **Extended SL Zone Breach Analysis**: Count "[150% ZONE BREACH]" trades. Were these bad entries or failed thesis?
- **Pattern Family Performance**: Compare Family A/B/C/Omega win rates. Identify best/worst performing families.
- **Confidence Calibration**: Compare High/Medium/Low confidence win rates. Are confidence ratings accurate?

RULES:
- All headings MUST appear exactly as written.
- If a section has no evidence, write exactly "None." (the notebook will drop empty product sections).
- Do not copy or restate skills/*.md or rules/recurring-mistakes.md — point at them in Actionable Rules instead.
- No new headings, no removed headings, no reordering.
- Output must be ~${charLimit} characters.
- Output must be ONE continuous text block.

Analyze the ${tradeCount} historical trades below and generate the summary:

${summariesText}

Return ONLY the structured summary.
`;

    // Reasoning-capable models (DeepSeek-R1, etc.) often prefix the answer
    // with their chain of thought — either inline or because the gateway
    // omits the final content field and the client salvages reasoning as the
    // response text. The answer is the block starting at the LAST
    // "Executive Summary" heading that still contains the other mandated
    // headings. Never store the thinking as pattern memory.
    // maxTokens is raised well above the ~4000-char summary: with the default
    // 4096 tokens, a long reasoning trace can truncate the response BEFORE
    // the answer is emitted, leaving only chain of thought behind.
    const request = (content: string) => sendChatRequest(config, [{ role: 'user', content }], { signal, maxTokens: 8192, temperature: 0.25 });

    let raw = sanitizeAIResponse(await request(prompt) || '');
    let structured = extractStructuredSummary(raw);
    if (!structured) {
        console.warn('[FinalSummary] First attempt returned no structured summary (snippet):', raw.slice(0, 400));
        // One hardened retry: forbid any thinking and demand the first
        // heading up front. Costs one extra call only when the first
        // response was unusable.
        raw = sanitizeAIResponse(await request(`${prompt}\n\nCRITICAL: Do NOT output any reasoning, thinking, or planning. Start your reply directly with the heading "Executive Summary" and output ONLY the structured summary.`) || '');
        structured = extractStructuredSummary(raw);
    }
    if (!structured) {
        console.warn('[FinalSummary] Retry also returned no structured summary (snippet):', raw.slice(0, 400));
        return 'The AI returned its reasoning instead of a structured pattern-memory summary. Regenerate the review to try again.';
    }
    return structured;
}

/**
 * The pattern-memory prompt mandates the exact heading list (see
 * generateFinalSummary). When a reasoning model leaks its chain of thought
 * into the response — inline, or via the reasoning-only fallback in the
 * provider layer — the real answer is the block that starts at the LAST
 * line beginning with the first required heading AND still contains a
 * quorum of the remaining headings (the CoT only *mentions* headings
 * inside prose; the draft emits them as standalone lines).
 *
 * Returns the extracted answer, or null when the response contains no
 * structured answer (pure reasoning / unusable output).
 */
export function extractStructuredSummary(
    response: string,
    headings: string[] = [
        'Executive Summary',
        'Missed Win Analysis',
        'Extended SL Zone Breach Analysis',
        'Pattern Family Performance',
        'Confidence Calibration',
        'Winning Patterns',
        'Failure Patterns',
        'Behavioral Biases',
        'Statistical Tendencies',
        'Actionable Rules',
        'Conclusion',
    ]
): string | null {
    if (!response || typeof response !== 'string') return null;
    const lines = response.split('\n');
    const [firstHeading, ...otherHeadings] = headings;
    if (!firstHeading) return null;

    // Normalize a line for heading comparison: strip leading/trailing
    // markdown decoration and list numbering ("1. ", "1) "). A line is in
    // heading form when it is EXACTLY the heading, or the heading followed
    // by a colon and content on the same line ("Executive Summary: The
    // dataset…"). Prose that merely mentions the heading ("Need 'Executive
    // Summary' include…") never normalizes to it.
    const normalizeHeadingLine = (line: string): string =>
        line
            .replace(/^[\s#>*_\-~`"'«»]+/, '')
            .replace(/^\d+[.)]?\s*/, '')
            .replace(/[\s#>*_\-~`"'«»]+$/, '')
            .trim();

    const isHeadingForm = (normalized: string, heading: string): boolean =>
        normalized === heading.toLowerCase()
        || normalized.startsWith(heading.toLowerCase() + ':');

    // Iterate from the END: the final output of a reasoning model always
    // follows its thinking, so the last candidate is the answer itself.
    for (let i = lines.length - 1; i >= 0; i--) {
        if (!isHeadingForm(normalizeHeadingLine(lines[i]).toLowerCase(), firstHeading)) continue;
        const tail = lines.slice(i);
        const tailNorms = tail.map(l => normalizeHeadingLine(l).toLowerCase());

        // Quorum: a real answer carries most mandated headings as heading
        // lines. A thinking fragment fails unless it literally emitted
        // several heading-form lines.
        const matched = otherHeadings.filter(h =>
            tailNorms.some(n => isHeadingForm(n, h))
        ).length;
        if (matched < 3) continue;

        // The answer always ends with the Conclusion section — require
        // actual content AFTER its heading line. This stops a reasoning-only
        // checklist that trails off at "Conclusion: …" from being stored.
        let lastConclusionIdx = -1;
        for (let j = tail.length - 1; j >= 0; j--) {
            if (isHeadingForm(tailNorms[j], 'Conclusion')) { lastConclusionIdx = j; break; }
        }
        if (lastConclusionIdx === -1) continue;
        if (!tail.slice(lastConclusionIdx + 1).some(l => l.trim().length > 0)) continue;

        return tail.join('\n').trim();
    }
    return null;
}

export async function compressChatHistory(
    config: ProviderConfig,
    messages: Message[],
    currentSummary: string = "",
    signal?: AbortSignal
): Promise<string> {
    const messagesText = messages.map(m => `${m.role}: ${m.text}`).join('\n\n');

    const prompt = `
You are a memory compressor for a trading chat.

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

    const result = await sendChatRequest(config, [{ role: 'user', content: prompt }], { maxTokens: 2048, signal, temperature: 0.25 });
    return sanitizeAIResponse(result || "Memory compression failed.");
}

export async function updateGlobalMemory(
    config: ProviderConfig,
    recentTrades: LoggedTrade[],
    currentMemory: GlobalMemory | undefined,
    signal?: AbortSignal
): Promise<GlobalMemory> {
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
You are a Global Memory Manager for a trading system.

**EXISTING GLOBAL MEMORY:**
${currentMemoryJson}

**RECENT TRADES (LAYER 2 DATA):**
${tradeSummaries}

**INSTRUCTIONS:**
Generate the updated Global Memory JSON object.
    `;

    const result = await sendChatRequest(config, [{ role: 'user', content: prompt }], { jsonMode: true, maxTokens: 2048, signal, temperature: 0.25 });
    try {
        const parsed = parseGlobalMemory(extractAndParseJson(result) || {});
        if (parsed) return parsed;
        console.error(`${config.name} updateGlobalMemory produced invalid memory shape:`, result);
    } catch {
        console.error(`${config.name} updateGlobalMemory JSON parse failed:`, result);
    }
    return currentMemory || {
        totalTradesAnalyzed: 0,
        familyPerformance: {},
        aiPatternMemory: [],
        // Default leverage matches the app-wide default (Conversation.leverage,
        // useTradeLogging, and the zod GlobalMemorySchema default) — was 10.
        userPreferences: { leverageDefault: 100, favoriteAssets: [], preferredSetup: '' },
        globalCorrections: [],
        lastUpdated: new Date().toISOString()
    };
}
