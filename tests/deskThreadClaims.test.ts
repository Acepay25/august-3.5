import { describe, it, expect } from 'vitest';
import { deskThread, threadForProvider } from '../utils/agentThreads';
import { MessageRole } from '../types/enums';
import type { Message } from '../types/message';

/**
 * Who owns an AI row in the Agents desk pane — written while chasing "the
 * second message doesn't render".
 *
 * The pane used to claim a row for a bot when its single `modelsUsed` entry
 * matched that bot's provider+model. A solo Chat-AI answer from that same model
 * matches exactly, so the desk pane dropped it — and the bot's own thread, which
 * keys on the same pair but a different conversation, never showed it either.
 * The row existed and rendered nowhere.
 *
 * It now claims only on `botId`, stamped by the writers that answer AS a bot.
 * These tests pin both halves: the trader's answer survives, and a real bot row
 * still leaves the desk.
 */

const msg = (over: Partial<Message>): Message => ({
    id: 'm', role: MessageRole.AI, text: 't', createdAt: new Date().toISOString(),
    ...over,
} as Message);

const BOT = [{ id: 'bot-1', providerId: 'gemini', modelId: 'gemini-2.5-flash' }];
const SOLO = { gemini: 'gemini-2.5-flash' };

const kept = (m: Message, bots = BOT) => deskThread([m], bots).some(x => x.id === m.id);

describe('the desk pane keeps what no bot positively owns', () => {
    it('keeps an unattributed answer', () => {
        expect(kept(msg({ id: 'plain' }))).toBe(true);
    });

    it('keeps an ensemble answer, which cannot be one bot\'s', () => {
        expect(kept(msg({
            id: 'ensemble',
            modelsUsed: { gemini: 'gemini-2.5-flash', openai: 'gpt-5' },
        }))).toBe(true);
    });

    it('keeps a solo answer even when a roster bot thinks with that model', () => {
        // The regression. Before the stamp, matching a bot's provider+model was
        // enough to delete the trader's own answer from the only pane that shows
        // it — and a session model IS one provider+model, so this fired for
        // every answer once such a bot existed on the roster.
        expect(kept(msg({ id: 'solo-desk', modelsUsed: SOLO }))).toBe(true);
    });

    it('keeps a solo answer on a provider no bot uses', () => {
        expect(kept(msg({ id: 'free', modelsUsed: { openai: 'gpt-5' } }))).toBe(true);
    });

    it('keeps the prompt AND its answer together', () => {
        const prompt = msg({ id: 'asked', role: MessageRole.USER, modelsUsed: undefined });
        const answer = msg({ id: 'answered', modelsUsed: SOLO });
        expect(deskThread([prompt, answer], BOT).map(t => t.id)).toEqual(['asked', 'answered']);
    });

    it('keeps a row stamped for a bot that is no longer on the roster', () => {
        // A deleted bot's history has no thread left to live in; dropping it
        // would destroy text that still has a reader.
        expect(kept(msg({ id: 'orphan', botId: 'gone', modelsUsed: SOLO }))).toBe(true);
    });

    it('scopes room rows to their room', () => {
        const inRoom = msg({ id: 'roomy', roomId: 'group-1' });
        expect(deskThread([inRoom], [])).toHaveLength(0);
    });
});

describe('a bot row still leaves the desk', () => {
    it('drops a row stamped for a roster bot', () => {
        expect(kept(msg({ id: 'dm', botId: 'bot-1', modelsUsed: SOLO }))).toBe(false);
    });

    it('drops a bot row even when its model is unattributed', () => {
        // The stamp is the whole claim: a row with no modelsUsed still must not
        // clutter the desk with someone else's DM.
        expect(kept(msg({ id: 'dm-bare', botId: 'bot-1' }))).toBe(false);
    });

    it('drops every stamped row and keeps every unstamped one', () => {
        const rows = [
            msg({ id: 'dm-a', botId: 'bot-1', modelsUsed: SOLO }),
            msg({ id: 'desk-a', modelsUsed: SOLO }),
            msg({ id: 'dm-b', botId: 'bot-1', modelsUsed: SOLO }),
            msg({ id: 'desk-b', modelsUsed: SOLO }),
        ];
        expect(deskThread(rows, BOT).map(r => r.id)).toEqual(['desk-a', 'desk-b']);
    });
});

describe('two bots on one provider+model stay separate', () => {
    it('never claims a row stamped for the other bot', () => {
        const rows = [
            msg({ id: 'p1', role: MessageRole.USER }),
            msg({ id: 'b2-answer', botId: 'bot-2', modelsUsed: SOLO }),
            msg({ id: 'p2', role: MessageRole.USER }),
            msg({ id: 'b1-answer', botId: 'bot-1', modelsUsed: SOLO }),
        ];
        // bot-1's thread must not swallow bot-2's reply — nor the prompt that
        // provoked it, which is what an inference-by-model would have done.
        expect(threadForProvider(rows, 'gemini', 'gemini-2.5-flash', 'bot-1').map(r => r.id))
            .toEqual(['p2', 'b1-answer']);
    });

    it('still claims an unstamped row by model, so history does not vanish', () => {
        const rows = [
            msg({ id: 'p1', role: MessageRole.USER }),
            msg({ id: 'legacy-answer', modelsUsed: SOLO }),
        ];
        expect(threadForProvider(rows, 'gemini', 'gemini-2.5-flash', 'bot-1').map(r => r.id))
            .toEqual(['p1', 'legacy-answer']);
    });
});
