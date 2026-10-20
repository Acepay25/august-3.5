/**
 * The REAL error — not the app's canned sentence.
 *
 * The transport reached the provider, the provider failed, and the failure had
 * a cause: "fetch failed" on top, "getaddrinfo ENOTFOUND api.example.com"
 * underneath. The app threw away the cause and kept only its own advice —
 * "could not reach the server. Check the base URL and your connection" — so
 * the trader was told a guess and never the fact. Worse, the dock wrote that
 * guess into the ANSWER field, so the transcript showed the app talking as
 * though the seat had said it, and the bot learned it as its own reply.
 *
 * These three claims, each with a way to be quietly false:
 *
 *  1. THE CAUSE SURFACES. Through the public transport, so the claim is about
 *     what a trader actually sees, not about a helper in isolation.
 *  2. A FAILED TURN IS NOT AN ANSWER. The row renders the error in the
 *     error's own colour, and the answer body does not stand in for it.
 *  3. THE DOCK DOES NOT PUT A FAILURE IN THE TEXT FIELD. The write is the
 *     place the bug lived, so it is pinned there too.
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';

// jsdom's hostname is 'localhost', which routes the transport through the dev
// /__provider_proxy branch — force a non-local host so the DIRECT SDK path runs.
const originalLocation = window.location;
Object.defineProperty(window, 'location', {
    value: { ...originalLocation, hostname: 'august.test' },
    writable: true,
});

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));
vi.mock('openai', () => ({
    default: class FakeOpenAI {
        chat = { completions: { create: (...args: unknown[]) => createMock(...args) } };
    }
}));

import { sendChatRequest } from '../services/providers/GenericProviderService';
import ChatTranscriptRow from '../components/shared/ChatTranscriptRow';
import type { ProviderConfig } from '../types/provider';

const config = (over: Partial<ProviderConfig> = {}): ProviderConfig => ({
    id: 'p1',
    name: 'Kilocode',
    baseUrl: 'https://api.kilocode.ai/v1',
    apiKey: 'sk-test',
    apiFormat: 'chat_completions',
    selectedModel: 'some-model',
    models: ['some-model'],
    isEnabled: true,
    ...over,
} as ProviderConfig);

/** What Node's fetch actually throws when a host does not resolve: the
 *  reason is in `cause`, and the top-level message says nothing. */
const networkError = (): Error => Object.assign(new TypeError('fetch failed'), {
    cause: Object.assign(
        new Error('getaddrinfo ENOTFOUND api.kilocode.ai'),
        { code: 'ENOTFOUND' },
    ),
});

const thrown = async (): Promise<string> => {
    try {
        await sendChatRequest(config(), [{ role: 'user', content: 'hi' }]);
    } catch (e) {
        return e instanceof Error ? e.message : String(e);
    }
    throw new Error('the request was expected to fail');
};

describe('the transport reports the REAL error', () => {
    it('names the cause, not just the app\'s advice', async () => {
        createMock.mockReset();
        createMock.mockRejectedValue(networkError());
        const message = await thrown();
        // The host that did not resolve, and the code that says why.
        expect(message).toContain('ENOTFOUND');
        expect(message).toContain('getaddrinfo ENOTFOUND api.kilocode.ai');
    });

    it('keeps the advice, after the fact', async () => {
        createMock.mockReset();
        createMock.mockRejectedValue(networkError());
        const message = await thrown();
        // The hint was never wrong — it just was not the whole story. It
        // stays, and the fact comes FIRST.
        expect(message).toContain('could not reach the server');
        expect(message.indexOf('ENOTFOUND')).toBeLessThan(message.indexOf('could not reach the server'));
    });

    it('a connection refused is the refused connection', async () => {
        createMock.mockReset();
        createMock.mockRejectedValue(Object.assign(new TypeError('fetch failed'), {
            cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:11434'), { code: 'ECONNREFUSED' }),
        }));
        const message = await thrown();
        expect(message).toContain('ECONNREFUSED');
        expect(message).toContain('127.0.0.1:11434');
    });

    it('a provider that said WHY still leads with why', async () => {
        createMock.mockReset();
        createMock.mockRejectedValue(Object.assign(new Error('HTTP 401'), { status: 401 }));
        const message = await thrown();
        expect(message).toContain('HTTP 401');
    });
});

describe('a failed turn is not an answer', () => {
    it('renders the error in the error\'s own row', () => {
        render(
            <ChatTranscriptRow
                row={{
                    id: 'e1', role: 'ai', text: '',
                    error: 'Kilocode: fetch failed · ENOTFOUND: getaddrinfo ENOTFOUND api.kilocode.ai — could not reach the server.',
                }}
            />,
        );
        const row = screen.getByTestId('chat-error-row');
        expect(row.textContent).toContain('ENOTFOUND');
        // The failure is labelled as one.
        expect(row.textContent).toContain('request failed');
    });

    it('does not claim a speaker for a turn nobody spoke', () => {
        render(
            <ChatTranscriptRow
                row={{ id: 'e1', role: 'ai', text: '', error: 'Kilocode: fetch failed' }}
            />,
        );
        // "desk" would read as though the desk had said it.
        expect(screen.getByTestId('chat-error-row')).toBeTruthy();
        expect(document.body.textContent).not.toContain('desk');
    });
});

describe('the dock does not put a failure in the text field', () => {
    it('the catch writes the error field', () => {
        const source = readFileSync('services/trade/chatTurnRunner.ts', 'utf8');
        expect(source).toMatch(/error: message/);
        // The old shape wrote the app's canned sentence into the ANSWER.
        expect(source).not.toMatch(/text: `The chart copilot could not answer/);
    });

    it('the row model carries the error', () => {
        expect(readFileSync('types/message.ts', 'utf8')).toMatch(/error\?: string;/);
        expect(readFileSync('components/shared/ChatTranscriptRow.tsx', 'utf8')).toMatch(/error\?: string;/);
    });
});

describe('the default context window is 1M', () => {
    it('the constant says so', () => {
        const source = readFileSync('utils/contextWindow.ts', 'utf8');
        expect(source).toMatch(/DEFAULT_CONTEXT_WINDOW_TOKENS = 1_000_000;/);
    });

    it('the Settings field says the same number the app uses', () => {
        // The field's placeholder used to read "e.g. 131072" — a number that
        // reads like the default and is not it. It must agree with the
        // constant, or the trader types the placeholder in.
        const source = readFileSync('components/settings/ProviderManager.tsx', 'utf8');
        expect(source).toMatch(/placeholder="1,000,000"/);
    });
});
