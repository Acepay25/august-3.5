
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { VirtuosoHandle } from 'react-virtuoso';
import { Message, MessageRole, TradeOutcome, ImageMetadata, AIProvider, Conversation, UserProfile, SavedAnalysis, TradeSummary, GlobalMemory, AccuracySubMode, CustomInstructionsMap, AnalystLensConfig } from './types';
import * as geminiService from './services/providers/geminiService';
import * as deepseekService from './services/providers/deepseekService';
import * as zhipuService from './services/providers/zhipuService';
import * as groqService from './services/providers/groqService';
import * as groqNewService from './services/providers/groqNewService';
import * as ensembleService from './services/providers/ensembleService';
import * as dbService from './services/infrastructure/dbService';
import { ProbabilityEngineService } from './services/analysis/ProbabilityEngineService';


// Modular Imports
import { ChatContextProps } from './components/chat/MessageItem';
import { useToastActions } from './components/shared/Toast';
import { Header } from './components/shared/Header';
import { ChatArea } from './components/chat/ChatArea';
import { Journal } from './components/journal/Journal';
import StrategySearch from './components/shared/StrategySearch';
import ConversationHistory from './components/chat/ConversationHistory';
import UserProfileManager from './components/settings/UserProfileManager';
import SavedAnalyses from './components/journal/SavedAnalyses';
import SettingsMenu from './components/settings/SettingsMenu';
import { useProviderConfigs } from './hooks/useProviderConfigs';
import LiveStreamView from './components/analysis/LiveStreamView';
import { LogTradeModal } from './components/journal/LogTradeModal';
import { PostTradeUploadModal, PostMortemCandidate } from './components/modals/PostTradeUploadModal';
import { SkipTradeModal } from './components/modals/SkipTradeModal';
import { DataCaptureModal } from './components/modals/DataCaptureModal';
import { EntryNotHitCaptureModal } from './components/modals/EntryNotHitCaptureModal';
import OutcomeMismatchModal from './components/modals/OutcomeMismatchModal';
// import ScenarioSimulatorModal from './components/ScenarioSimulatorModal'; // Not created yet
import { UpdateTradeModal } from './components/journal/UpdateTradeModal';
import VisionDataViewer from './components/analysis/VisionDataViewer';
import LiveMarket from './components/market/LiveMarket';
import { AccuracyModeModal } from './components/modals/AccuracyModeModal';
import HybridDataPanel from './components/analysis/HybridDataPanel';
import AdvancedAnalyticsSidePanel from './components/dashboards/AdvancedAnalyticsSidePanel';
import ScenarioSimulator from './components/modals/ScenarioSimulator';
import UpdateNotification from './components/shared/UpdateNotification';
import MistakeWarningBanner from './components/shared/MistakeWarningBanner';
import AnalysisProgress from './components/analysis/AnalysisProgress';
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
import { offlineQueue, QueuedRequest } from './services/infrastructure/OfflineQueueService';
// AI Learning Services - Adaptive Learning, Mistake Patterns, Insight Extraction
import { extractInsightsFromPostMortem, storeInsights, initializeKnowledgeBase } from './services/learning/InsightExtractionService';
import * as MemoryService from './services/learning/MemoryService';
import { MemoryProvider, MEMORY_PROVIDER_OPTIONS, MEMORY_MODELS, getDefaultModelForProvider } from './services/learning/MemoryService';
import { syncFromTradeLog, syncRollingWindowFromTradeLog, initModelPerformanceService } from './services/backtesting/ModelPerformanceService';
import { loadLensConfig, saveLensConfig, getDefaultLensAssignments, initAnalystLensService } from './services/ui/AnalystLensService';
import { detectTradingStyle, getEffectiveStyle, generateMasterPromptStyleInjection } from './services/ui/TradingStyleDetector';
import { checkDataIntegrity, createStartupBackup, updateTradeCount, logIntegrityEvent, runMigrations } from './services/validation/DataIntegrityService';
import { initInvalidationRuleService, loadInvalidationRules } from './services/validation/InvalidationRuleService';
import { PriceAlertService } from './services/ui/PriceAlertService';
import { initConfluenceService } from './services/analysis/TimeframeConfluenceService';
import { initPatternMemoryService } from './services/learning/PatternMemorySynthesisService';
import GlobalLearningService from './services/learning/GlobalLearningService';
import { VersionHistoryDashboard } from './components/dashboards/VersionHistoryDashboard';

const App: React.FC = () => {
    const toast = useToastActions();

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
        selectedGeminiModel, selectedDeepSeekModel, selectedZhipuModel,
        selectedGroqModel, selectedGroqNewModel, selectedGroqAlt2Model,
        selectedOpenrouterModel, selectedOcrModel, selectedOpenaiModel, selectedGrokNativeModel,
        isGeminiEnabled, isDeepSeekEnabled, isZhipuEnabled,
        isGroqEnabled, isGroqNewEnabled, isGroqAlt2Enabled,
        isOpenrouterEnabled, isOpenaiEnabled, isGrokNativeEnabled,
        moderatorProvider, moderatorModel,
        handleSetIsGeminiEnabled, handleSetIsDeepSeekEnabled, handleSetIsZhipuEnabled,
        handleSetIsGroqEnabled, handleSetIsGroqNewEnabled, handleSetIsGroqAlt2Enabled,
        handleSetIsOpenrouterEnabled, handleSetIsOpenaiEnabled, handleSetIsGrokNativeEnabled,
        handleSetVisionModel,
        handleSetSelectedGeminiModel, handleSetSelectedDeepSeekModel, handleSetSelectedZhipuModel,
        handleSetSelectedGroqModel, handleSetSelectedGroqNewModel, handleSetSelectedGroqAlt2Model,
        handleSetSelectedOpenrouterModel, handleSetSelectedOcrModel,
        handleSetSelectedOpenaiModel, handleSetSelectedGrokNativeModel,
        handleToggleProvider, handleSetModeratorProvider, handleSetModeratorModel,
    } = useConversations();

    // UI and other state

    // Layer 3: Global Long-Term Memory
    const [globalMemory, setGlobalMemory] = useState<GlobalMemory | undefined>(undefined);

    // Memory Provider Selection (for compressChatHistory and updateGlobalMemory)
    const [memoryProvider, setMemoryProvider] = useState<MemoryProvider>('gemini');
    const [memoryModel, setMemoryModel] = useState<string>('gemini-2.5-flash');
    const [isGlobalMemoryEnabled, setIsGlobalMemoryEnabled] = useState<boolean>(true);

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
        moderatorProvider,
        moderatorModel,
        memoryModel,
        memoryProvider,
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
        selectedGeminiModel, selectedDeepSeekModel, selectedZhipuModel,
        selectedGroqModel, selectedGroqNewModel, selectedGroqAlt2Model,
        selectedOpenrouterModel, selectedOpenaiModel, selectedGrokNativeModel,
        selectedOcrModel,
        isGeminiEnabled, isDeepSeekEnabled, isZhipuEnabled,
        isGroqEnabled, isGroqNewEnabled, isGroqAlt2Enabled,
        isOpenrouterEnabled, isOpenaiEnabled, isGrokNativeEnabled,
        moderatorProvider, moderatorModel,
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
        updateMessages,
        isAccuracyModeEnabled,
        accuracySubMode,
        isGeminiEnabled,
        isDeepSeekEnabled,
        isZhipuEnabled,
        isGroqEnabled,
        isGroqNewEnabled,
        isGroqAlt2Enabled,
        isOpenrouterEnabled,
        isOpenaiEnabled,
        isGrokNativeEnabled,
        selectedGeminiModel,
        selectedDeepSeekModel,
        selectedZhipuModel,
        selectedGroqModel,
        selectedGroqNewModel,
        selectedGroqAlt2Model,
        selectedOpenrouterModel,
        selectedOpenaiModel,
        selectedGrokNativeModel,
        moderatorProvider,
        moderatorModel,
        finalTradeSummary,
        loggedTrades,
        setLoggedTrades,
        globalMemory,
        setGlobalMemory,
        memoryModel,
        memoryProvider,
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
    const isAnyProviderEnabled = isGeminiEnabled || isDeepSeekEnabled || isZhipuEnabled || isGroqEnabled || isGroqNewEnabled || isGroqAlt2Enabled || isOpenrouterEnabled || isOpenaiEnabled || isGrokNativeEnabled || isAccuracyModeEnabled;

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

    const loadUserData = async (username: string) => {
        setIsLoading(true);

        // Initialize database (SQLite on native, IndexedDB on web)
        await dbService.initDatabase();
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
            setMemoryProvider((profile.settings?.memoryProvider as any) || 'gemini');
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

    useEffect(() => {
        if (!activeUsername) return;

        setSaveStatus('SAVING');

        const handler = setTimeout(async () => {
            try {
                const profileData: Partial<Omit<UserProfile, 'username'>> = {
                    conversations: conversationHistory,
                    tradeLog: loggedTrades,
                    savedAnalyses: savedAnalyses,
                    tradeSummaries: tradeSummaries,
                    finalTradeSummary: finalTradeSummary,
                    globalMemory: globalMemory,
                    settings: { activeFrameworks, summaryCharLimit, summarizationProvider, summarizationModel, isGlobalMemoryEnabled, isAccuracyModeEnabled, accuracySubMode, customInstructions, isPlaybookEnabledInPureAI, isFamiliesEnabledInPureAI, isMemoryEnabledInPureAI, isHybridIntelligenceEnabled, confidenceCalibration, memoryProvider, memoryModel },
                    lastActiveConversationId: activeConversationId || undefined,
                    // AI Learning data
                    insightKnowledgeBase: insightKnowledgeBase,
                };
                await dbService.saveUserProfile(activeUsername, profileData);
                setSaveStatus('SAVED');
            } catch (err) {
                console.error("Failed to save user profile:", err);
                setSaveStatus('ERROR');
            }
        }, 1500);

        return () => {
            clearTimeout(handler);
        };
    }, [conversationHistory, loggedTrades, activeFrameworks, activeUsername, activeConversationId, savedAnalyses, tradeSummaries, finalTradeSummary, globalMemory, summaryCharLimit, summarizationProvider, summarizationModel, isGlobalMemoryEnabled, isAccuracyModeEnabled, accuracySubMode, customInstructions, isPlaybookEnabledInPureAI, isFamiliesEnabledInPureAI, isMemoryEnabledInPureAI, isHybridIntelligenceEnabled, confidenceCalibration, insightKnowledgeBase, memoryProvider, memoryModel]);

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
                isGeminiEnabled: true,
                isDeepSeekEnabled: true,
                isZhipuEnabled: false, // Ensure Zhipu is Disabled
                isGroqEnabled: true,
                isGroqNewEnabled: false,
                geminiModel: ACCURACY_MODE_DEFAULTS.GEMINI,
                deepseekModel: ACCURACY_MODE_DEFAULTS.DEEPSEEK,
                zhipuModel: ACCURACY_MODE_DEFAULTS.ZHIPU,
                groqModel: ACCURACY_MODE_DEFAULTS.GROQ,
                groqNewModel: GROQ_NEW_MODELS[0].id,
                moderatorProvider: ACCURACY_MODE_DEFAULTS.MODERATOR_PROVIDER,
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

    const handleClearAllTrades = () => {
        if (confirm('Delete all trade history?')) {
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
                const summary = await MemoryService.summarizeTrade(trade, memoryModel, memoryProvider, useAlgorithmicInsights);
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
                    // Convert AIProvider enum to MemoryProvider string
                    const providerMap: Record<string, MemoryProvider> = {
                        'gemini': 'gemini',
                        'deepseek': 'deepseek',
                        'groq': 'groq',
                        'groq_new': 'groq', // Map groq_new to groq
                        'groq_alt2': 'groq-alt2', // Note: AIProvider uses underscore, MemoryProvider uses hyphen
                        'zhipu': 'zhipu',
                        'openrouter': 'openrouter',
                        'openai': 'openai',
                        'grok': 'grok-native', // AIProvider.GROK maps to MemoryProvider 'grok-native'
                    };
                    const provider = providerMap[summarizationProvider] || 'gemini';
                    console.log(`[AIRewrite] Calling MemoryService.summarizeTrade with provider: ${provider} (from UI: ${summarizationProvider}), model: ${summarizationModel}, useAlgorithmic: false`);
                    // Force AI mode (false = use AI, not algo)
                    const summary = await MemoryService.summarizeTrade(trade, summarizationModel, provider, false);
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
                // Use AI generation (Slower, Tokens)
                switch (summarizationProvider) {
                    case AIProvider.DEEPSEEK:
                        summary = await deepseekService.generateFinalSummary(tradeSummaries, summarizationModel, summaryCharLimit);
                        break;
                    case AIProvider.ZHIPU:
                        summary = await zhipuService.generateFinalSummary(tradeSummaries, summarizationModel, summaryCharLimit);
                        break;
                    case AIProvider.GROQ:
                        summary = await groqService.generateFinalSummary(tradeSummaries, summarizationModel, summaryCharLimit);
                        break;
                    case AIProvider.GROQ_NEW:
                        summary = await groqNewService.generateFinalSummary(tradeSummaries, summarizationModel, summaryCharLimit);
                        break;
                    case AIProvider.GEMINI:
                    default:
                        summary = await geminiService.generateFinalSummary(tradeSummaries, summarizationModel, summaryCharLimit);
                        break;
                }
            }

            setFinalTradeSummary(summary);
        } catch (e) {
            console.error("Summary regeneration failed", e);
        } finally {
            setIsSummaryInProgress(false);
        }
    };

    const handleClearAllConversations = () => {
        if (confirm('Clear all conversation history?')) {
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
            newConv.geminiModel = activeConversation.geminiModel;
            newConv.deepseekModel = activeConversation.deepseekModel;
            newConv.zhipuModel = activeConversation.zhipuModel;
            newConv.groqModel = activeConversation.groqModel;
            newConv.groqNewModel = activeConversation.groqNewModel;
            newConv.ocrModel = activeConversation.ocrModel;
            newConv.isGeminiEnabled = activeConversation.isGeminiEnabled;
            newConv.isDeepSeekEnabled = activeConversation.isDeepSeekEnabled;
            newConv.isZhipuEnabled = activeConversation.isZhipuEnabled;
            newConv.isGroqEnabled = activeConversation.isGroqEnabled;
            newConv.isGroqNewEnabled = activeConversation.isGroqNewEnabled;
            newConv.moderatorProvider = activeConversation.moderatorProvider;
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

    const handleClearAllSavedAnalyses = () => {
        if (confirm('Clear all saved analyses?')) {
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
            processImagesForSummarization(filesToProcess, images.length, selectedOcrModel, setImages, handleQuotaExceeded);
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
                geminiModelUsed: msg.geminiModelUsed,
                deepseekModelUsed: msg.deepseekModelUsed,
                zhipuModelUsed: msg.zhipuModelUsed,
                groqModelUsed: msg.groqModelUsed,
                groqNewModelUsed: msg.groqNewModelUsed,
                groqAlt2ModelUsed: msg.groqAlt2ModelUsed,

                ocrModelUsed: msg.ocrModelUsed,
                moderatorProvider,
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
                moderatorProvider,
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
        // ... (JSX Return)
        <div ref={appRef} className="flex flex-col bg-zinc-950 text-zinc-100 font-sans h-full overflow-hidden transition-colors duration-500">
            {isVersionHistoryVisible && (
                <VersionHistoryDashboard onClose={() => setIsVersionHistoryVisible(false)} />
            )}

            {/* SW Update Notification */}
            {showUpdateNotification && (
                <UpdateNotification
                    onRefresh={() => {
                        activateWaitingWorker();
                    }}
                    onDismiss={() => setShowUpdateNotification(false)}
                />
            )}
            <LiveStreamView
                variant="analysis"
                isVisible={isLiveAnalysisVisible}
                onClose={() => setIsLiveAnalysisVisible(false)}
                thoughts={liveThoughts}
                geminiModelName={isGeminiEnabled ? modelIdToName[selectedGeminiModel] : undefined}
                deepseekModelName={isDeepSeekEnabled ? modelIdToName[selectedDeepSeekModel] : undefined}
                zhipuModelName={isAccuracyModeEnabled ? undefined : (isZhipuEnabled ? modelIdToName[selectedZhipuModel] : undefined)}
                groqModelName={isGroqEnabled ? modelIdToName[selectedGroqModel] : undefined}
                groqNewModelName={isGroqNewEnabled ? modelIdToName[selectedGroqNewModel] : undefined}
                groqAlt2ModelName={isGroqAlt2Enabled ? modelIdToName[selectedGroqAlt2Model] : undefined}
                openrouterModelName={isOpenrouterEnabled ? modelIdToName[selectedOpenrouterModel] || selectedOpenrouterModel : undefined}
                onAllTypingComplete={handleAllAnalysisTypingComplete}
            />
            <LiveStreamView
                variant="postmortem"
                isVisible={isLivePostMortemVisible}
                onClose={() => setIsLivePostMortemVisible(false)}
                thoughts={livePostMortemThoughts}
                geminiModelName={isGeminiEnabled ? modelIdToName[selectedGeminiModel] : undefined}
                deepseekModelName={isDeepSeekEnabled ? modelIdToName[selectedDeepSeekModel] : undefined}
                zhipuModelName={isAccuracyModeEnabled ? undefined : (isZhipuEnabled ? modelIdToName[selectedZhipuModel] : undefined)}
                groqModelName={isGroqEnabled ? modelIdToName[selectedGroqModel] : undefined}
                groqNewModelName={isGroqNewEnabled ? modelIdToName[selectedGroqNewModel] : undefined}
                groqAlt2ModelName={isGroqAlt2Enabled ? modelIdToName[selectedGroqAlt2Model] : undefined}
                openrouterModelName={isOpenrouterEnabled ? modelIdToName[selectedOpenrouterModel] || selectedOpenrouterModel : undefined}
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
            {postMortemCandidate && <PostTradeUploadModal candidate={postMortemCandidate} onClose={() => setPostMortemCandidate(null)} onAnalyze={(summaries, urls) => startPostMortemAnalysis(postMortemCandidate, summaries, urls)} ocrModel={isAccuracyModeEnabled ? selectedOcrModel : (postMortemCandidate.message.ocrModelUsed?.split(',')[0].trim() || selectedOcrModel)} onQuotaExceeded={handleQuotaExceeded} />}
            {updateCandidate && <UpdateTradeModal message={updateCandidate} onClose={() => setUpdateCandidate(null)} onConfirm={handleConfirmUpdateTrade} onAutoCapture={handleUpdateAutoCapture} isCapturing={isUpdateAutoCapturing} ocrModel={isAccuracyModeEnabled ? selectedOcrModel : (updateCandidate.ocrModelUsed?.split(',')[0].trim() || selectedOcrModel)} onQuotaExceeded={handleQuotaExceeded} />}
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
                memoryProvider={memoryProvider}
                setMemoryProvider={setMemoryProvider}
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
                geminiModels={GEMINI_MODELS}
                deepseekModels={DEEPSEEK_MODELS}
                zhipuModels={ZHIPU_MODELS}
                groqModels={GROQ_MODELS}
                groqNewModels={GROQ_NEW_MODELS}
                groqAlt2Models={GROQ_ALT2_MODELS}
                openrouterModels={OPENROUTER_MODELS}
                openaiModels={OPENAI_MODELS}
                grokNativeModels={GROK_MODELS}

                selectedGeminiModel={selectedGeminiModel}
                selectedDeepSeekModel={selectedDeepSeekModel}
                selectedZhipuModel={selectedZhipuModel}
                selectedGroqModel={selectedGroqModel}
                selectedGroqNewModel={selectedGroqNewModel}
                selectedGroqAlt2Model={selectedGroqAlt2Model}
                selectedOpenrouterModel={selectedOpenrouterModel}
                selectedOpenaiModel={selectedOpenaiModel}
                selectedGrokNativeModel={selectedGrokNativeModel}

                onSetGeminiModel={handleSetSelectedGeminiModel}
                onSetDeepseekModel={handleSetSelectedDeepSeekModel}
                onSetZhipuModel={handleSetSelectedZhipuModel}
                onSetGroqModel={handleSetSelectedGroqModel}
                onSetGroqNewModel={handleSetSelectedGroqNewModel}
                onSetGroqAlt2Model={handleSetSelectedGroqAlt2Model}
                onSetOpenrouterModel={handleSetSelectedOpenrouterModel}
                onSetOpenaiModel={handleSetSelectedOpenaiModel}
                onSetGrokNativeModel={handleSetSelectedGrokNativeModel}

                isGeminiEnabled={isGeminiEnabled}
                isDeepSeekEnabled={isDeepSeekEnabled}
                isZhipuEnabled={isZhipuEnabled}
                isGroqEnabled={isGroqEnabled}
                isGroqNewEnabled={isGroqNewEnabled}
                isGroqAlt2Enabled={isGroqAlt2Enabled}
                isOpenrouterEnabled={isOpenrouterEnabled}
                isOpenaiEnabled={isOpenaiEnabled}
                isGrokNativeEnabled={isGrokNativeEnabled}

                onToggleProvider={handleToggleProvider}
                ocrModels={OCR_MODELS}
                selectedOcrModel={selectedOcrModel}
                onSetOcrModel={handleSetSelectedOcrModel}
                moderatorProvider={moderatorProvider}
                moderatorModel={moderatorModel}
                onSetModeratorProvider={handleSetModeratorProvider}
                onSetModeratorModel={handleSetModeratorModel}
                providerConfigs={providerConfigs}
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
                enabledProviders={[
                    ...(isGeminiEnabled ? [AIProvider.GEMINI] : []),
                    ...(isDeepSeekEnabled ? [AIProvider.DEEPSEEK] : []),
                    ...(isZhipuEnabled ? [AIProvider.ZHIPU] : []),
                    ...(isGroqEnabled ? [AIProvider.GROQ] : []),
                    ...(isGroqNewEnabled ? [AIProvider.GROQ_NEW] : []),
                    ...(isGroqAlt2Enabled ? [AIProvider.GROQ_ALT2] : []),

                    ...(isOpenrouterEnabled ? [AIProvider.OPENROUTER] : []),
                ]}
                selectedModels={{
                    [AIProvider.GEMINI]: modelIdToName[selectedGeminiModel] || selectedGeminiModel,
                    [AIProvider.DEEPSEEK]: modelIdToName[selectedDeepSeekModel] || selectedDeepSeekModel,
                    [AIProvider.ZHIPU]: modelIdToName[selectedZhipuModel] || selectedZhipuModel,
                    [AIProvider.GROQ]: modelIdToName[selectedGroqModel] || selectedGroqModel,
                    [AIProvider.GROQ_NEW]: modelIdToName[selectedGroqNewModel] || selectedGroqNewModel,
                    [AIProvider.GROQ_ALT2]: modelIdToName[selectedGroqAlt2Model] || selectedGroqAlt2Model,

                    [AIProvider.OPENROUTER]: modelIdToName[selectedOpenrouterModel] || selectedOpenrouterModel,
                }}
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

            <StrategySearch isVisible={isStrategySearchVisible} onClose={() => { setIsStrategySearchVisible(false); setStrategyToView(null); }} onApplyStrategy={handleApplyStrategy} onRemoveStrategy={handleRemoveStrategy} geminiModel={selectedGeminiModel} activeFrameworks={activeFrameworks} defaultFrameworks={DEFAULT_FRAMEWORKS} initialViewStrategy={strategyToView} onQuotaExceeded={handleQuotaExceeded} familyWinRates={familyWinRates} />
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
                enabledProviders={[
                    ...(isGeminiEnabled ? [AIProvider.GEMINI] : []),
                    ...(isDeepSeekEnabled ? [AIProvider.DEEPSEEK] : []),
                    ...(isZhipuEnabled ? [AIProvider.ZHIPU] : []),
                    ...(isGroqEnabled ? [AIProvider.GROQ] : []),
                    ...(isGroqNewEnabled ? [AIProvider.GROQ_NEW] : []),
                    ...(isGroqAlt2Enabled ? [AIProvider.GROQ_ALT2] : []),

                    ...(isOpenrouterEnabled ? [AIProvider.OPENROUTER] : []),
                ]}
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
                <MistakeWarningBanner
                    tradeLog={loggedTrades}
                />
            )}

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
                isGeminiEnabled={isGeminiEnabled}
                setIsGeminiEnabled={handleSetIsGeminiEnabled}
                isDeepSeekEnabled={isDeepSeekEnabled}
                setIsDeepSeekEnabled={handleSetIsDeepSeekEnabled}
                isZhipuEnabled={isZhipuEnabled}
                setIsZhipuEnabled={handleSetIsZhipuEnabled}
                isGroqEnabled={isGroqEnabled}
                setIsGroqEnabled={handleSetIsGroqEnabled}
                isGroqNewEnabled={isGroqNewEnabled}
                setIsGroqNewEnabled={handleSetIsGroqNewEnabled}
                isGroqAlt2Enabled={isGroqAlt2Enabled}
                setIsGroqAlt2Enabled={handleSetIsGroqAlt2Enabled}
                isOpenrouterEnabled={isOpenrouterEnabled}
                setIsOpenrouterEnabled={handleSetIsOpenrouterEnabled}
                isOpenaiEnabled={isOpenaiEnabled}
                setIsOpenaiEnabled={handleSetIsOpenaiEnabled}
                isGrokNativeEnabled={isGrokNativeEnabled}
                setIsGrokNativeEnabled={handleSetIsGrokNativeEnabled}


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
    );
};

export default App;



