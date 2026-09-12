/**
 * supervisorStore — the live state behind the supervisor indicator + panel:
 * honest phases, a bounded event log, streamed-text patches, decisions with
 * user overrides, and a per-user persisted automation toggle.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as store from '../services/learning/supervisorStore';
import { getActiveUsername } from '../utils/activeUser';

beforeEach(() => {
    store.__resetForTests();
    localStorage.clear();
});

describe('supervisorStore', () => {
    it('phases + activity update the snapshot; setRunning(false) returns to idle', () => {
        store.setPhase('reviewing', 'Reviewing “pin bar”');
        expect(store.getSnapshot().phase).toBe('reviewing');
        expect(store.getSnapshot().activity).toBe('Reviewing “pin bar”');
        store.setRunning(true);
        expect(store.getSnapshot().running).toBe(true);
        store.setRunning(false);
        expect(store.getSnapshot().running).toBe(false);
        expect(store.getSnapshot().phase).toBe('idle');
    });

    it('events are capped and stream patches land on the right event', () => {
        for (let i = 0; i < 100; i += 1) store.pushEvent({ phase: 'reviewing', text: `event ${i}` });
        expect(store.getSnapshot().events.length).toBe(80);
        expect(store.getSnapshot().events[79].text).toBe('event 99');
        const id = store.getSnapshot().events[79].id;
        store.patchEvent(id, { streamText: 'partial verdict…', streaming: true });
        expect(store.getSnapshot().events.find(e => e.id === id)?.streamText).toBe('partial verdict…');
        store.setDecision(id, { verdict: 'approved', reason: 'solid', atMs: Date.now() });
        const decided = store.getSnapshot().events.find(e => e.id === id);
        expect(decided?.decision?.verdict).toBe('approved');
        expect(decided?.streaming).toBe(false);
    });

    it('markOverridden flips the verdict and records the user', () => {
        const id = store.pushEvent({ phase: 'deciding', text: 'x' });
        store.setDecision(id, { verdict: 'approved', reason: 'model liked it', atMs: Date.now() });
        store.markOverridden(id, 'rejected');
        const ev = store.getSnapshot().events.find(e => e.id === id);
        expect(ev?.decision?.verdict).toBe('rejected');
        expect(ev?.decision?.overriddenByUser).toBe(true);
    });

    it('the automation toggle persists per user', () => {
        store.setAutoEnabled(false);
        expect(store.isAutoEnabled()).toBe(false);
        expect(localStorage.getItem(`supervisor_auto_v1_${getActiveUsername()}`)).toBe('0');
        store.__resetForTests();
        expect(store.isAutoEnabled()).toBe(false); // reloaded from storage
        store.setAutoEnabled(true);
    });
});
