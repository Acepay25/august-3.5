/**
 * One thread, read from either home.
 *
 * `entriesForSession` (`services/trade/chatSessions.ts`) is the single merge
 * that turns a dock session's own rows and App's canonical `Message[]` into ONE
 * transcript. Both readers call it — the dock's render and the history the bot
 * answers from — and `tests/botConversationStore.test.ts` pins that wiring. This
 * file pins what the function itself guarantees, because every one of these
 * cases is a way the two homes have already disagreed:
 *
 *  - a turn said in Chat that never reached the dock (the missing adoption);
 *  - the same turn reaching both and rendering TWICE (the mirror);
 *  - the bot answering from a stale copy while the trader looked at the live
 *    conversation (the raw-session read).
 *
 * The id is what makes two writers safe: `liveEntryFromMessage` keys a projected
 * row by `m.id`, and the `present_trade` path already writes its dock entry
 * under the conversation Message's id. Same id ⇒ one row here.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
    createSession, entriesForSession, liveEntryFromMessage, loadSessions, saveSessions,
    type StoredChatEntry,
} from '../services/trade/chatSessions';
import { MessageRole, type Message } from '../types';

const msg = (over: Partial<Message> = {}): Message => ({
    id: 'm1',
    role: MessageRole.USER,
    text: 'question',
    createdAt: '2026-10-14T08:00:00.000Z',
    ...over,
} as Message);

const entry = (over: Partial<StoredChatEntry> = {}): StoredChatEntry => ({
    id: 'e1',
    role: 'ai',
    text: 'dock row',
    tools: [],
    ...over,
});

describe('entriesForSession — the one merge', () => {
    it('hands back the session untouched when it has no counterpart', () => {
        // A solo or panel session has no canonical conversation, so the session
        // IS the transcript. Returning the SAME array (not a copy) is what keeps
        // a title-only `mutate` identity-stable for the render's memo.
        const local = [entry()];
        expect(entriesForSession(local, undefined)).toBe(local);
    });

    it('an empty canonical conversation still leaves the session alone', () => {
        // `[]` is a real answer ("this conversation has no rows yet"), not a
        // missing one — so the local rows join an empty list rather than
        // short-circuiting. Order is what this pins.
        const local = [entry({ id: 'a', text: 'streaming answer' })];
        expect(entriesForSession(local, []).map(e => e.id)).toEqual(['a']);
    });

    it('canonical rows come first, in conversation order', () => {
        const rows = entriesForSession(
            [entry({ id: 'live', text: 'still streaming' })],
            [msg({ id: 'q1', role: MessageRole.USER, text: 'look at BTC' }), msg({ id: 'a1', text: 'short it' })],
        );
        expect(rows.map(r => r.id)).toEqual(['q1', 'a1', 'live']);
        expect(rows[0].role).toBe('user');
        expect(rows[1].text).toBe('short it');
    });

    it('a settling turn with a canonical id REPLACES the projected row, never appends', () => {
        // The optimistic user bubble and the streaming answer both take this
        // path. Appending is what made every exchange appear twice.
        const canonical = [msg({ id: 'a1', text: 'short it' })];
        const settled = entry({ id: 'a1', text: 'short it (settled)', tools: ['read order book'] });
        const rows = entriesForSession([settled], canonical);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toBe(settled);
        expect(rows[0].tools).toEqual(['read order book']);
    });

    it('does not mutate either input', () => {
        // Both arrays are React memo dependencies. A merge that wrote through
        // would show the trader a row that vanished on the next re-render.
        const local = [entry({ id: 'live' })];
        const canonical = [msg({ id: 'q1' })];
        const localBefore = [...local];
        const canonicalIdsBefore = canonical.map(m => m.id);
        entriesForSession(local, canonical);
        expect(local).toEqual(localBefore);
        expect(canonical.map(m => m.id)).toEqual(canonicalIdsBefore);
    });

    it('carries the answer\'s work time across, so both homes say the same "Analyzed for Ns"', () => {
        // The Chat rail freezes `runStats.durationMs`; the dock's row shows
        // `workedMs`. Without the projection a turn asked in Chat would show a
        // duration in one surface and none in the other.
        const row = liveEntryFromMessage(msg({
            id: 'a1', role: MessageRole.AI, text: 'short it',
            runStats: { durationMs: 14_000 } as never,
        }));
        expect(row.workedMs).toBe(14_000);
        expect(row.at).toBe(Date.parse('2026-10-14T08:00:00.000Z'));
    });

    it('leaves `at` unset for an unparseable stamp rather than filing it as 0', () => {
        // The memory-attribution window join reads a real stamp as meaningful
        // and 0 as noise; a bogus lower bound would pull unrelated injections
        // onto this answer.
        expect(liveEntryFromMessage(msg({ createdAt: 'not a date' })).at).toBeUndefined();
    });
});

describe('the conversation link survives persistence', () => {
    // `chatSessions.ts` documents the trap in the note on `workedMs`: a new
    // ENTRY field rides `sanitizeEntry`'s spread and survives, but a new SESSION
    // field is stripped on the next write unless `loadSessions`'s explicit
    // rebuild carries it. `conversationId` is a session field, so the merged
    // thread depends on a line in that rebuild that nothing would notice if it
    // were deleted — the pane would quietly go back to being two transcripts
    // after a reload, with no failing test anywhere.
    beforeEach(() => { localStorage.clear(); });

    it('a bound session comes back bound', () => {
        const session = {
            ...createSession('solo'),
            conversationId: 'c-42',
            entries: [{ id: 'e1', role: 'user' as const, text: 'asked here', tools: [] }],
        };
        saveSessions([session]);
        const [back] = loadSessions();
        expect(back.conversationId).toBe('c-42');
    });

    it('and still merges the conversation it points at, after the reload', () => {
        saveSessions([{ ...createSession('solo'), conversationId: 'c-7', entries: [] }]);
        const [back] = loadSessions();
        const rows = entriesForSession(back.entries, [msg({ id: 'm9', text: 'said in Chat' })]);
        expect(rows.map(r => r.text)).toEqual(['said in Chat']);
    });

    it('drops an empty or non-string id rather than inventing a binding', () => {
        saveSessions([
            { ...createSession('solo'), conversationId: '' },
            { ...createSession('solo'), conversationId: 42 as unknown as string },
        ]);
        const back = loadSessions();
        expect(back).toHaveLength(2);
        expect(back.every(s => s.conversationId === undefined)).toBe(true);
    });
});
