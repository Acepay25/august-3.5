import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { AgentBot } from '../services/agents/agentRoster';
import type { ProviderConfig } from '../types/provider';
import type { Message } from '../types';
import { MessageRole } from '../types/enums';
import type { AutomationConfig, AutomationRun } from '../types/automation';

// Bot Mode G5 (plan botmode-scan): bot-scoped Routines through the
// useAutomations engine — the run executes AS the bot (persona prompt +
// its provider/model via streamQuickResponse), files the reply into the
// bot's thread through the bridge, and never touches the ensemble path.

const streamQuickResponse = vi.hoisted(() => vi.fn());
vi.mock('../services/providers/GenericAnalysisService', () => ({ streamQuickResponse }));
vi.mock('../services/bots/BotMemoryService', () => ({
    readBotSystemMarkdown: () => 'You are the macro desk.',
    readBotMemoryMarkdown: () => null,
}));
// Per-TEST preference store — a module-level Map would leak configs across
// tests and race the hook's mount-time load against the first save.
const prefStore = vi.hoisted(() => new Map<string, unknown>());
vi.mock('../services/infrastructure/PreferencesService', () => ({
    getPreferenceObject: async (k: string) => prefStore.get(k),
    setPreferenceObject: async (k: string, v: unknown) => { prefStore.set(k, v); },
    removePreference: async (k: string) => { prefStore.delete(k); },
}));

import { useAutomations } from '../hooks/useAutomations';

const bot = (over: Partial<AgentBot> & Pick<AgentBot, 'id' | 'name'>): AgentBot => ({
    providerId: 'p1', modelId: 'm1', avatar: { kind: 'auto' },
    createdAt: '2026-01-01T00:00:00.000Z', ...over,
});
const macro = bot({ id: 'b1', name: 'Macro' });

const cfg = (id: string, model: string): ProviderConfig => ({
    id, name: id, isEnabled: true, apiKey: 'k', baseUrl: 'https://x', apiFormat: 'chat_completions',
    models: [model], selectedModel: model,
} as ProviderConfig);
const CONFIGS = [cfg('p1', 'm1')];

const automation = (over: Partial<AutomationConfig>): AutomationConfig => ({
    id: 'a1', name: 'Morning brief', enabled: true, schedule: { cron: '0 9 * * *' },
    inputSource: 'template', promptTemplate: 'give the morning brief',
    mode: 'standard', useLenses: false,
    analystModels: [], moderatorModel: { providerId: '', modelId: '' },
    createdAt: 0, updatedAt: 0, runCount: 0, ...over,
});

const setup = async (bots: AgentBot[] = [macro]) => {
    const messages: Message[] = [];
    const messagesRef = { current: messages };
    const deliverDMs = vi.fn();
    const runPipeline = vi.fn();
    const toast = { success: vi.fn(), error: vi.fn(), warning: vi.fn() };
    const h = renderHook(() => useAutomations({
        activeUsername: 'tester',
        runPipeline: runPipeline as unknown as Parameters<typeof useAutomations>[0]['runPipeline'],
        conversationHistory: [],
        providerConfigs: CONFIGS,
        isAnalysisInProgress: false,
        toast,
        bots: () => bots,
        messagesRef,
        onBotRoutineDMs: deliverDMs,
    }));
    // Flush the mount-time async config load before the test touches state.
    await act(async () => { await Promise.resolve(); });
    act(() => { h.result.current.assignAutomationsBridge({ appendMessage: (m: Message) => { messages.push(m); } }); });
    return { h, messages, deliverDMs, runPipeline, toast };
};

beforeEach(() => {
    streamQuickResponse.mockReset();
    streamQuickResponse.mockResolvedValue('Brief done.');
    prefStore.clear();
});

describe('useAutomations — bot-scoped routines (G5)', () => {
    it('runs AS the bot: persona + its provider/model, reply filed into its thread', async () => {
        const { h, messages, toast } = await setup();
        const config = automation({ botId: 'b1' });
        await act(async () => { await h.result.current.saveAutomation(config); });
        await act(async () => { await h.result.current.runAutomation(config, false); });

        expect(streamQuickResponse).toHaveBeenCalledTimes(1);
        const [provider, prompt, , system] = streamQuickResponse.mock.calls[0];
        expect(provider.id).toBe('p1');
        expect(provider.selectedModel).toBe('m1');
        expect(prompt).toBe('give the morning brief');
        expect(String(system)).toContain('You are the macro desk.');
        expect(String(system)).toContain('## Messaging teammates');

        // The reply is an AI row attributed to the bot identity pair.
        const row = messages.find(m => m.role === MessageRole.AI && m.text === 'Brief done.');
        expect(row?.modelsUsed).toEqual({ p1: 'm1' });

        await waitFor(() => expect(h.result.current.runsByAutomation['a1']?.[0]?.status).toBe('complete'));
        const run = h.result.current.runsByAutomation['a1'][0] as AutomationRun;
        expect(run.userMessage?.text).toBe('give the morning brief');
        expect(run.message?.text).toBe('Brief done.');
        await waitFor(() => expect(h.result.current.configs[0]?.runCount).toBe(1));
        expect(toast.success).toHaveBeenCalledWith('Routine complete', expect.stringContaining('Macro replied'));
    });

    it('does NOT touch the ensemble pipeline and vice versa', async () => {
        const { h, runPipeline } = await setup();
        // Ensemble automation: no botId → the private pipeline, which fails
        // fast via onError so runAutomation's completion promise resolves.
        runPipeline.mockImplementation(
            (_p: string, _i: unknown, _h2: unknown, opts: { automation: { onError: (e: string) => void } }) =>
                opts.automation.onError('boom'),
        );
        const ensemble = automation({ id: 'a2', botId: undefined });
        await act(async () => { await h.result.current.runAutomation(ensemble, false); });
        expect(runPipeline).toHaveBeenCalledTimes(1);
        expect(streamQuickResponse).not.toHaveBeenCalled();
        await waitFor(() => expect(h.result.current.runsByAutomation['a2']?.[0]?.status).toBe('error'));

        // Bot automation: never calls the pipeline.
        const botRun = automation({ id: 'a3', botId: 'b1' });
        await act(async () => { await h.result.current.saveAutomation(botRun); });
        await act(async () => { await h.result.current.runAutomation(botRun, false); });
        expect(runPipeline).toHaveBeenCalledTimes(1);
        expect(streamQuickResponse).toHaveBeenCalledTimes(1);
    });

    it('skips VISIBLY when the bot left the roster (run row + toast, no transport)', async () => {
        const { h, toast } = await setup([macro]);
        const config = automation({ botId: 'ghost' });
        await act(async () => { await h.result.current.saveAutomation(config); });
        await act(async () => { await h.result.current.runAutomation(config, false); });
        await waitFor(() => expect(h.result.current.runsByAutomation['a1']?.[0]?.status).toBe('skipped'));
        const run = h.result.current.runsByAutomation['a1'][0] as AutomationRun;
        expect(run.error).toContain('no longer on the roster');
        expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining('skipped'), expect.stringContaining('no longer on the roster'));
        expect(streamQuickResponse).not.toHaveBeenCalled();
    });

    it('delivers the reply through the bridge and hands DM markers to the mailbox', async () => {
        streamQuickResponse.mockResolvedValue('Done. [[dm:@riskbot]] check sizing.');
        const roster = [macro, bot({ id: 'b2', name: 'Risk Bot', providerId: 'p1', modelId: 'm1' })];
        const { h, messages, deliverDMs } = await setup(roster);
        const config = automation({ botId: 'b1' });
        await act(async () => { await h.result.current.saveAutomation(config); });
        await act(async () => { await h.result.current.runAutomation(config, false); });

        const row = messages.find(m => m.role === MessageRole.AI);
        expect(row?.text).toBe('Done.');
        expect(deliverDMs).toHaveBeenCalledTimes(1);
        const envelopes = deliverDMs.mock.calls[0][0] as { toBotId: string; text: string }[];
        expect(envelopes).toHaveLength(1);
        expect(envelopes[0].toBotId).toBe('b2');
        expect(envelopes[0].text).toBe('check sizing.');
    });

    it('exposes botRoutineCount / botRoutinesFor for the rail', async () => {
        const { h } = await setup();
        await act(async () => { await h.result.current.saveAutomation(automation({ id: 'a1', botId: 'b1' })); });
        await act(async () => { await h.result.current.saveAutomation(automation({ id: 'a2', botId: 'b2' })); });
        await act(async () => { await h.result.current.saveAutomation(automation({ id: 'a4' })); });
        expect(h.result.current.botRoutineCount('b1')).toBe(1);
        expect(h.result.current.botRoutinesFor('b1').map(c => c.id)).toEqual(['a1']);
        expect(h.result.current.botRoutinesFor('ghost')).toEqual([]);
    });
});
