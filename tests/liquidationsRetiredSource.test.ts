import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Liquidations: the public Binance forceOrders sources are gone
 * (audit 2026-09-15 Tier-0 #4): /fapi/v1/forceOrders is signed-only (401) and
 * /fapi/v1/allForceOrders was removed (404). The service must (a) burn its
 * probe ONCE, (b) latch the dead source at module level so no later call
 * re-hammers ~8 serial endpoint attempts, (c) return an honest
 * "source retired by Binance" object whose available:false keeps every
 * downstream do-NOT-infer guard, and (d) NOT latch on transient failures.
 * Also pins: testnet.binancefuture.com is no longer in the prod futures chain
 * (its synthetic 200s were served as "live"), and the USD totals cover the
 * whole last hour rather than only the 10 displayed events.
 */

import {
    fetchRecentLiquidations,
    __resetMarketDataForTests,
} from '../services/analysis/MarketDataService';

const status = (code: number) => ({
    ok: code >= 200 && code < 300,
    status: code,
    json: async () => { throw new Error(`status ${code}`); },
});

const fetchSpy = vi.fn(async (input: unknown) => {
    const url = String(input);
    return status(url.includes('allForceOrders') ? 404 : 401);
});

const urlsOf = (): string[] => fetchSpy.mock.calls.map(c => String(c[0]));

describe('fetchRecentLiquidations (retired-source latch)', () => {
    beforeEach(() => {
        __resetMarketDataForTests();
        vi.stubGlobal('fetch', fetchSpy);
        fetchSpy.mockClear();
        vi.spyOn(console, 'warn').mockImplementation(() => { });
        vi.spyOn(console, 'log').mockImplementation(() => { });
        vi.spyOn(console, 'error').mockImplementation(() => { });
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('first 401-class failure returns the retired object immediately, without trying the 404 endpoint too', async () => {
        const liq = await fetchRecentLiquidations('LIQTESTUSDT');
        expect(liq.available).toBe(false);
        expect(liq.unavailableReason).toBe('source_retired');
        expect(liq.sentiment).toMatch(/RETIRED by Binance/i);
        // Exactly one probe per remaining prod futures host — no testnet, no
        // fallback-endpoint hammering.
        const urls = urlsOf();
        expect(urls).toHaveLength(3);
        expect(urls.every(u => u.includes('/fapi/v1/forceOrders'))).toBe(true);
        expect(urls.every(u => !u.includes('testnet'))).toBe(true);
        expect(urls.every(u => !u.includes('allForceOrders'))).toBe(true);
    });

    it('latches: every later call (any symbol) returns retired data with ZERO network attempts', async () => {
        await fetchRecentLiquidations('LIQTESTBUSDT');
        const afterFirst = fetchSpy.mock.calls.length;
        expect(afterFirst).toBeGreaterThan(0);
        const second = await fetchRecentLiquidations('LIQTESTBUSDT');
        const third = await fetchRecentLiquidations('LIQOTHERUSDT');
        expect(fetchSpy.mock.calls.length).toBe(afterFirst); // no hammering
        expect(second.unavailableReason).toBe('source_retired');
        expect(third.unavailableReason).toBe('source_retired');
        expect(third.sentiment).toMatch(/not "no liquidations happened"/i);
    });

    it('latches when only the fallback endpoint answers 404 (first leg failed transiently)', async () => {
        vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
            const url = String(input);
            return status(url.includes('allForceOrders') ? 404 : 500);
        }));
        const liq = await fetchRecentLiquidations('LIQTESTCUSDT');
        expect(liq.unavailableReason).toBe('source_retired');
        // Same symbol again: the latch short-circuits before the cache even
        // by returning the retired contract.
        const again = await fetchRecentLiquidations('LIQTESTCUSDT');
        expect(again.unavailableReason).toBe('source_retired');
    });

    it('does NOT latch on transient (5xx) failures — those stay fetch_failed and retry', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => status(500)));
        const first = await fetchRecentLiquidations('LIQTESTDUSDT');
        expect(first.available).toBe(false);
        expect(first.unavailableReason).toBe('fetch_failed');
        const afterFirst = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.length;
        expect(afterFirst).toBe(6); // 3 hosts × 2 endpoints, no testnet
        await fetchRecentLiquidations('LIQTESTDUSDT');
        const later = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.length;
        expect(later).toBeGreaterThan(afterFirst); // probe retried, not latched
    });

    it('when the endpoint DOES answer, USD totals cover the whole hour (not the 10 displayed events)', async () => {
        const now = Date.now();
        // 12 long-side force orders, $1M notional each, all inside the hour.
        const orders = Array.from({ length: 12 }, (_, i) => ({
            symbol: 'LIQTESTEUSDT',
            side: 'SELL', // sell to close = was LONG
            origQty: '10',
            price: '100000',
            time: now - 60_000 - i * 1000,
        }));
        vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
            const url = String(input);
            const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
            if (url.includes('forceOrders')) return json(orders);
            return status(404);
        }));
        const liq = await fetchRecentLiquidations('LIQTESTEUSDT');
        expect(liq.available).toBe(true);
        expect(liq.recentLongLiquidations).toBeCloseTo(12_000_000, 0);
        expect(liq.recentShortLiquidations).toBe(0);
        expect(liq.totalRecentLiquidations).toBeCloseTo(12_000_000, 0);
        // Display is still capped at 10 — but pressure/thresholds used the
        // full-hour total (12M > 10M ⇒ high; the old 10-event sum read 10M ⇒
        // medium).
        expect(liq.recentEvents).toHaveLength(10);
        expect(liq.liquidationPressure).toBe('high');
        expect(liq.dominantLiquidations).toBe('longs');
    });
});
