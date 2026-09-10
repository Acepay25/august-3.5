
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { VirtuosoHandle } from 'react-virtuoso';
import { reapplyIdleMotionClass } from './services/desk/idleMotion';

// Apply the user's persisted idle-motion preference to <body> on app
// startup so the desk view mounts with the correct class.
reapplyIdleMotionClass();
import { Message, MessageRole, TradeOutcome, ImageMetadata, AIProvider, UserProfile, SavedAnalysis, TradeSummary, CustomInstructionsMap, AnalystLensConfig, LoggedTrade, SetupWatch, SetupWatchTriggerEvent } from './types';
import * as ensembleService from './services/providers/ensembleService';
import { generateFinalSummary } from './services/providers/GenericAnalysisService';
import * as dbService from './services/infrastructure/dbService';
import { subscribeMemoryFilesChanged, syncPatternMemory } from './services/learning/MemoryFilesService';
import { runNotebookReview } from './services/learning/MemoryReviewService';
import { useUserProfileLoader } from './hooks/useUserProfileLoader';
import { useTradeJournalActions } from './hooks/useTradeJournalActions';
import { useProfilePersistence } from './hooks/useProfilePersistence';
import { useConversationHousekeeping } from './hooks/useConversationHousekeeping';
import { useLensAndEnsembleConfig } from './hooks/useLensAndEnsembleConfig';
import { useAgentThreads } from './hooks/useAgentThreads';
import { useWatchAndAutopilot } from './hooks/useWatchAndAutopilot';
import { useFloorProjection } from './hooks/useFloorProjection';
import { computeRegimeProviderStats } from './services/learning/SetupMemoryService';
import { AnalystRole } from './types/enums';
import { BotRegistry } from './services/bots/BotRegistry';
import { defaultToolsForRole } from './types/bot';
import { ProbabilityEngineService } from './services/analysis/ProbabilityEngineService';


// Modular Imports
import { ChatContextProps } from './components/chat/MessageItem';
import { useToastActions } from './components/shared/Toast';
import { FORGED_PROPOSAL_EVENT } from './services/tools/toolForge';
import { AMENDMENT_EVENT } from './services/learning/memoryAmendments';
import { useConfirmDialog } from './components/shared/ConfirmDialog';
import { OnboardingCard } from './components/shared/OnboardingCard';
import { Header } from './components/shared/Header';
import { SidebarContent } from './components/shared/Sidebar';
import { ChatArea } from './components/chat/ChatArea';
import { useProviderConfigs } from './hooks/useProviderConfigs';
import { useAppSettings } from './hooks/useAppSettings';
import { useJournalUI } from './hooks/useJournalUI';
import { useAutomations } from './hooks/useAutomations';
import type { AutomationConfig } from './types/automation';
import { useCompareRuns } from './hooks/useCompareRuns';
import { useConversationLeverage } from './hooks/useConversationLeverage';
import { useCatalogReconcile } from './hooks/useCatalogReconcile';
import AutomationView from './components/automation/AutomationView';
import AutomationEditorModal, { ModelOption } from './components/automation/AutomationEditorModal';
import { ChevronLeftIcon, ChevronRightIcon, ChevronDownIcon, CloseIcon } from './components/shared/Icons';
import BotManagerDrawer from './components/bots/BotManagerDrawer';

// Lazy-load heavy, conditionally-rendered components so the initial
// bundle stays small. Previously the entire app was one ~1.73 MB chunk.
// Each lazy() call below produces a separate chunk loaded on demand when
// the user opens the corresponding panel/modal. ChatArea and Header stay
// eager (always-rendered, critical path).
const StrategySearch = React.lazy(() => import('./components/shared/StrategySearch'));
const UserProfileManager = React.lazy(() => import('./components/settings/UserProfileManager'));
const SavedAnalyses = React.lazy(() => import('./components/journal/SavedAnalyses'));
const WatchListPanel = React.lazy(() => import('./components/analysis/WatchListPanel'));
const ApprovalInbox = React.lazy(() => import('./components/analysis/ApprovalInbox'));
const JobsDrawer = React.lazy(() => import('./components/settings/JobsDrawer'));
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
const StrategyStudio = React.lazy(() => import('./components/dashboards/StrategyStudio'));
const TradeView = React.lazy(() => import('./components/trade/TradeView'));
const MistakeWarningBanner = React.lazy(() => import('./components/shared/MistakeWarningBanner'));
const DeskScene = React.lazy(() => import('./components/desk/DeskScene'));
const AgentRosterRail = React.lazy(() => import('./components/chat/AgentRosterRail'));
const FloorScene = React.lazy(() => import('./components/floor/FloorScene'));
const NewBotDialog = React.lazy(() => import('./components/chat/NewBotDialog'));
const NewGroupDialog = React.lazy(() => import('./components/chat/NewGroupDialog'));
const GroupChatView = React.lazy(() => import('./components/chat/GroupChatView'));
const CoachThreadPanel = React.lazy(() => import('./components/chat/CoachThreadPanel'));
const ThreadTabs = React.lazy(() => import('./components/chat/ThreadTabs'));
import CommandPalette, { PaletteAction } from './components/shared/CommandPalette';
import AnalysisProgress from './components/analysis/AnalysisProgress';
import { DEFAULT_FRAMEWORKS } from './constants/models';
import { buildModelIdToName, buildProviderNameToId, getFirstReadyProvider, formatModelDisplayName } from './utils/providerUtils';
import { createNewConversation, DEFAULT_LEVERAGE, findReusableEmptyConversation } from './utils/conversationUtils';
import { recalculateAnalysisMetrics } from './utils/analysisUtils';
import { parseAppHash, serializeAppHash } from './utils/appHash';
import { collectWatchedSignals, toggleWatchOnMessage } from './utils/watchList';
import { collectApprovalItems, setAutoJournalRule, type ApprovalItem } from './utils/approvalInbox';
import { type ThreadSelection, threadForProvider, markThreadOpened, loadThreadOpenedMap, saveThreadOpenedMap } from './utils/agentThreads';
import {
    getBots, getGroups, saveBot, saveGroup, updateBot, updateGroup, removeBot, removeGroup, subscribeAgentRoster,
    findBotById, groupDisplayName, newId,
    type AgentBot, type AgentGroup,
} from './services/agents/agentRoster';
import { useAgentGroups } from './hooks/useAgentGroups';
import { useBotMailbox, type UseBotMailboxResult } from './hooks/useBotMailbox';
import { buildBotSystemPrompt } from './services/agents/botMailbox';
import { classifyBotAttention } from './services/agents/botAttention';
import { readBotSystemMarkdown, readBotMemoryMarkdown } from './services/bots/BotMemoryService';
import { takeSkillDraft, tombstoneSkillDraftKey, draftTriggerKey, type SkillDraft } from './utils/skillDrafts';
import { listLearningProposals } from './utils/learningQueue';
import { ingestCraftedSkill, ingestCraftedSkillFromDraft } from './services/learning/SkillMemoryService';
import { buildRiskBook, formatRiskBookBadge } from './utils/riskBook';
import { reconstructOpenings } from './utils/debateResume';
import { isEnsembleMessage, stageActorsForMessage, exchangesForTurns, convictionsFromTurns, livePhaseForMessage } from './utils/debateStageActors';
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
import { getPreference, setPreference, removePreference, getPreferenceObject, setPreferenceObject, PREF_KEYS } from './services/infrastructure/PreferencesService';
// AI Learning Services - Adaptive Learning, Mistake Patterns, Insight Extraction
import * as MemoryService from './services/learning/MemoryService';
import { insightTextForTrade } from './utils/tradeInsightBrief';
import { ProviderConfig } from './types/provider';
import { saveLensConfig, saveEnsembleModelSelection, loadLastModeratorPick, saveLastModeratorPick, EnsembleModelSelection, saveCustomEnsemblePrompt, saveCustomLensPrompts } from './services/ui/AnalystLensService';
import { isProviderOnCooldown, providerCooldownRemainingMs, getProviderHealth } from './services/infrastructure/ProviderHealthService';
import { deriveSeatWireStates } from './utils/floorSeatWire';
import { listHarnessLessons } from './services/learning/harnessLessons';
import { assessSession } from './services/validation/SessionGuardService';
import { getHarnessSettings, getSessionGuardConfig } from './utils/harnessSettings';
import { stopAutoBackup, createBackup } from './services/infrastructure/BackupService';
import { storageService } from './services/infrastructure/StorageService';
import { PriceAlertService } from './services/ui/PriceAlertService';
import { SetupWatchService, describeWatchTrigger } from './services/ui/SetupWatchService';
import { OutcomeAutopilotService, AutopilotResolution } from './services/ui/OutcomeAutopilotService';
import { useWatchSideEffects } from './hooks/useWatchSideEffects';
import { useUiMode } from './hooks/useUiMode';
import { useSurface, type AppSurface } from './hooks/useSurface';
import NavRail from './components/shell/NavRail';
import { Journal } from './components/journal/Journal';
import { useSidebarPane } from './hooks/useSidebarPane';
import { useModelCatalogRefresh } from './hooks/useModelCatalogRefresh';
import type { FloorPosition, FloorSquawkEvent } from './components/floor/FloorScene';
import { getThinkingTradeId, updateThinkingOutcome, deleteThinkingByTrade } from './services/infrastructure/ThinkingStoreService';
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
    /** Background-jobs drawer (status-stack pattern). */
    const [isJobsDrawerVisible, setIsJobsDrawerVisible] = useState(false);
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

    // Background model-catalog refresh: every dropdown (composer, bots,
    // team seats, automations) stays on the provider's CURRENT model list —
    // a quiet boot + 6h sweep merges freshly discovered ids per provider.
    useModelCatalogRefresh(providerConfigs, handleUpdateProvider);

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
    // analyst, so the moderator debated itself. A benched provider (P4
    // cooldown: ≥3 persisted errors in 15 min) is skipped even when the
    // user picked it — a failing moderator sinks every run's verdict.
    const moderatorConfig: ProviderConfig = useMemo(() => {
        const selected = readyProviders.find(p => p.id === moderatorProviderId);
        if (selected && !isProviderOnCooldown(selected.id)) return selected;
        if (selected) {
            const remainingMin = Math.ceil(providerCooldownRemainingMs(selected.id) / 60000);
            console.warn(`[Moderator] ${selected.name} benched (error cooldown, ~${remainingMin}m left) — using a fallback moderator this run.`);
        }
        const analystIds = new Set(
            (lensConfig?.assignments ?? []).map(a => a.assignedProvider).filter(Boolean)
        );
        const nonAnalystModerator = readyProviders.find(p => !analystIds.has(p.id) && !isProviderOnCooldown(p.id));
        if (nonAnalystModerator) {
            console.warn('[Moderator] No moderator selected — fell back to', nonAnalystModerator.name);
            return nonAnalystModerator;
        }
        return readyProviders.find(p => !isProviderOnCooldown(p.id)) || (() => {
            // Every ready provider is benched: the run still
            // needs a moderator, but say so loudly instead of silently.
            if (readyProviders.length > 0) console.warn('[Moderator] ALL providers are on error cooldown — using the first ready one anyway.');
            return readyProviders[0];
        })() || {
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
    // Chat vs floor presentation mode (see hooks/useUiMode.ts).
    const { uiMode, setUiMode, toggleUiMode } = useUiMode();
    // Minara arrangement: top-level surfaces chosen from the icon rail
    // (hooks/useSurface.ts). Floor remains a presentation mode INSIDE chat.
    const { surface, setSurface } = useSurface();
    // Unified sidebar pane (sessions | bots | terminal) — the BOTS tab
    // embeds the roster rail; floor mode hides the roster (below).
    const { sidebarPane, setSidebarPane } = useSidebarPane();
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
    });
    // (i/n) progress for the manual insight-generation loops (App only shows
    // a boolean spinner otherwise; a 50-trade rewrite runs for minutes).
    const [insightProgress, setInsightProgress] = useState<{ done: number; total: number } | null>(null);
    const appRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const virtuosoRef = useRef<VirtuosoHandle>(null);
    const mobileMenuRef = useRef<HTMLDivElement>(null);

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

    // ─── Bot Mode — pipeline bridge ────────────────
    // The pipeline is instantiated above the roster state, so it reads the
    // active bot + dispatches replies through refs assigned during render
    // (same pattern as handleSendMessageRef / loggedTradesRef).
    const botThreadStateRef = useRef<{ thread: ThreadSelection; bots: AgentBot[] }>({
        thread: { kind: 'coach' },
        bots: [],
    });
    const mailboxRef = useRef<UseBotMailboxResult | null>(null);
    const getActiveBotForPipeline = useCallback(() => {
        const { thread, bots: roster } = botThreadStateRef.current;
        if (thread.kind !== 'bot') return null;
        const bot = roster.find(b => b.id === thread.botId);
        if (!bot) return null;
        return {
            id: bot.id,
            name: bot.name,
            providerId: bot.providerId,
            modelId: bot.modelId,
            systemPrompt: buildBotSystemPrompt(bot, {
                persona: readBotSystemMarkdown(bot.id),
                notes: readBotMemoryMarkdown(bot.id),
                teammates: roster,
            }),
        };
    }, []);
    const handleBotReplyForPipeline = useCallback((messageId: string, rawText: string): void => {
        const { thread, bots: roster } = botThreadStateRef.current;
        if (thread.kind !== 'bot') return;
        const bot = roster.find(b => b.id === thread.botId);
        if (!bot) return;
        // User-initiated turn: its DMs start a fresh chain at hop 0.
        mailboxRef.current?.dispatchFromBotReply(bot, messageId, rawText, 0);
    }, []);

    // Analysis pipeline state, refs, and handlers (extracted to hooks/useAnalysisPipeline.ts)
    const {
        input, setInput,
        composerMode, setComposerMode,
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
        handleSteerSeat,
        handleStopSeat,
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
        getActiveBot: getActiveBotForPipeline,
        onBotReply: handleBotReplyForPipeline,
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

    // Session-guard verdict (Batch 2): deterministic day-P&L/trade-cap/streak
    // state over the journal — drives the composer banner and is injected
    // into the debate context so the moderator weighs it when grading.
    const sessionGuard = useMemo(
        () => assessSession(loggedTrades, getHarnessSettings().equityUsd, getSessionGuardConfig()),
        [loggedTrades],
    );

    // Toggling Trade on no longer warns about missing setup — incomplete
    // teams surface as chat bubbles when a run is actually attempted
    // (useAnalysisPipeline). Toggling off clears attached charts — they are
    // only analyzed in ensemble mode.
    const handleSetEnsembleEnabled = useCallback((enabled: boolean) => {
        setIsEnsembleEnabled(enabled);
        if (!enabled) setImages([]);
    }, [setImages]);

    // Mirror the (later-declared) activeUsername into a ref so the
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
        // a ref (not the raw string) is passed because usePostMortem
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
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isMobileMenuOpen]);

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

    const resetAppStateRef = useRef<((usernameToSave?: string | null) => Promise<void>) | null>(null);
    const resetAppState = useCallback((usernameToSave?: string | null) => {
        return resetAppStateRef.current ? resetAppStateRef.current(usernameToSave) : Promise.resolve();
    }, []);

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
        // live roster snapshot getter — App's bot state is declared
        // below this hook, and a cron fire must see the CURRENT roster.
        bots: () => getBots(),
        messagesRef,
        // Routine replies may carry [[dm:@…]] markers (pre-validated by the
        // pure half) — deliver them through the mailbox like any turn.
        onBotRoutineDMs: envelopes => {
            const roster = getBots();
            for (const env of envelopes) {
                const from = roster.find(b => b.id === env.fromBotId);
                if (from) mailboxRef.current?.deliverDM(env, from);
            }
        },
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

    // Track the previous active user in a ref mutated by this
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
            // Stop the old user's backup scheduler; loadUserData starts
            // a fresh one for the new user.
            if (previous !== null) stopAutoBackup();
            // No AI response cache exists to clear (removed). Only tool/data
            // caches remain, which are in-memory and never persist across
            // users or reloads.
        }
        previousUsernameRef.current = current;
    }, [activeUsername]);

    // Final cleanup — stop the auto-backup scheduler when the app unmounts.
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
    // Strategy Studio — the browse/annotate surface for the playbook library.
    // Strategy Studio moved to a surface (useSurface) — no overlay flag.

    // ─── Desk view (opt-in overlay projecting the current debate) ──────────
    const [isDeskSceneOpen, setIsDeskSceneOpen] = useState(false);

    // Chat-mode agent roster (extracted to hooks/useAgentThreads.ts):
    // bots/groups state + subscription, thread selection, unread badges,
    // and roster CRUD with confirm dialogs.
    const {
        activeThread, setActiveThread,
        threadOpenedMap,
        bots, groups,
        isNewBotOpen, setIsNewBotOpen,
        isNewGroupOpen, setIsNewGroupOpen,
        groupEditTarget, setGroupEditTarget,
        selectBotThread, selectGroupThread,
        createBot, createGroup, updateGroupMembers,
        deleteBot, deleteGroup,
    } = useAgentThreads({
        activeUsername, setSelectedChatModel, setIsEnsembleEnabled, confirmDialog,
    });


    // ─── Groups ARE the debate room (Team/group merge) ─────────────────
    // Opening a group re-arms the ensemble with the room's members
    // (selectGroupThread). Personas ride the MEMBER bots; no separate
    // team store, no seat activation — one room concept.

    // Group runner: one prompt fans out to the members serially.
    const appendGroupMessage = useCallback((msg: Message) => {
        updateMessages(prev => [...prev, msg]);
    }, [updateMessages]);
    const patchGroupMessage = useCallback((id: string, patch: Partial<Message>) => {
        updateMessages(prev => prev.map(m => (m.id === id ? { ...m, ...patch } : m)));
    }, [updateMessages]);
    const { workingBotId, isRunning: groupRunning, activity, runGroupThread, cancelRun: cancelGroupRun } = useAgentGroups({
        providerConfigs,
        appendMessage: appendGroupMessage,
        patchMessage: patchGroupMessage,
        username: activeUsername,
        // Hybrid Intelligence room toggle: shares the main hybrid
        // switch — the same live-data gate the debate pipeline uses.
        hybridEnabled: isHybridIntelligenceEnabled,
    });
    const toggleGroupHybrid = useCallback(() => {
        setIsHybridIntelligenceEnabled(v => !v);
    }, [setIsHybridIntelligenceEnabled]);
    // ─── Bot Mode — teammate DMs ────────────────────
    // Per-target serial queues; a DM runs the target bot's turn (persona +
    // notes + teammate protocol) and its reply's [[dm:@…]] markers deliver
    // the next hop or wake the sender with a notice. The pipeline bridge
    // (getActiveBotForPipeline / handleBotReplyForPipeline) reads through
    // these refs, which are assigned during render below.
    const mailbox = useBotMailbox({
        bots,
        providerConfigs,
        username: activeUsername,
        messagesRef,
        appendMessage: appendGroupMessage,
        patchMessage: patchGroupMessage,
        // Same live-data gate the rooms use: with Hybrid Intelligence ON,
        // a bot in its own thread reasons over live prices too.
        hybridEnabled: isHybridIntelligenceEnabled,
    });
    mailboxRef.current = mailbox;
    botThreadStateRef.current = { thread: activeThread, bots };
    // Rail working-pulse merge: the group runner owns the pulse first; a
    // draining DM queue shows the (first) busy bot when nothing else runs.
    const dmWorkingBotId = mailbox.dmBusyBotIds[0] ?? null;
    // needs-attention — classify each bot against
    // the live configs + provider health so the rail row says WHY a bot
    // can't work (missing key/model, auth, quota, benched) instead of the
    // user discovering it through a silent failure.
    const attentionMap = useMemo(() => {
        const out: Record<string, string> = {};
        for (const b of bots) {
            const a = classifyBotAttention(b, providerConfigs);
            if (a) out[b.id] = a.hint;
        }
        return out;
    }, [bots, providerConfigs]);
    // wire the automations hook to the Bot Mode
    // half — bot-scoped routines append their reply row through the same
    // message store as DM turns (App's roster state lives below useAuto-
    // mations, so bots are handed as a live getter instead of a value).
    useEffect(() => {
        automations.assignAutomationsBridge({ appendMessage: appendGroupMessage });
    }, [automations.assignAutomationsBridge, appendGroupMessage]);
    // bot → its bot-scoped routines (rail disclosure), plus the Run-now
    // handler that routes through the same engine as the scheduler.
    const botRoutinesMap = useMemo(() => {
        const out: Record<string, AutomationConfig[]> = {};
        for (const c of automations.configs) {
            if (!c.botId) continue;
            (out[c.botId] ??= []).push(c);
        }
        return out;
    }, [automations.configs]);
    const runRoutineFromRail = useCallback((config: AutomationConfig) => {
        automations.runNow(config);
    }, [automations.runNow]);
    const sendGroupThread = useCallback((prompt: string) => {
        if (activeThread.kind !== 'group') return;
        const group = groups.find(g => g.id === activeThread.groupId);
        if (group) void runGroupThread(group, prompt, bots);
    }, [activeThread, groups, bots, runGroupThread]);
    // Reply in thread: a direct @everyone round into the SAME room —
    // members' incremental context (lastSeenIndex) already carries the
    // prior thread, so the round continues it in place. Same shape as a
    // new-thread send; GroupChatView gates the affordance on this prop.
    const sendGroupReply = useCallback((prompt: string) => {
        if (activeThread.kind !== 'group') return;
        const group = groups.find(g => g.id === activeThread.groupId);
        if (group) void runGroupThread(group, prompt, bots);
    }, [activeThread, groups, bots, runGroupThread]);
    // The visible bot for ChatArea's scoped thread view.
    const visibleBot = useMemo(() => {
        if (activeThread.kind !== 'bot') return null;
        const bot = findBotById(bots, activeThread.botId);
        return bot ? { providerId: bot.providerId, modelId: bot.modelId, name: bot.name, avatar: bot.avatar } : null;
    }, [activeThread, bots]);
    const activeGroup = useMemo(() => (
        activeThread.kind === 'group' ? groups.find(g => g.id === activeThread.groupId) ?? null : null
    ), [activeThread, groups]);
    // Stable handlers for the memoized GroupChatView — inline arrows here
    // would defeat the memo on every App render.
    const handleEditActiveGroup = useCallback(() => {
        if (!activeGroup) return;
        setGroupEditTarget(activeGroup);
        setIsNewGroupOpen(true);
    }, [activeGroup]);
    const handleDeleteActiveGroup = useCallback(() => {
        if (!activeGroup) return;
        deleteGroup(activeGroup.id);
    }, [activeGroup, deleteGroup]);
    // External open-actor request: when the desk view's seat is clicked,
    // we publish {messageId, actorId} + bump a nonce so the matching
    // MessageItem mirrors the actor into its local side-panel state and
    // the per-message DebateSidePanel pops. Clicking another seat (or
    // re-clicking the same seat) bumps the nonce to re-fire the effect.
    const [externalOpenActor, setExternalOpenActor] = useState<{ messageId: string; actorId: string } | null>(null);
    const [externalOpenActorNonce, setExternalOpenActorNonce] = useState(0);

    // The debate the desk view projects: the message currently debating, else
    // the most recent ensemble message. Actors derive through the SAME builder
    // MessageItem uses, so the desk view never drifts from the transcript.
    const deskSceneMessage = useMemo(() => {
        const debating = messages.find(m => m.isDebating);
        if (debating) return debating;
        for (let i = messages.length - 1; i >= 0; i--) {
            const m = messages[i];
            if (isEnsembleMessage(m) || (m.debateTurns?.length ?? 0) > 0) return m;
        }
        return null;
    }, [messages]);
    const deskSceneActors = useMemo(
        () => (deskSceneMessage ? stageActorsForMessage(deskSceneMessage) : []),
        [deskSceneMessage],
    );
    // The desk view renders the same exchanges, sealed convictions, and
    // run-contract stages the in-transcript DebateStage renders. Building
    // them from the shared helpers keeps the room and the transcript
    // perfectly aligned — one source of truth.
    const deskSceneExchanges = useMemo(
        () => (deskSceneMessage
            ? exchangesForTurns(deskSceneMessage.debateTurns ?? deskSceneMessage.postMortemDebateTurns ?? [])
            : []),
        [deskSceneMessage],
    );
    const deskSceneConvictions = useMemo(
        () => (deskSceneMessage
            ? convictionsFromTurns(deskSceneMessage.debateTurns ?? deskSceneMessage.postMortemDebateTurns ?? [])
            : []),
        [deskSceneMessage],
    );
    const deskScenePhase = useMemo(
        () => (deskSceneMessage ? livePhaseForMessage(deskSceneMessage) : undefined),
        [deskSceneMessage],
    );
    const deskSceneStages = useMemo(
        () => (deskSceneMessage?.isDebating ? deskSceneMessage.runContract : undefined),
        [deskSceneMessage],
    );
    const deskSceneVerdictDetail = useMemo(() => {
        const a = deskSceneMessage?.analysis;
        if (!a) return undefined;
        return {
            direction: a.direction,
            confidence: a.confidence,
            grade: (a as { grade?: string | null }).grade ?? null,
            review: a.verdictReview,
        };
    }, [deskSceneMessage]);

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
            const anyOverlayOpen = isSettingsMenuVisible || isLiveMarketVisible || isCommandPaletteOpen || isSavedGalleryOpen || isUserModalOpen || isAdvancedAnalyticsOpen || isVisionDataVisible || isStrategySearchVisible || isSavedAnalysesVisible || isVersionHistoryVisible || isWatchListVisible || isApprovalInboxVisible || isDeskSceneOpen;
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
    }, [isAnalysisInProgress, isPostMortemInProgress, handleCancelAll, toast, isSettingsMenuVisible, isLiveMarketVisible, isCommandPaletteOpen, isSavedGalleryOpen, isUserModalOpen, isAdvancedAnalyticsOpen, isVisionDataVisible, isStrategySearchVisible, isSavedAnalysesVisible, isVersionHistoryVisible, isWatchListVisible, isApprovalInboxVisible, isDeskSceneOpen]);

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
            // Ctrl/Cmd+Shift+F toggles chat ↔ floor mode (useUiMode's
            // toggle is a stable callback, so a [] dep list is safe).
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
                e.preventDefault();
                toggleUiMode();
            }
            // Alt+1..5 jumps the icon-rail surfaces (Minara nav; Alt keeps
            // the browser/Electron Ctrl+number tab-switching intact).
            const SURFACE_KEYS: Record<string, AppSurface> = {
                '1': 'chat', '2': 'trade', '3': 'journal', '4': 'studio', '5': 'agents',
            };
            if (e.altKey && !e.ctrlKey && !e.metaKey && SURFACE_KEYS[e.key]) {
                e.preventDefault();
                setSurface(SURFACE_KEYS[e.key]);
            }
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [toggleUiMode, setSurface]);



    // Profile persistence (extracted to hooks/useProfilePersistence.ts):
    // heavy DATA save, light SETTINGS save, mid-run heartbeat, unload flush.
    useProfilePersistence({
        activeUsername, activeConversationId, setSaveStatus, toast,
        conversationHistory, loggedTrades, savedAnalyses, tradeSummaries,
        finalTradeSummary, globalMemory, insightKnowledgeBase,
        memoryConfig, memoryModel,
        isAnalysisInProgress, isPostMortemInProgress,
        activeFrameworks, summaryCharLimit, summarizationProvider, summarizationModel,
        visionModel, isGlobalMemoryEnabled, isStrategiesEnabled, isEnsembleEnabled,
        isAccuracyModeEnabled, accuracySubMode, customInstructions,
        isPlaybookEnabledInPureAI, isFamiliesEnabledInPureAI, isMemoryEnabledInPureAI,
        isHybridIntelligenceEnabled, isAutoCapturing, isUpdateAutoCapturing,
        isEntryNotHitCapturing, useAlgorithmicSummary, useAlgorithmicInsights,
        confidenceCalibration,
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


    // Lens / ensemble / moderator configuration (extracted to
    // hooks/useLensAndEnsembleConfig.ts): persisted setters, ensemble
    // seeding, and the catalog reconcile.
    const {
        handleSetModeratorProvider,
        handleSetModeratorModel,
        handleSetLensConfig,
        handleConfirmAccuracyMode,
        handleSetEnsembleModelSelection,
        handleSetCustomEnsemblePrompt,
        handleSetCustomLensPrompts,
    } = useLensAndEnsembleConfig({
        setConversationModeratorProvider, setConversationModeratorModel,
        moderatorProviderId, moderatorModel, updateActiveConversation,
        setLensConfig, lensConfig,
        setEnsembleModelSelection, ensembleModelSelection,
        setCustomEnsemblePrompt, setCustomLensPrompts,
        isAccuracyModeEnabled, setIsAccuracyModeEnabled,
        accuracySubMode, setAccuracySubMode, setShowAccuracyModal,
        providerConfigs, providerConfigsLoaded,
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

    const teamBotsSyncRef = useRef<string | null>(null);
    useEffect(() => {
        if (!providerConfigsLoaded) return;
        const key = JSON.stringify({ lens: lensConfig, sel: ensembleModelSelection });
        if (teamBotsSyncRef.current === key) return;
        teamBotsSyncRef.current = key;
        void (async () => {
            const bots = await BotRegistry.list();
            if (bots.length === 0 || bots.length !== 3) return;
            if (lensConfig.enabled) {
                for (const a of lensConfig.assignments) {
                    if (!a.assignedProvider || !a.role) continue;
                    const match = bots.find(b => b.role === a.role);
                    if (!match) continue;
                    const provider = providerConfigs.find(p => p.id === a.assignedProvider);
                    const model = a.assignedModel || provider?.selectedModel || provider?.models[0];
                    if (!model || (match.providerId === a.assignedProvider && match.model === model)) continue;
                    await BotRegistry.upsert({ ...match, providerId: a.assignedProvider, model });
                }
            }
        })();
    }, [providerConfigsLoaded, providerConfigs, lensConfig, ensembleModelSelection]);

    const syncBotsFromTeam = useCallback(async (): Promise<void> => {
        const bots = await BotRegistry.list();
        if (bots.length === 0) return;
        let changed = false;
        if (lensConfig.enabled) {
            for (const a of lensConfig.assignments) {
                if (!a.assignedProvider || !a.role) continue;
                const match = bots.find(b => b.role === a.role);
                if (!match) continue;
                const provider = providerConfigs.find(p => p.id === a.assignedProvider);
                const model = a.assignedModel || provider?.selectedModel || provider?.models[0];
                if (!model || (match.providerId === a.assignedProvider && match.model === model)) continue;
                await BotRegistry.upsert({ ...match, providerId: a.assignedProvider, model });
                changed = true;
            }
        } else {
            for (let i = 0; i < Math.min(bots.length, ensembleModelSelection.length); i++) {
                const e = ensembleModelSelection[i];
                if (!e?.providerId || !e.model) continue;
                const bot = bots[i];
                if (!bot || (bot.providerId === e.providerId && bot.model === e.model)) continue;
                await BotRegistry.upsert({ ...bot, providerId: e.providerId, model: e.model });
                changed = true;
            }
        }
        if (changed) toast.success('Bots synced from Team');
    }, [lensConfig, ensembleModelSelection, providerConfigs, toast]);

    // ToolForge + memory amendments: models can PROPOSE mid-debate; the
    // user only sees them in Settings, so surface each arrival as a toast
    // (the tool result already tells the model it landed as a candidate).
    useEffect(() => {
        const onForged = (e: Event): void => {
            const d = (e as CustomEvent<{ id?: string; name?: string }>).detail;
            toast.warning('New tool proposal', `${d?.name ?? 'A model'} proposed a desk tool — approve or retire it in Settings → Skills → Forged tools.`);
        };
        const onAmendment = (e: Event): void => {
            const d = (e as CustomEvent<{ id?: string; fileName?: string }>).detail;
            toast.warning('Memory correction proposed', `${d?.fileName ?? 'A file'} was flagged by a model — review it in Settings → Memory.`);
        };
        window.addEventListener(FORGED_PROPOSAL_EVENT, onForged);
        window.addEventListener(AMENDMENT_EVENT, onAmendment);
        return () => {
            window.removeEventListener(FORGED_PROPOSAL_EVENT, onForged);
            window.removeEventListener(AMENDMENT_EVENT, onAmendment);
        };
    }, [toast]);

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


    // Journal CRUD handlers (extracted to hooks/useTradeJournalActions.ts)
    const {
        handleDeleteTrades,
        handleClearAllTrades,
        handleManualInsightsUpdate,
        handleDeleteInsight,
        handleRewriteInsightsWithAI,
        handleUpdateTradeLeverage,
        handleUpdateTradeOutcome,
        handleUpdateTradePnL,
        handleRegenerateFinalSummary,
    } = useTradeJournalActions({
        loggedTrades, setLoggedTrades,
        tradeSummaries, setTradeSummaries,
        finalTradeSummary, setFinalTradeSummary,
        loggedTradesRef, activeUsernameRef,
        confirmDialog, toast,
        handleJournalAutoRefresh, regenerateFinalSummaryRef,
        isSummaryInProgress, setIsSummaryInProgress,
        setInsightProgress, setNewlyAddedInsightIds,
        memoryConfig, moderatorConfig, readyProviders,
        useAlgorithmicInsights, summaryCharLimit,
    });

    // Conversation housekeeping (extracted to hooks/useConversationHousekeeping.ts):
    // create/load/delete sessions, edit user messages, Ctrl+N + "/" shortcuts.
    const {
        handleClearAllConversations,
        handleNewConversation,
        handleLoadConversation,
        handleDeleteConversations,
        handleDeleteConversationFromSidebar,
        handleDeleteSelectedConversations,
        handleEditUserMessage,
    } = useConversationHousekeeping({
        conversationHistory, setConversationHistory,
        activeConversation, activeConversationId, setActiveConversationId,
        updateMessages, handleCancelAnalysis, invalidatePostMortemRuns,
        confirmDialog, toast, isCommandPaletteOpen,
    });

    // F3: New conversation (Ctrl/Cmd+N shortcut + palette action).
    // Reuse an existing blank session instead of minting another empty one —
    // "New" from a filled session should return to the unused blank tab.

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



    const confirmAutopilotRef = useRef<(messageId: string) => void>(() => {});

    // Watch list + outcome autopilot (extracted to hooks/useWatchAndAutopilot.ts):
    // pinned-signal derivations and handlers, autopilot registration and
    // resolutions, and the deferred watch-list actions.
    const {
        autopilotResolutions, setAutopilotResolutions,
        handleApprovalShow,
        handleToggleWatch,
        watchedSignals,
        watchOpenR,
        handleFollowUpTicket,
        handlePreReadCommit,
        handleOpenWatchedSignal,
        handleConfirmAutopilot,
        runWatchListAction,
        handleDismissAutopilot,
    } = useWatchAndAutopilot({
        messages, conversationHistory, loggedTrades,
        activeConversationId, activeConversation, updateMessages, messagesRef,
        stableHandleSendMessage, handleLoadConversation,
        setHighlightedAnalysisId, setIsApprovalInboxVisible, setIsWatchListVisible,
        confirmAutopilotOutcome, confirmAutopilotEntryNotHit, handleInitiateLogTrade,
        confirmAutopilotRef, toast,
    });

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
            id: 'floor-mode',
            label: uiMode === 'floor' ? 'Switch to chat mode' : 'Open floor mode',
            hint: 'View',
            run: toggleUiMode,
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
            id: 'strategy-studio',
            label: 'Open Strategy Studio',
            hint: 'Playbook',
            run: () => setSurface('studio'),
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
            id: 'desk-view',
            label: isDeskSceneOpen ? 'Close desk view' : 'Open desk view',
            hint: 'Debate',
            // Opt-in overlay projecting the current debate as a room of seat cards.
            run: () => setIsDeskSceneOpen(v => !v),
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
        // read via messagesRef for a stable identity (see handleSaveAnalysis).
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

    // reads messages via messagesRef (not the `messages` closure) so
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
                    // Entry→TP distances (% of entry) so the decay is
                    // distance-aware instead of a fixed step.
                    const entry = Number(String(msg.analysis.entryPoints?.[0]?.price ?? '').replace(/[$,\s]/g, ''));
                    const tpPct = (msg.analysis.takeProfit ?? [])
                        .map(tp => Number(String(tp.price ?? '').replace(/[$,\s]/g, '')))
                        .filter(p => Number.isFinite(p) && Number.isFinite(entry) && entry > 0)
                        .map(p => Math.abs(p - entry) / entry * 100);
                    const algoProbs = ProbabilityEngineService.calculateAlgoProbabilities(
                        msg.analysis.marketSnapshot,
                        loggedTrades,
                        msg.analysis.direction as 'Long' | 'Short' | 'Neutral',
                        tpPct.length >= 2 ? tpPct : undefined
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

    const {
        loadUserData,
        resetAppState: userProfileResetAppState,
    } = useUserProfileLoader({
        handleCancelAnalysis,
        invalidatePostMortemRuns,
        lensConfig,
        handleSetLensConfig,
        ensembleModelSelection,
        handleSetEnsembleModelSelection,
        persistedEnsembleModeRef,
        ensembleModelCount,
        providerConfigs,
        setConversationHistory,
        setActiveConversationId,
        setLoggedTrades,
        setSavedAnalyses,
        setTradeSummaries,
        setFinalTradeSummary,
        setGlobalMemory,
        setIsGlobalMemoryEnabled,
        setMemoryConfig,
        setMemoryModel,
        setInsightKnowledgeBase,
        setActiveFrameworks,
        setSummaryCharLimit,
        setSummarizationProvider,
        setSummarizationModel,
        setVisionModel,
        setUseAlgorithmicSummary,
        setUseAlgorithmicInsights,
        setIsStrategiesEnabled,
        setIsAccuracyModeEnabled,
        setAccuracySubMode,
        setCustomInstructions,
        setIsPlaybookEnabledInPureAI,
        setIsFamiliesEnabledInPureAI,
        setIsMemoryEnabledInPureAI,
        setIsHybridIntelligenceEnabled,
        setIsEnsembleEnabled,
        setIsAutoCapturing,
        setIsUpdateAutoCapturing,
        setIsEntryNotHitCapturing,
        setConfidenceCalibration,
        setAutopilotResolutions,
        setInput,
        setImages,
        setExpandedPostMortems,
        setHighlightedAnalysisId,
        setIsLoading,
        setActiveUsername,
        setExistingUsernames,
        setIsUserModalOpen,
        toast,
    });
    resetAppStateRef.current = userProfileResetAppState;

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
    // ─── Coach thread ───────────────────────────────────────────────
    // The learning loop's inbox as a conversation: pending skill drafts +
    // queue proposals. The badge counts both; the panel refreshes itself on
    // the same window events, so App only needs the count + selection.
    const [learningQueueNonce, setLearningQueueNonce] = useState(0);
    useEffect(() => {
        const bump = (): void => setLearningQueueNonce(n => n + 1);
        window.addEventListener('august-learning-queue', bump);
        return () => window.removeEventListener('august-learning-queue', bump);
    }, []);
    const coachCount = useMemo(
        () => approvalItems.filter(i => i.kind === 'skill').length
            + listLearningProposals(activeUsername || undefined).length,
        [approvalItems, learningQueueNonce, activeUsername],
    );
    const selectCoachThread = useCallback(() => setActiveThread({ kind: 'coach' }), []);
    const selectTeamThread = useCallback(() => setActiveThread({ kind: 'team' }), []);
    const coachAllowDraft = useCallback((draft: SkillDraft): void => {
        takeSkillDraft(draft.id, activeUsername || undefined);
        const trade = loggedTradesRef.current.find(t => t.id === draft.tradeId);
        if (trade) {
            void ingestCraftedSkill(trade, draft.crafted, activeUsername || 'default');
        } else {
            void ingestCraftedSkillFromDraft(draft.crafted, draft.coin, activeUsername || 'default');
        }
        toast.success('Skill saved', draft.crafted.name);
    }, [activeUsername]);
    const coachDenyDraft = useCallback((draft: SkillDraft): void => {
        takeSkillDraft(draft.id, activeUsername || undefined);
        tombstoneSkillDraftKey(
            draftTriggerKey(draft.coin, draft.crafted),
            activeUsername || undefined,
        );
        toast.success('Skill discarded', 'Similar suggestions paused for 7 days');
    }, [activeUsername]);
    // Floor projection (extracted to hooks/useFloorProjection.ts): gauge
    // stats, positions rail, squawk tape, day PnL, seat wires, tickers,
    // and the seat-click thread opener — all derived from the running
    // conversation and the projected desk message.
    const {
        gaugeStats,
        floorPositions,
        floorSquawk,
        floorDayPnl,
        floorSeatWire,
        floorTickers,
        openSeatChat,
    } = useFloorProjection({
        messages, loggedTrades, approvalItems,
        isAnalysisInProgress, isPostMortemInProgress,
        deskSceneMessage, deskSceneActors, providerNameToId,
        bots, selectBotThread, setActiveThread, setIsEnsembleEnabled, setUiMode,
    });
    // Skill-citation chip tap: open Settings → Skills so the
    // grid mounts and consumes the pending slug (SkillsGrid listens for the
    // same event when already mounted).
    useEffect(() => {
        const onOpenSkill = (): void => {
            setSettingsInitialTab('skills');
            setIsSettingsMenuVisible(true);
        };
        window.addEventListener('august:open-skill', onOpenSkill);
        return () => window.removeEventListener('august:open-skill', onOpenSkill);
    }, []);


    useWatchSideEffects({
        messagesRef,
        setConversationHistory,
        setAutopilotResolutions,
        toast,
        confirmAutopilot: confirmAutopilotRef,
        activeUsername,
    });


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




    /** Shared approval handlers — the Inbox modal AND the
     *  inline cards in the chat flow both route through these. */
    const approvalHandlers = useMemo(() => ({
        allow: (item: ApprovalItem): void => {
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
        },
        deny: (item: ApprovalItem): void => {
            if (item.kind === 'skill') {
                const draft = takeSkillDraft(item.id, activeUsername || undefined);
                if (draft) {
                    tombstoneSkillDraftKey(
                        draftTriggerKey(draft.coin, draft.crafted),
                        activeUsername || undefined,
                    );
                    toast.success('Skill discarded', 'Similar suggestions paused for 7 days');
                }
                return;
            }
            handleDismissAutopilot(item.messageId);
        },
        always: (item: ApprovalItem): void => {
            if (item.coin) setAutoJournalRule(item.coin, 'always', activeUsername || undefined);
            handleConfirmAutopilot(item.messageId);
        },
        never: (item: ApprovalItem): void => {
            if (item.coin) setAutoJournalRule(item.coin, 'deny', activeUsername || undefined);
            handleDismissAutopilot(item.messageId);
        },
    }), [activeUsername, loggedTrades, handleConfirmAutopilot, handleDismissAutopilot, toast]);

    // leverage as a primitive — deriving it inside the memo with
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
        onPreReadCommit: handlePreReadCommit,
        onForkDebate: handleForkDebate,
        onToggleWatch: handleToggleWatch,
        onReplacementChoice: handleReplacementChoice,
        // Per-seat controls: steer or bench one debate seat mid-run.
        onSteerSeat: handleSteerSeat,
        onStopSeat: handleStopSeat,
        // Inline approval cards — MessageItem filters to its own id.
        inlineApprovals: approvalItems,
        onApprovalAllow: approvalHandlers.allow,
        onApprovalDeny: approvalHandlers.deny,
        onApprovalAlways: approvalHandlers.always,
        onApprovalNever: approvalHandlers.never,
        onApprovalShow: handleApprovalShow,
        // Post-mortem "what would I do today?" re-assessment.
        onTodayReassessment: startTodayReassessment,
        todayReassessmentInFlight,
        lensConfig,
        // External open-actor request — the desk view publishes this and
        // the matching MessageItem mirrors the actor into its local
        // side-panel state.
        externalOpenActor,
        externalOpenActorNonce,
        // SessionGuard trade counter — the log-trade strip chip (Batch 2).
        sessionTradeCount: sessionGuard ? {
            tradesToday: sessionGuard.tradesToday,
            maxTradesPerDay: getSessionGuardConfig().maxTradesPerDay,
        } : undefined,
    }), [typingMessageState, highlightedAnalysisId, expandedPostMortems, expandedPostMortemImages, savedAnalyses, activeFrameworks, copiedMessageId, modelIdToName, providerNameToId, handleInitiateLogTrade, handleInitiateSkipTrade, handleViewStrategyDetails, handleApplyStrategy, handleSaveAnalysis, handleCopy, handleTypingComplete, handleInitiateUpdateTrade, confidenceCalibration, handleRetryPostMortem, chatLeverage, autopilotResolutions, handleConfirmAutopilot, handleDismissAutopilot, handleCompareAnalysis, handleViewReasoning, handleReRunAnalysis, handleResumeDebate, handleFollowUpTicket, handlePreReadCommit, handleForkDebate, handleToggleWatch, handleApprovalShow, handleReplacementChoice, startTodayReassessment, todayReassessmentInFlight, lensConfig, handleSteerSeat, handleStopSeat, externalOpenActor, externalOpenActorNonce,
        // The inline-approval surface reads these —
        // missing them froze cards on stale drafts/handlers.
        approvalItems, approvalHandlers, sessionGuard]);

    // ... (Rest of component remains unchanged) ...
    const isAnalysisProgressVisible = Boolean(
        loadingMessage || (isAnalysisInProgress && !isPostMortemInProgress),
    );

    // Pipeline card chrome: the floating card used to be a
    // fixed, unclosable overlay that sat on top of the debate side panel.
    // It can now be collapsed to a slim pill and dismissed for the rest of
    // the run — the Stop control lives in the pill so cancel stays one
    // click away even when the body is hidden. Dismissal resets when the
    // next run starts.
    const [isPipelineCollapsed, setIsPipelineCollapsed] = useState(false);
    const [isPipelineDismissed, setIsPipelineDismissed] = useState(false);
    const wasProgressVisibleRef = useRef(false);
    useEffect(() => {
        if (isAnalysisProgressVisible && !wasProgressVisibleRef.current) {
            setIsPipelineDismissed(false);
            setIsPipelineCollapsed(false);
        }
        wasProgressVisibleRef.current = isAnalysisProgressVisible;
    }, [isAnalysisProgressVisible]);
    const showPipelineCard = isAnalysisProgressVisible && !isPipelineDismissed;

    return (
        // Outer Suspense boundary. fallback={null} so a suspending lazy
        // subtree (e.g. a modal opening) does NOT blank the always-visible
        // chat/header. Per-component Suspense wrappers below isolate suspends.
        <React.Suspense fallback={null}>
        <div ref={appRef} className="flex flex-col bg-zinc-950 text-zinc-100 font-sans h-full overflow-hidden transition-colors duration-500">
            {/* Custom confirm dialog + undo toast (replaces window.confirm) */}
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
                onOpenStrategyStudio={() => { setSurface('studio'); setIsSettingsMenuVisible(false); }}
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
                bots={bots}
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
                onOpenJobs={() => setIsJobsDrawerVisible(true)}
                uiMode={uiMode}
                onSetUiMode={setUiMode}
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
                    onAllow={approvalHandlers.allow}
                    onDeny={approvalHandlers.deny}
                    onAlways={approvalHandlers.always}
                    onNever={approvalHandlers.never}
                    onOpen={(item) => {
                        setHighlightedAnalysisId(item.messageId);
                        setIsApprovalInboxVisible(false);
                    }}
                />
            </React.Suspense>
            {/* Background-jobs drawer — visible autonomy. */}
            <React.Suspense fallback={null}>
                <JobsDrawer open={isJobsDrawerVisible} onClose={() => setIsJobsDrawerVisible(false)} />
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
                {/* Minara arrangement, first column: the surface rail. */}
                <NavRail
                    surface={surface}
                    onSelect={setSurface}
                    onOpenSettings={() => setIsSettingsMenuVisible(true)}
                    username={activeUsername || undefined}
                />
                {surface === 'chat' && (
                    <>
                {/* Dark shell: the rail sits LIGHTER than the page
                    (#141412 over #0b0b0a) with NO dividing border —
                    separation reads from the fill step alone. */}
                <aside className={`hidden lg:flex flex-col ${isSidebarCollapsed ? 'w-16' : 'w-60'} shrink-0 min-h-0 bg-zinc-900 transition-[width] duration-200 relative`}>
                    <button
                        type="button"
                        onClick={() => setIsSidebarCollapsed(prev => !prev)}
                        className="absolute -right-3 top-4 z-30 h-6 w-6 rounded-full bg-zinc-800 text-zinc-500 hover:bg-zinc-700 hover:text-white transition-colors flex items-center justify-center focus-visible:ring-2 focus-visible:ring-cyan-400"
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
                        sidebarPane={sidebarPane}
                        onSetSidebarPane={setSidebarPane}
                        rosterSlot={uiMode === 'chat' ? (
                            <React.Suspense fallback={null}>
                                <AgentRosterRail
                                    variant="embedded"
                                    bots={bots}
                                    groups={groups}
                                    messages={messages}
                                    selection={activeThread}
                                    onSelectBot={selectBotThread}
                                    onSelectGroup={selectGroupThread}
                                    onDeleteBot={deleteBot}
                                    onDeleteGroup={deleteGroup}
                                    onEditGroup={groupId => {
                                        const target = groups.find(g => g.id === groupId);
                                        if (!target) return;
                                        setGroupEditTarget(target);
                                        setIsNewGroupOpen(true);
                                    }}
                                    onNewBot={() => setIsNewBotOpen(true)}
                                    onNewGroup={() => setIsNewGroupOpen(true)}
                                    onSelectCoach={selectCoachThread}
                                    onSelectTeam={selectTeamThread}
                                    coachCount={coachCount}
                                    workingBotId={workingBotId ?? dmWorkingBotId}
                                    lastOpenedMap={threadOpenedMap}
                                    attentionMap={attentionMap}
                                    botRoutines={botRoutinesMap}
                                    onRunRoutine={runRoutineFromRail}
                                />
                            </React.Suspense>
                        ) : null}
                    />
                </aside>

                {/* The standalone chat-mode roster rail was folded into the
                    unified sidebar's BOTS pane (rosterSlot above) — one
                    roster. Teams merged into groups: one room concept. */}

                <main
                    className={`chat-main flex-1 flex flex-col min-h-0 min-w-0 relative transition-[margin,padding] duration-200 ${isAnalysisProgressVisible ? 'lg:mr-[21rem] lg:px-8 xl:px-16' : ''}`}
                >
                    {/* Mistake Warning Banner - Global Risk Reminder */}
                    {loggedTrades.length > 0 && (
                        <React.Suspense fallback={null}>
                        <MistakeWarningBanner
                            tradeLog={loggedTrades}
                        />
                        </React.Suspense>
                    )}

                    {/* First-run onboarding card. Shows when no providers are
                        configured and the user hasn't dismissed it. */}
                    <OnboardingCard
                        hasAnyApiKey={readyProviders.length > 0}
                        onOpenSettings={() => setIsSettingsMenuVisible(true)}
                    />

                    {/* reference-style document tabs — GROUP threads only.
                        Individual bots never appear in the strip: their thread
                        opens directly, chat-style. Hidden outside group threads
                        (bot threads, coach, floor). */}
                    {uiMode === 'chat' && activeThread.kind === 'group' && (
                        <React.Suspense fallback={null}>
                            <ThreadTabs
                                selection={activeThread}
                                bots={bots}
                                groups={groups}
                                onSelectGroup={selectGroupThread}
                            />
                        </React.Suspense>
                    )}

                    {/* Chat body. Bot threads render directly (reference BOT
                        CHAT): no detail landing page, no tab — the reasoning
                        rows + message cards ARE the surface. */}
                    {(activeThread.kind === 'coach' ? (                <div className="min-h-0 flex-1 overflow-y-auto chat-scroll">
                    <React.Suspense fallback={null}>
                        <CoachThreadPanel
                            onAllowDraft={coachAllowDraft}
                            onDenyDraft={coachDenyDraft}
                            onOpenTrade={(tradeId) => {
                                // Jump to the most recent group transcript and
                                // highlight the originating verdict card (trade
                                // ids are message ids — see useTradeLogging).
                                const target = groups[0];
                                setActiveThread(target ? { kind: 'group', groupId: target.id } : { kind: 'coach' });
                                setHighlightedAnalysisId(tradeId);
                            }}
                        />
                    </React.Suspense>
                </div>
            ) : activeGroup ? (
                <React.Suspense fallback={null}>
                    <GroupChatView
                        group={activeGroup}
                        bots={bots}
                        messages={messages}
                        activity={activity}
                        workingBotId={workingBotId}
                        isRunning={groupRunning}
                        onSendThread={sendGroupThread}
                        onReplyInThread={sendGroupReply}
                        onCancelRun={cancelGroupRun}
                        hybridEnabled={isHybridIntelligenceEnabled}
                        onToggleHybrid={toggleGroupHybrid}
                        onEditGroup={handleEditActiveGroup}
                        onDeleteGroup={handleDeleteActiveGroup}
                    />
                </React.Suspense>
            ) : (
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
                sessionGuard={{
                    level: sessionGuard.level,
                    warnings: sessionGuard.warnings,
                    tradesToday: sessionGuard.tradesToday,
                    maxTradesPerDay: getSessionGuardConfig().maxTradesPerDay,
                }}
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
                leverageInput={leverageInput}
                handleLeverageChange={handleLeverageChange}
                handleLeverageBlur={handleLeverageBlur}
                handlePresetLeverage={handlePresetLeverage}
                fileInputRef={fileInputRef}
                isImageUploadDisabled={isImageUploadDisabled}
                handleImageUpload={handleImageUpload}
                input={input}
                setInput={setInput}
                handleSendMessage={handleSendMessage}
                composerMode={composerMode}
                setComposerMode={setComposerMode}
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
                visibleBot={visibleBot}
                bots={bots}
                onSelectBot={selectBotThread}
                onNewBot={() => setIsNewBotOpen(true)}
                homeDashboard={homeDashboard}
                onInteract={handleInteract}
            />
            ))}
                </main>

                {/* Desktop activity card: float progress over the
                    right side so the conversation keeps its width while a run
                    is live. Collapsible + closable so it never traps content
                    underneath; the pill keeps Stop one click away. */}
                {showPipelineCard && (
                    <div className="pointer-events-none fixed right-4 top-24 z-40 hidden w-[min(20rem,calc(100vw-2rem))] max-h-[calc(100vh-7rem)] lg:block">
                        {isPipelineCollapsed ? (
                            /* Collapsed pill: status + expand/dismiss + Stop. */
                            <div className="pointer-events-auto flex h-fit items-center gap-1.5 rounded-full border border-white/10 bg-zinc-950 px-3 py-1.5 shadow-lg" aria-label="Analysis progress (collapsed)">
                                <span className="flex items-center gap-1.5 rounded-full bg-cyan-500/10 px-2 py-0.5 text-[10px] font-medium text-cyan-300">
                                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400" aria-hidden="true" />
                                    Running
                                </span>
                                <button type="button" onClick={() => setIsPipelineCollapsed(false)} className="text-[11px] text-zinc-400 transition-colors hover:text-zinc-100" title="Show pipeline steps">Show</button>
                                <button type="button" onClick={() => setIsPipelineDismissed(true)} className="rounded p-1 text-zinc-500 transition-colors hover:text-zinc-200" title="Hide for this run" aria-label="Dismiss analysis progress">
                                    <CloseIcon className="h-3.5 w-3.5" />
                                </button>
                            </div>
                        ) : (
                        <div className="pointer-events-auto h-fit max-h-[calc(100vh-7rem)] overflow-y-auto rounded-2xl border border-white/10 bg-zinc-950 p-3 custom-scrollbar" aria-label="Analysis progress">
                            <div className="flex items-center justify-between px-1 pb-3">
                                <div>
                                    <h2 className="text-sm font-medium text-zinc-200">Analysis</h2>
                                    <p className="mt-0.5 text-[11px] text-zinc-500">Pipeline</p>
                                </div>
                                <span className="ml-auto flex shrink-0 items-center gap-1">
                                    <span className="flex items-center gap-1 rounded-full bg-cyan-500/10 px-2 py-1 text-[10px] font-medium text-cyan-300">
                                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400" aria-hidden="true" />
                                        {isPostMortemInProgress ? 'Post-mortem' : 'Running'}
                                    </span>
                                    {/* Collapse / dismiss chrome: the card is no longer
                                        unclosable — collapse to the pill or hide it for this run.
                                        The main chat keeps its own Stop control either way. */}
                                    <button
                                        type="button"
                                        onClick={() => setIsPipelineCollapsed(true)}
                                        className="rounded-md p-1 text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-100"
                                        title="Collapse"
                                        aria-label="Collapse analysis progress"
                                    >
                                        <ChevronDownIcon className="h-4 w-4" />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setIsPipelineDismissed(true)}
                                        className="rounded-md p-1 text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-100"
                                        title="Hide for this run"
                                        aria-label="Dismiss analysis progress"
                                    >
                                        <CloseIcon className="h-4 w-4" />
                                    </button>
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
                        )}
                    </div>
                )}
                    </>
                )}

                {/* Non-chat surfaces (Minara arrangement): pages, not modals.
                    Each embeds an existing component — presentation only, no
                    new data paths. */}
                {surface !== 'chat' && (
                    <main className="flex-1 flex flex-col min-h-0 min-w-0 relative bg-zinc-950">
                        {surface === 'trade' && (
                            <React.Suspense fallback={null}>
                                <TradeView
                                    providers={providerConfigs}
                                    selectedChatModel={selectedChatModel}
                                    onSelectChatModel={setSelectedChatModel}
                                />
                            </React.Suspense>
                        )}
                        {surface === 'journal' && (
                            <Journal
                                isVisible={true}
                                onClose={() => setSurface('chat')}
                                initialTab="log"
                                isEmbedded={true}
                                username={activeUsername || undefined}
                                trades={loggedTrades}
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
                                isLoading={isLoading}
                                isInsightGenerating={isInsightGenerating}
                                insightProgress={insightProgress}
                                newlyAddedInsightIds={newlyAddedInsightIds}
                                summarizationProvider={summarizationProvider}
                                summarizationModel={summarizationModel}
                                onSetSummarizationProvider={handleSetSummarizationProvider}
                                onSetSummarizationModel={setSummarizationModel}
                                providers={providerConfigs}
                                summaryCharLimit={summaryCharLimit}
                                onUpdateSummaryCharLimit={handleUpdateSummaryCharLimit}
                                onRegenerateSummary={handleRegenerateFinalSummary}
                                onDeleteInsight={handleDeleteInsight}
                                useAlgorithmicSummary={useAlgorithmicSummary}
                                onToggleAlgorithmicSummary={setUseAlgorithmicSummary}
                                useAlgorithmicInsights={useAlgorithmicInsights}
                                onToggleAlgorithmicInsights={setUseAlgorithmicInsights}
                                onRewriteInsightsWithAI={handleRewriteInsightsWithAI}
                                familyWinRates={familyWinRates}
                                enabledProviders={journalEnabledProviders}
                                selectedModels={journalSelectedModels}
                            />
                        )}
                        {surface === 'studio' && (
                            <React.Suspense fallback={null}>
                                <StrategyStudio
                                    trades={loggedTrades}
                                    username={activeUsername || undefined}
                                    currentRegime={(currentHybridData as { regime?: { regime?: string } } | null)?.regime?.regime}
                                    onClose={() => setSurface('chat')}
                                />
                            </React.Suspense>
                        )}
                        {surface === 'agents' && (
                            <div className="flex h-full min-h-0">
                                <div className="flex w-80 shrink-0 flex-col border-r border-white/[0.06] bg-zinc-900/50">
                                    <React.Suspense fallback={null}>
                                        <AgentRosterRail
                                            variant="embedded"
                                            bots={bots}
                                            groups={groups}
                                            messages={messages}
                                            selection={activeThread}
                                            onSelectBot={(id) => { selectBotThread(id); setSurface('chat'); }}
                                            onSelectGroup={(id) => { selectGroupThread(id); setSurface('chat'); }}
                                            onDeleteBot={deleteBot}
                                            onDeleteGroup={deleteGroup}
                                            onEditGroup={groupId => {
                                                const target = groups.find(g => g.id === groupId);
                                                if (!target) return;
                                                setGroupEditTarget(target);
                                                setIsNewGroupOpen(true);
                                            }}
                                            onNewBot={() => setIsNewBotOpen(true)}
                                            onNewGroup={() => setIsNewGroupOpen(true)}
                                            onSelectCoach={() => { selectCoachThread(); setSurface('chat'); }}
                                            onSelectTeam={() => { selectTeamThread(); setSurface('chat'); }}
                                            coachCount={coachCount}
                                            workingBotId={workingBotId ?? dmWorkingBotId}
                                            lastOpenedMap={threadOpenedMap}
                                            attentionMap={attentionMap}
                                            botRoutines={botRoutinesMap}
                                            onRunRoutine={runRoutineFromRail}
                                        />
                                    </React.Suspense>
                                </div>
                                <div className="hidden flex-1 items-center justify-center md:flex">
                                    <p className="max-w-sm text-center text-sm leading-6 text-zinc-600">
                                        Pick an agent to open its thread, or start a new one from the rail.
                                    </p>
                                </div>
                            </div>
                        )}
                    </main>
                )}

                </div>

            {/* Desk view — opt-in projection of the current debate as a 2D
                room of pixel-art seats. Toggled from the command palette
                ("desk view" action); hidden by default. Projects the same
                debate state the transcript renders. */}
            {isDeskSceneOpen && deskSceneMessage && (
                <React.Suspense fallback={null}>
                    <DeskScene
                        actors={deskSceneActors}
                        caption={deskSceneMessage.analysis?.coinName
                            ? `${deskSceneMessage.analysis.coinName} · ${deskSceneMessage.isDebating ? 'debate in progress' : 'debate floor'}`
                            : (deskSceneMessage.isDebating ? 'Debate in progress' : 'Debate floor')}
                        phase={deskScenePhase}
                        stages={deskSceneStages}
                        exchanges={deskSceneExchanges}
                        convictions={deskSceneConvictions}
                        verdictDetail={deskSceneVerdictDetail}
                        onSteerSeat={handleSteerSeat}
                        onOpenActor={actorId => {
                            // Publish a {messageId, actorId} request so
                            // the matching MessageItem's per-message side
                            // panel opens with this actor selected. Then
                            // close the desk overlay so the trader lands
                            // on the panel.
                            setExternalOpenActor({ messageId: deskSceneMessage.id, actorId });
                            setExternalOpenActorNonce(n => n + 1);
                            setIsDeskSceneOpen(false);
                        }}
                        onClose={() => setIsDeskSceneOpen(false)}
                    />
                </React.Suspense>
            )}

            {/* Floor mode — the debate UI. A full-screen trading floor
                (hooks/useUiMode.ts toggles chat ↔ floor; Ctrl/Cmd+Shift+F).
                Projects the same debate/approval/trade state the chat pane
                renders, as desks + a right rail. Chunk loads on first open. */}
            {uiMode === 'floor' && (
                <React.Suspense fallback={null}>
                    <FloorScene
                        open
                        onClose={() => setUiMode('chat')}
                        isDebating={isAnalysisInProgress || isPostMortemInProgress}
                        phase={deskScenePhase}
                        actors={deskSceneActors}
                        exchanges={deskSceneExchanges}
                        stages={deskSceneStages}
                        convictions={deskSceneConvictions}
                        verdictDetail={deskSceneVerdictDetail}
                        gaugeStats={gaugeStats}
                        approvalItems={approvalItems}
                        positions={floorPositions}
                        squawk={floorSquawk}
                        tickers={floorTickers}
                        staff={readyProviders.map(p => ({ id: p.id, name: p.name }))}
                        bots={bots}
                        workingBotId={workingBotId}
                        dayPnl={floorDayPnl}
                        guardState={sessionGuard ? {
                            dailyLossLimitUsd: getHarnessSettings().equityUsd * getSessionGuardConfig().dailyLossLimitPct,
                            tradesToday: sessionGuard.tradesToday,
                            maxTradesPerDay: getSessionGuardConfig().maxTradesPerDay,
                            level: sessionGuard.level,
                        } : undefined}
                        seatWire={floorSeatWire}
                        onOpenSeatChat={openSeatChat}
                    />
                </React.Suspense>
            )}

            {/* New Bot / New Group Chat dialogs (Hermes Bot Mode) */}
            {isNewBotOpen && (
                <React.Suspense fallback={null}>
                    <NewBotDialog
                        open
                        onClose={() => setIsNewBotOpen(false)}
                        onCreate={createBot}
                        providers={providerConfigs}
                    />
                </React.Suspense>
            )}
            {isNewGroupOpen && (
                <React.Suspense fallback={null}>
                    <NewGroupDialog
                        open
                        onClose={() => { setIsNewGroupOpen(false); setGroupEditTarget(null); }}
                        onCreate={createGroup}
                        onUpdate={updateGroupMembers}
                        initialGroup={groupEditTarget}
                        bots={bots}
                    />
                </React.Suspense>
            )}
            {/* TeamDialog removed — teams merged into groups (one room
                concept; roles/instructions live on the member bots). */}

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

            {/* Strategy Studio is a surface now (surface === 'studio' in the
                main row) — no overlay state to manage. */}

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
            <BotManagerDrawer open={isBotManagerVisible} onClose={() => setIsBotManagerVisible(false)} onSyncFromTeam={syncBotsFromTeam} />
        </div>
        </React.Suspense>
    );
};

export default App;
