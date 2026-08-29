import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { MessageRole } from '../types/enums';
import { Message } from '../types/message';
import { ProviderConfig } from '../types/provider';
import { useAgentGroups } from '../hooks/useAgentGroups';
import { streamQuickResponse } from '../services/providers/GenericAnalysisService';
import { AgentBot } from '../services/agents/agentRoster';

vi.mock('../services/providers/GenericAnalysisService', () => ({
    streamQuickResponse: vi.fn(),
}));

const streamMock = vi.mocked(streamQuickResponse);

const provider = (over: Partial<ProviderConfig> = {}): ProviderConfig => ({
    id: over.id ?? 'p1',
    name: over.name ?? 'OpenAI',
    apiKey: over.apiKey ?? 'sk-test',
    baseUrl: over.baseUrl ?? 'https://api.example.com',
    apiFormat: over.apiFormat ?? 'chat_completions',
    isEnabled: over.isEnabled ?? true,
    isBuiltIn: over.isBuiltIn ?? false,
    models: over.models ?? ['model-a', 'model-b'],
    selectedModel: over.selectedModel ?? 'model-a',
    ...over,
});

const bot = (over: Partial<AgentBot> = {}): AgentBot => ({
    id: over.id ?? 'b1',
    name: over.name ?? 'Scout',
    providerId: over.providerId ?? 'p1',
    modelId: over.modelId ?? 'model-a',
    avatar: over.avatar ?? { kind: 'auto' },
    createdAt: over.createdAt ?? new Date().toISOString(),
    ...over,
});

/** Store-side stubs: append/patch over a local array, App-style. */
const makeStore = () => {
    const messages: Message[] = [];
    return {
        messages,
        appendMessage: (m: Message) => { messages.push({ ...m }); },
        patchMessage: (id: string, patch: Partial<Message>) => {
            const i = messages.findIndex(m => m.id === id);
            if (i >= 0) messages[i] = { ...messages[i], ...patch };
        },
    };
};

beforeEach(() => {
    streamMock.mockReset();
});

describe('useAgentGroups', () => {
    it('fans one prompt out to every member serially, attributing replies via modelsUsed', async () => {
        streamMock.mockImplementation(async (config, _prompt, _history, _system, _signal, _onReasoning, onChunk) => {
            onChunk?.(`partial from ${config.selectedModel} `);
            return `reply from ${config.selectedModel}`;
        });
        const store = makeStore();
        const { result } = renderHook(() => useAgentGroups({
            providerConfigs: [provider()],
            appendMessage: store.appendMessage,
            patchMessage: store.patchMessage,
        }));
        const bots = [
            bot({ id: 'b1', name: 'Scout', modelId: 'model-a' }),
            bot({ id: 'b2', name: 'Ledger', modelId: 'model-b' }),
        ];

        await act(async () => {
            await result.current.runGroupThread({ memberIds: ['b1', 'b2'] }, 'analyze btc', bots);
        });

        // One prompt + one empty streaming reply per member.
        expect(store.messages).toHaveLength(3);
        expect(store.messages[0].role).toBe(MessageRole.USER);
        expect(store.messages[0].text).toBe('analyze btc');
        expect(store.messages[1].modelsUsed).toEqual({ p1: 'model-a' });
        expect(store.messages[2].modelsUsed).toEqual({ p1: 'model-b' });
        // Each reply was finalized with the stream result (not the partial).
        expect(store.messages[1].text).toBe('reply from model-a');
        expect(store.messages[1].isStreaming).toBe(false);
        expect(store.messages[2].text).toBe('reply from model-b');
        // Each bot got its own config with its own model.
        expect(streamMock).toHaveBeenCalledTimes(2);
        expect(streamMock.mock.calls[0][0].selectedModel).toBe('model-a');
        expect(streamMock.mock.calls[1][0].selectedModel).toBe('model-b');
        // Activity: sent → working/replied per bot; run finished.
        expect(result.current.activity.map(a => a.kind)).toEqual(['sent', 'working', 'replied', 'working', 'replied']);
        expect(result.current.isRunning).toBe(false);
        expect(result.current.workingBotId).toBeNull();
    });

    it('@name directs the prompt to that member only', async () => {
        streamMock.mockResolvedValue('direct reply');
        const store = makeStore();
        const { result } = renderHook(() => useAgentGroups({
            providerConfigs: [provider()],
            appendMessage: store.appendMessage,
            patchMessage: store.patchMessage,
        }));
        const bots = [
            bot({ id: 'b1', name: 'Scout', modelId: 'model-a' }),
            bot({ id: 'b2', name: 'Ledger', modelId: 'model-b' }),
        ];

        await act(async () => {
            await result.current.runGroupThread({ memberIds: ['b1', 'b2'] }, '@ledger check funding', bots);
        });

        expect(streamMock).toHaveBeenCalledTimes(1);
        expect(streamMock.mock.calls[0][0].selectedModel).toBe('model-b');
        expect(store.messages.filter(m => m.role === MessageRole.AI)).toHaveLength(1);
    });

    it('a member whose provider is offline passes without calling the model', async () => {
        const store = makeStore();
        const { result } = renderHook(() => useAgentGroups({
            providerConfigs: [provider({ isEnabled: false })],
            appendMessage: store.appendMessage,
            patchMessage: store.patchMessage,
        }));

        await act(async () => {
            await result.current.runGroupThread(
                { memberIds: ['b1'] },
                'hello',
                [bot({ id: 'b1', name: 'Scout' })],
            );
        });

        expect(streamMock).not.toHaveBeenCalled();
        expect(store.messages.filter(m => m.role === MessageRole.AI)).toHaveLength(0);
        expect(result.current.activity.map(a => a.kind)).toEqual(['sent', 'passed']);
        expect(result.current.activity[1].detail).toBe('provider offline');
    });
});
