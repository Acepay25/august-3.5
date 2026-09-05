import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import * as dbService from '../services/infrastructure/dbService';
import * as StorageService from '../services/infrastructure/StorageService';
import { useProfilePersistence, UseProfilePersistenceArgs } from '../hooks/useProfilePersistence';

vi.mock('../services/infrastructure/dbService', () => ({
    saveUserProfile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/infrastructure/StorageService', () => ({
    storageService: { loadLearningRules: vi.fn().mockReturnValue({ rules: [], lastUpdated: '', version: 2 }) },
}));

vi.mock('../hooks/useSaveOnUnload', () => ({
    useSaveOnUnload: vi.fn(),
}));

const baseArgs = (): UseProfilePersistenceArgs => ({
    activeUsername: 'alice',
    activeConversationId: 'conv-1',
    setSaveStatus: vi.fn(),
    toast: { error: vi.fn() },
    conversationHistory: [],
    loggedTrades: [],
    savedAnalyses: [],
    tradeSummaries: [],
    finalTradeSummary: null,
    globalMemory: undefined,
    insightKnowledgeBase: undefined,
    memoryConfig: null,
    memoryModel: '',
    isAnalysisInProgress: false,
    isPostMortemInProgress: false,
    activeFrameworks: ['f1'],
    summaryCharLimit: 4000,
    summarizationProvider: 'p1',
    summarizationModel: 'm1',
    visionModel: '',
    isGlobalMemoryEnabled: false,
    isStrategiesEnabled: false,
    isEnsembleEnabled: false,
    isAccuracyModeEnabled: false,
    accuracySubMode: 'original',
    customInstructions: { general: [], accuracyOriginal: [], accuracyPure: [] } as any,
    isPlaybookEnabledInPureAI: false,
    isFamiliesEnabledInPureAI: false,
    isMemoryEnabledInPureAI: false,
    isHybridIntelligenceEnabled: false,
    isAutoCapturing: false,
    isUpdateAutoCapturing: false,
    isEntryNotHitCapturing: false,
    useAlgorithmicSummary: false,
    useAlgorithmicInsights: false,
    confidenceCalibration: undefined,
});

/** Both debounced effects arm on mount — drain the initial DATA (1500ms)
 *  and SETTINGS (2500ms) writes before a test asserts on its own scenario. */
const drainMountSaves = async (): Promise<void> => {
    await vi.advanceTimersByTimeAsync(3000);
    vi.mocked(dbService.saveUserProfile).mockClear();
};

describe('useProfilePersistence', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('saves the light settings payload after the 2500ms debounce', async () => {
        const args = baseArgs();
        const { rerender } = renderHook(({ a }: { a: UseProfilePersistenceArgs }) => useProfilePersistence(a), {
            initialProps: { a: args },
        });
        await drainMountSaves();

        // A settings toggle re-arms ONLY the light settings write.
        rerender({ a: { ...args, summaryCharLimit: 2500 } });
        await vi.advanceTimersByTimeAsync(2499);
        expect(dbService.saveUserProfile).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(2);
        expect(dbService.saveUserProfile).toHaveBeenCalledTimes(1);
        expect(dbService.saveUserProfile).toHaveBeenCalledWith('alice', expect.objectContaining({
            settings: expect.objectContaining({ summaryCharLimit: 2500 }),
        }));
        const payload = vi.mocked(dbService.saveUserProfile).mock.calls[0][1];
        expect(payload).not.toHaveProperty('conversations');
        expect(payload).not.toHaveProperty('tradeLog');
    });

    it('saves the heavy data payload after the 1500ms debounce on a real data change', async () => {
        const args = baseArgs();
        const { rerender } = renderHook(({ a }: { a: UseProfilePersistenceArgs }) => useProfilePersistence(a), {
            initialProps: { a: args },
        });
        await drainMountSaves();

        const convs = [{ id: 'c1', messages: [] }] as any[];
        rerender({ a: { ...args, conversationHistory: convs } });
        await vi.advanceTimersByTimeAsync(1500);
        expect(dbService.saveUserProfile).toHaveBeenCalledTimes(1);
        expect(dbService.saveUserProfile).toHaveBeenCalledWith('alice', expect.objectContaining({
            conversations: convs,
        }));

        // Re-render with the SAME array references: no effect re-arms, no write.
        vi.mocked(dbService.saveUserProfile).mockClear();
        rerender({ a: { ...args, conversationHistory: convs } });
        await vi.advanceTimersByTimeAsync(3000);
        expect(dbService.saveUserProfile).not.toHaveBeenCalled();
    });

    it('heartbeat flushes mid-run when streaming keeps resetting the DATA debounce', async () => {
        const args = { ...baseArgs(), isAnalysisInProgress: true };
        const { rerender } = renderHook(({ a }: { a: UseProfilePersistenceArgs }) => useProfilePersistence(a), {
            initialProps: { a: args },
        });
        await drainMountSaves();

        // Simulate a streaming run: the conversations array gets a new
        // reference more often than every 1500ms, so the DATA debounce keeps
        // restarting and never completes. The 15s heartbeat must flush anyway.
        const latest: any[] = [];
        for (let i = 0; i < 12; i += 1) {
            latest.push({ id: 'c1', messages: [{ id: `m${i}` }] });
            rerender({ a: { ...args, conversationHistory: [...latest] } });
            await vi.advanceTimersByTimeAsync(1200);
        }
        // 12 × 1200ms = 14.4s with no completed DATA save; cross the 15s tick.
        await vi.advanceTimersByTimeAsync(1000);
        expect(dbService.saveUserProfile).toHaveBeenCalledWith('alice', expect.objectContaining({
            conversations: [...latest],
        }));
    });

    it('heartbeat stays silent when no run is active', async () => {
        const args = baseArgs();
        renderHook(({ a }: { a: UseProfilePersistenceArgs }) => useProfilePersistence(a), {
            initialProps: { a: args },
        });
        await drainMountSaves();
        await vi.advanceTimersByTimeAsync(60_000);
        expect(dbService.saveUserProfile).not.toHaveBeenCalled();
    });

    it('does not save when no user is active', async () => {
        renderHook(() => useProfilePersistence({ ...baseArgs(), activeUsername: null }));
        await vi.advanceTimersByTimeAsync(60_000);
        expect(dbService.saveUserProfile).not.toHaveBeenCalled();
    });
});
