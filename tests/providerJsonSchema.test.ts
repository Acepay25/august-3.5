import { describe, it, expect, vi, beforeEach } from 'vitest';

// json_schema constrained decoding (Batch 3): capability gating + the
// degrade chain json_schema → json_object → none. The OpenAI SDK is mocked;
// only the request BODIES matter here.

// jsdom's hostname is 'localhost', which routes sendChatRequest through the
// dev /__provider_proxy branch — force a non-local host so the DIRECT SDK
// path (the one under test) runs. Same pattern as auditFixes/warm tests.
const originalLocation = window.location;
Object.defineProperty(window, 'location', {
    value: { ...originalLocation, hostname: 'august.test' },
    writable: true,
});

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));
vi.mock('openai', () => ({
    default: class FakeOpenAI {
        chat = { completions: { create: (...args: unknown[]) => createMock(...args) } };
    },
}));

import { sendChatRequest } from '../services/providers/GenericProviderService';
import { detectWireCapabilities } from '../services/providers/reasoningControls';
import type { ProviderConfig } from '../types/provider';

const config = (over: Partial<ProviderConfig> = {}): ProviderConfig => ({
    id: 'p1',
    name: 'P1',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'sk-test',
    apiFormat: 'chat_completions',
    selectedModel: 'gpt-5.6',
    models: ['gpt-5.6'],
    isEnabled: true,
    ...over,
} as ProviderConfig);

const okBody = { choices: [{ message: { content: '{"ok":true}' } }] };
const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });

const paramsOf = (call: number) => createMock.mock.calls[call]?.[0] as { response_format?: Record<string, unknown> };

describe('detectWireCapabilities — jsonSchema class', () => {
    it('chat_completions on a verified host', () => {
        expect(detectWireCapabilities(config()).jsonSchema).toBe(true);
    });
    it('non-chat formats never claim it', () => {
        expect(detectWireCapabilities(config({ apiFormat: 'messages' })).jsonSchema).toBe(false);
        expect(detectWireCapabilities(config({ apiFormat: 'responses' })).jsonSchema).toBe(false);
    });
    it('unknown gateways default OFF…', () => {
        expect(detectWireCapabilities(config({ baseUrl: 'https://gateway.example.com/v1' })).jsonSchema).toBe(false);
    });
    it('…until the user certifies them, and a user can also veto a host', () => {
        expect(detectWireCapabilities(config({ baseUrl: 'https://gateway.example.com/v1', jsonSchemaCapable: true })).jsonSchema).toBe(true);
        expect(detectWireCapabilities(config({ jsonSchemaCapable: false })).jsonSchema).toBe(false);
    });
});

describe('json_schema request bodies', () => {
    beforeEach(() => createMock.mockReset());

    it('sends constrained json_schema when requested on a capable host', async () => {
        createMock.mockResolvedValue(okBody);
        await sendChatRequest(config(), [{ role: 'user', content: 'hi' }], {
            jsonMode: true,
            jsonSchema: { name: 'global_memory', schema: { type: 'object', properties: { ok: { type: 'boolean' } } } },
        });
        expect(createMock).toHaveBeenCalledTimes(1);
        const rf = paramsOf(0).response_format as { type: string; json_schema?: { name: string; strict: boolean } };
        expect(rf.type).toBe('json_schema');
        expect(rf.json_schema?.name).toBe('global_memory');
        expect(rf.json_schema?.strict).toBe(false);
    });

    it('degrades json_schema → json_object on a 400', async () => {
        createMock
            .mockRejectedValueOnce(httpError(400))
            .mockResolvedValue(okBody);
        const text = await sendChatRequest(config(), [{ role: 'user', content: 'hi' }], {
            jsonMode: true,
            jsonSchema: { name: 'x', schema: { type: 'object' } },
        });
        expect(text).toContain('ok');
        expect(createMock).toHaveBeenCalledTimes(2);
        expect(paramsOf(1).response_format).toEqual({ type: 'json_object' });
    });

    it('degrades json_schema → NO response_format when jsonMode was not asked', async () => {
        createMock
            .mockRejectedValueOnce(httpError(400))
            .mockResolvedValue(okBody);
        await sendChatRequest(config(), [{ role: 'user', content: 'hi' }], {
            jsonSchema: { name: 'x', schema: { type: 'object' } },
        });
        expect(createMock).toHaveBeenCalledTimes(2);
        expect(paramsOf(1).response_format).toBeUndefined();
    });

    it('two-stage chain: json_schema → json_object → none survives a second 400', async () => {
        createMock
            .mockRejectedValueOnce(httpError(400))
            .mockRejectedValueOnce(httpError(400))
            .mockResolvedValue(okBody);
        await sendChatRequest(config(), [{ role: 'user', content: 'hi' }], {
            jsonMode: true,
            jsonSchema: { name: 'x', schema: { type: 'object' } },
        });
        expect(createMock).toHaveBeenCalledTimes(3);
        expect(paramsOf(2).response_format).toBeUndefined();
    });

    it('never leaks json_schema to an uncertified gateway (json_object only)', async () => {
        createMock.mockResolvedValue(okBody);
        await sendChatRequest(config({ baseUrl: 'https://gateway.example.com/v1' }), [{ role: 'user', content: 'hi' }], {
            jsonMode: true,
            jsonSchema: { name: 'x', schema: { type: 'object' } },
        });
        expect(createMock).toHaveBeenCalledTimes(1);
        expect(paramsOf(0).response_format).toEqual({ type: 'json_object' });
    });
});
