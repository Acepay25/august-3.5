import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTradeJournalActions, UseTradeJournalActionsArgs } from '../hooks/useTradeJournalActions';
import * as MemoryFilesService from '../services/learning/MemoryFilesService';
import * as ThinkingStoreService from '../services/infrastructure/ThinkingStoreService';
import { OutcomeAutopilotService } from '../services/ui/OutcomeAutopilotService';

vi.mock('../services/learning/MemoryService', () => ({
    summarizeTrade: vi.fn().mockResolvedValue('summary text'),
}));

vi.mock('../services/providers/GenericAnalysisService', () => ({
    generateFinalSummary: vi.fn().mockResolvedValue('final summary'),
}));

vi.mock('../services/learning/MemoryFilesService', () => ({
    syncPatternMemory: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/infrastructure/ThinkingStoreService', () => ({
    getThinkingTradeId: vi.fn().mockReturnValue('think-1'),
    updateThinkingOutcome: vi.fn().mockResolvedValue(undefined),
    deleteThinkingByTrade: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/ui/OutcomeAutopilotService', () => ({
    OutcomeAutopilotService: { unregister: vi.fn() },
}));

const trade = (id: string, overrides: Partial<{ outcome: string; pnlAmount: number }> = {}) => ({
    id,
    timestamp: new Date().toISOString(),
    outcome: 'WIN',
    pnlAmount: 100,
    analysis: { coinName: 'BTC', direction: 'LONG', confidence: 70, createdAt: '2026-01-01T00:00:00Z' },
    ...overrides,
}) as any;

const createArgs = (overrides: Partial<UseTradeJournalActionsArgs> = {}): UseTradeJournalActionsArgs => ({
    loggedTrades: [trade('t1'), trade('t2')],
    setLoggedTrades: vi.fn(),
    tradeSummaries: [{ id: 't1', summaryText: 's1', timestamp: 'x' }] as any,
    setTradeSummaries: vi.fn(),
    finalTradeSummary: 'old summary',
    setFinalTradeSummary: vi.fn(),
    loggedTradesRef: { current: [trade('t1'), trade('t2')] },
    activeUsernameRef: { current: 'alice' },
    confirmDialog: vi.fn().mockResolvedValue(true),
    toast: { success: vi.fn() },
    handleJournalAutoRefresh: vi.fn(),
    regenerateFinalSummaryRef: { current: () => {} },
    isSummaryInProgress: false,
    setIsSummaryInProgress: vi.fn(),
    setInsightProgress: vi.fn(),
    setNewlyAddedInsightIds: vi.fn(),
    memoryConfig: null,
    moderatorConfig: { id: 'p1', name: 'P1', selectedModel: 'm1' } as any,
    readyProviders: [{ id: 'p1', name: 'P1', selectedModel: 'm1' }] as any,
    useAlgorithmicInsights: false,
    summaryCharLimit: 4000,
    ...overrides,
});

describe('useTradeJournalActions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('handleDeleteTrades filters trades and summaries and cascades cleanup for the deleted rows', () => {
        const setLoggedTrades = vi.fn();
        const setTradeSummaries = vi.fn();
        const args = createArgs({ setLoggedTrades, setTradeSummaries });
        const { result } = renderHook(() => useTradeJournalActions(args));

        act(() => result.current.handleDeleteTrades(['t1']));

        expect(setLoggedTrades).toHaveBeenCalledWith([expect.objectContaining({ id: 't2' })]);
        expect(setTradeSummaries).toHaveBeenCalledWith([]);
        expect(args.handleJournalAutoRefresh).toHaveBeenCalled();
        expect(ThinkingStoreService.deleteThinkingByTrade).toHaveBeenCalledWith('think-1', 'alice');
        expect(OutcomeAutopilotService.unregister).toHaveBeenCalledWith('t1');
    });

    it('handleDeleteTrades clears the final summary and syncs pattern memory when the log empties', () => {
        const args = createArgs({ loggedTrades: [trade('t1')], setFinalTradeSummary: vi.fn() });
        const { result } = renderHook(() => useTradeJournalActions(args));

        act(() => result.current.handleDeleteTrades(['t1']));

        expect(args.setFinalTradeSummary).toHaveBeenCalledWith(null);
        expect(MemoryFilesService.syncPatternMemory).toHaveBeenCalledWith(null, 'alice');
        expect(args.handleJournalAutoRefresh).not.toHaveBeenCalled();
    });

    it('handleDeleteInsight removes one summary and re-runs the AI review', () => {
        const setTradeSummaries = vi.fn();
        const args = createArgs({ setTradeSummaries });
        const { result } = renderHook(() => useTradeJournalActions(args));

        act(() => result.current.handleDeleteInsight('t1'));

        expect(setTradeSummaries).toHaveBeenCalled();
        expect(args.handleJournalAutoRefresh).toHaveBeenCalled();
    });

    it('handleUpdateTradeOutcome patches the trade and backfills the thinking record', () => {
        const setLoggedTrades = vi.fn();
        const args = createArgs({ setLoggedTrades });
        const { result } = renderHook(() => useTradeJournalActions(args));

        act(() => result.current.handleUpdateTradeOutcome('t1', 'LOSS' as any));

        expect(setLoggedTrades).toHaveBeenCalled();
        expect(ThinkingStoreService.updateThinkingOutcome).toHaveBeenCalledWith(
            'think-1', 'LOSS', 't1', 'alice', { pnlAmount: 100, pnlPercent: undefined },
        );
    });

    it('handleRegenerateFinalSummary with an empty log clears the summary and skips the AI call', async () => {
        const { generateFinalSummary } = await import('../services/providers/GenericAnalysisService');
        const args = createArgs({ loggedTrades: [] });
        const { result } = renderHook(() => useTradeJournalActions(args));

        await act(async () => result.current.handleRegenerateFinalSummary());

        expect(args.setFinalTradeSummary).toHaveBeenCalledWith(null);
        expect(generateFinalSummary).not.toHaveBeenCalled();
        expect(args.setIsSummaryInProgress).toHaveBeenCalledWith(false);
    });

    it('regenerateFinalSummaryRef receives the freshest regeneration logic on every render', async () => {
        const { generateFinalSummary } = await import('../services/providers/GenericAnalysisService');
        const regenerateFinalSummaryRef = { current: () => {} };
        const args = createArgs({ regenerateFinalSummaryRef });
        renderHook(() => useTradeJournalActions(args));

        await act(async () => regenerateFinalSummaryRef.current());

        expect(generateFinalSummary).toHaveBeenCalled();
    });
});
