/**
 * OfflineQueueService profile gate (audit §2.5): every item is stamped with
 * the username at ENQUEUE time (explicit arg or the module's active user),
 * and processQueue replays ONLY the active user's items — another profile's
 * queued analysis must never run inside this session. A minimal in-memory
 * IndexedDB stub backs the store (jsdom has no IDB).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Active-user marker ───────────────────────────────────────────────────────

const { userRef } = vi.hoisted(() => ({ userRef: { current: 'marker-user' } }));
vi.mock('../utils/activeUser', () => ({
    getActiveUsername: () => userRef.current,
    LAST_ACTIVE_USER_KEY: 'last_active_user',
}));

// ── Minimal IndexedDB fake (insertion-ordered single store) ─────────────────

type Row = Record<string, unknown>;
const rows = new Map<string, Row>();

const makeReq = (fn: () => { result?: unknown; error?: unknown }): any => {
    const req: any = { onsuccess: null, onerror: null, result: undefined, error: undefined };
    setTimeout(() => {
        const r = fn();
        req.result = r.result;
        req.error = r.error;
        if (r.error) req.onerror?.();
        else req.onsuccess?.();
    }, 0);
    return req;
};

(globalThis as unknown as { indexedDB: unknown }).indexedDB = {
    open: () => {
        const req: any = { onsuccess: null, onerror: null, onupgradeneeded: null, result: null, error: null };
        setTimeout(() => {
            req.result = {
                objectStoreNames: { contains: () => true },
                createObjectStore: () => ({}),
                transaction: () => ({
                    objectStore: () => ({
                        add: (value: Row) => makeReq(() => {
                            const id = String(value.id);
                            if (rows.has(id)) return { error: new Error('constraint') };
                            rows.set(id, value);
                            return { result: id };
                        }),
                        getAll: () => makeReq(() => ({ result: [...rows.values()] })),
                        get: (id: string) => makeReq(() => ({ result: rows.get(id) })),
                        put: (value: Row) => makeReq(() => {
                            rows.set(String(value.id), value);
                            return { result: value.id };
                        }),
                        delete: (id: string) => makeReq(() => {
                            rows.delete(id);
                            return { result: undefined };
                        }),
                        clear: () => makeReq(() => {
                            rows.clear();
                            return { result: undefined };
                        }),
                    }),
                }),
            };
            req.onsuccess?.();
        }, 0);
        return req;
    },
};

import {
    offlineQueue,
    addToQueue,
    getAllQueued,
    getQueueCount,
    processQueue,
    clearQueueForUser,
    setActiveUser,
    type QueuedRequest,
} from '../services/infrastructure/OfflineQueueService';

beforeEach(async () => {
    // Empty the store by id (module keeps its db handle cached — same as a
    // warm app session across profile switches).
    for (const id of [...rows.keys()]) rows.delete(id);
    userRef.current = 'marker-user';
    setActiveUser('marker-user');
});

describe('OfflineQueueService user stamping + processing gate', () => {
    it('stamps the active user on enqueue when the caller passes none', async () => {
        setActiveUser('alice');
        await addToQueue({ type: 'analysis', payload: { prompt: 'go' } });
        const items = await getAllQueued();
        expect(items).toHaveLength(1);
        expect(items[0].username).toBe('alice');
    });

    it('honours an explicit username argument over the active marker', async () => {
        setActiveUser('alice');
        await addToQueue({ type: 'postMortem', payload: {}, username: 'bob' });
        const items = await getAllQueued();
        expect(items[0].username).toBe('bob');
    });

    it('processQueue replays only the ACTIVE user\u2019s items; others stay parked', async () => {
        await addToQueue({ type: 'analysis', payload: { who: 'alice' }, username: 'alice' });
        await addToQueue({ type: 'analysis', payload: { who: 'bob' }, username: 'bob' });
        setActiveUser('alice');

        const replayed: unknown[] = [];
        const res = await processQueue({ onAnalysis: async p => { replayed.push(p); } });

        expect(replayed).toEqual([{ who: 'alice' }]);
        expect(res).toEqual({ processed: 1, failed: 0, skipped: 1 });
        const remaining = await getAllQueued();
        expect(remaining.map(r => r.username)).toEqual(['bob']); // still queued for bob

        // …and bob's session gets it.
        setActiveUser('bob');
        const bobs: unknown[] = [];
        await processQueue({ onAnalysis: async p => { bobs.push(p); } });
        expect(bobs).toEqual([{ who: 'bob' }]);
        expect(await getAllQueued()).toHaveLength(0);
    });

    it('legacy items without a username are processed by whoever is active', async () => {
        rows.set('queue-legacy', {
            id: 'queue-legacy', type: 'analysis', payload: { old: true },
            createdAt: new Date(Date.now() - 60_000).toISOString(), retryCount: 0,
        } satisfies QueuedRequest);
        setActiveUser('alice');
        const ran: unknown[] = [];
        const res = await processQueue({ onAnalysis: async p => { ran.push(p); } });
        expect(ran).toEqual([{ old: true }]);
        expect(res.skipped).toBe(0);
    });

    it('getQueueCount can be scoped per user (badge honesty)', async () => {
        await addToQueue({ type: 'summary', payload: {}, username: 'alice' });
        await addToQueue({ type: 'summary', payload: {}, username: 'alice' });
        await addToQueue({ type: 'summary', payload: {}, username: 'bob' });
        expect(await getQueueCount()).toBe(3);
        expect(await getQueueCount('alice')).toBe(2);
        expect(await offlineQueue.getCount('bob')).toBe(1);
    });

    it('clearQueueForUser deletes only that profile\u2019s items', async () => {
        await addToQueue({ type: 'analysis', payload: {}, username: 'alice' });
        await addToQueue({ type: 'analysis', payload: {}, username: 'bob' });
        const removed = await clearQueueForUser('alice');
        expect(removed).toBe(1);
        expect((await getAllQueued()).map(i => i.username)).toEqual(['bob']);
    });

    it('offlineQueue namespace exposes the profile API the loader wires', () => {
        expect(typeof offlineQueue.setActiveUser).toBe('function');
        expect(typeof offlineQueue.clearForUser).toBe('function');
        offlineQueue.setActiveUser('gina');
        expect(offlineQueue.getActiveUser()).toBe('gina');
    });
});
