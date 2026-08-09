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
 * Race all sources in parallel and resolve with the first VALID kline payload.
 * The old serial chain let a single slow source add its full timeout to the
 * critical path (worst case 27s+ for the Binance chain); with a parallel race
 * the fastest healthy source wins and the rest are abandoned (their abort
 * timers still fire, releasing the sockets). All sources share one parser, so
 * the first non-empty payload is a valid drop-in result.
 */
const fetchKlinesFromSources = async (
    sources: FetchSource[],
    parse: (data: any) => Kline[],
    label: string,
): Promise<Kline[]> => {
    const attempts = sources.map(async (source) => {
        const data = await fetchJson(source);
        const klines = parse(data);
        if (klines.length === 0) throw new Error('empty payload');
        return klines;
    });

    try {
        return await Promise.any(attempts);
    } catch {
        // Every source rejected or returned an empty payload.
        console.error(`All fetch attempts failed for ${label}`);
        return [];
    }
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
    // Only the trailing USDT quote gets converted. A blanket replace mangles
    // symbols where 'USDT' appears in the base (TUSDUSDT → T-PHPUSDT) and
    // passes non-USDT quotes (BTCBUSD) through to PDAX as garbage.
    const pdaxSymbol = symbol.endsWith('USDT') ? `${symbol.slice(0, -4)}-PHP` : symbol;
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
 * Multi-exchange kline fetch: races the two Philippine exchanges in parallel,
 * then falls back to the Binance proxy chain. Returns standardized Kline[]
 * (time in ms), or [] if all sources fail.
 *
 * Both PH exchanges quote the same pairs (BTCUSDT → BTC-PHP), so whichever
 * responds first with a non-empty payload is a valid result for the caller —
 * racing them (instead of the old PDAX→Coins.ph serial chain) cuts the
 * worst-case PH latency from ~10s to ~5s and returns as soon as the faster
 * exchange answers.
 */
export const fetchMultiExchangeKlines = async (
    symbol: string,
    interval: string,
    limit: number = 300,
): Promise<Kline[]> => {
    const phAttempts = [
        fetchFromPDAX(symbol, interval, limit).then(k => {
            if (k.length === 0) throw new Error('PDAX empty');
            return k;
        }),
        fetchFromCoinsph(symbol, interval, limit).then(k => {
            if (k.length === 0) throw new Error('Coins.ph empty');
            return k;
        }),
    ];

    try {
        return await Promise.any(phAttempts);
    } catch {
        // Both PH exchanges unavailable — fall back to Binance via proxy chain.
        console.log('PH exchanges unavailable, trying Binance fallback...');
        return fetchKlines(symbol, interval, limit);
    }
};
