/**
 * messageImageStore — the GC + write short-circuit contract:
 *  · putMessageImages must SKIP the IndexedDB write when the payload is
 *    unchanged since the last committed write/read (the profile heartbeat
 *    re-strips the same images every 15s — each one used to be a multi-MB
 *    put), and must WRITE again after the payload changes.
 *  · deleteMessageImages / deleteMessageImagesForConversations must remove
 *    every `convId__msgId` row of the given conversation(s) — the store had
 *    no delete path at all, so deleted conversations leaked their blobs
 *    forever — and must purge the fingerprints, so re-putting the same
 *    images afterwards (undo of a clear-all, a restored backup) writes
 *    fresh rows instead of short-circuiting against a deleted one.
 *
 * IndexedDB is not implemented in jsdom, so a minimal fake backs the store:
 * effects land synchronously, tx/request callbacks fire on the next
 * macrotask (the real callbacks are async, and the store assigns
 * oncomplete/onsuccess AFTER calling the op method — a synchronous callback
 * would run before it was assigned). Each test uses a UNIQUE conversation
 * id: the module's session read-cache is a module singleton with no test
 * reset, so a reused id would read a previous test's cached row.
 */

import { describe, it, expect, beforeEach } from 'vitest';

// jsdom has neither indexedDB nor IDBKeyRange — provide both before the
// store module is imported.
type Bound = { lower: string; upper: string };
(globalThis as Record<string, unknown>).IDBKeyRange = {
    bound: (lo: string, hi: string): Bound => ({ lower: lo, upper: hi }),
};

interface Row { key: string; images: string[]; updatedAt: number }

const rows = new Map<string, Row>();
let putCount = 0;
let deleteCount = 0;

const keyInRange = (key: string, range: Bound): boolean => key >= range.lower && key <= range.upper;

const later = (fn: () => void): void => { setTimeout(fn, 0); };

const fakeObjectStore = {
    put: (row: Row): void => { rows.set(row.key, { ...row }); putCount += 1; },
    get: (key: string): unknown => {
        const req: { result?: Row; onsuccess?: () => void; onerror?: () => void } = {};
        later(() => { req.result = rows.get(key); req.onsuccess?.(); });
        return req;
    },
    getAll: (range?: Bound): unknown => {
        const req: { result?: Row[]; onsuccess?: () => void; onerror?: () => void } = {};
        later(() => {
            req.result = [...rows.values()].filter(r => !range || keyInRange(r.key, range));
            req.onsuccess?.();
        });
        return req;
    },
    delete: (keyOrRange: string | Bound): void => {
        if (typeof keyOrRange === 'string') rows.delete(keyOrRange);
        else for (const k of [...rows.keys()]) if (keyInRange(k, keyOrRange)) rows.delete(k);
        deleteCount += 1;
    },
};

const fakeDb = {
    objectStoreNames: { contains: (): boolean => true },
    createObjectStore: (): void => {},
    transaction: (): { objectStore: () => typeof fakeObjectStore; oncomplete: (() => void) | null; onerror: (() => void) | null; onabort: (() => void) | null } => {
        const tx = {
            objectStore: () => fakeObjectStore,
            oncomplete: null as (() => void) | null,
            onerror: null as (() => void) | null,
            onabort: null as (() => void) | null,
        };
        // Fire AFTER the synchronous op block: the store's promise wrapper
        // assigns oncomplete right after calling the op methods.
        later(() => { tx.oncomplete?.(); });
        return tx;
    },
};

let openRequest: { result: unknown; onupgradeneeded: (() => void) | null; onsuccess: (() => void) | null; onerror: (() => void) | null } | null = null;
(globalThis as Record<string, unknown>).indexedDB = {
    open: (): unknown => {
        openRequest = {
            result: fakeDb,
            onupgradeneeded: null,
            onsuccess: null,
            onerror: null,
        };
        later(() => {
            openRequest?.onupgradeneeded?.();
            openRequest?.onsuccess?.();
        });
        return openRequest;
    },
};

const flush = (): Promise<void> => new Promise(resolve => { setTimeout(resolve, 5); });

import {
    putMessageImages, getMessageImages, getConversationImages,
    deleteMessageImages, deleteMessageImagesForConversations,
} from '../services/infrastructure/messageImageStore';

const img = (n: number): string => `data:image/png;base64,${'A'.repeat(64)}${n}${'B'.repeat(64)}`;

beforeEach(() => {
    rows.clear();
    putCount = 0;
    deleteCount = 0;
});

describe('messageImageStore write short-circuit', () => {
    it('stores once, then skips the IDB put for an unchanged payload', async () => {
        expect(await putMessageImages('c-put', 'm1', [img(1)])).toBe(true);
        expect(putCount).toBe(1);
        // Heartbeat re-save with the SAME images: no second write, still true
        // (the strip path relies on true meaning "stored").
        expect(await putMessageImages('c-put', 'm1', [img(1)])).toBe(true);
        expect(putCount).toBe(1);
        // A changed payload writes again.
        expect(await putMessageImages('c-put', 'm1', [img(1), img(2)])).toBe(true);
        expect(putCount).toBe(2);
        // And the store really holds the latest images.
        expect((await getMessageImages('c-put', 'm1'))?.length).toBe(2);
    });

    it('seeds the fingerprint from a read, so a reload does not force one full re-put', async () => {
        rows.set('c-read__m1', { key: 'c-read__m1', images: [img(1)], updatedAt: 1 });
        expect(await getMessageImages('c-read', 'm1')).toEqual([img(1)]);
        expect(await putMessageImages('c-read', 'm1', [img(1)])).toBe(true);
        expect(putCount).toBe(0); // short-circuited against the read-back row
    });

    it('getConversationImages seeds fingerprints the same way', async () => {
        rows.set('c-batch__m1', { key: 'c-batch__m1', images: [img(1)], updatedAt: 1 });
        rows.set('c-batch__m2', { key: 'c-batch__m2', images: [img(2)], updatedAt: 2 });
        const all = await getConversationImages('c-batch');
        expect(Object.keys(all).sort()).toEqual(['m1', 'm2']);
        await putMessageImages('c-batch', 'm1', [img(1)]);
        await putMessageImages('c-batch', 'm2', [img(2)]);
        expect(putCount).toBe(0);
    });
});

describe('messageImageStore GC (the missing delete path)', () => {
    it('deleteMessageImages removes only that conversation\'s rows', async () => {
        await putMessageImages('c-del', 'm1', [img(1)]);
        await putMessageImages('c-keep', 'm9', [img(9)]);
        await deleteMessageImages('c-del');
        await flush();
        expect(await getMessageImages('c-del', 'm1')).toBeUndefined();
        expect(await getMessageImages('c-keep', 'm9')).toEqual([img(9)]);
        expect(deleteCount).toBe(1);
    });

    it('purges the fingerprint: re-putting identical images writes a fresh row', async () => {
        await putMessageImages('c-undo', 'm1', [img(1)]);
        expect(putCount).toBe(1);
        await deleteMessageImages('c-undo');
        const before = putCount;
        // The undo-of-clear-all / backup-restore path: same payload again.
        expect(await putMessageImages('c-undo', 'm1', [img(1)])).toBe(true);
        expect(putCount).toBe(before + 1);
        expect(await getMessageImages('c-undo', 'm1')).toEqual([img(1)]);
    });

    it('deleteMessageImagesForConversations GCs several conversations in one call', async () => {
        await putMessageImages('c-b1', 'm1', [img(1)]);
        await putMessageImages('c-b3', 'm3', [img(3)]);
        await putMessageImages('c-bkeep', 'mk', [img(4)]);
        await deleteMessageImagesForConversations(['c-b1', 'c-b3', '', 'c-b1']);
        await flush();
        expect(await getMessageImages('c-b1', 'm1')).toBeUndefined();
        expect(await getMessageImages('c-b3', 'm3')).toBeUndefined();
        expect(await getMessageImages('c-bkeep', 'mk')).toEqual([img(4)]);
    });
});
