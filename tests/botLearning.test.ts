/**
 * botLearning — the WS-3 write-side guards.
 *
 * syncClosedTradeToNotebook is idempotent for its own writes but NOT cheap:
 * its worth-gate leg is a live LLM call that re-fires whenever an evidence
 * cluster still has no matching skill. If a bot re-folded the same closed
 * trades on every DM turn, ordinary chat would burn a provider call per turn
 * forever. These tests pin the fold-once behavior and the lesson write.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

let store: Record<string, unknown> = {};
// vi.hoisted: the mock factory below runs during module resolution, before a
// plain `const` would be initialized.
const { syncSpy } = vi.hoisted(() => ({
    syncSpy: vi.fn((..._args: unknown[]): Promise<void> => Promise.resolve()),
}));
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

// The real fold is covered in tests/learningLoopE2E.test.ts — this suite only
// needs to know how many times it was asked to run.
vi.mock('../services/learning/SkillMemoryService', async importOriginal => {
    const mod = await importOriginal<typeof import('../services/learning/SkillMemoryService')>();
    return { ...mod, syncClosedTradeToNotebook: syncSpy };
});

import { recordBotTurnOutcome, botLessonCount } from '../services/agents/botLearning';
import { initMemoryFiles, getMemoryFiles } from '../services/learning/MemoryFilesService';
import { readBotMemoryMarkdown, botMemoryFolderName } from '../services/bots/BotMemoryService';
import { TradeOutcome } from '../types';
import type { LoggedTrade, TradeAnalysis } from '../types';

const USER = 'bot-learn-user';
const BOT = { id: 'bot-7', name: 'Macro', providerId: 'prov-bot' };

const botTrade = (id: string): LoggedTrade => ({
    id,
    analysis: {
        coinName: 'BTCUSDT', direction: 'Short', detectedPatternFamily: 'Family A',
        entryPoints: [{ price: 100 }], stopLoss: 105, takeProfit: [{ price: 90 }],
    } as unknown as TradeAnalysis,
    outcome: TradeOutcome.LOSS,
    postMortem: 'Lesson: the sweep failed and the short had no edge.',
    timestamp: new Date(Date.now() - 5000).toISOString(),
    modelsUsed: { 'prov-bot': 'model-x' },
});

/** A turn that reads as the bot's own call: exactly one model, and it is this
 *  bot's provider — the utils/agentThreads single-model identity rule. */
const turn = async (trades: LoggedTrade[]): Promise<void> => {
    await recordBotTurnOutcome(BOT, 'BTC short?', 'Verdict: avoid.\nLesson: BTC shorting a failed sweep has no edge — wait for the reclaim close.', { username: USER, trades });
};

beforeEach(async () => {
    store = {};
    syncSpy.mockClear();
    localStorage.clear();
    await initMemoryFiles(USER);
});

describe('recordBotTurnOutcome', () => {
    it('folds each closed bot trade once, not on every turn', async () => {
        const trades = [botTrade('bt-1'), botTrade('bt-2')];
        await turn(trades);
        await turn(trades);
        await turn(trades);
        expect(syncSpy).toHaveBeenCalledTimes(2); // two trades, each folded once
        expect(syncSpy.mock.calls.map(c => (c[0] as LoggedTrade).id).sort()).toEqual(['bt-1', 'bt-2']);
    });

    it('ignores trades the bot did not author', async () => {
        const notTheBot = { ...botTrade('other-1'), modelsUsed: { 'prov-else': 'm' } };
        const ensemble = { ...botTrade('ens-1'), modelsUsed: { 'prov-bot': 'm', 'prov-other': 'm2' } };
        await turn([notTheBot, ensemble]);
        expect(syncSpy).not.toHaveBeenCalled();
    });

    it('writes its lesson where BotMemoryService reads it back', async () => {
        await turn([]);
        // The reader and the writer must agree on the folder name — a lesson
        // written under a differently-derived name is invisible to the bot.
        expect(getMemoryFiles().folders.some(f => f.name === botMemoryFolderName(BOT.id))).toBe(true);
        expect(readBotMemoryMarkdown(BOT.id)).toContain('failed sweep');
        expect(botLessonCount(BOT.id)).toBe(1);
    });

    it('gives a refusal no lesson line', async () => {
        await recordBotTurnOutcome(BOT, 'hi', 'I can’t help with that.', { username: USER, trades: [] });
        expect(botLessonCount(BOT.id)).toBe(0);
    });
});
