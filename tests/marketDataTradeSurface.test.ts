import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Phase 2 of the Minara trade surface: fetchMarkIndex (mark/oracle/funding
// clock from premiumIndex) and the raw bids/asks ladder exposed on
// OrderBookData for the DOM column. global.fetch is mocked by URL pattern;
// each test uses its own symbol so the 30s service cache never collides.

const premiumIndex = {
    symbol: 'TESTAUSDT',
    markPrice: '100.50',
    indexPrice: '100.40',
    lastFundingRate: '0.00010000',
    nextFundingTime: 1760000000000,
};
const depth = {
    bids: [['100.4', '10'], ['100.3', '250'], ['100.2', '5']],
    asks: [['100.6', '7'], ['100.7', '300'], ['100.8', '4']],
};
const ticker = {
    symbol: 'TESTAUSDT',
    lastPrice: '100.5',
    priceChangePercent: '-2.5',
    highPrice: '104',
    lowPrice: '99',
    volume: '12000',
};

const fetchMock = vi.fn(async (input: unknown) => {
    const url = String(input);
    const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
    if (url.includes('premiumIndex')) return json(premiumIndex);
    if (url.includes('/depth')) return json(depth);
    if (url.includes('ticker') || url.includes('24hr')) return json(ticker);
    return json([]);
});

import { fetchMarkIndex, fetchOrderBookDepth, fetchOpenInterest } from '../services/analysis/MarketDataService';

describe('fetchMarkIndex (trade stats strip)', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', fetchMock);
        fetchMock.mockClear();
    });
    afterEach(() => vi.unstubAllGlobals());

    it('parses mark, index, funding rate and the next-funding clock', async () => {
        const r = await fetchMarkIndex('TESTAUSDT');
        expect(r.available).toBe(true);
        expect(r.markPrice).toBeCloseTo(100.5, 6);
        expect(r.indexPrice).toBeCloseTo(100.4, 6);
        expect(r.lastFundingRate).toBeCloseTo(0.0001, 8);
        expect(r.nextFundingTime).toBe(1760000000000);
    });

    it('a fetch failure degrades to available:false, never throws', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
        const r = await fetchMarkIndex('TESTBUSDT');
        expect(r.available).toBe(false);
        expect(r.markPrice).toBe(0);
    });
});

describe('fetchOrderBookDepth ladder exposure', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', fetchMock);
        fetchMock.mockClear();
    });
    afterEach(() => vi.unstubAllGlobals());

    it('returns best-first bids/asks ladders alongside the aggregates', async () => {
        const ob = await fetchOrderBookDepth('TESTCUSDT');
        expect(ob.available).toBe(true);
        expect(ob.bids.length).toBeGreaterThan(0);
        expect(ob.asks.length).toBeGreaterThan(0);
        // best-first ordering preserved
        expect(ob.bids[0].price).toBeGreaterThan(ob.bids[1].price);
        expect(ob.asks[0].price).toBeLessThan(ob.asks[1].price);
        expect(ob.bids[0]).toEqual({ price: 100.4, qty: 10 });
        // aggregates still present (HybridDataPanel depends on them)
        expect(ob.bestBid).toBeGreaterThan(0);
        expect(Array.isArray(ob.buyWalls)).toBe(true);
    });
});

/**
 * Futures-native reference price for perp-book analysis (audit 2026-09-15).
 * The book comes from /fapi/v1/depth, but spread %, the ±1% depth window and
 * wall distances used to be measured against the SPOT ticker (and futures OI
 * valued at spot). On a symbol with a real basis every number was skewed and
 * the depth window could filter the entire ladder out. The reference must be
 * the futures mark price; the book mid only when mark is unavailable.
 */
describe('fetchOrderBookDepth / fetchOpenInterest use the FUTURES price', () => {
    const perpDepth = {
        bids: [['100.4', '5'], ['100.35', '5'], ['100.3', '5'], ['100.2', '100']],
        asks: [['100.6', '7'], ['100.7', '300']],
    };
    // Spot prints 90 — 10% under the perp. If any analysis number references
    // it, the ±1% window around "current price" catches zero ladder rows.
    const divergedSpotTicker = {
        symbol: 'TESTDUSDT', lastPrice: '90', priceChangePercent: '0',
        highPrice: '91', lowPrice: '89', volume: '1', quoteVolume: '1',
    };
    const perpPremiumIndex = {
        markPrice: '100.5', indexPrice: '100.45',
        lastFundingRate: '0.0001', nextFundingTime: 1760000000000,
    };

    const futuresOnlyMock = vi.fn(async (input: unknown) => {
        const url = String(input);
        const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
        if (url.includes('premiumIndex')) return json(perpPremiumIndex);
        if (url.includes('/fapi/v1/depth')) return json(perpDepth);
        if (url.includes('/fapi/v1/openInterest')) return json({ openInterest: '1000' });
        if (url.includes('/api/v3/ticker')) return json(divergedSpotTicker);
        return json([]);
    });

    beforeEach(() => {
        vi.stubGlobal('fetch', futuresOnlyMock);
        futuresOnlyMock.mockClear();
        vi.spyOn(console, 'warn').mockImplementation(() => { });
        vi.spyOn(console, 'log').mockImplementation(() => { });
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('measures spread and the ±1% depth window against the futures mark', async () => {
        const ob = await fetchOrderBookDepth('TESTDUSDT');
        expect(ob.available).toBe(true);
        // mark 100.5: spread 0.2 → ~0.199% of mark. Against spot 90 it would
        // read ~0.222% AND the depth window would be empty.
        expect(ob.spreadPercent).toBeCloseTo((0.2 / 100.5) * 100, 6);
        expect(ob.bidDepth).toBeGreaterThan(0);
        expect(ob.askDepth).toBeGreaterThan(0);
        // Wall distance below the mark is positive and mark-referenced:
        // (100.5 − 100.2) / 100.5 ≈ 0.2985% (spot-referenced it was negative).
        expect(ob.wallDistance.nearestBuyWall?.distance).toBeCloseTo(((100.5 - 100.2) / 100.5) * 100, 6);
        // The spot ticker must not be consulted at all for a perp-book read.
        expect(futuresOnlyMock.mock.calls.every(c => !String(c[0]).includes('/api/v3/ticker'))).toBe(true);
    });

    it('values futures open interest at the mark, not the spot price', async () => {
        const { oi, oiValue } = await fetchOpenInterest('TESTDUSDT');
        expect(oi).toBe(1000);
        expect(oiValue).toBeCloseTo(1000 * 100.5, 6);
        expect(futuresOnlyMock.mock.calls.every(c => !String(c[0]).includes('/api/v3/ticker'))).toBe(true);
    });

    it('an empty ask side yields 0 walls (not NaN) and stays finite', async () => {
        vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
            const url = String(input);
            const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
            if (url.includes('premiumIndex')) return json(perpPremiumIndex);
            if (url.includes('/fapi/v1/depth')) return json({ bids: [['100.4', '1'], ['100.35', '1'], ['100.3', '1'], ['100.2', '10']], asks: [] });
            return json([]);
        }));
        const ob = await fetchOrderBookDepth('TESTEUSDT');
        // Old bug: avgAskSize = 0/0 = NaN, and NaN comparisons silently
        // killed the BUY walls too. The bid wall (10 ≥ 3×avg(3.25)) must live.
        expect(ob.sellWalls).toEqual([]);
        expect(ob.buyWalls.length).toBe(1);
        expect(Number.isFinite(ob.spreadPercent)).toBe(true);
        expect(Number.isFinite(ob.depthImbalance)).toBe(true);
    });

    it('never caches a NaN-poisoned book: the bad parse returns the honest default', async () => {
        const calls: string[] = [];
        vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
            const url = String(input);
            calls.push(url);
            const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
            if (url.includes('premiumIndex')) return json({ markPrice: '', indexPrice: '', lastFundingRate: '0', nextFundingTime: 0 });
            if (url.includes('/fapi/v1/depth')) return json({ bids: [['abc', '5']], asks: [['def', '5']] });
            return json([]);
        }));
        const first = await fetchOrderBookDepth('TESTGUSDT');
        expect(first.available).toBe(false);
        expect(calls.length).toBeGreaterThan(0);
        const afterFirst = calls.length;
        // A cached NaN book would short-circuit the second call; instead it
        // hits the network again (nothing poisoned was stored).
        const second = await fetchOrderBookDepth('TESTGUSDT');
        expect(second.available).toBe(false);
        expect(calls.length).toBeGreaterThan(afterFirst);
    });
});
