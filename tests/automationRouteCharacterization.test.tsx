/**
 * 20t wrote this file to pin what a scheduled run did BEFORE stage 19; 20r is
 * the stage that moved it, so the file now describes the TOOL-TURN route —
 * rewritten as its own header demanded, not deleted.
 *
 * A schedule is the one send with nobody in front of the screen. That makes four
 * properties load-bearing and two of them new:
 *  1. a PRIVATE thread — the run never writes into the trader's open conversation;
 *  2. its OWN continuity — what it remembers is its own delivered runs;
 *  3. its OWN model — the config's pick answers, never whatever the desktop
 *     happens to have selected;
 *  4. a DELIVERED VERDICT — a row the Journal and the toast can act on.
 *  5. (20r) a RATIONED plan and (6) a VISIBLE failure, both asserted in
 *     `tests/automationToolTurn.test.ts` where the turn itself lives; here the
 *     scheduler side of the contract is the toast: caveats change its LEVEL.
 *
 * The ensemble leg is now a mode a TRADER opts into (`runEnsembleEnabled =
 * isEnsembleEnabled`), which is what lets stage 19 delete the engine without
 * taking the scheduler down with it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import type { Message } from '../types';
import type { Conversation } from '../types';
import type { ProviderConfig } from '../types/provider';
import type { AutomationConfig, AutomationRun } from '../types/automation';

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

interface AutomationOption {
    automationId: string;
    conversation: Conversation;
    overrides?: Record<string, unknown>;
    /** `notices` is stage 20r's caveat channel — a tool failure, a refused plan,
     *  or a run that looked nothing up. */
    onMessage: (run: { userMessage: Message; aiMessage: Message; notices?: string[] }) => void;
    onError: (error: string) => void;
}

type PipelineImpl = (
    prompt: string,
    images: unknown,
    hidden: unknown,
    options: { automation: AutomationOption },
) => Promise<{ ok?: boolean } | void>;

const cfg = (id: string, model: string): ProviderConfig => ({
    id, name: id, isEnabled: true, apiKey: 'k', baseUrl: 'https://x', apiFormat: 'chat_completions',
    models: [model], selectedModel: model,
} as ProviderConfig);

const automation = (over: Partial<AutomationConfig>): AutomationConfig => ({
    id: 'a1', name: 'Hourly sweep', enabled: true, schedule: { cron: '0 * * * *' },
    inputSource: 'template', promptTemplate: 'sweep BTC',
    mode: 'standard', useLenses: false,
    analystModels: [], moderatorModel: { providerId: 'p1', modelId: 'mod-1' },
    createdAt: 0, updatedAt: 0, runCount: 0, ...over,
});

/** The trader's OPEN conversation, seeded with a row no automation may read. */
const OPEN_ROW = 'the open conversation row';

const setup = (impl: PipelineImpl) => {
    const runPipeline = vi.fn(impl);
    const toast = { success: vi.fn(), error: vi.fn(), warning: vi.fn() };
    const messages: Message[] = [];
    const h = renderHook(() => useAutomations({
        activeUsername: 'tester',
        runPipeline: runPipeline as unknown as Parameters<typeof useAutomations>[0]['runPipeline'],
        conversationHistory: [{
            id: 'conv-open', title: 'Work', timestamp: 0, leverage: 10,
            messages: [{ id: 'o1', role: 'user', text: OPEN_ROW, createdAt: '' } as unknown as Message],
        } as unknown as Conversation],
        providerConfigs: [cfg('p1', 'mod-1')],
        isAnalysisInProgress: false,
        toast,
        bots: () => [],
        messagesRef: { current: messages },
        onBotRoutineDMs: vi.fn(),
    }));
    return { h, runPipeline, toast };
};

/** A pipeline that behaves like a completed ensemble run. */
const verdictRun: PipelineImpl = async (_p, _i, _h, options) => {
    options.automation.onMessage({
        userMessage: { id: 'u1', role: 'user', text: 'sweep BTC', createdAt: '' } as unknown as Message,
        aiMessage: {
            id: 'm1', role: 'ai', text: 'Long BTC', createdAt: '',
            analysis: { direction: 'Long', confidence: 62, coinName: 'BTC' },
            planId: 'plan-m1',
        } as unknown as Message,
    });
    return { ok: true };
};

const settledRuns = (h: { result: { current: { runsByAutomation: Record<string, AutomationRun[]> } } }): AutomationRun[] =>
    (h.result.current.runsByAutomation['a1'] ?? []).filter(r => r.status !== 'running');

beforeEach(() => prefStore.clear());

const runOnce = async (h: { result: { current: { runAutomation: (c: AutomationConfig, catchUp?: boolean) => Promise<void> } } }, config: AutomationConfig): Promise<void> => {
    await act(async () => { await h.result.current.runAutomation(config, false); });
};

describe('a scheduled run keeps its own thread', () => {
    it('runs into a private automation-<id> conversation, never the open one', async () => {
        const { h, runPipeline } = setup(verdictRun);
        await runOnce(h, automation({}));
        const options = runPipeline.mock.calls[0][3] as { automation: AutomationOption };
        expect(options.automation.conversation.id).toBe('automation-a1');
        expect(options.automation.conversation.messages.map(m => m.text)).not.toContain(OPEN_ROW);
        // The private conversation carries the run's OWN leverage + moderator
        // pair, which is why the pipeline can ignore the surface state.
        expect(options.automation.conversation.moderatorModel).toBe('mod-1');
    });

    it('carries context continuity from THIS automation\'s previous runs', async () => {
        const { h, runPipeline } = setup(verdictRun);
        await runOnce(h, automation({}));
        await runOnce(h, automation({}));
        await runOnce(h, automation({}));
        // Third run: the two completed runs before it (user + verdict each) are
        // the whole history — the open conversation contributes nothing.
        const options = (runPipeline.mock.calls[2] as unknown as [string, unknown, unknown, { automation: AutomationOption }])[3];
        const texts = options.automation.conversation.messages.map(m => m.text);
        expect(texts).toEqual(['sweep BTC', 'Long BTC', 'sweep BTC', 'Long BTC']);
        expect(texts).not.toContain(OPEN_ROW);
    });

    it('continuity is the last THREE delivered runs, not the last four rows', async () => {
        // `appendRun` prepends a 'running' stub for every attempt and never
        // dedupes it, so reading the newest N ROWS used to spend half the budget
        // on rows with no text in them — a schedule remembered two answers. 20r
        // filters to runs that carry both a prompt and an answer.
        const { h, runPipeline } = setup(verdictRun);
        for (let i = 0; i < 7; i += 1) await runOnce(h, automation({}));
        const last = runPipeline.mock.calls[6] as unknown as [string, unknown, unknown, { automation: AutomationOption }];
        expect(last[3].automation.conversation.messages.length).toBe(6);
        expect(last[3].automation.conversation.messages.map(m => m.text).filter(t => t === 'Long BTC')).toHaveLength(3);
    });

    it('applies the config\'s model overrides and keeps standard mode out of accuracy', async () => {
        const { h, runPipeline } = setup(verdictRun);
        await runOnce(h, automation({ mode: 'standard' }));
        const plain = (runPipeline.mock.calls[0] as unknown as [string, unknown, unknown, { automation: AutomationOption }])[3].automation.overrides;
        expect(plain?.accuracyMode).toBe(false);
        expect(plain?.lensConfig).toBeUndefined();

        await runOnce(h, automation({ mode: 'pure_ai' }));
        const acc = (runPipeline.mock.calls[1] as unknown as [string, unknown, unknown, { automation: AutomationOption }])[3].automation.overrides;
        expect(acc?.accuracyMode).toBe(true);
        expect(acc?.accuracySubMode).toBe('pure_ai');
    });

    it('a bot-scoped config takes the other fork and never reaches the pipeline', async () => {
        const { h, runPipeline } = setup(verdictRun);
        // No bot named `a-bot` in the roster, so the routine leg reports a
        // VISIBLE skip — the point is that the ensemble entry is not called.
        await runOnce(h, automation({ botId: 'a-bot' }));
        expect(runPipeline).not.toHaveBeenCalled();
    });
});

describe('the product a scheduled run must keep producing', () => {
    it('persists the user prompt AND the verdict row on the run', async () => {
        const { h } = setup(verdictRun);
        await runOnce(h, automation({}));
        const run = settledRuns(h)[0];
        expect(run.status).toBe('complete');
        expect(run.userMessage?.text).toBe('sweep BTC');
        // The verdict fields are what the journal row and the toast read; a tool
        // turn that returns prose without them would settle 'complete' and show
        // nothing, so this is the shape stage 20r has to satisfy by other means.
        expect(run.message?.analysis?.direction).toBe('Long');
        expect(run.message?.planId).toBe('plan-m1');
    });

    it('announces the verdict in words, not the raw row', async () => {
        const { h, toast } = setup(verdictRun);
        await runOnce(h, automation({}));
        const [title, body] = toast.success.mock.calls[0] as [string, string];
        expect(title).toBe('Automation complete');
        expect(body).toContain('Long');
        expect(body).toContain('62');
    });

    it('a run that carries caveats is announced as a WARNING, never as success', async () => {
        // The visible-failure rule lives in the turn (see automationToolTurn);
        // this is the SCHEDULER half: the one thing a trader sees for an
        // unattended run is the toast, so a caveat has to change its LEVEL.
        const { h, toast } = setup(async (_p, _i, _h, options) => {
            options.automation.onMessage({
                userMessage: { id: 'u1', role: 'user', text: 'sweep BTC', createdAt: '' } as unknown as Message,
                aiMessage: { id: 'm1', role: 'ai', text: 'Long BTC', createdAt: '' } as unknown as Message,
                notices: ['TOOL FAILURE(S): get_order_book came back with no data.'],
            });
            return { ok: true };
        });
        await runOnce(h, automation({}));
        expect(toast.success).not.toHaveBeenCalled();
        const [title, body] = toast.warning.mock.calls[0] as [string, string];
        expect(title).toBe('Automation finished with caveats');
        expect(body).toContain('1 thing(s) to check on the card.');
    });

    it('a run that announced nothing still reports the plan it presented', async () => {
        // A tool-turn run has no `analysis`; the card and the toast read the
        // `proposal`. Without this, the new shape announces "No signal".
        const { h, toast } = setup(async (_p, _i, _h, options) => {
            options.automation.onMessage({
                userMessage: { id: 'u1', role: 'user', text: 'sweep BTC', createdAt: '' } as unknown as Message,
                aiMessage: {
                    id: 'm1', role: 'ai', text: 'long here', createdAt: '',
                    proposal: { symbol: 'BTCUSDT', direction: 'Long', entry: 100, stopLoss: 90, takeProfits: [110] },
                } as unknown as Message,
            });
            return { ok: true };
        });
        await runOnce(h, automation({}));
        expect((toast.success.mock.calls[0] as [string, string])[1]).toContain('Long BTCUSDT');
    });
});

describe('the route a scheduled run takes now', () => {
    const src = readFileSync('hooks/useAnalysisPipeline.ts', 'utf8');

    it('an automation is no longer forced onto the ensemble, so stage 19 can delete it', () => {
        expect(src).toMatch(/const runEnsembleEnabled = isEnsembleEnabled;/);
        expect(src).not.toMatch(/isAutomationRun \|\| isEnsembleEnabled/);
    });

    it('a schedule is claimed by its own arm before any ensemble block can run', () => {
        const arm = src.indexOf('const out = await runAutomationTurn({');
        const guard = src.indexOf('if (isAutomationRun) {');
        const ensemble = src.indexOf('if (runEnsembleEnabled) {');
        expect(arm).toBeGreaterThan(-1);
        expect(guard).toBeGreaterThan(-1);
        // The arm RETURNS inside the guard, so what a schedule must never reach is
        // an ensemble-gated block. Position is the proof: guard < arm, and the
        // guard precedes every remaining `runEnsembleEnabled` block — the hybrid
        // pull still runs for a human send with the toggle on, and stage 19's next
        // tranche deletes those blocks outright.
        expect(guard).toBeLessThan(arm);
        expect(guard).toBeLessThan(ensemble);
        // The arm delivers the row AND the caveats through the scheduler's own
        // callback — the store and the toast must not be able to disagree.
        expect(src).toMatch(/onMessage\(\{\s*\n?\s*userMessage,\s*\n?\s*aiMessage,\s*\n?\s*\.\.\.\(out\.notices/);
    });

    it('the debate is gone from the pipeline, and the keywords stay dead', () => {
        // Stage 19 removed the branch that called the engine; nothing here may
        // re-add a debate call or a wording gate. A re-add would give a schedule
        // two different behaviours for two wordings.
        expect(src).not.toMatch(/conductDebate\(|conductRealDebate\(/);
        expect(src).not.toMatch(/isChartAnalysisRequested/);
        expect(src).not.toMatch(/upperPrompt/);
        expect(src).not.toMatch(/Prompt\.includes\(/);
        for (const word of ['LIVE MARKET', 'ANALYZE', 'CHART', 'SETUP', 'STRATEGY']) {
            expect(src, `the pipeline tests the prompt for ${word} again`)
                .not.toMatch(new RegExp(`includes\\(\\s*['"\`]${word}['"\`]`));
        }
        // The debate's gate scan is still keyed on the MODE, not on the schedule:
        // a scheduled plan is capped by present_trade's own gate instead.
        // Stage 20a2 put the gate where a plan is minted (`present_trade`). The
        // pipeline scanning the tape for its own verdict is what stage 19 deleted,
        // and a re-add would spend a network call per send on a result nothing reads.
        expect(src).not.toMatch(/if \(finalSymbol && runEnsembleEnabled\) \{/);
    });
});
