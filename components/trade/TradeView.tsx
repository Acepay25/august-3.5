/**
 * TradeView — August's take on Minara's /app/trade/perps/BTC screen, dark:
 * a stats strip (Mark / Oracle / 24h / Volume / OI / Funding + countdown)
 * over a full-height canvas chart with TradingView-style drawing tools,
 * with the order-book ladder and the live-context Chart AI docked to the
 * right. The dock is drag-resizable, collapsible to a rail and expandable
 * over the chart; its width persists. Push-first: one websocket bundle per
 * symbol drives strip + book + candles; REST polling takes over the moment
 * the socket drops (and the chart's own stall watchdog re-syncs a quiet
 * stream), so prices on the chart are realtime or visibly healing.
 * Presentation only — no order execution.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { GripVertical } from 'lucide-react';
import { ProviderConfig } from '../../types/provider';
import { TradeAnalysis, LoggedTrade } from '../../types';
import { fetchMarkIndex, fetchMarketData, fetchDerivativesData, fetchTopFuturesSymbols, type SymbolTicker } from '../../services/analysis/MarketDataService';
import { verdictLevels } from '../../services/trade/chartData';
import type { ChartDrawing } from '../../services/trade/chartDrawings';
import type { TradeProposal } from '../../services/trade/proposedTrade';
import * as levelWatch from '../../services/trade/levelWatchService';
import { formatLevelHitForModel, type WatchPlan } from '../../services/trade/tradePlanLevels';
import * as watchService from '../../services/trade/watchService';
import { formatWatchFiredForModel } from '../../services/trade/chartTriggers';
import { notify, ensureNotifyPermission } from '../../services/infrastructure/notify';
import * as chatStore from '../../services/trade/chatStore';
import { useFuturesLiveFeed } from '../../hooks/useFuturesLiveFeed';
import TradingChart, { type ChartInterval, type ChartHandle } from './TradingChart';
import OrderBookPanel from './OrderBookPanel';
import TradeChatPanel from './TradeChatPanel';
import type { AgentBot } from '../../services/agents/agentRoster';

const FALLBACK_SYMBOLS: SymbolTicker[] = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'DOGEUSDT', 'XRPUSDT', 'BNBUSDT', 'ADAUSDT', 'AVAXUSDT']
    .map(symbol => ({ symbol, lastPrice: 0, changePercent24h: 0, quoteVolume: 0 }));

interface TradeViewProps {
    providers: ProviderConfig[];
    selectedChatModel: string;
    onSelectChatModel: (modelId: string) => void;
    /** The currently projected verdict — its Entry/SL/TP lines are drawn on
     *  the chart when it belongs to the selected symbol. */
    verdict?: TradeAnalysis | null;
    /** Roster bots — a Chart AI session can be bound to one (persona). */
    bots?: AgentBot[];
    /** The user's logged trade history — passed to Chart AI's desk tools so
     *  recall / setup-history see what the user actually traded. */
    trades?: LoggedTrade[];
    /** A roster click elsewhere asked Chart AI to open this bot's session
     *  (nonce-keyed so repeats re-open even for the same bot). */
    botSessionRequest?: { botId: string; nonce: number };
    /** Same for group rooms and the Coach inbox (dock session kinds). */
    groupSessionRequest?: { groupId: string; nonce: number };
    coachSessionRequest?: number;
    /** Run the FULL ensemble analysis from the Chart AI composer; resolves
     *  with the verdict summary text to show back in the chat. */
    onRunAnalysis?: (prompt: string, images: Array<{ name: string; dataURL: string }>) => Promise<string>;
    /** "Log this trade" on a Chart AI proposal → record an OPEN trade. */
    onLogProposedTrade?: (proposal: TradeProposal) => void;
    /** Roster surfaces the Chart AI dock embeds (Coach inbox + group rooms). */
    renderCoachSurface?: () => React.ReactNode;
    renderGroupSurface?: (groupId: string) => React.ReactNode;
    /** Group rooms offered in the dock's New-session menu (name for tabs). */
    groups?: Array<{ id: string; name: string }>;
    /** The Antigravity-style left sidebar (the order book) — toggled by
     *  clicking the active Trade icon in the activity bar. */
    sidebarOpen?: boolean;
}

interface StripData {
    markPrice: number;
    indexPrice: number;
    lastFundingRate: number;
    nextFundingTime: number;
    changePercent24h: number;
    volume24h: number;
    oiValue: number;
}

const fmtUsd = (n: number): string => n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${n.toFixed(2)}`;
const fmtPrice = (n: number): string => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: n >= 1000 ? 2 : 4 });

/** Chart AI dock geometry — persisted like a panel, clamped to sane widths.
 *  The dock lives at the RIGHT of the chart, so dragging the separator LEFT
 *  grows it: width = startWidth - (clientX - startX). */
const DOCK_WIDTH_KEY = 'trade_dock_width_v1';
const DOCK_MIN = 300;
const DOCK_MAX = 820;
const DOCK_DEFAULT = 384;
const readDockWidth = (): number => {
    try {
        const n = Number(localStorage.getItem(DOCK_WIDTH_KEY));
        return Number.isFinite(n) && n >= DOCK_MIN && n <= DOCK_MAX ? n : DOCK_DEFAULT;
    } catch { return DOCK_DEFAULT; }
};

const Stat: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
    <div className="flex min-w-0 flex-col px-3">
        <span className="text-[9px] uppercase tracking-wider text-zinc-600">{label}</span>
        <span className="truncate font-mono text-[12px] tabular-nums text-zinc-200">{value}</span>
    </div>
);

const fundingCountdown = (nextFundingTime: number, nowMs: number): string => {
    const left = nextFundingTime - nowMs;
    if (!Number.isFinite(left) || left <= 0) return '—';
    const h = Math.floor(left / 3_600_000);
    const m = Math.floor((left % 3_600_000) / 60_000);
    const s = Math.floor((left % 60_000) / 1000);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

const TradeView: React.FC<TradeViewProps> = ({ providers, selectedChatModel, onSelectChatModel, verdict, bots = [], trades = [], botSessionRequest, groupSessionRequest, coachSessionRequest, onRunAnalysis, onLogProposedTrade, renderCoachSurface, renderGroupSurface, groups = [], sidebarOpen = true }) => {
    const [symbol, setSymbol] = useState('BTCUSDT');
    const [interval, setInterval_] = useState<ChartInterval>('15m');
    const [strip, setStrip] = useState<StripData | null>(null);
    const [nowMs, setNowMs] = useState(() => Date.now());
    const [symbols, setSymbols] = useState<SymbolTicker[]>(FALLBACK_SYMBOLS);
    const [chartDrawings, setChartDrawings] = useState<ChartDrawing[]>([]);
    /** Shapes the MODEL drew via desk tools — rendered on the chart, never
     *  persisted into the user's drawing file, cleared on symbol change. */
    const [modelDrawings, setModelDrawings] = useState<ChartDrawing[]>([]);
    const chartHandleRef = useRef<ChartHandle | null>(null);
    const [dockWidth, setDockWidth] = useState<number>(readDockWidth);
    const [dockCollapsed, setDockCollapsed] = useState(false);
    const [dockExpanded, setDockExpanded] = useState(false);
    const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
    const widthRef = useRef(dockWidth);
    widthRef.current = dockWidth;

    // Push-first feed: markPrice@1s + depth20@100ms + ticker + kline over two
    // websockets. `live` gates every REST poll below — polling is the
    // fallback, never the primary path while the socket is up.
    const feed = useFuturesLiveFeed(symbol, interval);
    const live = feed.status === 'live';

    // ── Session-scoped chart memory ─────────────────────────────────────────
    // Each Chart AI session remembers the instrument + interval it was set up
    // on: switching sessions (from the dock's history palette) — or remounting
    // this surface — restores that chart. Capture flows the other way: every
    // user-driven symbol/interval change is stamped onto the ACTIVE session.
    const chatSnap = useSyncExternalStore(chatStore.subscribe, chatStore.getSnapshot, chatStore.getSnapshot);
    const symbolRef = useRef(symbol);
    symbolRef.current = symbol;
    const intervalRef = useRef(interval);
    intervalRef.current = interval;
    useEffect(() => {
        const s = chatStore.getSnapshot().sessions.find(x => x.id === chatSnap.activeId);
        if (!s) return;
        if (s.symbol && s.symbol !== symbolRef.current) setSymbol(s.symbol);
        if (s.interval && s.interval !== intervalRef.current) setInterval_(s.interval as ChartInterval);
    }, [chatSnap.activeId]);
    const changeSymbol = useCallback((next: string): void => {
        setSymbol(next);
        chatStore.mutate(chatStore.getActiveId(), sess => ({ ...sess, symbol: next }));
    }, []);
    const changeInterval = useCallback((next: ChartInterval): void => {
        setInterval_(next);
        chatStore.mutate(chatStore.getActiveId(), sess => ({ ...sess, interval: next }));
    }, []);

    // Dynamic universe: top USDT perps by 24h volume, one public call, 60s
    // refresh; the static fallback keeps the picker usable offline.
    useEffect(() => {
        let cancelled = false;
        const load = async (): Promise<void> => {
            const top = await fetchTopFuturesSymbols(20);
            if (!cancelled && top.length > 0) setSymbols(top);
        };
        void load();
        const poll = window.setInterval(() => void load(), 60_000);
        return () => { cancelled = true; window.clearInterval(poll); };
    }, []);

    // Fallback strip (only while the socket is down): 15s refresh.
    useEffect(() => {
        if (live) return;
        let cancelled = false;
        const load = async (): Promise<void> => {
            try {
                const [mi, market, deriv] = await Promise.all([
                    fetchMarkIndex(symbol),
                    fetchMarketData(symbol),
                    fetchDerivativesData(symbol),
                ]);
                if (!cancelled) {
                    setStrip({
                        markPrice: mi.markPrice,
                        indexPrice: mi.indexPrice,
                        lastFundingRate: mi.lastFundingRate,
                        nextFundingTime: mi.nextFundingTime,
                        changePercent24h: market.priceChangePercent24h ?? 0,
                        volume24h: market.volume24h ?? 0,
                        oiValue: deriv.openInterestValue ?? 0,
                    });
                }
            } catch { /* keep the last strip on a failed poll */ }
        };
        void load();
        const poll = window.setInterval(() => void load(), 15_000);
        return () => { cancelled = true; window.clearInterval(poll); };
    }, [symbol, live]);

    // OI has no public stream — seed/refresh it on the slow poll even when
    // the rest of the strip is live.
    useEffect(() => {
        let cancelled = false;
        void fetchDerivativesData(symbol).then(d => {
            if (!cancelled) setStrip(prev => (prev ? { ...prev, oiValue: d.openInterestValue ?? prev.oiValue } : prev));
        }).catch(() => { /* keep last */ });
        return () => { cancelled = true; };
    }, [symbol, live]);

    // A model drawing belongs to the symbol it was drawn on — switching
    // instruments wipes the canvas and drops the PREVIOUS symbol's level
    // watches (a remount of the same symbol keeps its plans alive — the
    // watch lives in the module singleton, and fired latches persist).
    const prevSymbolRef = useRef(symbol);
    useEffect(() => {
        if (prevSymbolRef.current !== symbol) levelWatch.disarmSymbol(prevSymbolRef.current);
        prevSymbolRef.current = symbol;
        setModelDrawings([]);
    }, [symbol]);

    // 1s tick for the funding countdown.
    useEffect(() => {
        const tick = window.setInterval(() => setNowMs(Date.now()), 1000);
        return () => window.clearInterval(tick);
    }, []);

    // Live values override polled ones while the socket is up.
    const markPrice = feed.markIndex?.markPrice ?? strip?.markPrice;
    const indexPrice = feed.markIndex?.indexPrice ?? strip?.indexPrice;
    const fundingRate = feed.markIndex?.fundingRate ?? strip?.lastFundingRate;
    const nextFundingTime = feed.markIndex?.nextFundingTime ?? strip?.nextFundingTime;
    const changePct = feed.ticker?.changePercent24h ?? strip?.changePercent24h;
    const quoteVolume = feed.ticker?.quoteVolume24h ?? strip?.volume24h;
    const lastPrice = feed.ticker?.lastPrice ?? markPrice;
    // What's drawn on the chart right now — forwarded to the chat so its
    // get_chart_view tool can tell the model what the user is looking at.
    const chartLevels = useMemo(() => verdictLevels(verdict, symbol), [verdict, symbol]);

    // ── Harness level-watch (advisory only — OutcomeAutopilot resolves) ────
    // Arm a plan the Chart AI model presents, feeding it the live mark so the
    // stale-plan guard can suppress a tick-0 ping for an already-dead plan.
    // The mark rides a ref so the handler identity stays stable (the dock is
    // memoized; the mark re-renders every second).
    const markPriceRef = useRef<number | undefined>(markPrice);
    markPriceRef.current = markPrice;
    const handlePlanPresented = useCallback((plan: WatchPlan): void => {
        // A level watch is exactly "alert me when price gets there" — request
        // the OS notification permission NOW so the grant exists when the
        // level hits later (same treatment as the watch_price/wake_me tools).
        void ensureNotifyPermission();
        const at = markPriceRef.current;
        levelWatch.arm(plan, typeof at === 'number' && Number.isFinite(at) ? at : null);
    }, []);
    // Tick the level-watch AND the model's price watches on every live mark
    // print (~1s while the socket is up; the polled strip value drives it
    // otherwise). Time wake-ups fire off the watch service's own clock.
    useEffect(() => {
        if (Number.isFinite(markPrice)) {
            levelWatch.tick(symbol, markPrice!);
            watchService.tick(symbol, markPrice!);
        }
    }, [symbol, markPrice]);
    // Route every level hit into the Chart AI queue as a model warning. The
    // store holds it if a run is busy or the dock is unmounted, so nothing
    // drops — the panel flushes the queue when its session goes idle. Also
    // ping the user's computer: a level hitting is exactly the moment they
    // stepped away waiting for.
    useEffect(() => levelWatch.subscribe((hit, plan) => {
        chatStore.queueHarnessSignal(formatLevelHitForModel(plan, hit, levelWatch.firedLevelsFor(plan.planId)));
        void notify(`${plan.symbol} ${hit.label} hit`, `${hit.label} @ ${hit.price} reached (mark ${hit.hitPrice}). Chart AI is reviewing the plan.`, { tag: hit.levelId });
    }), []);
    // A fired watch (price trigger or scheduled wake) wakes the model the
    // same store-queued way, so the alert survives a busy run or a tab switch
    // — and reaches the OS so the user notices even with the app backgrounded.
    useEffect(() => watchService.subscribe((fired, remaining) => {
        chatStore.queueHarnessSignal(formatWatchFiredForModel(fired, remaining.length));
        const w = fired.watch;
        const cond = w.kind === 'price'
            ? `${w.symbol} ${w.condition} ${w.price}${fired.price !== null ? ` (now ${fired.price})` : ''}`
            : `${w.symbol} scheduled re-check is due`;
        void notify('Chart AI watch fired', `${cond} — ${w.note}`, { tag: w.id });
    }), []);

    const changeTone = useMemo(() => {
        const v = changePct ?? 0;
        return v > 0 ? 'text-emerald-400' : v < 0 ? 'text-rose-400' : 'text-zinc-300';
    }, [changePct]);

    // ── Dock drag-resize (pointer capture, persists on release) ────────────
    // While the dock is EXPANDED the width comes from the flex layout, so a
    // drag starts by un-expanding and capturing the CURRENT pixel width (the
    // ref reads the live DOM, not the stale px state) — the separator always
    // does something instead of feeling dead.
    const onDragMove = useCallback((ev: PointerEvent): void => {
        const drag = dragRef.current;
        if (!drag) return;
        setDockWidth(Math.min(DOCK_MAX, Math.max(DOCK_MIN, drag.startWidth - (ev.clientX - drag.startX))));
    }, []);
    const onDragUp = useCallback((): void => {
        dragRef.current = null;
        window.removeEventListener('pointermove', onDragMove);
        window.removeEventListener('pointerup', onDragUp);
        try { localStorage.setItem(DOCK_WIDTH_KEY, String(widthRef.current)); } catch { /* private mode */ }
    }, [onDragMove]);
    const startDrag = useCallback((ev: React.PointerEvent): void => {
        ev.preventDefault();
        const dockEl = (ev.currentTarget as HTMLElement).nextElementSibling as HTMLElement | null;
        const currentWidth = dockEl?.getBoundingClientRect().width ?? widthRef.current;
        if (dockExpanded) setDockExpanded(false);
        dragRef.current = { startX: ev.clientX, startWidth: currentWidth };
        window.addEventListener('pointermove', onDragMove);
        window.addEventListener('pointerup', onDragUp);
    }, [onDragMove, onDragUp, dockExpanded]);
    useEffect(() => () => { window.removeEventListener('pointermove', onDragMove); window.removeEventListener('pointerup', onDragUp); }, [onDragMove, onDragUp]);

    const captureChart = useCallback((): string | null => chartHandleRef.current?.capturePng() ?? null, []);
    const getChartSnapshot = useCallback(() => chartHandleRef.current?.getSnapshot() ?? null, []);
    /** Desk-tool drawing surface: the panel hands these to the model's
     *  draw_on_chart / mark_trade_levels / clear_chart_drawings calls. */
    const addModelDrawings = useCallback((drawings: ChartDrawing[]): void => {
        setModelDrawings(prev => [...prev, ...drawings].slice(-60));
    }, []);
    const clearModelDrawings = useCallback((): void => setModelDrawings([]), []);
    const clearAllDrawings = useCallback((): void => {
        setModelDrawings([]);
        chartHandleRef.current?.clearUserDrawings();
    }, []);

    const dockProps = {
        symbol,
        interval,
        providers,
        selectedChatModel,
        onSelectChatModel,
        live,
        chartLevels,
        chartDrawings,
        modelDrawings,
        onCaptureChart: captureChart,
        getChartSnapshot,
        addModelDrawings,
        clearModelDrawings,
        clearAllDrawings,
        bots,
        trades,
        botSessionRequest,
        groupSessionRequest,
        coachSessionRequest,
        onRunAnalysis,
        onLogProposedTrade,
        onPlanPresented: handlePlanPresented,
        renderCoachSurface,
        renderGroupSurface,
        groups,
    };

    return (
        <div className="flex h-full min-h-0 flex-col bg-zinc-950" data-testid="trade-view">
            {/* Stats strip (Minara perps header) */}
            <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-white/[0.06] bg-zinc-900/60 py-2 pr-3">
                <div className="pl-3 pr-1">
                    <select
                        value={symbol}
                        onChange={e => changeSymbol(e.target.value)}
                        aria-label="Trade symbol"
                        className="rounded-control border border-white/10 bg-zinc-800 px-2 py-1 text-[13px] font-bold text-zinc-100 focus:outline-none"
                    >
                        {symbols.map(s => <option key={s.symbol} value={s.symbol}>
                            {s.symbol.replace(/USDT$/, '/USDT')}{s.changePercent24h ? `  ${s.changePercent24h >= 0 ? '+' : ''}${s.changePercent24h.toFixed(1)}%` : ''}
                        </option>)}
                    </select>
                </div>
                <span
                    data-testid="feed-status"
                    title={feed.status === 'live' ? 'Websocket push (markPrice@1s · depth20@100ms · ticker · kline)' : feed.status === 'connecting' ? 'Opening websockets…' : 'Websocket down — REST polling every 15s'}
                    className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest ${
                        feed.status === 'live' ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                            : feed.status === 'connecting' ? 'border-white/10 bg-zinc-800 text-zinc-400'
                                : 'border-amber-500/30 bg-amber-500/10 text-amber-400'
                    }`}
                >
                    {feed.status === 'live' ? '● live' : feed.status === 'connecting' ? 'connecting' : 'polling'}
                </span>
                <Stat label="Mark" value={Number.isFinite(markPrice) ? fmtPrice(markPrice!) : '—'} />
                <Stat label="Oracle" value={Number.isFinite(indexPrice) ? fmtPrice(indexPrice!) : '—'} />
                <Stat label="24h Change" value={Number.isFinite(changePct) ? `${changePct! >= 0 ? '+' : ''}${changePct!.toFixed(2)}%` : '—'} />
                <Stat label="24h Volume" value={Number.isFinite(quoteVolume) ? fmtUsd(quoteVolume!) : '—'} />
                <Stat label="Open Interest" value={strip ? fmtUsd(strip.oiValue) : '—'} />
                <Stat label="Funding / Countdown" value={Number.isFinite(fundingRate) ? (
                    <span className={fundingRate! >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                        {(fundingRate! * 100).toFixed(4)}% <span className="text-zinc-500">{fundingCountdown(nextFundingTime ?? 0, nowMs)}</span>
                    </span>
                ) : '—'} />
                <span className={`ml-auto hidden shrink-0 pr-1 font-mono text-[15px] font-bold tabular-nums sm:block ${changeTone}`}>
                    {Number.isFinite(lastPrice) ? fmtPrice(lastPrice!) : ''}
                </span>
            </div>

            {/* Chart + book + AI chat (drag-resizable dock) */}
            <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
                {/* Left sidebar (Antigravity's Explorer position): the order
                    book, open/closed from the activity bar's active Trade
                    icon. Closed = the chart owns the whole middle. */}
                {sidebarOpen && (
                    <div className="hidden w-[300px] shrink-0 md:block" data-testid="trade-sidebar">
                        <OrderBookPanel symbol={symbol} live={live} liveDepth={feed.depth} />
                    </div>
                )}
                <div className={`min-h-[420px] flex-1 lg:min-h-0 ${dockExpanded ? 'lg:w-1/3 lg:flex-none' : ''}`}>
                    <TradingChart symbol={symbol} interval={interval} onIntervalChange={changeInterval} verdict={verdict} live={live} liveKline={feed.kline}
                        lastPrice={Number.isFinite(lastPrice) ? lastPrice : null}
                        chartHandle={chartHandleRef}
                        onDrawingsChange={setChartDrawings}
                        modelDrawings={modelDrawings} />
                </div>
                {!dockCollapsed && (
                    <>
                        {/* Drag handle: resize the Chart AI dock (TradingView-style). */}
                        <div
                            role="separator"
                            aria-orientation="vertical"
                            aria-label="Resize Chart AI dock"
                            onPointerDown={startDrag}
                            onDoubleClick={() => { setDockWidth(DOCK_DEFAULT); try { localStorage.setItem(DOCK_WIDTH_KEY, String(DOCK_DEFAULT)); } catch { /* private mode */ } }}
                            title="Drag to resize · double-click to reset"
                            className="hidden w-1.5 shrink-0 cursor-col-resize touch-none items-center justify-center border-x border-white/[0.06] bg-zinc-900/40 text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-zinc-300 lg:flex"
                        >
                            <GripVertical className="h-3 w-3" />
                        </div>
                        <div
                            data-testid="trade-dock"
                            style={{ '--dock-w': `${dockWidth}px` } as React.CSSProperties}
                            className={`h-96 w-full shrink-0 lg:h-auto lg:w-[var(--dock-w)] lg:min-w-[300px] ${dockExpanded ? 'lg:!w-2/3 xl:!w-3/4' : ''}`}
                        >
                            <TradeChatPanel
                                {...dockProps}
                                collapsed={false}
                                onToggleCollapsed={() => { setDockCollapsed(true); setDockExpanded(false); }}
                                expanded={dockExpanded}
                                onToggleExpanded={() => setDockExpanded(v => !v)}
                            />
                        </div>
                    </>
                )}
                {dockCollapsed && (
                    <div className="hidden shrink-0 lg:block" data-testid="trade-dock-rail">
                        <TradeChatPanel
                            {...dockProps}
                            collapsed
                            onToggleCollapsed={() => setDockCollapsed(false)}
                            expanded={dockExpanded}
                            onToggleExpanded={() => setDockExpanded(v => !v)}
                        />
                    </div>
                )}
            </div>
        </div>
    );
};

export default TradeView;
