/**
 * chatStore — the Chart AI dock's session state lives OUTSIDE React so an
 * in-flight answer survives a surface switch. The load-bearing guarantees:
 * switching the active session never aborts another session's run (only an
 * explicit Stop or delete does), the running map tracks live streams, and
 * persistence strips streaming flags.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as store from '../services/trade/chatStore';
import { storageKey } from '../services/trade/chatSessions';

// The store persists per ACTIVE user — swap the marker from one place so
// the user-switch tests can flip identities mid-suite.
const { userRef } = vi.hoisted(() => ({ userRef: { current: 'alice' } }));
vi.mock('../utils/activeUser', () => ({
    getActiveUsername: () => userRef.current,
    LAST_ACTIVE_USER_KEY: 'last_active_user',
}));

beforeEach(() => {
    store.__resetForTests();
    localStorage.clear();
    userRef.current = 'alice';
});

const active = () => store.getSnapshot().sessions.find(s => s.id === store.getSnapshot().activeId);

describe('chatStore sessions', () => {
    it('seeds one session and tracks the active id', () => {
        const snap = store.getSnapshot();
        expect(snap.sessions.length).toBeGreaterThanOrEqual(1);
        expect(snap.activeId).toBe(snap.sessions[0].id);
    });

    it('addSession appends + activates, returning the new id', () => {
        const before = store.getSnapshot().sessions.length;
        const id = store.addSession({ kind: 'panel', title: 'Panel' });
        const snap = store.getSnapshot();
        expect(snap.sessions.length).toBe(before + 1);
        expect(snap.activeId).toBe(id);
        expect(snap.sessions.find(s => s.id === id)?.kind).toBe('panel');
    });

    it('mutate updates a session immutably and rebuilds the snapshot', () => {
        const id = store.getActiveId();
        const before = store.getSnapshot();
        store.mutate(id, s => ({ ...s, entries: [...s.entries, { id: 'u1', role: 'user', text: 'hi', tools: [] }] }));
        const after = store.getSnapshot();
        expect(after).not.toBe(before);
        expect(active()?.entries.map(e => e.text)).toEqual(['hi']);
    });

    it('removeSession aborts that session and keeps at least one alive', () => {
        const a = store.getActiveId();
        const b = store.addSession({ title: 'B' });
        const ctrl = new AbortController();
        store.beginRun(b, ctrl);
        expect(ctrl.signal.aborted).toBe(false);
        const newActive = store.removeSession(b);
        expect(ctrl.signal.aborted).toBe(true);
        expect(store.getSnapshot().sessions.find(s => s.id === b)).toBeUndefined();
        expect(newActive).toBe(a);
        // Deleting the last session leaves a fresh one.
        store.removeSession(a);
        expect(store.getSnapshot().sessions.length).toBe(1);
    });
});

describe('chatStore run survival (the tab-switch fix)', () => {
    it('switching the active session does NOT abort another session run', () => {
        const a = store.getActiveId();
        const b = store.addSession({ title: 'B' });
        const ctrlA = new AbortController();
        store.beginRun(a, ctrlA);
        // User switches to B (surface switch or session tab) — A keeps running.
        store.setActiveId(b);
        expect(ctrlA.signal.aborted).toBe(false);
        expect(store.getSnapshot().running[a]).toBe(true);
        // A's stream can still write into the store while B is active.
        store.mutate(a, s => ({ ...s, entries: [{ id: 'x', role: 'ai', text: 'streamed', tools: [] }] }));
        expect(store.getSnapshot().sessions.find(s => s.id === a)?.entries[0].text).toBe('streamed');
    });

    it('abortActive aborts only the active session run', () => {
        const a = store.getActiveId();
        const b = store.addSession({ title: 'B' });
        const ctrlA = new AbortController();
        const ctrlB = new AbortController();
        store.beginRun(a, ctrlA);
        store.beginRun(b, ctrlB);
        store.setActiveId(a);
        store.abortActive();
        expect(ctrlA.signal.aborted).toBe(true);
        expect(ctrlB.signal.aborted).toBe(false);
    });

    it('endRun clears the running flag', () => {
        const a = store.getActiveId();
        store.beginRun(a, new AbortController());
        expect(store.getSnapshot().running[a]).toBe(true);
        store.endRun(a);
        expect(store.getSnapshot().running[a]).toBeUndefined();
    });
});

describe('chatStore persistence', () => {
    it('saves settled sessions and strips streaming flags', () => {
        vi.useFakeTimers();
        const a = store.getActiveId();
        store.beginRun(a, new AbortController());
        store.mutate(a, s => ({ ...s, entries: [{ id: 'u', role: 'user', text: 'q', tools: [] }, { id: 'ai', role: 'ai', text: 'partial', tools: [], streaming: true }] }));
        // While a stream runs, persistence defers.
        vi.advanceTimersByTime(1000);
        expect(localStorage.getItem(storageKey())).toBeNull();
        // Settle the run → the streaming flag is stripped before storage.
        store.mutate(a, s => ({ ...s, entries: s.entries.map(e => ({ ...e, streaming: false })) }));
        store.endRun(a);
        vi.advanceTimersByTime(1000);
        const saved = JSON.parse(localStorage.getItem(storageKey()) ?? '[]');
        const savedAi = saved.find((x: { id: string }) => x.id === a).entries.find((e: { id: string }) => e.id === 'ai');
        expect(savedAi.text).toBe('partial');
        expect(savedAi.streaming).toBeUndefined();
        vi.useRealTimers();
    });

    it('persists the last-active session and restores it on rehydrate', () => {
        vi.useFakeTimers();
        const a = store.getActiveId();
        store.addSession({ title: 'B' });
        store.setActiveId(a); // last-open = a, NOT the newest session
        vi.advanceTimersByTime(1000); // the debounced persist also writes the active key
        expect(localStorage.getItem('trade_chat_active_v1_alice')).toBe(a);
        // A fresh store (reload / surface remount) returns to the session the
        // user actually left open, not sessions[0].
        store.__resetForTests();
        expect(store.getActiveId()).toBe(a);
        vi.useRealTimers();
    });

    it('a user switch RELOADS instead of leaking the old chats into the new key', () => {
        vi.useFakeTimers();
        const a = store.getActiveId();
        store.mutate(a, s => ({ ...s, title: 'Alice chat', entries: [{ id: 'u', role: 'user', text: 'hi alice', tools: [] }] }));
        vi.advanceTimersByTime(1000);
        expect(JSON.parse(localStorage.getItem('trade_chat_sessions_v1_alice') ?? '[]')[0].title).toBe('Alice chat');

        // The user switches. The debounced persist must NOT write Alice's
        // sessions into Bob's key — it rehydrates from his (empty) key.
        userRef.current = 'bob';
        store.mutate(a, s => ({ ...s, title: 'still alice' }));
        vi.advanceTimersByTime(1000);

        expect(localStorage.getItem('trade_chat_sessions_v1_bob')).toBeNull();
        const snap = store.getSnapshot();
        expect(snap.sessions.some(s => s.title === 'Alice chat')).toBe(false);
        expect(snap.sessions.length).toBe(1); // a fresh session for bob
        // Alice's stored chat is untouched.
        expect(JSON.parse(localStorage.getItem('trade_chat_sessions_v1_alice') ?? '[]')[0].title).toBe('Alice chat');
        vi.useRealTimers();
    });

    it('picks up another window\'s write via the storage event while idle', () => {
        store.getSnapshot(); // force the first load so the listener is live
        const foreign = [{ id: 's-x', title: 'From the other window', createdAt: 1, updatedAt: 1, entries: [] }];
        // A real storage event fires AFTER the shared value is already written
        // (localStorage is per-origin, so the other window's write landed here).
        localStorage.setItem(storageKey(), JSON.stringify(foreign));
        window.dispatchEvent(new StorageEvent('storage', {
            key: storageKey(),
            newValue: JSON.stringify(foreign),
        }));
        expect(store.getSnapshot().sessions.map(s => s.id)).toEqual(['s-x']);
    });
});

describe('chatStore harness signal queue (store-based so hits never drop)', () => {
    it('queue → visible in the snapshot; take drains and re-emits; capped at 8', () => {
        expect(store.getSnapshot().signals).toEqual([]);
        store.queueHarnessSignal('[HARNESS SIGNAL] TP1 hit');
        expect(store.getSnapshot().signals).toEqual(['[HARNESS SIGNAL] TP1 hit']);
        expect(store.takeHarnessSignals()).toEqual(['[HARNESS SIGNAL] TP1 hit']);
        expect(store.getSnapshot().signals).toEqual([]);
        expect(store.takeHarnessSignals()).toEqual([]);
        for (let i = 0; i < 12; i += 1) store.queueHarnessSignal(`sig-${i}`);
        const q = store.getSnapshot().signals;
        expect(q.length).toBe(8);
        expect(q[q.length - 1]).toBe('sig-11');
    });
});
