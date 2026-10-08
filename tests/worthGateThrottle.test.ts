import { describe, it, expect, beforeEach } from 'vitest';
import {
    shouldAttemptWorthGate,
    recordWorthGateAttempt,
    readWorthGateAttempt,
    clearWorthGateAttempt,
    listWorthGateAttempts,
} from '../utils/skillDrafts';

/**
 * P1-4 — the worth gate is a LIVE LLM call.
 *
 * When it cannot run (no ready provider) the cluster stays eligible and the
 * next closed trade retried it. On a cluster that keeps producing trades and
 * never gets a provider that is one billed attempt per close, forever. The
 * ledger throttles a retry to "the gate has not seen this trade yet".
 *
 * The line these tests hold: a throttle must never suppress a FIRST attempt,
 * and must never outlive the evidence it was pacing.
 */

const USER = 'gate-attempt-user';
const KEY = 'BTC|Short|Family A';

describe('worth-gate attempt throttle', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('always allows the first attempt', () => {
        expect(shouldAttemptWorthGate(KEY, ['t1', 't2', 't3'], USER)).toBe(true);
    });

    it('throttles a retry over evidence the gate has already seen', () => {
        recordWorthGateAttempt(KEY, ['t1', 't2', 't3'], USER);
        // Same cluster, same trades — this is the one-LLM-per-close bug.
        expect(shouldAttemptWorthGate(KEY, ['t1', 't2', 't3'], USER)).toBe(false);
    });

    it('re-opens once the cluster gains a trade the gate has not judged', () => {
        recordWorthGateAttempt(KEY, ['t1', 't2', 't3'], USER);
        expect(shouldAttemptWorthGate(KEY, ['t1', 't2', 't3', 't4'], USER)).toBe(true);
    });

    it('honours the human override regardless of the ledger', () => {
        recordWorthGateAttempt(KEY, ['t1', 't2', 't3'], USER);
        expect(shouldAttemptWorthGate(KEY, ['t1', 't2', 't3'], USER, true)).toBe(true);
    });

    it('counts attempts and keeps the newest cluster membership', () => {
        recordWorthGateAttempt(KEY, ['t1'], USER);
        recordWorthGateAttempt(KEY, ['t1', 't2'], USER);
        const rec = readWorthGateAttempt(KEY, USER);
        expect(rec?.attempts).toBe(2);
        expect(rec?.tradeIds).toEqual(['t1', 't2']);
    });

    it('keeps clusters independent — one throttle does not silence another', () => {
        recordWorthGateAttempt(KEY, ['t1'], USER);
        expect(shouldAttemptWorthGate('ETH|Long|Family B', ['t9'], USER)).toBe(true);
    });

    it('scopes the ledger per user', () => {
        recordWorthGateAttempt(KEY, ['t1'], USER);
        expect(shouldAttemptWorthGate(KEY, ['t1'], 'someone-else')).toBe(true);
    });

    it('clears the record once the gate reaches a verdict', () => {
        recordWorthGateAttempt(KEY, ['t1', 't2'], USER);
        clearWorthGateAttempt(KEY, USER);
        expect(readWorthGateAttempt(KEY, USER)).toBeNull();
        // A cleared cluster is a fresh question — the next close may ask again.
        expect(shouldAttemptWorthGate(KEY, ['t1', 't2'], USER)).toBe(true);
    });

    it('survives a reload — the ledger is persisted, not in-memory', () => {
        recordWorthGateAttempt(KEY, ['t1'], USER);
        // A fresh module read is what a reload does; the throttle must hold or
        // every app restart re-bills the same clusters.
        expect(listWorthGateAttempts(USER)).toHaveLength(1);
        expect(shouldAttemptWorthGate(KEY, ['t1'], USER)).toBe(false);
    });

    it('bounds the ledger so it cannot grow without limit', () => {
        for (let i = 0; i < 60; i++) recordWorthGateAttempt(`cluster-${i}`, ['t1'], USER);
        expect(listWorthGateAttempts(USER).length).toBeLessThanOrEqual(50);
        // Newest wins: the most recent cluster is the one retained.
        expect(readWorthGateAttempt('cluster-59', USER)).not.toBeNull();
    });
});
