import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * The chart's candle HISTORY must come from the FUTURES market (fapi) — the
 * same market as the Trade surface's markPrice@1s websocket, funding/OI and
 * the hybrid packet. Spot history under a futures mark line made the
 * spot↔perp basis read as a price move. Regression: fetchKlines pulls
 * /fapi/v1/klines first, maps the app's interval tokens ('1D'→'1d', monthly
 * stays capital '1M'), and only when fapi is unreachable degrades to the
 * SPOT mirror chain (logged as such).
 */

const fapiCandles = [[1760000000000, '100', '101', '99', '100.5', '50', 1760000900000, 0, 0, '30', 0, '0']];
const spotCandles = [[1760000000000, '200', '201', '199', '200.5', '80', 1760000900000, 0, 0, '60', 0, '0']];

const respond = (body: unknown, ok = true) => ({
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
    text: async () => JSON.stringify(body),
});

const calls: string[] = [];
const fetchMock = vi.fn(async (input: unknown) => {
    const url = String(input);
    calls.push(url);
    // Catches every futures mirror (fapi.binance.com / fapi1 / fapi2).
    if (url.includes('fapi/v1/klines')) return respond(fapiCandles);
    // binance.vision, api.binance.com and the CORS proxies all proxy spot.
    if (url.includes('klines')) return respond(spotCandles);
    return respond({}, false);
});

import { fetchKlines } from '../services/analysis/KlineService';

describe('fetchKlines (futures-native chart history)', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', fetchMock);
        fetchMock.mockClear();
        calls.length = 0;
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('pulls history from the FUTURES klines endpoint, never spot', async () => {
        const klines = await fetchKlines('FTCHUSDT', '15m', 60);
        expect(klines[0].close).toBeCloseTo(100.5, 6);
        expect(calls.some(u => u.includes('fapi/v1/klines'))).toBe(true);
        // '//api.binance.com' with the scheme separator — 'api.binance.com'
        // alone would also match 'fapi.binance.com'.
        expect(calls.some(u => u.includes('binance.vision') || u.includes('//api.binance.com'))).toBe(false);
    });

    it('maps the app interval tokens for futures — 1D → 1d, and 1M stays CAPITAL monthly', async () => {
        await fetchKlines('FTCHDUSDT', '1D', 60);
        expect(calls.some(u => u.includes('fapi/v1/klines') && u.includes('interval=1d'))).toBe(true);

        calls.length = 0;
        await fetchKlines('FTCHMUSDT', '1M', 60);
        // Monthly must stay capital '1M' — lowercase '1m' is 1-MINUTE.
        expect(calls.some(u => u.includes('fapi/v1/klines') && u.includes('interval=1M'))).toBe(true);
        expect(calls.some(u => u.includes('fapi/v1/klines') && u.includes('interval=1m'))).toBe(false);
    });

    it('when fapi is unreachable it degrades to the spot chain and says so', async () => {
        vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
            const url = String(input);
            calls.push(url);
            if (url.includes('fapi/v1/klines')) return respond({}, false);
            if (url.includes('klines')) return respond(spotCandles);
            return respond({}, false);
        }));
        const klines = await fetchKlines('FTCHFALLUSDT', '15m', 60);
        expect(klines[0].close).toBeCloseTo(200.5, 6);
        expect(calls.some(u => u.includes('binance.vision') || u.includes('//api.binance.com'))).toBe(true);
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('DEGRADED to the SPOT mirror chain'));
    });
});
