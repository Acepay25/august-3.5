/**
 * The dev-proxy routing guard (audit crosscheck 2026-09-15 §4.5):
 * /__provider_proxy only exists in the vite DEV server's configureServer.
 * A packaged Capacitor WebView reports hostname 'localhost' too, so the old
 * hostname-only check sent production mobile provider calls into a 404
 * dead-end. The guard must require DEV (or tests would stop exercising the
 * proxy branch — jsdom's hostname is 'localhost' and vitest runs with DEV).
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { readWireBody, usesDevProviderProxy } from '../services/providers/GenericProviderService';

describe('usesDevProviderProxy', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('routes through the dev proxy on a loopback host in DEV', () => {
        expect(window.location.hostname).toBe('localhost');
        expect(usesDevProviderProxy()).toBe(true);
    });

    it('never targets the dev-only middleware in a production build', () => {
        vi.stubEnv('DEV', false);
        // Same hostname as a packaged Capacitor WebView — the guard must
        // fall through to the direct-call branches instead of 404'ing.
        expect(usesDevProviderProxy()).toBe(false);
    });
});

/**
 * The proxy hands the provider's own JSON back untouched, and TWO call paths
 * (the string request and the tool-capable turn) read it. They had already
 * drifted: the turn path passed an array `message.content` straight through as
 * `text` while the request path joined its text parts. These cases pin the one
 * reader both now use, on the two shapes where the drift was visible.
 */
describe('readWireBody', () => {
    it('chat_completions: an array content is joined into one answer', () => {
        const body = readWireBody('chat_completions', {
            choices: [{ message: { content: [{ type: 'text', text: 'Bias ' }, { type: 'text', text: 'long.' }] } }],
        });
        expect(body.text).toBe('Bias \nlong.');
    });

    it('chat_completions: an inline think block is reasoning, never the answer', () => {
        const body = readWireBody('chat_completions', {
            choices: [{ message: { content: 'Bias <think>the sweep took the lows</think>long.' } }],
        });
        expect(body.text).toContain('Bias');
        expect(body.text).not.toContain('sweep took the lows');
        expect(body.reasoning).toContain('sweep took the lows');
    });

    it('messages: text blocks are the answer, thinking blocks are the reasoning', () => {
        const body = readWireBody('messages', {
            content: [
                { type: 'thinking', thinking: 'wait for the retest' },
                { type: 'text', text: 'Long above 111k.' },
            ],
        });
        expect(body.text).toBe('Long above 111k.');
        expect(body.reasoning).toBe('wait for the retest');
    });

    it('responses: output_text is the answer, a reasoning item is the reasoning', () => {
        const body = readWireBody('responses', {
            output_text: 'Hold the range.',
            output: [{ type: 'reasoning', content: [{ type: 'output_text', text: 'the range is mid' }] }],
        });
        expect(body.text).toBe('Hold the range.');
        expect(body.reasoning).toBe('the range is mid');
    });

    it('a reasoning string the proxy itself reported beats the body parse', () => {
        const body = readWireBody('messages', {
            content: [{ type: 'thinking', thinking: 'from the body' }, { type: 'text', text: 'answer' }],
        }, 'from the proxy');
        expect(body.reasoning).toBe('from the proxy');
    });
});
