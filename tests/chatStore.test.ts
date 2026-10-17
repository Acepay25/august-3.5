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

describe('the composer values shared by both chat homes', () => {
    // The Chart AI dock and the Chat surface render the same two chips over the
    // same session row. The dock unmounts when you hop, so anything kept in its
    // component state is invisible to the other home — these writers exist so
    // the row, not the component, is the answer.
    it('reads auto for a session that never chose a tier', () => {
        expect(store.getActiveEffort()).toBe('auto');
    });

    it('setActiveEffort lands on the active row and is what the store now reads', () => {
        store.setActiveEffort('high');
        expect(store.getActiveEffort()).toBe('high');
        expect(active()?.effort).toBe('high');
    });

    it('is per session, and follows the active one', () => {
        const first = store.getActiveId();
        store.setActiveEffort('max');
        const second = store.addSession({ title: 'B' });
        // A new chat starts with the composer as it stands — then it is its own
        // choice, and the two rows must not follow each other.
        expect(store.getActiveEffort()).toBe('max');
        store.setActiveEffort('low');
        store.setActiveId(first);
        expect(store.getActiveEffort()).toBe('max');
        store.setActiveId(second);
        expect(store.getActiveEffort()).toBe('low');
    });

    it('a tier change notifies subscribers, and a repeat does not write again', () => {
        const seen: string[] = [];
        const off = store.subscribe(() => seen.push(store.getActiveEffort()));
        store.setActiveEffort('high');
        store.setActiveEffort('high');
        off();
        // One emit for one real change: the guard is what keeps App's
        // subscription from re-rendering on every repeat click.
        expect(seen).toEqual(['high']);
    });

    it('setActiveSoloModel binds the pick to a solo session', () => {
        store.setActiveSoloModel('gemini::gemini-2.5-flash');
        expect(active()?.soloModel).toBe('gemini::gemini-2.5-flash');
    });

    it('leaves a panel session alone — its seats are the model choice', () => {
        store.addSession({ kind: 'panel', title: 'Panel' });
        store.setActiveSoloModel('x::y');
        expect(active()?.soloModel).toBeUndefined();
    });

    it('a chat minted mid-run inherits the composer, not the chart', () => {
        // The Chat surface's send lands in a fresh App conversation, and
        // `bindConversation` mints a row for it. A row that inherits nothing
        // resets the dock's dial to Auto under a trader who just picked High.
        store.setActiveEffort('high');
        store.setActiveSoloModel('gemini::gemini-2.5-flash');
        // Not blank any more, so bindConversation must CREATE a row rather than
        // adopt this one — creation is the path that used to lose the dial.
        store.mutate(store.getActiveId(), s => ({ ...s, entries: [{ id: 'u1', role: 'user', text: 'x', tools: [] }] }));
        const id = store.bindConversation('conv-1');
        const row = store.getSnapshot().sessions.find(s => s.id === id);
        expect(row?.conversationId).toBe('conv-1');
        expect(row?.effort).toBe('high');
        expect(row?.soloModel).toBe('gemini::gemini-2.5-flash');
        // The instrument is NOT inherited: only the dock's own New-chat passes a
        // chart setup, and a bot opened with { botId } must not adopt the coin
        // that happened to be on screen.
        expect(row?.symbol).toBeUndefined();
    });

    it('an explicit choice on the new row beats the inherited one', () => {
        store.setActiveEffort('high');
        const id = store.addSession({ effort: 'off' });
        expect(store.getSnapshot().sessions.find(s => s.id === id)?.effort).toBe('off');
    });

    it('says so when a write lands on an id the store does not hold', () => {
        // Silent is the worst shape here: a send into a stale id appends no row,
        // throws nothing, and leaves a bubble streaming forever. The trader's
        // only symptom is "it never answered", which blames the provider.
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        store.mutate('session-that-was-never-created', s => ({ ...s, title: 'nope' }));
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('unknown session'));
        warn.mockRestore();
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
    it('persists settled entries even while another entry streams (no deadlock)', () => {
        vi.useFakeTimers();
        const a = store.getActiveId();
        store.beginRun(a, new AbortController());
        store.mutate(a, s => ({ ...s, entries: [{ id: 'u', role: 'user', text: 'q', tools: [] }, { id: 'ai', role: 'ai', text: 'partial', tools: [], streaming: true }] }));
        // The fix: a still-streaming entry is EXCLUDED from the write, but it
        // must NOT block the rest. Previously any streaming flag re-armed the
        // persist forever, so one stuck bubble froze EVERY session's history.
        vi.advanceTimersByTime(1000);
        const mid = JSON.parse(localStorage.getItem(storageKey()) ?? '[]');
        const midEntries = mid.find((x: { id: string }) => x.id === a).entries;
        expect(midEntries.map((e: { id: string }) => e.id)).toEqual(['u']); // settled user entry lands
        expect(midEntries.find((e: { id: string }) => e.id === 'ai')).toBeUndefined(); // half answer never stored
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

// Memory mirrors trimForStorage (chatSessions): 12 sessions × 60 entries.
// The live store used to be uncapped, so a long-lived terminal's memory
// grew while disk stayed flat — the caps keep both honest.
describe('chatStore memory caps (mirror trimForStorage)', () => {
    it('addSession keeps at most MAX_SESSIONS sessions, dropping the oldest idle ones', () => {
        const first = store.getActiveId();
        for (let i = 0; i < 13; i += 1) store.addSession({ title: `s${i}` });
        const ids = store.getSnapshot().sessions.map(s => s.id);
        expect(ids.length).toBe(12);
        expect(ids).not.toContain(first); // oldest idle evicted
    });

    it('a session with a live run is not evicted while idle candidates exist', () => {
        const seeded = store.getSnapshot().sessions.map(s => s.id);
        const ctrl = new AbortController();
        store.beginRun(seeded[0], ctrl); // the OLDEST session is running
        for (let i = 0; i < 13; i += 1) store.addSession({ title: `s${i}` });
        const ids = store.getSnapshot().sessions.map(s => s.id);
        expect(ids.length).toBe(12);
        expect(ids).toContain(seeded[0]); // the running one survives
        expect(ids).not.toContain(seeded[1]); // its idle neighbor was evicted instead
    });

    it('mutate keeps at most MAX_ENTRIES entries per session, keeping the most recent', () => {
        const id = store.getActiveId();
        for (let i = 0; i < 70; i += 1) {
            store.mutate(id, s => ({ ...s, entries: [...s.entries, { id: `e${i}`, role: 'user' as const, text: `t${i}`, tools: [] }] }));
        }
        const entries = store.getSnapshot().sessions.find(s => s.id === id)?.entries ?? [];
        expect(entries.length).toBe(60);
        expect(entries[0].id).toBe('e10'); // the 10 oldest were dropped
        expect(entries[59].id).toBe('e69');
    });
});
