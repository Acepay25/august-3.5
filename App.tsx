
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { VirtuosoHandle } from 'react-virtuoso';
import { Message, MessageRole, TradeOutcome, ImageMetadata, AIProvider, UserProfile, SavedAnalysis, TradeSummary, CustomInstructionsMap, AnalystLensConfig, LoggedTrade, SetupWatch, SetupWatchTriggerEvent } from './types';
import * as ensembleService from './services/providers/ensembleService';
import { generateFinalSummary } from './services/providers/GenericAnalysisService';
import * as dbService from './services/infrastructure/dbService';
import { initPromptOverrides } from './services/infrastructure/PromptOverrideService';
import { initStrategyDocs } from './services/infrastructure/StrategyService';
import { initMemoryFiles, syncPatternMemory, syncProfileMemory, syncRecurringMistakes, subscribeMemoryFilesChanged } from './services/learning/MemoryFilesService';
import { runNotebookReview } from './services/learning/MemoryReviewService';
import { computeRegimeProviderStats } from './services/learning/SetupMemoryService';
import { ANALYST_ROLE_DEFINITIONS } from './services/ui/AnalystLensService';
import { AnalystRole } from './types/enums';
import { BotRegistry } from './services/bots/BotRegistry';
import { defaultToolsForRole } from './types/bot';
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
import { useAutomations } from './hooks/useAutomations';
import { useCompareRuns } from './hooks/useCompareRuns';
import { useConversationLeverage } from './hooks/useConversationLeverage';
import { useCatalogReconcile } from './hooks/useCatalogReconcile';
import AutomationView from './components/automation/AutomationView';
import AutomationEditorModal, { ModelOption } from './components/automation/AutomationEditorModal';
import { ChevronLeftIcon, ChevronRightIcon } from './components/shared/Icons';
import BotManagerDrawer from './components/bots/BotManagerDrawer';

// P1-6: Lazy-load heavy, conditionally-rendered components so the initial
// bundle is much smaller. Previously the entire app was one ~1.73 MB chunk.
// Each lazy() call below produces a separate chunk loaded on demand when
// the user opens the corresponding panel/modal. ChatArea and Header stay
// eager (always-rendered, critical path).
const StrategySearch = React.lazy(() => import('./components/shared/StrategySearch'));
const UserProfileManager = React.lazy(() => import('./components/settings/UserProfileManager'));
const SavedAnalyses = React.lazy(() => import('./components/journal/SavedAnalyses'));
const WatchListPanel = React.lazy(() => import('./components/analysis/WatchListPanel'));
const ApprovalInbox = React.lazy(() => import('./components/analysis/ApprovalInbox'));
const SettingsMenu = React.lazy(() => import('./components/settings/SettingsMenu'));
const LiveStreamView = React.lazy(() => import('./components/analysis/LiveStreamView'));
// (LogTradeModal was removed — the capture flow uses DataCaptureModal.)
const PostTradeUploadModal = React.lazy(() => import('./components/modals/PostTradeUploadModal').then(m => ({ default: m.PostTradeUploadModal })));
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
import AnalysisProgress from './components/analysis/AnalysisProgress';
import { DEFAULT_FRAMEWORKS } from './constants/models';
import { buildModelIdToName, buildProviderNameToId, getFirstReadyProvider } from './utils/providerUtils';
import { createNewConversation, DEFAULT_LEVERAGE, findReusableEmptyConversation } from './utils/conversationUtils';
import { recalculateAnalysisMetrics } from './utils/analysisUtils';
import { parseAppHash, serializeAppHash } from './utils/appHash';
import { collectWatchedSignals, toggleWatchOnMessage } from './utils/watchList';
import { collectApprovalItems, setAutoJournalRule } from './utils/approvalInbox';
import { takeSkillDraft } from './utils/skillDrafts';
import { ingestCraftedSkill, ingestCraftedSkillFromDraft } from './services/learning/SkillMemoryService';
import { buildRiskBook, formatRiskBookBadge } from './utils/riskBook';
import { reconstructOpenings } from './utils/debateResume';
import { processImagesForSummarization } from './utils/imageProcessor';
import { extractLastJson } from './utils/jsonUtils';
import { parseLevelProbabilities } from './schemas/tradeAnalysis';
import useNetworkStatus from './hooks/useNetworkStatus';
import { useUIState } from './hooks/useUIState';
import { useConversations } from './hooks/useConversations';
import { useMarketData } from './hooks/useMarketData';
import { useTradeLogging, MAX_TRADE_SUMMARIES } from './hooks/useTradeLogging';
import { useAnalysisPipeline } from './hooks/useAnalysisPipeline';
import { usePostMortem } from './hooks/usePostMortem';
import { useUserProfiles } from './hooks/useUserProfiles';
import { useSaveOnUnload } from './hooks/useSaveOnUnload';
import { offlineQueue } from './services/infrastructure/OfflineQueueService';
import { jobQueue, JobType } from './services/infrastructure/JobQueueService';
import { getPreference, setPreference, removePreference, getPreferenceObject, PREF_KEYS } from './services/infrastructure/PreferencesService';
// AI Learning Services - Adaptive Learning, Mistake Patterns, Insight Extraction
import { storeInsights } from './services/learning/InsightExtractionService';
import * as MemoryService from './services/learning/MemoryService';
import { insightTextForTrade } from './utils/tradeInsightBrief';
import { ProviderConfig } from './types/provider';
import { syncFromTradeLog, syncRollingWindowFromTradeLog, initModelPerformanceService } from './services/backtesting/ModelPerformanceService';
import { saveLensConfig, initAnalystLensService, loadLensConfig, saveEnsembleModelSelection, loadLastModeratorPick, saveLastModeratorPick, EnsembleModelSelection, saveCustomEnsemblePrompt, saveCustomLensPrompts } from './services/ui/AnalystLensService';
import { checkDataIntegrity, createStartupBackup, logIntegrityEvent, runMigrations } from './services/validation/DataIntegrityService';
import { startAutoBackup, stopAutoBackup, createBackup } from './services/infrastructure/BackupService';
import { storageService } from './services/infrastructure/StorageService';
import { initInvalidationRuleService } from './services/validation/InvalidationRuleService';
import { PriceAlertService } from './services/ui/PriceAlertService';
import { SetupWatchService, describeWatchTrigger } from './services/ui/SetupWatchService';
import { OutcomeAutopilotService, AutopilotResolution } from './services/ui/OutcomeAutopilotService';
import { useWatchSideEffects } from './hooks/useWatchSideEffects';
import { getThinkingTradeId, updateThinkingOutcome, deleteThinkingByTrade } from './services/infrastructure/ThinkingStoreService';
import { removeRulesForTrades } from './services/learning/LearningRulesService';
import { initNativeStatusBar } from './services/infrastructure/NativeStatusBar';
import { initConfluenceService, syncConfluenceFromTradeLog } from './services/analysis/TimeframeConfluenceService';
import { initPatternMemoryService, setAttributedInsightsUser } from './services/learning/PatternMemorySynthesisService';
import GlobalLearningService from './services/learning/GlobalLearningService';
const VersionHistoryDashboard = React.lazy(() => import('./components/dashboards/VersionHistoryDashboard').then(m => ({ default: m.VersionHistoryDashboard })));

/**
 * Rebuilds a File from a data URL so persisted chart images can be
 * re-dispatched through the vision pipeline (F4 re-run).
 */
const dataUrlToFile = (dataUrl: string, filename: string): File => {
    const commaIdx = dataUrl.indexOf(',');
    const meta = commaIdx >= 0 ? dataUrl.slice(0, commaIdx) : '';
    const mime = meta.match(/data:(.*?);/)?.[1] || 'image/png';
    const b64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
    const byteString = atob(b64);
    const bytes = new Uint8Array(byteString.length);
    for (let i = 0; i < byteString.length; i++) bytes[i] = byteString.charCodeAt(i);
    return new File([bytes], filename, { type: mime });
};

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
    const [isWatchListVisible, setIsWatchListVisible] = useState(false);
    const [isApprovalInboxVisible, setIsApprovalInboxVisible] = useState(false);
    const [isBotManagerVisible, setIsBotManagerVisible] = useState(false);
    const applyingHashRef = useRef(false);

    // Settings initial tab — set by handleOpenJournal to open Settings → Journal directly
    const [settingsInitialTab, setSettingsInitialTab] = useState<string | undefined>(undefined);

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
        handleSetModeratorProvider: setConversationModeratorProvider,
        handleSetModeratorModel: setConversationModeratorModel,
    } = useConversations();

    const handleSetModeratorProvider = useCallback((providerId: string) => {
        setConversationModeratorProvider(providerId);
        saveLastModeratorPick({ providerId, model: moderatorModel || '' });
    }, [setConversationModeratorProvider, moderatorModel]);

    const handleSetModeratorModel = useCallback((model: string) => {
        setConversationModeratorModel(model);
        if (moderatorProviderId) saveLastModeratorPick({ providerId: moderatorProviderId, model });
    }, [setConversationModeratorModel, moderatorProviderId]);

    // UI and other state

    // AI analysis settings (memory, accuracy, instructions, summarization, lens)
    const {
        globalMemory, setGlobalMemory,
        memoryConfig, setMemoryConfig,
        memoryModel, setMemoryModel,
        isGlobalMemoryEnabled, setIsGlobalMemoryEnabled,
        isStrategiesEnabled, setIsStrategiesEnabled,
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
        visionModel, setVisionModel,
        useAlgorithmicSummary, setUseAlgorithmicSummary,
        useAlgorithmicInsights, setUseAlgorithmicInsights,
    } = useAppSettings();

    // Derive the moderator ProviderConfig from readyProviders. When the user
    // never picked a moderator, prefer a provider that is NOT one of the
    // analyst providers — the old readyProviders[0] fallback often WAS an
    // analyst, so the moderator debated itself.
    const moderatorConfig: ProviderConfig = useMemo(() => {
        const selected = readyProviders.find(p => p.id === moderatorProviderId);
        if (selected) return selected;
        const analystIds = new Set(
            (lensConfig?.assignments ?? []).map(a => a.assignedProvider).filter(Boolean)
        );
        const nonAnalystModerator = readyProviders.find(p => !analystIds.has(p.id));
        if (nonAnalystModerator) {
            console.warn('[Moderator] No moderator selected — fell back to', nonAnalystModerator.name);
            return nonAnalystModerator;
        }
        return readyProviders[0] || {
            id: 'none', name: 'None', apiKey: '', baseUrl: '', apiFormat: 'chat_completions' as const,
            isEnabled: false, isBuiltIn: true, models: [], selectedModel: '',
        };
    }, [readyProviders, moderatorProviderId, lensConfig]);

    // ONE vision model for EVERY vision feature (chart OCR, post-trade
    // uploads, PDF book OCR). Resolution: the globally selected model
    // (Settings → AI setup → Vision Model) → the per-conversation OCR model
    // (legacy, saved conversations) → first ready provider → moderator.
    const visionConfig: ProviderConfig = useMemo(() => {
        if (visionModel) {
            const byGlobal = readyProviders.find(p => p.selectedModel === visionModel || p.models.includes(visionModel));
            if (byGlobal) return byGlobal;
        }
        if (selectedOcrModel) {
            const byConversation = readyProviders.find(p => p.selectedModel === selectedOcrModel || p.models.includes(selectedOcrModel));
            if (byConversation) return byConversation;
        }
        return readyProviders[0] || moderatorConfig;
    }, [readyProviders, visionModel, selectedOcrModel, moderatorConfig]);

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

    const memoryConfigRef = useRef(memoryConfig);
    memoryConfigRef.current = memoryConfig;
    const readyProvidersRef = useRef(readyProviders);
    readyProvidersRef.current = readyProviders;

    useEffect(() => {
        let timer: ReturnType<typeof setTimeout> | null = null;
        const unsubscribe = subscribeMemoryFilesChanged((username) => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => {
                const config = memoryConfigRef.current || readyProvidersRef.current[0] || null;
                void runNotebookReview(username, config).then((wrote) => {
                    if (wrote) {
                        toast.success('Memory reviewed', 'Open Suggestions in Settings → Memory.');
                    }
                }).catch((err) => {
                    console.warn('[MemoryReview] Notebook review failed:', err);
                });
            }, 4000);
        });
        return () => {
            unsubscribe();
            if (timer) clearTimeout(timer);
        };
    }, [toast]);
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
    // Persisted per-profile ensemble choice (loaded by loadUserData, possibly
    // after this effect fires on first mount — the ref bridges that race).
    const persistedEnsembleModeRef = useRef<boolean | null>(null);
    useEffect(() => {
        if (!ensembleInitializedRef.current && readyProviders.length > 0) {
            ensembleInitializedRef.current = true;
            // The saved mode wins; the derived provider count is only the
            // fallback for profiles that predate the setting.
            setIsEnsembleEnabled(persistedEnsembleModeRef.current ?? (ensembleModelCount > 1));
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

    useEffect(() => {
        const apply = (): void => {
            const route = parseAppHash(window.location.hash);
            applyingHashRef.current = true;
            if (route.view === 'journal') {
                setJournalState({ isOpen: true, tab: route.tab || 'log' });
                setIsSettingsMenuVisible(false);
                setIsLiveMarketVisible(false);
                setIsWatchListVisible(false);
            } else if (route.view === 'market') {
                setIsLiveMarketVisible(true);
                setJournalState(prev => ({ ...prev, isOpen: false }));
                setIsSettingsMenuVisible(false);
                setIsWatchListVisible(false);
            } else if (route.view === 'settings') {
                setIsSettingsMenuVisible(true);
                setJournalState(prev => ({ ...prev, isOpen: false }));
                setIsLiveMarketVisible(false);
                setIsWatchListVisible(false);
            } else if (route.view === 'watch') {
                setIsWatchListVisible(true);
                setJournalState(prev => ({ ...prev, isOpen: false }));
                setIsSettingsMenuVisible(false);
                setIsLiveMarketVisible(false);
            } else if (window.location.hash) {
                setJournalState(prev => ({ ...prev, isOpen: false }));
                setIsSettingsMenuVisible(false);
                setIsLiveMarketVisible(false);
                setIsWatchListVisible(false);
            }
            queueMicrotask(() => { applyingHashRef.current = false; });
        };
        apply();
        window.addEventListener('hashchange', apply);
        return () => window.removeEventListener('hashchange', apply);
    }, [setJournalState, setIsSettingsMenuVisible, setIsLiveMarketVisible, setIsWatchListVisible]);

    useEffect(() => {
        if (applyingHashRef.current) return;
        const route = journalState.isOpen
            ? { view: 'journal' as const, tab: journalState.tab }
            : isLiveMarketVisible
                ? { view: 'market' as const }
                : isSettingsMenuVisible
                    ? { view: 'settings' as const }
                    : isWatchListVisible || isApprovalInboxVisible
                        ? { view: 'watch' as const }
                        : { view: 'chat' as const };
        if (route.view === 'chat' && !window.location.hash) return;
        const next = serializeAppHash(route);
        if (window.location.hash !== next) {
            history.replaceState(null, '', next);
        }
    }, [journalState, isLiveMarketVisible, isSettingsMenuVisible, isWatchListVisible]);

    // Refs for functions defined later but needed by useTradeLogging (breaks circular dependency)
    const handleSendMessageRef = useRef<(...args: any[]) => any>(null!);
    const startPostMortemAnalysisRef = useRef<(...args: any[]) => any>(null!);
    const stableHandleSendMessage = useCallback((...args: any[]) => handleSendMessageRef.current(...args), []);
    const stableStartPostMortem = useCallback((...args: any[]) => startPostMortemAnalysisRef.current(...args), []);

    // ─── Journal auto-refresh ────────────────────────────────────────────
    // Every logged trade (WIN/LOSS/ENTRY_NOT_HIT) re-runs the AI Review
    // (Pattern Memory) automatically instead of waiting for the manual
    // "Regenerate" button. The handler is STABLE (useCallback + latest-ref)
    // so useTradeLogging's memoized callbacks don't re-arm on every App
    // render; the 1.2s debounce collapses rapid multi-trade logging into a
    // single regeneration.
    const journalAutoRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const regenerateFinalSummaryRef = useRef<() => void>(() => {});
    const handleJournalAutoRefresh = useCallback(() => {
        if (journalAutoRefreshTimerRef.current) clearTimeout(journalAutoRefreshTimerRef.current);
        journalAutoRefreshTimerRef.current = setTimeout(() => {
            journalAutoRefreshTimerRef.current = null;
            regenerateFinalSummaryRef.current();
        }, 1200);
    }, []);
    useEffect(() => () => {
        if (journalAutoRefreshTimerRef.current) clearTimeout(journalAutoRefreshTimerRef.current);
    }, []);

    // Trade logging state and handlers (extracted to hooks/useTradeLogging.ts)
    const {
        loggedTrades, setLoggedTrades,
        savedAnalyses, setSavedAnalyses,
        tradeSummaries, setTradeSummaries,
        finalTradeSummary, setFinalTradeSummary,
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
        messagesRef,
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
        onJournalAutoRefresh: handleJournalAutoRefresh,
    });

    const [leverageInput, setLeverageInput] = useState<string>(String(DEFAULT_LEVERAGE));
    const { handleLeverageChange, handleLeverageBlur, handlePresetLeverage } = useConversationLeverage({
        leverageInput,
        setLeverageInput,
        updateActiveConversation,
        setIsLeverageDropdownOpen,
    });
    // (i/n) progress for the manual insight-generation loops (App only shows
    // a boolean spinner otherwise; a 50-trade rewrite runs for minutes).
    const [insightProgress, setInsightProgress] = useState<{ done: number; total: number } | null>(null);
    const appRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const virtuosoRef = useRef<VirtuosoHandle>(null);
    const mobileMenuRef = useRef<HTMLDivElement>(null);
    const leverageRef = useRef<HTMLDivElement>(null);

    // Casual-chat model (used when ensemble is off): app-wide preference,
    // persisted in Preferences. Empty until loaded or chosen — the pipeline
    // falls back to the first ready provider's model.
    const [selectedChatModel, setSelectedChatModel] = useState(() => {
        try { return localStorage.getItem(PREF_KEYS.CASUAL_CHAT_MODEL) || ''; } catch { return ''; }
    });
    const chatModelReadyRef = useRef(false);
    useEffect(() => {
        let cancelled = false;
        getPreference(PREF_KEYS.CASUAL_CHAT_MODEL).then(v => {
            if (cancelled) return;
            if (v) {
                try { localStorage.setItem(PREF_KEYS.CASUAL_CHAT_MODEL, v); } catch { /* ignore */ }
                setSelectedChatModel(v);
            }
            chatModelReadyRef.current = true;
        });
        return () => { cancelled = true; };
    }, []);
    useEffect(() => {
        if (!chatModelReadyRef.current && !selectedChatModel) return;
        if (selectedChatModel) {
            setPreference(PREF_KEYS.CASUAL_CHAT_MODEL, selectedChatModel);
            try { localStorage.setItem(PREF_KEYS.CASUAL_CHAT_MODEL, selectedChatModel); } catch { /* ignore */ }
        } else if (chatModelReadyRef.current) {
            removePreference(PREF_KEYS.CASUAL_CHAT_MODEL);
            try { localStorage.removeItem(PREF_KEYS.CASUAL_CHAT_MODEL); } catch { /* ignore */ }
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
        currentVisionData, setCurrentVisionData,
        isDeepAnalysis, setIsDeepAnalysis,
        analysisAbortController,
        initAnalysisSteps, startStep, completeStep, failStep, addSubStep,
        handleSendMessage,
        handleCancelAnalysis,
        handleClearChat,
        handleDeleteMessages,
        getActiveCustomInstructions,
        handleReplacementChoice,
        steeringNotes,
        handleRemoveSteeringNote,
    } = useAnalysisPipeline({
        messages, messagesRef, updateMessages, activeConversation, activeConversationId,
        providerConfigs: readyProviders,
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
        isEnsembleEnabled,
        ensembleModelSelection,
        customEnsemblePrompt,
        customLensPrompts,
        selectedChatModel,
        toast,
        confirmDialog,
    });

    // Regime-matched provider win rates for the CURRENT market regime — feeds
    // the lens auto-assign (Team modal) so routing prefers who actually wins
    // in this kind of market, not a blended all-time number.
    const regimeProviderStats = useMemo(
        () => computeRegimeProviderStats(loggedTrades, (currentHybridData as any)?.regime?.regime),
        [loggedTrades, currentHybridData]
    );

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
            issues.push('select a moderator in Settings → AI setup');
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
        todayReassessmentInFlight,
        startTodayReassessment,
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
        memoryConfig,
        memoryModel,
        useAlgorithmicInsights,
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

    // Cancel BOTH the analysis pipeline and any in-flight post-mortem — the
    // "Stop generating" affordance must never be a silent no-op for
    // post-mortems (the pipeline's controller is null during one).
    const handleCancelAll = useCallback(() => {
        handleCancelAnalysis();
        invalidatePostMortemRuns();
    }, [handleCancelAnalysis, invalidatePostMortemRuns]);

    // ... (Rest of existing hooks/functions) ...
    const analysisMessages = useMemo(() => messages.filter(m => m.analysis || m.isDebating), [messages]);
    const currentInsightIds = useMemo(() => tradeSummaries.map(s => s.id), [tradeSummaries]);
    const isImageUploadDisabled = isAnalysisInProgress || isPostMortemInProgress;
    const isSummarizing = images.some(img => img.isLoading);
    // The Send button must never look active when no provider can actually
    // run — accuracy mode doesn't conjure providers out of thin air (the
    // pipeline toasts "No AI Providers Enabled" on send).
    const isAnyProviderEnabled = readyProviders.length > 0;

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
                onAnalysis: async (payload) => {
                    // Re-dispatch queued analyses with their original charts
                    // (dataURLs persisted at enqueue time).
                    const images = (payload?.images || []).map((url: string, i: number) => ({
                        file: dataUrlToFile(url, `chart-${i + 1}.png`),
                        dataURL: url,
                        isLoading: false,
                    }));
                    handleSendMessage(payload?.prompt || '', images);
                },
                onItemProcessed: () => updateQueueCount(),
                onQueueEmpty: () => setPendingQueueCount(0)
            });
        }
    }, [isOnline, wasOffline, handleSendMessage]);

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
        setIsGlobalMemoryEnabled(false);
        setMemoryConfig(null);
        setMemoryModel('');
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
                settings: { activeFrameworks: DEFAULT_FRAMEWORKS, summaryCharLimit: 4000, summarizationProvider: firstReady?.id || '', summarizationModel: firstReady?.selectedModel || '', visionModel: '', isGlobalMemoryEnabled: false, isAccuracyModeEnabled: false, accuracySubMode: 'original', customInstructions: { general: [], accuracyOriginal: [], accuracyPure: [] }, isPlaybookEnabledInPureAI: false, isFamiliesEnabledInPureAI: false, isMemoryEnabledInPureAI: false, isHybridIntelligenceEnabled: false, isAutoCapturing: false, isUpdateAutoCapturing: false, isEntryNotHitCapturing: false, useAlgorithmicSummary: false, useAlgorithmicInsights: false, memoryProvider: '', memoryModel: '' },
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
        confirmDialog,
    });

    // ─── Automations: scheduled analyses (own card feed per automation) ───
    // Placed after activeUsername — the scheduler is scoped to the active
    // user's configs and re-arms on user switch.
    const automations = useAutomations({
        activeUsername,
        runPipeline: handleSendMessage,
        conversationHistory,
        providerConfigs,
        isAnalysisInProgress,
        toast,
    });

    // Model options for the automation editor (provider :: model pairs).
    const automationModelOptions = useMemo(() => {
        const options: ModelOption[] = [];
        for (const p of providerConfigs) {
            if (!p.isEnabled || !p.apiKey.trim()) continue;
            for (const m of p.models) {
                options.push({ value: `${p.id}::${m}`, label: `${p.name} · ${m}` });
            }
        }
        return options;
    }, [providerConfigs]);

    // Editor target — narrowed once here (property narrowing does not
    // survive into the JSX callbacks below).
    const editingAutomation = automations.editor && automations.editor.mode === 'edit'
        ? automations.editor.automation
        : undefined;
    const editorIsOpen = automations.editor !== null;

    // Keep the activeUsernameRef (read by usePostMortem's run-staleness
    // checks) in sync with the canonical activeUsername state before
    // dependent hooks render.
    activeUsernameRef.current = activeUsername ?? null;

    const latestHistoricalAnalysis = useMemo(() => {
        const historical = conversationHistory
            .flatMap(conversation => conversation.messages || [])
            .filter(message => Boolean(message.analysis))
            .sort((a, b) => new Date(b.analysis?.createdAt || b.createdAt).getTime() - new Date(a.analysis?.createdAt || a.createdAt).getTime());
        return historical[0]?.analysis;
    }, [conversationHistory]);
    const homeDashboard = useMemo(() => {
        if (messages.length > 0 || (conversationHistory.length === 0 && loggedTrades.length === 0)) return undefined;
        return {
            username: activeUsername,
            trades: loggedTrades,
            latestAnalysis: latestHistoricalAnalysis,
            conversationCount: conversationHistory.length,
            readyProviderCount: readyProviders.length,
            hasProviderConfig: providerConfigs.length > 0,
            onStartAnalysis: () => {
                setInput('Analyze the chart I attached with a clear verdict, entry, stop, targets, and invalidation criteria.');
                requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('textarea')?.focus());
            },
            onOpenJournal: () => setJournalState({ isOpen: true, tab: 'log' }),
            onOpenLiveMarket: () => setIsLiveMarketVisible(true),
            onOpenSettings: () => setIsSettingsMenuVisible(true),
        };
    }, [activeUsername, conversationHistory, latestHistoricalAnalysis, loggedTrades, messages.length, providerConfigs.length, readyProviders.length, setInput, setJournalState]);

    // P1-4/P1-9: Track the previous active user in a ref mutated by this
    // effect itself. (A render-phase read of activeUsernameRef made
    // `previous` equal the NEW username right after a switch — the
    // cache-clear and backup-stop below never fired, so one user's cached
    // AI responses and 30-min backup scheduler leaked into the next user's
    // session. The ref initializes from the session user so a same-user boot
    // is a no-op.)
    const previousUsernameRef = useRef<string | null>(activeUsernameRef.current);
    useEffect(() => {
        // Legacy migration: delete the AI response-cache IndexedDB left by
        // older builds. Analysis never reads or writes an AI response cache —
        // only tool/data caches (market data, kline, desk tools) remain.
        try { indexedDB.deleteDatabase('august-cache'); } catch { /* no-op */ }
    }, []);
    useEffect(() => {
        const previous = previousUsernameRef.current;
        const current = activeUsername ?? null;
        if (previous !== current) {
            // P1-9: Stop the old user's backup scheduler; loadUserData starts
            // a fresh one for the new user.
            if (previous !== null) stopAutoBackup();
            // No AI response cache exists to clear (removed). Only tool/data
            // caches remain, which are in-memory and never persist across
            // users or reloads.
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
            const anyOverlayOpen = isSettingsMenuVisible || isLiveMarketVisible || isCommandPaletteOpen || isSavedGalleryOpen || isUserModalOpen || isAdvancedAnalyticsOpen || isVisionDataVisible || isStrategySearchVisible || isSavedAnalysesVisible || isVersionHistoryVisible || isWatchListVisible || isApprovalInboxVisible;
            if (anyOverlayOpen) {
                // Overlays with their own document-level Esc handlers
                // (SettingsMenu, command palette, Journal, LiveMarket, dialogs)
                // close themselves. Close the gate-owned overlays here so one
                // Esc never both closes an overlay AND cancels a running
                // analysis — but never cancels while anything is open.
                if (isAdvancedAnalyticsOpen) setIsAdvancedAnalyticsOpen(false);
                if (isVisionDataVisible) setIsVisionDataVisible(false);
                if (isStrategySearchVisible) setIsStrategySearchVisible(false);
                if (isSavedAnalysesVisible) setIsSavedAnalysesVisible(false);
                if (isWatchListVisible) setIsWatchListVisible(false);
                if (isApprovalInboxVisible) setIsApprovalInboxVisible(false);
                if (isVersionHistoryVisible) setIsVersionHistoryVisible(false);
                return;
            }
            if (isAnalysisInProgress || isPostMortemInProgress) {
                handleCancelAll();
                toast.info(
                    isPostMortemInProgress ? 'Post-mortem cancelled' : 'Analysis cancelled',
                    isPostMortemInProgress ? 'The trade log was not updated.' : 'The partial debate was preserved in the chat.'
                );
            }
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [isAnalysisInProgress, isPostMortemInProgress, handleCancelAll, toast, isSettingsMenuVisible, isLiveMarketVisible, isCommandPaletteOpen, isSavedGalleryOpen, isUserModalOpen, isAdvancedAnalyticsOpen, isVisionDataVisible, isStrategySearchVisible, isSavedAnalysesVisible, isVersionHistoryVisible, isWatchListVisible, isApprovalInboxVisible]);

    const {
        comparePrimary,
        compareSecondary,
        handleCompareAnalysis,
        handlePickSecondary,
        closeCompare,
    } = useCompareRuns(messages);

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

    // F3: Ctrl/Cmd+N = new conversation; "/" focuses the composer (unless
    // already typing or an overlay is open).
    // (Ctrl+N + "/" handler lives next to handleNewConversation below.)


    // Prevent the async startup profile scan from reopening the workspace
    // picker after the user has already submitted a workspace name.
    const profileSelectionStartedRef = useRef(false);

    const loadUserData = async (username: string) => {
        profileSelectionStartedRef.current = true;
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
        // Prompt overrides are per-user — load the active user's edits into
        // the sync cache so prompt assembly (getPrompt) sees them.
        await initPromptOverrides(username);
        // Same per-user treatment for uploaded strategy docs (Settings →
        // Strategies) — the sync cache feeds the analysis-prompt injection.
        await initStrategyDocs(username);
        // Trader Notebook (Settings → Personal edge → Memory files): load the
        // user's markdown memory into the sync cache (seeds the default
        // folders + starter templates on first boot).
        await initMemoryFiles(username);
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
        await SetupWatchService.init();
        await OutcomeAutopilotService.init();
        await initConfluenceService();
        await initPatternMemoryService();
        await GlobalLearningService.setActiveUser(username);
        // Same per-user treatment for the attributed-insights knowledge base —
        // resets the module cache so the next read loads THIS user's insights.
        setAttributedInsightsUser(username);

        const profile = await dbService.getUserProfile(username);
        if (profile) {
            // Refresh the harness-maintained notebook files from the loaded
            // profile: profile/memory.md (who the trader is) and
            // rules/recurring-mistakes.md (loss clusters). Best-effort.
            try {
                await syncProfileMemory(profile, username);
                await syncPatternMemory(profile.finalTradeSummary, username, profile.tradeLog || []);
                await syncRecurringMistakes(profile.tradeLog || [], username);
            } catch (e) {
                console.warn('[TraderNotebook] Initial sync failed:', e);
            }
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
                    if (normalized.isDebating) {
                        return { ...normalized, isDebating: false };
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
            // Global vision model: empty = fall back to the conversation's
            // OCR model / first ready provider at resolution time.
            setVisionModel(profile.settings?.visionModel || '');
            setUseAlgorithmicSummary(profile.settings?.useAlgorithmicSummary ?? false);
            setUseAlgorithmicInsights(profile.settings?.useAlgorithmicInsights ?? false);
            setIsGlobalMemoryEnabled(profile.settings?.isGlobalMemoryEnabled ?? false);
            setIsStrategiesEnabled(profile.settings?.isStrategiesEnabled ?? false);
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
            // Persisted ensemble mode wins; the derived provider count is the
            // fallback for profiles that predate the setting. The ref bridges
            // the race with the one-time init effect above (loadUserData can
            // run before or after providers finish loading).
            persistedEnsembleModeRef.current = profile.settings?.isEnsembleEnabled ?? null;
            setIsEnsembleEnabled(profile.settings?.isEnsembleEnabled ?? (ensembleModelCount > 1));
            setIsAutoCapturing(profile.settings?.isAutoCapturing ?? false);
            setIsUpdateAutoCapturing(profile.settings?.isUpdateAutoCapturing ?? false);
            setIsEntryNotHitCapturing(profile.settings?.isEntryNotHitCapturing ?? false);
            setConfidenceCalibration(profile.settings?.confidenceCalibration);
            const loadedMemoryConfig = providerConfigs.find(p => p.id === profile.settings?.memoryProvider) || null;
            setMemoryConfig(loadedMemoryConfig);
            setMemoryModel(profile.settings?.memoryModel || loadedMemoryConfig?.selectedModel || getFirstReadyProvider(providerConfigs)?.selectedModel || '');

            // AI Learning: Load knowledge base
            setInsightKnowledgeBase(profile.insightKnowledgeBase);

            // Restored/migrated profiles carry learning rules in the snapshot.
            // Write them back into the local store when it's empty (e.g. after
            // restoring a backup onto a fresh WebView) — in the normal flow the
            // local store already holds the same (possibly newer) rules.
            if (profile.learningRules && (profile.learningRules.rules?.length ?? 0) > 0) {
                const localRules = storageService.loadLearningRules();
                if ((localRules.rules?.length ?? 0) === 0) {
                    storageService.saveLearningRules({
                        rules: profile.learningRules.rules,
                        lastUpdated: profile.learningRules.lastUpdated,
                        version: 2,
                    });
                }
            }

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
                } else if (!profileSelectionStartedRef.current) {
                    setIsUserModalOpen(true);
                }
            } catch (error) {
                console.error('App: initialization failed', error);
                if (!isMounted) return;
                // Show the user modal even if DB init fails so the app
                // doesn't get stuck on a blank screen.
                if (!profileSelectionStartedRef.current) setIsUserModalOpen(true);
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
        settings: { activeFrameworks, summaryCharLimit, summarizationProvider, summarizationModel, visionModel, isGlobalMemoryEnabled, isStrategiesEnabled, isEnsembleEnabled, isAccuracyModeEnabled, accuracySubMode, customInstructions, isPlaybookEnabledInPureAI, isFamiliesEnabledInPureAI, isMemoryEnabledInPureAI, isHybridIntelligenceEnabled, isAutoCapturing, isUpdateAutoCapturing, isEntryNotHitCapturing, useAlgorithmicSummary, useAlgorithmicInsights, confidenceCalibration, memoryProvider: memoryConfig?.id || '', memoryModel },
        lastActiveConversationId: activeConversationId || undefined,
        // AI Learning data
        insightKnowledgeBase: insightKnowledgeBase,
        // Learning rules used to live ONLY in WebView localStorage — they were
        // excluded from SQLite, backups and migrations, so a WebView data
        // clear silently destroyed them. Snapshotting them here populates the
        // users.learningRules column and BackupService payload.
        learningRules: storageService.loadLearningRules(),
    }), [conversationHistory, loggedTrades, activeFrameworks, activeConversationId, savedAnalyses, tradeSummaries, finalTradeSummary, globalMemory, summaryCharLimit, summarizationProvider, summarizationModel, visionModel, isGlobalMemoryEnabled, isStrategiesEnabled, isEnsembleEnabled, isAccuracyModeEnabled, accuracySubMode, customInstructions, isPlaybookEnabledInPureAI, isFamiliesEnabledInPureAI, isMemoryEnabledInPureAI, isHybridIntelligenceEnabled, isAutoCapturing, isUpdateAutoCapturing, isEntryNotHitCapturing, useAlgorithmicSummary, useAlgorithmicInsights, confidenceCalibration, insightKnowledgeBase, memoryConfig, memoryModel]);

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

        // Bail out when already SAVING — this effect re-arms on EVERY stream
        // chunk, and a state write to the same value would still schedule a
        // full App render each time (P1-6: setSaveStatus was a raw setter).
        setSaveStatus(prev => (prev === 'SAVING' ? prev : 'SAVING'));

        const handler = setTimeout(async () => {
            try {
                // buildProfileSnapshot deliberately stays OUT of this effect's
                // deps (see dep list below): settings-only toggles would re-arm
                // a heavy full-snapshot save that the SETTINGS effect already
                // covers. heartbeatSnapshotRef (synced every render, below)
                // always holds the freshest snapshot without re-arming here.
                const profileData = heartbeatSnapshotRef.current();
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
    }, [conversationHistory, loggedTrades, savedAnalyses, tradeSummaries, finalTradeSummary, globalMemory, insightKnowledgeBase, activeUsername, activeConversationId]);

    // (2) SETTINGS save — light payload, runs on settings toggles. Uses a
    // longer debounce (2500ms) since settings changes are low-risk and we
    // don't want every checkbox tick to trigger a save storm.
    useEffect(() => {
        if (!activeUsername) return;

        // Surface settings saves in the header status too — the old path
        // failed silently (console.error only), so a broken write looked
        // like a successful toggle. Same bail-out as the DATA effect.
        setSaveStatus(prev => (prev === 'SAVING' ? prev : 'SAVING'));

        const handler = setTimeout(async () => {
            try {
                // Only the settings sub-object — no conversations, no trades,
                // no base64 images. This is a cheap write.
                await dbService.saveUserProfile(activeUsername, {
                    settings: { activeFrameworks, summaryCharLimit, summarizationProvider, summarizationModel, visionModel, isGlobalMemoryEnabled, isStrategiesEnabled, isEnsembleEnabled, isAccuracyModeEnabled, accuracySubMode, customInstructions, isPlaybookEnabledInPureAI, isFamiliesEnabledInPureAI, isMemoryEnabledInPureAI, isHybridIntelligenceEnabled, isAutoCapturing, isUpdateAutoCapturing, isEntryNotHitCapturing, useAlgorithmicSummary, useAlgorithmicInsights, confidenceCalibration, memoryProvider: memoryConfig?.id || '', memoryModel },
                });
                setSaveStatus('SAVED');
            } catch (err) {
                console.error("Failed to save user profile (settings):", err);
                setSaveStatus('ERROR');
                toast.error('Settings not saved', 'Your changes could not be saved. Check storage permissions and try again.');
            }
        }, 2500);

        return () => {
            clearTimeout(handler);
        };
    }, [activeFrameworks, summaryCharLimit, summarizationProvider, summarizationModel, visionModel, isGlobalMemoryEnabled, isStrategiesEnabled, isEnsembleEnabled, isAccuracyModeEnabled, accuracySubMode, customInstructions, isPlaybookEnabledInPureAI, isFamiliesEnabledInPureAI, isMemoryEnabledInPureAI, isHybridIntelligenceEnabled, isAutoCapturing, isUpdateAutoCapturing, isEntryNotHitCapturing, useAlgorithmicSummary, useAlgorithmicInsights, confidenceCalibration, memoryConfig, memoryModel, activeUsername, toast]);

    // (3) SAVE HEARTBEAT — the 1500ms DATA debounce restarts on every message
    // change, so nothing is persisted for the ENTIRE duration of a run (the
    // RAF-throttled debate updates keep resetting it). A native kill or
    // background termination mid-run then loses the whole run. Flush every
    // 15s while a run is active instead.
    // buildProfileSnapshot changes identity on every conversationHistory
    // mutation — using it directly in deps would re-arm this interval every
    // frame during a run (the exact bug this heartbeat exists to fix). Keep
    // the freshest snapshot in a ref instead. The ref is synced during RENDER
    // (like loggedTradesRef): the effect body only runs when the run starts,
    // so an assignment inside it would freeze the snapshot at run-start data
    // and the mid-run flush would overwrite the profile with stale state.
    const heartbeatSnapshotRef = useRef(buildProfileSnapshot);
    heartbeatSnapshotRef.current = buildProfileSnapshot;
    useEffect(() => {
        if (!activeUsername || (!isAnalysisInProgress && !isPostMortemInProgress)) return;
        const interval = setInterval(async () => {
            try {
                const last = lastSavedSnapshotRef.current;
                const snapshot = heartbeatSnapshotRef.current();
                // Skip the write when nothing changed since the last persisted
                // snapshot (reference compare — same as the unload-flush dirty
                // check). Pure typing or a settled run must not force a
                // full-profile stringify every 15s.
                const dirty = !last
                    || last.conversations !== snapshot.conversations
                    || last.tradeLog !== snapshot.tradeLog
                    || last.tradeSummaries !== snapshot.tradeSummaries
                    || last.savedAnalyses !== snapshot.savedAnalyses
                    || last.finalTradeSummary !== snapshot.finalTradeSummary
                    || last.globalMemory !== snapshot.globalMemory
                    || last.insightKnowledgeBase !== snapshot.insightKnowledgeBase;
                if (!dirty) return;
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

    // Seed the ordinary (normal-mode) debate-model selection from the ready
    // providers' ensembleModels when nothing has been picked yet. The run
    // falls back to those models anyway — without the seed the chat pickers
    // look empty while three "hardcoded" models silently run. Once seeded
    // (or cleared by the user), never re-seed this session.
    const ensembleSelectionSeededRef = useRef(false);
    useEffect(() => {
        if (!providerConfigsLoaded || ensembleSelectionSeededRef.current) return;
        if (ensembleModelSelection && ensembleModelSelection.length > 0) {
            ensembleSelectionSeededRef.current = true;
            return;
        }
        const ready = providerConfigs.filter(c => c.isEnabled && c.apiKey.trim().length > 0);
        if (ready.length === 0) return;
        const seeded: EnsembleModelSelection = [];
        for (const c of ready) {
            const models = (c.ensembleModels?.filter(m => c.models.includes(m)) ?? []).slice(0, 3);
            if (models.length === 0 && c.selectedModel && c.models.includes(c.selectedModel)) models.push(c.selectedModel);
            for (const m of models) {
                if (seeded.length >= 3) break;
                const key = `${c.id}::${m}`;
                if (!seeded.some(e => `${e.providerId}::${e.model}` === key)) seeded.push({ providerId: c.id, model: m });
            }
            if (seeded.length >= 3) break;
        }
        if (seeded.length > 0) {
            ensembleSelectionSeededRef.current = true;
            handleSetEnsembleModelSelection(seeded);
        }
    }, [providerConfigsLoaded, providerConfigs, ensembleModelSelection, handleSetEnsembleModelSelection]);

    // Custom prompt overrides (prompt editor) — persist so they survive reloads.
    const handleSetCustomEnsemblePrompt = useCallback((prompt: string | null) => {
        setCustomEnsemblePrompt(prompt);
        saveCustomEnsemblePrompt(prompt);
    }, [setCustomEnsemblePrompt]);

    const handleSetCustomLensPrompts = useCallback((prompts: Record<string, string>) => {
        setCustomLensPrompts(prompts);
        saveCustomLensPrompts(prompts);
    }, [setCustomLensPrompts]);

    useCatalogReconcile({
        providerConfigsLoaded,
        providerConfigs,
        lensConfig,
        handleSetLensConfig,
        ensembleModelSelection,
        handleSetEnsembleModelSelection,
    });

    useEffect(() => {
        if (!providerConfigsLoaded) return;
        void (async () => {
            const existing = await BotRegistry.list();
            if (existing.length > 0) return;
            const fallback: Array<{ providerId: string; model: string; role: AnalystRole; name: string }> = [];
            if (lensConfig.enabled) {
                const roleNames: Record<string, string> = {
                    [AnalystRole.MACRO_VOLATILITY]: 'Macro',
                    [AnalystRole.TECHNICAL_ANALYST]: 'Technical',
                    [AnalystRole.RISK_EXECUTION]: 'Risk',
                };
                for (const a of lensConfig.assignments) {
                    if (!a.assignedProvider || !a.role) continue;
                    const provider = providerConfigs.find(p => p.id === a.assignedProvider);
                    const model = a.assignedModel || provider?.selectedModel || provider?.models[0];
                    if (!provider || !model) continue;
                    fallback.push({ providerId: provider.id, model, role: a.role, name: roleNames[a.role] || provider.name });
                }
            }
            if (fallback.length === 0) {
                const names = ['Macro', 'Technical', 'Risk'];
                const roles = [AnalystRole.MACRO_VOLATILITY, AnalystRole.TECHNICAL_ANALYST, AnalystRole.RISK_EXECUTION];
                for (let i = 0; i < Math.min(3, ensembleModelSelection.length); i++) {
                    const e = ensembleModelSelection[i];
                    if (!e?.providerId || !e.model) continue;
                    fallback.push({ providerId: e.providerId, model: e.model, role: roles[i], name: names[i] });
                }
            }
            if (fallback.length > 0) {
                await BotRegistry.seedIfEmpty(fallback);
            }
        })();
    }, [providerConfigsLoaded, providerConfigs, lensConfig, ensembleModelSelection]);

    // Quota flagging UI never materialized (the old quotaExceededModels state
    // was set but never read by any component) — keep the callback for the
    // modal plumbing; quota errors surface via the OCR error state instead.
    const handleQuotaExceeded = useCallback((_modelId: string) => {
        // Intentional no-op.
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
        const idSet = new Set(ids);
        const nextTrades = loggedTrades.filter(t => !idSet.has(t.id));
        const nextSummaries = tradeSummaries.filter(s => !idSet.has(s.id));
        setLoggedTrades(nextTrades);
        setTradeSummaries(nextSummaries);
        if (nextTrades.length === 0) {
            setFinalTradeSummary(null);
            void syncPatternMemory(null, activeUsernameRef.current || 'default').catch(() => {});
        } else if (nextTrades.length !== loggedTrades.length) {
            // The AI Review was synthesized from the old trade set — re-run
            // it so Pattern Memory never describes deleted trades.
            handleJournalAutoRefresh();
        }
        // Cascade: reasoning records, learning rules and autopilot watchers
        // keyed to the deleted trades must not survive — a deleted trade
        // would otherwise re-trigger "outcome detected" and be re-logged.
        const username = activeUsernameRef.current || 'default';
        const deletedTrades = loggedTrades.filter(t => idSet.has(t.id));
        deletedTrades.forEach(t => {
            void deleteThinkingByTrade(getThinkingTradeId(t.analysis?.createdAt, t.id), username);
            OutcomeAutopilotService.unregister(t.id);
        });
        removeRulesForTrades(ids);
    };

    const handleClearAllTrades = async () => {
        // P2-13: Capture state before deletion for undo. Previously this used
        // native confirm() (blocking, no undo) — a delete could appear to
        // succeed in UI but be lost if the tab closed before the debounced save.
        const prevTrades = loggedTrades;
        const prevSummaries = tradeSummaries;
        const prevFinalSummary = finalTradeSummary;
        let restored = false;
        const ok = await confirmDialog({
            title: 'Delete all trade history?',
            message: `This will remove ${loggedTrades.length} logged trade(s) and their insights. You can undo this for 5 seconds.`,
            confirmLabel: 'Delete All',
            destructive: true,
            onUndo: () => {
                restored = true;
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
            void syncPatternMemory(null, activeUsernameRef.current || 'default').catch(() => {});
            // AFTER the undo grace window — an undo restores the trades, so
            // their artifacts must survive until the delete is final.
            window.setTimeout(() => {
                if (restored || prevTrades.length === 0) return;
                const username = activeUsernameRef.current || 'default';
                prevTrades.forEach(t => {
                    void deleteThinkingByTrade(getThinkingTradeId(t.analysis?.createdAt, t.id), username);
                    OutcomeAutopilotService.unregister(t.id);
                });
                removeRulesForTrades(prevTrades.map(t => t.id));
            }, 5500);
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
            let done = 0;
            setInsightProgress({ done: 0, total: newTrades.length });

            for (const trade of newTrades) {
                const fromPostMortem = insightTextForTrade(trade);
                const summary = fromPostMortem
                    || await MemoryService.summarizeTrade(trade, memoryConfig?.selectedModel || '', memoryConfig || moderatorConfig, useAlgorithmicInsights);
                newSummaries.push({
                    id: trade.id,
                    summaryText: summary,
                    timestamp: new Date().toISOString()
                });
                done++;
                setInsightProgress({ done, total: newTrades.length });
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
            setInsightProgress(null);
            // New insights landed — re-run the AI Review so Pattern Memory
            // reflects the expanded insight set.
            handleJournalAutoRefresh();
        }
    };

    // Delete individual insight from Recent Insights
    const handleDeleteInsight = (id: string) => {
        setTradeSummaries(prev => prev.filter(s => s.id !== id));
        // The AI Review is synthesized from the insights — keep it in sync.
        handleJournalAutoRefresh();
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
            let done = 0;
            setInsightProgress({ done: 0, total: targetIds.length });

            for (const id of targetIds) {
                const trade = loggedTrades.find(t => t.id === id);
                console.log(`[AIRewrite] Looking for trade with id: ${id}, found: ${!!trade}`);
                if (trade) {
                    const summaryConfig = memoryConfig || readyProviders[0] || moderatorConfig;
                    console.log(`[AIRewrite] Calling MemoryService.summarizeTrade with provider: ${summaryConfig.name}, model: ${summaryConfig.selectedModel}`);
                    const fromPostMortem = insightTextForTrade(trade);
                    const summary = fromPostMortem
                        || await MemoryService.summarizeTrade(trade, summaryConfig.selectedModel || '', summaryConfig, false);
                    console.log(`[AIRewrite] Got summary for ${id}:`, summary?.substring(0, 100));
                    updatedSummaries.push({
                        id: trade.id,
                        summaryText: summary,
                        timestamp: new Date().toISOString()
                    });
                } else {
                    console.warn(`[AIRewrite] Trade not found for id: ${id}. Available trade ids:`, loggedTrades.map(t => t.id));
                }
                done++;
                setInsightProgress({ done, total: targetIds.length });
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
            setInsightProgress(null);
            // Insights were rewritten — re-run the AI Review so Pattern
            // Memory is synthesized from the fresh insight text.
            handleJournalAutoRefresh();
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

    // Correct a mis-logged outcome (WIN/LOSS/etc.) from the journal card —
    // previously the only fix was delete + re-log. Backfills the thinking
    // records so outcome-correlated reasoning stays accurate.
    const handleUpdateTradeOutcome = useCallback((id: string, outcome: TradeOutcome) => {
        setLoggedTrades(prev => prev.map(t => t.id === id ? { ...t, outcome } : t));
        const trade = loggedTradesRef.current.find(t => t.id === id);
        if (trade) {
            const tradeId = getThinkingTradeId(trade.analysis?.createdAt, id);
            void updateThinkingOutcome(tradeId, outcome, id, activeUsernameRef.current || 'default', { pnlAmount: trade.pnlAmount, pnlPercent: trade.pnlPercent }).catch(err => {
                console.warn('[TradeLog] Failed to update thinking outcome:', err);
            });
        }
    }, [setLoggedTrades, loggedTradesRef]);

    // Fill in / correct PnL from the journal card (autopilot-logged trades
    // only carry the leveraged percent, so the dollar figure needs a manual
    // entry to make the dashboard PnL math meaningful). Backfills the
    // thinking records too so the training corpus stays consistent with the
    // journal.
    const handleUpdateTradePnL = useCallback((id: string, pnl: { pnlAmount?: number; pnlPercent?: number }) => {
        setLoggedTrades(prev => prev.map(t => t.id === id ? { ...t, ...pnl } : t));
        const trade = loggedTradesRef.current.find(t => t.id === id);
        if (trade) {
            const tradeId = getThinkingTradeId(trade.analysis?.createdAt, id);
            void updateThinkingOutcome(tradeId, trade.outcome, id, activeUsernameRef.current || 'default', pnl).catch(err => {
                console.warn('[TradeLog] Failed to backfill thinking PnL:', err);
            });
        }
    }, [setLoggedTrades, loggedTradesRef]);

    const handleRegenerateFinalSummary = async () => {
        // Guard: an auto-refresh may already be running (the debounced
        // journal auto-refresh and the manual button share this path) —
        // never launch two AI syntheses concurrently.
        if (isSummaryInProgress) return;
        setIsSummaryInProgress(true);
        try {
            if (loggedTrades.length === 0) {
                setFinalTradeSummary(null);
                void syncPatternMemory(null, activeUsernameRef.current || 'default').catch(() => {});
                return;
            }
            let summary = '';
            const summaryConfig = memoryConfig || readyProviders[0];
            if (summaryConfig) {
                summary = await generateFinalSummary(summaryConfig, tradeSummaries, summaryCharLimit);
            }

            setFinalTradeSummary(summary);
            const notebookUser = activeUsernameRef.current || 'default';
            void syncPatternMemory(summary || null, notebookUser, loggedTrades).catch(err => {
                console.warn('[TraderNotebook] pattern-memory.md sync failed:', err);
            });
        } catch (e) {
            console.error("Summary regeneration failed", e);
        } finally {
            setIsSummaryInProgress(false);
        }
    };

    // Latest-ref for the journal auto-refresh (declared above the
    // useTradeLogging call). Assigning AFTER the declaration keeps the stable
    // handleJournalAutoRefresh closure seeing the freshest regeneration logic
    // without re-arming the hook's memoized callbacks on every render.
    regenerateFinalSummaryRef.current = () => { void handleRegenerateFinalSummary(); };

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

    // F3: New conversation (Ctrl/Cmd+N shortcut + palette action).
    // Reuse an existing blank session instead of minting another empty one —
    // "New" from a filled session should return to the unused blank tab.
    const handleNewConversation = useCallback(() => {
        handleCancelAnalysis();
        invalidatePostMortemRuns();
        const reusable = findReusableEmptyConversation(conversationHistory, activeConversationId);
        if (reusable) {
            if (reusable.id !== activeConversationId) {
                setConversationHistory(prev => [
                    { ...reusable, timestamp: Date.now() },
                    ...prev.filter(c => c.id !== reusable.id),
                ]);
                setActiveConversationId(reusable.id);
            }
            return;
        }
        const newConv = createNewConversation();
        const lastModerator = loadLastModeratorPick();
        if (activeConversation) {
            newConv.ocrModel = activeConversation.ocrModel;
            newConv.moderatorProviderId = activeConversation.moderatorProviderId || lastModerator?.providerId || '';
            newConv.moderatorModel = activeConversation.moderatorModel || lastModerator?.model || '';
            newConv.leverage = activeConversation.leverage;
        } else if (lastModerator) {
            newConv.moderatorProviderId = lastModerator.providerId;
            newConv.moderatorModel = lastModerator.model;
        }
        setConversationHistory(prev => [newConv, ...prev]);
        setActiveConversationId(newConv.id);
    }, [handleCancelAnalysis, invalidatePostMortemRuns, conversationHistory, activeConversationId, activeConversation]);

    useEffect(() => {
        if (moderatorProviderId && moderatorModel) {
            saveLastModeratorPick({ providerId: moderatorProviderId, model: moderatorModel });
            return;
        }
        if (!activeConversation || activeConversation.moderatorProviderId) return;
        const lastModerator = loadLastModeratorPick();
        if (!lastModerator?.providerId) return;
        setConversationModeratorProvider(lastModerator.providerId);
        if (lastModerator.model) setConversationModeratorModel(lastModerator.model);
    }, [activeConversation, moderatorProviderId, moderatorModel, setConversationModeratorProvider, setConversationModeratorModel]);

    // F3: Ctrl/Cmd+N = new conversation; "/" focuses the composer (unless
    // already typing or an overlay is open).
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
                e.preventDefault();
                handleNewConversation();
                return;
            }
            if (e.key === '/' && !isCommandPaletteOpen) {
                const target = e.target as HTMLElement | null;
                const isTyping = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
                if (isTyping) return;
                const composer = document.getElementById('chat-composer') as HTMLTextAreaElement | null;
                composer?.focus();
            }
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [handleNewConversation, isCommandPaletteOpen]);

    const handleLoadConversation = useCallback((id: string) => {
        if (id !== activeConversationId) {
            handleCancelAnalysis();
            invalidatePostMortemRuns();
            setActiveConversationId(id);
        }
    }, [activeConversationId, handleCancelAnalysis, invalidatePostMortemRuns, setActiveConversationId]);

    const pendingWatchActionRef = useRef<
        | { type: 'log'; messageId: string; outcome: TradeOutcome.WIN | TradeOutcome.LOSS }
        | { type: 'autopilot'; messageId: string }
        | null
    >(null);

    const handleToggleWatch = useCallback((messageId: string, conversationId?: string | null) => {
        const convId = conversationId || activeConversationId;
        if (!convId) return;
        updateMessages(prev => prev.map(m => {
            if (m.id !== messageId) return m;
            const nextWatch = !m.watched;
            const updated = toggleWatchOnMessage(m, nextWatch);
            if (updated.watched) {
                toast.success('Pinned', 'This signal is on the Watch list. Win/Loss and autopilot still work the same.');
            }
            return updated;
        }), convId);
    }, [activeConversationId, toast, updateMessages]);

    const watchedSignals = useMemo(() => collectWatchedSignals(conversationHistory), [conversationHistory]);
    const watchOpenR = useMemo(() => {
        const book = buildRiskBook(watchedSignals, loggedTrades, (symbol) => PriceAlertService.getCurrentPrice(symbol));
        return formatRiskBookBadge(book);
    }, [watchedSignals, loggedTrades]);

    const handleFollowUpTicket = useCallback((messageId: string, text: string) => {
        const msg = messagesRef.current.find(m => m.id === messageId);
        const analysis = msg?.analysis;
        const ocr = (msg?.ocrCache?.texts || []).join('\n').slice(0, 800);
        const openings = reconstructOpenings(msg?.debateTurns || [])
            .map(s => `${s.name}: ${s.opening.slice(0, 280)}`)
            .join('\n');
        const hidden = analysis
            ? `Follow-up on ${analysis.coinName || 'setup'} ${analysis.direction} SL ${analysis.stopLoss || '—'}. Do not re-open the tape; answer the user only.\n${openings ? `Prior openings:\n${openings}\n` : ''}${ocr ? `OCR:\n${ocr}` : ''}`
            : 'Follow-up on the latest ticket.';
        stableHandleSendMessage(text, [], hidden, { followUpFromMessageId: messageId });
    }, [stableHandleSendMessage]);

    const handleOpenWatchedSignal = useCallback((conversationId: string, messageId: string) => {
        handleLoadConversation(conversationId);
        setHighlightedAnalysisId(messageId);
        setIsWatchListVisible(false);
    }, [handleLoadConversation]);

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
                // Don't reuse via handleNewConversation — that would see the
                // pre-delete history and resurrect the session we just removed.
                const newConv = createNewConversation();
                setConversationHistory([newConv]);
                setActiveConversationId(newConv.id);
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

    const handleDeleteSelectedConversations = async (ids: string[]): Promise<boolean> => {
        if (ids.length === 0) return false;
        const ok = await confirmDialog({
            title: `Delete ${ids.length} session${ids.length === 1 ? '' : 's'}?`,
            message: `This will remove ${ids.length} selected conversation${ids.length === 1 ? '' : 's'} and their messages. Logged trades are kept.`,
            confirmLabel: 'Delete selected',
            destructive: true,
        });
        if (!ok) return false;
        handleDeleteConversations(ids);
        return true;
    };

    const handleStartNewConversation = handleNewConversation;

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
        let index = messages.length - 1;
        for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].role === MessageRole.AI) {
                index = i;
                break;
            }
        }
        if (index < 0) return;
        virtuosoRef.current?.scrollIntoView({ index, align: 'end', behavior: 'smooth' });
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
            label: isEnsembleEnabled ? 'Switch to casual chat' : 'Enable Team analysis',
            hint: 'Team',
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
            id: 'watch-list',
            label: 'Open Watch list',
            hint: `${watchedSignals.filter(s => !s.outcome || s.outcome === TradeOutcome.PENDING).length} open`,
            run: () => setIsWatchListVisible(true),
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
        {
            id: 'accuracy-mode',
            label: isAccuracyModeEnabled ? 'Accuracy Mode: ON — view settings' : 'Enable Accuracy Mode',
            hint: 'Validation',
            run: () => setShowAccuracyModal(true),
        },
        {
            id: 'clear-chat',
            label: 'Clear current chat',
            hint: 'Messages',
            run: () => { void handleClearChat(); },
        },
    ], [handleScrollToBottom, input, stableHandleSendMessage, setJournalState, setIsLiveMarketVisible, setIsSettingsMenuVisible, setIsStrategySearchVisible, setIsVersionHistoryVisible, isEnsembleEnabled, handleSetEnsembleEnabled, lensConfig, handleSetLensConfig, savedAnalyses, setIsSavedGalleryOpen, isAccuracyModeEnabled, setShowAccuracyModal, handleClearChat, watchedSignals]);

    const removeImage = (index: number) => {
        setImages(prev => prev.filter((_, i) => i !== index));
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
        // Ensemble messages carry a stub text — copy the actual plan markdown
        // (analysis.strategy) when it exists, else the raw message text.
        const plan = message.analysis?.strategy;
        const textToCopy = (plan && !plan.startsWith('Parsing Error:') && !plan.startsWith('Connection Error:'))
            ? plan
            : message.text;
        if (textToCopy) {
            navigator.clipboard.writeText(textToCopy);
            setCopiedMessageId(message.id);
            setTimeout(() => setCopiedMessageId(null), 2000);
        }
    }, []);

    // F4: "Re-run debate" — re-dispatches the original prompt + chart images
    // through the normal pipeline so the user gets a fresh debate for the
    // same setup (also the missing retry path for failed analyst slots).
    // Shared by the manual Re-run button and price-triggered setup watches.
    const buildRerunPayload = useCallback((messageId: string, isUserMessageId = false): { prompt: string; images: ImageMetadata[] } | null => {
        // P1-6: read via messagesRef for a stable identity (see handleSaveAnalysis).
        const msgs = messagesRef.current;
        const index = msgs.findIndex(m => m.id === messageId);
        const card = index >= 0 ? msgs[index] : undefined;
        if (!card) return null;
        let userMsg: Message | undefined;
        if (isUserMessageId) {
            // Failed-run retry: the id IS the user message that started the run.
            userMsg = card.role === MessageRole.USER ? card : undefined;
        } else {
            for (let i = index - 1; i >= 0; i--) {
                if (msgs[i].role === MessageRole.USER) { userMsg = msgs[i]; break; }
            }
        }
        const prompt = userMsg?.text?.trim();
        if (!prompt) return null;
        // Rebuild ImageMetadata from the persisted dataURLs (the pipeline's
        // vision payload needs File objects).
        const images: ImageMetadata[] = (userMsg?.images ?? []).map((url, i) => ({
            file: dataUrlToFile(url, `chart-${i + 1}.png`),
            dataURL: url,
            summary: userMsg?.imageSummaries?.[i],
            isLoading: false,
        }));
        return { prompt, images };
    }, [messagesRef]);

    const handleReRunAnalysis = useCallback((messageId: string) => {
        const payload = buildRerunPayload(messageId);
        if (!payload) {
            toast.warning('Cannot re-run', 'No original prompt found for this analysis.');
            return;
        }
        stableHandleSendMessage(payload.prompt, payload.images, `Re-run requested for analysis card ${messageId}.`);
    }, [buildRerunPayload, stableHandleSendMessage, toast]);

    // Failed-run retry: rebuild the exact prompt + charts from the user
    // message the failed run was sent with (the error bubble carries its id).
    const handleRetryFailedRun = useCallback((userMessageId: string) => {
        const payload = buildRerunPayload(userMessageId, true);
        if (!payload) {
            toast.warning('Cannot retry', 'No original prompt found for this analysis.');
            return;
        }
        stableHandleSendMessage(payload.prompt, payload.images, 'Retrying the failed analysis.');
    }, [buildRerunPayload, stableHandleSendMessage, toast]);

    const handleResumeDebate = useCallback((messageId: string) => {
        const payload = buildRerunPayload(messageId);
        if (!payload) {
            toast.warning('Cannot resume', 'No original prompt found for this debate.');
            return;
        }
        stableHandleSendMessage(payload.prompt, payload.images, 'Resume interrupted debate.', { resumeMessageId: messageId });
    }, [buildRerunPayload, stableHandleSendMessage, toast]);

    const handleForkDebate = useCallback((messageId: string, round: number) => {
        const msgs = messagesRef.current;
        const index = msgs.findIndex(m => m.id === messageId);
        if (index < 0) return;
        const ai = msgs[index];
        const userMsg = msgs.slice(0, index).reverse().find(m => m.role === MessageRole.USER);
        const turns = (ai.debateTurns || []).filter(t => (t.round || 1) <= round);
        if (turns.length === 0) {
            toast.warning('Cannot fork', 'No debate turns up to that round.');
            return;
        }
        const newConv = createNewConversation();
        if (activeConversation) {
            newConv.ocrModel = activeConversation.ocrModel;
            newConv.moderatorProviderId = activeConversation.moderatorProviderId;
            newConv.moderatorModel = activeConversation.moderatorModel;
            newConv.leverage = activeConversation.leverage;
        }
        const now = Date.now();
        newConv.messages = [
            ...(userMsg ? [{ ...userMsg, id: `user-${now}` }] : []),
            {
                ...ai,
                id: `ai-${now}`,
                analysis: undefined,
                outcome: undefined,
                isDebating: false,
                debateTurns: turns,
                debateCheckpoint: {
                    lastCompletedRound: round,
                    savedAt: new Date().toISOString(),
                    analystNames: [...new Set(turns.filter(t => t.speaker !== 'System' && t.speaker !== 'Moderator').map(t => t.speaker))],
                    laneDrafts: {},
                },
                ocrCache: ai.ocrCache,
                text: `Forked from round ${round}. Continue debate to resume from here.`,
            },
        ];
        handleCancelAnalysis();
        setConversationHistory(prev => [newConv, ...prev]);
        setActiveConversationId(newConv.id);
        toast.success('Forked debate', `New session from round ${round}.`);
    }, [activeConversation, handleCancelAnalysis, messagesRef, toast]);

    // Edit a sent user message's text in place (persisted to history).
    const handleEditUserMessage = useCallback((messageId: string, text: string) => {
        updateMessages(prev => prev.map(m => m.id === messageId ? { ...m, text } : m));
    }, [updateMessages]);

    // ─── Price-triggered re-debate ("watch this setup") ────────────────────
    // A setup watch fires → launch a fresh debate for the same setup with the
    // previous verdict as context. In-flight runs re-arm the watch instead so
    // the next price tick (≤10s polling) launches once the pipeline frees up.
    // The guard reads isAnalysisInProgress DIRECTLY: a ref synced via an
    // effect lagged by one effect cycle, so a fire landing in that window was
    // dropped — and since rearmWatch had already re-armed, the watch lost its
    // fire-once while staying TRIGGERED.

    const launchRedeBate = useCallback((watch: SetupWatch) => {
        const payload = buildRerunPayload(watch.messageId);
        if (!payload) {
            toast.warning('Watch triggered', `No original prompt found for ${watch.coinName} — re-debate skipped.`);
            return;
        }
        const card = messagesRef.current.find(m => m.id === watch.messageId);
        const a = card?.analysis;
        const verdict = a
            ? `Previous verdict: ${a.direction || 'Neutral'} · confidence ${a.confidence || 'N/A'} · probability ${a.probability != null ? `${a.probability}%` : 'N/A'}.`
            : 'No previous verdict available.';
        const hidden = `Price-triggered re-debate for ${watch.coinName} (watch on ${watch.messageId}): ${describeWatchTrigger(watch)}. ${verdict} Re-analyze this setup with fresh market data and reassess the trade.`;
        stableHandleSendMessage(payload.prompt, payload.images, hidden);
        toast.success?.('Re-debate launched', `${watch.coinName} hit "${describeWatchTrigger(watch)}" — fresh debate started with the previous verdict as context.`);
    }, [buildRerunPayload, messagesRef, stableHandleSendMessage, toast]);

    const handleWatchTriggered = useCallback((trigger: SetupWatchTriggerEvent) => {
        if (isAnalysisInProgress) {
            // A run is already in progress — re-arm; the next tick retries.
            SetupWatchService.rearmWatch(trigger.watch.id);
            return;
        }
        launchRedeBate(trigger.watch);
    }, [isAnalysisInProgress, launchRedeBate]);

    // Subscribe once; armed watches persisted in Preferences re-fire after
    // restart because SetupWatchService.init() runs in the bootstrap effect.
    useEffect(() => {
        return SetupWatchService.subscribe(handleWatchTriggered);
    }, [handleWatchTriggered]);

    const handleViewStrategyDetails = useCallback((name: string) => {
        setStrategyToView(name);
        setIsStrategySearchVisible(true);
    }, []);

    // P1-6: reads messages via messagesRef (not the `messages` closure) so
    // this handler keeps a stable identity across stream chunks — a fresh
    // identity here would re-create chatContext (and re-render every visible
    // MessageItem) on each chunk.
    const handleSaveAnalysis = useCallback((messageId: string) => {
        const msgs = messagesRef.current;
        const msgIndex = msgs.findIndex(m => m.id === messageId);
        const msg = msgIndex >= 0 ? msgs[msgIndex] : undefined;
        if (msg && msg.analysis) {
            // Find the nearest preceding user message. Reconstructing the user ID from the
            // AI message ID never matches because both use independent Date.now() timestamps.
            let userPrompt = "Unknown Request";
            for (let i = msgIndex - 1; i >= 0; i--) {
                if (msgs[i].role === MessageRole.USER) {
                    userPrompt = msgs[i].text || "Unknown Request";
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
    }, [messagesRef, moderatorProviderId, moderatorModel]);

    const handleCalculateAIProbabilities = useCallback(async (messageId: string, mode: 'AI' | 'Algo' = 'AI') => {
        const msg = messages.find(m => m.id === messageId);
        if (!msg || !msg.analysis) return;

        // Algo Mode Logic
        if (mode === 'Algo') {
            if (msg.analysis.marketSnapshot) {
                try {
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
                } catch (error) {
                    console.error('Algo probability calculation failed:', error);
                    toast.error('Probability calculation failed', 'The algo engine hit an error with this trade\'s data. Try the AI mode instead.');
                }
            } else {
                console.warn('Cannot run Algo mode: No snapshot available for trade', messageId);
                toast.warning('No market data', 'This trade has no saved market snapshot, so the algo engine cannot run. Use AI mode instead.');
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
                    toast.warning('Probability update failed', 'The AI response was missing the expected probability fields. No changes were applied.');
                }
            } else {
                console.warn('Failed to extract valid JSON from AI response:', fullJson);
                toast.warning('Probability update failed', 'The AI response could not be parsed. No changes were applied.');
            }
        } catch (error) {
            console.error('Failed to calculate AI probabilities:', error);
            toast.error('Probability update failed', 'An error occurred while recalculating probabilities. Please try again.');
        } finally {
            setIsCalculatingAIProbabilities(false);
        }
    }, [messages, loggedTrades, updateMessages, toast, moderatorConfig, moderatorModel]);

    // ─── Stable identities for overlay/panel callbacks ─────────────────────
    // Inline arrows here were recreated on every App render, busting
    // React.memo on ChatArea/Journal and rebuilding ChatArea's
    // enhancedContext (re-rendering every memoized MessageItem) on each
    // keystroke / progress tick even when nothing relevant changed.
    const handleSelectMessageForProbability = useCallback((id: string) => {
        setSelectedProbabilityMessageId(id);
        setIsAdvancedAnalyticsOpen(true);
        handleCalculateAIProbabilities(id);
    }, [handleCalculateAIProbabilities]);

    const handleCloseJournal = useCallback(() => {
        setJournalState(prev => ({ ...prev, isOpen: false }));
    }, []);

    const handleOpenJournal = useCallback(() => {
        // Open Settings directly to the Journal tab instead of the overlay
        setIsSettingsMenuVisible(true);
        setSettingsInitialTab('journal');
    }, []);

    const handleOpenLiveMarket = useCallback(() => {
        setIsLiveMarketVisible(true);
    }, []);

    const handleOpenVersionHistory = useCallback(() => {
        setIsVersionHistoryVisible(true);
    }, []);

    const handleOpenAnalytics = useCallback(() => {
        setIsAdvancedAnalyticsOpen(true);
    }, []);

    const handleInteract = useCallback(() => {
        setIsAdvancedAnalyticsOpen(false);
    }, []);

    // Journal props were rebuilt per render (fresh array/object identities),
    // which refired ModelPerformanceDashboard's full trade-log rescan on every
    // App render while the journal was open. Memoize on readyProviders so they
    // only change when the provider configuration actually changes.
    const journalEnabledProviders = useMemo(
        () => readyProviders.map(p => p.id),
        [readyProviders]
    );
    const journalSelectedModels = useMemo(
        () => Object.fromEntries(readyProviders.map(p => [p.id, p.selectedModel])),
        [readyProviders]
    );

    // ─── Outcome Autopilot ────────────────────────────────────────────────
    // Register PENDING analyses for automatic SL/TP detection; resolutions
    // surface in the chat via chatContext for inline one-click confirmation.
    const [autopilotResolutions, setAutopilotResolutions] = useState<Record<string, AutopilotResolution>>({});
    const confirmAutopilotRef = useRef<(messageId: string) => void>(() => {});
    const [skillDraftNonce, setSkillDraftNonce] = useState(0);
    useEffect(() => {
        const bump = (): void => setSkillDraftNonce(n => n + 1);
        window.addEventListener('august-skill-drafts', bump);
        return () => window.removeEventListener('august-skill-drafts', bump);
    }, []);
    const approvalItems = useMemo(
        () => collectApprovalItems(messages, autopilotResolutions, activeUsername || undefined),
        [messages, autopilotResolutions, skillDraftNonce, activeUsername],
    );

    useWatchSideEffects({
        messagesRef,
        setConversationHistory,
        setAutopilotResolutions,
        toast,
        confirmAutopilot: confirmAutopilotRef,
        activeUsername,
    });

    // P5: diff ids instead of re-registering every message on every stream
    // chunk — register() re-arms the 60s detection loop, so the old effect
    // perpetually reset the timers while a debate streamed.
    const autopilotRegisteredRef = useRef<Set<string>>(new Set());
    const autopilotLeverageRef = useRef<number>(DEFAULT_LEVERAGE);

    useEffect(() => {
        const leverage = activeConversation?.leverage || DEFAULT_LEVERAGE;
        if (autopilotLeverageRef.current !== leverage) {
            // Leverage changed — re-register everything with the new value.
            autopilotRegisteredRef.current.clear();
            autopilotLeverageRef.current = leverage;
        }

        const trackableIds = new Set<string>();
        messages.forEach(m => {
            const trackable = m.outcome === TradeOutcome.PENDING
                && !!m.analysis
                && m.analysis.direction !== 'Neutral'
                && m.analysis.confidence !== 'Avoid'
                && (m.analysis.direction === 'Long' || m.analysis.direction === 'Short')
                && (m.analysis.entryPoints?.length ?? 0) > 0
                && !!m.analysis.stopLoss;
            if (trackable) {
                trackableIds.add(m.id);
                if (!autopilotRegisteredRef.current.has(m.id)) {
                    OutcomeAutopilotService.register(m.id, m.analysis!, leverage);
                    autopilotRegisteredRef.current.add(m.id);
                }
            } else if (autopilotRegisteredRef.current.has(m.id)) {
                OutcomeAutopilotService.unregister(m.id);
                autopilotRegisteredRef.current.delete(m.id);
            }
        });
        // Messages removed from the conversation entirely.
        for (const id of [...autopilotRegisteredRef.current]) {
            if (!trackableIds.has(id)) {
                OutcomeAutopilotService.unregister(id);
                autopilotRegisteredRef.current.delete(id);
            }
        }
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

    // F6: best-effort backup when the desktop app closes — the unload flush
    // protects the DB, but a fresh snapshot guards against IndexedDB
    // eviction/corruption between the 30-minute auto-backups. Throttled to
    // once per 10 minutes so quick relaunches don't churn backup files.
    const lastExitBackupRef = useRef(0);
    useEffect(() => {
        const onBeforeUnload = () => {
            if (typeof (window as any).electronAPI === 'undefined') return;
            if (Date.now() - lastExitBackupRef.current < 10 * 60 * 1000) return;
            lastExitBackupRef.current = Date.now();
            if (activeUsernameRef.current) {
                // Best-effort: IndexedDB transactions started in beforeunload
                // usually complete in Chromium; a failed write is non-fatal.
                void createBackup(activeUsernameRef.current).catch(() => {});
            }
        };
        window.addEventListener('beforeunload', onBeforeUnload);
        return () => window.removeEventListener('beforeunload', onBeforeUnload);
    }, []);

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
    confirmAutopilotRef.current = handleConfirmAutopilot;

    const runWatchListAction = useCallback((
        conversationId: string,
        action: { type: 'log'; messageId: string; outcome: TradeOutcome.WIN | TradeOutcome.LOSS } | { type: 'autopilot'; messageId: string },
    ) => {
        if (conversationId !== activeConversationId) {
            pendingWatchActionRef.current = action;
            handleLoadConversation(conversationId);
            setIsWatchListVisible(false);
            return;
        }
        if (action.type === 'log') handleInitiateLogTrade(action.messageId, action.outcome);
        else handleConfirmAutopilot(action.messageId);
        setIsWatchListVisible(false);
    }, [activeConversationId, handleConfirmAutopilot, handleInitiateLogTrade, handleLoadConversation]);

    useEffect(() => {
        const pending = pendingWatchActionRef.current;
        if (!pending) return;
        if (!messages.some(m => m.id === pending.messageId)) return;
        pendingWatchActionRef.current = null;
        if (pending.type === 'log') handleInitiateLogTrade(pending.messageId, pending.outcome);
        else handleConfirmAutopilot(pending.messageId);
    }, [messages, handleInitiateLogTrade, handleConfirmAutopilot]);

    const handleDismissAutopilot = useCallback((messageId: string) => {
        OutcomeAutopilotService.dismiss(messageId);
        setAutopilotResolutions(prev => {
            const next = { ...prev };
            delete next[messageId];
            return next;
        });
    }, []);

    // P1-6b: leverage as a primitive — deriving it inside the memo with
    // `activeConversation` in the dep list made chatContext (and therefore
    // every visible MessageItem) re-created on every stream chunk.
    const chatLeverage = parseInt(leverageInput, 10) || activeConversation?.leverage || DEFAULT_LEVERAGE;

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
        activeFrameworks,
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
        leverage: chatLeverage, // Leverage for backtest P&L calculations
        autopilotResolutions, // Outcome autopilot detected resolutions
        onConfirmAutopilot: handleConfirmAutopilot,
        onDismissAutopilot: handleDismissAutopilot,
        onCompareAnalysis: handleCompareAnalysis,
        onViewReasoning: handleViewReasoning,
        onReRunAnalysis: handleReRunAnalysis,
        onResumeDebate: handleResumeDebate,
        onFollowUpTicket: handleFollowUpTicket,
        onForkDebate: handleForkDebate,
        onToggleWatch: (messageId: string) => handleToggleWatch(messageId),
        onReplacementChoice: handleReplacementChoice,
        // Post-mortem "what would I do today?" re-assessment.
        onTodayReassessment: startTodayReassessment,
        todayReassessmentInFlight,
        lensConfig,
    }), [typingMessageState, highlightedAnalysisId, expandedPostMortems, expandedPostMortemImages, savedAnalyses, activeFrameworks, copiedMessageId, modelIdToName, providerNameToId, handleInitiateLogTrade, handleInitiateSkipTrade, handleViewStrategyDetails, handleApplyStrategy, handleSaveAnalysis, handleCopy, handleTypingComplete, handleInitiateUpdateTrade, confidenceCalibration, handleRetryPostMortem, chatLeverage, autopilotResolutions, handleConfirmAutopilot, handleDismissAutopilot, handleCompareAnalysis, handleViewReasoning, handleReRunAnalysis, handleResumeDebate, handleFollowUpTicket, handleForkDebate, handleToggleWatch, handleReplacementChoice, startTodayReassessment, todayReassessmentInFlight, lensConfig]);

    // ... (Rest of component remains unchanged) ...
    const isAnalysisProgressVisible = Boolean(
        loadingMessage || (isAnalysisInProgress && !isPostMortemInProgress),
    );

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
            <UserProfileManager isVisible={isUserModalOpen} onUserSelect={loadUserData} existingUsers={existingUsernames} onImportProfile={handleImportData} onDeleteUser={handleDeleteUser} onClose={() => setIsUserModalOpen(false)} />
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
            {postMortemCandidate && <PostTradeUploadModal candidate={postMortemCandidate} onClose={() => setPostMortemCandidate(null)} onAnalyze={(summaries, urls) => startPostMortemAnalysis(postMortemCandidate, summaries, urls)} visionConfig={visionConfig} onQuotaExceeded={handleQuotaExceeded} />}
            {updateCandidate && <UpdateTradeModal message={updateCandidate} onClose={() => setUpdateCandidate(null)} onConfirm={handleConfirmUpdateTrade} onAutoCapture={handleUpdateAutoCapture} isCapturing={isUpdateAutoCapturing} visionConfig={visionConfig} onQuotaExceeded={handleQuotaExceeded} />}
            {simulatorCandidate && (
                <ScenarioSimulator
                    message={simulatorCandidate}
                    loggedTrades={loggedTrades}
                    leverage={activeConversation?.leverage || DEFAULT_LEVERAGE}
                    onClose={() => setSimulatorCandidate(null)}
                />
            )}
            {/* Per-component Suspense: isolates a suspending lazy overlay from
                the rest of the app. fallback={null} — these overlays mount at
                boot, so their chunks preload during startup; a visible
                full-screen fallback here caused a triple overlay flash on
                every launch. */}
            <React.Suspense fallback={null}>
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
                username={activeUsername || undefined}
                onProfileRestored={(restoredUsername) => { loadUserData(restoredUsername); }}
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
                isStrategiesEnabled={isStrategiesEnabled}
                setIsStrategiesEnabled={setIsStrategiesEnabled}
                memoryConfig={memoryConfig}
                onMemoryConfigChange={(config) => {
                    setMemoryConfig(config);
                    setMemoryModel(config?.selectedModel || '');
                }}
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
                providerConfigsLoaded={providerConfigsLoaded}
                selectedOcrModel={selectedOcrModel}
                onSetOcrModel={handleSetSelectedOcrModel}
                visionModel={visionModel}
                onSetVisionModel={setVisionModel}
                visionConfig={visionConfig}
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
                onOpenJournal={handleOpenJournal}
                settingsInitialTab={settingsInitialTab}
                onSettingsInitialTabConsumed={() => setSettingsInitialTab(undefined)}
                onDeleteTrades={handleDeleteTrades}
                onClearAllTrades={handleClearAllTrades}
                modelIdToName={modelIdToName}
                onUpdateInsights={handleManualInsightsUpdate}
                isSummarizing={isSummaryInProgress}
                currentInsightIds={currentInsightIds}
                onUpdateTradeLeverage={handleUpdateTradeLeverage}
                onUpdateOutcome={handleUpdateTradeOutcome}
                onUpdatePnL={handleUpdateTradePnL}
                finalSummary={finalTradeSummary}
                individualSummaries={tradeSummaries}
                isInsightGenerating={isInsightGenerating}
                insightProgress={insightProgress}
                newlyAddedInsightIds={newlyAddedInsightIds}
                onDeleteInsight={handleDeleteInsight}
                onRewriteInsightsWithAI={handleRewriteInsightsWithAI}
                familyWinRates={familyWinRates}
                enabledProviders={journalEnabledProviders}
                selectedModels={journalSelectedModels}
            />
            </React.Suspense>
            <VisionDataViewer isVisible={isVisionDataVisible} onClose={() => setIsVisionDataVisible(false)} visionData={currentVisionData} />

            {/* Automations: the selected automation's card feed + editor */}
            {automations.viewAutomationId && (() => {
                const config = automations.configs.find(c => c.id === automations.viewAutomationId);
                if (!config) return null;
                return (
                    <div className="fixed inset-0 z-[75] bg-zinc-950 animate-fade-in">
                        <AutomationView
                            config={config}
                            runs={automations.runsByAutomation[config.id] ?? []}
                            isLoadingRuns={false}
                            isRunning={automations.runningAutomationId === config.id}
                            onBack={automations.closeAutomation}
                            onEdit={() => automations.setEditor({ mode: 'edit', automation: config })}
                            onDelete={() => {
                                void confirmDialog({
                                    title: 'Delete this automation?',
                                    message: `"${config.name}" and its ${(automations.runsByAutomation[config.id] ?? []).length} stored runs will be removed.`,
                                    confirmLabel: 'Delete',
                                    destructive: true,
                                }).then(ok => { if (ok) void automations.deleteAutomation(config.id); });
                            }}
                            onRunNow={() => automations.runNow(config)}
                            onToggleEnabled={() => void automations.toggleAutomationEnabled(config.id)}
                            onPauseUntil={(until) => void automations.pauseAutomationUntil(config.id, until)}
                            onRefresh={() => automations.refreshRuns(config.id)}
                            modelIdToName={modelIdToName}
                            onConfirmOutcome={(run, outcome) => {
                                const msg = run.message;
                                if (!msg) return;
                                if (outcome === 'entry_not_hit') {
                                    confirmAutopilotEntryNotHit(msg);
                                } else {
                                    confirmAutopilotOutcome(msg, outcome === 'win' ? TradeOutcome.WIN : TradeOutcome.LOSS);
                                }
                            }}
                        />
                    </div>
                );
            })()}
            <AutomationEditorModal
                isVisible={editorIsOpen}
                initial={editingAutomation}
                modelOptions={automationModelOptions}
                providers={providerConfigs}
                onClose={() => automations.setEditor(null)}
                onSave={(config) => {
                    void automations.saveAutomation(config);
                    automations.setEditor(null);
                }}
                onDelete={editingAutomation
                    ? () => {
                        void automations.deleteAutomation(editingAutomation.id);
                        automations.setEditor(null);
                    }
                    : undefined}
            />


            <Header
                activeUsername={activeUsername}
                saveStatus={saveStatus}
                isAnalysisInProgress={isAnalysisInProgress}
                isPostMortemInProgress={isPostMortemInProgress}
                currentVisionData={currentVisionData}
                isFreshSession={messages.length === 0}
                onOpenVersionHistory={handleOpenVersionHistory}
                isMobileMenuOpen={isMobileMenuOpen}
                mobileMenuRef={mobileMenuRef}
                setIsMobileMenuOpen={setIsMobileMenuOpen}
                setIsVisionDataVisible={setIsVisionDataVisible}
                setJournalState={setJournalState}
                setIsSettingsVisible={setIsSettingsMenuVisible}
                setIsLivePostMortemVisible={setIsLivePostMortemVisible}
                onOpenLiveMarket={handleOpenLiveMarket}
                onDeleteConversation={handleDeleteConversationFromSidebar}
                onDeleteConversations={handleDeleteSelectedConversations}
                isOnline={isOnline}
                pendingQueueCount={pendingQueueCount}
                liveMarketConditions={liveMarketConditions}
                conversations={conversationHistory}
                activeConversationId={activeConversationId}
                onNewConversation={handleStartNewConversation}
                onLoadConversation={handleLoadConversation}
                automations={automations.configs}
                onOpenAutomation={(id) => automations.openAutomation(id)}
                onCreateAutomation={() => automations.setEditor({ mode: 'create' })}
                onOpenWatchList={() => setIsWatchListVisible(true)}
                watchOpenCount={watchedSignals.filter(s => !s.outcome || s.outcome === TradeOutcome.PENDING).length}
                watchOpenR={watchOpenR}
                onOpenApprovals={() => setIsApprovalInboxVisible(true)}
                approvalCount={approvalItems.length}
            />

            {/* Journal overlay — REMOVED: now rendered inside Settings → Journal tab */}
            {/* <React.Suspense fallback={null}>
            <Journal
                isVisible={journalState.isOpen}
                onClose={handleCloseJournal}
                initialTab={journalState.tab}
                initialTradeId={journalState.focusTradeId}
                username={activeUsername || undefined}
                onInitialTradeConsumed={handleReasoningTradeConsumed}
                trades={loggedTrades}
                enabledProviders={journalEnabledProviders}
                selectedModels={journalSelectedModels}
                onDeleteTrades={handleDeleteTrades}
                onClearAllTrades={handleClearAllTrades}
                modelIdToName={modelIdToName}
                onUpdateInsights={handleManualInsightsUpdate}
                isSummarizing={isSummaryInProgress}
                currentInsightIds={currentInsightIds}
                onUpdateTradeLeverage={handleUpdateTradeLeverage}
                onUpdateOutcome={handleUpdateTradeOutcome}
                onUpdatePnL={handleUpdateTradePnL}
                familyWinRates={familyWinRates}
                globalMemory={globalMemory}
                threadSummary={activeConversation?.threadSummary}

                finalSummary={finalTradeSummary}
                individualSummaries={tradeSummaries}
                isLoading={isSummaryInProgress}
                isInsightGenerating={isInsightGenerating}
                insightProgress={insightProgress}
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
            </React.Suspense> */}

            <React.Suspense fallback={null}>
            <StrategySearch isVisible={isStrategySearchVisible} onClose={() => { setIsStrategySearchVisible(false); setStrategyToView(null); }} onApplyStrategy={handleApplyStrategy} onRemoveStrategy={handleRemoveStrategy} providerConfig={readyProviders[0] || moderatorConfig} activeFrameworks={activeFrameworks} defaultFrameworks={DEFAULT_FRAMEWORKS} initialViewStrategy={strategyToView} onQuotaExceeded={handleQuotaExceeded} familyWinRates={familyWinRates} />
            </React.Suspense>
            <SavedAnalyses analyses={savedAnalyses} isVisible={isSavedAnalysesVisible} onClose={() => setIsSavedAnalysesVisible(false)} onDelete={handleDeleteSavedAnalyses} onClearAll={handleClearAllSavedAnalyses} modelIdToName={modelIdToName} ocrModelIdToName={ocrModelIdToName} />
            <React.Suspense fallback={null}>
                <WatchListPanel
                    isVisible={isWatchListVisible}
                    onClose={() => setIsWatchListVisible(false)}
                    signals={watchedSignals}
                    activeConversationId={activeConversationId}
                    autopilotResolutions={autopilotResolutions}
                    onToggleWatch={handleToggleWatch}
                    onLogTrade={(messageId, outcome, conversationId) => runWatchListAction(conversationId, { type: 'log', messageId, outcome })}
                    onOpenSignal={handleOpenWatchedSignal}
                    onConfirmAutopilot={(messageId, conversationId) => runWatchListAction(conversationId, { type: 'autopilot', messageId })}
                />
            </React.Suspense>
            <React.Suspense fallback={null}>
                <ApprovalInbox
                    isVisible={isApprovalInboxVisible}
                    onClose={() => setIsApprovalInboxVisible(false)}
                    items={approvalItems}
                    onAllow={(item) => {
                        if (item.kind === 'skill') {
                            const draft = takeSkillDraft(item.id, activeUsername || undefined);
                            const trade = loggedTrades.find(t => t.id === item.messageId);
                            if (draft && trade) {
                                void ingestCraftedSkill(trade, draft.crafted, activeUsername || 'default');
                                toast.success('Skill saved', draft.crafted.name);
                            } else if (draft) {
                                // Verdict-sourced draft — no closed trade behind it.
                                void ingestCraftedSkillFromDraft(draft.crafted, draft.coin, activeUsername || 'default');
                                toast.success('Skill saved', draft.crafted.name);
                            }
                            return;
                        }
                        handleConfirmAutopilot(item.messageId);
                    }}
                    onDeny={(item) => {
                        if (item.kind === 'skill') {
                            takeSkillDraft(item.id, activeUsername || undefined);
                            return;
                        }
                        handleDismissAutopilot(item.messageId);
                    }}
                    onAlways={(item) => {
                        if (item.coin) setAutoJournalRule(item.coin, 'always', activeUsername || undefined);
                        handleConfirmAutopilot(item.messageId);
                    }}
                    onNever={(item) => {
                        if (item.coin) setAutoJournalRule(item.coin, 'deny', activeUsername || undefined);
                        handleDismissAutopilot(item.messageId);
                    }}
                    onOpen={(item) => {
                        setHighlightedAnalysisId(item.messageId);
                        setIsApprovalInboxVisible(false);
                    }}
                />
            </React.Suspense>
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
                <aside className={`hidden lg:flex flex-col ${isSidebarCollapsed ? 'w-16' : 'w-60'} shrink-0 min-h-0 border-r border-white/10 bg-zinc-950 transition-[width] duration-200 relative`}>
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
                        onDeleteConversations={handleDeleteSelectedConversations}
                        onOpenLiveMarket={handleOpenLiveMarket}
                        onOpenVisionData={() => setIsVisionDataVisible(true)}
                        onOpenJournal={handleOpenJournal}
                        onOpenBotManager={() => setIsBotManagerVisible(true)}
                        onOpenWatchList={() => setIsWatchListVisible(true)}
                        onOpenSettings={() => setIsSettingsMenuVisible(true)}
                        automations={automations.configs}
                        onOpenAutomation={(id) => automations.openAutomation(id)}
                        onCreateAutomation={() => automations.setEditor({ mode: 'create' })}
                        collapsed={isSidebarCollapsed}
                    />
                </aside>

                <main
                    className={`flex-1 flex flex-col min-h-0 min-w-0 relative transition-[margin,padding] duration-200 ${isAnalysisProgressVisible ? 'lg:mr-[21rem] lg:px-8 xl:px-16' : ''}`}
                >
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
                regimeProviderStats={regimeProviderStats}
                onSelectMessageForProbability={handleSelectMessageForProbability}
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
                steeringNotes={steeringNotes}
                onRemoveSteeringNote={handleRemoveSteeringNote}
                isPostMortemInProgress={isPostMortemInProgress}
                setIsLivePostMortemVisible={setIsLivePostMortemVisible}
                handleCancelAnalysis={handleCancelAll}
                onRetryFailedRun={handleRetryFailedRun}
                onEditUserMessage={handleEditUserMessage}
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
                moderatorProviderId={moderatorProviderId}
                moderatorModel={moderatorModel}
                onSetModeratorProvider={handleSetModeratorProvider}
                onSetModeratorModel={handleSetModeratorModel}
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
                onOpenSettings={(tab) => { setSettingsInitialTab(tab || 'models'); setIsSettingsMenuVisible(true); }}
                onOpenLiveMarket={handleOpenLiveMarket}
                homeDashboard={homeDashboard}
                onInteract={handleInteract}
            />
                </main>

                {/* Desktop activity card: float progress over the right side so
                    the conversation keeps its full width while the run is live. */}
                {isAnalysisProgressVisible && (
                    <div className="pointer-events-none fixed right-4 top-24 z-40 hidden w-[min(20rem,calc(100vw-2rem))] max-h-[calc(100vh-7rem)] lg:block">
                        <div className="pointer-events-auto h-fit max-h-[calc(100vh-7rem)] overflow-y-auto rounded-2xl border border-white/10 bg-zinc-950 p-3 custom-scrollbar" aria-label="Analysis progress">
                            <div className="flex items-center justify-between px-1 pb-3">
                                <div>
                                    <h2 className="text-sm font-medium text-zinc-200">Analysis</h2>
                                    <p className="mt-0.5 text-[11px] text-zinc-500">Pipeline</p>
                                </div>
                                <span className="flex items-center gap-1.5 rounded-full bg-cyan-500/10 px-2 py-1 text-[10px] font-medium text-cyan-300">
                                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400" aria-hidden="true" />
                                    {isPostMortemInProgress ? 'Post-mortem' : 'Running'}
                                </span>
                            </div>

                            {analysisSteps && analysisSteps.length > 0 ? (
                                <AnalysisProgress
                                    steps={analysisSteps}
                                    isActive={!!loadingMessage || isAnalysisInProgress}
                                    onCancel={handleCancelAnalysis}
                                    embedded
                                    isPostMortem={isPostMortemInProgress}
                                    isPostMortemInProgress={isPostMortemInProgress}
                                    onOpenPostMortem={() => setIsLivePostMortemVisible(true)}
                                    />
                            ) : (
                                <div className="rounded-2xl border border-white/10 bg-zinc-900/60 p-4">
                                    <div className="flex items-center gap-2 text-sm text-zinc-300" aria-live="polite">
                                        <span className="h-2 w-2 animate-pulse rounded-full bg-cyan-400" aria-hidden="true" />
                                        {loadingMessage || 'Analysis in progress'}
                                    </div>
                                    <button
                                        type="button"
                                        onClick={handleCancelAnalysis}
                                        className="status-surface mt-4 w-full rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-300 transition-colors hover:bg-rose-500/20"
                                    >
                                        Stop generating
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                )}

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
                        onClose={closeCompare}
                    />
                </React.Suspense>
            )}
            <BotManagerDrawer open={isBotManagerVisible} onClose={() => setIsBotManagerVisible(false)} />
        </div>
        </React.Suspense>
    );
};

export default App;
