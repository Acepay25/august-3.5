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
