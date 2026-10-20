/**
 * E-22 — the two silently swallowed data-loss failures.
 *
 * (a) The backup. `createBackup` catches its own error and resolves to NULL
 *     (BackupService.ts:223-226), so the caller's `.catch()` never even
 *     fired — and the 30-minute scheduler ignored that null too. A failed
 *     backup produced NO signal at all: the trader believed they had a
 *     backup cadence and learned the truth only when they needed a restore.
 *
 * (b) The pattern memory. `syncPatternMemory` is a WRITE to the trader's
 *     notebook, and three call sites swallowed its failure outright
 *     (`.catch(() => {})`). A lost synthesis leaves the notebook describing
 *     trades that no longer exist — silently.
 *
 * The repo's own rule is explicit: "Never add a swallow-and-continue around
 * a notebook write; surface it, like `memoryHealth` does." This suite pins
 * that the two sites follow it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { renderHook, act } from '@testing-library/react';
import { useTradeJournalActions } from '../hooks/useTradeJournalActions';
import { syncPatternMemory } from '../services/learning/MemoryFilesService';

vi.mock('../services/learning/MemoryFilesService', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../services/learning/MemoryFilesService')>();
    return {
        ...actual,
        syncPatternMemory: vi.fn(async () => { throw new Error('origin quota exceeded'); }),
    };
});

// The delete cascade touches the thinking store, which opens IndexedDB —
// jsdom has none. Stub it so the cascade is not an unhandled rejection that
// has nothing to do with what this suite is about.
vi.mock('../services/infrastructure/ThinkingStoreService', () => ({
    getThinkingTradeId: vi.fn(() => 'thinking-id'),
    updateThinkingOutcome: vi.fn(async () => { }),
    deleteThinkingByTrade: vi.fn(async () => { }),
}));

const read = (rel: string): string => readFileSync(resolve(__dirname, '..', rel), 'utf8');

const toast = { success: vi.fn(), error: vi.fn() };

const makeArgs = (): any => ({
    loggedTrades: [{ id: 't1', analysis: {}, tradeLog: [] }],
    setLoggedTrades: vi.fn(),
    tradeSummaries: [],
    setTradeSummaries: vi.fn(),
    finalTradeSummary: null,
    setFinalTradeSummary: vi.fn(),
    loggedTradesRef: { current: [] },
    activeUsernameRef: { current: 'alice' },
    confirmDialog: vi.fn().mockResolvedValue(true),
    toast,
    handleJournalAutoRefresh: vi.fn(),
    regenerateFinalSummaryRef: { current: () => { } },
    isSummaryInProgress: false,
    setIsSummaryInProgress: vi.fn(),
    setInsightProgress: vi.fn(),
    setNewlyAddedInsightIds: vi.fn(),
    memoryConfig: null,
    moderatorConfig: { id: 'p1', name: 'P1', selectedModel: 'm1' },
    readyProviders: [],
    useAlgorithmicInsights: false,
    summaryCharLimit: 100,
});

beforeEach(() => {
    vi.clearAllMocks();
});

describe('E-22(b) — a failed pattern-memory sync is SURFACED, not swallowed', () => {
    it('the three swallow sites are gone', () => {
        const src = read('hooks/useTradeJournalActions.ts');
        expect(src).not.toMatch(/syncPatternMemory\([^)]*\)\.catch\(\(\)\s*=>\s*\{\s*\}\)/);
        // Every sync now goes through the one reporter.
        const syncs = src.match(/syncPatternMemory\(/g) || [];
        const reported = src.match(/syncPatternMemory\([^;]*?\)\.catch\(reportPatternMemoryFailure\)/g) || [];
        expect(syncs.length).toBeGreaterThan(0);
        expect(reported.length).toBe(syncs.length);
    });

    it('the reporter logs AND raises a toast, using the app error vocabulary', async () => {
        const { result } = renderHook(() => useTradeJournalActions(makeArgs()));
        // Deleting every trade is the path that re-syncs the pattern memory.
        // The rejection handler runs in a microtask, so the act() must be
        // awaited or the assertion races it.
        await act(async () => { result.current.handleDeleteTrades(['t1']); });
        expect(syncPatternMemory).toHaveBeenCalled();
        expect(toast.error).toHaveBeenCalled();
        const [title, body] = toast.error.mock.calls[0] as [string, string];
        expect(title).toMatch(/pattern memory/i);
        // The body carries the sanitized reason, not a raw stack.
        expect(body).toMatch(/could not be written/i);
        expect(body).not.toMatch(/at Object\./);
    });

    it('the error text is sanitized — a URL in the message never reaches the UI', async () => {
        const { result } = renderHook(() => useTradeJournalActions(makeArgs()));
        (syncPatternMemory as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
            new Error('failed https://api.example.com/v1/chat with key sk-abcdefghijklmnopqrstuvwx'),
        );
        await act(async () => { result.current.handleDeleteTrades(['t1']); });
        const [, body] = toast.error.mock.calls[0] as [string, string];
        expect(body).not.toMatch(/https:\/\//);
        expect(body).not.toMatch(/sk-abcdefghijklmnopqrstuvwx/);
    });
});

describe('E-22(a) — a failed backup is SURFACED, not swallowed', () => {
    it('the exit-backup swallow is gone', () => {
        const src = read('App.tsx');
        expect(src).not.toMatch(/createBackup\([^)]*\)\.catch\(\(\)\s*=>\s*\{\s*\}\)/);
        // The null return IS the failure signal (createBackup swallows its own
        // error), so it is checked and reported.
        expect(src).toMatch(/Exit backup FAILED/);
    });

    it('there is a watchdog that tells the trader the CADENCE stopped', () => {
        const src = read('App.tsx');
        expect(src).toContain('BACKUP_WATCHDOG');
        expect(src).toContain('getBackups');
        expect(src).toMatch(/toast\.error\(/);
        expect(src).toMatch(/Auto-backup has not run/);
    });
});
