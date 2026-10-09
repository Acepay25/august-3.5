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
    getPreference: vi.fn(async (key: string) => store[key] ?? null),
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

import { recordBotTurnOutcome, botLessonCount, lessonFromBotTurn } from '../services/agents/botLearning';
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
    it('folds each closed bot trade once, and names the acting bot to the worth gate', async () => {
        const trades = [botTrade('bt-1'), botTrade('bt-2')];
        await turn(trades);
        await turn(trades);
        await turn(trades);
        expect(syncSpy).toHaveBeenCalledTimes(2); // two trades, each folded once
        expect(syncSpy.mock.calls.map(c => (c[0] as LoggedTrade).id).sort()).toEqual(['bt-1', 'bt-2']);
        // WS-3.2: the gate must judge a bot's skill against THAT bot's memory.
        // Before this, syncClosedTradeToNotebook read bots[0] off the roster,
        // so a skill earned by the third teammate was judged against the first
        // one's notes.
        for (const call of syncSpy.mock.calls) {
            expect(call[3]).toMatchObject({ botId: BOT.id, botName: BOT.name });
        }
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

describe('lessonFromBotTurn — the declaration and the widened gate', () => {
    it('mines an explicit LESSON token, and only the token', () => {
        const reply = 'Verdict: avoid the short.\nLesson: the sweep had no follow-through at all here.\n'
            + 'LESSON: wait for the 15m reclaim <-- LEARN';
        // The declaration wins over the longer prose line: the bot said which
        // one it means, and a parser that preferred the prose would make the
        // declaration decorative.
        expect(lessonFromBotTurn(reply)).toBe('wait for the 15m reclaim');
    });

    it('writes the declared lesson into the bot notes, minus the protocol bytes', async () => {
        await recordBotTurnOutcome(BOT, 'btc?', 'Funding is hot.\nLESSON: wait for the 15m reclaim <-- LEARN', {
            username: USER, trades: [],
        });
        expect(readBotMemoryMarkdown(BOT.id)).toContain('wait for the 15m reclaim');
        // The sentinel is a parser boundary, not part of the lesson.
        expect(readBotMemoryMarkdown(BOT.id)).not.toContain('LEARN');
        expect(botLessonCount(BOT.id)).toBe(1);
    });

    it('accepts the label spellings the old gate refused', () => {
        // "Lessons learned:" needs the plural+learned form; the previous
        // pattern only matched a bare "lesson:" and so silently dropped a
        // labelled lesson from a reply that had one.
        expect(lessonFromBotTurn('Lessons learned: wait for the reclaim close before adding.')).toBe(
            'wait for the reclaim close before adding.');
        expect(lessonFromBotTurn('What I learned: do not front-run a failed sweep here.')).toBe(
            'do not front-run a failed sweep here.');
    });

    it('gives a declaration too short to be a lesson nothing at all', () => {
        // Not the prose around it either: the declaration is the permission,
        // and a thin one is not an invitation to mine the rest of the reply.
        expect(lessonFromBotTurn('LESSON: ok <-- LEARN\nOtherwise this is a fine answer.')).toBe('');
    });

    it('gives a refusal, a disclaimer and an unladen reply no lesson', () => {
        for (const reply of [
            'I can’t help with that.',
            'I have no price data here.',
            'BTC is ranging and nothing resolves today.',
            'I learned nothing from this trade',
        ]) expect(lessonFromBotTurn(reply)).toBe('');
    });
});
