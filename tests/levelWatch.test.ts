/**
 * levelWatchService — the harness arm/tick/subscribe loop. The load-bearing
 * guarantees: fire-once per level (across ticks AND across reloads, via the
 * persisted per-user latch), the stale-plan guard at arm time, symbol
 * routing, and silent disarm. Advisory-only: nothing here resolves trades.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as levelWatch from '../services/trade/levelWatchService';
import type { LevelHit, WatchPlan } from '../services/trade/tradePlanLevels';

const { userRef } = vi.hoisted(() => ({ userRef: { current: 'alice' } }));
vi.mock('../utils/activeUser', () => ({
    getActiveUsername: () => userRef.current,
    LAST_ACTIVE_USER_KEY: 'last_active_user',
}));

const PLAN: WatchPlan = {
    planId: 'btc-1', symbol: 'BTCUSDT', direction: 'Long',
    entry: 100, stopLoss: 90, takeProfits: [110, 120],
};

beforeEach(() => {
    levelWatch.__resetForTests();
    localStorage.clear();
    userRef.current = 'alice';
});

const collectHits = (): LevelHit[] => {
    const hits: LevelHit[] = [];
    levelWatch.subscribe(h => hits.push(h));
    return hits;
};

describe('arm + tick', () => {
    it('fires each level once, in touch order, routed by symbol', () => {
        const hits = collectHits();
        levelWatch.arm(PLAN, 105);
        levelWatch.tick('BTCUSDT', 105);   // nothing touched
        expect(hits.length).toBe(0);
        levelWatch.tick('BTCUSDT', 99);    // entry
        levelWatch.tick('BTCUSDT', 89);    // stop
        levelWatch.tick('BTCUSDT', 88.5);  // still below — must NOT re-fire
        expect(hits.map(h => h.levelId)).toEqual(['btc-1:ENTRY', 'btc-1:SL']);
        expect(hits[1].hitPrice).toBe(89);
    });

    it('ignores ticks for other symbols', () => {
        const hits = collectHits();
        levelWatch.arm(PLAN, 105);
        levelWatch.tick('ETHUSDT', 50);
        expect(hits.length).toBe(0);
    });

    it('a bad subscriber never stalls the watch', () => {
        levelWatch.subscribe(() => { throw new Error('boom'); });
        const hits = collectHits();
        levelWatch.arm(PLAN, 105);
        levelWatch.tick('BTCUSDT', 99);
        expect(hits.map(h => h.levelId)).toEqual(['btc-1:ENTRY']);
    });
});

describe('the fire-once latch (persistence)', () => {
    it('survives a reload: a re-armed same-plan level never re-pings', () => {
        const hits = collectHits();
        levelWatch.arm(PLAN, 105);
        levelWatch.tick('BTCUSDT', 99);
        expect(hits.length).toBe(1);

        // Simulate reload: singleton resets, localStorage persists.
        levelWatch.__resetForTests();
        const afterReload = collectHits();
        levelWatch.arm(PLAN, 99); // still between entry and stop — not stale
        levelWatch.tick('BTCUSDT', 89);
        // ENTRY is latched (no re-ping); SL now touches for the first time.
        expect(afterReload.map(h => h.levelId)).toEqual(['btc-1:SL']);
    });

    it('the latch is per-user: switching users does not inherit latches', () => {
        levelWatch.arm(PLAN, 105);
        levelWatch.tick('BTCUSDT', 99);
        // Bob reloads the same plan: alice's latch must not silence him.
        userRef.current = 'bob';
        levelWatch.__resetForTests();
        const hits = collectHits();
        levelWatch.arm(PLAN, 99);
        levelWatch.tick('BTCUSDT', 98);
        expect(hits.map(h => h.levelId)).toEqual(['btc-1:ENTRY']);
    });
});

describe('stale-plan guard at arm', () => {
    it('a plan already through its stop is not armed and latches silently', () => {
        const hits = collectHits();
        levelWatch.arm(PLAN, 85); // Long armed below the stop
        expect(levelWatch.getArmedPlans().length).toBe(0);
        levelWatch.tick('BTCUSDT', 120); // even a TP touch stays silent — the plan is dead
        expect(hits.length).toBe(0);
        expect(localStorage.getItem('trade_level_hits_v1_alice')).toContain('btc-1:SL');
    });

    it('a cold feed (null price at arm) arms normally', () => {
        const hits = collectHits();
        levelWatch.arm(PLAN, null);
        expect(levelWatch.getArmedPlans().map(p => p.planId)).toEqual(['btc-1']);
        levelWatch.tick('BTCUSDT', 100);
        expect(hits.map(h => h.levelId)).toEqual(['btc-1:ENTRY']);
    });
});

describe('disarm', () => {
    it('disarm drops one plan; disarmSymbol drops that symbol only', () => {
        const hits = collectHits();
        const eth: WatchPlan = { ...PLAN, planId: 'eth-1', symbol: 'ETHUSDT', entry: 3000, stopLoss: 3100, takeProfits: [2900], direction: 'Short' };
        levelWatch.arm(PLAN, 105);
        levelWatch.arm(eth, 2950);
        levelWatch.disarm('btc-1');
        levelWatch.disarmSymbol('ETHUSDT');
        levelWatch.tick('BTCUSDT', 80);
        levelWatch.tick('ETHUSDT', 3200);
        expect(hits.length).toBe(0);
        expect(levelWatch.getArmedPlans().length).toBe(0);
    });
});

describe('firedLevelsFor', () => {
    it('lists the plan levels that already fired (for the context block)', () => {
        levelWatch.arm(PLAN, 105);
        levelWatch.tick('BTCUSDT', 99);
        expect(levelWatch.firedLevelsFor('btc-1')).toEqual(['btc-1:ENTRY']);
        expect(levelWatch.firedLevelsFor('nope')).toEqual([]);
    });
});
