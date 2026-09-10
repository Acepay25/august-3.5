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

import { fetchMarkIndex, fetchOrderBookDepth } from '../services/analysis/MarketDataService';

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
