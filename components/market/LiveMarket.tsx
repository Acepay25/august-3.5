
import React, { useState, useEffect, useRef } from 'react';
import { CloseIcon, ActivityIcon, BellIcon, TrashIcon, LoadingIcon, CameraIcon, CheckIcon, ChevronDownIcon, BrainIcon, TrendUpIcon, TrendDownIcon, AlertTriangleIcon } from '../shared/Icons';
import { Kline } from '../../../types';
import { detectChartPatterns, detectKeyZones, DetectedPattern } from '../../../utils/patternDetection';
import OKXChart from './OKXChart';
import { analyzeWithAI, AITrendlineAnalysis, MarketInsights } from '../../services/analysis/AITrendlineService';
import { CandlestickData, Time } from 'lightweight-charts';

interface LiveMarketProps {
    isVisible: boolean;
    onClose: () => void;
    onAnalyze: (data: string) => void;
}

interface Alert {
    id: string;
    price: number;
    symbol: string;
    condition: 'above' | 'below';
    active: boolean;
}

declare global {
    interface Window {
        TradingView: any;
    }
}

const ASSETS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'DOGEUSDT', 'PEPEUSDT', 'TAOUSDT', 'XRPUSDT', 'BNBUSDT', 'ADAUSDT', 'AVAXUSDT'];
const INTERVALS = ['5m', '15m', '1h', '4h'];
const EXCHANGES = ['BINANCE', 'OKX'] as const;
type Exchange = typeof EXCHANGES[number];

// --- Data Engine ---

const fetchKlines = async (symbol: string, interval: string, limit: number = 300): Promise<Kline[]> => {
    // Try Binance Vision first (often allows CORS), then proxies
    const publicUrl = `https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    const targetUrl = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;

    const sources = [
        { url: publicUrl, isProxy: false },
        { url: `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}&t=${Date.now()}`, isProxy: true },
        { url: `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`, isProxy: true },
        { url: `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetUrl)}`, isProxy: true },
    ];

    for (const source of sources) {
        try {
            const controller = new AbortController();
            // Shorter timeout for direct, longer for proxies
            const timeoutId = window.setTimeout(() => controller.abort(), source.isProxy ? 8000 : 3000);

            const response = await fetch(source.url, {
                signal: controller.signal,
                headers: { 'Accept': 'application/json' }
            });
            window.clearTimeout(timeoutId);

            if (!response.ok) {
                continue;
            }

            const text = await response.text();
            try {
                const data = JSON.parse(text);
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
            } catch (parseError) {
                // console.warn(`JSON parse failed for ${interval}`);
            }
        } catch (e) {
            // console.warn(`Fetch attempt failed for ${symbol} ${interval}`, e);
        }
    }

    console.error(`All fetch attempts failed for ${symbol} ${interval}`);
    return [];
};

const calculateSMA = (data: number[], period: number): number | null => {
    if (data.length < period) return null;
    const slice = data.slice(-period);
    const sum = slice.reduce((a, b) => a + b, 0);
    return parseFloat((sum / period).toFixed(2));
};

const calculateEMA = (data: number[], period: number): number | null => {
    if (data.length < period) return null;
    const k = 2 / (period + 1);
    const seed = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
    let ema = seed;
    for (let i = period; i < data.length; i++) {
        ema = data[i] * k + ema * (1 - k);
    }
    return parseFloat(ema.toFixed(2));
};

const calculateRSI = (data: number[], period: number = 14): number | null => {
    if (data.length < period + 1) return null;
    let gains = 0;
    let losses = 0;
    for (let i = 1; i <= period; i++) {
        const diff = data[i] - data[i - 1];
        if (diff > 0) gains += diff;
        else losses -= diff;
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;

    for (let i = period + 1; i < data.length; i++) {
        const diff = data[i] - data[i - 1];
        if (diff > 0) {
            avgGain = (avgGain * (period - 1) + diff) / period;
            avgLoss = (avgLoss * (period - 1)) / period;
        } else {
            avgGain = (avgGain * (period - 1)) / period;
            avgLoss = (avgLoss * (period - 1) - diff) / period;
        }
    }

    if (avgLoss === 0) {
        // If average loss is 0, it usually means price only went up (RSI=100).
        // However, if avgGain is ALSO 0 (flat market), RSI should be 50 (neutral).
        return avgGain === 0 ? 50 : 100;
    }

    const rs = avgGain / avgLoss;
    return parseFloat((100 - (100 / (1 + rs))).toFixed(2));
};

const calculateMACD = (data: number[], fast: number = 12, slow: number = 26, signal: number = 9) => {
    if (data.length < slow + signal) return { dif: null, dea: null, hist: null };
    const getEMAArray = (values: number[], period: number) => {
        const k = 2 / (period + 1);
        const emas = [];
        let ema = values[0];
        emas.push(ema);
        for (let i = 1; i < values.length; i++) {
            ema = values[i] * k + ema * (1 - k);
            emas.push(ema);
        }
        return emas;
    };
    const emaFast = getEMAArray(data, fast);
    const emaSlow = getEMAArray(data, slow);
    const difLine = emaFast.map((f, i) => f - emaSlow[i]);
    const deaLine = getEMAArray(difLine, signal);
    const currentDif = difLine[difLine.length - 1];
    const currentDea = deaLine[deaLine.length - 1];
    const currentHist = 2 * (currentDif - currentDea);
    return { dif: parseFloat(currentDif.toFixed(4)), dea: parseFloat(currentDea.toFixed(4)), hist: parseFloat(currentHist.toFixed(4)) };
};

const calculateBollingerBands = (data: number[], period: number = 20, stdDevMultiplier: number = 2) => {
    if (data.length < period) return { upper: null, lower: null, mid: null };
    const mid = calculateSMA(data, period);
    if (mid === null) return { upper: null, lower: null, mid: null };
    const slice = data.slice(-period);
    const variance = slice.reduce((a, b) => a + Math.pow(b - mid, 2), 0) / period;
    const stdDev = Math.sqrt(variance);
    return {
        upper: parseFloat((mid + stdDev * stdDevMultiplier).toFixed(2)),
        lower: parseFloat((mid - stdDev * stdDevMultiplier).toFixed(2)),
        mid: mid
    };
};

const calculateKDJ = (klines: Kline[]) => {
    const N = 9;
    if (klines.length < N) return { k: 50, d: 50, j: 50 };
    let k = 50;
    let d = 50;
    for (let i = 0; i < klines.length; i++) {
        if (i < N - 1) continue;
        const periodData = klines.slice(i - N + 1, i + 1);
        const lows = periodData.map(k => k.low);
        const highs = periodData.map(k => k.high);
        const lowestLow = Math.min(...lows);
        const highestHigh = Math.max(...highs);
        const close = klines[i].close;
        let rsv = 50;
        if (highestHigh !== lowestLow) rsv = ((close - lowestLow) / (highestHigh - lowestLow)) * 100;
        k = (2 / 3) * k + (1 / 3) * rsv;
        d = (2 / 3) * d + (1 / 3) * k;
    }
    const j = 3 * k - 2 * d;
    return { k: parseFloat(k.toFixed(2)), d: parseFloat(d.toFixed(2)), j: parseFloat(j.toFixed(2)) };
};

const calculateSAR = (klines: Kline[], step = 0.02, max = 0.2) => {
    if (klines.length < 20) return null;
    let isRising = klines[1].high > klines[0].high;
    let sar = isRising ? klines[0].low : klines[0].high;
    let ep = isRising ? klines[0].high : klines[0].low;
    let af = step;
    for (let i = 1; i < klines.length; i++) {
        const prevSar = sar;
        const prevEp = ep;
        const low = klines[i].low;
        const high = klines[i].high;
        sar = prevSar + af * (prevEp - prevSar);
        if (isRising) {
            if (low < sar) { isRising = false; sar = ep; ep = low; af = step; }
            else { if (high > ep) { ep = high; af = Math.min(af + step, max); } if (i > 1) sar = Math.min(sar, klines[i - 1].low, klines[i - 2].low); }
        } else {
            if (high > sar) { isRising = true; sar = ep; ep = high; af = step; }
            else { if (low < ep) { ep = low; af = Math.min(af + step, max); } if (i > 1) sar = Math.max(sar, klines[i - 1].high, klines[i - 2].high); }
        }
    }
    return parseFloat(sar.toFixed(2));
};

const identifyCandlePattern = (klines: Kline[]) => {
    if (klines.length < 2) return "Normal";
    const current = klines[klines.length - 1];
    const prev = klines[klines.length - 2];
    const body = Math.abs(current.close - current.open);
    const totalRange = current.high - current.low;
    if (body <= totalRange * 0.1 && totalRange > 0) return "Doji";
    const isBullish = current.close > current.open;
    const isPrevBearish = prev.close < prev.open;
    if (isBullish && isPrevBearish && current.close > prev.open && current.open < prev.close) return "Bullish Engulfing";
    if (!isBullish && !isPrevBearish && current.close < prev.open && current.open > prev.close) return "Bearish Engulfing";
    return "Normal";
};

const LiveMarket: React.FC<LiveMarketProps> = ({ isVisible, onClose, onAnalyze }) => {
    const [symbol, setSymbol] = useState('ETHUSDT');
    const [interval, setInterval] = useState('15m');
    const [exchange, setExchange] = useState<Exchange>('BINANCE');
    const [alerts, setAlerts] = useState<Alert[]>([]);
    const alertsRef = useRef<Alert[]>([]);

    const [newAlertPrice, setNewAlertPrice] = useState('');
    const [isAlertModalOpen, setIsAlertModalOpen] = useState(false);

    const [notification, setNotification] = useState<string | null>(null);
    const [analysisProgress, setAnalysisProgress] = useState<string | null>(null);

    const [connectionState, setConnectionState] = useState<{
        status: 'connecting' | 'connected' | 'reconnecting';
        source: 'socket' | 'polling';
    }>({ status: 'connecting', source: 'socket' });

    // AI Analysis state for Binance
    const [isAIAnalyzing, setIsAIAnalyzing] = useState(false);
    const [marketBias, setMarketBias] = useState<'bullish' | 'bearish' | 'neutral'>('neutral');
    const [aiSummary, setAiSummary] = useState<string>('');
    const [keyLevels, setKeyLevels] = useState<{ price: number; type: 'support' | 'resistance' }[]>([]);
    const [marketInsights, setMarketInsights] = useState<MarketInsights | null>(null);
    const [isInsightsPanelExpanded, setIsInsightsPanelExpanded] = useState(true);

    const widgetRef = useRef<HTMLDivElement>(null);
    const tradingViewWidgetRef = useRef<any>(null);
    const notificationTimeoutRef = useRef<number | null>(null);

    const priceDisplayRef = useRef<HTMLSpanElement>(null);
    const lastPriceRef = useRef<number | null>(null);

    const isMountedRef = useRef(true);

    useEffect(() => {
        alertsRef.current = alerts;
    }, [alerts]);

    useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
            // Clear notification timeout on unmount
            if (notificationTimeoutRef.current) {
                window.clearTimeout(notificationTimeoutRef.current);
                notificationTimeoutRef.current = null;
            }
        };
    }, []);

    useEffect(() => {
        if (isVisible && !window.TradingView) {
            // Check if script already exists to prevent duplicate injection
            const existingScript = document.querySelector('script[src*="tradingview"]');
            if (!existingScript) {
                const script = document.createElement('script');
                script.src = 'https://s3.tradingview.com/tv.js';
                script.async = true;
                script.onload = initWidget;
                document.head.appendChild(script);
            }
        } else if (isVisible && window.TradingView) {
            initWidget();
        }

        return () => {
            // Cleanup widget on unmount or when dependencies change
            if (tradingViewWidgetRef.current) {
                try {
                    if (typeof tradingViewWidgetRef.current.remove === 'function') {
                        tradingViewWidgetRef.current.remove();
                    }
                } catch (e) {
                    // Widget remove not supported, clear container instead
                }
                tradingViewWidgetRef.current = null;
            }
            if (widgetRef.current) {
                widgetRef.current.innerHTML = '';
            }
        };
    }, [isVisible, symbol, interval, exchange, initWidget]);

    const initWidget = () => {
        if (window.TradingView && widgetRef.current) {
            widgetRef.current.innerHTML = '';
            // Map symbol for OKX (uses BTCUSDT.P format for perpetual swaps)
            const chartSymbol = exchange === 'OKX'
                ? `OKX:${symbol}.P`
                : `BINANCE:${symbol}`;
            tradingViewWidgetRef.current = new window.TradingView.widget({
                autosize: true,
                symbol: chartSymbol,
                interval: mapIntervalToTradingView(interval),
                timezone: "Etc/UTC",
                theme: "dark",
                style: "1",
                locale: "en",
                toolbar_bg: "#f1f3f6",
                enable_publishing: false,
                allow_symbol_change: true,
                container_id: "tradingview_widget",
                studies: ["RSI@tv-basicstudies", "MASimple@tv-basicstudies", "MACD@tv-basicstudies", "BollingerBands@tv-basicstudies"],
                hide_side_toolbar: false,
                save_image: true,
            });
        }
    };

    const mapIntervalToTradingView = (appInterval: string): string => {
        switch (appInterval) {
            case '5m': return '5';
            case '15m': return '15';
            case '1h': return '60';
            case '4h': return '240';
            default: return '15';
        }
    }

    // AI Analysis for chart
    useEffect(() => {
        if (!isVisible) {
            setMarketBias('neutral');
            setAiSummary('');
            setKeyLevels([]);
            setMarketInsights(null);
            return;
        }

        const runAIAnalysis = async () => {
            setIsAIAnalyzing(true);
            try {
                // Fetch kline data for AI analysis
                const klines = await fetchKlines(symbol, interval, 300);
                if (klines.length < 50) {
                    setIsAIAnalyzing(false);
                    return;
                }

                // Convert to CandlestickData format for AI service
                const candles: CandlestickData<Time>[] = klines.map(k => ({
                    time: Math.floor(k.time / 1000) as Time,
                    open: k.open,
                    high: k.high,
                    low: k.low,
                    close: k.close,
                }));

                const analysis = await analyzeWithAI(candles, symbol, interval);

                if (isMountedRef.current) {
                    setMarketBias(analysis.marketBias);
                    setAiSummary(analysis.summary);
                    setKeyLevels(analysis.keyLevels);
                    setMarketInsights(analysis.insights);
                    console.log(`[Binance AI] ${analysis.trendlines.length} trendlines, bias: ${analysis.marketBias}`);
                }
            } catch (error) {
                console.warn('[Binance AI] Analysis failed:', error);
            } finally {
                if (isMountedRef.current) setIsAIAnalyzing(false);
            }
        };

        // Debounce to avoid rapid calls
        const timeout = setTimeout(runAIAnalysis, 500);
        return () => clearTimeout(timeout);
    }, [isVisible, exchange, symbol, interval]);
    useEffect(() => {
        if (!isVisible) {
            setConnectionState({ status: 'connecting', source: 'socket' });
            return;
        }

        // Initial UI Reset
        if (priceDisplayRef.current) {
            priceDisplayRef.current.textContent = 'Loading...';
            priceDisplayRef.current.className = "font-mono text-sm sm:text-base font-bold text-zinc-600 transition-colors duration-300";
        }
        lastPriceRef.current = null;

        let ws: WebSocket | null = null;
        let pollingInterval: number | null = null;
        let reconnectTimeout: number | null = null;
        let retryCount = 0;
        let isUnmounted = false;

        const updatePriceUI = (price: number) => {
            if (isUnmounted) return;

            if (priceDisplayRef.current) {
                const prev = lastPriceRef.current || price;

                requestAnimationFrame(() => {
                    if (!priceDisplayRef.current) return;
                    priceDisplayRef.current.textContent = `$${price.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

                    if (price > prev) {
                        priceDisplayRef.current.className = "font-mono text-sm sm:text-base font-bold transition-colors duration-300 text-emerald-400";
                    } else if (price < prev) {
                        priceDisplayRef.current.className = "font-mono text-sm sm:text-base font-bold transition-colors duration-300 text-rose-400";
                    }
                    lastPriceRef.current = price;
                });
            }

            const currentAlerts = alertsRef.current;
            let hasUpdates = false;
            const nextAlerts = currentAlerts.map(alert => {
                if (!alert.active || alert.symbol !== symbol) return alert;
                const triggered = (alert.condition === 'above' && price >= alert.price) || (alert.condition === 'below' && price <= alert.price);
                if (triggered) {
                    showNotification(`Price Alert: ${symbol} crossed ${alert.price}`);
                    hasUpdates = true;
                    return { ...alert, active: false };
                }
                return alert;
            });
            if (hasUpdates) setAlerts(nextAlerts);
        };

        const stopPolling = () => {
            if (pollingInterval) {
                clearInterval(pollingInterval);
                pollingInterval = null;
            }
        };

        const fetchRestPrice = async () => {
            const visionUrl = `https://data-api.binance.vision/api/v3/ticker/price?symbol=${symbol}`;
            const targetUrl = `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`;

            const sources = [
                { url: visionUrl, isProxy: false },
                { url: `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}&t=${Date.now()}`, isProxy: true },
                { url: `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`, isProxy: true },
            ];

            // Race strategy: Parallel execution to get the first available price
            const fetchSource = (source: { url: string, isProxy: boolean }): Promise<number> => {
                return new Promise(async (resolve, reject) => {
                    const controller = new AbortController();
                    // Shorter timeout for faster failover perception in the race
                    const timeoutId = window.setTimeout(() => controller.abort(), source.isProxy ? 4000 : 2000);

                    try {
                        const response = await fetch(source.url, { signal: controller.signal });
                        window.clearTimeout(timeoutId);

                        if (!response.ok) {
                            reject(new Error(`Status ${response.status}`));
                            return;
                        }

                        const data = await response.json();
                        if (data.price) {
                            resolve(parseFloat(data.price));
                        } else {
                            reject(new Error("No price data"));
                        }
                    } catch (e) {
                        reject(e);
                    }
                });
            };

            try {
                // Implement a Promise.any-like race for robustness
                const promises = sources.map(s => fetchSource(s));
                const price = await new Promise<number>((resolve, reject) => {
                    let failureCount = 0;
                    promises.forEach(p => {
                        p.then(resolve).catch(() => {
                            failureCount++;
                            if (failureCount === promises.length) reject(new Error("All sources failed"));
                        });
                    });
                });

                if (!isUnmounted) {
                    updatePriceUI(price);
                    // Only update state to polling if WS is NOT active/open
                    if (!ws || ws.readyState !== WebSocket.OPEN) {
                        setConnectionState({ status: 'connected', source: 'polling' });
                    }
                }
            } catch (error) {
                // Silently fail, we'll try again next tick
            }
        };

        const startPolling = () => {
            if (pollingInterval) return;
            fetchRestPrice(); // Immediate fetch
            pollingInterval = window.setInterval(fetchRestPrice, 2000);
        };

        const connectWs = () => {
            if (isUnmounted) return;

            // Cleanup old instance
            if (ws) {
                ws.onclose = null;
                ws.close();
            }

            // Use port 443 for better firewall compatibility
            const wsSymbol = symbol.toLowerCase();
            const wsUrl = `wss://stream.binance.com:443/ws/${wsSymbol}@trade`;

            try {
                ws = new WebSocket(wsUrl);

                ws.onopen = () => {
                    if (isUnmounted) return;
                    setConnectionState({ status: 'connected', source: 'socket' });
                    retryCount = 0;
                    stopPolling(); // Critical: Stop polling once WS is stable
                };

                ws.onmessage = (event) => {
                    if (isUnmounted) return;
                    try {
                        const data = JSON.parse(event.data);
                        if (data.p) {
                            updatePriceUI(parseFloat(data.p));
                            // Ensure status reflects socket is the source
                            setConnectionState(prev => prev.source === 'socket' ? prev : { status: 'connected', source: 'socket' });
                        }
                    } catch (e) { }
                };

                ws.onclose = () => {
                    if (isUnmounted) return;

                    // 1. Immediately start polling to maintain data flow
                    startPolling();

                    // 2. Update status to show we are reconnecting (or falling back)
                    setConnectionState(prev => ({ ...prev, status: 'reconnecting' }));

                    // 3. Schedule reconnect with backoff (capped at 5s for granular updates)
                    const delay = Math.min(500 * Math.pow(1.5, retryCount), 5000);
                    retryCount++;
                    reconnectTimeout = window.setTimeout(connectWs, delay);
                };

                ws.onerror = () => {
                    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
                        ws.close();
                    }
                };

            } catch (err) {
                console.error("WS creation failed:", err);
                startPolling();
                reconnectTimeout = window.setTimeout(connectWs, 2000);
            }
        };

        // Start Strategy: Race-to-Data
        setConnectionState({ status: 'connecting', source: 'socket' });
        startPolling(); // Start HTTP immediately
        connectWs();    // Start WS concurrently

        return () => {
            isUnmounted = true;
            stopPolling();
            if (ws) {
                ws.onclose = null;
                ws.close();
            }
            if (reconnectTimeout) clearTimeout(reconnectTimeout);
        };
    }, [isVisible, symbol]);

    const showNotification = (msg: string) => {
        setNotification(msg);
        // Clear previous timeout if exists
        if (notificationTimeoutRef.current) {
            window.clearTimeout(notificationTimeoutRef.current);
        }
        notificationTimeoutRef.current = window.setTimeout(() => {
            setNotification(null);
            notificationTimeoutRef.current = null;
        }, 5000);
    };

    const handleExtractAndAnalyze = async () => {
        if (analysisProgress) return;

        setAnalysisProgress('Initializing...');

        try {
            const timeframes = ['5m', '15m', '1h', '4h'];
            // Structured JSON container
            const marketData: any = {
                asset: symbol,
                timestamp: new Date().toISOString(),
                timeframes: {}
            };

            let validDataCount = 0;

            for (const tf of timeframes) {
                setAnalysisProgress(`Analyzing ${tf}...`);

                const klines = await fetchKlines(symbol, tf, 300);
                if (klines.length < 200) continue;

                validDataCount++;

                const closes = klines.map(k => k.close);
                const lastClose = closes[closes.length - 1];
                const volume = klines[klines.length - 1].volume;

                // Calculate standard and short-term RSI
                const rsi14 = calculateRSI(closes, 14);
                const rsi2 = calculateRSI(closes, 2);
                const rsi3 = calculateRSI(closes, 3);

                const sar = calculateSAR(klines);
                const bb = calculateBollingerBands(closes);
                const macd = calculateMACD(closes);
                const kdj = calculateKDJ(klines);
                const pattern = identifyCandlePattern(klines);

                // Enhanced Detection: Get separate patterns and zones
                const chartPatterns = detectChartPatterns(klines);
                const keyZones = detectKeyZones(klines); // New feature

                const ma = {
                    '5': calculateSMA(closes, 5),
                    '10': calculateSMA(closes, 10),
                    '20': calculateSMA(closes, 20),
                    '30': calculateSMA(closes, 30),
                    '60': calculateSMA(closes, 60),
                    '200': calculateSMA(closes, 200)
                };

                const ema = {
                    '5': calculateEMA(closes, 5),
                    '13': calculateEMA(closes, 13),
                    '20': calculateEMA(closes, 20),
                    '200': calculateEMA(closes, 200)
                };

                // Explicit, robust JSON structure for the AI
                const tfData: any = {
                    price: lastClose,
                    trend_indicators: {
                        candle_pattern: pattern,
                        ma: ma,
                        ema: ema,
                        bollinger: bb,
                        sar: sar
                    },
                    momentum_indicators: {
                        rsi14: rsi14,
                        rsi2: rsi2, // Always include if calculated
                        rsi3: rsi3,
                        macd: macd,
                        kdj: kdj,
                        volume: volume
                    },
                    structural_analysis: {
                        detected_patterns: chartPatterns, // Patterns like Head & Shoulders
                        key_zones: keyZones // Explicit Support/Resistance arrays
                    }
                };

                marketData.timeframes[tf] = tfData;
            }

            if (validDataCount === 0) throw new Error("Insufficient data fetched. Check network connection.");

            // Output String formatted to look like a raw data block
            const outputString = `**LIVE MARKET DATA**
\`\`\`json
${JSON.stringify(marketData, null, 2)}
\`\`\`

**INSTRUCTION:**
1. Parse the JSON above. It contains precise indicators, algorithmic pattern detections, and calculated support/resistance zones.
2. Use the 'structural_analysis' section to identify the current market structure (Bullish/Bearish patterns).
3. Use 'key_zones' to find valid entry and stop-loss levels.
4. Formulate a high-precision strategy based on this data.`;

            setAnalysisProgress('Finalizing...');
            await new Promise(resolve => window.setTimeout(resolve, 300));

            onAnalyze(outputString);

        } catch (error: any) {
            console.error("Analysis extraction failed", error);
            showNotification(error.message || "Failed to extract market data. Please try again.");
        } finally {
            setAnalysisProgress(null);
        }
    };

    if (!isVisible) return null;

    return (
        <div className="fixed inset-0 bg-zinc-950 z-50 flex flex-col animate-fade-in pb-[env(safe-area-inset-bottom)]">
            {/* Header - 2 rows on mobile for spacious feel */}
            <div className="bg-zinc-900/95 backdrop-blur-sm border-b border-white/10 flex-shrink-0">
                {/* Top Row - Title, Price & Close */}
                <div className="flex items-center justify-between px-3 sm:px-4 py-3 border-b border-white/5">
                    <div className="flex items-center gap-2 sm:gap-3">
                        <div className="flex items-center gap-1.5 sm:gap-2 text-cyan-400">
                            <ActivityIcon className="w-5 h-5 sm:w-6 sm:h-6" />
                            <h2 className="font-bold text-base sm:text-lg tracking-tight">Live Market</h2>
                        </div>

                        {/* Connection Status Badge */}
                        <div className={`hidden xs:flex items-center gap-1.5 px-2.5 py-1 rounded-full border transition-colors ${connectionState.status === 'connected'
                            ? (connectionState.source === 'socket' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-yellow-500/10 border-yellow-500/20 text-yellow-400')
                            : connectionState.status === 'reconnecting' ? 'bg-red-500/10 border-red-500/20 text-red-400'
                                : 'bg-zinc-500/10 border-zinc-500/20 text-zinc-400'
                            }`}>
                            <div className={`w-2 h-2 rounded-full ${connectionState.status === 'connected'
                                ? (connectionState.source === 'socket' ? 'bg-emerald-500 animate-pulse' : 'bg-yellow-500 animate-pulse')
                                : connectionState.status === 'reconnecting' ? 'bg-red-500 animate-pulse'
                                    : 'bg-zinc-500'
                                }`}></div>
                            <span className="text-[10px] font-bold uppercase tracking-widest">
                                {connectionState.status === 'connected'
                                    ? (connectionState.source === 'socket' ? 'Live' : 'HTTP')
                                    : connectionState.status === 'reconnecting' ? '...' : 'Off'}
                            </span>
                        </div>
                    </div>

                    {/* Price Display & Close */}
                    <div className="flex items-center gap-2 sm:gap-4">
                        <div className="text-right">
                            <span className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider block">Current</span>
                            <span ref={priceDisplayRef} className="font-mono text-base sm:text-lg font-bold text-zinc-400 transition-colors duration-300">
                                Loading...
                            </span>
                        </div>
                        <button
                            onClick={onClose}
                            className="p-3 text-zinc-400 hover:text-white bg-zinc-800 hover:bg-zinc-700 rounded-xl transition-colors active:scale-95"
                            aria-label="Close"
                        >
                            <CloseIcon className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                {/* Bottom Row - Controls */}
                <div className="flex items-center justify-between px-4 py-3 gap-3">
                    {/* Selectors Group */}
                    <div className="flex items-center gap-2 flex-1 overflow-x-auto [&::-webkit-scrollbar]:hidden" style={{ scrollbarWidth: 'none' }}>
                        {/* Exchange Toggle */}
                        <div className="flex rounded-xl bg-zinc-800/80 p-1 shrink-0">
                            {EXCHANGES.map((ex) => (
                                <button
                                    key={ex}
                                    onClick={() => setExchange(ex)}
                                    className={`px-4 py-2 text-xs font-bold rounded-lg transition-all ${exchange === ex
                                        ? 'bg-gradient-to-r from-cyan-600 to-cyan-500 text-white shadow-lg shadow-cyan-900/30'
                                        : 'text-zinc-400 hover:text-white'
                                        }`}
                                >
                                    {ex}
                                </button>
                            ))}
                        </div>

                        {/* Symbol Selector */}
                        <div className="relative shrink-0">
                            <select
                                value={symbol}
                                onChange={(e) => setSymbol(e.target.value)}
                                className="appearance-none bg-zinc-800 text-white text-sm font-bold h-10 pl-4 pr-10 rounded-xl border border-white/10 focus:outline-none focus:border-cyan-500 cursor-pointer hover:bg-zinc-700 transition-colors min-w-[100px]"
                            >
                                {ASSETS.map(a => <option key={a} value={a}>{a.replace('USDT', '')}</option>)}
                            </select>
                            <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-400">
                                <ChevronDownIcon className="w-4 h-4" />
                            </div>
                        </div>

                        {/* Interval Selector */}
                        <div className="relative shrink-0">
                            <select
                                value={interval}
                                onChange={(e) => setInterval(e.target.value)}
                                className="appearance-none bg-zinc-800 text-white text-sm font-bold h-10 pl-4 pr-10 rounded-xl border border-white/10 focus:outline-none focus:border-cyan-500 cursor-pointer hover:bg-zinc-700 transition-colors min-w-[70px]"
                            >
                                {INTERVALS.map(i => <option key={i} value={i}>{i}</option>)}
                            </select>
                            <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-400">
                                <ChevronDownIcon className="w-4 h-4" />
                            </div>
                        </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex items-center gap-2 shrink-0">
                        <button
                            onClick={() => setIsAlertModalOpen(true)}
                            className="h-10 w-10 flex items-center justify-center text-zinc-400 hover:text-yellow-400 bg-zinc-800/80 hover:bg-yellow-500/10 border border-white/5 hover:border-yellow-500/30 rounded-xl transition-all active:scale-95"
                            aria-label="Price Alerts"
                        >
                            <BellIcon className="w-5 h-5" />
                        </button>

                        <button
                            onClick={handleExtractAndAnalyze}
                            disabled={!!analysisProgress}
                            className="flex items-center justify-center gap-2 h-10 bg-gradient-to-r from-cyan-600 to-cyan-500 hover:from-cyan-500 hover:to-cyan-400 text-white text-sm font-bold px-5 rounded-xl shadow-lg shadow-cyan-900/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap active:scale-95"
                        >
                            {analysisProgress ? <LoadingIcon className="w-4 h-4" /> : <CameraIcon className="w-4 h-4" />}
                            <span>{analysisProgress || 'Analyze'}</span>
                        </button>
                    </div>
                </div>
            </div>

            {/* Chart Container */}
            <div className="flex-1 relative bg-zinc-900 overflow-hidden">
                {exchange === 'OKX' ? (
                    <OKXChart symbol={symbol} interval={interval} isVisible={isVisible} />
                ) : (
                    <>
                        <div id="tradingview_widget" ref={widgetRef} className="w-full h-full" />

                        {/* AI Analysis Overlay for Binance */}
                        {exchange === 'BINANCE' && (marketBias !== 'neutral' || isAIAnalyzing || keyLevels.length > 0) && (
                            <div className="absolute top-2 right-2 z-10 flex flex-col gap-2 max-w-[200px]">
                                {/* AI Analyzing Indicator */}
                                {isAIAnalyzing && (
                                    <div className="flex items-center gap-2 bg-[#ffd700]/10 border border-[#ffd700]/20 rounded-lg px-3 py-1.5 backdrop-blur-sm">
                                        <div className="w-3 h-3 border-2 border-[#ffd700] border-t-transparent rounded-full animate-spin"></div>
                                        <span className="text-[#ffd700] font-bold text-xs">AI Analyzing...</span>
                                    </div>
                                )}

                                {/* Market Bias Badge */}
                                {!isAIAnalyzing && marketBias !== 'neutral' && (
                                    <div className={`flex items-center gap-2 rounded-lg px-3 py-1.5 backdrop-blur-sm ${marketBias === 'bullish'
                                        ? 'bg-emerald-500/10 border border-emerald-500/20'
                                        : 'bg-red-500/10 border border-red-500/20'
                                        }`}>
                                        <span className={`font-bold text-xs ${marketBias === 'bullish' ? 'text-emerald-400' : 'text-red-400'
                                            }`}>
                                            {marketBias === 'bullish' ? '🐂 BULLISH' : '🐻 BEARISH'}
                                        </span>
                                    </div>
                                )}

                                {/* Key Levels */}
                                {!isAIAnalyzing && keyLevels.length > 0 && (
                                    <div className="bg-zinc-900/80 border border-white/10 rounded-lg px-3 py-2 backdrop-blur-sm">
                                        <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Key Levels</span>
                                        <div className="flex flex-col gap-1 mt-1">
                                            {keyLevels.slice(0, 4).map((level, i) => (
                                                <div key={i} className="flex items-center justify-between gap-2 text-xs">
                                                    <span className={level.type === 'resistance' ? 'text-red-400' : 'text-emerald-400'}>
                                                        {level.type === 'resistance' ? 'R' : 'S'}
                                                    </span>
                                                    <span className="font-mono text-white">${level.price.toLocaleString()}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* AI Summary */}
                                {!isAIAnalyzing && aiSummary && (
                                    <div className="bg-zinc-900/80 border border-white/10 rounded-lg px-3 py-2 backdrop-blur-sm">
                                        <span className="text-[10px] text-zinc-400 leading-relaxed line-clamp-3">{aiSummary}</span>
                                    </div>
                                )}
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* AI Market Insights Panel */}
            {(marketInsights || isAIAnalyzing) && (
                <div className="flex-shrink-0 bg-zinc-900 border-t border-white/10">
                    {/* Panel Header */}
                    <button
                        onClick={() => setIsInsightsPanelExpanded(!isInsightsPanelExpanded)}
                        className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-800/50 transition-colors"
                    >
                        <div className="flex items-center gap-2">
                            <BrainIcon className="w-5 h-5 text-cyan-400" />
                            <span className="font-bold text-sm text-cyan-400">AI Market Insights</span>
                            {isAIAnalyzing && (
                                <div className="w-3 h-3 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin ml-2"></div>
                            )}
                            {!isAIAnalyzing && marketBias !== 'neutral' && (
                                <span className={`ml-2 px-2 py-0.5 rounded text-[10px] font-bold uppercase ${marketBias === 'bullish'
                                    ? 'bg-emerald-500/20 text-emerald-400'
                                    : 'bg-red-500/20 text-red-400'
                                    }`}>
                                    {marketBias}
                                </span>
                            )}
                        </div>
                        <ChevronDownIcon className={`w-5 h-5 text-zinc-400 transition-transform duration-200 ${isInsightsPanelExpanded ? 'rotate-180' : ''}`} />
                    </button>

                    {/* Panel Content */}
                    {isInsightsPanelExpanded && marketInsights && !isAIAnalyzing && (
                        <div className="px-4 pb-4 space-y-4 max-h-[40vh] overflow-y-auto custom-scrollbar">
                            {/* Current Situation */}
                            <div className="bg-zinc-800/50 rounded-xl p-3 border border-white/5">
                                <div className="flex items-center gap-2 mb-2">
                                    <ActivityIcon className="w-4 h-4 text-cyan-400" />
                                    <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Current Situation</span>
                                </div>
                                <p className="text-sm text-zinc-200 leading-relaxed">{marketInsights.situation}</p>
                            </div>

                            {/* Key Observations */}
                            {marketInsights.observations.length > 0 && (
                                <div className="bg-zinc-800/50 rounded-xl p-3 border border-white/5">
                                    <div className="flex items-center gap-2 mb-2">
                                        <span className="text-base">👁️</span>
                                        <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Key Observations</span>
                                    </div>
                                    <ul className="space-y-1.5">
                                        {marketInsights.observations.map((obs, i) => (
                                            <li key={i} className="flex items-start gap-2 text-sm text-zinc-300">
                                                <span className="text-cyan-400 mt-1">•</span>
                                                <span>{obs}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}

                            {/* Potential Moves */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                {/* Bullish Scenario */}
                                <div className="bg-emerald-500/5 rounded-xl p-3 border border-emerald-500/20">
                                    <div className="flex items-center gap-2 mb-2">
                                        <TrendUpIcon className="w-4 h-4 text-emerald-400" />
                                        <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider">Bullish</span>
                                    </div>
                                    <p className="text-sm text-zinc-300 leading-relaxed">{marketInsights.potentialMoves.bullish}</p>
                                </div>

                                {/* Bearish Scenario */}
                                <div className="bg-red-500/5 rounded-xl p-3 border border-red-500/20">
                                    <div className="flex items-center gap-2 mb-2">
                                        <TrendDownIcon className="w-4 h-4 text-red-400" />
                                        <span className="text-xs font-bold text-red-400 uppercase tracking-wider">Bearish</span>
                                    </div>
                                    <p className="text-sm text-zinc-300 leading-relaxed">{marketInsights.potentialMoves.bearish}</p>
                                </div>
                            </div>

                            {/* Risk Factors */}
                            {marketInsights.riskFactors.length > 0 && (
                                <div className="bg-amber-500/5 rounded-xl p-3 border border-amber-500/20">
                                    <div className="flex items-center gap-2 mb-2">
                                        <AlertTriangleIcon className="w-4 h-4 text-amber-400" />
                                        <span className="text-xs font-bold text-amber-400 uppercase tracking-wider">Watch Out</span>
                                    </div>
                                    <ul className="space-y-1.5">
                                        {marketInsights.riskFactors.map((risk, i) => (
                                            <li key={i} className="flex items-start gap-2 text-sm text-zinc-300">
                                                <span className="text-amber-400 mt-1">⚠️</span>
                                                <span>{risk}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Loading State */}
                    {isInsightsPanelExpanded && isAIAnalyzing && (
                        <div className="px-4 pb-4">
                            <div className="bg-zinc-800/50 rounded-xl p-6 border border-white/5 flex flex-col items-center justify-center gap-3">
                                <div className="w-8 h-8 border-3 border-cyan-400 border-t-transparent rounded-full animate-spin"></div>
                                <span className="text-sm text-zinc-400">Analyzing market conditions...</span>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Notification Toast */}
            {notification && (
                <div className="absolute top-28 left-4 right-4 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 z-50 bg-emerald-500/90 text-white px-5 py-3.5 rounded-2xl shadow-2xl backdrop-blur-md flex items-center gap-3 animate-fade-in">
                    <CheckIcon className="w-5 h-5 shrink-0" />
                    <span className="font-medium text-sm">{notification}</span>
                </div>
            )}

            {/* Alert Modal - Mobile Optimized */}
            {isAlertModalOpen && (
                <div className="absolute top-32 left-4 right-4 sm:left-4 sm:right-auto sm:w-80 bg-zinc-900/95 backdrop-blur-sm border border-white/10 rounded-2xl shadow-2xl p-5 animate-fade-in z-50">
                    <h3 className="text-sm font-bold text-zinc-400 uppercase tracking-widest mb-4">Price Alerts</h3>
                    <div className="flex gap-3 mb-4">
                        <input
                            type="number"
                            value={newAlertPrice}
                            onChange={(e) => setNewAlertPrice(e.target.value)}
                            placeholder="Target Price"
                            className="flex-1 bg-zinc-950 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:border-cyan-500 outline-none"
                        />
                        <button
                            onClick={() => {
                                if (newAlertPrice && lastPriceRef.current) {
                                    setAlerts(p => [...p, { id: Date.now().toString(), price: parseFloat(newAlertPrice), symbol, condition: parseFloat(newAlertPrice) > lastPriceRef.current! ? 'above' : 'below', active: true }]);
                                    setNewAlertPrice('');
                                    setIsAlertModalOpen(false);
                                }
                            }}
                            className="h-12 w-12 flex items-center justify-center bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl text-lg font-bold active:scale-95 transition-transform"
                        >
                            +
                        </button>
                    </div>
                    <div className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar">
                        {alerts.filter(a => a.symbol === symbol).map(alert => (
                            <div key={alert.id} className="flex items-center justify-between bg-black/30 p-3 rounded-xl border border-white/5">
                                <span className={`text-sm font-mono ${alert.active ? 'text-zinc-300' : 'text-zinc-600'}`}>
                                    {alert.condition === 'above' ? '≥' : '≤'} ${alert.price.toLocaleString()}
                                </span>
                                <button
                                    onClick={() => setAlerts(p => p.filter(a => a.id !== alert.id))}
                                    className="p-2 text-zinc-600 hover:text-red-400 transition-colors"
                                >
                                    <TrashIcon />
                                </button>
                            </div>
                        ))}
                        {alerts.filter(a => a.symbol === symbol).length === 0 && (
                            <p className="text-zinc-600 text-sm text-center py-4">No alerts set for {symbol}</p>
                        )}
                    </div>
                    <button
                        onClick={() => setIsAlertModalOpen(false)}
                        className="mt-4 w-full py-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 text-sm rounded-xl font-medium transition-colors active:scale-[0.98]"
                    >
                        Close
                    </button>
                </div>
            )}
        </div>
    );
};

export default React.memo(LiveMarket);
