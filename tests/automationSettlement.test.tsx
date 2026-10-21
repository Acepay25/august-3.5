import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { Message } from '../types';
import type { ProviderConfig } from '../types/provider';
import type { AutomationConfig, AutomationRun } from '../types/automation';

/**
 * Ensemble-run settlement.
 *
 * The pipeline reports through `onMessage`/`onError`, but FOUR of its exits
 * reach neither — cancellation, the 429 rate-limit return, the quota return
 * and the offline re-queue. Before this was fixed, `runAutomation` awaited a
 * promise only those callbacks could settle, so an early exit left
 * `inFlightRef` set permanently and the 15s tick loop's in-flight guard
 * disabled every automation until the app was restarted. A 429 is the single
 * most likely thing an unattended scheduled run hits.
 *
 * The early-exit cases below return from the pipeline WITHOUT calling any
 * automation callback — the exact shape that used to strand the scheduler.
 */

const prefStore = vi.hoisted(() => new Map<string, unknown>());
vi.mock('../services/infrastructure/PreferencesService', () => ({
    getPreferenceObject: async (k: string) => prefStore.get(k),
    getPreferenceArray: async (key: string, guard?: (item: unknown) => boolean) => {
        const raw = prefStore.get(key);
        if (!Array.isArray(raw)) return [];
        return guard ? raw.filter(guard) : raw;
    },
    setPreferenceObject: async (k: string, v: unknown) => { prefStore.set(k, v); },
    removePreference: async (k: string) => { prefStore.delete(k); },
}));
vi.mock('../services/providers/GenericAnalysisService', () => ({ streamQuickResponse: vi.fn() }));
vi.mock('../services/bots/BotMemoryService', () => ({
    readBotSystemMarkdown: () => '',
    readBotMemoryMarkdown: () => null,
}));

import { useAutomations } from '../hooks/useAutomations';

interface AutomationOptions {
    automation: {
        // The delivery fields the pipeline actually passes — the same shape
        // `AutomationRunDelivery` declares in the hook. `plans` is E-57 §6.
        onMessage: (run: { userMessage: Message; aiMessage: Message; notices?: string[]; plans?: { presented: number; refused: number } }) => void;
        onError: (error: string) => void;
    };
}

type PipelineImpl = (
    prompt: string,
    images: unknown,
    hidden: unknown,
    options: AutomationOptions,
) => Promise<{ ok?: boolean } | void>;

const cfg = (id: string, model: string): ProviderConfig => ({
    id, name: id, isEnabled: true, apiKey: 'k', baseUrl: 'https://x', apiFormat: 'chat_completions',
    models: [model], selectedModel: model,
} as ProviderConfig);

const automation = (over: Partial<AutomationConfig>): AutomationConfig => ({
    id: 'a1', name: 'Hourly sweep', enabled: true, schedule: { cron: '0 * * * *' },
    inputSource: 'template', promptTemplate: 'sweep BTC',
 mode: 'standard',
 moderatorModel: { providerId: '', modelId: '' },
    createdAt: 0, updatedAt: 0, runCount: 0, ...over,
});

const setup = async (impl: PipelineImpl) => {
    const runPipeline = vi.fn(impl);
    const toast = { success: vi.fn(), error: vi.fn(), warning: vi.fn() };
    const messages: Message[] = [];
    const h = renderHook(() => useAutomations({
        activeUsername: 'tester',
        runPipeline: runPipeline as unknown as Parameters<typeof useAutomations>[0]['runPipeline'],
        conversationHistory: [],
        providerConfigs: [cfg('p1', 'm1')],
        isAnalysisInProgress: false,
        toast,
        bots: () => [],
        messagesRef: { current: messages },
        onBotRoutineDMs: vi.fn(),
    }));
    await act(async () => { await Promise.resolve(); });
    act(() => { h.result.current.assignAutomationsBridge({ appendMessage: (m: Message) => { messages.push(m); } }); });
    return { h, runPipeline, toast };
};

/** Early exit: the pipeline resolves and calls nothing. This is the 429 shape. */
const silentExit = (ok: boolean): PipelineImpl => async () => ({ ok });

/** Normal success: onMessage fires, then the promise resolves. */
const callbackThenResolve: PipelineImpl = async (_p, _i, _h, options) => {
    options.automation.onMessage({
        userMessage: { id: 'u1', role: 'user', text: 'sweep BTC' } as unknown as Message,
        aiMessage: { id: 'm1', role: 'ai', text: 'done', analysis: {} } as unknown as Message,
    });
    return { ok: true };
};

beforeEach(() => prefStore.clear());

/** `appendRun` prepends and never dedupes, so every run leaves a
 *  'running' row behind. The settled row is the one that isn't. */
const settledRuns = (h: { result: { current: { runsByAutomation: Record<string, AutomationRun[]> } } }): AutomationRun[] =>
    (h.result.current.runsByAutomation['a1'] ?? []).filter(r => r.status !== 'running');

describe('useAutomations — ensemble run settlement', () => {
    it('a rate-limited early exit settles the run instead of hanging', async () => {
        const { h, toast } = await setup(silentExit(false));

        // The whole point: this await must resolve. It used to hang forever.
        await act(async () => { await h.result.current.runAutomation(automation({}), false); });

        await waitFor(() => expect(settledRuns(h)[0]).toBeTruthy());
        const run = settledRuns(h)[0];
        expect(run.status).toBe('error');
        expect(run.error).toMatch(/before producing a verdict/i);
        expect(toast.error).toHaveBeenCalled();
    });

    it('clears the in-flight guard so the NEXT scheduled run still fires', async () => {
        const { h, runPipeline } = await setup(silentExit(false));

        await act(async () => { await h.result.current.runAutomation(automation({}), false); });
        expect(runPipeline).toHaveBeenCalledTimes(1);

        // Second run: with the guard stranded the pipeline is never called
        // again — the original production failure, and the reason a 429 on one
        // unattended run silently disabled every automation in the app.
        await act(async () => { await h.result.current.runAutomation(automation({}), false); });
        expect(runPipeline).toHaveBeenCalledTimes(2);
        await waitFor(() => expect(settledRuns(h).length).toBe(2));
    });

    it('a cancelled or offline-requeued exit is recorded as skipped, not as a duplicate run', async () => {
        const { h } = await setup(silentExit(true));
        await act(async () => { await h.result.current.runAutomation(automation({}), false); });

        const runs = settledRuns(h);
        // Cancellation is not a failure and not a completed analysis — but it
        // must still be VISIBLE, or a silently-skipped schedule looks like work.
        expect(runs.length).toBe(1);
        expect(runs[0].status).toBe('skipped');
        expect(runs[0].finishedAt).toBeTruthy();
    });

    it('a rejected pipeline settles instead of hanging', async () => {
        const { h } = await setup(async () => { throw new Error('transport exploded'); });
        await act(async () => { await h.result.current.runAutomation(automation({}), false); });

        await waitFor(() => expect(settledRuns(h)[0]).toBeTruthy());
        const run = settledRuns(h)[0];
        expect(run.status).toBe('error');
        expect(run.error).toBe('transport exploded');
    });

    it('each early-exit path appends exactly one settled row', async () => {
        const { h } = await setup(silentExit(false));

        await act(async () => { await h.result.current.runAutomation(automation({}), false); });
        // One settled row, not two: the settlement guard must not fire after a
        // callback that already settled the run.
        expect(settledRuns(h).length).toBe(1);

        await act(async () => { await h.result.current.runAutomation(automation({}), false); });
        expect(settledRuns(h).length).toBe(2);
    });

    it('the callback success path is unchanged: one settled row, complete', async () => {
        const { h } = await setup(callbackThenResolve);
        await act(async () => { await h.result.current.runAutomation(automation({}), false); });

        await waitFor(() => expect(settledRuns(h)[0]).toBeTruthy());
        const runs = settledRuns(h);
        // The settlement guard must not append a second row after onMessage.
        expect(runs.length).toBe(1);
        expect(runs[0].status).toBe('complete');
        expect(runs[0].message?.text).toBe('done');
    });
});

/**
 * E-57 §6 — what a run LEAVES behind, and what happens when runs stop leaving
 * anything at all.
 *
 * Two halves. (1) The turn's caveats were a toast and a line of prose: the toast
 * is gone in seconds, the prose only exists on a run that answered, so an
 * `error`/`skipped` row recorded nothing about why it failed. Now they are
 * fields on the row. (2) Ruling (d): three runs in a row that produced nothing
 * disable the schedule, visibly, and only a human can start it again — because
 * autonomy that fails repeatedly and keeps trying quietly is the one failure
 * mode an unattended feature must not have.
 */
describe('useAutomations — the run record and the failure breaker (E-57 §6)', () => {
    /** `persistConfigs` REPLACES the list, so the breaker can only act on a
     *  schedule the store already knows. Seed it the way the app's own load
     *  does, and wait for the mount to read it back. */
    const setupSeeded = async (impl: PipelineImpl, over: Partial<AutomationConfig> = {}) => {
        prefStore.set('automations_v1_tester', [automation(over)]);
        const s = await setup(impl);
        await waitFor(() => expect(s.h.result.current.configs.length).toBe(1));
        return s;
    };
    const stored = () => (prefStore.get('automations_v1_tester') ?? []) as AutomationConfig[];

    const answerWith = (notices: string[], plans: { presented: number; refused: number }): PipelineImpl =>
        async (_p, _i, _h, options) => {
            options.automation.onMessage({
                userMessage: { id: 'u1', role: 'user', text: 'sweep BTC' } as unknown as Message,
                aiMessage: { id: 'm1', role: 'ai', text: 'done', analysis: {} } as unknown as Message,
                notices,
                plans,
            });
            return { ok: true };
        };

    it('writes the caveats and the plan ration ONTO the row, not only into a toast', async () => {
        const notices = ['NO MARKET LOOKUP: this turn answered without calling a market tool.'];
        const { h, toast } = await setup(answerWith(notices, { presented: 1, refused: 1 }));
        await act(async () => { await h.result.current.runAutomation(automation({}), false); });

        await waitFor(() => expect(settledRuns(h)[0]).toBeTruthy());
        const run = settledRuns(h)[0];
        expect(run.notices).toEqual(notices);
        expect(run.plans).toEqual({ presented: 1, refused: 1 });
        // The toast still fires — the row is the record, the toast is the moment.
        expect(toast.warning).toHaveBeenCalled();
    });

    it('control: a clean run stores neither field, so an absent caveat is not a gap', async () => {
        const { h } = await setup(callbackThenResolve);
        await act(async () => { await h.result.current.runAutomation(automation({}), false); });
        const run = settledRuns(h)[0];
        expect(run.notices).toBeUndefined();
        expect(run.plans).toBeUndefined();
        expect(run.status).toBe('complete');
    });

    it('a run that never answered keeps its own reason, and counts', async () => {
        const { h } = await setupSeeded(silentExit(false));
        await act(async () => { await h.result.current.runAutomation(automation({}), false); });
        expect(settledRuns(h)[0].status).toBe('error');
        expect(stored()[0].consecutiveFailures).toBe(1);
        expect(stored()[0].enabled).toBe(true);
    });

    it('disables the schedule after three in a row, in words, and the disable survives a reload', async () => {
        const { h, toast } = await setupSeeded(silentExit(false));
        for (let i = 0; i < 3; i += 1) {
            await act(async () => { await h.result.current.runAutomation(automation({}), false); });
        }

        await waitFor(() => expect(stored()[0].enabled).toBe(false));
        expect(stored()[0].consecutiveFailures).toBe(3);
        expect(stored()[0].disabledReason).toMatch(/3 runs in a row that produced nothing/);
        expect(stored()[0].disabledReason).toMatch(/Switch Scheduled back on/);
        expect(toast.warning).toHaveBeenCalledWith(
            'Automation disabled after repeated failures',
            expect.stringContaining('It is off until you turn it back on'),
        );
        // The reload is the real test: the store is what the app reads at boot,
        // so a breaker that only lived in React state would forget its own
        // verdict and start answering again on its own.
        const reopened = await setup(silentExit(false));
        await waitFor(() => expect(reopened.h.result.current.configs[0].enabled).toBe(false));
        expect(reopened.h.result.current.configs[0].disabledReason).toMatch(/runs in a row/);
    });

    it('counts a STREAK, not a total — one clean run in the middle resets it', async () => {
        // Without this arm the test above would pass on a breaker that counted
        // every failure since the day the schedule was made.
        let fires = 0;
        const impl: PipelineImpl = async (_p, _i, _h, options) => {
            fires += 1;
            if (fires === 3) {
                options.automation.onMessage({
                    userMessage: { id: 'u1', role: 'user', text: 'sweep BTC' } as unknown as Message,
                    aiMessage: { id: 'm1', role: 'ai', text: 'done', analysis: {} } as unknown as Message,
                });
                return { ok: true };
            }
            return { ok: false };
        };
        const { h } = await setupSeeded(impl);
        for (let i = 0; i < 5; i += 1) {
            await act(async () => { await h.result.current.runAutomation(automation({}), false); });
        }
        expect(stored()[0].enabled).toBe(true);
        expect(stored()[0].consecutiveFailures).toBe(2);
        expect(stored()[0].runCount).toBe(5);
    });

    it('a human re-enable clears the counter and the reason, and that is the only way', async () => {
        const { h } = await setupSeeded(silentExit(false));
        for (let i = 0; i < 3; i += 1) {
            await act(async () => { await h.result.current.runAutomation(automation({}), false); });
        }
        await waitFor(() => expect(stored()[0].enabled).toBe(false));

        await act(async () => { await h.result.current.toggleAutomationEnabled('a1'); });
        expect(stored()[0].enabled).toBe(true);
        expect(stored()[0].consecutiveFailures).toBe(0);
        expect(stored()[0].disabledReason).toBeUndefined();
    });

    it('control: switching a schedule OFF by hand writes no breaker reason', async () => {
        // Two states that look alike are one state: a trader's own pause must not
        // read as the app reporting it stopped trying.
        const { h } = await setupSeeded(silentExit(false));
        await act(async () => { await h.result.current.toggleAutomationEnabled('a1'); });
        expect(stored()[0].enabled).toBe(false);
        expect(stored()[0].disabledReason).toBeUndefined();
    });

    it('the bot arm feeds the SAME breaker — one rule, one writer', async () => {
        // The harness roster is empty, so every bot-scoped fire is skipped with
        // "no longer on the roster": exactly the repeated silence ruling (d)
        // covers, and the arm that does not run the pipeline at all.
        const { h, runPipeline } = await setupSeeded(silentExit(false), { botId: 'macro' });
        for (let i = 0; i < 3; i += 1) {
            await act(async () => { await h.result.current.runAutomation(automation({ botId: 'macro' }), false); });
        }
        await waitFor(() => expect(stored()[0].enabled).toBe(false));
        expect(stored()[0].disabledReason).toMatch(/3 runs in a row that produced nothing/);
        expect(stored()[0].disabledReason).toMatch(/no longer on the roster/);
        expect(runPipeline).not.toHaveBeenCalled();
    });
});
