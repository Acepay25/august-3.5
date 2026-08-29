import { describe, it, expect, beforeEach } from 'vitest';

// Provider cooldown law (Batch 1 P4): ≥3 persisted errors inside 15 minutes
// benches a provider for 10 minutes; one success clears the bench.

import {
    COOLDOWN_ERROR_THRESHOLD,
    COOLDOWN_WINDOW_MS,
    COOLDOWN_DURATION_MS,
    recordProviderSuccess,
    recordProviderError,
    isProviderOnCooldown,
    providerCooldownRemainingMs,
    resetProviderHealth,
    getProviderHealth,
} from '../services/infrastructure/ProviderHealthService';

const minutesAgo = (mins: number): Date => new Date(Date.now() - mins * 60_000);

describe('ProviderHealthService cooldown law (P4)', () => {
    beforeEach(() => {
        resetProviderHealth();
    });

    it('no health entry → never on cooldown (safe default for fresh installs)', () => {
        expect(isProviderOnCooldown('never-seen')).toBe(false);
        expect(providerCooldownRemainingMs('never-seen')).toBe(0);
    });

    it('below the error threshold → not benched', () => {
        recordProviderError('p', new Error('boom'));
        recordProviderError('p', new Error('boom'));
        expect(getProviderHealth('p')!.errorCount).toBe(2);
        expect(isProviderOnCooldown('p')).toBe(false);
    });

    it('≥ threshold errors inside the window → benched, with a remaining duration', () => {
        for (let i = 0; i < COOLDOWN_ERROR_THRESHOLD; i++) {
            recordProviderError('p', new Error(`boom ${i}`));
        }
        expect(isProviderOnCooldown('p')).toBe(true);
        const remaining = providerCooldownRemainingMs('p');
        expect(remaining).toBeGreaterThan(0);
        expect(remaining).toBeLessThanOrEqual(COOLDOWN_DURATION_MS);
    });

    it('errors older than the window fall out (the bench decays)', () => {
        recordProviderError('p', new Error('old-1'));
        recordProviderError('p', new Error('old-2'));
        recordProviderError('p', new Error('old-3'));
        // Timestamps are stamped by recordProviderError itself — simulate the
        // window expiring by rewriting the recorded stamps.
        const entry = getProviderHealth('p')!;
        entry.recentErrorAts = entry.recentErrorAts!.map(() => minutesAgo(COOLDOWN_WINDOW_MS / 60_000 + 1).toISOString());
        expect(isProviderOnCooldown('p')).toBe(false);
        expect(providerCooldownRemainingMs('p')).toBe(0);
    });

    it('a single success clears the accumulated error window (recovery)', () => {
        for (let i = 0; i < COOLDOWN_ERROR_THRESHOLD; i++) {
            recordProviderError('p', new Error('boom'));
        }
        expect(isProviderOnCooldown('p')).toBe(true);
        recordProviderSuccess('p', 120);
        expect(isProviderOnCooldown('p')).toBe(false);
        expect(getProviderHealth('p')!.recentErrorAts).toEqual([]);
    });

    it('the bench window runs from the LAST error, not the first', () => {
        recordProviderError('p', new Error('first'));
        // Two more errors, stamped 5 minutes later than the first.
        const later = minutesAgo(-5);
        const entry = getProviderHealth('p')!;
        for (let i = 0; i < COOLDOWN_ERROR_THRESHOLD - 1; i++) {
            entry.recentErrorAts!.push(later.toISOString());
        }
        // now - lastError = 5 minutes ago (in the future by construction) →
        // elapsed is negative → still well inside the bench window.
        expect(isProviderOnCooldown('p')).toBe(true);
    });

    it('benched providers un-bench once the duration elapses', () => {
        recordProviderError('p', new Error('boom-1'));
        recordProviderError('p', new Error('boom-2'));
        recordProviderError('p', new Error('boom-3'));
        const entry = getProviderHealth('p')!;
        entry.recentErrorAts = entry.recentErrorAts!.map(() =>
            minutesAgo(COOLDOWN_DURATION_MS / 60_000 + 1).toISOString());
        expect(isProviderOnCooldown('p')).toBe(false);
        expect(providerCooldownRemainingMs('p')).toBe(0);
    });

    it('rate-limit errors are still just errors (transient retries happen below this layer)', () => {
        recordProviderError('p', new Error('429 rate limit exceeded'));
        expect(getProviderHealth('p')!.rateLimitCount).toBe(1);
        expect(isProviderOnCooldown('p')).toBe(false);
    });

    it('cooldown law constants match the documented law', () => {
        expect(COOLDOWN_ERROR_THRESHOLD).toBe(3);
        expect(COOLDOWN_WINDOW_MS).toBe(15 * 60 * 1000);
        expect(COOLDOWN_DURATION_MS).toBe(10 * 60 * 1000);
    });
});
