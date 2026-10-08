
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { reapplyIdleMotionClass } from './services/desk/idleMotion';

// Apply the user's persisted idle-motion preference to <body> on app
// startup so the desk view mounts with the correct class.
reapplyIdleMotionClass();
import { Message, MessageRole, TradeOutcome, Conversation, ImageMetadata, AIProvider, LoggedTrade } from './types';
import { subscribeMemoryFilesChanged } from './services/learning/MemoryFilesService';
import { runNotebookReview } from './services/learning/MemoryReviewService';
import { useUserProfileLoader } from './hooks/useUserProfileLoader';
import { useTradeJournalActions } from './hooks/useTradeJournalActions';
import { useProfilePersistence } from './hooks/useProfilePersistence';
import { useConversationHousekeeping } from './hooks/useConversationHousekeeping';
import { useLensAndEnsembleConfig } from './hooks/useLensAndEnsembleConfig';
import { useAgentThreads } from './hooks/useAgentThreads';
import { useWatchAndAutopilot } from './hooks/useWatchAndAutopilot';
import { buildProposedTradeMessage, type TradeProposal } from './services/trade/proposedTrade';
import * as chatStore from './services/trade/chatStore';
import { AnalystRole } from './types/enums';
import { BotRegistry } from './services/bots/BotRegistry';


// Modular Imports
import { useToastActions } from './components/shared/Toast';
import { FORGED_PROPOSAL_EVENT } from './services/tools/toolForge';
import { AMENDMENT_EVENT } from './services/learning/memoryAmendments';
import { countPendingEverything } from './services/learning/memoryHealth';
import { loadBotLearningStats } from './services/agents/botLearning';
import { useConfirmDialog } from './components/shared/ConfirmDialog';
import { Header } from './components/shared/Header';
import { useProviderConfigs } from './hooks/useProviderConfigs';
import { useAppSettings } from './hooks/useAppSettings';
import { useJournalUI } from './hooks/useJournalUI';
import type { JournalUIState } from './hooks/useJournalUI';
import { useAutomations } from './hooks/useAutomations';
import type { AutomationConfig } from './types/automation';
import { useCompareRuns } from './hooks/useCompareRuns';
// Automations were statically imported, dragging the whole editor into the
// startup chunk; they render only from the header's automation rows.
// AutomationEditorModal keeps its own `isVisible` toggling (it must stay
// mounted across opens per its hooks contract), so it is gated on
// `editorIsOpen` at the render site — see the Suspense wrapper there.
const AutomationView = React.lazy(() => import('./components/automation/AutomationView'));
const AutomationEditorModal = React.lazy(() => import('./components/automation/AutomationEditorModal'));
import type { ModelOption } from './components/automation/AutomationEditorModal';
import { ChevronDownIcon, CloseIcon } from './components/shared/Icons';

// Lazy-load heavy, conditionally-rendered components so the initial
// bundle stays small. Previously the entire app was one ~1.73 MB chunk.
// Each lazy() call below produces a separate chunk loaded on demand when
// the user opens the corresponding panel/modal. ChatArea and Header stay
// eager (always-rendered, critical path).
const StrategySearch = React.lazy(() => import('./components/shared/StrategySearch'));
const UserProfileManager = React.lazy(() => import('./components/settings/UserProfileManager'));
const SavedAnalyses = React.lazy(() => import('./components/journal/SavedAnalyses'));
const WatchListPanel = React.lazy(() => import('./components/analysis/WatchListPanel'));
const ActionApprovalsPanel = React.lazy(() => import('./components/learn/ActionApprovals'));
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
const ScenarioSimulator = React.lazy(() => import('./components/modals/ScenarioSimulator'));
const UpdateOverlay = React.lazy(() => import('./components/shared/UpdateOverlay'));
const CompareModal = React.lazy(() => import('./components/analysis/CompareModal'));
const StrategyStudio = React.lazy(() => import('./components/dashboards/StrategyStudio'));
const TradeView = React.lazy(() => import('./components/trade/TradeView'));
const MistakeWarningBanner = React.lazy(() => import('./components/shared/MistakeWarningBanner'));
const DeskScene = React.lazy(() => import('./components/desk/DeskScene'));
const NewBotDialog = React.lazy(() => import('./components/chat/NewBotDialog'));
const BotSeatOverridesDialog = React.lazy(() => import('./components/agents/BotSeatOverridesDialog'));
const NewGroupDialog = React.lazy(() => import('./components/chat/NewGroupDialog'));
const GroupChatView = React.lazy(() => import('./components/chat/GroupChatView'));
const CoachThreadPanel = React.lazy(() => import('./components/chat/CoachThreadPanel'));
const LearnView = React.lazy(() => import('./components/learn/LearnView'));
import type { LearnTab } from './components/learn/LearnView';
const AgentsView = React.lazy(() => import('./components/agents/AgentsView'));
import ModelPicker from './components/shared/ModelPicker';
import AnalysisProgress from './components/analysis/AnalysisProgress';
import { DEFAULT_FRAMEWORKS } from './constants/models';
import { computeChatModelFallback, isProviderReady } from './utils/providerUtils';
import { DEFAULT_LEVERAGE } from './utils/conversationUtils';
import { collectApprovalItems, setAutoJournalRule, type ApprovalItem } from './utils/approvalInbox';
import { type ThreadSelection, threadForProvider } from './utils/agentThreads';
import { deriveMessageDisplayText } from './utils/messageDisplayText';
import {
    getBots, updateBot, 
    groupDisplayName, 
    type AgentBot,
} from './services/agents/agentRoster';
import { useAgentGroups } from './hooks/useAgentGroups';
import { useBotMailbox, type UseBotMailboxResult } from './hooks/useBotMailbox';
import { buildBotSystemPrompt } from './services/agents/botMailbox';
import { classifyBotAttention } from './services/agents/botAttention';
import { readBotSystemMarkdown, readBotMemoryMarkdown } from './services/bots/BotMemoryService';
import { takeSkillDraft, tombstoneSkillDraftKey, draftTriggerKey, listSkillDrafts, type SkillDraft } from './utils/skillDrafts';
import { listLearningProposals } from './utils/learningQueue';
import { approveSkillDraft, skillApprovalToast } from './services/learning/skillApproval';
import { isEnsembleMessage, stageActorsForMessage, exchangesForTurns, convictionsFromTurns, livePhaseForMessage } from './utils/debateStageActors';
import useNetworkStatus from './hooks/useNetworkStatus';
import { useSupervisorBootstrap } from './hooks/useSupervisorBootstrap';
import { useLearningHeartbeat } from './hooks/useLearningHeartbeat';
import { useUIState } from './hooks/useUIState';
import { useConversations } from './hooks/useConversations';
import { useMarketData } from './hooks/useMarketData';
import { useTradeLogging } from './hooks/useTradeLogging';
import { useAnalysisPipeline } from './hooks/useAnalysisPipeline';
import { ANALYSIS_STOP_TEXT } from './services/trade/analysisTurn';
import { usePostMortem } from './hooks/usePostMortem';
import { useUserProfiles } from './hooks/useUserProfiles';
import { offlineQueue } from './services/infrastructure/OfflineQueueService';
import { getPreference, setPreference, removePreference, PREF_KEYS } from './services/infrastructure/PreferencesService';
// AI Learning Services - Adaptive Learning, Mistake Patterns, Insight Extraction
import { ProviderConfig } from './types/provider';
import { loadLastModeratorPick, saveLastModeratorPick } from './services/ui/AnalystLensService';
import { isProviderOnCooldown, providerCooldownRemainingMs } from './services/infrastructure/ProviderHealthService';
import { stopAutoBackup, createBackup } from './services/infrastructure/BackupService';
import { useWatchSideEffects } from './hooks/useWatchSideEffects';
import { useSurfaceRouter } from './hooks/useSurfaceRouter';
import type { AppSurface } from './hooks/useSurface';
import type { TradeMode } from './components/trade/TradeView';
import type { NavBadge } from './components/shell/SurfaceMenuList';
import NavRail, { NAV_RAIL_AUTO_COLLAPSE_PX } from './components/shell/NavRail';
import StatusBar from './components/shell/StatusBar';
import * as supervisorStore from './services/learning/supervisorStore';
import { tokensForChars, DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS } from './utils/tokenEstimate';
import { getHarnessSettings, saveHarnessSettings } from './utils/harnessSettings';
// The Journal pulls recharts + react-virtuoso into its chunk — statically
// importing it put both on the startup path for a surface most users open
// after days of logging. Lazy-once like the other surfaces; the deep-link
// (hash router + openJournal) only mounts it, so Suspense below is enough.
const Journal = React.lazy(() => import('./components/journal/Journal').then(m => ({ default: m.Journal })));
import { useModelCatalogRefresh } from './hooks/useModelCatalogRefresh';

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

/**
 * Suspense fallback for the SURFACE-level lazy screens (TradeView,
 * StrategyStudio, the Agents roster). With fallback={null} the whole surface
 * flashed a blank black/white void for the duration of the chunk fetch
 * (audit: 21× fallback={null}). This is a quiet pulsing zinc panel that
 * matches the dark chrome — no new deps, no layout shift to the real screen.
 */
const SurfaceSkeleton: React.FC = () => (
    <div className="flex h-full min-h-0 w-full flex-col gap-3 bg-zinc-950 p-4" role="status" aria-label="Loading">
        <div className="h-8 w-40 animate-pulse rounded-control bg-zinc-900" />
        <div className="flex-1 animate-pulse rounded-2xl border border-white/[0.06] bg-zinc-900" />
    </div>
);

/** Persisted nav-rail width preference. Deliberately NOT per-profile: the rail
 *  is a property of the window, not of who is signed into it, and two profiles
 *  on one machine should see the same rail they left behind. */
const NAV_RAIL_KEY = 'nav_rail_width_v1';

const App: React.FC = () => {
    const toast = useToastActions();
    const { confirm: confirmDialog, ConfirmDialogComponent } = useConfirmDialog();

    // UI visibility and progress state (extracted to hooks/useUIState.ts)
    const {
        isUserModalOpen, setIsUserModalOpen,
        isStrategySearchVisible, setIsStrategySearchVisible,
        isSettingsMenuVisible, setIsSettingsMenuVisible,
        isLiveMarketVisible, setIsLiveMarketVisible,
        isLivePostMortemVisible, setIsLivePostMortemVisible,
        showMismatchModal, setShowMismatchModal,
        isVisionDataVisible, setIsVisionDataVisible,
        showAccuracyModal, setShowAccuracyModal,


        isLoading, setIsLoading,
        isHybridLoading, setIsHybridLoading,
 setIsPostMortemTypingComplete,
        isAnalysisInProgress, setIsAnalysisInProgress,
        isPostMortemInProgress, setIsPostMortemInProgress,
        isSummaryInProgress, setIsSummaryInProgress,
        isInsightGenerating, setIsInsightGenerating,
        isAutoCapturing, setIsAutoCapturing,
        isEntryNotHitCapturing, setIsEntryNotHitCapturing,
        isAutoCaptureBusy, setIsAutoCaptureBusy,
        isUpdateCaptureBusy, setIsUpdateCaptureBusy,
        isEntryNotHitCaptureBusy, setIsEntryNotHitCaptureBusy,
        isRateLimited, setIsRateLimited,
    } = useUIState();
    const [isWatchListVisible, setIsWatchListVisible] = useState(false);
    /** Background-jobs drawer (status-stack pattern). */
    const [isJobsDrawerVisible, setIsJobsDrawerVisible] = useState(false);
    const [seatOverridesBot, setSeatOverridesBot] = useState<AgentBot | null>(null);

    // Lazy-on-demand: only mount the legacy StrategySearch + Analytics side
    // panels once the user opens them at least once. They stay mounted
    // thereafter so the open/close animation is instant on the second open.
    const [isStrategySearchEverOpened, setIsStrategySearchEverOpened] = useState(false);
    React.useEffect(() => {
        if (isStrategySearchVisible) setIsStrategySearchEverOpened(true);
    }, [isStrategySearchVisible]);

    // Provider configuration (API keys, base URLs, custom providers), plus the
    // display/lookup maps derived from that catalog — see useProviderConfigs.
    const {
        configs: providerConfigs,
        isLoaded: providerConfigsLoaded,
        readyProviders,
        modelIdToName,
        ocrModelIdToName,

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
    const { refreshNow: refreshModelCatalog } = useModelCatalogRefresh(providerConfigs, handleUpdateProvider);

    // Dynamic model display map + speaker-name→provider-id map come from
    // `useProviderConfigs` above, because they are derived from the catalog it
    // owns. Co-locating them there is what makes a stale map impossible rather
    // than merely unlikely.

    // Conversation state, derived values, and handlers (extracted to hooks/useConversations.ts)
    const {
        conversationHistory, setConversationHistory,
        activeConversationId, setActiveConversationId,
        activeConversation, messages, messagesRef,
        updateMessages, updateActiveConversation,
        selectedOcrModel,
        moderatorProviderId, moderatorModel,

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
            setMemoryNonce(n => n + 1);
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
    /** Set when another surface asks to open Learn on a SPECIFIC tab
     *  (Settings → "Open the notebook"). LearnView reports it consumed
     *  (onInitialTabConsumed), so it navigates exactly once and the user's own
     *  last tab survives the next mount — same contract as journalTab. */
    const [learnTab, setLearnTab] = useState<LearnTab | null>(null);
    const learnTabConsumed = useCallback(() => setLearnTab(null), []);

    // Surface + URL routing, the journal deep-link and the surface-enter
    // direction — one self-contained cluster, lifted out of this component
    // (handoff 2.1). It owns `useSurface` and needs `setLearnTab` for the
    // #/journal/learning bookmark, which is why it is called after that.
    const {
        surface, setSurface,
        journalTab,
        journalOpenNonce,
        surfaceEnterFrom, setSurfaceEnterFrom,
        handleSurfaceSelect, openJournal,
    } = useSurfaceRouter({
        isSettingsMenuVisible, setIsSettingsMenuVisible,
        isLiveMarketVisible, setIsLiveMarketVisible,
        isWatchListVisible, setIsWatchListVisible,
        setLearnTab,
    });
    // The trade surface's collapsible left panel: the order book, opened and
    // closed from the toggle in the Chart's own market row. Persisted so the
    // layout survives reloads like the dock width.
    const [tradeSidebarOpen, setTradeSidebarOpen] = useState<boolean>(() => {
        try { return localStorage.getItem('trade_sidebar_open_v1') !== '0'; } catch { return true; }
    });
    // Below lg there is no sidebar to toggle — the book is one of the mobile
    // Chart|AI|Book modes owned by TradeView. The icon therefore requests a
    // mode flip (nonce-keyed so a repeat 'book' request still applies)
    // instead of silently mutating a flag nothing reads (audit R6 #4: the
    // old toggle did exactly that on phones).
    const [tradeModeRequest, setTradeModeRequest] = useState<{ mode: TradeMode; n: number } | null>(null);
    const tradeModeReqNRef = useRef(0);
    const lastRequestedTradeModeRef = useRef<TradeMode>('chart');
    const isBelowLgNow = (): boolean => {
        try { return !window.matchMedia('(min-width: 1024px)').matches; } catch { return false; }
    };
    const toggleTradeSidebar = useCallback(() => {
        if (isBelowLgNow()) {
            const next: TradeMode = lastRequestedTradeModeRef.current === 'book' ? 'chart' : 'book';
            lastRequestedTradeModeRef.current = next;
            setTradeModeRequest({ mode: next, n: ++tradeModeReqNRef.current });
            return;
        }
        setTradeSidebarOpen(prev => {
            try { localStorage.setItem('trade_sidebar_open_v1', prev ? '0' : '1'); } catch { /* private mode */ }
            return !prev;
        });
    }, []);
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
 setHybridConnectionStatus,
        setLatestMonteCarloResult,
        setLatestBacktestResult,
        setPerAIMonteCarloResults,
        setCurrentSlOptimization,
 setCurrentSuggestedEntryPrice,
        setCurrentEntryTimingScore,
        liveMarketConditions,
        liveMarketSymbol,
    } = marketData;

    // Network status and offline queue
    const { isOnline, wasOffline } = useNetworkStatus();
    const [pendingQueueCount, setPendingQueueCount] = useState<number>(0);

    // Journal and message expansion state
    // (journalState/setJournalState intentionally NOT consumed — the legacy
    // journal overlay is gone; the journal lives on its own surface, and the
    // deep-link tab/trade-id state is declared with the surface block below.)
    const {
        strategyToView, setStrategyToView,


 setExpandedPostMortems,
        postMortemCandidate, setPostMortemCandidate,
    } = useJournalUI();


    // Refs for functions defined later but needed by useTradeLogging (breaks circular dependency)
    //
    // Typed from the hooks that DEFINE the functions rather than as
    // `(...args: any[]) => any`. The indirection is still needed — the send
    // path and the post-mortem entry point are declared hundreds of lines
    // below these hooks are called — but the bridge no longer erases the
    // signature: if `handleSendMessage` gains or reorders a parameter, this
    // wrapper stops compiling instead of forwarding the wrong argument at
    // runtime. Deriving from `ReturnType<typeof hook>` also means the two
    // cannot drift apart by hand.
    type SendMessage = ReturnType<typeof useAnalysisPipeline>['handleSendMessage'];
    type StartPostMortem = ReturnType<typeof usePostMortem>['startPostMortemAnalysis'];
    const handleSendMessageRef = useRef<SendMessage | null>(null);
    const startPostMortemAnalysisRef = useRef<StartPostMortem | null>(null);
    const stableHandleSendMessage = useCallback<SendMessage>((...args) => {
        const send = handleSendMessageRef.current;
        // The ref is written during render, further down, on purpose: both
        // functions are declared hundreds of lines after the hooks that need
        // them. So the only way to arrive here with nothing wired is a caller
        // that fires DURING the same render pass — a bug in that caller.
        //
        // Say so, rather than `current?.(...)` behind an `as`. Optional chaining
        // here returns `undefined` typed as the pipeline's real result, so the
        // failure surfaces much later as a confusing property-of-undefined
        // crash in a caller that looks blameless. Throwing costs one branch and
        // removes the cast entirely — the return type is now genuinely the
        // hook's, with nothing asserting otherwise.
        if (!send) {
            throw new Error('handleSendMessage was called before the analysis pipeline was wired');
        }
        return send(...args);
    }, []);
    const stableStartPostMortem = useCallback<StartPostMortem>((...args) => {
        const start = startPostMortemAnalysisRef.current;
        if (!start) {
            throw new Error('startPostMortemAnalysis was called before the post-mortem hook was wired');
        }
        return start(...args);
    }, []);

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
    // Bound names here are a contract: every one is used, and a test enforces
    // it. Thirteen dead bindings were removed when this surface shrank.
    const {
        loggedTrades, setLoggedTrades,
        savedAnalyses, setSavedAnalyses,
        tradeSummaries, setTradeSummaries,
        finalTradeSummary, setFinalTradeSummary,
        updateCandidate, setUpdateCandidate,
        simulatorCandidate, setSimulatorCandidate,
        dataCaptureCandidate, setDataCaptureCandidate,
        entryNotHitCandidate, setEntryNotHitCandidate,
        newlyAddedInsightIds, setNewlyAddedInsightIds,
        confirmAutopilotOutcome,
        confirmAutopilotEntryNotHit,
        handleDataCaptureUpload,
        handleDataCaptureAuto,
        handleDataCaptureSkip,
        handleInitiateLogTrade,
        handleEntryNotHitAutoCapture,
        handleEntryNotHitUpload,
        handleEntryNotHitSkip,
        handleConfirmUpdateTrade,
        handleUpdateAutoCapture,
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
        setIsAutoCaptureBusy,
        setIsHybridLoading,
        setIsEntryNotHitCaptureBusy,
        setIsUpdateCaptureBusy,
        isEntryNotHitCapturing,
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
    // The three leverage handlers useConversationLeverage used to return are
    // gone: nothing called them. The state stays — the composer and the desk
    // both bind to it — but the hook is pure derivation with no effects, so
    // calling it bought nothing. @typescript-eslint/no-unused-vars had been
    // reporting all three at this line for the life of the file.
    // (i/n) progress for the manual insight-generation loops (App only shows
    // a boolean spinner otherwise; a 50-trade rewrite runs for minutes).
    const [insightProgress, setInsightProgress] = useState<{ done: number; total: number } | null>(null);
    const appRef = useRef<HTMLDivElement>(null);
    // ── Scroll-to-message bridge (audit UI-shell fix, 2026-09-15) ──────────
    // The main transcript lives in the trade surface's Chart AI dock
    // (TradeChatPanel renders a plain scroll container, NOT a Virtuoso), so
    // the old virtuosoRef could never be attached and both scroll affordances
    // were silent no-ops. The dock now registers a scrollToMessage(id)
    // function here on mount (and null on unmount); "Jump to latest
    // analysis" and the gallery's Locate call it. Ids are the chatStore
    // entry ids stamped as `data-message-id` on each rendered entry.
    const scrollToMessageRef = useRef<((messageId: string) => void) | null>(null);
    const registerScrollToMessage = useCallback((fn: ((messageId: string) => void) | null): void => {
        scrollToMessageRef.current = fn;
    }, []);
    // ── Nav rail (D2) ───────────────────────────────────────────────────────
    // The rail is the navigation now: a 56px column that expands to 280px,
    // instead of a drawer the whole surface list was hidden behind.
    //
    // The preference is persisted like every other layout choice, but the
    // window gets the last word: below 1024px there is no room for a 280px
    // panel beside a chart, so the rail is a rail regardless of what the user
    // last chose. That override is applied at RENDER time rather than stored
    // back, so widening the window restores the choice the user actually made
    // instead of leaving it silently overwritten.
    const [isNavRailExpanded, setIsNavRailExpanded] = useState(() => {
        try {
            return localStorage.getItem(NAV_RAIL_KEY) !== 'collapsed';
        } catch { return true; }
    });
    const [isNavViewportNarrow, setIsNavViewportNarrow] = useState(
        () => typeof window !== 'undefined' && window.innerWidth < NAV_RAIL_AUTO_COLLAPSE_PX,
    );
    useEffect(() => {
        const onResize = () => setIsNavViewportNarrow(window.innerWidth < NAV_RAIL_AUTO_COLLAPSE_PX);
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);
    useEffect(() => {
        try { localStorage.setItem(NAV_RAIL_KEY, isNavRailExpanded ? 'expanded' : 'collapsed'); }
        catch { /* private mode */ }
    }, [isNavRailExpanded]);
    // Below NAV_RAIL_AUTO_COLLAPSE_PX the rail is not a column, it is a wall —
    // so a user-OPENED rail at those widths is an overlay instead. Without the
    // second flag the narrow override won whatever the header button did, and
    // "Expand navigation" was rendered, advertised with aria-controls, and did
    // nothing: at 390px the five surfaces were reachable only by Alt+1..5.
    const [isNavOverlayOpen, setIsNavOverlayOpen] = useState(false);
    const isNavRailOpen = isNavRailExpanded && (!isNavViewportNarrow || isNavOverlayOpen);
    const isNavOverlay = isNavViewportNarrow && isNavRailOpen;
    const toggleNavRail = useCallback(() => {
        // Toggle the EFFECTIVE state, not the stored preference: at narrow
        // widths the preference can read `expanded` while the rail is closed.
        const willOpen = !isNavRailOpen;
        if (isNavViewportNarrow) {
            setIsNavOverlayOpen(willOpen);
            if (willOpen) setIsNavRailExpanded(true);
        } else {
            setIsNavRailExpanded(willOpen);
            setIsNavOverlayOpen(false);
        }
    }, [isNavRailOpen, isNavViewportNarrow]);
    // Closing the drawer leaves the stored choice alone, so widening the window
    // puts the rail back where the user left it.
    const closeNavOverlay = useCallback(() => setIsNavOverlayOpen(false), []);

    // Chart AI dock routing (the Chat surface is gone — roster clicks open
    // sessions inside the trade surface instead). Nonce-keyed so re-clicking
    // the same bot/group re-fires the open effect. The Coach inbox is not
    // routed here any more: it is a Learn tab.
    const [tradeBotRequest, setTradeBotRequest] = useState<{ botId: string; nonce: number } | null>(null);
    const [tradeGroupRequest, setTradeGroupRequest] = useState<{ groupId: string; nonce: number } | null>(null);

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

    // The composer's model selection is provider-qualified
    // (`providerId::modelId`) so a model name offered by TWO providers
    // answers from the one the user actually picked, not whichever provider
    // happened to be scanned first. Migrate the legacy bare-model preference
    // to the qualified form once the provider list exists.
    const chatModelMigratedRef = useRef('');
    useEffect(() => {
        if (!selectedChatModel || selectedChatModel.includes('::')) return;
        if (chatModelMigratedRef.current === selectedChatModel) return;
        if (providerConfigs.length === 0) return;
        chatModelMigratedRef.current = selectedChatModel;
        const owner = providerConfigs.find(c => isProviderReady(c) && c.selectedModel === selectedChatModel)
            ?? providerConfigs.find(c => isProviderReady(c) && c.models.includes(selectedChatModel))
            ?? providerConfigs.find(c => c.selectedModel === selectedChatModel)
            ?? providerConfigs.find(c => c.models.includes(selectedChatModel));
        if (owner) setSelectedChatModel(`${owner.id}::${selectedChatModel}`);
    }, [providerConfigs, selectedChatModel]);

    // ─── Bot Mode — pipeline bridge ────────────────
    // The pipeline is instantiated above the roster state, so it reads the
    // active bot + dispatches replies through refs assigned during render
    // (same pattern as handleSendMessageRef / loggedTradesRef).
    const botThreadStateRef = useRef<{ thread: ThreadSelection; bots: AgentBot[] }>({
        thread: { kind: 'team' },
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

        // tsc reports this binding as unused; it is NOT. The one function
        // that reads it declares a local `const images` that shadows it, which
        // is why no reference resolves back to this destructure member.
        images, setImages,
        loadingMessage, setLoadingMessage,
        analysisSteps, setAnalysisSteps,
        currentVisionData,


        initAnalysisSteps, startStep, completeStep,
        handleSendMessage,
        handleCancelAnalysis,
        handleClearChat,





        handleSteerSeat,

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

    // Session-guard verdict (Batch 2): deterministic day-P&L/trade-cap/streak
    // state over the journal — drives the composer banner and is injected
    // into the debate context so the moderator weighs it when grading.

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
    // THE REF HAS TWO WRITERS, and both are load-bearing — this looked like a
    // duplicate and is not:
    //
    //   1. HERE, from sessionStorage. `usePostMortem` is called below, BEFORE
    //      `useUserProfiles` destructures `activeUsername`, so this write is
    //      the only thing that makes the ref current for that hook — without
    //      it usePostMortem reads the PREVIOUS render's value on every render,
    //      i.e. one render stale, and its run-staleness checks fire against
    //      the wrong user.
    //   2. After `activeUsername` is destructured, from that state. Every
    //      later reader uses this one, because the state is the canonical
    //      source (sessionStorage is only where it was last mirrored).
    //
    // Deleting either one is a bug, not a cleanup. The ordering cannot simply
    // be reversed: `activeUsername` does not exist yet at the point this hook
    // is called, which is the entire reason the ref exists.
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
        mismatchData,

        livePostMortemThoughts,
        startPostMortemAnalysis,
        invalidatePostMortemRuns,

        handleAllPostMortemTypingComplete,
        handleMismatchResolution,
        handleRetryPostMortem,


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

    const currentInsightIds = useMemo(() => tradeSummaries.map(s => s.id), [tradeSummaries]);
    // The Send button must never look active when no provider can actually
    // run — accuracy mode doesn't conjure providers out of thin air (the
    // pipeline toasts "No AI Providers Enabled" on send).

    const familyWinRates = useMemo(() => {
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
                    // (dataURLs persisted at enqueue time). AWAIT the run's
                    // promise: processQueue awaits this callback before it
                    // removes the item, so the queued analysis is only
                    // dropped once the pipeline run actually ENDS — previously
                    // the fire-and-forget call resolved at the first internal
                    // await and the item vanished the moment a run merely
                    // STARTED (audit §2.3).
                    //
                    // Resolving is NOT the same as succeeding. handleSendMessage
                    // catches a failing analysis internally (error bubble / rate
                    // / quota) and resolves with { ok:false }; a bare await
                    // would still dequeue that dead run. Throw on ok:false so
                    // the existing retryCount / exponential-backoff / MAX_RETRIES
                    // path applies instead of silently losing the work.
                    const images = (payload?.images || []).map((url: string, i: number) => ({
                        file: dataUrlToFile(url, `chart-${i + 1}.png`),
                        dataURL: url,
                        isLoading: false,
                    }));
                    const outcome = await handleSendMessage(payload?.prompt || '', images);
                    if (outcome && outcome.ok === false) {
                        throw new Error('Queued analysis replay failed — deferring to the retry/backoff path.');
                    }
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
        // WS-3.2: a scheduled bot turn folds its bot's closed trades into the
        // notebook, so it needs the live journal.
        trades: () => loggedTradesRef.current,
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

    // Second of the two activeUsernameRef writers (see the declaration for why
    // both exist and what each one serves). This one is the canonical value:
    // every hook called from here down reads it.
    activeUsernameRef.current = activeUsername ?? null;


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

    // ─── Saved analyses gallery ────────────────────────────────────────────
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
        // WS-3: room turns teach their speakers too — same write-back the
        // 1:1 mailbox gets (lesson → memory.md, closed trades → evidence).
        loggedTradesRef,
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
        // WS-3: bot turns fold closed bot-authored trades back into the
        // shared learning loop (skills + evidence), same as chart AI closes.
        loggedTradesRef,
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
    /** The room view, hoisted so both the Chart AI dock and the Agents surface
     *  render the SAME room from the SAME runners instead of two copies that
     *  can drift. */
    const renderGroupSurface = useCallback((groupId: string): React.ReactNode => {
        const group = groups.find(g => g.id === groupId);
        if (!group) return <p className="p-4 text-ui-dense leading-5 text-zinc-500">This room was deleted.</p>;
        return (
            <React.Suspense fallback={null}>
                <GroupChatView
                    group={group}
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
                    onEditGroup={() => {
                        setGroupEditTarget(group);
                        setIsNewGroupOpen(true);
                    }}
                    onDeleteGroup={() => deleteGroup(group.id)}
                />
            </React.Suspense>
        );
    }, [groups, bots, messages, activity, workingBotId, groupRunning, sendGroupThread,
        sendGroupReply, cancelGroupRun, isHybridIntelligenceEnabled, toggleGroupHybrid,
        setIsNewGroupOpen, deleteGroup]);
    // The debate the desk view projects: the message currently debating, else
    // the most recent ensemble message. Actors derive through the SAME builder
    // the transcript uses, so the desk view never drifts from the transcript.
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
    // Exchanges, sealed convictions and the live phase for the desk floor,
    // from the SAME shared builders the transcript rows use. Deriving them
    // in one place keeps the room and the transcript aligned — one source
    // of truth.
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
            const anyOverlayOpen = isSettingsMenuVisible || isLiveMarketVisible || isUserModalOpen || isVisionDataVisible || isStrategySearchVisible || isWatchListVisible || isDeskSceneOpen;
            if (anyOverlayOpen) {
                // Overlays with their own document-level Esc handlers
                // (SettingsMenu, command palette, Journal, LiveMarket, dialogs)
                // close themselves. Close the gate-owned overlays here so one
                // Esc never both closes an overlay AND cancels a running
                // analysis — but never cancels while anything is open.
                if (isVisionDataVisible) setIsVisionDataVisible(false);
                if (isStrategySearchVisible) setIsStrategySearchVisible(false);
                if (isWatchListVisible) setIsWatchListVisible(false);
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
    }, [isAnalysisInProgress, isPostMortemInProgress, handleCancelAll, toast, isSettingsMenuVisible, isLiveMarketVisible, isUserModalOpen, isVisionDataVisible, isStrategySearchVisible, isWatchListVisible, isDeskSceneOpen]);

    const {
        comparePrimary,
        compareSecondary,

        handlePickSecondary,
        closeCompare,
    } = useCompareRuns(messages);

    // ─── View model reasoning (Think tab deep link) ────────────────────────
    // Opens the Trading Journal's Think tab focused on the reasoning records
    // of the clicked analysis card. The reasoning set is keyed by the
    // analysis createdAt, so resolve it via the card (message) id.

    // ─── Saved analyses gallery ────────────────────────────────────────────
    const handleLocateMessage = useCallback((messageId: string) => {
        const index = messages.findIndex(m => m.id === messageId);
        if (index >= 0) {
            scrollToMessageRef.current?.(messageId);
        }
    }, [messages]);

    // Saved-analysis Locate: the transcript lives on the Trade surface, so
    // from the Journal this is the show-the-trade dance — land on Trade and
    // scroll only if the dock's bridge is already mounted.
    const handleLocateSavedAnalysis = useCallback((messageId: string) => {
        const dockIsMounted = surface === 'trade';
        setSurface('trade');
        if (dockIsMounted) {
            const index = messages.findIndex(m => m.id === messageId);
            if (index >= 0) scrollToMessageRef.current?.(messageId);
        }
    }, [messages, surface]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            // Ctrl/Cmd+, opens Settings — the platform convention the activity
            // rail advertises in its tooltip. It was advertised but never
            // bound, so the kbd hint was a dead affordance.
            if ((e.ctrlKey || e.metaKey) && e.key === ',') {
                e.preventDefault();
                setIsSettingsMenuVisible(true);
            }
            // Ctrl/Cmd+B collapses and expands the nav rail. Matches the reference
            // clients, and is checked BEFORE the Ctrl+B that the rich-text
            // surfaces would otherwise claim — nothing else in this app binds
            // it, but the composer does contain a focusable text field.
            if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'b') {
                e.preventDefault();
                toggleNavRail();
            }
            // Alt+1..5 jumps the nav-rail surfaces (Minara nav; Alt keeps
            // the browser/Electron Ctrl+number tab-switching intact).
            const SURFACE_KEYS: Record<string, AppSurface> = {
                '1': 'trade', '2': 'journal', '3': 'skills', '4': 'agents', '5': 'learn',
            };
            if (e.altKey && !e.ctrlKey && !e.metaKey && SURFACE_KEYS[e.key]) {
                e.preventDefault();
                handleSurfaceSelect(SURFACE_KEYS[e.key]);
            }
            // Alt+D flips the whole-view density. One key for one contract: the
            // shortcut, the status bar and Settings all write the same stored
            // value, so no reader can show a panel the setting says is resting.
            if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'd') {
                e.preventDefault();
                const next = getHarnessSettings().viewDensity === 'detail' ? 'focus' : 'detail';
                saveHarnessSettings({ viewDensity: next });
            }
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [handleSurfaceSelect, setIsSettingsMenuVisible, toggleNavRail]);



    // True once the ACTIVE profile's data has actually loaded. Owned here
    // because the autosave below is constructed before the loader further
    // down, and both must agree: data may only be written for a profile that
    // loaded. A load that throws used to adopt the username anyway, and the
    // debounced autosave then wrote stale (or empty) state over that profile.
    const profileReadyRef = useRef(false);

    // Profile persistence (extracted to hooks/useProfilePersistence.ts):
    // heavy DATA save, light SETTINGS save, mid-run heartbeat, unload flush.
    useProfilePersistence({
        activeUsername, activeConversationId, setSaveStatus, toast, profileReadyRef,
        conversationHistory, loggedTrades, savedAnalyses, tradeSummaries,
        finalTradeSummary, globalMemory, insightKnowledgeBase,
        memoryConfig, memoryModel,
        isAnalysisInProgress, isPostMortemInProgress,
        activeFrameworks, summaryCharLimit, summarizationProvider, summarizationModel,
        visionModel, isGlobalMemoryEnabled, isStrategiesEnabled, isEnsembleEnabled,
        isAccuracyModeEnabled, accuracySubMode, customInstructions,
        isPlaybookEnabledInPureAI, isFamiliesEnabledInPureAI, isMemoryEnabledInPureAI,
        isHybridIntelligenceEnabled, isAutoCapturing,
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

    const handleUpdateSummaryCharLimit = (limit: number) => setSummaryCharLimit(limit);


    // Journal CRUD handlers (extracted to hooks/useTradeJournalActions.ts)
    const {
        handleDeleteTrades,
        handleClearAllTrades,
        handleManualInsightsUpdate,
        handleUpdateTradeLeverage,
        handleUpdateTradeType,
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

        handleNewConversation,
        handleLoadConversation,

        handleDeleteConversationFromSidebar,

    } = useConversationHousekeeping({
        conversationHistory, setConversationHistory,
        activeConversation, activeConversationId, setActiveConversationId,
        updateMessages, handleCancelAnalysis, invalidatePostMortemRuns,
        confirmDialog, toast,
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
        handleToggleWatch,
        watchedSignals,
        watchOpenR,

        handleOpenWatchedSignal,
        handleConfirmAutopilot,
        runWatchListAction,
        handleDismissAutopilot,
    } = useWatchAndAutopilot({
        messages, conversationHistory, loggedTrades,
        activeConversationId, activeConversation, updateMessages, messagesRef,
        stableHandleSendMessage, handleLoadConversation,
        setIsWatchListVisible,
        confirmAutopilotOutcome, confirmAutopilotEntryNotHit, handleInitiateLogTrade,
        confirmAutopilotRef, toast,
    });

    /** Drives the dock's Pin chip. The flag lives on the Message, so a chat
     *  entry is pinable only through the analysis message id the bridge
     *  stamped on it (TradeChatPanel's data-message-id). */
    const pinnedMessageIds = useMemo(
        () => new Set(messages.filter(m => m.watched).map(m => m.id)),
        [messages],
    );

    const handleStartNewConversation = handleNewConversation;

    // Stable handler identities — plain arrow functions here were recreated
    // every render, defeating the chatContext memo and re-rendering every
    // visible transcript row on each stream chunk / keystroke.
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

    // F4: "Re-run debate" — re-dispatches the original prompt + chart images
    // through the normal pipeline so the user gets a fresh debate for the
    // same setup (also the missing retry path for failed analyst slots).
    // Shared by the manual Re-run button and price-triggered setup watches.
    // Failed-run retry: rebuild the exact prompt + charts from the user
    // message the failed run was sent with (the error bubble carries its id).
    // ── Chart AI dock bridges ─────────────────────────────────────────────
    // "Full analysis" from the trade chat: run the SAME ensemble pipeline the
    // old Chat surface ran (automation-shaped private run), resolve with the
    // verdict summary so the dock shows the answer in its own transcript.
    // "Log this trade" from a Chart AI proposal → append a PENDING analysis
    // message. The outcome autopilot (useWatchAndAutopilot) registers it,
    // watches the SL/TP, and runs the full post-mortem → skill-learning loop
    // when it resolves — so a chat-proposed trade is scored like any analysis.
    const handleLogProposedTrade = useCallback((proposal: TradeProposal): void => {
        updateMessages(prev => {
            // planId dedupe, keyed on the JOURNAL ROW (`LoggedTrade.planId`) and
            // the pending card's own field — never on the headline string. The
            // dock's per-card map stops a double-click on one card; re-presenting
            // the same plan from another surface used to mint a byte-identical
            // second card because the only trace of the plan was prose.
            if (proposal.planId
                && (loggedTrades.some(t => t.planId === proposal.planId)
                    || prev.some(m => m.planId === proposal.planId))) {
                return prev;
            }
            return [...prev, buildProposedTradeMessage(proposal, `proposed-${Date.now()}`)];
        });
    }, [updateMessages, loggedTrades]);

    /** The dock holds a settled verdict's message id, not a copy of the
     *  analysis — a persisted chat session would otherwise store a whole
     *  `TradeAnalysis` per answer. This lets it resolve the backing on demand.
     *  Memoised because `TradeChatPanel` is `React.memo`: an inline arrow would
     *  hand it a new prop on every App pass. */
    const getAnalysisMessage = useCallback(
        (messageId: string): Message | undefined => messages.find(m => m.id === messageId),
        [messages],
    );

    /** The instrument the active chat session is bound to. Both surfaces pass
     *  this into the analysis so a coin picker means something: the pipeline
     *  otherwise reads the coin out of the prompt TEXT, so selecting ETH and
     *  typing a question that names no coin would fetch nothing. Text still
     *  wins when it names one — the picker says where you are looking, not
     *  what to analyse. */
    const activeInstrument = useCallback((): { symbol?: string; interval?: string } => {
        const snap = chatStore.getSnapshot();
        const s = snap.sessions.find(x => x.id === snap.activeId);
        return s?.symbol || s?.interval ? { symbol: s.symbol, interval: s.interval } : {};
    }, []);

    const handleRunAnalysisFromChat = useCallback((prompt: string, chatImages: Array<{ name: string; dataURL: string }>): Promise<string | { text: string; messageId?: string }> => {
        if (isAnalysisInProgress) return Promise.reject(new Error('an analysis is already running — wait for it or stop it first'));
        if (readyProviders.length === 0) return Promise.reject(new Error('no AI providers are configured'));
        const images: ImageMetadata[] = chatImages.map(img => ({
            file: new File([], img.name, { type: 'image/png' }),
            dataURL: img.dataURL,
            isLoading: false,
        }));
        const conversation: Conversation = {
            id: `trade-chat-${Date.now()}`,
            title: 'Chart AI analysis',
            timestamp: Date.now(),
            messages: [],
            ocrModel: selectedOcrModel,
            moderatorProviderId: moderatorProviderId ?? '',
            moderatorModel: moderatorModel ?? '',
            leverage: parseInt(leverageInput, 10) || DEFAULT_LEVERAGE,
        };
        return new Promise<string | { text: string; messageId?: string }>((resolve, reject) => {
            let settled = false;
            void handleSendMessage(prompt, images, undefined, {
                ...activeInstrument(),
                automation: {
                    automationId: 'trade-chat',
                    conversation,
                    onMessage: ({ aiMessage }) => {
                        if (settled) return;
                        settled = true;
                        const display = deriveMessageDisplayText(aiMessage);
                        const summary = (display.displayContent || aiMessage.text || '').trim();
                        const a = aiMessage.analysis;
                        const verdict = a
                            ? `${a.direction ?? '—'} ${a.coinName ?? ''} · confidence ${a.confidence ?? '—'}${a.entryPoints?.[0]?.price ? ` · entry ${a.entryPoints[0].price}` : ''}${a.stopLoss ? ` · stop ${a.stopLoss}` : ''}`
                            : '';
                        // Carry the message id back to the dock: it stamps
                        // the answer entry's data-message-id so the gallery's
                        // Locate can scroll straight to it.
                        resolve({
                            text: [summary.slice(0, 8000), verdict].filter(Boolean).join('\n\n') || 'The analysis completed with no summary.',
                            messageId: aiMessage.id,
                        });
                    },
                    onError: (error) => {
                        if (settled) return;
                        settled = true;
                        reject(new Error(error));
                    },
                },
            }).then((outcome) => {
                // Settlement guard (mirrors useAutomations'): several of the
                // pipeline's early exits — cancel, 429, quota, offline
                // re-queue, parked send, blocked pre-flight — call NO
                // automation callback. Without settling from the awaited
                // outcome, one cancelled run left the dock's run guard set
                // forever and every later full-analysis send in that session
                // was silently swallowed until reload.
                if (settled) return;
                settled = true;
                if (outcome?.ok) resolve(ANALYSIS_STOP_TEXT);
                else reject(new Error('the analysis ended without a verdict (rate limit, quota, or a pre-run block)'));
            }, (error: unknown) => {
                if (settled) return;
                settled = true;
                reject(error instanceof Error ? error : new Error(String(error)));
            });
        });
    }, [isAnalysisInProgress, readyProviders, selectedOcrModel, moderatorProviderId, moderatorModel, leverageInput, handleSendMessage]);

    /** The Agents surface's analysis entry — the same promise the dock gets, on
     *  the NORMAL conversation path. The dock runs into a private message list
     *  (it renders the answer out of chatStore); the Chat surface renders the
     *  ACTIVE conversation, so routing it through `automation` left it watching
     *  an empty thread while a full ensemble debate ran. `onSettled` reports
     *  the verdict back without moving the run, so this surface ends up with
     *  its rows in `messages` AND its copy in the shared chat session. */
    const handleRunAnalysisFromAgents = useCallback((prompt: string, chatImages: Array<{ name: string; dataURL: string }>): Promise<string | { text: string; messageId?: string }> => {
        if (isAnalysisInProgress) return Promise.reject(new Error('an analysis is already running — wait for it or stop it first'));
        if (readyProviders.length === 0) return Promise.reject(new Error('no AI providers are configured'));
        const images: ImageMetadata[] = chatImages.map(img => ({
            file: new File([], img.name, { type: 'image/png' }),
            dataURL: img.dataURL,
            isLoading: false,
        }));
        return new Promise<string | { text: string; messageId?: string }>((resolve, reject) => {
            let settled = false;
            void handleSendMessage(prompt, images, undefined, {
                ...activeInstrument(),
                onSettled: (aiMessage) => {
                    if (settled) return;
                    settled = true;
                    const display = deriveMessageDisplayText(aiMessage);
                    const summary = (display.displayContent || aiMessage.text || '').trim();
                    resolve({ text: summary.slice(0, 8000) || 'The analysis completed with no summary.', messageId: aiMessage.id });
                },
            }).then((outcome) => {
                // Same settlement guard as the dock wrapper: the pipeline's
                // callback-less early exits must still settle this promise,
                // or the Agents surface's run slot leaks until reload.
                if (settled) return;
                settled = true;
                if (outcome?.ok) resolve(ANALYSIS_STOP_TEXT);
                else reject(new Error('the analysis ended without a verdict (rate limit, quota, or a pre-run block)'));
            }, (error: unknown) => {
                if (settled) return;
                settled = true;
                reject(error instanceof Error ? error : new Error(String(error)));
            });
        });
    }, [isAnalysisInProgress, readyProviders, handleSendMessage]);



    /** The canonical conversation for whichever bot the dock is bound to, as
     *  rows, recomputed whenever `messages` changes.
     *
     *  This is what makes a bot session in the dock a VIEW of the conversation
     *  rather than a copy taken when it was opened: a turn said in the Chat
     *  surface appears in an already-open dock session with nothing to click.
     *
     *  It rides `tradeBotRequest` — the bot the trader last pushed into the
     *  dock — because App is the scope that holds `messages` and re-renders
     *  when it changes. There is deliberately no second copy of this selection
     *  anywhere: a filter here that disagreed with the Chat rail's would be a
     *  filter that decides who owns a message, twice. */
    const tradeBotThread = useMemo(() => {
        const botId = tradeBotRequest?.botId;
        if (!botId) return [];
        const b = bots.find(x => x.id === botId);
        if (!b) return [];
        return threadForProvider(messages, b.providerId, b.modelId, b.id);
    }, [tradeBotRequest, bots, messages]);

    /** A bot turn asked in the Chart AI dock, committed to the conversation
     *  that owns it.
     *
     *  The dock is a VIEW of `messages` (see mergeBotConversation in the dock),
     *  and a view cannot write. So the turn had to be committed here, and until
     *  it was, a question asked in Chart AI produced an answer the Chat
     *  surface could not see — the trader switched surfaces and found the
     *  exchange had never happened.
     *
     *  Both rows go in, because the dock's composer writes into the chat
     *  session, not the conversation: unlike the Chat surface, the trader's own
     *  line is NOT already there waiting to be claimed. The answer is stamped
     *  `botId` + `modelsUsed`, which is what lets `threadForProvider` claim the
     *  pair as this bot's thread, and what keeps it out of the desk pane —
     *  one stamp, both behaviours, and no second opinion about ownership.
     *
     *  `answer === undefined` is the trader's question; a string is the settled
     *  answer. Two calls rather than one, so the question is visible in the
     *  other surface while it is still being answered.
     */
    const commitDockBotTurn = useCallback((bot: AgentBot, prompt: string, answer?: string): void => {
        const at = new Date().toISOString();
        const row: Message = answer === undefined
            ? { id: `dbu-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, role: MessageRole.USER, text: prompt, createdAt: at }
            : {
                id: `dba-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                role: MessageRole.AI,
                text: answer,
                createdAt: at,
                modelsUsed: { [bot.providerId]: bot.modelId },
                botId: bot.id,
            };
        updateMessages(prev => [...prev, row], activeConversationId ?? null);
    }, [updateMessages, activeConversationId]);

    // ─── Stable identities for overlay/panel callbacks ─────────────────────
    // Inline arrows here were recreated on every App render, busting
    // React.memo on ChatArea/Journal and rebuilding ChatArea's
    // enhancedContext (re-rendering every memoized transcript row) on each
    // keystroke / progress tick even when nothing relevant changed.
    const handleCloseJournal = useCallback(() => {
        setSurface('trade');
    }, [setSurface]);

    // Settings → Journal's launcher cards route to the JOURNAL SURFACE.
    // They used to call a handler that re-opened Settings at its own Journal
    // tab — a launcher loop the audit caught (the surface was never reachable
    // from Settings). One route now, the same one every other affordance uses.
    const handleOpenJournal = useCallback((tab: JournalUIState['tab'] = 'log') => {
        openJournal(tab);
    }, [openJournal]);

    const handleOpenLiveMarket = useCallback(() => {
        setIsLiveMarketVisible(true);
    }, []);

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
        setIsEntryNotHitCapturing,
        setConfidenceCalibration,
        setAutopilotResolutions,
        setInput,
        setImages,
        setExpandedPostMortems,
        setIsLoading,
        setActiveUsername,
        setExistingUsernames,
        setIsUserModalOpen,
        toast,
        profileReadyRef,
    });
    resetAppStateRef.current = userProfileResetAppState;

    const [skillDraftNonce, setSkillDraftNonce] = useState(0);
    /** Bumped on any notebook write — the Agents rail's per-bot learning stats
     *  read the notebook, so they refresh with it rather than every price tick. */
    const [memoryNonce, setMemoryNonce] = useState(0);
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
    // Per-bot learning stats for the Agents rail (WS-3.4). Walks the notebook,
    // so it is keyed to notebook writes and the roster — not to price ticks.
    const botStats = useMemo(() => loadBotLearningStats(), [bots, memoryNonce]);
    // Surface-menu badges. Memoized because App re-renders on every price tick
    // and both Header and SurfaceMenuList are React.memo'd — a fresh object
    // literal would invalidate the memo once a second for nothing.
    const navBadges = useMemo<Partial<Record<AppSurface, NavBadge>>>(() => {
        const next: Partial<Record<AppSurface, NavBadge>> = {};
        // The group runner owns the working pulse; a draining DM queue counts
        // too (the roster rail already read it this way — the rail didn't).
        const working = workingBotId ?? dmWorkingBotId;
        if (working) {
            next.agents = { active: true, detail: 'a bot is working' };
        }
        if (isInsightGenerating) {
            next.journal = {
                active: true,
                detail: insightProgress
                    ? `summarizing ${insightProgress.done}/${insightProgress.total} trades`
                    : 'generating insights',
            };
        }
        // The Learn badge counts what is still UNDECIDED across every queue
        // that surface hosts — the Coach inbox's drafts and proposals, the
        // amendments, everything else. The supervisor may already be working
        // through them, but a decision the model has not recorded yet is
        // something the user can still lose.
        // No Learn count here any more: the Approvals row below it on the same
        // rail routes into this surface and carries the one number.
        return next;
    }, [workingBotId, dmWorkingBotId, isInsightGenerating, insightProgress, activeUsername, skillDraftNonce, learningQueueNonce]);
    // One number for one meaning. The rail's Approvals row used to count the
    // drawer's items (which included skill drafts) while the Learn badge counted
    // drafts + proposals + amendments — two figures for overlapping sets, both
    // labelled as if they were the whole backlog. This is the union, and the
    // Learn surface badge is gone, because the row routes INTO that surface.
    const approvalsWaiting = useMemo(() => {
        // The notebook's own pending total (drafts + proposals + amendments),
        // plus the permissions the harness is asking for. A skill draft appears
        // in approvalItems too, so it is counted once, from the store — not
        // twice because two surfaces happened to list it.
        const permissions = approvalItems.filter(i => i.kind !== 'skill').length;
        return countPendingEverything(activeUsername || 'default') + permissions;
    }, [approvalItems, activeUsername, skillDraftNonce, learningQueueNonce, memoryNonce]);
    const selectTeamThread = useCallback(() => setActiveThread({ kind: 'team' }), []);
    const coachAllowDraft = useCallback((draft: SkillDraft): void => {
        void approveSkillDraft(draft, activeUsername || 'default', loggedTradesRef.current)
            .then(r => { const t = skillApprovalToast(r, draft.crafted.name); toast[t.kind](t.title, t.body); });
    }, [activeUsername]);
    const coachDenyDraft = useCallback((draft: SkillDraft): void => {
        takeSkillDraft(draft.id, activeUsername || undefined);
        tombstoneSkillDraftKey(
            draftTriggerKey(draft.coin, draft.crafted),
            activeUsername || undefined,
        );
        toast.success('Skill discarded', 'Similar suggestions paused for 7 days');
    }, [activeUsername]);
    // Roster clicks route into the Chart AI dock (the Chat surface is gone).
    // Declared after the thread selectors above so their useCallback
    // identities exist at first read.
    const openBotInTrade = useCallback((id: string) => {
        selectBotThread(id);
        setTradeBotRequest({ botId: id, nonce: Date.now() });
        setSurface('trade');
    }, [selectBotThread, setSurface]);
    const openGroupInTrade = useCallback((id: string) => {
        selectGroupThread(id);
        setTradeGroupRequest({ groupId: id, nonce: Date.now() });
        setSurface('trade');
    }, [selectGroupThread, setSurface]);
    /** The Coach inbox merged into the Learn surface, so a coach hop names the
     *  tab rather than opening a dock session. */
    const renderCoachInbox = useCallback(() => (
        <React.Suspense fallback={null}>
            <CoachThreadPanel onAllowDraft={coachAllowDraft} onDenyDraft={coachDenyDraft} />
        </React.Suspense>
    ), [coachAllowDraft, coachDenyDraft]);
    /** The one inbox. The nav rail's Approvals row and every "open the Coach"
     *  affordance land here, so a decision has exactly one address. */
    const openApprovalsInLearn = useCallback(() => {
        setLearnTab('coach');
        setSurface('learn');
    }, [setSurface]);
    // Skill-citation chip tap: open Settings → Skills so the
    // Skill-citation chip tap: open the Strategy Studio surface so it mounts
    // and consumes the pending slug (Studio listens for the same event when
    // already open). The Settings → Skills tab is now just a pointer here.
    useEffect(() => {
        const onOpenSkill = (): void => {
            setIsSettingsMenuVisible(false);
            setSurface('skills');
        };
        window.addEventListener('august:open-skill', onOpenSkill);
        return () => window.removeEventListener('august:open-skill', onOpenSkill);
    }, []);

    // "Try in chat" from the Studio or the learning queue: the dock reads the
    // hand-off itself (see skillDeepLink), but on Learn nothing would show the
    // result, so App does the travelling.
    useEffect(() => {
        const onTrySkill = (): void => setSurface('trade');
        window.addEventListener('august:try-skill', onTrySkill);
        return () => window.removeEventListener('august:try-skill', onTrySkill);
    }, []);


    useWatchSideEffects({
        messagesRef,
        setConversationHistory,
        setAutopilotResolutions,
        toast,
        confirmAutopilot: confirmAutopilotRef,
        activeUsername,
    });

    // WS-2.1: the supervisor's listeners + startup sweep live at App level —
    // a session that never opens the Trade dock still self-governs its queues.
    useSupervisorBootstrap(activeUsername);

    // The four scheduled passes used to fire once, from the profile load, so
    // they only ran when the app was opened. App level for the same reason as
    // the supervisor above: the loop belongs to the session, not to whichever
    // surface happens to be mounted.
    useLearningHeartbeat(activeUsername, loggedTrades);


    // F6: best-effort backup when the desktop app closes — the unload flush
    // protects the DB, but a fresh snapshot guards against IndexedDB
    // eviction/corruption between the 30-minute auto-backups. Throttled to
    // once per 10 minutes so quick relaunches don't churn backup files.
    const lastExitBackupRef = useRef(0);
    useEffect(() => {
        const onBeforeUnload = () => {
            if (typeof window.electronAPI === 'undefined') return;
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
                // Read the draft WITHOUT consuming it: the old path took it off
                // the queue first, so a write that silently declined destroyed
                // the trader's only copy and still said "Skill saved".
                const draft = listSkillDrafts(activeUsername || undefined)
                    .find(d => d.id === item.id);
                if (!draft) return;
                void approveSkillDraft(draft, activeUsername || 'default', loggedTrades)
                    .then(r => { const t = skillApprovalToast(r, draft.crafted.name); toast[t.kind](t.title, t.body); });
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

    // The status bar's readouts. A thread that has never been opened reports
    // null, not 0% — 0% would claim an empty window the app never filled, and a
    // trader who sees "0%" while the notebook is loaded correctly stops trusting
    // the number.
    const chatModelLabel = useMemo(() => {
        const id = moderatorConfig?.selectedModel;
        if (!id) return null;
        const named = (modelIdToName as Record<string, string>)[id];
        return named || id;
    }, [moderatorConfig, modelIdToName]);
    const chatWindowTokens = moderatorConfig?.contextWindowTokens ?? DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS;
    const contextPercent = useMemo(() => {
        if (messages.length === 0) return null;
        const chars = messages.reduce((n, m) => n + (m.text?.length ?? 0), 0);
        if (chars <= 0) return null;
        return Math.min(100, Math.round((tokensForChars(chars) / chatWindowTokens) * 100));
    }, [messages, chatWindowTokens]);
    const [supervisorAuto, setSupervisorAuto] = useState(() => supervisorStore.isAutoEnabled());
    useEffect(() => supervisorStore.subscribe(
        () => setSupervisorAuto(supervisorStore.isAutoEnabled()),
    ), []);

    const renderActionApprovals = useCallback(() => (
        <React.Suspense fallback={null}>
            <ActionApprovalsPanel
                items={approvalItems}
                onAllow={approvalHandlers.allow}
                onDeny={approvalHandlers.deny}
                onAlways={approvalHandlers.always}
                onNever={approvalHandlers.never}
                onOpen={(item) => {
                    // The dock owns the only transcript scroller, and it
                    // registers its bridge on mount — so from another surface
                    // this can honestly do one thing: land the user on Trade.
                    // Calling the bridge there would be a null deref that
                    // silently scrolls nothing.
                    const dockIsMounted = surface === 'trade';
                    setSurface('trade');
                    if (dockIsMounted) handleLocateMessage(item.messageId);
                }}
            />
        </React.Suspense>
    ), [approvalItems, approvalHandlers, surface, handleLocateMessage, setSurface]);


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
        <div ref={appRef} className="flex flex-col bg-zinc-950 text-zinc-100 font-sans h-full overflow-hidden">
            {/* Custom confirm dialog + undo toast (replaces window.confirm) */}
            {ConfirmDialogComponent}

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
            <UserProfileManager isVisible={isUserModalOpen} isLoading={isLoading} onUserSelect={loadUserData} existingUsers={existingUsernames} onImportProfile={handleImportData} onDeleteUser={handleDeleteUser} onClose={() => setIsUserModalOpen(false)} />
            <AccuracyModeModal isOpen={showAccuracyModal} onClose={() => setShowAccuracyModal(false)} onConfirm={handleConfirmAccuracyMode} isEnabling={!isAccuracyModeEnabled} />
            {/* Mounted only while the overlay is open: LiveMarket now runs the
                app's shared live feed (a combined futures socket PLUS a kline
                socket), so leaving the panel mounted-but-hidden would hold two
                sockets and a REST poller open for the whole session. The panel
                returns null on !isVisible anyway, so nothing it can see
                changes — it just stops paying for it while it is closed. */}
            {isLiveMarketVisible && (
                <LiveMarket isVisible onClose={() => setIsLiveMarketVisible(false)} onAnalyze={handleLiveMarketAnalyze} />
            )}
            {dataCaptureCandidate && (
                <DataCaptureModal
                    message={dataCaptureCandidate.message}
                    outcome={dataCaptureCandidate.outcome}
                    onClose={() => setDataCaptureCandidate(null)}
                    onUploadScreenshot={handleDataCaptureUpload}
                    onAutoCapture={handleDataCaptureAuto}
                    onSkip={handleDataCaptureSkip}
                    isCapturing={isAutoCaptureBusy}
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
                    isCapturing={isEntryNotHitCaptureBusy}
                />
            )}
            {postMortemCandidate && <PostTradeUploadModal candidate={postMortemCandidate} onClose={() => setPostMortemCandidate(null)} onAnalyze={(summaries, urls) => startPostMortemAnalysis(postMortemCandidate, summaries, urls)} visionConfig={visionConfig} onQuotaExceeded={handleQuotaExceeded} />}
            {updateCandidate && <UpdateTradeModal message={updateCandidate} onClose={() => setUpdateCandidate(null)} onConfirm={handleConfirmUpdateTrade} onAutoCapture={handleUpdateAutoCapture} isCapturing={isUpdateCaptureBusy} visionConfig={visionConfig} onQuotaExceeded={handleQuotaExceeded} />}
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
                onOpenStrategyStudio={() => { setSurface('skills'); setIsSettingsMenuVisible(false); }}
                onOpenLearn={(tab) => { setLearnTab(tab ?? null); setSurface('learn'); setIsSettingsMenuVisible(false); }}
                summaryCharLimit={summaryCharLimit}
                onUpdateSummaryCharLimit={handleUpdateSummaryCharLimit}
                useAlgorithmicSummary={useAlgorithmicSummary}
                onToggleAlgorithmicSummary={setUseAlgorithmicSummary}
                useAlgorithmicInsights={useAlgorithmicInsights}
                onToggleAlgorithmicInsights={setUseAlgorithmicInsights}
                onSwitchUser={handleSwitchUser}
                onExportData={handleExportData}
                username={activeUsername || undefined}
                onProfileRestored={(restoredUsername) => { loadUserData(restoredUsername); }}
                isAccuracyModeEnabled={isAccuracyModeEnabled}
                isEnsembleEnabled={isEnsembleEnabled}
                onToggleEnsembleEnabled={() => handleSetEnsembleEnabled(!isEnsembleEnabled)}
                onToggleAccuracyMode={handleToggleAccuracyMode}
                accuracySubMode={accuracySubMode}
                setAccuracySubMode={setAccuracySubMode}
                isHybridIntelligenceEnabled={isHybridIntelligenceEnabled}
                setIsHybridIntelligenceEnabled={setIsHybridIntelligenceEnabled}
                isAutoCapturing={isAutoCapturing}
                onToggleAutoCapturing={() => setIsAutoCapturing(!isAutoCapturing)}
                isEntryNotHitCapturing={isEntryNotHitCapturing}
                onToggleEntryNotHitCapturing={() => setIsEntryNotHitCapturing(!isEntryNotHitCapturing)}
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
            />
            </React.Suspense>
            <VisionDataViewer isVisible={isVisionDataVisible} onClose={() => setIsVisionDataVisible(false)} visionData={currentVisionData} />

            {/* Automations: the selected automation's card feed + editor */}
            {automations.viewAutomationId && (() => {
                const config = automations.configs.find(c => c.id === automations.viewAutomationId);
                if (!config) return null;
                return (
                    <div className="fixed inset-0 z-[75] bg-zinc-950 animate-fade-in">
                        <React.Suspense fallback={<SurfaceSkeleton />}>
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
                        </React.Suspense>
                    </div>
                );
            })()}
            {/* The editor is lazy, so it is gated on editorIsOpen — rendering it
                unconditionally would fetch the chunk at startup for a modal
                that opens rarely. Gating remounts it per open, which
                re-initializes its form state from `initial`: the intended
                trade-off (discarding unsaved edits on close) and incidentally
                a fix — the always-mounted version never re-read `initial`, so
                editing automation A, closing, then opening B showed A's values. */}
            {editorIsOpen && (
                <React.Suspense fallback={null}>
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
                </React.Suspense>
            )}


            <Header
                saveStatus={saveStatus}
                isAnalysisInProgress={isAnalysisInProgress}
                isPostMortemInProgress={isPostMortemInProgress}
                currentVisionData={currentVisionData}
                surface={surface}
                setIsLivePostMortemVisible={setIsLivePostMortemVisible}
                isOnline={isOnline}
                pendingQueueCount={pendingQueueCount}
                liveMarketConditions={liveMarketConditions}
                liveMarketSymbol={liveMarketSymbol}
                onOpenActivity={() => setIsJobsDrawerVisible(true)}
                onOpenLiveMarket={handleOpenLiveMarket}
                onOpenVisionData={() => setIsVisionDataVisible(true)}
                hasVisionData={currentVisionData.length > 0}
                onExpandNavRail={isNavRailOpen ? undefined : toggleNavRail}
            />

            {/* The old Journal OVERLAY was removed (navigation rewired to the
                journal surface): the live render is the embedded branch in
                <main> below — do not re-add an overlay or journalState-style
                plumbing. */}

            <React.Suspense fallback={null}>
            {isStrategySearchEverOpened && (
                <StrategySearch isVisible={isStrategySearchVisible} onClose={() => { setIsStrategySearchVisible(false); setStrategyToView(null); }} onApplyStrategy={handleApplyStrategy} onRemoveStrategy={handleRemoveStrategy} providerConfig={readyProviders[0] || moderatorConfig} activeFrameworks={activeFrameworks} defaultFrameworks={DEFAULT_FRAMEWORKS} initialViewStrategy={strategyToView} onQuotaExceeded={handleQuotaExceeded} familyWinRates={familyWinRates} />
            )}
            </React.Suspense>
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
            {/* Background-jobs drawer — visible autonomy. Stage 3 widened it
                into the Activity drawer: the rail's automations section lives
                here now, one drawer for everything the app does on its own. */}
            <React.Suspense fallback={null}>
                <JobsDrawer
                    open={isJobsDrawerVisible}
                    onClose={() => setIsJobsDrawerVisible(false)}
                    automations={automations.configs}
                    onOpenAutomation={(id) => { setIsJobsDrawerVisible(false); automations.openAutomation(id); }}
                    onCreateAutomation={() => { setIsJobsDrawerVisible(false); automations.setEditor({ mode: 'create' }); }}
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


            {/* Main row: the nav rail and the surfaces share it. The rail sits BESIDE
                the content rather than spanning the header too, so the header
                keeps its full width for the command palette and the live-market
                read — and so the rail is a plain flex child, not something that
                has to out-z-index the sticky header. */}
            <div className="flex-1 flex flex-row min-h-0">
                <NavRail
                    expanded={isNavRailOpen}
                    onToggleExpanded={toggleNavRail}
                    overlay={isNavOverlay}
                    onCloseOverlay={closeNavOverlay}
                    activeUsername={activeUsername}
                    surface={surface}
                    onSelectSurface={handleSurfaceSelect}
                    badges={navBadges}
                    onOpenApprovals={openApprovalsInLearn}
                    approvalsCount={approvalsWaiting}
                    onSwitchUser={handleSwitchUser}
                    onOpenSettings={() => setIsSettingsMenuVisible(true)}
                />
                {/* Surfaces: pages, not modals. The Chat surface is gone — the
                    trade surface's Chart AI dock carries the chats, panels and
                    roster threads; the Coach inbox is a Learn tab; the other
                    tabs embed existing components. */}
                <main className="flex-1 flex flex-col min-h-0 min-w-0 relative bg-zinc-950">
                    {/* Mistake Warning Banner - Global Risk Reminder */}
                    {loggedTrades.length > 0 && (
                        <React.Suspense fallback={null}>
                        <MistakeWarningBanner
                            tradeLog={loggedTrades}
                        />
                        </React.Suspense>
                    )}

                    {/* The first-run onboarding card used to sit here as a
                        centered banner, but it ate ~50% of the Trade surface
                        width. The same nudge now lives inside the Chart AI
                        dock's composer card (see TradeChatPanel) so it shows
                        up exactly where the user needs to take action. */}

                    {surface === 'trade' && (
                            <React.Suspense fallback={<SurfaceSkeleton />}>
                                <TradeView
                                    providers={providerConfigs}
                                    selectedChatModel={selectedChatModel}
                                    onSelectChatModel={setSelectedChatModel}
                                    onRefreshModels={refreshModelCatalog}
                                    sidebarOpen={surface === 'trade' && tradeSidebarOpen}
                                    onToggleSidebar={toggleTradeSidebar}
                                    modeRequest={tradeModeRequest ?? undefined}
                                    activeUsername={activeUsername ?? undefined}
                                    onTradeModeChange={(m) => { lastRequestedTradeModeRef.current = m; }}
                                    onOpenChat={() => handleSurfaceSelect('agents')}
                                    /* The same two handlers the Chat rail gets, so
                                       the dock is the Chat's compact form rather
                                       than a reduced one: it can open a room and
                                       the Coach inbox, not just list rooms. */
                                    botThreadRows={tradeBotThread}
                                    onBotTurnCommit={commitDockBotTurn}
                                    onNewGroup={() => setIsNewGroupOpen(true)}
                                    onOpenCoach={openApprovalsInLearn}
                                    coachCount={coachCount}
                                    surfaceEnterFrom={surfaceEnterFrom}
                                    verdict={deskSceneMessage?.analysis}
                                    bots={bots}
                                    trades={loggedTrades}
                                    groups={groups.map(g => ({ id: g.id, name: groupDisplayName(g, bots) }))}
                                    botSessionRequest={tradeBotRequest ?? undefined}
                                    groupSessionRequest={tradeGroupRequest ?? undefined}
                                    onRunAnalysis={handleRunAnalysisFromChat}
                                    getAnalysisMessage={getAnalysisMessage}
                                    onLogProposedTrade={handleLogProposedTrade}
                                    registerScrollToMessage={registerScrollToMessage}
                                    onToggleDeskScene={() => setIsDeskSceneOpen(v => !v)}
                                    onToggleWatch={handleToggleWatch}
                                    onOpenWatchList={() => setIsWatchListVisible(true)}
                                    watchOpenCount={watchedSignals.filter(s => !s.outcome || s.outcome === TradeOutcome.PENDING).length}
                                    watchOpenR={watchOpenR}
                                    pinnedMessageIds={pinnedMessageIds}
                                    isDeskSceneOpen={isDeskSceneOpen}
                                    hasDeskSceneMessage={!!deskSceneMessage}
                                    renderGroupSurface={renderGroupSurface}
                                />
                            </React.Suspense>
                        )}
                        {surface === 'journal' && (
                            <React.Suspense fallback={<SurfaceSkeleton />}>
                                <Journal
                                    isVisible={true}
                                onClose={handleCloseJournal}
                                initialTab={journalTab}
                                openNonce={journalOpenNonce}
                                username={activeUsername || undefined}
                                trades={loggedTrades}
                                onDeleteTrades={handleDeleteTrades}
                                onClearAllTrades={handleClearAllTrades}
                                modelIdToName={modelIdToName}
                                onUpdateInsights={handleManualInsightsUpdate}
                                isSummarizing={isSummaryInProgress}
                                currentInsightIds={currentInsightIds}
                                onUpdateTradeLeverage={handleUpdateTradeLeverage}
                onUpdateTradeType={handleUpdateTradeType}
                                onUpdateOutcome={handleUpdateTradeOutcome}
                                onUpdatePnL={handleUpdateTradePnL}
                                savedAnalyses={savedAnalyses}
                                onDeleteSavedAnalyses={handleDeleteSavedAnalyses}
                                onClearAllSavedAnalyses={handleClearAllSavedAnalyses}
                                onLocateSavedAnalysis={handleLocateSavedAnalysis}
                                ocrModelIdToName={ocrModelIdToName}
                                />
                            </React.Suspense>
                        )}
                        {surface === 'skills' && (
                            <React.Suspense fallback={<SurfaceSkeleton />}>
                                <StrategyStudio
                                    trades={loggedTrades}
                                    onOpenStrategySearch={() => setIsStrategySearchVisible(true)}
                                    username={activeUsername || undefined}
                                    memoryConfig={memoryConfig}
                                    currentRegime={(currentHybridData as { regime?: { regime?: string } } | null)?.regime?.regime}
                                    onClose={() => setSurface('trade')}
                                />
                            </React.Suspense>
                        )}
                        {surface === 'learn' && (
                            <React.Suspense fallback={<SurfaceSkeleton />}>
                                <LearnView
                                    username={activeUsername || 'default'}
                                    trades={loggedTrades}
                                    memoryConfig={memoryConfig}
                                    initialTab={learnTab}
                                    onInitialTabConsumed={learnTabConsumed}
                                    renderCoach={renderCoachInbox}
                                    renderActionApprovals={renderActionApprovals}
                                    coachCount={coachCount}
                                    reviewSummary={finalTradeSummary}
                                    reviewLoading={isLoading}
                                    onRegenerateReview={handleRegenerateFinalSummary}
                                />
                            </React.Suspense>
                        )}
                        {surface === 'agents' && (
                            <React.Suspense fallback={<SurfaceSkeleton />}>
                                <AgentsView
                                    username={activeUsername || ''}
                                    bots={bots}
                                    groups={groups}
                                    messages={messages}
                                    selection={activeThread}
                                    onSelect={t => {
                                        if (t.kind === 'bot') selectBotThread(t.botId);
                                        else if (t.kind === 'group') selectGroupThread(t.groupId);
                                        else selectTeamThread();
                                    }}
                                    onNewBot={() => setIsNewBotOpen(true)}
                                    onNewGroup={() => setIsNewGroupOpen(true)}
                                    onSendBotTurn={async (bot, prompt) =>
                                        (await mailboxRef.current?.runUserBotTurn(bot, prompt)) ?? false}
                                    onAnalyze={handleRunAnalysisFromAgents}
                                    renderGroup={g => renderGroupSurface(g.id)}
                                    coachCount={coachCount}
                                    surfaceEnterFrom={surfaceEnterFrom}
                                    workingBotId={workingBotId ?? dmWorkingBotId}
                                    lastOpenedMap={threadOpenedMap}
                                    attentionMap={attentionMap}
                                    botRoutines={botRoutinesMap}
                                    botStats={botStats}
                                    providerReady={readyProviders.length > 0}
                                    onRunRoutine={runRoutineFromRail}
                                    onDeleteBot={deleteBot}
                                    onRenameBot={(botId, name) => updateBot(botId, { name })}
                                    onEditSeatOverrides={setSeatOverridesBot}
                                    onOpenCoach={openApprovalsInLearn}
                                    onDeleteGroup={deleteGroup}
                                    onRetryPostMortem={handleRetryPostMortem}
                                    onEditGroup={groupId => {
                                        const target = groups.find(g => g.id === groupId);
                                        if (!target) return;
                                        setGroupEditTarget(target);
                                        setIsNewGroupOpen(true);
                                    }}
                                    modelPicker={(
                                        <ModelPicker providers={providerConfigs} value={selectedChatModel}
                                            onChange={setSelectedChatModel} onRefreshModels={refreshModelCatalog} compact />
                                    )}
                                    modelFallback={(() => {
                                        // Same helper the dock uses, over the same
                                        // list the picker offers: a stale pick warns
                                        // here as loudly as it does in the dock.
                                        const f = computeChatModelFallback(providerConfigs, selectedChatModel);
                                        return f.issue && f.provider ? { issue: f.issue, provider: f.provider } : null;
                                    })()}
                                    onOpenInDock={() => {
                                        // Chat → Chart AI: the chart arrives from
                                        // the RIGHT. This path deliberately does
                                        // NOT go through handleSurfaceSelect (the
                                        // bot/group branches navigate themselves),
                                        // so the direction has to be set here too
                                        // or the hop animates as a plain cut.
                                        setSurfaceEnterFrom('right');
                                        if (activeThread.kind === 'bot') openBotInTrade(activeThread.botId);
                                        else if (activeThread.kind === 'group') openGroupInTrade(activeThread.groupId);
                                        else setSurface('trade');
                                    }}
                                    conversations={conversationHistory}
                                    activeConversationId={activeConversationId}
                                    onLoadConversation={(id) => {
                                        // A loaded conversation's general rows land
                                        // in the desk pane's slice, so the selection
                                        // follows — otherwise the pane kept showing
                                        // the previous thread while the transcript
                                        // silently swapped underneath (stage-3 fix
                                        // for the silent-session-swap defect).
                                        handleLoadConversation(id);
                                        selectTeamThread();
                                    }}
                                    onDeleteConversation={handleDeleteConversationFromSidebar}
                                    onClearConversation={(id) => { void handleClearChat(id); }}
                                    onNewChat={handleStartNewConversation}
                                />
                            </React.Suspense>
                        )}
                    </main>

                {/* Desktop activity card: float progress over the
                    right side so the conversation keeps its width while a run
                    is live. Collapsible + closable so it never traps content
                    underneath; the pill keeps Stop one click away.
                    Breakpoint: md (768px), NOT lg — the Electron window has an
                    800px minimum width, and at lg (1024px) the whole
                    800-1023px desktop band ran as a silent black box with no
                    discoverable Stop. Mobile (<md) keeps the dock's Stop. */}
                {showPipelineCard && (
                    <div className="pointer-events-none fixed right-4 top-24 z-40 hidden w-[min(20rem,calc(100vw-2rem))] max-h-[calc(100vh-7rem)] md:block">
                        {isPipelineCollapsed ? (
                            /* Collapsed pill: status + expand/dismiss + Stop. */
                            <div className="pointer-events-auto flex h-fit items-center gap-1.5 rounded-full border border-white/10 bg-zinc-950 px-3 py-1.5 shadow-lg" aria-label="Analysis progress (collapsed)">
                                <span className="flex items-center gap-1.5 rounded-full bg-cyan-500/10 px-2 py-0.5 text-ui-xs font-medium text-cyan-300">
                                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400" aria-hidden="true" />
                                    Running
                                </span>
                                <button type="button" onClick={() => setIsPipelineCollapsed(false)} className="text-ui-dense text-zinc-400 transition-colors hover:text-zinc-100" title="Show pipeline steps">Show</button>
                                <button type="button" onClick={() => setIsPipelineDismissed(true)} className="rounded p-1 text-zinc-500 transition-colors hover:text-zinc-200" title="Hide for this run" aria-label="Dismiss analysis progress">
                                    <CloseIcon className="h-3.5 w-3.5" aria-hidden="true" />
                                </button>
                            </div>
                        ) : (
                        <div className="pointer-events-auto h-fit max-h-[calc(100vh-7rem)] overflow-y-auto rounded-2xl border border-white/10 bg-zinc-950 p-3 custom-scrollbar" aria-label="Analysis progress">
                            <div className="flex items-center justify-between px-1 pb-3">
                                <div>
                                    <h2 className="text-ui-base font-medium text-zinc-200">Analysis</h2>
                                    <p className="mt-0.5 text-ui-dense text-zinc-500">Pipeline</p>
                                </div>
                                <span className="ml-auto flex shrink-0 items-center gap-1">
                                    <span className="flex items-center gap-1 rounded-full bg-cyan-500/10 px-2 py-1 text-ui-xs font-medium text-cyan-300">
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
                                        <ChevronDownIcon className="h-4 w-4" aria-hidden="true" />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setIsPipelineDismissed(true)}
                                        className="rounded-md p-1 text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-100"
                                        title="Hide for this run"
                                        aria-label="Dismiss analysis progress"
                                    >
                                        <CloseIcon className="h-4 w-4" aria-hidden="true" />
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
                                    <div className="flex items-center gap-2 text-ui-base text-zinc-300" aria-live="polite">
                                        <span className="h-2 w-2 animate-pulse rounded-full bg-cyan-400" aria-hidden="true" />
                                        {loadingMessage || 'Analysis in progress'}
                                    </div>
                                    <button
                                        type="button"
                                        onClick={handleCancelAnalysis}
                                        className=" mt-4 w-full rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-ui-sm font-medium text-rose-300 transition-colors hover:bg-rose-500/20"
                                    >
                                        Stop generating
                                    </button>
                                </div>
                            )}
                        </div>
                        )}
                    </div>
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
                        onOpenActor={() => {
                            // The per-seat transcript hand-off this used to
                            // request never shipped, so the click does what it
                            // has always visibly done: dismiss the floor.
                            setIsDeskSceneOpen(false);
                        }}
                        onClose={() => setIsDeskSceneOpen(false)}
                    />
                </React.Suspense>
            )}

            {/* New Bot / New Group Chat dialogs */}
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

            {/* The command palette was deleted (stage 3): a fixed action list
                that duplicated chrome and could not search anything. Its
                sole-path actions were rehomed — StrategySearch onto the
                Studio, Saved Analyses into the Journal's Saved tab, the
                ensemble toggle into Settings → Analysis, clear-chat into the
                conversation row menu, jump-to-latest into the transcript's
                scroll-to-bottom pill. Every other entry was a duplicate. */}

            {/* Strategy Studio is a surface now (surface === 'skills' in the
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
            {seatOverridesBot && (
                <React.Suspense fallback={null}>
                    <BotSeatOverridesDialog open bot={seatOverridesBot} onClose={() => setSeatOverridesBot(null)} />
                </React.Suspense>
            )}

            {/* Always-visible, 28px, OUTSIDE every surface: what answers, how
                full the window is, whether the supervisor decides alone, and how
                much of the screen is showing. The telemetry this carries used to
                be six panels deep in Learn. */}
            <StatusBar
                modelLabel={chatModelLabel}
                contextPercent={contextPercent}
                contextWindowTokens={chatWindowTokens}
                supervisorAuto={supervisorAuto}
                pendingApprovals={approvalsWaiting}
                onOpenApprovals={openApprovalsInLearn}
                onOpenModels={() => setIsSettingsMenuVisible(true)}
                onOpenHealth={() => { setLearnTab('health'); setSurface('learn'); }}
            />
        </div>
        </React.Suspense>
    );
};

export default App;