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
import type { TradeOutcomeValidation } from '../services/backtesting/BacktestingService';

const conductPostMortemMock = vi.hoisted(() => vi.fn());
// Notebook/learning-write spies for the supersede-WRITES tests.
const pmMocks = vi.hoisted(() => ({
    syncClosedTradeToNotebook: vi.fn(),
    craftSkillFromPostMortem: vi.fn(),
    gateEvidenceBackedDraft: vi.fn(),
    writeNotebookNoteFromPostMortem: vi.fn(),
    writeModelNote: vi.fn(),
    getMemoryFiles: vi.fn(),
    extractLessonFromPostMortem: vi.fn(() => ''),
    parseSkillMarkdown: vi.fn(() => null),
    listSkillSlugs: vi.fn(() => []),
    updateGlobalMemory: vi.fn(),
    addJob: vi.fn(),
}));

vi.mock('../services/providers/GenericAnalysisService', () => ({
    conductPostMortem: (...args: unknown[]) => conductPostMortemMock(...args),
    conductTodayReassessment: vi.fn(async () => ({ verdict: 'hold', text: '' })),
    writePostMortemMarkdownReport: vi.fn(),
}));
vi.mock('../services/learning/SkillMemoryService', () => ({
    syncClosedTradeToNotebook: pmMocks.syncClosedTradeToNotebook,
    parseSkillMarkdown: pmMocks.parseSkillMarkdown,
    listSkillSlugs: pmMocks.listSkillSlugs,
}));
vi.mock('../services/learning/SkillCraftService', () => ({
    craftSkillFromPostMortem: pmMocks.craftSkillFromPostMortem,
}));
vi.mock('../services/learning/draftGates', () => ({
    gateEvidenceBackedDraft: pmMocks.gateEvidenceBackedDraft,
}));
vi.mock('../services/learning/NotebookWriterService', () => ({
    writeNotebookNoteFromPostMortem: pmMocks.writeNotebookNoteFromPostMortem,
}));
vi.mock('../services/learning/MemoryFilesService', () => ({
    writeModelNote: pmMocks.writeModelNote,
    getMemoryFiles: pmMocks.getMemoryFiles,
    // severityInsights (live in the graph) pulls the lesson miner.
    extractLessonFromPostMortem: pmMocks.extractLessonFromPostMortem,
}));
vi.mock('../services/learning/MemoryService', () => ({
    updateGlobalMemory: pmMocks.updateGlobalMemory,
}));
vi.mock('../services/infrastructure/JobQueueService', () => ({
    jobQueue: { addJob: pmMocks.addJob },
    JobType: { EXTRACT_INSIGHTS: 'extract_insights' },
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
    Object.values(pmMocks).forEach(m => m.mockClear());
    pmMocks.getMemoryFiles.mockReturnValue({ version: 1, folders: [], files: [] });
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

// ─── Supersession of the WRITE half ──────────────────────────────────────────
// The run-id guards above silence the post-mortem TEXT. The learning chain
// (insight job, diary/skill sync, LLM craft, evidence gate, AI notebook
// note) spans awaits that the abort signal does not cover, and when the
// awaited global-memory step REJECTED (the abort landing inside it) the
// catch swallowed and a superseded run fell straight through into the
// chain — publishing the OLD user's notebook entries. These tests pin the
// new staleness re-checks around the chain.

const notebookTrade = (id: string): LoggedTrade => ({
    id,
    outcome: TradeOutcome.LOSS,
    timestamp: new Date().toISOString(),
    postMortem: 'old report',
} as unknown as LoggedTrade);

describe('post-mortem supersession — notebook/learning WRITES', () => {
    const reportText = '## Final Report\nThe stop sat above structure; the thesis needed a fresh reclaim that never printed.';

    it('a run superseded before the learning chain begins performs NO notebook writes', async () => {
        const { result } = renderHook(() => usePostMortem({
            ...baseParams(),
            loggedTradesRef: { current: [notebookTrade('msg-nb')] } as MutableRefObject<LoggedTrade[]>,
        }));
        conductPostMortemMock.mockResolvedValue(reportText);
        // The global-memory await rejects AFTER the supersede — exactly the
        // pre-fix fall-through path (the catch above the chain swallowed it
        // and the chain ran for the stale run).
        let releaseMemory: () => void = () => undefined;
        pmMocks.updateGlobalMemory.mockImplementation(() =>
            new Promise<never>((_res, rej) => { releaseMemory = () => rej(new Error('provider aborted')); }));

        let run: Promise<void> | undefined;
        await act(async () => {
            run = result.current.startPostMortemAnalysis(candidate('msg-nb'));
            await tick(10);
        });
        act(() => { result.current.invalidatePostMortemRuns(); }); // e.g. account switch
        act(() => { releaseMemory(); });
        await act(async () => { await run; await tick(20); });

        expect(pmMocks.updateGlobalMemory).toHaveBeenCalled();
        // Pre-fix: control fell through the memory catch into the chain.
        expect(pmMocks.addJob).not.toHaveBeenCalled();
        expect(pmMocks.syncClosedTradeToNotebook).not.toHaveBeenCalled();
        expect(pmMocks.craftSkillFromPostMortem).not.toHaveBeenCalled();
        expect(pmMocks.gateEvidenceBackedDraft).not.toHaveBeenCalled();
        expect(pmMocks.writeNotebookNoteFromPostMortem).not.toHaveBeenCalled();
        expect(pmMocks.writeModelNote).not.toHaveBeenCalled();
    });

    it('a run superseded mid-notebook-sync skips every LATER learning write', async () => {
        const { result } = renderHook(() => usePostMortem({
            ...baseParams(),
            loggedTradesRef: { current: [notebookTrade('msg-nb2')] } as MutableRefObject<LoggedTrade[]>,
        }));
        conductPostMortemMock.mockResolvedValue(reportText);
        pmMocks.updateGlobalMemory.mockResolvedValue({} as never);
        let releaseSync: () => void = () => undefined;
        pmMocks.syncClosedTradeToNotebook.mockImplementation(() =>
            new Promise<void>(res => { releaseSync = res; }));
        pmMocks.craftSkillFromPostMortem.mockResolvedValue(null);

        let run: Promise<void> | undefined;
        await act(async () => {
            run = result.current.startPostMortemAnalysis(candidate('msg-nb2'));
            await tick(10);
        });
        expect(pmMocks.syncClosedTradeToNotebook).toHaveBeenCalledTimes(1); // chain entered while fresh
        act(() => { result.current.invalidatePostMortemRuns(); });
        act(() => { releaseSync(); });
        await act(async () => { await run; await tick(20); });

        // The in-flight sync cannot be recalled, but the superseded run must
        // not continue: craft / gate / AI note are all gated behind it.
        expect(pmMocks.craftSkillFromPostMortem).not.toHaveBeenCalled();
        expect(pmMocks.gateEvidenceBackedDraft).not.toHaveBeenCalled();
        expect(pmMocks.writeNotebookNoteFromPostMortem).not.toHaveBeenCalled();
        expect(pmMocks.writeModelNote).not.toHaveBeenCalled();
    });
});

/**
 * The skill ledger scores each closed trade with its price-measured R
 * (`countTradeOutcome(meta, win, trade.realizedR)`). `realizedR` is produced
 * HERE and nowhere else, so the post-mortem is the only thing that can feed
 * expectancy — and it wrote it through `setLoggedTrades`, then read the row
 * back off `loggedTradesRef`, which only refreshes on the render that
 * setState scheduled. Same tick ⇒ pre-write row ⇒ `r` undefined forever,
 * `rSampled` never reaching the 8 samples a skill needs to report an R.
 */
describe('post-mortem → skill ledger R hand-off', () => {
    const report = '## Final Report\nThe stop sat above structure; the reclaim never printed.';

    /** A freshly logged row: outcome known, no measured R yet. */
    const awaitingR = (id: string): LoggedTrade => ({
        id,
        outcome: TradeOutcome.LOSS,
        timestamp: new Date().toISOString(),
        leverage: 10,
    } as unknown as LoggedTrade);

    /** `analysis` is what turns the price-validation pre-pass on. */
    const candidateWithAnalysis = (id: string): PostMortemCandidate => ({
        message: {
            id,
            role: 'ai' as Message['role'],
            text: 'BTC long, stop under the swing low',
            createdAt: new Date(Date.now() - 3_600_000).toISOString(),
            analysis: { coinName: 'BTCUSDT', direction: 'LONG' },
        } as unknown as Message,
        outcome: TradeOutcome.LOSS,
    });

    const validation = {
        isMismatch: false,
        outcome: 'LOSS',
        hitTarget: false,
        validationSummary: 'SL touched on bar 4.',
        dataRange: '2026-09-17 → 2026-09-18',
        candlesEvaluated: 20,
        rrRatio: 2.5,
        maePercent: 1.25,
        mfePercent: 2.1,
    };

    it('carries realizedR and excursions to the ledger instead of re-reading the row', async () => {
        const ref = { current: [awaitingR('msg-r')] } as MutableRefObject<LoggedTrade[]>;
        const { result } = renderHook(() => usePostMortem({
            ...baseParams(),
            loggedTradesRef: ref,
        }));
        conductPostMortemMock.mockResolvedValue(report);
        pmMocks.updateGlobalMemory.mockResolvedValue({} as never);
        // The supersede tests leave a hand-released sync implementation behind
        // (mockClear keeps implementations) — settle it or this run hangs.
        pmMocks.syncClosedTradeToNotebook.mockResolvedValue(undefined as never);
        pmMocks.craftSkillFromPostMortem.mockResolvedValue(null);

        await act(async () => {
            await result.current.startPostMortemAnalysis(
                candidateWithAnalysis('msg-r'),
                undefined,
                undefined,
                validation as unknown as TradeOutcomeValidation,
            );
            await tick(20);
        });

        expect(pmMocks.syncClosedTradeToNotebook).toHaveBeenCalledTimes(1);
        const closed = pmMocks.syncClosedTradeToNotebook.mock.calls[0][0] as LoggedTrade;
        expect(closed.realizedR).toBe(2.5);
        // Excursions ride in LEVERAGED %, the basis the row's pnlPercent uses.
        expect(closed.maxAdverseExcursion).toBe(12.5);
        expect(closed.maxFavorableExcursion).toBe(21);
        // Proof the merge is what carries R: the ref row this hook was handed
        // is still the pre-write copy, so a read-back sees nothing.
        expect(ref.current[0].realizedR).toBeUndefined();
    });
});
