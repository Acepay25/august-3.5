/**
 * Offline queue completion contract (audit 2026-09-15 §2.3): App's
 * onAnalysis replay callback used to START handleSendMessage without
 * awaiting it, so processQueue — which awaits the callback before removing
 * the item — resolved at the run's FIRST internal await and dequeued while
 * the analysis had merely begun (failed runs vanished from the queue).
 *
 * Service-level behavior tests prove the contract processQueue enforces,
 * the ok:false-resolution tests prove App's outcome→throw mapping routes a
 * silently-failed replay into the retry path, and source scans pin App's
 * callback to `await handleSendMessage(...)` + `throw` (the ChatRunOutcome
 * contract) plus the explicit username stamp at the pipeline's enqueue
 * site. IDB fake mirrors tests/offlineQueueProfile.test.ts.
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

describe('replayed run FAILURE reaches the retry path (ChatRunOutcome)', () => {
    // handleSendMessage catches an internally-failed analysis (error bubble,
    // 429, quota, config block) and RESOLVES — resolving is not succeeding.
    // The completion contract alone would dequeue that dead run. The fix:
    // the run resolves with { ok } and App's onAnalysis maps ok:false to a
    // THROW, so processQueue's existing retryCount/backoff/MAX_RETRIES path
    // applies. Service-level: prove the App-shaped wrapper behaves exactly
    // like the rejection test above for an ok:false resolution, and keeps
    // the dequeue behavior for ok:true / undefined resolutions.
    const appShapedCallback = (run: () => Promise<{ ok: boolean }>) => async () => {
        const outcome = await run();
        if (outcome && outcome.ok === false) {
            throw new Error('Queued analysis replay failed — deferring to the retry/backoff path.');
        }
    };

    it('an ok:false resolution (failed run, no throw) stays queued with the retry path armed', async () => {
        await addToQueue({ type: 'analysis', payload: { prompt: 'go' }, username: 'alice' });
        let ran = 0;
        const results = await processQueue({
            onAnalysis: appShapedCallback(async () => { ran++; return { ok: false }; }),
        });
        expect(ran).toBe(1);
        expect(results.failed).toBe(1);
        const items = await getAllQueued();
        expect(items).toHaveLength(1);               // NOT consumed
        expect(items[0].retryCount).toBe(1);         // backoff armed
        expect(items[0].lastAttempt).toBeTruthy();
    });

    it('an ok:true resolution completes and dequeues as before', async () => {
        await addToQueue({ type: 'analysis', payload: { prompt: 'go' }, username: 'alice' });
        const results = await processQueue({
            onAnalysis: appShapedCallback(async () => ({ ok: true })),
        });
        expect(results).toEqual({ processed: 1, failed: 0, skipped: 0 });
        expect(await getAllQueued()).toHaveLength(0);
    });

    it('backoff then final drop: MAX_RETRIES still bounds a permanently-failing replay', async () => {
        await addToQueue({ type: 'analysis', payload: { prompt: 'go' }, username: 'alice' });
        // Burn attempts by backdating lastAttempt past every required delay.
        // (The IDB fake hands out the stored reference, so mutating the
        // returned item IS mutating the row — and the service's
        // post-increment >= MAX_RETRIES check fires on the attempt that takes
        // retryCount to 5 — four failures must leave the item parked.)
        for (let attempt = 0; attempt < 4; attempt++) {
            const [item] = await getAllQueued();
            if (!item) break;
            item.lastAttempt = new Date(Date.now() - 10 * 60_000).toISOString();
            await processQueue({ onAnalysis: appShapedCallback(async () => ({ ok: false })) });
        }
        const [item] = await getAllQueued();
        expect(item).toBeTruthy();
        expect(item.retryCount).toBe(4);
        // The next failure hits MAX_RETRIES and removes the item.
        item.lastAttempt = new Date(Date.now() - 10 * 60_000).toISOString();
        await processQueue({ onAnalysis: appShapedCallback(async () => ({ ok: false })) });
        expect(await getAllQueued()).toHaveLength(0); // exhausted, dropped
    });
});

describe('App/pipeline wiring of the queue contract (source)', () => {
    it('App awaits handleSendMessage and THROWS on ok:false (failure retries, not vanishes)', () => {
        expect(appSrc).toMatch(/const outcome = await handleSendMessage\(payload\?\.prompt \|\| '', images\);/);
        expect(appSrc).toMatch(/if \(outcome && outcome\.ok === false\) \{/);
        // The old fire-and-forget shape must not come back…
        expect(appSrc).not.toMatch(/^\s*handleSendMessage\(payload\?\.prompt/m);
        // …and neither must the old resolve-and-dequeue return (completion
        // without the outcome check silently loses failed replays).
        expect(appSrc).not.toMatch(/return handleSendMessage\(payload\?\.prompt \|\| '', images\);/);
    });

    it('the pipeline enqueue site stamps the username explicitly', () => {
        expect(pipelineSrc).toMatch(/offlineQueue\.add\(\{[^}]*username: getActiveUsername\(\)/);
    });

    it('handleSendMessage declares the outcome and flags the catch failure paths', () => {
        // Public signature: the run resolves with a ChatRunOutcome.
        expect(pipelineSrc).toMatch(/\}\): Promise<ChatRunOutcome> => \{/);
        expect(pipelineSrc).toMatch(/export interface ChatRunOutcome \{\s*\n\s*ok: boolean;/);
        // End of try = success; end of catch (generic error bubble) = failure.
        // Slice from the MAIN run's catch (there are smaller inner catches).
        const catchAt = pipelineSrc.indexOf('const cancelled = currentAbortController');
        expect(catchAt).toBeGreaterThan(-1);
        expect(pipelineSrc.slice(0, catchAt))
            .toMatch(/return \{ ok: true \};\s*\n\s*\} catch \(error: any\) \{/);
        expect(pipelineSrc.slice(catchAt))
            .toMatch(/return \{ ok: false \};\s*\n\s*\} finally \{/);
        // The transient/config arms inside the catch report ok:false too…
        expect(pipelineSrc.slice(catchAt))
            .toMatch(/\/\/ Transient — a queued replay must RETRY with backoff\.\s*\n\s*return \{ ok: false \};/);
        // …while cancellation and the offline re-queue arm dequeue honestly.
        expect(pipelineSrc.slice(catchAt)).toMatch(/if \(cancelled\) return \{ ok: true \};/);
    });
});
