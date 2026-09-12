/**
 * TradingChart — a LOCAL canvas candlestick chart (lightweight-charts,
 * TradingView's MIT library) fed by the app's own Binance kline fetchers.
 * Deliberately NOT the embed widget: an iframe from s.tradingview.com is
 * blocked inside embedded webviews (and any strict CSP), which made the trade
 * surface look dead. Canvas + same-origin data works everywhere, refreshes on
 * a timer, and lets August draw its OWN verdict levels (Entry/SL/TP) on top
 * of the candles — the chart becomes part of the harness, not a guest.
 *
 * Three surfaces live here:
 *  · The candles: websocket-driven last-bar patching plus a freshness
 *    watchdog — while the feed claims 'live' but no kline arrives within a
 *    few bars' worth of quiet, history is re-synced so a stalled socket can
 *    never freeze the chart silently.
 *  · User drawings (TradingView-style): trendline / horizontal / ray /
 *    rectangle / freehand, drawn on a transparent overlay canvas anchored in
 *    DATA space (bar-time + price), so shapes survive zoom, pan, interval
 *    reloads and restarts (persisted per symbol via chartDrawings). An
 *    eraser, undo and clear complete the toolbar.
 *  · An imperative handle (chartHandle) the parent passes down: capturePng()
 *    composites the chart + the drawing overlay into one PNG (the Chart AI
 *    screenshot button), getSnapshot() returns everything currently on
 *    screen in plain data.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { phtAxisTick } from '../../utils/timezone';
import { toCandles, toVolumes, verdictLevels, VOLUME_UP, VOLUME_DOWN, type ChartLevel } from '../../services/trade/chartData';
import {
    loadDrawings, saveDrawings, loadSessionDrawings, saveSessionDrawings, createDrawingId, pointsForKind, FIB_RATIOS,
    type ChartDrawing, type DrawKind, type DrawPoint, type DrawTool, DRAW_COLORS,
} from '../../services/trade/chartDrawings';
import type { LiveKline } from '../../services/trade/futuresStreams';
import { getActiveUsername } from '../../utils/activeUser';
import { TradeAnalysis } from '../../types';
import { ChartToolRail, CHART_RAIL_WIDTH } from './ChartToolRail';

/** Every timeframe Binance klines serve — the pool the user picks from. */
export const CHART_INTERVALS = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1D', '3D', '1W', '1M'] as const;
export type ChartInterval = (typeof CHART_INTERVALS)[number];

/** The bar's default selection — the set the toolbar shipped with before it
 *  became customizable (TradingView-style: pick which intervals appear). */
export const DEFAULT_CHART_INTERVALS: readonly ChartInterval[] = ['1m', '5m', '15m', '1h', '4h', '1D'];

/** KlineService/Binance interval strings for each supported timeframe. */
const KLINE_OF: Partial<Record<ChartInterval, string>> = { '1D': '1d', '3D': '3d', '1W': '1w' };
const toKlineInterval = (interval: ChartInterval): string => KLINE_OF[interval] ?? interval;

/** Bar length in SECONDS for each timeframe — the drawings' data-space ruler. */
const INTERVAL_SECONDS: Record<ChartInterval, number> = {
    '1m': 60, '3m': 180, '5m': 300, '15m': 900, '30m': 1800,
    '1h': 3600, '2h': 7200, '4h': 14400, '6h': 21600, '12h': 43200,
    '1D': 86400, '3D': 259200, '1W': 604800, '1M': 2592000,
};
export const intervalSeconds = (interval: ChartInterval): number => INTERVAL_SECONDS[interval] ?? 900;

// ── The user's chosen timeframe bar (persisted per user, like dock width) ──
const TF_BAR_KEY = 'trade_tf_bar_v1';
const tfBarKey = (): string => `${TF_BAR_KEY}_${getActiveUsername()}`;

export const readTfBarSelection = (): ChartInterval[] => {
    try {
        const raw = localStorage.getItem(tfBarKey());
        if (!raw) return [...DEFAULT_CHART_INTERVALS];
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [...DEFAULT_CHART_INTERVALS];
        const valid = parsed.filter((i): i is ChartInterval =>
            typeof i === 'string' && (CHART_INTERVALS as readonly string[]).includes(i));
        return valid.length > 0 ? valid : [...DEFAULT_CHART_INTERVALS];
    } catch { return [...DEFAULT_CHART_INTERVALS]; }
};

const writeTfBarSelection = (intervals: ChartInterval[]): void => {
    try { localStorage.setItem(tfBarKey(), JSON.stringify(intervals)); } catch { /* private mode */ }
};

const REFRESH_MS = 15_000;
/** While the feed claims live but no kline tick lands within this window,
 *  re-sync history — a silently stalled socket must never freeze the chart. */
const LIVE_STALL_MS = 12_000;
/** Bars the chart loads (and fitContent shows on first paint) — the user
 *  asked for at least 500 candles of visible history; 1000 is the Binance
 *  klines maximum, so the deepest chart stays one round-trip. */
const HISTORY_BARS = 1000;

/** The drawing tools the rail can arm. 'cursor' is the chart's native
 *  pan/zoom; the rest live in chartDrawings (shared with the rail). */
export type { DrawTool } from '../../services/trade/chartDrawings';
export { DRAW_COLORS } from '../../services/trade/chartDrawings';

/** What the parent can ask the chart for, imperatively. */
export interface ChartHandle {
    /** PNG data URL of the chart + the user's drawings (screenshot tool). */
    capturePng: () => string | null;
    /** Plain-data snapshot of everything currently on the chart. */
    getSnapshot: () => ChartSnapshot | null;
    /** Wipe the USER'S own drawings (the model's 'all' clear lands here —
     *  the model's own shapes live in the parent's state). */
    clearUserDrawings: () => void;
}

export interface ChartSnapshot {
    symbol: string;
    interval: ChartInterval;
    /** Last ≤30 candles (oldest→newest), unix seconds. */
    candles: { time: number; open: number; high: number; low: number; close: number }[];
    markPrice: number | null;
    levels: { label: string; price: number }[];
    drawings: ChartDrawing[];
    /** Shapes the model itself drew via desk tools (not persisted). */
    modelDrawings: ChartDrawing[];
    capturedAt: number;
}

interface TradingChartProps {
    symbol: string;
    interval: ChartInterval;
    onIntervalChange: (interval: ChartInterval) => void;
    /** The ACTIVE Chart AI session — when set, drawings are SESSION-scoped
     *  (each session is its own chart with its own shapes) instead of
     *  shared per symbol. */
    sessionId?: string;
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
    /** Imperative handle filled in on mount (screenshot + snapshot). */
    chartHandle?: React.MutableRefObject<ChartHandle | null>;
    /** Notifies the parent (→ Chart AI context/desk tools) of drawing edits. */
    onDrawingsChange?: (drawings: ChartDrawing[]) => void;
    /** Shapes the MODEL drew via desk tools (draw_on_chart /
     *  mark_trade_levels) — rendered over the candles like the user's own,
     *  but never persisted into the user's drawing file. */
    modelDrawings?: ChartDrawing[];
}

const sma = (closes: number[], period: number): (number | null)[] => closes.map((_, i) => {
    if (i < period - 1) return null;
    let sum = 0;
    for (let j = i - period + 1; j <= i; j += 1) sum += closes[j];
    return sum / period;
});

/** Distance from a point to a segment — the eraser's hit test (screen px). */
const distToSegment = (px: number, py: number, ax: number, ay: number, bx: number, by: number): number => {
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return Math.hypot(px - ax, py - ay);
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};

const TradingChart: React.FC<TradingChartProps> = ({ symbol, interval, onIntervalChange, sessionId, verdict, showSma = false, live = false, liveKline, lastPrice, chartHandle, onDrawingsChange, modelDrawings }) => {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const candlesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
    const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null);
    const smaRef = useRef<ISeriesApi<'Line'> | null>(null);
    const levelLinesRef = useRef<ISeriesApi<'Line'>[]>([]);
    const markLineRef = useRef<IPriceLine | null>(null);
    const [status, setStatus] = useState<'loading' | 'live' | 'unavailable'>('loading');
    const [levels, setLevels] = useState<ChartLevel[]>([]);

    // ─── Drawings state ─────────────────────────────────────────────────────
    const overlayRef = useRef<HTMLCanvasElement | null>(null);
    const [drawings, setDrawings] = useState<ChartDrawing[]>([]);
    const [tool, setTool] = useState<DrawTool>('cursor');
    const [color, setColor] = useState<string>(DRAW_COLORS[0]);
    /** In-progress shape in SCREEN space while the user is clicking/dragging. */
    const [draft, setDraft] = useState<{ points: { x: number; y: number }[] } | null>(null);
    /** Hide-all (the rail's eye): every drawing layer off the canvas, nothing
     *  deleted — TradingView's "hide all objects" toggle. */
    const [drawingsHidden, setDrawingsHidden] = useState(false);
    const drawingsHiddenRef = useRef(drawingsHidden);
    drawingsHiddenRef.current = drawingsHidden;
    /** Live-editing a text note: which drawing id + where its input renders. */
    const [textEdit, setTextEdit] = useState<{ id: string; x: number; y: number } | null>(null);
    /** The user's chosen timeframe bar (TradingView-style: which intervals
     *  the bar shows). The ACTIVE interval always rides the bar regardless. */
    const [tfBar, setTfBar] = useState<ChartInterval[]>(readTfBarSelection);
    const [tfPickerOpen, setTfPickerOpen] = useState(false);
    const barIntervals = CHART_INTERVALS.filter(tf => tfBar.includes(tf) || tf === interval);
    const toggleTfBar = (tf: ChartInterval): void => {
        if (tf === interval) return; // never hide the one you're looking at
        setTfBar(prev => {
            const next = prev.includes(tf) ? prev.filter(x => x !== tf) : [...prev, tf];
            writeTfBarSelection(next);
            return next;
        });
    };
    const lastTickRef = useRef<number>(Date.now());
    const drawingsRef = useRef<ChartDrawing[]>([]);
    drawingsRef.current = drawings;
    const modelDrawingsRef = useRef<ChartDrawing[]>([]);
    modelDrawingsRef.current = modelDrawings ?? [];

    // Load the persisted shapes whenever the chart (session + symbol)
    // changes: session-scoped when the active session is known, legacy
    // per-symbol otherwise.
    useEffect(() => {
        setDrawings(sessionId ? loadSessionDrawings(sessionId, symbol) : loadDrawings(symbol));
        setDraft(null);
        setTool('cursor');
        setTextEdit(null);
    }, [symbol, sessionId]);

    // Esc cancels an in-progress shape (TradingView behaviour) — the draft
    // lives across pointer moves, so the listener rides its lifetime.
    useEffect(() => {
        if (!draft) return;
        const onKey = (ev: KeyboardEvent): void => {
            if (ev.key === 'Escape') setDraft(null);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [draft]);

    const publishDrawings = useCallback((next: ChartDrawing[]): void => {
        setDrawings(next);
        if (sessionId) saveSessionDrawings(sessionId, symbol, next);
        else saveDrawings(symbol, next);
        onDrawingsChange?.(next);
    }, [symbol, sessionId, onDrawingsChange]);

    // ─── Chart lifecycle ────────────────────────────────────────────────────
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
            timeScale: {
                borderColor: 'rgba(255,255,255,0.08)', timeVisible: true, secondsVisible: false,
                // Philippine-time axis labels (lightweight-charts defaults to UTC).
                tickMarkFormatter: (time: number | { year: number; month: number; day: number }, tickMarkType: unknown) => {
                    if (typeof time !== 'number') return `${time.year}-${String(time.month).padStart(2, '0')}-${String(time.day).padStart(2, '0')}`;
                    // TimeMarkType: 0/1 are clock ticks; MonthDay(2)+ are date ticks.
                    return phtAxisTick(time, Number(tickMarkType) >= 2 ? 'day' : 'time');
                },
            },
            localization: {
                // Crosshair + any default time tooltip render in PHT, not UTC.
                timeFormatter: (time: number | { year: number; month: number; day: number }) =>
                    typeof time === 'number' ? phtAxisTick(time, 'full') : `${phtAxisTick(Date.UTC(time.year, time.month - 1, time.day) / 1000, 'day')}`,
            },
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
    // drives updates and no fast timer is armed — but a stall watchdog
    // re-syncs if the socket goes quiet; otherwise 15s (4s while empty).
    // Tracks symbol flips inside the data-lifecycle effect below (it also
    // re-runs on `live` toggles, which must NOT blank the chart).
    const dataSymbolRef = useRef(symbol);
    useEffect(() => {
        // Symbol switch: drop the PREVIOUS coin's artifacts immediately —
        // candles, volume and the mark price line — so no stale price prints
        // on the new chart during the history fetch (the "BTC mark on a ZEN
        // chart" data-discrepancy flag).
        if (dataSymbolRef.current !== symbol) {
            dataSymbolRef.current = symbol;
            if (markLineRef.current) {
                try { candlesRef.current?.removePriceLine(markLineRef.current); } catch { /* series gone */ }
                markLineRef.current = null;
            }
            candlesRef.current?.setData([]);
            volumeRef.current?.setData([]);
            lastTickRef.current = Date.now();
        }
        let cancelled = false;
        let timer = 0;
        let watchdog = 0;
        const load = async (isInitial: boolean): Promise<void> => {
            try {
                const klines = await fetchKlines(symbol, toKlineInterval(interval), HISTORY_BARS);
                if (cancelled) return;
                const cs = candlesRef.current;
                const vs = volumeRef.current;
                if (!cs || !vs || klines.length === 0) { setStatus('unavailable'); timer = window.setTimeout(() => void load(false), 4000); return; }
                const candles = toCandles(klines);
                cs.setData(candles.map(c => ({ ...c, time: c.time as UTCTimestamp })));
                vs.setData(toVolumes(klines).map(v => ({ ...v, time: v.time as UTCTimestamp })));
                setStatus('live');
                lastTickRef.current = Date.now();
                if (isInitial) {
                    const ts = chartRef.current?.timeScale();
                    ts?.fitContent?.();
                    // A tick sitting exactly on the pane's left edge clips its
                    // axis label in half against the tool-rail seam. Pad the
                    // initial window with logical (empty) bars so the first
                    // labeled tick has room — spacing measured from the range
                    // fitContent actually produced (options().barSpacing is
                    // just the configured default, not the fitted one).
                    try {
                        const range = typeof ts?.getVisibleLogicalRange === 'function' ? ts.getVisibleLogicalRange() : null;
                        const width = hostRef.current?.clientWidth ?? 900;
                        const spacing = range ? width / Math.max(1, range.to - range.from) : 2;
                        const pad = (px: number): number => Math.ceil(px / Math.max(spacing, 0.25));
                        ts?.setVisibleLogicalRange?.({ from: (range?.from ?? 0) - pad(30), to: (range?.to ?? HISTORY_BARS) + pad(10) });
                    } catch { /* a mock without range APIs just keeps fitContent */ }
                }
                if (!live) timer = window.setTimeout(() => void load(false), REFRESH_MS);
            } catch {
                if (!cancelled) setStatus('unavailable');
                timer = window.setTimeout(() => void load(false), 4000);
            }
        };
        void load(true);
        if (live) {
            // Stall watchdog: any gap in the push stream gets healed by a
            // history re-sync instead of leaving a frozen last bar.
            watchdog = window.setInterval(() => {
                if (Date.now() - lastTickRef.current > LIVE_STALL_MS) void load(false);
            }, 5000);
        }
        return () => { cancelled = true; window.clearTimeout(timer); window.clearInterval(watchdog); };
    }, [symbol, interval, live]);

    // Live kline stream: patch the last bar in place (sub-second ticks).
    useEffect(() => {
        if (!liveKline || !candlesRef.current || !volumeRef.current) return;
        lastTickRef.current = Date.now();
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
        // A closed bar means the next tick opens a NEW bar — keep history
        // honest without waiting for the watchdog.
        if (liveKline.closed) {
            const cs = candlesRef.current;
            void fetchKlines(symbol, toKlineInterval(interval), 3).then(kl => {
                if (kl.length === 0 || cs.data().length === 0) return;
                const last = kl[kl.length - 1];
                cs.update({ time: Math.floor(last.time / 1000) as UTCTimestamp, open: last.open, high: last.high, low: last.low, close: last.close });
            }).catch(() => { /* the next tick or the watchdog covers it */ });
        }
    }, [liveKline, symbol, interval]);

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

    // ─── Drawing overlay: data↔screen conversion ────────────────────────────
    // x converts through the time scale's LOGICAL space (bar index), y through
    // the series' price space. Logical indexes anchor to the loaded bars —
    // NOT to whatever is visible — so a shape stays glued to the SAME bar
    // through pan, zoom and new-bar appends, and drawing WORKS while the
    // early candles are scrolled far off-screen (the previous anchor-time
    // conversion asked timeToCoordinate for a possibly hidden bar, got null,
    // and silently killed every tool: clicks drew a preview that never
    // committed, existing shapes vanished on pan).

    /** Nearest bar index for a stored unix time (drawings are quantized to
     *  bar times on write, so an exact hit is the norm; binary search). */
    const barIndexForTime = useCallback((t: number): number | null => {
        const cs = candlesRef.current;
        const data = (cs?.data?.() ?? []) as readonly { time: number }[];
        if (data.length === 0) return null;
        let lo = 0;
        let hi = data.length - 1;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (data[mid].time < t) lo = mid + 1;
            else hi = mid;
        }
        if (data[lo].time === t) return lo;
        const prev = data[lo - 1];
        if (!prev) return lo;
        return Math.abs(prev.time - t) <= Math.abs(data[lo].time - t) ? lo - 1 : lo;
    }, []);

    const toScreen = useCallback((p: DrawPoint): { x: number; y: number } | null => {
        const chart = chartRef.current;
        const cs = candlesRef.current;
        if (!chart || !cs) return null;
        const ts = chart.timeScale();
        // Test mocks (and mid-teardown windows) may lack the logical API —
        // conversion is impossible there; callers skip those shapes.
        if (typeof ts.logicalToCoordinate !== 'function' || typeof cs.priceToCoordinate !== 'function') return null;
        const idx = barIndexForTime(p.t);
        if (idx === null) return null;
        const x = ts.logicalToCoordinate(idx as never);
        const y = cs.priceToCoordinate(p.p as never);
        if (x === null || x === undefined || y === null || y === undefined) return null;
        return { x, y };
    }, [barIndexForTime]);

    const toData = useCallback((x: number, y: number): DrawPoint | null => {
        const chart = chartRef.current;
        const cs = candlesRef.current;
        if (!chart || !cs) return null;
        const ts = chart.timeScale();
        if (typeof ts.coordinateToLogical !== 'function' || typeof cs.coordinateToPrice !== 'function') return null;
        const logical = ts.coordinateToLogical(x);
        const p = cs.coordinateToPrice(y);
        if (logical === null || logical === undefined || p === null || p === undefined) return null;
        const data = (cs.data?.() ?? []) as readonly { time: number }[];
        if (data.length === 0) return null;
        // Fractional logical position → floor bar + fraction of one bar
        // length, so a click BETWEEN bars lands between their times.
        const base = Math.min(Math.max(Math.floor(logical), 0), data.length - 1);
        const frac = Math.min(Math.max(logical - Math.floor(logical), 0), 1);
        const t = Math.round(data[base].time + frac * intervalSeconds(interval));
        return { t, p: Number(p) };
    }, [interval]);

    // Paint committed drawings + the in-progress draft onto the overlay.
    const repaint = useCallback((): void => {
        const canvas = overlayRef.current;
        const host = hostRef.current;
        if (!canvas || !host) return;
        const dpr = window.devicePixelRatio || 1;
        const w = host.clientWidth;
        const h = host.clientHeight;
        if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
            canvas.width = w * dpr;
            canvas.height = h * dpr;
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        // Never paint over the price-axis gutter (right ~58px) or time axis.
        const plotW = Math.max(0, w - 58);
        const plotH = Math.max(0, h - 28);
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, plotW, plotH);
        ctx.clip();

        const project = (list: ChartDrawing['points']): { x: number; y: number }[] =>
            list.map(pt => toScreen(pt)).filter((s): s is { x: number; y: number } => s !== null);

        const strokeLine = (pts: { x: number; y: number }[], stroke: string, dashed = false, width = 1.6): void => {
            if (pts.length < 2) return;
            ctx.strokeStyle = stroke;
            ctx.lineWidth = width;
            ctx.setLineDash(dashed ? [6, 4] : []);
            ctx.beginPath();
            ctx.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i].x, pts[i].y);
            ctx.stroke();
            ctx.setLineDash([]);
        };

        const priceLabel = (at: { x: number; y: number }, stroke: string): void => {
            const cs = candlesRef.current;
            const dp = cs ? Number(cs.coordinateToPrice(at.y as never)) : NaN;
            if (!Number.isFinite(dp)) return;
            ctx.fillStyle = 'rgba(0,0,0,0.55)';
            ctx.fillRect(at.x - 2, at.y + 2, 58, 13);
            ctx.fillStyle = stroke;
            ctx.font = '9px ui-monospace, monospace';
            ctx.fillText(dp >= 1000 ? dp.toFixed(0) : dp.toFixed(2), at.x + 1, at.y + 12);
        };

        const drawShape = (kind: DrawKind, pts: { x: number; y: number }[], stroke: string, fill?: string, label?: string): void => {
            if (pts.length === 0) return;
            switch (kind) {
                case 'hline':
                    strokeLine([{ x: 0, y: pts[0].y }, { x: plotW, y: pts[0].y }], stroke, true);
                    break;
                case 'trend':
                    strokeLine(pts, stroke);
                    break;
                case 'ray': {
                    if (pts.length < 2) return;
                    const [a, b] = pts;
                    const dx = b.x - a.x;
                    if (Math.abs(dx) < 0.001) { strokeLine([a, { x: a.x, y: plotH }], stroke); return; }
                    const slope = (b.y - a.y) / dx;
                    strokeLine([a, { x: plotW, y: a.y + slope * (plotW - a.x) }], stroke);
                    break;
                }
                case 'rect': {
                    if (pts.length < 2) return;
                    const [a, b] = pts;
                    ctx.fillStyle = fill ?? `${stroke}22`;
                    ctx.strokeStyle = stroke;
                    ctx.lineWidth = 1.4;
                    ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
                    ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
                    break;
                }
                case 'brush':
                    strokeLine(pts, stroke, false, 2);
                    break;
                case 'fib': {
                    // Retracement levels between the two anchors — dashed
                    // interior lines, solid 0%/100%, each tagged with ratio +
                    // real price (like TradingView's level captions).
                    if (pts.length < 2) return;
                    const [a, b] = pts;
                    const left = Math.min(a.x, b.x);
                    const right = Math.max(a.x, b.x);
                    const cs = candlesRef.current;
                    ctx.font = '9px ui-monospace, monospace';
                    for (const r of FIB_RATIOS) {
                        const y = a.y + (b.y - a.y) * r;
                        ctx.strokeStyle = stroke;
                        ctx.lineWidth = 1;
                        ctx.setLineDash(r === 0 || r === 1 ? [] : [4, 3]);
                        ctx.beginPath();
                        ctx.moveTo(left, y);
                        ctx.lineTo(right, y);
                        ctx.stroke();
                        ctx.setLineDash([]);
                        const dp = cs ? Number(cs.coordinateToPrice(y as never)) : NaN;
                        const price = Number.isFinite(dp) ? ` ${dp >= 1000 ? dp.toFixed(0) : dp.toFixed(2)}` : '';
                        ctx.fillStyle = stroke;
                        ctx.fillText(`${(r * 100).toFixed(1)}%${price}`, left + 3, Math.max(8, y - 3));
                    }
                    return;
                }
                case 'text': {
                    // The annotation string IS the label (user tool + the
                    // model's draw_on_chart kind "text" both set it).
                    ctx.fillStyle = stroke;
                    ctx.font = '11px ui-monospace, monospace';
                    ctx.fillText(label || 'Note', pts[0].x + 4, pts[0].y - 4);
                    return;
                }
            }
            if (label) {
                ctx.fillStyle = stroke;
                ctx.font = '10px ui-monospace, monospace';
                ctx.fillText(label, pts[0].x + 4, Math.max(10, pts[0].y - 5));
            }
            priceLabel(pts[0], stroke);
        };

        // The eye toggle blanks every layer (draft included) without deleting.
        if (!drawingsHiddenRef.current) {
            for (const d of drawingsRef.current) {
                const pts = project(d.points);
                if (pts.length > 0) drawShape(d.kind, pts, d.color, undefined, d.label);
            }
            // The model's own shapes (draw_on_chart / mark_trade_levels) render
            // after the user's, same style — their labels ("Entry", "SL"…)
            // announce them. Not persisted into the user's drawing file.
            for (const d of modelDrawingsRef.current) {
                const pts = project(d.points);
                if (pts.length > 0) drawShape(d.kind, pts, d.color, undefined, d.label);
            }
            if (draft && draft.points.length > 0) {
                const draftKind: DrawKind = tool === 'hline' ? 'hline' : tool === 'rect' ? 'rect' : tool === 'ray' ? 'ray' : tool === 'brush' ? 'brush' : tool === 'fib' ? 'fib' : 'trend';
                drawShape(draftKind, draft.points, color, `${color}22`);
            }
        }
        ctx.restore();
    }, [toScreen, draft, tool, color]);

    // Repaint on state changes and on every pan/zoom the chart performs.
    useEffect(() => {
        repaint();
        const chart = chartRef.current;
        if (!chart) return;
        const handler = (): void => repaint();
        const ts = chart.timeScale();
        // Test mocks may omit the subscription API — painting still works,
        // only pan/zoom repaint is skipped there.
        const sub = ts.subscribeVisibleLogicalRangeChange?.bind(ts);
        const unsub = ts.unsubscribeVisibleLogicalRangeChange?.bind(ts);
        if (sub) sub(handler);
        // jsdom (and older webviews) have no ResizeObserver — painting on
        // pan/zoom still works via the range subscription alone.
        const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => repaint()) : null;
        if (ro && hostRef.current) ro.observe(hostRef.current);
        return () => {
            if (unsub) { try { unsub(handler); } catch { /* chart removed */ } }
            ro?.disconnect();
        };
    }, [repaint, drawings, modelDrawings, status, interval]);

    // ─── Pointer capture on the overlay (only while a tool is active) ───────
    const localPoint = (ev: React.PointerEvent): { x: number; y: number } => {
        const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
        return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
    };

    const hitTestDrawing = (x: number, y: number): ChartDrawing | null => {
        for (let i = drawingsRef.current.length - 1; i >= 0; i -= 1) {
            const d = drawingsRef.current[i];
            const pts = d.points.map(p => toScreen(p)).filter((s): s is { x: number; y: number } => s !== null);
            if (pts.length === 0) continue;
            if (d.kind === 'rect') {
                const [a, b] = pts;
                if (Math.min(a.x, b.x) - 4 <= x && x <= Math.max(a.x, b.x) + 4
                    && Math.min(a.y, b.y) - 4 <= y && y <= Math.max(a.y, b.y) + 4) return d;
                continue;
            }
            if (d.kind === 'hline' && Math.abs(y - pts[0].y) < 6) return d;
            if (d.kind === 'text' && Math.hypot(x - pts[0].x, y - pts[0].y) < 12) return d;
            for (let j = 1; j < pts.length; j += 1) {
                if (distToSegment(x, y, pts[j - 1].x, pts[j - 1].y, pts[j].x, pts[j].y) < 6) return d;
            }
        }
        return null;
    };

    const onPointerDown = (ev: React.PointerEvent): void => {
        if (tool === 'cursor') return;
        ev.preventDefault();
        const pt = localPoint(ev);
        if (tool === 'erase') {
            const hit = hitTestDrawing(pt.x, pt.y);
            if (hit) publishDrawings(drawingsRef.current.filter(d => d.id !== hit.id));
            return;
        }
        if (tool === 'hline') {
            const dp = toData(pt.x, pt.y);
            if (dp) publishDrawings([...drawingsRef.current, { id: createDrawingId(), kind: 'hline', points: [dp], color, createdAt: Date.now() }]);
            return;
        }
        if (tool === 'text') {
            // A text note is placed in one click, then typed in place — the
            // editor input mounts over the anchor; Enter commits, Esc deletes.
            const dp = toData(pt.x, pt.y);
            if (dp) {
                const id = createDrawingId();
                publishDrawings([...drawingsRef.current, { id, kind: 'text', points: [dp], color, createdAt: Date.now(), label: 'Note' }]);
                setTextEdit({ id, x: pt.x, y: pt.y });
            }
            return;
        }
        setDraft({ points: [pt] });
        (ev.currentTarget as HTMLElement).setPointerCapture?.(ev.pointerId);
    };

    const onPointerMove = (ev: React.PointerEvent): void => {
        if (!draft || tool === 'cursor' || tool === 'erase') return;
        const pt = localPoint(ev);
        if (tool === 'brush') {
            const last = draft.points[draft.points.length - 1];
            if (Math.hypot(pt.x - last.x, pt.y - last.y) < 3) return;
            setDraft({ points: [...draft.points, pt] });
        } else {
            const a = draft.points[0];
            setDraft({ points: [a, pt] });
        }
    };

    const onPointerUp = (ev: React.PointerEvent): void => {
        if (!draft) return;
        const kind = tool as DrawKind;
        const pts = draft.points;
        setDraft(null);
        (ev.currentTarget as HTMLElement).releasePointerCapture?.(ev.pointerId);
        if (pts.length < 2) return;
        const dataPts = pts.map(p => toData(p.x, p.y)).filter((p): p is DrawPoint => p !== null);
        const finalPts = pointsForKind(kind, dataPts);
        if (!finalPts || finalPts.length < 2) return;
        publishDrawings([...drawingsRef.current, { id: createDrawingId(), kind, points: finalPts, color, createdAt: Date.now() }]);
    };

    const undoDrawing = (): void => publishDrawings(drawings.slice(0, -1));
    const clearDrawings = (): void => {
        publishDrawings([]);
        setTextEdit(null);
    };
    /** Live-rename the text note being edited (already published). */
    const renameTextDrawing = (id: string, label: string): void => {
        publishDrawings(drawingsRef.current.map(d => (d.id === id ? { ...d, label: label.slice(0, 80) } : d)));
    };
    /** Commit (blur/Enter) or cancel (Esc — removes the note) the editor. */
    const finishTextEdit = (cancel = false): void => {
        if (!textEdit) return;
        if (cancel) publishDrawings(drawingsRef.current.filter(d => d.id !== textEdit.id));
        setTextEdit(null);
    };

    // ─── Imperative handle (screenshot + snapshot) ──────────────────────────
    useEffect(() => {
        if (!chartHandle) return;
        chartHandle.current = {
            capturePng: (): string | null => {
                try {
                    const chart = chartRef.current;
                    if (!chart) return null;
                    const base = chart.takeScreenshot(false, false);
                    const out = document.createElement('canvas');
                    out.width = base.width;
                    out.height = base.height;
                    const ctx = out.getContext('2d');
                    if (!ctx) return null;
                    ctx.fillStyle = '#0b0b0a';
                    ctx.fillRect(0, 0, out.width, out.height);
                    ctx.drawImage(base, 0, 0);
                    // The drawing overlay is a CSS-pixel canvas over the chart
                    // host — scale it onto the screenshot's pixel grid.
                    if (overlayRef.current) {
                        ctx.drawImage(overlayRef.current, 0, 0, out.width, out.height);
                    }
                    return out.toDataURL('image/png');
                } catch {
                    return null;
                }
            },
            getSnapshot: (): ChartSnapshot | null => {
                const cs = candlesRef.current;
                if (!cs) return null;
                const data = (cs.data() ?? []) as readonly { time: number; open: number; high: number; low: number; close: number }[];
                const tail = data.slice(-30).map(c => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close }));
                return {
                    symbol,
                    interval,
                    candles: tail,
                    markPrice: lastPrice ?? null,
                    levels: levels.map(l => ({ label: l.label, price: l.price })),
                    drawings: drawingsRef.current,
                    modelDrawings: modelDrawingsRef.current,
                    capturedAt: Date.now(),
                };
            },
            clearUserDrawings: (): void => publishDrawings([]),
        };
        return () => { chartHandle.current = null; };
    }, [chartHandle, symbol, interval, lastPrice, levels, publishDrawings]);

    const toolActive = tool !== 'cursor';

    return (
        <div className="flex h-full min-h-0 flex-col" data-testid="trading-chart">
            <div className="relative flex shrink-0 flex-wrap items-center gap-0.5 border-b border-white/[0.06] px-2 py-1.5">
                {barIntervals.map(tf => (
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
                {/* TradingView-style interval customization: pick which
                    timeframes the bar shows (the active one is locked in). */}
                <button type="button" onClick={() => setTfPickerOpen(v => !v)} aria-label="Customize timeframes" aria-expanded={tfPickerOpen}
                    title="Choose which timeframes show in this bar"
                    className={`ml-0.5 h-6 w-6 rounded-control text-[12px] leading-none transition-colors ${
                        tfPickerOpen ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:bg-white/[0.05] hover:text-zinc-200'
                    }`}>
                    ⚙
                </button>
                {tfPickerOpen && (
                    <>
                        <div className="fixed inset-0 z-20" aria-hidden onClick={() => setTfPickerOpen(false)} />
                        <div className="absolute left-2 top-9 z-30 w-40 rounded-xl border border-white/10 bg-zinc-900 p-1 shadow-xl" data-testid="tf-picker">
                            <p className="px-2 py-1 text-[9px] uppercase tracking-widest text-zinc-600">Timeframes</p>
                            <div className="grid grid-cols-2 gap-0.5">
                                {CHART_INTERVALS.map(tf => {
                                    const shown = tfBar.includes(tf) || tf === interval;
                                    return (
                                        <button key={tf} type="button" onClick={() => toggleTfBar(tf)} disabled={tf === interval}
                                            aria-pressed={shown} title={tf === interval ? 'The current timeframe always shows' : undefined}
                                            className={`flex items-center justify-between rounded-lg px-2 py-1 text-[11px] transition-colors hover:bg-white/[0.06] disabled:opacity-40 ${
                                                shown ? 'text-zinc-100' : 'text-zinc-500'
                                            }`}>
                                            {tf}
                                            <span aria-hidden>{shown ? '✓' : ''}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </>
                )}
                {/* Drawing tools live in the TradingView-style LEFT RAIL over
                    the plot (ChartToolRail) — the top bar keeps timeframes. */}
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
                <ChartToolRail
                    tool={tool}
                    onSelectTool={t => { setTool(t); setDraft(null); setTextEdit(null); }}
                    color={color}
                    onColorChange={setColor}
                    canUndo={drawings.length > 0}
                    onUndo={undoDrawing}
                    onClear={clearDrawings}
                    hidden={drawingsHidden}
                    onToggleHidden={() => setDrawingsHidden(v => !v)}
                />
                <div ref={hostRef} className="absolute inset-y-0 right-0" style={{ left: CHART_RAIL_WIDTH }} />
                {/* Drawing overlay: captures the pointer ONLY while a tool is
                    active; otherwise the chart underneath gets every event.
                    z-10 clears lightweight-charts' internal z-1/z-2 canvases —
                    without it the overlay is hit-test BELOW the chart and no
                    tool ever receives a pointer. Inset left by the rail width
                    so shapes never paint under the rail. */}
                <canvas
                    ref={overlayRef}
                    data-testid="draw-overlay"
                    className={`absolute inset-y-0 right-0 z-10 h-full w-auto ${toolActive ? (tool === 'erase' ? 'cursor-pointer' : 'cursor-crosshair') : 'pointer-events-none'}`}
                    style={{ left: CHART_RAIL_WIDTH, touchAction: 'none' }}
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                />
                {/* In-place editor for a just-placed text note. */}
                {textEdit && (
                    <input
                        autoFocus
                        data-testid="text-note-editor"
                        defaultValue={drawingsRef.current.find(d => d.id === textEdit.id)?.label ?? ''}
                        onChange={ev => renameTextDrawing(textEdit.id, ev.target.value)}
                        onKeyDown={ev => {
                            if (ev.key === 'Enter') finishTextEdit(false);
                            if (ev.key === 'Escape') finishTextEdit(true);
                        }}
                        onBlur={() => finishTextEdit(false)}
                        placeholder="Type a note…"
                        className="absolute z-20 w-40 rounded-control border border-white/15 bg-zinc-900 px-1.5 py-0.5 text-[11px] text-zinc-100 focus:outline-none"
                        style={{
                            left: Math.min(textEdit.x + CHART_RAIL_WIDTH + 6, (hostRef.current?.clientWidth ?? 400) - 170),
                            top: Math.max(4, textEdit.y - 24),
                        }}
                    />
                )}
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
