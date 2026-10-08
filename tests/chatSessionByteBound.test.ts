/**
 * The chat transcript's byte bound.
 *
 * A count cap (12 sessions × 60 entries) does not bound SIZE, and on web this
 * store IS localStorage, whose quota is shared by every other store in the app —
 * so a handful of screenshots used to stop the journal, the notebook and the
 * settings from saving as well, with the transcript still looking fine in memory.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    MAX_PINNED_SESSIONS,
    MAX_STORED_CHARS,
    loadSessions,
    saveSessions,
    storageKey,
    type ChatSession,
    type StoredChatEntry,
} from '../services/trade/chatSessions';

const BIG_IMAGE = `data:image/png;base64,${'A'.repeat(900_000)}`;

const entry = (id: string, withImage = false): StoredChatEntry => ({
    id,
    role: 'ai',
    text: `answer ${id}`,
    tools: [],
    ...(withImage ? { image: BIG_IMAGE } : {}),
});

const session = (id: string, count: number, withImage: boolean): ChatSession => ({
    id,
    title: id,
    createdAt: Date.now() - 1000,
    updatedAt: Date.now(),
    kind: 'solo',
    entries: Array.from({ length: count }, (_, i) => entry(`${id}-e${i}`, withImage)),
});

beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('activeUsername', 'probe-user');
});

const imageCount = (sessions: ChatSession[]): number =>
    sessions.reduce((n, s) => n + s.entries.filter(e => !!e.image).length, 0);
const textCount = (sessions: ChatSession[]): number =>
    sessions.reduce((n, s) => n + s.entries.filter(e => !!e.text).length, 0);

describe('saveSessions byte budget', () => {
    it('leaves a normal transcript completely alone', () => {
        const sessions = [session('s1', 5, false), session('s2', 5, false)];
        saveSessions(sessions);
        const raw = localStorage.getItem(storageKey()) ?? '';
        const read = loadSessions();
        expect(textCount(read)).toBe(10);
        expect(read[0].entries[0].text).toBe('answer s1-e0');
        expect(raw.length).toBeLessThan(MAX_STORED_CHARS);
    });

    it('drops the oldest screenshots before it drops any words', () => {
        // 6 image entries ≈ 5.4 MB — over the budget on purpose.
        const sessions = [
            session('s-old', 6, true),
            session('s-new', 1, false),
        ];
        saveSessions(sessions);
        const read = loadSessions();
        expect(imageCount(read)).toBeLessThan(6);
        // Nothing is thrown away but the images: every text row survives.
        expect(textCount(read)).toBe(7);
        expect(read[read.length - 1].entries[0].text).toBe('answer s-new-e0');
    });

    it('keeps the written blob inside the budget on a realistic overflow', () => {
        // Five screenshots ≈ 4.5 MB against a 3.5 MB budget — what a week of
        // chart captures actually looks like, not a synthetic megabyte-per-entry
        // stress case that jsdom's own storage limit answers first.
        const fat = [session('a', 3, true), session('b', 3, true), session('c', 2, false)];
        expect(imageCount(fat)).toBe(6);
        saveSessions(fat);
        const raw = localStorage.getItem(storageKey()) ?? '';
        expect(raw.length).toBeLessThanOrEqual(MAX_STORED_CHARS);
        const read = loadSessions();
        expect(read.length).toBe(3);
        expect(textCount(read)).toBe(8);
        expect(imageCount(read)).toBeLessThan(6);
    });

    it('retries without screenshots when the write itself fails', () => {
        const sessions = [session('s1', 3, true)];
        const real = Storage.prototype.setItem;
        let threw = false;
        const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k: string, v: string) => {
            if (!threw && v.includes('data:image')) { threw = true; throw new Error('QuotaExceededError'); }
            real.call(localStorage, k, v);
        });
        try {
            saveSessions(sessions);
        } finally {
            spy.mockRestore();
        }
        expect(threw).toBe(true);
        const saved = localStorage.getItem(storageKey());
        expect(saved).toBeTruthy();
        expect(saved).not.toContain('data:image');
        expect(loadSessions()[0].entries).toHaveLength(3);
    });

    it('warns when the retry is what saved the transcript', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const real = Storage.prototype.setItem;
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k: string, v: string) => {
            if (v.includes('data:image')) throw new Error('QuotaExceededError');
            real.call(localStorage, k, v);
        });
        try {
            saveSessions([session('s1', 2, true)]);
        } finally {
            vi.restoreAllMocks();
        }
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('without screenshots'));
    });

    it('reports a hard failure instead of swallowing it', () => {
        const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('QuotaExceededError');
        });
        try {
            saveSessions([session('s1', 2, false)]);
        } finally {
            vi.restoreAllMocks();
        }
        expect(err).toHaveBeenCalledWith(expect.stringContaining('NOT persisted'));
    });
});

/**
 * A pin is a promise, and the byte budget used to break it three ways: the
 * count trim dropped the oldest sessions (after pinning, exactly the chats
 * the user kept), Pass 2 shaved every session's oldest entries, and Pass 3
 * deleted whole oldest sessions. Pin-awareness is now a predicate BOTH caps
 * consult — and where "never touch a pinned chat" would dead-end at a
 * throwing setItem, the last resort shaves the oldest pinned chat and SAYS
 * so, because a silent trim is the defect the store exists to prevent.
 */
describe('a pinned chat survives the caps', () => {
    /** A text-heavy session: no images, so Pass 1 is a no-op and the test
     *  exercises the entry-shaving passes directly. */
    const fat = (id: string, count: number, kbPerEntry: number, updatedAt = Date.now()): ChatSession => ({
        id,
        title: id,
        createdAt: updatedAt - 1000,
        updatedAt,
        kind: 'solo',
        entries: Array.from({ length: count }, (_, i) => ({
            id: `${id}-e${i}`,
            role: 'ai',
            text: `${id} entry ${i} ${'x'.repeat(kbPerEntry * 1024)}`,
            tools: [],
        })),
    });

    const byId = (id: string): ChatSession | undefined => loadSessions().find(s => s.id === id);
    const entryCount = (id: string): number => byId(id)?.entries.length ?? 0;

    it('survives the count cap even when it is the oldest session', () => {
        // 13 sessions; the pinned one is the OLDEST — the exact session
        // `slice(-MAX_SESSIONS)` used to delete.
        const sessions = [
            fat('s-pinned', 3, 1, Date.now() - 50_000),
            ...Array.from({ length: 13 }, (_, i) => fat(`u${i}`, 3, 1, Date.now() - 1000 * (13 - i))),
        ];
        saveSessions(sessions, ['s-pinned']);
        const read = loadSessions();
        expect(read).toHaveLength(12);
        expect(byId('s-pinned')).toBeDefined();
        expect(entryCount('s-pinned')).toBe(3);
        // The newest unpinned session is the one kept; the oldest unpinned is gone.
        expect(byId('u12')).toBeDefined();
        expect(byId('u0')).toBeUndefined();
    });

    it('is not the session Pass 2 shaves', () => {
        // 35 entries × 100 KB ≈ 3.58M — just over the 3.5M ceiling. Shaving
        // the UNPINNED session to its newest ten brings the store back under;
        // the pinned session must come out of this with all fifteen entries.
        const sessions = [fat('s-keep', 15, 100), fat('s-lose', 20, 100)];
        const notice = saveSessions(sessions, ['s-keep']);
        expect(entryCount('s-keep')).toBe(15);
        expect(byId('s-keep')?.entries[0].text).toContain('s-keep entry 0');
        expect(entryCount('s-lose')).toBeLessThanOrEqual(10);
        expect(notice).toBeNull();
    });

    it('is never the whole session Pass 3 deletes while an unpinned one exists', () => {
        // s-fat is heavy enough to survive Pass 2's shave (10 × 400 KB > the
        // ceiling), so the test reaches Pass 3 — where an unpinned session
        // must be the one deleted, never the pinned one.
        const sessions = [
            fat('s-pinned', 2, 1, Date.now() - 50_000),
            fat('s-fat', 20, 400),
            fat('s-new', 2, 1),
        ];
        saveSessions(sessions, ['s-pinned']);
        expect(byId('s-pinned')).toBeDefined();
        expect(byId('s-new')).toBeDefined();
        expect(byId('s-fat')).toBeUndefined();
    });

    it('the last resort shaves the oldest PINNED chat and reports it — never silently', () => {
        // Every session pinned and still over the ceiling: the store must
        // trim something or the write throws and the LIVE transcript is what
        // gets lost. It trims the oldest pinned chat's oldest entries, keeps
        // its newest ten, and returns the notice the rail shows.
        const sessions = [fat('s-old-pinned', 20, 250, Date.now() - 50_000), fat('s-new-pinned', 3, 1)];
        const notice = saveSessions(sessions, ['s-old-pinned', 's-new-pinned']);
        expect(entryCount('s-old-pinned')).toBe(10);
        expect(byId('s-old-pinned')?.entries[0].text).toContain('s-old-pinned entry 10');
        expect(byId('s-new-pinned')?.entries).toHaveLength(3);
        expect(notice?.pinnedTrimmed).toEqual(['s-old-pinned']);
    });

    it('caps the pinned set at MAX_PINNED_SESSIONS and names the pins it could not keep', () => {
        const pins = Array.from({ length: MAX_PINNED_SESSIONS + 1 }, (_, i) => `p${i}`);
        const sessions = [
            ...pins.map((id, i) => fat(id, 2, 1, Date.now() - 10_000 * (MAX_PINNED_SESSIONS + 1 - i))),
            ...Array.from({ length: 3 }, (_, i) => fat(`u${i}`, 2, 1, Date.now())),
        ];
        const notice = saveSessions(sessions, pins);
        // The STALEST pin (p0 — smallest updatedAt) is the one dropped, and
        // it is reported rather than silently gone.
        expect(notice?.pinsDropped).toEqual(['p0']);
        expect(byId('p0')).toBeUndefined();
        expect(byId('p10')).toBeDefined();
        // The newest two unpinned sessions still fit beside the ten pins.
        const read = loadSessions();
        expect(read).toHaveLength(12);
        expect(read.filter(s => s.id.startsWith('p')).length).toBe(MAX_PINNED_SESSIONS);
        expect(read.filter(s => s.id.startsWith('u')).length).toBe(2);
        expect(byId('u2')).toBeDefined();
        expect(byId('u0')).toBeUndefined();
    });
});
