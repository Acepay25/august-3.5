/**
 * KlineService - Candlestick (kline) data fetching.
 *
 * PRIMARY source: Binance USDT-FUTURES klines (fapi) — the SAME market as the
 * Trade surface's markPrice@1s websocket, funding/OI, and the hybrid packet.
 * The desk is a perps desk: chart history from the SPOT market made the
 * painted candles deviate from the live mark on moving symbols (the
 * spot↔perp basis read as a price move). fapi sends
 * `Access-Control-Allow-Origin: *`, so the browser calls it directly; on
 * failure the request races the fapi/fapi1/fapi2 mirrors.
 *
 * DEGRADED FALLBACK: the SPOT mirror chain (data-api.binance.vision + CORS
 * proxies) — a DIFFERENT market whose candles can deviate from the perp
 * feed. Used only when fapi itself is unreachable from the browser, and
 * logged as degraded when it wins.
 *
 * All functions return a standardized Kline[] (time in milliseconds, OHLCV).
 */

import { Kline } from '../../types';

// --- Short-TTL cache + in-flight coalescing ---
// Chart mounts/polls re-race up to 4 proxy sources per fetch; a 30s TTL and
// shared promise dedupe concurrent identical requests (mirrors
// MarketDataService's pattern).
const klineCache = new Map<string, { at: number; data: Kline[] }>();
const klineInFlight = new Map<string, Promise<Kline[]>>();
const KLINE_CACHE_TTL_MS = 30_000;

// --- Binance interval mapping ---
// Binance klines are case-sensitive: daily/weekly are lowercase
// ('1d','3d','1w') but MONTHLY is a CAPITAL '1M' (a lowercase '1m' is
// 1-MINUTE). The app's timeframe tokens use '1D','3D','1W','1M'
// (TradingChart.CHART_INTERVALS), so map the multi-day ones here —
// normalizing in ONE place means no caller has to `.toLowerCase()` and
// silently turn the monthly chart into a 1-minute one. Spot and futures
// klines share the interval tokens.
const BINANCE_INTERVALS: Record<string, string> = {
    '5m': '5m', '15m': '15m', '1h': '1h', '4h': '4h',
    '1D': '1d', '3D': '3d', '1W': '1w', '1M': '1M',
};

const mapBinanceInterval = (interval: string): string => BINANCE_INTERVALS[interval] || interval;

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
 * Time is preserved in milliseconds. Spot (/api/v3) and futures (/fapi/v1)
 * klines share this array layout.
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
 * the first non-empty payload is a valid drop-in result. Resolves [] when
 * every source fails.
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

// --- PRIMARY: Binance futures klines (fapi, browser-direct) ---

const FUTURES_HOSTS = [
    'https://fapi.binance.com',
    'https://fapi1.binance.com',
    'https://fapi2.binance.com',
];

const buildFuturesSources = (symbol: string, interval: string, limit: number): FetchSource[] => {
    const binanceInterval = mapBinanceInterval(interval);
    return FUTURES_HOSTS.map(host => ({
        url: `${host}/fapi/v1/klines?symbol=${symbol}&interval=${binanceInterval}&limit=${limit}`,
        timeout: 8000,
    }));
};

// --- DEGRADED FALLBACK: Binance SPOT mirror chain (direct + CORS proxies) ---

const buildBinanceSources = (symbol: string, interval: string, limit: number): FetchSource[] => {
    const binanceInterval = mapBinanceInterval(interval);
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
 * Fetch klines for the perp chart: futures (fapi) first, spot mirror chain as
 * the labeled degraded fallback. Returns standardized Kline[] (time in ms),
 * or [] if both fail.
 *
 * `noCache` bypasses the 30 s read cache for periodic re-syncs (the live
 * watchdog / 15 s chart refresh) — without it the TTL halves their cadence
 * and can serve a just-closed bar its pre-close OHLC for up to 30 s. Fresh
 * results still land IN the cache (other consumers benefit either way).
 */
export const fetchKlines = async (
    symbol: string,
    interval: string,
    limit: number = 300,
    opts?: { noCache?: boolean },
): Promise<Kline[]> => {
    const cacheKey = `kline_${symbol}_${interval}_${limit}`;
    const cached = klineCache.get(cacheKey);
    if (cached && !opts?.noCache && Date.now() - cached.at < KLINE_CACHE_TTL_MS) return cached.data;
    const inFlight = klineInFlight.get(cacheKey);
    if (inFlight) return inFlight;

    const promise = (async () => {
        try {
            // PRIMARY: the futures market itself — same instrument the user
            // trades, same basis as the markPrice@1s feed and the packet.
            let data = await fetchKlinesFromSources(
                buildFuturesSources(symbol, interval, limit),
                parseBinanceKlines,
                `${symbol} ${interval} (futures)`,
            );
            if (data.length === 0) {
                console.warn(
                    `[KlineService] futures klines unavailable for ${symbol} ${interval} — DEGRADED to the SPOT mirror chain; candles may deviate from the perp feed`,
                );
                data = await fetchKlinesFromSources(
                    buildBinanceSources(symbol, interval, limit),
                    parseBinanceKlines,
                    `${symbol} ${interval} (spot fallback)`,
                );
            }
            klineCache.set(cacheKey, { at: Date.now(), data });
            return data;
        } finally {
            klineInFlight.delete(cacheKey);
        }
    })();
    klineInFlight.set(cacheKey, promise);
    return promise;
};
