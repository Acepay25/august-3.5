
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { VirtuosoHandle } from 'react-virtuoso';
import { Message, MessageRole, TradeOutcome, ImageMetadata, AIProvider, Conversation, UserProfile, SavedAnalysis, TradeSummary, GlobalMemory, AccuracySubMode, CustomInstructionsMap, AnalystLensConfig, LoggedTrade } from './types';
import * as ensembleService from './services/providers/ensembleService';
import { generateFinalSummary } from './services/providers/GenericAnalysisService';
import * as dbService from './services/infrastructure/dbService';
import { ANALYST_ROLE_DEFINITIONS, getRoleForProvider } from './services/ui/AnalystLensService';
import { AnalystRole } from './types/enums';
import { ProbabilityEngineService } from './services/analysis/ProbabilityEngineService';


// Modular Imports
import { ChatContextProps } from './components/chat/MessageItem';
import { useToastActions } from './components/shared/Toast';
import { useConfirmDialog } from './components/shared/ConfirmDialog';
import { OnboardingCard } from './components/shared/OnboardingCard';
import { Header } from './components/shared/Header';
import { SidebarContent } from './components/shared/Sidebar';
import { ChatArea } from './components/chat/ChatArea';
import { useProviderConfigs } from './hooks/useProviderConfigs';
import { useAppSettings } from './hooks/useAppSettings';
import { useJournalUI } from './hooks/useJournalUI';
import { PostMortemCandidate } from './components/modals/PostTradeUploadModal';
import { ChevronLeftIcon, ChevronRightIcon } from './components/shared/Icons';

// P1-6: Lazy-load heavy, conditionally-rendered components so the initial
// bundle is much smaller. Previously the entire app was one ~1.73 MB chunk.
// Each lazy() call below produces a separate chunk loaded on demand when
// the user opens the corresponding panel/modal. ChatArea and Header stay
// eager (always-rendered, critical path).
const Journal = React.lazy(() => import('./components/journal/Journal').then(m => ({ default: m.Journal })));
const StrategySearch = React.lazy(() => import('./components/shared/StrategySearch'));
const UserProfileManager = React.lazy(() => import('./components/settings/UserProfileManager'));
const SavedAnalyses = React.lazy(() => import('./components/journal/SavedAnalyses'));
const SettingsMenu = React.lazy(() => import('./components/settings/SettingsMenu'));
const LiveStreamView = React.lazy(() => import('./components/analysis/LiveStreamView'));
const LogTradeModal = React.lazy(() => import('./components/journal/LogTradeModal').then(m => ({ default: m.LogTradeModal })));
const PostTradeUploadModal = React.lazy(() => import('./components/modals/PostTradeUploadModal').then(m => ({ default: m.PostTradeUploadModal })));
const SkipTradeModal = React.lazy(() => import('./components/modals/SkipTradeModal').then(m => ({ default: m.SkipTradeModal })));
const DataCaptureModal = React.lazy(() => import('./components/modals/DataCaptureModal').then(m => ({ default: m.DataCaptureModal })));
const EntryNotHitCaptureModal = React.lazy(() => import('./components/modals/EntryNotHitCaptureModal').then(m => ({ default: m.EntryNotHitCaptureModal })));
const OutcomeMismatchModal = React.lazy(() => import('./components/modals/OutcomeMismatchModal'));
const UpdateTradeModal = React.lazy(() => import('./components/journal/UpdateTradeModal').then(m => ({ default: m.UpdateTradeModal })));
const VisionDataViewer = React.lazy(() => import('./components/analysis/VisionDataViewer'));
const LiveMarket = React.lazy(() => import('./components/market/LiveMarket'));
const AccuracyModeModal = React.lazy(() => import('./components/modals/AccuracyModeModal').then(m => ({ default: m.AccuracyModeModal })));
const AdvancedAnalyticsSidePanel = React.lazy(() => import('./components/dashboards/AdvancedAnalyticsSidePanel'));
const ScenarioSimulator = React.lazy(() => import('./components/modals/ScenarioSimulator'));
const UpdateOverlay = React.lazy(() => import('./components/shared/UpdateOverlay'));
const CompareModal = React.lazy(() => import('./components/analysis/CompareModal'));
const SavedAnalysesGallery = React.lazy(() => import('./components/dashboards/SavedAnalysesGallery'));
const MistakeWarningBanner = React.lazy(() => import('./components/shared/MistakeWarningBanner'));
import CommandPalette, { PaletteAction } from './components/shared/CommandPalette';
const AnalysisProgress = React.lazy(() => import('./components/analysis/AnalysisProgress'));
import { DEFAULT_FRAMEWORKS } from './constants/models';
import { buildModelIdToName, buildProviderNameToId, getFirstReadyProvider } from './utils/providerUtils';
import { createNewConversation, DEFAULT_LEVERAGE } from './utils/conversationUtils';
import { recalculateAnalysisMetrics } from './utils/analysisUtils';
import { processImagesForSummarization } from './utils/imageProcessor';
import { extractLastJson } from './utils/jsonUtils';
import { parseLevelProbabilities } from './schemas/tradeAnalysis';
import { pingBinanceAPI } from './services/analysis/MarketDataService';
import { updateCalibration, updateGranularCalibration, initializeCalibration } from './services/validation/ConfidenceCalibrationService';
import { ConfidenceCalibration, InsightKnowledgeBase } from './types';
import useNetworkStatus from './hooks/useNetworkStatus';
import { useUIState } from './hooks/useUIState';
import { useConversations } from './hooks/useConversations';
import { useMarketData } from './hooks/useMarketData';
import { useTradeLogging, MAX_TRADE_SUMMARIES } from './hooks/useTradeLogging';
import { useAnalysisPipeline } from './hooks/useAnalysisPipeline';
import { usePostMortem } from './hooks/usePostMortem';
import { useUserProfiles } from './hooks/useUserProfiles';
import { useSaveOnUnload } from './hooks/useSaveOnUnload';
import { offlineQueue, QueuedRequest } from './services/infrastructure/OfflineQueueService';
import { jobQueue, JobType } from './services/infrastructure/JobQueueService';
import { getPreference, setPreference, removePreference, getPreferenceObject, PREF_KEYS } from './services/infrastructure/PreferencesService';
// AI Learning Services - Adaptive Learning, Mistake Patterns, Insight Extraction
import { extractInsightsFromPostMortem, storeInsights, initializeKnowledgeBase } from './services/learning/InsightExtractionService';
import * as MemoryService from './services/learning/MemoryService';
import { ProviderConfig } from './types/provider';
import { syncFromTradeLog, syncRollingWindowFromTradeLog, initModelPerformanceService } from './services/backtesting/ModelPerformanceService';
import { saveLensConfig, initAnalystLensService, loadLensConfig, saveEnsembleModelSelection, EnsembleModelSelection, saveCustomEnsemblePrompt, saveCustomLensPrompts } from './services/ui/AnalystLensService';
import { detectTradingStyle, getEffectiveStyle, generateMasterPromptStyleInjection } from './services/ui/TradingStyleDetector';
import { checkDataIntegrity, createStartupBackup, updateTradeCount, logIntegrityEvent, runMigrations } from './services/validation/DataIntegrityService';
import { startAutoBackup, stopAutoBackup } from './services/infrastructure/BackupService';
import { initInvalidationRuleService, loadInvalidationRules } from './services/validation/InvalidationRuleService';
import { PriceAlertService } from './services/ui/PriceAlertService';
import { OutcomeAutopilotService, AutopilotResolution } from './services/ui/OutcomeAutopilotService';
import { clearAllCaches } from './services/infrastructure/responseCache';
import { initNativeStatusBar } from './services/infrastructure/NativeStatusBar';
import { initConfluenceService, syncConfluenceFromTradeLog } from './services/analysis/TimeframeConfluenceService';
import { initPatternMemoryService, setAttributedInsightsUser } from './services/learning/PatternMemorySynthesisService';
import GlobalLearningService from './services/learning/GlobalLearningService';
const VersionHistoryDashboard = React.lazy(() => import('./components/dashboards/VersionHistoryDashboard').then(m => ({ default: m.VersionHistoryDashboard })));

const App: React.FC = () => {
    const toast = useToastActions();
    const { confirm: confirmDialog, ConfirmDialogComponent } = useConfirmDialog();

    // UI visibility and progress state (extracted to hooks/useUIState.ts)
    const {
        isUserModalOpen, setIsUserModalOpen,
        isStrategySearchVisible, setIsStrategySearchVisible,
        isSavedAnalysesVisible, setIsSavedAnalysesVisible,
        isSettingsMenuVisible, setIsSettingsMenuVisible,
        isLiveMarketVisible, setIsLiveMarketVisible,
        isAdvancedAnalyticsOpen, setIsAdvancedAnalyticsOpen,
        isVersionHistoryVisible, setIsVersionHistoryVisible,
        isLivePostMortemVisible, setIsLivePostMortemVisible,
        isMobileMenuOpen, setIsMobileMenuOpen,
        showMismatchModal, setShowMismatchModal,
        isLeverageDropdownOpen, setIsLeverageDropdownOpen,
        isVisionDataVisible, setIsVisionDataVisible,
        showAccuracyModal, setShowAccuracyModal,
        showScrollDown, setShowScrollDown,
        showScrollUp, setShowScrollUp,
        isLoading, setIsLoading,
        isHybridLoading, setIsHybridLoading,
        isCalculatingAIProbabilities, setIsCalculatingAIProbabilities,
        isPostMortemTypingComplete, setIsPostMortemTypingComplete,
        isAnalysisInProgress, setIsAnalysisInProgress,
        isPostMortemInProgress, setIsPostMortemInProgress,
        isSummaryInProgress, setIsSummaryInProgress,
        isInsightGenerating, setIsInsightGenerating,
        isAutoCapturing, setIsAutoCapturing,
        isUpdateAutoCapturing, setIsUpdateAutoCapturing,
        isEntryNotHitCapturing, setIsEntryNotHitCapturing,
        isRateLimited, setIsRateLimited,
    } = useUIState();

    // Provider configuration (API keys, base URLs, custom providers)
    const {
        configs: providerConfigs,
        isLoaded: providerConfigsLoaded,
        readyProviders,
        handleUpdateProvider,
        handleAddCustomProvider,
        handleRemoveProvider,
        handleToggleProvider: handleToggleProviderConfig,
        handleAddModel,
        handleRemoveModel,
        handleUpdateModel,
    } = useProviderConfigs();

    // Dynamic model display map built from configured providers.
    // Replaces the legacy static modelIdToName / ocrModelIdToName constants —
    // vision models are just provider models now, so one map serves both.
    const modelIdToName = useMemo(() => buildModelIdToName(providerConfigs), [providerConfigs]);
    const ocrModelIdToName = modelIdToName;
    // Debate speaker names → provider ids (for lens roles and model tooltips)
    const providerNameToId = useMemo(() => buildProviderNameToId(providerConfigs), [providerConfigs]);

    // Conversation state, derived values, and handlers (extracted to hooks/useConversations.ts)
    const {
        conversationHistory, setConversationHistory,
        activeConversationId, setActiveConversationId,
        activeConversation, messages, messagesRef,
        updateMessages, updateActiveConversation,
        selectedOcrModel,
        moderatorProviderId, moderatorModel,
        handleSetVisionModel,
        handleSetSelectedOcrModel,
        handleSetModeratorProvider, handleSetModeratorModel,
    } = useConversations();

    // UI and other state

    // AI analysis settings (memory, accuracy, instructions, summarization, lens)
    const {
        globalMemory, setGlobalMemory,
        memoryConfig, setMemoryConfig,
        memoryModel, setMemoryModel,
        isGlobalMemoryEnabled, setIsGlobalMemoryEnabled,
        isAccuracyModeEnabled, setIsAccuracyModeEnabled,
        accuracySubMode, setAccuracySubMode,
        customInstructions, setCustomInstructions,
        isPlaybookEnabledInPureAI, setIsPlaybookEnabledInPureAI,
        isFamiliesEnabledInPureAI, setIsFamiliesEnabledInPureAI,
        isMemoryEnabledInPureAI, setIsMemoryEnabledInPureAI,
        isHybridIntelligenceEnabled, setIsHybridIntelligenceEnabled,
        lensConfig, setLensConfig,
        ensembleModelSelection, setEnsembleModelSelection,
        customEnsemblePrompt, setCustomEnsemblePrompt,
        customLensPrompts, setCustomLensPrompts,
        confidenceCalibration, setConfidenceCalibration,
        insightKnowledgeBase, setInsightKnowledgeBase,
        activeFrameworks, setActiveFrameworks,
        summaryCharLimit, setSummaryCharLimit,
        summarizationProvider, setSummarizationProvider,
        summarizationModel, setSummarizationModel,
        useAlgorithmicSummary, setUseAlgorithmicSummary,
        useAlgorithmicInsights, setUseAlgorithmicInsights,
    } = useAppSettings();

    // Derive the moderator ProviderConfig from readyProviders
    const moderatorConfig: ProviderConfig = useMemo(() =>
        readyProviders.find(p => p.id === moderatorProviderId) || readyProviders[0] || {
            id: 'none', name: 'None', apiKey: '', baseUrl: '', apiFormat: 'chat_completions' as const,
            isEnabled: false, isBuiltIn: true, models: [], selectedModel: '',
        },
    [readyProviders, moderatorProviderId]);

    // Ensemble mode: off = casual chat with the selected model (no chart
    // analysis); on = full analysis/debate pipeline. Initialized once from
    // the loaded provider count so existing multi-provider setups keep
    // their current behavior. Declared early so useMarketData can gate its
    // polling on it.
    const [isEnsembleEnabled, setIsEnsembleEnabled] = useState(false);
    const ensembleModelCount = useMemo(() => readyProviders.reduce((total, provider) => {
        const selected = provider.ensembleModels?.filter(model => provider.models.includes(model))
            ?? (provider.selectedModel ? [provider.selectedModel] : []);
        return total + selected.length;
    }, 0), [readyProviders]);
    const requiredAnalystRoles = [AnalystRole.MACRO_VOLATILITY, AnalystRole.TECHNICAL_ANALYST, AnalystRole.RISK_EXECUTION];
    const missingAnalystRoles = useMemo(() => requiredAnalystRoles
        .filter(role => {
            const assignment = lensConfig?.assignments.find(item => item.role === role);
            const provider = readyProviders.find(item => item.id === assignment?.assignedProvider);
            return !assignment?.assignedProvider || !(assignment.assignedModel || provider?.selectedModel);
        }), [lensConfig, readyProviders]);
    const hasCompleteAnalystAssignments = useMemo(() => {
        if (missingAnalystRoles.length > 0) return false;
        const identities = requiredAnalystRoles.map(role => {
            const assignment = lensConfig.assignments.find(item => item.role === role)!;
            const provider = readyProviders.find(item => item.id === assignment.assignedProvider);
            return `${assignment.assignedProvider}::${assignment.assignedModel || provider?.selectedModel}`;
        });
        return new Set(identities).size === identities.length;
    }, [lensConfig, missingAnalystRoles, readyProviders]);
    const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() => {
        try {
            return window.localStorage.getItem('august_sidebar_collapsed') === 'true';
        } catch {
            return false;
        }
    });
    useEffect(() => {
        try {
            window.localStorage.setItem('august_sidebar_collapsed', String(isSidebarCollapsed));
        } catch {
            // Preferences are optional in restricted browser contexts.
        }
    }, [isSidebarCollapsed]);
    const ensembleInitializedRef = useRef(false);
    useEffect(() => {
        if (!ensembleInitializedRef.current && readyProviders.length > 0) {
            ensembleInitializedRef.current = true;
            setIsEnsembleEnabled(ensembleModelCount > 1);
        }
    }, [ensembleModelCount]);

    // Market data state and effects (extracted to hooks/useMarketData.ts)
    const marketData = useMarketData(isHybridIntelligenceEnabled, isEnsembleEnabled);
    const {
        currentHybridData, setCurrentHybridData,
        hybridConnectionStatus, setHybridConnectionStatus,
        latestMonteCarloResult, setLatestMonteCarloResult,
        latestBacktestResult, setLatestBacktestResult,
        perAIMonteCarloResults, setPerAIMonteCarloResults,
        currentSlOptimization, setCurrentSlOptimization,
        currentSuggestedEntryPrice, setCurrentSuggestedEntryPrice,
        currentEntryTimingScore, setCurrentEntryTimingScore,
        liveMarketConditions, setLiveMarketConditions,
    } = marketData;

    // Network status and offline queue
    const { isOnline, wasOffline } = useNetworkStatus();
    const [pendingQueueCount, setPendingQueueCount] = useState<number>(0);

    // Journal and message expansion state
    const {
        journalState, setJournalState,
        selectedProbabilityMessageId, setSelectedProbabilityMessageId,
        strategyToView, setStrategyToView,
        copiedMessageId, setCopiedMessageId,
        highlightedAnalysisId, setHighlightedAnalysisId,
        expandedPostMortemImages, setExpandedPostMortemImages,
        expandedPostMortems, setExpandedPostMortems,
        postMortemCandidate, setPostMortemCandidate,
    } = useJournalUI();

    // Refs for functions defined later but needed by useTradeLogging (breaks circular dependency)
    const handleSendMessageRef = useRef<(...args: any[]) => any>(null!);
    const startPostMortemAnalysisRef = useRef<(...args: any[]) => any>(null!);
    const stableHandleSendMessage = useCallback((...args: any[]) => handleSendMessageRef.current(...args), []);
    const stableStartPostMortem = useCallback((...args: any[]) => startPostMortemAnalysisRef.current(...args), []);

    // Trade logging state and handlers (extracted to hooks/useTradeLogging.ts)
    const {
        loggedTrades, setLoggedTrades,
        savedAnalyses, setSavedAnalyses,
        tradeSummaries, setTradeSummaries,
        finalTradeSummary, setFinalTradeSummary,
        loggingTradeId, setLoggingTradeId,
        skipCandidate, setSkipCandidate,
        updateCandidate, setUpdateCandidate,
        simulatorCandidate, setSimulatorCandidate,
        skipReason, setSkipReason,
        correctedEntry, setCorrectedEntry,
        dataCaptureCandidate, setDataCaptureCandidate,
        entryNotHitCandidate, setEntryNotHitCandidate,
        newlyAddedInsightIds, setNewlyAddedInsightIds,
        logTradeWithFeedback,
        autoLearnFromOutcome,
        confirmAutopilotOutcome,
        confirmAutopilotEntryNotHit,
        handleDataCaptureUpload,
        handleDataCaptureAuto,
        handleDataCaptureSkip,
        handleInitiateLogTrade,
        handleInitiateSkipTrade,
        handleConfirmSkipTrade,
        logEntryNotHitTrade,
        handleEntryNotHitAutoCapture,
        handleEntryNotHitUpload,
        handleEntryNotHitSkip,
        handleInitiateUpdateTrade,
        handleInitiateSimulator,
        handleConfirmUpdateTrade,
        handleUpdateAutoCapture,
        calculateTimeDifference,
    } = useTradeLogging({
        messages,
        updateMessages,
        activeConversationLeverage: activeConversation?.leverage,
        moderatorProviderId,
        moderatorModel,
        memoryModel,
        memoryConfig: memoryConfig || moderatorConfig,
        useAlgorithmicInsights,
        setIsAutoCapturing,
        setIsHybridLoading,
        setIsEntryNotHitCapturing,
        setIsUpdateAutoCapturing,
        setIsInsightGenerating,
        setCurrentHybridData,
        startPostMortemAnalysis: stableStartPostMortem,
        handleSendMessage: stableHandleSendMessage,
        toast,
        setPostMortemCandidate,
        setConfidenceCalibration,
    });

    const [leverageInput, setLeverageInput] = useState<string>('100');
    const appRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const virtuosoRef = useRef<VirtuosoHandle>(null);
    const mobileMenuRef = useRef<HTMLDivElement>(null);
    const leverageRef = useRef<HTMLDivElement>(null);

    // Casual-chat model (used when ensemble is off): app-wide preference,
    // persisted in Preferences. Empty until loaded or chosen — the pipeline
    // falls back to the first ready provider's model.
    const [selectedChatModel, setSelectedChatModel] = useState('');
    useEffect(() => {
        let cancelled = false;
        getPreference(PREF_KEYS.CASUAL_CHAT_MODEL).then(v => {
            if (!cancelled && v) setSelectedChatModel(v);
        });
        return () => { cancelled = true; };
    }, []);
    useEffect(() => {
        if (selectedChatModel) {
            setPreference(PREF_KEYS.CASUAL_CHAT_MODEL, selectedChatModel);
        } else {
            removePreference(PREF_KEYS.CASUAL_CHAT_MODEL);
        }
    }, [selectedChatModel]);

    // Knowledge base: post-mortem insight-extraction jobs complete in the
    // background queue — fold their results into the per-profile KB so the
    // "Lessons from your past trades" injection actually has data.
    useEffect(() => {
        const unsubscribe = jobQueue.onJobComplete(job => {
            const insights = job.result?.data;
            if (job.type === JobType.EXTRACT_INSIGHTS && job.result?.success && Array.isArray(insights) && insights.length > 0) {
                setInsightKnowledgeBase(prev => storeInsights(insights, prev));
            }
        });
        return unsubscribe;
    }, [setInsightKnowledgeBase]);

    // Analysis pipeline state, refs, and handlers (extracted to hooks/useAnalysisPipeline.ts)
    const {
        input, setInput,
        images, setImages,
        loadingMessage, setLoadingMessage,
        analysisSteps, setAnalysisSteps,
        currentGateResult, setCurrentGateResult,
        currentVisionData, setCurrentVisionData,
        isDeepAnalysis, setIsDeepAnalysis,
        quotaExceededModels, setQuotaExceededModels,
        analysisAbortController,
        initAnalysisSteps, startStep, completeStep, failStep, addSubStep,
        handleSendMessage,
        handleCancelAnalysis,
        handleClearChat,
        handleDeleteMessages,
        getActiveCustomInstructions,
    } = useAnalysisPipeline({
        messages, messagesRef, updateMessages, activeConversation, activeConversationId,
        providerConfigs: readyProviders,
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
        isEnsembleEnabled,
        ensembleModelSelection,
        customEnsemblePrompt,
        customLensPrompts,
        selectedChatModel,
        toast,
    });

    // Warn when ensemble is switched on without the required configuration
    // (2–3 enabled models + a selected moderator). The toggle still turns
    // on; the pipeline degrades to single-model analysis / casual chat.
    // Toggling off clears attached charts — they are only analyzed in
    // ensemble mode. Note: Accuracy Mode lifts the 3-provider cap
    // (useAnalysisPipeline only enforces it in Standard Mode), so the
    // maximum warning is skipped there.
    const handleSetEnsembleEnabled = useCallback((enabled: boolean) => {
        setIsEnsembleEnabled(enabled);
        if (!enabled) {
            setImages([]);
            return;
        }
        const issues: string[] = [];
        if (ensembleModelCount < 2) {
            const missing = 2 - ensembleModelCount;
            issues.push(`enable ${missing} more AI model${missing === 1 ? '' : 's'} (ensemble needs 2–3 enabled models)`);
        } else if (!isAccuracyModeEnabled && ensembleModelCount > 3) {
            issues.push('disable extra models (maximum 3 for ensemble)');
        }
        if (!moderatorProviderId || !readyProviders.some(p => p.id === moderatorProviderId)) {
            issues.push('select a moderator in Settings → AI Models');
        }
        if (missingAnalystRoles.length > 0 && lensConfig.enabled) {
            issues.push(`assign ${missingAnalystRoles.map(role => ANALYST_ROLE_DEFINITIONS[role].shortName).join(', ')} in Assign Analysts`);
        } else if (lensConfig.enabled) {
            const identities = requiredAnalystRoles.map(role => {
                const assignment = lensConfig.assignments.find(item => item.role === role)!;
                const provider = readyProviders.find(item => item.id === assignment.assignedProvider);
                return `${assignment.assignedProvider}::${assignment.assignedModel || provider?.selectedModel}`;
            });
            if (new Set(identities).size !== identities.length) issues.push('assign a different model to each analyst role');
        }
        if (issues.length > 0) {
            toast.warning('Ensemble needs more setup', `To use ensemble: ${issues.join(' and ')}.`);
        }
    }, [readyProviders, ensembleModelCount, moderatorProviderId, isAccuracyModeEnabled, toast, setImages, lensConfig.enabled, missingAnalystRoles]);

    // P0-2: Mirror the (later-declared) activeUsername into a ref so the
    // usePostMortem hook — which is instantiated BEFORE useUserProfiles
    // destructures activeUsername — can observe user switches and cancel
    // in-flight post-mortem work that would otherwise clobber the new user.
    //
    // The ref is written to during render from sessionStorage (the same
    // source of truth loadUserData uses at line 726), and usePostMortem
    // watches it for changes. We ALSO update it via the effect below once
    // activeUsername is destructured, so both paths agree.
    const activeUsernameRef = useRef<string | null>(sessionStorage.getItem('activeUsername'));
    activeUsernameRef.current = sessionStorage.getItem('activeUsername') || null;

    // Freshest logged-trades array for the post-mortem hook. Capture flows
    // call setLoggedTrades and startPostMortemAnalysis in the same tick, so
    // the `loggedTrades` prop closure is stale by the time the post-mortem
    // resolves — the ref (updated every render) always holds the latest rows.
    const loggedTradesRef = useRef<LoggedTrade[]>(loggedTrades);
    loggedTradesRef.current = loggedTrades;

    // Post-mortem analysis state and handlers (extracted to hooks/usePostMortem.ts)
    const {
        mismatchData, setMismatchData,
        typingMessageState, setTypingMessageState,
        livePostMortemThoughts, setLivePostMortemThoughts,
        startPostMortemAnalysis,
        invalidatePostMortemRuns,
        handleRetryPostMortem,
        handleAllPostMortemTypingComplete,
        handleMismatchResolution,
    } = usePostMortem({
        messages,
        activeConversationId,
        messagesRef,
        updateMessages,
        isAccuracyModeEnabled,
        accuracySubMode,
        // P0-2: a ref (not the raw string) is passed because usePostMortem
        // is called before useUserProfiles destructures activeUsername below.
        // The ref is kept in sync on every render via the effect right after.
        activeUsernameRef,
        providerConfigs: readyProviders,
        moderatorConfig,
        moderatorModel,
        finalTradeSummary,
        loggedTrades,
        loggedTradesRef,
        setLoggedTrades,
        globalMemory,
        setGlobalMemory,
        memoryModel,
        memoryConfig,
        tradeSummaries,
        setTradeSummaries,
        setIsPostMortemInProgress,
        setIsLivePostMortemVisible,
        setLoadingMessage,
        setIsPostMortemTypingComplete,
        setShowMismatchModal,
        setExpandedPostMortems,
        initAnalysisSteps,
        startStep,
        completeStep,
        setAnalysisSteps,
        setPostMortemCandidate,
    });

    // Update ref for useTradeLogging (breaks circular dependency)
    startPostMortemAnalysisRef.current = startPostMortemAnalysis;

    // ... (Rest of existing hooks/functions) ...
    const analysisMessages = useMemo(() => messages.filter(m => m.analysis || m.isDebating), [messages]);
    const currentInsightIds = useMemo(() => tradeSummaries.map(s => s.id), [tradeSummaries]);

    const isImageUploadDisabled = isAnalysisInProgress || isPostMortemInProgress;
    const isSummarizing = images.some(img => img.isLoading);
    const isAnyProviderEnabled = readyProviders.length > 0 || isAccuracyModeEnabled;

    const familyWinRates = useMemo(() => {
        // ... (same implementation) ...
        const stats: Record<string, { total: number; wins: number; winRate: number }> = {
            'Family A': { total: 0, wins: 0, winRate: 0 },
            'Family B': { total: 0, wins: 0, winRate: 0 },
            'Family C': { total: 0, wins: 0, winRate: 0 },
            'Family Omega': { total: 0, wins: 0, winRate: 0 },
        };

        loggedTrades.forEach(trade => {
            if (trade.outcome === TradeOutcome.PENDING || trade.outcome === TradeOutcome.SKIPPED || trade.outcome === TradeOutcome.ENTRY_NOT_HIT) return;

            let family = trade.analysis.detectedPatternFamily;

            if (!family) {
                const pat = (trade.analysis.marketConditions?.pattern || '').toUpperCase();
                if (pat.includes('FAMILY A')) family = 'Family A';
                else if (pat.includes('FAMILY B')) family = 'Family B';
                else if (pat.includes('FAMILY C')) family = 'Family C';
                else if (pat.includes('OMEGA')) family = 'Family Omega';
            }

            let key = '';
            if (family?.toUpperCase().includes('FAMILY A')) key = 'Family A';
            else if (family?.toUpperCase().includes('FAMILY B')) key = 'Family B';
            else if (family?.toUpperCase().includes('FAMILY C')) key = 'Family C';
            else if (family?.toUpperCase().includes('OMEGA')) key = 'Family Omega';

            if (key && stats[key]) {
                stats[key].total++;
                if (trade.outcome === TradeOutcome.WIN) {
                    stats[key].wins++;
                }
            }
        });

        Object.keys(stats).forEach(key => {
            const s = stats[key];
            if (s.total > 0) {
                s.winRate = Math.round((s.wins / s.total) * 100);
            }
        });

        return stats;
    }, [loggedTrades]);

    // ... (useEffects) ...
    useEffect(() => {
        if (activeConversation) {
            setLeverageInput(String(activeConversation.leverage));
        }
    }, [activeConversation?.id, activeConversation?.leverage]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (isMobileMenuOpen && mobileMenuRef.current && !mobileMenuRef.current.contains(event.target as Node)) {
                setIsMobileMenuOpen(false);
            }
            if (isLeverageDropdownOpen && leverageRef.current && !leverageRef.current.contains(event.target as Node)) {
                setIsLeverageDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isMobileMenuOpen, isLeverageDropdownOpen]);

    // Offline Queue: Sync when coming back online
    useEffect(() => {
        const updateQueueCount = async () => {
            try {
                const count = await offlineQueue.getCount();
                setPendingQueueCount(count);
            } catch (e) {
                console.error('[OfflineQueue] Failed to get queue count:', e);
            }
        };

        // Load initial queue count
        updateQueueCount();

        // When coming back online, process the queue
        if (wasOffline && isOnline) {
            console.log('[OfflineQueue] Back online, processing queued requests...');
            offlineQueue.process({
                onItemProcessed: () => updateQueueCount(),
                onQueueEmpty: () => setPendingQueueCount(0)
            });
        }
    }, [isOnline, wasOffline]);

    // --- AUTOMATIC MEMORY COMPRESSION --- DISABLED to save tokens
    // Thread Memory (Layer 2) is no longer used, so no need to compress chat history
    // useEffect(() => {
    //     const compressMemory = async () => {
    //         if (!activeConversationId || !activeConversation || messages.length === 0) return;
    //         if (messages.length > 5 && messages.length % 8 === 0) {
    //             try {
    //                 const newSummary = await MemoryService.compressChatHistory(messages, activeConversation.threadSummary || '', memoryProvider);
    //                 updateActiveConversation(c => ({
    //                     ...c,
    //                     threadSummary: newSummary
    //                 }));
    //             } catch (e) {
    //                 console.error("Memory compression failed:", e);
    //             }
    //         }
    //     };
    //     compressMemory();
    // }, [messages.length, activeConversationId]);

    // ... (resetAppState, loadUserData) ...
    // resetAppState(usernameToSave): persists the blank profile under an
    // EXPLICIT username. The caller decides the save target — reading
    // `activeUsername` from the closure here is wrong: on user deletion the
    // closure still holds the deleted name, so the save resurrected a blank
    // profile for the user we just deleted. Pass null to skip persisting.
    const resetAppState = async (usernameToSave?: string | null) => {
        handleCancelAnalysis();
        const newConv = createNewConversation();
        setConversationHistory([newConv]);
        setActiveConversationId(newConv.id);
        setLoggedTrades([]);
        setSavedAnalyses([]);
        setTradeSummaries([]);
        setFinalTradeSummary(null);
        setGlobalMemory(undefined);
        setIsGlobalMemoryEnabled(true);
        setIsAccuracyModeEnabled(false);
        setAccuracySubMode('original');
        setCustomInstructions({ general: [], accuracyOriginal: [], accuracyPure: [] });
        setIsPlaybookEnabledInPureAI(false);
        setIsFamiliesEnabledInPureAI(false);
        setIsMemoryEnabledInPureAI(false);
        setIsHybridIntelligenceEnabled(false);
        setIsAutoCapturing(false);
        setIsUpdateAutoCapturing(false);
        setIsEntryNotHitCapturing(false);
        setActiveFrameworks(DEFAULT_FRAMEWORKS);
        setSummaryCharLimit(4000);
        const firstReady = getFirstReadyProvider(providerConfigs);
        setSummarizationProvider(firstReady?.id || '');
        setSummarizationModel(firstReady?.selectedModel || '');
        setInput('');
        setImages([]);
        setExpandedPostMortems({});

        if (usernameToSave) {
            await dbService.saveUserProfile(usernameToSave, {
                conversations: [newConv],
                tradeLog: [],
                savedAnalyses: [],
                tradeSummaries: [],
                finalTradeSummary: null,
                globalMemory: undefined,
                settings: { activeFrameworks: DEFAULT_FRAMEWORKS, summaryCharLimit: 4000, summarizationProvider: firstReady?.id || '', summarizationModel: firstReady?.selectedModel || '', isGlobalMemoryEnabled: true, isAccuracyModeEnabled: false, accuracySubMode: 'original', customInstructions: { general: [], accuracyOriginal: [], accuracyPure: [] }, isPlaybookEnabledInPureAI: false, isFamiliesEnabledInPureAI: false, isMemoryEnabledInPureAI: false, isHybridIntelligenceEnabled: false, isAutoCapturing: false, isUpdateAutoCapturing: false, isEntryNotHitCapturing: false },
                lastActiveConversationId: newConv.id
            });
        }
    };

    // User Profile state and handlers (extracted to hooks/useUserProfiles.ts)
    const {
        activeUsername, setActiveUsername,
        existingUsernames, setExistingUsernames,
        saveStatus, setSaveStatus,
        handleImportData,
        handleDeleteUser,
        handleSwitchUser,
        handleExportData,
    } = useUserProfiles({
        resetAppState,
        setIsUserModalOpen,
        setIsSettingsVisible: setIsSettingsMenuVisible,
        toast,
    });

    // Keep the activeUsernameRef (read by usePostMortem's run-staleness
    // checks) in sync with the canonical activeUsername state before
    // dependent hooks render.
    activeUsernameRef.current = activeUsername ?? null;

    // P1-4/P1-9: Track the previous active user in a ref mutated by this
    // effect itself. (A render-phase read of activeUsernameRef made
    // `previous` equal the NEW username right after a switch — the
    // cache-clear and backup-stop below never fired, so one user's cached
    // AI responses and 30-min backup scheduler leaked into the next user's
    // session. The ref initializes from the session user so a same-user boot
    // is a no-op.)
    const previousUsernameRef = useRef<string | null>(activeUsernameRef.current);
    useEffect(() => {
        const previous = previousUsernameRef.current;
        const current = activeUsername ?? null;
        if (previous !== current) {
            // P1-9: Stop the old user's backup scheduler; loadUserData starts
            // a fresh one for the new user.
            if (previous !== null) stopAutoBackup();
            // P1-4: Clear the AI response cache (memory + persisted layers)
            // so one user's cached analyses are never served to another user.
            clearAllCaches();
            console.log('[App] Cleared response cache on user switch');
        }
        previousUsernameRef.current = current;
    }, [activeUsername]);

    // P1-9: Final cleanup — stop the auto-backup scheduler when the app unmounts.
    useEffect(() => {
        return () => {
            stopAutoBackup();
        };
    }, []);

    // ─── Command palette (Ctrl/Cmd+K) ─────────────────────────────────────
    // Declared here (before the Esc handler) because the handler gates on
    // these overlay flags.
    const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);

    // ─── Saved analyses gallery ────────────────────────────────────────────
    const [isSavedGalleryOpen, setIsSavedGalleryOpen] = useState(false);

    // Esc cancels an in-progress analysis (including the debate phase). Never
    // fires while the user is typing in an input/textarea/contenteditable, and
    // never while an overlay is open — overlays close themselves on Esc (their
    // own keydown handlers), and one Esc must not both close an overlay AND
    // cancel a running analysis.
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            const target = e.target as HTMLElement | null;
            const isTyping = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
            if (isTyping) return;
            const anyOverlayOpen = journalState.isOpen || isSettingsMenuVisible || isLiveMarketVisible || isCommandPaletteOpen || isSavedGalleryOpen || isUserModalOpen;
            if (anyOverlayOpen) return;
            if (isAnalysisInProgress && !isPostMortemInProgress) {
                handleCancelAnalysis();
                toast.info('Analysis cancelled', 'The partial debate was preserved in the chat.');
            }
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [isAnalysisInProgress, isPostMortemInProgress, handleCancelAnalysis, toast, journalState.isOpen, isSettingsMenuVisible, isLiveMarketVisible, isCommandPaletteOpen, isSavedGalleryOpen, isUserModalOpen]);

    // ─── Side-by-side compare ──────────────────────────────────────────────
    const [compareState, setCompareState] = useState<{ primaryId: string; secondaryId: string | null } | null>(null);
    const handleCompareAnalysis = useCallback((messageId: string) => {
        setCompareState({ primaryId: messageId, secondaryId: null });
    }, []);
    const handlePickSecondary = useCallback((messageId: string) => {
        setCompareState(prev => prev ? { ...prev, secondaryId: messageId } : prev);
    }, []);
    const comparePrimary = compareState ? messages.find(m => m.id === compareState.primaryId) ?? null : null;
    const compareSecondary = compareState?.secondaryId ? messages.find(m => m.id === compareState.secondaryId) ?? null : null;

    // ─── View model reasoning (Think tab deep link) ────────────────────────
    // Opens the Trading Journal's Think tab focused on the reasoning records
    // of the clicked analysis card. The reasoning set is keyed by the
    // analysis createdAt, so resolve it via the card (message) id.
    const handleViewReasoning = useCallback(async (messageId: string) => {
        let tradeId: string | undefined;
        try {
            const { getThinkingByMessage } = await import('./services/infrastructure/ThinkingStoreService');
            // Scoped to the active user — message ids can otherwise collide
            // across profiles.
            const records = await getThinkingByMessage(messageId, activeUsername || undefined);
            tradeId = records[0]?.tradeId;
        } catch (err) {
            console.warn('[App] Failed to resolve reasoning records for card:', err);
        }
        setJournalState({ isOpen: true, tab: 'reasoning', focusTradeId: tradeId });
    }, [setJournalState, activeUsername]);

    // Stable identity for the Journal's deep-link consumer. An inline arrow
    // here would change on every render and refire ReasoningDashboard's load
    // effect (it lists this prop in its deps), re-querying the store during
    // every streaming debate update while the Think tab is open.
    const handleReasoningTradeConsumed = useCallback(() => {
        setJournalState(prev => ({ ...prev, focusTradeId: undefined }));
    }, [setJournalState]);

    // ─── Saved analyses gallery ────────────────────────────────────────────
    const handleLocateMessage = useCallback((messageId: string) => {
        const index = messages.findIndex(m => m.id === messageId);
        if (index >= 0) {
            virtuosoRef.current?.scrollToIndex({ index, behavior: 'smooth' });
            setHighlightedAnalysisId(messageId);
        }
        setIsSavedGalleryOpen(false);
    }, [messages]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                setIsCommandPaletteOpen(prev => !prev);
            }
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, []);


    const loadUserData = async (username: string) => {
        handleCancelAnalysis();
        invalidatePostMortemRuns();
        setIsLoading(true);

        // Profile switch: clear the previous user's autopilot registrations
        // and resolutions so the 60s loop can't verify/notify for the wrong
        // profile (the service is a singleton and init() is guarded).
        OutcomeAutopilotService.reset();
        setAutopilotResolutions({});

        try {
        // Initialize database (SQLite on native, IndexedDB on web)
        await dbService.initDatabase();
        // P1-8: Configure native status bar (no-op on web)
        await initNativeStatusBar();
        // Initialize service caches
        await initModelPerformanceService();
        await initAnalystLensService();
        // Native (Capacitor) loads the lens config asynchronously, after the
        // useAppSettings lazy initializer already ran with an empty default —
        // push the cached config into React state so the lens dropdowns don't
        // open empty on startup.
        const cachedLens = loadLensConfig();
        if (cachedLens && JSON.stringify(cachedLens) !== JSON.stringify(lensConfig)) {
            handleSetLensConfig(cachedLens);
        }
        // Same async-load sync for the ordinary ensemble model selection
        // (native stores it in Capacitor Preferences, not localStorage).
        try {
            const cachedSelection = await getPreferenceObject<EnsembleModelSelection>(PREF_KEYS.ENSEMBLE_MODEL_SELECTION);
            if (Array.isArray(cachedSelection) && cachedSelection.length > 0
                && JSON.stringify(cachedSelection) !== JSON.stringify(ensembleModelSelection)) {
                handleSetEnsembleModelSelection(cachedSelection);
            }
        } catch (e) {
            console.warn('[App] Failed to sync ensemble model selection:', e);
        }
        await initInvalidationRuleService();
        await PriceAlertService.init();
        await OutcomeAutopilotService.init();
        await initConfluenceService();
        await initPatternMemoryService();
        await GlobalLearningService.setActiveUser(username);
        // Same per-user treatment for the attributed-insights knowledge base —
        // resets the module cache so the next read loads THIS user's insights.
        setAttributedInsightsUser(username);

        const profile = await dbService.getUserProfile(username);
        if (profile) {
            const correctedConvs = (profile.conversations || []).map(conv => {
                const leverage = conv.leverage || DEFAULT_LEVERAGE;
                const correctedMessages = (conv.messages || []).map(msg => {
                    // A restored message can never be mid-stream: the abort
                    // controller and the debate status callbacks died with the
                    // page that was running them. Clear live debate state so a
                    // message saved mid-debate doesn't render a stuck
                    // "thinking" indicator or permanently hide its turns
                    // (DebateChat filters turns by activeDebateSpeakers).
                    const normalized: Message = msg.isDebating || msg.activeDebateSpeakers
                        ? { ...msg, isDebating: false, activeDebateSpeakers: undefined }
                        : msg;
                    if (normalized.analysis) {
                        return { ...normalized, analysis: recalculateAnalysisMetrics(normalized.analysis, leverage) };
                    }
                    return normalized;
                });
                return { ...conv, leverage, messages: correctedMessages };
            });

            const convs = correctedConvs.length > 0 ? correctedConvs : [createNewConversation()];

            setConversationHistory(convs);
            const loadedTrades = (profile.tradeLog || []).map(t => ({ ...t, leverage: t.leverage || DEFAULT_LEVERAGE }));
            setLoggedTrades(loadedTrades);
            // Rebuild confluence historical stats from the loaded log (was
            // never wired — getConfluenceInsight always returned empty).
            syncConfluenceFromTradeLog(loadedTrades);
            setSavedAnalyses(profile.savedAnalyses || []);
            setTradeSummaries((profile.tradeSummaries || []).slice(-MAX_TRADE_SUMMARIES));  // Keep most recent entries
            setFinalTradeSummary(profile.finalTradeSummary || null);
            setGlobalMemory(profile.globalMemory);
            setActiveFrameworks(profile.settings?.activeFrameworks || DEFAULT_FRAMEWORKS);
            setSummaryCharLimit(profile.settings?.summaryCharLimit || 4000);
            const firstReadyProvider = getFirstReadyProvider(providerConfigs);
            setSummarizationProvider(profile.settings?.summarizationProvider || firstReadyProvider?.id || '');
            setSummarizationModel(profile.settings?.summarizationModel || firstReadyProvider?.selectedModel || '');
            setIsGlobalMemoryEnabled(profile.settings?.isGlobalMemoryEnabled ?? true);
            setIsAccuracyModeEnabled(profile.settings?.isAccuracyModeEnabled ?? false);
            setAccuracySubMode(profile.settings?.accuracySubMode || 'original');

            const loadedInstructions = profile.settings?.customInstructions;
            const defaultMap: CustomInstructionsMap = { general: [], accuracyOriginal: [], accuracyPure: [] };

            if (loadedInstructions) {
                if (typeof (loadedInstructions as any).general === 'string') {
                    const legacyGeneral = (loadedInstructions as any).general;
                    const legacyOriginal = (loadedInstructions as any).accuracyOriginal;
                    const legacyPure = (loadedInstructions as any).accuracyPure;

                    if (legacyGeneral) defaultMap.general.push({ id: 'migrated-gen', title: 'Legacy General', content: legacyGeneral, isActive: true });
                    if (legacyOriginal) defaultMap.accuracyOriginal.push({ id: 'migrated-orig', title: 'Legacy Accuracy', content: legacyOriginal, isActive: true });
                    if (legacyPure) defaultMap.accuracyPure.push({ id: 'migrated-pure', title: 'Legacy Pure', content: legacyPure, isActive: true });

                    setCustomInstructions(defaultMap);
                } else {
                    setCustomInstructions({
                        general: loadedInstructions.general || [],
                        accuracyOriginal: loadedInstructions.accuracyOriginal || [],
                        accuracyPure: loadedInstructions.accuracyPure || []
                    });
                }
            } else {
                setCustomInstructions(defaultMap);
            }

            setIsPlaybookEnabledInPureAI(profile.settings?.isPlaybookEnabledInPureAI ?? false);
            setIsFamiliesEnabledInPureAI(profile.settings?.isFamiliesEnabledInPureAI ?? false);
            setIsMemoryEnabledInPureAI(profile.settings?.isMemoryEnabledInPureAI ?? false);
            setIsHybridIntelligenceEnabled(profile.settings?.isHybridIntelligenceEnabled ?? false);
            setIsAutoCapturing(profile.settings?.isAutoCapturing ?? false);
            setIsUpdateAutoCapturing(profile.settings?.isUpdateAutoCapturing ?? false);
            setIsEntryNotHitCapturing(profile.settings?.isEntryNotHitCapturing ?? false);
            setConfidenceCalibration(profile.settings?.confidenceCalibration);
            const loadedMemoryConfig = providerConfigs.find(p => p.id === profile.settings?.memoryProvider) || null;
            setMemoryConfig(loadedMemoryConfig);
            setMemoryModel(profile.settings?.memoryModel || loadedMemoryConfig?.selectedModel || getFirstReadyProvider(providerConfigs)?.selectedModel || '');

            // AI Learning: Load knowledge base
            setInsightKnowledgeBase(profile.insightKnowledgeBase);

            // Sync model performance data from trade log
            const tradeLogData = (profile.tradeLog || []).map(t => ({ ...t, leverage: t.leverage || DEFAULT_LEVERAGE }));
            syncFromTradeLog(tradeLogData);
            syncRollingWindowFromTradeLog(tradeLogData);
            console.log('[App] Synced model performance data from trade log');

            const lastActive = convs.find(c => c.id === profile.lastActiveConversationId) || convs[0];
            setActiveConversationId(lastActive.id);

            // Data Integrity: Run migrations if needed
            await runMigrations(username);

            // Data Integrity: Create startup backup before any operations
            const tradeCount = (profile.tradeLog || []).length;
            createStartupBackup(username).catch(err =>
                console.warn('[DataIntegrity] Startup backup failed:', err)
            );

            // P1-9: Start the 30-minute auto-backup scheduler. Previously
            // startAutoBackup was dead code — only a single startup backup
            // ran per app launch, leaving long sessions unprotected. The
            // scheduler is stopped on user switch / unmount (see effect below).
            startAutoBackup(username);

            // Data Integrity: Check for data loss
            const integrityCheck = await checkDataIntegrity(username, tradeCount);
            if (!integrityCheck.valid && integrityCheck.tradeCountChanged) {
                logIntegrityEvent('DATA_LOSS_DETECTED', integrityCheck);
                const message = ` Data Issue Detected\n\n` +
                    `Your trade log appears to have fewer trades than before ` +
                    `(${integrityCheck.previousTradeCount} → ${integrityCheck.currentTradeCount}).\n\n` +
                    (integrityCheck.hasBackups && integrityCheck.latestBackup
                        ? `A backup with ${integrityCheck.latestBackup.tradeCount} trades is available from ${new Date(integrityCheck.latestBackup.timestamp).toLocaleString()}.\n\nGo to Settings → Export Data to restore from backup.`
                        : 'Consider exporting your data regularly to prevent future data loss.');
                toast.info(message);
            }
        } else {
            // Fresh (never-saved) user: persist the blank profile under the
            // NEW username — the closure's activeUsername is the PREVIOUS
            // user, and saving under it would wipe their data on web.
            resetAppState(username);
        }
        setActiveUsername(username);
        sessionStorage.setItem('activeUsername', username);
        // Tag thinking records with the active user — the writers read
        // 'last_active_user' but nothing ever wrote it (all records landed
        // in the 'default' bucket).
        localStorage.setItem('last_active_user', username);
        setIsUserModalOpen(false);
        setHighlightedAnalysisId(null);
        setIsLoading(false);
        } catch (error) {
            console.error('App: failed to load user data', error);
            // Ensure the app doesn't stay stuck on a loading screen
            setActiveUsername(username);
            sessionStorage.setItem('activeUsername', username);
            setIsUserModalOpen(false);
            setIsLoading(false);
        }
    };

    useEffect(() => {
        // Wait for provider configs to load before resolving defaults like the
        // summarization provider / memory model. getFirstReadyProvider would
        // otherwise see an empty list on first mount (configs load async) and
        // pin defaults to '' that never self-correct.
        if (!providerConfigsLoaded) return;
        let isMounted = true;
        const initializeApp = async () => {
            try {
                const users = await dbService.getAllUsernames();
                if (!isMounted) return;
                setExistingUsernames(users);
                const sessionUser = sessionStorage.getItem('activeUsername');
                if (sessionUser && users.includes(sessionUser)) {
                    loadUserData(sessionUser);
                } else {
                    setIsUserModalOpen(true);
                }
            } catch (error) {
                console.error('App: initialization failed', error);
                if (!isMounted) return;
                // Show the user modal even if DB init fails so the app
                // doesn't get stuck on a blank screen.
                setIsUserModalOpen(true);
            }
        };
        initializeApp();
        return () => { isMounted = false; };
    }, [providerConfigsLoaded]);

    // ─── P0-1: Save-on-unload flush ──────────────────────────────────────
    // The debounced saves below lose data if the tab closes mid-window.
    // This ref tracks the last successfully persisted snapshot so the
    // useSaveOnUnload hook can skip IO when nothing has changed.
    const lastSavedSnapshotRef = useRef<Partial<Omit<UserProfile, 'username'>> | null>(null);
    const buildProfileSnapshot = useCallback((): Partial<Omit<UserProfile, 'username'>> => ({
        conversations: conversationHistory,
        tradeLog: loggedTrades,
        savedAnalyses: savedAnalyses,
        tradeSummaries: tradeSummaries,
        finalTradeSummary: finalTradeSummary,
        globalMemory: globalMemory,
        settings: { activeFrameworks, summaryCharLimit, summarizationProvider, summarizationModel, isGlobalMemoryEnabled, isAccuracyModeEnabled, accuracySubMode, customInstructions, isPlaybookEnabledInPureAI, isFamiliesEnabledInPureAI, isMemoryEnabledInPureAI, isHybridIntelligenceEnabled, isAutoCapturing, isUpdateAutoCapturing, isEntryNotHitCapturing, confidenceCalibration, memoryProvider: memoryConfig?.id || '', memoryModel },
        lastActiveConversationId: activeConversationId || undefined,
        // AI Learning data
        insightKnowledgeBase: insightKnowledgeBase,
    }), [conversationHistory, loggedTrades, activeFrameworks, activeConversationId, savedAnalyses, tradeSummaries, finalTradeSummary, globalMemory, summaryCharLimit, summarizationProvider, summarizationModel, isGlobalMemoryEnabled, isAccuracyModeEnabled, accuracySubMode, customInstructions, isPlaybookEnabledInPureAI, isFamiliesEnabledInPureAI, isMemoryEnabledInPureAI, isHybridIntelligenceEnabled, isAutoCapturing, isUpdateAutoCapturing, isEntryNotHitCapturing, confidenceCalibration, insightKnowledgeBase, memoryConfig, memoryModel]);

    // ─── P1-6: Split save into DATA (heavy) + SETTINGS (light) ───────────
    // Previously a single effect re-serialized ALL conversations (with base64
    // images) + ALL trades on ANY of 22 dependency changes, including trivial
    // settings toggles. Now:
    //   - The DATA effect only re-serializes when conversations/trades/
    //     summaries/memory actually change (the heavy payload).
    //   - The SETTINGS effect handles cheap settings toggles (activeFrameworks,
    //     summaryCharLimit, etc.) with the same 1500ms debounce but a much
    //     smaller payload (no base64 images, no trade log).
    // Both write to the same profile; dbService merges them. The net effect:
    // toggling a settings checkbox no longer triggers a multi-MB re-serialize.

    // (1) DATA save — heavy payload, only on real data changes.
    useEffect(() => {
        if (!activeUsername) return;

        setSaveStatus('SAVING');

        const handler = setTimeout(async () => {
            try {
                const profileData = buildProfileSnapshot();
                await dbService.saveUserProfile(activeUsername, profileData);
                lastSavedSnapshotRef.current = profileData;
                setSaveStatus('SAVED');
            } catch (err) {
                console.error("Failed to save user profile (data):", err);
                setSaveStatus('ERROR');
            }
        }, 1500);

        return () => {
            clearTimeout(handler);
        };
    }, [conversationHistory, loggedTrades, savedAnalyses, tradeSummaries, finalTradeSummary, globalMemory, insightKnowledgeBase, activeUsername, activeConversationId, buildProfileSnapshot]);

    // (2) SETTINGS save — light payload, runs on settings toggles. Uses a
    // longer debounce (2500ms) since settings changes are low-risk and we
    // don't want every checkbox tick to trigger a save storm.
    useEffect(() => {
        if (!activeUsername) return;

        const handler = setTimeout(async () => {
            try {
                // Only the settings sub-object — no conversations, no trades,
                // no base64 images. This is a cheap write.
                await dbService.saveUserProfile(activeUsername, {
                    settings: { activeFrameworks, summaryCharLimit, summarizationProvider, summarizationModel, isGlobalMemoryEnabled, isAccuracyModeEnabled, accuracySubMode, customInstructions, isPlaybookEnabledInPureAI, isFamiliesEnabledInPureAI, isMemoryEnabledInPureAI, isHybridIntelligenceEnabled, isAutoCapturing, isUpdateAutoCapturing, isEntryNotHitCapturing, confidenceCalibration, memoryProvider: memoryConfig?.id || '', memoryModel },
                });
            } catch (err) {
                console.error("Failed to save user profile (settings):", err);
            }
        }, 2500);

        return () => {
            clearTimeout(handler);
        };
    }, [activeFrameworks, summaryCharLimit, summarizationProvider, summarizationModel, isGlobalMemoryEnabled, isAccuracyModeEnabled, accuracySubMode, customInstructions, isPlaybookEnabledInPureAI, isFamiliesEnabledInPureAI, isMemoryEnabledInPureAI, isHybridIntelligenceEnabled, isAutoCapturing, isUpdateAutoCapturing, isEntryNotHitCapturing, confidenceCalibration, memoryConfig, memoryModel, activeUsername]);

    // (3) SAVE HEARTBEAT — the 1500ms DATA debounce restarts on every message
    // change, so nothing is persisted for the ENTIRE duration of a run (the
    // RAF-throttled debate updates keep resetting it). A native kill or
    // background termination mid-run then loses the whole run. Flush every
    // 15s while a run is active instead.
    // buildProfileSnapshot changes identity on every conversationHistory
    // mutation — using it directly in deps would re-arm this interval every
    // frame during a run (the exact bug this heartbeat exists to fix). Keep
    // the freshest snapshot in a ref instead. The ref must be declared at
    // component level — useRef inside the effect body throws "Invalid hook
    // call" the moment the effect re-runs (i.e. at the start of every run).
    const heartbeatSnapshotRef = useRef(buildProfileSnapshot);
    useEffect(() => {
        if (!activeUsername || (!isAnalysisInProgress && !isPostMortemInProgress)) return;
        heartbeatSnapshotRef.current = buildProfileSnapshot;
        const interval = setInterval(async () => {
            try {
                const snapshot = heartbeatSnapshotRef.current();
                await dbService.saveUserProfile(activeUsername, snapshot);
                lastSavedSnapshotRef.current = snapshot;
            } catch (err) {
                console.error('Failed to save user profile (heartbeat):', err);
            }
        }, 15000);
        return () => clearInterval(interval);
    }, [activeUsername, isAnalysisInProgress, isPostMortemInProgress]);

    // Flush pending state on tab close / hide. The hook keeps an internal
    // ref to the freshest snapshot (updated every render via getSnapshot)
    // so the synchronous unload handler always persists the latest data.
    useSaveOnUnload({
        enabled: !!activeUsername,
        getSnapshot: buildProfileSnapshot,
        isDirty: () => {
            const last = lastSavedSnapshotRef.current;
            if (!last) return true; // never saved yet
            // Shallow reference check on the heavy arrays is sufficient —
            // any state mutation produces a new array reference (immutable updates).
            return last.conversations !== conversationHistory
                || last.tradeLog !== loggedTrades
                || last.tradeSummaries !== tradeSummaries
                || last.savedAnalyses !== savedAnalyses
                || last.finalTradeSummary !== finalTradeSummary
                || last.globalMemory !== globalMemory
                || last.insightKnowledgeBase !== insightKnowledgeBase
                || last.lastActiveConversationId !== (activeConversationId || undefined);
        },
        save: async (snapshot) => {
            if (!activeUsername) return;
            await dbService.saveUserProfile(activeUsername, snapshot);
            lastSavedSnapshotRef.current = snapshot;
        },
        onFlushed: () => {
            // Don't touch React state during unload — just log for diagnostics.
            console.log('[App] Flushed pending save on unload');
        },
    });

    // --- ACCURACY MODE THEME HANDLER ---
    // Maintain consistent dark theme regardless of mode
    useEffect(() => {
        if (appRef.current) {
            // Remove all legacy theme classes and use consistent dark theme
            appRef.current.classList.remove('bg-zinc-950', 'bg-[#000000]', 'bg-[#000000]');
            appRef.current.classList.add('bg-zinc-950');
        }
    }, [isAccuracyModeEnabled, accuracySubMode]);

    const handleToggleAccuracyMode = () => {
        setShowAccuracyModal(true);
    };

    const handleConfirmAccuracyMode = () => {
        setIsAccuracyModeEnabled(!isAccuracyModeEnabled);
        setShowAccuracyModal(false);

        if (!isAccuracyModeEnabled) { // Enabling Accuracy Mode
            // Default moderator/vision to the first ready provider instead of a hardcoded brand.
            const firstReady = getFirstReadyProvider(providerConfigs);
            updateActiveConversation(conv => ({
                ...conv,
                moderatorProviderId: firstReady?.id || conv.moderatorProviderId || '',
                moderatorModel: firstReady?.selectedModel || conv.moderatorModel || '',
                ocrModel: firstReady?.selectedModel || conv.ocrModel || ''
            }));
            if (!accuracySubMode) setAccuracySubMode('original');
        }
    };

    // Analyst Lens config handler - updates state and persists to storage
    const handleSetLensConfig = useCallback((newConfig: AnalystLensConfig) => {
        setLensConfig(newConfig);
        saveLensConfig(newConfig);
    }, []);

    // Ordinary ensemble model selection (Lenses off) handler — persists the
    // three picked models that drive the cards and the debate.
    const handleSetEnsembleModelSelection = useCallback((selection: EnsembleModelSelection) => {
        setEnsembleModelSelection(selection.slice(0, 3));
        saveEnsembleModelSelection(selection.slice(0, 3));
    }, [setEnsembleModelSelection]);

    // Custom prompt overrides (prompt editor) — persist so they survive reloads.
    const handleSetCustomEnsemblePrompt = useCallback((prompt: string | null) => {
        setCustomEnsemblePrompt(prompt);
        saveCustomEnsemblePrompt(prompt);
    }, [setCustomEnsemblePrompt]);

    const handleSetCustomLensPrompts = useCallback((prompts: Record<string, string>) => {
        setCustomLensPrompts(prompts);
        saveCustomLensPrompts(prompts);
    }, [setCustomLensPrompts]);

    // Reconcile stale lens assignments when providers/models change: drop a
    // role whose provider was removed or whose assigned model no longer
    // exists, so the lens dropdowns never render a blank value for a dead
    // assignment (the pipeline used to run a model the UI could not show).
    useEffect(() => {
        if (!lensConfig || !lensConfig.assignments) return;
        const providersById = new Map(providerConfigs.map(c => [c.id, c]));
        let changed = false;
        const assignments = lensConfig.assignments.map(a => {
            if (!a.assignedProvider) return a;
            const provider = providersById.get(a.assignedProvider);
            if (!provider) {
                changed = true;
                return { ...a, assignedProvider: null, assignedModel: undefined };
            }
            if (a.assignedModel && !provider.models.includes(a.assignedModel)) {
                changed = true;
                return { ...a, assignedModel: undefined };
            }
            return a;
        });
        if (changed) {
            handleSetLensConfig({ ...lensConfig, assignments });
        }
    }, [providerConfigs, lensConfig, handleSetLensConfig]);

    // Reconcile stale ordinary ensemble selections: drop entries whose
    // provider was removed or whose model no longer exists on that provider.
    useEffect(() => {
        if (!ensembleModelSelection || ensembleModelSelection.length === 0) return;
        const providersById = new Map(providerConfigs.map(c => [c.id, c]));
        const cleaned = ensembleModelSelection.filter(e =>
            Boolean(providersById.get(e.providerId)?.models.includes(e.model))
        );
        if (cleaned.length !== ensembleModelSelection.length) {
            handleSetEnsembleModelSelection(cleaned);
        }
    }, [providerConfigs, ensembleModelSelection, handleSetEnsembleModelSelection]);

    const handleQuotaExceeded = useCallback((modelId: string) => {
        setQuotaExceededModels(prev => new Set(prev).add(modelId));
    }, []);

    // Update ref for useTradeLogging (breaks circular dependency)
    handleSendMessageRef.current = handleSendMessage;


    // ... (handleAssistantChat remains unchanged) ...

    const handleLiveMarketAnalyze = (data: string) => {
        setIsLiveMarketVisible(false);
        setInput(data); // PREFILL INPUT, DO NOT SEND IMMEDIATELY
    };

    const handleSetSummarizationProvider = (provider: AIProvider) => setSummarizationProvider(provider);
    const handleSetSummarizationModel = (id: string) => setSummarizationModel(id);
    const handleUpdateSummaryCharLimit = (limit: number) => setSummaryCharLimit(limit);


    const handleDeleteTrades = (ids: string[]) => {
        setLoggedTrades(prev => prev.filter(t => !ids.includes(t.id)));
        setTradeSummaries(prev => prev.filter(s => !ids.includes(s.id)));
    };

    const handleClearAllTrades = async () => {
        // P2-13: Capture state before deletion for undo. Previously this used
        // native confirm() (blocking, no undo) — a delete could appear to
        // succeed in UI but be lost if the tab closed before the debounced save.
        const prevTrades = loggedTrades;
        const prevSummaries = tradeSummaries;
        const prevFinalSummary = finalTradeSummary;
        const ok = await confirmDialog({
            title: 'Delete all trade history?',
            message: `This will remove ${loggedTrades.length} logged trade(s) and their insights. You can undo this for 5 seconds.`,
            confirmLabel: 'Delete All',
            destructive: true,
            onUndo: () => {
                setLoggedTrades(prevTrades);
                setTradeSummaries(prevSummaries);
                setFinalTradeSummary(prevFinalSummary);
                toast.success('Trade history restored');
            },
        });
        if (ok) {
            setLoggedTrades([]);
            setTradeSummaries([]);
            setFinalTradeSummary(null);
        }
    };

    const handleManualInsightsUpdate = async (ids: string[]) => {
        // Find trades that need summaries generated (not already in tradeSummaries)
        const existingIds = new Set(tradeSummaries.map(s => s.id));
        const newTrades = loggedTrades.filter(t => ids.includes(t.id) && !existingIds.has(t.id));
        const alreadyAddedCount = ids.length - newTrades.length;

        if (newTrades.length === 0) {
            console.log('[ManualInsights] All selected trades are already in Recent Insights');
            return; // No new trades to process
        }

        setIsSummaryInProgress(true);

        try {
            // Generate summaries for each new trade
            const newSummaries: TradeSummary[] = [];

            for (const trade of newTrades) {
                // Use the user's preference for Algo vs AI insight generation
                const summary = await MemoryService.summarizeTrade(trade, memoryModel, memoryConfig || moderatorConfig, useAlgorithmicInsights);
                newSummaries.push({
                    id: trade.id,
                    summaryText: summary,
                    timestamp: new Date().toISOString()
                });
            }

            // Add new summaries with FIFO enforcement and robust deduplication
            setTradeSummaries(prev => {
                // Re-check for duplicates to prevent race conditions
                const prevIds = new Set(prev.map(s => s.id));
                const uniqueNewSummaries = newSummaries.filter(s => !prevIds.has(s.id));

                if (uniqueNewSummaries.length < newSummaries.length) {
                    console.warn(`[ManualInsights] Filtered ${newSummaries.length - uniqueNewSummaries.length} duplicates during update.`);
                }

                const updated = [...prev, ...uniqueNewSummaries];
                // Remove oldest entries from the beginning to maintain max limit
                return updated.slice(-MAX_TRADE_SUMMARIES);
            });

            // Track newly added insights for animation
            const addedIds = newSummaries.map(s => s.id);
            setNewlyAddedInsightIds(prev => {
                const next = new Set(prev);
                addedIds.forEach(id => next.add(id));
                return next;
            });
            // Clear animation after 3 seconds
            setTimeout(() => {
                setNewlyAddedInsightIds(prev => {
                    const next = new Set(prev);
                    addedIds.forEach(id => next.delete(id));
                    return next;
                });
            }, 3000);

            console.log(`[ManualInsights] Processed ${newSummaries.length} trades for insights.`);
            if (alreadyAddedCount > 0) {
                console.log(`[ManualInsights] ${alreadyAddedCount} trades were already in Recent Insights (pre-check)`);
            }
        } catch (e) {
            console.error('[ManualInsights] Failed to generate summaries:', e);
        } finally {
            setIsSummaryInProgress(false);
        }
    };

    // Delete individual insight from Recent Insights
    const handleDeleteInsight = (id: string) => {
        setTradeSummaries(prev => prev.filter(s => s.id !== id));
        console.log(`[ManualInsights] Removed insight with id: ${id}`);
    };

    // Rewrite insights with AI - regenerates summaries using AI provider
    // If ids is empty/undefined, rewrites ALL insights
    const handleRewriteInsightsWithAI = async (ids?: string[]) => {
        const targetIds = ids && ids.length > 0 ? ids : tradeSummaries.map(s => s.id);

        if (targetIds.length === 0) {
            console.log('[AIRewrite] No insights to rewrite');
            return;
        }

        setIsSummaryInProgress(true);
        console.log(`[AIRewrite] Rewriting ${targetIds.length} insights with AI...`);

        try {
            const updatedSummaries: TradeSummary[] = [];

            for (const id of targetIds) {
                const trade = loggedTrades.find(t => t.id === id);
                console.log(`[AIRewrite] Looking for trade with id: ${id}, found: ${!!trade}`);
                if (trade) {
                    // Find the provider config matching the summarization provider
                    const summaryConfig = readyProviders.find(p => p.id === summarizationProvider) || readyProviders[0] || moderatorConfig;
                    console.log(`[AIRewrite] Calling MemoryService.summarizeTrade with provider: ${summaryConfig.name}, model: ${summarizationModel}, useAlgorithmic: false`);
                    // Force AI mode (false = use AI, not algo)
                    const summary = await MemoryService.summarizeTrade(trade, summarizationModel, summaryConfig, false);
                    console.log(`[AIRewrite] Got summary for ${id}:`, summary?.substring(0, 100));
                    updatedSummaries.push({
                        id: trade.id,
                        summaryText: summary,
                        timestamp: new Date().toISOString()
                    });
                } else {
                    console.warn(`[AIRewrite] Trade not found for id: ${id}. Available trade ids:`, loggedTrades.map(t => t.id));
                }
            }

            // Replace existing summaries with AI-generated ones
            setTradeSummaries(prev => {
                const unchangedSummaries = prev.filter(s => !targetIds.includes(s.id));
                return [...unchangedSummaries, ...updatedSummaries].slice(-MAX_TRADE_SUMMARIES);
            });

            // Show animation for rewritten insights
            setNewlyAddedInsightIds(prev => {
                const next = new Set(prev);
                updatedSummaries.forEach(s => next.add(s.id));
                return next;
            });
            setTimeout(() => {
                setNewlyAddedInsightIds(prev => {
                    const next = new Set(prev);
                    updatedSummaries.forEach(s => next.delete(s.id));
                    return next;
                });
            }, 3000);

            console.log(`[AIRewrite] Successfully rewrote ${updatedSummaries.length} insights with AI`);
        } catch (e) {
            console.error('[AIRewrite] Failed to rewrite insights:', e);
        } finally {
            setIsSummaryInProgress(false);
        }
    };

    const handleUpdateTradeLeverage = (id: string, leverage: number) => {
        setLoggedTrades(prev => prev.map(t => {
            if (t.id === id) {
                const updatedAnalysis = recalculateAnalysisMetrics(t.analysis, leverage);
                return { ...t, leverage, analysis: updatedAnalysis };
            }
            return t;
        }));
    };

    const handleRegenerateFinalSummary = async () => {
        setIsSummaryInProgress(true);
        try {
            let summary = '';

            if (useAlgorithmicSummary) {
                // Use algorithmic generation (Fast, Free, No tokens)
                const { generatePatternMemorySynthesis } = await import('./services/ui/AlgorithmicSummaryService');
                summary = generatePatternMemorySynthesis(loggedTrades);
            } else {
                // Use AI generation (Slower, Tokens) via GenericAnalysisService
                const summaryConfig = readyProviders.find(p => p.id === summarizationProvider) || readyProviders[0];
                if (summaryConfig) {
                    summary = await generateFinalSummary(summaryConfig, tradeSummaries, summaryCharLimit);
                }
            }

            setFinalTradeSummary(summary);
        } catch (e) {
            console.error("Summary regeneration failed", e);
        } finally {
            setIsSummaryInProgress(false);
        }
    };

    const handleClearAllConversations = async () => {
        const prevHistory = conversationHistory;
        const prevActiveId = activeConversationId;
        const ok = await confirmDialog({
            title: 'Clear all conversation history?',
            message: `This will remove ${conversationHistory.length} conversation(s). You can undo this for 5 seconds.`,
            confirmLabel: 'Clear All',
            destructive: true,
            onUndo: () => {
                setConversationHistory(prevHistory);
                setActiveConversationId(prevActiveId);
                toast.success('Conversations restored');
            },
        });
        if (ok) {
            handleCancelAnalysis();
            const newConv = createNewConversation();
            setConversationHistory([newConv]);
            setActiveConversationId(newConv.id);
        }
    };

    const handleLoadConversation = (id: string) => {
        if (id !== activeConversationId) {
            handleCancelAnalysis();
            invalidatePostMortemRuns();
            setActiveConversationId(id);
        }
    };

    const handleDeleteConversations = (ids: string[]) => {
        // Single source of truth: filter from the same list we store, so the
        // active-conversation fallback can't reference a stale snapshot.
        const remaining = conversationHistory.filter(c => !ids.includes(c.id));
        setConversationHistory(remaining);
        if (activeConversationId && ids.includes(activeConversationId)) {
            handleCancelAnalysis();
            invalidatePostMortemRuns();
            if (remaining.length > 0) {
                setActiveConversationId(remaining[0].id);
            } else {
                handleStartNewConversation();
            }
        }
    };

    // Sidebar delete: confirm + undo (5s grace) before removing a session.
    const handleDeleteConversationFromSidebar = async (id: string) => {
        const ok = await confirmDialog({
            title: 'Delete session?',
            message: 'This conversation and its messages will be removed. Logged trades are kept.',
            confirmLabel: 'Delete',
        });
        if (ok) handleDeleteConversations([id]);
    };

    const handleStartNewConversation = () => {
        handleCancelAnalysis();
        invalidatePostMortemRuns();
        const newConv = createNewConversation();
        if (activeConversation) {
            newConv.ocrModel = activeConversation.ocrModel;
            newConv.moderatorProviderId = activeConversation.moderatorProviderId;
            newConv.moderatorModel = activeConversation.moderatorModel;
            newConv.leverage = activeConversation.leverage;
        }
        setConversationHistory(prev => [newConv, ...prev]);
        setActiveConversationId(newConv.id);
    };

    // Stable handler identities — plain arrow functions here were recreated
    // every render, defeating the chatContext memo and re-rendering every
    // visible MessageItem on each stream chunk / keystroke.
    const handleApplyStrategy = useCallback((strategyName: string) => {
        if (!activeFrameworks.includes(strategyName)) {
            setActiveFrameworks(prev => [...prev, strategyName]);
        }
    }, [activeFrameworks]);

    const handleRemoveStrategy = (strategyName: string) => {
        setActiveFrameworks(prev => prev.filter(s => s !== strategyName));
    };

    const handleDeleteSavedAnalyses = (ids: string[]) => {
        setSavedAnalyses(prev => prev.filter(a => !ids.includes(a.id)));
    };

    const handleClearAllSavedAnalyses = async () => {
        const prevAnalyses = savedAnalyses;
        const ok = await confirmDialog({
            title: 'Clear all saved analyses?',
            message: `This will remove ${savedAnalyses.length} saved analysis entry/entries. You can undo this for 5 seconds.`,
            confirmLabel: 'Clear All',
            destructive: true,
            onUndo: () => {
                setSavedAnalyses(prevAnalyses);
                toast.success('Saved analyses restored');
            },
        });
        if (ok) {
            setSavedAnalyses([]);
        }
    };

    const handleCycleAnalysisUp = () => {
        if (analysisMessages.length === 0) return;
        let nextIndex = analysisMessages.length - 1;
        if (highlightedAnalysisId) {
            const currentIndex = analysisMessages.findIndex(m => m.id === highlightedAnalysisId);
            if (currentIndex > 0) {
                nextIndex = currentIndex - 1;
            } else {
                nextIndex = analysisMessages.length - 1;
            }
        }
        const nextId = analysisMessages[nextIndex].id;
        setHighlightedAnalysisId(nextId);
        virtuosoRef.current?.scrollIntoView({ index: messages.findIndex(m => m.id === nextId), behavior: 'smooth', align: 'start' });
    };


    const handleScrollToBottom = () => {
        virtuosoRef.current?.scrollToIndex({ index: messages.length - 1, behavior: 'smooth' });
        setHighlightedAnalysisId(null);
    };

    const commandPaletteActions = useMemo<PaletteAction[]>(() => [
        {
            id: 'jump-latest',
            label: 'Jump to latest analysis',
            hint: '↓',
            run: handleScrollToBottom,
        },
        {
            id: 'new-analysis',
            label: input.trim() ? `Analyze: ${input.trim().slice(0, 40)}` : 'Analyze current input',
            hint: 'Enter',
            run: () => { if (input.trim()) stableHandleSendMessage(); },
        },
        {
            id: 'journal',
            label: 'Open Journal',
            hint: 'Trades',
            run: () => setJournalState({ isOpen: true, tab: 'log' }),
        },
        {
            id: 'live-market',
            label: 'Open Live Market',
            hint: 'Prices',
            run: () => setIsLiveMarketVisible(true),
        },
        {
            id: 'settings',
            label: 'Open Settings',
            hint: 'Providers',
            run: () => setIsSettingsMenuVisible(true),
        },
        {
            id: 'strategies',
            label: 'Open Strategy Search',
            hint: 'Playbook',
            run: () => setIsStrategySearchVisible(true),
        },
        {
            id: 'toggle-ensemble',
            label: isEnsembleEnabled ? 'Disable Ensemble mode' : 'Enable Ensemble mode',
            hint: 'Debates',
            // The canonical handler — the raw setter skipped image cleanup and
            // the setup-warning toasts.
            run: () => handleSetEnsembleEnabled(!isEnsembleEnabled),
        },
        {
            id: 'toggle-lenses',
            label: lensConfig.enabled ? 'Disable Analyst Lenses' : 'Enable Analyst Lenses',
            hint: 'Roles',
            // The canonical handler — persists the toggle (raw setter reverted on reload).
            run: () => handleSetLensConfig({ ...lensConfig, enabled: !lensConfig.enabled }),
        },
        {
            id: 'saved-analyses',
            label: 'Open Saved Analyses',
            hint: `${savedAnalyses.length} saved`,
            run: () => setIsSavedGalleryOpen(true),
        },
        {
            id: 'version-history',
            label: 'Open Version History',
            hint: 'Backups',
            run: () => setIsVersionHistoryVisible(true),
        },
    ], [handleScrollToBottom, input, stableHandleSendMessage, setJournalState, setIsLiveMarketVisible, setIsSettingsMenuVisible, setIsStrategySearchVisible, setIsVersionHistoryVisible, isEnsembleEnabled, handleSetEnsembleEnabled, lensConfig, handleSetLensConfig, savedAnalyses, setIsSavedGalleryOpen]);

    const removeImage = (index: number) => {
        setImages(prev => prev.filter((_, i) => i !== index));
    };

    const handleLeverageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setLeverageInput(e.target.value);
    };

    const handleLeverageBlur = () => {
        let val = parseInt(leverageInput, 10);
        if (isNaN(val) || val < 1) val = 1;
        if (val > 125) val = 125;
        setLeverageInput(String(val));

        updateActiveConversation(c => {
            const updatedMessages = c.messages.map(m => {
                if (m.analysis) {
                    return { ...m, analysis: recalculateAnalysisMetrics(m.analysis, val) };
                }
                return m;
            });
            return { ...c, leverage: val, messages: updatedMessages };
        });
    };

    const handlePresetLeverage = (val: number) => {
        setLeverageInput(String(val));

        updateActiveConversation(c => {
            const updatedMessages = c.messages.map(m => {
                if (m.analysis) {
                    return { ...m, analysis: recalculateAnalysisMetrics(m.analysis, val) };
                }
                return m;
            });
            return { ...c, leverage: val, messages: updatedMessages };
        });

        setIsLeverageDropdownOpen(false);
    };

    const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
        if (event.target.files) {
            const newFiles: File[] = Array.from(event.target.files);
            const remainingSlots = 5 - images.length;
            if (remainingSlots <= 0) return;
            const filesToProcess = newFiles.slice(0, remainingSlots);
            const placeholderMetadata: ImageMetadata[] = filesToProcess.map(file => ({ file, dataURL: '', isLoading: true }));
            setImages(prev => [...prev, ...placeholderMetadata]);
            // OCR burns a vision API call — only run it in ensemble mode
            // (the upload button is already hidden/disabled otherwise).
            if (isEnsembleEnabled) {
                const visionConfig = readyProviders.find(p => p.selectedModel === selectedOcrModel || p.models.includes(selectedOcrModel)) || readyProviders[0] || moderatorConfig;
                processImagesForSummarization(filesToProcess, images.length, visionConfig, setImages, handleQuotaExceeded);
            } else {
                setImages(prev => prev.filter(img => !img.isLoading));
            }
            if (event.target) event.target.value = '';
        }
    };

    const handleTypingComplete = useCallback(() => {
        if (typingMessageState) {
            const { id, fullText, field } = typingMessageState;
            updateMessages(prev => prev.map(m => m.id === id ? { ...m, [field]: fullText } : m));
            setTypingMessageState(null);
        }
    }, [typingMessageState]);

    const handleCopy = useCallback((message: Message) => {
        if (message.text) {
            navigator.clipboard.writeText(message.text);
            setCopiedMessageId(message.id);
            setTimeout(() => setCopiedMessageId(null), 2000);
        }
    }, []);

    const handleViewStrategyDetails = useCallback((name: string) => {
        setStrategyToView(name);
        setIsStrategySearchVisible(true);
    }, []);

    const handleSaveAnalysis = useCallback((messageId: string) => {
        const msgIndex = messages.findIndex(m => m.id === messageId);
        const msg = msgIndex >= 0 ? messages[msgIndex] : undefined;
        if (msg && msg.analysis) {
            // Find the nearest preceding user message. Reconstructing the user ID from the
            // AI message ID never matches because both use independent Date.now() timestamps.
            let userPrompt = "Unknown Request";
            for (let i = msgIndex - 1; i >= 0; i--) {
                if (messages[i].role === MessageRole.USER) {
                    userPrompt = messages[i].text || "Unknown Request";
                    break;
                }
            }
            const saved: SavedAnalysis = {
                id: msg.id,
                analysis: msg.analysis,
                userPrompt,
                timestamp: new Date().toISOString(),
                modelsUsed: msg.modelsUsed,

                ocrModelUsed: msg.ocrModelUsed,
                moderatorProvider: moderatorProviderId,
                moderatorModel
            };
            setSavedAnalyses(prev => {
                if (prev.some(s => s.id === saved.id)) return prev;
                return [...prev, saved];
            });
        }
    }, [messages, moderatorProviderId, moderatorModel]);

    const handleCalculateAIProbabilities = async (messageId: string, mode: 'AI' | 'Algo' = 'AI') => {
        const msg = messages.find(m => m.id === messageId);
        if (!msg || !msg.analysis) return;

        // Algo Mode Logic
        if (mode === 'Algo') {
            if (msg.analysis.marketSnapshot) {
                const algoProbs = ProbabilityEngineService.calculateAlgoProbabilities(
                    msg.analysis.marketSnapshot,
                    loggedTrades,
                    msg.analysis.direction as 'Long' | 'Short' | 'Neutral'
                );
                updateMessages(prev => prev.map(m =>
                    m.id === messageId
                        ? { ...m, analysis: { ...m.analysis!, levelProbabilities: algoProbs } }
                        : m
                ));
            } else {
                console.warn('Cannot run Algo mode: No snapshot available for trade', messageId);
            }
            return;
        }

        // AI Mode Logic
        setIsCalculatingAIProbabilities(true);
        try {
            const stream = ensembleService.recalculateProbabilities(
                msg.analysis,
                moderatorConfig,
                moderatorModel,
                msg.analysis.marketSnapshot // Pass snapshot for historical consistency
            );

            let fullJson = '';
            for await (const chunk of stream) {
                fullJson += chunk;
            }

            const parsed = extractLastJson(fullJson);
            if (parsed) {
                // Schema-validated normalization (accepts wrapped or bare shape)
                const probs = parseLevelProbabilities(parsed);

                if (probs) {
                    // Tag with mode
                    probs.calculationMode = 'AI';

                    updateMessages(prev => prev.map(m =>
                        m.id === messageId
                            ? { ...m, analysis: { ...m.analysis!, levelProbabilities: probs } }
                            : m
                    ));
                    console.log('Successfully updated AI probabilities for:', messageId);
                } else {
                    console.warn('Parsed JSON did not contain expected probability fields:', parsed);
                }
            } else {
                console.warn('Failed to extract valid JSON from AI response:', fullJson);
            }
        } catch (error) {
            console.error('Failed to calculate AI probabilities:', error);
        } finally {
            setIsCalculatingAIProbabilities(false);
        }
    };

    // ─── Outcome Autopilot ────────────────────────────────────────────────
    // Register PENDING analyses for automatic SL/TP detection; resolutions
    // surface in the chat via chatContext for inline one-click confirmation.
    const [autopilotResolutions, setAutopilotResolutions] = useState<Record<string, AutopilotResolution>>({});

    useEffect(() => {
        const unsubscribe = OutcomeAutopilotService.subscribe((messageId, resolution) => {
            setAutopilotResolutions(prev => ({ ...prev, [messageId]: resolution }));
            toast.success('Autopilot: outcome detected', resolution.detail);
        });
        return unsubscribe;
    }, [toast]);

    useEffect(() => {
        const leverage = activeConversation?.leverage || DEFAULT_LEVERAGE;
        messages.forEach(m => {
            const trackable = m.outcome === TradeOutcome.PENDING
                && !!m.analysis
                && m.analysis.direction !== 'Neutral'
                && (m.analysis.entryPoints?.length ?? 0) > 0
                && !!m.analysis.stopLoss
                && !!m.analysis.createdAt;
            if (trackable) {
                OutcomeAutopilotService.register(m.id, m.analysis!, leverage);
            } else {
                OutcomeAutopilotService.unregister(m.id);
            }
        });
    }, [messages, activeConversation?.leverage]);

    // Startup catch-up: once messages load, verify pending trades once
    // (covers outcomes that resolved while the app was closed).
    const autopilotCaughtUp = useRef(false);
    useEffect(() => {
        if (!autopilotCaughtUp.current && messages.length > 0) {
            autopilotCaughtUp.current = true;
            void OutcomeAutopilotService.checkNow();
        }
    }, [messages]);

    const handleConfirmAutopilot = useCallback((messageId: string) => {
        const msg = messages.find(m => m.id === messageId);
        const resolution = OutcomeAutopilotService.getResolution(messageId);
        if (!msg || !resolution || resolution.expiredOpen) return;
        if (resolution.outcome === TradeOutcome.ENTRY_NOT_HIT) {
            confirmAutopilotEntryNotHit(msg);
        } else {
            confirmAutopilotOutcome(msg, resolution.outcome, resolution.pnlPercent, resolution.slOptimizationData);
        }
        OutcomeAutopilotService.markProcessed(messageId);
        setAutopilotResolutions(prev => {
            const next = { ...prev };
            delete next[messageId];
            return next;
        });
        toast.success('Trade logged', `${resolution.outcome} confirmed via autopilot`);
    }, [messages, confirmAutopilotOutcome, confirmAutopilotEntryNotHit, toast]);

    const handleDismissAutopilot = useCallback((messageId: string) => {
        OutcomeAutopilotService.dismiss(messageId);
        setAutopilotResolutions(prev => {
            const next = { ...prev };
            delete next[messageId];
            return next;
        });
    }, []);

    const chatContext: ChatContextProps = useMemo(() => ({
        typingMessageState,
        setTypingMessageState,
        handleTypingComplete,
        highlightedAnalysisId,
        expandedPostMortems,
        setExpandedPostMortems,
        expandedPostMortemImages,
        setExpandedPostMortemImages,
        savedAnalyses,
        loggingTradeId,
        activeFrameworks,
        activeConversation,
        copiedMessageId,
        modelIdToName,
        ocrModelIdToName,
        providerNameToId,
        handleInitiateLogTrade,
        handleInitiateSkipTrade,
        handleViewStrategyDetails,
        handleApplyStrategy,
        handleSaveAnalysis,
        handleCopy,
        handleInitiateUpdateTrade,
        handleInitiateSimulator, // Scenario Simulator
        confidenceCalibration, // Confidence calibration stats
        onRetryPostMortem: handleRetryPostMortem, // Retry failed post-mortem
        lensConfig, // Analyst lens configuration for debate visualization
        leverage: parseInt(leverageInput, 10) || 100, // Leverage for backtest P&L calculations
        autopilotResolutions, // Outcome autopilot detected resolutions
        onConfirmAutopilot: handleConfirmAutopilot,
        onDismissAutopilot: handleDismissAutopilot,
        onCompareAnalysis: handleCompareAnalysis,
        onViewReasoning: handleViewReasoning
    }), [typingMessageState, highlightedAnalysisId, expandedPostMortems, expandedPostMortemImages, savedAnalyses, loggingTradeId, activeFrameworks, activeConversation, copiedMessageId, modelIdToName, providerNameToId, handleInitiateLogTrade, handleInitiateSkipTrade, handleViewStrategyDetails, handleApplyStrategy, handleSaveAnalysis, handleCopy, handleTypingComplete, handleInitiateUpdateTrade, confidenceCalibration, handleRetryPostMortem, lensConfig, leverageInput, autopilotResolutions, handleConfirmAutopilot, handleDismissAutopilot, handleCompareAnalysis, handleViewReasoning]);

    // ... (Rest of component remains unchanged) ...
    return (
        // P1-6: Outer Suspense boundary. fallback={null} so a suspending lazy
        // subtree (e.g. a modal opening) does NOT blank the always-visible
        // chat/header. Per-component Suspense wrappers below isolate suspends.
        <React.Suspense fallback={null}>
        <div ref={appRef} className="flex flex-col bg-zinc-950 text-zinc-100 font-sans h-full overflow-hidden transition-colors duration-500">
            {/* P2-13: Custom confirm dialog + undo toast (replaces window.confirm) */}
            {ConfirmDialogComponent}

            {isVersionHistoryVisible && (
                <VersionHistoryDashboard onClose={() => setIsVersionHistoryVisible(false)} />
            )}

            {/* Desktop auto-update overlay (Electron only).
                Renders null in the browser and whenever no update is in
                progress, so it's a safe no-op outside Electron. */}
            <React.Suspense fallback={null}>
                <UpdateOverlay />
            </React.Suspense>
            <LiveStreamView
                variant="postmortem"
                isVisible={isLivePostMortemVisible}
                onClose={() => setIsLivePostMortemVisible(false)}
                thoughts={livePostMortemThoughts}
                outputs={livePostMortemThoughts}
                providers={readyProviders}
                onAllTypingComplete={handleAllPostMortemTypingComplete}
            />
            <UserProfileManager isVisible={isUserModalOpen} onUserSelect={loadUserData} existingUsers={existingUsernames} onImportProfile={handleImportData} onDeleteUser={handleDeleteUser} />
            <AccuracyModeModal isOpen={showAccuracyModal} onClose={() => setShowAccuracyModal(false)} onConfirm={handleConfirmAccuracyMode} isEnabling={!isAccuracyModeEnabled} />
            <LiveMarket isVisible={isLiveMarketVisible} onClose={() => setIsLiveMarketVisible(false)} onAnalyze={handleLiveMarketAnalyze} />
            {dataCaptureCandidate && (
                <DataCaptureModal
                    message={dataCaptureCandidate.message}
                    outcome={dataCaptureCandidate.outcome}
                    onClose={() => setDataCaptureCandidate(null)}
                    onUploadScreenshot={handleDataCaptureUpload}
                    onAutoCapture={handleDataCaptureAuto}
                    onSkip={handleDataCaptureSkip}
                    isCapturing={isAutoCapturing}
                />
            )}
            {entryNotHitCandidate && (
                <EntryNotHitCaptureModal
                    message={entryNotHitCandidate.message}
                    correctedEntry={entryNotHitCandidate.correctedEntry}
                    onClose={() => setEntryNotHitCandidate(null)}
                    onAutoCapture={handleEntryNotHitAutoCapture}
                    onUploadScreenshot={handleEntryNotHitUpload}
                    onSkip={handleEntryNotHitSkip}
                    isCapturing={isEntryNotHitCapturing}
                />
            )}
            {postMortemCandidate && <PostTradeUploadModal candidate={postMortemCandidate} onClose={() => setPostMortemCandidate(null)} onAnalyze={(summaries, urls) => startPostMortemAnalysis(postMortemCandidate, summaries, urls)} visionConfig={readyProviders.find(p => p.selectedModel === selectedOcrModel || p.models.includes(selectedOcrModel)) || readyProviders[0] || moderatorConfig} onQuotaExceeded={handleQuotaExceeded} />}
            {updateCandidate && <UpdateTradeModal message={updateCandidate} onClose={() => setUpdateCandidate(null)} onConfirm={handleConfirmUpdateTrade} onAutoCapture={handleUpdateAutoCapture} isCapturing={isUpdateAutoCapturing} visionConfig={readyProviders.find(p => p.selectedModel === selectedOcrModel || p.models.includes(selectedOcrModel)) || readyProviders[0] || moderatorConfig} onQuotaExceeded={handleQuotaExceeded} />}
            {simulatorCandidate && (
                <ScenarioSimulator
                    message={simulatorCandidate}
                    loggedTrades={loggedTrades}
                    leverage={activeConversation?.leverage || DEFAULT_LEVERAGE}
                    onClose={() => setSimulatorCandidate(null)}
                />
            )}
            <SettingsMenu
                isVisible={isSettingsMenuVisible}
                onClose={() => setIsSettingsMenuVisible(false)}
                isLoading={isLoading}
                onOpenSavedAnalyses={() => { setIsSavedAnalysesVisible(true); setIsSettingsMenuVisible(false); }}
                onOpenStrategySearch={() => { setIsStrategySearchVisible(true); setIsSettingsMenuVisible(false); }}
                summarizationProvider={summarizationProvider}
                summarizationModel={summarizationModel}
                onSetSummarizationProvider={handleSetSummarizationProvider}
                onSetSummarizationModel={setSummarizationModel}
                summaryCharLimit={summaryCharLimit}
                onUpdateSummaryCharLimit={handleUpdateSummaryCharLimit}
                onRegenerateSummary={handleRegenerateFinalSummary}
                useAlgorithmicSummary={useAlgorithmicSummary}
                onToggleAlgorithmicSummary={setUseAlgorithmicSummary}
                useAlgorithmicInsights={useAlgorithmicInsights}
                onToggleAlgorithmicInsights={setUseAlgorithmicInsights}
                onSwitchUser={handleSwitchUser}
                onExportData={handleExportData}
                isAccuracyModeEnabled={isAccuracyModeEnabled}
                onToggleAccuracyMode={handleToggleAccuracyMode}
                accuracySubMode={accuracySubMode}
                setAccuracySubMode={setAccuracySubMode}
                isHybridIntelligenceEnabled={isHybridIntelligenceEnabled}
                setIsHybridIntelligenceEnabled={setIsHybridIntelligenceEnabled}
                isAutoCapturing={isAutoCapturing}
                onToggleAutoCapturing={() => setIsAutoCapturing(!isAutoCapturing)}
                isUpdateAutoCapturing={isUpdateAutoCapturing}
                onToggleUpdateAutoCapturing={() => setIsUpdateAutoCapturing(!isUpdateAutoCapturing)}
                isEntryNotHitCapturing={isEntryNotHitCapturing}
                onToggleEntryNotHitCapturing={() => setIsEntryNotHitCapturing(!isEntryNotHitCapturing)}
                isGlobalMemoryEnabled={isGlobalMemoryEnabled}
                setIsGlobalMemoryEnabled={setIsGlobalMemoryEnabled}
                memoryConfig={memoryConfig}
                onMemoryConfigChange={setMemoryConfig}
                memoryModel={memoryModel}
                setMemoryModel={setMemoryModel}
                isPlaybookEnabledInPureAI={isPlaybookEnabledInPureAI}
                setIsPlaybookEnabledInPureAI={setIsPlaybookEnabledInPureAI}
                isFamiliesEnabledInPureAI={isFamiliesEnabledInPureAI}
                setIsFamiliesEnabledInPureAI={setIsFamiliesEnabledInPureAI}
                isMemoryEnabledInPureAI={isMemoryEnabledInPureAI}
                setIsMemoryEnabledInPureAI={setIsMemoryEnabledInPureAI}
                customInstructions={customInstructions}
                setCustomInstructions={setCustomInstructions}
                lensConfig={lensConfig}
                onSetLensConfig={handleSetLensConfig}
                providerConfigs={providerConfigs}
                selectedOcrModel={selectedOcrModel}
                onSetOcrModel={handleSetSelectedOcrModel}
                moderatorProvider={moderatorProviderId as AIProvider}
                moderatorModel={moderatorModel}
                onSetModeratorProvider={handleSetModeratorProvider}
                onSetModeratorModel={handleSetModeratorModel}
                onUpdateProvider={handleUpdateProvider}
                onAddCustomProvider={handleAddCustomProvider}
                onRemoveProvider={handleRemoveProvider}
                onToggleProviderConfig={handleToggleProviderConfig}
                onAddModel={handleAddModel}
                onRemoveModel={handleRemoveModel}
                onUpdateModel={handleUpdateModel}
                loggedTrades={loggedTrades}
                onDeleteTrades={handleDeleteTrades}
                onClearAllTrades={handleClearAllTrades}
                modelIdToName={modelIdToName}
                ocrModelIdToName={ocrModelIdToName}
                onUpdateInsights={handleManualInsightsUpdate}
                isSummarizing={isSummarizing}
                currentInsightIds={currentInsightIds}
                onUpdateTradeLeverage={handleUpdateTradeLeverage}
                familyWinRates={familyWinRates}
                globalMemory={globalMemory}
                threadSummary={activeConversation?.threadSummary}
            />
            <VisionDataViewer isVisible={isVisionDataVisible} onClose={() => setIsVisionDataVisible(false)} visionData={currentVisionData} />


            <Header
                activeUsername={activeUsername}
                saveStatus={saveStatus}
                isAnalysisInProgress={isAnalysisInProgress}
                isPostMortemInProgress={isPostMortemInProgress}
                currentVisionData={currentVisionData}
                isFreshSession={messages.length === 0}
                onOpenVersionHistory={() => setIsVersionHistoryVisible(true)}
                isMobileMenuOpen={isMobileMenuOpen}
                mobileMenuRef={mobileMenuRef}
                setIsMobileMenuOpen={setIsMobileMenuOpen}
                setIsVisionDataVisible={setIsVisionDataVisible}
                setJournalState={setJournalState}
                setIsSettingsVisible={setIsSettingsMenuVisible}
                setIsLivePostMortemVisible={setIsLivePostMortemVisible}
                isLoading={isLoading}
                isRateLimited={isRateLimited}
                onOpenLiveMarket={() => setIsLiveMarketVisible(true)}
                onDeleteConversation={handleDeleteConversationFromSidebar}
                isOnline={isOnline}
                pendingQueueCount={pendingQueueCount}
                liveMarketConditions={liveMarketConditions}
                conversations={conversationHistory}
                activeConversationId={activeConversationId}
                onNewConversation={handleStartNewConversation}
                onLoadConversation={handleLoadConversation}
            />

            <Journal
                isVisible={journalState.isOpen}
                onClose={() => setJournalState(prev => ({ ...prev, isOpen: false }))}
                initialTab={journalState.tab}
                initialTradeId={journalState.focusTradeId}
                username={activeUsername || undefined}
                onInitialTradeConsumed={handleReasoningTradeConsumed}
                trades={loggedTrades}
                enabledProviders={readyProviders.map(p => p.id)}
                selectedModels={Object.fromEntries(readyProviders.map(p => [p.id, p.selectedModel]))}
                onDeleteTrades={handleDeleteTrades}
                onClearAllTrades={handleClearAllTrades}
                modelIdToName={modelIdToName}
                ocrModelIdToName={ocrModelIdToName}
                onUpdateInsights={handleManualInsightsUpdate}
                isSummarizing={isSummarizing}
                currentInsightIds={currentInsightIds}
                onUpdateTradeLeverage={handleUpdateTradeLeverage}
                familyWinRates={familyWinRates}
                globalMemory={globalMemory}
                threadSummary={activeConversation?.threadSummary}

                finalSummary={finalTradeSummary}
                individualSummaries={tradeSummaries}
                isLoading={isSummaryInProgress}
                isInsightGenerating={isInsightGenerating}
                newlyAddedInsightIds={newlyAddedInsightIds}
                summarizationProvider={summarizationProvider}
                summarizationModel={summarizationModel}
                onSetSummarizationProvider={handleSetSummarizationProvider}
                onSetSummarizationModel={handleSetSummarizationModel}
                providers={readyProviders}

                summaryCharLimit={summaryCharLimit}
                onUpdateSummaryCharLimit={handleUpdateSummaryCharLimit}
                onRegenerateSummary={handleRegenerateFinalSummary}
                onDeleteInsight={handleDeleteInsight}
                useAlgorithmicSummary={useAlgorithmicSummary}
                onToggleAlgorithmicSummary={setUseAlgorithmicSummary}
                useAlgorithmicInsights={useAlgorithmicInsights}
                onToggleAlgorithmicInsights={setUseAlgorithmicInsights}
                onRewriteInsightsWithAI={handleRewriteInsightsWithAI}
            />

            <StrategySearch isVisible={isStrategySearchVisible} onClose={() => { setIsStrategySearchVisible(false); setStrategyToView(null); }} onApplyStrategy={handleApplyStrategy} onRemoveStrategy={handleRemoveStrategy} providerConfig={readyProviders[0] || moderatorConfig} activeFrameworks={activeFrameworks} defaultFrameworks={DEFAULT_FRAMEWORKS} initialViewStrategy={strategyToView} onQuotaExceeded={handleQuotaExceeded} familyWinRates={familyWinRates} />
            <SavedAnalyses analyses={savedAnalyses} isVisible={isSavedAnalysesVisible} onClose={() => setIsSavedAnalysesVisible(false)} onDelete={handleDeleteSavedAnalyses} onClearAll={handleClearAllSavedAnalyses} modelIdToName={modelIdToName} ocrModelIdToName={ocrModelIdToName} />
            {skipCandidate && <SkipTradeModal onClose={() => setSkipCandidate(null)} onConfirm={handleConfirmSkipTrade} skipReason={skipReason} setSkipReason={setSkipReason} correctedEntry={correctedEntry} setCorrectedEntry={setCorrectedEntry} />}
            {showMismatchModal && mismatchData && (
                <OutcomeMismatchModal
                    isVisible={showMismatchModal}
                    onClose={() => setShowMismatchModal(false)}
                    userOutcome={mismatchData.candidate.outcome === TradeOutcome.WIN ? 'WIN' : 'LOSS'}
                    priceValidation={mismatchData.validation}
                    onResolve={handleMismatchResolution}
                />
            )}


            {/* Advanced Analytics Side Panel - Fixed on right edge */}
            <AdvancedAnalyticsSidePanel
                enabledProviders={readyProviders.map(p => p.id)}
                monteCarloResult={latestMonteCarloResult}
                backtestResult={latestBacktestResult}
                isCalculating={isAnalysisInProgress || isCalculatingAIProbabilities}
                perAIMonteCarloResults={perAIMonteCarloResults}
                entryTimingScore={currentEntryTimingScore}
                slOptimization={currentSlOptimization}
                levelProbabilities={(() => {
                    // Use selected message if available, otherwise fall back to latest
                    const selectedMsg = selectedProbabilityMessageId
                        ? analysisMessages.find(m => m.id === selectedProbabilityMessageId)
                        : null;
                    const targetMsg = selectedMsg || (analysisMessages.length > 0 ? analysisMessages[analysisMessages.length - 1] : null);
                    return targetMsg?.analysis?.levelProbabilities || null;
                })()}
                selectedCoinName={(() => {
                    const selectedMsg = selectedProbabilityMessageId
                        ? analysisMessages.find(m => m.id === selectedProbabilityMessageId)
                        : null;
                    return selectedMsg?.analysis?.coinName || null;
                })()}
                onClearSelection={() => setSelectedProbabilityMessageId(null)}
                isExternallyOpen={isAdvancedAnalyticsOpen}
                onClose={() => setIsAdvancedAnalyticsOpen(false)}
            />

            {/* Main row: persistent desktop sidebar + chat column */}
            <div className="flex-1 flex flex-row min-h-0">
                <aside className={`hidden lg:flex flex-col ${isSidebarCollapsed ? 'w-16' : 'w-60'} shrink-0 min-h-0 border-r border-white/5 bg-[#151515] transition-[width] duration-200 relative`}>
                    <button
                        type="button"
                        onClick={() => setIsSidebarCollapsed(prev => !prev)}
                        className="absolute -right-3 top-4 z-30 h-6 w-6 rounded-full border border-white/10 bg-zinc-800 text-zinc-400 shadow-lg hover:bg-zinc-700 hover:text-white transition-colors flex items-center justify-center focus-visible:ring-2 focus-visible:ring-cyan-400"
                        title={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                        aria-label={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                    >
                        {isSidebarCollapsed ? <ChevronRightIcon className="h-3.5 w-3.5" /> : <ChevronLeftIcon className="h-3.5 w-3.5" />}
                    </button>
                    <SidebarContent
                        activeUsername={activeUsername}
                        conversations={conversationHistory}
                        activeConversationId={activeConversationId}
                        hasVisionData={currentVisionData.length > 0}
                        isFreshSession={messages.length === 0}
                        onNewConversation={handleStartNewConversation}
                        onLoadConversation={handleLoadConversation}
                        onDeleteConversation={handleDeleteConversationFromSidebar}
                        onOpenLiveMarket={() => setIsLiveMarketVisible(true)}
                        onOpenVisionData={() => setIsVisionDataVisible(true)}
                        onOpenJournal={() => setJournalState({ isOpen: true, tab: 'log' })}
                        onOpenSettings={() => setIsSettingsMenuVisible(true)}
                        collapsed={isSidebarCollapsed}
                    />
                </aside>

                <main className="flex-1 flex flex-col min-h-0 min-w-0 relative">
                    {/* Mistake Warning Banner - Global Risk Reminder */}
                    {loggedTrades.length > 0 && (
                        <React.Suspense fallback={null}>
                        <MistakeWarningBanner
                            tradeLog={loggedTrades}
                        />
                        </React.Suspense>
                    )}

                    {/* P2-12: First-run onboarding card. Shows when no providers are
                        configured and the user hasn't dismissed it. */}
                    <OnboardingCard
                        hasAnyApiKey={readyProviders.length > 0}
                        onOpenSettings={() => setIsSettingsMenuVisible(true)}
                    />

            <ChatArea
                messages={messages}
                analysisSteps={analysisSteps}
                isAnalysisActive={!!loadingMessage}
                onSelectMessageForProbability={(id) => {
                    setSelectedProbabilityMessageId(id);
                    setIsAdvancedAnalyticsOpen(true);
                    handleCalculateAIProbabilities(id);
                }}
                chatContext={chatContext}
                virtuosoRef={virtuosoRef}
                isRateLimited={isRateLimited}
                setIsRateLimited={setIsRateLimited}
                showScrollDown={showScrollDown}
                setShowScrollDown={setShowScrollDown}
                showScrollUp={showScrollUp}
                setShowScrollUp={setShowScrollUp}
                handleCycleAnalysisUp={handleCycleAnalysisUp}
                handleScrollToBottom={handleScrollToBottom}
                highlightedAnalysisId={highlightedAnalysisId}
                setHighlightedAnalysisId={setHighlightedAnalysisId}
                analysisMessages={analysisMessages}
                loadingMessage={loadingMessage}
                isAnalysisInProgress={isAnalysisInProgress}
                isPostMortemInProgress={isPostMortemInProgress}
                setIsLivePostMortemVisible={setIsLivePostMortemVisible}
                handleCancelAnalysis={handleCancelAnalysis}
                onDeleteMessages={handleDeleteMessages}
                // ChatInput props
                lensConfig={lensConfig}
                setLensConfig={handleSetLensConfig}
                ensembleModelSelection={ensembleModelSelection}
                setEnsembleModelSelection={handleSetEnsembleModelSelection}
                customEnsemblePrompt={customEnsemblePrompt}
                setCustomEnsemblePrompt={handleSetCustomEnsemblePrompt}
                customLensPrompts={customLensPrompts}
                setCustomLensPrompts={handleSetCustomLensPrompts}
                isEnsembleEnabled={isEnsembleEnabled}
                setIsEnsembleEnabled={handleSetEnsembleEnabled}
                selectedChatModel={selectedChatModel}
                setSelectedChatModel={setSelectedChatModel}
                images={images}
                removeImage={removeImage}
                leverageRef={leverageRef}
                setIsLeverageDropdownOpen={setIsLeverageDropdownOpen}
                leverageInput={leverageInput}
                handleLeverageChange={handleLeverageChange}
                handleLeverageBlur={handleLeverageBlur}
                isLeverageDropdownOpen={isLeverageDropdownOpen}
                handlePresetLeverage={handlePresetLeverage}
                fileInputRef={fileInputRef}
                isImageUploadDisabled={isImageUploadDisabled}
                handleImageUpload={handleImageUpload}
                input={input}
                setInput={setInput}
                handleSendMessage={handleSendMessage}
                isSummarizing={isSummarizing}
                isAnyProviderEnabled={isAnyProviderEnabled}
                isAccuracyModeEnabled={isAccuracyModeEnabled}
                accuracySubMode={accuracySubMode}
                providers={providerConfigs}
                onUpdateProvider={handleUpdateProvider}

                selectedVisionModel={selectedOcrModel}
                setSelectedVisionModel={handleSetVisionModel}
                hybridData={currentHybridData}
                isHybridLoading={isHybridLoading}
                hybridConnectionStatus={hybridConnectionStatus}
                hideHybridPanel={isSettingsMenuVisible}
                slOptimization={currentSlOptimization}
                suggestedEntryPrice={currentSuggestedEntryPrice}
                entryTimingScore={currentEntryTimingScore}
                onNewConversation={handleStartNewConversation}
                onOpenJournal={() => setJournalState({ isOpen: true, tab: 'log' })}
                onOpenLiveMarket={() => setIsLiveMarketVisible(true)}
                onOpenAnalytics={() => setIsAdvancedAnalyticsOpen(true)}
                onInteract={() => {
                    if (isAdvancedAnalyticsOpen) setIsAdvancedAnalyticsOpen(false);
                }}
            />
                </main>
            </div>

            {/* Command palette — Ctrl/Cmd+K */}
            <CommandPalette
                isOpen={isCommandPaletteOpen}
                onClose={() => setIsCommandPaletteOpen(false)}
                inputPreview={input.trim() ? input.trim().slice(0, 60) : undefined}
                actions={commandPaletteActions}
            />

            {/* Saved analyses gallery */}
            {isSavedGalleryOpen && (
                <React.Suspense fallback={null}>
                    <SavedAnalysesGallery
                        savedAnalyses={savedAnalyses}
                        modelIdToName={modelIdToName}
                        onLocateMessage={handleLocateMessage}
                        onClose={() => setIsSavedGalleryOpen(false)}
                    />
                </React.Suspense>
            )}

            {/* Side-by-side compare */}
            {comparePrimary && (
                <React.Suspense fallback={null}>
                    <CompareModal
                        primary={comparePrimary}
                        secondary={compareSecondary}
                        analysisMessages={messages.filter(m => m.analysis)}
                        modelIdToName={modelIdToName}
                        onPickSecondary={handlePickSecondary}
                        onClose={() => setCompareState(null)}
                    />
                </React.Suspense>
            )}
        </div>
        </React.Suspense>
    );
};

export default App;
