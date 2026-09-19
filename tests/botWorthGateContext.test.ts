/**
 * WS-3.2 — the worth gate must judge a bot's skill against THAT bot's memory.
 *
 * syncClosedTradeToNotebook used to read `bots[0]` off the roster for its
 * bot-memory context no matter which bot earned the trade, so a skill learned
 * from the third teammate's closed trades was judged against the first one's
 * notes. The acting bot now travels in as `origin`, and this pins that it is
 * the one actually read.
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

const { ctxCalls, worthCalls } = vi.hoisted(() => ({
    ctxCalls: [] as string[],
    worthCalls: [] as string[],
}));

vi.mock('../services/bots/BotMemoryService', () => ({
    getBotMemoryContext: (botId: string) => { ctxCalls.push(botId); return `MEMORY OF ${botId}`; },
    readBotMemoryMarkdown: () => null,
    readBotSystemMarkdown: () => null,
    botMemoryFolderName: (id: string) => `bots-${id}`,
    filterBotNoteByQuery: (n: string | null) => n,
    getBotMemoryContextDefault: undefined,
}));

// A ready "memory model" so the gate branch is taken, and a worth gate that
// says "create" while recording the bot context it was handed.
vi.mock('../services/learning/MemoryModelService', () => ({
    resolveMemoryConfig: vi.fn(async () => ({
        id: 'p1', name: 'Gate', apiKey: 'k', baseUrl: 'https://x/v1',
        apiFormat: 'chat_completions', isEnabled: true, isBuiltIn: false,
        models: ['m'], selectedModel: 'm',
    })),
}));

vi.mock('../services/learning/skillWorthGate', () => ({
    evaluateSkillWorth: async (_c: unknown, botContext: string) => {
        worthCalls.push(botContext);
        return null; // null ⇒ the deterministic fallback; this test only reads the context
    },
    validateCraftedSkill: () => null,
    skillClusterExists: () => false,
}));

import { initMemoryFiles } from '../services/learning/MemoryFilesService';
import { syncClosedTradeToNotebook } from '../services/learning/SkillMemoryService';
import { LAST_ACTIVE_USER_KEY } from '../utils/activeUser';
import { TradeOutcome } from '../types';
import type { LoggedTrade, TradeAnalysis } from '../types';

const USER = 'gate-ctx-user';

/** Three closed trades on one cluster, so MIN_CLUSTER_FOR_SKILL (3) is met and
 *  the worth-gate branch actually runs. */
const cluster: LoggedTrade[] = ['g1', 'g2', 'g3'].map(id => ({
    id,
    analysis: {
        coinName: 'BTCUSDT', direction: 'Short', detectedPatternFamily: 'Family A',
        entryPoints: [{ price: 100 }], stopLoss: 105, takeProfit: [{ price: 90 }],
    } as unknown as TradeAnalysis,
    outcome: TradeOutcome.LOSS,
    postMortem: 'Lesson: the sweep failed and the short had no edge once it reclaimed.',
    timestamp: new Date(Date.now() - 5000).toISOString(),
}));

beforeEach(async () => {
    store = {};
    ctxCalls.length = 0;
    worthCalls.length = 0;
    localStorage.clear();
    localStorage.setItem(LAST_ACTIVE_USER_KEY, USER);
    await initMemoryFiles(USER);
});

describe('syncClosedTradeToNotebook worth-gate context', () => {
    it("reads the acting bot's memory when a bot authored the trade", async () => {
        localStorage.setItem(`bots_v1_${USER}`, JSON.stringify({
            bots: [{ id: 'bot-first' }, { id: 'bot-acting' }],
        }));
        await syncClosedTradeToNotebook(cluster[2], cluster, USER, { botId: 'bot-acting', botName: 'Acting' });
        expect(ctxCalls).toContain('bot-acting');
        expect(ctxCalls).not.toContain('bot-first');
        expect(worthCalls.some(c => c.includes('bot-acting'))).toBe(true);
    });

    it('falls back to the roster head only when nobody authored it', async () => {
        localStorage.setItem(`bots_v1_${USER}`, JSON.stringify({
            bots: [{ id: 'bot-first' }, { id: 'bot-acting' }],
        }));
        await syncClosedTradeToNotebook(cluster[2], cluster, USER);
        expect(ctxCalls).toContain('bot-first');
    });
});
