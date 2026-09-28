import { describe, it, expect, vi } from 'vitest';

// The response-format / tools degrade ladder. Nested try/catch fallbacks stranded
// the tools rung behind a `response_format` guard that stops holding after the
// first step — so the plain jsonMode + tools shape (every desk-tool seat) died
// with two 400s instead of dropping the tools. These pin the whole ladder, rung
// by rung, including the shapes the old chain could not reach.

// jsdom's hostname is 'localhost', which routes sendChatRequest through the
// dev /__provider_proxy branch — force a non-local host so the DIRECT SDK
// path (the one under test) runs. Same pattern as providerJsonSchema.test.ts.
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
// `as const` on the discriminator: without it the object literal widens
// `type` to `string`, and the service's tool array is typed
// `{ type: "function"; ... }` — so passing a plain literal is a type error
// that says nothing about the behaviour this file is pinning.
//
// `description` is required by the service's own tool type and was missing
// here, which is the same class of mistake: a fixture that does not match the
// contract it is supposed to exercise.
const tools = [{
    type: 'function' as const,
    function: { name: 'market_price', description: 'Current price for a symbol.', parameters: { type: 'object' } },
}];

interface Body {
    response_format?: { type?: string };
    tools?: unknown;
    tool_choice?: unknown;
}
const bodyOf = (call: number): Body => createMock.mock.calls[call]?.[0] as Body;

describe('response-format / tools degrade ladder', () => {
    // There is deliberately NO beforeEach/afterEach reset of `createMock`.
    //
    // On vitest 4.1.10, resetting a `vi.hoisted()` mock from a hook is
    // unreliable in two separate ways, and both look like product bugs:
    //
    //  - from `beforeEach`, the next `mockRejectedValue` THROWS AT ITS OWN CALL
    //    SITE. The Error's only stack frame is where it was constructed, so the
    //    report points at `httpError(401)` rather than at the hook.
    //  - from `afterEach`, the `Once` queue leaks into the following test, so
    //    call counts drift. CI caught it as
    //    `expected "vi.fn()" to be called 3 times, but got 2 times`.
    //
    // So each test resets at its own first line instead. That is the one form
    // that has proven correct, and it also makes each test's starting state
    // explicit where it is chosen rather than inherited.
    it('a healthy gateway is asked exactly once, with everything it was offered', async () => {
        createMock.mockReset();
        createMock.mockResolvedValue(okBody);
        await sendChatRequest(config(), [{ role: 'user', content: 'hi' }], { jsonMode: true, tools });
        expect(createMock).toHaveBeenCalledTimes(1);
        expect(bodyOf(0).response_format).toEqual({ type: 'json_object' });
        expect(bodyOf(0).tools).toEqual(tools);
    });

    it('jsonMode + tools (no schema) reaches the tools-free rung — the desk-tool seat', async () => {
        createMock.mockReset();
        // This is the shape the nested chain could never degrade: step one
        // deletes response_format, so the guard on the next rung was already
        // false and the run threw instead of falling back to the text protocol.
        createMock
            .mockRejectedValueOnce(httpError(400))
            .mockRejectedValueOnce(httpError(400))
            .mockResolvedValue(okBody);
        const text = await sendChatRequest(config(), [{ role: 'user', content: 'hi' }], { jsonMode: true, tools });
        expect(text).toContain('ok');
        expect(createMock).toHaveBeenCalledTimes(3);
        expect(bodyOf(0).response_format).toEqual({ type: 'json_object' });
        expect(bodyOf(1).response_format).toBeUndefined();
        expect(bodyOf(1).tools).toEqual(tools);
        expect(bodyOf(2).response_format).toBeUndefined();
        expect(bodyOf(2).tools).toBeUndefined();
        expect(bodyOf(2).tool_choice).toBeUndefined();
    });

    it('runs the full four-rung ladder for constrained json_schema + tools', async () => {
        createMock.mockReset();
        createMock
            .mockRejectedValueOnce(httpError(400))
            .mockRejectedValueOnce(httpError(422))
            .mockRejectedValueOnce(httpError(400))
            .mockResolvedValue(okBody);
        await sendChatRequest(config(), [{ role: 'user', content: 'hi' }], {
            jsonMode: true,
            jsonSchema: { name: 'x', schema: { type: 'object' } },
            tools,
        });
        expect(createMock).toHaveBeenCalledTimes(4);
        expect(bodyOf(0).response_format?.type).toBe('json_schema');
        expect(bodyOf(1).response_format).toEqual({ type: 'json_object' });
        expect(bodyOf(2).response_format).toBeUndefined();
        expect(bodyOf(2).tools).toEqual(tools);
        expect(bodyOf(3).response_format).toBeUndefined();
        expect(bodyOf(3).tools).toBeUndefined();
    });

    it('drops the tools after a 400 with jsonMode off (unchanged behaviour)', async () => {
        createMock.mockReset();
        createMock.mockRejectedValueOnce(httpError(400)).mockResolvedValue(okBody);
        await sendChatRequest(config(), [{ role: 'user', content: 'hi' }], { tools });
        expect(createMock).toHaveBeenCalledTimes(2);
        expect(bodyOf(1).tools).toBeUndefined();
    });

    it('gives up after the last rung and reports the refusal it was given', async () => {
        createMock.mockReset();
        createMock
            .mockRejectedValueOnce(httpError(400))
            .mockRejectedValueOnce(httpError(400))
            .mockRejectedValueOnce(httpError(400));
        // toFriendlyProviderError owns the wording — the raw body never surfaces.
        await expect(
            sendChatRequest(config(), [{ role: 'user', content: 'hi' }], { jsonMode: true, tools }),
        ).rejects.toThrow(/request failed \(400\)/);
        // Three bodies offered, no fourth attempt with nothing left to remove.
        expect(createMock).toHaveBeenCalledTimes(3);
    });

    it('a non-refusal status does not walk the ladder', async () => {
        createMock.mockReset();
        createMock.mockRejectedValue(httpError(401));
        let refused = false;
        try {
            await sendChatRequest(config(), [{ role: 'user', content: 'hi' }], { jsonMode: true, tools });
        } catch {
            refused = true;
        }
        expect(refused).toBe(true);
        // A 401 is an auth failure, not "this body was refused" — dropping the
        // schema or the tools cannot fix it, so no further body is offered.
        // (The wording of the thrown error is toFriendlyProviderError's own
        // contract and is pinned by its own suite.)
        expect(createMock).toHaveBeenCalledTimes(1);
    });

    // ── TEMPORARY DIAGNOSTIC ────────────────────────────────────────────────
    // Three of the rung tests above fail in CI but pass on Node 22 AND Node 24,
    // single-file and in the full parallel suite, with and without coverage.
    // The only remaining difference from CI is the platform.
    //
    // Rather than guess, these record WHAT THE LADDER ACTUALLY OFFERED and
    // print it. Console output is not intercepted (see vitest.config.ts), so
    // these lines land in the CI log verbatim. The failing assertion on its own
    // says only "3 times, but got 2" — it does not say which rung vanished.
    // Delete this block once the cause is fixed.
    const record = (): unknown[] => createMock.mock.calls.map((c, i) => {
        const b = c[0] as { response_format?: { type?: string }; tools?: unknown };
        return { n: i, rf: b?.response_format?.type ?? null, tools: b?.tools ? 'yes' : 'no' };
    });

    it('DIAG A: jsonMode + tools, two 400s then ok', async () => {
        createMock.mockReset();
        createMock.mockRejectedValueOnce(httpError(400)).mockRejectedValueOnce(httpError(400)).mockResolvedValue(okBody);
        try { await sendChatRequest(config(), [{ role: 'user', content: 'hi' }], { jsonMode: true, tools }); } catch { /* below */ }
        console.log('LADDER-DIAG-A', JSON.stringify(record()));
        expect(true).toBe(true);
    });

    it('DIAG B: json_schema + tools, 400/422/400 then ok', async () => {
        createMock.mockReset();
        createMock.mockRejectedValueOnce(httpError(400)).mockRejectedValueOnce(httpError(422))
            .mockRejectedValueOnce(httpError(400)).mockResolvedValue(okBody);
        try {
            await sendChatRequest(config(), [{ role: 'user', content: 'hi' }], {
                jsonMode: true, jsonSchema: { name: 'x', schema: { type: 'object' } }, tools,
            });
        } catch { /* below */ }
        console.log('LADDER-DIAG-B', JSON.stringify(record()));
        expect(true).toBe(true);
    });

    it('DIAG C: jsonMode + tools, three 400s then give up', async () => {
        createMock.mockReset();
        createMock.mockRejectedValueOnce(httpError(400)).mockRejectedValueOnce(httpError(400))
            .mockRejectedValueOnce(httpError(400));
        try { await sendChatRequest(config(), [{ role: 'user', content: 'hi' }], { jsonMode: true, tools }); } catch { /* below */ }
        console.log('LADDER-DIAG-C', JSON.stringify(record()));
        expect(true).toBe(true);
    });
});
