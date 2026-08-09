import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { Message, TradeOutcome } from '../types';
import { ProviderConfig } from '../types/provider';
import { useAppSettings } from '../hooks/useAppSettings';
import { useTradeLogging } from '../hooks/useTradeLogging';

// ── Mocks ────────────────────────────────────────────────────────────────────
// The insight generation is the async work the hook fires after logging —
// swap it for an immediate resolution so the refresh callback settles in a tick.
vi.mock('../services/learning/MemoryService', () => ({
    summarizeTrade: vi.fn(async () => 'Mocked insight summary'),
}));

// ── Fixtures ─────────────────────────────────────────────────────────────────

const providerConfig = (): ProviderConfig => ({
    id: 'provider-a',
    name: 'Provider A',
    apiKey: 'test-key',
    isEnabled: true,
    isBuiltIn: true,
    apiFormat: 'chat_completions',
    selectedModel: 'model-a',
    models: ['model-a'],
    baseUrl: '',
});

const analysisMessage = (): Message => ({
    id: 'trade-1',
    role: 'assistant' as any,
    text: 'BTC analysis',
    createdAt: new Date().toISOString(),
    // confidence left undefined so the calibration/confluence side-effects
    // are skipped entirely in the logging path (keeps the test focused).
    analysis: {
        coinName: 'BTC',
        direction: 'Long',
        detectedPatternFamily: 'Cup',
        entryPoints: [{ price: '94500', type: 'limit' as any }],
        confidence: undefined as any,
    } as any,
});

const tradeLoggingParams = (onJournalAutoRefresh: ReturnType<typeof vi.fn>) => ({
    messages: [],
    messagesRef: { current: [] as Message[] },
    updateMessages: vi.fn(),
    activeConversationLeverage: 10,
    moderatorProviderId: 'provider-a',
    moderatorModel: 'model-a',
    memoryModel: 'model-a',
    memoryConfig: providerConfig(),
    useAlgorithmicInsights: false,
    onJournalAutoRefresh,
    setIsAutoCapturing: vi.fn(),
    setIsHybridLoading: vi.fn(),
    setIsEntryNotHitCapturing: vi.fn(),
    setIsUpdateAutoCapturing: vi.fn(),
    setIsInsightGenerating: vi.fn(),
    setCurrentHybridData: vi.fn(),
    startPostMortemAnalysis: vi.fn(),
    handleSendMessage: vi.fn(),
    toast: { error: vi.fn(), success: vi.fn() },
    setPostMortemCandidate: vi.fn(),
    setConfidenceCalibration: vi.fn(),
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('journal AI defaults (useAppSettings)', () => {
    it('defaults journal generation to AI mode (algorithmic off)', () => {
        const { result } = renderHook(() => useAppSettings());
        expect(result.current.useAlgorithmicSummary).toBe(false);
        expect(result.current.useAlgorithmicInsights).toBe(false);
    });
});

describe('journal auto-refresh on trade log (useTradeLogging)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('fires onJournalAutoRefresh when a WIN/LOSS trade is logged', async () => {
        const onJournalAutoRefresh = vi.fn();
        const { result } = renderHook(() => useTradeLogging(tradeLoggingParams(onJournalAutoRefresh) as any));

        await act(async () => {
            await result.current.logTradeWithFeedback(analysisMessage(), TradeOutcome.WIN, { pnlPercent: 10 });
        });
        // autoAddRecentInsight is fire-and-forget (void) — flush its promise chain.
        await act(async () => {
            await new Promise(r => setTimeout(r, 0));
        });

        expect(onJournalAutoRefresh).toHaveBeenCalledTimes(1);
    });

    it('fires onJournalAutoRefresh when an ENTRY_NOT_HIT trade is logged', async () => {
        const onJournalAutoRefresh = vi.fn();
        const { result } = renderHook(() => useTradeLogging(tradeLoggingParams(onJournalAutoRefresh) as any));

        await act(async () => {
            await result.current.logEntryNotHitTrade({ message: analysisMessage() });
        });
        await act(async () => {
            await new Promise(r => setTimeout(r, 0));
        });

        expect(onJournalAutoRefresh).toHaveBeenCalledTimes(1);
    });

    it('does NOT fire onJournalAutoRefresh when nothing is logged', async () => {
        const onJournalAutoRefresh = vi.fn();
        renderHook(() => useTradeLogging(tradeLoggingParams(onJournalAutoRefresh) as any));

        expect(onJournalAutoRefresh).not.toHaveBeenCalled();
    });
});
