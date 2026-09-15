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
    // The REST-poll clock must never touch the network from the other suites;
    // the poll tests below replace this with their own resolving mock.
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('no network in tests'); }));
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

describe('cross-symbol REST poll (Tier-0 #6)', () => {
    it('fires an armed watch on a NON-visible symbol from the polled mark price', async () => {
        const fetchMock = vi.fn(async (_url: string) => ({ ok: true, json: async () => ({ markPrice: '101.5' }) }));
        vi.stubGlobal('fetch', fetchMock);
        vi.useFakeTimers({ now: Date.now() });
        const fired = collect();
        armPrice({ condition: 'above', price: 100, symbol: 'ETHUSDT' });
        // The chart feed only ever carries the VISIBLE symbol (BTC here) —
        // before the fix the ETH watch could never see a price and silently
        // expired at its deadline.
        watchService.tick('BTCUSDT', 50);
        expect(fired.length).toBe(0);

        await vi.advanceTimersByTimeAsync(1_100); // one clock tick → poll → evaluate
        expect(fetchMock).toHaveBeenCalled();
        expect(String(fetchMock.mock.calls[0][0])).toContain('premiumIndex?symbol=ETHUSDT');
        expect(fired.length).toBe(1);
        expect(fired[0].price).toBe(101.5);
        expect(watchService.list().length).toBe(0); // fire-once, then gone
        vi.useRealTimers();
    });

    it('a fresh live tick suppresses polling for that symbol', async () => {
        const fetchMock = vi.fn(async (_url: string) => ({ ok: true, json: async () => ({ markPrice: '100' }) }));
        vi.stubGlobal('fetch', fetchMock);
        vi.useFakeTimers({ now: Date.now() });
        armPrice({ condition: 'above', price: 500, symbol: 'BTCUSDT' });
        watchService.tick('BTCUSDT', 100); // visible feed — fresh, <5s old
        await vi.advanceTimersByTimeAsync(3_000);
        expect(fetchMock).not.toHaveBeenCalled();
        vi.useRealTimers();
    });

    it('throttles repeat polls to ~5s per symbol (attempts, not successes)', async () => {
        const fetchMock = vi.fn(async (_url: string) => ({ ok: true, json: async () => ({ markPrice: '999' }) }));
        vi.stubGlobal('fetch', fetchMock);
        vi.useFakeTimers({ now: Date.now() });
        armPrice({ condition: 'above', price: 1_000_000, symbol: 'ETHUSDT' });
        await vi.advanceTimersByTimeAsync(10_000); // 10 clock ticks
        const ethCalls = fetchMock.mock.calls.filter(c => String(c[0]).includes('symbol=ETHUSDT')).length;
        // t≈1s first attempt, t≈6s next allowed — NOT one fetch per second.
        expect(ethCalls).toBe(2);
        vi.useRealTimers();
    });
});
