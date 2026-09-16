/**
 * loggedTradeHarness — the Chart AI dock's chat session (the "harness") was
 * previously BLIND to its own logged-trade events: when the user accepted a
 * present_trade proposal and the trade was logged, the chat session saw no
 * "trade logged at $X" message and had no openTrades ledger, and when the
 * outcome autopilot resolved the trade the session saw no close-message and
 * never auto-fired the post-mortem. These tests assert the four invariants
 * the fix introduces:
 *
 *  (a) logTradeWithFeedback pushes a one-shot chat entry summarising the
 *      trade (symbol · direction · entry · SL · TPs · leverage) AND adds
 *      the trade id to the session's openTrades / loggedTradeIds ledger.
 *  (b) pushTradeClosedEvent drops the trade from openTrades and pushes a
 *      "[HARNESS] Trade closed: …" close-message.
 *  (c) autoStartPostMortemForResolvedTrade is invoked exactly once per
 *      resolution (the harness always runs the post-mortem on resolve,
 *      with no user clicks).
 *  (d) The session-level openTrades invariant survives across helper
 *      calls (add → remove) without leaking into persistence.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { MessageRole, TradeOutcome } from '../types';
import type { Message, TradeAnalysis, UserPriorCall } from '../types';
import * as chatStore from '../services/trade/chatStore';
import { storageKey } from '../services/trade/chatSessions';

// ─── Heavy dependency mocks ──────────────────────────────────────────────────
// useTradeLogging pulls in a long tail of services (memory, notebook sync,
// thinking store, calibration). Stub them all out so the harness side-effect
// is the only thing under test.

vi.mock('@capacitor/core', () => ({
    Capacitor: { isNativePlatform: () => false },
}));

vi.mock('../services/learning/MemoryService', () => ({
    summarizeTrade: vi.fn(async () => 'mocked summary'),
}));
vi.mock('../utils/tradeInsightBrief', () => ({
    insightTextForTrade: () => null,
}));
vi.mock('../services/learning/GlobalLearningService', () => ({
    default: {
        updateCalibration: vi.fn(async () => undefined),
        getCalibration: () => ({}),
    },
}));
vi.mock('../services/backtesting/ModelPerformanceService', () => ({
    trackTradeOutcome: vi.fn(),
    mapRegimeToKey: (v: unknown) => v,
}));
vi.mock('../utils/disciplineAnalytics', () => ({
    computeRMultiple: () => undefined,
}));
vi.mock('../services/analysis/TimeframeConfluenceService', () => ({
    trackConfluenceOutcome: vi.fn(),
    calculateConfluenceScore: () => ({ score: 0 }),
}));
vi.mock('../services/learning/SkillMemoryService', () => ({
    syncClosedTradeToNotebook: vi.fn(async () => undefined),
}));
vi.mock('../utils/watchList', () => ({
    appendWatchEpisode: (m: Message, _kind: string, outcome: TradeOutcome) => ({ ...m, outcome }),
}));

const updateThinkingOutcome = vi.hoisted(() => vi.fn(async () => undefined));
const getThinkingTradeId = vi.hoisted(() => vi.fn((_createdAt: string | undefined, id: string) => id));
vi.mock('../services/infrastructure/ThinkingStoreService', () => ({
    updateThinkingOutcome,
    getThinkingTradeId,
}));

vi.mock('../utils/activeUser', () => ({
    getActiveUsername: () => 'alice',
    LAST_ACTIVE_USER_KEY: 'last_active_user',
}));

// ─── Test helpers ────────────────────────────────────────────────────────────

const userRef = vi.hoisted(() => ({ current: 'alice' }));

const analysis = (over: Partial<TradeAnalysis> = {}): TradeAnalysis => ({
    coinName: 'BTCUSDT',
    direction: 'Long',
    confidence: 'High',
    probability: 80,
    strategy: 'Breakout',
    activeStrategies: [],
    entryPoints: [{ price: '95000', description: 'entry' }],
    stopLoss: '94000',
    takeProfit: [
        { price: '96000', percentage: '+100.0%' },
        { price: '97000', percentage: '+200.0%' },
    ],
    marketConditions: { pattern: '', candleBehavior: '', timeframeAlignment: '', rsi: '', macd: '', sentiment: '' },
    historicalCorrelation: '',
    createdAt: '2026-09-15T10:00:00.000Z',
    validityDurationMinutes: 330,
    ...over,
} as TradeAnalysis);

const userPrior = (over: Partial<UserPriorCall> = {}): UserPriorCall => ({
    direction: 'Long',
    confidencePct: 70,
    createdAt: '2026-09-15T09:59:00.000Z',
    ...over,
} as UserPriorCall);

/** Build a chart-AI session whose entries include an analysis bubble whose
 *  id matches the trade's message id — this is how logTradeWithFeedback
 *  routes its harness side-effect back to the session that presented the
 *  trade. */
const seedSessionWithAnalysisEntry = (messageId: string, withUserPrior = true): string => {
    const sid = chatStore.addSession({ kind: 'solo', title: 'BTC chat' });
    chatStore.mutate(sid, s => ({
        ...s,
        entries: [...s.entries, { id: messageId, role: 'ai', text: 'analysis bubble', tools: [] }],
    }));
    return sid;
};

beforeEach(() => {
    chatStore.__resetForTests();
    localStorage.clear();
    userRef.current = 'alice';
    updateThinkingOutcome.mockClear();
    getThinkingTradeId.mockClear();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('chatStore logged-trade harness invariants', () => {
    it('addOpenTrade records the trade in openTrades AND loggedTradeIds', () => {
        const sid = chatStore.addSession({ kind: 'solo', title: 'X' });
        chatStore.addOpenTrade({
            tradeId: 't1',
            symbol: 'BTCUSDT',
            direction: 'Long',
            entry: '95000',
            stopLoss: '94000',
            takeProfits: ['96000', '97000'],
            openedAt: '2026-09-15T10:00:00.000Z',
        }, sid);

        const session = chatStore.getSnapshot().sessions.find(s => s.id === sid);
        expect(session?.openTrades?.['t1']).toBeTruthy();
        expect(session?.openTrades?.['t1']?.symbol).toBe('BTCUSDT');
        expect(session?.loggedTradeIds).toEqual(['t1']);
    });

    it('removeOpenTrade clears openTrades but keeps loggedTradeIds', () => {
        const sid = chatStore.addSession({ kind: 'solo', title: 'X' });
        chatStore.addOpenTrade({
            tradeId: 't1', symbol: 'BTCUSDT', direction: 'Long',
            entry: '95000', stopLoss: '94000', takeProfits: ['96000'], openedAt: '2026-09-15T10:00:00.000Z',
        }, sid);
        chatStore.removeOpenTrade('t1', sid);

        const session = chatStore.getSnapshot().sessions.find(s => s.id === sid);
        expect(session?.openTrades?.['t1']).toBeUndefined();
        expect(session?.loggedTradeIds).toEqual(['t1']); // preserved for the model context loader
    });

    it('addChatSystemEntry pushes a notice-style entry into the session', () => {
        const sid = chatStore.addSession({ kind: 'solo', title: 'X' });
        chatStore.addChatSystemEntry('[HARNESS] Trade logged: BTCUSDT Long @ 95000', sid);
        const session = chatStore.getSnapshot().sessions.find(s => s.id === sid);
        const sysEntries = (session?.entries ?? []).filter(e => e.notice);
        expect(sysEntries.length).toBe(1);
        expect(sysEntries[0].tools[0]).toMatch(/Trade logged/);
    });

    it('findSessionByEntryId routes an entry id back to the session that holds it', () => {
        const sid = seedSessionWithAnalysisEntry('msg-42');
        expect(chatStore.findSessionByEntryId('msg-42')).toBe(sid);
        expect(chatStore.findSessionByEntryId('msg-not-here')).toBeUndefined();
    });

    it('persistence strips openTrades / loggedTradeIds (they are runtime-only)', async () => {
        vi.useFakeTimers();
        const sid = chatStore.addSession({ kind: 'solo', title: 'X' });
        chatStore.addOpenTrade({
            tradeId: 't1', symbol: 'BTCUSDT', direction: 'Long',
            entry: '95000', stopLoss: '94000', takeProfits: ['96000'], openedAt: '2026-09-15T10:00:00.000Z',
        }, sid);
        vi.advanceTimersByTime(600);
        const raw = localStorage.getItem(storageKey());
        expect(raw).toBeTruthy();
        const parsed = JSON.parse(raw as string);
        const persisted = parsed.find((s: { id: string }) => s.id === sid);
        expect(persisted.openTrades).toBeUndefined();
        expect(persisted.loggedTradeIds).toBeUndefined();
        vi.useRealTimers();
    });
});

describe('useTradeLogging harness side-effects', () => {
    it('logTradeWithFeedback pushes a chat entry AND adds to openTrades', async () => {
        const sid = seedSessionWithAnalysisEntry('msg-trade-1');
        const message = {
            id: 'msg-trade-1',
            role: MessageRole.AI,
            text: 'plan',
            createdAt: '2026-09-15T10:00:00.000Z',
            analysis: analysis(),
            userPriorCall: userPrior(),
        } as Message;

        // Render the hook with a stub startPostMortemAnalysis so the post-
        // mortem side-effect of logTradeWithFeedback is a no-op.
        const { useTradeLogging } = await import('../hooks/useTradeLogging');
        const startPostMortemAnalysis = vi.fn();
        const captured: Message[] = [];
        const messagesRef = { current: captured };
        const { result } = renderHook(() => useTradeLogging({
            messages: captured,
            messagesRef: messagesRef as { current: Message[] },
            updateMessages: (updater) => { const next = updater(captured); captured.length = 0; captured.push(...next); },
            activeConversationLeverage: 100,
            moderatorProviderId: 'p1',
            moderatorModel: 'm1',
            memoryModel: 'm1',
            memoryConfig: { id: 'p1', name: 'p1', isEnabled: true, apiKey: 'k', models: ['m1'], selectedModel: 'm1', apiFormat: 'chat_completions', baseUrl: '' } as never,
            useAlgorithmicInsights: false,
            onJournalAutoRefresh: undefined,
            setIsAutoCaptureBusy: () => undefined,
            setIsHybridLoading: () => undefined,
            setIsEntryNotHitCaptureBusy: () => undefined,
            setIsUpdateCaptureBusy: () => undefined,
            isEntryNotHitCapturing: false,
            setIsInsightGenerating: () => undefined,
            setCurrentHybridData: () => undefined,
            startPostMortemAnalysis: startPostMortemAnalysis as never,
            handleSendMessage: () => undefined,
            toast: { error: () => undefined, success: () => undefined },
            setPostMortemCandidate: () => undefined,
            setConfidenceCalibration: () => undefined,
        }));

        await act(async () => {
            await result.current.logTradeWithFeedback(message, TradeOutcome.WIN, {});
        });

        // The harness (chat session) MUST now carry the trade:
        const session = chatStore.getSnapshot().sessions.find(s => s.id === sid);
        expect(session?.openTrades?.['msg-trade-1']).toBeTruthy();
        expect(session?.openTrades?.['msg-trade-1']?.symbol).toBe('BTCUSDT');
        expect(session?.loggedTradeIds).toContain('msg-trade-1');
        // A notice-style entry describing the trade landed on the transcript:
        const sysEntries = (session?.entries ?? []).filter(e => e.notice);
        const loggedLine = sysEntries.map(e => e.tools.join('\n')).join('\n');
        expect(loggedLine).toMatch(/Trade logged/);
        expect(loggedLine).toMatch(/BTCUSDT/);
        expect(loggedLine).toMatch(/95000/);
        expect(loggedLine).toMatch(/94000/);
        expect(loggedLine).toMatch(/96000/);
        expect(loggedLine).toMatch(/100x/);
    });

    it('pushTradeClosedEvent removes from openTrades, pushes close-message, calls startPostMortemAnalysis exactly once', async () => {
        const sid = seedSessionWithAnalysisEntry('msg-trade-2');
        const message = {
            id: 'msg-trade-2',
            role: MessageRole.AI,
            text: 'plan',
            createdAt: '2026-09-15T10:00:00.000Z',
            analysis: analysis(),
        } as Message;

        const { useTradeLogging } = await import('../hooks/useTradeLogging');
        const startPostMortemAnalysis = vi.fn();
        const captured: Message[] = [];
        const messagesRef = { current: captured };
        const { result } = renderHook(() => useTradeLogging({
            messages: captured,
            messagesRef: messagesRef as { current: Message[] },
            updateMessages: (updater) => { const next = updater(captured); captured.length = 0; captured.push(...next); },
            activeConversationLeverage: 100,
            moderatorProviderId: 'p1',
            moderatorModel: 'm1',
            memoryModel: 'm1',
            memoryConfig: { id: 'p1', name: 'p1', isEnabled: true, apiKey: 'k', models: ['m1'], selectedModel: 'm1', apiFormat: 'chat_completions', baseUrl: '' } as never,
            useAlgorithmicInsights: false,
            onJournalAutoRefresh: undefined,
            setIsAutoCaptureBusy: () => undefined,
            setIsHybridLoading: () => undefined,
            setIsEntryNotHitCaptureBusy: () => undefined,
            setIsUpdateCaptureBusy: () => undefined,
            isEntryNotHitCapturing: false,
            setIsInsightGenerating: () => undefined,
            setCurrentHybridData: () => undefined,
            startPostMortemAnalysis: startPostMortemAnalysis as never,
            handleSendMessage: () => undefined,
            toast: { error: () => undefined, success: () => undefined },
            setPostMortemCandidate: () => undefined,
            setConfidenceCalibration: () => undefined,
        }));

        // 1. Log the trade so the harness ledger sees it as open.
        await act(async () => {
            await result.current.logTradeWithFeedback(message, TradeOutcome.WIN, {});
        });
        // The logged-trade side-effect must have fired already.
        let session = chatStore.getSnapshot().sessions.find(s => s.id === sid);
        expect(session?.openTrades?.['msg-trade-2']).toBeTruthy();

        // 2. Resolve: the autopilot (or any future resolve path) calls
        //    pushTradeClosedEvent with WIN + leveraged PnL.
        await act(async () => {
            result.current.pushTradeClosedEvent({
                tradeId: 'msg-trade-2',
                outcome: TradeOutcome.WIN,
                pnlPercent: 105.3,
                sid,
            });
        });

        // 3. The close-message landed on the dock:
        session = chatStore.getSnapshot().sessions.find(s => s.id === sid);
        const sysLines = (session?.entries ?? [])
            .filter(e => e.notice)
            .map(e => e.tools.join('\n'))
            .join('\n');
        expect(sysLines).toMatch(/Trade closed/);
        expect(sysLines).toMatch(/WIN/);
        expect(sysLines).toMatch(/\+105\.3%/);

        // 4. openTrades no longer carries the resolved trade:
        expect(session?.openTrades?.['msg-trade-2']).toBeUndefined();
        // loggedTradeIds still carries it (the model context loader's
        // channel — knowing your last recommendation even after resolve).
        expect(session?.loggedTradeIds).toContain('msg-trade-2');

        // 5. autoStartPostMortemForResolvedTrade fired EXACTLY ONCE:
        await waitFor(() => expect(startPostMortemAnalysis).toHaveBeenCalledTimes(1));
        const [arg] = startPostMortemAnalysis.mock.calls[0];
        expect(arg.outcome).toBe(TradeOutcome.WIN);
        expect(arg.message.analysis?.coinName).toBe('BTCUSDT');
    });

    it('autoStartPostMortemForResolvedTrade is a no-op for trades not in the ledger', async () => {
        const { useTradeLogging } = await import('../hooks/useTradeLogging');
        const startPostMortemAnalysis = vi.fn();
        const { result } = renderHook(() => useTradeLogging({
            messages: [],
            messagesRef: { current: [] } as { current: Message[] },
            updateMessages: () => undefined,
            activeConversationLeverage: 100,
            moderatorProviderId: 'p1',
            moderatorModel: 'm1',
            memoryModel: 'm1',
            memoryConfig: { id: 'p1', name: 'p1', isEnabled: true, apiKey: 'k', models: ['m1'], selectedModel: 'm1', apiFormat: 'chat_completions', baseUrl: '' } as never,
            useAlgorithmicInsights: false,
            onJournalAutoRefresh: undefined,
            setIsAutoCaptureBusy: () => undefined,
            setIsHybridLoading: () => undefined,
            setIsEntryNotHitCaptureBusy: () => undefined,
            setIsUpdateCaptureBusy: () => undefined,
            isEntryNotHitCapturing: false,
            setIsInsightGenerating: () => undefined,
            setCurrentHybridData: () => undefined,
            startPostMortemAnalysis: startPostMortemAnalysis as never,
            handleSendMessage: () => undefined,
            toast: { error: () => undefined, success: () => undefined },
            setPostMortemCandidate: () => undefined,
            setConfidenceCalibration: () => undefined,
        }));

        act(() => { result.current.autoStartPostMortemForResolvedTrade('not-a-real-id'); });
        expect(startPostMortemAnalysis).not.toHaveBeenCalled();
    });
});