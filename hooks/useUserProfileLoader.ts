import { useCallback, useEffect, useRef, useState } from 'react';
import * as dbService from '../services/infrastructure/dbService';
import { initNativeStatusBar } from '../services/infrastructure/NativeStatusBar';
import {
    initModelPerformanceService,
    syncFromTradeLog,
    syncRollingWindowFromTradeLog,
} from '../services/backtesting/ModelPerformanceService';
import {
    initAnalystLensService,
    loadLensConfig,
    type EnsembleModelSelection,
} from '../services/ui/AnalystLensService';
import { initPromptOverrides } from '../services/infrastructure/PromptOverrideService';
import { initStrategyDocs } from '../services/infrastructure/StrategyService';
import {
    initMemoryFiles,
    syncProfileMemory,
    syncPatternMemory,
    syncRecurringMistakes,
} from '../services/learning/MemoryFilesService';
import { hydrateRegimeLedger } from '../services/learning/regimeLedger';
import { hydrateStrategyRegimeMatrix } from '../services/learning/strategyRegimeMatrix';
import { ensureSeedSkills } from '../services/learning/seedStrategies';
import { ensureBookSkillDrafts } from '../services/learning/bookSkillDrafts';
import { runWeeklyRollupIfDue } from '../services/learning/weeklyRollup';
import { runWeeklyReviewIfDue } from '../services/learning/weeklyReview';
import { runMonthlyReportIfDue } from '../services/learning/monthlyReport';
import {
    initConfluenceService,
    syncConfluenceFromTradeLog,
} from '../services/analysis/TimeframeConfluenceService';
import {
    initPatternMemoryService,
    setAttributedInsightsUser,
} from '../services/learning/PatternMemorySynthesisService';
import GlobalLearningService from '../services/learning/GlobalLearningService';
import { PriceAlertService } from '../services/ui/PriceAlertService';
import { SetupWatchService } from '../services/ui/SetupWatchService';
import { OutcomeAutopilotService } from '../services/ui/OutcomeAutopilotService';
import { VetoLedgerService } from '../services/ui/VetoLedgerService';
import { storageService } from '../services/infrastructure/StorageService';
import { runMigrations, checkDataIntegrity, createStartupBackup, logIntegrityEvent } from '../services/validation/DataIntegrityService';
import { startAutoBackup } from '../services/infrastructure/BackupService';
import { getPreferenceObject, PREF_KEYS } from '../services/infrastructure/PreferencesService';
import { createNewConversation, DEFAULT_LEVERAGE } from '../utils/conversationUtils';
import { recalculateAnalysisMetrics } from '../utils/analysisUtils';
import { getFirstReadyProvider } from '../utils/providerUtils';
import { DEFAULT_FRAMEWORKS } from '../constants/models';
import { MAX_TRADE_SUMMARIES } from './useTradeLogging';
import type { Message, Conversation, LoggedTrade, CustomInstructionsMap, AccuracySubMode, TradeSummary } from '../types';
import type { ProviderConfig } from '../types/provider';

export interface UseUserProfileLoaderArgs {
    handleCancelAnalysis: () => void;
    invalidatePostMortemRuns: () => void;

    lensConfig: any;
    handleSetLensConfig: (cfg: any) => void;
    ensembleModelSelection: any;
    handleSetEnsembleModelSelection: (sel: any) => void;
    persistedEnsembleModeRef: React.MutableRefObject<boolean | null>;
    ensembleModelCount: number;

    providerConfigs: ProviderConfig[];

    setConversationHistory: React.Dispatch<React.SetStateAction<Conversation[]>>;
    setActiveConversationId: React.Dispatch<React.SetStateAction<string | null>>;

    setLoggedTrades: React.Dispatch<React.SetStateAction<LoggedTrade[]>>;
    setSavedAnalyses: React.Dispatch<React.SetStateAction<any[]>>;
    setTradeSummaries: React.Dispatch<React.SetStateAction<TradeSummary[]>>;
    setFinalTradeSummary: React.Dispatch<React.SetStateAction<string | null>>;
    setGlobalMemory: React.Dispatch<React.SetStateAction<any>>;
    setIsGlobalMemoryEnabled: React.Dispatch<React.SetStateAction<boolean>>;
    setMemoryConfig: React.Dispatch<React.SetStateAction<ProviderConfig | null>>;
    setMemoryModel: React.Dispatch<React.SetStateAction<string>>;
    setInsightKnowledgeBase: React.Dispatch<React.SetStateAction<any>>;

    setActiveFrameworks: React.Dispatch<React.SetStateAction<string[]>>;
    setSummaryCharLimit: React.Dispatch<React.SetStateAction<number>>;
    setSummarizationProvider: React.Dispatch<React.SetStateAction<string>>;
    setSummarizationModel: React.Dispatch<React.SetStateAction<string>>;
    setVisionModel: React.Dispatch<React.SetStateAction<string>>;
    setUseAlgorithmicSummary: React.Dispatch<React.SetStateAction<boolean>>;
    setUseAlgorithmicInsights: React.Dispatch<React.SetStateAction<boolean>>;
    setIsStrategiesEnabled: React.Dispatch<React.SetStateAction<boolean>>;
    setIsAccuracyModeEnabled: React.Dispatch<React.SetStateAction<boolean>>;
    setAccuracySubMode: React.Dispatch<React.SetStateAction<AccuracySubMode>>;
    setCustomInstructions: React.Dispatch<React.SetStateAction<CustomInstructionsMap>>;
    setIsPlaybookEnabledInPureAI: React.Dispatch<React.SetStateAction<boolean>>;
    setIsFamiliesEnabledInPureAI: React.Dispatch<React.SetStateAction<boolean>>;
    setIsMemoryEnabledInPureAI: React.Dispatch<React.SetStateAction<boolean>>;
    setIsHybridIntelligenceEnabled: React.Dispatch<React.SetStateAction<boolean>>;
    setIsEnsembleEnabled: React.Dispatch<React.SetStateAction<boolean>>;
    setIsAutoCapturing: React.Dispatch<React.SetStateAction<boolean>>;
    setIsUpdateAutoCapturing: React.Dispatch<React.SetStateAction<boolean>>;
    setIsEntryNotHitCapturing: React.Dispatch<React.SetStateAction<boolean>>;
    setConfidenceCalibration: React.Dispatch<React.SetStateAction<any>>;
    setAutopilotResolutions: React.Dispatch<React.SetStateAction<Record<string, any>>>;

    setInput: React.Dispatch<React.SetStateAction<string>>;
    setImages: React.Dispatch<React.SetStateAction<any[]>>;
    setExpandedPostMortems: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
    setHighlightedAnalysisId: React.Dispatch<React.SetStateAction<string | null>>;
    setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;

    setActiveUsername: (u: string) => void;
    setExistingUsernames: React.Dispatch<React.SetStateAction<string[]>>;
    setIsUserModalOpen: (open: boolean) => void;
    toast: { info: (msg: string) => void };
}

export interface UseUserProfileLoaderResult {
    loadUserData: (username: string) => Promise<void>;
    resetAppState: (usernameToSave?: string | null) => Promise<void>;
    profileReady: boolean;
    profileSelectionStartedRef: React.MutableRefObject<boolean>;
}

export const useUserProfileLoader = (args: UseUserProfileLoaderArgs): UseUserProfileLoaderResult => {
    const {
        handleCancelAnalysis, invalidatePostMortemRuns,
        lensConfig, handleSetLensConfig,
        ensembleModelSelection, handleSetEnsembleModelSelection,
        persistedEnsembleModeRef, ensembleModelCount,
        providerConfigs,
        setConversationHistory, setActiveConversationId,
        setLoggedTrades, setSavedAnalyses, setTradeSummaries, setFinalTradeSummary,
        setGlobalMemory, setIsGlobalMemoryEnabled, setMemoryConfig, setMemoryModel,
        setInsightKnowledgeBase, setActiveFrameworks, setSummaryCharLimit,
        setSummarizationProvider, setSummarizationModel, setVisionModel,
        setUseAlgorithmicSummary, setUseAlgorithmicInsights,
        setIsStrategiesEnabled, setIsAccuracyModeEnabled, setAccuracySubMode,
        setCustomInstructions, setIsPlaybookEnabledInPureAI, setIsFamiliesEnabledInPureAI,
        setIsMemoryEnabledInPureAI, setIsHybridIntelligenceEnabled,
        setIsEnsembleEnabled, setIsAutoCapturing, setIsUpdateAutoCapturing,
        setIsEntryNotHitCapturing, setConfidenceCalibration, setAutopilotResolutions,
        setInput, setImages, setExpandedPostMortems, setHighlightedAnalysisId,
        setIsLoading, setActiveUsername, setExistingUsernames, setIsUserModalOpen,
        toast,
    } = args;

    const [profileReady, setProfileReady] = useState(false);
    const profileSelectionStartedRef = useRef(false);

    const resetAppState = useCallback(async (usernameToSave?: string | null) => {
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
                settings: {
                    activeFrameworks: DEFAULT_FRAMEWORKS,
                    summaryCharLimit: 4000,
                    summarizationProvider: firstReady?.id || '',
                    summarizationModel: firstReady?.selectedModel || '',
                    visionModel: '',
                    isGlobalMemoryEnabled: false,
                    isAccuracyModeEnabled: false,
                    accuracySubMode: 'original',
                    customInstructions: { general: [], accuracyOriginal: [], accuracyPure: [] },
                    isPlaybookEnabledInPureAI: false,
                    isFamiliesEnabledInPureAI: false,
                    isMemoryEnabledInPureAI: false,
                    isHybridIntelligenceEnabled: false,
                    isAutoCapturing: false,
                    isUpdateAutoCapturing: false,
                    isEntryNotHitCapturing: false,
                    useAlgorithmicSummary: false,
                    useAlgorithmicInsights: false,
                    memoryProvider: '',
                    memoryModel: '',
                },
                lastActiveConversationId: newConv.id,
            });
        }
    }, [
        handleCancelAnalysis, providerConfigs, setActiveConversationId,
        setActiveFrameworks, setAccuracySubMode, setConversationHistory,
        setCustomInstructions, setExpandedPostMortems, setFinalTradeSummary,
        setGlobalMemory, setImages, setInput, setIsAccuracyModeEnabled,
        setIsAutoCapturing, setIsEntryNotHitCapturing, setIsFamiliesEnabledInPureAI,
        setIsGlobalMemoryEnabled, setIsHybridIntelligenceEnabled,
        setIsMemoryEnabledInPureAI, setIsPlaybookEnabledInPureAI,
        setIsUpdateAutoCapturing, setLoggedTrades, setMemoryConfig,
        setMemoryModel, setSavedAnalyses, setSummarizationModel,
        setSummarizationProvider, setSummaryCharLimit, setTradeSummaries,
    ]);

    const loadUserData = useCallback(async (username: string): Promise<void> => {
        handleCancelAnalysis();
        invalidatePostMortemRuns();
        setIsLoading(true);

        OutcomeAutopilotService.reset();
        setAutopilotResolutions({});

        try {
            await dbService.initDatabase();
            await initNativeStatusBar();
            await initModelPerformanceService();
            await initAnalystLensService();
            await initPromptOverrides(username);
            await initStrategyDocs(username);
            await initMemoryFiles(username);

            void hydrateRegimeLedger(username).catch(() => { /* ledger is best-effort */ });
            void hydrateStrategyRegimeMatrix(username).catch(() => { /* matrix is best-effort */ });
            // Book-prior seed corpus (Kakushadze & Serur): create any missing
            // seed skills once per boot. Idempotent by slug — user edits,
            // retirements and graveyard moves are never overwritten.
            void ensureSeedSkills(username).catch(() => { /* seeding is best-effort */ });
            // The trader's own strategy-PDF playbooks, queued once as
            // approval-gated skill drafts (Inbox / Coach). The flag guard means
            // approving or dismissing a draft is never undone on a later boot.
            try { ensureBookSkillDrafts(username); } catch { /* best-effort */ }
            void runWeeklyRollupIfDue(username).then(res => {
                if (res) console.log('[WeeklyRollup] pass complete:', res);
            }).catch(e => {
                console.warn('[WeeklyRollup] boot pass failed:', e instanceof Error ? e.message : e);
            });

            const cachedLens = loadLensConfig();
            if (cachedLens && JSON.stringify(cachedLens) !== JSON.stringify(lensConfig)) {
                handleSetLensConfig(cachedLens);
            }

            try {
                const cachedSelection = await getPreferenceObject<EnsembleModelSelection>(PREF_KEYS.ENSEMBLE_MODEL_SELECTION);
                if (Array.isArray(cachedSelection) && cachedSelection.length > 0
                    && JSON.stringify(cachedSelection) !== JSON.stringify(ensembleModelSelection)) {
                    handleSetEnsembleModelSelection(cachedSelection);
                }
            } catch (e) {
                console.warn('[App] Failed to sync ensemble model selection:', e);
            }

            await PriceAlertService.init();
            await SetupWatchService.init();
            await OutcomeAutopilotService.init();
            await VetoLedgerService.init(username);
            await initConfluenceService();
            await initPatternMemoryService();
            await GlobalLearningService.setActiveUser(username);
            setAttributedInsightsUser(username);

            const profile = await dbService.getUserProfile(username);
            if (profile) {
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
                syncConfluenceFromTradeLog(loadedTrades);

                void runWeeklyReviewIfDue(username, loadedTrades).then(res => {
                    if (res) console.log('[WeeklyReview] digest generated:', res.impulse.slice(0, 80));
                }).catch(e => {
                    console.warn('[WeeklyReview] boot pass failed:', e instanceof Error ? e.message : e);
                });

                void runMonthlyReportIfDue(username, loadedTrades).then(res => {
                    if (res) console.log('[MonthlyReport] card generated for period ending', res.generatedAt.slice(0, 10));
                }).catch(e => {
                    console.warn('[MonthlyReport] boot pass failed:', e instanceof Error ? e.message : e);
                });

                setSavedAnalyses(profile.savedAnalyses || []);
                setTradeSummaries((profile.tradeSummaries || []).slice(-MAX_TRADE_SUMMARIES));
                setFinalTradeSummary(profile.finalTradeSummary || null);
                setGlobalMemory(profile.globalMemory);
                setActiveFrameworks(profile.settings?.activeFrameworks || DEFAULT_FRAMEWORKS);
                setSummaryCharLimit(profile.settings?.summaryCharLimit || 4000);

                const firstReadyProvider = getFirstReadyProvider(providerConfigs);
                setSummarizationProvider(profile.settings?.summarizationProvider || firstReadyProvider?.id || '');
                setSummarizationModel(profile.settings?.summarizationModel || firstReadyProvider?.selectedModel || '');
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
                            accuracyPure: loadedInstructions.accuracyPure || [],
                        });
                    }
                } else {
                    setCustomInstructions(defaultMap);
                }

                setIsPlaybookEnabledInPureAI(profile.settings?.isPlaybookEnabledInPureAI ?? false);
                setIsFamiliesEnabledInPureAI(profile.settings?.isFamiliesEnabledInPureAI ?? false);
                setIsMemoryEnabledInPureAI(profile.settings?.isMemoryEnabledInPureAI ?? false);
                setIsHybridIntelligenceEnabled(profile.settings?.isHybridIntelligenceEnabled ?? false);

                persistedEnsembleModeRef.current = profile.settings?.isEnsembleEnabled ?? null;
                setIsEnsembleEnabled(profile.settings?.isEnsembleEnabled ?? (ensembleModelCount > 1));
                setIsAutoCapturing(profile.settings?.isAutoCapturing ?? false);
                setIsUpdateAutoCapturing(profile.settings?.isUpdateAutoCapturing ?? false);
                setIsEntryNotHitCapturing(profile.settings?.isEntryNotHitCapturing ?? false);
                setConfidenceCalibration(profile.settings?.confidenceCalibration);

                const loadedMemoryConfig = providerConfigs.find(p => p.id === profile.settings?.memoryProvider) || null;
                setMemoryConfig(loadedMemoryConfig);
                setMemoryModel(profile.settings?.memoryModel || loadedMemoryConfig?.selectedModel || getFirstReadyProvider(providerConfigs)?.selectedModel || '');

                setInsightKnowledgeBase(profile.insightKnowledgeBase);

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

                const tradeLogData = (profile.tradeLog || []).map(t => ({ ...t, leverage: t.leverage || DEFAULT_LEVERAGE }));
                syncFromTradeLog(tradeLogData);
                syncRollingWindowFromTradeLog(tradeLogData);

                const lastActive = convs.find(c => c.id === profile.lastActiveConversationId) || convs[0];
                setActiveConversationId(lastActive.id);

                await runMigrations(username);

                const tradeCount = (profile.tradeLog || []).length;
                createStartupBackup(username).catch(err =>
                    console.warn('[DataIntegrity] Startup backup failed:', err)
                );

                startAutoBackup(username);

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
                await resetAppState(username);
            }

            setActiveUsername(username);
            sessionStorage.setItem('activeUsername', username);
            localStorage.setItem('last_active_user', username);
            profileSelectionStartedRef.current = true;
            setIsUserModalOpen(false);
            setHighlightedAnalysisId(null);
            setIsLoading(false);
            setProfileReady(true);
        } catch (error) {
            console.error('App: failed to load user data', error);
            setActiveUsername(username);
            sessionStorage.setItem('activeUsername', username);
            profileSelectionStartedRef.current = true;
            setIsUserModalOpen(false);
            setIsLoading(false);
        }
    }, [
        ensembleModelCount, ensembleModelSelection, handleCancelAnalysis,
        handleSetEnsembleModelSelection, handleSetLensConfig,
        invalidatePostMortemRuns, lensConfig, persistedEnsembleModeRef,
        providerConfigs, resetAppState, setActiveConversationId,
        setActiveFrameworks, setActiveUsername, setAccuracySubMode,
        setAutopilotResolutions, setConfidenceCalibration, setConversationHistory,
        setCustomInstructions, setFinalTradeSummary, setGlobalMemory,
        setHighlightedAnalysisId, setInsightKnowledgeBase, setIsAccuracyModeEnabled,
        setIsAutoCapturing, setIsEnsembleEnabled, setIsEntryNotHitCapturing,
        setIsFamiliesEnabledInPureAI, setIsGlobalMemoryEnabled,
        setIsHybridIntelligenceEnabled, setIsLoading, setIsMemoryEnabledInPureAI,
        setIsPlaybookEnabledInPureAI, setIsStrategiesEnabled,
        setIsUpdateAutoCapturing, setIsUserModalOpen, setLoggedTrades,
        setMemoryConfig, setMemoryModel, setSavedAnalyses,
        setSummarizationModel, setSummarizationProvider, setSummaryCharLimit,
        setTradeSummaries, setUseAlgorithmicInsights, setUseAlgorithmicSummary,
        setVisionModel, toast,
    ]);

    // The workspace scan is a MOUNT-ONLY bootstrap. It must never re-run when
    // loadUserData's identity changes: its deps include providerConfigs and
    // the lens/ensemble settings, which legitimately change mid-session, and
    // a re-run would reload the whole profile from disk (loading flash,
    // autopilot reset, re-running migrations and startup backups) and wipe
    // any work not yet covered by the debounced save. The ref keeps each
    // invocation fresh without re-arming the effect.
    const loadUserDataRef = useRef(loadUserData);
    loadUserDataRef.current = loadUserData;

    useEffect(() => {
        let isMounted = true;
        const openWorkspaceIfNeeded = async (): Promise<void> => {
            try {
                const users = await dbService.getAllUsernames();
                if (!isMounted) return;
                setExistingUsernames(users);
                const sessionUser = sessionStorage.getItem('activeUsername');
                if (sessionUser && users.includes(sessionUser)) {
                    void loadUserDataRef.current(sessionUser);
                } else if (!profileSelectionStartedRef.current) {
                    setIsUserModalOpen(true);
                }
            } catch (error) {
                console.error('App: initialization failed', error);
                if (!isMounted) return;
                if (!profileSelectionStartedRef.current) setIsUserModalOpen(true);
            }
        };
        void openWorkspaceIfNeeded();
        return () => { isMounted = false; };
    }, [setExistingUsernames, setIsUserModalOpen]);

    return {
        loadUserData,
        resetAppState,
        profileReady,
        profileSelectionStartedRef,
    };
};
