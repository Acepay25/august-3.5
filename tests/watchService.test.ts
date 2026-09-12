/**
 * watchService — the model-facing watch/schedule harness. Load-bearing
 * behaviour: price watches fire ONCE on the live tick and are then gone, the
 * clock fires time wake-ups even with a quiet feed, expiry drops silently,
 * cancels work, and the armed set persists per user (reload-safe) with the
 * chatStore lesson — a user switch never leaks one profile's watches into
 * another's storage key.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as watchService from '../services/trade/watchService';
import { parsePriceWatch, parseTimeWake, type WatchFired } from '../services/trade/chartTriggers';

const { userRef } = vi.hoisted(() => ({ userRef: { current: 'alice' } }));
vi.mock('../utils/activeUser', () => ({
    getActiveUsername: () => userRef.current,
    LAST_ACTIVE_USER_KEY: 'last_active_user',
}));

beforeEach(() => {
    watchService.__resetForTests();
    localStorage.clear();
    userRef.current = 'alice';
});

const armPrice = (over: { condition?: 'above' | 'below'; price?: number; symbol?: string; expiresInMinutes?: number } = {}) => {
    const nowMs = Date.now();
    const { watch } = parsePriceWatch(
        { condition: over.condition ?? 'above', price: over.price ?? 100, symbol: over.symbol, expiresInMinutes: over.expiresInMinutes },
        { symbol: 'BTCUSDT', makeId: () => `w-${Math.random()}`, nowMs },
    )!;
    watchService.arm(watch!);
    return watch!;
};

const collect = (): WatchFired[] => {
    const fired: WatchFired[] = [];
    watchService.subscribe(f => fired.push(f));
    return fired;
};

describe('price watches', () => {
    it('fire once on the live tick, then lapse', () => {
        const fired = collect();
        armPrice({ condition: 'above', price: 100 });
        watchService.tick('BTCUSDT', 99);
        expect(fired.length).toBe(0);
        watchService.tick('BTCUSDT', 100.5);
        expect(fired.length).toBe(1);
        expect(fired[0].price).toBe(100.5);
        // Gone after firing — a second touch never re-pings.
        watchService.tick('BTCUSDT', 101);
        expect(fired.length).toBe(1);
        expect(watchService.list().length).toBe(0);
    });

    it('a condition already true at arm time fires ON THE SPOT (arm evaluates)', () => {
        const fired = collect();
        watchService.tick('BTCUSDT', 105);   // the feed's last price
        armPrice({ condition: 'above', price: 100 });
        expect(fired.length).toBe(1);
        watchService.tick('BTCUSDT', 105);   // and only once
        expect(fired.length).toBe(1);
    });

    it('a below-watch ignores other symbols\' prices', () => {
        const fired = collect();
        armPrice({ condition: 'below', price: 100, symbol: 'ETHUSDT' });
        watchService.tick('BTCUSDT', 1);
        expect(fired.length).toBe(0);
        watchService.tick('ETHUSDT', 99);
        expect(fired.length).toBe(1);
    });

    it('an expired watch is dropped silently (never fires)', () => {
        const fired = collect();
        const { watch } = parsePriceWatch({ condition: 'above', price: 100 },
            { symbol: 'BTCUSDT', makeId: () => 'w-x', nowMs: Date.now() })!;
        watchService.arm({ ...watch!, expiresAt: Date.now() - 1 }); // past its deadline
        watchService.tick('BTCUSDT', 999);
        expect(fired.length).toBe(0);
        expect(watchService.list().length).toBe(0);
    });
});

describe('time wake-ups (fire off the clock, not the tape)', () => {
    it('a wake fires from the internal 1s clock even with no price feed', () => {
        const fired = collect();
        vi.useFakeTimers({ now: 1_000_000 });
        const { wake } = parseTimeWake({ inMinutes: 1 }, { symbol: 'BTCUSDT', makeId: () => 'w-t', nowMs: Date.now() });
        watchService.arm(wake!); // due at 1_060_000 — not yet
        expect(fired.length).toBe(0);
        vi.advanceTimersByTime(61_000); // the internal clock crosses the deadline
        vi.useRealTimers();
        expect(fired.length).toBe(1);
        expect(fired[0].watch.id).toBe('w-t');
    });

    it('a wake whose deadline already passed fires on the spot', () => {
        const fired = collect();
        const past = parseTimeWake({ inMinutes: 1 }, { symbol: 'BTCUSDT', makeId: () => 'w-past', nowMs: Date.now() - 120_000 });
        watchService.arm(past.wake!);
        expect(fired.length).toBe(1);
    });
});

describe('cancel + list', () => {
    it('cancel removes one by id; cancelWhere drops a symbol\'s watches', () => {
        const w1 = armPrice({ price: 100 });
        armPrice({ price: 200, symbol: 'ETHUSDT' });
        expect(watchService.cancel(w1.id)).toBe(true);
        expect(watchService.cancel('nope')).toBe(false);
        expect(watchService.list().map(w => w.id)).not.toContain(w1.id);
        const n = watchService.cancelWhere(w => w.symbol === 'ETHUSDT');
        expect(n).toBe(1);
        expect(watchService.list().length).toBe(0);
    });
});

describe('persistence + user scoping', () => {
    it('armed watches survive a reload (singleton reset, storage kept)', () => {
        armPrice({ price: 100 });
        watchService.__resetForTests();
        const fired = collect();
        watchService.tick('BTCUSDT', 100);
        expect(fired.length).toBe(1);
    });

    it('the watch key is per user; a switch reloads instead of leaking', () => {
        armPrice({ price: 100 });
        // Switch users and reload: Bob starts with no watches, and Alice's
        // key still holds hers.
        userRef.current = 'bob';
        watchService.__resetForTests();
        expect(watchService.list().length).toBe(0);
        expect(JSON.parse(localStorage.getItem('trade_watches_v1_alice') ?? '[]').length).toBe(1);
        expect(localStorage.getItem('trade_watches_v1_bob')).toBeNull();
    });
});
