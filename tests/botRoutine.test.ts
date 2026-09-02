import { describe, it, expect } from 'vitest';
import type { AgentBot } from '../services/agents/agentRoster';
import type { ProviderConfig } from '../types/provider';
import type { Message } from '../types';
import { MessageRole } from '../types/enums';
import type { AutomationConfig } from '../types/automation';
import {
    BOT_ROUTINE_HOP,
    botRoutineMessageRow,
    botRoutineProvider,
    botRoutineSkipReason,
    botRoutineRunRow,
    runBotRoutineTurn,
    routineBot,
} from '../services/agents/botRoutine';
import { DM_MAX_HOPS } from '../services/agents/botMailbox';

// Bot Mode G5 (plan botmode-scan): bot-scoped Routines — the pure executor.
// The transport is injected, so no module mocks are needed at all.

const bot = (over: Partial<AgentBot> & Pick<AgentBot, 'id' | 'name'>): AgentBot => ({
    providerId: 'p1', modelId: 'm1', avatar: { kind: 'auto' },
    createdAt: '2026-01-01T00:00:00.000Z', ...over,
});

const macro = bot({ id: 'b1', name: 'Macro', title: 'Macro analyst' });
const risk = bot({ id: 'b2', name: 'Risk Bot', providerId: 'p2', modelId: 'm2' });

const cfg = (id: string, model: string, over: Partial<ProviderConfig> = {}): ProviderConfig => ({
    id, name: id, isEnabled: true, apiKey: 'k', baseUrl: 'https://x', apiFormat: 'chat_completions',
    models: [model], selectedModel: model, ...over,
} as ProviderConfig);

const CONFIGS = [cfg('p1', 'm1'), cfg('p2', 'm2')];

const msg = (over: Partial<Message>): Message => ({
    id: over.id ?? 'x', role: over.role ?? MessageRole.USER,
    text: over.text ?? '', createdAt: '2026-01-01T00:01:00.000Z', ...over,
});

const deps = (over: {
    bots?: AgentBot[]; configs?: ProviderConfig[]; messages?: Message[];
    persona?: string | null; notes?: string | null;
    stream?: (config: ProviderConfig, prompt: string, history: Message[], system: string) => Promise<string>;
} = {}) => ({
    bots: over.bots ?? [macro, risk],
    providerConfigs: over.configs ?? CONFIGS,
    messages: over.messages ?? [],
    persona: over.persona ?? null,
    notes: over.notes ?? null,
    stream: over.stream ?? (async () => 'plain reply'),
});

const automation = (over: Partial<AutomationConfig> = {}): AutomationConfig => ({
    id: 'a1', name: 'Morning brief', enabled: true, schedule: { cron: '0 9 * * *' },
    inputSource: 'template', mode: 'standard', useLenses: false,
    analystModels: [], moderatorModel: { providerId: '', modelId: '' },
    createdAt: 0, updatedAt: 0, runCount: 0, ...over,
});

describe('botRoutine — readiness (G5)', () => {
    it('resolves the ready provider for a roster bot', () => {
        const r = botRoutineProvider([macro], CONFIGS, 'b1');
        expect(r?.bot.id).toBe('b1');
        expect(r?.provider.id).toBe('p1');
    });

    it('is null for a dangling bot id and a bot without a provider', () => {
        expect(botRoutineProvider([macro], CONFIGS, 'ghost')).toBeNull();
        expect(botRoutineProvider([macro], [cfg('pX', 'other')], 'b1')).toBeNull();
        expect(botRoutineProvider([macro], [cfg('p1', 'm1', { isEnabled: false })], 'b1')).toBeNull();
        expect(botRoutineProvider([macro], [cfg('p1', 'm1', { apiKey: '' })], 'b1')).toBeNull();
        expect(botRoutineProvider([macro], [cfg('p1', 'm1', { models: ['other'] })], 'b1')).toBeNull();
    });

    it('skipReason mirrors the executor for the hook fire-time check', () => {
        expect(botRoutineSkipReason([macro], automation({ botId: 'b1' }), CONFIGS)).toBeNull();
        expect(botRoutineSkipReason([macro], automation({ botId: 'ghost' }), CONFIGS))
            .toContain('no longer on the roster');
        expect(botRoutineSkipReason([macro], automation({ botId: 'b1' }), [cfg('pX', 'other')]))
            .toContain('provider is not configured');
        expect(routineBot([macro], automation({ botId: 'b1' }))?.id).toBe('b1');
        expect(routineBot([macro], automation())).toBeNull();
    });
});

describe('botRoutine — the turn (G5)', () => {
    it('runs as the bot: persona system prompt, its provider/model, thread-scoped history', async () => {
        const seen: { provider: ProviderConfig; prompt: string; history: Message[]; system: string }[] = [];
        const history: Message[] = [
            msg({ id: 'h1', role: MessageRole.AI, text: 'other bot\u2019s view', modelsUsed: { p2: 'm2' } }),
            msg({ id: 'h2', role: MessageRole.USER, text: 'hello', modelsUsed: { p1: 'm1' } }),
            msg({ id: 'h3', role: MessageRole.AI, text: 'hi', modelsUsed: { p1: 'm1' } }),
        ];
        const out = await runBotRoutineTurn('b1', 'morning brief', deps({
            messages: history,
            persona: 'You are the macro desk.',
            stream: async (provider, prompt, hist, system) => {
                seen.push({ provider, prompt, history: hist, system });
                return 'Looking at the dollar.';
            },
        }));
        expect(out.status).toBe('complete');
        if (out.status !== 'complete') return;
        expect(out.bot.id).toBe('b1');
        expect(seen).toHaveLength(1);
        expect(seen[0].provider.id).toBe('p1');
        expect(seen[0].provider.selectedModel).toBe('m1');
        expect(seen[0].prompt).toBe('morning brief');
        // History is the bot's OWN derived thread — other bots' rows excluded.
        expect(seen[0].history.map(m => m.id)).toEqual(['h2', 'h3']);
        // Persona + the teammate protocol (byte-stable section) are present.
        expect(seen[0].system).toContain('You are the macro desk.');
        expect(seen[0].system).toContain('## Messaging teammates');
        expect(seen[0].system).toContain('@riskbot');
        expect(out.systemPrompt).toBe(seen[0].system);
        expect(out.reply).toBe('Looking at the dollar.');
        expect(out.dmEnvelopes).toEqual([]);
    });

    it('skips VISIBLE when the bot left the roster or lost its provider', async () => {
        const gone = await runBotRoutineTurn('ghost', 'p', deps());
        expect(gone.status).toBe('skipped');
        if (gone.status === 'skipped') expect(gone.skipReason).toContain('no longer on the roster');

        const unconfigured = await runBotRoutineTurn('b1', 'p', deps({ configs: [] }));
        expect(unconfigured.status).toBe('skipped');
        if (unconfigured.status === 'skipped') expect(unconfigured.skipReason).toContain("Macro's provider is not configured");
    });

    it('strips DM markers from the reply and delivers validated envelopes one hop below', async () => {
        const out = await runBotRoutineTurn('b1', 'p', deps({
            stream: async () => 'Done. [[dm:@riskbot]] check the sizing please.',
        }));
        expect(out.status).toBe('complete');
        if (out.status !== 'complete') return;
        expect(out.reply).toBe('Done.');
        expect(out.dmEnvelopes).toHaveLength(1);
        expect(out.dmEnvelopes[0].fromBotId).toBe('b1');
        expect(out.dmEnvelopes[0].toBotId).toBe('b2');
        expect(out.dmEnvelopes[0].text).toBe('check the sizing please.');
        expect(out.dmEnvelopes[0].hop).toBe(BOT_ROUTINE_HOP);
        expect(BOT_ROUTINE_HOP).toBeLessThan(DM_MAX_HOPS);
    });

    it('drops unknown-target markers instead of delivering them', async () => {
        const out = await runBotRoutineTurn('b1', 'p', deps({
            stream: async () => 'Note. [[dm:@nobody]] ghost text',
        }));
        expect(out.status).toBe('complete');
        if (out.status !== 'complete') return;
        expect(out.reply).toBe('Note.');
        expect(out.dmEnvelopes).toEqual([]);
    });
});

describe('botRoutine — persistence rows (G5)', () => {
    it('message row is attributed to the bot identity pair (files into its thread)', () => {
        const row = botRoutineMessageRow(macro, 'the reply', 'r1');
        expect(row.role).toBe(MessageRole.AI);
        expect(row.text).toBe('the reply');
        expect(row.modelsUsed).toEqual({ p1: 'm1' });
    });

    it('run row stores the prompt + reply, no analysis card', () => {
        const row = botRoutineMessageRow(macro, 'the reply', 'r1');
        const run = botRoutineRunRow(automation({ botId: 'b1' }), 'morning brief', 'run1', '2026-01-01T00:00:00.000Z', row);
        expect(run.id).toBe('run1');
        expect(run.automationId).toBe('a1');
        expect(run.status).toBe('complete');
        expect(run.startedAt).toBe('2026-01-01T00:00:00.000Z');
        expect(run.userMessage?.text).toBe('morning brief');
        expect(run.message?.text).toBe('the reply');
        expect(run.message?.analysis).toBeUndefined();
        expect(run.error).toBeUndefined();
    });
});
