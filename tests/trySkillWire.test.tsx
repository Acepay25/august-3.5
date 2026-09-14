/**
 * "Try in chat" → Chart AI composer, end to end. The Strategy Studio cards and
 * the learning-queue rows dispatch `august:try-skill`; TradeChatPanel owns the
 * listener (the old ChatInput that handled it was deleted in 78bc027, which
 * silently turned every "Try in chat" button into a no-op). This mounts the
 * real dock and asserts the skill's /slash-invocation lands in the composer —
 * and that invoking the same skill twice doesn't duplicate the token.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ProviderConfig } from '../types/provider';

const { streamMock } = vi.hoisted(() => ({
    streamMock: vi.fn() as Mock<(...args: any[]) => any>,
}));

vi.mock('../services/analysis/DeskToolsService', () => ({
    streamChatWithDeskTools: (...args: unknown[]) => streamMock(...args),
}));
vi.mock('../services/analysis/HybridIntelligenceService', () => ({
    fetchHybridData: vi.fn(async () => ({})),
    generateHybridPromptInjection: vi.fn(() => '## packet'),
}));
vi.mock('../services/learning/SkillMemoryService', () => ({
    listSkills: vi.fn(() => []),
}));
vi.mock('../utils/activeUser', () => ({
    getActiveUsername: () => 'alice',
    LAST_ACTIVE_USER_KEY: 'last_active_user',
}));

import TradeChatPanel, { __clearPacketCacheForTests } from '../components/trade/TradeChatPanel';
import * as chatStore from '../services/trade/chatStore';

const config: ProviderConfig = {
    id: 'prov-a', name: 'Provider A', apiKey: 'test-key',
    baseUrl: 'https://api.example.com/v1', apiFormat: 'chat_completions',
    isEnabled: true, isBuiltIn: true, models: ['model-a'], selectedModel: 'model-a',
};

beforeEach(() => {
    streamMock.mockReset();
    chatStore.__resetForTests();
    __clearPacketCacheForTests();
    localStorage.clear();
    localStorage.setItem('trader_learning_v1:alice', '0');
    localStorage.setItem('supervisor_auto_v1:alice', '0');
});

const trySkill = (slug: string): void => {
    window.dispatchEvent(new CustomEvent('august:try-skill', { detail: { slug } }));
};

describe('august:try-skill → Chart AI composer', () => {
    it('drops the skill /slug into an empty composer (send stays manual)', async () => {
        render(
            <TradeChatPanel
                symbol="BTCUSDT" interval="15m"
                providers={[config]} selectedChatModel="model-a" onSelectChatModel={() => {}}
            />,
        );
        const composer = await screen.findByPlaceholderText('Ask anything…') as HTMLTextAreaElement;
        expect(composer.value).toBe('');

        trySkill('btc-15m-pin-bar-reclaim');
        await waitFor(() => expect(composer.value).toContain('/btc-15m-pin-bar-reclaim'));
        // .md is stripped from the invocation token.
        expect(composer.value.trim()).toBe('/btc-15m-pin-bar-reclaim');
    });

    it('prepends the token to existing text and never duplicates it', async () => {
        render(
            <TradeChatPanel
                symbol="BTCUSDT" interval="15m"
                providers={[config]} selectedChatModel="model-a" onSelectChatModel={() => {}}
            />,
        );
        const composer = await screen.findByPlaceholderText('Ask anything…') as HTMLTextAreaElement;
        fireEvent.change(composer, { target: { value: 'what do you see?' } });

        trySkill('eth-breakout');
        await waitFor(() => expect(composer.value).toContain('/eth-breakout'));
        expect(composer.value).toBe('/eth-breakout what do you see?');

        // A second tap on the same skill must not stack a second token.
        trySkill('eth-breakout');
        await new Promise(r => setTimeout(r, 0));
        expect(composer.value.match(/\/eth-breakout/g)?.length).toBe(1);
    });
});
