/**
 * usePostMortem — SUPERSESSION silence.
 *
 * Starting a second post-mortem aborts the in-flight first one. The abandoned
 * run must discard SILENTLY: without bumping postMortemRunIdRef before the
 * abort, the old run's catch still saw itself as current (same id), threw the
 * "All AI providers failed" error the abort produced, and rendered
 * "Post-Mortem Failed: …" + a retry CTA over its superseded transcript.
 * The bump-before-abort rule startTodayReassessment already followed is now
 * the same rule startPostMortemAnalysis uses — this test pins the behavior.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { MutableRefObject } from 'react';
import type { Message, LoggedTrade } from '../types';
import { TradeOutcome } from '../types';
import type { PostMortemCandidate } from '../components/modals/PostTradeUploadModal';
import type { ProviderConfig } from '../types/provider';

const conductPostMortemMock = vi.hoisted(() => vi.fn());

vi.mock('../services/providers/GenericAnalysisService', () => ({
    conductPostMortem: (...args: unknown[]) => conductPostMortemMock(...args),
    conductTodayReassessment: vi.fn(async () => ({ verdict: 'hold', text: '' })),
    writePostMortemMarkdownReport: vi.fn(),
}));

import { usePostMortem, type UsePostMortemParams } from '../hooks/usePostMortem';

const provider = {
    id: 'prov-a', name: 'Provider A', apiKey: 'key', baseUrl: 'https://api.example.com/v1',
    apiFormat: 'chat_completions', isEnabled: true, isBuiltIn: true,
    models: ['model-a'], selectedModel: 'model-a',
} as unknown as ProviderConfig;

const tick = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

let messages: Message[] = [];

const baseParams = (): UsePostMortemParams => ({
    messages: [],
    activeConversationId: 'conv-1',
    messagesRef: { current: [] } as MutableRefObject<Message[]>,
    updateMessages: (updater) => { messages = updater(messages); },
    isAccuracyModeEnabled: false,
    accuracySubMode: 'standard',
    activeUsernameRef: { current: 'alice' } as MutableRefObject<string | null>,
    providerConfigs: [provider],
    moderatorConfig: provider,
    moderatorModel: 'model-a',
    finalTradeSummary: null,
    loggedTrades: [],
    loggedTradesRef: { current: [] } as MutableRefObject<LoggedTrade[]>,
    setLoggedTrades: () => { /* noop */ },
    globalMemory: undefined,
    setGlobalMemory: () => { /* noop */ },
    memoryConfig: null,
    memoryModel: '',
    useAlgorithmicInsights: false,
    tradeSummaries: [],
    setTradeSummaries: () => { /* noop */ },
    setIsPostMortemInProgress: () => { /* noop */ },
    setIsLivePostMortemVisible: () => { /* noop */ },
    setLoadingMessage: () => { /* noop */ },
    setIsPostMortemTypingComplete: () => { /* noop */ },
    setShowMismatchModal: () => { /* noop */ },
    setExpandedPostMortems: () => { /* noop */ },
    initAnalysisSteps: () => { /* noop */ },
    startStep: () => { /* noop */ },
    completeStep: () => { /* noop */ },
    setAnalysisSteps: () => { /* noop */ },
    setPostMortemCandidate: () => { /* noop */ },
});

const candidate = (id: string): PostMortemCandidate => ({
    message: {
        id,
        role: 'ai' as Message['role'],
        text: 'long BTC here, stop under the low',
        createdAt: new Date(Date.now() - 3_600_000).toISOString(),
        // analysis intentionally absent → the price-validation pre-pass is
        // skipped and the run goes straight to the analyst calls.
    } as Message,
    outcome: TradeOutcome.LOSS,
});

beforeEach(() => {
    messages = [];
    conductPostMortemMock.mockReset();
});

describe('post-mortem supersession', () => {
    it('a second startPostMortemAnalysis silences the first WITHOUT a "Post-Mortem Failed" bubble', async () => {
        const { result } = renderHook(() => usePostMortem(baseParams()));

        // Run 1: analysts hang until aborted (mirrors the real transport's
        // AbortError on cancel).
        conductPostMortemMock.mockImplementationOnce((_config: unknown, params: { signal?: AbortSignal }) =>
            new Promise<string>((_resolve, reject) => {
                const onAbort = (): void => {
                    const err = new Error('The user aborted a request.');
                    err.name = 'AbortError';
                    reject(err);
                };
                if (params.signal?.aborted) onAbort();
                else params.signal?.addEventListener('abort', onAbort);
            }));
        // Run 2: fails on its own (provider down) — its own failure bubble IS
        // expected and proves the message machinery works at all.
        conductPostMortemMock.mockImplementationOnce(async () => {
            throw new Error('provider down');
        });

        let run1: Promise<void> | undefined;
        await act(async () => {
            run1 = result.current.startPostMortemAnalysis(candidate('msg-1'));
            await tick(5); // let run 1 reach the analyst await
        });
        let run2: Promise<void> | undefined;
        await act(async () => {
            run2 = result.current.startPostMortemAnalysis(candidate('msg-2'));
            await tick(5);
        });
        await act(async () => {
            await run1;
            await run2;
            await tick(10);
        });

        const failed = messages.filter(m => (m.text || '').includes('Post-Mortem Failed'));
        // EXACTLY one — the second run's own honest failure. Pre-fix there
        // were two: the superseded run appended
        // "Post-Mortem Failed: All AI providers failed…" + retry CTA.
        expect(failed).toHaveLength(1);
        expect(failed[0].text).toContain('All AI providers failed');
        // Run 1's placeholder bubble was left untouched (empty text).
        const run1Bubble = messages.find(m => m.isPostMortem && !failed.includes(m));
        expect(run1Bubble).toBeDefined();
        expect((run1Bubble?.text || '')).toBe('');
    });
});
