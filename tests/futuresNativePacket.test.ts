import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * The packet must be FUTURES-native. The Trade surface is a perpetuals desk:
 * the chart's mark line and header stream markPrice@1s from fstream, so a
 * packet built from the SPOT ticker/klines made the model read the spot↔perp
 * basis (plus the 30s cache) as a fresh price move — e.g. "Packet shows
 * $0.8038, but your live chart mark is $0.78357 — price dropped 2.5%".
 * Regression: fetchCompleteMarketSnapshot pulls ticker + klines from /fapi/v1,
 * falls back to the spot ticker only when futures itself fails, and
 * fetchMarkIndex refreshes near-stream-fresh instead of the 30s cache.
 */

const futuresTicker = {
    symbol: 'PACKETUSDT',
    lastPrice: '100.5',
    priceChange: '-2.5',
    priceChangePercent: '-2.4',
    highPrice: '104',
    lowPrice: '99',
    volume: '12000',
    quoteVolume: '1200000',
};
const spotTicker = {
    symbol: 'PACKETUSDT',
    lastPrice: '99.9',
    priceChange: '-3.0',
    priceChangePercent: '-2.9',
    highPrice: '103',
    lowPrice: '98',
    volume: '11000',
    quoteVolume: '1100000',
};
const futuresKlines = [[1760000000000, '100', '101', '99', '100.5', '50', 0, 0, 0, '30', 0]];
const premiumIndex = {
    symbol: 'PACKETUSDT',
    markPrice: '100.5',
    indexPrice: '100.4',
    lastFundingRate: '0.00010000',
    nextFundingTime: 1760000000000,
};

const calls: string[] = [];
const fetchMock = vi.fn(async (input: unknown) => {
    const url = String(input);
    calls.push(url);
    const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
    if (url.includes('fapi/v1/ticker/24hr')) return json(futuresTicker);
    if (url.includes('/api/v3/ticker/24hr')) return json(spotTicker);
    if (url.includes('fapi/v1/klines')) return json(futuresKlines);
    if (url.includes('/api/v3/klines')) return json(futuresKlines);
    if (url.includes('premiumIndex')) return json(premiumIndex);
    return json({});
});

import { fetchCompleteMarketSnapshot, fetchMarkIndex } from '../services/analysis/MarketDataService';

describe('fetchCompleteMarketSnapshot (futures-native packet)', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', fetchMock);
        fetchMock.mockClear();
        calls.length = 0;
    });
    afterEach(() => vi.unstubAllGlobals());

    it('pulls the headline price from the FUTURES ticker, never the spot ticker', async () => {
        const snap = await fetchCompleteMarketSnapshot('PACKETUSDT');
        expect(snap.marketData.currentPrice).toBeCloseTo(100.5, 6);
        expect(calls.some(u => u.includes('fapi/v1/ticker/24hr'))).toBe(true);
        expect(calls.some(u => u.includes('/api/v3/ticker/24hr'))).toBe(false);
    });

    it('pulls the packet candles from /fapi/v1 klines', async () => {
        // Distinct symbol per test — the service cache is module-global with a
        // 30s TTL, so a reused symbol would be served from test 1's cache.
        const snap = await fetchCompleteMarketSnapshot('PACKETKUSDT');
        expect(snap.availability.klines['15m']).toBe(true);
        expect(snap.klines['15m'][0].close).toBeCloseTo(100.5, 6);
        expect(calls.filter(u => u.includes('fapi/v1/klines')).length).toBeGreaterThanOrEqual(4);
        expect(calls.some(u => u.includes('/api/v3/klines'))).toBe(false);
    });

    it('a futures ticker failure falls back to the spot ticker so the packet survives', async () => {
        vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
            const url = String(input);
            const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
            if (url.includes('fapi/v1/ticker/24hr')) return { ok: false, status: 400, json: async () => ({ code: -1121, msg: 'Invalid symbol.' }) };
            if (url.includes('/api/v3/ticker/24hr')) return json(spotTicker);
            if (url.includes('klines')) return json(futuresKlines);
            if (url.includes('premiumIndex')) return json(premiumIndex);
            return json({});
        }));
        const snap = await fetchCompleteMarketSnapshot('PACKETFALLBACKUSDT');
        expect(snap.marketData.currentPrice).toBeCloseTo(99.9, 6);
        expect(snap.availability.marketData).toBe(true);
    });
});

describe('fetchMarkIndex freshness (the live mark the packet quotes)', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(1_760_000_000_000);
        vi.stubGlobal('fetch', fetchMock);
        fetchMock.mockClear();
        calls.length = 0;
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('serves from cache only briefly, then refetches while price streams', async () => {
        await fetchMarkIndex('MARKTTLUSDT');
        expect(fetchMock).toHaveBeenCalledTimes(1);

        // 2s later: still inside the 3s live-mark window → cached.
        vi.setSystemTime(1_760_000_002_000);
        await fetchMarkIndex('MARKTTLUSDT');
        expect(fetchMock).toHaveBeenCalledTimes(1);

        // 5s in: past the window → a fresh premiumIndex pull.
        vi.setSystemTime(1_760_000_005_000);
        await fetchMarkIndex('MARKTTLUSDT');
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});
