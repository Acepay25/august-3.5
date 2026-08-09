import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
    Message, MessageRole, TradeOutcome, LoggedTrade, ImageMetadata,
    DebateTurn, Conversation, TradeAnalysis, TradeSummary,
    GlobalMemory, AccuracySubMode, CustomInstructionsMap, CustomInstruction,
    AnalystLensConfig, AnalysisStep, InsightKnowledgeBase, ConfidenceCalibration,
    ReplacementOffer,
} from '../types';

import { ProviderConfig } from '../types/provider';
import { analyzeTradingView, getQuickResponse } from '../services/providers/GenericAnalysisService';
import * as ensembleService from '../services/providers/ensembleService';

// Analysis / validation / backtesting services
import { tryFetchHybridDataFromPromptWithCalibration, generateHybridPromptInjection, HybridDataPacket, runMonteCarloForSetupAsync } from '../services/analysis/HybridIntelligenceService';
import { extractSymbolFromPrompt } from '../services/analysis/MarketDataService';
import { LabeledMonteCarloResult } from '../services/analysis/MonteCarloService';
import { backtestSimilarSetups } from '../services/backtesting/LiveBacktestService';
import { runValidationGate } from '../services/validation/TradeValidationGate';
import { getGateAnalysis, GateOutput } from '../services/validation/GateKeeperService';

// Utils
import { isQuotaError } from '../utils/errorUtils';
import { recalculateAnalysisMetrics, sanitizeTradeAnalysis, clampProbabilityToGate } from '../utils/analysisUtils';
import { saveThinkingBatch, generateThinkingId, getThinkingTradeId } from '../services/infrastructure/ThinkingStoreService';
import { notifyAnalysisComplete } from '../services/infrastructure/CompletionNotifications';
import { ThinkingRecord } from '../types/thinking';
import { extractLastJson } from '../utils/jsonUtils';
import { sanitizeAIResponse } from '../utils/sanitizers';
import { buildModelIdToName, isProviderReady } from '../utils/providerUtils';
import { DEFAULT_LEVERAGE } from '../utils/conversationUtils';
import { loadLearningRules } from '../services/learning/LearningRulesService';
import { StructuredRule } from '../types';
import {
    getCachedResponse, cacheResponse, getImageHash, hashString,
} from '../services/infrastructure/responseCache';
import { COMMON_WORDS } from '../constants/commonWords';
import { useRafThrottle } from './useRafThrottle';

// ─── Dev-only logging ─────────────────────────────────────────────────────
// console.log calls are gated behind the Vite dev flag so production builds
// stay clean. console.error / console.warn are kept unconditionally (genuine
// faults must always surface).
const devLog = (...args: unknown[]) => { if ((import.meta as any).env?.DEV) console.log(...args); };

// Learning services
import { generateLearningFromPrompt, isLearningEnabled } from '../services/learning/LearningPromptService';
import { generatePersonalizedInjection } from '../services/ui/PersonalizedPromptService';
import { PriceAlertService } from '../services/ui/PriceAlertService';
import { buildUnifiedLearningContext } from '../services/learning/UnifiedLearningBuilder';
import { ANALYST_ROLE_DEFINITIONS, getLensPromptForStyle, getRoleForProvider } from '../services/ui/AnalystLensService';
import { buildEnsembleAnalysts, buildAnalystFailureReport } from '../services/ui/EnsembleAnalystService';
import { EnsembleModelSelection } from '../services/ui/AnalystLensService';
import GlobalLearningService from '../services/learning/GlobalLearningService';

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
    // Casual-chat model: used when ensemble is off; falls back to the first
    // ready provider's model when empty/stale.
    selectedChatModel: string;

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
const minePatternFromPrompt = (prompt: string): string | undefined => {
    const p = prompt.toUpperCase();
    if (p.includes('FAMILY A') || p.includes('EXHAUSTION') || p.includes('TRAP') || p.includes('FAKEOUT')) return 'Family A';
    if (p.includes('FAMILY B') || p.includes('REVERSAL')) return 'Family B';
    if (p.includes('FAMILY C') || p.includes('CONTINUATION')) return 'Family C';
    if (p.includes('OMEGA') || p.includes('MOMENTUM')) return 'Family Omega';
    return undefined;
};

// ─── Hook ──────────────────────────────────────────────────────────────────────

export function useAnalysisPipeline(params: UseAnalysisPipelineParams) {
    const {
        messages, messagesRef, updateMessages, activeConversation, activeConversationId,
        providerConfigs,
        selectedOcrModel,
        moderatorConfig, moderatorModel,
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
        isGlobalMemoryEnabled, customInstructions,
        isPlaybookEnabledInPureAI, isFamiliesEnabledInPureAI, isMemoryEnabledInPureAI,
        isHybridIntelligenceEnabled, lensConfig, activeFrameworks,
        ensembleModelSelection,
        customEnsemblePrompt,
        customLensPrompts,
        isEnsembleEnabled,
        selectedChatModel,
        toast,
        confirmDialog,
    } = params;

    // ─── P1-4: Response cache wrapper ─────────────────────────────────────
    // Wraps a provider's analyzeTradingView call with a short-TTL response
    // cache. Re-analyzing the same chart (same images + prompt + model) within
    // 10 minutes returns the cached result instantly instead of re-OCRing,
    // re-encoding images to base64, and re-calling the API. Cache hits are
    // logged so they're visible during debugging.
    /** Named parameters for cachedAnalyzeTradingView — replaces the fragile
     *  `...rest: any[]` positional access. Every caller passes these by name
     *  so adding/removing/renrolling fields is caught at compile time. */
    interface CacheableAnalysisParams {
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
        onReasoning: (reasoning: string) => void;
    }

    const cachedAnalyzeTradingView = useCallback(async (
        config: ProviderConfig,
        model: string,
        prompt: string,
        imageFiles: File[],
        dataURLs: string[],
        signal: AbortSignal | undefined,
        params: CacheableAnalysisParams,
    ): Promise<{ thoughtProcess: string; finalOutput: string; analysis: any; sources?: any[] }> => {
        // Build cache key from image hashes + prompt + model. The hash comes
        // from the actual image BYTES (the dataURLs) — keying by File
        // name:size:lastModified let two different charts re-exported with
        // identical metadata collide and serve each other's analysis.
        const imageHashes = dataURLs.length > 0
            ? dataURLs.map(url => getImageHash(url))
            : ['no-images'];

        // Everything that alters the model input beyond the prompt itself must
        // be part of the key: deep analysis, accuracy submode, role/custom
        // prompts, custom instructions, learning flags, pattern-memory summary,
        // recent insights, global memory, and thread context. Hashing keeps the
        // key short. Without this a 10-minute-TTL hit serves an analysis
        // computed under DIFFERENT instructions for the same chart.
        // OCR image summaries, the recent chat-history tail (bounded —
        // full-history hashing would run on every call) and the provider
        // identity (config.id) are folded in too: two providers exposing the
        // same model id, or a re-analysis after a different vision model
        // re-OCR'd the chart, must not share entries.
        // Message IDs are deliberately excluded from the history fingerprint:
        // every send creates a fresh `user-<Date.now()>` id, so including ids
        // made the tail differ on EVERY run — the same-chart repeat (the
        // whole point of the 10-min TTL) could never hit the cache.
        const historyFingerprint = hashString(JSON.stringify(
            params.chatHistory?.slice(-10).map(m => `${m.role}:${(m.text || '').slice(0, 200)}`) || []
        ));
        const modeContext = hashString(JSON.stringify([
            params.deepenAnalysis, params.subMode, params.rolePrompt, params.systemPromptOverride,
            params.finalTradeSummary, params.recentInsights, params.globalMemory, params.threadSummary,
            params.customInstructions, params.isPlaybookEnabledInPureAI, params.isFamiliesEnabledInPureAI, params.isMemoryEnabledInPureAI,
            params.activeFrameworks,
            params.imageSummaries,
            historyFingerprint,                    // recent chat history (bounded)
            config.id,                             // provider identity
        ]));

        const cached = await getCachedResponse(imageHashes, prompt, model, modeContext);
        if (cached) {
            devLog(`[ResponseCache] HIT for ${config.name || model} (${model})`);
            // Replay the stored reasoning through onReasoning — a cache hit
            // otherwise left the live reasoning views and the thinking
            // record's rawReasoning empty for this run.
            if (cached.thoughtProcess) {
                params.onReasoning?.(cached.thoughtProcess);
            }
            return {
                thoughtProcess: cached.thoughtProcess,
                finalOutput: cached.finalOutput || cached.thoughtProcess,
                analysis: cached.analysis,
                sources: cached.sources,
            };
        }

        const result = await analyzeTradingView(config, {
            prompt,
            images: imageFiles,
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
            onReasoning: params.onReasoning,
        });

        // Only cache successful, non-empty results.
        if (result && result.analysis) {
            cacheResponse(imageHashes, prompt, model, {
                thoughtProcess: result.thoughtProcess,
                finalOutput: result.finalOutput,
                analysis: result.analysis,
                sources: result.sources,
            }, modeContext);
            devLog(`[ResponseCache] STORED for ${config.name || model} (${model})`);
        }

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
        activeSpeakers: Record<string, number>
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
            };
            const newMessages = [...prev];
            newMessages[messageIndex] = updatedMessage;
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

    // ─── RAF-throttled LIVE reasoning updates ─────────────────────────────
    // (removed: the Live Neural Analysis view that consumed these was
    // deleted; reasoning now lives in reasoningProcesses/thoughtProcesses)

    // ─── State ─────────────────────────────────────────────────────────────
    const [input, setInput] = useState('');
    const [images, setImages] = useState<ImageMetadata[]>([]);
    const [loadingMessage, setLoadingMessage] = useState<string | null>(null);
    const [analysisSteps, setAnalysisSteps] = useState<AnalysisStep[]>([]);
    const reasoningMapRef = useRef<Record<string, string>>({});
    const activeDebateSpeakersRef = useRef<Record<string, number>>({});
    const debateTurnsRef = useRef<DebateTurn[]>([]);
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
    const initAnalysisSteps = (steps: AnalysisStep[]) => {
        setAnalysisSteps(steps.map(s => ({ ...s, status: 'pending' as const, startTime: undefined, endTime: undefined })));
    };

    const startStep = (id: string) => {
        setAnalysisSteps(prev => prev.map(s => s.id === id ? { ...s, status: 'running' as const, startTime: Date.now() } : s));
    };

    const completeStep = (id: string) => {
        setAnalysisSteps(prev => prev.map(s => s.id === id ? { ...s, status: 'complete' as const, endTime: Date.now() } : s));
    };

    const failStep = (id: string) => {
        setAnalysisSteps(prev => prev.map(s => s.id === id ? { ...s, status: 'error' as const, endTime: Date.now() } : s));
    };

    const addSubStep = (id: string, subStep: { label: string; detail?: string; filename?: string }) => {
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
    const handleSendMessage = useCallback(async (customPrompt?: string, customImages?: ImageMetadata[], hiddenContext?: string, options?: { isUpdate?: boolean; updateInterval?: string; presetHybridData?: HybridDataPacket | null }) => {
        const isSummarizing = images.some(img => img.isLoading);

        if (isAnalysisInProgress || analysisInFlightRef.current) return;

        // --- ROUTING LOGIC: Standard vs Accuracy Mode ---
        // Ensemble participants are model-level entries, not just provider
        // entries. This allows several models from one provider while keeping
        // each result and reasoning trace separate.
        // Build the analyst list (model-level entries). Extracted to a pure
        // helper so the N-1 failure path is unit-testable; stale lens-assignment
        // model ids are resolved against each provider's current model list.
        const { analysts: enabledProviders, missingAnalystRoles, hasCompleteAnalystAssignments } = buildEnsembleAnalysts(
            providerConfigs,
            lensConfig,
            ensembleModelSelection,
            isEnsembleEnabled
        );

        // Accuracy mode runs the same per-analyst analysis phase, so the
        // staged analyst cards (status + live reasoning) apply there too —
        // previously the user only saw the single moderator stream.
        const isStagedEnsemble = isEnsembleEnabled && enabledProviders.length > 1;

        let effectiveInput = '';
        if (typeof customPrompt === 'string') {
            effectiveInput = customPrompt;
        } else if (typeof input === 'string') {
            effectiveInput = input;
        }

        // Determine images source (state or override)
        const imagesToUse = customImages || images;

        if (loadingMessage || isSummarizing || (!effectiveInput.trim() && imagesToUse.length === 0) || isRateLimited) return;

        // P0 fix: Surface a clear error when no AI providers are enabled.
        // Previously this returned silently, leaving the user with no feedback.
        if (enabledProviders.length === 0) {
            toast.error(
                "No AI Providers Enabled",
                "Add an API key in Settings → AI Models to start analyzing charts."
            );
            return;
        }
        if (isEnsembleEnabled) {
            // Role-assignment requirements only apply when Lenses are ON —
            // with Lenses off, the ordinary "Debate Models" picker (or the
            // per-provider ensemble models) determines the participants.
            if (lensConfig.enabled) {
                if (missingAnalystRoles.length > 0) {
                    toast.warning('Assign all analysts', `Assign ${missingAnalystRoles.map(role => ANALYST_ROLE_DEFINITIONS[role].shortName).join(', ')} before starting the ensemble.`);
                    return;
                }
                if (!hasCompleteAnalystAssignments) {
                    toast.warning('Distinct analyst models required', 'Each analyst role must use a different model. The same provider is allowed.');
                    return;
                }
            }
        }

        if (!isAccuracyModeEnabled && enabledProviders.length > 3) {
            toast.warning("Provider Limit", "A maximum of 3 AI providers can be enabled for an ensemble debate in Standard Mode. Please disable at least one.");
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
        // Bind every async message write to the conversation that started the
        // request. This remains correct even if the user switches conversations
        // before a provider response or stream chunk arrives.
        const requestConversationId = activeConversationId;
        const updateRequestMessages = (updater: (prevMessages: Message[]) => Message[]): void => {
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

        if (imagesToUse.length > 0) {
            const visionData = imagesToUse.map(img => img.fullAnalysisText || `Chart ${imagesToUse.indexOf(img) + 1}: No analysis text available.`);
            setCurrentVisionData(visionData);
        }

        const imageFiles = imagesToUse.map(meta => meta.file);
        const dataURLs = imagesToUse.map(meta => meta.dataURL);
        // UI displays the user input, but API may receive enhanced context
        const originalPrompt = effectiveInput;
        const promptToSend = hiddenContext ? `${hiddenContext}\n\nUser Input: "${effectiveInput}"` : effectiveInput;

        const ocrModelsUsed = [...new Set(imagesToUse.map(meta => meta.ocrModelUsed).filter(Boolean) as string[])];

        const userMessage: Message = {
            id: `user-${Date.now()}`,
            role: MessageRole.USER,
            text: originalPrompt,
            createdAt: new Date().toISOString(),
            images: dataURLs,
            imageSummaries: imagesToUse.map(meta => meta.summary).filter(Boolean) as string[],
            ocrModelUsed: ocrModelsUsed.join(','),
        };

        const ensembleMessageId = `ensemble-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
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
            createdAt: new Date().toISOString(),
            isDebating: false,
            debateTurns: [],
            ensembleProgress,
            ocrModelUsed: userMessage.ocrModelUsed,
            imageSummaries: userMessage.imageSummaries,
            modelsUsed: Object.fromEntries(enabledProviders.map(provider => [provider.config.id, provider.model])),
            isAccuracyMode: isAccuracyModeEnabled,
            isLensMode: lensConfig?.enabled ?? false,
            accuracySubMode: isAccuracyModeEnabled ? accuracySubMode : undefined,
            tradingStyle: (lensConfig?.enabled && lensConfig.tradingStyle !== 'auto') ? (lensConfig.tradingStyle as any) : (lensConfig?.enabled ? 'swing' : undefined),
        } : null;

        updateRequestMessages(prev => ensemblePlaceholder ? [...prev, userMessage, ensemblePlaceholder] : [...prev, userMessage]);
        setInput('');
        setImages([]);

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
        if (isEnsembleEnabled && isHybridIntelligenceEnabled && !cachedHybridData && !options?.presetHybridData) {
            setHybridConnectionStatus(prev => (prev === 'connected' ? 'connected' : 'connecting'));
            setIsHybridLoading(true);
            setCurrentHybridData(null);
        }
        let freshHybridData: HybridDataPacket | null = cachedHybridData;
        if (options?.presetHybridData) {
            setCurrentHybridData(options.presetHybridData);
            freshHybridData = options.presetHybridData;
            setIsHybridLoading(false);
        }

        try {
            const currentMessages = [...messagesRef.current, userMessage];
            const currentThreadSummary = activeConversation?.threadSummary;
            const memoryToInject = isGlobalMemoryEnabled ? globalMemory : undefined;
            const instructionsToUse = getActiveCustomInstructions();

            // These steps describe the ensemble analysis pipeline only. Casual
            // chat must not render analysis/fetching progress at all.
            if (isEnsembleEnabled) {
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
            if (isEnsembleEnabled && isHybridIntelligenceEnabled && !options?.presetHybridData) {
                try {
                    devLog('[Hybrid Intelligence] Attempting to fetch data for prompt:', effectiveInput);
                    setLoadingMessage('Fetching real-time market data...');
                    startStep('market-data');
                    const learningRules = loadLearningRules();
                    const hybridResult = await tryFetchHybridDataFromPromptWithCalibration(
                        effectiveInput,
                        GlobalLearningService.getCalibration(),
                        learningRules
                    );
                    if (!isCurrentRequest()) assertCurrentRequest();
                    setIsHybridLoading(false);
                    if (hybridResult) {
                        bayesianConfidenceCap = hybridResult.adjustedConfidence;
                        // Use enhanced injection which includes calibration data
                        hybridDataInjection = hybridResult.enhancedInjection || hybridResult.promptInjection;
                        setCurrentHybridData(hybridResult.data); // Store for UI display
                        freshHybridData = hybridResult.data; // Use local var downstream (state is stale in this closure)

                        // Store correlation risk if available - helpful for UI later
                        if (hybridResult.correlationRisk) {
                            devLog('[Hybrid Intelligence] Correlation Risk Score:', hybridResult.correlationRisk.correlationRiskScore);
                        }

                        devLog('[Hybrid Intelligence] SUCCESS - Got data for:', hybridResult.data.symbol);

                        devLog('[Hybrid Intelligence] Injection length:', hybridDataInjection.length);
                        devLog('[Hybrid Intelligence] Injection preview:', hybridDataInjection.substring(0, 500));
                    } else {
                        devLog('[Hybrid Intelligence] FAILED - No symbol detected in prompt');
                    }
                } catch (hybridError) {
                    if (!isCurrentRequest()) assertCurrentRequest();
                    setIsHybridLoading(false);
                    completeStep('market-data');
                    console.error('[Hybrid Intelligence] ERROR fetching market data:', hybridError);
                    toast.warning('Hybrid data unavailable', 'Market data fetch failed — analysis will proceed without real-time data.');
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

            // AI LEARNING: Generate UNIFIED learning context from all 6 learning services
            let learningInjection = '';
            let moderatorLearningContext = ''; // NEW: Separate context for moderator

            // Coin detection for learning context: match only uppercase tickers (no /i flag,
            // which would match any word) and exclude common command words, mirroring the
            // GateKeeper commonWords exclusion list further below.
            const learningCommonWords = COMMON_WORDS;
            const detectedCoinRaw = effectiveInput.match(/\b([A-Z]{2,10})(?:USDT?)?/)?.[1]?.toUpperCase();
            const detectedLearningCoin = detectedCoinRaw && !learningCommonWords.includes(detectedCoinRaw) ? detectedCoinRaw : undefined;

            // Use UnifiedLearningBuilder to consolidate all learning services
            const unifiedLearning = buildUnifiedLearningContext(
                loggedTrades,
                {
                    coin: detectedLearningCoin,
                    pattern: minePatternFromPrompt(effectiveInput),
                    direction: effectiveInput.toLowerCase().includes('long') ? 'Long' :
                        effectiveInput.toLowerCase().includes('short') ? 'Short' : 'Neutral'
                },
                enabledProviders.map(p => p.config.id),
                insightKnowledgeBase
            );

            if (!unifiedLearning.isEmpty) {
                learningInjection = unifiedLearning.forAnalysts;
                moderatorLearningContext = unifiedLearning.forModerator; // Store for moderator
                devLog('[AI Learning] Unified context generated - Analyst:', learningInjection.length, 'chars, Moderator:', moderatorLearningContext.length, 'chars');
            } else if (loggedTrades.length >= 3) {
                // Fallback to legacy personalized injection if unified fails
                try {
                    learningInjection = generatePersonalizedInjection(
                        loggedTrades,
                        detectedLearningCoin,
                        effectiveInput.toLowerCase().includes('long') ? 'Long' :
                            effectiveInput.toLowerCase().includes('short') ? 'Short' : 'Neutral'
                    );
                    if (learningInjection) {
                        devLog('[AI Learning] Fallback: personalized injection, length:', learningInjection.length);
                    }
                } catch (learningError) {
                    console.error('[AI Learning] Failed to generate personalized context:', learningError);
                }
            } else if (isLearningEnabled(loggedTrades)) {
                // Legacy fallback
                try {
                    learningInjection = generateLearningFromPrompt(
                        effectiveInput,
                        loggedTrades,
                        insightKnowledgeBase
                    );
                    if (learningInjection) {
                        devLog('[AI Learning] Fallback: legacy injection, length:', learningInjection.length);
                    }
                } catch (learningError) {
                    console.error('[AI Learning] Failed to generate learning context:', learningError);
                }
            }

            // PATTERN MEMORY: Use finalTradeSummary as the source for synthesized pattern memory
            const enhancedFinalTradeSummary = finalTradeSummary;

            // RECENT INSIGHTS: Construct string from individual trade summaries
            let recentInsightsString: string | null = null;
            if (tradeSummaries && tradeSummaries.length > 0) {
                const top10Summaries = tradeSummaries.slice(0, 10);
                recentInsightsString = top10Summaries.map((s, idx) => `${idx + 1}. [${new Date(s.timestamp).toLocaleDateString()}] ${s.summaryText}`).join('\n\n');
                devLog('[Recent Insights] Generated from tradeSummaries array, length:', recentInsightsString.length);
            }

            // Enhance prompt with hybrid data AND learning context if available
            let enhancedPrompt = promptToSend;
            if (hybridDataInjection || learningInjection) {
                const contextParts: string[] = [];
                if (hybridDataInjection) contextParts.push(hybridDataInjection);
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

            let gateInjection = '';
            let capturedGateResult: GateOutput | null = null; // Local variable to avoid state closure issue
            if (finalSymbol && isEnsembleEnabled) {
                try {
                    devLog(`[GateKeeper] Running Gate check for ${finalSymbol}...`);
                    setLoadingMessage('Running Gate Scan...');
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
                    toast.warning('Gate check skipped', 'Quality constraints could not be applied — analysis will proceed without gate validation.');
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
            if (isChartAnalysisRequested && isEnsembleEnabled) {
                const summaries = imagesToUse.map(meta => meta.fullAnalysisText).filter(Boolean) as string[];
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
                    // ========== END GATE KEEPER RESULT ==========

                    // ========== ACCURACY VALIDATION GATE ==========
                    // Always run validation gate to ensure quality checks
                    // The gate will handle gracefully when hybridData is null
                    try {
                        const validationResult = runValidationGate({
                            analysis: finalAnalysis,
                            hybridData: freshHybridData, // May be null in non-hybrid mode
                            calibration: GlobalLearningService.getCalibration(), // Use global persistent calibration
                            tradeHistory: loggedTrades,
                            learningRules: loadLearningRules().rules as StructuredRule[]
                        });

                        // Store original confidence if adjusted
                        if (validationResult.confidenceWasAdjusted) {
                            finalAnalysis.originalConfidence = validationResult.originalConfidence;
                            finalAnalysis.confidence = validationResult.adjustedConfidence;
                            devLog(`[ValidationGate] Confidence adjusted: ${validationResult.originalConfidence} → ${validationResult.adjustedConfidence}`);
                        }

                        // Bayesian cap from the hybrid fetch: the calibration
                        // pipeline computes a capped confidence level for this
                        // setup — never let the analysis exceed it.
                        if (bayesianConfidenceCap) {
                            const LEVEL_ORDER: Record<string, number> = { low: 0, medium: 1, high: 2 };
                            const cap = LEVEL_ORDER[bayesianConfidenceCap.toLowerCase()];
                            const current = LEVEL_ORDER[finalAnalysis.confidence?.toLowerCase() || 'high'];
                            if (cap !== undefined && current !== undefined && current > cap) {
                                finalAnalysis.originalConfidence = finalAnalysis.originalConfidence ?? finalAnalysis.confidence;
                                finalAnalysis.confidence = bayesianConfidenceCap;
                                devLog(`[Bayesian] Confidence capped: ${current} → ${bayesianConfidenceCap}`);
                            }
                        }

                        // Store validation warnings
                        if (validationResult.warnings.length > 0) {
                            finalAnalysis.validationWarnings = validationResult.warnings;
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
                    // ========== END VALIDATION GATE ==========

                    return recalculateAnalysisMetrics(finalAnalysis, activeConversation?.leverage || DEFAULT_LEVERAGE);
                };

                if (enabledProviders.length > 1) {
                    setLoadingMessage("Thinking...");
                    completeStep('gate-scan'); startStep('analysis');
                    currentPhaseRef.current = 'analysis';
                    setAnalysisSteps(prev => prev.map(s => s.id === 'analysis' ? { ...s, title: `Analyzing with ${enabledProviders.map(p => p.name).join(', ')}` } : s));
                    setIsAnalysisInProgress(true);
                    // Clear previous Monte Carlo results for fresh analysis
                    setPerAIMonteCarloResults([]);
                    setLatestMonteCarloResult(null);
                    setLatestBacktestResult(null);
                    reasoningMapRef.current = {};
                    activeDebateSpeakersRef.current = {};
                    debateTurnsRef.current = [];

                    // Captured before the promise map: ensemblePlaceholder is
                    // non-null for staged ensembles, but closures see the
                    // declared Message | null type.
                    const placeholderId = ensemblePlaceholder?.id ?? '';
                    // Per-analyst cost & latency ledger: measure each analyst's
                    // initial-analysis wall time + output size as they run.
                    const analystTimings = new Map<string, { durationMs: number; charsOut: number }>();
                    // Shared analysis options for the initial analysts AND any
                    // mid-debate replacement (the replacement must see the exact
                    // same prompt/images/context as the analysts it steps in for —
                    // otherwise the moderator gets an incomparable position).
                    const buildAnalystParams = (provider: { config: ProviderConfig; name: string; model: string; thoughtsKey: string }): CacheableAnalysisParams => ({
                        imageSummaries: summaries,
                        chatHistory: currentMessages,
                        finalTradeSummary: enhancedFinalTradeSummary,
                        recentInsights: recentInsightsString,
                        activeFrameworks,
                        deepenAnalysis: isDeepAnalysis,
                        globalMemory: memoryToInject,
                        threadSummary: currentThreadSummary,
                        subMode: isAccuracyModeEnabled ? accuracySubMode : undefined,
                        customInstructions: instructionsToUse,
                        isPlaybookEnabledInPureAI,
                        isFamiliesEnabledInPureAI,
                        isMemoryEnabledInPureAI,
                        // Analyst Lens: pass role-specific prompt based on trading style.
                        // Custom overrides from the prompt editor win over built-ins.
                        rolePrompt: lensConfig.enabled && provider.thoughtsKey
                            ? (customLensPrompts?.[getRoleForProvider(`${provider.config.id}::${provider.model}`, lensConfig.assignments)]
                                || getLensPromptForStyle(
                                    `${provider.config.id}::${provider.model}`,
                                    lensConfig.assignments,
                                    // For auto mode, use swing as default (will be detected per-call with hybrid data)
                                    lensConfig.tradingStyle === 'auto' ? 'swing' : lensConfig.tradingStyle
                                ))
                            : undefined,
                        // Normal mode (Lenses off): custom base prompt override.
                        systemPromptOverride: lensConfig.enabled ? undefined : (customEnsemblePrompt || undefined),
                        // Streamed chain-of-thought deltas accumulate — the
                        // latest full string is pushed to the live cards.
                        onReasoning: (reasoning: string) => {
                             reasoningMapRef.current[provider.name] = (reasoningMapRef.current[provider.name] || '') + reasoning;
                             if (isStagedEnsemble && provider.thoughtsKey) {
                                 // Coalesced to one update per animation frame —
                                 // per-token updates re-render the whole chat.
                                 throttledEnsembleProgress(
                                     requestConversationId,
                                     placeholderId,
                                     provider.thoughtsKey,
                                     reasoningMapRef.current[provider.name],
                                 );
                             }
                         },
                    });
                    const analysisPromises = enabledProviders.map(provider => {
                        if (isStagedEnsemble) {
                            updateEnsembleProgress(progress => ({
                                ...progress,
                                analysts: progress.analysts.map(analyst => analyst.key === provider.thoughtsKey
                                    ? { ...analyst, status: 'analyzing' }
                                    : analyst),
                            }));
                        }
                        const runStartedAtMs = performance.now();
                        return cachedAnalyzeTradingView(
                            provider.config,
                            provider.model,
                            enhancedPrompt,
                            imageFiles,
                            dataURLs,
                            currentAbortController.signal,
                            buildAnalystParams(provider),
                        )
                                 .then(result => {
                                     analystTimings.set(provider.config.id, {
                                         durationMs: Math.round(performance.now() - runStartedAtMs),
                                         charsOut: (result.finalOutput?.length ?? 0) + (result.thoughtProcess?.length ?? 0),
                                     });
                                     if (isStagedEnsemble) {
                                         updateEnsembleProgress(progress => ({
                                             ...progress,
                                             analysts: progress.analysts.map(analyst => analyst.key === provider.thoughtsKey
                                                 ? {
                                                     ...analyst,
                                                     status: 'complete',
                                                     finalOutput: result.finalOutput || result.thoughtProcess,
                                                     thoughtProcess: result.thoughtProcess,
                                                     reasoning: reasoningMapRef.current[provider.name],
                                                 }
                                                 : analyst),
                                         }));
                                     }
                                     return result;
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

                    const thoughtMap: Record<string, string> = {};
                    // P1-6 (pre-existing fix): iterate settledResults, NOT the
                    // re-indexed `results` array — otherwise a failed provider
                    // at index 0 would cause results[0] (actually provider #1's
                    // data) to be attributed to enabledProviders[0].thoughtsKey.
                    settledResults.forEach((settled, index) => {
                        if (settled.status === 'fulfilled') {
                                const providerKey = enabledProviders[index].thoughtsKey;
                                thoughtMap[providerKey] = settled.value.thoughtProcess;
                                thoughtMap[enabledProviders[index].name] = settled.value.thoughtProcess;
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
                        debateTurns: [],
                        // Non-staged runs never carried modelsUsed — the chat's
                        // per-bubble model line was blank for them.
                        modelsUsed: ensemblePlaceholder?.modelsUsed
                                || Object.fromEntries(enabledProviders.map(p => [p.config.id, p.model])),
                        thoughtProcesses: { ...(ensemblePlaceholder?.thoughtProcesses || {}), ...thoughtMap },
                        reasoningProcesses: { ...(ensemblePlaceholder?.reasoningProcesses || {}), ...reasoningMapRef.current },
                        activeDebateSpeakers: {},
                    };

                    updateRequestMessages(prev => ensemblePlaceholder
                        ? prev.map(message => message.id === debateMessageId ? debatePlaceholder : message)
                        : [...prev, debatePlaceholder]);
                    startStep('debate');
                    currentPhaseRef.current = 'debate';

                    // --- ENSEMBLE ROUTING ---
                    let debateStream;

                    const activeModModel = moderatorModel;

                    // Align analysts with their results by ticker index. The
                    // re-indexed `results` array shifts when an analyst fails,
                    // silently mislabeling provider #2's analysis as #1's (and
                    // passing `undefined` when fewer analysts succeed than the
                    // enabledProviders count — crashing the n-way debaters).
                    const fulfilledAnalysts = settledResults
                        .map((settled, i) => settled.status === 'fulfilled' ? { provider: enabledProviders[i], result: settled.value } : null)
                        .filter((x): x is { provider: (typeof enabledProviders)[number]; result: { thoughtProcess: string; finalOutput: string; analysis: any } } => x !== null);
                    // Mutable superset of fulfilledAnalysts: a mid-debate
                    // replacement analyst is appended here so the run ledger,
                    // the consensus explainability panel, and the analyst count
                    // reflect everyone who actually delivered, not just the
                    // initial roster.
                    const allFulfilledAnalysts: ensembleService.RealDebateAnalyst[] = [...fulfilledAnalysts];

                    if (isAccuracyModeEnabled) {
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
                                accuracySubMode,
                                instructionsToUse,
                                moderatorConfig,
                                activeModModel,
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
                                    thoughtMap.moderator = reasoningMapRef.current.moderator;
                                },
                                // Provider IDs for Bayesian calibration (keyed by id)
                                fulfilledAnalysts.map(a => a.provider.config.id)
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
                            usedProviderIds.add(moderatorConfig.id);
                            const candidates = providerConfigs
                                .filter(p => p.isEnabled !== false && !usedProviderIds.has(p.id) && (p.selectedModel || p.models?.[0]))
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
                            const runStartedAtMs = performance.now();
                            const result = await cachedAnalyzeTradingView(
                                candidate,
                                model,
                                enhancedPrompt,
                                imageFiles,
                                dataURLs,
                                currentAbortController.signal,
                                buildAnalystParams(replacementProvider),
                            );
                            analystTimings.set(candidate.id, {
                                durationMs: Math.round(performance.now() - runStartedAtMs),
                                charsOut: (result.finalOutput?.length ?? 0) + (result.thoughtProcess?.length ?? 0),
                            });
                            const record: ensembleService.RealDebateAnalyst = {
                                provider: replacementProvider,
                                result: {
                                    thoughtProcess: result.thoughtProcess,
                                    finalOutput: result.finalOutput || result.thoughtProcess,
                                    analysis: result.analysis,
                                },
                            };
                            allFulfilledAnalysts.push(record);
                            // Model line for the replacement's transcript bubbles.
                            updateRequestMessages(prev => prev.map(m => m.id === debateMessageId
                                ? { ...m, modelsUsed: { ...m.modelsUsed, [candidate.id]: model } }
                                : m));
                            return record;
                        };
                        debateStream = ensembleService.conductRealDebate(
                                fulfilledAnalysts.map(a => ({
                                    provider: a.provider,
                                    result: a.result,
                                })),
                                enhancedPrompt,
                                finalTradeSummary,
                                moderatorConfig,
                                activeModModel,
                                instructionsToUse,
                                perAIMC,   // monteCarloResults
                                lensConfig.enabled ? lensConfig : undefined, // lensConfig
                                lensConfig.enabled ? fulfilledAnalysts.map(a => a.provider.config.id) : undefined, // analystProviders
                                activeFrameworks, // playbook
                                tradeSummaries, // recent insights for pattern matching
                                capturedGateResult, // Gate result (current run, not stale state)
                                moderatorLearningContext, // Unified learning context for moderator
                                currentAbortController.signal, // Cancellation for the moderator stream
                                (reasoning: string) => {
                                    // Streamed moderator chain-of-thought accumulates
                                    // (deltas replace nothing — they append).
                                    reasoningMapRef.current.moderator = (reasoningMapRef.current.moderator || '') + reasoning;
                                    thoughtMap.moderator = reasoningMapRef.current.moderator;
                            },
                            (speaker: string, reasoning: string) => {
                                // Rebuttal and clarification reasoning is keyed by speaker
                                // so the debate chat can show it live. Deltas ACCUMULATE
                                // (same as the analyst/moderator callbacks) — replacing
                                // wiped everything but the last delta of the last round.
                                reasoningMapRef.current[speaker] = (reasoningMapRef.current[speaker] || '') + reasoning;
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
                                    activeDebateSpeakersRef.current,
                                );
                            },
                            hybridDataInjection,
                            undefined, // timeoutMs (debate budget is engine-defaulted)
                            requestReplacement,
                            undefined, // replacementTimeoutMs (engine-defaulted)
                            // Live-price refresh between rounds: the debate
                            // re-anchors each round on TODAY's price (from the
                            // live feed's cache — zero extra network calls).
                            // Null symbol / unknown price → graceful no-op.
                            () => (finalSymbol ? PriceAlertService.getCurrentPrice(finalSymbol) ?? null : null),
                        );
                    }

                    let fullResponseText = '';
                    if (isAccuracyModeEnabled) {
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
                            const matches = [...debateContent.matchAll(turnRegex)];
                            // Autoplayed transcripts carry no explicit rounds —
                            // derive them: each moderator turn starts a new
                            // round, so the messenger chat keeps its round
                            // separators and the final moderator message gets
                            // the verdict treatment. Prefix-stable: earlier
                            // turns never change as the stream grows.
                            let autoplayRound = 0;
                            for (const m of matches) {
                                let speaker = m[1].trim();
                                if (speaker === "Master Strategist") speaker = "Moderator";
                                speaker = speaker.charAt(0).toUpperCase() + speaker.slice(1);
                                if (speaker === 'Moderator') autoplayRound++;
                                currentTurns.push({
                                    speaker: speaker as DebateTurn['speaker'],
                                    round: autoplayRound > 0 ? autoplayRound : undefined,
                                    text: sanitizeAIResponse(m[2].trim()),
                                });
                            }

                            // The moderator's verdict prose sits right before
                            // </DEBATE_END> (no "Speaker:" prefix), so the turn
                            // regex can't capture it — surface it as the final
                            // moderator synthesis instead of dropping it.
                            if (!synthesisContent && matches.length > 0) {
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
                                    currentTurns.push({ speaker: 'Moderator', round: autoplayRound + 1, text: sanitizeAIResponse(cleanSynthesis) });
                                }
                            }

                            // P1-5: Coalesce per-token updates into one per frame.
                            debateTurnsRef.current = currentTurns;
                            throttledDebateUpdate(requestConversationId, debateMessageId, currentTurns, thoughtMap, reasoningMapRef.current, activeDebateSpeakersRef.current);
                        }
                    } else {
                        // STANDARD MODE — REAL debate: the pipeline receives
                        // structured turn events (delta chunks per speaker +
                        // round) instead of a transcript to regex-parse.
                        const turnTexts: Record<string, string> = {}; // `${round}::${speaker}` → accumulated text
                        const turnTimes: Record<string, string> = {};   // first-delta timestamp per turn (replay)
                        let moderatorRound = 0;

                        for await (const event of debateStream as AsyncGenerator<ensembleService.RealDebateTurnEvent, void, unknown>) {
                            if (!isCurrentRequest()) assertCurrentRequest();
                            if (!event || typeof event.text !== 'string') continue;

                            const key = `${event.round}::${event.speaker}`;
                            // The engine emits this marker before a moderator
                            // verdict retry — discard the failed attempt's
                            // partial prose so it never glues onto the verdict.
                            if (event.text.includes('<MODERATOR_RETRY>')) {
                                // Discard the failed attempt entirely — text AND
                                // first-delta timestamp (the retried verdict must
                                // not carry the failed attempt's start time).
                                turnTexts[key] = '';
                                delete turnTimes[key];
                                continue;
                            }
                            // The engine abandoned the replacement wait — the
                            // suspended requestReplacement must be unblocked so
                            // a late click on the banner can never resolve into
                            // a phantom analyst (a full paid re-analysis call
                            // injected into consensus/runStats).
                            if (event.text.includes('<REPLACEMENT_TIMEOUT>')) {
                                const pending = replacementChoiceRef.current;
                                if (pending) handleReplacementChoice(pending.messageId, null);
                            }
                            if (!turnTimes[key]) turnTimes[key] = new Date().toISOString();
                            turnTexts[key] = (turnTexts[key] || '') + event.text;
                            if (event.speaker === 'Moderator') {
                                fullResponseText += event.text;
                                moderatorRound = event.round;
                            }

                            const currentTurns: DebateTurn[] = Object.entries(turnTexts)
                                .map(([k, text]) => {
                                    const sep = k.indexOf('::');
                                    const speaker = k.slice(sep + 2) as DebateTurn['speaker'];
                                    const cleanedText = speaker === 'Moderator'
                                        ? text
                                            .replace(/<CLARIFICATION_(?:DONE|SATISFIED|UNSATISFIED)>/gi, '')
                                            .replace(/<MODERATOR_RETRY>/gi, '')
                                            .replace(/<MODERATOR_ERROR>[\s\S]*?<\/MODERATOR_ERROR>/gi, '')
                                            .replace(/<JSON_PLAN>[\s\S]*/i, '')
                                            .replace(/<\/?DEBATE_END>/gi, '')
                                            .trim()
                                        : text.trim();
                                    return {
                                        speaker,
                                        round: parseInt(k.slice(0, sep), 10) || undefined,
                                        createdAt: turnTimes[k],
                                        text: sanitizeAIResponse(cleanedText),
                                    };
                                })
                                .filter(turn => Boolean(turn.text))
                                .sort((a, b) => (a.round ?? 0) - (b.round ?? 0));

                            debateTurnsRef.current = currentTurns;
                            throttledDebateUpdate(requestConversationId, debateMessageId, currentTurns, thoughtMap, reasoningMapRef.current, activeDebateSpeakersRef.current);
                        }

                        // The moderator's verdict prose lives before the
                        // </DEBATE_END> / <JSON_PLAN> markers — strip them so
                        // the transcript shows clean verdict text.
                        if (moderatorRound > 0) {
                            const modKey = `${moderatorRound}::Moderator`;
                            if (turnTexts[modKey]) {
                                const cleaned = turnTexts[modKey]
                                    .replace(/<MODERATOR_RETRY>/gi, '')
                                    .replace(/<\/?DEBATE_END>/gi, '')
                                    .replace(/<MODERATOR_ERROR>[\s\S]*?<\/MODERATOR_ERROR>/gi, '')
                                    .replace(/<JSON_PLAN>[\s\S]*/i, '')
                                    .trim();
                                if (cleaned) {
                                    turnTexts[modKey] = cleaned;
                                    const finalTurns: DebateTurn[] = Object.entries(turnTexts)
                                        .map(([k, text]) => {
                                            const sep = k.indexOf('::');
                                            const speaker = k.slice(sep + 2) as DebateTurn['speaker'];
                                            const cleanedText = speaker === 'Moderator'
                                                ? text
                                                    .replace(/<CLARIFICATION_(?:DONE|SATISFIED|UNSATISFIED)>/gi, '')
                                                    .replace(/<MODERATOR_ERROR>[\s\S]*?<\/MODERATOR_ERROR>/gi, '')
                                                    .replace(/<JSON_PLAN>[\s\S]*/i, '')
                                                    .replace(/<\/?DEBATE_END>/gi, '')
                                                    .trim()
                                                : text.trim();
                                            return {
                                                speaker,
                                                round: parseInt(k.slice(0, sep), 10) || undefined,
                                                createdAt: turnTimes[k],
                                                text: sanitizeAIResponse(cleanedText),
                                            };
                                        })
                                        .filter(turn => Boolean(turn.text))
                                        .sort((a, b) => (a.round ?? 0) - (b.round ?? 0));
                                    debateTurnsRef.current = finalTurns;
                                    throttledDebateUpdate(requestConversationId, debateMessageId, finalTurns, thoughtMap, reasoningMapRef.current, activeDebateSpeakersRef.current);
                                }
                            }
                        }
                    }
                    // Flush the final pending update synchronously so the
                    // last chunk's state is committed before downstream parsing.
                    throttledDebateUpdate.flush();
                    if (!isCurrentRequest()) assertCurrentRequest();

                    let finalAnalysis: TradeAnalysis;
                    try {
                        // Layered extraction: prefer the moderator's post-debate
                        // section, but never hard-fail when the moderator omits
                        // </DEBATE_END> — fall back to the last JSON in the whole
                        // response so a formatting hiccup can't turn the run into
                        // a Neutral "no signal" card.
                        const moderatorErrorMatch = fullResponseText.match(/<MODERATOR_ERROR>([\s\S]*?)<\/MODERATOR_ERROR>/);
                        const debateEnd = fullResponseText.match(/<\/?DEBATE_END>/i);
                        const candidate = debateEnd && debateEnd.index !== undefined
                            ? fullResponseText.slice(debateEnd.index + debateEnd[0].length)
                            : fullResponseText;
                        try {
                            finalAnalysis = extractLastJson(candidate);
                        } catch (e) {
                            // Only surface the moderator error marker when no
                            // valid JSON plan could be recovered at all.
                            if (moderatorErrorMatch) {
                                throw new Error(`Moderator Error: ${moderatorErrorMatch[1]}`, { cause: e });
                            }
                            throw e;
                        }
                    } catch (e) {
                        console.error("Failed to parse final debate JSON:", e);
                        const errorMessage = e instanceof Error ? e.message : 'Unknown error';
                        const isModeratorError = errorMessage.includes('Moderator Error');
                        finalAnalysis = sanitizeTradeAnalysis({
                            strategy: isModeratorError
                                ? `Connection Error: ${errorMessage}. Please try again.`
                                : 'Parsing Error: The moderator failed to generate a valid JSON plan. Please review the debate transcript above for the consensus.',
                            direction: 'Neutral',
                            confidence: 'Low'
                        });
                    }

                    finalAnalysis = sanitizeTradeAnalysis(finalAnalysis);

                    // === ACCURACY MODE VERIFICATION PASS ===
                    // Standard mode has the clarification loop; accuracy mode is a
                    // single autoplayed stream. This second focused moderator call
                    // reviews the debate + plan and may adjust levels/confidence.
                    // Fail-safe: any error keeps the moderator's plan untouched.
                    let accuracyVerificationNote = '';
                    if (isAccuracyModeEnabled && finalAnalysis.direction && finalAnalysis.direction !== 'Neutral') {
                        try {
                            const verification = await ensembleService.verifyAccuracyPlan(
                                moderatorConfig,
                                activeModModel,
                                fullResponseText,
                                JSON.stringify(finalAnalysis),
                                currentAbortController.signal,
                            );
                            if (verification.verdict === 'adjusted' && verification.planJson) {
                                const adjusted = sanitizeTradeAnalysis(extractLastJson(verification.planJson));
                                if (adjusted && adjusted.direction && adjusted.direction !== 'Neutral') {
                                    finalAnalysis = adjusted;
                                    accuracyVerificationNote = verification.note;
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
                    // The Gate produces a confidenceCap based on data integrity, pattern memory,
                    // HTF/LTF conflict, and volume context. The moderator can emit any probability
                    // in its JSON, but it must never exceed the gate cap. Enforce in code.
                    if (capturedGateResult && finalAnalysis.probability != null) {
                        const gateCap = capturedGateResult.confidenceCap ?? 1.0;
                        const clampResult = clampProbabilityToGate(
                            finalAnalysis.probability,
                            gateCap,
                            finalAnalysis.rrRatio
                        );
                        if (clampResult.wasClamped) {
                            console.warn(`[Gate Enforcement] Clamped probability ${finalAnalysis.probability}% → ${clampResult.probability}% (${clampResult.reason})`);
                            finalAnalysis.probability = clampResult.probability;
                            // Also downgrade the confidence string if probability was clamped below the threshold
                            if (clampResult.probability < 70 && finalAnalysis.confidence === 'High') {
                                finalAnalysis.confidence = 'Medium';
                            } else if (clampResult.probability < 55 && finalAnalysis.confidence === 'Medium') {
                                finalAnalysis.confidence = 'Low';
                            }
                            // Record the clamping in validation warnings
                            if (!finalAnalysis.validationWarnings) {
                                finalAnalysis.validationWarnings = [];
                            }
                            finalAnalysis.validationWarnings.push(`Gate enforcement: ${clampResult.reason}`);
                        }
                    }

                    // Compute OUTSIDE the state updater: updaters may re-run in
                    // StrictMode (duplicate notifications) and must stay pure
                    // (processNewAnalysis performs synchronous setState calls).
                    const processedAnalysis = processNewAnalysis(finalAnalysis);
                    if (freshHybridData && processedAnalysis) {
                        // Inject market snapshot (Algo Mode & Regeneration).
                        processedAnalysis.marketSnapshot = freshHybridData;
                    }

                    // Consensus explainability: per-analyst structured calls +
                    // pre-debate divergence, attached to the verdict so the
                    // result card can audit the call against its own inputs.
                    if (processedAnalysis) {
                        const consensus = ensembleService.buildAnalystConsensus(allFulfilledAnalysts);
                        if (consensus) processedAnalysis.analystConsensus = consensus;
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
                            isLensMode: lensConfig?.enabled ?? false,
                            // Always set tradingStyle regardless of Lens mode
                            tradingStyle: lensConfig.tradingStyle === 'auto' ? 'swing' : lensConfig.tradingStyle
                        };

                        // Per-run execution summary (compare mode + diagnostics).
                        updatedMessage.runStats = {
                            startedAt: new Date(runStartedAt).toISOString(),
                            finishedAt: new Date().toISOString(),
                            durationMs: Date.now() - runStartedAt,
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
                                const timing = analystTimings.get(a.provider.config.id);
                                return {
                                    providerId: a.provider.config.id,
                                    displayName: a.provider.name,
                                    modelId: a.provider.model,
                                    ...(timing ? { durationMs: timing.durationMs, charsOut: timing.charsOut } : {}),
                                };
                            }),
                        };

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

                    // === ThinkingStore: Save reasoning for training & analysis ===
                    // Persist per-analyst reasoning, moderator synthesis, and debate turns
                    // so they can be correlated with outcomes and exported for model training.
                    try {
                        const tradeId = getThinkingTradeId(finalAnalysis.createdAt, debateMessageId);
                        const username = localStorage.getItem('last_active_user') || 'default';
                        const now = new Date().toISOString();
                        const thinkingRecords: ThinkingRecord[] = [];

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
                            thinkingRecords.push({
                                id: generateThinkingId(),
                                tradeId,
                                username,
                                provider: providerKey,
                                role: 'analyst',
                                modelName: provider.model,
                                reasoning: thoughtMap[providerKey] || '',
                                // The analyst's final answer (post-reasoning
                                // output), kept separate from its reasoning.
                                finalOutput: analystResult.finalOutput || undefined,
                                // Raw provider-streamed chain of thought
                                // (reasoning_content / thinking blocks) keyed by
                                // provider display name in reasoningMapRef.
                                rawReasoning: reasoningMapRef.current[provider.name] || undefined,
                                // Card linkage: the message id of this prediction.
                                messageId: debateMessageId,
                                analysisJson: analystResult.analysis ? JSON.stringify(analystResult.analysis) : undefined,
                                confidence: analystResult.analysis?.confidence,
                                probability: analystResult.analysis?.probability,
                                createdAt: now,
                            });
                        });

                        // Save moderator synthesis (the full debate response)
                        thinkingRecords.push({
                            id: generateThinkingId(),
                            tradeId,
                            username,
                            provider: 'moderator',
                            role: 'moderator',
                            modelName: activeModModel,
                            reasoning: fullResponseText,
                            // The moderator's verdict prose — the full stream
                            // cleaned of control markers and the JSON plan (the
                            // plan itself lives in analysisJson).
                            finalOutput: fullResponseText
                                .replace(/<CLARIFICATION_(?:DONE|SATISFIED|UNSATISFIED)>/gi, '')
                                .replace(/<MODERATOR_RETRY>/gi, '')
                                .replace(/<MODERATOR_ERROR>[\s\S]*?<\/MODERATOR_ERROR>/gi, '')
                                .replace(/<\/?DEBATE_END>/gi, '')
                                .replace(/<JSON_PLAN>[\s\S]*/i, '')
                                .replace(/<\/?DEBATE_START>/gi, '')
                                .trim() || undefined,
                            // Raw streamed chain of thought from the moderator's
                            // final verdict call.
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
                            thinkingRecords.push({
                                id: generateThinkingId(),
                                tradeId,
                                username,
                                provider: turn.speaker.toLowerCase().includes('moderator') ? 'moderator' : turn.speaker.toLowerCase(),
                                role: 'debate_turn',
                                debateTurnIndex: idx,
                                debateTurnSpeaker: turn.speaker,
                                reasoning: turn.text,
                                messageId: debateMessageId,
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
                    setLoadingMessage(isAccuracyModeEnabled ? `Running High-Precision Analysis...` : `Analyzing with ${provider.name}...`);
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
                            const result = await cachedAnalyzeTradingView(
                            provider.config,
                            provider.model,
                            enhancedPrompt, // Fixed: was promptToSend, now uses enhancedPrompt with Hybrid data
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
                                subMode: isAccuracyModeEnabled ? accuracySubMode : undefined,
                                customInstructions: instructionsToUse,
                                isPlaybookEnabledInPureAI,
                                isFamiliesEnabledInPureAI,
                                isMemoryEnabledInPureAI,
                                // Analyst Lens: pass role-specific prompt based on trading style
                                // (custom prompt overrides from the prompt editor win).
                                rolePrompt: lensConfig.enabled && provider.thoughtsKey
                                    ? (customLensPrompts?.[getRoleForProvider(`${provider.config.id}::${provider.model}`, lensConfig.assignments)]
                                        || getLensPromptForStyle(
                                            `${provider.config.id}::${provider.model}`,
                                            lensConfig.assignments,
                                            lensConfig.tradingStyle === 'auto' ? 'swing' : lensConfig.tradingStyle
                                        ))
                                    : undefined,
                                // Normal mode (Lenses off): custom base prompt override.
                                systemPromptOverride: lensConfig.enabled ? undefined : (customEnsemblePrompt || undefined),
                                // Streamed chain-of-thought deltas accumulate — the
                                // multi path uses the same append pattern.
                                onReasoning: (reasoning: string) => { soloRawReasoning += reasoning; },
                            },
                        );
                    if (!isCurrentRequest()) assertCurrentRequest();
                    const soloAiMessage: Message = {
                        id: `ai-${Date.now()}`, role: MessageRole.AI, text: result.finalOutput || result.thoughtProcess, createdAt: new Date().toISOString(), analysis: processNewAnalysis(result.analysis), sources: result.sources || [], outcome: TradeOutcome.PENDING, ocrModelUsed: userMessage.ocrModelUsed,
                        imageSummaries: userMessage.imageSummaries,
                        modelsUsed: { [provider.config.id]: provider.model },
                        thoughtProcesses: { [provider.config.id]: result.thoughtProcess },
                        isAccuracyMode: isAccuracyModeEnabled,
                        isLensMode: lensConfig?.enabled ?? false,
                        // Always set tradingStyle regardless of Lens mode
                        tradingStyle: lensConfig.tradingStyle === 'auto' ? 'swing' : lensConfig.tradingStyle,
                        accuracySubMode: isAccuracyModeEnabled ? accuracySubMode : undefined,
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

                    // === ThinkingStore: Persist the solo analysis reasoning ===
                    // Same training-data contract as the debate path (one
                    // analyst record per card) so the Think view and outcome
                    // correlation work for single-provider runs too.
                    try {
                        const username = localStorage.getItem('last_active_user') || 'default';
                        const now = new Date().toISOString();
                        persistThinkingRecords([{
                            id: generateThinkingId(),
                            tradeId: getThinkingTradeId(soloAiMessage.analysis?.createdAt, soloAiMessage.id),
                            username,
                            provider: provider.thoughtsKey,
                            role: 'analyst',
                            modelName: provider.model,
                            reasoning: result.thoughtProcess || '',
                            finalOutput: result.finalOutput || undefined,
                            rawReasoning: soloRawReasoning || undefined,
                            messageId: soloAiMessage.id,
                            analysisJson: result.analysis ? JSON.stringify(result.analysis) : undefined,
                            confidence: result.analysis?.confidence,
                            probability: result.analysis?.probability,
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
                const chosen = providerConfigs.find(c =>
                    isProviderReady(c) && (c.selectedModel === selectedChatModel || c.models.includes(selectedChatModel))
                );
                const provider = chosen
                    ? { config: { ...chosen, selectedModel: selectedChatModel }, name: chosen.name, model: selectedChatModel, useImages: false, thoughtsKey: chosen.id }
                    : enabledProviders[0];
                setLoadingMessage("Thinking...");
                setIsAnalysisInProgress(true);
                startStep('analysis');
                let reasoningContent = '';
                const responseText = await getQuickResponse(
                    provider.config,
                    promptToSend,
                    currentMessages,
                    undefined,
                    currentAbortController.signal,
                    reasoning => { reasoningContent = reasoning; }
                );
                if (!isCurrentRequest()) assertCurrentRequest();
                // Casual chat is a single-model conversation. Do not store the
                // answer as an individual insight; that creates an oversized
                // "Individual AI Insights" section under ordinary replies.
                updateRequestMessages(prev => [...prev, {
                    id: `ai-${Date.now()}`,
                    role: MessageRole.AI,
                    text: responseText,
                    createdAt: new Date().toISOString(),
                    modelsUsed: { [provider.config.id]: provider.model },
                    thoughtProcesses: reasoningContent ? { [provider.config.id]: reasoningContent } : undefined,
                }]);
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
                if (m.id === ensemblePlaceholder?.id && m.ensembleProgress) {
                    return {
                        ...m,
                        isDebating: false,
                        activeDebateSpeakers: {},
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
                    replacementOffer: undefined,
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

            // Sanitize the fallback: never leak long key-like tokens (API keys)
            // and cap length so internal SDK errors stay readable but bounded.
            const rawMessage = error instanceof Error ? error.message : "An unknown error occurred.";
            const safeMessage = rawMessage.replace(/\b[A-Za-z0-9_-]{24,}\b/g, '***').slice(0, 500);
            updateRequestMessages(prev => [...prev, { id: `err-${Date.now()}`, role: MessageRole.SYSTEM, createdAt: new Date().toISOString(), text: safeMessage }]);
        } finally {
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
    }, [input, images, loadingMessage, finalTradeSummary, activeFrameworks, isRateLimited, providerConfigs, isDeepAnalysis, selectedOcrModel, updateMessages, moderatorConfig, moderatorModel, activeConversationId, activeConversation, isAnalysisInProgress, globalMemory, isGlobalMemoryEnabled, isAccuracyModeEnabled, accuracySubMode, customInstructions, isPlaybookEnabledInPureAI, isFamiliesEnabledInPureAI, isMemoryEnabledInPureAI, lensConfig, isHybridIntelligenceEnabled, isEnsembleEnabled, selectedChatModel, loggedTrades, confidenceCalibration, insightKnowledgeBase, currentHybridData, tradeSummaries, customEnsemblePrompt, customLensPrompts]);

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
    };
}
