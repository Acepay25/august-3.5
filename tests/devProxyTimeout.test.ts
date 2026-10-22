/**
 * The dev-proxy transport is capped like the transport it stands in for.
 *
 * Every other request path in `GenericProviderService` passes a timeout signal —
 * `withTimeoutSignal` for a non-streaming call (120 s), `withStreamTimeoutSignal`
 * for a stream (300 s, because a reasoning model streams its chain of thought
 * before its answer). The `/__provider_proxy` branches were the two that did not,
 * so a wedged dev request held the pipeline open until the trader pressed Stop —
 * and in dev that is the ONLY way out.
 *
 * The assertion is on the signal the request was actually handed, not on a wall
 * clock: `AbortSignal.timeout` is spied so the budget is named, and the caller's
 * own abort is checked to still reach the fetch — combining the two signals must
 * not replace one with the other.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendChatRequest, sendChatTurn } from '../services/providers/GenericProviderService';
import type { ProviderConfig } from '../types/provider';

const config = {
    id: 'p1',
    name: 'Dev',
    baseUrl: 'https://api.dev.invalid/v1',
    apiKey: 'sk-test',
    apiFormat: 'chat_completions',
    selectedModel: 'some-model',
    models: ['some-model'],
    isEnabled: true,
} as ProviderConfig;

const providerBody = JSON.stringify({
    choices: [{ message: { content: 'BTC is holding 111k.' } }],
});

/** The proxy answers with the provider's own body as a string, so a successful
 *  turn is `ok:true` plus `body` — the shape both branches parse. */
const stubFetch = () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: unknown, init: unknown) => {
        calls.push({ url: String(input), init: (init ?? {}) as RequestInit });
        return { ok: true, status: 200, json: async () => ({ ok: true, status: 200, body: providerBody, reasoning: '' }) };
    }));
    return calls;
};

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('the dev-proxy request carries a timeout of its own', () => {
    it('caps a non-streaming proxy request at the non-streaming budget', async () => {
        const calls = stubFetch();
        const timeouts = vi.spyOn(AbortSignal, 'timeout');
        const controller = new AbortController();

        await sendChatRequest(config, [{ role: 'user', content: 'hi' }], { signal: controller.signal });

        const proxy = calls.find(c => c.url.includes('__provider_proxy'));
        expect(proxy, 'the dev-proxy branch never ran, so this test measured nothing').toBeDefined();
        const sent = proxy!.init.signal;
        expect(sent, 'the proxy request was sent with NO signal at all').not.toBeNull();
        // THE FIX: a signal that carries a timeout, not the caller's bare signal.
        expect(sent).not.toBe(controller.signal);
        expect(timeouts.mock.calls.map(c => c[0])).toContain(120_000);
        // And the caller's Stop still reaches the wire.
        expect(sent!.aborted).toBe(false);
        controller.abort();
        expect(sent!.aborted).toBe(true);
    });

    it('caps a streaming proxy turn at the STREAM budget, not the 120 s one', async () => {
        const calls = stubFetch();
        const timeouts = vi.spyOn(AbortSignal, 'timeout');

        await sendChatTurn(config, [{ role: 'user', content: 'hi' }], { signal: undefined });

        const proxy = calls.find(c => c.url.includes('__provider_proxy'));
        expect(proxy, 'the streaming dev-proxy branch never ran').toBeDefined();
        expect(proxy!.init.signal, 'a stream with no timeout signal can hang the turn').not.toBeNull();
        const budgets = timeouts.mock.calls.map(c => c[0]);
        expect(budgets).toContain(300_000);
        expect(budgets, 'a stream cut at 120 s would end a thinking model mid-chain').not.toContain(120_000);
    });
});
