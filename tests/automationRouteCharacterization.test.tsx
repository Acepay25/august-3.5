/**
 * 20t — what a scheduled run does TODAY, written down before stage 19/20r move it.
 *
 * Automations are the one caller that still REQUIRES the ensemble: the pipeline
 * forces `runEnsembleEnabled = isAutomationRun || isEnsembleEnabled`, so a
 * scheduled run gets the debate even when the trader's ensemble switch is off,
 * it lands in a private `automation-<id>` conversation rather than the open
 * one, and what comes back is a verdict row whose `analysis` becomes the journal
 * card and the success toast. Deleting the debate (stage 19) therefore has to
 * give scheduled runs a NEW route with the same four observable properties —
 * private thread, own-run continuity, per-config model overrides, a loggable
 * verdict — not merely remove a branch.
 *
 * This is a CHARACTERIZATION file: every assertion describes current behavior,
 * and the honest signal that stage 19/20r is done is this file being REWRITTEN
 * to describe the tool-turn route — not deleted.
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
    onMessage: (run: { userMessage: Message; aiMessage: Message }) => void;
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

    it('continuity is capped at the last TWO completed runs, because every run leaves a stub row', async () => {
        // CHARACTERIZATION, not endorsement. `appendRun` prepends and never
        // dedupes, so a run is stored twice: once 'running' (no messages) and
        // once settled. The history read is `slice(0, 4)` of the ROWS, so half
        // the budget is spent on empty stubs and a long-lived schedule never
        // remembers more than its last two completed runs. Stage 20r inherits
        // this until the read counts runs instead of rows.
        const { h, runPipeline } = setup(verdictRun);
        for (let i = 0; i < 7; i += 1) await runOnce(h, automation({}));
        const last = runPipeline.mock.calls[6] as unknown as [string, unknown, unknown, { automation: AutomationOption }];
        expect(last[3].automation.conversation.messages.length).toBe(4);
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
});

describe('the fact stage 19 has to replace rather than delete', () => {
    const src = readFileSync('hooks/useAnalysisPipeline.ts', 'utf8');

    it('an automation run is forced onto the ensemble route regardless of the user switch', () => {
        // Pinned as a source contract because observing it needs the whole
        // pipeline mounted. When the debate goes away this line must be
        // REPLACED (a tool turn for scheduled runs), and this test rewritten —
        // removing it silently is how a schedule starts answering casually and
        // nobody notices for a week.
        expect(src).toMatch(/const runEnsembleEnabled = isAutomationRun \|\| isEnsembleEnabled;/);
        // Stage 20c retired the wording gate: the branch is the MODE's, so the
        // flag alone decides it. Pinned WITH its first statement, because
        // `if (runEnsembleEnabled) {` also appears at the data pull — a bare
        // match would stay green if the fork itself were deleted.
        expect(src).toMatch(/if \(runEnsembleEnabled\) \{\n\s+const summaries = \[/);
        // And the keywords must stay dead. This is the whole ruling in four
        // greps: no send may route on its own text, and a re-add would give a
        // schedule two different behaviours for two different wordings.
        // And the keywords must stay dead. Pinned as a CALL SHAPE, not as a
        // word ban — the comment above this gate legitimately names the five
        // words it removed, and a scan that trips on prose is a false-positive
        // machine. What may not come back is a string test on the prompt.
        expect(src).not.toMatch(/isChartAnalysisRequested/);
        expect(src).not.toMatch(/upperPrompt/);
        expect(src).not.toMatch(/Prompt\.includes\(/);
        for (const word of ['LIVE MARKET', 'ANALYZE', 'CHART', 'SETUP', 'STRATEGY']) {
            expect(src, `the pipeline tests the prompt for ${word} again`)
                .not.toMatch(new RegExp(`includes\\(\\s*['"\`]${word}['"\`]`));
        }
        // And the gate scan is part of that route, keyed on the same flag: the
        // cap a scheduled plan gets today is a gate cap, not a tool cap.
        expect(src).toMatch(/if \(finalSymbol && runEnsembleEnabled\) \{/);
    });
});
