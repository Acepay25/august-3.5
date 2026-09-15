/**
 * Offline queue completion contract (audit 2026-09-15 §2.3): App's
 * onAnalysis replay callback used to START handleSendMessage without
 * awaiting it, so processQueue — which awaits the callback before removing
 * the item — resolved at the run's FIRST internal await and dequeued while
 * the analysis had merely begun (failed runs vanished from the queue).
 *
 * Service-level behavior tests prove the contract processQueue enforces,
 * and source scans pin App's callback to `return handleSendMessage(...)`
 * (the completion promise) plus the explicit username stamp at the
 * pipeline's enqueue site. IDB fake mirrors tests/offlineQueueProfile.test.ts.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';

const appSrc = readFileSync('App.tsx', 'utf8');
const pipelineSrc = readFileSync('hooks/useAnalysisPipeline.ts', 'utf8');

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
    addToQueue,
    getAllQueued,
    processQueue,
    setActiveUser,
} from '../services/infrastructure/OfflineQueueService';

beforeEach(async () => {
    for (const id of [...rows.keys()]) rows.delete(id);
    userRef.current = 'alice';
    setActiveUser('alice');
});

describe('processQueue awaits the replay callback to COMPLETION', () => {
    it('item stays queued while the analysis run is still pending; removed once it resolves', async () => {
        await addToQueue({ type: 'analysis', payload: { prompt: 'go' }, username: 'alice' });

        let finishRun!: () => void;
        const runDone = new Promise<void>(resolve => { finishRun = resolve; });
        const resPromise = processQueue({
            // Same contract App wires: the callback RETURNS the run's
            // promise (handleSendMessage resolves at end-of-run).
            onAnalysis: async () => runDone,
        });

        // Let the callback start + the first dequeue checks settle.
        await new Promise(r => setTimeout(r, 30));
        expect(rows.size).toBe(1);          // still queued — run merely started
        expect((await getAllQueued())[0].retryCount).toBe(0);

        finishRun();                         // end-of-run signal
        const res = await resPromise;
        expect(res).toEqual({ processed: 1, failed: 0, skipped: 0 });
        expect(await getAllQueued()).toHaveLength(0); // removed ONLY after completion
    });

    it('a rejected callback (run threw) keeps the item for the retry/backoff path', async () => {
        await addToQueue({ type: 'analysis', payload: { prompt: 'go' }, username: 'alice' });

        const results = await processQueue({
            onAnalysis: async () => { throw new Error('dispatch failed'); },
        });

        expect(results.failed).toBe(1);
        const items = await getAllQueued();
        expect(items).toHaveLength(1);               // NOT consumed
        expect(items[0].retryCount).toBe(1);         // retry path ran
        expect(items[0].lastAttempt).toBeTruthy();
    });

    it('a successful completion removes the item and reports processed', async () => {
        await addToQueue({ type: 'analysis', payload: { prompt: 'go' }, username: 'alice' });
        const results = await processQueue({ onAnalysis: async () => undefined });
        expect(results).toEqual({ processed: 1, failed: 0, skipped: 0 });
        expect(await getAllQueued()).toHaveLength(0);
    });
});

describe('App/pipeline wiring of the queue contract (source)', () => {
    it('App RE-TURNS the handleSendMessage promise from onAnalysis (awaits end-of-run)', () => {
        expect(appSrc).toMatch(/return handleSendMessage\(payload\?\.prompt \|\| '', images\);/);
        // The old fire-and-forget shape must not come back.
        expect(appSrc).not.toMatch(/^\s*handleSendMessage\(payload\?\.prompt/m);
    });

    it('the pipeline enqueue site stamps the username explicitly', () => {
        expect(pipelineSrc).toMatch(/offlineQueue\.add\(\{[^}]*username: getActiveUsername\(\)/);
    });
});
