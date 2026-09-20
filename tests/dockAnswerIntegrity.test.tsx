/**
 * The dock must render every character it has, mid-stream.
 *
 * The reveal used to be a requestAnimationFrame loop that showed a growing
 * prefix of the answer. Measured in the running app on a 4,800-character
 * reply, only 1,728 characters were in the DOM while the window was hidden
 * (rAF fired zero times in 400ms) — the tail was neither visible nor
 * scrollable, while the Copy chip handed over the complete text. These two
 * assertions are that bug's fence.
 */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import type { ProviderConfig } from '../types/provider';

vi.mock('../services/analysis/DeskToolsService', () => ({
    streamChatWithDeskTools: vi.fn(() => ({ done: true })),
}));
vi.mock('../services/analysis/HybridIntelligenceService', () => ({
    fetchHybridData: vi.fn(async () => ({})),
    generateHybridPromptInjection: vi.fn(() => ''),
}));
vi.mock('../services/analysis/KlineService', () => ({
    fetchKlines: vi.fn(async () => []),
}));
vi.mock('../services/learning/SkillMemoryService', () => ({ listSkills: () => [] }));
vi.mock('../utils/activeUser', () => ({
    getActiveUsername: () => 'alice',
    LAST_ACTIVE_USER_KEY: 'last_active_user',
}));

import TradeChatPanel from '../components/trade/TradeChatPanel';
import * as chatStore from '../services/trade/chatStore';

const config: ProviderConfig = {
    id: 'prov-a', name: 'Provider A', apiKey: 'key-a',
    baseUrl: 'https://api.example.com/v1', apiFormat: 'chat_completions',
    isEnabled: true, isBuiltIn: true, models: ['model-a'], selectedModel: 'model-a',
};

beforeEach(() => {
    chatStore.__resetForTests();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline test'); }));
    localStorage.clear();
});

afterEach(cleanup);

/** jsdom's requestAnimationFrame is unreliable; stub it out so a frame-driven
 *  reveal cannot advance even in principle during the assertion. */
const noFrames = (): void => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 0));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
};

const seedStreamingAnswer = (text: string): void => {
    act(() => { chatStore.addSession({ kind: 'solo' }); });
    const sid = chatStore.getActiveId();
    act(() => { chatStore.mutate(sid, s => ({
        ...s,
        entries: [
            { id: 'u1', role: 'user', text: 'the full read please', tools: [], at: Date.now() },
            { id: 'a1', role: 'ai', text, tools: [], streaming: true, at: Date.now() },
        ],
    })); });
};

describe('a streaming answer is complete in the DOM', () => {
    beforeEach(noFrames);

    it('shows the whole reply, not a reveal prefix, while the flag is set', async () => {
        const answer = 'SENTINEL-abcdefghij '.repeat(240) + 'THE TAIL OF THE ANSWER';
        render(
            <TradeChatPanel symbol="BTCUSDT" interval="15m" providers={[config]}
                selectedChatModel="model-a" onSelectChatModel={() => {}} />,
        );
        seedStreamingAnswer(answer);
        const entry = await screen.findByText(/SENTINEL-abcdefghij/);
        const wrapper = entry.closest('[data-entry-id="a1"]')!;
        expect(wrapper.textContent).toContain('THE TAIL OF THE ANSWER');
        expect((wrapper.textContent || '').length).toBeGreaterThanOrEqual(answer.length);
    });

    it('a reopened session shows the whole settled answer at once', async () => {
        const answer = 'y'.repeat(2000) + 'END-OF-REPLY';
        render(
            <TradeChatPanel symbol="BTCUSDT" interval="15m" providers={[config]}
                selectedChatModel="model-a" onSelectChatModel={() => {}} />,
        );
        act(() => { chatStore.addSession({ kind: 'solo' }); });
        const sid = chatStore.getActiveId();
        act(() => { chatStore.mutate(sid, s => ({
            ...s,
            entries: [{ id: 'a1', role: 'ai', text: answer, tools: [], at: Date.now() }],
        })); });
        await screen.findByText(/END-OF-REPLY/);
        expect(document.querySelector('[data-entry-id="a1"]')?.textContent).toContain('END-OF-REPLY');
    });
});
