/**
 * MarketDataService - Real-time market data from Binance
 * Provides OHLCV, current price, and funding rate data
 */

// Using fetch directly instead of ccxt for better browser/mobile compatibility
const BINANCE_API_BASE = 'https://api.binance.com';
const BINANCE_FUTURES_API = 'https://fapi.binance.com';

// Simple in-memory cache with eviction
const cache: Map<string, { data: any; timestamp: number }> = new Map();
const CACHE_TTL = 30000; // 30 seconds
const MAX_CACHE_SIZE = 100; // Maximum number of cached entries

export interface Kline {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

export interface MarketData {
    symbol: string;
    currentPrice: number;
    price24hHigh: number;
    price24hLow: number;
    priceChange24h: number;
    priceChangePercent24h: number;
    volume24h: number;
    fundingRate?: number;
}

/**
 * Derivatives market data from Binance Futures API (PUBLIC - No API Key Required)
 */
export interface DerivativesData {
    // Open Interest
    openInterest: number;              // OI in contracts
    openInterestValue: number;         // OI in USDT
    oiChange24h: number;               // % change in OI over 24h (approximated)

    // Long/Short Account Ratio (Global)
    longShortRatio: {
        longAccount: number;           // % of accounts that are long
        shortAccount: number;          // % of accounts that are short
        ratio: number;                 // long/short ratio
        sentiment: 'extreme_long' | 'long_bias' | 'neutral' | 'short_bias' | 'extreme_short';
    };

    // Top Trader Long/Short Ratio
    topTraderRatio: {
        longAccount: number;
        shortAccount: number;
        ratio: number;
        sentiment: 'extreme_long' | 'long_bias' | 'neutral' | 'short_bias' | 'extreme_short';
    };

    // Taker Buy/Sell Volume Ratio
    takerBuySell: {
        buyVolume: number;
        sellVolume: number;
        ratio: number;                 // buy/sell ratio
        pressure: 'strong_buying' | 'buying' | 'neutral' | 'selling' | 'strong_selling';
    };

    // Combined sentiment analysis
    overallSentiment: 'very_bullish' | 'bullish' | 'neutral' | 'bearish' | 'very_bearish';
    sentimentScore: number;            // -100 to +100

    dataTimestamp: string;
}

/**
 * Order Book Depth data - Shows buy/sell walls and liquidity
 */
export interface OrderBookData {
    // Top bid/ask levels
    bestBid: number;
    bestAsk: number;
    spread: number;
    spreadPercent: number;

    // Aggregated depth (within 1% of current price)
    bidDepth: number;              // Total bid volume within 1%
    askDepth: number;              // Total ask volume within 1%
    depthImbalance: number;        // (bid - ask) / (bid + ask), ranges -1 to +1

    // Major walls (significant order clusters)
    buyWalls: { price: number; quantity: number; usdValue: number }[];
    sellWalls: { price: number; quantity: number; usdValue: number }[];

    // Analysis
    dominantSide: 'buyers' | 'sellers' | 'balanced';
    wallDistance: {
        nearestBuyWall?: { price: number; distance: number };
        nearestSellWall?: { price: number; distance: number };
    };
}

/**
 * Recent Liquidation data - Shows forced position closures
 */
export interface LiquidationData {
    // Recent liquidations (last hour)
    recentLongLiquidations: number;    // USD value
    recentShortLiquidations: number;   // USD value
    totalRecentLiquidations: number;   // Combined

    // Liquidation events (last 10)
    recentEvents: {
        side: 'LONG' | 'SHORT';
        price: number;
        quantity: number;
        usdValue: number;
        timestamp: string;
    }[];

    // Analysis
    dominantLiquidations: 'longs' | 'shorts' | 'balanced';
    liquidationPressure: 'high' | 'medium' | 'low';
    sentiment: string; // e.g., "Heavy long liquidations - bearish pressure"
}

/**
 * Normalize symbol format for Binance API
 * Handles various input formats: BTC, BTCUSDT, BTC/USDT, btc
 */
export const normalizeSymbol = (input: string): string => {
    let symbol = input.toUpperCase().replace(/[^A-Z0-9]/g, '');

    // If it doesn't end with USDT, add it
    if (!symbol.endsWith('USDT') && !symbol.endsWith('BUSD')) {
        symbol = symbol + 'USDT';
    }

    return symbol;
};

/**
 * Get cached data or fetch new
 */
const getCached = <T>(key: string): T | null => {
    const cached = cache.get(key);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.data as T;
    }
    return null;
};

const setCache = (key: string, data: any): void => {
    // Evict expired entries first
    if (cache.size >= MAX_CACHE_SIZE) {
        const now = Date.now();
        for (const [k, v] of cache) {
            if (now - v.timestamp >= CACHE_TTL) {
                cache.delete(k);
            }
        }
    }
    // If still over limit, evict oldest entries
    if (cache.size >= MAX_CACHE_SIZE) {
        const entries = [...cache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
        const toRemove = entries.slice(0, Math.ceil(MAX_CACHE_SIZE * 0.25)); // Remove oldest 25%
        for (const [k] of toRemove) {
            cache.delete(k);
        }
    }
    cache.set(key, { data, timestamp: Date.now() });
};

// List of available Binance API endpoints to try
const BINANCE_ENDPOINTS = [
    'https://api.binance.com',
    'https://api1.binance.com',
    'https://api2.binance.com',
    'https://api3.binance.com',
    'https://data-api.binance.vision' // Fallback data API (usually works when others fail)
];

// List of available Binance Futures API endpoints to try
const BINANCE_FUTURES_ENDPOINTS = [
    'https://fapi.binance.com',
    'https://fapi1.binance.com',
    'https://fapi2.binance.com',
    'https://testnet.binancefuture.com' // Testnet fallback (may have limited data)
];

/**
 * Robust fetch helper that tries multiple Binance endpoints
 * Handles SSL certificate errors by falling back to working endpoints
 */
const robustBinanceFetch = async (apiPath: string, timeoutMs: number = 10000): Promise<Response> => {
    let lastError: Error | null = null;
    let lastStatus: number | null = null;

    for (const baseUrl of BINANCE_ENDPOINTS) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

            const response = await fetch(`${baseUrl}${apiPath}`, {
                method: 'GET',
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (response.ok) {
                return response;
            } else {
                lastStatus = response.status;
                console.warn(`[MarketDataService] ${baseUrl} returned ${response.status}, trying next...`);
            }
        } catch (error) {
            lastError = error as Error;
            console.warn(`[MarketDataService] Failed with ${baseUrl}, trying next...`);
            // Continue to next endpoint
        }
    }

    if (lastStatus) {
        throw new Error(`Binance API error: ${lastStatus}`);
    }

    throw lastError || new Error('All Binance API endpoints failed');
};

/**
 * Robust fetch helper for Binance Futures API
 * Tries multiple futures endpoints to handle CORS/SSL issues
 * Enhanced with better error handling and logging
 */
const robustFuturesFetch = async (apiPath: string, timeoutMs: number = 15000): Promise<Response> => {
    let lastError: Error | null = null;
    let lastStatus: number | null = null;

    for (const baseUrl of BINANCE_FUTURES_ENDPOINTS) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
            const fullUrl = `${baseUrl}${apiPath}`;

            console.log(`[MarketDataService] Trying Futures endpoint: ${fullUrl}`);

            const response = await fetch(fullUrl, {
                method: 'GET',
                signal: controller.signal,
                headers: {
                    'Accept': 'application/json'
                }
            });

            clearTimeout(timeoutId);

            if (response.ok) {
                console.log(`[MarketDataService] Success with ${baseUrl}`);
                return response;
            } else {
                lastStatus = response.status;
                console.warn(`[MarketDataService] ${baseUrl} returned ${response.status}, trying next...`);
            }
        } catch (error) {
            lastError = error as Error;
            console.warn(`[MarketDataService] Futures API failed with ${baseUrl}:`, (error as Error).message);
            // Continue to next endpoint
        }
    }

    // If we got a specific HTTP error, throw more info
    if (lastStatus) {
        throw new Error(`All Binance Futures endpoints failed with status: ${lastStatus}`);
    }

    // FIX: Always throw if we reach here (all endpoints failed without HTTP status)
    throw lastError || new Error('All Binance Futures endpoints failed');
};

/**
 * Ping Binance API to check connectivity
 * Uses multiple endpoints and retries for robustness
 */
export const pingBinanceAPI = async (): Promise<boolean> => {
    // Helper to try a single endpoint with timeout
    const tryEndpoint = async (baseUrl: string): Promise<boolean> => {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3000); // 3s timeout per attempt

            const response = await fetch(`${baseUrl}/api/v3/ping`, {
                method: 'GET',
                signal: controller.signal
            });

            clearTimeout(timeoutId);
            return response.ok;
        } catch (error) {
            return false;
        }
    };

    // Try endpoints in sequence (or could be parallel race if speed is critical)
    // We try up to 3 different endpoints before giving up
    for (let i = 0; i < 3; i++) {
        // Pick a random endpoint to distribute load and avoid a single down server
        const endpoint = BINANCE_ENDPOINTS[Math.floor(Math.random() * BINANCE_ENDPOINTS.length)];
        const success = await tryEndpoint(endpoint);
        if (success) return true;

        // Small delay before retry
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    console.warn('[MarketDataService] All Binance ping attempts failed.');
    return false;
};

/**
 * Fetch OHLCV (candlestick) data from Binance
 * @param symbol - Trading pair (e.g., 'BTCUSDT')
 * @param timeframe - Candle interval ('1m', '5m', '15m', '1h', '4h', '1d')
 * @param limit - Number of candles to fetch (default 100)
 */
export const fetchOHLCV = async (
    symbol: string,
    timeframe: string = '1h',
    limit: number = 100
): Promise<Kline[]> => {
    const normalizedSymbol = normalizeSymbol(symbol);
    const cacheKey = `ohlcv_${normalizedSymbol}_${timeframe}_${limit}`;

    const cached = getCached<Kline[]>(cacheKey);
    if (cached) return cached;

    try {
        const response = await robustBinanceFetch(`/api/v3/klines?symbol=${normalizedSymbol}&interval=${timeframe}&limit=${limit}`);
        const data = await response.json();

        const klines: Kline[] = data.map((k: any[]) => ({
            time: k[0],
            open: parseFloat(k[1]),
            high: parseFloat(k[2]),
            low: parseFloat(k[3]),
            close: parseFloat(k[4]),
            volume: parseFloat(k[5])
        }));

        setCache(cacheKey, klines);
        return klines;
    } catch (error) {
        console.error(`Failed to fetch OHLCV for ${normalizedSymbol}:`, error);
        throw error;
    }
};

/**
 * Fetch OHLCV data starting from a specific timestamp
 * Used for historical verification of trade outcomes
 * @param symbol - Trading pair (e.g., 'BTCUSDT')
 * @param timeframe - Candle interval ('1m', '5m', '15m', '1h', '4h', '1d')
 * @param startTime - Unix timestamp in milliseconds to start from
 * @param endTime - Optional Unix timestamp in milliseconds to end at (defaults to now)
 */
export const fetchOHLCVFromTime = async (
    symbol: string,
    timeframe: string,
    startTime: number,
    endTime?: number
): Promise<Kline[]> => {
    const normalizedSymbol = normalizeSymbol(symbol);
    const actualEndTime = endTime || Date.now();

    // Don't cache historical queries as they're specific to timestamps
    console.log(`[MarketDataService] Fetching historical klines for ${normalizedSymbol} from ${new Date(startTime).toISOString()} to ${new Date(actualEndTime).toISOString()}`);

    try {
        let url = `/api/v3/klines?symbol=${normalizedSymbol}&interval=${timeframe}&startTime=${startTime}&endTime=${actualEndTime}&limit=1000`;
        const response = await robustBinanceFetch(url);
        const data = await response.json();

        const klines: Kline[] = data.map((k: any[]) => ({
            time: k[0],
            open: parseFloat(k[1]),
            high: parseFloat(k[2]),
            low: parseFloat(k[3]),
            close: parseFloat(k[4]),
            volume: parseFloat(k[5])
        }));

        console.log(`[MarketDataService] Fetched ${klines.length} historical candles for ${normalizedSymbol}`);
        return klines;
    } catch (error) {
        console.error(`Failed to fetch historical OHLCV for ${normalizedSymbol}:`, error);
        throw error;
    }
};

/**
 * Fetch OHLCV data from Binance FUTURES API starting from a specific timestamp
 * Used for accurate historical verification of perpetual futures trade outcomes
 * @param symbol - Trading pair (e.g., 'BTCUSDT')
 * @param timeframe - Candle interval ('1m', '5m', '15m', '1h', '4h', '1d')
 * @param startTime - Unix timestamp in milliseconds to start from
 * @param endTime - Optional Unix timestamp in milliseconds to end at (defaults to now)
 */
export const fetchFuturesOHLCVFromTime = async (
    symbol: string,
    timeframe: string,
    startTime: number,
    endTime?: number
): Promise<Kline[]> => {
    const normalizedSymbol = normalizeSymbol(symbol);
    const actualEndTime = endTime || Date.now();

    console.log(`[MarketDataService] Fetching FUTURES historical klines for ${normalizedSymbol} from ${new Date(startTime).toISOString()} to ${new Date(actualEndTime).toISOString()}`);

    try {
        // Use Binance Futures API for perpetual contract prices
        const url = `/fapi/v1/klines?symbol=${normalizedSymbol}&interval=${timeframe}&startTime=${startTime}&endTime=${actualEndTime}&limit=1500`;
        const response = await robustFuturesFetch(url);
        const data = await response.json();

        const klines: Kline[] = data.map((k: any[]) => ({
            time: k[0],
            open: parseFloat(k[1]),
            high: parseFloat(k[2]),
            low: parseFloat(k[3]),
            close: parseFloat(k[4]),
            volume: parseFloat(k[5])
        }));

        console.log(`[MarketDataService] Fetched ${klines.length} FUTURES historical candles for ${normalizedSymbol}`);
        return klines;
    } catch (error) {
        console.error(`Failed to fetch Futures OHLCV for ${normalizedSymbol}:`, error);
        // Fallback to spot API if futures fails
        console.log(`[MarketDataService] Falling back to SPOT API...`);
        return fetchOHLCVFromTime(symbol, timeframe, startTime, endTime);
    }
};

/**
 * Fetch current price and 24h statistics
 */
export const fetchMarketData = async (symbol: string): Promise<MarketData> => {
    const normalizedSymbol = normalizeSymbol(symbol);
    const cacheKey = `market_${normalizedSymbol}`;

    const cached = getCached<MarketData>(cacheKey);
    if (cached) return cached;

    try {
        const response = await robustBinanceFetch(`/api/v3/ticker/24hr?symbol=${normalizedSymbol}`);
        const data = await response.json();

        const marketData: MarketData = {
            symbol: normalizedSymbol,
            currentPrice: parseFloat(data.lastPrice),
            price24hHigh: parseFloat(data.highPrice),
            price24hLow: parseFloat(data.lowPrice),
            priceChange24h: parseFloat(data.priceChange),
            priceChangePercent24h: parseFloat(data.priceChangePercent),
            volume24h: parseFloat(data.quoteVolume)
        };

        setCache(cacheKey, marketData);
        return marketData;
    } catch (error) {
        console.error(`Failed to fetch market data for ${normalizedSymbol}:`, error);
        throw error;
    }
};

/**
 * Fetch funding rate for perpetual futures
 * Uses premiumIndex endpoint which is more reliable
 */
export const fetchFundingRate = async (symbol: string): Promise<number> => {
    const normalizedSymbol = normalizeSymbol(symbol);
    const cacheKey = `funding_${normalizedSymbol}`;

    const cached = getCached<number>(cacheKey);
    if (cached !== null) return cached;

    try {
        // Try premiumIndex first - it's more reliable and gives current funding rate
        const response = await robustFuturesFetch(`/fapi/v1/premiumIndex?symbol=${normalizedSymbol}`);
        const data = await response.json();

        // premiumIndex returns a single object with lastFundingRate
        const fundingRate = parseFloat(data.lastFundingRate) || 0;

        if (fundingRate !== 0) {
            setCache(cacheKey, fundingRate);
            return fundingRate;
        }

        // Fallback: try the fundingRate endpoint
        console.log(`[MarketDataService] premiumIndex returned 0, trying fundingRate endpoint...`);
        const fallbackResponse = await robustFuturesFetch(`/fapi/v1/fundingRate?symbol=${normalizedSymbol}&limit=1`);
        const fallbackData = await fallbackResponse.json();
        const fallbackRate = fallbackData.length > 0 ? parseFloat(fallbackData[0].fundingRate) : 0;

        setCache(cacheKey, fallbackRate);
        return fallbackRate;
    } catch (error) {
        console.warn(`Failed to fetch funding rate for ${normalizedSymbol}:`, error);
        return 0;
    }
};

/**
 * Fetch Open Interest from Binance Futures (PUBLIC - No API Key Required)
 */
export const fetchOpenInterest = async (symbol: string): Promise<{ oi: number; oiValue: number }> => {
    const normalizedSymbol = normalizeSymbol(symbol);
    const cacheKey = `oi_${normalizedSymbol}`;

    const cached = getCached<{ oi: number; oiValue: number }>(cacheKey);
    if (cached) return cached;

    try {
        const response = await robustFuturesFetch(`/fapi/v1/openInterest?symbol=${normalizedSymbol}`);
        // robustFuturesFetch throws on non-ok responses

        const data = await response.json();
        const result = {
            oi: parseFloat(data.openInterest) || 0,
            oiValue: parseFloat(data.openInterest) * (await fetchMarketData(normalizedSymbol)).currentPrice || 0
        };

        setCache(cacheKey, result);
        return result;
    } catch (error) {
        console.warn(`Failed to fetch OI for ${normalizedSymbol}:`, error);
        return { oi: 0, oiValue: 0 };
    }
};

/**
 * Fetch Global Long/Short Account Ratio (PUBLIC - No API Key Required)
 * Shows the ratio of accounts with net long vs short positions
 */
export const fetchLongShortRatio = async (symbol: string): Promise<{
    longAccount: number;
    shortAccount: number;
    ratio: number;
    sentiment: 'extreme_long' | 'long_bias' | 'neutral' | 'short_bias' | 'extreme_short';
}> => {
    const normalizedSymbol = normalizeSymbol(symbol);
    const cacheKey = `lsr_${normalizedSymbol}`;

    const cached = getCached<ReturnType<typeof fetchLongShortRatio> extends Promise<infer T> ? T : never>(cacheKey);
    if (cached) return cached;

    try {
        const response = await robustFuturesFetch(`/futures/data/globalLongShortAccountRatio?symbol=${normalizedSymbol}&period=5m&limit=1`);
        // robustFuturesFetch throws on non-ok responses

        const data = await response.json();
        if (!data || data.length === 0) {
            return { longAccount: 50, shortAccount: 50, ratio: 1, sentiment: 'neutral' };
        }

        const latest = data[0];
        const longAccount = parseFloat(latest.longAccount) * 100;
        const shortAccount = parseFloat(latest.shortAccount) * 100;
        const ratio = parseFloat(latest.longShortRatio);

        // Determine sentiment based on ratio
        let sentiment: 'extreme_long' | 'long_bias' | 'neutral' | 'short_bias' | 'extreme_short';
        if (ratio > 2) sentiment = 'extreme_long';
        else if (ratio > 1.2) sentiment = 'long_bias';
        else if (ratio < 0.5) sentiment = 'extreme_short';
        else if (ratio < 0.8) sentiment = 'short_bias';
        else sentiment = 'neutral';

        const result = { longAccount, shortAccount, ratio, sentiment };
        setCache(cacheKey, result);
        return result;
    } catch (error) {
        console.warn(`Failed to fetch Long/Short ratio for ${normalizedSymbol}:`, error);
        return { longAccount: 50, shortAccount: 50, ratio: 1, sentiment: 'neutral' };
    }
};

/**
 * Fetch Top Trader Long/Short Ratio (PUBLIC - No API Key Required)
 * Shows positioning of top traders by accounts
 */
export const fetchTopTraderRatio = async (symbol: string): Promise<{
    longAccount: number;
    shortAccount: number;
    ratio: number;
    sentiment: 'extreme_long' | 'long_bias' | 'neutral' | 'short_bias' | 'extreme_short';
}> => {
    const normalizedSymbol = normalizeSymbol(symbol);
    const cacheKey = `ttr_${normalizedSymbol}`;

    const cached = getCached<ReturnType<typeof fetchTopTraderRatio> extends Promise<infer T> ? T : never>(cacheKey);
    if (cached) return cached;

    try {
        const response = await robustFuturesFetch(`/futures/data/topLongShortAccountRatio?symbol=${normalizedSymbol}&period=5m&limit=1`);
        // robustFuturesFetch throws on non-ok responses

        const data = await response.json();
        if (!data || data.length === 0) {
            return { longAccount: 50, shortAccount: 50, ratio: 1, sentiment: 'neutral' };
        }

        const latest = data[0];
        const longAccount = parseFloat(latest.longAccount) * 100;
        const shortAccount = parseFloat(latest.shortAccount) * 100;
        const ratio = parseFloat(latest.longShortRatio);

        let sentiment: 'extreme_long' | 'long_bias' | 'neutral' | 'short_bias' | 'extreme_short';
        if (ratio > 2) sentiment = 'extreme_long';
        else if (ratio > 1.2) sentiment = 'long_bias';
        else if (ratio < 0.5) sentiment = 'extreme_short';
        else if (ratio < 0.8) sentiment = 'short_bias';
        else sentiment = 'neutral';

        const result = { longAccount, shortAccount, ratio, sentiment };
        setCache(cacheKey, result);
        return result;
    } catch (error) {
        console.warn(`Failed to fetch Top Trader ratio for ${normalizedSymbol}:`, error);
        return { longAccount: 50, shortAccount: 50, ratio: 1, sentiment: 'neutral' };
    }
};

/**
 * Fetch Taker Buy/Sell Volume Ratio (PUBLIC - No API Key Required)
 * Shows aggressive buying vs selling pressure
 */
export const fetchTakerBuySellRatio = async (symbol: string): Promise<{
    buyVolume: number;
    sellVolume: number;
    ratio: number;
    pressure: 'strong_buying' | 'buying' | 'neutral' | 'selling' | 'strong_selling';
}> => {
    const normalizedSymbol = normalizeSymbol(symbol);
    const cacheKey = `tbs_${normalizedSymbol}`;

    const cached = getCached<ReturnType<typeof fetchTakerBuySellRatio> extends Promise<infer T> ? T : never>(cacheKey);
    if (cached) return cached;

    try {
        const response = await robustFuturesFetch(`/futures/data/takerlongshortRatio?symbol=${normalizedSymbol}&period=5m&limit=1`);
        // robustFuturesFetch throws on non-ok responses

        const data = await response.json();
        if (!data || data.length === 0) {
            return { buyVolume: 0, sellVolume: 0, ratio: 1, pressure: 'neutral' };
        }

        const latest = data[0];
        const buyVolume = parseFloat(latest.buyVol) || 0;
        const sellVolume = parseFloat(latest.sellVol) || 0;
        const ratio = parseFloat(latest.buySellRatio) || 1;

        let pressure: 'strong_buying' | 'buying' | 'neutral' | 'selling' | 'strong_selling';
        if (ratio > 1.5) pressure = 'strong_buying';
        else if (ratio > 1.1) pressure = 'buying';
        else if (ratio < 0.67) pressure = 'strong_selling';
        else if (ratio < 0.9) pressure = 'selling';
        else pressure = 'neutral';

        const result = { buyVolume, sellVolume, ratio, pressure };
        setCache(cacheKey, result);
        return result;
    } catch (error) {
        console.warn(`Failed to fetch Taker Buy/Sell for ${normalizedSymbol}:`, error);
        return { buyVolume: 0, sellVolume: 0, ratio: 1, pressure: 'neutral' };
    }
};

/**
 * Fetch all derivatives data in one call
 * Combines Open Interest, Long/Short Ratios, and Taker Buy/Sell data
 */
export const fetchDerivativesData = async (symbol: string): Promise<DerivativesData> => {
    const normalizedSymbol = normalizeSymbol(symbol);
    const cacheKey = `derivatives_${normalizedSymbol}`;

    const cached = getCached<DerivativesData>(cacheKey);
    if (cached) return cached;

    try {
        const [oi, lsr, ttr, tbs] = await Promise.all([
            fetchOpenInterest(normalizedSymbol),
            fetchLongShortRatio(normalizedSymbol),
            fetchTopTraderRatio(normalizedSymbol),
            fetchTakerBuySellRatio(normalizedSymbol)
        ]);

        // Calculate overall sentiment score (-100 to +100)
        // Weight: Long/Short Ratio (30%), Top Trader (40%), Taker Buy/Sell (30%)
        let sentimentScore = 0;

        // Long/Short contribution
        const lsrScore = (lsr.ratio - 1) * 50; // 1 = neutral, 2 = +50, 0.5 = -25
        sentimentScore += lsrScore * 0.3;

        // Top Trader contribution (more weight to smart money)
        const ttrScore = (ttr.ratio - 1) * 50;
        sentimentScore += ttrScore * 0.4;

        // Taker Buy/Sell contribution
        const tbsScore = (tbs.ratio - 1) * 50;
        sentimentScore += tbsScore * 0.3;

        // Clamp to -100 to +100
        sentimentScore = Math.max(-100, Math.min(100, sentimentScore));

        // Determine overall sentiment
        let overallSentiment: DerivativesData['overallSentiment'];
        if (sentimentScore > 40) overallSentiment = 'very_bullish';
        else if (sentimentScore > 15) overallSentiment = 'bullish';
        else if (sentimentScore < -40) overallSentiment = 'very_bearish';
        else if (sentimentScore < -15) overallSentiment = 'bearish';
        else overallSentiment = 'neutral';

        const result: DerivativesData = {
            openInterest: oi.oi,
            openInterestValue: oi.oiValue,
            oiChange24h: 0, // Would need historical data to calculate
            longShortRatio: lsr,
            topTraderRatio: ttr,
            takerBuySell: tbs,
            overallSentiment,
            sentimentScore: Math.round(sentimentScore),
            dataTimestamp: new Date().toISOString()
        };

        setCache(cacheKey, result);
        return result;
    } catch (error) {
        console.error(`Failed to fetch derivatives data for ${normalizedSymbol}:`, error);
        // Return neutral defaults
        return {
            openInterest: 0,
            openInterestValue: 0,
            oiChange24h: 0,
            longShortRatio: { longAccount: 50, shortAccount: 50, ratio: 1, sentiment: 'neutral' },
            topTraderRatio: { longAccount: 50, shortAccount: 50, ratio: 1, sentiment: 'neutral' },
            takerBuySell: { buyVolume: 0, sellVolume: 0, ratio: 1, pressure: 'neutral' },
            overallSentiment: 'neutral',
            sentimentScore: 0,
            dataTimestamp: new Date().toISOString()
        };
    }
};

/**
 * Fetch Order Book Depth from Binance Futures (PUBLIC - No API Key Required)
 * Shows bid/ask walls and liquidity distribution
 */
export const fetchOrderBookDepth = async (symbol: string): Promise<OrderBookData> => {
    const normalizedSymbol = normalizeSymbol(symbol);
    const cacheKey = `orderbook_${normalizedSymbol}`;

    const cached = getCached<OrderBookData>(cacheKey);
    if (cached) return cached;

    try {
        // Fetch futures order book (limit 100 for detailed depth)
        const response = await robustFuturesFetch(`/fapi/v1/depth?symbol=${normalizedSymbol}&limit=100`);
        // robustFuturesFetch throws on non-ok responses

        const data = await response.json();
        const currentPrice = await fetchMarketData(normalizedSymbol).then(m => m.currentPrice);

        // Parse bids and asks: [[price, quantity], ...]
        const bids: { price: number; qty: number }[] = data.bids.map((b: string[]) => ({
            price: parseFloat(b[0]),
            qty: parseFloat(b[1])
        }));

        const asks: { price: number; qty: number }[] = data.asks.map((a: string[]) => ({
            price: parseFloat(a[0]),
            qty: parseFloat(a[1])
        }));

        const bestBid = bids[0]?.price || currentPrice;
        const bestAsk = asks[0]?.price || currentPrice;
        const spread = bestAsk - bestBid;
        const spreadPercent = (spread / currentPrice) * 100;

        // Calculate depth within 1% of current price
        const priceRange = currentPrice * 0.01;
        const bidDepth = bids
            .filter(b => b.price >= currentPrice - priceRange)
            .reduce((sum, b) => sum + (b.qty * b.price), 0);
        const askDepth = asks
            .filter(a => a.price <= currentPrice + priceRange)
            .reduce((sum, a) => sum + (a.qty * a.price), 0);
        const depthImbalance = (bidDepth + askDepth) > 0
            ? (bidDepth - askDepth) / (bidDepth + askDepth)
            : 0;

        // Detect walls (orders > 3x average size)
        const avgBidSize = bids.reduce((sum, b) => sum + b.qty, 0) / bids.length;
        const avgAskSize = asks.reduce((sum, a) => sum + a.qty, 0) / asks.length;

        const buyWalls = bids
            .filter(b => b.qty >= avgBidSize * 3)
            .slice(0, 3)
            .map(b => ({ price: b.price, quantity: b.qty, usdValue: b.qty * b.price }));

        const sellWalls = asks
            .filter(a => a.qty >= avgAskSize * 3)
            .slice(0, 3)
            .map(a => ({ price: a.price, quantity: a.qty, usdValue: a.qty * a.price }));

        // Determine dominant side
        const dominantSide: OrderBookData['dominantSide'] =
            depthImbalance > 0.15 ? 'buyers' :
                depthImbalance < -0.15 ? 'sellers' : 'balanced';

        // Calculate wall distances
        const wallDistance: OrderBookData['wallDistance'] = {};
        if (buyWalls.length > 0) {
            wallDistance.nearestBuyWall = {
                price: buyWalls[0].price,
                distance: ((currentPrice - buyWalls[0].price) / currentPrice) * 100
            };
        }
        if (sellWalls.length > 0) {
            wallDistance.nearestSellWall = {
                price: sellWalls[0].price,
                distance: ((sellWalls[0].price - currentPrice) / currentPrice) * 100
            };
        }

        const result: OrderBookData = {
            bestBid,
            bestAsk,
            spread,
            spreadPercent,
            bidDepth,
            askDepth,
            depthImbalance,
            buyWalls,
            sellWalls,
            dominantSide,
            wallDistance
        };

        setCache(cacheKey, result);
        return result;
    } catch (error) {
        console.warn(`Failed to fetch order book for ${normalizedSymbol}:`, error);
        return getDefaultOrderBook();
    }
};

const getDefaultOrderBook = (): OrderBookData => ({
    bestBid: 0,
    bestAsk: 0,
    spread: 0,
    spreadPercent: 0,
    bidDepth: 0,
    askDepth: 0,
    depthImbalance: 0,
    buyWalls: [],
    sellWalls: [],
    dominantSide: 'balanced',
    wallDistance: {}
});

/**
 * Fetch Recent Liquidations from Binance Futures
 * Note: The forceOrders endpoint may require authentication for symbol-specific queries.
 * We try fetching all liquidations first and filter client-side.
 */
export const fetchRecentLiquidations = async (symbol: string): Promise<LiquidationData> => {
    const normalizedSymbol = normalizeSymbol(symbol);
    const cacheKey = `liquidations_${normalizedSymbol}`;

    const cached = getCached<LiquidationData>(cacheKey);
    if (cached) return cached;

    try {
        // Try fetching all recent force orders (without symbol - this is public)
        // Then filter for our symbol client-side
        let data: any[] = [];

        try {
            // First try with symbol (may fail without auth)
            const symbolResponse = await robustFuturesFetch(`/fapi/v1/forceOrders?symbol=${normalizedSymbol}&limit=50`);
            data = await symbolResponse.json();
            console.log(`[MarketDataService] Got ${(data || []).length} liquidations for ${normalizedSymbol}`);
        } catch (symbolError) {
            console.warn(`[MarketDataService] Symbol-specific liquidations failed, trying all liquidations...`);

            // Fallback: fetch all recent liquidations and filter
            try {
                const allResponse = await robustFuturesFetch(`/fapi/v1/allForceOrders?limit=100`);
                const allData = await allResponse.json();
                data = (allData || []).filter((o: any) => o.symbol === normalizedSymbol);
                console.log(`[MarketDataService] Filtered ${data.length} liquidations for ${normalizedSymbol} from all`);
            } catch (allError) {
                console.warn(`[MarketDataService] All liquidations fetch also failed:`, allError);
                // Return default with "data unavailable" note
                return getDefaultLiquidations();
            }
        }

        // Filter to last hour
        const oneHourAgo = Date.now() - (60 * 60 * 1000);
        const recentOrders = (data || []).filter((o: any) => o.time >= oneHourAgo);

        let recentLongLiquidations = 0;
        let recentShortLiquidations = 0;

        const recentEvents: LiquidationData['recentEvents'] = recentOrders
            .slice(0, 10)
            .map((o: any) => {
                const side: 'LONG' | 'SHORT' = o.side === 'BUY' ? 'SHORT' : 'LONG'; // Buy to close = was short, Sell to close = was long
                const qty = parseFloat(o.origQty) || 0;
                const price = parseFloat(o.price) || 0;
                const usdValue = qty * price;

                if (side === 'LONG') recentLongLiquidations += usdValue;
                else recentShortLiquidations += usdValue;

                return {
                    side,
                    price,
                    quantity: qty,
                    usdValue,
                    timestamp: new Date(o.time).toISOString()
                };
            });

        const totalRecentLiquidations = recentLongLiquidations + recentShortLiquidations;

        // Determine dominant side
        const ratio = totalRecentLiquidations > 0
            ? recentLongLiquidations / totalRecentLiquidations
            : 0.5;
        const dominantLiquidations: LiquidationData['dominantLiquidations'] =
            ratio > 0.6 ? 'longs' : ratio < 0.4 ? 'shorts' : 'balanced';

        // Determine pressure level
        const liquidationPressure: LiquidationData['liquidationPressure'] =
            totalRecentLiquidations > 10000000 ? 'high' :
                totalRecentLiquidations > 1000000 ? 'medium' : 'low';

        // Generate sentiment string
        let sentiment = '';
        if (liquidationPressure === 'high') {
            sentiment = dominantLiquidations === 'longs'
                ? '🔴 Heavy long liquidations — bearish pressure'
                : dominantLiquidations === 'shorts'
                    ? '🟢 Heavy short liquidations — bullish squeeze'
                    : '⚪ Mixed liquidations — volatile conditions';
        } else if (liquidationPressure === 'medium') {
            sentiment = dominantLiquidations === 'longs'
                ? 'Moderate long liquidations — bearish lean'
                : dominantLiquidations === 'shorts'
                    ? 'Moderate short liquidations — bullish lean'
                    : 'Balanced liquidations — neutral';
        } else {
            sentiment = 'Low liquidation activity — stable market';
        }

        const result: LiquidationData = {
            recentLongLiquidations,
            recentShortLiquidations,
            totalRecentLiquidations,
            recentEvents,
            dominantLiquidations,
            liquidationPressure,
            sentiment
        };

        setCache(cacheKey, result);
        return result;
    } catch (error) {
        console.warn(`Failed to fetch liquidations for ${normalizedSymbol}:`, error);
        return getDefaultLiquidations();
    }
};

const getDefaultLiquidations = (): LiquidationData => ({
    recentLongLiquidations: 0,
    recentShortLiquidations: 0,
    totalRecentLiquidations: 0,
    recentEvents: [],
    dominantLiquidations: 'balanced',
    liquidationPressure: 'low',
    sentiment: 'No liquidation data available'
});

/**
 * Fetch complete market snapshot for a symbol
 * Includes price, OHLCV for multiple timeframes, and funding rate
 */
export const fetchCompleteMarketSnapshot = async (
    symbol: string
): Promise<{
    marketData: MarketData;
    klines: { '5m': Kline[]; '15m': Kline[]; '1h': Kline[]; '4h': Kline[] };
    fundingRate: number;
}> => {
    const normalizedSymbol = normalizeSymbol(symbol);

    console.log(`[MarketDataService] Fetching complete snapshot for ${normalizedSymbol}`);

    const [marketData, klines5m, klines15m, klines1h, klines4h, fundingRate] = await Promise.all([
        fetchMarketData(normalizedSymbol),
        fetchOHLCV(normalizedSymbol, '5m', 100),   // More candles for more accurate indicators
        fetchOHLCV(normalizedSymbol, '15m', 100),
        fetchOHLCV(normalizedSymbol, '1h', 100),
        fetchOHLCV(normalizedSymbol, '4h', 100),
        fetchFundingRate(normalizedSymbol)
    ]);

    return {
        marketData,
        klines: {
            '5m': klines5m,
            '15m': klines15m,
            '1h': klines1h,
            '4h': klines4h
        },
        fundingRate
    };
};

/**
 * Extract symbol from user prompt
 * Looks for common crypto symbols in the text
 */
export const extractSymbolFromPrompt = (prompt: string): string | null => {
    const upperPrompt = prompt.toUpperCase();

    // Common trading pairs to look for
    const commonSymbols = [
        'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT',
        'ADAUSDT', 'AVAXUSDT', 'DOTUSDT', 'MATICUSDT', 'LINKUSDT', 'ATOMUSDT',
        'LTCUSDT', 'UNIUSDT', 'APTUSDT', 'ARBUSDT', 'OPUSDT', 'SUIUSDT',
        'PEPEUSDT', 'SHIBUSDT', 'WIFUSDT', 'BONKUSDT', 'FLOKIUSDT',
        'BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'DOGE', 'ADA', 'AVAX', 'DOT', 'MATIC'
    ];

    for (const symbol of commonSymbols) {
        if (upperPrompt.includes(symbol)) {
            return symbol.endsWith('USDT') ? symbol : symbol + 'USDT';
        }
    }

    // Try to find pattern like "analyze X" or "X/USDT"
    const patterns = [
        /ANALYZE\s+([A-Z]{2,10})/i,
        /([A-Z]{2,10})\/USDT/i,
        /([A-Z]{2,10})\s+CHART/i,
        /([A-Z]{2,10})\s+ANALYSIS/i
    ];

    for (const pattern of patterns) {
        const match = upperPrompt.match(pattern);
        if (match && match[1]) {
            return match[1] + 'USDT';
        }
    }

    return null;
};
