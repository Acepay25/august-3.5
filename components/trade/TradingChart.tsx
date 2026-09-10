/**
 * TradingChart — a LOCAL canvas candlestick chart (lightweight-charts,
 * TradingView's MIT library) fed by the app's own Binance kline fetchers.
 * Deliberately NOT the embed widget: an iframe from s.tradingview.com is
 * blocked inside embedded webviews (and any strict CSP), which made the trade
 * surface look dead. Canvas + same-origin data works everywhere, refreshes on
 * a timer, and lets August draw its OWN verdict levels (Entry/SL/TP) on top
 * of the candles — the chart becomes part of the harness, not a guest.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
    createChart,
    CandlestickSeries,
    HistogramSeries,
    LineSeries,
    type IChartApi,
    type IPriceLine,
    type ISeriesApi,
    type UTCTimestamp,
} from 'lightweight-charts';
import { fetchKlines } from '../../services/analysis/KlineService';
import { toCandles, toVolumes, verdictLevels, VOLUME_UP, VOLUME_DOWN, type ChartLevel } from '../../services/trade/chartData';
import type { LiveKline } from '../../services/trade/futuresStreams';
import { TradeAnalysis } from '../../types';

export const CHART_INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1D'] as const;
export type ChartInterval = (typeof CHART_INTERVALS)[number];

/** KlineService/Binance interval strings for each supported timeframe. */
const toKlineInterval = (interval: ChartInterval): string => (interval === '1D' ? '1d' : interval);

const REFRESH_MS = 15_000;

interface TradingChartProps {
    symbol: string;
    interval: ChartInterval;
    onIntervalChange: (interval: ChartInterval) => void;
    /** The current verdict (optional): its Entry/SL/TP lines are drawn on the
     *  candles when it belongs to this symbol. */
    verdict?: TradeAnalysis | null;
    /** Optional moving average overlay (SMA20) — cheap context, one line. */
    showSma?: boolean;
    /** Websocket kline stream is up: the initial history load still happens,
     *  but the 15s refresh stops — liveKline drives the last bar instead. */
    live?: boolean;
    liveKline?: LiveKline | null;
    /** Live trade/mark price from the ticker stream — drawn as a dedicated
     *  dashed price line ("mark") that ticks every second, faster than the
     *  built-in last-close line can move while a bar is still open. */
    lastPrice?: number | null;
}

const sma = (closes: number[], period: number): (number | null)[] => closes.map((_, i) => {
    if (i < period - 1) return null;
    let sum = 0;
    for (let j = i - period + 1; j <= i; j += 1) sum += closes[j];
    return sum / period;
});

const TradingChart: React.FC<TradingChartProps> = ({ symbol, interval, onIntervalChange, verdict, showSma = false, live = false, liveKline, lastPrice }) => {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const candlesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
    const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null);
    const smaRef = useRef<ISeriesApi<'Line'> | null>(null);
    const levelLinesRef = useRef<ISeriesApi<'Line'>[]>([]);
    const markLineRef = useRef<IPriceLine | null>(null);
    const [status, setStatus] = useState<'loading' | 'live' | 'unavailable'>('loading');
    const [levels, setLevels] = useState<ChartLevel[]>([]);

    // Create the chart once per mount; theme tokens match the app's dark surface.
    useEffect(() => {
        const host = hostRef.current;
        if (!host) return;
        const chart = createChart(host, {
            autoSize: true,
            layout: {
                background: { color: 'transparent' },
                textColor: '#8c8c86',
                attributionLogo: false,
            },
            grid: {
                vertLines: { color: 'rgba(255,255,255,0.04)' },
                horzLines: { color: 'rgba(255,255,255,0.04)' },
            },
            rightPriceScale: { borderColor: 'rgba(255,255,255,0.08)' },
            timeScale: { borderColor: 'rgba(255,255,255,0.08)', timeVisible: true, secondsVisible: false },
            crosshair: { mode: 0 },
        });
        const candles = chart.addSeries(CandlestickSeries, {
            upColor: '#07b56a', downColor: '#f75d5f',
            borderUpColor: '#07b56a', borderDownColor: '#f75d5f',
            wickUpColor: '#07b56a', wickDownColor: '#f75d5f',
            priceLineSource: 1, // last price line
        });
        const volume = chart.addSeries(HistogramSeries, {
            priceFormat: { type: 'volume' },
            priceScaleId: 'volume',
        });
        chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
        chartRef.current = chart;
        candlesRef.current = candles;
        volumeRef.current = volume;
        return () => {
            chart.remove();
            chartRef.current = null;
            candlesRef.current = null;
            volumeRef.current = null;
            smaRef.current = null;
            levelLinesRef.current = [];
            markLineRef.current = null;
        };
    }, []);

    // Data lifecycle: the history load always runs (the stream only pushes
    // the CURRENT bar). Refresh cadence after that: while live the websocket
    // drives updates and no timer is armed; otherwise 15s (4s while empty).
    useEffect(() => {
        let cancelled = false;
        let timer = 0;
        const load = async (): Promise<void> => {
            try {
                const klines = await fetchKlines(symbol, toKlineInterval(interval), 300);
                if (cancelled) return;
                const cs = candlesRef.current;
                const vs = volumeRef.current;
                if (!cs || !vs || klines.length === 0) { setStatus('unavailable'); timer = window.setTimeout(() => void load(), 4000); return; }
                const candles = toCandles(klines);
                cs.setData(candles.map(c => ({ ...c, time: c.time as UTCTimestamp })));
                vs.setData(toVolumes(klines).map(v => ({ ...v, time: v.time as UTCTimestamp })));
                setStatus('live');
                if (!timer) chartRef.current?.timeScale().fitContent();
                if (!live) timer = window.setTimeout(() => void load(), REFRESH_MS);
            } catch {
                if (!cancelled) setStatus('unavailable');
                timer = window.setTimeout(() => void load(), 4000);
            }
        };
        void load();
        return () => { cancelled = true; window.clearTimeout(timer); };
    }, [symbol, interval, live]);

    // Live kline stream: patch the last bar in place (sub-second ticks).
    useEffect(() => {
        if (!liveKline || !candlesRef.current || !volumeRef.current) return;
        const t = Math.floor(liveKline.openTime / 1000);
        candlesRef.current.update({
            time: t as UTCTimestamp,
            open: liveKline.open, high: liveKline.high, low: liveKline.low, close: liveKline.close,
        });
        volumeRef.current.update({
            time: t as UTCTimestamp,
            value: liveKline.volume,
            color: liveKline.close >= liveKline.open ? VOLUME_UP : VOLUME_DOWN,
        });
    }, [liveKline]);

    // Realtime price line: the live ticker/mark price gets its own dashed
    // "mark" line updated on every tick — visible immediately, unlike the
    // built-in last-close line which only moves when the open bar updates.
    useEffect(() => {
        const cs = candlesRef.current;
        if (!cs) return;
        const removeLine = (): void => {
            if (markLineRef.current) {
                try { cs.removePriceLine?.(markLineRef.current); } catch { /* already gone */ }
                markLineRef.current = null;
            }
        };
        if (lastPrice == null || !Number.isFinite(lastPrice)) { removeLine(); return; }
        if (markLineRef.current) {
            try { markLineRef.current.applyOptions({ price: lastPrice }); return; } catch { removeLine(); }
        }
        try {
            markLineRef.current = cs.createPriceLine({
                price: lastPrice, color: '#399ef7', lineWidth: 1, lineStyle: 2,
                axisLabelVisible: true, title: 'mark',
            }) ?? null;
        } catch { /* series without price-line support (test mock) */ }
    }, [lastPrice, status]);

    // SMA overlay.
    useEffect(() => {
        const chart = chartRef.current;
        if (!chart) return;
        if (!showSma) {
            if (smaRef.current) { chart.removeSeries(smaRef.current); smaRef.current = null; }
            return;
        }
        if (!smaRef.current) smaRef.current = chart.addSeries(LineSeries, { color: '#f08800', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
        const candles = (candlesRef.current?.data?.() ?? []) as readonly { time: number; close: number }[];
        if (candles.length > 0 && smaRef.current) {
            const values = sma(candles.map(c => c.close), 20);
            smaRef.current.setData(candles.map((c, i) => (values[i] === null ? null : { time: c.time as UTCTimestamp, value: values[i] as number })).filter(Boolean) as { time: UTCTimestamp; value: number }[]);
        }
    }, [showSma, status]);

    // Verdict levels: horizontal lines per Entry/SL/TP with labels.
    useEffect(() => {
        const chart = chartRef.current;
        const cs = candlesRef.current;
        if (!chart || !cs) return;
        const next = verdictLevels(verdict, symbol);
        setLevels(next);
        levelLinesRef.current.forEach(l => { try { chart.removeSeries(l); } catch { /* already gone */ } });
        levelLinesRef.current = next.map(level => {
            const line = chart.addSeries(LineSeries, {
                color: level.color,
                lineWidth: 1,
                lineStyle: level.dashed ? 2 : 0,
                priceLineVisible: false,
                lastValueVisible: false,
                crosshairMarkerVisible: false,
            });
            const data = (cs.data?.() ?? []) as readonly { time: number }[];
            if (data.length > 0) line.setData([{ time: data[0].time as UTCTimestamp, value: level.price }, { time: data[data.length - 1].time as UTCTimestamp, value: level.price }]);
            return line;
        });
    }, [verdict, symbol, status]);

    return (
        <div className="flex h-full min-h-0 flex-col" data-testid="trading-chart">
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
                <span className="ml-auto flex items-center gap-2 pr-1">
                    {levels.length > 0 && (
                        <span className="text-[10px] uppercase tracking-widest text-zinc-500" title="Current verdict levels drawn on the chart">
                            verdict overlay · {levels.map(l => l.label).join(' ')}
                        </span>
                    )}
                    <span className={`h-1.5 w-1.5 rounded-full ${status === 'live' ? 'bg-emerald-500' : status === 'loading' ? 'animate-pulse bg-cyan-400' : 'bg-rose-500'}`} aria-label={`chart ${status}`} />
                    <span className="text-[10px] uppercase tracking-widest text-zinc-600">{symbol} · Binance · {interval}</span>
                </span>
            </div>
            <div className="relative min-h-0 flex-1 bg-zinc-950">
                <div ref={hostRef} className="absolute inset-0" />
                {status === 'unavailable' && (
                    <div className="absolute inset-0 flex items-center justify-center">
                        <p className="text-[11px] text-zinc-600">Candles unavailable — Binance fetch failed; retrying in 4s.</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default React.memo(TradingChart);
