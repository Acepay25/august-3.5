import React, { useEffect, useRef, useState } from 'react';
import { createChart, IChartApi, CandlestickData, Time, ISeriesApi, CandlestickSeries, LineSeries, LineData, LineStyle } from 'lightweight-charts';
import { analyzeWithAI, TrendlineResult, convertToLineData } from '../services/AITrendlineService';

interface OKXChartProps {
    symbol: string;
    interval: string;
    isVisible: boolean;
}

// OKX API intervals mapping
const INTERVAL_MAP: Record<string, string> = {
    '5m': '5m',
    '15m': '15m',
    '1h': '1H',
    '4h': '4H',
};

// Convert symbol format (BTCUSDT -> BTC-USDT)
const formatSymbol = (symbol: string): string => {
    return symbol.replace('USDT', '-USDT');
};

// Map interval for different exchanges
const mapInterval = (interval: string, exchange: 'pdax' | 'coinsph' | 'binance'): string => {
    const map: Record<string, Record<string, string>> = {
        pdax: { '5m': '5M', '15m': '15M', '1h': '60M', '4h': '4H' },
        coinsph: { '5m': '5m', '15m': '15m', '1h': '1h', '4h': '4h' },
        binance: { '5m': '5m', '15m': '15m', '1h': '1h', '4h': '4h' },
    };
    return map[exchange][interval] || interval;
};

// Main fetch function - tries multiple Philippine exchanges first, then Binance
const fetchOKXCandles = async (symbol: string, interval: string): Promise<CandlestickData<Time>[]> => {
    // Try PDAX first (Philippine exchange)
    const pdaxData = await tryFetchFromPDAX(symbol, interval);
    if (pdaxData.length > 0) return pdaxData;

    // Try Coins.ph second (Philippine exchange)
    const coinsphData = await tryFetchFromCoinsph(symbol, interval);
    if (coinsphData.length > 0) return coinsphData;

    // Fallback to Binance via proxy
    console.log('PH exchanges unavailable, trying Binance fallback...');
    return await fetchFromBinanceFallback(symbol, interval);
};

// PDAX API - Philippine Digital Asset Exchange
const tryFetchFromPDAX = async (symbol: string, interval: string): Promise<CandlestickData<Time>[]> => {
    // PDAX uses PHP pairs, convert: BTCUSDT -> BTC-PHP
    const pdaxSymbol = symbol.replace('USDT', '-PHP');
    const pdaxInterval = mapInterval(interval, 'pdax');
    const url = `https://api.pdax.ph/api/v1/market/klines?symbol=${pdaxSymbol}&interval=${pdaxInterval}&limit=300`;

    try {
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), 5000);

        const response = await fetch(url, {
            signal: controller.signal,
            headers: { 'Accept': 'application/json' }
        });
        window.clearTimeout(timeoutId);

        if (!response.ok) {
            console.warn(`PDAX returned ${response.status}`);
            return [];
        }

        const data = await response.json();
        // PDAX returns array of { time, open, close, high, low, volume }
        if (Array.isArray(data) && data.length > 0) {
            console.log(`PDAX data loaded: ${data.length} candles`);
            return data.map((k: any) => ({
                time: Math.floor(k.time / 1000) as Time,
                open: parseFloat(k.open),
                high: parseFloat(k.high),
                low: parseFloat(k.low),
                close: parseFloat(k.close),
            }));
        }
    } catch (e: any) {
        console.warn('PDAX fetch failed:', e.name === 'AbortError' ? 'timeout' : e.message);
    }
    return [];
};

// Coins.ph API - Philippine Crypto Exchange
const tryFetchFromCoinsph = async (symbol: string, interval: string): Promise<CandlestickData<Time>[]> => {
    const coinsphInterval = mapInterval(interval, 'coinsph');
    const url = `https://api.pro.coins.ph/openapi/quote/v1/klines?symbol=${symbol}&interval=${coinsphInterval}&limit=300`;

    try {
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), 5000);

        const response = await fetch(url, {
            signal: controller.signal,
            headers: { 'Accept': 'application/json' }
        });
        window.clearTimeout(timeoutId);

        if (!response.ok) {
            console.warn(`Coins.ph returned ${response.status}`);
            return [];
        }

        const data = await response.json();
        // Coins.ph returns array similar to Binance: [[time, open, high, low, close, volume], ...]
        if (Array.isArray(data) && data.length > 0 && Array.isArray(data[0])) {
            console.log(`Coins.ph data loaded: ${data.length} candles`);
            return data.map((k: any[]) => ({
                time: Math.floor(k[0] / 1000) as Time,
                open: parseFloat(k[1]),
                high: parseFloat(k[2]),
                low: parseFloat(k[3]),
                close: parseFloat(k[4]),
            }));
        }
    } catch (e: any) {
        console.warn('Coins.ph fetch failed:', e.name === 'AbortError' ? 'timeout' : e.message);
    }
    return [];
};

// Binance fallback - uses proxies that work for indicators
const fetchFromBinanceFallback = async (symbol: string, interval: string): Promise<CandlestickData<Time>[]> => {
    const binanceInterval = mapInterval(interval, 'binance');
    const binanceUrl = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${binanceInterval}&limit=300`;

    const sources = [
        { url: `https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=${binanceInterval}&limit=300`, timeout: 3000 },
        { url: `https://api.allorigins.win/raw?url=${encodeURIComponent(binanceUrl)}&t=${Date.now()}`, timeout: 6000 },
        { url: `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(binanceUrl)}`, timeout: 6000 },
    ];

    for (const source of sources) {
        try {
            const controller = new AbortController();
            const timeoutId = window.setTimeout(() => controller.abort(), source.timeout);

            const response = await fetch(source.url, {
                signal: controller.signal,
                headers: { 'Accept': 'application/json' }
            });
            window.clearTimeout(timeoutId);

            if (!response.ok) continue;

            const data = await response.json();
            if (Array.isArray(data) && data.length > 0 && Array.isArray(data[0])) {
                console.log(`Binance fallback loaded: ${data.length} candles`);
                return data.map((k: any[]) => ({
                    time: Math.floor(k[0] / 1000) as Time,
                    open: parseFloat(k[1]),
                    high: parseFloat(k[2]),
                    low: parseFloat(k[3]),
                    close: parseFloat(k[4]),
                }));
            }
        } catch (e: any) {
            console.warn('Binance fallback failed:', e.name === 'AbortError' ? 'timeout' : e.message);
        }
    }

    console.error('All data sources failed');
    return [];
};

// --- Auto Trendline Detection ---

interface SwingPoint {
    time: Time;
    price: number;
    type: 'high' | 'low';
    index: number;
}

// Detect swing highs and lows (pivot points)
const detectSwingPoints = (candles: CandlestickData<Time>[], lookback: number = 5): SwingPoint[] => {
    const swings: SwingPoint[] = [];

    for (let i = lookback; i < candles.length - lookback; i++) {
        const current = candles[i];
        let isSwingHigh = true;
        let isSwingLow = true;

        // Check if current is higher/lower than surrounding candles
        for (let j = i - lookback; j <= i + lookback; j++) {
            if (j === i) continue;
            if (candles[j].high >= current.high) isSwingHigh = false;
            if (candles[j].low <= current.low) isSwingLow = false;
        }

        if (isSwingHigh) {
            swings.push({ time: current.time, price: current.high, type: 'high', index: i });
        }
        if (isSwingLow) {
            swings.push({ time: current.time, price: current.low, type: 'low', index: i });
        }
    }

    return swings;
};

// Calculate trendline points from swing points
const calculateTrendlines = (swings: SwingPoint[], candles: CandlestickData<Time>[]): {
    resistance: LineData<Time>[] | null;
    support: LineData<Time>[] | null;
} => {
    // Get only recent swing highs and lows
    const recentHighs = swings.filter(s => s.type === 'high').slice(-3);
    const recentLows = swings.filter(s => s.type === 'low').slice(-3);

    let resistance: LineData<Time>[] | null = null;
    let support: LineData<Time>[] | null = null;

    // Create descending resistance line from swing highs
    if (recentHighs.length >= 2) {
        const h1 = recentHighs[recentHighs.length - 2];
        const h2 = recentHighs[recentHighs.length - 1];

        // Extend line to current candle
        const lastCandle = candles[candles.length - 1];
        const slope = (h2.price - h1.price) / (h2.index - h1.index);
        const extendedPrice = h2.price + slope * (candles.length - 1 - h2.index);

        resistance = [
            { time: h1.time, value: h1.price },
            { time: lastCandle.time, value: extendedPrice },
        ];
    }

    // Create ascending support line from swing lows
    if (recentLows.length >= 2) {
        const l1 = recentLows[recentLows.length - 2];
        const l2 = recentLows[recentLows.length - 1];

        // Extend line to current candle
        const lastCandle = candles[candles.length - 1];
        const slope = (l2.price - l1.price) / (l2.index - l1.index);
        const extendedPrice = l2.price + slope * (candles.length - 1 - l2.index);

        support = [
            { time: l1.time, value: l1.price },
            { time: lastCandle.time, value: extendedPrice },
        ];
    }

    return { resistance, support };
};

const OKXChart: React.FC<OKXChartProps> = ({ symbol, interval, isVisible }) => {
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
    const resistanceLineRef = useRef<ISeriesApi<'Line'> | null>(null);
    const supportLineRef = useRef<ISeriesApi<'Line'> | null>(null);
    const aiTrendlinesRef = useRef<ISeriesApi<'Line'>[]>([]);
    const isMountedRef = useRef(true);
    const [isLoading, setIsLoading] = useState(true);
    const [isAIAnalyzing, setIsAIAnalyzing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [lastPrice, setLastPrice] = useState<number | null>(null);
    const [priceChange, setPriceChange] = useState<number>(0);
    const [marketBias, setMarketBias] = useState<'bullish' | 'bearish' | 'neutral'>('neutral');
    const [aiSummary, setAiSummary] = useState<string>('');

    // Initialize chart with proper sizing
    useEffect(() => {
        if (!isVisible) return;

        // Delay initialization to ensure container has dimensions
        const initTimeout = setTimeout(() => {
            if (!chartContainerRef.current) return;

            const container = chartContainerRef.current;
            const width = container.clientWidth || 800;
            const height = container.clientHeight || 500;

            // OKX-style dark theme colors
            const chart = createChart(container, {
                width,
                height,
                layout: {
                    background: { color: '#0b0e11' }, // OKX dark bg
                    textColor: '#848e9c',
                },
                grid: {
                    vertLines: { color: '#1f2937' },
                    horzLines: { color: '#1f2937' },
                },
                crosshair: {
                    mode: 1,
                    vertLine: {
                        color: '#00c896',
                        width: 1,
                        style: 2,
                        labelBackgroundColor: '#00c896',
                    },
                    horzLine: {
                        color: '#00c896',
                        width: 1,
                        style: 2,
                        labelBackgroundColor: '#00c896',
                    },
                },
                rightPriceScale: {
                    borderColor: '#1f2937',
                    scaleMargins: {
                        top: 0.1,
                        bottom: 0.2,
                    },
                },
                timeScale: {
                    borderColor: '#1f2937',
                    timeVisible: true,
                    secondsVisible: false,
                },
            });

            // OKX-style candle colors (green/red) - lightweight-charts v5 API
            const candleSeries = chart.addSeries(CandlestickSeries, {
                upColor: '#00c896',          // OKX green
                downColor: '#f03a50',        // OKX red
                borderUpColor: '#00c896',
                borderDownColor: '#f03a50',
                wickUpColor: '#00c896',
                wickDownColor: '#f03a50',
            });

            chartRef.current = chart;
            candleSeriesRef.current = candleSeries;

            // Use ResizeObserver for proper sizing
            const resizeObserver = new ResizeObserver((entries) => {
                for (const entry of entries) {
                    const { width, height } = entry.contentRect;
                    if (width > 0 && height > 0) {
                        chart.applyOptions({ width, height });
                    }
                }
            });

            resizeObserver.observe(container);

            // Cleanup stored for this scope
            (chartRef.current as any)._resizeObserver = resizeObserver;
        }, 100);

        return () => {
            isMountedRef.current = false;
            clearTimeout(initTimeout);
            if (chartRef.current) {
                const observer = (chartRef.current as any)._resizeObserver;
                if (observer) observer.disconnect();
                chartRef.current.remove();
                chartRef.current = null;
                candleSeriesRef.current = null;
            }
        };
    }, [isVisible]);

    // Fetch and update data
    useEffect(() => {
        if (!isVisible) return;

        let isMounted = true;
        let retryTimeout: number | null = null;

        const loadData = async () => {
            if (!isMountedRef.current) return;
            // Wait for chart to be ready
            if (!candleSeriesRef.current) {
                // Retry after a short delay if chart isn't ready yet
                retryTimeout = window.setTimeout(loadData, 200);
                return;
            }

            setIsLoading(true);
            setError(null);

            try {
                const candles = await fetchOKXCandles(symbol, interval);

                if (!isMounted) return;

                if (candles.length > 0) {
                    candleSeriesRef.current?.setData(candles);

                    // --- AI-Powered Trendlines ---
                    // Remove old trendlines first
                    if (resistanceLineRef.current && chartRef.current) {
                        chartRef.current.removeSeries(resistanceLineRef.current);
                        resistanceLineRef.current = null;
                    }
                    if (supportLineRef.current && chartRef.current) {
                        chartRef.current.removeSeries(supportLineRef.current);
                        supportLineRef.current = null;
                    }
                    // Remove old AI trendlines
                    aiTrendlinesRef.current.forEach(line => {
                        if (chartRef.current) {
                            try { chartRef.current.removeSeries(line); } catch { }
                        }
                    });
                    aiTrendlinesRef.current = [];

                    // Use basic algorithmic trendlines as fallback first (instant)
                    const swings = detectSwingPoints(candles, 5);
                    const { resistance, support } = calculateTrendlines(swings, candles);

                    if (resistance && chartRef.current) {
                        const resLine = chartRef.current.addSeries(LineSeries, {
                            color: '#f03a50',
                            lineWidth: 1,
                            lineStyle: LineStyle.Dotted,
                            lastValueVisible: false,
                            priceLineVisible: false,
                        });
                        resLine.setData(resistance);
                        resistanceLineRef.current = resLine;
                    }
                    if (support && chartRef.current) {
                        const supLine = chartRef.current.addSeries(LineSeries, {
                            color: '#00c896',
                            lineWidth: 1,
                            lineStyle: LineStyle.Dotted,
                            lastValueVisible: false,
                            priceLineVisible: false,
                        });
                        supLine.setData(support);
                        supportLineRef.current = supLine;
                    }

                    // Calculate price info
                    const latestCandle = candles[candles.length - 1];
                    const firstCandle = candles[0];
                    setLastPrice(latestCandle.close);
                    setPriceChange(((latestCandle.close - firstCandle.open) / firstCandle.open) * 100);
                    chartRef.current?.timeScale().fitContent();

                    // AI Analysis in background (non-blocking)
                    setIsAIAnalyzing(true);
                    analyzeWithAI(candles, symbol, interval)
                        .then(analysis => {
                            if (!isMounted || !chartRef.current) return;

                            // Only remove algorithmic lines if AI has trendlines to replace them
                            if (analysis.trendlines.length > 0) {
                                if (resistanceLineRef.current) {
                                    try { chartRef.current?.removeSeries(resistanceLineRef.current); } catch { }
                                    resistanceLineRef.current = null;
                                }
                                if (supportLineRef.current) {
                                    try { chartRef.current?.removeSeries(supportLineRef.current); } catch { }
                                    supportLineRef.current = null;
                                }
                            }

                            // Draw AI-identified trendlines
                            analysis.trendlines.forEach(tl => {
                                if (!chartRef.current) return;

                                const lineData = convertToLineData(tl);
                                const lineWidth = tl.importance === 'high' ? 3 : tl.importance === 'medium' ? 2 : 1;

                                const line = chartRef.current.addSeries(LineSeries, {
                                    color: tl.color,
                                    lineWidth,
                                    lineStyle: LineStyle.Solid,
                                    lastValueVisible: false,
                                    priceLineVisible: false,
                                });
                                line.setData(lineData);
                                aiTrendlinesRef.current.push(line);
                            });

                            // Update state with AI insights
                            setMarketBias(analysis.marketBias);
                            setAiSummary(analysis.summary);
                            console.log(`[AI Trendlines] ${analysis.trendlines.length} lines, bias: ${analysis.marketBias}`);
                        })
                        .catch(err => {
                            console.warn('[AI Trendlines] Analysis failed:', err.message);
                            // Keep algorithmic trendlines on AI failure
                        })
                        .finally(() => {
                            if (isMounted) setIsAIAnalyzing(false);
                        });
                } else {
                    setError('No data available - OKX may be blocked');
                }
            } catch (e) {
                if (isMounted) setError('Failed to load OKX data');
            } finally {
                if (isMounted) setIsLoading(false);
            }
        };

        // Track if this is initial load or refresh
        let isInitialLoad = true;

        const loadDataWithAI = async () => {
            await loadData();
            isInitialLoad = false;
        };

        // Refresh data only (no AI re-analysis) - just update candles
        const refreshDataOnly = async () => {
            if (!candleSeriesRef.current) return;
            try {
                const candles = await fetchOKXCandles(symbol, interval);
                if (candles.length > 0 && isMounted && candleSeriesRef.current) {
                    candleSeriesRef.current.setData(candles);
                    // Update price info
                    const latestCandle = candles[candles.length - 1];
                    const firstCandle = candles[0];
                    setLastPrice(latestCandle.close);
                    setPriceChange(((latestCandle.close - firstCandle.open) / firstCandle.open) * 100);
                }
            } catch (e) {
                console.warn('[OKXChart] Refresh failed:', e);
            }
        };

        // Start loading after a delay to let chart initialize
        const startTimeout = window.setTimeout(loadDataWithAI, 200);

        // Refresh data every 30 seconds (without re-running AI analysis)
        const refreshInterval = window.setInterval(refreshDataOnly, 30000);

        return () => {
            isMounted = false;
            if (retryTimeout) clearTimeout(retryTimeout);
            clearTimeout(startTimeout);
            clearInterval(refreshInterval);
        };
    }, [symbol, interval, isVisible]);

    if (!isVisible) return null;

    return (
        <div className="w-full h-full relative bg-[#0b0e11]">
            {/* OKX-style header overlay - mobile optimized */}
            <div className="absolute top-0 left-0 right-0 z-10 px-2 sm:px-4 py-2 sm:py-3 bg-gradient-to-b from-[#0b0e11] to-transparent">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-1.5 sm:gap-3 flex-wrap">
                        {/* OKX Logo Badge */}
                        <div className="flex items-center gap-1.5 sm:gap-2 bg-[#00c896]/10 border border-[#00c896]/20 rounded-lg px-2 sm:px-3 py-1 sm:py-1.5">
                            <span className="text-[#00c896] font-bold text-xs sm:text-sm">OKX</span>
                        </div>

                        {/* AI Market Bias Badge */}
                        {isAIAnalyzing ? (
                            <div className="flex items-center gap-2 bg-[#ffd700]/10 border border-[#ffd700]/20 rounded-lg px-3 py-1.5">
                                <div className="w-3 h-3 border-2 border-[#ffd700] border-t-transparent rounded-full animate-spin"></div>
                                <span className="text-[#ffd700] font-bold text-xs">AI Analyzing...</span>
                            </div>
                        ) : marketBias !== 'neutral' && (
                            <div className={`flex items-center gap-2 rounded-lg px-3 py-1.5 ${marketBias === 'bullish'
                                ? 'bg-[#00c896]/10 border border-[#00c896]/20'
                                : 'bg-[#f03a50]/10 border border-[#f03a50]/20'
                                }`}>
                                <span className={`font-bold text-xs ${marketBias === 'bullish' ? 'text-[#00c896]' : 'text-[#f03a50]'
                                    }`}>
                                    {marketBias === 'bullish' ? '🐂 BULLISH' : '🐻 BEARISH'}
                                </span>
                            </div>
                        )}

                        <div className="flex items-center gap-2">
                            <span className="text-white font-bold text-lg">{symbol.replace('USDT', '/USDT')}</span>
                            <span className="text-xs text-[#848e9c] bg-[#1f2937] px-2 py-0.5 rounded">Perp</span>
                        </div>
                    </div>

                    {lastPrice && (
                        <div className="text-right">
                            <div className="text-xl font-mono font-bold text-white">
                                ${lastPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </div>
                            <div className={`text-sm font-bold ${priceChange >= 0 ? 'text-[#00c896]' : 'text-[#f03a50]'}`}>
                                {priceChange >= 0 ? '+' : ''}{priceChange.toFixed(2)}%
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Loading/Error states */}
            {isLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-[#0b0e11]/80 z-20">
                    <div className="flex flex-col items-center gap-3">
                        <div className="w-8 h-8 border-2 border-[#00c896] border-t-transparent rounded-full animate-spin"></div>
                        <span className="text-[#848e9c] text-sm">Loading OKX data...</span>
                    </div>
                </div>
            )}

            {error && !isLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-[#0b0e11]/80 z-20">
                    <div className="text-center">
                        <div className="text-[#f03a50] text-lg font-bold mb-2">⚠️ {error}</div>
                        <p className="text-[#848e9c] text-sm">OKX API may be unavailable in your region</p>
                    </div>
                </div>
            )}

            {/* Chart container */}
            <div ref={chartContainerRef} className="w-full h-full" />

            {/* OKX-style bottom bar */}
            <div className="absolute bottom-0 left-0 right-0 z-10 px-4 py-2 bg-gradient-to-t from-[#0b0e11] to-transparent">
                <div className="flex items-center justify-between text-xs text-[#848e9c]">
                    <span>Powered by OKX API</span>
                    <span>{interval.toUpperCase()}</span>
                </div>
            </div>
        </div>
    );
};

export default React.memo(OKXChart);
