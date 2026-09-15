/**
 * levelWatchService — cross-symbol REST poll (Tier-0 #6 for the plan watch).
 *
 * Reality check against TradeView: switching coins DISARMS the previous
 * coin's plans (disarmSymbol), so "arm on BTC then switch to ETH" can never
 * leave an armed-but-starved plan. The reachable gap is the arm-time
 * direction: a background/harness turn presenting a plan for a coin the
 * chart is NOT on (wave-3 turn context — TradeView arms it with a null mark
 * anchor), and reload/user-switch-adopted plans on off-view coins. The view
 * feed only ever carries the visible symbol, so those plans could never see
 * a tick and went silent. These tests pin the fix: the service's own 1s
 * clock REST-polls stale symbols (~5s throttle, same shape as watchService)
 * and feeds the polled mark price through the normal tick() crossing logic,
 * which carries the subscriber routing.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as levelWatch from '../services/trade/levelWatchService';
import type { LevelHit, WatchPlan } from '../services/trade/tradePlanLevels';

const { userRef } = vi.hoisted(() => ({ userRef: { current: 'alice' } }));
vi.mock('../utils/activeUser', () => ({
    getActiveUsername: () => userRef.current,
    LAST_ACTIVE_USER_KEY: 'last_active_user',
}));

const BTC_PLAN: WatchPlan = {
    planId: 'btc-1', symbol: 'BTCUSDT', direction: 'Long',
    entry: 100, stopLoss: 90, takeProfits: [110],
};
const ETH_PLAN: WatchPlan = {
    planId: 'eth-1', symbol: 'ETHUSDT', direction: 'Long',
    entry: 100, stopLoss: 90, takeProfits: [110],
};

beforeEach(() => {
    levelWatch.__resetForTests();
    localStorage.clear();
    userRef.current = 'alice';
    // The poll clock must never touch the network from the non-poll tests —
    // each poll test replaces this with its own resolving mock.
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('no network in tests'); }));
});

const collectHits = (): LevelHit[] => {
    const hits: LevelHit[] = [];
    levelWatch.subscribe(h => hits.push(h));
    return hits;
};

const pollFetch = (markPrice: string) => {
    const fetchMock = vi.fn(async (_url: string) => ({ ok: true, json: async () => ({ markPrice }) }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
};

describe('cross-symbol REST poll (Tier-0 #6 for armed plans)', () => {
    it('fires an armed plan on a NON-visible symbol off the polled mark price', async () => {
        const fetchMock = pollFetch('98.5'); // ETH Long: entry ≤100 touched, SL 90 not
        vi.useFakeTimers({ now: Date.now() });
        const hits = collectHits();
        // A background turn armed this while the chart sits on BTC — the
        // viewed mark is not authoritative for it, so TradeView arms with a
        // null anchor (plain first-tick touch test).
        levelWatch.arm(ETH_PLAN, null);
        // The view feed only ever carries the VISIBLE symbol.
        levelWatch.tick('BTCUSDT', 105);
        expect(hits.length).toBe(0);

        await vi.advanceTimersByTimeAsync(1_100); // one clock tick → poll → tick()
        expect(fetchMock).toHaveBeenCalled();
        expect(String(fetchMock.mock.calls[0][0])).toContain('premiumIndex?symbol=ETHUSDT');
        expect(hits.map(h => h.levelId)).toEqual(['eth-1:ENTRY']);
        expect(hits[0].hitPrice).toBe(98.5);
        // The hit latched like a view-fed one (fire-once persists).
        expect(localStorage.getItem('trade_level_hits_v1_alice')).toContain('eth-1:ENTRY');
        vi.useRealTimers();
    });

    it('a fresh live tick suppresses polling for that symbol', async () => {
        const fetchMock = pollFetch('105');
        vi.useFakeTimers({ now: Date.now() });
        levelWatch.arm(BTC_PLAN, 105);
        levelWatch.tick('BTCUSDT', 105); // visible feed — fresh, <5s old
        await vi.advanceTimersByTimeAsync(3_000);
        expect(fetchMock).not.toHaveBeenCalled();
        vi.useRealTimers();
    });

    it('throttles repeat polls to ~5s per symbol (attempts, not successes)', async () => {
        const fetchMock = pollFetch('105'); // prints no level → plan stays armed
        vi.useFakeTimers({ now: Date.now() });
        levelWatch.arm(ETH_PLAN, null);
        await vi.advanceTimersByTimeAsync(10_000); // 10 clock ticks
        const ethCalls = fetchMock.mock.calls.filter(c => String(c[0]).includes('symbol=ETHUSDT')).length;
        // t≈1s first attempt, t≈6s next allowed — NOT one fetch per second.
        expect(ethCalls).toBe(2);
        vi.useRealTimers();
    });

    it('a quiet view degrades to polled too', async () => {
        // The chart still points at BTC but its feed died (unmounted socket) —
        // the BTC entry must fall back to the poll rather than go silent.
        const fetchMock = pollFetch('98.5');
        vi.useFakeTimers({ now: Date.now() });
        const hits = collectHits();
        levelWatch.arm(BTC_PLAN, 105);
        levelWatch.tick('BTCUSDT', 105); // last live print
        await vi.advanceTimersByTimeAsync(6_100); // freshness expires at 5s
        expect(String(fetchMock.mock.calls[0][0])).toContain('premiumIndex?symbol=BTCUSDT');
        expect(hits.map(h => h.levelId)).toEqual(['btc-1:ENTRY']);
        vi.useRealTimers();
    });

    it('survives a reload: adopted off-view plans re-arm the clock and poll', async () => {
        const fetchMock = pollFetch('98.5');
        levelWatch.arm(ETH_PLAN, null);
        levelWatch.__resetForTests(); // simulated reload — clock gone, storage kept
        vi.useFakeTimers({ now: Date.now() });
        const hits = collectHits();
        // The next view tick adopts the persisted ETH plan AND restarts the
        // clock (loadFired's switch branch runs syncClock).
        levelWatch.tick('BTCUSDT', 105);
        await vi.advanceTimersByTimeAsync(1_100);
        expect(String(fetchMock.mock.calls[0][0])).toContain('premiumIndex?symbol=ETHUSDT');
        expect(hits.map(h => h.levelId)).toEqual(['eth-1:ENTRY']);
        vi.useRealTimers();
    });

    it('disarm stops the clock; nothing armed means nothing is polled', async () => {
        const fetchMock = pollFetch('105');
        vi.useFakeTimers({ now: Date.now() });
        await vi.advanceTimersByTimeAsync(2_000); // no plans armed at all
        expect(fetchMock).not.toHaveBeenCalled();

        levelWatch.arm(ETH_PLAN, null);
        await vi.advanceTimersByTimeAsync(1_100);
        expect(fetchMock.mock.calls.length).toBe(1);

        levelWatch.disarm('eth-1'); // last plan out → interval must die
        await vi.advanceTimersByTimeAsync(10_000);
        expect(fetchMock.mock.calls.length).toBe(1);
        vi.useRealTimers();
    });

    it('a coin switch disarms the previous coin only — a THIRD coin keeps polling, the new view does not', async () => {
        // The TradeView interplay: BTC→ETH fires disarmSymbol('BTCUSDT'),
        // the ETH plan is now view-fed, and the SOL plan (armed earlier by a
        // background turn) stays on polled — exactly what the poller is for.
        const fetchMock = pollFetch('105');
        vi.useFakeTimers({ now: Date.now() });
        const sol: WatchPlan = { ...ETH_PLAN, planId: 'sol-1', symbol: 'SOLUSDT' };
        levelWatch.arm(BTC_PLAN, 105);
        levelWatch.arm(sol, null);
        // User switches BTC → ETH: TradeView disarms the coin being left.
        levelWatch.disarmSymbol('BTCUSDT');
        await vi.advanceTimersByTimeAsync(1_100);
        const polled = fetchMock.mock.calls.map(c => String(c[0]));
        expect(polled.some(u => u.includes('symbol=SOLUSDT'))).toBe(true);
        expect(polled.some(u => u.includes('symbol=BTCUSDT'))).toBe(false);
        expect(levelWatch.getArmedPlans().map(p => p.planId)).toEqual(['sol-1']);
        vi.useRealTimers();
    });
});
