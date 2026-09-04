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

// ── G2: bounded rounds, (pass) silence, incremental room context ──────────
describe('useAgentGroups room engine (G2)', () => {
    const bots3 = [
        bot({ id: 'b1', name: 'Macro', modelId: 'model-a' }),
        bot({ id: 'b2', name: 'Risk', modelId: 'model-b' }),
        bot({ id: 'b3', name: 'Scout', modelId: 'model-a' }),
    ];

    const setupRoom = () => {
        const store = makeStore();
        const { result } = renderHook(() => useAgentGroups({
            providerConfigs: [provider()],
            appendMessage: store.appendMessage,
            patchMessage: store.patchMessage,
        }));
        return { store, result };
    };

    it('a reply that @mentions a teammate gives them the next round', async () => {
        streamMock
            .mockResolvedValueOnce('Thesis is long. @risk check my size')
            .mockResolvedValueOnce('Size is fine');
        const { store, result } = setupRoom();
        await act(async () => {
            await result.current.runGroupThread({ memberIds: ['b1', 'b2'] }, '@macro analyze', bots3);
        });
        // Round 1: only Macro (mention routing). Round 2: Risk (re-mention).
        expect(streamMock).toHaveBeenCalledTimes(2);
        expect(String(streamMock.mock.calls[0][3])).toContain('You are Macro');
        expect(String(streamMock.mock.calls[1][3])).toContain('You are Risk');
        // Risk's turn was fed Macro's reply, not the whole room twice.
        expect(String(streamMock.mock.calls[1][1])).toContain('Macro: Thesis is long');
        // Settled: Scout was never addressed.
        expect(store.messages.filter(m => m.role === MessageRole.AI)).toHaveLength(2);
    });

    it('(pass) is silence: no bubble, no room entry, activity only', async () => {
        streamMock
            .mockResolvedValueOnce('(pass)')
            .mockResolvedValueOnce('I concur');
        const { store, result } = setupRoom();
        await act(async () => {
            await result.current.runGroupThread({ memberIds: ['b1', 'b2'] }, '@macro @risk go', bots3);
        });
        const ai = store.messages.filter(m => m.role === MessageRole.AI);
        // The pass row exists (attribution) but is hidden and empty.
        expect(ai).toHaveLength(2);
        expect(ai[0].hidden).toBe(true);
        expect(ai[0].text).toBe('');
        expect(ai[1].text).toBe('I concur');
        expect(result.current.activity.some(a => a.kind === 'passed' && a.botName === 'Macro')).toBe(true);
    });

    it('an all-pass round settles the room (no further rounds)', async () => {
        streamMock.mockResolvedValue('(pass)');
        const { result } = setupRoom();
        await act(async () => {
            await result.current.runGroupThread({ memberIds: ['b1', 'b2'] }, '@everyone react', bots3);
        });
        // @everyone = both speak once; nobody mentioned anyone → settled.
        expect(streamMock).toHaveBeenCalledTimes(2);
    });

    it('each member sees only room messages newer than their last turn', async () => {
        streamMock
            .mockResolvedValueOnce('M1 @risk your call')
            .mockResolvedValueOnce('R1 @macro your call')
            .mockResolvedValueOnce('M2');
        const { result } = setupRoom();
        await act(async () => {
            await result.current.runGroupThread({ memberIds: ['b1', 'b2'] }, '@macro start', bots3);
        });
        expect(streamMock).toHaveBeenCalledTimes(3);
        // Macro turn 1: only the prompt.
        const macroFirst = String(streamMock.mock.calls[0][1]);
        expect(macroFirst).toContain('Trader: @macro start');
        // Risk turn: prompt + Macro's reply (both new to Risk).
        const riskTurn = String(streamMock.mock.calls[1][1]);
        expect(riskTurn).toContain('Trader: @macro start');
        expect(riskTurn).toContain('Macro: M1 @risk your call');
        // Macro turn 2: only what appeared since its last turn — the
        // prompt is NOT re-fed, but its own prior line is (rendered as
        // "You:" — a stateless model needs to see what it already said).
        const macroSecond = String(streamMock.mock.calls[2][1]);
        expect(macroSecond).toContain('Risk: R1 @macro your call');
        expect(macroSecond).toContain('You: M1 @risk your call');
        expect(macroSecond).not.toContain('Trader: @macro start');
    });

    it('the turn budget bounds a chatty room', async () => {
        // Every reply mentions the other bot: an endless ping-pong.
        streamMock.mockImplementation(async (_c, prompt) =>
            String(prompt).includes('Macro:') ? '@macro your turn' : '@risk your turn');
        const { result } = setupRoom();
        await act(async () => {
            await result.current.runGroupThread({ memberIds: ['b1', 'b2'] }, '@macro start', bots3);
        });
        // ROOM_ROUND_CAP (3) rounds serial bounds it well under turn cap.
        expect(streamMock.mock.calls.length).toBeLessThanOrEqual(6);
        expect(result.current.isRunning).toBe(false);
    });
});

// ── R54: cancel + hybrid injection ─────────────────────────────────────────
describe('useAgentGroups cancel + hybrid (R54)', () => {
    const bots2 = [
        bot({ id: 'b1', name: 'Macro', modelId: 'model-a' }),
        bot({ id: 'b2', name: 'Risk', modelId: 'model-b' }),
    ];

    it('cancelRun aborts the stream, stops the loop, and settles the room', async () => {
        const store = makeStore();
        const { result } = renderHook(() => useAgentGroups({
            providerConfigs: [provider()],
            appendMessage: store.appendMessage,
            patchMessage: store.patchMessage,
        }));
        // A stream that never resolves on its own — cancel must break it.
        streamMock.mockImplementation((_c, _p, _h, _s, signal) => new Promise((_resolve, reject) => {
            signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }));

        let runPromise: Promise<void> = Promise.resolve();
        act(() => {
            runPromise = result.current.runGroupThread({ memberIds: ['b1', 'b2'] }, 'analyze btc', bots2);
        });
        expect(result.current.isRunning).toBe(true);
        expect(streamMock).toHaveBeenCalledTimes(1);

        act(() => { result.current.cancelRun(); });
        await act(async () => { await runPromise.catch(() => undefined); });

        expect(result.current.isRunning).toBe(false);
        expect(result.current.workingBotId).toBeNull();
        // Only the first member's bubble was created; the loop never
        // reached the second (nonce guard) — no partial second bubble.
        expect(store.messages.filter(m => m.role === MessageRole.AI)).toHaveLength(1);
        expect(result.current.activity.some(a => a.detail === 'cancelled')).toBe(true);
    });

    it('hybrid ON injects the enhanced packet into every member system prompt', async () => {
        // resetModules so the doMock below actually applies — the hook was
        // already imported statically at the top of the file.
        vi.resetModules();
        vi.doMock('../services/analysis/HybridIntelligenceService', () => ({
            tryFetchHybridDataFromPromptWithCalibration: vi.fn(async () => ({
                data: {},
                promptInjection: 'BASE',
                enhancedInjection: 'LIVE BTC DATA',
            })),
        }));
        const { useAgentGroups: withHybrid } = await import('../hooks/useAgentGroups');
        streamMock.mockResolvedValue('ok');
        const store = makeStore();
        const { result } = renderHook(() => withHybrid({
            providerConfigs: [provider()],
            appendMessage: store.appendMessage,
            patchMessage: store.patchMessage,
            hybridEnabled: true,
        }));

        await act(async () => {
            await result.current.runGroupThread({ memberIds: ['b1', 'b2'] }, 'analyze btc', bots2);
        });
        expect(streamMock).toHaveBeenCalledTimes(2);
        expect(String(streamMock.mock.calls[0][3])).toContain('LIVE BTC DATA');
        expect(String(streamMock.mock.calls[1][3])).toContain('LIVE BTC DATA');
    });

    it('hybrid OFF sends plain system prompts (no fetch at all)', async () => {
        vi.resetModules();
        const hybridFetch = vi.fn();
        vi.doMock('../services/analysis/HybridIntelligenceService', () => ({
            tryFetchHybridDataFromPromptWithCalibration: hybridFetch,
        }));
        const { useAgentGroups: withHybrid } = await import('../hooks/useAgentGroups');
        streamMock.mockResolvedValue('ok');
        const store = makeStore();
        const { result } = renderHook(() => withHybrid({
            providerConfigs: [provider()],
            appendMessage: store.appendMessage,
            patchMessage: store.patchMessage,
            hybridEnabled: false,
        }));

        await act(async () => {
            await result.current.runGroupThread({ memberIds: ['b1'] }, 'analyze btc', [bots2[0]]);
        });
        expect(hybridFetch).not.toHaveBeenCalled();
        expect(String(streamMock.mock.calls[0][3])).not.toContain('LIVE BTC DATA');
    });

    it('a hybrid fetch failure never blocks the room (plain prompts still sent)', async () => {
        vi.resetModules();
        vi.doMock('../services/analysis/HybridIntelligenceService', () => ({
            tryFetchHybridDataFromPromptWithCalibration: vi.fn(async () => { throw new Error('offline'); }),
        }));
        const { useAgentGroups: withHybrid } = await import('../hooks/useAgentGroups');
        streamMock.mockResolvedValue('ok');
        const store = makeStore();
        const { result } = renderHook(() => withHybrid({
            providerConfigs: [provider()],
            appendMessage: store.appendMessage,
            patchMessage: store.patchMessage,
            hybridEnabled: true,
        }));

        await act(async () => {
            await result.current.runGroupThread({ memberIds: ['b1'] }, 'analyze btc', [bots2[0]]);
        });
        expect(streamMock).toHaveBeenCalledTimes(1);
        expect(result.current.isRunning).toBe(false);
    });
});
