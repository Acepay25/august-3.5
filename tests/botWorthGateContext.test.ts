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
    getPreference: vi.fn(async (key: string) => store[key] ?? null),
    getPreferenceArray: vi.fn(async (key: string, guard?: (item: unknown) => boolean) => {
        const raw = store[key];
        if (!Array.isArray(raw)) return [];
        return guard ? raw.filter(guard) : raw;
    }),
    setPreferenceObject: vi.fn(async (key: string, value: unknown) => { store[key] = value; }),
    removePreference: vi.fn(async (key: string) => { delete store[key]; }),
}));

// P0-3: the roster moved to Preferences via BotRegistry; the raw localStorage
// read below only survives for pre-migration installs and is NEVER consulted
// on native (Capacitor Preferences and localStorage are two different places
// there).
const { mockBots } = vi.hoisted(() => ({ mockBots: [] as Array<{ id: string }> }));
vi.mock('../services/bots/BotRegistry', () => ({
    BotRegistry: {
        list: vi.fn(async () => mockBots),
    },
}));

const { ctxCalls, worthCalls } = vi.hoisted(() => ({
    ctxCalls: [] as string[],
    worthCalls: [] as string[],
}));

/** P1-4: how many times the gate was actually INVOKED, so the throttle can be
 *  asserted end-to-end (the context recorder above only proves it ran once). */
const { gateRuns } = vi.hoisted(() => ({ gateRuns: { n: 0 } }));

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
        gateRuns.n += 1;
        worthCalls.push(botContext);
        return null; // null ⇒ the deterministic fallback; this test only reads the context
    },
    validateCraftedSkill: () => null,
    skillClusterExists: () => false,
}));

import { initMemoryFiles } from '../services/learning/MemoryFilesService';
import { syncClosedTradeToNotebook, __resetSettledTradesForTests } from '../services/learning/SkillMemoryService';
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
    gateRuns.n = 0;
    mockBots.length = 0;
    __resetSettledTradesForTests();
    localStorage.clear();
    localStorage.setItem(LAST_ACTIVE_USER_KEY, USER);
    await initMemoryFiles(USER);
});

describe('syncClosedTradeToNotebook worth-gate context', () => {
    it("reads the acting bot's memory when a bot authored the trade", async () => {
        mockBots.push({ id: 'bot-first' }, { id: 'bot-acting' });
        await syncClosedTradeToNotebook(cluster[2], cluster, USER, { botId: 'bot-acting', botName: 'Acting' });
        expect(ctxCalls).toContain('bot-acting');
        expect(ctxCalls).not.toContain('bot-first');
        expect(worthCalls.some(c => c.includes('bot-acting'))).toBe(true);
    });

    it('falls back to the roster head only when nobody authored it', async () => {
        mockBots.push({ id: 'bot-first' }, { id: 'bot-acting' });
        await syncClosedTradeToNotebook(cluster[2], cluster, USER);
        expect(ctxCalls).toContain('bot-first');
    });

    it('P1-4: throttles a re-attempt over evidence the gate already judged', async () => {
        // The one-LLM-per-close bug: this cluster keeps producing trades and
        // the gate cannot reach a verdict (evaluateSkillWorth returns null), so
        // before the ledger every close re-billed the provider.
        mockBots.push({ id: 'bot-first' });
        await syncClosedTradeToNotebook(cluster[2], cluster, USER);
        expect(gateRuns.n).toBe(1);

        // Same cluster membership as the gate's last view. The settle guard
        // would stop this anyway, so clear it — this asserts the GATE throttle,
        // not the settle guard.
        __resetSettledTradesForTests();
        await syncClosedTradeToNotebook(cluster[2], cluster, USER);
        expect(gateRuns.n).toBe(1); // ← the throttle fired

        // A new trade in the cluster re-opens it: the gate has not judged this
        // one, so the retry is real work, not a repeat.
        __resetSettledTradesForTests();
        const fresh = { ...cluster[0], id: 'g-new-1' };
        await syncClosedTradeToNotebook(fresh, [...cluster, fresh], USER);
        expect(gateRuns.n).toBe(2);
    });
});
