import { describe, it, expect, beforeEach } from 'vitest';
import {
    createSession,
    titleFromMessage,
    loadSessions,
    saveSessions,
    storageKey,
    MAX_SESSIONS,
    MAX_ENTRIES,
} from '../services/trade/chatSessions';

/**
 * chatSessions — the Trade panel's persisted chat tabs. jsdom localStorage
 * is per test file; a unique active user per test keeps the key isolated.
 */

const uniqueUser = (): string => `chatsessions-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('last_active_user', uniqueUser());
});

describe('trade chat sessions', () => {
    it('creates an empty untitled session with a unique id', () => {
        const a = createSession();
        const b = createSession();
        expect(a.title).toBe('New chat');
        expect(a.entries).toEqual([]);
        expect(a.id).not.toBe(b.id);
        expect(a.createdAt).toBeLessThanOrEqual(a.updatedAt);
    });

    it('titles from the first message: markdown stripped, capped, one line', () => {
        expect(titleFromMessage('# Is **BTC** reclaiming the highs?')).toBe('Is BTC reclaiming the highs?');
        expect(titleFromMessage('multi\nline prompt')).toBe('multi');
        expect(titleFromMessage('x'.repeat(80))).toHaveLength(36);
        expect(titleFromMessage('   ')).toBe('New chat');
    });

    it('round-trips sessions through localStorage', () => {
        const s = createSession();
        s.entries.push(
            { id: 'u1', role: 'user', text: 'bias?', tools: [] },
            { id: 'a1', role: 'ai', text: 'long-ish', tools: ['get_order_book'] },
        );
        saveSessions([s]);
        expect(loadSessions()).toEqual([s]);
    });

    it('caps stored sessions and entries to the most recent', () => {
        const many = Array.from({ length: MAX_SESSIONS + 3 }, (_, i) => {
            const s = createSession();
            s.title = `s${i}`;
            return s;
        });
        const fat = createSession();
        fat.title = 'fat';
        fat.entries = Array.from({ length: MAX_ENTRIES + 20 }, (_, i) => ({
            id: `e${i}`, role: 'user' as const, text: `m${i}`, tools: [],
        }));
        saveSessions([...many, fat]);
        const loaded = loadSessions();
        expect(loaded).toHaveLength(MAX_SESSIONS);
        expect(loaded[loaded.length - 1].title).toBe('fat');
        expect(loaded[loaded.length - 1].entries).toHaveLength(MAX_ENTRIES);
        expect(loaded[loaded.length - 1].entries[0].id).toBe('e20');
    });

    it('survives corrupt storage as an empty list', () => {
        localStorage.setItem(storageKey(), '{not json');
        expect(loadSessions()).toEqual([]);
        localStorage.setItem(storageKey(), '[]');
        expect(loadSessions()).toEqual([]);
        localStorage.setItem(storageKey(), '"nope"');
        expect(loadSessions()).toEqual([]);
    });

    it('drops malformed entries instead of crashing', () => {
        const s = createSession();
        s.entries.push({ id: 'ok', role: 'user', text: 'hi', tools: [] });
        saveSessions([
            {
                ...s,
                entries: [
                    ...s.entries,
                    { id: 'bad-role', role: 'wizard', text: 'hi', tools: [] } as never,
                    { id: 'no-tools', role: 'ai', text: 'hi' } as never,
                    null as never,
                ],
            },
        ]);
        const [loaded] = loadSessions();
        expect(loaded.entries.map(e => e.id)).toEqual(['ok']);
    });

    it('keys storage per active user', () => {
        saveSessions([createSession()]);
        localStorage.setItem('last_active_user', uniqueUser());
        expect(loadSessions()).toEqual([]);
    });
});
