import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import type { AgentBot } from '../services/agents/agentRoster';
import type { ProviderConfig } from '../types/provider';
import type { Message } from '../types';
import { MessageRole } from '../types/enums';

// Bot Mode G1 async half: per-target serial queues, TTL expiry, hop cap,
// sender wake-up notices, and marker stripping on the settled bubble.
// The transport (streamQuickResponse) is mocked — replies are scripted.

const streamQuickResponse = vi.hoisted(() => vi.fn());
vi.mock('../services/providers/GenericAnalysisService', () => ({ streamQuickResponse }));
vi.mock('../services/bots/BotMemoryService', () => ({
    readBotSystemMarkdown: () => null,
    readBotMemoryMarkdown: () => null,
}));

import { useBotMailbox } from '../hooks/useBotMailbox';
import { DM_MAX_HOPS } from '../services/agents/botMailbox';

const bot = (over: Partial<AgentBot> & Pick<AgentBot, 'id' | 'name'>): AgentBot => ({
    providerId: 'gemini', modelId: 'gemini-2.5-pro', avatar: '',
    createdAt: '2026-01-01T00:00:00.000Z', ...over,
} as AgentBot);

const macro = bot({ id: 'b1', name: 'Macro' });
const risk = bot({ id: 'b2', name: 'Risk Bot', providerId: 'openai', modelId: 'gpt-4.1' });

const cfg = (id: string, model: string): ProviderConfig => ({
    id, name: id, isEnabled: true, apiKey: 'k', models: [model], selectedModel: model,
    apiFormat: 'chat_completions', baseUrl: '',
} as ProviderConfig);

const CONFIGS = [cfg('gemini', 'gemini-2.5-pro'), cfg('openai', 'gpt-4.1')];

const envelope = (over: Partial<Parameters<ReturnType<typeof useBotMailbox>['deliverDM']>[0]> = {}) => ({
    id: `env-${Math.random().toString(36).slice(2, 7)}`,
    fromBotId: 'b1', toBotId: 'b2', text: 'size my short?', hop: 0, queuedAt: Date.now(),
    ...over,
});

const setup = (bots: AgentBot[] = [macro, risk]) => {
    const messages: Message[] = [];
    const ref = { current: messages };
    const h = renderHook(() => useBotMailbox({
        bots,
        providerConfigs: CONFIGS,
        username: 'tester',
        messagesRef: ref,
        appendMessage: m => { messages.push(m); },
        patchMessage: (id, patch) => {
            const m = messages.find(x => x.id === id);
            if (m) Object.assign(m, patch);
        },
    }));
    return { h, messages };
};

beforeEach(() => {
    streamQuickResponse.mockReset();
});

describe('useBotMailbox (G1)', () => {
    it('runs the target bot turn and wakes the sender with a reply notice', async () => {
        streamQuickResponse.mockResolvedValue('Size it at 0.5R.');
        const { h, messages } = setup();
        act(() => { h.result.current.deliverDM(envelope(), macro); });
        await waitFor(() => expect(streamQuickResponse).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(messages.some(m => m.role === MessageRole.SYSTEM && m.dmNotice && m.text.includes('Risk Bot replied to your DM'))).toBe(true));

        // The DM itself is visible in the target thread as a dmFrom row.
        expect(messages.some(m => m.role === MessageRole.USER && m.dmFrom && m.text.includes('Macro (teammate DM)'))).toBe(true);
        // The target's reply bubble carries the answer.
        const reply = messages.find(m => m.role === MessageRole.AI && m.text.includes('0.5R'));
        expect(reply).toBeTruthy();
        // The persona system prompt was passed (4th arg).
        const sysArg = String(streamQuickResponse.mock.calls[0][3] ?? '');
        expect(sysArg).toContain('Risk Bot');
        expect(h.result.current.dmActivityCount).toBe(1);
    });

    it('strips DM markers from the settled bubble and delivers the next hop', async () => {
        streamQuickResponse.mockResolvedValue('Heavy into supply.\n[[dm:@riskbot]] check size');
        const { h, messages } = setup();
        const botReply = h.result.current.dispatchFromBotReply;
        act(() => {
            messages.push({ id: 'r1', role: MessageRole.AI, text: 'raw', createdAt: new Date().toISOString() } as Message);
            botReply(macro, 'r1', 'Heavy into supply.\n[[dm:@riskbot]] check size', 0);
        });
        await waitFor(() => expect(streamQuickResponse).toHaveBeenCalledTimes(1));
        expect(messages.find(m => m.id === 'r1')!.text).toBe('Heavy into supply.');
        // The second hop ran Risk with the envelope text.
        expect(String(streamQuickResponse.mock.calls[0][1])).toContain('Macro (teammate DM): check size');
    });

    it('posts a visible refusal for unknown targets (never silently drops)', async () => {
        const { h, messages } = setup();
        act(() => {
            messages.push({ id: 'r2', role: MessageRole.AI, text: 'raw', createdAt: new Date().toISOString() } as Message);
            h.result.current.dispatchFromBotReply(macro, 'r2', 'a\n[[dm:@ghost]] hello', 0);
        });
        expect(streamQuickResponse).not.toHaveBeenCalled();
        expect(messages.some(m => m.dmNotice && m.text.includes('not on the roster'))).toBe(true);
    });

    it('expires envelopes past TTL at drain time', async () => {
        const { h, messages } = setup();
        act(() => {
            h.result.current.deliverDM(envelope({ queuedAt: Date.now() - 16 * 60_000 }), macro);
        });
        await waitFor(() => expect(messages.some(m => m.dmNotice && m.text.includes('expired'))).toBe(true));
        expect(streamQuickResponse).not.toHaveBeenCalled();
    });

    it('holds the chain at the hop cap', async () => {
        const { h, messages } = setup();
        act(() => {
            messages.push({ id: 'r3', role: MessageRole.AI, text: 'raw', createdAt: new Date().toISOString() } as Message);
            h.result.current.dispatchFromBotReply(macro, 'r3', 'a\n[[dm:@riskbot]] ping', DM_MAX_HOPS);
        });
        expect(streamQuickResponse).not.toHaveBeenCalled();
        expect(messages.some(m => m.dmNotice && m.text.includes('hop cap'))).toBe(true);
    });

    it('dispatch is idempotent per message id', () => {
        const { h, messages } = setup();
        messages.push({ id: 'r4', role: MessageRole.AI, text: 'raw', createdAt: new Date().toISOString() } as Message);
        expect(h.result.current.dispatchFromBotReply(macro, 'r4', 'a\n[[dm:@riskbot]] ping', 0)).toBe(true);
        expect(h.result.current.dispatchFromBotReply(macro, 'r4', 'a\n[[dm:@riskbot]] ping', 0)).toBe(false);
    });

    it('runUserBotTurn returns false when the bot provider is not ready', async () => {
        const dead = bot({ id: 'b9', name: 'Ghost', providerId: 'nope', modelId: 'x' });
        const { h } = setup([dead]);
        expect(await h.result.current.runUserBotTurn(dead, 'hi')).toBe(false);
        expect(streamQuickResponse).not.toHaveBeenCalled();
    });
});
