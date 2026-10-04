/**
 * `trade_chat_active_v1_<user>` is deliberately NOT in any backup: chatStore.ts:160
 * writes a PLAIN session-id string, which the export sweep cannot JSON.parse (so it
 * exports nothing), and mirroring a parsed value would restore `"s-1"` where the
 * owner reads the bare `s-1`. Registering it would corrupt the pointer it was meant
 * to protect.
 *
 * So a restored install always lands here with no pointer, and the fallback is what
 * the trader actually sees. It has to open the conversation they were last in — not
 * crash, not an empty dock, and not the oldest chat on the device.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { getActiveId, __resetForTests } from '../services/trade/chatStore';
import { getActiveUsername, LAST_ACTIVE_USER_KEY } from '../utils/activeUser';

const USER = 'pointer-user';
const SESSIONS_KEY = `trade_chat_sessions_v1_${USER}`;

const session = (id: string, updatedAt: number, title = id) => ({
    id, title, createdAt: 1, updatedAt,
    entries: [{ id: `${id}-e1`, role: 'user', text: `text from ${title}`, tools: [] }],
});

beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(LAST_ACTIVE_USER_KEY, USER);
    __resetForTests();
    expect(getActiveUsername()).toBe(USER);
});

describe('the dock with no active-session pointer', () => {
    it('opens the most recently touched session, not the first row stored', () => {
        // Insertion order is oldest-first (`sessions = [...sessions, fresh]`), so
        // `sessions[0]` is the OLDEST chat — the fallback a returning trader would
        // never choose.
        localStorage.setItem(SESSIONS_KEY, JSON.stringify([
            session('s-old', 1000),
            session('s-middle', 3000),
            session('s-newest', 5000),
        ]));

        expect(getActiveId()).toBe('s-newest');
    });

    it('still honours a pointer that matches a session', () => {
        localStorage.setItem(SESSIONS_KEY, JSON.stringify([session('s-a', 1), session('s-b', 2)]));
        localStorage.setItem(`trade_chat_active_v1_${USER}`, 's-a');
        expect(getActiveId()).toBe('s-a');
    });

    it('ignores a pointer to a session that no longer exists', () => {
        localStorage.setItem(SESSIONS_KEY, JSON.stringify([session('s-a', 1), session('s-b', 9)]));
        localStorage.setItem(`trade_chat_active_v1_${USER}`, 's-deleted');
        expect(getActiveId()).toBe('s-b');
    });

    it('creates a session rather than showing an empty dock', () => {
        // No sessions key at all — a fresh install or a restore that carried none.
        const id = getActiveId();
        expect(id).toBeTruthy();
        expect(JSON.parse(localStorage.getItem(SESSIONS_KEY) ?? '[]')).toEqual(expect.any(Array));
    });

    it('survives a corrupt sessions row', () => {
        localStorage.setItem(SESSIONS_KEY, '{not json');
        expect(() => getActiveId()).not.toThrow();
        expect(getActiveId()).toBeTruthy();
    });
});
