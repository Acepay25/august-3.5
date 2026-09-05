import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useUserProfileLoader, UseUserProfileLoaderArgs } from '../hooks/useUserProfileLoader';
import * as dbService from '../services/infrastructure/dbService';

vi.mock('../services/infrastructure/dbService', () => ({
    initDatabase: vi.fn().mockResolvedValue(undefined),
    getAllUsernames: vi.fn().mockResolvedValue(['user1', 'user2']),
    getUserProfile: vi.fn(),
    saveUserProfile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/infrastructure/NativeStatusBar', () => ({
    initNativeStatusBar: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/backtesting/ModelPerformanceService', () => ({
    initModelPerformanceService: vi.fn().mockResolvedValue(undefined),
    syncFromTradeLog: vi.fn(),
    syncRollingWindowFromTradeLog: vi.fn(),
}));

vi.mock('../services/ui/AnalystLensService', () => ({
    initAnalystLensService: vi.fn().mockResolvedValue(undefined),
    loadLensConfig: vi.fn().mockReturnValue(null),
}));

vi.mock('../services/infrastructure/PromptOverrideService', () => ({
    initPromptOverrides: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/infrastructure/StrategyService', () => ({
    initStrategyDocs: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/learning/MemoryFilesService', () => ({
    initMemoryFiles: vi.fn().mockResolvedValue(undefined),
    syncProfileMemory: vi.fn().mockResolvedValue(undefined),
    syncPatternMemory: vi.fn().mockResolvedValue(undefined),
    syncRecurringMistakes: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/learning/regimeLedger', () => ({
    hydrateRegimeLedger: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/learning/weeklyRollup', () => ({
    runWeeklyRollupIfDue: vi.fn().mockResolvedValue(null),
}));

vi.mock('../services/learning/weeklyReview', () => ({
    runWeeklyReviewIfDue: vi.fn().mockResolvedValue(null),
}));

vi.mock('../services/learning/monthlyReport', () => ({
    runMonthlyReportIfDue: vi.fn().mockResolvedValue(null),
}));

vi.mock('../services/analysis/TimeframeConfluenceService', () => ({
    initConfluenceService: vi.fn().mockResolvedValue(undefined),
    syncConfluenceFromTradeLog: vi.fn(),
}));

vi.mock('../services/learning/PatternMemorySynthesisService', () => ({
    initPatternMemoryService: vi.fn().mockResolvedValue(undefined),
    setAttributedInsightsUser: vi.fn(),
}));

vi.mock('../services/learning/GlobalLearningService', () => ({
    default: { setActiveUser: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../services/ui/PriceAlertService', () => ({
    PriceAlertService: { init: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../services/ui/SetupWatchService', () => ({
    SetupWatchService: { init: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../services/ui/OutcomeAutopilotService', () => ({
    OutcomeAutopilotService: { init: vi.fn().mockResolvedValue(undefined), reset: vi.fn() },
}));

vi.mock('../services/ui/VetoLedgerService', () => ({
    VetoLedgerService: { init: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../services/infrastructure/BackupService', () => ({
    startAutoBackup: vi.fn(),
    createStartupBackup: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/validation/DataIntegrityService', () => ({
    runMigrations: vi.fn().mockResolvedValue(undefined),
    createStartupBackup: vi.fn().mockResolvedValue(undefined),
    checkDataIntegrity: vi.fn().mockResolvedValue({ valid: true, tradeCountChanged: false }),
    logIntegrityEvent: vi.fn(),
}));

vi.mock('../services/infrastructure/PreferencesService', () => ({
    getPreferenceObject: vi.fn().mockResolvedValue(null),
    PREF_KEYS: { ENSEMBLE_MODEL_SELECTION: 'ensemble_model_selection' },
}));

const createMockArgs = (overrides: Partial<UseUserProfileLoaderArgs> = {}): UseUserProfileLoaderArgs => ({
    handleCancelAnalysis: vi.fn(),
    invalidatePostMortemRuns: vi.fn(),
    lensConfig: null,
    handleSetLensConfig: vi.fn(),
    ensembleModelSelection: null,
    handleSetEnsembleModelSelection: vi.fn(),
    persistedEnsembleModeRef: { current: null },
    ensembleModelCount: 2,
    providerConfigs: [{
        id: 'p1',
        name: 'Provider 1',
        apiKey: 'key',
        isEnabled: true,
        isBuiltIn: true,
        apiFormat: 'chat_completions',
        selectedModel: 'm1',
        models: ['m1'],
        baseUrl: '',
    }],
    setConversationHistory: vi.fn(),
    setActiveConversationId: vi.fn(),
    setLoggedTrades: vi.fn(),
    setSavedAnalyses: vi.fn(),
    setTradeSummaries: vi.fn(),
    setFinalTradeSummary: vi.fn(),
    setGlobalMemory: vi.fn(),
    setIsGlobalMemoryEnabled: vi.fn(),
    setMemoryConfig: vi.fn(),
    setMemoryModel: vi.fn(),
    setInsightKnowledgeBase: vi.fn(),
    setActiveFrameworks: vi.fn(),
    setSummaryCharLimit: vi.fn(),
    setSummarizationProvider: vi.fn(),
    setSummarizationModel: vi.fn(),
    setVisionModel: vi.fn(),
    setUseAlgorithmicSummary: vi.fn(),
    setUseAlgorithmicInsights: vi.fn(),
    setIsStrategiesEnabled: vi.fn(),
    setIsAccuracyModeEnabled: vi.fn(),
    setAccuracySubMode: vi.fn(),
    setCustomInstructions: vi.fn(),
    setIsPlaybookEnabledInPureAI: vi.fn(),
    setIsFamiliesEnabledInPureAI: vi.fn(),
    setIsMemoryEnabledInPureAI: vi.fn(),
    setIsHybridIntelligenceEnabled: vi.fn(),
    setIsEnsembleEnabled: vi.fn(),
    setIsAutoCapturing: vi.fn(),
    setIsUpdateAutoCapturing: vi.fn(),
    setIsEntryNotHitCapturing: vi.fn(),
    setConfidenceCalibration: vi.fn(),
    setAutopilotResolutions: vi.fn(),
    setInput: vi.fn(),
    setImages: vi.fn(),
    setExpandedPostMortems: vi.fn(),
    setHighlightedAnalysisId: vi.fn(),
    setIsLoading: vi.fn(),
    setActiveUsername: vi.fn(),
    setExistingUsernames: vi.fn(),
    setIsUserModalOpen: vi.fn(),
    toast: { info: vi.fn() },
    ...overrides,
});

describe('useUserProfileLoader', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        sessionStorage.clear();
        localStorage.clear();
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('resetAppState resets state and persists blank profile when username provided', async () => {
        const args = createMockArgs();
        const { result } = renderHook(() => useUserProfileLoader(args));

        await act(async () => {
            await result.current.resetAppState('new_user');
        });

        expect(args.handleCancelAnalysis).toHaveBeenCalled();
        expect(args.setLoggedTrades).toHaveBeenCalledWith([]);
        expect(args.setSavedAnalyses).toHaveBeenCalledWith([]);
        expect(args.setTradeSummaries).toHaveBeenCalledWith([]);
        expect(args.setFinalTradeSummary).toHaveBeenCalledWith(null);
        expect(dbService.saveUserProfile).toHaveBeenCalledWith('new_user', expect.objectContaining({
            tradeLog: [],
            savedAnalyses: [],
        }));
    });

    it('loadUserData loads an existing profile and populates state', async () => {
        const mockProfile = {
            username: 'alice',
            conversations: [{ id: 'c1', title: 'Conv 1', messages: [] }],
            tradeLog: [{ id: 't1', symbol: 'BTCUSDT' }],
            savedAnalyses: [],
            tradeSummaries: [],
            finalTradeSummary: 'Good performance',
            settings: {
                activeFrameworks: ['f1'],
                summaryCharLimit: 2000,
                isEnsembleEnabled: true,
            },
            lastActiveConversationId: 'c1',
        };
        vi.mocked(dbService.getUserProfile).mockResolvedValueOnce(mockProfile as any);

        const args = createMockArgs();
        const { result } = renderHook(() => useUserProfileLoader(args));

        await act(async () => {
            await result.current.loadUserData('alice');
        });

        expect(args.setIsLoading).toHaveBeenCalledWith(true);
        expect(args.setConversationHistory).toHaveBeenCalledWith([expect.objectContaining({ id: 'c1', leverage: 100 })]);
        expect(args.setLoggedTrades).toHaveBeenCalledWith([expect.objectContaining({ id: 't1' })]);
        expect(args.setActiveConversationId).toHaveBeenCalledWith('c1');
        expect(args.setActiveUsername).toHaveBeenCalledWith('alice');
        expect(result.current.profileReady).toBe(true);
        expect(sessionStorage.getItem('activeUsername')).toBe('alice');
        expect(localStorage.getItem('last_active_user')).toBe('alice');
    });

    it('loadUserData falls back to resetAppState when profile is not found', async () => {
        vi.mocked(dbService.getUserProfile).mockResolvedValueOnce(undefined);

        const args = createMockArgs();
        const { result } = renderHook(() => useUserProfileLoader(args));

        await act(async () => {
            await result.current.loadUserData('fresh_user');
        });

        expect(args.setActiveUsername).toHaveBeenCalledWith('fresh_user');
        expect(dbService.saveUserProfile).toHaveBeenCalledWith('fresh_user', expect.any(Object));
        expect(result.current.profileReady).toBe(true);
    });

    it('workspace bootstrap runs once on mount — changed hook args must not reload the profile', async () => {
        sessionStorage.setItem('activeUsername', 'user1');
        vi.mocked(dbService.getUserProfile).mockResolvedValue({
            username: 'user1',
            conversations: [],
            tradeLog: [],
            savedAnalyses: [],
            tradeSummaries: [],
            settings: {},
        } as any);

        const args = createMockArgs();
        const { rerender } = renderHook(
            ({ hookArgs }: { hookArgs: UseUserProfileLoaderArgs }) => useUserProfileLoader(hookArgs),
            { initialProps: { hookArgs: args } },
        );

        await act(async () => { /* let the mount bootstrap settle */ });
        const loadsAfterBoot = vi.mocked(dbService.getUserProfile).mock.calls.length;
        expect(loadsAfterBoot).toBe(1);

        // A mid-session provider edit changes providerConfigs (and every
        // vi.fn() setter identity when the args object is rebuilt). The
        // bootstrap must stay asleep — no second profile load, no second
        // workspace scan.
        const editedArgs: UseUserProfileLoaderArgs = {
            ...args,
            providerConfigs: [{ ...args.providerConfigs[0], name: 'Renamed' }],
            setSummarizationProvider: vi.fn(),
            setSummarizationModel: vi.fn(),
        };
        rerender({ hookArgs: editedArgs });
        await act(async () => {});

        expect(vi.mocked(dbService.getAllUsernames).mock.calls.length).toBe(1);
        expect(vi.mocked(dbService.getUserProfile).mock.calls.length).toBe(loadsAfterBoot);
    });
});
