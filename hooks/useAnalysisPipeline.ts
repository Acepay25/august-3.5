import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
    Message, MessageRole, TradeOutcome, LoggedTrade, ImageMetadata,
    DebateTurn, Conversation, TradeAnalysis, TradeSummary,
    GlobalMemory, AccuracySubMode, CustomInstructionsMap, CustomInstruction,
    AnalystLensConfig, AnalysisStep, InsightKnowledgeBase, ConfidenceCalibration,
    ReplacementOffer, PatternMemoryGateView, DebateRunEvent,
} from '../types';

import { ProviderConfig } from '../types/provider';
import { analyzeTradingView, getQuickResponse, streamQuickResponse } from '../services/providers/GenericAnalysisService';
import type { ToolAction } from '../types/message';
import { WireAuditEntry } from '../services/providers/reasoningControls';
import * as ensembleService from '../services/providers/ensembleService';
import { BotRegistry } from '../services/bots/BotRegistry';
import { defaultToolsForRole } from '../types/bot';
import { AnalystRole } from '../types/enums';
import { getActiveUsername } from '../utils/activeUser';
import { getBots, getGroups, AgentTeamSeat } from '../services/agents/agentRoster';
import { seatPersonaPrompt, generalSeatMandate, GENERAL_DIMENSION_TAGS } from '../services/agents/seatPersonas';
import { TEAM_MAX_SEATS } from '../utils/teamRoster';

// Analysis / validation / backtesting services
import { tryFetchHybridDataFromPromptWithCalibration, generateHybridPromptInjection, HybridDataPacket, runMonteCarloForSetupAsync } from '../services/analysis/HybridIntelligenceService';
import { extractSymbolFromPrompt } from '../services/analysis/MarketDataService';
import { LabeledMonteCarloResult } from '../services/analysis/MonteCarloService';
import { backtestSimilarSetups } from '../services/backtesting/LiveBacktestService';
import { runValidationGate } from '../services/validation/TradeValidationGate';
import { getGateAnalysis, GateOutput } from '../services/validation/GateKeeperService';

// Utils
import { isQuotaError } from '../utils/errorUtils';
import { shouldSkillHoldout } from '../utils/skillHoldout';
import { recalculateAnalysisMetrics, sanitizeTradeAnalysis, clampProbabilityToGate, parsePrice, parseProseTradePlan, parseMarkdownTradePlan, tradePlanToAnalysis, stripPlanTags, isBindingMarkdownPlan } from '../utils/analysisUtils';
import { subscribeTokenUsage, mergeTokenUsage, emptyTokenUsage, estimateCostUsd, TokenUsage } from '../utils/tokenUsage';
import { appendSessionUsage } from '../utils/sessionUsage';
import { saveThinkingBatch, buildThinkingRecordId, getThinkingTradeId, getThinkingExemplars } from '../services/infrastructure/ThinkingStoreService';
import { offlineQueue } from '../services/infrastructure/OfflineQueueService';
import { notifyAnalysisComplete } from '../services/infrastructure/CompletionNotifications';
import { ThinkingRecord } from '../types/thinking';
import { lensFromAnalystRole, lensFromSpeakerName } from '../utils/thinkingLens';
import { splitThinkingFromOutput } from '../utils/thinkingSplit';
import { sanitizeAIResponseLight } from '../utils/sanitizers';
import { buildModelIdToName, isProviderReady } from '../utils/providerUtils';
import { DEFAULT_LEVERAGE } from '../utils/conversationUtils';
import { buildDecisionReflectionContext } from '../services/learning/DecisionReflectionService';
import { buildCoinLessonsBlock } from '../utils/postMortemLessons';
import { getEnabledStrategiesText } from '../services/infrastructure/StrategyService';
import { COMMON_WORDS } from '../constants/commonWords';
import { buildModelsUsedRecord } from './analysisPipeline/modelsUsed';
import { assemblePipelineMemoryContext } from './analysisPipeline/memoryContext';
import { useRafThrottle } from './useRafThrottle';

// ─── Dev-only logging ─────────────────────────────────────────────────────
// console.log calls are gated behind the Vite dev flag so production builds
// stay clean. console.error / console.warn are kept unconditionally (genuine
// faults must always surface).
const devLog = (...args: unknown[]) => { if ((import.meta as any).env?.DEV) console.log(...args); };

// ─── Trader Notebook quick-save intent ────────────────────────────────────
// "Save this to the notebook / write it down in my memory / add this to my
// notes" — anchored on a memory noun so plain phrases ("note that…",
// "remember to…") never hijack a normal analysis.
const NOTEBOOK_SAVE_PATTERN = /\b(save|store|write|add|log|remember|record|put)\b[^\n]{0,60}\b(notebook|memory|journal|diary|notes?)\b|\b(notebook|memory|journal|diary|notes?)\b[^\n]{0,60}\b(save|store|write|add|log|remember|record|put)\b/i;

// Ensemble openings launch each seat this many ms apart. Free-tier gateways
// dedupe/cache CONCURRENT near-identical requests (the three openings share
// ~99% of their payload once the hybrid envelope is in); staggering breaks
// the simultaneous-identical window those caches key on.
const SEAT_LAUNCH_STAGGER_MS = 700;

// Learning services
import { generateWeightedVotingContext } from '../services/backtesting/ModelPerformanceService';
import { PriceAlertService } from '../services/ui/PriceAlertService';
import { getMemoryFilesContext, writeModelNote, extractLessonFromPostMortem, slugifyName } from '../services/learning/MemoryFilesService';
import { listRetrievedMemorySources } from '../services/learning/MemoryRetrievalService';
import { annotateVerdictCitations } from '../services/learning/MemoryInjectionService';
import { getBotMemoryContext } from '../services/bots/BotMemoryService';
import { threadForProvider } from '../utils/agentThreads';
import { writeNotebookNoteFromRequest } from '../services/learning/NotebookWriterService';
import { toolActionStamp } from '../utils/toolActions';
import { buildSimilarSetupsContext, buildRegimeWeightingContext } from '../services/learning/SetupMemoryService';
import { generateMandatoryPatternCheck, generatePatternMemoryEnforcementContext } from '../services/learning/PatternMemorySynthesisService';
import { applyNotebookSkillsToAnalysis, confirmedAvoidForSetup, titleFromMeta, skillFileNameFor } from '../services/learning/SkillMemoryService';
import { sortByFitness, recordPreflightResult } from '../services/learning/providerFitness';
import { buildPreflightBlock, applyPreflightGate } from '../services/learning/preflight';
import { recordRegimeDay, marketRegimeToLedger } from '../services/learning/regimeLedger';
import { VetoLedgerService } from '../services/ui/VetoLedgerService';
import { ANALYST_ROLE_DEFINITIONS, getLensPromptForStyle, getRoleForProvider, appendLensMemoryToPrompt, EnsembleModelSelection } from '../services/ui/AnalystLensService';
import { buildHybridEnvelope, buildOcrEnvelope, envelopeKindForRole } from '../utils/debateEnvelopes';
import { buildRecommendationContract } from '../utils/recommendationContract';
import { buildRunContractStages, type RunContractStage } from '../utils/runContract';
import { buildVerdictEvidencePack, deriveSetupQueryFromPrompt } from '../services/learning/EvidencePackService';
import { maybeQueueVerdictSkillDraft } from '../utils/verdictSkillDraft';
import { applyReplyTo } from '../utils/debateReplyTo';
import { parseProvisionalVerdict, parsePartialVerdictFields } from '../utils/provisionalVerdict';
import { extractDebateTemplate, DebateTemplate } from '../utils/debateTemplates';
import { debateTurnsToRoundTexts, lastCompletedRound, laneDraftsFromTurns, reconstructOpenings } from '../utils/debateResume';
import { parseStructuredAutoplayTranscript } from '../utils/debateTranscript';
import { parseComposerIntent, formatComposerSteer } from '../utils/composerMentions';
import { parseKeptAnalyst } from '../utils/keptAnalyst';
import { buildLevelCitations } from '../utils/levelEvidence';
import { enforceUngroundedLevels } from '../utils/ungroundedGate';
import { rescueSoftAvoid } from '../utils/avoidReason';
import { applyHybridChartDrift } from '../utils/hybridChartDrift';
import { computeContractSize, gradeRiskTier, kellyAdvisory } from '../utils/ticketSize';
import { planAmendmentDiff } from '../utils/trustSurface';
import { withFinComMetadata, flagBannedVocabulary } from '../services/providers/debateScience';
import { assessSession, formatGuardContextBlock } from '../services/validation/SessionGuardService';
import { getHarnessSettings, getSessionGuardConfig } from '../utils/harnessSettings';
import { beginPromptLane, endPromptLane } from '../services/infrastructure/PromptOverrideService';
import { buildEnsembleAnalysts, buildAnalystFailureReport, findDuplicateAnalystOutputs, AnalystOutputSample } from '../services/ui/EnsembleAnalystService';
import { getEffectiveStyle } from '../services/ui/TradingStyleDetector';
import GlobalLearningService from '../services/learning/GlobalLearningService';
import { CLARIFICATION_MARKERS_RE, DEBATE_END_MARKERS_RE, MODERATOR_ERROR_BLOCK_RE, MODERATOR_RETRY_MARKER, MODERATOR_RETRY_RE, REPLACEMENT_TIMEOUT_MARKER } from '../constants/debateMarkers';

// ─── Params Interface ──────────────────────────────────────────────────────────

export interface UseAnalysisPipelineParams {
    // From conversations:
    messages: Message[];
    messagesRef: React.MutableRefObject<Message[]>;
    updateMessages: (updater: (prev: Message[]) => Message[], conversationId?: string | null) => void;
    activeConversation: Conversation | undefined;
    activeConversationId: string | null;

    // All model/provider values:
    providerConfigs: ProviderConfig[];
    selectedOcrModel: string;
    moderatorConfig: ProviderConfig;
    moderatorModel: string;
    /** Settings → Memory model — notebook notes, pattern-memory rewrite, reviews. */
    memoryConfig?: ProviderConfig | null;

    // From memory/trade:
    finalTradeSummary: string | null;
    loggedTrades: LoggedTrade[];
    tradeSummaries: TradeSummary[];
    globalMemory: GlobalMemory | undefined;
    insightKnowledgeBase: InsightKnowledgeBase | undefined;
    confidenceCalibration: ConfidenceCalibration | undefined;

    // From market data:
    currentHybridData: HybridDataPacket | null;
    setCurrentHybridData: (v: HybridDataPacket | null) => void;
    setLatestMonteCarloResult: (v: any) => void;
    setLatestBacktestResult: (v: any) => void;
    setPerAIMonteCarloResults: React.Dispatch<React.SetStateAction<LabeledMonteCarloResult[]>>;
    setCurrentSlOptimization: (v: any) => void;
    setCurrentSuggestedEntryPrice: (v: number | null) => void;
    setCurrentEntryTimingScore: (v: any) => void;
    setHybridConnectionStatus: React.Dispatch<React.SetStateAction<'disconnected' | 'connecting' | 'connected' | 'error'>>;

    // From UI state:
    isAnalysisInProgress: boolean;
    setIsAnalysisInProgress: (v: boolean) => void;
    isHybridLoading: boolean;
    setIsHybridLoading: (v: boolean) => void;
    isRateLimited: boolean;
    setIsRateLimited: (v: boolean) => void;
    setHighlightedAnalysisId: (v: string | null) => void;
    setIsPostMortemInProgress: (v: boolean) => void;
    setIsLivePostMortemVisible: (v: boolean) => void;

    // Settings:
    isAccuracyModeEnabled: boolean;
    accuracySubMode: AccuracySubMode;
    isGlobalMemoryEnabled: boolean;
    /** Master switch for user-uploaded strategy books (Settings → Strategies). */
    isStrategiesEnabled: boolean;
    customInstructions: CustomInstructionsMap;
    isPlaybookEnabledInPureAI: boolean;
    isFamiliesEnabledInPureAI: boolean;
    isMemoryEnabledInPureAI: boolean;
    isHybridIntelligenceEnabled: boolean;
    lensConfig: AnalystLensConfig;
    /**
     * Ordinary 3-model picker used when Lenses are OFF — the selected models
     * become the debate participants (mirrors lens role assignments).
     */
    ensembleModelSelection?: EnsembleModelSelection;
    /** Custom Normal-mode base prompt (prompt editor); undefined = built-in master prompt. */
    customEnsemblePrompt?: string | null;
    /** Custom per-role lens prompts (prompt editor); missing roles use built-ins. */
    customLensPrompts?: Record<string, string>;
    activeFrameworks: string[];
    // Ensemble mode: when off, messages are casual chat with the selected
    // model and the chart-analysis pipeline never runs.
    isEnsembleEnabled: boolean;
    // Casual-chat model: used when ensemble off; falls back to the first
    // ready provider's model when empty/stale.
    selectedChatModel: string;
    /** ── Bot Mode (plan botmode-scan G1) ──
     *  When a bot's 1:1 thread is open, casual sends run AS that bot:
     *  persona system prompt, thread-scoped history, and the reply is
     *  handed to onBotReply so the mailbox can dispatch [[dm:@…]] markers.
     *  A GETTER (not a value) because App declares the roster below this
     *  hook — read at send time, stable identity. Null outside bot threads
     *  (Team/casual model chat keep old behavior). */
    getActiveBot?: () => {
        id: string;
        name: string;
        providerId: string;
        modelId: string;
        systemPrompt: string;
    } | null;
    /** Fired after a bot-thread casual reply settles (messageId + raw text
     *  INCLUDING any DM markers — the mailbox strips + delivers them). */
    onBotReply?: (messageId: string, rawText: string) => void;

    // Toast:
    toast: {
        warning: (t: string, m?: string) => void;
        error: (t: string, m?: string) => void;
        success?: (t: string, m?: string) => void;
    };
    /** Non-blocking styled confirmation dialog (replaces native window.confirm). */
    confirmDialog?: (opts: {
        title: string;
        message?: string;
        confirmLabel?: string;
        cancelLabel?: string;
        destructive?: boolean;
        undoGraceMs?: number;
        onUndo?: () => void | Promise<void>;
    }) => Promise<boolean>;
}

// Best-effort pattern-family detection from the user prompt, so the
// unified learning context can match insights/mistakes to the current setup
// before the AI analysis completes (there is no analysis yet at send time).
// Falls back to undefined when no keyword matches.



/**
 * Stable fingerprint of the effective prompt layers for a run — lets prompt
 * edits be measured against outcomes (A/B without an experiment framework:
 * each run records WHICH prompt version produced it).
 */
const computePromptVersion = (parts: Record<string, unknown>): string => {
    let hash = 5381;
    const payload = JSON.stringify(parts) || '';
    for (let i = 0; i < payload.length; i++) {
        hash = ((hash << 5) + hash + payload.charCodeAt(i)) >>> 0;
    }
    return `v${hash.toString(36)}`;
};

const MAX_INITIAL_ANALYSIS_RETRIES = 1;

/**
 * Wraps analyzeTradingView with one bounded retry for transient failures
 * (429/5xx/network blip). The debate rounds already retry via
 * streamWithTransientRetry, but the initial analyst streams ran bare — a
 * single rate-limit blip silently dropped an analyst before the debate
 * started (two rate-limited analysts killed the whole run). A retry re-runs
 * the full call (a partial stream is discarded, never resumed), so a
 * genuinely failing provider still surfaces its error.
 */
/** Stable per-seat temperature (0.55–0.85) so Normal-mode ensemble seats that
 *  share one prompt sample differently. Deterministic per key — not random —
 *  so a seat keeps the same temperature across re-runs/replacements. */
const seatTemperature = (key: string): number => {
    let h = 0;
    for (let i = 0; i < key.length; i += 1) h = (h * 31 + key.charCodeAt(i)) | 0;
    return 0.55 + (Math.abs(h) % 4) * 0.1;
};

async function analyzeTradingViewWithTransientRetry(
    config: ProviderConfig,
    params: Parameters<typeof analyzeTradingView>[1],
): Promise<Awaited<ReturnType<typeof analyzeTradingView>>> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_INITIAL_ANALYSIS_RETRIES; attempt++) {
        if (attempt > 0) await new Promise(r => setTimeout(r, 2000));
        try {
            if (params.signal?.aborted) {
                const err = new Error('Aborted');
                err.name = 'AbortError';
                throw err;
            }
            return await analyzeTradingView(config, params);
        } catch (e: any) {
            const isAbort = e?.name === 'AbortError' || e?.code === 'ABORT_ERR' || e?.name === 'TimeoutError';
            const transient = !isAbort && (
                e?.status === 429 || e?.status === 502 || e?.status === 503 || e?.status === 504 ||
                /network|econnrefused|failed to fetch|fetch failed|socket hang up/i.test(e?.message || '')
            );
            lastError = e;
            if (!transient) throw e;
            console.warn(`[Analysis] Transient failure (${e?.status ?? e?.message ?? e}); retrying once.`);
        }
    }
    throw lastError;
}

// ─── Hook ──────────────────────────────────────────────────────────────────────

export function useAnalysisPipeline(params: UseAnalysisPipelineParams) {
    const {
        messages, messagesRef, updateMessages, activeConversation, activeConversationId,
        providerConfigs,
        selectedOcrModel,
        moderatorConfig, moderatorModel,
        memoryConfig,
        finalTradeSummary, loggedTrades, tradeSummaries,
        globalMemory, insightKnowledgeBase, confidenceCalibration,
        currentHybridData, setCurrentHybridData,
        setLatestMonteCarloResult, setLatestBacktestResult,
        setPerAIMonteCarloResults, setCurrentSlOptimization,
        setCurrentSuggestedEntryPrice, setCurrentEntryTimingScore,
        setHybridConnectionStatus,
        isAnalysisInProgress, setIsAnalysisInProgress,
        isHybridLoading, setIsHybridLoading,
        isRateLimited, setIsRateLimited,
        setHighlightedAnalysisId,
        setIsPostMortemInProgress, setIsLivePostMortemVisible,
        isAccuracyModeEnabled, accuracySubMode,
        isGlobalMemoryEnabled, isStrategiesEnabled, customInstructions,
        isPlaybookEnabledInPureAI, isFamiliesEnabledInPureAI, isMemoryEnabledInPureAI,
        isHybridIntelligenceEnabled, lensConfig, activeFrameworks,
        ensembleModelSelection,
        customEnsemblePrompt,
        customLensPrompts,
        isEnsembleEnabled,
        selectedChatModel,
        getActiveBot,
        onBotReply,
        toast,
        confirmDialog,
    } = params;

    // Every analysis request goes to the configured provider. Keeping this
    // wrapper preserves one typed call shape for the ensemble, solo, and
    // replacement paths without replaying a locally cached AI response.
    interface AnalysisRequestParams {
        imageSummaries: string[];
        chatHistory: Message[];
        finalTradeSummary: string | null;
        recentInsights: string | null;
        activeFrameworks: string[];
        deepenAnalysis: boolean;
        globalMemory: GlobalMemory | undefined;
        threadSummary: string | undefined;
        subMode: AccuracySubMode | undefined;
        customInstructions: string;
        isPlaybookEnabledInPureAI: boolean;
        isFamiliesEnabledInPureAI: boolean;
        isMemoryEnabledInPureAI: boolean;
        rolePrompt: string | undefined;
        systemPromptOverride: string | undefined;
        /** Per-seat independence directive — rendered into the system prompt head. */
        seatDirective?: string;
        /** Role-scoped desk tools for this seat (undefined = full toolset). */
        allowedTools?: string[];
        /** Per-seat sampling temperature (ensemble Normal mode). */
        temperature?: number;
        /** Summaries of user-uploaded strategy books (Settings → Strategies). */
        userStrategies: string | undefined;
        onReasoning: (reasoning: string) => void;
        /** Visible content deltas — surfaces the answer forming live. */
        onPartialOutput: (chunk: string) => void;
        /** Wire-audit sink (P5) — applied reasoning-route label per call. */
        onWireAudit?: (entry: WireAuditEntry) => void;
        /** R54: model side-effects from this seat's desk tools. */
        onToolAction?: (action: ToolAction) => void;
    }

    const runAnalyzeTradingView = useCallback(async (
        config: ProviderConfig,
        model: string,
        prompt: string,
        imageFiles: File[],
        dataURLs: string[],
        signal: AbortSignal | undefined,
        params: AnalysisRequestParams,
    ): Promise<{ thoughtProcess: string; finalOutput: string; analysis: any; sources?: any[] }> => {
        // The seat model is authoritative. Provider configs can be stale after
        // a Team/Lens selection or replacement choice, and the generic client
        // reads config.selectedModel when constructing the API request. Clone
        // only when necessary so the request cannot silently run on a prior
        // model while the UI labels it as another seat.
        const requestConfig = config.selectedModel === model
            ? config
            : { ...config, selectedModel: model };
        const result = await analyzeTradingViewWithTransientRetry(requestConfig, {
            prompt,
            images: (params.imageSummaries?.length ?? 0) > 0 ? [] : imageFiles,
            imageSummaries: params.imageSummaries ?? [],
            chatHistory: params.chatHistory ?? [],
            finalTradeSummary: params.finalTradeSummary ?? null,
            recentInsights: params.recentInsights ?? null,
            activeFrameworks: params.activeFrameworks ?? [],
            deepenAnalysis: params.deepenAnalysis ?? false,
            globalMemory: params.globalMemory,
            threadSummary: params.threadSummary,
            subMode: params.subMode,
            customInstructions: params.customInstructions,
            isPlaybookEnabledInPureAI: params.isPlaybookEnabledInPureAI,
            isFamiliesEnabledInPureAI: params.isFamiliesEnabledInPureAI,
            isMemoryEnabledInPureAI: params.isMemoryEnabledInPureAI,
            rolePrompt: params.rolePrompt,
            signal,
            systemPromptOverride: params.systemPromptOverride,
            seatDirective: params.seatDirective,
            userStrategies: params.userStrategies,
            temperature: params.temperature,
            trades: loggedTradesRef.current.length > 0 ? loggedTradesRef.current : undefined,
            onReasoning: params.onReasoning,
            onPartialOutput: params.onPartialOutput,
            onWireAudit: params.onWireAudit,
            onToolAction: params.onToolAction,
        });
        return result;
    }, []);

    // ─── P1-5: RAF-throttled debate stream updates ────────────────────────
    // The debate `for await` loop below calls updateMessages on EVERY token
    // chunk, rebuilding the messages array and re-rendering the chat subtree
    // hundreds of times per response. This throttled wrapper coalesces those
    // calls into one per animation frame (~60fps) — the fastest the browser
    // can paint anyway. The final flush() at the end of the loop guarantees
    // the last chunk's state is committed synchronously.
    const throttledDebateUpdate = useRafThrottle((
        conversationId: string | null,
        debateMessageId: string,
        currentTurns: DebateTurn[],
        thoughtMap: Record<string, string>,
        reasoningMap: Record<string, string>,
        activeSpeakers: Record<string, number>,
        runContractStages: Message['runContract']
    ) => {
        updateMessages(prev => {
            const messageIndex = prev.findIndex(m => m.id === debateMessageId);
            if (messageIndex === -1) return prev;
            const updatedMessage = {
                ...prev[messageIndex],
                debateTurns: currentTurns,
                thoughtProcesses: thoughtMap,
                reasoningProcesses: reasoningMap,
                activeDebateSpeakers: { ...activeSpeakers },
                liveToolEvents: { ...liveToolEventsRef.current },
                debateRunLog: [...debateRunLogRef.current],
                runContract: runContractStages,
                debateCheckpoint: currentTurns.length > 0 ? (() => {
                    const analystNames = [...new Set(currentTurns.filter(t => t.speaker !== 'System' && t.speaker !== 'Moderator').map(t => t.speaker))];
                    const completed = lastCompletedRound(currentTurns, analystNames);
                    return {
                        lastCompletedRound: completed,
                        savedAt: new Date().toISOString(),
                        analystNames,
                        laneDrafts: laneDraftsFromTurns(currentTurns, completed),
                    };
                })() : prev[messageIndex].debateCheckpoint,
            };
            const newMessages = [...prev];
            newMessages[messageIndex] = updatedMessage;
            return newMessages;
        }, conversationId);
    });

    // ─── Progressive verdict ───────────────────────────────────────────────
    // While the moderator is still WRITING the final verdict, a complete
    // trade plan often already exists in the stream. This throttled writer
    // publishes it as `provisionalAnalysis` so the TradingSignalCard fills
    // in live instead of appearing only after the debate concludes. The
    // final commit replaces it with the authoritative `analysis`.
    const throttledProvisionalVerdict = useRafThrottle((
        conversationId: string | null,
        debateMessageId: string,
        provisional: TradeAnalysis | undefined,
        planFields: Message['provisionalPlanFields']
    ) => {
        updateMessages(prev => {
            const messageIndex = prev.findIndex(m => m.id === debateMessageId);
            if (messageIndex === -1) return prev;
            if (prev[messageIndex].analysis) return prev; // final verdict already committed
            const newMessages = [...prev];
            newMessages[messageIndex] = {
                ...prev[messageIndex],
                provisionalAnalysis: provisional,
                provisionalPlanFields: planFields,
            };
            return newMessages;
        }, conversationId);
    });

    // ─── RAF-throttled LIVE reasoning updates ─────────────────────────────
    // The analyst onReasoning callback fires on EVERY streamed reasoning
    // token (20-100/s per analyst). Rebuilding the message array per token
    // re-renders the whole chat subtree dozens of times per second. This
    // coalesces those updates into one per animation frame, same pattern as
    // the debate loop above. The latest reasoning string wins per frame.
    const throttledEnsembleProgress = useRafThrottle((
        conversationId: string | null,
        placeholderId: string,
        thoughtsKey: string,
        reasoning: string
    ) => {
        updateMessages(prev => {
            const messageIndex = prev.findIndex(m => m.id === placeholderId);
            if (messageIndex === -1) return prev;
            const current = prev[messageIndex];
            const next = {
                ...current,
                ensembleProgress: {
                    ...(current.ensembleProgress ?? { analysts: [], moderator: { status: 'waiting' as const } }),
                    analysts: (current.ensembleProgress?.analysts ?? []).map(analyst =>
                        analyst.key === thoughtsKey ? { ...analyst, reasoning } : analyst),
                },
            };
            const newMessages = [...prev];
            newMessages[messageIndex] = next;
            return newMessages;
        }, conversationId);
    });

    // ─── RAF-throttled CASUAL-CHAT streaming updates ──────────────────────
    // Casual replies used to appear all at once after the full response
    // resolved. This streams visible deltas into the bubble one frame at a
    // time (perceived speed). The latest accumulated text +
    // reasoning win per frame; the final flush() commits the settled state.
    const throttledCasualStream = useRafThrottle((
        conversationId: string | null,
        messageId: string,
        text: string,
        thinking: string,
        providerId: string,
        streaming: boolean
    ) => {
        updateMessages(prev => {
            const messageIndex = prev.findIndex(m => m.id === messageId);
            if (messageIndex === -1) return prev;
            const current = prev[messageIndex];
            const next = {
                ...current,
                text,
                isStreaming: streaming,
                thoughtProcesses: thinking ? { [providerId]: thinking } : current.thoughtProcesses,
            };
            const newMessages = [...prev];
            newMessages[messageIndex] = next;
            return newMessages;
        }, conversationId);
    });

    // ─── RAF-throttled LIVE reasoning updates ─────────────────────────────
    // (removed: the Live Neural Analysis view that consumed these was
    // deleted; reasoning now lives in reasoningProcesses/thoughtProcesses)

    // ─── State ─────────────────────────────────────────────────────────────
    const [input, setInput] = useState('');
    const [images, setImages] = useState<ImageMetadata[]>([]);
    const [loadingMessage, setLoadingMessage] = useState<string | null>(null);
    const [analysisSteps, setAnalysisSteps] = useState<AnalysisStep[]>([]);
    const reasoningMapRef = useRef<Record<string, string>>({});
    const turnReasoningRef = useRef<Record<string, string>>({});
    // Visible content streamed during the opening analysis (keyed by
    // thoughtsKey) — surfaced live as round-1 turn text before the debate
    // rounds begin.
    const openingTextRef = useRef<Record<string, string>>({});
    const activeDebateSpeakersRef = useRef<Record<string, number>>({});
    // Live desk-tool chips: speaker -> latest tool line. Transient — cleared
    // when the debate concludes (never persisted).
    const liveToolEventsRef = useRef<Record<string, string>>({});
    // R54: persisted model side-effects for the CURRENT run — proposal tools
    // (forge_tool/amend_memory) and custom tools. Reset at run start, merged
    // into the AI message when it lands (Hermes-style status rows).
    const toolActionsRef = useRef<ToolAction[]>([]);
    const debateTurnsRef = useRef<DebateTurn[]>([]);
    const debateRunLogRef = useRef<DebateRunEvent[]>([]);
    /**
     * Live run-contract view (U1): re-derived from the run log on every push.
     */
    const runContractFor = (): Message['runContract'] =>
        buildRunContractStages(debateRunLogRef.current, true);
    /** Journal mirror for zero-dep callbacks (desk-tool recall on solo runs). */
    const loggedTradesRef = useRef<LoggedTrade[]>(loggedTrades);
    useEffect(() => { loggedTradesRef.current = loggedTrades; }, [loggedTrades]);
    const steeringQueueRef = useRef<string[]>([]);
    const [steeringNotes, setSteeringNotes] = useState<string[]>([]);
    /** Per-seat steering: seat name → one queued note, drained per turn. */
    const seatSteeringRef = useRef<Record<string, string>>({});
    /** Per-seat stop: seats benched by the user for the rest of this run. */
    const stoppedSeatsRef = useRef<Set<string>>(new Set());
    // Mid-debate analyst replacement: the generator suspends and waits on a
    // promise whose resolver lives here; the UI calls handleReplacementChoice
    // (via ChatContext) to settle it with the picked provider id (or null to
    // continue without). Nulled on choice, run end, and cancel so a late click
    // can never resolve a stale wait.
    const replacementChoiceRef = useRef<{ messageId: string; resolve: (providerId: string | null) => void } | null>(null);
    const handleReplacementChoice = useCallback((messageId: string, providerId: string | null): void => {
        const pending = replacementChoiceRef.current;
        if (!pending || pending.messageId !== messageId) return;
        replacementChoiceRef.current = null;
        pending.resolve(providerId);
    }, []);
    const [currentVisionData, setCurrentVisionData] = useState<string[]>([]);
    const [isDeepAnalysis, setIsDeepAnalysis] = useState<boolean>(false);

    // ─── Refs ──────────────────────────────────────────────────────────────
    const analysisAbortController = useRef<AbortController | null>(null);
    const analysisConversationIdRef = useRef<string | null>(null);
    // Automation runs: private message list (results never touch the main
    // conversation) + silent flag (step tracker / loading UI stay muted).
    const automationMessagesRef = useRef<Message[]>([]);
    const automationSilentRef = useRef(false);
    // Synchronous double-submit guard: `isAnalysisInProgress` (state) is only
    // flipped deep inside the async run, so a second Enter in the window
    // between submit and the first await passed both guards, appended a
    // duplicate user message and aborted run #1. Set synchronously before any
    // await; cleared in the finally.
    const analysisInFlightRef = useRef(false);
    // Which pipeline phase is running — used to fail the CORRECT step when a
    // run errors (the old catch hardcoded failStep('analysis'), so debate-phase
    // failures marked the wrong step and the finally force-completed everything).
    const currentPhaseRef = useRef<'analysis' | 'debate'>('analysis');

    // ─── RAF-throttled OPENING-PHASE thinking/output surfacing ───────────
    // While the analysts run their initial analysis (before any debate round
    // exists) their chain-of-thought and answer only live in ensembleProgress
    // — tiny stage bubbles / a click-to-open seat. That left "the three
    // models thinking" invisible in the transcript. This coalesces the
    // accumulated reasoning (and the visible answer forming) into round-1
    // (openings) turns and marks them live, so the debate floor streams each
    // model's thinking + output exactly the way it streams later debate
    // turns. Guarded to the analysis phase: once the debate loop starts it
    // owns the transcript.
    const throttledOpeningThinking = useRafThrottle((
        conversationId: string | null,
        messageId: string,
        analysts: { name: string; thoughtsKey: string }[],
        reasoningMap: Record<string, string>,
        partialMap: Record<string, string>,
    ) => {
        if (currentPhaseRef.current !== 'analysis') return;
        updateMessages(prev => {
            const idx = prev.findIndex(m => m.id === messageId);
            if (idx === -1) return prev;
            const turns: DebateTurn[] = [];
            for (const a of analysts) {
                const key = a.thoughtsKey || a.name;
                const cot = reasoningMap[key];
                const text = partialMap[key] || '';
                if ((cot && cot.trim()) || text.trim()) {
                    turns.push({ speaker: a.name, round: 1, text, reasoning: cot || '' });
                }
            }
            if (turns.length === 0) return prev;
            const active: Record<string, number> = {};
            for (const t of turns) active[t.speaker] = 1;
            const next = {
                ...prev[idx],
                isDebating: true,
                debateTurns: turns,
                activeDebateSpeakers: active,
            };
            const copy = [...prev];
            copy[idx] = next;
            return copy;
        }, conversationId);
    });

    useEffect(() => {
        const requestConversationId = analysisConversationIdRef.current;
        if (requestConversationId === null || requestConversationId === activeConversationId) return;

        analysisAbortController.current?.abort();
        analysisAbortController.current = null;
        analysisConversationIdRef.current = null;
        analysisInFlightRef.current = false; // keep the double-submit guard consistent
        setLoadingMessage(null);
        setIsAnalysisInProgress(false);
        setIsPostMortemInProgress(false);
        setIsLivePostMortemVisible(false);
        setAnalysisSteps([]);
    }, [activeConversationId, setIsLivePostMortemVisible, setIsPostMortemInProgress]);

    // Hybrid data and pipeline steps are ensemble-only. Clear any stale visual
    // state immediately when the user switches back to casual chat mode.
    useEffect(() => {
        if (isEnsembleEnabled) return;
        if (isHybridLoading) setIsHybridLoading(false);
        if (currentHybridData !== null) setCurrentHybridData(null);
        if (loadingMessage !== null) setLoadingMessage(null);
        if (analysisSteps.length > 0) setAnalysisSteps([]);
    }, [isEnsembleEnabled, isHybridLoading, currentHybridData, loadingMessage, analysisSteps.length]);

    // ─── Analysis Pipeline Step Tracking ───────────────────────────────────
    // Automation runs mute the step tracker entirely (automationSilentRef).
    const initAnalysisSteps = (steps: AnalysisStep[]) => {
        if (automationSilentRef.current) return;
        setAnalysisSteps(steps.map(s => ({ ...s, status: 'pending' as const, startTime: undefined, endTime: undefined })));
    };

    const startStep = (id: string) => {
        if (automationSilentRef.current) return;
        setAnalysisSteps(prev => prev.map(s => s.id === id ? { ...s, status: 'running' as const, startTime: Date.now() } : s));
    };

    const completeStep = (id: string) => {
        if (automationSilentRef.current) return;
        setAnalysisSteps(prev => prev.map(s => s.id === id ? { ...s, status: 'complete' as const, endTime: Date.now() } : s));
    };

    const failStep = (id: string) => {
        if (automationSilentRef.current) return;
        setAnalysisSteps(prev => prev.map(s => s.id === id ? { ...s, status: 'error' as const, endTime: Date.now() } : s));
    };

    const addSubStep = (id: string, subStep: { label: string; detail?: string; filename?: string }) => {
        if (automationSilentRef.current) return;
        setAnalysisSteps(prev => prev.map(s => s.id === id ? { ...s, subSteps: [...(s.subSteps || []), subStep] } : s));
    };

    // ─── Helper: active custom instructions ────────────────────────────────
    const getActiveCustomInstructions = () => {
        let instructionsList: CustomInstruction[];

        if (isAccuracyModeEnabled) {
            instructionsList = accuracySubMode === 'pure_ai' ? customInstructions.accuracyPure : customInstructions.accuracyOriginal;
        } else {
            instructionsList = customInstructions.general;
        }

        return instructionsList
            .filter(inst => inst.isActive)
            .map(inst => `[${inst.title}]\n${inst.content}`)
            .join('\n\n');
    };

    // ─── Helper: persist thinking records (best-effort, non-blocking) ──────
    // A failed reasoning write must never fail the analysis run itself.
    const persistThinkingRecords = (records: ThinkingRecord[]): void => {
        saveThinkingBatch(records).catch(err => {
            console.warn('[ThinkingStore] Failed to save thinking records:', err);
        });
    };

    // ─── Main Analysis Handler ─────────────────────────────────────────────
    const handleSendMessage = useCallback(async (customPrompt?: string, customImages?: ImageMetadata[], hiddenContext?: string, options?: {
        isUpdate?: boolean;
        updateInterval?: string;
        /** Version-stamped amendments (Batch 7): the plan this update revises. */
        priorAnalysis?: TradeAnalysis;
        priorMessageId?: string;
        presetHybridData?: HybridDataPacket | null;
        /**
         * Automation run: the analysis executes with the automation's own
         * mode/model overrides and its results are delivered via onMessage
         * instead of being written to the active conversation. The run uses
         * a private message list, so the main chat is never touched.
         */
        automation?: {
            automationId: string;
            /** Synthetic conversation providing leverage + thread summary. */
            conversation: Conversation;
            /** Per-run overrides; absent fields fall back to global settings. */
            overrides?: {
                accuracyMode?: boolean;
                accuracySubMode?: AccuracySubMode;
                lensConfig?: AnalystLensConfig;
                ensembleModelSelection?: EnsembleModelSelection;
                moderatorConfig?: ProviderConfig;
                moderatorModel?: string;
            };
            /** Delivered once with the complete user prompt + AI card. */
            onMessage: (run: { userMessage: Message; aiMessage: Message }) => void;
            /** Delivered when the run fails (user-safe message). */
            onError: (error: string) => void;
        };
        /** Continue an interrupted debate from persisted turns. */
        resumeMessageId?: string;
        /** Same-thread ticket follow-up: reuse OCR, skip leftover composer charts. */
        followUpFromMessageId?: string;
    }) => {
        const isAutomationRun = !!options?.automation;
        let stopTokenUsage: (() => void) | undefined;
        const tokenByProvider = new Map<string, TokenUsage>();
        // Automation runs redirect message writes to a private list and mute
        // the chat UI (loading text, step tracker, hybrid panel).
        automationSilentRef.current = isAutomationRun;
        if (isAutomationRun) automationMessagesRef.current = [];

        // Run-scoped mode/model overrides — automation runs may specify
        // their own accuracy mode, lens config, analyst picks and moderator
        // (fall back to the global settings when absent).
        const runAccuracyMode = options?.automation?.overrides?.accuracyMode ?? isAccuracyModeEnabled;
        const runAccuracySubMode = options?.automation?.overrides?.accuracySubMode ?? accuracySubMode;
        const runLensConfig = options?.automation?.overrides?.lensConfig ?? lensConfig;
        const runEnsembleSelection = options?.automation?.overrides?.ensembleModelSelection ?? ensembleModelSelection;
        const runModeratorConfig = options?.automation?.overrides?.moderatorConfig ?? moderatorConfig;
        const runModeratorModel = options?.automation?.overrides?.moderatorModel ?? moderatorModel;
        // Automations always run the ensemble pipeline, even when the global
        // ensemble toggle is off.
        const runEnsembleEnabled = isAutomationRun || isEnsembleEnabled;

        const isSummarizing = images.some(img => img.isLoading);

        if (isAnalysisInProgress || analysisInFlightRef.current) {
            // Drafting stays enabled during a run, but a send attempt while a
            // debate is live must not silently eat the message (the composer
            // only disables during loadingMessage, which is null mid-debate).
            // Automation runs skip the toast — the scheduler checks the
            // in-flight state itself before firing.
            if (!isAutomationRun) {
                const draft = typeof customPrompt === 'string' ? customPrompt : input;
                if (draft.trim()) {
                    const intent = parseComposerIntent(draft.trim());
                    steeringQueueRef.current = [...steeringQueueRef.current, formatComposerSteer(intent) || draft.trim()];
                    setSteeringNotes(steeringQueueRef.current);
                    setInput('');
                    toast.success?.('Queued for debate', 'Shown under the composer — applied at the next debate step.');
                }
            }
            return;
        }

        // --- ROUTING LOGIC: Standard vs Accuracy Mode ---
        // Ensemble participants are model-level entries, not just provider
        // entries. This allows several models from one provider while keeping
        // each result and reasoning trace separate.
        // Build the analyst list (model-level entries). Extracted to a pure
        // helper so the N-1 failure path is unit-testable; stale lens-assignment
        // model ids are resolved against each provider's current model list.
        const { analysts: enabledProviders, missingAnalystRoles, hasCompleteAnalystAssignments, resolvedAssignments } = buildEnsembleAnalysts(
            providerConfigs,
            runLensConfig,
            runEnsembleSelection,
            runEnsembleEnabled
        );

        // Group-member personas (the Team/group merge): resolve the personas
        // of bots that are members of ANY group, keyed provider+model, so
        // each member's role/custom instructions ride its prompts. Members
        // are matched by provider+model identity (the same identity the
        // composer's Talk-to selector writes); a bot that moved on gets the
        // general-analyst default rather than a stale persona. Read at fire
        // time — persona edits apply to the next send.
        const runGroupMemberPersonas: AgentTeamSeat[] = (() => {
            try {
                const groups = getGroups();
                const memberIds = new Set(groups.flatMap(g => g.memberIds));
                return getBots()
                    .filter(b => memberIds.has(b.id) && b.providerId && b.modelId)
                    .map(b => ({ providerId: b.providerId, modelId: b.modelId, role: b.role, customPrompt: b.customPrompt }));
            } catch {
                return [];
            }
        })();
        const teamSeatFor = (configId: string, model: string): AgentTeamSeat | undefined =>
            runGroupMemberPersonas.find(s => s.providerId === configId && s.modelId === model);
        // Role-scoped desk tools: a seat with a built-in team role inherits
        // that role's tool preset (macro/technical/risk) on its opening;
        // unroled seats, teamless runs, and Lens mode keep the FULL toolset
        // (undefined) — personas never mix with the Lens engine.
        const seatToolsFor = (seat?: AgentTeamSeat): string[] | undefined =>
            !runLensConfig.enabled && runGroupMemberPersonas.length > 0 && seat?.role ? defaultToolsForRole(seat.role) : undefined;
        // Legacy mandate rotation (ad-hoc ensembles, no active team). Hoisted
        // so the mid-debate replacement path can mirror the initial seats.
        const seatMandates = [
            'market structure, trend context, and the dominant directional bias — anchor on higher-timeframe structure first',
            'entry mechanics, key levels, and confirmation triggers — pinpoint the entry, stop, and take-profit levels',
            'risk, invalidation, and failure scenarios — stress-test the trade and argue where it breaks',
        ];

        // Accuracy mode runs the same per-analyst analysis phase, so the
        // staged analyst cards (status + live reasoning) apply there too —
        // previously the user only saw the single moderator stream.
        const isStagedEnsemble = runEnsembleEnabled && enabledProviders.length > 1;

        let effectiveInput = '';
        if (typeof customPrompt === 'string') {
            effectiveInput = customPrompt;
        } else if (typeof input === 'string') {
            effectiveInput = input;
        }
        // Debate template marker ([[Scalp check]] etc.) — extract before the
        // composer-intent parse so the marker never reaches the models.
        let runDebateTemplate: DebateTemplate | null = null;
        {
            const extracted = extractDebateTemplate(effectiveInput);
            if (extracted.template) {
                runDebateTemplate = extracted.template;
                effectiveInput = extracted.cleanText;
            }
        }
        if (effectiveInput.trim()) {
            const intent = parseComposerIntent(effectiveInput);
            const steered = formatComposerSteer(intent);
            if (steered) effectiveInput = steered;
        }

        // Determine images source (state or override)
        const followSource = options?.followUpFromMessageId
            ? (messagesRef.current.find(m => m.id === options.followUpFromMessageId)
                || messages.find(m => m.id === options.followUpFromMessageId))
            : undefined;
        const imagesToUse = followSource ? [] : (customImages || images);

        if (loadingMessage || isSummarizing || (!effectiveInput.trim() && imagesToUse.length === 0) || isRateLimited) return;

        // Setup problems no longer toast — they render as a normal chat
        // exchange (the user's message + an explanation bubble) so the reason
        // a run cannot start stays visible in the conversation history.
        const appendBlockedRunNotice = (reason: string): void => {
            updateMessages(prev => [...prev, {
                id: `user-${Date.now()}`,
                role: MessageRole.USER,
                text: effectiveInput,
                createdAt: new Date().toISOString(),
                images: imagesToUse.map(meta => meta.dataURL),
                imageSummaries: imagesToUse.map(meta => meta.summary).filter(Boolean) as string[],
            }, {
                id: `blocked-${Date.now()}`,
                role: MessageRole.AI,
                text: reason,
                createdAt: new Date().toISOString(),
                isDebating: false,
            }], activeConversationId);
        };

        // P0 fix: Surface a clear error when no AI providers are enabled.
        // Previously this returned silently, leaving the user with no feedback.
        if (enabledProviders.length === 0) {
            appendBlockedRunNotice(
                'No AI models are ready yet. Add an API key and enable at least one provider in Settings → AI Models, then send this again.'
            );
            return;
        }

        // Moderator pre-flight: the debate cannot function without its
        // moderator — they chair the rounds and produce the binding verdict.
        // A missing/broken moderator pick used to fall through to a 'none'
        // placeholder config and the run died mid-debate with a raw provider
        // error AFTER the analysts had already burned their requests. Refuse
        // before anything starts instead.
        if (runEnsembleEnabled && !isProviderReady(runModeratorConfig)) {
            appendBlockedRunNotice(
                'The debate cannot start: no moderator model is available. Pick a moderator (Team picker or Settings → AI Models), make sure it is enabled and has an API key, then send this again.'
            );
            return;
        }

        // ─── TRADER NOTEBOOK QUICK-SAVE ────────────────────────────────
        // "Save this to the notebook" short-circuits the ensemble: no chart
        // analysis, just the notebook write + a confirmation message. The
        // model reads the current notebook index and decides skip / append /
        // create (see writeNotebookNoteFromRequest).
        if (!isAutomationRun && NOTEBOOK_SAVE_PATTERN.test(effectiveInput)) {
            const provider = memoryConfig || enabledProviders[0]?.config;
            try {
                setLoadingMessage('Writing to your notebook…');
                const username = getActiveUsername();
                // Give the model something concrete to write about: the most
                // recent analysis card in this conversation, if any.
                let notebookContext = '';
                for (let i = messagesRef.current.length - 1; i >= 0; i--) {
                    const a = messagesRef.current[i].analysis;
                    if (a) {
                        notebookContext = `${a.coinName ?? '?'} ${a.direction ?? '?'} ${a.confidence ?? ''} — ${(a.strategy ?? '').slice(0, 400)}`;
                        break;
                    }
                }
                const note = provider ? await writeNotebookNoteFromRequest(effectiveInput, notebookContext, provider) : null;
                const notebookMsgId = `notebook-${Date.now()}`;
                if (note) {
                    const file = await writeModelNote(note, username);
                    updateMessages(prev => [...prev, {
                        id: notebookMsgId,
                        role: MessageRole.AI,
                        text: `📓 **Saved to your Trader Notebook** — \`${note.folder}/${file.name}\` (${note.decision === 'append' ? 'appended a new section to the existing file' : 'new file'}).\n\nThe model will read this on every future analysis. Manage everything in **Settings → Memory**.`,
                        createdAt: new Date().toISOString(),
                        isDebating: false,
                        // R54: status row for the model-authored write.
                        toolActions: [{
                            at: toolActionStamp(), speaker: 'Coach', tool: 'notebook_note', ok: true,
                            verb: note.decision === 'append' ? 'appended' : 'created',
                            label: `${note.folder}/${file.name}`, review: 'Settings → Memory',
                        }],
                    }], activeConversationId);
                } else {
                    updateMessages(prev => [...prev, {
                        id: notebookMsgId,
                        role: MessageRole.AI,
                        text: `📓 **Notebook: nothing written** — the model found this already covered (or nothing concrete to save). You can still add it manually in **Settings → Memory**.`,
                        createdAt: new Date().toISOString(),
                        isDebating: false,
                    }], activeConversationId);
                }
            } catch (quickSaveError) {
                console.error('[TraderNotebook] Quick-save failed:', quickSaveError);
                updateMessages(prev => [...prev, {
                    id: `notebook-err-${Date.now()}`,
                    role: MessageRole.AI,
                    text: `📓 **Notebook write failed** — ${(quickSaveError as Error)?.message ?? 'unknown error'}. The diary keeps recording trades automatically; this manual save did not go through.`,
                    createdAt: new Date().toISOString(),
                    isDebating: false,
                }], activeConversationId);
            } finally {
                setLoadingMessage(null);
            }
            return;
        }
        if (runEnsembleEnabled && !isAutomationRun) {
            // Role-assignment requirements only apply when Lenses are ON —
            // with Lenses off, the ordinary "Debate Models" picker (or the
            // per-provider ensemble models) determines the participants.
            // (Automation runs build complete assignments by construction.)
            if (runLensConfig.enabled) {
                if (missingAnalystRoles.length > 0) {
                    appendBlockedRunNotice(
                        `Your analyst team is incomplete. Assign ${missingAnalystRoles.map(role => ANALYST_ROLE_DEFINITIONS[role].shortName).join(', ')} in the Team menu, then send again.`
                    );
                    return;
                }
                if (!hasCompleteAnalystAssignments) {
                    appendBlockedRunNotice(
                        'Analysts must use different models. Each lens role needs its own model (the same provider is allowed) — reassign the duplicates in the Team menu, then send again.'
                    );
                    return;
                }
            } else if (enabledProviders.length > 1) {
                // Normal mode (Lenses OFF): the same provider+model may not
                // occupy two seats — identical prompts through an identical
                // model produce identical output (the "three AIs say the same
                // thing" symptom). Block it up front.
                const seatIdentities = enabledProviders.map(p => `${p.config.id}::${p.model}`);
                if (new Set(seatIdentities).size !== seatIdentities.length) {
                    appendBlockedRunNotice(
                        'Two debate seats share a model. Identical prompts through an identical model return identical output — pick a different model per seat in the Team menu, then send again.'
                    );
                    return;
                }
            }
        }

        // Seat ceiling (TEAM_MAX_SEATS, kept from the Team era — now it
        // caps the GROUP debate room). Teams of 4+ are the supported
        // pod-tier configuration (debatePods), so the old hard-3
        // Standard-mode cap was stale — it blocked exactly the room sizes
        // the roster builder seats. The ceiling still guards a runaway
        // enabled-provider list from fanning out N× calls.
        if (!isAutomationRun && !runAccuracyMode && enabledProviders.length > TEAM_MAX_SEATS) {
            appendBlockedRunNotice(
                `Too many providers for a Standard-mode debate. A maximum of ${TEAM_MAX_SEATS} AI providers can join — disable at least one in Settings → AI Models, then send again.`
            );
            return;
        }

        const runStartedAt = Date.now();
        // Live-backtest summary (block-scoped result is captured here so the
        // final message update below can persist it on runStats).
        let liveBtResult: { totalMatches: number; winRate: number; expectedValue: number } | undefined;
        setHighlightedAnalysisId(null);
        setIsRateLimited(false);
        analysisAbortController.current?.abort();
        const currentAbortController = new AbortController();
        analysisAbortController.current = currentAbortController;
        analysisConversationIdRef.current = activeConversationId;
        // Synchronous in-flight marker — see analysisInFlightRef above.
        analysisInFlightRef.current = true;
        steeringQueueRef.current = [];
        setSteeringNotes([]);
        seatSteeringRef.current = {};
        stoppedSeatsRef.current = new Set();
        // Bind every async message write to the conversation that started the
        // request. This remains correct even if the user switches conversations
        // before a provider response or stream chunk arrives.
        const requestConversationId = activeConversationId;
        const updateRequestMessages = (updater: (prevMessages: Message[]) => Message[]): void => {
            if (isAutomationRun) {
                // Automation runs keep a PRIVATE message list — the main
                // conversation is never touched.
                automationMessagesRef.current = updater(automationMessagesRef.current);
                return;
            }
            updateMessages(updater, requestConversationId);
        };
        const isCurrentRequest = (): boolean =>
            analysisAbortController.current === currentAbortController && !currentAbortController.signal.aborted;

        // Throw when the request goes stale (user cancel or conversation
        // switch). Plain early-returns/breaks bypassed the catch block's
        // message cleanup, leaving the debate placeholder stuck with
        // isDebating:true — and with the abort controller already nulled by
        // the finally, the Stop button couldn't even abort it again.
        const assertCurrentRequest = (): void => {
            if (!isCurrentRequest()) {
                const abortError = new Error('Analysis aborted');
                abortError.name = 'AbortError';
                throw abortError;
            }
        };

        if (imagesToUse.length > 0 && !isAutomationRun) {
            const visionData = imagesToUse.map(img => img.fullAnalysisText || `Chart ${imagesToUse.indexOf(img) + 1}: No analysis text available.`);
            setCurrentVisionData(visionData);
        }

        const imageFiles = imagesToUse.map(meta => meta.file);
        const dataURLs = imagesToUse.map(meta => meta.dataURL);
        // UI displays the user input, but API may receive enhanced context
        const originalPrompt = effectiveInput;
        const promptToSend = hiddenContext ? `${hiddenContext}\n\nUser Input: "${effectiveInput}"` : effectiveInput;

        const ocrModelsUsed = [...new Set(imagesToUse.map(meta => meta.ocrModelUsed).filter(Boolean) as string[])];

        const resumeTarget = options?.resumeMessageId
            ? (messagesRef.current.find(m => m.id === options.resumeMessageId) || messages.find(m => m.id === options.resumeMessageId))
            : undefined;
        const canResume = Boolean(resumeTarget && !resumeTarget.analysis && (resumeTarget.debateTurns?.length || 0) > 0);

        // Ensemble without a chart still works — bare greetings just get a
        // nudge toward including a coin, not a hard block.
        if (!isAutomationRun && runEnsembleEnabled && imagesToUse.length === 0 && !canResume && !extractSymbolFromPrompt(effectiveInput)) {
            toast.warning('Tip: include a coin', 'For a full analysis add a symbol like BTC, SOL or ETH — e.g. “analyze BTC”.');
        }

        const userMessage: Message = {
            id: `user-${Date.now()}`,
            role: MessageRole.USER,
            text: originalPrompt,
            createdAt: new Date().toISOString(),
            images: dataURLs,
            imageSummaries: imagesToUse.map(meta => meta.summary).filter(Boolean) as string[],
            ocrModelUsed: ocrModelsUsed.join(','),
            ocrCache: (() => {
                const texts = [
                    ...imagesToUse.map(meta => meta.fullAnalysisText).filter((t): t is string => Boolean(t)),
                    ...(resumeTarget?.ocrCache?.texts ?? []),
                    ...(followSource?.ocrCache?.texts ?? []),
                ];
                const unique = [...new Set(texts)];
                return unique.length > 0 ? { texts: unique } : undefined;
            })(),
        };

        const ensembleMessageId = canResume && resumeTarget ? resumeTarget.id : `ensemble-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        const ensembleProgress = isStagedEnsemble ? {
            analysts: enabledProviders.map(provider => ({
                key: provider.thoughtsKey,
                providerId: provider.config.id,
                providerName: provider.config.name,
                modelId: provider.model,
                modelName: provider.model,
                displayName: provider.name,
                status: 'waiting' as const,
            })),
            moderator: {
                status: 'waiting' as const,
                waitingFor: enabledProviders.map(provider => provider.name),
            },
        } : undefined;
        const ensemblePlaceholder: Message | null = isStagedEnsemble ? {
            id: ensembleMessageId,
            role: MessageRole.AI,
            text: '',
            createdAt: canResume && resumeTarget ? resumeTarget.createdAt : new Date().toISOString(),
            isDebating: false,
            debateTurns: canResume && resumeTarget ? (resumeTarget.debateTurns || []) : [],
            debateRunLog: canResume && resumeTarget ? (resumeTarget.debateRunLog || []) : [],
            debateCheckpoint: canResume && resumeTarget ? resumeTarget.debateCheckpoint : undefined,
            ensembleProgress,
            ocrModelUsed: userMessage.ocrModelUsed,
            imageSummaries: userMessage.imageSummaries,
            ocrCache: userMessage.ocrCache,
            modelsUsed: (canResume && resumeTarget?.modelsUsed) || buildModelsUsedRecord(enabledProviders),
            isAccuracyMode: runAccuracyMode,
            isLensMode: runLensConfig?.enabled ?? false,
            accuracySubMode: runAccuracyMode ? runAccuracySubMode : undefined,
            tradingStyle: runLensConfig?.enabled && runLensConfig.tradingStyle !== 'auto' ? (runLensConfig.tradingStyle as any) : undefined,
        } : null;

        if (canResume) {
            updateRequestMessages(prev => prev.map(m => m.id === ensembleMessageId ? { ...m, isDebating: true } : m));
        } else {
            updateRequestMessages(prev => ensemblePlaceholder ? [...prev, userMessage, ensemblePlaceholder] : [...prev, userMessage]);
        }
        // Automation runs must not clear the composer (the user may be
        // mid-draft while a scheduled run fires).
        if (!isAutomationRun) {
            setInput('');
            setImages([]);
        }

        const updateEnsembleProgress = (updater: (progress: NonNullable<Message['ensembleProgress']>) => NonNullable<Message['ensembleProgress']>): void => {
            if (!ensemblePlaceholder) return;
            updateRequestMessages(prev => prev.map(message => message.id === ensemblePlaceholder.id
                ? { ...message, ensembleProgress: updater(message.ensembleProgress ?? ensembleProgress!) }
                : message));
        };

        // Only claim the hybrid fetch when the feature is ON — the old
        // condition spun the HybridDataPanel for the whole run even with the
        // toggle off (the skip path never reset it).
        //
        // Guard against cross-symbol contamination: cached hybrid data from a
        // previous analysis (e.g. BTC) must never feed a different coin
        // (e.g. ETH) — the wrong prices/ATR/regime would be injected into the
        // analyst prompts and persisted onto the new trade card.
        const detectedSymbol = extractSymbolFromPrompt(effectiveInput);
        const cachedHybridData =
            currentHybridData && detectedSymbol && currentHybridData.symbol === detectedSymbol
                ? currentHybridData
                : null;
        // Hybrid intelligence: automation runs ALWAYS fetch real-time market
        // data (that data IS the point of an automated analysis) — the
        // global toggle only gates MANUAL runs.
        const runHybridEnabled = isAutomationRun || isHybridIntelligenceEnabled;
        if (runEnsembleEnabled && runHybridEnabled && !cachedHybridData && !options?.presetHybridData) {
            if (!isAutomationRun) {
                setHybridConnectionStatus(prev => (prev === 'connected' ? 'connected' : 'connecting'));
                setIsHybridLoading(true);
                setCurrentHybridData(null);
            }
        }
        let freshHybridData: HybridDataPacket | null = cachedHybridData;
        if (options?.presetHybridData) {
            setCurrentHybridData(options.presetHybridData);
            freshHybridData = options.presetHybridData;
            setIsHybridLoading(false);
        }

        let promptLane: 'live' | 'control' = 'live';
        // Id of the live-streaming casual-chat bubble (if this run is a casual
        // reply) so the catch block can settle it on cancel/error instead of
        // leaving a stuck isStreaming placeholder.
        let casualMessageId: string | null = null;
        // Casual chats attribute their error bubble to the provider that was
        // tried (modelsUsed), so a failed 1:1 bot reply surfaces INSIDE that
        // bot's thread instead of vanishing from the scoped view.
        let casualErrorAttribution: Record<string, string> | undefined;
        try {
            promptLane = beginPromptLane();
            const currentMessages = isAutomationRun
                ? [...(options?.automation?.conversation.messages ?? []), userMessage]
                : [...messagesRef.current, userMessage];
            const currentThreadSummary = isAutomationRun
                ? options?.automation?.conversation.threadSummary
                : activeConversation?.threadSummary;
            const memoryToInject = isGlobalMemoryEnabled ? globalMemory : undefined;
            // Debate template steering rides the custom instructions so every
            // seat + the moderator see the framing (Scalp / Swing / Devil's
            // advocate / Risk-only).
            const instructionsToUse = runDebateTemplate
                ? [getActiveCustomInstructions(), runDebateTemplate.steering].filter(Boolean).join('\n\n')
                : getActiveCustomInstructions();

            // These steps describe the ensemble analysis pipeline only. Casual
            // chat must not render analysis/fetching progress at all.
            // Set loading immediately so the empty-chat hero and progress UI
            // swap in the same paint — otherwise there is a gap of black
            // canvas before "Fetching market data" appears.
            if (runEnsembleEnabled) {
                if (!isAutomationRun) {
                    setLoadingMessage(
                        runHybridEnabled && !cachedHybridData && !options?.presetHybridData
                            ? 'Fetching real-time market data...'
                            : 'Starting analysis...'
                    );
                }
                initAnalysisSteps([
                    { id: 'market-data', title: 'Fetching market data', status: 'pending' },
                    { id: 'gate-scan', title: 'Running pattern gate scan', status: 'pending' },
                    { id: 'analysis', title: 'Analyzing charts', status: 'pending' },
                    { id: 'debate', title: 'Ensemble debate', status: 'pending' },
                ]);
            } else {
                setAnalysisSteps([]);
            }

            // HYBRID INTELLIGENCE: Inject real-time market data if enabled
            // Bayesian confidence cap computed by the hybrid fetch (calibration
            // pipeline) — enforced in processNewAnalysis below. Hoisted so the
            // nested function can read it (hybridResult is block-scoped).
            let bayesianConfidenceCap: 'High' | 'Medium' | 'Low' | 'Avoid' | undefined;

            // Skip fetching if preset data was already passed (from auto-capture)
            let hybridDataInjection = '';
            devLog('[Hybrid Intelligence] ======= START =======');
            devLog('[Hybrid Intelligence] Enabled:', isHybridIntelligenceEnabled);
            devLog('[Hybrid Intelligence] HasPresetData:', !!options?.presetHybridData);
            devLog('[Hybrid Intelligence] User prompt:', effectiveInput);
            // The toggle gates the fetch: with Hybrid Intelligence OFF no data
            // is fetched and nothing is injected into the analyst prompts.
            // Preset data (auto-capture) always wins — it was explicitly
            // fetched for this analysis, so it is injected below regardless.
            if (runEnsembleEnabled && runHybridEnabled && !options?.presetHybridData) {
                try {
                    devLog('[Hybrid Intelligence] Attempting to fetch data for prompt:', effectiveInput);
                    if (!isAutomationRun) setLoadingMessage('Fetching real-time market data...');
                    startStep('market-data');
                    const hybridResult = await tryFetchHybridDataFromPromptWithCalibration(
                        effectiveInput,
                        GlobalLearningService.getCalibration()
                    );
                    if (!isCurrentRequest()) assertCurrentRequest();
                    if (!isAutomationRun) setIsHybridLoading(false);
                    if (hybridResult) {
                        bayesianConfidenceCap = hybridResult.adjustedConfidence;
                        // Use enhanced injection which includes calibration data
                        hybridDataInjection = hybridResult.enhancedInjection || hybridResult.promptInjection;
                        if (!isAutomationRun) setCurrentHybridData(hybridResult.data); // Store for UI display
                        freshHybridData = hybridResult.data; // Use local var downstream (state is stale in this closure)

                        // Store correlation risk if available - helpful for UI later
                        if (hybridResult.correlationRisk) {
                            devLog('[Hybrid Intelligence] Correlation Risk Score:', hybridResult.correlationRisk.correlationRiskScore);
                        }

                        devLog('[Hybrid Intelligence] SUCCESS - Got data for:', hybridResult.data.symbol);

                        // Regime ledger (Macro-lens memory): record today's
                        // regime for this coin so the regime seat can say "day 4
                        // of ranging" instead of starting blank every run.
                        // Fire-and-forget; deduped per coin×day.
                        try {
                            const ledgerRegime = marketRegimeToLedger(hybridResult.data.regime?.regime);
                            if (hybridResult.data.symbol && ledgerRegime) {
                                void recordRegimeDay(
                                    { coin: hybridResult.data.symbol, regime: ledgerRegime, source: 'hybrid' },
                                    getActiveUsername(),
                                ).catch(() => { /* ledger is best-effort */ });
                            }
                        } catch { /* ledger is best-effort */ }

                        devLog('[Hybrid Intelligence] Injection length:', hybridDataInjection.length);
                        devLog('[Hybrid Intelligence] Injection preview:', hybridDataInjection.substring(0, 500));
                    } else {
                        devLog('[Hybrid Intelligence] FAILED - No symbol detected in prompt');
                    }
                } catch (hybridError) {
                    if (!isCurrentRequest()) assertCurrentRequest();
                    if (!isAutomationRun) setIsHybridLoading(false);
                    completeStep('market-data');
                    console.error('[Hybrid Intelligence] ERROR fetching market data:', hybridError);
                    if (!isAutomationRun) toast.warning('Hybrid data unavailable', 'Market data fetch failed — analysis will proceed without real-time data.');
                }
            } else if (options?.presetHybridData) {
                // Auto-capture flow: the data was already fetched upstream —
                // build the same injection so the three analysts still receive
                // the hybrid market data in their prompts.
                hybridDataInjection = generateHybridPromptInjection(options.presetHybridData);
                devLog('[Hybrid Intelligence] SKIPPED - Using preset data from auto-capture');
                completeStep('market-data');
            } else {
                devLog('[Hybrid Intelligence] SKIPPED - Feature not enabled');
                completeStep('market-data');
            }

            // USER STRATEGIES (Settings → Strategies): enabled book summaries
            // are injected into every analyst prompt AND bundled with the
            // hybrid chart block for every moderator surface — the ensemble
            // trades like a human following the uploaded book.
            const strategiesBlock = isStrategiesEnabled
                ? (() => {
                    const text = getEnabledStrategiesText();
                    return text ? `\n**USER STRATEGIES (from uploaded books — follow these when they apply):**\n${text}` : '';
                })()
                : '';

            // Coin detection for learning context: match only uppercase
            // tickers (no /i flag, which would match any word) and exclude
            // common command words, mirroring the GateKeeper commonWords
            // exclusion list. Hoisted ABOVE the moderator bundle so the
            // journal-driven accuracy blocks can join it.
            // TRADER NOTEBOOK stage (extracted): notebook slices, bot
            // memory, similar-setups record, regime weighting, loss priming.
            const {
                memoryQuery,
                detectedLearningCoin,
                pendingDirection,
                pendingPattern,
                botMemoryContext,
                memoryFilesContext,
                moderatorMemoryContext,
                memoryRetrieved,
                similarSetupsContext,
                regimeWeightingContext,
                lossPrimingRows,
            } = assemblePipelineMemoryContext(effectiveInput, loggedTrades, freshHybridData ?? null, userMessage.id);

            // One context bundle for every moderator surface (autoplay debate,
            // real debate, accuracy verification, compact retry): the same
            // chart/pattern block the analysts see + the user strategies.
            const moderatorHybrid = buildHybridEnvelope(freshHybridData, 'moderator') || hybridDataInjection;
            const moderatorContextBundle = [moderatorMemoryContext, similarSetupsContext, regimeWeightingContext, moderatorHybrid, strategiesBlock].filter(Boolean).join('\n\n');

            // 'auto' trading style was hardcoded to 'swing' at every call
            // site — the market-data detector (ADX/regime/volume/session)
            // was never invoked. Resolve the effective style ONCE from the
            // live data so the lens prompts, the rebuttal personas and the
            // card's tradingStyle field all agree. Falls back to swing when
            // no hybrid data exists (hybrid off / fetch failed).
            const effectiveTradingStyle = getEffectiveStyle(runLensConfig.tradingStyle, freshHybridData ?? undefined).style;

            // AI LEARNING: the old UnifiedLearningBuilder channel is
            // RETIRED — its six overlapping profile/mistake/insight injections
            // fought the budgeted notebook slice above (two memory voices is
            // exactly the degradation mode the simplification killed).
            // What survives is the one thing the notebook slice cannot produce:
            // per-provider historical accuracy weighting (weighted voting), fed
            // to BOTH the analysts and the moderator. Gated on a real closed
            // trade sample so fresh installs get clean prompts.
            let learningInjection = '';
            let moderatorLearningContext = ''; // Separate context for moderator surfaces

            const closedSample = loggedTrades.filter(
                t => t.outcome === TradeOutcome.WIN || t.outcome === TradeOutcome.LOSS,
            ).length;
            if (closedSample >= 3 && enabledProviders.length > 0) {
                try {
                    learningInjection = generateWeightedVotingContext(
                        enabledProviders.map(p => p.config.id),
                        pendingPattern || undefined,
                    );
                    moderatorLearningContext = learningInjection;
                    if (learningInjection) {
                        devLog('[AI Learning] Weighted-voting context generated:', learningInjection.length, 'chars');
                    }
                } catch (learningError) {
                    console.error('[AI Learning] Failed to generate weighted-voting context:', learningError);
                }
            }

            // Retrieved harness context already carries similar trades + skills.
            // Do not also dump the pattern-memory essay or raw insight list.
            const enhancedFinalTradeSummary = memoryFilesContext ? null : finalTradeSummary;

            let recentInsightsString: string | null = null;
            if (!memoryFilesContext && tradeSummaries && tradeSummaries.length > 0) {
                const top10Summaries = tradeSummaries.slice(0, 10);
                recentInsightsString = top10Summaries.map((s, idx) => `${idx + 1}. [${new Date(s.timestamp).toLocaleDateString()}] ${s.summaryText}`).join('\n\n');
                devLog('[Recent Insights] Generated from tradeSummaries array, length:', recentInsightsString.length);
            }

            // Enhance prompt with memory files, similar setups, hybrid data AND learning context
            let enhancedPrompt = promptToSend;
            if (memoryFilesContext || similarSetupsContext || learningInjection) {
                const contextParts: string[] = [];
                if (memoryFilesContext) contextParts.push(memoryFilesContext);
                if (similarSetupsContext) contextParts.push(similarSetupsContext);
                if (learningInjection) contextParts.push(learningInjection);
                enhancedPrompt = `${contextParts.join('\n\n')}\n\n${promptToSend}`;
            }

            // ========== GATE KEEPER: Two-Stage Gate Scan ==========
            // Extract symbol from prompt for Gate analysis
            // Exclude common command words that might be mistaken for symbols
            const commonWords = COMMON_WORDS;
            // Match crypto symbols: prioritize those ending in USDT/PERP, then standalone 2-5 letter symbols
            const symbolMatches = effectiveInput.match(/\b([A-Z]{2,10})(?:USDT?|PERP)\b/gi) ||
                effectiveInput.match(/\b([A-Z]{2,5})\b/gi) || [];
            const detectedSymbol = symbolMatches
                .map(m => m.replace(/USDT?|PERP/gi, '').toUpperCase())
                .find(s => s.length >= 2 && s.length <= 10 && !commonWords.includes(s));
            const finalSymbol = detectedSymbol ? `${detectedSymbol}USDT` : null;

            // ========== DECISION REFLECTIONS ==========
            // Feed the user's closed trades + lessons back into the NEXT run
            // (TradingAgents/Reflexion loop): the model reasons with actual
            // outcomes for this ticker, not only generic extracted rules.
            try {
                const reflectionBlock = buildDecisionReflectionContext(loggedTrades, finalSymbol);
                if (reflectionBlock) {
                    enhancedPrompt = `${reflectionBlock}

${enhancedPrompt}`;
                    // Shared harness memory: the moderator must weigh the same
                    // recent decisions the analysts see — its verdict grounds
                    // in the same memory, not a condensed subset.
                    moderatorLearningContext = moderatorLearningContext
                        ? `${moderatorLearningContext}

${reflectionBlock}`
                        : reflectionBlock;
                }
            } catch { /* reflection is best-effort */ }

            // POST-MORTEM LESSONS FOR THIS COIN: the reflection block above
            // carries raw post-mortem snippets; this adds the EXTRACTED lesson
            // line per closed trade on the same coin so the floor does not
            // repeat a mistake it already paid for. Zero AI cost.
            try {
                const coinLessonsBlock = buildCoinLessonsBlock(loggedTrades, detectedLearningCoin || detectedSymbol || undefined);
                if (coinLessonsBlock) {
                    enhancedPrompt = `${coinLessonsBlock}\n\n${enhancedPrompt}`;
                    moderatorLearningContext = moderatorLearningContext
                        ? `${moderatorLearningContext}\n\n${coinLessonsBlock}`
                        : coinLessonsBlock;
                }
            } catch { /* coin lessons are best-effort */ }

            let gateInjection = '';
            let capturedGateResult: GateOutput | null = null; // Local variable to avoid state closure issue
            if (finalSymbol && runEnsembleEnabled) {
                try {
                    devLog(`[GateKeeper] Running Gate check for ${finalSymbol}...`);
                    if (!isAutomationRun) setLoadingMessage('Running Gate Scan...');
                    completeStep('market-data'); startStep('gate-scan');

                    const gateResult = await getGateAnalysis(finalSymbol, loggedTrades);
                    capturedGateResult = gateResult.gateOutput; // Capture locally for processNewAnalysis

                    if (gateResult.shouldProceed) {
                        gateInjection = gateResult.promptPrefix;
                        devLog(`[GateKeeper] ✅ Gate PASSED: Confidence cap ${(gateResult.gateOutput.confidenceCap * 100).toFixed(0)}%`);
                        if (gateResult.gateOutput.suggestedDirection) {
                            devLog(`[GateKeeper] Pattern Memory suggests: ${gateResult.gateOutput.suggestedDirection}`);
                        }
                    } else {
                        devLog(`[GateKeeper] ⚠️ Gate BLOCKED: ${gateResult.rejectionReason}`);
                        // Even if blocked, still proceed but with max penalty applied
                        gateInjection = `\n⚠️ GATE WARNING: ${gateResult.rejectionReason}\n`;
                    }
                } catch (gateError) {
                    console.error('[GateKeeper] Gate check failed:', gateError);
                    // Fail-open: proceed without Gate constraints
                    failStep('gate-scan');
                    if (!isAutomationRun) toast.warning('Gate check skipped', 'Quality constraints could not be applied — analysis will proceed without gate validation.');
                }
            }

            // No symbol → the gate block never ran, so the market-data step
            // (completed inside it) would stay 'pending' for the whole run.
            if (!finalSymbol) completeStep('market-data');

            // Prepend Gate injection to enhanced prompt if available
            if (gateInjection) {
                enhancedPrompt = `${gateInjection}${enhancedPrompt}`;
                devLog('[GateKeeper] Gate constraints injected into prompt');
            }
            // ========== END GATE KEEPER ==========

            devLog('[Hybrid Intelligence] Enhanced prompt length:', enhancedPrompt.length);
            devLog('[Hybrid Intelligence] Has injection:', hybridDataInjection.length > 0);
            devLog('[AI Learning] Has learning injection:', learningInjection.length > 0);
            devLog('[Hybrid Intelligence] ======= END =======');

            // Check if it's an update request via hiddenContext or other triggers
            const isUpdate = !!hiddenContext;
            const upperPrompt = originalPrompt.toUpperCase();
            const isChartAnalysisRequested =
                imageFiles.length > 0 ||
                upperPrompt.includes("LIVE MARKET") ||
                upperPrompt.includes("STRATEGY") ||
                upperPrompt.includes("ANALYZE") ||
                upperPrompt.includes("CHART") ||
                upperPrompt.includes("SETUP") ||
                isUpdate ||
                // Ensemble mode always follows the analysis/debate pipeline,
                // even when the user uses conversational wording.
                isEnsembleEnabled;

            // Chart analysis only runs in ensemble mode; otherwise the
            // message is handled as casual chat with the selected model.
            if (isChartAnalysisRequested && runEnsembleEnabled) {
                const summaries = [
                    ...imagesToUse.map(meta => meta.fullAnalysisText).filter((t): t is string => Boolean(t)),
                    ...(userMessage.ocrCache?.texts ?? []),
                ].filter((t, i, arr) => arr.indexOf(t) === i);
                const processNewAnalysis = (analysis: TradeAnalysis): TradeAnalysis => {
                    const finalAnalysis = sanitizeTradeAnalysis(analysis);
                    finalAnalysis.originalStopLossPercentage = finalAnalysis.stopLossPercentage;
                    finalAnalysis.takeProfit = Array.isArray(finalAnalysis.takeProfit)
                        ? finalAnalysis.takeProfit.map(tp => ({ ...tp, originalPercentage: tp.percentage }))
                        : [];

                    // Explicitly inject isUpdate flag if this was an update action
                    if (options?.isUpdate) {
                        finalAnalysis.isUpdate = true;
                        if (options.updateInterval) {
                            finalAnalysis.updateInterval = options.updateInterval;
                        }
                        // Version stamp (Batch 7): a revision is an explicit
                        // amendment with a recorded diff, never an overwrite.
                        finalAnalysis.planVersion = (options.priorAnalysis?.planVersion ?? 1) + 1;
                        if (options.priorMessageId) {
                            finalAnalysis.amendsMessageId = options.priorMessageId;
                        }
                        if (options.priorAnalysis) {
                            const diff = planAmendmentDiff(options.priorAnalysis, finalAnalysis);
                            if (diff) finalAnalysis.planDiff = diff;
                        }
                    }

                    // ========== GATE KEEPER RESULT ==========
                    // Store Gate result in analysis for UI display
                    if (capturedGateResult) {
                        finalAnalysis.gateResult = {
                            passed: capturedGateResult.pass,
                            confidenceCap: capturedGateResult.confidenceCap,
                            penalties: capturedGateResult.confidencePenalties,
                            familyBias: capturedGateResult.familyBias,
                            suggestedDirection: capturedGateResult.suggestedDirection,
                            warnings: capturedGateResult.warnings.slice(0, 3),
                            insights: capturedGateResult.insights.slice(0, 2)
                        };
                        devLog(`[GateKeeper] Result stored in analysis: cap=${(capturedGateResult.confidenceCap * 100).toFixed(0)}%`);
                    }
                    // ========== DETERMINISTIC RISK VETO ==========
                    // Rules-based veto between the moderator's verdict and the
                    // final signal (TradingAgents-style: consensus among models
                    // is not risk control). Hard checks only — no LLM involved.
                    if (capturedGateResult) {
                        const vetoNotes: string[] = [];
                        if (capturedGateResult.pass === false) {
                            vetoNotes.push('GATE VETO: insufficient data — this signal must not be traded on its own.');
                        }
                        const verdictDir = finalAnalysis.direction?.toLowerCase();
                        const gateDir = capturedGateResult.suggestedDirection?.toLowerCase();
                        if (gateDir && verdictDir && gateDir !== verdictDir && (capturedGateResult.confidencePenalties?.patternMemory ?? 0) > 0.15) {
                            vetoNotes.push(`PATTERN-MEMORY CONTRADICTION: gate favors ${capturedGateResult.suggestedDirection}, verdict is ${finalAnalysis.direction}.`);
                            finalAnalysis.originalConfidence = finalAnalysis.originalConfidence ?? finalAnalysis.confidence;
                            if (finalAnalysis.confidence === 'High') finalAnalysis.confidence = 'Medium';
                        }
                        const hasSL = parsePrice(finalAnalysis.stopLoss || '') > 0;
                        const hasTP = finalAnalysis.takeProfit?.[0]?.price != null;
                        if (!hasSL || !hasTP) {
                            vetoNotes.push('INCOMPLETE PLAN: missing stop loss or take profit — not tradeable as-is.');
                            if (finalAnalysis.confidence === 'High') {
                                finalAnalysis.originalConfidence = finalAnalysis.originalConfidence ?? finalAnalysis.confidence;
                                finalAnalysis.confidence = 'Medium';
                            }
                        }
                        if (vetoNotes.length > 0) {
                            if (!finalAnalysis.validationWarnings) finalAnalysis.validationWarnings = [];
                            finalAnalysis.validationWarnings.push(...vetoNotes);
                            finalAnalysis.riskVeto = vetoNotes.join(' ');
                            devLog(`[RiskVeto] ${vetoNotes.join(' | ')}`);
                        }
                    }
                    // ========== END GATE KEEPER RESULT ==========

                    // ========== ACCURACY VALIDATION GATE ==========
                    // Always run validation gate to ensure quality checks
                    // The gate will handle gracefully when hybridData is null
                    // Direction captured before the gate so a rescued soft
                    // Avoid can restore it (Avoid forces Neutral below).
                    const directionBeforeValidation = finalAnalysis.direction;
                    let validationAdjustedConfidence: 'High' | 'Medium' | 'Low' | 'Avoid' | undefined;
                    try {
                        const validationResult = runValidationGate({
                            analysis: finalAnalysis,
                            hybridData: freshHybridData, // May be null in non-hybrid mode
                            calibration: GlobalLearningService.getCalibration(), // Use global persistent calibration
                            tradeHistory: loggedTrades
                        });

                        // Store original confidence if adjusted
                        if (validationResult.confidenceWasAdjusted) {
                            validationAdjustedConfidence = validationResult.adjustedConfidence;
                            finalAnalysis.originalConfidence = validationResult.originalConfidence;
                            finalAnalysis.confidence = validationResult.adjustedConfidence;
                            if (finalAnalysis.confidence === 'Avoid') {
                                // Avoid is a no-trade result. Keep the
                                // direction field consistent with the card's
                                // final action after a hard validation veto.
                                finalAnalysis.direction = 'Neutral';
                            }
                            devLog(`[ValidationGate] Confidence adjusted: ${validationResult.originalConfidence} → ${validationResult.adjustedConfidence}`);
                        }

                        // Bayesian cap from the hybrid fetch: the calibration
                        // pipeline computes a capped confidence level for this
                        // setup — never let the analysis exceed it.
                        if (bayesianConfidenceCap) {
                            // 'Avoid' ranks BELOW 'low' — it is the strongest
                            // veto the calibration pipeline has and must be
                            // enforceable (previously missing from the ladder,
                            // so an Avoid cap was silently never applied).
                            const LEVEL_ORDER: Record<string, number> = { avoid: -1, low: 0, medium: 1, high: 2 };
                            const cap = LEVEL_ORDER[bayesianConfidenceCap.toLowerCase()];
                            const current = LEVEL_ORDER[finalAnalysis.confidence?.toLowerCase() || 'high'];
                            if (cap !== undefined && current !== undefined && current > cap) {
                                finalAnalysis.originalConfidence = finalAnalysis.originalConfidence ?? finalAnalysis.confidence;
                                finalAnalysis.confidence = bayesianConfidenceCap;
                                devLog(`[Bayesian] Confidence capped: ${current} → ${bayesianConfidenceCap}`);
                            }
                        }

                        // Store validation warnings
                        if (validationResult.warnings.length > 0 || validationResult.errors.length > 0) {
                            finalAnalysis.validationWarnings = [
                                ...validationResult.warnings,
                                ...validationResult.errors.map(error => ` HARD VALIDATION: ${error.trim()}`),
                            ];
                            devLog(`[ValidationGate] ${validationResult.warnings.length} warnings added to analysis`);
                        }

                        // Store Devil's Advocate data if available
                        if (validationResult.devilsAdvocate) {
                            finalAnalysis.devilsAdvocate = {
                                bearCaseReasons: validationResult.devilsAdvocate.bearCaseReasons,
                                failureScenarios: validationResult.devilsAdvocate.tradeFailureScenarios,
                                crowdedTradeWarning: validationResult.crowdedTradeWarning,
                                riskScore: validationResult.devilsAdvocate.overallRiskScore
                            };
                        }

                        // Store Entry Timing Score for display in trade card
                        if (validationResult.entryTiming) {
                            finalAnalysis.entryTimingScore = {
                                score: validationResult.entryTiming.score,
                                timingQuality: validationResult.entryTiming.timing,
                                suggestedEntry: validationResult.entryTiming.suggestedEntry
                            };
                            devLog(`[ValidationGate] Entry Timing Score: ${validationResult.entryTiming.score}/100 (${validationResult.entryTiming.timing})`);

                            // Store Entry Timing Score for HybridDataPanel display
                            setCurrentEntryTimingScore({
                                score: validationResult.entryTiming.score,
                                timingQuality: validationResult.entryTiming.timing,
                                suggestedEntry: validationResult.entryTiming.suggestedEntry
                            });

                            // Store suggested entry price for HybridDataPanel SL Optimization display
                            if (validationResult.entryTiming.suggestedEntry?.price) {
                                setCurrentSuggestedEntryPrice(validationResult.entryTiming.suggestedEntry.price);
                                devLog(`[ValidationGate] Suggested Entry Price: $${validationResult.entryTiming.suggestedEntry.price}`);
                            }
                        }

                        // Store SL Optimization for HybridDataPanel display
                        if (validationResult.slOptimization) {
                            setCurrentSlOptimization(validationResult.slOptimization);
                            devLog(`[ValidationGate] SL Optimization: Recommended multiplier ${(validationResult.slOptimization.recommendedMultiplier * 100).toFixed(0)}%, Missed wins: ${validationResult.slOptimization.missedWinRate.toFixed(0)}%`);
                        }

                        // Log validation report (for debugging)
                        const modeStr = isAccuracyModeEnabled
                            ? (accuracySubMode === 'pure_ai' ? 'Pure AI' : 'Accuracy Original')
                            : 'Standard';
                        devLog(`[ValidationGate] Mode: ${modeStr} | Hybrid: ${isHybridIntelligenceEnabled}`);
                        devLog('[ValidationGate] Full Report:\n', validationResult.validationReport);

                        // ========== MONTE CARLO SIMULATION ==========
                        // Run simulation if we have hybrid data and a trade setup
                        devLog('[MonteCarlo] Conditions check:', {
                            hasHybridData: !!freshHybridData,
                            hybridDataSymbol: freshHybridData?.symbol || 'none',
                            hybridData1hATR: freshHybridData?.indicators?.['1h']?.atr || 'none',
                            hasEntryPoints: !!finalAnalysis.entryPoints?.length,
                            entryPointsLength: finalAnalysis.entryPoints?.length || 0,
                            hasStopLoss: !!finalAnalysis.stopLoss,
                            stopLoss: finalAnalysis.stopLoss,
                            hasTakeProfit: !!finalAnalysis.takeProfit?.length,
                            direction: finalAnalysis.direction
                        });

                        // Run if we have entry points and stop loss (Hybrid data is optional - will use fallback ATR)
                        if (finalAnalysis.entryPoints?.length && finalAnalysis.stopLoss) {
                            // Worker-backed (async); only state setters depend on the
                            // result, so this runs off the main thread fire-and-forget.
                            runMonteCarloForSetupAsync({
                                direction: finalAnalysis.direction,
                                entryPoints: finalAnalysis.entryPoints,
                                stopLoss: finalAnalysis.stopLoss,
                                takeProfit: finalAnalysis.takeProfit
                            }, freshHybridData || {
                                // Fallback minimal hybrid data when Hybrid Intelligence is off
                                indicators: {},
                                regime: { detected: 'unknown', trendDirection: 'neutral' }
                            } as any).then(mcResult => {
                                if (!isCurrentRequest()) return;
                                if (mcResult) {
                                    setLatestMonteCarloResult(mcResult);
                                    // Also add to perAI results as the final moderator result
                                    // Uses functional update to ensure it appends to current per-AI results
                                    setPerAIMonteCarloResults(current => [
                                        ...current.filter(r => !r.isModeratorFinal), // Remove any previous moderator
                                        {
                                            provider: 'MODERATOR (Final)',
                                            result: mcResult,
                                            isModeratorFinal: true
                                        }
                                    ]);
                                    devLog(`[MonteCarlo] Simulation complete: WinRate=${mcResult.winRate}%, EV=${mcResult.expectedValue}%`);
                                } else {
                                    devLog('[MonteCarlo] Simulation returned null - insufficient trade data');
                                }
                            }).catch(mcError => {
                                console.error('[MonteCarlo] Simulation failed:', mcError);
                            });
                        } else {
                            devLog('[MonteCarlo] Skipped - missing conditions:', {
                                needsEntryPoints: !finalAnalysis.entryPoints?.length ? 'No entry points in analysis' : 'present',
                                needsStopLoss: !finalAnalysis.stopLoss ? 'No stop loss in analysis' : 'present'
                            });
                        }
                        // ========== END MONTE CARLO ==========

                        // ========== LIVE BACKTEST ==========
                        // Run backtest if we have trade history
                        devLog('[LiveBacktest] Conditions check:', {
                            loggedTradesCount: loggedTrades.length,
                            needsMinTrades: 3,
                            hasCoinName: !!finalAnalysis.coinName,
                            coinName: finalAnalysis.coinName
                        });

                        if (loggedTrades.length >= 3 && finalAnalysis.coinName) {
                            try {
                                const btResult = backtestSimilarSetups(
                                    finalAnalysis,
                                    loggedTrades,
                                    freshHybridData?.regime?.regime
                                );
                                liveBtResult = btResult ?? undefined;

                                if (btResult && btResult.totalMatches > 0) {
                                    setLatestBacktestResult(btResult);
                                    devLog(`[LiveBacktest] ✅ Found ${btResult.totalMatches} matches: WinRate=${btResult.winRate.toFixed(1)}%, EV=${btResult.expectedValue.toFixed(2)}%`);
                                } else {
                                    devLog('[LiveBacktest] ⚠️ No similar trades found in history');
                                }
                            } catch (btError) {
                                console.error('[LiveBacktest] ❌ Backtest failed:', btError);
                            }
                        } else {
                            devLog('[LiveBacktest] ⏭️ Skipped - missing conditions:', {
                                needsMoreTrades: loggedTrades.length < 3 ? `Need ${3 - loggedTrades.length} more logged trades` : '✓',
                                needsCoinName: !finalAnalysis.coinName ? 'No coin detected in analysis' : '✓'
                            });
                        }
                        // ========== END LIVE BACKTEST ==========

                    } catch (validationError) {
                        console.error('[ValidationGate] Validation failed:', validationError);
                    }
                    // Regime-conditional enforcement: the live
                    // hybrid regime flows into the strict matcher so a skill
                    // scoped to one market regime doesn't veto in another.
                    // username opts this run into enforcement telemetry.
                    Object.assign(finalAnalysis, applyNotebookSkillsToAnalysis(finalAnalysis, {
                        regime: freshHybridData?.regime?.regime,
                        username: getActiveUsername(),
                    }));
                    finalAnalysis.levelCitations = buildLevelCitations(finalAnalysis);
                    Object.assign(finalAnalysis, enforceUngroundedLevels(finalAnalysis));
                    Object.assign(finalAnalysis, applyHybridChartDrift(finalAnalysis, freshHybridData || currentHybridData));
                    // ========== SOFT AVOID RESCUE ==========
                    // One weak rule must not collapse a valid Low/Medium setup
                    // into Avoid. Floor soft Avoids back to Low (restoring the
                    // direction the veto neutralized). Model-declared Avoids,
                    // hard blockers (gate fail, ungrounded levels, R:R < 1:1,
                    // hard validation), and the Bayesian calibration Avoid cap
                    // all stay Avoid.
                    if (finalAnalysis.confidence === 'Avoid' && String(bayesianConfidenceCap ?? '').toLowerCase() !== 'avoid') {
                        rescueSoftAvoid(finalAnalysis, {
                            directionBefore: directionBeforeValidation,
                            modelDeclaredAvoid: validationAdjustedConfidence !== 'Avoid',
                        });
                    }
                    // ========== END SOFT AVOID RESCUE ==========
                    // Grade-tiered risk (Batch 2): the moderator's setup grade
                    // scales the base risk — A full, B half, C/D quarter (the
                    // no-trade guidance case). Kelly advisory rides the journaled
                    // history; the session-guard verdict is snapshotted onto the
                    // analysis so the journal records the state the moderator saw.
                    const harnessSettingsNow = getHarnessSettings();
                    const tier = gradeRiskTier(finalAnalysis.grade, harnessSettingsNow.riskPercent);
                    const guardVerdict = assessSession(loggedTradesRef.current, harnessSettingsNow.equityUsd, getSessionGuardConfig());
                    const closedTrades = loggedTradesRef.current.filter(t =>
                        t.outcome === TradeOutcome.WIN || t.outcome === TradeOutcome.LOSS);
                    const wins = closedTrades.filter(t => t.outcome === TradeOutcome.WIN);
                    const losses = closedTrades.filter(t => t.outcome === TradeOutcome.LOSS);
                    const avg = (xs: typeof closedTrades) => xs.length > 0
                        ? xs.reduce((s, t) => s + (t.pnlAmount ?? 0), 0) / xs.length
                        : 0;
                    // Losses store pnlAmount NEGATIVE (capture flow negates) —
                    // kellyAdvisory needs the payoff ratio magnitudes.
                    const kelly = kellyAdvisory(wins.length, losses.length, avg(wins), Math.abs(avg(losses)));
                    const sized = computeContractSize(
                        finalAnalysis,
                        harnessSettingsNow.equityUsd,
                        activeConversation?.leverage || DEFAULT_LEVERAGE,
                        tier.riskPercent,
                    );
                    finalAnalysis.positionSize = {
                        line: sized.line,
                        riskUsd: sized.riskUsd,
                        fraction: sized.fraction,
                        label: sized.label,
                    };
                    finalAnalysis.sessionGuard = {
                        level: guardVerdict.level,
                        summary: guardVerdict.warnings.length > 0
                            ? guardVerdict.warnings.join(' ')
                            : `Trades today: ${guardVerdict.tradesToday} · Day P&L ${guardVerdict.dayPnlUsd >= 0 ? '+' : ''}$${Math.round(guardVerdict.dayPnlUsd)}`,
                    };
                    if (kelly.line) finalAnalysis.kellyAdvisory = kelly.line;
                    // Funding carry snapshot (Batch 7): the rate the moderator
                    // saw, framed verdict-relative on the card.
                    if (typeof freshHybridData?.fundingRate === 'number') {
                        finalAnalysis.fundingRate = freshHybridData.fundingRate;
                    }
                    finalAnalysis.recommendationContract = buildRecommendationContract(finalAnalysis);
                    // ========== END VALIDATION GATE ==========

                    return recalculateAnalysisMetrics(finalAnalysis, activeConversation?.leverage || DEFAULT_LEVERAGE);
                };

                if (enabledProviders.length > 1) {
                    if (!isAutomationRun) setLoadingMessage("Thinking...");
                    completeStep('gate-scan'); startStep('analysis');
                    currentPhaseRef.current = 'analysis';
                    setAnalysisSteps(prev => prev.map(s => s.id === 'analysis' ? { ...s, title: `Analyzing with ${enabledProviders.map(p => p.name).join(', ')}` } : s));
                    setIsAnalysisInProgress(true);
                    // Clear previous Monte Carlo results for fresh analysis
                    if (!isAutomationRun) {
                        setPerAIMonteCarloResults([]);
                        setLatestMonteCarloResult(null);
                        setLatestBacktestResult(null);
                    }
                    reasoningMapRef.current = {};
                    turnReasoningRef.current = {};
                    openingTextRef.current = {};
                    activeDebateSpeakersRef.current = {};
                    liveToolEventsRef.current = {};
                    toolActionsRef.current = [];
                    const resumeSeeds = canResume && resumeTarget ? reconstructOpenings(resumeTarget.debateTurns || []) : [];
                    const useResume = resumeSeeds.filter(s => enabledProviders.some(p => p.name === s.name)).length >= 2;
                    if (useResume && resumeTarget) {
                        debateTurnsRef.current = resumeTarget.debateTurns || [];
                        debateRunLogRef.current = resumeTarget.debateRunLog || [];
                    } else {
                        debateTurnsRef.current = [];
                        debateRunLogRef.current = [];
                    }

                    // Captured before the promise map: ensemblePlaceholder is
                    // non-null for staged ensembles, but closures see the
                    // declared Message | null type.
                    const placeholderId = ensemblePlaceholder?.id ?? '';
                    // Per-analyst cost & latency ledger: measure each analyst's
                    // initial-analysis wall time + output size as they run.
                    const analystTimings = new Map<string, { durationMs: number; charsOut: number }>();
                    stopTokenUsage = subscribeTokenUsage(event => {
                        tokenByProvider.set(
                            event.providerId,
                            mergeTokenUsage(tokenByProvider.get(event.providerId) ?? emptyTokenUsage(), event.usage),
                        );
                    });
                    // Shared analysis options for the initial analysts AND any
                    // mid-debate replacement (the replacement must see the exact
                    // same prompt/images/context as the analysts it steps in for —
                    // otherwise the moderator gets an incomparable position).
                    const buildAnalystParams = (provider: { config: ProviderConfig; name: string; model: string; thoughtsKey: string }): AnalysisRequestParams => ({
                        imageSummaries: summaries,
                        chatHistory: currentMessages,
                        finalTradeSummary: enhancedFinalTradeSummary,
                        recentInsights: recentInsightsString,
                        activeFrameworks,
                        deepenAnalysis: isDeepAnalysis,
                        globalMemory: memoryToInject,
                        threadSummary: currentThreadSummary,
                        subMode: runAccuracyMode ? runAccuracySubMode : undefined,
                        customInstructions: instructionsToUse,
                        isPlaybookEnabledInPureAI,
                        isFamiliesEnabledInPureAI,
                        isMemoryEnabledInPureAI,
                        // Analyst Lens: pass role-specific prompt based on trading style.
                        // Custom overrides from the prompt editor win over built-ins.
                        // resolvedAssignments (not lensConfig.assignments): a stale
                        // persisted model id would otherwise make the role lookup
                        // return UNASSIGNED and drop the persona silently.
                        // appendLensMemoryToPrompt then prepends this seat's OWN
                        // memory file (lens/*.md) + seat extras (regime line for
                        // Macro, in-scope skill supplement) so each lens reads its
                        // own record before answering. buildPreflightBlock goes
                        // FIRST: the seat must open with DATA / SOURCE /
                        // FALSIFICATION or its claim is substituted (validated
                        // in the .then below, recorded to provider fitness).
                        rolePrompt: runLensConfig.enabled && provider.thoughtsKey
                            ? `${buildPreflightBlock()}\n\n${appendLensMemoryToPrompt(
                                `${provider.config.id}::${provider.model}`,
                                resolvedAssignments,
                                customLensPrompts?.[getRoleForProvider(`${provider.config.id}::${provider.model}`, resolvedAssignments)]
                                || getLensPromptForStyle(
                                    `${provider.config.id}::${provider.model}`,
                                    resolvedAssignments,
                                    effectiveTradingStyle
                                ),
                                { coin: finalSymbol ?? undefined, memoryQuery },
                            )}`
                            : undefined,
                        // Normal mode (Lenses off): custom base prompt override.
                        systemPromptOverride: runLensConfig.enabled ? undefined : (customEnsemblePrompt || undefined),
                        // User-uploaded strategy summaries (Settings → Strategies).
                        userStrategies: strategiesBlock || undefined,
                        // Per-seat temperature: Lenses ON → each seat has a
                        // distinct persona (prompts already differ), so keep
                        // the disciplined default. Lenses OFF → the three
                        // seats share one prompt, so a stable per-seat
                        // temperature keeps them genuinely independent
                        // instead of near-identical at 0.35.
                        temperature: runLensConfig.enabled ? undefined : seatTemperature(provider.thoughtsKey || provider.name),
                        // Streamed chain-of-thought deltas accumulate — the
                        // latest full string is pushed to the live cards.
                        onReasoning: (reasoning: string) => {
                             // Key reasoning by the SAME thoughtsKey used
                             // everywhere else (provider::model). Keying by
                             // provider.name here produced a duplicate entry
                             // per analyst — 6 rows/tabs for 3 analysts — and
                             // the name-keyed copy resolved to UNASSIGNED.
                             const reasoningKey = provider.thoughtsKey || provider.name;
                             reasoningMapRef.current[reasoningKey] = (reasoningMapRef.current[reasoningKey] || '') + reasoning;
                             if (isStagedEnsemble && provider.thoughtsKey) {
                                 // Coalesced to one update per animation frame —
                                 // per-token updates re-render the whole chat.
                                 throttledEnsembleProgress(
                                     requestConversationId,
                                     placeholderId,
                                     provider.thoughtsKey,
                                     reasoningMapRef.current[reasoningKey],
                                 );
                                 // Stream the analysis thinking into the transcript
                                 // as live round-1 turns (see throttledOpeningThinking).
                                 throttledOpeningThinking(
                                     requestConversationId,
                                     placeholderId,
                                     enabledProviders,
                                     reasoningMapRef.current,
                                     openingTextRef.current,
                                 );
                             }
                         },
                        // Visible content deltas (the answer — and any thinking the
                        // model writes directly into content — forming live). Mirrors
                        // the reasoning channel: accumulate + surface as round-1 text.
                        onPartialOutput: (chunk: string) => {
                            if (!isStagedEnsemble || !provider.thoughtsKey) return;
                            const reasoningKey = provider.thoughtsKey || provider.name;
                            openingTextRef.current[reasoningKey] = (openingTextRef.current[reasoningKey] || '') + chunk;
                            throttledOpeningThinking(
                                requestConversationId,
                                placeholderId,
                                enabledProviders,
                                reasoningMapRef.current,
                                openingTextRef.current,
                            );
                        },
                        // P5: the openings' wire labels ride the same
                        // debateRunLog the engine writes — one "budget" line
                        // per seat explaining which reasoning route applied.
                        onWireAudit: (entry: WireAuditEntry) => {
                            const event: DebateRunEvent = {
                                at: new Date().toISOString(),
                                kind: 'budget',
                                detail: `wire: ${provider.name} opening ${entry.applied ? 'applied' : 'no-op'} — ${entry.reason}`,
                            };
                            debateRunLogRef.current = [...debateRunLogRef.current, event].slice(-100);
                        },
                    });
                    const analysisPromises = enabledProviders.map((provider, analystIndex) => {
                        if (useResume) {
                            const seed = resumeSeeds.find(s => s.name === provider.name);
                            if (!seed) {
                                return Promise.reject(new Error('Resume seed missing'));
                            }
                            return Promise.resolve({
                                thoughtProcess: seed.opening,
                                finalOutput: seed.opening,
                                analysis: seed.analysis,
                            });
                        }
                        if (isStagedEnsemble) {
                            updateEnsembleProgress(progress => ({
                                ...progress,
                                analysts: progress.analysts.map(analyst => analyst.key === provider.thoughtsKey
                                    ? { ...analyst, status: 'analyzing' }
                                    : analyst),
                            }));
                        }
                        const runStartedAtMs = performance.now();
                        // Thinking-corpus exemplars: this model's own past
                        // WINNING reasoning (few-shot) — the corpus was
                        // write-only before; reading it back is what lets a
                        // deployed model improve. Non-fatal: a slow store
                        // must never delay or fail an analysis.
                        return (async () => {
                            // Thinking-corpus read starts immediately; the
                            // stagger below hides its latency for seats > 0.
                            const exemplarsPromise = getThinkingExemplars(provider.thoughtsKey || provider.config.id, 1)
                                .catch(() => []);
                            // Staggered seat launches: free-tier gateways
                            // dedupe/cache CONCURRENT near-identical requests
                            // (the three openings share ~99% of their payload
                            // once the hybrid envelope is in). Launching each
                            // seat SEAT_LAUNCH_STAGGER_MS apart breaks the
                            // simultaneous-identical window those caches key on.
                            if (analystIndex > 0) {
                                await new Promise<void>(resolve => setTimeout(resolve, SEAT_LAUNCH_STAGGER_MS * analystIndex));
                                if (currentAbortController.signal.aborted) {
                                    throw new DOMException('Analysis cancelled', 'AbortError');
                                }
                            }
                            let exemplarBlock = '';
                            try {
                                const exemplars = await exemplarsPromise;
                                if (exemplars.length > 0 && exemplars[0].reasoning.trim()) {
                                    const ex = exemplars[0];
                                    exemplarBlock = `

 **YOUR OWN PAST WINNING REASONING (EXEMPLAR — study the reasoning pattern, do not copy the numbers):**
${ex.coin ? `Setup: ${ex.coin}` : 'Setup: (similar setup)'}${ex.confidence ? ` | Confidence: ${ex.confidence}` : ''}${typeof ex.probability === 'number' ? ` | Probability: ${ex.probability}%` : ''}
> ${ex.reasoning.replace(/\n/g, '\n> ')}`;
                                }
                            } catch { /* corpus read is best-effort */ }
                            const assignedRole = getRoleForProvider(`${provider.config.id}::${provider.model}`, resolvedAssignments);
                            const envelopeKind = envelopeKindForRole(assignedRole);
                            const envelope = [
                                buildHybridEnvelope(freshHybridData, envelopeKind),
                                buildOcrEnvelope(summaries, envelopeKind),
                            ].filter(Boolean).join('\n\n');
                            // seatMandates (hoisted above) feeds the legacy
                            // rotation here when no team drives the run.
                            // Team-seat persona (G-roles): when an ACTIVE team
                            // drives the run, its seat record wins — built-in
                            // role prompt (optionally refined by trader
                            // instructions) or, with nothing set, the
                            // general-analyst default (full-scope market
                            // analysis, desk tools + web search grounded).
                            // Without an active team the legacy 3-rotation
                            // mandate stays so ad-hoc ensembles behave
                            // exactly as before.
                            const teamSeat = teamSeatFor(provider.config.id, provider.model);
                            const persona = !runLensConfig.enabled && runGroupMemberPersonas.length > 0
                                ? seatPersonaPrompt(teamSeat)
                                : `Your specialty: ${seatMandates[analystIndex % seatMandates.length]}.`;
                            // Seat differentiation lives in the SYSTEM prompt
                            // (rendered near the front by GenericAnalysisService),
                            // NOT as a suffix on the shared user message — a
                            // differing tail does not break bulk/prefix-keyed
                            // upstream prompt caches, a differing head does.
                            const seatDirective = !runLensConfig.enabled
                                ? `You are INDEPENDENT ANALYST SEAT ${analystIndex + 1} of several independent analysts looking at the same chart. Recompute it from scratch — do not copy another seat's conclusion or a stock script. ${persona} Form your own view in your own words; where your read differs from the other seats, say so explicitly.`
                                : '';
                            return runAnalyzeTradingView(
                                provider.config,
                                provider.model,
                                `${envelope ? `${envelope}\n\n` : ''}${enhancedPrompt}${exemplarBlock}`,
                                imageFiles,
                                dataURLs,
                                currentAbortController.signal,
                                { ...buildAnalystParams(provider), seatDirective: seatDirective || undefined, allowedTools: seatToolsFor(teamSeat),
                                  onToolAction: action => { toolActionsRef.current = [...toolActionsRef.current, { ...action, speaker: provider.name }].slice(-50); } },
                            );
                        })()
                                 .then(result => {
                                     analystTimings.set(provider.thoughtsKey, {
                                         durationMs: Math.round(performance.now() - runStartedAtMs),
                                         charsOut: (result.finalOutput?.length ?? 0) + (result.thoughtProcess?.length ?? 0),
                                     });
                                     // Preflight gate (lens mode): the seat's prompt
                                     // demanded DATA / SOURCE / FALSIFICATION. Validate
                                     // the opening claim; on failure substitute a NO
                                     // CLAIM placeholder so the debate argues with the
                                     // seat's actual (missing) evidence instead of a
                                     // hallucinated call, and record the outcome to
                                     // provider fitness (best-effort, never throws).
                                     let gated = result;
                                     if (runLensConfig.enabled && provider.thoughtsKey) {
                                         const gate = applyPreflightGate(result.finalOutput);
                                         void recordPreflightResult(getActiveUsername(), provider.config.id, gate.passed);
                                         if (!gate.passed) {
                                             gated = { ...result, finalOutput: gate.output };
                                         }
                                     }
                                     if (isStagedEnsemble) {
                                         const split = splitThinkingFromOutput(
                                             reasoningMapRef.current[provider.thoughtsKey || provider.name] || gated.thoughtProcess || '',
                                             gated.finalOutput || '',
                                         );
                                         updateEnsembleProgress(progress => ({
                                             ...progress,
                                             analysts: progress.analysts.map(analyst => analyst.key === provider.thoughtsKey
                                                 ? {
                                                     ...analyst,
                                                     status: 'complete',
                                                     finalOutput: split.output,
                                                     thoughtProcess: split.thinking || gated.thoughtProcess,
                                                     reasoning: split.thinking,
                                                 }
                                                 : analyst),
                                         }));
                                     }
                                     return gated;
                                 })
                                 .catch((err: any) => {
                                     const errorMsg = err instanceof Error ? err.message : String(err);
                                     if (isStagedEnsemble) {
                                         updateEnsembleProgress(progress => ({
                                             ...progress,
                                             analysts: progress.analysts.map(analyst => analyst.key === provider.thoughtsKey
                                                 ? { ...analyst, status: 'error', error: errorMsg }
                                                 : analyst),
                                         }));
                                     }
                                     throw err;
                                 });
                    });

                    const settledResults = await Promise.allSettled(analysisPromises);
                    if (!isCurrentRequest()) assertCurrentRequest();
                    // Commit the last opening-phase frame before the message
                    // changes ownership from the analyst progress view to the
                    // debate view. The snapshot below is still built from the
                    // refs because React state updates are asynchronous.
                    throttledOpeningThinking.flush();
                    if (isStagedEnsemble) {
                        updateEnsembleProgress(progress => ({
                                ...progress,
                                moderator: { status: 'reviewing' },
                        }));
                    }
                    setLoadingMessage(null);
                    completeStep('analysis');

                    // Log analysts that failed; downstream consumers iterate
                    // settledResults ALIGNED BY ORIGINAL PROVIDER INDEX so a
                    // failed analyst can never shift another provider's data.
                    // (The old re-indexed `results` array caused exactly that.)
                    settledResults.forEach((settled, index) => {
                        if (settled.status === 'rejected') {
                                console.warn(`[Ensemble] Analyst "${enabledProviders[index]?.name || `#${index}`}" failed:`, settled.reason);
                        }
                    });

                    // Duplicate-generation guard: near-identical openings across
                    // two different models mean an upstream gateway served ONE
                    // generation to several seats (free-tier routers dedupe/
                    // cache concurrent near-identical prompts). Surface it —
                    // the "debate" would otherwise argue with its own echo.
                    const duplicatePairs = findDuplicateAnalystOutputs(
                        settledResults.map((settled, index): AnalystOutputSample => ({
                            name: enabledProviders[index]?.name || `Seat ${index + 1}`,
                            model: enabledProviders[index]?.model || '',
                            finalOutput: settled.status === 'fulfilled' ? settled.value.finalOutput : undefined,
                            thoughtProcess: settled.status === 'fulfilled' ? settled.value.thoughtProcess : undefined,
                        })),
                    );
                    if (duplicatePairs.length > 0) {
                        console.warn(`[Ensemble] Upstream duplicated generations across seats:\n${duplicatePairs.join('\n')}`);
                        if (!isAutomationRun) {
                            toast.warning(
                                'Duplicated analyst generations',
                                `The provider returned the same text to multiple seats (${duplicatePairs[0]}). Its free tier is collapsing near-identical requests — results may not be independent.`,
                            );
                        }
                    }

                    // Keep the opening trace visible when the debate object is
                    // created. Previously this handoff replaced the staged
                    // placeholder with `debateTurns: []`, which erased the
                    // live opening thinking/output immediately before the real
                    // debate stream began.
                    const openingTurns: DebateTurn[] = settledResults
                        .map((settled, index): DebateTurn | null => {
                            if (settled.status !== 'fulfilled') return null;
                            const provider = enabledProviders[index];
                            const key = provider.thoughtsKey || provider.name;
                            const streamedThinking = reasoningMapRef.current[key] || settled.value.thoughtProcess || '';
                            const streamedOutput = openingTextRef.current[key] || '';
                            const rawOutput = settled.value.finalOutput || streamedOutput;
                            const split = splitThinkingFromOutput(streamedThinking, rawOutput);
                            const text = split.output || streamedOutput.trim();
                            const reasoning = split.thinking || streamedThinking;
                            if (!text.trim() && !reasoning.trim()) return null;
                            return {
                                speaker: provider.name,
                                round: 1,
                                text,
                                reasoning,
                                createdAt: new Date().toISOString(),
                            };
                        })
                        .filter((turn): turn is DebateTurn => Boolean(turn));

                    const thoughtMap: Record<string, string> = {};
                    // P1-6 (pre-existing fix): iterate settledResults, NOT the
                    // re-indexed `results` array — otherwise a failed provider
                    // at index 0 would cause results[0] (actually provider #1's
                    // data) to be attributed to enabledProviders[0].thoughtsKey.
                    settledResults.forEach((settled, index) => {
                        if (settled.status === 'fulfilled') {
                                const providerKey = enabledProviders[index].thoughtsKey;
                                thoughtMap[providerKey] = settled.value.thoughtProcess;
                        }
                    });

                    // ========== PER-AI MONTE CARLO ==========
                    // Run Monte Carlo on each AI's proposed setup BEFORE moderation
                    const perAIMC: LabeledMonteCarloResult[] = [];
                    const hybridDataForMC = freshHybridData || {
                        indicators: {},
                        regime: { detected: 'unknown', trendDirection: 'neutral' }
                    } as any;

                    // Align per-analyst Monte Carlo by settled-result index (NOT
                    // the re-indexed `results` array): if an analyst at index 0
                    // fails, results[0] would be provider #1's data labeled as
                    // provider #0. Same bug class as the P1-6 thoughtMap fix.
                    // Runs off the main thread via a Web Worker (with a
                    // synchronous fallback) so 1000 simulations per analyst
                    // never block the debate UI.
                    for (const [index, settled] of settledResults.entries()) {
                        if (!isCurrentRequest()) assertCurrentRequest();
                        if (settled.status !== 'fulfilled') continue; // failed analyst has no analysis
                        const providerName = enabledProviders[index]?.name || `Unknown-${index}`;
                        const analysis = settled.value?.analysis;

                        devLog(`[PerAI-MonteCarlo] Checking ${providerName}...`);

                        if (!analysis) {
                                console.warn(`[PerAI-MonteCarlo] ${providerName} - Missing analysis object`);
                                continue;
                        }

                        // Validate specific fields
                        const hasEntry = analysis.entryPoints && analysis.entryPoints.length > 0;
                        const hasSL = !!analysis.stopLoss;
                        const hasTP = analysis.takeProfit && analysis.takeProfit.length > 0;

                        if (hasEntry && hasSL && hasTP) {
                                try {
                                    const mcResult = await runMonteCarloForSetupAsync({
                                        direction: analysis.direction,
                                        entryPoints: analysis.entryPoints,
                                        stopLoss: analysis.stopLoss,
                                        takeProfit: analysis.takeProfit
                                    }, hybridDataForMC);

                                    if (!isCurrentRequest()) assertCurrentRequest();
                                    if (mcResult) {
                                        perAIMC.push({
                                            provider: providerName,
                                            result: mcResult,
                                            isModeratorFinal: false
                                        });
                                        devLog(`[PerAI-MonteCarlo] ${providerName}: Success (WinRate=${mcResult.winRate}%)`);
                                    }
                                } catch (err) {
                                    // A user cancel must abort the whole run, not
                                    // just this simulation — swallowing it wrote
                                    // partial post-cancel state (per-AI results +
                                    // an isDebating placeholder) before the debate
                                    // loop noticed the aborted signal.
                                    if ((err as { name?: string })?.name === 'AbortError') throw err;
                                    console.error(`[PerAI-MonteCarlo] ${providerName} failed execution:`, err);
                                }
                        } else {
                                console.warn(`[PerAI-MonteCarlo] ${providerName} - Skipped (Missing components: Entry=${hasEntry}, SL=${hasSL}, TP=${hasTP})`);
                        }
                    }

                    // Store per-AI Monte Carlo results
                    if (perAIMC.length > 0) {
                        setPerAIMonteCarloResults(perAIMC);
                        devLog(`[PerAI-MonteCarlo] Completed ${perAIMC.length} simulations`);
                    }
                    // ========== END PER-AI MONTE CARLO ==========

                    const debateMessageId = ensemblePlaceholder?.id || `debate-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
                    const debatePlaceholder: Message = {
                        ...(ensemblePlaceholder || {
                                id: debateMessageId,
                                role: MessageRole.AI,
                                text: '',
                                createdAt: new Date().toISOString(),
                        }),
                        isDebating: true,
                        debateTurns: useResume && resumeTarget
                            ? (resumeTarget.debateTurns || [])
                            : openingTurns,
                        // Non-staged runs never carried modelsUsed — the chat's
                        // per-bubble model line was blank for them.
                        modelsUsed: ensemblePlaceholder?.modelsUsed
                                || buildModelsUsedRecord(enabledProviders),
                        thoughtProcesses: { ...(ensemblePlaceholder?.thoughtProcesses || {}), ...thoughtMap },
                        reasoningProcesses: { ...(ensemblePlaceholder?.reasoningProcesses || {}), ...reasoningMapRef.current },
                        activeDebateSpeakers: {},
                        memoryRetrieved,
                    };

                    updateRequestMessages(prev => ensemblePlaceholder
                        ? prev.map(message => message.id === debateMessageId ? debatePlaceholder : message)
                        : [...prev, debatePlaceholder]);
                    startStep('debate');
                    currentPhaseRef.current = 'debate';

                    // --- ENSEMBLE ROUTING ---
                    let debateStream;
                    // Assigned in the standard-mode branch below: rebuilds the
                    // visible turns from the accumulated lanes (text AND
                    // thinking) and flushes them to the message. Reasoning
                    // callbacks invoke it so thinking-only turns appear live —
                    // before a seat's first output delta. Null in accuracy mode.
                    const rebuildDebateTurnsRef: { current: (() => void) | null } = { current: null };

                    const activeModModel = moderatorModel;

                    // STRICT ALL-OR-NOTHING GATE — a debate with a missing seat
                    // is not a debate: rebuttals answer specific arguments, so
                    // one dropped analyst poisons the whole transcript. The old
                    // behavior silently continued with whoever survived and let
                    // only the <2 guard catch total collapse. Now ANY failure
                    // aborts before the moderator is invoked, with the per-seat
                    // reason surfaced in the chat bubble.
                    const failedAnalysts = settledResults
                        .map((settled, i) => ({ settled, provider: enabledProviders[i] }))
                        .filter((x): x is { settled: PromiseRejectedResult; provider: NonNullable<typeof enabledProviders[number]> } => x.settled.status === 'rejected');
                    if (failedAnalysts.length > 0) {
                        const reasons = failedAnalysts.map(({ settled, provider }) =>
                            `• ${provider?.name || 'Unknown seat'}: ${String((settled as PromiseRejectedResult).reason?.message || (settled as PromiseRejectedResult).reason || 'unknown error')}`
                        ).join('\n');
                        throw new Error(
                            `Debate aborted: ${failedAnalysts.length} of ${enabledProviders.length} analysts failed to deliver an opening. All seats must be working for the debate to run.\n${reasons}`
                        );
                    }
                    // Align analysts with their results by ticker index. The
                    // re-indexed `results` array shifts when an analyst fails,
                    // silently mislabeling provider #2's analysis as #1's (and
                    // passing `undefined` when fewer analysts succeed than the
                    // enabledProviders count — crashing the n-way debaters).
                    // With the strict gate above this list always matches
                    // enabledProviders 1:1.
                    const fulfilledAnalysts = settledResults
                        .map((settled, i) => settled.status === 'fulfilled' ? { provider: enabledProviders[i], result: settled.value } : null)
                        .filter((x): x is { provider: (typeof enabledProviders)[number]; result: { thoughtProcess: string; finalOutput: string; analysis: any } } => x !== null);
                    // Mutable superset of fulfilledAnalysts: a mid-debate
                    // replacement analyst is appended here so the run ledger,
                    // the consensus explainability panel, and the analyst count
                    // reflect everyone who actually delivered, not just the
                    // initial roster.
                    const allFulfilledAnalysts: ensembleService.RealDebateAnalyst[] = [...fulfilledAnalysts];

                    // PATTERN-MEMORY GATE (visibility + enforcement) — the
                    // HALT/REDUCE_SIZE/WARNING check only ever ran inside the
                    // legacy 3-way generator: invisible to the user and absent
                    // from the live debate paths. Run it here — surface the
                    // outcome on the card AND fold the enforcement text into
                    // the moderator's learning context so live debates enforce
                    // it the same way the legacy path did.
                    let patternMemoryGate: PatternMemoryGateView | null = null;
                    const gateSource = fulfilledAnalysts[0]?.result;
                    if (gateSource?.analysis && loggedTrades.length > 0) {
                        try {
                            const gateSetupContext = {
                                coin: gateSource.analysis.coinName,
                                direction: gateSource.analysis.direction as 'Long' | 'Short' | undefined,
                                pattern: gateSource.analysis.marketConditions?.pattern,
                                family: gateSource.analysis.detectedPatternFamily || undefined,
                                confidence: gateSource.analysis.confidence as 'High' | 'Medium' | 'Low' | undefined,
                            };
                            const gate = generateMandatoryPatternCheck(gateSetupContext, loggedTrades);
                            if (gate.gateResult !== 'PASS') {
                                patternMemoryGate = {
                                    gateResult: gate.gateResult,
                                    reason: gate.reason,
                                    mandatoryQuestions: gate.mandatoryQuestions,
                                    historicalFailures: gate.historicalFailures.map(t => ({
                                        coinName: t.coin,
                                        direction: t.direction,
                                        outcome: t.outcome,
                                        keyLesson: t.keyLesson,
                                    })),
                                };
                                const enforcementText = generatePatternMemoryEnforcementContext(gateSetupContext, loggedTrades);
                                moderatorLearningContext = moderatorLearningContext
                                    ? `${moderatorLearningContext}\n\n${enforcementText}`
                                    : enforcementText;
                                updateRequestMessages(prev => prev.map(m =>
                                    (m.id === debateMessageId || m.id === ensemblePlaceholder?.id)
                                        ? { ...m, patternMemoryGate: patternMemoryGate! }
                                        : m
                                ));
                            }
                        } catch (gateError) {
                            console.warn('[Pipeline] Pattern memory gate failed:', gateError);
                            // Fail-open, but never silently — enforcement is
                            // weaker this run and the user should know.
                            if (!isAutomationRun) {
                                toast.warning('Pattern-memory gate skipped', 'Historical-failure enforcement could not run for this debate.');
                            }
                        }
                    }

                    const skillVetoMeta = confirmedAvoidForSetup({
                        coin: fulfilledAnalysts[0]?.result?.analysis?.coinName || finalSymbol,
                        direction: fulfilledAnalysts[0]?.result?.analysis?.direction,
                        family: fulfilledAnalysts[0]?.result?.analysis?.detectedPatternFamily,
                        pattern: fulfilledAnalysts[0]?.result?.analysis?.marketConditions?.pattern,
                        // Regime-conditional enforcement.
                        regime: freshHybridData?.regime?.regime,
                    });
                    const skillVeto = skillVetoMeta ? titleFromMeta(skillVetoMeta) : undefined;

                    // ── Veto falsification ledger ──
                    // A vetoed setup produces no trade outcome, so an avoid
                    // skill can never be refuted by evidence. Build the veto
                    // record now (the blocked setup's TP/SL targets come from
                    // the analyst's preliminary plan) but DEFER the stamp to
                    // the verdict commit below — only a verdict that actually
                    // stays blocked belongs in the ledger. If the floor defies
                    // the veto end-to-end and ships an actionable Long/Short,
                    // nothing was blocked and the trade takes the normal
                    // evidence path instead of a phantom ledger entry.
                    let vetoRecordParams: Parameters<typeof VetoLedgerService.recordVeto>[0] | null = null;
                    if (skillVetoMeta) {
                        const vetoAnalysis = fulfilledAnalysts[0]?.result?.analysis;
                        // Key the ledger by the skill's REAL file name — a
                        // title-derived slug drifts from fileNameFromMeta's
                        // [coin, direction, family, kind] ordering and would
                        // never match the file the dashboard links to.
                        const vetoSkillName = skillFileNameFor(skillVetoMeta)
                            ?? `${slugifyName([
                                skillVetoMeta.coin,
                                skillVetoMeta.direction,
                                skillVetoMeta.family,
                                skillVetoMeta.kind,
                            ].filter(Boolean).join(' ')) || 'skill'}.md`;
                        vetoRecordParams = {
                            username: getActiveUsername(),
                            skill: skillVetoMeta,
                            skillName: vetoSkillName,
                            coinName: vetoAnalysis?.coinName || finalSymbol,
                            direction: vetoAnalysis?.direction === 'Long' || vetoAnalysis?.direction === 'Short'
                                ? vetoAnalysis.direction
                                : 'Neutral',
                            entryPrice: parseFloat(String(vetoAnalysis?.entryPoints?.[0]?.price ?? '').replace(/[^0-9.]/g, '')) || 0,
                            takeProfits: (vetoAnalysis?.takeProfit ?? []).map((t: { price: number | string }) => ({
                                price: parseFloat(String(t.price).replace(/[^0-9.]/g, '')) || 0,
                            })).filter((t: { price: number }) => t.price > 0),
                            stopLoss: parseFloat(String(vetoAnalysis?.stopLoss ?? '').replace(/[^0-9.]/g, '')) || 0,
                            regime: freshHybridData?.regime?.regime,
                            reason: titleFromMeta(skillVetoMeta),
                        };
                    }

                    if (runAccuracyMode) {
                        // ACCURACY MODE — the moderator autoplays the whole
                        // simulated transcript. Guard: with zero fulfilled
                        // analysts the moderator would be invoked with an
                        // empty analyst list and fabricate a Neutral card
                        // (standard mode has the ≥2 guard; this one was missing).
                        if (fulfilledAnalysts.length < 1) {
                                const failureReport = buildAnalystFailureReport(settledResults, enabledProviders);
                                const detail = failureReport
                                    ? `\n\nFailed analysts:\n${failureReport}`
                                    : '\n\nNo analyst succeeded. Enable at least one model (Settings → AI Models or the Debate Models picker) to run the debate.';
                                throw new Error(`Accuracy-mode debate requires at least 1 analyst (${fulfilledAnalysts.length} provided).${detail}`);
                        }
                        debateStream = ensembleService.conductDebate(
                                fulfilledAnalysts.map(a => a.result),
                                fulfilledAnalysts.map(a => a.provider.name),
                                enhancedPrompt,
                                finalTradeSummary,
                                runAccuracySubMode,
                                instructionsToUse,
                                runModeratorConfig,
                                runModeratorModel,
                                isFamiliesEnabledInPureAI,
                                isMemoryEnabledInPureAI,
                                capturedGateResult, // Gate result for reconciliation (local, not stale state)
                                tradeSummaries, // Recent Insights
                                moderatorLearningContext, // Unified learning context for moderator
                                currentAbortController.signal, // Cancellation for the moderator stream
                                (reasoning: string) => {
                                    // Streamed moderator chain-of-thought accumulates
                                    // (deltas replace nothing — they append).
                                    reasoningMapRef.current.moderator = (reasoningMapRef.current.moderator || '') + reasoning;
                                    reasoningMapRef.current.Moderator = reasoningMapRef.current.moderator;
                                    thoughtMap.moderator = reasoningMapRef.current.moderator;
                                    // Accuracy/autoplay has no per-speaker
                                    // status callback. Push the global
                                    // moderator trace immediately so the Floor
                                    // and the debate floor can show thinking before
                                    // the transcript parser sees public text.
                                    throttledDebateUpdate(
                                        requestConversationId,
                                        debateMessageId,
                                        debateTurnsRef.current,
                                        thoughtMap,
                                        reasoningMapRef.current,
                                        activeDebateSpeakersRef.current, runContractFor(),
                                    );
                                },
                                // Provider IDs for Bayesian calibration (keyed by id)
                                fulfilledAnalysts.map(a => a.provider.config.id),
                                // Full chart/pattern context + user strategies —
                                // the moderator sees the same chart the analysts see.
                                moderatorContextBundle,
                                // Analyst Lens config — the accuracy-mode
                                // moderator previously got NO role context
                                // (lenses silently inert in accuracy mode).
                                // Assignments are resolved so stale model ids
                                // still resolve to the right persona.
                                runLensConfig.enabled ? { ...runLensConfig, assignments: resolvedAssignments } : undefined,
                                // R54: model side-effects — same ledger as standard mode.
                                { onToolAction: action => { toolActionsRef.current = [...toolActionsRef.current, action].slice(-50); } },
                        );
                    } else {
                        // STANDARD MODE — REAL inter-model debate. Each analyst
                        // is re-invoked on its own provider for the rebuttal
                        // rounds; only the moderator produces the JSON plan.
                        if (fulfilledAnalysts.length < 2) {
                                // Enrich the bare engine error with the per-analyst
                                // failure reasons (or the enabled count) so the user
                                // can see exactly why the debate could not start
                                // instead of a cryptic "1 provided".
                                const failureReport = buildAnalystFailureReport(settledResults, enabledProviders);
                                const detail = failureReport
                                    ? `\n\nFailed analysts:\n${failureReport}`
                                    : `\n\nOnly ${fulfilledAnalysts.length} analyst${fulfilledAnalysts.length === 1 ? ' was' : 's were'} enabled and all of them succeeded. Enable at least 2 models (Settings → AI Models or the Debate Models picker) to run the debate.`;
                                throw new Error(`Real debate requires at least 2 analysts (${fulfilledAnalysts.length} provided).${detail}`);
                        }
                        // Mid-debate replacement: the generator suspends after an
                        // analyst drops; the UI shows the offer banner and the
                        // user's pick (or skip) settles this promise. The fresh
                        // analyst runs with the exact same options as the initial
                        // roster and joins the remaining debate.
                        const requestReplacement = async (
                            droppedName: string,
                            round: number,
                        ): Promise<ensembleService.RealDebateAnalyst | null> => {
                            // Candidates: every ready provider except the ones
                            // already in this debate (initial + dropped +
                            // already-replaced) and the moderator.
                            const usedProviderIds = new Set<string>();
                            for (const a of allFulfilledAnalysts) usedProviderIds.add(a.provider.config.id);
                            usedProviderIds.add(runModeratorConfig.id);
                            let replacementPool = providerConfigs
                                .filter(p => p.isEnabled !== false && !usedProviderIds.has(p.id) && (p.selectedModel || p.models?.[0]));
                            // Fittest first: outcome record + preflight pass
                            // rate order the offer, so the user's top pick is
                            // the provider with the best recent evidence.
                            try {
                                replacementPool = await sortByFitness(replacementPool, getActiveUsername());
                            } catch { /* fitness read is best-effort */ }
                            const candidates = replacementPool
                                .map(p => ({
                                    providerId: p.id,
                                    displayName: p.name,
                                    modelId: p.selectedModel || p.models?.[0] || '',
                                }));
                            if (candidates.length === 0) return null;

                            const offer: ReplacementOffer = { droppedName, round, candidates };
                            updateRequestMessages(prev => prev.map(m => m.id === debateMessageId ? { ...m, replacementOffer: offer } : m));

                            // Suspend until the user picks a candidate or skips
                            // (bounded by the generator's replacement timeout;
                            // a user cancel aborts the whole debate).
                            const choice = await new Promise<string | null>((resolve) => {
                                replacementChoiceRef.current = { messageId: debateMessageId, resolve };
                            });
                            if (choice) {
                                updateRequestMessages(prev => prev.map(m => m.id === debateMessageId
                                    ? { ...m, replacementOffer: { ...offer, chosenProviderId: choice } }
                                    : m));
                            } else {
                                updateRequestMessages(prev => prev.map(m => m.id === debateMessageId ? { ...m, replacementOffer: undefined } : m));
                            }
                            if (!choice) return null;

                            const candidate = providerConfigs.find(p => p.id === choice);
                            if (!candidate) return null;
                            const model = candidate.selectedModel || candidate.models?.[0] || '';
                            const replacementProvider = { config: candidate, name: candidate.name, model, thoughtsKey: `${candidate.id}:${model}` };
                            // The replacement STEPS INTO the dropped seat: it
                            // runs with that seat's persona (team role /
                            // instructions) and tool scope so the debate
                            // keeps a comparable position. Without an active
                            // team, fall back to the legacy mandate rotation.
                            const dropped = allFulfilledAnalysts.find(a => a.provider.name === droppedName);
                            const droppedSeat = dropped ? teamSeatFor(dropped.provider.config.id, dropped.provider.model) : undefined;
                            const seatIdx = dropped
                                ? enabledProviders.findIndex(p => p.config.id === dropped.provider.config.id && p.model === dropped.provider.model)
                                : -1;
                            const replacementSeatDirective = !runLensConfig.enabled
                                ? `You are INDEPENDENT ANALYST SEAT ${seatIdx >= 0 ? seatIdx + 1 : enabledProviders.length + 1} of several independent analysts looking at the same chart. Recompute it from scratch — do not copy another seat's conclusion or a stock script. ${!runLensConfig.enabled && runGroupMemberPersonas.length > 0 ? seatPersonaPrompt(droppedSeat) : `Your specialty: ${seatMandates[seatIdx >= 0 ? seatIdx % seatMandates.length : 0]}.`} Form your own view in your own words; where your read differs from the other seats, say so explicitly.`
                                : undefined;
                            const runStartedAtMs = performance.now();
                            const result = await runAnalyzeTradingView(
                                candidate,
                                model,
                                enhancedPrompt,
                                imageFiles,
                                dataURLs,
                                currentAbortController.signal,
                                { ...buildAnalystParams(replacementProvider), seatDirective: replacementSeatDirective, allowedTools: seatToolsFor(droppedSeat) },
                            );
                            analystTimings.set(replacementProvider.thoughtsKey, {
                                durationMs: Math.round(performance.now() - runStartedAtMs),
                                charsOut: (result.finalOutput?.length ?? 0) + (result.thoughtProcess?.length ?? 0),
                            });
                            const record: ensembleService.RealDebateAnalyst = {
                                provider: replacementProvider,
                                result: {
                                    thoughtProcess: result.thoughtProcess,
                                    finalOutput: result.finalOutput || '',
                                    analysis: result.analysis,
                                },
                            };
                            allFulfilledAnalysts.push(record);
                            // Persona follows the floor slot: the replacement
                            // inherits the dropped seat's persona under its
                            // OWN name (the engine keys personas by seat name,
                            // and the replacement keeps the name it joined with).
                            if (seatPersonasBySeatName && droppedSeat) {
                                seatPersonasBySeatName[replacementProvider.name] =
                                    seatPersonasBySeatName[droppedName]
                                    ?? `You are INDEPENDENT ANALYST SEAT ${seatIdx >= 0 ? seatIdx + 1 : enabledProviders.length + 1} of ${enabledProviders.length}. ${seatPersonaPrompt(droppedSeat)}`;
                            }
                            // Model line for the replacement's transcript
                            // bubbles — keyed by thoughtsKey so a replacement
                            // sharing the dropped analyst's provider cannot
                            // overwrite the original's attribution.
                            updateRequestMessages(prev => prev.map(m => m.id === debateMessageId
                                ? { ...m, modelsUsed: { ...m.modelsUsed, [replacementProvider.thoughtsKey]: model } }
                                : m));
                            return record;
                        };
                        // Per-bot prompt/tool overrides + centralized market snapshot for the debate.
                        let botByThoughtsKey: Record<string, import('../types/bot').HermesBot> | undefined;
                        let centralizedSnapshot: string | undefined;
                        // Team-seat personas keyed by SEAT NAME (the engine's
                        // roster key — thoughtsKey would miss a replacement).
                        // Mutable: a mid-debate replacement registers under
                        // its own name, inheriting the dropped seat's persona.
                        const seatPersonasBySeatName: Record<string, string> | undefined =
                            !runLensConfig.enabled && runGroupMemberPersonas.length > 0
                                ? Object.fromEntries(enabledProviders.map((p, i) => {
                                      const seat = teamSeatFor(p.config.id, p.model);
                                      // Unroled seats rotate a focus dimension so
                                      // N general seats diverge instead of echoing.
                                      const persona = seat?.role || (seat?.customPrompt ?? '').trim()
                                          ? seatPersonaPrompt(seat)
                                          : `${seatPersonaPrompt(seat)}\n\n${generalSeatMandate(i)}`;
                                      return [p.name, `You are INDEPENDENT ANALYST SEAT ${i + 1} of ${enabledProviders.length}. ${persona}`];
                                  }))
                                : undefined;
                        try {
                            const bots = await BotRegistry.list();
                            if (bots.length > 0) {
                                botByThoughtsKey = {};
                                for (const p of fulfilledAnalysts) {
                                    const match = bots.find(b => b.providerId === p.provider.config.id && b.model === p.provider.model)
                                        || bots.find(b => b.providerId === p.provider.config.id);
                                    if (match) botByThoughtsKey[p.provider.thoughtsKey] = match;
                                }
                                if (Object.keys(botByThoughtsKey).length === 0) botByThoughtsKey = undefined;
                            }
                        } catch { /* best-effort */ }
                        if (hybridDataInjection) {
                            centralizedSnapshot = hybridDataInjection.slice(0, 2400);
                        } else if (freshHybridData) {
                            try {
                                const { generateHybridPromptInjection } = await import('../services/analysis/HybridIntelligenceService');
                                centralizedSnapshot = generateHybridPromptInjection(freshHybridData as any).slice(0, 2400);
                            } catch { /* ignore */ }
                        }
                        // The protocol lane is hashed from THIS
                        // setup's identity — identical trade ideas always run
                        // the same debate structure, so verdicts stay
                        // comparable across reruns. Unseeded engine calls
                        // (tests) deterministically take the control lane.
                        ensembleService.setProtocolSeed(
                            `${finalSymbol || 'unknown'}|${enhancedPrompt.slice(0, 200)}|${fulfilledAnalysts.map(a => a.provider.name).join(',')}`,
                        );
                        debateStream = ensembleService.conductRealDebate(
                                fulfilledAnalysts.map(a => ({
                                    provider: a.provider,
                                    result: a.result,
                                })),
                                enhancedPrompt,
                                finalTradeSummary,
                                runModeratorConfig,
                                runModeratorModel,
                                instructionsToUse,
                                perAIMC,   // monteCarloResults
                                runLensConfig.enabled ? { ...runLensConfig, assignments: resolvedAssignments } : undefined, // lensConfig (resolved)
                                runLensConfig.enabled ? fulfilledAnalysts.map(a => a.provider.config.id) : undefined, // analystProviders
                                activeFrameworks, // playbook
                                tradeSummaries, // recent insights for pattern matching
                                capturedGateResult, // Gate result (current run, not stale state)
                                moderatorLearningContext, // Unified learning context for moderator
                                currentAbortController.signal, // Cancellation for the moderator stream
                                (reasoning: string) => {
                                    // Streamed moderator chain-of-thought accumulates
                                    // (deltas replace nothing — they append).
                                    reasoningMapRef.current.moderator = (reasoningMapRef.current.moderator || '') + reasoning;
                                    reasoningMapRef.current.Moderator = reasoningMapRef.current.moderator;
                                    thoughtMap.moderator = reasoningMapRef.current.moderator;
                                    // Push immediately (rAF-coalesced) so the Floor
                                    // shows the moderator THINKING live — before the
                                    // first visible text delta lands. Previously this
                                    // only flushed when a turn text chunk arrived.
                                    throttledDebateUpdate(
                                        requestConversationId,
                                        debateMessageId,
                                        debateTurnsRef.current,
                                        thoughtMap,
                                        reasoningMapRef.current,
                                        activeDebateSpeakersRef.current, runContractFor(),
                                    );
                            },
                            (speaker: string, reasoning: string, round?: number) => {
                                // Rebuttal and clarification reasoning is keyed by speaker
                                // so the debate chat can show it live. Deltas ACCUMULATE
                                // (same as the analyst/moderator callbacks) — replacing
                                // wiped everything but the last delta of the last round.
                                // The moderator's GLOBAL channel (.moderator / .Moderator)
                                // is owned by the moderator callback above — it mirrors the
                                // full accumulated trace, so appending here too would
                                // double-count every chunk. Analysts keep accumulating.
                                if (speaker !== 'Moderator') {
                                    reasoningMapRef.current[speaker] = (reasoningMapRef.current[speaker] || '') + reasoning;
                                }
                                if (round && round > 0) {
                                    const key = `${round}::${speaker}`;
                                    turnReasoningRef.current[key] = (turnReasoningRef.current[key] || '') + reasoning;
                                }
                                if (rebuildDebateTurnsRef.current) {
                                    // Rebuild the lanes — this CREATES thinking-only
                                    // turns before any output text exists — then flush
                                    // (rAF-coalesced), so thinking streams live.
                                    rebuildDebateTurnsRef.current();
                                } else {
                                    throttledDebateUpdate(
                                        requestConversationId,
                                        debateMessageId,
                                        debateTurnsRef.current,
                                        thoughtMap,
                                        reasoningMapRef.current,
                                        activeDebateSpeakersRef.current, runContractFor(),
                                    );
                                }
                            },
                            (speaker: string, round: number, active: boolean) => {
                                if (active) {
                                    activeDebateSpeakersRef.current[speaker] = round;
                                } else if (activeDebateSpeakersRef.current[speaker] === round) {
                                    delete activeDebateSpeakersRef.current[speaker];
                                }
                                throttledDebateUpdate(
                                    requestConversationId,
                                    debateMessageId,
                                    debateTurnsRef.current,
                                    thoughtMap,
                                    reasoningMapRef.current,
                                    activeDebateSpeakersRef.current, runContractFor(),
                                );
                            },
                            // Full chart/pattern context + user strategies —
                            // the moderator sees the same chart the analysts see.
                            moderatorContextBundle,
                            undefined, // timeoutMs (debate budget is engine-defaulted)
                            requestReplacement,
                            undefined, // replacementTimeoutMs (engine-defaulted)
                            // Live-price refresh between rounds: the debate
                            // re-anchors each round on TODAY's price (from the
                            // live feed's cache — zero extra network calls).
                            // Null symbol / unknown price → graceful no-op.
                            () => (finalSymbol ? PriceAlertService.getCurrentPrice(finalSymbol) ?? null : null),
                            () => {
                                const notes = steeringQueueRef.current;
                                steeringQueueRef.current = [];
                                setSteeringNotes([]);
                                return notes.join('\n');
                            },
                            // Per-seat steering: notes addressed to one seat
                            // ("@Technical …") ride only that seat's prompt.
                            (seatName: string) => {
                                const note = seatSteeringRef.current[seatName];
                                if (!note) return '';
                                delete seatSteeringRef.current[seatName];
                                return note;
                            },
                            // Per-seat stop: benched seats leave at the next
                            // round boundary; the debate continues without them.
                            (seatName: string) => stoppedSeatsRef.current.has(seatName),
                            (event) => {
                                debateRunLogRef.current = [...debateRunLogRef.current, event].slice(-100);
                            },
                            patternMemoryGate || skillVeto
                                ? { ...(patternMemoryGate ?? {}), skillVeto }
                                : null,
                            useResume && resumeTarget ? {
                                lastCompletedRound: resumeTarget.debateCheckpoint?.lastCompletedRound
                                    || lastCompletedRound(resumeTarget.debateTurns || [], resumeTarget.debateCheckpoint?.analystNames),
                                seedRoundTexts: debateTurnsToRoundTexts(resumeTarget.debateTurns || []),
                                laneDrafts: resumeTarget.debateCheckpoint?.laneDrafts,
                            } : undefined,
                            () => {
                                const cap = getHarnessSettings().debateCostCapUsd;
                                if (cap <= 0) return false;
                                let spent = 0;
                                for (const [id, usage] of tokenByProvider) {
                                    const cfg = providerConfigs.find(p => p.id === id);
                                    spent += estimateCostUsd(usage, {
                                        inputUsdPer1k: cfg?.inputUsdPer1k,
                                        outputUsdPer1k: cfg?.outputUsdPer1k,
                                    }) ?? 0;
                                }
                                return spent >= cap;
                            },
                            // Live desk-tool chips — the Floor shows what each
                            // seat is looking up instead of a silent bot.
                            // Keep a short ROLLING FEED per seat
                            // (newest first, capped) so the side panel can
                            // render stacked tool rows instead of
                            // a single overwriting chip.
                            // Each line carries a wall-clock prefix
                            // (HH:MM:SS) so the panel rows can render an
                            // elapsed/when stamp per row.
                            (speaker: string, _round: number, line: string) => {
                                const stamp = new Date().toLocaleTimeString([], { hour12: false });
                                const stamped = `${stamp} · ${line}`;
                                const prev = liveToolEventsRef.current[speaker];
                                const merged = prev ? `${stamped}\n${prev}` : stamped;
                                liveToolEventsRef.current[speaker] = merged.split('\n').slice(0, 8).join('\n');
                                throttledDebateUpdate(
                                    requestConversationId,
                                    debateMessageId,
                                    debateTurnsRef.current,
                                    thoughtMap,
                                    reasoningMapRef.current,
                                    activeDebateSpeakersRef.current, runContractFor(),
                                );
                            },
                            // Risk-only template: straight to the verdict.
                            runDebateTemplate?.skipToVerdict,
                            botByThoughtsKey,
                            centralizedSnapshot,
                            lossPrimingRows,
                            loggedTrades,
                            // Team-seat personas: seatName → directive, so a
                            // team seat's role/instructions survive into the
                            // rebuttal/clarification/verdict rounds too.
                            seatPersonasBySeatName,
                            // Session-guard facts (Batch 2): the moderator weighs
                            // "trader is at the daily-loss limit" when grading.
                            formatGuardContextBlock(assessSession(
                                loggedTrades,
                                getHarnessSettings().equityUsd,
                                getSessionGuardConfig(),
                            )),
                            // R54: model side-effects — proposals + custom tools
                            // land on the message as ToolAction status rows.
                            { onToolAction: action => { toolActionsRef.current = [...toolActionsRef.current, action].slice(-50); } },
                        );
                    }

                    let fullResponseText = '';
                    // Peel thinking out of a turn BEFORE sanitizing —
                    // sanitizeAIResponseLight strips <think> tags but keeps
                    // their bodies, so the split must run first. Used by the
                    // accuracy-mode autoplay path (the standard path uses
                    // peelDebateTurn, which also merges streamed CoT).
                    const peelRawTurn = (raw: string): { text: string; reasoning?: string } => {
                        const split = splitThinkingFromOutput('', raw);
                        return {
                            text: sanitizeAIResponseLight(split.output),
                            reasoning: split.thinking || undefined,
                        };
                    };
                    if (runAccuracyMode) {
                        // ACCURACY MODE — the moderator autoplays the whole
                        // simulated transcript as one stream; parse `Speaker:`
                        // lines out of it with the established regex.
                        // Updated regex to include Puter model names (Claude, GPT, Grok, etc.) and OpenRouter
                        const assignedRoleNames = enabledProviders.map(provider => provider.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
                        const speakerNames = [...new Set([
                            ...assignedRoleNames,
                            'Gemini', 'DeepSeek', 'Zhipu', 'Groq', 'Groq \\(Alt\\)', 'Groq \\(Alt 2\\)', 'OpenRouter',
                            'Moderator', 'Master Strategist', 'Claude[^:]*', 'GPT[^:]*', 'Grok[^:]*', 'Mistral[^:]*',
                            'Kimi[^:]*', 'Qwen[^:]*', 'LLaMA[^:]*', 'Puter[^:]*'
                        ])].sort((a, b) => b.length - a.length);
                        const speakerPattern = speakerNames.join('|');
                        const turnRegex = new RegExp(`(?:^|\\n)\\s*(?:[*_~]*)(${speakerPattern})[^\\n]*?(?:[*_~]*)\\s*:\\s*([\\s\\S]*?)(?=(?:^|\\n)\\s*(?:[*_~]*)(${speakerPattern})[^\\n]*?(?:[*_~]*)\\s*:|$)`, 'gi');

                        for await (const chunk of debateStream as AsyncGenerator<string, void, unknown>) {
                            if (!isCurrentRequest()) assertCurrentRequest();
                            fullResponseText += chunk;

                            const startTagRegex = /(?:<|\*\*<|`|< \*\*|_\*<)?DEBATE_START(?:>|>\*\*|`|\*\* >|>\*_)*/i;
                            const endTagRegex = /(?:<|\*\*<|`|< \*\*|_\*<)?\/?(?:DEBATE_END|\/DEBATE_START)(?:>|>\*\*|`|\*\* >|>\*_)*/i;

                            const startMatch = fullResponseText.match(startTagRegex);
                            let debateContent = '';
                            let synthesisContent = '';

                            if (startMatch) {
                                const startIndex = startMatch.index! + startMatch[0].length;
                                const endMatch = fullResponseText.slice(startIndex).match(endTagRegex);
                                if (endMatch) {
                                    debateContent = fullResponseText.slice(startIndex, startIndex + endMatch.index!);
                                    const endTagLength = endMatch[0].length;
                                    const contentAfterDebate = fullResponseText.slice(startIndex + endMatch.index! + endTagLength);
                                    const jsonStart = contentAfterDebate.match(/<JSON_PLAN>|```json/i);
                                    if (jsonStart) {
                                        synthesisContent = contentAfterDebate.substring(0, jsonStart.index).trim();
                                    } else {
                                        synthesisContent = contentAfterDebate.trim();
                                    }
                                } else {
                                    debateContent = fullResponseText.slice(startIndex);
                                }
                            } else {
                                if (/(Gemini|DeepSeek|Zhipu|Groq|Groq \(Alt\)|Moderator|Master Strategist).*:/.test(fullResponseText)) {
                                    const jsonStart = fullResponseText.match(/<JSON_PLAN>|```json/i);
                                    if (jsonStart) {
                                        debateContent = fullResponseText.substring(0, jsonStart.index);
                                    } else {
                                        debateContent = fullResponseText;
                                    }
                                }
                            }

                            const currentTurns: DebateTurn[] = [];
                            const structuredTurns = parseStructuredAutoplayTranscript(debateContent);
                            const matches = structuredTurns.length > 0
                                ? []
                                : [...debateContent.matchAll(turnRegex)];
                            // Autoplayed transcripts carry no explicit rounds —
                            // derive them: each moderator turn starts a new
                            // round, so the messenger chat keeps its round
                            // separators and the final moderator message gets
                            // the verdict treatment. Prefix-stable: earlier
                            // turns never change as the stream grows.
                            let autoplayRound = 0;
                            const parsedTurns = structuredTurns.length > 0
                                ? structuredTurns.map(turn => ({
                                    speaker: turn.speaker,
                                    round: turn.round,
                                    text: turn.text,
                                }))
                                : matches.map(m => ({
                                    speaker: m[1].trim(),
                                    round: undefined,
                                    text: m[2].trim(),
                                }));
                            for (const parsed of parsedTurns) {
                                let speaker = parsed.speaker.trim();
                                if (speaker === "Master Strategist") speaker = "Moderator";
                                speaker = speaker.charAt(0).toUpperCase() + speaker.slice(1);
                                if (parsed.round !== undefined) autoplayRound = parsed.round;
                                else if (speaker === 'Moderator') autoplayRound++;
                                const peeledTurn = peelRawTurn(parsed.text);
                                currentTurns.push({
                                    speaker: speaker as DebateTurn['speaker'],
                                    round: autoplayRound > 0 ? autoplayRound : undefined,
                                    text: peeledTurn.text,
                                    reasoning: peeledTurn.reasoning,
                                });
                            }

                            // The moderator's verdict prose sits right before
                            // </DEBATE_END> (no "Speaker:" prefix), so the turn
                            // regex can't capture it — surface it as the final
                            // moderator synthesis instead of dropping it.
                            if (!synthesisContent && structuredTurns.length > 0) {
                                const lastTurnEnd = debateContent.toLowerCase().lastIndexOf('</turn>');
                                const trailing = lastTurnEnd >= 0 ? debateContent.slice(lastTurnEnd + '</turn>'.length) : '';
                                if (trailing.trim()) {
                                    synthesisContent = trailing.trim();
                                }
                            } else if (!synthesisContent && matches.length > 0) {
                                const lastMatch = matches[matches.length - 1];
                                const trailing = debateContent.slice((lastMatch.index ?? 0) + lastMatch[0].length);
                                if (trailing.trim()) {
                                    synthesisContent = trailing.trim();
                                }
                            }

                            if (synthesisContent) {
                                const cleanSynthesis = synthesisContent.replace(/^(?:[*_~]*)(Moderator|Master Strategist)[^:\n]*?:\s*/i, '');
                                const lastTurn = currentTurns[currentTurns.length - 1];
                                if (cleanSynthesis && (!lastTurn || lastTurn.text !== cleanSynthesis)) {
                                    const peeledSynthesis = peelRawTurn(cleanSynthesis);
                                    currentTurns.push({ speaker: 'Moderator', round: autoplayRound + 1, text: peeledSynthesis.text, reasoning: peeledSynthesis.reasoning });
                                }
                            }

                            // P1-5: Coalesce per-token updates into one per frame.
                            // REPLY-TO markers become `to` and leave the display text.
                            const normalizedTurns = currentTurns.map(applyReplyTo);
                            debateTurnsRef.current = normalizedTurns;
                            throttledDebateUpdate(requestConversationId, debateMessageId, normalizedTurns, thoughtMap, reasoningMapRef.current, activeDebateSpeakersRef.current, runContractFor());
                        }
                    } else {
                        // STANDARD MODE — REAL debate: the pipeline receives
                        // structured turn events (delta chunks per speaker +
                        // round) instead of a transcript to regex-parse.
                        const turnTexts: Record<string, string> = {}; // `${round}::${speaker}` → accumulated text
                        const turnTimes: Record<string, string> = {};   // first-delta timestamp per turn (replay)
                        // Per-turn speed metrics: provider-call launch time
                        // (rides the first delta) + last-delta time.
                        const turnLaunchTimes: Record<string, number> = {};
                        const turnLastDeltaAt: Record<string, number> = {};
                        let moderatorRound = 0;

                        const peelDebateTurn = (speaker: string, raw: string, key: string): { text: string; reasoning?: string } => {
                            const cot = turnReasoningRef.current[key]
                                || reasoningMapRef.current[speaker]
                                || (speaker === 'Moderator' ? reasoningMapRef.current.moderator : '')
                                || '';
                            const split = splitThinkingFromOutput(cot, raw);
                            return {
                                text: sanitizeAIResponseLight(split.output),
                                reasoning: split.thinking || undefined,
                            };
                        };

                        // Single rebuild path shared by the text-event loop AND the
                        // reasoning callbacks. Turns are assembled from BOTH lanes —
                        // accumulated text AND accumulated thinking — so a seat that
                        // is still thinking (no output deltas yet) already has a
                        // live turn whose Thinking row streams.
                        const rebuildDebateTurns = (): void => {
                            const turnKeys = new Set<string>(Object.keys(turnTexts));
                            for (const k of Object.keys(turnReasoningRef.current)) {
                                if (turnReasoningRef.current[k]) turnKeys.add(k);
                            }
                            const currentTurns: DebateTurn[] = [...turnKeys]
                                .map((k) => {
                                    const sep = k.indexOf('::');
                                    const speaker = k.slice(sep + 2) as DebateTurn['speaker'];
                                    const text = turnTexts[k] || '';
                                    const cleanedText = speaker === 'Moderator'
                                        ? text
                                            .replace(CLARIFICATION_MARKERS_RE, '')
                                            .replace(MODERATOR_RETRY_RE, '')
                                            .replace(MODERATOR_ERROR_BLOCK_RE, '')
                                            .replace(/<JSON_PLAN>[\s\S]*/i, '')
                                            .replace(DEBATE_END_MARKERS_RE, '')
                                            .trim()
                                        : text.trim();
                                    const peeled = peelDebateTurn(speaker, cleanedText, k);
                                    // Per-turn speed metrics:
                                    // TTFT from provider-launch → first delta,
                                    // output rate from first → last delta.
                                    const launch = turnLaunchTimes[k];
                                    const firstAt = turnTimes[k] ? Date.parse(turnTimes[k]) : NaN;
                                    const lastAt = turnLastDeltaAt[k];
                                    const ttftMs = launch && Number.isFinite(firstAt) && firstAt >= launch
                                        ? Math.max(0, firstAt - launch)
                                        : undefined;
                                    const chars = (turnTexts[k] || '').length;
                                    const streamSec = Number.isFinite(firstAt) && lastAt && lastAt > firstAt
                                        ? (lastAt - firstAt) / 1000
                                        : 0;
                                    const tokensPerSec = streamSec >= 0.5 && chars > 0
                                        ? Math.round(chars / 4 / streamSec)
                                        : undefined;
                                    return {
                                        speaker,
                                        round: parseInt(k.slice(0, sep), 10) || undefined,
                                        createdAt: turnTimes[k],
                                        text: peeled.text,
                                        reasoning: peeled.reasoning,
                                        metrics: ttftMs !== undefined || tokensPerSec !== undefined
                                            ? { ttftMs, tokensPerSec }
                                            : undefined,
                                    };
                                })
                                .filter(turn => Boolean(turn.text) || Boolean(turn.reasoning))
                                .sort((a, b) => (a.round ?? 0) - (b.round ?? 0));

                            // REPLY-TO markers become `to`; FinCom COMMIT/DISSENT
                            // lines parse into `fincom` metadata (Batch 4 g).
                            const normalizedTurns = currentTurns.map(t => withFinComMetadata(applyReplyTo(t)));
                            debateTurnsRef.current = normalizedTurns;
                            throttledDebateUpdate(requestConversationId, debateMessageId, normalizedTurns, thoughtMap, reasoningMapRef.current, activeDebateSpeakersRef.current, runContractFor());
                        };
                        rebuildDebateTurnsRef.current = rebuildDebateTurns;

                        // ─── Progressive verdict ───────────────────────────────
                        // Re-parse the moderator's stream as it grows so the
                        // TradingSignalCard fills while the verdict is still
                        // being written. Guarded by a growth threshold so the
                        // parser doesn't run on every token; the authoritative
                        // parse still runs once the debate concludes.
                        let progressiveParsedLen = 0;
                        let lastProvisionalJson = '';
                        const tryProgressiveVerdict = (): void => {
                            if (moderatorRound <= 0) return;
                            const hasEndMarker = /<\/?DEBATE_END>/i.test(fullResponseText);
                            if (!hasEndMarker && fullResponseText.length - progressiveParsedLen < 160) return;
                            progressiveParsedLen = fullResponseText.length;
                            const moderatorTurn = turnTexts[`${moderatorRound}::Moderator`] || '';
                            const provisional = parseProvisionalVerdict(fullResponseText, moderatorTurn);
                            // Skeleton-fill: publish whatever labeled fields have
                            // arrived so far, even before the plan is binding.
                            const planFields = parsePartialVerdictFields(fullResponseText, moderatorTurn) ?? undefined;
                            const json = JSON.stringify({ provisional, planFields });
                            if (json === lastProvisionalJson) return;
                            lastProvisionalJson = json;
                            throttledProvisionalVerdict(requestConversationId, debateMessageId, provisional ?? undefined, planFields);
                        };

                        for await (const event of debateStream as AsyncGenerator<ensembleService.RealDebateTurnEvent, void, unknown>) {
                            if (!isCurrentRequest()) assertCurrentRequest();
                            if (!event || typeof event.text !== 'string') continue;

                            const key = `${event.round}::${event.speaker}`;
                            // The engine emits this marker before a moderator
                            // verdict retry — discard the failed attempt's
                            // partial prose so it never glues onto the verdict.
                            if (event.text.includes(MODERATOR_RETRY_MARKER)) {
                                // Discard the failed attempt entirely — text, the
                                // first-delta timestamp, AND the streamed thinking
                                // (the retried verdict must not carry the failed
                                // attempt's start time or chain-of-thought).
                                turnTexts[key] = '';
                                delete turnTimes[key];
                                delete turnLaunchTimes[key];
                                delete turnLastDeltaAt[key];
                                delete turnReasoningRef.current[key];
                                continue;
                            }
                            // The engine abandoned the replacement wait — the
                            // suspended requestReplacement must be unblocked so
                            // a late click on the banner can never resolve into
                            // a phantom analyst (a full paid re-analysis call
                            // injected into consensus/runStats).
                            if (event.text.includes(REPLACEMENT_TIMEOUT_MARKER)) {
                                const pending = replacementChoiceRef.current;
                                if (pending) handleReplacementChoice(pending.messageId, null);
                            }
                            if (!turnTimes[key]) turnTimes[key] = new Date().toISOString();
                            if (event.startedAt && !turnLaunchTimes[key]) {
                                turnLaunchTimes[key] = Date.parse(event.startedAt);
                            }
                            turnLastDeltaAt[key] = Date.now();
                            turnTexts[key] = (turnTexts[key] || '') + event.text;
                            if (event.speaker === 'Moderator') {
                                fullResponseText += event.text;
                                moderatorRound = event.round;
                                tryProgressiveVerdict();
                            }

                            rebuildDebateTurns();
                        }

                        // The moderator's verdict prose lives before the
                        // </DEBATE_END> / <JSON_PLAN> markers — strip them so
                        // the transcript shows clean verdict text.
                        if (moderatorRound > 0) {
                            const modKey = `${moderatorRound}::Moderator`;
                            if (turnTexts[modKey]) {
                                const cleaned = turnTexts[modKey]
                                    .replace(MODERATOR_RETRY_RE, '')
                                    .replace(DEBATE_END_MARKERS_RE, '')
                                    .replace(MODERATOR_ERROR_BLOCK_RE, '')
                                    .replace(/<JSON_PLAN>[\s\S]*/i, '')
                                    .trim();
                                if (cleaned) {
                                    turnTexts[modKey] = cleaned;
                                    rebuildDebateTurns();
                                }
                            }
                        }
                    }
                    // Flush the final pending update synchronously so the
                    // last chunk's state is committed before downstream parsing.
                    throttledDebateUpdate.flush();
                    throttledProvisionalVerdict.flush();
                    if (!isCurrentRequest()) assertCurrentRequest();

                    let finalAnalysis: TradeAnalysis;
                    try {
                        // The moderator's final output is MARKDOWN: verdict
                        // prose + a labeled **FINAL TRADE PLAN** block (no
                        // JSON anywhere). Parse the plan deterministically;
                        // the parser itself falls back to free-form prose.
                        const moderatorErrorMatch = fullResponseText.match(/<MODERATOR_ERROR>([\s\S]*?)<\/MODERATOR_ERROR>/);
                        const debateEnd = fullResponseText.match(/<\/?DEBATE_END>/i);
                        // Prefer the last moderator turn (the verdict). Concatenating
                        // every moderator round glues clarification questions onto
                        // the Trading signal card.
                        const lastModeratorTurn = [...debateTurnsRef.current]
                            .reverse()
                            .find(t => t.speaker === 'Moderator')?.text ?? '';
                        const candidate = debateEnd && debateEnd.index !== undefined
                            ? fullResponseText.slice(debateEnd.index + debateEnd[0].length)
                            : (lastModeratorTurn || fullResponseText);
                        try {
                            const plan = parseMarkdownTradePlan(candidate);
                            if (!plan || !isBindingMarkdownPlan(plan)) {
                                throw new Error('No markdown trade plan found in the moderator response');
                            }
                            finalAnalysis = sanitizeTradeAnalysis({
                                ...tradePlanToAnalysis(plan),
                                // The card renders the moderator's own markdown
                                // verdict + plan — the same markdown format as
                                // the workspace, never a JSON schema.
                                strategy: stripPlanTags(candidate).slice(0, 3000),
                            });
                            // Vocabulary flag (Batch 4 f): urgency-framed
                            // wording in the rendered verdict is a measured
                            // tell (urgency-framed calls averaged −0.42R in
                            // the signal study) — surface it, don't rewrite it.
                            const bannedHits = flagBannedVocabulary(candidate);
                            if (bannedHits.length > 0) {
                                finalAnalysis.validationWarnings = [
                                    ...(finalAnalysis.validationWarnings ?? []),
                                    `URGENCY WORDING: ${bannedHits.join(', ')} — urgency-framed confidence is historically inflated; discount accordingly.`,
                                ];
                            }
                        } catch (e) {
                            // Only surface the moderator error marker when no
                            // plan could be recovered at all.
                            if (moderatorErrorMatch) {
                                throw new Error(`Moderator Error: ${moderatorErrorMatch[1]}`, { cause: e });
                            }
                            throw e;
                        }
                    } catch (e) {
                        console.error("Failed to parse final debate JSON:", e);
                        const errorMessage = e instanceof Error ? e.message : 'Unknown error';
                        const isModeratorError = errorMessage.includes('Moderator Error');
                        // Prose rescue: the moderator's markdown verdict often
                        // carries the whole plan in WORDS even when the JSON
                        // failed — parse the labeled fields so the card shows a
                        // REAL signal (coin name, direction, entry/SL/TP,
                        // probability) in the same markdown format, never a
                        // dead "Unknown Asset · Neutral" card. The verdict
                        // prose itself becomes the card's strategy text (tags
                        // stripped — the JSON schema never renders).
                        const lastModeratorTurn = [...debateTurnsRef.current]
                            .reverse()
                            .find(t => t.speaker === 'Moderator')?.text ?? '';
                        const rescueSource = lastModeratorTurn || fullResponseText;
                        const prosePlan = parseProseTradePlan(rescueSource);
                        const rescuePlan = prosePlan ? { ...prosePlan } : null;
                        const canRescue = Boolean(
                            rescuePlan?.direction
                            && rescuePlan.entry
                            && rescuePlan.stopLoss
                            && rescuePlan.takeProfit
                            && !((rescuePlan.direction === 'Long' || rescuePlan.direction === 'Short') && /avoid/i.test(rescuePlan.confidence || '')),
                        );
                        const fallbackStrategy = isModeratorError
                            ? `Connection Error: ${errorMessage}. Please try again.`
                            : 'Plan incomplete — the moderator markdown could not be parsed. Open the Floor for the debate.';
                        finalAnalysis = sanitizeTradeAnalysis({
                            coinName: canRescue ? (prosePlan?.coinName ?? finalSymbol ?? undefined) : (finalSymbol ?? undefined),
                            direction: canRescue ? (prosePlan?.direction ?? 'Neutral') : 'Neutral',
                            confidence: canRescue ? (prosePlan?.confidence ?? 'Low') : 'Avoid',
                            probability: canRescue ? prosePlan?.probability : undefined,
                            entryPoints: canRescue && prosePlan?.entry ? [{ price: prosePlan.entry }] : undefined,
                            stopLoss: canRescue ? prosePlan?.stopLoss : undefined,
                            takeProfit: canRescue && prosePlan?.takeProfit ? [{ price: prosePlan.takeProfit }] : undefined,
                            strategy: canRescue
                                ? (stripPlanTags(rescueSource).slice(0, 3000) || fallbackStrategy)
                                : fallbackStrategy,
                        });
                    }

                    finalAnalysis = sanitizeTradeAnalysis(finalAnalysis);

                    // === ACCURACY MODE VERIFICATION PASS ===
                    // Standard mode has the clarification loop; accuracy mode is a
                    // single autoplayed stream. This second focused moderator call
                    // reviews the debate + plan and may adjust levels/confidence.
                    // Fail-safe: any error keeps the moderator's plan untouched.
                    let accuracyVerificationNote = '';
                    if (runAccuracyMode && finalAnalysis.direction && finalAnalysis.direction !== 'Neutral') {
                        try {
                            const verification = await ensembleService.verifyAccuracyPlan(
                                runModeratorConfig,
                                runModeratorModel,
                                fullResponseText,
                                JSON.stringify(finalAnalysis),
                                currentAbortController.signal,
                                // Chart context + user strategies so the
                                // verification pass is not blind.
                                moderatorContextBundle,
                                // Journal access so the verifier's recall
                                // desk tool can check claims against history.
                                loggedTrades,
                            );
                            if (verification.verdict === 'adjusted' && verification.planJson) {
                                const adjustedPlan = parseMarkdownTradePlan(verification.planJson);
                                if (adjustedPlan && adjustedPlan.direction) {
                                    const adjusted = sanitizeTradeAnalysis(tradePlanToAnalysis(adjustedPlan));
                                    if (adjusted.direction !== 'Neutral') {
                                        finalAnalysis = adjusted;
                                        accuracyVerificationNote = verification.note;
                                    }
                                }
                            } else {
                                accuracyVerificationNote = verification.note || 'Plan verified by the accuracy pass.';
                            }
                        } catch (verifyError) {
                            const err = verifyError as { name?: string; code?: string; message?: string };
                            // A user cancel must stay a cancel — it was being
                            // swallowed here, so the run continued and emitted
                            // the card after the user pressed stop.
                            // A TIMEOUT is NOT a cancel: the debate + plan already
                            // completed, so a slow verification pass must never
                            // abort the finished run — keep the original plan
                            // (mirrors verifyAccuracyPlan's own fail-safe).
                            if ((err?.name === 'AbortError' || err?.code === 'ABORT_ERR') || !isCurrentRequest()) {
                                throw verifyError;
                            }
                            console.warn('[AccuracyVerification] Skipped (kept original plan):', err?.message || verifyError);
                        }
                    }

                    // === PROGRAMMATIC GATE CAP ENFORCEMENT ===
                    // (moved below processNewAnalysis so the R:R-based clamp
                    // tiers use the recomputed rrRatio)

                    // Compute OUTSIDE the state updater: updaters may re-run in
                    // StrictMode (duplicate notifications) and must stay pure
                    // (processNewAnalysis performs synchronous setState calls).
                    const processedAnalysis = processNewAnalysis(finalAnalysis);

                    // === PROGRAMMATIC GATE CAP ENFORCEMENT ===
                    // Runs AFTER processNewAnalysis so the R:R-based clamp
                    // tiers use the RECOMPUTED rrRatio — clamping before the
                    // metrics pass meant a moderator-emitted (or wrong)
                    // rrRatio disabled the 54%/69% grade clamps entirely.
                    if (processedAnalysis && capturedGateResult && processedAnalysis.probability != null) {
                        const gateCap = capturedGateResult.confidenceCap ?? 1.0;
                        const clampResult = clampProbabilityToGate(
                            processedAnalysis.probability,
                            gateCap,
                            processedAnalysis.rrRatio
                        );
                        if (clampResult.wasClamped) {
                            console.warn(`[Gate Enforcement] Clamped probability ${processedAnalysis.probability}% → ${clampResult.probability}% (${clampResult.reason})`);
                            processedAnalysis.probability = clampResult.probability;
                            // Also downgrade the confidence string if probability was clamped below the threshold
                            if (clampResult.probability < 70 && processedAnalysis.confidence === 'High') {
                                processedAnalysis.confidence = 'Medium';
                            } else if (clampResult.probability < 55 && processedAnalysis.confidence === 'Medium') {
                                processedAnalysis.confidence = 'Low';
                            }
                            // Record the clamping in validation warnings
                            if (!processedAnalysis.validationWarnings) {
                                processedAnalysis.validationWarnings = [];
                            }
                            processedAnalysis.validationWarnings.push(`Gate enforcement: ${clampResult.reason}`);
                        }
                    }

                    if (freshHybridData && processedAnalysis) {
                        // Inject market snapshot (Algo Mode & Regeneration).
                        processedAnalysis.marketSnapshot = freshHybridData;
                    }

                    // Consensus explainability: per-analyst structured calls +
                    // pre-debate divergence, attached to the verdict so the
                    // result card can audit the call against its own inputs.
                    if (processedAnalysis) {
                        const consensus = ensembleService.buildAnalystConsensus(allFulfilledAnalysts);
                        if (consensus) {
                            processedAnalysis.analystConsensus = ensembleService.attachVerdictCitations(consensus, processedAnalysis);
                            Object.assign(processedAnalysis, ensembleService.enforceCitedVerdict(
                                processedAnalysis,
                                processedAnalysis.analystConsensus,
                                parseKeptAnalyst(fullResponseText),
                            ));
                        }
                        processedAnalysis.recommendationContract = buildRecommendationContract(processedAnalysis);
                        // §8.3a citation stamp: annotate the newest verdict-stage
                        // injection record with which skills the FINAL verdict
                        // actually cited. Without this call the `cited` field is
                        // never written, skillAdherenceForRun can only ever return
                        // 'injected-unknown', and the OVERRIDDEN evidence state
                        // (injected-but-ignored → amendment counter, not stat rot)
                        // is dead. Fire-and-forget — telemetry must never break
                        // the verdict commit.
                        void annotateVerdictCitations(getActiveUsername(), fullResponseText, userMessage.id)
                            .catch(() => { /* citation telemetry is best-effort */ });
                    }

                    // Veto falsification ledger — stamp the deferred
                    // veto only if the final verdict actually stayed blocked. An
                    // actionable Long/Short here means the floor defied the veto
                    // end-to-end, so nothing was blocked and the trade earns
                    // normal evidence attribution instead of a phantom entry.
                    if (vetoRecordParams
                        && processedAnalysis.direction !== 'Long'
                        && processedAnalysis.direction !== 'Short') {
                        void VetoLedgerService.recordVeto(vetoRecordParams)
                            .catch(() => { /* ledger must never break the debate */ });
                    }

                    updateRequestMessages(prev => {
                        const messageIndex = prev.findIndex(m => m.id === debateMessageId);
                        if (messageIndex === -1) return prev;

                        const existingMessage = prev[messageIndex];
                        const updatedMessage = {
                            ...existingMessage,
                            isDebating: false,
                            text: accuracyVerificationNote
                                ? `The ensemble has concluded its debate.

${accuracyVerificationNote}`
                                : `The ensemble has concluded its debate.`,
                            analysis: processedAnalysis,
                            outcome: TradeOutcome.PENDING,
                            // The authoritative verdict replaces the provisional
                            // card that streamed while the moderator wrote.
                            provisionalAnalysis: undefined,
                            provisionalPlanFields: undefined,
                            // Tool chips are live-only — the settled card keeps
                            // the permanent run log instead.
                            liveToolEvents: undefined,
                            debateTurns: existingMessage.debateTurns,
                            thoughtProcesses: { ...thoughtMap },
                            reasoningProcesses: { ...reasoningMapRef.current },
                            activeDebateSpeakers: {},
                            // Any pending replacement offer is void once the
                            // debate concludes (the banner must never persist
                            // on the finished card).
                            replacementOffer: undefined,
                            // Multi-Timeframe Confluence from Hybrid Intelligence
                            confluenceData: freshHybridData?.confluence ? {
                                score: freshHybridData.confluence.score,
                                direction: freshHybridData.confluence.direction,
                                strength: freshHybridData.confluence.strength,
                                alignedSignals: freshHybridData.confluence.alignment,
                                conflictingSignals: freshHybridData.confluence.conflicts,
                                timeframeCount: 4 // 5m, 15m, 1h, 4h
                            } : undefined,
                            isLensMode: runLensConfig?.enabled ?? lensConfig?.enabled ?? false,
                            // Always set tradingStyle regardless of Lens mode
                            tradingStyle: effectiveTradingStyle,
                            debateRunLog: [...debateRunLogRef.current],
                            // R54: persisted model side-effects for this run.
                            toolActions: toolActionsRef.current.length > 0 ? [...toolActionsRef.current] : undefined,
                            debateCheckpoint: undefined,
                            memoryRetrieved,
                            // Audit surfaces: the finished
                            // contract (frozen from the final log) + what the
                            // arbiter's evidence pack contained.
                            runContract: buildRunContractStages(debateRunLogRef.current, false),
                            evidencePack: (() => {
                                try {
                                    return buildVerdictEvidencePack(
                                        memoryQuery ?? deriveSetupQueryFromPrompt(effectiveInput),
                                        loggedTrades,
                                    ).ui;
                                } catch { return undefined; }
                            })(),
                        };

                        // Per-run execution summary (compare mode + diagnostics).
                        updatedMessage.runStats = {
                            // §8.3a: the run's identity — the user message that
                            // triggered it, same id the injection records carry.
                            // Trades copy it at log time so evidence attribution
                            // joins exactly instead than by time window.
                            runId: userMessage.id,
                            startedAt: new Date(runStartedAt).toISOString(),
                            finishedAt: new Date().toISOString(),
                            durationMs: Date.now() - runStartedAt,
                            promptVersion: computePromptVersion({
                                accuracy: runAccuracyMode,
                                ensemble: runEnsembleEnabled,
                                hybrid: isHybridIntelligenceEnabled,
                                lens: Boolean(runLensConfig?.enabled ?? lensConfig?.enabled),
                                playbook: isPlaybookEnabledInPureAI,
                                families: isFamiliesEnabledInPureAI,
                                memory: isMemoryEnabledInPureAI,
                                customEnsemble: Boolean(customEnsemblePrompt),
                                promptLane,
                                // Protocol lane attribution.
                                protocol: ensembleService.getLastDebateProtocol(),
                            }),
                            promptLane,
                            // Protocol lane attribution — on
                            // runStats itself so the signal card can chip it.
                            protocol: ensembleService.getLastDebateProtocol(),
                            // §8.5a: ε-holdout classification for THIS run —
                            // the same seeded decision the retrieval layer made
                            // when it withheld skill injection.
                            skillHoldout: shouldSkillHoldout(userMessage.id),
                            gateCap: capturedGateResult?.confidenceCap,
                            mcWinRate: perAIMC[0]?.result?.winRate,
                            mcEV: perAIMC[0]?.result?.expectedValue,
                            analystCount: allFulfilledAnalysts.length,
                            btMatches: liveBtResult?.totalMatches,
                            btWinRate: liveBtResult?.winRate,
                            btEV: liveBtResult?.expectedValue,
                            // Cost & latency ledger — the analysts that ACTUALLY
                            // delivered (initial roster + mid-debate replacements),
                            // with their model, wall time, and output size.
                            analysts: allFulfilledAnalysts.map(a => {
                                const timing = analystTimings.get(a.provider.thoughtsKey);
                                const tokens = tokenByProvider.get(a.provider.config.id);
                                // Seat identity for the floor/transcript tags:
                                // the team role (or the unroled seat's focus
                                // dimension) the harness actually ran with.
                                const seat = teamSeatFor(a.provider.config.id, a.provider.model);
                                const seatRole = !runLensConfig.enabled && runGroupMemberPersonas.length > 0 && seat?.role && seat.role !== AnalystRole.UNASSIGNED
                                    ? ANALYST_ROLE_DEFINITIONS[seat.role]?.shortName
                                    : undefined;
                                const seatIndex = allFulfilledAnalysts.indexOf(a);
                                const seatFocus = !runLensConfig.enabled && runGroupMemberPersonas.length > 0 && !seatRole
                                    ? GENERAL_DIMENSION_TAGS[seatIndex % GENERAL_DIMENSION_TAGS.length]
                                    : undefined;
                                return {
                                    providerId: a.provider.config.id,
                                    displayName: a.provider.name,
                                    modelId: a.provider.model,
                                    ...(seatRole ? { seatRole } : {}),
                                    ...(seatFocus ? { seatFocus } : {}),
                                    ...(timing ? { durationMs: timing.durationMs, charsOut: timing.charsOut } : {}),
                                    ...(tokens ? { promptTokens: tokens.promptTokens, completionTokens: tokens.completionTokens } : {}),
                                };
                            }),
                            promptTokens: [...tokenByProvider.values()].reduce((sum, u) => sum + u.promptTokens, 0) || undefined,
                            completionTokens: [...tokenByProvider.values()].reduce((sum, u) => sum + u.completionTokens, 0) || undefined,
                            costUsd: (() => {
                                let total = 0;
                                let any = false;
                                tokenByProvider.forEach((usage, providerId) => {
                                    const cfg = providerConfigs.find(p => p.id === providerId);
                                    const cost = estimateCostUsd(usage, cfg);
                                    if (cost !== undefined) {
                                        any = true;
                                        total += cost;
                                    }
                                });
                                return any ? total : undefined;
                            })(),
                        };

                        void appendSessionUsage({
                            at: updatedMessage.runStats.finishedAt,
                            durationMs: updatedMessage.runStats.durationMs,
                            promptTokens: updatedMessage.runStats.promptTokens ?? 0,
                            completionTokens: updatedMessage.runStats.completionTokens ?? 0,
                            tokensEst: updatedMessage.runStats.analysts?.reduce((sum, a) => sum + Math.round((a.charsOut ?? 0) / 4), 0) ?? 0,
                            analystCount: updatedMessage.runStats.analystCount ?? 0,
                            costUsd: updatedMessage.runStats.costUsd,
                            coin: processedAnalysis?.coinName,
                            direction: processedAnalysis?.direction,
                            models: updatedMessage.runStats.analysts?.map(a => ({
                                modelId: a.modelId,
                                tokens: (a.promptTokens ?? 0) + (a.completionTokens ?? 0) || Math.round((a.charsOut ?? 0) / 4),
                            })),
                        });

                        const newMessages = [...prev];
                        newMessages[messageIndex] = updatedMessage;
                        return newMessages;
                    });

                    // Background completion notification (native, backgrounded only) —
                    // outside the updater so StrictMode double-invocation can't
                    // schedule duplicate notifications.
                    void notifyAnalysisComplete(
                        'Analysis complete',
                        `${processedAnalysis?.direction ?? finalAnalysis.direction} ${finalAnalysis.coinName || ''} — ${finalAnalysis.confidence} confidence`
                    );
                    if (!isAutomationRun) {
                        setHighlightedAnalysisId(debateMessageId);
                    }

                    // Verdict → skill draft: when the moderator cites a pattern
                    // the notebook does not know yet, queue a draft for the
                    // approval inbox (deterministic — no LLM call). Interactive
                    // runs only; automation runs must not spam drafts.
                    if (!isAutomationRun && runEnsembleEnabled) {
                        try {
                            maybeQueueVerdictSkillDraft(
                                debateMessageId,
                                processedAnalysis ?? finalAnalysis,
                                getActiveUsername(),
                            );
                        } catch (draftError) {
                            console.warn('[SkillDraft] Verdict draft queue failed (non-fatal):', draftError);
                        }
                    }

                    // Automation run: deliver the completed card to the caller
                    // (the main conversation was never touched).
                    if (isAutomationRun) {
                        const finalAiMessage = automationMessagesRef.current.find(m => m.id === debateMessageId);
                        if (finalAiMessage) {
                            options?.automation?.onMessage({ userMessage, aiMessage: finalAiMessage });
                        } else {
                            options?.automation?.onError?.('Automation run produced no result message.');
                        }
                    }

                    // === ThinkingStore: Save reasoning for training & analysis ===
                    // Persist per-analyst reasoning, moderator synthesis, and debate turns
                    // so they can be correlated with outcomes and exported for model training.
                    try {
                        const tradeId = getThinkingTradeId(finalAnalysis.createdAt, debateMessageId);
                        const username = getActiveUsername();
                        const now = new Date().toISOString();
                        const thinkingRecords: ThinkingRecord[] = [];
                        const lensEnabled = Boolean(runLensConfig?.enabled && hasCompleteAnalystAssignments);

                        // Save each analyst's reasoning + analysis JSON. Aligned
                        // by settled-result index so a failed analyst doesn't shift
                        // attribution (same bug class as the P1-6 thoughtMap fix),
                        // and the unreliable name-vs-id string matching is removed.
                        settledResults.forEach((settled, idx) => {
                            if (settled.status !== 'fulfilled') return;
                            const provider = enabledProviders[idx];
                            if (!provider) return;
                            const providerKey = provider.thoughtsKey;
                            const analystResult = settled.value;
                            const assignedRole = getRoleForProvider(`${provider.config.id}::${provider.model}`, resolvedAssignments);
                            const analystSplit = splitThinkingFromOutput(
                                reasoningMapRef.current[provider.name] || analystResult.thoughtProcess || '',
                                analystResult.finalOutput || '',
                            );
                            thinkingRecords.push({
                                id: buildThinkingRecordId(tradeId, providerKey, 'analyst'),
                                tradeId,
                                username,
                                provider: providerKey,
                                role: 'analyst',
                                modelName: provider.model,
                                reasoning: analystSplit.thinking,
                                finalOutput: analystSplit.output || undefined,
                                rawReasoning: reasoningMapRef.current[provider.name] || undefined,
                                messageId: debateMessageId,
                                analysisJson: analystResult.analysis ? JSON.stringify(analystResult.analysis) : undefined,
                                confidence: analystResult.analysis?.confidence,
                                probability: analystResult.analysis?.probability,
                                analystLens: lensFromAnalystRole(assignedRole, lensEnabled),
                                createdAt: now,
                            });
                        });

                        // Save moderator synthesis (the full debate response)
                        const cleanedVerdict = fullResponseText
                                .replace(CLARIFICATION_MARKERS_RE, '')
                                .replace(MODERATOR_RETRY_RE, '')
                                .replace(MODERATOR_ERROR_BLOCK_RE, '')
                                .replace(DEBATE_END_MARKERS_RE, '')
                                .replace(/<JSON_PLAN>[\s\S]*/i, '')
                                .replace(/<\/?DEBATE_START>/gi, '')
                                .trim();
                        const moderatorSplit = splitThinkingFromOutput(
                            reasoningMapRef.current.moderator || '',
                            cleanedVerdict,
                        );
                        thinkingRecords.push({
                            id: buildThinkingRecordId(tradeId, 'moderator', 'moderator'),
                            tradeId,
                            username,
                            provider: 'moderator',
                            role: 'moderator',
                            modelName: activeModModel,
                            reasoning: moderatorSplit.thinking,
                            finalOutput: moderatorSplit.output || undefined,
                            rawReasoning: reasoningMapRef.current.moderator || undefined,
                            messageId: debateMessageId,
                            analysisJson: JSON.stringify(finalAnalysis),
                            confidence: finalAnalysis.confidence,
                            probability: finalAnalysis.probability,
                            createdAt: now,
                        });

                        // Save debate turns (if any were parsed). Read from the
                        // stream ref (the final flush already committed it) —
                        // messagesRef only refreshes in a useEffect and can lag
                        // behind the just-written message, dropping the last
                        // moderator turn from the persisted thinking records.
                        const debateTurns = debateTurnsRef.current;

                        debateTurns.forEach((turn, idx) => {
                            const turnProvider = turn.speaker.toLowerCase().includes('moderator') ? 'moderator' : turn.speaker.toLowerCase();
                            const matchedAnalyst = enabledProviders.find(p => p.name === turn.speaker);
                            const matchedRole = matchedAnalyst
                                ? getRoleForProvider(`${matchedAnalyst.config.id}::${matchedAnalyst.model}`, resolvedAssignments)
                                : undefined;
                            thinkingRecords.push({
                                id: buildThinkingRecordId(tradeId, turnProvider, 'debate_turn', idx),
                                tradeId,
                                username,
                                provider: turnProvider,
                                role: 'debate_turn',
                                debateTurnIndex: idx,
                                debateTurnSpeaker: turn.speaker,
                                reasoning: (turn.reasoning || '').trim(),
                                finalOutput: turn.text,
                                messageId: debateMessageId,
                                analystLens: lensFromSpeakerName(turn.speaker)
                                    ?? (matchedRole !== undefined ? lensFromAnalystRole(matchedRole, lensEnabled) : 'normal'),
                                createdAt: now,
                            });
                        });

                        // Save asynchronously (non-blocking)
                        persistThinkingRecords(thinkingRecords);
                    } catch (thinkingError) {
                        console.warn('[ThinkingStore] Error preparing thinking records:', thinkingError);
                    }

                } else if (enabledProviders.length === 1) {
                    const provider = enabledProviders[0];
                    if (!isAutomationRun) setLoadingMessage(runAccuracyMode ? `Running High-Precision Analysis...` : `Analyzing with ${provider.name}...`);
                    completeStep('gate-scan'); startStep('analysis');
                    // Guard flag for the solo path too — without it Esc couldn't
                    // cancel solo runs and the re-entrancy guard was inert
                    // (a second send was only blocked by the loadingMessage check).
                    setIsAnalysisInProgress(true);
                    setAnalysisSteps(prev => prev.map(s => s.id === 'analysis' ? { ...s, title: `Analyzing with ${provider.name}` } : s));
                            // Solo path: capture streamed raw reasoning via the
                            // same onReasoning slot as the multi path so the
                            // thinking record carries the chain-of-thought.
                            let soloRawReasoning = '';
                            const result = await runAnalyzeTradingView(
                            provider.config,
                            provider.model,
                            `${buildHybridEnvelope(freshHybridData, 'general') ? `${buildHybridEnvelope(freshHybridData, 'general')}\n\n` : ''}${enhancedPrompt}`,
                            imageFiles,
                            dataURLs,
                            currentAbortController.signal,
                            {
                                imageSummaries: summaries,
                                chatHistory: currentMessages,
                                finalTradeSummary,
                                recentInsights: recentInsightsString,
                                activeFrameworks,
                                deepenAnalysis: isDeepAnalysis,
                                globalMemory: memoryToInject,
                                threadSummary: currentThreadSummary,
                                subMode: runAccuracyMode ? runAccuracySubMode : undefined,
                                customInstructions: instructionsToUse,
                                isPlaybookEnabledInPureAI,
                                isFamiliesEnabledInPureAI,
                                isMemoryEnabledInPureAI,
                                // Analyst Lens: pass role-specific prompt based on trading style
                                // (custom prompt overrides from the prompt editor win), then
                                // prepend this seat's own lens memory (see multi-path note).
                                // Preflight block first, as in the multi path — solo runs
                                // record the same pass/fail telemetry but never substitute
                                // the output (there is no debate to absorb a NO CLAIM).
                                rolePrompt: runLensConfig.enabled && provider.thoughtsKey
                                    ? `${buildPreflightBlock()}\n\n${appendLensMemoryToPrompt(
                                        `${provider.config.id}::${provider.model}`,
                                        resolvedAssignments,
                                        customLensPrompts?.[getRoleForProvider(`${provider.config.id}::${provider.model}`, resolvedAssignments)]
                                        || getLensPromptForStyle(
                                            `${provider.config.id}::${provider.model}`,
                                            resolvedAssignments,
                                            effectiveTradingStyle
                                        ),
                                        { coin: finalSymbol ?? undefined, memoryQuery },
                                    )}`
                                    : undefined,
                                // Normal mode (Lenses off): custom base prompt override.
                                systemPromptOverride: runLensConfig.enabled ? undefined : (customEnsemblePrompt || undefined),
                                // User-uploaded strategy summaries (Settings → Strategies).
                                userStrategies: strategiesBlock || undefined,
                                // Streamed chain-of-thought deltas accumulate — the
                                // multi path uses the same append pattern.
                                onReasoning: (reasoning: string) => { soloRawReasoning += reasoning; },
                                // Solo path has no Floor/transcript — nothing to surface.
                                onPartialOutput: () => {},
                            },
                        );
                    if (!isCurrentRequest()) assertCurrentRequest();
                    // Preflight telemetry (lens mode): the solo run is validated
                    // exactly like a debate seat and its pass/fail is recorded
                    // to provider fitness, but its output is never substituted —
                    // a solo transcript has no debate to absorb a NO CLAIM.
                    if (runLensConfig.enabled && provider.thoughtsKey) {
                        const soloGate = applyPreflightGate(result.finalOutput);
                        void recordPreflightResult(getActiveUsername(), provider.config.id, soloGate.passed);
                    }
                    const soloAiMessage: Message = {
                        id: `ai-${Date.now()}`, role: MessageRole.AI, text: result.finalOutput || result.thoughtProcess, createdAt: new Date().toISOString(), analysis: processNewAnalysis(result.analysis), sources: result.sources || [], outcome: TradeOutcome.PENDING, ocrModelUsed: userMessage.ocrModelUsed,
                        imageSummaries: userMessage.imageSummaries,
                        modelsUsed: { [provider.config.id]: provider.model },
                        thoughtProcesses: { [provider.config.id]: result.thoughtProcess },
                        isAccuracyMode: runAccuracyMode,
                        isLensMode: runLensConfig?.enabled ?? false,
                        // Always set tradingStyle regardless of Lens mode
                        tradingStyle: effectiveTradingStyle,
                        accuracySubMode: runAccuracyMode ? runAccuracySubMode : undefined,
                        // Multi-Timeframe Confluence from Hybrid Intelligence
                        confluenceData: freshHybridData?.confluence ? {
                            score: freshHybridData.confluence.score,
                            direction: freshHybridData.confluence.direction,
                            strength: freshHybridData.confluence.strength,
                            alignedSignals: freshHybridData.confluence.alignment,
                            conflictingSignals: freshHybridData.confluence.conflicts,
                            timeframeCount: 4 // 5m, 15m, 1h, 4h
                        } : undefined,
                    };
                    // Inject snapshot if available
                    if (freshHybridData) {
                        soloAiMessage.analysis!.marketSnapshot = freshHybridData;
                    }
                        updateRequestMessages(prev => [...prev, soloAiMessage]);

                    // Automation run: deliver the completed solo card.
                    if (isAutomationRun) {
                        options?.automation?.onMessage({ userMessage, aiMessage: soloAiMessage });
                    }

                    // === ThinkingStore: Persist the solo analysis reasoning ===
                    // Same training-data contract as the debate path (one
                    // analyst record per card) so the Think view and outcome
                    // correlation work for single-provider runs too.
                    try {
                        const username = getActiveUsername();
                        const now = new Date().toISOString();
                        const soloSplit = splitThinkingFromOutput(soloRawReasoning || result.thoughtProcess || '', result.finalOutput || '');
                        persistThinkingRecords([{
                            id: buildThinkingRecordId(getThinkingTradeId(soloAiMessage.analysis?.createdAt, soloAiMessage.id), provider.thoughtsKey, 'analyst'),
                            tradeId: getThinkingTradeId(soloAiMessage.analysis?.createdAt, soloAiMessage.id),
                            username,
                            provider: provider.thoughtsKey,
                            role: 'analyst',
                            modelName: provider.model,
                            reasoning: soloSplit.thinking,
                            finalOutput: soloSplit.output || undefined,
                            rawReasoning: soloRawReasoning || undefined,
                            messageId: soloAiMessage.id,
                            analysisJson: result.analysis ? JSON.stringify(result.analysis) : undefined,
                            confidence: result.analysis?.confidence,
                            probability: result.analysis?.probability,
                            analystLens: 'normal',
                            createdAt: now,
                        }]);
                    } catch (thinkingError) {
                        console.warn('[ThinkingStore] Error preparing thinking records:', thinkingError);
                    }
                }
            } else {
                // Casual chat: use the user-selected model when it maps to a
                // ready provider; otherwise fall back to the first ready
                // provider (previous behavior).
                // ── Bot Mode G1: inside a bot's 1:1 thread, the send runs
                // AS the bot — its exact provider+model, its persona system
                // prompt, and only its own thread's history (threads are
                // derived views; threadForProvider is the same slice the
                // rail renders). Outside bot threads activeBot is null and
                // behavior is unchanged.
                const activeBot = getActiveBot?.() ?? null;
                const botProvider = activeBot
                    ? providerConfigs.find(c => c.id === activeBot.providerId && c.isEnabled && c.apiKey.trim().length > 0 && c.models.includes(activeBot.modelId))
                    : undefined;
                const useBotThread = Boolean(activeBot && botProvider);
                const chosen = useBotThread && activeBot && botProvider
                    ? botProvider
                    : providerConfigs.find(c =>
                        isProviderReady(c) && (c.selectedModel === selectedChatModel || c.models.includes(selectedChatModel))
                    );
                const provider = chosen
                    ? { config: { ...chosen, selectedModel: useBotThread && activeBot ? activeBot.modelId : selectedChatModel }, name: chosen.name, model: useBotThread && activeBot ? activeBot.modelId : selectedChatModel, useImages: false, thoughtsKey: chosen.id }
                    : enabledProviders[0];
                setLoadingMessage("Thinking...");
                setIsAnalysisInProgress(true);
                startStep('analysis');
                // Stream the reply into the bubble as it generates (perceived
                // speed) instead of appending it once after completion.
                const streamingMessageId = `ai-${Date.now()}`;
                casualMessageId = streamingMessageId;
                casualErrorAttribution = { [provider.config.id]: provider.model };
                updateRequestMessages(prev => [...prev, {
                    id: streamingMessageId,
                    role: MessageRole.AI,
                    text: '',
                    createdAt: new Date().toISOString(),
                    modelsUsed: { [provider.config.id]: provider.model },
                    isStreaming: true,
                }]);
                let reasoningContent = '';
                let visibleContent = '';
                const responseText = await streamQuickResponse(
                    provider.config,
                    promptToSend,
                    // Bot threads see ONLY their own thread (derived view);
                    // ordinary casual chat keeps the full conversation.
                    useBotThread && activeBot
                        ? threadForProvider(currentMessages, activeBot.providerId, activeBot.modelId)
                        : currentMessages,
                    useBotThread && activeBot ? activeBot.systemPrompt : undefined,
                    currentAbortController.signal,
                    reasoning => {
                        reasoningContent += reasoning;
                        throttledCasualStream(requestConversationId, streamingMessageId, visibleContent, reasoningContent, provider.config.id, true);
                    },
                    delta => {
                        visibleContent += delta;
                        throttledCasualStream(requestConversationId, streamingMessageId, visibleContent, reasoningContent, provider.config.id, true);
                    },
                );
                if (!isCurrentRequest()) assertCurrentRequest();
                // Split before display: native CoT and any leaked scratchpad
                // belong in the bubble's Thinking row, never in the reply.
                const casualSplit = splitThinkingFromOutput(reasoningContent, responseText);
                // Casual chat is a single-model conversation. Do not store the
                // answer as an individual insight; that creates an oversized
                // "Individual AI Insights" section under ordinary replies.
                updateMessages(prev => prev.map(m => m.id === streamingMessageId ? {
                    ...m,
                    text: casualSplit.output,
                    isStreaming: false,
                    modelsUsed: { [provider.config.id]: provider.model },
                    thoughtProcesses: casualSplit.thinking ? { [provider.config.id]: casualSplit.thinking } : undefined,
                } : m), requestConversationId);
                throttledCasualStream.flush();
                // ── Bot Mode G1: hand the settled reply (raw, markers
                // included) to the mailbox — it strips [[dm:@…]] markers
                // from the bubble and delivers the DMs. Fire-and-forget.
                if (useBotThread && activeBot && onBotReply) {
                    try { onBotReply(streamingMessageId, casualSplit.output || responseText); } catch { /* mailbox must never break the reply */ }
                }
            }
        } catch (error: any) {
            // Runs for BOTH errors and user cancels. Previously the
            // `!isCurrentRequest()` early-return skipped this cleanup on abort,
            // leaving the placeholder stuck as isDebating:true with a permanent
            // "thinking" indicator until the next reload.
            //
            // Only a true abort of THIS run's own signal is a cancellation.
            // `!isCurrentRequest()` also returns true when a NEWER run simply
            // replaced the abort-controller ref — labeling that run's genuine
            // error as "cancelled" silently swallowed real failures.
            const cancelled = currentAbortController.signal.aborted;
            if (!cancelled) failStep(currentPhaseRef.current);
            // A pending replacement wait is void — a late click on the banner
            // must never resolve into a dead debate.
            replacementChoiceRef.current = null;
            // Preserve the debate transcript when the debate was interrupted —
            // never wipe a debate that already produced turns. A bare
            // placeholder (no turns yet) is still removed.
            updateRequestMessages(prev => prev.map(m => {
                // A live-streaming casual bubble must settle on cancel/error —
                // keep whatever text already arrived, drop the streaming flag.
                if (casualMessageId && m.id === casualMessageId) {
                    if (!m.text.trim()) return null;
                    return { ...m, isStreaming: false };
                }
                if (m.id === ensemblePlaceholder?.id && m.ensembleProgress) {
                    return {
                        ...m,
                        isDebating: false,
                        activeDebateSpeakers: {},
                        liveToolEvents: undefined,
                        text: cancelled ? 'The analysis was cancelled.' : 'The ensemble could not continue before the debate started.',
                        ensembleProgress: {
                            ...m.ensembleProgress,
                            moderator: { status: 'error', error: cancelled ? 'Cancelled by user.' : 'The ensemble could not continue before the debate started.' },
                        },
                    };
                }
                if (!m.isDebating) return m;
                if ((m.debateTurns?.length ?? 0) === 0) return null;
                return {
                    ...m,
                    isDebating: false,
                    activeDebateSpeakers: {},
                    liveToolEvents: undefined,
                    replacementOffer: undefined,
                    // An interrupted verdict may be incomplete — never leave a
                    // provisional card standing in for a final one.
                    provisionalAnalysis: undefined,
                    provisionalPlanFields: undefined,
                    text: cancelled ? 'The analysis was cancelled.' : 'The debate was interrupted by an error before the moderator could issue a final verdict.',
                };
            }).filter((m): m is Message => m !== null));

            // User cancels / stale runs get no error bubbles.
            if (cancelled) return;

            // Rate limits first — isQuotaError also claims status === 429, so
            // the dedicated rate-limit path below was previously unreachable.
            if (error.status === 429 || (error.message && error.message.includes('Too Many Requests'))) {
                setIsRateLimited(true);
                // Auto-clear after a backoff so a later run isn't blocked
                // forever (the old reset sat behind an early-return guard).
                // Capture this run's controller so a stale timer from a
                // previous run can never clear the flag on a newer run.
                const rateLimitRunController = currentAbortController;
                window.setTimeout(() => {
                    if (analysisAbortController.current === rateLimitRunController) {
                        setIsRateLimited(false);
                    }
                }, 60_000);
                return;
            }

            if (isQuotaError(error)) {
                const quotaModelNames = buildModelIdToName(providerConfigs);
                let flaggedModel = '';
                enabledProviders.forEach(p => {
                    if (error.message.toLowerCase().includes(p.name.toLowerCase()) || error.model === p.model) {
                        flaggedModel = quotaModelNames[p.model] || p.model;
                    }
                });
                updateRequestMessages(prev => [...prev, { id: `err-${Date.now()}`, role: MessageRole.SYSTEM, createdAt: new Date().toISOString(), text: `Model "${flaggedModel || 'an enabled AI'}" has exceeded its usage quota.` }]);
                return;
            }

            // Offline sends are queued and re-dispatched on reconnect instead
            // of landing as a dead error bubble (the queue was previously
            // wired to the header badge but nothing ever enqueued).
            if (typeof navigator !== 'undefined' && !navigator.onLine) {
                try {
                    await offlineQueue.add({ type: 'analysis', payload: { prompt: effectiveInput, images: imagesToUse.map(img => img.dataURL) } });
                    updateRequestMessages(prev => [...prev, { id: `err-${Date.now()}`, role: MessageRole.SYSTEM, createdAt: new Date().toISOString(), text: "You're offline — this analysis was queued and will run automatically when you're back online." }]);
                    return;
                } catch (queueErr) {
                    console.warn('[Pipeline] Failed to queue offline request:', queueErr);
                }
            }

            // Sanitize the fallback: never leak long key-like tokens (API keys)
            // and cap length so internal SDK errors stay readable but bounded.
            const rawMessage = error instanceof Error ? error.message : "An unknown error occurred.";
            const safeMessage = rawMessage.replace(/\b[A-Za-z0-9_-]{24,}\b/g, '***').slice(0, 500);
            // retryOf lets the error bubble rebuild the exact prompt + charts
            // (the send cleared the composer immediately, so a failure left
            // the user with no way to re-run the same setup).
            updateRequestMessages(prev => [...prev, { id: `err-${Date.now()}`, role: MessageRole.SYSTEM, createdAt: new Date().toISOString(), text: safeMessage, retryOf: { userMessageId: userMessage.id }, modelsUsed: casualErrorAttribution }]);

            // Automation runs surface failures through their own callback
            // (the error bubble above lands in the private list).
            if (isAutomationRun) {
                options?.automation?.onError?.(safeMessage || 'Automation run failed.');
            }
        } finally {
            endPromptLane();
            stopTokenUsage?.();
            automationSilentRef.current = false;
            if (analysisAbortController.current === currentAbortController) {
                setLoadingMessage(null);
                // Cancelling during the hybrid fetch skipped setIsHybridLoading
                // (the assert threw before it) — reset here so the panel
                // spinner can't spin until the next run.
                setIsHybridLoading(false);
                // NOTE: the old finally force-completed every running step,
                // masking debate-phase errors and cancellations as "complete".
                // Failures are marked by the catch above; success paths already
                // complete their own steps.
                analysisAbortController.current = null;
                analysisConversationIdRef.current = null;
                setIsAnalysisInProgress(false);
                analysisInFlightRef.current = false;
            }
        }
    }, [input, images, loadingMessage, finalTradeSummary, activeFrameworks, isRateLimited, providerConfigs, isDeepAnalysis, selectedOcrModel, updateMessages, moderatorConfig, moderatorModel, memoryConfig, activeConversationId, activeConversation, isAnalysisInProgress, globalMemory, isGlobalMemoryEnabled, isAccuracyModeEnabled, accuracySubMode, customInstructions, isPlaybookEnabledInPureAI, isFamiliesEnabledInPureAI, isMemoryEnabledInPureAI, lensConfig, isHybridIntelligenceEnabled, isEnsembleEnabled, selectedChatModel, loggedTrades, confidenceCalibration, insightKnowledgeBase, currentHybridData, tradeSummaries, customEnsemblePrompt, customLensPrompts, ensembleModelSelection, isStrategiesEnabled, confirmDialog, toast]);

    // ─── Cancel Analysis ───────────────────────────────────────────────────
    const handleCancelAnalysis = () => {
        if (analysisAbortController.current) {
            analysisAbortController.current.abort();
                setLoadingMessage(null);
            setIsAnalysisInProgress(false);
            setIsPostMortemInProgress(false);
            setIsLivePostMortemVisible(false);
            analysisInFlightRef.current = false;
        }
    };

    // ─── Chat Management ───────────────────────────────────────────────────
    const handleClearChat = async () => {
        const ok = confirmDialog
            ? await confirmDialog({ title: 'Clear chat?', message: 'Clear current chat messages?', destructive: true })
            : confirm('Clear current chat messages?');
        if (ok) updateMessages(() => []);
    };

    const handleDeleteMessages = async (ids: string[]) => {
        // F1: message deletion gets a 5s undo like every other destructive
        // clear in the app (conversations, trade history, analyses).
        const prevMessages = messagesRef.current;
        const ok = confirmDialog
            ? await confirmDialog({
                title: 'Delete messages?',
                message: `Delete ${ids.length} messages?`,
                destructive: true,
                undoGraceMs: 5000,
                onUndo: () => {
                    updateMessages(() => [...prevMessages]);
                    toast.success?.('Messages restored');
                },
            })
            : confirm(`Delete ${ids.length} messages?`);
        if (ok) updateMessages(prev => prev.filter(m => !ids.includes(m.id)));
    };

    return {
        // State
        input, setInput,
        images, setImages,
        loadingMessage, setLoadingMessage,
        analysisSteps, setAnalysisSteps,
        currentVisionData, setCurrentVisionData,
        isDeepAnalysis, setIsDeepAnalysis,

        // Refs
        analysisAbortController,

        // Step tracking helpers
        initAnalysisSteps,
        startStep,
        completeStep,
        failStep,
        addSubStep,

        // Handlers
        handleSendMessage,
        handleCancelAnalysis,
        handleClearChat,
        handleDeleteMessages,
        getActiveCustomInstructions,
        // Mid-debate analyst replacement: the user picks a candidate (or
        // passes null to continue without) from the debate banner.
        handleReplacementChoice,
        steeringNotes,
        handleRemoveSteeringNote: (index: number) => {
            steeringQueueRef.current = steeringQueueRef.current.filter((_, i) => i !== index);
            setSteeringNotes(steeringQueueRef.current);
        },
        // Steer or bench one seat mid-debate.
        handleSteerSeat: (seatName: string, note: string) => {
            seatSteeringRef.current[seatName] = note;
            toast.success?.(`Queued for ${seatName}`, 'Applied at that seat\'s next turn.');
        },
        handleStopSeat: (seatName: string) => {
            stoppedSeatsRef.current.add(seatName);
            toast.success?.(`${seatName} stopped`, 'The debate continues without them at the next round.');
        },
    };
}
