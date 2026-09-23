/**
 * Chart AI ↔ Agents sync.
 *
 * A Chart AI session can be bound to a roster bot (`ChatSession.botId`), and
 * until now that binding carried the bot's PERSONA text only — the debate
 * passes `getBotMemoryContext` while the dock passed nothing, so the same named
 * agent knew less at the chart than at the desk. Rows were the other half: the
 * solo turn stamped `providerId:modelId`, so a bot's chart answer was claimed
 * by model while its desk answer is claimed by identity.
 *
 * The harness-signal path is used to drive a turn because it runs on mount
 * without a composer interaction, and it goes through the same two sites.
 */

import React from 'react';
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import type { ProviderConfig } from '../types/provider';
import type { AgentBot } from '../services/agents/agentRoster';

const { streamMock, botMemoryMock } = vi.hoisted(() => ({
    streamMock: vi.fn() as Mock<(...args: unknown[]) => AsyncGenerator<string>>,
    botMemoryMock: vi.fn() as Mock<(botId: string, query?: unknown, scope?: string) => string>,
}));

vi.mock('../services/analysis/DeskToolsService', () => ({
    streamChatWithDeskTools: (...args: unknown[]) => streamMock(...args),
}));
vi.mock('../services/analysis/HybridIntelligenceService', () => ({
    fetchHybridData: vi.fn(async () => ({})),
    generateHybridPromptInjection: vi.fn(() => '## packet'),
}));
vi.mock('../services/analysis/KlineService', () => ({ fetchKlines: vi.fn(async () => []) }));
vi.mock('../services/learning/SkillMemoryService', () => ({ listSkills: vi.fn(() => []) }));
// Partial mock: only the reader is faked, so the test asserts against the
// REAL allowance constant the dock imports. A whole-module mock would hand the
// assertion `undefined` and a passing test that checked nothing.
vi.mock('../services/bots/BotMemoryService', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../services/bots/BotMemoryService')>()),
    getBotMemoryContext: (...args: unknown[]) => (botMemoryMock as (...a: unknown[]) => unknown)(...args),
}));
vi.mock('../utils/activeUser', () => ({
    getActiveUsername: () => 'alice',
    LAST_ACTIVE_USER_KEY: 'last_active_user',
}));

import TradeChatPanel, { __clearPacketCacheForTests, __clearProposalStateForTests } from '../components/trade/TradeChatPanel';
import * as chatStore from '../services/trade/chatStore';
import * as levelWatch from '../services/trade/levelWatchService';
import * as watchService from '../services/trade/watchService';
import { BOT_MEMORY_TOTAL_CHAR_BUDGET } from '../services/bots/botMemoryBudget';

const config: ProviderConfig = {
    id: 'prov-a', name: 'Provider A', apiKey: 'key-a',
    baseUrl: 'https://api.example.com/v1', apiFormat: 'chat_completions',
    isEnabled: true, isBuiltIn: true, models: ['model-a'], selectedModel: 'model-a',
};

const BOT: AgentBot = {
    id: 'b1', name: 'Aria', providerId: 'prov-a', modelId: 'model-a',
    memoryScope: 'global', avatar: { kind: 'auto' }, createdAt: '2026-09-01T00:00:00.000Z',
};

const NOTES = '[bot:b1/memory.md] This trader gets stopped by tight entries on 15m.';
const SIGNAL = '[HARNESS SIGNAL — price event, not the user] Plan btc-1: TP1 @ 110 HIT (mark 110.5, 14:31 UTC). Level id btc-1:TP1.';

const yieldText = (text: string) => async function* (): AsyncGenerator<string> { yield text; };

const systemPromptOf = (call: unknown[]): string =>
    (call[1] as Array<{ role: string; content: string }>).find(m => m.role === 'system')?.content ?? '';

beforeEach(() => {
    chatStore.__resetForTests();
    levelWatch.__resetForTests();
    watchService.__resetForTests();
    // Sessions persist per user, so a bot-bound session left active by an
    // earlier case would make the unbound case bot-bound.
    localStorage.clear();
    botMemoryMock.mockReset();
    botMemoryMock.mockReturnValue(NOTES);
    streamMock.mockReset();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline test'); }));
    __clearPacketCacheForTests();
    __clearProposalStateForTests();
});

describe('a bot bound to Chart AI', () => {
    it('answers with its own notes in the prompt, filtered to the chart coin', async () => {
        script_turn('noted');
        render(<TradeChatPanel
            symbol="BTCUSDT" interval="15m" providers={[config]}
            selectedChatModel="model-a" onSelectChatModel={() => {}}
            bots={[BOT]} botSessionRequest={{ botId: 'b1', nonce: 1 }}
        />);
        act(() => { chatStore.queueHarnessSignal(SIGNAL); });
        await screen.findByTestId('chat-notice');
        await waitFor(() => expect(streamMock).toHaveBeenCalled());

        expect(systemPromptOf(streamMock.mock.calls[0])).toContain(NOTES);
        // The query and the allowance are the contract: the coin filter now
        // carries every coin this trader keeps a journal for (not just a
        // hardcoded majors list), and one agent speaking gets the whole
        // bot-memory allowance the debate divides across its roster.
        expect(botMemoryMock).toHaveBeenCalledWith(
            'b1',
            expect.objectContaining({ coin: 'BTCUSDT' }),
            BOT_MEMORY_TOTAL_CHAR_BUDGET,
        );
    });

    it('labels its answer with the agent, not the model slug', async () => {
        script_turn('noted');
        render(<TradeChatPanel
            symbol="BTCUSDT" interval="15m" providers={[config]}
            selectedChatModel="model-a" onSelectChatModel={() => {}}
            bots={[BOT]} botSessionRequest={{ botId: 'b1', nonce: 1 }}
        />);
        act(() => { chatStore.queueHarnessSignal(SIGNAL); });
        // The last AI row, scoped away from the session's agent chip: only
        // this label is the identity claim under test.
        const rows = await screen.findAllByTestId('chat-entry-ai');
        const row = rows[rows.length - 1];
        expect(row.textContent).toContain('Aria');
        expect(row.textContent).not.toContain('Model A');
    });
});

describe('an unbound Chart AI session', () => {
    it('pulls no bot notebook and names no agent', async () => {
        script_turn('plain answer');
        render(<TradeChatPanel
            symbol="BTCUSDT" interval="15m" providers={[config]}
            selectedChatModel="model-a" onSelectChatModel={() => {}}
            bots={[BOT]}
        />);
        act(() => { chatStore.queueHarnessSignal(SIGNAL); });
        await screen.findByTestId('chat-notice');
        await waitFor(() => expect(streamMock).toHaveBeenCalled());

        expect(botMemoryMock).not.toHaveBeenCalled();
        expect(systemPromptOf(streamMock.mock.calls[0])).not.toContain(NOTES);
        // The dock seeds an entry per session, so assert on the row that just
        // streamed — the last one — not on "an" AI row.
        const rows = await screen.findAllByTestId('chat-entry-ai');
        const row = rows[rows.length - 1];
        // No label at all on this path today — which is the point: the name
        // appears only because a bot is bound, so binding is the one thing
        // that can claim an answer.
        expect(row.textContent).not.toContain('Aria');
    });
});

function script_turn(text: string): void {
    streamMock.mockImplementation(yieldText(text));
}
