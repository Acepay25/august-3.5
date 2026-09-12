/**
 * TradeChatPanel — RETRY on user bubbles. Hovering a user message shows a
 * retry chip: the stale answer(s) after that bubble are dropped and the
 * turn re-runs with the SAME text/image plus fresh live context. Stopping
 * during the context fetch rolls back the fresh answer but KEEPS the
 * original user bubble.
 */

import React from 'react';
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import type { ProviderConfig } from '../types/provider';

const { streamMock, listSkillsMock, fetchHybridMock } = vi.hoisted(() => ({
    streamMock: vi.fn() as Mock<(...args: any[]) => any>,
    listSkillsMock: vi.fn() as Mock<() => any[]>,
    fetchHybridMock: vi.fn() as Mock<(...args: any[]) => any>,
}));

vi.mock('../services/analysis/DeskToolsService', () => ({
    streamChatWithDeskTools: (...args: unknown[]) => streamMock(...args),
}));
vi.mock('../services/analysis/HybridIntelligenceService', () => ({
    fetchHybridData: (...args: unknown[]) => fetchHybridMock(...args),
    generateHybridPromptInjection: vi.fn(() => '## packet'),
}));
vi.mock('../services/learning/SkillMemoryService', () => ({
    listSkills: (...args: unknown[]) => (listSkillsMock as (...a: unknown[]) => unknown)(...args),
}));
vi.mock('../utils/activeUser', () => ({
    getActiveUsername: () => 'alice',
    LAST_ACTIVE_USER_KEY: 'last_active_user',
}));

import TradeChatPanel, { __clearPacketCacheForTests } from '../components/trade/TradeChatPanel';
import * as chatStore from '../services/trade/chatStore';

const config: ProviderConfig = {
    id: 'prov-a', name: 'Provider A', apiKey: 'key-a',
    baseUrl: 'https://api.example.com/v1', apiFormat: 'chat_completions',
    isEnabled: true, isBuiltIn: true, models: ['model-a', 'model-b'], selectedModel: 'model-a',
};

const yieldText = (text: string) => async function* (): AsyncGenerator<string> { yield text; };

beforeEach(() => {
    chatStore.__resetForTests();
    __clearPacketCacheForTests();
    localStorage.clear();
    localStorage.setItem('trader_learning_v1:alice', '0');
    localStorage.setItem('supervisor_auto_v1:alice', '0');
    listSkillsMock.mockReset();
    listSkillsMock.mockReturnValue([]);
    fetchHybridMock.mockReset();
    fetchHybridMock.mockImplementation(async () => ({}));
    streamMock.mockReset();
    streamMock.mockImplementation(yieldText('ok'));
});

const mount = (): void => {
    render(<TradeChatPanel symbol="BTCUSDT" interval="15m" providers={[config]} selectedChatModel="model-a" onSelectChatModel={() => {}} />);
};

const seedTurn = (): void => {
    const sid = chatStore.getActiveId();
    act(() => {
        chatStore.mutate(sid, s => ({
            ...s,
            entries: [
                { id: 'u-seed', role: 'user', text: 'Read this chart', tools: [] },
                { id: 'a-seed', role: 'ai', text: 'Stale answer', tools: [] },
            ],
        }));
    });
};

describe('retry on a user bubble', () => {
    it('drops the stale answer and regenerates from the original message', async () => {
        streamMock.mockImplementation(yieldText('Fresh regenerated answer'));
        mount();
        seedTurn();

        fireEvent.click(screen.getByLabelText('Retry this message'));

        // The stale answer is gone from the transcript…
        await waitFor(() => expect(screen.queryByText('Stale answer')).toBeNull());
        // …the fresh answer streams in…
        expect(await screen.findByText('Fresh regenerated answer')).toBeTruthy();
        // …the user bubble is NOT duplicated…
        expect(screen.getAllByText('Read this chart').length).toBe(1);
        // …and the model saw the original message with NO stale answer in history.
        const messages = streamMock.mock.calls[0][1] as Array<{ role: string; content: string }>;
        const nonSystem = messages.filter(m => m.role !== 'system').map(m => String(m.content));
        expect(nonSystem.some(t => t.includes('Stale answer'))).toBe(false);
        expect(nonSystem[nonSystem.length - 1]).toContain('Read this chart');
    });

    it('retries an image-only send by reusing the attached screenshot', async () => {
        mount();
        const sid = chatStore.getActiveId();
        act(() => {
            chatStore.mutate(sid, s => ({
                ...s,
                entries: [
                    { id: 'u-img', role: 'user', text: '(chart screenshot)', tools: [], image: 'data:image/png;base64,AAA' },
                    { id: 'a-img', role: 'ai', text: 'Old read', tools: [] },
                ],
            }));
        });

        fireEvent.click(screen.getByLabelText('Retry this message'));

        await waitFor(() => expect(screen.queryByText('Old read')).toBeNull());
        expect(await screen.findByText('ok')).toBeTruthy();
        // model-a is not a vision model, so the retry announces the attached
        // screenshot in the user content it sends.
        const messages = streamMock.mock.calls[0][1] as Array<{ role: string; content: string }>;
        const lastUser = messages.filter(m => m.role === 'user').at(-1);
        expect(String(lastUser?.content)).toContain('attached a chart screenshot');
    });

    it('hides retry + copy while the regenerated answer streams, back on settle', async () => {
        // A stream that stays open until the store aborts it.
        streamMock.mockImplementation(async function* (_c: unknown, _m: unknown, opts: { signal?: AbortSignal }) {
            yield 'partial answer';
            await new Promise<void>(resolve => {
                const check = window.setInterval(() => {
                    if (opts?.signal?.aborted) { window.clearInterval(check); resolve(); }
                }, 10);
            });
        });
        mount();
        seedTurn();
        expect(screen.getByLabelText('Retry this message')).toBeTruthy();
        fireEvent.click(screen.getByLabelText('Retry this message'));
        // Mid-generation BOTH chips are gone (copy hides the same way)…
        await waitFor(() => expect(screen.queryByLabelText('Retry this message')).toBeNull());
        expect(screen.queryByLabelText('Copy message')).toBeNull();
        // …and stopping the generation brings them back on settle.
        act(() => { chatStore.abortActive(); });
        expect(await screen.findByText('partial answer')).toBeTruthy();
        await waitFor(() => expect(screen.getByLabelText('Retry this message')).toBeTruthy());
    });

    it('keeps the retried user bubble when stopped during the context fetch', async () => {
        // Hold the hybrid-packet fetch so the turn sits between the
        // optimistic paint and the stream.
        let release!: (value: unknown) => void;
        fetchHybridMock.mockImplementation(() => new Promise(resolve => { release = resolve; }));
        mount();
        seedTurn();

        fireEvent.click(screen.getByLabelText('Retry this message'));
        await waitFor(() => expect(screen.queryByText('Stale answer')).toBeNull());
        // Stop while the fetch is still held…
        act(() => { chatStore.abortActive(); });
        act(() => { release({}); });

        // …the fresh answer rolled back, the ORIGINAL user bubble survived.
        await waitFor(() => {
            const sid = chatStore.getActiveId();
            const ids = chatStore.getSnapshot().sessions.find(s => s.id === sid)?.entries.map(e => e.id);
            expect(ids).toEqual(['u-seed']);
        });
        expect(screen.getByText('Read this chart')).toBeTruthy();
        expect(screen.queryByLabelText('Retry this message')).toBeTruthy();
    });
});
