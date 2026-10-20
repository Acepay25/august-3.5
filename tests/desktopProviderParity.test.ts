/**
 * Desktop provider-bridge parity (v1.0.23 A1): the composer's reasoning effort
 * must reach the Electron main-process request exactly like it reaches the
 * vite dev proxy. Regression roots: main.cjs substituted `reasoning` into
 * `text` on empty content (the renderer's pure-echo guard then fired a FALSE
 * "streamed only its reasoning" error that localhost never showed), and the
 * providerChat IPC payload carried no reasoningPatch, so thinking-default
 * gateways (GLM/DeepSeek/xAI routes) ignored off/low on desktop while
 * localhost disabled thinking. These tests pin the payload side; the
 * collapse removal is main.cjs (typecheck:scripts-covered, human-reviewed).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendChatRequest, streamChatRequest } from '../services/providers/GenericProviderService';
import type { ProviderConfig } from '../types/provider';

const baseConfig = (over: Partial<ProviderConfig>): ProviderConfig => ({
    id: 'deepseek',
    name: 'DeepSeek',
    apiKey: 'sk-test',
    baseUrl: 'https://api.deepseek.com',
    apiFormat: 'chat_completions',
    isEnabled: true,
    isBuiltIn: false,
    models: ['deepseek-chat'],
    selectedModel: 'deepseek-chat',
    ...over,
});

const messages = [{ role: 'user' as const, content: 'hi' }];

type BridgeChatFn = NonNullable<NonNullable<Window['electronAPI']>['providerChat']>;
type BridgePayload = Parameters<BridgeChatFn>[0];

let providerChat: BridgeChatFn;
let calls: BridgePayload[];

beforeEach(() => {
    calls = [];
    providerChat = vi.fn(async (request: Parameters<BridgeChatFn>[0]) => {
        calls.push(request);
        return { ok: true, text: 'an answer' } as Awaited<ReturnType<BridgeChatFn>>;
    }) as unknown as BridgeChatFn;
    window.electronAPI = {
        isElectron: true,
        providerChat,
        cancelProviderChat: vi.fn(async () => true),
    };
});

afterEach(() => {
    window.electronAPI = undefined;
});

describe('providerChat IPC reasoning-effort parity', () => {
    it('sends the effort-derived thinking-disable patch at off (deepseek route)', async () => {
        const text = await sendChatRequest(baseConfig({}), messages, { reasoningEffort: 'off' });
        expect(text).toBe('an answer');
        expect(calls).toHaveLength(1);
        expect(calls[0].reasoningPatch).toEqual({ thinking: { type: 'disabled' } });
    });

    it('sends no patch at effort auto (fail-closed — same as the vite proxy)', async () => {
        await sendChatRequest(baseConfig({}), messages, {});
        expect(calls[0].reasoningPatch).toBeUndefined();
    });

    it('maps responses-format effort to reasoning.effort over the bridge', async () => {
        const cfg = baseConfig({
            id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1',
            apiFormat: 'responses', models: ['gpt-5'], selectedModel: 'gpt-5',
        });
        await sendChatRequest(cfg, messages, { reasoningEffort: 'high' });
        expect(calls[0].reasoningPatch).toEqual({ reasoning: { effort: 'high' } });
    });
});

/**
 * Desktop LIVE streaming (v1.0.24): streamChatRequest must yield deltas as
 * the bridge pushes them, forward reasoning to onReasoning (the AnalyzedRow
 * timer starts on the first thought), deliver native tool calls via
 * onStreamToolCalls (the old short-circuit dropped them), and still paint a
 * whole answer when the provider ignores stream:true.
 */
describe('streamChatRequest over the chunk bridge', () => {
    type Chunk = { requestId: string; type: 'text' | 'reasoning'; delta: string };
    let chunkCb: ((chunk: Chunk) => void) | null;
    const collect = async (gen: AsyncGenerator<string>): Promise<string[]> => {
        const out: string[] = [];
        for await (const d of gen) out.push(d);
        return out;
    };

    beforeEach(() => {
        chunkCb = null;
        window.electronAPI = {
            isElectron: true,
            providerChat: vi.fn(async (request: BridgePayload) => {
                calls.push(request);
                const rid = request.requestId as string;
                // Simulate main.cjs pushing SSE deltas before resolving.
                chunkCb?.({ requestId: rid, type: 'reasoning', delta: 'think A' });
                chunkCb?.({ requestId: rid, type: 'reasoning', delta: 'think B' });
                chunkCb?.({ requestId: rid, type: 'text', delta: 'Hello ' });
                chunkCb?.({ requestId: rid, type: 'text', delta: 'world' });
                return { ok: true, text: 'Hello world', reasoning: 'think Athink B' };
            }) as unknown as BridgeChatFn,
            cancelProviderChat: vi.fn(async () => true),
            onProviderChunk: vi.fn((cb: (chunk: Chunk) => void) => {
                chunkCb = cb;
                return () => { chunkCb = null; };
            }) as never,
        };
    });

    it('yields text deltas incrementally and forwards reasoning live', async () => {
        const reasoning: string[] = [];
        const deltas = await collect(streamChatRequest(baseConfig({}), messages, {
            onReasoning: chunk => { reasoning.push(chunk); },
        }));
        expect(deltas).toEqual(['Hello ', 'world']);
        expect(reasoning).toEqual(['think A', 'think B']);
        expect(calls[0].stream).toBe(true);
    });

    it('delivers native tool calls through onStreamToolCalls', async () => {
        window.electronAPI!.providerChat = vi.fn(async (request: BridgePayload) => {
            calls.push(request);
            return {
                ok: true, text: '', toolCalls: [{ id: 'call_1', name: 'get_market_packet', arguments: { symbol: 'ETHUSDT' } }],
            };
        }) as unknown as BridgeChatFn;
        let delivered: Array<{ id: string; name: string }> = [];
        await collect(streamChatRequest(baseConfig({}), messages, {
            onStreamToolCalls: c => { delivered = c; },
        }));
        expect(delivered).toEqual([{ id: 'call_1', name: 'get_market_packet', arguments: { symbol: 'ETHUSDT' } }]);
    });

    it('paints the whole answer when the provider ignored stream:true', async () => {
        window.electronAPI!.providerChat = vi.fn(async (request: BridgePayload) => {
            calls.push(request);
            return { ok: true, text: 'buffered answer' };
        }) as unknown as BridgeChatFn;
        const deltas = await collect(streamChatRequest(baseConfig({}), messages, {}));
        expect(deltas.join('')).toBe('buffered answer');
    });

    it('ignores chunks from a different requestId', async () => {
        const original = window.electronAPI!.providerChat!;
        window.electronAPI!.providerChat = vi.fn(async (request: BridgePayload) => {
            const promise = original(request);
            chunkCb?.({ requestId: 'someone-elses-call', type: 'text', delta: 'LEAK' });
            return promise;
        }) as unknown as BridgeChatFn;
        const deltas = await collect(streamChatRequest(baseConfig({}), messages, {}));
        expect(deltas.join('')).toBe('Hello world');
    });

    it('routes a jsonMode stream through the BUFFERED bridge (chunk payload cannot carry jsonMode)', async () => {
        // The chunk bridge's payload has NO jsonMode/jsonSchema field, so
        // main.cjs's streamRequested() jsonMode guard can never see the JSON
        // request — a chunk-bridged jsonMode call would silently drop
        // constrained decoding on desktop while web/proxy streams honored it.
        // The buffered sendChatRequest path DOES forward jsonMode, and the
        // generator contract holds (full text yielded once).
        const deltas = await collect(streamChatRequest(baseConfig({}), messages, { jsonMode: true }));
        expect(calls).toHaveLength(1);
        expect(calls[0].stream).toBeUndefined();
        expect(calls[0].jsonMode).toBe(true);
        expect(deltas).toEqual(['Hello world']);
    });
});

// ─── Automatic recovery from a context-window rejection ─────────────────────
// The one error class where the provider states the number the app needed. A
// 400 that says "maximum context length is 4096 tokens" must not surface as a
// dead turn: the limit is remembered, the history is compacted to it, and the
// request is made again. A rejection that is NOT about the window must not be
// retried at all — rewriting the trader's transcript for a rate limit would be
// its own bug.

import { measuredContextWindow, resetMeasuredContextWindows, resolveContextWindow } from '../utils/contextWindow';

const longConversation = (): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> => {
    const pad = 'x'.repeat(2_400);
    const out: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
        { role: 'system', content: 'the mandate' },
    ];
    for (let i = 0; i < 4; i++) {
        out.push({ role: 'user', content: `${pad} question ${i}` });
        out.push({ role: 'assistant', content: `${pad} answer ${i}` });
    }
    out.push({ role: 'user', content: 'and now?' });
    return out;
};

describe('context-window rejection recovery over the desktop bridge', () => {
    const windowConfig = baseConfig({ id: 'p1', name: 'Provider One', selectedModel: 'model-a', models: ['model-a'] });

    beforeEach(() => { resetMeasuredContextWindows(); });

    it('learns the limit, compacts and retries once', async () => {
        let attempt = 0;
        providerChat = vi.fn(async (request: BridgePayload) => {
            calls.push(request);
            attempt += 1;
            if (attempt === 1) {
                return {
                    ok: false,
                    status: 400,
                    message: 'Maximum context length is 4096 tokens. However, your messages resulted in 9000 tokens.',
                } as unknown as Awaited<ReturnType<BridgeChatFn>>;
            }
            return { ok: true, text: 'an answer after compaction' } as Awaited<ReturnType<BridgeChatFn>>;
        }) as unknown as BridgeChatFn;
        window.electronAPI = { isElectron: true, providerChat, cancelProviderChat: vi.fn(async () => true) };

        const lines: string[] = [];
        const text = await sendChatRequest(windowConfig, longConversation(), { onContextCompact: l => lines.push(l) });

        expect(text).toBe('an answer after compaction');
        expect(calls).toHaveLength(2);
        const retried = calls[1].messages as { content?: string }[];
        expect(retried.length).toBeLessThan((calls[0].messages as unknown[]).length);
        expect(lines.join('\n')).toMatch(/COMPACTED FOR THE CONTEXT WINDOW/);
        // The lesson persists for the rest of the session, and it WINS over the
        // 1M assumption that let the request be sent in the first place.
        expect(measuredContextWindow('p1', 'model-a')).toBe(4_096);
        expect(resolveContextWindow(windowConfig)).toMatchObject({ tokens: 4_096, source: 'measured' });
    });

    it('does not retry a 400 that is not about the window', async () => {
        providerChat = vi.fn(async (request: BridgePayload) => {
            calls.push(request);
            return { ok: false, status: 400, message: 'The requested model does not exist.' } as unknown as Awaited<ReturnType<BridgeChatFn>>;
        }) as unknown as BridgeChatFn;
        window.electronAPI = { isElectron: true, providerChat, cancelProviderChat: vi.fn(async () => true) };

        await expect(sendChatRequest(windowConfig, longConversation(), {})).rejects.toThrow(/does not exist/);
        expect(calls).toHaveLength(1);
        expect(measuredContextWindow('p1', 'model-a')).toBeNull();
    });

    it('does not retry when compaction would cut nothing', async () => {
        // Three short messages fit any stated window. Retrying identical bytes
        // against an identical limit only delays the error the trader needs.
        providerChat = vi.fn(async (request: BridgePayload) => {
            calls.push(request);
            return { ok: false, status: 400, message: "This model's maximum context length is 128000 tokens. However, your request contains 400000 input tokens and 400000 cached tokens. Please reduce the number of tokens in your prompt." } as unknown as Awaited<ReturnType<BridgeChatFn>>;
        }) as unknown as BridgeChatFn;
        window.electronAPI = { isElectron: true, providerChat, cancelProviderChat: vi.fn(async () => true) };

        await expect(sendChatRequest(windowConfig, [{ role: 'user', content: 'hi' }], {})).rejects.toThrow(/128000/);
        expect(calls).toHaveLength(1);
    });

    it('never retries a stream once a delta has been painted', async () => {
        // Re-answering into a bubble that already shows text would append a
        // SECOND reply. The guard is on "anything was yielded", not on the
        // error's shape, so a mid-stream ceiling stays a single honest failure.
        type Chunk = { requestId: string; type: 'text' | 'reasoning'; delta: string };
        let bridgeChunk: ((chunk: Chunk) => void) | null = null;
        let attempt = 0;
        window.electronAPI = {
            isElectron: true,
            providerChat: vi.fn(async (request: BridgePayload) => {
                calls.push(request);
                attempt += 1;
                const rid = request.requestId as string;
                if (attempt === 1) {
                    bridgeChunk?.({ requestId: rid, type: 'text', delta: 'partial ' });
                    return {
                        ok: false,
                        status: 400,
                        message: 'Maximum context length is 4096 tokens. However, your messages resulted in 9000 tokens.',
                    } as unknown as Awaited<ReturnType<BridgeChatFn>>;
                }
                return { ok: true, text: 'second answer' } as unknown as Awaited<ReturnType<BridgeChatFn>>;
            }) as unknown as BridgeChatFn,
            cancelProviderChat: vi.fn(async () => true),
            onProviderChunk: vi.fn((cb: (chunk: Chunk) => void) => {
                bridgeChunk = cb;
                return () => { bridgeChunk = null; };
            }) as never,
        };

        const deltas: string[] = [];
        await expect((async () => {
            for await (const d of streamChatRequest(windowConfig, longConversation(), {})) deltas.push(d);
        })()).rejects.toThrow(/context length/i);
        expect(calls).toHaveLength(1);
        expect(deltas.join('')).toMatch(/partial/);
    });
});
