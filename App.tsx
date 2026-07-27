
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { VirtuosoHandle } from 'react-virtuoso';
import { Message, MessageRole, TradeOutcome, ImageMetadata, AIProvider, Conversation, UserProfile, SavedAnalysis, TradeSummary, GlobalMemory, AccuracySubMode, CustomInstructionsMap, AnalystLensConfig } from './types';
import * as ensembleService from './services/providers/ensembleService';
import { generateFinalSummary } from './services/providers/GenericAnalysisService';
import * as dbService from './services/infrastructure/dbService';
import { ProbabilityEngineService } from './services/analysis/ProbabilityEngineService';


// Modular Imports
import { ChatContextProps } from './components/chat/MessageItem';
import { useToastActions } from './components/shared/Toast';
import { useConfirmDialog } from './components/shared/ConfirmDialog';
import { OnboardingCard } from './components/shared/OnboardingCard';
import { Header } from './components/shared/Header';
import { ChatArea } from './components/chat/ChatArea';
import { useProviderConfigs } from './hooks/useProviderConfigs';
import { PostMortemCandidate } from './components/modals/PostTradeUploadModal';

// P1-6: Lazy-load heavy, conditionally-rendered components so the initial
// bundle is much smaller. Previously the entire app was one ~1.73 MB chunk.
// Each lazy() call below produces a separate chunk loaded on demand when
// the user opens the corresponding panel/modal. ChatArea and Header stay
// eager (always-rendered, critical path).
const Journal = React.lazy(() => import('./components/journal/Journal').then(m => ({ default: m.Journal })));
const StrategySearch = React.lazy(() => import('./components/shared/StrategySearch'));
const ConversationHistory = React.lazy(() => import('./components/chat/ConversationHistory'));
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
const HybridDataPanel = React.lazy(() => import('./components/analysis/HybridDataPanel'));
const AdvancedAnalyticsSidePanel = React.lazy(() => import('./components/dashboards/AdvancedAnalyticsSidePanel'));
const ScenarioSimulator = React.lazy(() => import('./components/modals/ScenarioSimulator'));
const UpdateNotification = React.lazy(() => import('./components/shared/UpdateNotification'));
const UpdateOverlay = React.lazy(() => import('./components/shared/UpdateOverlay'));
const MistakeWarningBanner = React.lazy(() => import('./components/shared/MistakeWarningBanner'));
const AnalysisProgress = React.lazy(() => import('./components/analysis/AnalysisProgress'));
import { setUpdateNotificationHandler, activateWaitingWorker } from './index';

import { GEMINI_MODELS, DEEPSEEK_MODELS, ZHIPU_MODELS, GROQ_MODELS, GROQ_NEW_MODELS, GROQ_ALT2_MODELS, OPENROUTER_MODELS, OPENAI_MODELS, GROK_MODELS, OCR_MODELS, modelIdToName, ocrModelIdToName, DEFAULT_FRAMEWORKS, ACCURACY_MODE_DEFAULTS } from './constants/models';
import { createNewConversation } from './utils/conversationUtils';
import { recalculateAnalysisMetrics } from './utils/analysisUtils';
import { processImagesForSummarization } from './utils/imageProcessor';
import { extractLastJson } from './utils/jsonUtils';
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
// AI Learning Services - Adaptive Learning, Mistake Patterns, Insight Extraction
import { extractInsightsFromPostMortem, storeInsights, initializeKnowledgeBase } from './services/learning/InsightExtractionService';
import * as MemoryService from './services/learning/MemoryService';
import { ProviderConfig } from './types/provider';
import { syncFromTradeLog, syncRollingWindowFromTradeLog, initModelPerformanceService } from './services/backtesting/ModelPerformanceService';
import { loadLensConfig, saveLensConfig, getDefaultLensAssignments, initAnalystLensService } from './services/ui/AnalystLensService';
import { detectTradingStyle, getEffectiveStyle, generateMasterPromptStyleInjection } from './services/ui/TradingStyleDetector';
import { checkDataIntegrity, createStartupBackup, updateTradeCount, logIntegrityEvent, runMigrations } from './services/validation/DataIntegrityService';
import { startAutoBackup, stopAutoBackup } from './services/infrastructure/BackupService';
import { initInvalidationRuleService, loadInvalidationRules } from './services/validation/InvalidationRuleService';
import { PriceAlertService } from './services/ui/PriceAlertService';
import { clearAllCaches } from './services/infrastructure/responseCache';
import { initNativeStatusBar } from './services/infrastructure/NativeStatusBar';
import { initConfluenceService } from './services/analysis/TimeframeConfluenceService';
import { initPatternMemoryService } from './services/learning/PatternMemorySynthesisService';
import GlobalLearningService from './services/learning/GlobalLearningService';
const VersionHistoryDashboard = React.lazy(() => import('./components/dashboards/VersionHistoryDashboard').then(m => ({ default: m.VersionHistoryDashboard })));

const App: React.FC = () => {
    const toast = useToastActions();
    const { confirm: confirmDialog, ConfirmDialogComponent } = useConfirmDialog();

    // P2-12: Detect whether any AI provider API key is configured so the
    // first-run onboarding card can guide new users to Settings. Keys are
    // inlined at build time via vite.config.ts, so this is a static check.
    const hasAnyApiKey = !!(
        process.env.GEMINI_API_KEY ||
        process.env.OPENAI_API_KEY ||
        process.env.DEEPSEEK_API_KEY ||
        process.env.GROQ_API_KEY ||
        process.env.GROQ_NEW_API_KEY ||
        process.env.GROQ_ALT2_API_KEY ||
        process.env.ZHIPU_API_KEY ||
        process.env.OPENROUTER_API_KEY ||
        process.env.GROK_API_KEY
    );

    // UI visibility and progress state (extracted to hooks/useUIState.ts)
    const {
        isUserModalOpen, setIsUserModalOpen,
        isHistoryVisible, setIsHistoryVisible,
        isStrategySearchVisible, setIsStrategySearchVisible,
        isSavedAnalysesVisible, setIsSavedAnalysesVisible,
        isSettingsMenuVisible, setIsSettingsMenuVisible,
        isLiveMarketVisible, setIsLiveMarketVisible,
        isAdvancedAnalyticsOpen, setIsAdvancedAnalyticsOpen,
        isVersionHistoryVisible, setIsVersionHistoryVisible,
        isLiveAnalysisVisible, setIsLiveAnalysisVisible,
        isLivePostMortemVisible, setIsLivePostMortemVisible,
        isMobileMenuOpen, setIsMobileMenuOpen,
        showMismatchModal, setShowMismatchModal,
        isFullscreen, setIsFullscreen,
        isLeverageDropdownOpen, setIsLeverageDropdownOpen,
        isVisionDataVisible, setIsVisionDataVisible,
        showUpdateNotification, setShowUpdateNotification,
        showAccuracyModal, setShowAccuracyModal,
        showScrollDown, setShowScrollDown,
        showScrollUp, setShowScrollUp,
        isLoading, setIsLoading,
        isHybridLoading, setIsHybridLoading,
        isCalculatingAIProbabilities, setIsCalculatingAIProbabilities,
        isAnalysisTypingComplete, setIsAnalysisTypingComplete,
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
        readyProviders,
        handleUpdateProvider,
        handleAddCustomProvider,
        handleRemoveProvider,
        handleToggleProvider: handleToggleProviderConfig,
    } = useProviderConfigs();

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

    // Layer 3: Global Long-Term Memory
    const [globalMemory, setGlobalMemory] = useState<GlobalMemory | undefined>(undefined);

    // Memory Provider Selection (for compressChatHistory and updateGlobalMemory)
    const [memoryConfig, setMemoryConfig] = useState<ProviderConfig | null>(null);
    const [memoryModel, setMemoryModel] = useState<string>('gemini-2.5-flash');
    const [isGlobalMemoryEnabled, setIsGlobalMemoryEnabled] = useState<boolean>(true);

    // Derive the moderator ProviderConfig from readyProviders
    const moderatorConfig: ProviderConfig = useMemo(() =>
        readyProviders.find(p => p.id === moderatorProviderId) || readyProviders[0] || {
            id: 'none', name: 'None', apiKey: '', baseUrl: '', apiFormat: 'chat_completions' as const,
            isEnabled: false, isBuiltIn: true, models: [], selectedModel: '',
        },
    [readyProviders, moderatorProviderId]);

    // Accuracy Mode State
    const [isAccuracyModeEnabled, setIsAccuracyModeEnabled] = useState<boolean>(false);
    const [accuracySubMode, setAccuracySubMode] = useState<AccuracySubMode>('original');

    // Custom AI Behavior
    const [customInstructions, setCustomInstructions] = useState<CustomInstructionsMap>({
        general: [],
        accuracyOriginal: [],
        accuracyPure: []
    });
    const [isPlaybookEnabledInPureAI, setIsPlaybookEnabledInPureAI] = useState<boolean>(false);
    const [isFamiliesEnabledInPureAI, setIsFamiliesEnabledInPureAI] = useState<boolean>(false);
    const [isMemoryEnabledInPureAI, setIsMemoryEnabledInPureAI] = useState<boolean>(false);
    const [isHybridIntelligenceEnabled, setIsHybridIntelligenceEnabled] = useState<boolean>(false);

    // Analyst Lens Configuration - specialized roles for ensemble debates
    const [lensConfig, setLensConfig] = useState<AnalystLensConfig>(() => loadLensConfig());


    // Market data state and effects (extracted to hooks/useMarketData.ts)
    const marketData = useMarketData(isHybridIntelligenceEnabled);
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

    // Confidence Calibration - tracks AI confidence vs actual outcomes
    const [confidenceCalibration, setConfidenceCalibration] = useState<ConfidenceCalibration | undefined>(undefined);

    // AI Learning - Knowledge base for extracted insights from post-mortems
    const [insightKnowledgeBase, setInsightKnowledgeBase] = useState<InsightKnowledgeBase | undefined>(undefined);

    // Network status and offline queue
    const { isOnline, wasOffline } = useNetworkStatus();
    const [pendingQueueCount, setPendingQueueCount] = useState<number>(0);

    const [activeFrameworks, setActiveFrameworks] = useState<string[]>(DEFAULT_FRAMEWORKS);
    const [summaryCharLimit, setSummaryCharLimit] = useState<number>(4000);
    const [summarizationProvider, setSummarizationProvider] = useState<AIProvider>(AIProvider.GEMINI);
    const [summarizationModel, setSummarizationModel] = useState<string>(GEMINI_MODELS[0].id);
    const [useAlgorithmicSummary, setUseAlgorithmicSummary] = useState<boolean>(true); // Default to Algo (saves tokens)
    const [useAlgorithmicInsights, setUseAlgorithmicInsights] = useState<boolean>(true); // NEW: Toggle for individual insights (Algo vs AI)


    const [journalState, setJournalState] = useState<{ isOpen: boolean, tab: 'log' | 'performance' | 'analytics' | 'learning' | 'memory' }>({ isOpen: false, tab: 'log' });

    const [selectedProbabilityMessageId, setSelectedProbabilityMessageId] = useState<string | null>(null); // Trade selection for AI Probability panel
    const [strategyToView, setStrategyToView] = useState<string | null>(null);
    const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
    const [highlightedAnalysisId, setHighlightedAnalysisId] = useState<string | null>(null);
    const [expandedIndividualThoughts, setExpandedIndividualThoughts] = useState<Record<string, boolean>>({});
    const [expandedDebateTranscripts, setExpandedDebateTranscripts] = useState<Record<string, boolean>>({});
    const [expandedPostMortemImages, setExpandedPostMortemImages] = useState<Record<string, boolean>>({});
    const [expandedPostMortems, setExpandedPostMortems] = useState<Record<string, boolean>>({});
    const [collapsedUserMessages, setCollapsedUserMessages] = useState<Record<string, boolean>>({});
    const [postMortemCandidate, setPostMortemCandidate] = useState<PostMortemCandidate | null>(null);

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

    // Analysis pipeline state, refs, and handlers (extracted to hooks/useAnalysisPipeline.ts)
    const {
        input, setInput,
        images, setImages,
        loadingMessage, setLoadingMessage,
        analysisSteps, setAnalysisSteps,
        liveThoughts, setLiveThoughts,
        currentGateResult, setCurrentGateResult,
        currentVisionData, setCurrentVisionData,
        isDeepAnalysis, setIsDeepAnalysis,
        quotaExceededModels, setQuotaExceededModels,
        analysisAbortController, abortRef,
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
        setIsLiveAnalysisVisible, setIsAnalysisTypingComplete,
        setHighlightedAnalysisId,
        setIsPostMortemInProgress, setIsLivePostMortemVisible,
        isAccuracyModeEnabled, accuracySubMode,
        isGlobalMemoryEnabled, customInstructions,
        isPlaybookEnabledInPureAI, isFamiliesEnabledInPureAI, isMemoryEnabledInPureAI,
        isHybridIntelligenceEnabled, lensConfig, activeFrameworks,
        toast,
    });

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

    // Post-mortem analysis state and handlers (extracted to hooks/usePostMortem.ts)
    const {
        mismatchData, setMismatchData,
        typingMessageState, setTypingMessageState,
        livePostMortemThoughts, setLivePostMortemThoughts,
        startPostMortemAnalysis,
        handleRetryPostMortem,
        handleAllPostMortemTypingComplete,
        handleMismatchResolution,
    } = usePostMortem({
        messages,
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

    // Register SW update notification handler
    useEffect(() => {
        setUpdateNotificationHandler(() => setShowUpdateNotification(true));
    }, []);

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
    const resetAppState = async () => {
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
        setActiveFrameworks(DEFAULT_FRAMEWORKS);
        setSummaryCharLimit(4000);
        setSummarizationProvider(AIProvider.GEMINI);
        setSummarizationModel(GEMINI_MODELS[0].id);
        setInput('');
        setImages([]);
        setExpandedIndividualThoughts({});
        setExpandedDebateTranscripts({});
        setExpandedPostMortems({});
        setCollapsedUserMessages({});

        if (activeUsername) {
            await dbService.saveUserProfile(activeUsername, {
                conversations: [newConv],
                tradeLog: [],
                savedAnalyses: [],
                tradeSummaries: [],
                finalTradeSummary: null,
                globalMemory: undefined,
                settings: { activeFrameworks: DEFAULT_FRAMEWORKS, summaryCharLimit: 4000, summarizationProvider: AIProvider.GEMINI, summarizationModel: GEMINI_MODELS[0].id, isGlobalMemoryEnabled: true, isAccuracyModeEnabled: false, accuracySubMode: 'original', customInstructions: { general: [], accuracyOriginal: [], accuracyPure: [] }, isPlaybookEnabledInPureAI: false, isFamiliesEnabledInPureAI: false, isMemoryEnabledInPureAI: false, isHybridIntelligenceEnabled: false },
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

    // Keep the activeUsernameRef (read by usePostMortem above) in sync with
    // the canonical activeUsername state. The ref is initialized from
    // sessionStorage so the very first render has a sensible value; this
    // effect keeps it accurate as the user switches accounts.
    useEffect(() => {
        const previous = activeUsernameRef.current;
        activeUsernameRef.current = activeUsername ?? null;
        // P1-4: Clear the AI response cache on user switch so one user's
        // cached analyses are never served to another user.
        if (previous !== null && previous !== activeUsername) {
            clearAllCaches();
            console.log('[App] Cleared response cache on user switch');
        }
        // P1-9: Stop the auto-backup scheduler when the active user changes
        // (loadUserData starts a fresh one for the new user). Also stops it
        // on unmount of the last user.
        if (previous !== null && previous !== activeUsername) {
            stopAutoBackup();
        }
    }, [activeUsername]);

    // P1-9: Final cleanup — stop the auto-backup scheduler when the app unmounts.
    useEffect(() => {
        return () => {
            stopAutoBackup();
        };
    }, []);

    const loadUserData = async (username: string) => {
        setIsLoading(true);

        // Initialize database (SQLite on native, IndexedDB on web)
        await dbService.initDatabase();
        // P1-8: Configure native status bar (no-op on web)
        await initNativeStatusBar();
        // Initialize service caches
        await initModelPerformanceService();
        await initAnalystLensService();
        await initInvalidationRuleService();
        await PriceAlertService.init();
        await initConfluenceService();
        await initPatternMemoryService();
        await GlobalLearningService.initialize();

        const profile = await dbService.getUserProfile(username);
        if (profile) {
            const correctedConvs = (profile.conversations || []).map(conv => {
                const leverage = conv.leverage || 100;
                const correctedMessages = (conv.messages || []).map(msg => {
                    if (msg.analysis) {
                        return { ...msg, analysis: recalculateAnalysisMetrics(msg.analysis, leverage) };
                    }
                    return msg;
                });
                return { ...conv, leverage, messages: correctedMessages };
            });

            const convs = correctedConvs.length > 0 ? correctedConvs : [createNewConversation()];

            setConversationHistory(convs);
            setLoggedTrades((profile.tradeLog || []).map(t => ({ ...t, leverage: t.leverage || 100 })));
            setSavedAnalyses(profile.savedAnalyses || []);
            setTradeSummaries((profile.tradeSummaries || []).slice(-MAX_TRADE_SUMMARIES));  // Keep most recent entries
            setFinalTradeSummary(profile.finalTradeSummary || null);
            setGlobalMemory(profile.globalMemory);
            setActiveFrameworks(profile.settings?.activeFrameworks || DEFAULT_FRAMEWORKS);
            setSummaryCharLimit(profile.settings?.summaryCharLimit || 4000);
            setSummarizationProvider(profile.settings?.summarizationProvider || AIProvider.GEMINI);
            setSummarizationModel(profile.settings?.summarizationModel || GEMINI_MODELS[0].id);
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
            setConfidenceCalibration(profile.settings?.confidenceCalibration);
            setMemoryConfig(providerConfigs.find(p => p.id === profile.settings?.memoryProvider) || null);
            setMemoryModel(profile.settings?.memoryModel || 'gemini-2.5-flash');

            // AI Learning: Load knowledge base
            setInsightKnowledgeBase(profile.insightKnowledgeBase);

            // Sync model performance data from trade log
            const tradeLogData = (profile.tradeLog || []).map(t => ({ ...t, leverage: t.leverage || 100 }));
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
                const message = `⚠️ Data Issue Detected\n\n` +
                    `Your trade log appears to have fewer trades than before ` +
                    `(${integrityCheck.previousTradeCount} → ${integrityCheck.currentTradeCount}).\n\n` +
                    (integrityCheck.hasBackups && integrityCheck.latestBackup
                        ? `A backup with ${integrityCheck.latestBackup.tradeCount} trades is available from ${new Date(integrityCheck.latestBackup.timestamp).toLocaleString()}.\n\nGo to Settings → Export Data to restore from backup.`
                        : 'Consider exporting your data regularly to prevent future data loss.');
                toast.info(message);
            }
        } else {
            resetAppState();
        }
        setActiveUsername(username);
        sessionStorage.setItem('activeUsername', username);
        setIsUserModalOpen(false);
        setHighlightedAnalysisId(null);
        setCollapsedUserMessages({});
        setIsLoading(false);
    };

    useEffect(() => {
        let isMounted = true;
        const initializeApp = async () => {
            const users = await dbService.getAllUsernames();
            if (!isMounted) return;
            setExistingUsernames(users);
            const sessionUser = sessionStorage.getItem('activeUsername');
            if (sessionUser && users.includes(sessionUser)) {
                loadUserData(sessionUser);
            } else {
                setIsUserModalOpen(true);
            }
        };
        initializeApp();
        return () => { isMounted = false; };
    }, []);

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
        settings: { activeFrameworks, summaryCharLimit, summarizationProvider, summarizationModel, isGlobalMemoryEnabled, isAccuracyModeEnabled, accuracySubMode, customInstructions, isPlaybookEnabledInPureAI, isFamiliesEnabledInPureAI, isMemoryEnabledInPureAI, isHybridIntelligenceEnabled, confidenceCalibration, memoryProvider: memoryConfig?.id || '', memoryModel },
        lastActiveConversationId: activeConversationId || undefined,
        // AI Learning data
        insightKnowledgeBase: insightKnowledgeBase,
    }), [conversationHistory, loggedTrades, activeFrameworks, activeConversationId, savedAnalyses, tradeSummaries, finalTradeSummary, globalMemory, summaryCharLimit, summarizationProvider, summarizationModel, isGlobalMemoryEnabled, isAccuracyModeEnabled, accuracySubMode, customInstructions, isPlaybookEnabledInPureAI, isFamiliesEnabledInPureAI, isMemoryEnabledInPureAI, isHybridIntelligenceEnabled, confidenceCalibration, insightKnowledgeBase, memoryConfig, memoryModel]);

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
        // eslint-disable-next-line react-hooks/exhaustive-deps
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
                    settings: { activeFrameworks, summaryCharLimit, summarizationProvider, summarizationModel, isGlobalMemoryEnabled, isAccuracyModeEnabled, accuracySubMode, customInstructions, isPlaybookEnabledInPureAI, isFamiliesEnabledInPureAI, isMemoryEnabledInPureAI, isHybridIntelligenceEnabled, confidenceCalibration, memoryProvider: memoryConfig?.id || '', memoryModel },
                });
            } catch (err) {
                console.error("Failed to save user profile (settings):", err);
            }
        }, 2500);

        return () => {
            clearTimeout(handler);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeFrameworks, summaryCharLimit, summarizationProvider, summarizationModel, isGlobalMemoryEnabled, isAccuracyModeEnabled, accuracySubMode, customInstructions, isPlaybookEnabledInPureAI, isFamiliesEnabledInPureAI, isMemoryEnabledInPureAI, isHybridIntelligenceEnabled, confidenceCalibration, memoryConfig, memoryModel, activeUsername]);

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
            appRef.current.classList.remove('bg-zinc-950', 'bg-[#1A0000]', 'bg-[#00121F]');
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
            updateActiveConversation(conv => ({
                ...conv,
                moderatorProviderId: ACCURACY_MODE_DEFAULTS.MODERATOR_PROVIDER,
                moderatorModel: ACCURACY_MODE_DEFAULTS.MODERATOR_MODEL,
                ocrModel: ACCURACY_MODE_DEFAULTS.VISION
            }));
            if (!accuracySubMode) setAccuracySubMode('original');
        }
    };

    // Analyst Lens config handler - updates state and persists to storage
    const handleSetLensConfig = useCallback((newConfig: AnalystLensConfig) => {
        setLensConfig(newConfig);
        saveLensConfig(newConfig);
    }, []);

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

    // Missing Handlers Implementation Start
    const handleAllAnalysisTypingComplete = useCallback(() => {
        setIsAnalysisTypingComplete(true);
    }, []);

    const handleSetSummarizationProvider = (provider: AIProvider) => setSummarizationProvider(provider);
    const handleSetSummarizationModel = (id: string) => setSummarizationModel(id);
    const handleUpdateSummaryCharLimit = (limit: number) => setSummaryCharLimit(limit);

    const handleToggleFullscreen = () => {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => { });
        } else {
            document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => { });
        }
    };

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
            const newConv = createNewConversation();
            setConversationHistory([newConv]);
            setActiveConversationId(newConv.id);
        }
    };

    const handleLoadConversation = (id: string) => {
        if (id !== activeConversationId) {
            setActiveConversationId(id);
            setIsHistoryVisible(false);
        }
    };

    const handleDeleteConversations = (ids: string[]) => {
        setConversationHistory(prev => prev.filter(c => !ids.includes(c.id)));
        if (activeConversationId && ids.includes(activeConversationId)) {
            const remaining = conversationHistory.filter(c => !ids.includes(c.id));
            if (remaining.length > 0) {
                setActiveConversationId(remaining[0].id);
            } else {
                handleStartNewConversation();
            }
        }
    };

    const handleStartNewConversation = () => {
        const newConv = createNewConversation();
        if (activeConversation) {
            newConv.ocrModel = activeConversation.ocrModel;
            newConv.moderatorProviderId = activeConversation.moderatorProviderId;
            newConv.moderatorModel = activeConversation.moderatorModel;
            newConv.leverage = activeConversation.leverage;
        }
        setConversationHistory(prev => [newConv, ...prev]);
        setActiveConversationId(newConv.id);
        setIsHistoryVisible(false);
    };

    const handleApplyStrategy = (strategyName: string) => {
        if (!activeFrameworks.includes(strategyName)) {
            setActiveFrameworks(prev => [...prev, strategyName]);
        }
    };

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
            const visionConfig = readyProviders.find(p => p.selectedModel === selectedOcrModel) || readyProviders[0] || moderatorConfig;
            processImagesForSummarization(filesToProcess, images.length, visionConfig, setImages, handleQuotaExceeded);
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

    const handleCopy = (message: Message) => {
        if (message.text) {
            navigator.clipboard.writeText(message.text);
            setCopiedMessageId(message.id);
            setTimeout(() => setCopiedMessageId(null), 2000);
        }
    };

    const handleViewStrategyDetails = (name: string) => {
        setStrategyToView(name);
        setIsStrategySearchVisible(true);
    };

    const handleSaveAnalysis = (messageId: string) => {
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
                geminiModelUsed: msg.modelsUsed?.['gemini'],
                deepseekModelUsed: msg.modelsUsed?.['deepseek'],
                zhipuModelUsed: msg.modelsUsed?.['zhipu'],
                groqModelUsed: msg.modelsUsed?.['groq'],
                groqNewModelUsed: msg.modelsUsed?.['groq_new'],
                groqAlt2ModelUsed: msg.modelsUsed?.['groq_alt2'],

                ocrModelUsed: msg.ocrModelUsed,
                moderatorProvider: moderatorProviderId,
                moderatorModel
            };
            setSavedAnalyses(prev => {
                if (prev.some(s => s.id === saved.id)) return prev;
                return [...prev, saved];
            });
        }
    };

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
                // Determine if 'parsed' is the levelProbabilities object or if it's wrapped
                const probs = parsed.levelProbabilities || (parsed.slProbability ? parsed : null);

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

    const chatContext: ChatContextProps = useMemo(() => ({
        typingMessageState,
        setTypingMessageState,
        handleTypingComplete,
        highlightedAnalysisId,
        expandedPostMortems,
        setExpandedPostMortems,
        expandedPostMortemImages,
        setExpandedPostMortemImages,
        expandedIndividualThoughts,
        setExpandedIndividualThoughts,
        expandedDebateTranscripts,
        setExpandedDebateTranscripts,
        collapsedUserMessages,
        setCollapsedUserMessages,
        savedAnalyses,
        loggingTradeId,
        activeFrameworks,
        activeConversation,
        copiedMessageId,
        modelIdToName,
        ocrModelIdToName,
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
        leverage: parseInt(leverageInput, 10) || 100 // Leverage for backtest P&L calculations
    }), [typingMessageState, highlightedAnalysisId, expandedPostMortems, expandedPostMortemImages, expandedIndividualThoughts, expandedDebateTranscripts, collapsedUserMessages, savedAnalyses, loggingTradeId, activeFrameworks, activeConversation, copiedMessageId, handleInitiateLogTrade, handleInitiateSkipTrade, handleViewStrategyDetails, handleApplyStrategy, handleSaveAnalysis, handleCopy, handleTypingComplete, handleInitiateUpdateTrade, confidenceCalibration, handleRetryPostMortem, lensConfig, leverageInput]);

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

            {/* SW Update Notification */}
            {showUpdateNotification && (
                <React.Suspense fallback={null}>
                <UpdateNotification
                    onRefresh={() => {
                        activateWaitingWorker();
                    }}
                    onDismiss={() => setShowUpdateNotification(false)}
                />
                </React.Suspense>
            )}

            {/* Desktop auto-update overlay (Electron only).
                Renders null in the browser and whenever no update is in
                progress, so it's a safe no-op outside Electron. */}
            <React.Suspense fallback={null}>
                <UpdateOverlay />
            </React.Suspense>
            <LiveStreamView
                variant="analysis"
                isVisible={isLiveAnalysisVisible}
                onClose={() => setIsLiveAnalysisVisible(false)}
                thoughts={liveThoughts}
                geminiModelName={readyProviders.find(p => p.id === 'gemini')?.selectedModel}
                deepseekModelName={readyProviders.find(p => p.id === 'deepseek')?.selectedModel}
                zhipuModelName={isAccuracyModeEnabled ? undefined : readyProviders.find(p => p.id === 'zhipu')?.selectedModel}
                groqModelName={readyProviders.find(p => p.id === 'groq')?.selectedModel}
                groqNewModelName={readyProviders.find(p => p.id === 'groq_new')?.selectedModel}
                groqAlt2ModelName={readyProviders.find(p => p.id === 'groq_alt2')?.selectedModel}
                openrouterModelName={readyProviders.find(p => p.id === 'openrouter')?.selectedModel}
                onAllTypingComplete={handleAllAnalysisTypingComplete}
            />
            <LiveStreamView
                variant="postmortem"
                isVisible={isLivePostMortemVisible}
                onClose={() => setIsLivePostMortemVisible(false)}
                thoughts={livePostMortemThoughts}
                geminiModelName={readyProviders.find(p => p.id === 'gemini')?.selectedModel}
                deepseekModelName={readyProviders.find(p => p.id === 'deepseek')?.selectedModel}
                zhipuModelName={isAccuracyModeEnabled ? undefined : readyProviders.find(p => p.id === 'zhipu')?.selectedModel}
                groqModelName={readyProviders.find(p => p.id === 'groq')?.selectedModel}
                groqNewModelName={readyProviders.find(p => p.id === 'groq_new')?.selectedModel}
                groqAlt2ModelName={readyProviders.find(p => p.id === 'groq_alt2')?.selectedModel}
                openrouterModelName={readyProviders.find(p => p.id === 'openrouter')?.selectedModel}
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
            {postMortemCandidate && <PostTradeUploadModal candidate={postMortemCandidate} onClose={() => setPostMortemCandidate(null)} onAnalyze={(summaries, urls) => startPostMortemAnalysis(postMortemCandidate, summaries, urls)} visionConfig={readyProviders.find(p => p.selectedModel === selectedOcrModel) || readyProviders[0] || moderatorConfig} onQuotaExceeded={handleQuotaExceeded} />}
            {updateCandidate && <UpdateTradeModal message={updateCandidate} onClose={() => setUpdateCandidate(null)} onConfirm={handleConfirmUpdateTrade} onAutoCapture={handleUpdateAutoCapture} isCapturing={isUpdateAutoCapturing} visionConfig={readyProviders.find(p => p.selectedModel === selectedOcrModel) || readyProviders[0] || moderatorConfig} onQuotaExceeded={handleQuotaExceeded} />}
            {simulatorCandidate && (
                <ScenarioSimulator
                    message={simulatorCandidate}
                    loggedTrades={loggedTrades}
                    leverage={activeConversation?.leverage || 100}
                    onClose={() => setSimulatorCandidate(null)}
                />
            )}
            <SettingsMenu
                isVisible={isSettingsMenuVisible}
                onClose={() => setIsSettingsMenuVisible(false)}
                isLoading={isLoading}
                onOpenSavedAnalyses={() => { setIsSavedAnalysesVisible(true); setIsSettingsMenuVisible(false); }}
                onOpenStrategySearch={() => { setIsStrategySearchVisible(true); setIsSettingsMenuVisible(false); }}
                onSwitchUser={handleSwitchUser}
                onExportData={handleExportData}
                isAccuracyModeEnabled={isAccuracyModeEnabled}
                onToggleAccuracyMode={handleToggleAccuracyMode}
                accuracySubMode={accuracySubMode}
                setAccuracySubMode={setAccuracySubMode}
                isHybridIntelligenceEnabled={isHybridIntelligenceEnabled}
                setIsHybridIntelligenceEnabled={setIsHybridIntelligenceEnabled}
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
            />
            <VisionDataViewer isVisible={isVisionDataVisible} onClose={() => setIsVisionDataVisible(false)} visionData={currentVisionData} />


            <Header
                activeUsername={activeUsername}
                saveStatus={saveStatus}
                isAnalysisInProgress={isAnalysisInProgress}
                isPostMortemInProgress={isPostMortemInProgress}
                currentVisionData={currentVisionData}
                isFullscreen={isFullscreen}
                onOpenVersionHistory={() => setIsVersionHistoryVisible(true)}
                isMobileMenuOpen={isMobileMenuOpen}
                mobileMenuRef={mobileMenuRef}
                setIsMobileMenuOpen={setIsMobileMenuOpen}
                setIsVisionDataVisible={setIsVisionDataVisible}
                handleClearChat={handleClearChat}
                setJournalState={setJournalState}
                setIsHistoryVisible={setIsHistoryVisible}
                handleToggleFullscreen={handleToggleFullscreen}
                setIsSettingsVisible={setIsSettingsMenuVisible}
                setIsLiveAnalysisVisible={setIsLiveAnalysisVisible}
                setIsLivePostMortemVisible={setIsLivePostMortemVisible}
                isLoading={isLoading}
                isRateLimited={isRateLimited}
                onOpenLiveMarket={() => setIsLiveMarketVisible(true)}
                isOnline={isOnline}
                pendingQueueCount={pendingQueueCount}
                liveMarketConditions={liveMarketConditions}
            />

            <Journal
                isVisible={journalState.isOpen}
                onClose={() => setJournalState(prev => ({ ...prev, isOpen: false }))}
                initialTab={journalState.tab}
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
                geminiModels={GEMINI_MODELS}
                deepseekModels={DEEPSEEK_MODELS}
                zhipuModels={ZHIPU_MODELS}
                groqModels={GROQ_MODELS}
                groqNewModels={GROQ_NEW_MODELS}
                groqAlt2Models={GROQ_ALT2_MODELS}

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

            <ConversationHistory conversations={conversationHistory} activeConversationId={activeConversationId} isVisible={isHistoryVisible} onClose={() => setIsHistoryVisible(false)} onLoadConversation={handleLoadConversation} onDelete={handleDeleteConversations} onClearAll={handleClearAllConversations} onStartNew={handleStartNewConversation} />

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

            {/* Mistake Warning Banner - Global Risk Reminder */}
            {loggedTrades.length > 0 && (
                <React.Suspense fallback={null}>
                <MistakeWarningBanner
                    tradeLog={loggedTrades}
                />
                </React.Suspense>
            )}

            {/* P2-12: First-run onboarding card. Shows when no API keys are
                configured and the user hasn't dismissed it. */}
            <OnboardingCard
                hasAnyApiKey={hasAnyApiKey}
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
                setIsLiveAnalysisVisible={setIsLiveAnalysisVisible}
                setIsLivePostMortemVisible={setIsLivePostMortemVisible}
                handleCancelAnalysis={handleCancelAnalysis}
                onDeleteMessages={handleDeleteMessages}
                // ChatInput props
                lensConfig={lensConfig}
                setLensConfig={handleSetLensConfig}
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
                providers={readyProviders}
                onToggleProvider={handleToggleProviderConfig}


                selectedVisionModel={selectedOcrModel}
                setSelectedVisionModel={handleSetVisionModel}
                hybridData={currentHybridData}
                isHybridLoading={isHybridLoading}
                hybridConnectionStatus={hybridConnectionStatus}
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
        </div>
        </React.Suspense>
    );
};

export default App;



