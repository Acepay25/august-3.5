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
