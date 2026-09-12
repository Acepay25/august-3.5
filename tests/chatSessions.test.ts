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

    it('panel sessions carry their seats and survive a round-trip', () => {
        const s = createSession('panel', [
            { providerId: 'gemini', modelId: 'a' },
            { providerId: 'x', modelId: 'b' },
        ]);
        s.entries.push({ id: 'a1', role: 'ai', text: 'answer', tools: [], speaker: 'gemini:a' });
        saveSessions([s]);
        const [loaded] = loadSessions();
        expect(loaded.kind).toBe('panel');
        expect(loaded.title).toBe('New panel');
        expect(loaded.panelModels).toEqual([
            { providerId: 'gemini', modelId: 'a' },
            { providerId: 'x', modelId: 'b' },
        ]);
        expect(loaded.entries[0].speaker).toBe('gemini:a');
    });

    it('sessions remember their chart setup, effort and solo model', () => {
        const s = createSession();
        s.symbol = 'solusdt';
        s.interval = '4h';
        s.effort = 'high';
        s.soloModel = 'gemini-2.5-flash';
        saveSessions([s]);
        const [loaded] = loadSessions();
        expect(loaded.symbol).toBe('SOLUSDT');
        expect(loaded.interval).toBe('4h');
        expect(loaded.effort).toBe('high');
        expect(loaded.soloModel).toBe('gemini-2.5-flash');
    });

    it('drops junk session-scoped fields instead of restoring them', () => {
        const raw = JSON.stringify([{
            id: 's-x', title: 'x', createdAt: 1, updatedAt: 1,
            entries: [], kind: 'solo',
            symbol: 42, interval: true, effort: 'ludicrous', soloModel: {},
        }]);
        localStorage.setItem(storageKey(), raw);
        const [loaded] = loadSessions();
        expect(loaded.symbol).toBeUndefined();
        expect(loaded.interval).toBeUndefined();
        expect(loaded.effort).toBeUndefined();
        expect(loaded.soloModel).toBeUndefined();
    });

    it('caps panel seats at 5 and drops malformed seat rows', () => {
        const s = createSession('panel', Array.from({ length: 8 }, (_, i) => ({ providerId: 'p', modelId: `m${i}` })));
        s.panelModels = [...(s.panelModels ?? []), { providerId: 1 as never, modelId: 'junk' }];
        saveSessions([s]);
        const [loaded] = loadSessions();
        expect(loaded.panelModels).toHaveLength(5);
        expect(loaded.panelModels!.every(m => m.providerId === 'p')).toBe(true);
    });

    it('bounds the per-entry thinking trace, actions and image', () => {
        const s = createSession();
        s.entries.push({
            id: 'a1', role: 'ai', text: 'x', tools: [],
            reasoning: 'r'.repeat(9000),
            actions: Array.from({ length: 60 }, (_, i) => ({ at: 'now', speaker: 'bot', tool: `t${i}`, ok: true, verb: 'created', label: 'l', review: '' })),
            image: 'data:image/png;base64,AAAA',
        });
        s.entries.push({ id: 'a2', role: 'ai', text: 'y', tools: [], image: 'https://evil.example/x.png' });
        s.entries.push({ id: 'a3', role: 'ai', text: 'z', tools: [], actions: [{ nope: true } as never] });
        saveSessions([s]);
        const [loaded] = loadSessions();
        expect(loaded.entries[0].reasoning).toHaveLength(4000);
        expect(loaded.entries[0].actions).toHaveLength(50);
        expect(loaded.entries[0].image).toBe('data:image/png;base64,AAAA');
        // A non-data-URL image never reaches storage; junk actions are dropped.
        expect(loaded.entries[1].image).toBeUndefined();
        expect(loaded.entries[2].actions).toEqual([]);
    });

    it('coach and group session kinds round-trip (roster surfaces in the dock)', () => {
        const coach = createSession('coach');
        coach.title = 'Coach inbox';
        const group = { ...createSession('group'), title: 'Macro room', groupId: 'g-1' };
        const botBound = { ...createSession('solo'), botId: 'bot-9' };
        saveSessions([coach, group, botBound]);
        const loaded = loadSessions();
        expect(loaded.map(s => s.kind)).toEqual(['coach', 'group', 'solo']);
        expect(loaded[1].groupId).toBe('g-1');
        expect(loaded[2].botId).toBe('bot-9');
    });

    it('an unknown stored kind falls back to solo, never a crash', () => {
        const s = createSession();
        (s as { kind?: string }).kind = 'wizard';
        saveSessions([s]);
        expect(loadSessions()[0].kind).toBe('solo');
    });
});
