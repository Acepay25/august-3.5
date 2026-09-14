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
import { sendChatRequest } from '../services/providers/GenericProviderService';
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
