/**
 * WS-3.2's craft leg — a bot's closed trade goes through the same draft chain
 * the chart AI's post-mortems do, judged against THAT bot's memory.
 *
 * The two things worth pinning are the seat (a bot crafts with the model it
 * thinks with, not the provider default) and the context (the gate reads the
 * acting bot's persona + notes). The third is the offline shape: no ready
 * provider must mean the leg quietly does nothing, never a throw that would
 * surface in the middle of a chat turn.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

let store: Record<string, unknown> = {};
vi.mock('../services/infrastructure/PreferencesService', () => ({
    getPreferenceObject: vi.fn(async (key: string) => store[key] ?? null),
    getPreferenceArray: vi.fn(async (key: string, guard?: (item: unknown) => boolean) => {
        const raw = store[key];
        if (!Array.isArray(raw)) return [];
        return guard ? raw.filter(guard) : raw;
    }),
    setPreferenceObject: vi.fn(async (key: string, value: unknown) => { store[key] = value; }),
    removePreference: vi.fn(async (key: string) => { delete store[key]; }),
}));

const { craftCalls, gateCalls, botMemory, syncSpy } = vi.hoisted(() => ({
    craftCalls: [] as Array<{ providerId: string; selectedModel: string }>,
    gateCalls: [] as Array<{ botContext: string; tradeId: string }>,
    botMemory: {} as Record<string, string>,
    // The evidence fold is covered in learningLoopE2E; here it only needs to
    // not run. Declared inside hoisted() because the mock factory below runs
    // during module resolution, before a plain `const` would initialize.
    syncSpy: vi.fn(async (): Promise<void> => { /* no-op */ }),
}));

vi.mock('../services/learning/SkillCraftService', () => ({
    craftSkillFromPostMortem: async (trade: any, config: any) => {
        craftCalls.push({ providerId: config.id, selectedModel: config.selectedModel });
        return {
            name: `Crafted ${trade.id}`, kind: 'avoid', when: 'BTC sweeps the low and reclaims',
            inputs: ['price'], steps: ['wait for the reclaim close'], validate: 'closed above',
            output: 'skip the short', approval: 'size changes',
            ifCondition: 'BTC sweeps the prior low but the candle closes back above it',
            thenAction: 'Do not short — the failed sweep removes downside conviction',
        };
    },
}));

vi.mock('../services/learning/draftGates', () => ({
    gateEvidenceBackedDraft: async (input: any) => {
        gateCalls.push({ botContext: input.botContext, tradeId: input.tradeId });
        return { action: 'skipped' as const, reason: 'test: gate declined', judged: true };
    },
    validateIfThen: () => null,
}));

vi.mock('../services/infrastructure/ProviderConfigService', () => ({
    loadProviderConfigs: vi.fn(async () => store.__providers ?? []),
}));

vi.mock('../services/bots/BotMemoryService', () => ({
    getBotMemoryContext: (botId: string) => botMemory[botId] ?? `MEMORY OF ${botId}`,
    readBotMemoryMarkdown: (botId: string) => botMemory[botId] ?? null,
    readBotSystemMarkdown: () => null,
    botMemoryFolderName: (id: string) => `bots-${id}`,
}));

vi.mock('../services/learning/SkillMemoryService', async importOriginal => {
    const mod = await importOriginal<typeof import('../services/learning/SkillMemoryService')>();
    return { ...mod, syncClosedTradeToNotebook: syncSpy };
});

import { craftAndGateBotTrade, recordBotTurnOutcome } from '../services/agents/botLearning';
import { initMemoryFiles } from '../services/learning/MemoryFilesService';
import { LAST_ACTIVE_USER_KEY } from '../utils/activeUser';
import { TradeOutcome } from '../types';
import type { LoggedTrade, TradeAnalysis } from '../types';

const USER = 'craft-leg-user';
const BOT = { id: 'bot-3', name: 'Sweep', providerId: 'prov-bot', modelId: 'gpt-x' };

const readyConfig = {
    id: 'prov-bot', name: 'Bot provider', apiKey: 'k', baseUrl: 'https://x/v1',
    apiFormat: 'chat_completions' as const, isEnabled: true, isBuiltIn: false,
    models: ['gpt-x', 'other'], selectedModel: 'gpt-x',
};

const trade = (id: string): LoggedTrade => ({
    id,
    analysis: {
        coinName: 'BTCUSDT', direction: 'Short', detectedPatternFamily: 'Family A',
        entryPoints: [{ price: 100 }], stopLoss: 105, takeProfit: [{ price: 90 }],
    } as unknown as TradeAnalysis,
    outcome: TradeOutcome.LOSS,
    postMortem: 'Lesson: BTC shorting a failed sweep has no edge — wait for the reclaim close.',
    timestamp: new Date(Date.now() - 5000).toISOString(),
    modelsUsed: { 'prov-bot': 'gpt-x' },
});

beforeEach(async () => {
    store = {};
    craftCalls.length = 0;
    gateCalls.length = 0;
    for (const k of Object.keys(botMemory)) delete botMemory[k];
    syncSpy.mockClear();
    localStorage.clear();
    localStorage.setItem(LAST_ACTIVE_USER_KEY, USER);
    await initMemoryFiles(USER);
});

describe('craftAndGateBotTrade', () => {
  it('crafts with the bot\'s own model and gates against the bot\'s own memory', async () => {
    store.__providers = [readyConfig];
    botMemory['bot-3'] = 'Sweep believes: never short a reclaimed sweep.';

    const result = await craftAndGateBotTrade(BOT, trade('ct-1'), [trade('ct-1')], USER);

    expect(craftCalls).toEqual([{ providerId: 'prov-bot', selectedModel: 'gpt-x' }]);
    expect(gateCalls).toHaveLength(1);
    expect(gateCalls[0].tradeId).toBe('ct-1');
    expect(gateCalls[0].botContext).toContain('never short a reclaimed sweep');
    expect(result).toBeNull(); // the stubbed gate declined
  });

  it('does nothing without a ready provider — a chat turn never pays for it', async () => {
    store.__providers = [];
    expect(await craftAndGateBotTrade(BOT, trade('ct-2'), [trade('ct-2')], USER)).toBeNull();
    expect(craftCalls).toHaveLength(0);
    expect(gateCalls).toHaveLength(0);
  });

  it('skips a provider that has no key rather than falling back to another', async () => {
    store.__providers = [{ ...readyConfig, apiKey: '', isEnabled: false }];
    expect(await craftAndGateBotTrade(BOT, trade('ct-3'), [trade('ct-3')], USER)).toBeNull();
    expect(craftCalls).toHaveLength(0);
  });
});

describe('recordBotTurnOutcome craft leg wiring', () => {
  it('runs the draft chain once per folded bot trade, before the evidence fold', async () => {
    store.__providers = [readyConfig];
    const trades = [trade('w-1'), trade('w-2')];
    const turn = () => recordBotTurnOutcome(BOT, 'BTC short?', 'Lesson: BTC shorting a failed sweep has no edge — wait for the reclaim close.', { username: USER, trades });

    await turn();
    await turn(); // fold-once guard must cover the craft leg too

    expect(gateCalls.map(g => g.tradeId).sort()).toEqual(['w-1', 'w-2']);
    expect(syncSpy).toHaveBeenCalledTimes(2);
    // Craft happens for the same two trades, once each.
    expect(craftCalls).toHaveLength(2);
  });
});
