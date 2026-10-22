/**
 * One thread, two homes — the LIVE sync.
 *
 * What this pins, and why each arm exists:
 *  - `liveEntryFromMessage` carries `Message.isStreaming`. A Chat-surface run
 *    was already mirrored into the dock row by row, but the row claimed to be
 *    finished, so crossing over mid-answer showed a settled reply that the next
 *    token then rewrote under the trader's eyes.
 *  - `startEntryMirror` copies a dock entry into the conversation: immediately,
 *    then throttled, and ALWAYS flushed on stop — a stopped or failed turn must
 *    not leave a row that says it is still streaming.
 *  - The dock's send path resolves a conversation first (minting one for a
 *    session that never had a thread), registers its controller under the
 *    CONVERSATION id so the other home can stop it, and mirrors the turn while
 *    it runs.
 *
 * The panel is mounted for the last group because the wiring, not the idea, is
 * what breaks: a runner that mirrors into a session-local entry but never tells
 * the conversation is exactly the bug this file exists to keep.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import type { Message } from '../types';
import type { ProviderConfig } from '../types/provider';
import type { SoloTurnRow } from '../services/trade/chatTurnMirror';

vi.mock('../utils/activeUser', () => ({
    getActiveUsername: () => 'alice',
    LAST_ACTIVE_USER_KEY: 'last_active_user',
}));

const { streamMock } = vi.hoisted(() => ({ streamMock: vi.fn() }));
vi.mock('../services/analysis/DeskToolsService', () => ({
    stripTextToolCalls: (t: string): string => t,
    streamChatWithDeskTools: (...args: unknown[]) => streamMock(...args),
    // `runSeatTurn` reads the cache clear through `toolTurn`, which imports it
    // from here; a missing export is a module-load error, not a skipped call.
    clearDeskToolCache: vi.fn(),
}));
vi.mock('../services/analysis/HybridIntelligenceService', () => ({
    fetchHybridData: vi.fn(async () => ({})),
    generateHybridPromptInjection: vi.fn(() => '## packet'),
}));
vi.mock('../services/analysis/KlineService', () => ({ fetchKlines: vi.fn(async () => []) }));
// The learning hooks a send fires in its `finally` are best-effort and would
// otherwise reach the transport this file is not stubbing.
vi.mock('../services/learning/sessionSkillReview', () => ({
    runThesisResolver: vi.fn(async () => {}),
    runSessionSkillReview: vi.fn(async () => {}),
    runTraderLearner: vi.fn(async () => {}),
    recordSessionForReview: vi.fn(() => false),
}));
vi.mock('../services/learning/traderLearner', () => ({ runTraderLearner: vi.fn(async () => {}) }));

import TradeChatPanel, { __clearPacketCacheForTests } from '../components/trade/TradeChatPanel';
import * as chatStore from '../services/trade/chatStore';
import type { LiveEntry } from '../services/trade/chatStore';
import { entriesForSession, liveEntryFromMessage, type StoredChatEntry } from '../services/trade/chatSessions';
import { startEntryMirror } from '../services/trade/chatTurnMirror';
import { MessageRole } from '../types';

const config = {
    id: 'prov-a', name: 'Provider A', apiKey: 'key-a',
    baseUrl: 'https://api.example.com/v1', apiFormat: 'chat_completions',
    isEnabled: true, isBuiltIn: true, models: ['model-a'], selectedModel: 'model-a',
} as unknown as ProviderConfig;

const msg = (over: Partial<Message>): Message => ({
    id: 'm1', role: MessageRole.AI, text: 'partial answer', createdAt: new Date().toISOString(),
    ...over,
} as Message);

describe('the projection of a running conversation row', () => {
    it('carries isStreaming, so the dock says the turn is still arriving', () => {
        expect(liveEntryFromMessage(msg({ isStreaming: true })).streaming).toBe(true);
        expect(liveEntryFromMessage(msg({})).streaming).toBe(false);
    });

    it('keeps the streaming flag through the one merge', () => {
        const merged = entriesForSession([] as StoredChatEntry[], [msg({ isStreaming: true })]);
        expect(merged[0].streaming).toBe(true);
    });

    it('a local row still wins for its own id — the dock owns the turn it is running', () => {
        const local: StoredChatEntry[] = [{ id: 'm1', role: 'ai', text: 'dock text', tools: [], streaming: true } as never];
        const merged = entriesForSession(local, [msg({ isStreaming: false, text: 'conversation text' })]);
        expect(merged).toHaveLength(1);
        expect(merged[0].text).toBe('dock text');
        expect(merged[0].streaming).toBe(true);
    });
});

describe('startEntryMirror', () => {
    beforeEach(() => { chatStore.__resetForTests(); localStorage.clear(); vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    const seed = (entry: LiveEntry): string => {
        const sid = chatStore.getActiveId();
        act(() => { chatStore.mutate(sid, s => ({ ...s, entries: [entry] })); });
        return sid;
    };

    it('commits the placeholder at once, throttles the stream, and flushes on stop', () => {
        const sid = seed({ id: 'a1', role: 'ai', text: '', tools: [], streaming: true });
        const commit = vi.fn();
        const mirror = startEntryMirror({ sid, entryId: 'a1', conversationId: 'conv-1', commit });
        // The row appears the moment the dock paints it — not one throttle
        // window later, which reads as a dead thread on the other home.
        expect(commit).toHaveBeenCalledTimes(1);
        expect(commit.mock.calls[0][0]).toMatchObject({ id: 'a1', streaming: true, text: '' });

        act(() => { chatStore.mutate(sid, s => ({ ...s, entries: [{ id: 'a1', role: 'ai', text: 'Hel', tools: [], streaming: true }] })); });
        act(() => { chatStore.mutate(sid, s => ({ ...s, entries: [{ id: 'a1', role: 'ai', text: 'Hello', tools: [], streaming: true }] })); });
        expect(commit).toHaveBeenCalledTimes(1);
        act(() => { vi.advanceTimersByTime(250); });
        expect(commit).toHaveBeenCalledTimes(2);
        expect(commit.mock.calls[1][0]).toMatchObject({ text: 'Hello', streaming: true });

        act(() => { chatStore.mutate(sid, s => ({ ...s, entries: [{ id: 'a1', role: 'ai', text: 'Hello', tools: [], streaming: false, workedMs: 900 }] })); });
        mirror.stop();
        const last = commit.mock.calls.at(-1)![0];
        expect(last).toMatchObject({ text: 'Hello', streaming: false, workedMs: 900 });
        expect(commit.mock.calls.at(-1)![1]).toBe('conv-1');
    });

    it('a stop with nothing new to say commits once, and after it nothing at all', () => {
        const sid = seed({ id: 'a2', role: 'ai', text: 'half', tools: [], streaming: true });
        const commit = vi.fn();
        const mirror = startEntryMirror({ sid, entryId: 'a2', conversationId: 'conv-2', commit });
        // The entry never changed, so the row the conversation already has IS
        // the final state. In the real flow the runner's finally patches
        // `streaming: false` on the entry BEFORE stopping the mirror, which is
        // the next case; what this one pins is that a stop is not a second
        // write of the same bytes.
        mirror.stop();
        expect(commit).toHaveBeenCalledTimes(1);
        expect(commit.mock.calls.at(-1)![0].streaming).toBe(true);
        // After stop, store writes reach nobody.
        act(() => { chatStore.mutate(sid, s => ({ ...s, entries: [{ id: 'a2', role: 'ai', text: 'late', tools: [], streaming: false }] })); });
        act(() => { vi.advanceTimersByTime(1000); });
        expect(commit).toHaveBeenCalledTimes(1);
    });

    it('the order the runner settles in — entry closed, then stop — puts a settled row in the conversation', () => {
        const sid = seed({ id: 'a5', role: 'ai', text: 'partial', tools: [], streaming: true });
        const commit = vi.fn();
        const mirror = startEntryMirror({ sid, entryId: 'a5', conversationId: 'conv-5', commit });
        act(() => { chatStore.mutate(sid, s => ({ ...s, entries: [{ id: 'a5', role: 'ai', text: 'the whole answer', tools: [], streaming: false, workedMs: 1200 }] })); });
        mirror.stop();
        expect(commit.mock.calls.at(-1)![0]).toMatchObject({ text: 'the whole answer', streaming: false, workedMs: 1200 });
    });

    it('another session streaming does not re-commit this entry unchanged', () => {
        const sid = seed({ id: 'a6', role: 'ai', text: 'Hello', tools: [], streaming: true });
        const commit = vi.fn();
        const mirror = startEntryMirror({ sid, entryId: 'a6', conversationId: 'conv-6', commit });
        expect(commit).toHaveBeenCalledTimes(1);
        // The store emits for EVERY session, and a subscriber that wrote on
        // every emit would push a React state write into the Chat surface ~5x/s
        // for a row that has not moved.
        const other = chatStore.addSession();
        act(() => { chatStore.mutate(other, s => ({ ...s, entries: [{ id: 'x1', role: 'ai', text: 'the other turn', tools: [], streaming: true }] })); });
        act(() => { vi.advanceTimersByTime(250); });
        expect(commit, 'the mirror commits what changed, not what woke it up').toHaveBeenCalledTimes(1);
        // Its own entry moving still commits.
        act(() => { chatStore.mutate(sid, s => ({ ...s, entries: [{ id: 'a6', role: 'ai', text: 'Hello there', tools: [], streaming: true }] })); });
        act(() => { vi.advanceTimersByTime(250); });
        expect(commit).toHaveBeenCalledTimes(2);
        mirror.stop();
    });
});

describe('the run is stoppable from the home that did not start it', () => {
    // Shape contracts, because the fact is a WIRING fact: a controller that is
    // registered only under the session id is unreachable from the Chat
    // surface's Stop, and a Chat composer that never reads the conversation
    // registry shows Send over an answer arriving from the chart.
    const runnerSrc = readFileSync('services/trade/chatTurnRunner.ts', 'utf8');
    const pipelineSrc = readFileSync('hooks/useAnalysisPipeline.ts', 'utf8');
    const chatSrc = readFileSync('components/agents/AgentsView.tsx', 'utf8');

    it('the dock registers its controller under the conversation and releases it owned', () => {
        expect(runnerSrc).toMatch(/chatStore\.beginConversationRun\(turnConversationId, controller\)/);
        expect(runnerSrc).toMatch(/chatStore\.endConversationRunOwned\(turnConversationId, controller\)/);
    });

    it('a Stop with no pipeline run still aborts the conversation run', () => {
        expect(pipelineSrc).toMatch(/if \(key && key !== NO_CONVERSATION_KEY\) abortConversationRun\(key\);/);
    });

    it('the Chat surface folds a dock run into its own busy state', () => {
        expect(chatSrc).toMatch(/snap\.conversationRunning\[activeConversationId\]/);
        expect(chatSrc).toMatch(/const running = busy \|\| analysisRunning \|\| dockRunning;/);
        expect(chatSrc).toMatch(/if \(!prompt \|\| running\) return;/);
    });

    it('the abort-during-fetch branch releases BOTH registrations, not just the session’s', () => {
        // `send()` has ONE finally, and this branch returns before the try that
        // owns it is entered — so a conversation registration armed above is
        // released here or nowhere. Measured, not theorised: the render probe's
        // Stop-mid-tool-round pressed exactly this path, and the Chat surface's
        // composer then stayed on Stop for the rest of the session because the
        // thread still read as running.
        const start = runnerSrc.indexOf('if (controller.signal.aborted) {');
        expect(start, 'the abort-during-fetch branch is still there to check').toBeGreaterThan(-1);
        const end = runnerSrc.indexOf('return;', start);
        expect(end, 'the branch still ends on its own return').toBeGreaterThan(start);
        const branch = runnerSrc.slice(start, end);
        expect(branch).toContain('endRunOwned(sid, controller)');
        expect(branch).toContain('chatStore.endConversationRunOwned(turnConversationId, controller)');
    });

    it('a thread that is already answering is never adopted for a dock turn', () => {
        // The pipeline registers its run under the conversation id BEFORE the
        // trader's row lands, so an empty active thread can still be mid-run.
        // Adopting it would put two writers on one answer — the desync this
        // callback exists to remove. Sliced to the function body, because the
        // check is about which branch owns the condition.
        const appSrc = readFileSync('App.tsx', 'utf8');
        const start = appSrc.indexOf('const ensureDockTurnConversation');
        expect(start, 'the adopt-or-mint callback is still there to check').toBeGreaterThan(-1);
        const end = appSrc.indexOf('}, [conversationHistory', start);
        expect(end).toBeGreaterThan(start);
        expect(appSrc.slice(start, end))
            .toMatch(/if \(reusable && !chatStore\.isConversationRunning\(reusable\.id\)\)/);
    });
});

describe('a Chart AI turn mirrored into the conversation', () => {
    beforeEach(() => {
        vi.useRealTimers();
        chatStore.__resetForTests();
        __clearPacketCacheForTests();
        localStorage.clear();
        streamMock.mockReset();
    });

    /** Chunked slower than the mirror's throttle window, so a mid-stream commit
     *  is a fact the test can see rather than a race it hopes to win. */
    const CHUNK_MS = 260;
    const stream = (chunks: string[]) => streamMock.mockImplementation(async function* () {
        for (const c of chunks) {
            yield c;
            await new Promise(r => setTimeout(r, CHUNK_MS));
        }
    });

    it('adopts a conversation for a session that never had one, mirrors the stream, and settles it', async () => {
        stream(['Long ', 'BTC above ', 'the VWAP.']);
        const commits: SoloTurnRow[] = [];
        const onSoloTurnCommit = vi.fn((row: SoloTurnRow) => { commits.push(row); });
        const onSyncConversation = vi.fn(() => 'conv-9');
        render(<TradeChatPanel symbol="BTCUSDT" interval="15m" providers={[config]} selectedChatModel="model-a"
            onSelectChatModel={() => {}} onSoloTurnCommit={onSoloTurnCommit} onSyncConversation={onSyncConversation} />);

        const input = screen.getByTestId('composer-input');
        await act(async () => {
            fireEvent.change(input, { target: { value: 'read this chart' } });
            fireEvent.click(screen.getByRole('button', { name: 'Send' }));
        });

        // Wait for the turn to SETTLE on the conversation, not merely for text
        // to appear: the last commit is the one that has to say so.
        await waitFor(() => expect(commits.some(c => c.role === 'ai' && c.streaming === false)).toBe(true), { timeout: 6000 });
        expect(screen.getByText(/the VWAP/)).toBeTruthy();

        // The thread is resolved BEFORE anything is written, and the session
        // keeps the binding, so the next turn and the other home agree.
        expect(onSyncConversation).toHaveBeenCalled();
        expect(chatStore.getActiveSession()?.conversationId).toBe('conv-9');

        const user = commits.find(c => c.role === 'user');
        expect(user).toMatchObject({ text: 'read this chart' });
        const live = commits.filter(c => c.role === 'ai');
        expect(live.length, 'the answer is mirrored while it streams, not only at settle').toBeGreaterThan(1);
        expect(live.some(c => c.streaming === true && typeof c.text === 'string' && c.text.length > 0)).toBe(true);
        // …and the final word is a settled row with the whole answer.
        expect(live.at(-1)).toMatchObject({ streaming: false, text: 'Long BTC above the VWAP.' });
        expect(typeof live.at(-1)!.workedMs).toBe('number');
        // The conversation registry is released, so the Chat surface stops
        // showing Stop for a run that has ended.
        expect(chatStore.isConversationRunning('conv-9')).toBe(false);
    });

    it('refuses a second send while the same conversation is answering', async () => {
        stream(['one ']);
        const onSoloTurnCommit = vi.fn();
        render(<TradeChatPanel symbol="BTCUSDT" interval="15m" providers={[config]} selectedChatModel="model-a"
            onSelectChatModel={() => {}} onSoloTurnCommit={onSoloTurnCommit}
            onSyncConversation={() => 'conv-lock'} />);
        const sid = chatStore.getActiveId();
        // A run the Chat surface owns, on the conversation this session IS.
        act(() => { chatStore.mutate(sid, s => ({ ...s, conversationId: 'conv-lock' })); });
        const foreign = new AbortController();
        chatStore.beginConversationRun('conv-lock', foreign);
        await act(async () => {
            fireEvent.change(screen.getByTestId('composer-input'), { target: { value: 'second question' } });
            fireEvent.click(screen.getByRole('button', { name: /Send|Stop/ }));
            await new Promise(r => setTimeout(r, 0));
        });
        expect(streamMock, 'the dock must not start a second writer on one thread').not.toHaveBeenCalled();
        // The question never enters the transcript — only the draft is left in
        // the composer, which is what a refused send looks like.
        expect(chatStore.getSnapshot().sessions.find(s => s.id === chatStore.getActiveId())?.entries ?? [])
            .not.toContainEqual(expect.objectContaining({ text: 'second question' }));
        chatStore.endConversationRun('conv-lock');
    });
});
