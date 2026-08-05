import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
    Message, MessageRole, TradeOutcome, LoggedTrade, ImageMetadata,
    DebateTurn, Conversation, TradeAnalysis, TradeSummary,
    GlobalMemory, AccuracySubMode, CustomInstructionsMap, CustomInstruction,
    AnalystLensConfig, AnalysisStep, InsightKnowledgeBase, ConfidenceCalibration,
} from '../types';

import { ProviderConfig } from '../types/provider';
import { analyzeTradingView, getQuickResponse } from '../services/providers/GenericAnalysisService';
import * as ensembleService from '../services/providers/ensembleService';

// Analysis / validation / backtesting services
import { tryFetchHybridDataFromPromptWithCalibration, generateHybridPromptInjection, HybridDataPacket, runMonteCarloForSetupAsync } from '../services/analysis/HybridIntelligenceService';
import { LabeledMonteCarloResult } from '../services/analysis/MonteCarloService';
import { backtestSimilarSetups } from '../services/backtesting/LiveBacktestService';
import { runValidationGate } from '../services/validation/TradeValidationGate';
import { getGateAnalysis, GateOutput } from '../services/validation/GateKeeperService';

// Utils
import { isQuotaError } from '../utils/errorUtils';
import { recalculateAnalysisMetrics, sanitizeTradeAnalysis, clampProbabilityToGate } from '../utils/analysisUtils';
import { saveThinkingBatch, generateThinkingId } from '../services/infrastructure/ThinkingStoreService';
import { notifyAnalysisComplete } from '../services/infrastructure/CompletionNotifications';
import { ThinkingRecord } from '../types/thinking';
import { extractLastJson } from '../utils/jsonUtils';
import { sanitizeAIResponse } from '../utils/sanitizers';
import { buildModelIdToName, isProviderReady } from '../utils/providerUtils';
import { loadLearningRules } from '../services/learning/LearningRulesService';
import { StructuredRule } from '../types';
import {
    getCachedResponse, cacheResponse, getImageHash, clearAllCaches,
} from '../services/infrastructure/responseCache';
import { useRafThrottle } from './useRafThrottle';

// Learning services
import { generateLearningFromPrompt, isLearningEnabled } from '../services/learning/LearningPromptService';
import { generatePersonalizedInjection } from '../services/ui/PersonalizedPromptService';
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
    toast: { warning: (t: string, m?: string) => void; error: (t: string, m?: string) => void };
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
    } = params;

    // ─── P1-4: Response cache wrapper ─────────────────────────────────────
    // Wraps a provider's analyzeTradingView call with a short-TTL response
    // cache. Re-analyzing the same chart (same images + prompt + model) within
    // 10 minutes returns the cached result instantly instead of re-OCRing,
    // re-encoding images to base64, and re-calling the API. Cache hits are
    // logged so they're visible during debugging.
    const cachedAnalyzeTradingView = useCallback(async (
        config: ProviderConfig,
        model: string,
        prompt: string,
        imageFiles: File[],
        signal: AbortSignal | undefined,
        // The remaining args are passed through unchanged.
        ...rest: any[]
    ): Promise<{ thoughtProcess: string; finalOutput: string; analysis: any; sources?: any[] }> => {
        // Build cache key from image hashes + prompt + model. We hash the
        // File names+sizes as a proxy (the responseCache.getImageHash helper
        // is designed for base64 data URLs; for File objects we synthesize a
        // key from stable metadata since reading the bytes would defeat the
        // purpose of caching).
        const imageHashes = imageFiles.map(f => `${f.name}:${f.size}:${f.lastModified}`);
        const cacheKey = imageHashes.length > 0 ? imageHashes : ['no-images'];

        // Mode/role context must be part of the key — the same chart+prompt
        // legitimately produces different analyses under deep analysis, an
        // accuracy submode, a lens role prompt, or a custom ensemble prompt.
        // Without this a 10-minute-TTL hit serves the previous mode's analysis.
        const modeContext = JSON.stringify([rest[5], rest[8], rest[13], rest[14]]);

        const cached = await getCachedResponse(cacheKey, prompt, model, modeContext);
        if (cached) {
            console.log(`[ResponseCache] HIT for ${config.name || model} (${model})`);
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
            imageSummaries: rest[0] as string[],
            chatHistory: rest[1] as Message[],
            finalTradeSummary: rest[2] as string | null,
            recentInsights: rest[3] as string | null,
            activeFrameworks: rest[4] as string[],
            deepenAnalysis: rest[5] as boolean,
            globalMemory: rest[6] as GlobalMemory | undefined,
            threadSummary: rest[7] as string | undefined,
            subMode: rest[8] as AccuracySubMode | undefined,
            customInstructions: rest[9] as string,
            isPlaybookEnabledInPureAI: rest[10] as boolean,
            isFamiliesEnabledInPureAI: rest[11] as boolean,
            isMemoryEnabledInPureAI: rest[12] as boolean,
            rolePrompt: rest[13] as string | undefined,
            signal,
            systemPromptOverride: rest[14] as string | undefined,
            onReasoning: rest[15] as ((reasoning: string) => void) | undefined,
        });

        // Only cache successful, non-empty results.
        if (result && result.analysis) {
            cacheResponse(cacheKey, prompt, model, {
                thoughtProcess: result.thoughtProcess,
                finalOutput: result.finalOutput,
                analysis: result.analysis,
                sources: result.sources,
            }, modeContext);
            console.log(`[ResponseCache] STORED for ${config.name || model} (${model})`);
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
    const [currentGateResult, setCurrentGateResult] = useState<GateOutput | null>(null);
    const [currentVisionData, setCurrentVisionData] = useState<string[]>([]);
    const [isDeepAnalysis, setIsDeepAnalysis] = useState<boolean>(false);
    const [quotaExceededModels, setQuotaExceededModels] = useState<Set<string>>(new Set());

    // ─── Refs ──────────────────────────────────────────────────────────────
    const analysisAbortController = useRef<AbortController | null>(null);
    const analysisConversationIdRef = useRef<string | null>(null);
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

    // ─── Main Analysis Handler ─────────────────────────────────────────────
    const handleSendMessage = useCallback(async (customPrompt?: string, customImages?: ImageMetadata[], hiddenContext?: string, options?: { isUpdate?: boolean; updateInterval?: string; presetHybridData?: HybridDataPacket | null }) => {
        const isSummarizing = images.some(img => img.isLoading);

        if (isAnalysisInProgress) return;

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

        const isStagedEnsemble = isEnsembleEnabled && !isAccuracyModeEnabled && enabledProviders.length > 1;

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
        // Bind every async message write to the conversation that started the
        // request. This remains correct even if the user switches conversations
        // before a provider response or stream chunk arrives.
        const requestConversationId = activeConversationId;
        const updateRequestMessages = (updater: (prevMessages: Message[]) => Message[]): void => {
            updateMessages(updater, requestConversationId);
        };
        const isCurrentRequest = (): boolean =>
            analysisAbortController.current === currentAbortController && !currentAbortController.signal.aborted;

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
            modelsUsed: Object.fromEntries(enabledProviders.map(provider => [provider.thoughtsKey, provider.model])),
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

        if (isEnsembleEnabled && !currentHybridData && !options?.presetHybridData) {
            setHybridConnectionStatus(prev => (prev === 'connected' ? 'connected' : 'connecting'));
            setIsHybridLoading(true);
            setCurrentHybridData(null);
        }
        let freshHybridData: HybridDataPacket | null = currentHybridData;
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
            console.log('[Hybrid Intelligence] ======= START =======');
            console.log('[Hybrid Intelligence] Enabled:', isHybridIntelligenceEnabled);
            console.log('[Hybrid Intelligence] HasPresetData:', !!options?.presetHybridData);
            console.log('[Hybrid Intelligence] User prompt:', effectiveInput);
            // The toggle gates the fetch: with Hybrid Intelligence OFF no data
            // is fetched and nothing is injected into the analyst prompts.
            // Preset data (auto-capture) always wins — it was explicitly
            // fetched for this analysis, so it is injected below regardless.
            if (isEnsembleEnabled && isHybridIntelligenceEnabled && !options?.presetHybridData) {
                try {
                    console.log('[Hybrid Intelligence] Attempting to fetch data for prompt:', effectiveInput);
                    setLoadingMessage('Fetching real-time market data...');
                    startStep('market-data');
                    const learningRules = loadLearningRules();
                    const hybridResult = await tryFetchHybridDataFromPromptWithCalibration(
                        effectiveInput,
                        GlobalLearningService.getCalibration(),
                        learningRules
                    );
                    if (!isCurrentRequest()) return;
                    setIsHybridLoading(false);
                    if (hybridResult) {
                        bayesianConfidenceCap = hybridResult.adjustedConfidence;
                        // Use enhanced injection which includes calibration data
                        hybridDataInjection = hybridResult.enhancedInjection || hybridResult.promptInjection;
                        setCurrentHybridData(hybridResult.data); // Store for UI display
                        freshHybridData = hybridResult.data; // Use local var downstream (state is stale in this closure)

                        // Store correlation risk if available - helpful for UI later
                        if (hybridResult.correlationRisk) {
                            console.log('[Hybrid Intelligence] Correlation Risk Score:', hybridResult.correlationRisk.correlationRiskScore);
                        }

                        console.log('[Hybrid Intelligence] SUCCESS - Got data for:', hybridResult.data.symbol);

                        console.log('[Hybrid Intelligence] Injection length:', hybridDataInjection.length);
                        console.log('[Hybrid Intelligence] Injection preview:', hybridDataInjection.substring(0, 500));
                    } else {
                        console.log('[Hybrid Intelligence] FAILED - No symbol detected in prompt');
                    }
                } catch (hybridError) {
                    if (!isCurrentRequest()) return;
                    setIsHybridLoading(false);
                    console.error('[Hybrid Intelligence] ERROR fetching market data:', hybridError);
                }
            } else if (options?.presetHybridData) {
                // Auto-capture flow: the data was already fetched upstream —
                // build the same injection so the three analysts still receive
                // the hybrid market data in their prompts.
                hybridDataInjection = generateHybridPromptInjection(options.presetHybridData);
                console.log('[Hybrid Intelligence] SKIPPED - Using preset data from auto-capture');
            } else {
                console.log('[Hybrid Intelligence] SKIPPED - Feature not enabled');
            }

            // AI LEARNING: Generate UNIFIED learning context from all 6 learning services
            let learningInjection = '';
            let moderatorLearningContext = ''; // NEW: Separate context for moderator

            // Coin detection for learning context: match only uppercase tickers (no /i flag,
            // which would match any word) and exclude common command words, mirroring the
            // GateKeeper commonWords exclusion list further below.
            const learningCommonWords = ['ANALYZE', 'CHECK', 'LOOK', 'REVIEW', 'SHOW', 'TELL', 'GIVE', 'WHAT', 'HOW', 'WHEN', 'WHERE', 'SHOULD', 'COULD', 'WOULD', 'PLEASE', 'HELP', 'FIND', 'GET', 'SET', 'RUN', 'TEST', 'TRADE', 'LONG', 'SHORT', 'BUY', 'SELL', 'SETUP', 'ENTRY', 'EXIT', 'STOP', 'TAKE', 'PROFIT', 'LOSS', 'CHART', 'PRICE', 'MARKET', 'UPDATE', 'THIS', 'THAT', 'WITH', 'FROM', 'INTO', 'ABOUT', 'LIKE', 'JUST', 'SOME', 'MORE', 'VERY', 'ALSO', 'EVEN', 'ONLY', 'SUCH', 'HERE', 'THERE', 'WELL', 'THAN', 'THEM', 'THEN', 'BEEN', 'HAVE', 'WILL', 'DOES', 'DONE', 'MAKE', 'MADE', 'WANT', 'NEED', 'MUST', 'TIME', 'DATA', 'INFO'];
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
                console.log('[AI Learning] Unified context generated - Analyst:', learningInjection.length, 'chars, Moderator:', moderatorLearningContext.length, 'chars');
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
                        console.log('[AI Learning] Fallback: personalized injection, length:', learningInjection.length);
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
                        console.log('[AI Learning] Fallback: legacy injection, length:', learningInjection.length);
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
                console.log('[Recent Insights] Generated from tradeSummaries array, length:', recentInsightsString.length);
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
            const commonWords = ['ANALYZE', 'CHECK', 'LOOK', 'REVIEW', 'SHOW', 'TELL', 'GIVE', 'WHAT', 'HOW', 'WHEN', 'WHERE', 'SHOULD', 'COULD', 'WOULD', 'PLEASE', 'HELP', 'FIND', 'GET', 'SET', 'RUN', 'TEST', 'TRADE', 'LONG', 'SHORT', 'BUY', 'SELL', 'SETUP', 'ENTRY', 'EXIT', 'STOP', 'TAKE', 'PROFIT', 'LOSS', 'CHART', 'PRICE', 'MARKET', 'UPDATE', 'THIS', 'THAT', 'WITH', 'FROM', 'INTO', 'ABOUT', 'LIKE', 'JUST', 'SOME', 'MORE', 'VERY', 'ALSO', 'EVEN', 'ONLY', 'SUCH', 'HERE', 'THERE', 'WELL', 'THAN', 'THEM', 'THEN', 'BEEN', 'HAVE', 'WILL', 'DOES', 'DONE', 'MAKE', 'MADE', 'WANT', 'NEED', 'MUST', 'TIME', 'DATA', 'INFO'];
            // Match crypto symbols: prioritize those ending in USDT/PERP, then standalone 2-5 letter symbols
            const symbolMatches = effectiveInput.match(/\b([A-Z]{2,10})(?:USDT?|PERP)\b/gi) ||
                effectiveInput.match(/\b([A-Z]{2,5})\b/gi) || [];
            const detectedSymbol = symbolMatches
                .map(m => m.replace(/USDT?|PERP/gi, '').toUpperCase())
                .find(s => s.length >= 2 && s.length <= 10 && !commonWords.includes(s));
            const finalSymbol = detectedSymbol ? `${detectedSymbol}USDT` : null;

            let gateInjection = '';
            let capturedGateResult: typeof currentGateResult = null; // Local variable to avoid state closure issue
            if (finalSymbol && isEnsembleEnabled) {
                try {
                    console.log(`[GateKeeper] Running Gate check for ${finalSymbol}...`);
                    setLoadingMessage('Running Gate Scan...');
                    completeStep('market-data'); startStep('gate-scan');

                    const gateResult = await getGateAnalysis(finalSymbol, loggedTrades);
                    capturedGateResult = gateResult.gateOutput; // Capture locally for processNewAnalysis
                    setCurrentGateResult(gateResult.gateOutput);

                    if (gateResult.shouldProceed) {
                        gateInjection = gateResult.promptPrefix;
                        console.log(`[GateKeeper] ✅ Gate PASSED: Confidence cap ${(gateResult.gateOutput.confidenceCap * 100).toFixed(0)}%`);
                        if (gateResult.gateOutput.suggestedDirection) {
                            console.log(`[GateKeeper] Pattern Memory suggests: ${gateResult.gateOutput.suggestedDirection}`);
                        }
                    } else {
                        console.log(`[GateKeeper] ⚠️ Gate BLOCKED: ${gateResult.rejectionReason}`);
                        // Even if blocked, still proceed but with max penalty applied
                        gateInjection = `\n⚠️ GATE WARNING: ${gateResult.rejectionReason}\n`;
                    }
                } catch (gateError) {
                    console.error('[GateKeeper] Gate check failed:', gateError);
                    // Fail-open: proceed without Gate constraints
                }
            }

            // Prepend Gate injection to enhanced prompt if available
            if (gateInjection) {
                enhancedPrompt = `${gateInjection}${enhancedPrompt}`;
                console.log('[GateKeeper] Gate constraints injected into prompt');
            }
            // ========== END GATE KEEPER ==========

            console.log('[Hybrid Intelligence] Enhanced prompt length:', enhancedPrompt.length);
            console.log('[Hybrid Intelligence] Has injection:', hybridDataInjection.length > 0);
            console.warn('[AI Learning] Has learning injection:', learningInjection.length > 0);
            console.log('[Hybrid Intelligence] ======= END =======');

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
                        console.log(`[GateKeeper] Result stored in analysis: cap=${(capturedGateResult.confidenceCap * 100).toFixed(0)}%`);
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
                            console.log(`[ValidationGate] Confidence adjusted: ${validationResult.originalConfidence} → ${validationResult.adjustedConfidence}`);
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
                                console.log(`[Bayesian] Confidence capped: ${current} → ${bayesianConfidenceCap}`);
                            }
                        }

                        // Store validation warnings
                        if (validationResult.warnings.length > 0) {
                            finalAnalysis.validationWarnings = validationResult.warnings;
                            console.log(`[ValidationGate] ${validationResult.warnings.length} warnings added to analysis`);
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
                            console.log(`[ValidationGate] Entry Timing Score: ${validationResult.entryTiming.score}/100 (${validationResult.entryTiming.timing})`);

                            // Store Entry Timing Score for HybridDataPanel display
                            setCurrentEntryTimingScore({
                                score: validationResult.entryTiming.score,
                                timingQuality: validationResult.entryTiming.timing,
                                suggestedEntry: validationResult.entryTiming.suggestedEntry
                            });

                            // Store suggested entry price for HybridDataPanel SL Optimization display
                            if (validationResult.entryTiming.suggestedEntry?.price) {
                                setCurrentSuggestedEntryPrice(validationResult.entryTiming.suggestedEntry.price);
                                console.log(`[ValidationGate] Suggested Entry Price: $${validationResult.entryTiming.suggestedEntry.price}`);
                            }
                        }

                        // Store SL Optimization for HybridDataPanel display
                        if (validationResult.slOptimization) {
                            setCurrentSlOptimization(validationResult.slOptimization);
                            console.log(`[ValidationGate] SL Optimization: Recommended multiplier ${(validationResult.slOptimization.recommendedMultiplier * 100).toFixed(0)}%, Missed wins: ${validationResult.slOptimization.missedWinRate.toFixed(0)}%`);
                        }

                        // Log validation report (for debugging)
                        const modeStr = isAccuracyModeEnabled
                            ? (accuracySubMode === 'pure_ai' ? 'Pure AI' : 'Accuracy Original')
                            : 'Standard';
                        console.log(`[ValidationGate] Mode: ${modeStr} | Hybrid: ${isHybridIntelligenceEnabled}`);
                        console.log('[ValidationGate] Full Report:\n', validationResult.validationReport);

                        // ========== MONTE CARLO SIMULATION ==========
                        // Run simulation if we have hybrid data and a trade setup
                        console.log('[MonteCarlo] Conditions check:', {
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
                                    console.log(`[MonteCarlo] Simulation complete: WinRate=${mcResult.winRate}%, EV=${mcResult.expectedValue}%`);
                                } else {
                                    console.log('[MonteCarlo] Simulation returned null - insufficient trade data');
                                }
                            }).catch(mcError => {
                                console.error('[MonteCarlo] Simulation failed:', mcError);
                            });
                        } else {
                            console.log('[MonteCarlo] Skipped - missing conditions:', {
                                needsEntryPoints: !finalAnalysis.entryPoints?.length ? 'No entry points in analysis' : 'present',
                                needsStopLoss: !finalAnalysis.stopLoss ? 'No stop loss in analysis' : 'present'
                            });
                        }
                        // ========== END MONTE CARLO ==========

                        // ========== LIVE BACKTEST ==========
                        // Run backtest if we have trade history
                        console.log('[LiveBacktest] Conditions check:', {
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
                                    console.log(`[LiveBacktest] ✅ Found ${btResult.totalMatches} matches: WinRate=${btResult.winRate.toFixed(1)}%, EV=${btResult.expectedValue.toFixed(2)}%`);
                                } else {
                                    console.log('[LiveBacktest] ⚠️ No similar trades found in history');
                                }
                            } catch (btError) {
                                console.error('[LiveBacktest] ❌ Backtest failed:', btError);
                            }
                        } else {
                            console.log('[LiveBacktest] ⏭️ Skipped - missing conditions:', {
                                needsMoreTrades: loggedTrades.length < 3 ? `Need ${3 - loggedTrades.length} more logged trades` : '✓',
                                needsCoinName: !finalAnalysis.coinName ? 'No coin detected in analysis' : '✓'
                            });
                        }
                        // ========== END LIVE BACKTEST ==========

                    } catch (validationError) {
                        console.error('[ValidationGate] Validation failed:', validationError);
                    }
                    // ========== END VALIDATION GATE ==========

                    return recalculateAnalysisMetrics(finalAnalysis, activeConversation?.leverage || 100);
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

                    const analysisPromises = enabledProviders.map(provider => {
                        if (isStagedEnsemble) {
                            updateEnsembleProgress(progress => ({
                                ...progress,
                                analysts: progress.analysts.map(analyst => analyst.key === provider.thoughtsKey
                                    ? { ...analyst, status: 'analyzing' }
                                    : analyst),
                            }));
                        }
                        return cachedAnalyzeTradingView(
                            provider.config,
                            provider.model,
                            enhancedPrompt,
                            imageFiles,
                            currentAbortController.signal,
                            summaries,
                            currentMessages,
                            enhancedFinalTradeSummary, // Pattern Memory (Synthesis)
                            recentInsightsString,      // Recent Insights (Individual)
                            // provider.model removed from rest (now param 2)
                            activeFrameworks,
                            isDeepAnalysis,
                            memoryToInject,
                            currentThreadSummary,
                            isAccuracyModeEnabled ? accuracySubMode : undefined,
                            instructionsToUse,
                            isPlaybookEnabledInPureAI,
                            isFamiliesEnabledInPureAI,
                            isMemoryEnabledInPureAI,
                            // Analyst Lens: pass role-specific prompt based on trading style.
                            // Custom overrides from the prompt editor win over built-ins.
                            lensConfig.enabled && provider.thoughtsKey
                                ? (customLensPrompts?.[getRoleForProvider(`${provider.config.id}::${provider.model}`, lensConfig.assignments)]
                                    || getLensPromptForStyle(
                                        `${provider.config.id}::${provider.model}`,
                                        lensConfig.assignments,
                                        // For auto mode, use swing as default (will be detected per-call with hybrid data)
                                        lensConfig.tradingStyle === 'auto' ? 'swing' : lensConfig.tradingStyle
                                    ))
                                : undefined,
                            // Normal mode (Lenses off): custom base prompt override.
                            lensConfig.enabled ? undefined : (customEnsemblePrompt || undefined),
                            // Streamed chain-of-thought deltas accumulate — the
                            // latest full string is pushed to the live cards.
                             (reasoning: string) => {
                                 reasoningMapRef.current[provider.name] = (reasoningMapRef.current[provider.name] || '') + reasoning;
                                 if (isStagedEnsemble) {
                                     updateEnsembleProgress(progress => ({
                                         ...progress,
                                         analysts: progress.analysts.map(analyst => analyst.key === provider.thoughtsKey
                                             ? { ...analyst, reasoning: reasoningMapRef.current[provider.name] }
                                             : analyst),
                                     }));
                                 }
                             }
                         )
                             .then(result => {
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
                    if (!isCurrentRequest()) return;
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
                        if (!isCurrentRequest()) return;
                        if (settled.status !== 'fulfilled') continue; // failed analyst has no analysis
                        const providerName = enabledProviders[index]?.name || `Unknown-${index}`;
                        const analysis = settled.value?.analysis;

                        console.log(`[PerAI-MonteCarlo] Checking ${providerName}...`);

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

                                if (!isCurrentRequest()) return;
                                if (mcResult) {
                                    perAIMC.push({
                                        provider: providerName,
                                        result: mcResult,
                                        isModeratorFinal: false
                                    });
                                    console.log(`[PerAI-MonteCarlo] ${providerName}: Success (WinRate=${mcResult.winRate}%)`);
                                }
                            } catch (err) {
                                console.error(`[PerAI-MonteCarlo] ${providerName} failed execution:`, err);
                            }
                        } else {
                            console.warn(`[PerAI-MonteCarlo] ${providerName} - Skipped (Missing components: Entry=${hasEntry}, SL=${hasSL}, TP=${hasTP})`);
                        }
                    }

                    // Store per-AI Monte Carlo results
                    if (perAIMC.length > 0) {
                        setPerAIMonteCarloResults(perAIMC);
                        console.log(`[PerAI-MonteCarlo] Completed ${perAIMC.length} simulations`);
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

                    if (isAccuracyModeEnabled) {
                        // ACCURACY MODE
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
                            }
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
                                // so the debate chat can show it live.
                                reasoningMapRef.current[speaker] = reasoning;
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
                            hybridDataInjection
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
                            if (!isCurrentRequest()) break;
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
                            if (!isCurrentRequest()) break;
                            if (!event || typeof event.text !== 'string') continue;

                            const key = `${event.round}::${event.speaker}`;
                            // The engine emits this marker before a moderator
                            // verdict retry — discard the failed attempt's
                            // partial prose so it never glues onto the verdict.
                            if (event.text.includes('<MODERATOR_RETRY>')) {
                                turnTexts[key] = '';
                                continue;
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
                    if (!isCurrentRequest()) return;

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
                            const err = verifyError as { message?: string };
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
                            analysis: processNewAnalysis(finalAnalysis),
                            outcome: TradeOutcome.PENDING,
                            debateTurns: existingMessage.debateTurns,
                            thoughtProcesses: { ...thoughtMap },
                            reasoningProcesses: { ...reasoningMapRef.current },
                            activeDebateSpeakers: {},
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
                            analystCount: fulfilledAnalysts.length,
                            btMatches: liveBtResult?.totalMatches,
                            btWinRate: liveBtResult?.winRate,
                            btEV: liveBtResult?.expectedValue,
                        };

                        // Background completion notification (native, backgrounded only).
                        void notifyAnalysisComplete(
                            'Analysis complete',
                            `${finalAnalysis.direction} ${finalAnalysis.coinName || ''} — ${finalAnalysis.confidence} confidence`
                        );

                        // Inject market snapshot if available (for Algo Mode & Regeneration)
                        if (freshHybridData && updatedMessage.analysis) {
                            updatedMessage.analysis.marketSnapshot = freshHybridData;
                        }

                        const newMessages = [...prev];
                        newMessages[messageIndex] = updatedMessage;
                        return newMessages;
                    });

                    // === ThinkingStore: Save reasoning for training & analysis ===
                    // Persist per-analyst reasoning, moderator synthesis, and debate turns
                    // so they can be correlated with outcomes and exported for model training.
                    try {
                        const tradeId = finalAnalysis.createdAt || new Date().toISOString();
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
                                createdAt: now,
                            });
                        });

                        // Save asynchronously (non-blocking)
                        saveThinkingBatch(thinkingRecords).catch(err => {
                            console.warn('[ThinkingStore] Failed to save thinking records:', err);
                        });
                    } catch (thinkingError) {
                        console.warn('[ThinkingStore] Error preparing thinking records:', thinkingError);
                    }

                } else if (enabledProviders.length === 1) {
                    const provider = enabledProviders[0];
                    setLoadingMessage(isAccuracyModeEnabled ? `Running High-Precision Analysis...` : `Analyzing with ${provider.name}...`);
                    completeStep('gate-scan'); startStep('analysis');
                    setAnalysisSteps(prev => prev.map(s => s.id === 'analysis' ? { ...s, title: `Analyzing with ${provider.name}` } : s));
const result = await cachedAnalyzeTradingView(
                            provider.config,
                            provider.model,
                            enhancedPrompt, // Fixed: was promptToSend, now uses enhancedPrompt with Hybrid data
                            imageFiles,
                            currentAbortController.signal,
                            summaries,
                            currentMessages,
                            finalTradeSummary,
                            recentInsightsString,      // Recent Insights (Individual) - must match multi-provider arg order
                            // provider.model removed from rest (now param 2)
                            activeFrameworks,
                            isDeepAnalysis,
                            memoryToInject,
                            currentThreadSummary,
                            isAccuracyModeEnabled ? accuracySubMode : undefined,
                            instructionsToUse,
                            isPlaybookEnabledInPureAI,
                            isFamiliesEnabledInPureAI,
                            isMemoryEnabledInPureAI,
                            // Analyst Lens: pass role-specific prompt based on trading style
                            // (custom prompt overrides from the prompt editor win).
                            lensConfig.enabled && provider.thoughtsKey
                                ? (customLensPrompts?.[getRoleForProvider(`${provider.config.id}::${provider.model}`, lensConfig.assignments)]
                                    || getLensPromptForStyle(
                                        `${provider.config.id}::${provider.model}`,
                                        lensConfig.assignments,
                                        lensConfig.tradingStyle === 'auto' ? 'swing' : lensConfig.tradingStyle
                                    ))
                                : undefined,
                            // Normal mode (Lenses off): custom base prompt override.
                            lensConfig.enabled ? undefined : (customEnsemblePrompt || undefined),
                            // Solo path has no onReasoning callback — keep the
                            // positional slots aligned with the multi path.
                            undefined
                        );
                    if (!isCurrentRequest()) return;
                    const soloAiMessage: Message = {
                        id: `ai-${Date.now()}`, role: MessageRole.AI, text: result.thoughtProcess, createdAt: new Date().toISOString(), analysis: processNewAnalysis(result.analysis), sources: result.sources || [], outcome: TradeOutcome.PENDING, ocrModelUsed: userMessage.ocrModelUsed,
                        imageSummaries: userMessage.imageSummaries,
                        modelsUsed: { [provider.thoughtsKey]: provider.model },
                        thoughtProcesses: { [provider.thoughtsKey]: result.thoughtProcess },
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
                if (!isCurrentRequest()) return;
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
            const cancelled = !isCurrentRequest();
            if (!cancelled) failStep(currentPhaseRef.current);
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
                window.setTimeout(() => setIsRateLimited(false), 60_000);
                return;
            }

            if (isQuotaError(error)) {
                const quotaModelNames = buildModelIdToName(providerConfigs);
                let flaggedModel = '';
                enabledProviders.forEach(p => {
                    if (error.message.toLowerCase().includes(p.name.toLowerCase()) || error.model === p.model) {
                        setQuotaExceededModels(prev => new Set(prev).add(quotaModelNames[p.model] || p.model));
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
                // NOTE: the old finally force-completed every running step,
                // masking debate-phase errors and cancellations as "complete".
                // Failures are marked by the catch above; success paths already
                // complete their own steps.
                analysisAbortController.current = null;
                analysisConversationIdRef.current = null;
                setIsAnalysisInProgress(false);
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
        }
    };

    // ─── Chat Management ───────────────────────────────────────────────────
    const handleClearChat = () => {
        if (confirm('Clear current chat messages?')) {
            updateMessages(() => []);
        }
    };

    const handleDeleteMessages = (ids: string[]) => {
        if (confirm(`Delete ${ids.length} messages?`)) {
            updateMessages(prev => prev.filter(m => !ids.includes(m.id)));
        }
    };

    return {
        // State
        input, setInput,
        images, setImages,
        loadingMessage, setLoadingMessage,
        analysisSteps, setAnalysisSteps,
        currentGateResult, setCurrentGateResult,
        currentVisionData, setCurrentVisionData,
        isDeepAnalysis, setIsDeepAnalysis,
        quotaExceededModels, setQuotaExceededModels,

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
    };
}
