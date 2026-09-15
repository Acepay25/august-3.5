/**
 * levelWatchService — the harness arm/tick/subscribe loop. The load-bearing
 * guarantees: fire-once per level (across ticks AND across reloads, via the
 * persisted per-user latch — with the ENTRY re-touch exception: ENTRY is a
 * per-VISIT latch, re-armed when price prints to its far side so a renewed
 * touch re-pings "is my entry live?"), the stale-plan guard at arm time,
 * symbol routing, and silent disarm. Advisory-only: nothing here resolves
 * trades.
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
    // The armed-plan REST-poll clock (cross-symbol Tier-0 #6) runs every
    // second while a plan is armed — these suites never advance real time,
    // but the guard keeps any leaked interval from ever hitting the network
    // (same treatment as watchService.test.ts).
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('no network in tests'); }));
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

describe('ENTRY re-touch (far-side re-arm — the "is my entry live?" signal)', () => {
    it('a Long re-fires ENTRY after price re-crosses above it and touches again', () => {
        const hits = collectHits();
        levelWatch.arm(PLAN, 105);
        levelWatch.tick('BTCUSDT', 99);   // visit 1 → ping
        levelWatch.tick('BTCUSDT', 98);   // still in the zone — no spam
        levelWatch.tick('BTCUSDT', 101);  // far side: visit ends, ENTRY re-arms (silent)
        levelWatch.tick('BTCUSDT', 99.5); // visit 2 → re-ping
        expect(hits.map(h => h.levelId)).toEqual(['btc-1:ENTRY', 'btc-1:ENTRY']);
        expect(hits[1].hitPrice).toBe(99.5);
    });

    it('a Short mirrors: re-cross below entry re-arms, the next touch re-fires', () => {
        const shortPlan: WatchPlan = {
            planId: 'eth-s', symbol: 'ETHUSDT', direction: 'Short',
            entry: 3000, stopLoss: 3100, takeProfits: [2900],
        };
        const hits = collectHits();
        levelWatch.arm(shortPlan, 2950);
        levelWatch.tick('ETHUSDT', 3010); // >= entry → fires
        levelWatch.tick('ETHUSDT', 2980); // far side (below) → re-arm
        levelWatch.tick('ETHUSDT', 3005); // re-touch → re-fire
        expect(hits.map(h => h.levelId)).toEqual(['eth-s:ENTRY', 'eth-s:ENTRY']);
    });

    it('re-arming mutates the PERSISTED latch: fired → far side → gone → re-touch → back', () => {
        levelWatch.arm(PLAN, 105);
        levelWatch.tick('BTCUSDT', 99);
        expect(localStorage.getItem('trade_level_hits_v1_alice')).toContain('btc-1:ENTRY');
        expect(levelWatch.firedLevelsFor('btc-1')).toEqual(['btc-1:ENTRY']);
        levelWatch.tick('BTCUSDT', 102); // re-arm persists immediately
        expect(localStorage.getItem('trade_level_hits_v1_alice')).not.toContain('btc-1:ENTRY');
        expect(levelWatch.firedLevelsFor('btc-1')).toEqual([]);
        levelWatch.tick('BTCUSDT', 99); // fired again, persisted again
        expect(localStorage.getItem('trade_level_hits_v1_alice')).toContain('btc-1:ENTRY');
        expect(levelWatch.firedLevelsFor('btc-1')).toEqual(['btc-1:ENTRY']);
    });

    it('a reload mid-visit keeps the ENTRY latch silent until the next far-side cross', () => {
        levelWatch.arm(PLAN, 105);
        levelWatch.tick('BTCUSDT', 99); // ENTRY fires + latches
        levelWatch.__resetForTests();   // reload; latch persisted, plan re-adopted
        const afterReload = collectHits();
        levelWatch.tick('BTCUSDT', 98); // still inside the visit — stays silent
        expect(afterReload.length).toBe(0);
        levelWatch.tick('BTCUSDT', 101); // far side → re-arm
        levelWatch.tick('BTCUSDT', 99);  // new visit → re-ping
        expect(afterReload.map(h => h.levelId)).toEqual(['btc-1:ENTRY']);
    });

    it('SL and TP stay strict fire-once across far-side re-crossings', () => {
        const hits = collectHits();
        levelWatch.arm(PLAN, 105);
        levelWatch.tick('BTCUSDT', 95);   // ENTRY fires (visit 1)
        levelWatch.tick('BTCUSDT', 89);   // still on the entry's near side: only SL fires
        levelWatch.tick('BTCUSDT', 105);  // far side: ENTRY re-arms; SL stays latched forever
        levelWatch.tick('BTCUSDT', 89);   // ENTRY re-fires; SL touched again — must NOT re-fire
        levelWatch.tick('BTCUSDT', 115);  // TP1 fires once (and ENTRY re-arms again, far)
        levelWatch.tick('BTCUSDT', 105);  // under TP1…
        levelWatch.tick('BTCUSDT', 116);  // …through it again — TP1 must NOT re-fire
        expect(hits.map(h => h.levelId)).toEqual([
            'btc-1:ENTRY', 'btc-1:SL', 'btc-1:ENTRY', 'btc-1:TP1',
        ]);
    });

    it('polled far-side prints re-arm an off-view plan too', () => {
        // Same tick() path the REST poll feeds — re-arm is not view-feed-only.
        const hits = collectHits();
        levelWatch.arm(PLAN, 105);
        levelWatch.tick('BTCUSDT', 99);   // fires
        levelWatch.tick('BTCUSDT', 105);  // polled far-side print → re-arm
        levelWatch.tick('BTCUSDT', 99);   // fires again
        expect(hits.map(h => h.levelId)).toEqual(['btc-1:ENTRY', 'btc-1:ENTRY']);
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

describe('armed-plan persistence (Tier-1: the armed set was memory-only)', () => {
    it('an ARMED plan survives a reload and keeps firing without re-arm', () => {
        levelWatch.arm(PLAN, 105);
        expect(localStorage.getItem('trade_level_arms_v1_alice')).toContain('btc-1');

        // Simulate reload: singleton resets, localStorage persists. The old
        // service silently un-watched the live trade here.
        levelWatch.__resetForTests();
        const afterReload = collectHits();
        levelWatch.tick('BTCUSDT', 99);  // ENTRY fires off the reloaded plan
        levelWatch.tick('BTCUSDT', 89);  // SL fires
        expect(afterReload.map(h => h.levelId)).toEqual(['btc-1:ENTRY', 'btc-1:SL']);
    });

    it('the armed set is per-user: a switch does not inherit the other profile\u2019s live watches', () => {
        levelWatch.arm(PLAN, 105);
        levelWatch.tick('BTCUSDT', 99); // alice's ENTRY fires + latches

        userRef.current = 'bob';
        levelWatch.__resetForTests();
        const bobHits = collectHits();
        levelWatch.tick('BTCUSDT', 89); // bob has no armed plans → silent
        expect(bobHits.length).toBe(0);
        expect(levelWatch.getArmedPlans().length).toBe(0);
        // And back to alice, her plan is re-adopted from her own key.
        userRef.current = 'alice';
        levelWatch.__resetForTests();
        const aliceHits = collectHits();
        levelWatch.tick('BTCUSDT', 89);
        expect(aliceHits.map(h => h.levelId)).toEqual(['btc-1:SL']);
    });

    it('disarming persists (a reload does not resurrect a dropped watch)', () => {
        levelWatch.arm(PLAN, 105);
        levelWatch.disarm('btc-1');
        expect(localStorage.getItem('trade_level_arms_v1_alice')).toBeNull();
        levelWatch.__resetForTests();
        const hits = collectHits();
        levelWatch.tick('BTCUSDT', 99);
        expect(hits.length).toBe(0);
    });
});
