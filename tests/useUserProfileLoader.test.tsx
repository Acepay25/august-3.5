import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useUserProfileLoader, UseUserProfileLoaderArgs } from '../hooks/useUserProfileLoader';
import * as dbService from '../services/infrastructure/dbService';
import { PriceAlertService } from '../services/ui/PriceAlertService';
import { OutcomeAutopilotService } from '../services/ui/OutcomeAutopilotService';
import { offlineQueue } from '../services/infrastructure/OfflineQueueService';
import { initPromptOverrides } from '../services/infrastructure/PromptOverrideService';
import { initStrategyDocs } from '../services/infrastructure/StrategyService';
import { initMemoryFiles } from '../services/learning/MemoryFilesService';

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

vi.mock('../services/learning/memoryHygiene', () => ({
    runMemoryHygieneIfDue: vi.fn().mockResolvedValue(null),
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
    // loadUserData now calls reset() (switch path) + init(username), both
    // before and inside its stale-write-guarded sequence.
    PriceAlertService: { init: vi.fn().mockResolvedValue(undefined), reset: vi.fn() },
}));

vi.mock('../services/ui/OutcomeAutopilotService', () => ({
    OutcomeAutopilotService: { init: vi.fn().mockResolvedValue(undefined), reset: vi.fn() },
}));

vi.mock('../services/infrastructure/OfflineQueueService', () => ({
    offlineQueue: { setActiveUser: vi.fn() },
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
    getPreferenceArray: vi.fn(async () => []),
    PREF_KEYS: { ENSEMBLE_MODEL_SELECTION: 'ensemble_model_selection' },
}));

const createMockArgs = (overrides: Partial<UseUserProfileLoaderArgs> = {}): UseUserProfileLoaderArgs => ({
    profileReadyRef: { current: false },
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
    setIsLoading: vi.fn(),
    setActiveUsername: vi.fn(),
    setExistingUsernames: vi.fn(),
    setIsUserModalOpen: vi.fn(),
    toast: { info: vi.fn(), error: vi.fn() },
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

    /**
     * A FAILED load must not adopt the username. The profile's data was never
     * read, so React state still holds the PREVIOUS user's conversations and
     * trades; committing the switch let the 1500ms debounced autosave write
     * that stale state over the incoming profile — empty arrays over a real
     * trade log on a cold boot, one user's trades into another's on a switch.
     * Both reproduced before this guard.
     */
    it('a failed load does NOT adopt the profile, and reports it', async () => {
        vi.mocked(dbService.getUserProfile).mockRejectedValueOnce(new Error('IndexedDB unavailable'));

        const args = createMockArgs();
        const { result } = renderHook(() => useUserProfileLoader(args));

        await act(async () => {
            await result.current.loadUserData('victim');
        });

        // The load failed, so the username must not be committed anywhere…
        expect(args.setActiveUsername).not.toHaveBeenCalledWith('victim');
        expect(sessionStorage.getItem('activeUsername')).toBeNull();
        expect(localStorage.getItem('last_active_user')).toBeNull();
        // …and the autosave must be told the active profile is NOT ready.
        expect(result.current.profileReady).toBe(false);
        expect(args.profileReadyRef.current).toBe(false);
        // The trader is told, rather than losing data silently.
        expect(args.toast.error).toHaveBeenCalled();
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

    it("switch path drops the outgoing profile's live singletons before loading the incoming one", async () => {
        vi.mocked(dbService.getUserProfile).mockResolvedValue({
            username: 'bob', conversations: [], tradeLog: [], savedAnalyses: [],
            tradeSummaries: [], settings: {},
        } as any);
        const args = createMockArgs();
        const { result } = renderHook(() => useUserProfileLoader(args));

        await act(async () => {
            await result.current.loadUserData('bob');
        });

        // Audit §2.5: these singletons carried the previous profile's
        // alerts/watches/registrations/queue across the switch.
        expect(OutcomeAutopilotService.reset).toHaveBeenCalled();
        expect(PriceAlertService.reset).toHaveBeenCalled();
        expect(offlineQueue.setActiveUser).toHaveBeenCalledWith('bob');
        // And the monitoring inits get the INCOMING username explicitly.
        expect(PriceAlertService.init).toHaveBeenCalledWith('bob');
        expect(OutcomeAutopilotService.init).toHaveBeenCalledWith('bob');
    });

    it('stale-write guard: a superseded load never stamps its profile into state', async () => {
        // Alice's profile read HANGS until after Bob's whole load has
        // committed. Without the generation token, Alice's tail (conversation
        // history, trades, active-username commit, sessionStorage) would land
        // over Bob's — the audit's loader stale-write race.
        const bobProfile = {
            username: 'bob',
            conversations: [{ id: 'bob-conv', title: 'Bob', messages: [] }],
            tradeLog: [{ id: 'bob-t1', symbol: 'BTCUSDT' }],
            savedAnalyses: [], tradeSummaries: [], settings: {},
            lastActiveConversationId: 'bob-conv',
        };
        const aliceProfile = {
            username: 'alice',
            conversations: [{ id: 'alice-conv', title: 'Alice', messages: [] }],
            tradeLog: [{ id: 'alice-t1', symbol: 'ETHUSDT' }],
            savedAnalyses: [], tradeSummaries: [], settings: {},
            lastActiveConversationId: 'alice-conv',
        };
        let releaseAlice: (p: unknown) => void = () => {};
        const aliceGate = new Promise(res => { releaseAlice = res; });
        vi.mocked(dbService.getUserProfile).mockImplementation((user: string) => {
            if (user === 'alice') return aliceGate.then(() => aliceProfile) as any;
            return Promise.resolve(bobProfile) as any;
        });

        const args = createMockArgs();
        const { result } = renderHook(() => useUserProfileLoader(args));

        let aliceLoad: Promise<void> | null = null;
        await act(async () => {
            aliceLoad = result.current.loadUserData('alice');
        });
        // Bob's load overtakes and fully commits while Alice's read is open.
        await act(async () => {
            await result.current.loadUserData('bob');
        });
        expect(args.setActiveUsername).toHaveBeenCalledWith('bob');
        expect(localStorage.getItem('last_active_user')).toBe('bob');

        const conversationsBefore = vi.mocked(args.setConversationHistory).mock.calls.length;
        // Now the abandoned Alice load finally resolves.
        releaseAlice(undefined);
        await act(async () => {
            await aliceLoad;
        });

        // Every post-await write site in the stale load bailed: no Alice
        // profile data, no active-username hijack, no storage rewrite.
        expect(vi.mocked(args.setConversationHistory).mock.calls.length).toBe(conversationsBefore);
        expect(args.setConversationHistory).toHaveBeenCalledWith(
            [expect.objectContaining({ id: 'bob-conv' })],
        );
        expect(args.setActiveUsername).not.toHaveBeenCalledWith('alice');
        expect(localStorage.getItem('last_active_user')).toBe('bob');
        expect(sessionStorage.getItem('activeUsername')).toBe('bob');
        expect(args.setIsLoading).toHaveBeenLastCalledWith(false);
    });

    it('stale-write guard inside the per-username init trio: a load superseded mid-trio bails before the NEXT singleton write', async () => {
        // The trio (initPromptOverrides / initStrategyDocs / initMemoryFiles)
        // writes username-scoped MODULE SINGLETONS before any React state
        // lands. If Alice's load is parked inside the first await when Bob's
        // load overtakes and fully commits, releasing Alice must NOT let the
        // remaining two inits run for 'alice' (they would re-init the
        // OUTGOING profile over Bob's).
        vi.mocked(dbService.getUserProfile).mockResolvedValue({
            username: 'bob', conversations: [], tradeLog: [], savedAnalyses: [],
            tradeSummaries: [], settings: {},
        } as any);
        let releaseAliceOverrides: () => void = () => {};
        const aliceGate = new Promise<void>(res => { releaseAliceOverrides = res; });
        // First call (Alice's) hangs; later calls (Bob's) resolve normally.
        vi.mocked(initPromptOverrides).mockImplementationOnce(() => aliceGate);

        const args = createMockArgs();
        const { result } = renderHook(() => useUserProfileLoader(args));

        let aliceLoad: Promise<void> | null = null;
        await act(async () => {
            aliceLoad = result.current.loadUserData('alice');
        });
        // Alice is now parked inside initPromptOverrides('alice'). Bob's load
        // bumps the generation and runs the trio + tail to completion.
        await act(async () => {
            await result.current.loadUserData('bob');
        });
        expect(initPromptOverrides).toHaveBeenCalledWith('bob');
        expect(initStrategyDocs).toHaveBeenCalledWith('bob');
        expect(initMemoryFiles).toHaveBeenCalledWith('bob');

        const strategyCallsBefore = vi.mocked(initStrategyDocs).mock.calls.length;
        const memoryCallsBefore = vi.mocked(initMemoryFiles).mock.calls.length;

        releaseAliceOverrides();
        await act(async () => {
            await aliceLoad;
        });

        // Alice bailed right after her released await: no further trio writes,
        // no active-username/storage hijack from the superseded load.
        expect(vi.mocked(initStrategyDocs).mock.calls.length).toBe(strategyCallsBefore);
        expect(vi.mocked(initMemoryFiles).mock.calls.length).toBe(memoryCallsBefore);
        expect(args.setActiveUsername).not.toHaveBeenCalledWith('alice');
        expect(localStorage.getItem('last_active_user')).toBe('bob');
    });
});
