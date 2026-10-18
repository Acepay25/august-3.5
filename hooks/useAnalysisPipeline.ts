import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
    Message, MessageRole, TradeOutcome, LoggedTrade, ImageMetadata,
    DebateTurn, Conversation, TradeAnalysis, TradeSummary,
    GlobalMemory, AccuracySubMode, CustomInstructionsMap, CustomInstruction,
    AnalystLensConfig, AnalysisStep, InsightKnowledgeBase, ConfidenceCalibration,
    ReplacementOffer, PatternMemoryGateView,
} from '../types';

import { ProviderConfig } from '../types/provider';
import { analyzeTradingView, streamQuickResponse } from '../services/providers/GenericAnalysisService';
import type { ToolAction } from '../types/message';
import { WireAuditEntry, type ReasoningEffort } from '../services/providers/reasoningControls';
import { defaultToolsForRole } from '../types/bot';
import { getActiveUsername } from '../utils/activeUser';
import { getBots, getGroups, AgentTeamSeat } from '../services/agents/agentRoster';

// Analysis / validation / backtesting services
import { tryFetchHybridDataFromPromptWithCalibration, generateHybridPromptInjection, HybridDataPacket } from '../services/analysis/HybridIntelligenceService';
import { extractSymbolFromPrompt } from '../services/analysis/MarketDataService';
import { LabeledMonteCarloResult } from '../services/analysis/MonteCarloService';
import { type LiveBacktestResult } from '../services/backtesting/LiveBacktestService';
import { getGateAnalysis, GateOutput } from '../services/validation/GateKeeperService';

// Utils
import { TokenUsage } from '../utils/tokenUsage';
import { saveThinkingBatch } from '../services/infrastructure/ThinkingStoreService';
import { offlineQueue } from '../services/infrastructure/OfflineQueueService';
import { ThinkingRecord } from '../types/thinking';
import { splitThinkingFromOutput } from '../utils/thinkingSplit';
import { chatModelIdOf, isProviderReady, resolveChatModelSelection } from '../utils/providerUtils';
import { buildDecisionReflectionContext } from '../services/learning/DecisionReflectionService';
import { getEnabledStrategiesText } from '../services/infrastructure/StrategyService';
import { assemblePipelineMemoryContext } from './analysisPipeline/memoryContext';
import { useStreamThrottlers } from './analysisPipeline/streamThrottlers';
import { isNotebookQuickSaveRequest, runNotebookQuickSave } from './analysisPipeline/notebookQuickSave';
import { classifyRunFailure, mapRunFailureMessages, resolveQuotaFlaggedModel, sanitizeFallbackErrorMessage } from './analysisPipeline/runOutcome';
import { runChatSurfaceTurn } from '../services/trade/chatSurfaceTurn';
import { automationSeatFor, runAutomationTurn } from '../services/trade/automationTurn';
import { appendToolActions } from '../utils/toolActions';
import type { ToolTurnOutcome } from '../services/trade/toolTurn';
import type { PredicateGateResult } from '../services/learning/skillPredicateGate';

// ─── Dev-only logging ─────────────────────────────────────────────────────
// console.log calls are gated behind the Vite dev flag so production builds
// stay clean. console.error / console.warn are kept unconditionally (genuine
// faults must always surface).
const devLog = (...args: unknown[]) => { if ((import.meta as any).env?.DEV) console.log(...args); };

// Ensemble openings launch each seat this many ms apart. Free-tier gateways
// dedupe/cache CONCURRENT near-identical requests (the three openings share
// ~99% of their payload once the hybrid envelope is in); staggering breaks
// the simultaneous-identical window those caches key on.
/** How stale a prior run's packet may be and still be reused instead of
 *  re-fetched. `dataTimestamp` is when the assembly ran, so this is a FLOOR on
 *  the real age — every cell inside it additionally carries up to its own REST
 *  cache window. Reusing a minutes-old packet was the worst link in the chain:
 *  automation and follow-up runs got the previous tape labelled "real-time". */
const HYBRID_REUSE_MAX_AGE_MS = 60_000;

// Learning services
import { generateWeightedVotingContext } from '../services/backtesting/ModelPerformanceService';
import { threadForProvider } from '../utils/agentThreads';
import { formatInvokedSkillSection, resolveInvokedSkills } from '../services/learning/SkillMemoryService';
import { recordRegimeDay, marketRegimeToLedger } from '../services/learning/regimeLedger';
import { EnsembleModelSelection } from '../services/ui/AnalystLensService';
import { buildHybridEnvelope } from '../utils/debateEnvelopes';
import { extractDebateTemplate, DebateTemplate } from '../utils/debateTemplates';
import { parseComposerIntent, formatComposerSteer } from '../utils/composerMentions';
import { beginPromptLane, endPromptLane } from '../services/infrastructure/PromptOverrideService';
import { buildEnsembleAnalysts } from '../services/ui/EnsembleAnalystService';
import { getEffectiveStyle } from '../services/ui/TradingStyleDetector';
import GlobalLearningService from '../services/learning/GlobalLearningService';
import { parseDmMarkers } from '../services/agents/botMailbox';
import { classifyStepError, describeStepError } from '../utils/runStatus';
import { notify } from '../services/infrastructure/notify';

// ─── Run Outcome ──────────────────────────────────────────────────────────────

/**
 * What `handleSendMessage` resolves with once the run ENDS. The offline
 * queue's replay callback is the consumer that makes this load-bearing:
 * `processQueue` awaits the callback before dequeuing, and an analysis that
 * fails INTERNALLY lands in the catch and lands an error bubble instead of
 * throwing — without an outcome flag the replayed item was consumed by a
 * failed run (audit 2026-09-15 §2.3 residual). App maps `ok:false` to a
 * throw so the queue's existing retryCount/MAX_RETRIES backoff applies.
 *
 * `ok:false` means "this attempt did not produce a completed analysis and
 * the work is worth retrying": the generic provider/pipeline error (error
 * bubble), the 429 rate-limit branch, the quota branch, and the pre-run
 * team/config blocks (no providers ready, missing moderator, incomplete
 * roster — retried with backoff, dropped after MAX_RETRIES, since the queue
 * item would otherwise vanish silently, which is the very bug).
 * `ok:true` covers a completed run, a user CANCEL (deliberate stop — a
 * retry would fight the user), a superseded/replaced run, a send parked
 * into the steering queue, a notebook quick-save short-circuit, and the
 * offline branch that re-queued the analysis as a FRESH item.
 */
export interface ChatRunOutcome {
    ok: boolean;
}

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
    /** ── Bot Mode ──
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
        setHybridConnectionStatus,
        isAnalysisInProgress, setIsAnalysisInProgress,
        isHybridLoading, setIsHybridLoading,
        isRateLimited, setIsRateLimited,
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
        /** model side-effects from this seat's desk tools. */
        onToolAction?: (action: ToolAction) => void;
    }

    
    // ─── State ─────────────────────────────────────────────────────────────
    const [input, setInput] = useState('');
        const [images, setImages] = useState<ImageMetadata[]>([]);
    const [loadingMessage, setLoadingMessage] = useState<string | null>(null);
    const [analysisSteps, setAnalysisSteps] = useState<AnalysisStep[]>([]);
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
    // Latest handleSendMessage closure, for the queued-send drain effect at
    // the bottom of this hook — the drain fires after commit, so it must
    // call through the freshest closure, not the one that started the run.
    // Assigned after handleSendMessage below.
    const drainSendRef = useRef<((text?: string) => Promise<ChatRunOutcome>) | null>(null);
    // Which pipeline phase is running — used to fail the CORRECT step when a
    // run errors (the old catch hardcoded failStep('analysis'), so debate-phase
    // failures marked the wrong step and the finally force-completed everything).
    const currentPhaseRef = useRef<'analysis' | 'debate'>('analysis');

    // ─── RAF-throttled casual-chat stream update ──────────────────────────
    // The four debate writers this call used to hand back died with the
    // ensemble engine; see hooks/analysisPipeline/streamThrottlers.ts.
    const {
                                throttledCasualStream,
            } = useStreamThrottlers({ updateMessages });

    useEffect(() => {
        const requestConversationId = analysisConversationIdRef.current;
        if (requestConversationId === null || requestConversationId === activeConversationId) return;

        analysisAbortController.current?.abort();
        analysisAbortController.current = null;
        analysisConversationIdRef.current = null;
        analysisInFlightRef.current = false; // keep the double-submit guard consistent
        // Parked sends belong to the conversation they were typed in — the
        // queue is memory, not an outbox. Leaving them would drain into the
        // WRONG conversation when the abort settles.
        steeringQueueRef.current = [];
        setSteeringNotes([]);
        setLoadingMessage(null);
        setIsAnalysisInProgress(false);
        setAnalysisSteps([]);
    }, [activeConversationId]);

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

    /**
     * Mark a step failed, WITH A REASON.
     *
     * `reason` is what the user sees expanded. Before the step type had an
     * error field the UI could only paint a red ✕, and the only place the
     * message existed at all was a chat bubble that rendered raw provider
     * text. Every failure path should pass the error it is reacting to.
     */
    const failStep = (id: string, reason?: unknown) => {
        if (automationSilentRef.current) return;
        const classified = reason === undefined
            ? { kind: 'unknown' as const, text: describeStepError('unknown') }
            : classifyStepError(reason);
        setAnalysisSteps(prev => prev.map(s => s.id === id
            ? { ...s, status: 'error' as const, endTime: Date.now(), errorKind: classified.kind, errorText: classified.text }
            : s));
    };

    /** Mark a step the user stopped. Neutral, not a failure. */
    const stopStep = (id: string) => {
        if (automationSilentRef.current) return;
        setAnalysisSteps(prev => prev.map(s => s.id === id
            ? { ...s, status: 'stopped' as const, endTime: Date.now(), errorKind: 'cancelled', errorText: describeStepError('cancelled') }
            : s));
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
        /** The instrument the SURFACE is currently showing, used only when the
         *  prompt names no coin. Naming a coin in the text still wins — the
         *  picker says where you are looking, it does not override what you
         *  just asked about. */
        symbol?: string;
        interval?: string;
        /** The composer's thinking tier for a casual (non-debate) turn, read
         *  off the active chat session by the surface that sent. `'auto'` and
         *  an omitted value both mean the task default, so every caller that
         *  never shows a dial keeps exactly the request it was making before.
         *  The debate ignores it: each seat's effort comes from the role
         *  schedule (`EFFORT_BY_TASK`), not from a composer. */
        reasoningEffort?: ReasoningEffort;
        /** Stage 20f: the trader pressed FULL ANALYSIS. With the ensemble toggle
         *  off this is what turns the desk arm's casual turn into a turn that is
         *  TOLD to look things up and CHECKED for having done so — the surviving
         *  half of the old keyword trigger, with the keyword gone (20c). */
        fullAnalysis?: boolean;
    }): Promise<ChatRunOutcome> => {
        const isAutomationRun = !!options?.automation;
        // Run-scoped mode/model overrides — automation runs may specify
        // their own accuracy mode, lens config, analyst picks and moderator
        // (fall back to the global settings when absent).
        const runAccuracyMode = options?.automation?.overrides?.accuracyMode ?? isAccuracyModeEnabled;
        const runAccuracySubMode = options?.automation?.overrides?.accuracySubMode ?? accuracySubMode;
        const runLensConfig = options?.automation?.overrides?.lensConfig ?? lensConfig;
        const runEnsembleSelection = options?.automation?.overrides?.ensembleModelSelection ?? ensembleModelSelection;
        const runModeratorConfig = options?.automation?.overrides?.moderatorConfig ?? moderatorConfig;
        const runModeratorModel = options?.automation?.overrides?.moderatorModel ?? moderatorModel;
        // Stage 20r: a scheduled run is NO LONGER forced onto the debate. The
        // flag used to be true whenever this was an automation, whatever the
        // trader had switched — which meant stage 19 could not delete the engine
        // without taking the scheduler down with it. The route a schedule takes
        // now is its own tool turn (the arm at the fork below), so this flag
        // answers the question it always should have: does THIS SEND use the
        // ensemble mode?
        const runEnsembleEnabled = isEnsembleEnabled;

        // ── Composer + hybrid snapshots ──────────────────────────────────
        // These three used to be dependencies of this callback, which is the
        // wrong shape twice over: `input` and `images` change on every
        // keystroke and attachment, and `currentHybridData` changes on every
        // hybrid stream frame, so the function identity churned continuously
        // and took every downstream memo and effect down with it.
        //
        // Snapshotted HERE, at the top of the send, rather than read through a
        // ref (the `composerModeRef` precedent). A ref would be correct for the
        // composer — it is read before any await — and WRONG for
        // `currentHybridData`, which is read at the hybrid-reuse decision and
        // again in the pipeline call, both of which sit AFTER the
        // `runNotebookQuickSave` await. A ref there would swap the packet
        // captured when the trader pressed send for whatever the stream had
        // produced by then, quietly changing which market data reaches the
        // models. A local captures at exactly the moment the old closure did,
        // so this is behaviour-identical and the dep array gets smaller.
        const composerInput = input;
        const composerImages = images;
        const hybridAtSend = currentHybridData;

        const isSummarizing = composerImages.some(img => img.isLoading);

        if (isAnalysisInProgress || analysisInFlightRef.current) {
            // Drafting stays enabled during a run, but a send attempt while a
            // debate is live must not silently eat the message (the composer
            // only disables during loadingMessage, which is null mid-debate).
            // The words park in steeringQueueRef and render as faded queued
            // bubbles above the composer — no toast, the bubbles ARE the
            // receipt. At the next debate step they steer in-run; anything
            // still parked when the run ends drains as one follow-up turn
            // (see the drain effect). Automation runs skip queueing — the
            // scheduler checks the in-flight state itself before firing.
            if (!isAutomationRun) {
                const draft = typeof customPrompt === 'string' ? customPrompt : composerInput;
                if (draft.trim()) {
                    const intent = parseComposerIntent(draft.trim());
                    steeringQueueRef.current = [...steeringQueueRef.current, formatComposerSteer(intent) || draft.trim()];
                    setSteeringNotes(steeringQueueRef.current);
                    setInput('');
                }
            }
            // Parked into the steering queue (it WILL run against the live
            // debate or as the end-of-run drain) — consumed, not failed.
            return { ok: true };
        }

        // --- ROUTING LOGIC: Standard vs Accuracy Mode ---
        // Ensemble participants are model-level entries, not just provider
        // entries. This allows several models from one provider while keeping
        // each result and reasoning trace separate.
        // Build the analyst list (model-level entries). Extracted to a pure
        // helper so the N-1 failure path is unit-testable; stale lens-assignment
        // model ids are resolved against each provider's current model list.
        const { analysts: enabledProviders } = buildEnsembleAnalysts(
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
                        // Role-scoped desk tools: a seat with a built-in team role inherits
        // that role's tool preset (macro/technical/risk) on its opening;
        // unroled seats, teamless runs, and Lens mode keep the FULL toolset
        // (undefined) — personas never mix with the Lens engine.
                // Legacy mandate rotation (ad-hoc ensembles, no active team). Hoisted
        // so the mid-debate replacement path can mirror the initial seats.
        
        // The staged analyst cards this flag used to gate are gone with the
        // ensemble engine: nothing renders `ensembleProgress`, and the placeholder
        // row it minted had no settle path.

        let effectiveInput = '';
        if (typeof customPrompt === 'string') {
            effectiveInput = customPrompt;
        } else if (typeof composerInput === 'string') {
            effectiveInput = composerInput;
        }
        // Debate template marker ([[Scalp check]] etc.) — extract before the
        // composer-intent parse so the marker never reaches the models.
                // /slug skill invocations, captured before the steer-rewrite folds
        // the message into prose — resolved into actual skill content below
        // (a name alone teaches the seats nothing).
                {
            const extracted = extractDebateTemplate(effectiveInput);
            if (extracted.template) {
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
        const imagesToUse = followSource ? [] : (customImages || composerImages);

        // Nothing ran: a live loading/summarize state, a rate-limit flag, or
        // an empty payload. A replay hitting this must stay queued (the
        // transient block will clear; an empty item dies at MAX_RETRIES) —
        // ok:false so App's callback throws and the backoff path applies.
        if (loadingMessage || isSummarizing || (!effectiveInput.trim() && imagesToUse.length === 0) || isRateLimited) return { ok: false };

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
            // Config block, not a completed run — ok:false keeps a replayed
            // item on the queue's backoff path (dropped at MAX_RETRIES).
            return { ok: false };
        }

        // Moderator pre-flight belongs to the one path that still reads that
        // pick: a scheduled run takes its answering seat from it (`automationSeatFor`
        // below). A human send answers from the composer's own selection — one
        // model, :1368 — so refusing a click over an unused moderator config is a
        // block with nothing behind it. The check stays where the config is read.
        if (isAutomationRun && !isProviderReady(runModeratorConfig)) {
            appendBlockedRunNotice(
                'This schedule has no model to answer with: pick a moderator model (Settings → AI Models), make sure it is enabled and has an API key, then run this again.'
            );
            return { ok: false };
        }

        // ─── TRADER NOTEBOOK QUICK-SAVE ────────────────────────────────
        // "Save this to the notebook" short-circuits the ensemble: no chart
        // analysis, just the notebook write + a confirmation message. The
        // model reads the current notebook index and decides skip / append /
        // create (see writeNotebookNoteFromRequest).
        if (!isAutomationRun && isNotebookQuickSaveRequest(effectiveInput)) {
            await runNotebookQuickSave(effectiveInput, {
                provider: memoryConfig || enabledProviders[0]?.config,
                setLoadingMessage,
                messagesRef,
                updateMessages,
                activeConversationId,
            });
            // The notebook quick-save completed (or reported its own failure
            // in-chat) — this was never an analysis run; consume it.
            return { ok: true };
        }
        // The seat-completeness refusals are gone with the debate. Only ONE
        // model answers a send (`provider`, below), so "your analyst team is
        // incomplete", "analysts must use different models" and "two debate
        // seats share a model" all blocked a run over a roster the run never
        // uses — identical prompts through identical models cannot happen here,
        // because there is only one prompt and one model. The TEAM_MAX_SEATS
        // ceiling went for the same reason: it existed to stop N× fan-out, and
        // nothing fans out since the engine was deleted.

        // Live-backtest summary (block-scoped result is captured here so the
        // final message update below can persist it on runStats).
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
        // nudge toward including a coin, not a hard block. A surface that
        // ALREADY has an instrument selected is not a bare greeting, so it must
        // not be nagged about one it is effectively supplying.
        if (!isAutomationRun && runEnsembleEnabled && imagesToUse.length === 0 && !canResume
            && !extractSymbolFromPrompt(effectiveInput) && !options?.symbol) {
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

        // The staged-ensemble PLACEHOLDER is gone. The tool turn writes its own
        // canonical row (`streamingMessageId`, below), so this row was a second
        // one appended beside the answer — and after the debate engine was
        // deleted nothing had a settle path for it: a staged send left an empty
        // bubble in the transcript permanently. `runOutcome` keyed its
        // cancel/error text on this row's `ensembleProgress`, and that guard goes
        // with it, so an interrupted run settles the answer row and nothing else.
        updateRequestMessages(prev => [...prev, userMessage]);
        // Automation runs must not clear the composer (the user may be
        // mid-draft while a scheduled run fires).
        if (!isAutomationRun) {
            setInput('');
            setImages([]);
        }

        
        // Only claim the hybrid fetch when the feature is ON — the old
        // condition spun the HybridDataPanel for the whole run even with the
        // toggle off (the skip path never reset it).
        //
        // Guard against cross-symbol contamination: cached hybrid data from a
        // previous analysis (e.g. BTC) must never feed a different coin
        // (e.g. ETH) — the wrong prices/ATR/regime would be injected into the
        // analyst prompts and persisted onto the new trade card.
        // EXPLICIT WINS, then the words, then the instrument the user picked in
        // the surface. The picker has to reach the analysis or it is decoration:
        // asking "what is BTC doing?" while ETH is selected must analyse BTC, but
        // asking a question that names no coin must analyse what the user
        // selected rather than fetching nothing.
        const detectedSymbol = extractSymbolFromPrompt(effectiveInput) ?? options?.symbol ?? null;
        const cachedHybridAgeMs = hybridAtSend
            ? Date.now() - new Date(hybridAtSend.dataTimestamp).getTime()
            : Number.POSITIVE_INFINITY;
        const cachedHybridData = hybridAtSend
            && detectedSymbol
            && hybridAtSend.symbol === detectedSymbol
            && Number.isFinite(cachedHybridAgeMs)
            && cachedHybridAgeMs <= HYBRID_REUSE_MAX_AGE_MS
            ? hybridAtSend
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

        // eslint-disable-next-line no-useless-assignment -- consumed by the verdictFinalizer input below; the cluster owns the lane attribution now.
                // Id of the live-streaming casual-chat bubble (if this run is a casual
        // reply) so the catch block can settle it on cancel/error instead of
        // leaving a stuck isStreaming placeholder.
        let casualMessageId: string | null = null;
        // Casual chats attribute their error bubble to the provider that was
        // tried (modelsUsed), so a failed 1:1 bot reply surfaces INSIDE that
        // bot's thread instead of vanishing from the scoped view.
        let casualErrorAttribution: Record<string, string> | undefined;
        // Automation runs redirect message writes to a private list and mute
        // the chat UI (loading text, step tracker, hybrid panel). The flag is
        // set HERE — after every pre-flight early return — not at the top of
        // the function: an automation that exits early (in-flight park, 429,
        // no ready provider, blocked roster) used to leave it `true` and mute
        // the step tracker of the manual run that was concurrently in flight.
        // The `finally` below resets it, so set+reset are now paired.
        automationSilentRef.current = isAutomationRun;
        if (isAutomationRun) automationMessagesRef.current = [];
        try {
            const currentMessages = isAutomationRun
                ? [...(options?.automation?.conversation.messages ?? []), userMessage]
                : [...messagesRef.current, userMessage];
                        // Debate template steering rides the custom instructions so every
            // seat + the moderator see the framing (Scalp / Swing / Devil's
            // advocate / Risk-only).
            // Invoked notebook skills (/slug) resolve to their ACTUAL content
            // and ride the same lane — OpenBot's skills-as-system-turn shape:
            // "apply skill X" without skill X's text is a wish, not an
            // instruction. Missing slugs are stated, never silently dropped.
                        
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
            
            // Coin detection for learning context: match only uppercase
            // tickers (no /i flag, which would match any word) and exclude
            // common command words, mirroring the GateKeeper commonWords
            // exclusion list. Hoisted ABOVE the moderator bundle so the
            // journal-driven accuracy blocks can join it.
            // TRADER NOTEBOOK stage (extracted): notebook slices, bot
            // memory, similar-setups record, regime weighting, loss priming.
            const {
                                detectedLearningCoin,
                pendingDirection,
                pendingPattern,
                memoryFilesContext,
                                                                similarSetupsContext,
                                                asOfMs: memoryAsOfMs,
            } = await assemblePipelineMemoryContext(
                effectiveInput,
                loggedTrades,
                freshHybridData ?? null,
                userMessage.id,
                undefined,
                // One window value for every seat that reads this slice (it
                // rides analyst AND moderator prompts): the memory model's own
                // window decides, and windowBudgetTokens' floor keeps a tiny
                // window from zeroing memory out entirely.
                memoryConfig?.contextWindowTokens,
            );

            // ── CODE-CHECKED SKILL TRIGGERS ──
            // Retrieval answers which skills are RELEVANT; a predicate answers
            // whether a relevant skill's own trigger is TRUE on the current bar.
            // That second question used to be settled by a seat reading prose,
            // which is precisely what a deterministic check should replace.
            // Evaluated over candles KlineService already caches (30s with
            // in-flight de-dupe), so in the common case this is not an extra
            // round trip. Best-effort by design: any failure leaves the run
            // byte-for-byte as it was before predicates existed.
            let predicateGate: PredicateGateResult | null = null;
            if (detectedLearningCoin) {
                const gateSymbol = /USDT?$/i.test(detectedLearningCoin)
                    ? detectedLearningCoin.toUpperCase()
                    : `${detectedLearningCoin.toUpperCase()}USDT`;
                try {
                    const { evaluateSkillPredicates } = await import('../services/learning/skillPredicateGate');
                    predicateGate = await evaluateSkillPredicates({
                        coin: gateSymbol,
                        // Same guards retrieval applies: the gate must not
                        // clamp a Long verdict with a Short skill, and a
                        // replay run must not read bars that had not closed
                        // yet at its own cutoff.
                        direction: pendingDirection,
                        asOfMs: memoryAsOfMs,
                        runId: userMessage.id,
                    });
                } catch (err) {
                    console.warn('[PredicateGate] skipped:', err);
                    predicateGate = null;
                }
            }

            // One context bundle for every moderator surface (autoplay debate,
            // real debate, accuracy verification, compact retry): the same
            // chart/pattern block the analysts see + the user strategies.
            
            // 'auto' trading style was hardcoded to 'swing' at every call
            // site — the market-data detector (ADX/regime/volume/session)
            // was never invoked. Resolve the effective style ONCE from the
            // live data so the lens prompts, the rebuttal personas and the
            // card's tradingStyle field all agree. Falls back to swing when
            // no hybrid data exists (hybrid off / fetch failed).

            // AI LEARNING: the old UnifiedLearningBuilder channel is
            // RETIRED — its six overlapping profile/mistake/insight injections
            // fought the budgeted notebook slice above (two memory voices is
            // exactly the degradation mode the simplification killed).
            // What survives is the one thing the notebook slice cannot produce:
            // per-provider historical accuracy weighting (weighted voting), fed
            // to BOTH the analysts and the moderator. Gated on a real closed
            // trade sample so fresh installs get clean prompts.
            let learningInjection = '';
            // Separate context for moderator surfaces

            const closedSample = loggedTrades.filter(
                t => t.outcome === TradeOutcome.WIN || t.outcome === TradeOutcome.LOSS,
            ).length;
            if (closedSample >= 3 && enabledProviders.length > 0) {
                try {
                    learningInjection = generateWeightedVotingContext(
                        enabledProviders.map(p => p.config.id),
                        pendingPattern || undefined,
                    );
                    if (learningInjection) {
                        devLog('[AI Learning] Weighted-voting context generated:', learningInjection.length, 'chars');
                    }
                } catch (learningError) {
                    console.error('[AI Learning] Failed to generate weighted-voting context:', learningError);
                }
            }

            // Retrieved harness context already carries similar trades + skills.
            // Do not also dump the pattern-memory essay or raw insight list.

            let recentInsightsString: string | null = null;
            if (!memoryFilesContext && tradeSummaries && tradeSummaries.length > 0) {
                const top10Summaries = tradeSummaries.slice(0, 10);
                recentInsightsString = top10Summaries.map((s, idx) => `${idx + 1}. [${new Date(s.timestamp).toLocaleDateString()}] ${s.summaryText}`).join('\n\n');
                devLog('[Recent Insights] Generated from tradeSummaries array, length:', recentInsightsString.length);
            }

            // Enhance prompt with memory files, similar setups, hybrid data AND learning context
            let enhancedPrompt = promptToSend;
            if (memoryFilesContext || similarSetupsContext || learningInjection || predicateGate?.note) {
                const contextParts: string[] = [];
                if (memoryFilesContext) contextParts.push(memoryFilesContext);
                if (similarSetupsContext) contextParts.push(similarSetupsContext);
                if (learningInjection) contextParts.push(learningInjection);
                if (predicateGate?.note) contextParts.push(predicateGate.note);
                enhancedPrompt = `${contextParts.join('\n\n')}\n\n${promptToSend}`;
            }

            // ========== GATE KEEPER: Two-Stage Gate Scan ==========
            // The authoritative symbol is the one detected at the top of the
            // run: extractSymbolFromPrompt (canonical pair extraction), then
            // the surface's instrument picker. This block used to re-detect
            // with a case-insensitive scan whose stopword check was
            // case-SENSITIVE — a lowercase prompt like "what is the plan for
            // btc today" minted "WHATUSDT" and ran the gate scan on a
            // nonexistent market — and it shadowed the picker value, which
            // then never reached the gate scan, the veto ledger or the
            // coin-lessons block.
            const finalSymbol = detectedSymbol;

            // ========== DECISION REFLECTIONS ==========
            // Feed the user's closed trades + lessons back into the NEXT run
            // (TradingAgents/Reflexion loop): the model reasons with actual
            // outcomes for this ticker, not only generic extracted rules.
            try {
                const reflectionBlock = buildDecisionReflectionContext(loggedTrades, finalSymbol);
                if (reflectionBlock) {
                    enhancedPrompt = `${reflectionBlock}

${enhancedPrompt}`;
                }
            } catch { /* reflection is best-effort */ }

            const gateInjection = '';
            // Local variable to avoid state closure issue
            
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

            // ── What the SEND IS decides the branch; what it SAYS never did ────
            // This gate used to test the prompt text for LIVE MARKET / STRATEGY /
            // ANALYZE / CHART / SETUP, plus the image and update facts. Read
            // closely, the five wording tests could not change a human send's
            // route: this predicate was ANDed with `runEnsembleEnabled`, and
            // `isEnsembleEnabled` also appeared INSIDE the predicate — so with the
            // toggle on every send ran the pipeline whatever its wording, and with
            // it off no wording could make one run it. The one route wording
            // controlled was a scheduled run's, where `isAutomationRun` supplied
            // the flag: the same automation answered casually when its prompt read
            // "outlook" and fully when it read "setup", against this flag's own
            // documented intent ("Automations always run the ensemble pipeline").
            // Deleting the wording therefore changes exactly one thing — a
            // scheduled run is an analysis run, always — and leaves a send with
            // the toggle off as casual chat even with a screenshot attached, which
            // is what it already was. The verdict, the levels and the journal row
            // are now reachable as TOOLS from the casual arm (stage 20's point);
            // the branch below is the mode's, not the prompt's, and stage 19
            // deletes it.
            if (isAutomationRun) {
                // ── 20r: A SCHEDULED RUN ANSWERS WITH ITS TOOLS ────────────────
                // The arm sits BEFORE the mode fork, not inside it, so one config
                // has exactly one behaviour: the trader's ensemble toggle changes
                // what a human send does and never what a schedule does. The run
                // keeps the four properties stage 20t pinned — private thread
                // (`automationMessagesRef`, built by `useAutomations`), its own
                // continuity (the history in `currentMessages`), its own model
                // pick (`automationSeatFor`), and a verdict row a human can act
                // on — and gains two it never had: a ration on how many plans a
                // schedule may present, and a failure the card cannot hide.
                const automationId = options?.automation?.automationId ?? '';
                const seat = automationSeatFor(
                    runModeratorConfig ?? undefined,
                    runModeratorModel,
                    [
                        ...(runEnsembleSelection ?? []),
                        // Lens-mode configs carry their picks as role
                        // assignments, not as an ensemble selection.
                        ...(runLensConfig?.enabled
                            ? (runLensConfig.assignments ?? []).map(a => ({ providerId: a.assignedProvider, model: a.assignedModel }))
                            : []),
                    ],
                    providerConfigs,
                );
                if (!seat) {
                    // A schedule with no ready model is a FAILURE the trader sees,
                    // not a run that silently produced nothing.
                    options?.automation?.onError?.(
                        'No AI model is ready for this schedule: its configured provider is disabled, has no API key, or no longer offers that model. Re-pick it in the automation editor.',
                    );
                    return { ok: false };
                }
                setIsAnalysisInProgress(true);
                const turnStartedAt = Date.now();
                const out = await runAutomationTurn({
                    config: seat.config,
                    history: currentMessages,
                    prompt: promptToSend,
                    // A replayed chart from "repeat the last manual analysis" is
                    // SENT, as a real image part — the same contract the Chat
                    // surface got in 20b.
                    image: dataURLs[0],
                    symbol: finalSymbol ?? options?.symbol ?? null,
                    interval: options?.interval,
                    trades: loggedTrades,
                    username: getActiveUsername(),
                    automationId,
                    signal: currentAbortController.signal,
                    startedAt: turnStartedAt,
                });
                // A Stop on a scheduled run lands in the existing cancel path
                // (`cancelled` → `{ ok: true }` → the scheduler settles it as
                // 'skipped'), so a cut run is never written as if it finished.
                if (!isCurrentRequest()) assertCurrentRequest();
                const scheduleText = [out.text, ...out.notices].filter(part => part.trim()).join('\n\n');
                const scheduleMessage: Message = {
                    id: `ai-${Date.now()}`,
                    role: MessageRole.AI,
                    text: scheduleText,
                    createdAt: new Date().toISOString(),
                    modelsUsed: { [seat.config.id]: seat.model },
                    thoughtProcesses: out.reasoning.trim() ? { [seat.config.id]: out.reasoning } : undefined,
                    liveToolEvents: out.toolLines.length ? { desk: out.toolLines.join('\n') } : undefined,
                    injectedSkills: out.skills.length ? out.skills : undefined,
                    ...(out.proposal ? { proposal: out.proposal, planId: out.proposal.planId } : {}),
                    runStats: {
                        runId: `schedule-${userMessage.id}`,
                        startedAt: new Date(turnStartedAt).toISOString(),
                        finishedAt: new Date(turnStartedAt + out.workedMs).toISOString(),
                        durationMs: out.workedMs,
                    },
                    imageSummaries: userMessage.imageSummaries,
                };
                // The side-effect ledger rides through the ONE cap helper, so a
                // schedule's rows are trimmed exactly like a chat row's.
                const aiMessage = appendToolActions([scheduleMessage], scheduleMessage.id, out.actions)[0];
                updateRequestMessages(prev => [...prev, aiMessage]);
                options?.automation?.onMessage({
                    userMessage,
                    aiMessage,
                    ...(out.notices.length ? { notices: out.notices } : {}),
                });
                return { ok: true };
            }
            // Casual chat: use the user-selected model when it maps to a
            // ready provider; otherwise fall back to the first ready
            // provider (previous behavior).
            // ── Bot Mode: inside a bot's 1:1 thread, the send runs
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
            // The composer selection is provider-qualified
            // (`providerId::modelId`) so a model name offered by two
            // providers answers from the one the user actually picked.
            // Legacy bare ids resolve heuristically (see providerUtils).
            const chosen = useBotThread && activeBot && botProvider
                ? botProvider
                : resolveChatModelSelection(providerConfigs, selectedChatModel) ?? undefined;
            const chatModel = useBotThread && activeBot ? activeBot.modelId : chatModelIdOf(selectedChatModel);
            const provider = chosen
                ? { config: { ...chosen, selectedModel: chatModel }, name: chosen.name, model: chatModel, useImages: false, thoughtsKey: chosen.id }
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
            // ONE live writer for both shapes of this branch: the
            // RAF-coalesced casual updater, so a tool turn's per-token paint
            // costs one Message write per frame exactly like the plain one.
            const paint = (text: string, thinking: string): void => {
                throttledCasualStream(requestConversationId, streamingMessageId, text, thinking, provider.config.id, true);
            };
            // The bubble's own stamp: a Stop, a failure and a clean finish
            // must all report the same "worked for Ns", not each measure from
            // their own `Date.now()`.
            const turnStartedAt = Date.now();
            let toolTurn: ToolTurnOutcome | null = null;
            let responseText = '';
            if (useBotThread && activeBot) {
                // BOTS STAY CHAT-ONLY (stage 20 ruling). The roster
                // answers with its persona over the plain transport;
                // `useBotMailbox`, `botRoutine` and `groupRounds` are
                // deliberately NOT moved onto the tool turn.
                responseText = await streamQuickResponse(
                    provider.config,
                    promptToSend,
                    // Bot threads see ONLY their own thread (derived view).
                    threadForProvider(currentMessages, activeBot.providerId, activeBot.modelId, activeBot.id),
                    activeBot.systemPrompt,
                    currentAbortController.signal,
                    reasoning => {
                        reasoningContent += reasoning;
                        paint(visibleContent, reasoningContent);
                    },
                    delta => {
                        visibleContent += delta;
                        paint(visibleContent, reasoningContent);
                    },
                    // The dial the surface is showing, not the task default: a
                    // chip that displayed a tier while the request sent `'low'`
                    // is the dead affordance this argument exists to remove.
                    options?.reasoningEffort,
                );
            } else {
                // THE DESK ANSWERS WITH ITS TOOLS — the one executor the
                // Chart AI dock runs, writing this canonical row instead of
                // a dock entry. Ordinary conversation on this surface used
                // to be answered from the model's training data while the
                // dock looked the same question up.
                toolTurn = await runChatSurfaceTurn({
                    config: provider.config,
                    history: currentMessages,
                    prompt: promptToSend,
                    // An attached screenshot is SENT, not mentioned: before
                    // this the camera on this surface painted a bubble the
                    // model never received.
                    image: dataURLs[0],
                    symbol: finalSymbol ?? options?.symbol ?? null,
                    interval: options?.interval,
                    trades: loggedTrades,
                    effort: options?.reasoningEffort,
                    requireTools: options?.fullAnalysis === true,
                    signal: currentAbortController.signal,
                    startedAt: turnStartedAt,
                    patch: fn => updateMessages(
                        prev => prev.map(m => (m.id === streamingMessageId ? fn(m) : m)),
                        requestConversationId,
                    ),
                    paint,
                });
                responseText = toolTurn.text;
            }
            if (!isCurrentRequest()) assertCurrentRequest();
            // Split before display: native CoT and any leaked scratchpad
            // belong in the bubble's Thinking row, never in the reply. The
            // tool turn already did this on its own accumulator (`runToolTurn`
            // owns the peel so both homes settle the same way), so re-splitting
            // its output would be a second opinion about the same text.
            const casualSplit = toolTurn
                ? { output: toolTurn.text, thinking: toolTurn.reasoning }
                : splitThinkingFromOutput(reasoningContent, responseText);
            // Strip [[dm:@…]] markers BEFORE the first persisted update:
            // the mailbox delivery below is fire-and-forget, so without
            // this the bubble shows raw marker text until the mailbox's
            // own patch lands (and forever if it throws). The mailbox
            // still receives the RAW text — it needs the markers to route.
            const casualClean = parseDmMarkers(casualSplit.output).clean.trim();
            // Casual chat is a single-model conversation. Do not store the
            // answer as an individual insight; that creates an oversized
            // "Individual AI Insights" section under ordinary replies.
            // Flush BEFORE the settle write, never after. A chunk that
            // arrived between the last animation frame and here is still
            // pending; flushing after the settle re-applies it and puts
            // `isStreaming: true` and the un-stripped live text back onto
            // the message that was just settled — permanently.
            throttledCasualStream.flush();
            updateMessages(prev => prev.map(m => m.id === streamingMessageId ? {
                ...m,
                // A deliberate Stop keeps the half-written answer the trader
                // chose to cut; a clean turn keeps the settled text.
                text: toolTurn?.interrupted ? (m.text || casualClean) : casualClean,
                isStreaming: false,
                modelsUsed: { [provider.config.id]: provider.model },
                thoughtProcesses: casualSplit.thinking ? { [provider.config.id]: casualSplit.thinking } : undefined,
                ...(toolTurn && !toolTurn.interrupted ? {
                    runStats: {
                        runId: `desk-${streamingMessageId}`,
                        startedAt: new Date(turnStartedAt).toISOString(),
                        finishedAt: new Date(turnStartedAt + toolTurn.workedMs).toISOString(),
                        durationMs: toolTurn.workedMs,
                    },
                } : {}),
                // The tools-off / reasoning-only truth belongs IN the
                // transcript, beside the lines that claim it — not in a toast
                // that disappears while the answer stays on screen.
                ...(toolTurn?.notice ? {
                    liveToolEvents: {
                        ...m.liveToolEvents,
                        desk: [m.liveToolEvents?.desk, toolTurn.notice].filter(Boolean).join('\n'),
                    },
                } : {}),
            } : m), requestConversationId);
            // ── Completion notice for a run the trader asked for by name.
            // Before stage 19 this fired from the verdict finalizer; with the
            // finalizer out of the send path a Full analysis could finish in the
            // background and say nothing, which is how an unattended 40-second
            // turn becomes a tab the trader waits in. Scoped to the explicit
            // request and to turns that were not stopped, so an ordinary chat
            // line stays quiet and a cancelled one does not announce itself.
            // Schedules are excluded — nobody is watching them live, and 20r
            // already lands their outcome in the run's own row.
            if (options?.fullAnalysis === true && toolTurn && !toolTurn.interrupted) {
                void notify(
                    'Analysis complete',
                    `${provider.config.name} · ${provider.model} answered in `
                        + `${(toolTurn.workedMs / 1000).toFixed(1)}s — open the app to read it.`,
                    { tag: streamingMessageId },
                );
            }
            // ── Bot Mode: hand the settled reply (raw, markers
            // included) to the mailbox — it strips [[dm:@…]] markers
            // from the bubble and delivers the DMs. Fire-and-forget.
            if (useBotThread && activeBot && onBotReply) {
                try { onBotReply(streamingMessageId, casualSplit.output || responseText); } catch { /* mailbox must never break the reply */ }
            }
            // End of the try — the run completed (or, for automation runs,
            // delivered through its own onMessage callback). Success.
            return { ok: true };
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
            // A user Stop is not a failure — it gets the neutral 'stopped'
            // chrome. Only a real error carries the rose treatment, and now
            // carries the reason with it.
            if (cancelled) stopStep(currentPhaseRef.current);
            else failStep(currentPhaseRef.current, error);
            // A pending replacement wait is void — a late click on the banner
            // must never resolve into a dead debate.
            replacementChoiceRef.current = null;
            // Preserve the debate transcript when the debate was interrupted —
            // never wipe a debate that already produced turns. A bare
            // placeholder (no turns yet) is still removed.
            updateRequestMessages(prev => mapRunFailureMessages(prev, { cancelled, casualMessageId }));

            // User cancels / stale runs get no error bubbles. A deliberate
            // Stop (or a superseded run) is NOT a retryable failure —
            // ok:true lets a queued replay of it dequeue instead of fighting
            // the user with a backoff retry.
            if (cancelled) return { ok: true };

            const failureKind = classifyRunFailure(error);
            // Rate limits first — isQuotaError also claims status === 429, so
            // the dedicated rate-limit path below was previously unreachable.
            if (failureKind === 'rate-limit') {
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
                // Transient — a queued replay must RETRY with backoff.
                return { ok: false };
            }

            if (failureKind === 'quota') {
                const flaggedModel = resolveQuotaFlaggedModel(error, providerConfigs, enabledProviders);
                updateRequestMessages(prev => [...prev, { id: `err-${Date.now()}`, role: MessageRole.SYSTEM, createdAt: new Date().toISOString(), text: `Model "${flaggedModel || 'an enabled AI'}" has exceeded its usage quota.` }]);
                return { ok: false };
            }

            // Offline sends are queued and re-dispatched on reconnect instead
            // of landing as a dead error bubble (the queue was previously
            // wired to the header badge but nothing ever enqueued). The
            // username is passed EXPLICITLY at the enqueue site so the item's
            // profile stamp never depends on the queue module's marker being
            // fresh — processQueue replays only the active user's items.
            // (Kept inline: tests/offlineQueueCompletion.test.ts pins this
            // enqueue site's shape by source contract.)
            if (typeof navigator !== 'undefined' && !navigator.onLine) {
                try {
                    await offlineQueue.add({ type: 'analysis', username: getActiveUsername(), payload: { prompt: effectiveInput, images: imagesToUse.map(img => img.dataURL) } });
                    updateRequestMessages(prev => [...prev, { id: `err-${Date.now()}`, role: MessageRole.SYSTEM, createdAt: new Date().toISOString(), text: "You're offline — this analysis was queued and will run automatically when you're back online." }]);
                    // Re-queued as a FRESH item — this attempt is done; let
                    // the replayed original dequeue (no duplicate retry).
                    return { ok: true };
                } catch (queueErr) {
                    console.warn('[Pipeline] Failed to queue offline request:', queueErr);
                }
            }

            // Sanitize the fallback: never leak long key-like tokens (API keys)
            // and cap length so internal SDK errors stay readable but bounded.
            const safeMessage = sanitizeFallbackErrorMessage(error instanceof Error ? error.message : "An unknown error occurred.");
            // retryOf lets the error bubble rebuild the exact prompt + charts
            // (the send cleared the composer immediately, so a failure left
            // the user with no way to re-run the same setup).
            updateRequestMessages(prev => [...prev, { id: `err-${Date.now()}`, role: MessageRole.SYSTEM, createdAt: new Date().toISOString(), text: safeMessage, retryOf: { userMessageId: userMessage.id }, modelsUsed: casualErrorAttribution }]);

            // Automation runs surface failures through their own callback
            // (the error bubble above lands in the private list).
            if (isAutomationRun) {
                options?.automation?.onError?.(safeMessage || 'Automation run failed.');
            }
            // The generic error-bubble path: the analysis FAILED internally.
            // ok:false is what keeps an offline-queue replay on the
            // retry/backoff path instead of dequeuing a dead run (§2.3).
            return { ok: false };
        } finally {
            endPromptLane();
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
            // NOTE: queued sends are NOT drained here. The drain (see the
            // effect below) keys on the isAnalysisInProgress false-transition
            // AFTER React commits, because this closure's captured state is
            // stale — draining here would start the next run with a
            // mid-run-era closure. When a drain does start a new run before
            // this finally executes (fast cancel), the ownership guard above
            // sees a replaced controller and skips this cleanup — the new run
            // owns the state from there on.
        }
    }, [loadingMessage, finalTradeSummary, activeFrameworks, isRateLimited, providerConfigs, isDeepAnalysis, selectedOcrModel, updateMessages, moderatorConfig, moderatorModel, memoryConfig, activeConversationId, activeConversation, isAnalysisInProgress, globalMemory, isGlobalMemoryEnabled, isAccuracyModeEnabled, accuracySubMode, customInstructions, isPlaybookEnabledInPureAI, isFamiliesEnabledInPureAI, isMemoryEnabledInPureAI, lensConfig, isHybridIntelligenceEnabled, isEnsembleEnabled, selectedChatModel, loggedTrades, confidenceCalibration, insightKnowledgeBase, tradeSummaries, customEnsemblePrompt, customLensPrompts, ensembleModelSelection, isStrategiesEnabled, confirmDialog, toast]);

    // ─── Cancel Analysis ───────────────────────────────────────────────────
    const handleCancelAnalysis = () => {
        if (analysisAbortController.current) {
            analysisAbortController.current.abort();
                setLoadingMessage(null);
            setIsAnalysisInProgress(false);
            analysisInFlightRef.current = false;
        }
    };

    // ─── Chat Management ───────────────────────────────────────────────────
    const handleClearChat = async (conversationId?: string) => {
        const ok = confirmDialog
            ? await confirmDialog({ title: 'Clear chat?', message: 'Clear current chat messages?', destructive: true })
            : confirm('Clear current chat messages?');
        // An explicit id clears THAT conversation — the Chat rail's row menu
        // clears a row without loading it first. Default stays the active one.
        if (ok) updateMessages(() => [], conversationId ?? null);
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

    // ─── Queued-send drain: the run ends, the queue runs ───────────────────
    // Everything parked while a run was live drains as ONE follow-up turn
    // when the run ends — however it ended. Settling is not the same as
    // succeeding: a complete, errored, or user-stopped run all drain, which
    // is what makes Stop a way of steering rather than a way of giving up
    // (park a correction, press Stop, and the correction is what runs next).
    // One turn and not one per message, newline-joined: three quick
    // corrections are usually one correction typed in three breaths. Keyed on
    // the isAnalysisInProgress FALSE-TRANSITION — not on run completion —
    // so it fires after React has committed the idle state and the send runs
    // with a fresh closure. A conversation switch clears the queue first (the
    // switch effect above), so parked words never drain into the wrong
    // thread; the queue is memory in one mount, not an outbox.
    drainSendRef.current = handleSendMessage;
    const wasRunActiveRef = useRef(false);
    useEffect(() => {
        if (isAnalysisInProgress) {
            wasRunActiveRef.current = true;
            return;
        }
        if (!wasRunActiveRef.current) return;
        wasRunActiveRef.current = false;
        const queuedDrain = steeringQueueRef.current;
        if (queuedDrain.length === 0) return;
        steeringQueueRef.current = [];
        setSteeringNotes([]);
        void drainSendRef.current?.(queuedDrain.join('\n'));
    }, [isAnalysisInProgress]);

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
