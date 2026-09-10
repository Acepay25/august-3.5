/**
 * TradingChart — the Minara perps-screen chart: a full-height TradingView
 * candlestick widget with the timeframe row (1m–1D) above it. The widget
 * lifecycle is the pattern proven in LiveMarket (script injection with a
 * dedupe guard, BINANCE: prefix so the chart matches the Binance price feed,
 * teardown on symbol/interval change), restyled for the dark trade surface
 * (dark toolbar instead of LiveMarket's light one).
 */

import React, { useEffect, useRef, useState } from 'react';

declare global {
    interface Window { TradingView: any }
}

export const CHART_INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1D'] as const;
export type ChartInterval = (typeof CHART_INTERVALS)[number];

const toTradingView = (interval: string): string => {
    switch (interval) {
        case '1m': return '1';
        case '5m': return '5';
        case '15m': return '15';
        case '1h': return '60';
        case '4h': return '240';
        case '1D': return 'D';
        default: return '15';
    }
};

interface TradingChartProps {
    symbol: string;
    interval: ChartInterval;
    onIntervalChange: (interval: ChartInterval) => void;
}

const TradingChart: React.FC<TradingChartProps> = ({ symbol, interval, onIntervalChange }) => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const widgetRef = useRef<{ remove?: () => void } | null>(null);
    // TradingView replaces the container's children with an iframe; a stable
    // id is required by the widget API, and it must survive re-inits.
    const [widgetId] = useState(() => `tradingview_${Math.random().toString(36).slice(2, 10)}`);

    useEffect(() => {
        const init = () => {
            if (!window.TradingView || !containerRef.current) return;
            containerRef.current.innerHTML = '';
            widgetRef.current = new window.TradingView.widget({
                autosize: true,
                symbol: `BINANCE:${symbol}`,
                interval: toTradingView(interval),
                timezone: 'Etc/UTC',
                theme: 'dark',
                style: '1',
                locale: 'en',
                toolbar_bg: '#141412',
                enable_publishing: false,
                allow_symbol_change: false,
                container_id: widgetId,
                studies: ['RSI@tv-basicstudies', 'MASimple@tv-basicstudies', 'MACD@tv-basicstudies', 'BollingerBands@tv-basicstudies'],
                hide_side_toolbar: false,
                save_image: true,
            });
        };
        if (window.TradingView) {
            init();
        } else {
            // A prior mount may already be loading tv.js (StrictMode re-runs,
            // or the other TradingView surface). Attach to that in-flight
            // script instead of racing it — a second <script> would double-load.
            const existing = document.querySelector<HTMLScriptElement>('script[src*="tradingview"]');
            if (existing) {
                existing.addEventListener('load', init);
            } else {
                const script = document.createElement('script');
                script.src = 'https://s3.tradingview.com/tv.js';
                script.async = true;
                script.onload = init;
                document.head.appendChild(script);
            }
        }
        return () => {
            try { widgetRef.current?.remove?.(); } catch { /* older builds lack remove */ }
            widgetRef.current = null;
            if (containerRef.current) containerRef.current.innerHTML = '';
        };
    }, [symbol, interval, widgetId]);

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex shrink-0 items-center gap-0.5 border-b border-white/[0.06] px-2 py-1.5">
                {CHART_INTERVALS.map(tf => (
                    <button
                        key={tf}
                        type="button"
                        onClick={() => onIntervalChange(tf)}
                        className={`rounded-control px-2 py-1 text-[11px] font-semibold transition-colors ${
                            interval === tf ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:bg-white/[0.05] hover:text-zinc-200'
                        }`}
                    >
                        {tf}
                    </button>
                ))}
                <span className="ml-auto pr-1 text-[10px] uppercase tracking-widest text-zinc-600">{symbol} · Binance</span>
            </div>
            <div className="relative min-h-0 flex-1 bg-zinc-950">
                <div ref={containerRef} id={widgetId} className="absolute inset-0" />
            </div>
        </div>
    );
};

export default React.memo(TradingChart);
