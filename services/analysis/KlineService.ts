/**
 * KlineService - Candlestick (kline) data fetching with multi-source fallback.
 *
 * Extracted from LiveMarket.tsx and OKXChart.tsx. Browser requests to exchange
 * APIs are frequently blocked by CORS, so every fetch path rotates through a
 * chain of direct endpoints and public CORS proxies, returning the first
 * successful, well-formed response.
 *
 * All functions return a standardized Kline[] (time in milliseconds, OHLCV).
 */

import { Kline } from '../../types';

// --- Interval mapping per exchange ---

const INTERVAL_MAP: Record<'pdax' | 'coinsph' | 'binance', Record<string, string>> = {
    // PDAX uses minute-based suffixes (M) and hour (H)
    pdax: { '5m': '5M', '15m': '15M', '1h': '60M', '4h': '4H' },
    coinsph: { '5m': '5m', '15m': '15m', '1h': '1h', '4h': '4h' },
    binance: { '5m': '5m', '15m': '15m', '1h': '1h', '4h': '4h' },
};

const mapInterval = (interval: string, exchange: 'pdax' | 'coinsph' | 'binance'): string =>
    INTERVAL_MAP[exchange][interval] || interval;

// --- Core fetch helper ---

interface FetchSource {
    url: string;
    timeout: number;
}

/**
 * Fetch a URL with an abort-based timeout. Returns the parsed JSON body, or
 * throws on network error / non-OK status / timeout.
 */
const fetchJson = async (source: FetchSource): Promise<any> => {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), source.timeout);

    try {
        const response = await fetch(source.url, {
            signal: controller.signal,
            headers: { 'Accept': 'application/json' },
        });

        if (!response.ok) {
            throw new Error(`Status ${response.status}`);
        }

        // Parse via text to tolerate proxies that wrap/alter the payload.
        const text = await response.text();
        return JSON.parse(text);
    } finally {
        window.clearTimeout(timeoutId);
    }
};

/**
 * Parse Binance-style kline payload (array of arrays:
 * [time, open, high, low, close, volume, ...]) into standardized Kline[].
 * Time is preserved in milliseconds.
 */
const parseBinanceKlines = (data: any): Kline[] => {
    if (Array.isArray(data) && data.length > 0 && Array.isArray(data[0])) {
        return data.map((d: any[]) => ({
            time: d[0],
            open: parseFloat(d[1]),
            high: parseFloat(d[2]),
            low: parseFloat(d[3]),
            close: parseFloat(d[4]),
            volume: parseFloat(d[5]),
        }));
    }
    return [];
};

/**
 * Try each source in order, returning the first valid Kline[] result.
 * Returns [] if every source fails.
 */
const fetchKlinesFromSources = async (
    sources: FetchSource[],
    parse: (data: any) => Kline[],
    label: string,
): Promise<Kline[]> => {
    for (const source of sources) {
        try {
            const data = await fetchJson(source);
            const klines = parse(data);
            if (klines.length > 0) {
                return klines;
            }
        } catch (e: any) {
            // console.warn(`${label} attempt failed`, e?.name === 'AbortError' ? 'timeout' : e?.message);
        }
    }

    console.error(`All fetch attempts failed for ${label}`);
    return [];
};

// --- Binance source chain (direct + CORS proxies) ---

const buildBinanceSources = (symbol: string, interval: string, limit: number): FetchSource[] => {
    const binanceInterval = mapInterval(interval, 'binance');
    const publicUrl = `https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=${binanceInterval}&limit=${limit}`;
    const targetUrl = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${binanceInterval}&limit=${limit}`;

    return [
        // Binance Vision often allows CORS directly - try it first with a short timeout.
        { url: publicUrl, timeout: 3000 },
        { url: `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}&t=${Date.now()}`, timeout: 8000 },
        { url: `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`, timeout: 8000 },
        { url: `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetUrl)}`, timeout: 8000 },
    ];
};

/**
 * Fetch klines from Binance via a direct endpoint with CORS-proxy fallback.
 * Returns standardized Kline[] (time in ms), or [] if all sources fail.
 */
export const fetchKlines = async (
    symbol: string,
    interval: string,
    limit: number = 300,
): Promise<Kline[]> => {
    const sources = buildBinanceSources(symbol, interval, limit);
    return fetchKlinesFromSources(sources, parseBinanceKlines, `${symbol} ${interval}`);
};

// --- Philippine exchange sources (PDAX, Coins.ph) ---

/**
 * PDAX (Philippine Digital Asset Exchange). Uses PHP pairs (BTCUSDT -> BTC-PHP)
 * and returns an array of objects: { time, open, high, low, close, volume }.
 */
const fetchFromPDAX = async (symbol: string, interval: string, limit: number): Promise<Kline[]> => {
    const pdaxSymbol = symbol.replace('USDT', '-PHP');
    const pdaxInterval = mapInterval(interval, 'pdax');
    const source: FetchSource = {
        url: `https://api.pdax.ph/api/v1/market/klines?symbol=${pdaxSymbol}&interval=${pdaxInterval}&limit=${limit}`,
        timeout: 5000,
    };

    try {
        const data = await fetchJson(source);
        if (Array.isArray(data) && data.length > 0) {
            return data.map((k: any) => ({
                time: k.time,
                open: parseFloat(k.open),
                high: parseFloat(k.high),
                low: parseFloat(k.low),
                close: parseFloat(k.close),
                volume: parseFloat(k.volume),
            }));
        }
    } catch (e: any) {
        console.warn('PDAX fetch failed:', e?.name === 'AbortError' ? 'timeout' : e?.message);
    }
    return [];
};

/**
 * Coins.ph (Philippine Crypto Exchange). Returns Binance-style array of arrays.
 */
const fetchFromCoinsph = async (symbol: string, interval: string, limit: number): Promise<Kline[]> => {
    const coinsphInterval = mapInterval(interval, 'coinsph');
    const source: FetchSource = {
        url: `https://api.pro.coins.ph/openapi/quote/v1/klines?symbol=${symbol}&interval=${coinsphInterval}&limit=${limit}`,
        timeout: 5000,
    };

    try {
        const data = await fetchJson(source);
        const klines = parseBinanceKlines(data);
        if (klines.length > 0) {
            return klines;
        }
    } catch (e: any) {
        console.warn('Coins.ph fetch failed:', e?.name === 'AbortError' ? 'timeout' : e?.message);
    }
    return [];
};

/**
 * Multi-exchange kline fetch: tries Philippine exchanges first (PDAX, Coins.ph),
 * then falls back to the Binance proxy chain. Returns standardized Kline[]
 * (time in ms), or [] if all sources fail.
 */
export const fetchMultiExchangeKlines = async (
    symbol: string,
    interval: string,
    limit: number = 300,
): Promise<Kline[]> => {
    // Try PDAX first (Philippine exchange)
    const pdaxData = await fetchFromPDAX(symbol, interval, limit);
    if (pdaxData.length > 0) return pdaxData;

    // Try Coins.ph second (Philippine exchange)
    const coinsphData = await fetchFromCoinsph(symbol, interval, limit);
    if (coinsphData.length > 0) return coinsphData;

    // Fallback to Binance via proxy chain
    console.log('PH exchanges unavailable, trying Binance fallback...');
    return fetchKlines(symbol, interval, limit);
};
