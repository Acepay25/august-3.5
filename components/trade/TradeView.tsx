/**
 * TradeView — August's take on Minara's /app/trade/perps/BTC screen, dark,
 * in the prototype's two-row market header: identity + HERO price (with a
 * 48-bar spark + feed state), then a quiet metrics strip (Mark / Oracle /
 * 24h / Volume / OI / Funding with a depleting-window bar) — over a
 * full-height canvas chart with TradingView-style drawing tools, with the
 * order-book ladder and the live-context Chart AI docked to the
 * right. The dock is drag-resizable, collapsible to a rail and expandable
 * over the chart; its width persists. BELOW LG the three panes (book / chart
 * / AI dock) flatten into an explicit Chart | AI | Book mode switcher — one
 * full-height pane at a time, choice persisted per user. Push-first: one
 * websocket bundle per symbol drives strip + book + candles; REST polling
 * takes over the moment the socket drops (and the chart's own stall watchdog
 * re-syncs a quiet
 * stream), so prices on the chart are realtime or visibly healing.
 * A Chart AI levels card can also push its key levels onto the canvas
 * (chatLevels — transient, coin-stamped, blanked on instrument switch).
 * Presentation only — no order execution.
 */

import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { GripVertical, PanelRight, TrendingDown, TrendingUp } from 'lucide-react';
import { ProviderConfig } from '../../types/provider';
import { TradeAnalysis, LoggedTrade, Message } from '../../types';
import { fetchMarkIndex, fetchFuturesTicker24h, fetchDerivativesData, fetchAllFuturesSymbols, type SymbolMeta } from '../../services/analysis/MarketDataService';
import { verdictLevels } from '../../services/trade/chartData';
import type { ChartDrawing } from '../../services/trade/chartDrawings';
import { loadSessionModelDrawings, saveSessionModelDrawings } from '../../services/trade/chartDrawings';
import type { TradeProposal } from '../../services/trade/proposedTrade';
import { baseOf } from '../../utils/symbol';
import { getActiveUsername } from '../../utils/activeUser';
import { fmtPrice } from '../../utils/formatters';
import * as levelWatch from '../../services/trade/levelWatchService';
import { formatLevelHitForModel, type WatchPlan } from '../../services/trade/tradePlanLevels';
import * as watchService from '../../services/trade/watchService';
import { formatWatchFiredForModel } from '../../services/trade/chartTriggers';
import { notify, ensureNotifyPermission } from '../../services/infrastructure/notify';
import * as chatStore from '../../services/trade/chatStore';
import { useFuturesLiveFeed } from '../../hooks/useFuturesLiveFeed';
import { useSurfaceEnter, type SurfaceEnterDirection } from '../../hooks/useSurfaceEnter';
import TradingChart, { toKlineInterval, chartColor, type ChartInterval, type ChartHandle } from './TradingChart';
import type { MessageLevelLines } from '../../services/trade/keyLevels';
import { fetchKlines } from '../../services/analysis/KlineService';
import OrderBookPanel from './OrderBookPanel';
import TradeChatPanel from './TradeChatPanel';
import type { PanelTurnContext } from './TradeChatPanel';
import SymbolPicker from './SymbolPicker';
import ScreenerPanel from './ScreenerPanel';
import StatusPill from '../ui/StatusPill';
import type { AgentBot } from '../../services/agents/agentRoster';

const FALLBACK_SYMBOLS: SymbolMeta[] = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'DOGEUSDT', 'XRPUSDT', 'BNBUSDT', 'ADAUSDT', 'AVAXUSDT']
    .map(symbol => ({ symbol, baseAsset: baseOf(symbol), lastPrice: 0, changePercent24h: 0, quoteVolume: 0 }));

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
    /** Same for group rooms (dock session kinds). */
    groupSessionRequest?: { groupId: string; nonce: number };
    /** Run the FULL ensemble analysis from the Chart AI composer; resolves
     *  with the verdict summary text to show back in the chat — optionally
     *  alongside the created analysis message id (lets the dock stamp the
     *  answer entry for the gallery's Locate scroll). */
    onRunAnalysis?: (prompt: string, images: Array<{ name: string; dataURL: string }>) =>
        Promise<string | { text: string; messageId?: string }>;
    /** Resolve the analysis message `onRunAnalysis` created, so the dock can
     *  show what its settled verdict was built on. Threaded straight through to
     *  `TradeChatPanel` — the chart surface owns no verdict rendering itself.
     *  Forwarded rather than copied: the dock keeps a message id, not a stored
     *  duplicate of the analysis. */
    getAnalysisMessage?: (messageId: string) => Message | undefined;
    /** "Log this trade" on a Chart AI proposal → record an OPEN trade. */
    onLogProposedTrade?: (proposal: TradeProposal) => void;
    /** Group rooms the Chart AI dock embeds as a session. The Coach inbox used
     *  to be handed through here for the dock's Chat | Coach switch; it is a
     *  tab on the Learn surface now. */
    renderGroupSurface?: (groupId: string) => React.ReactNode;
    /** Group rooms offered in the dock's New-session menu (name for tabs). */
    groups?: Array<{ id: string; name: string }>;
    /** Imperative scroll-to-entry bridge forwarded to the Chart AI dock:
     *  App's "Jump to latest analysis" + gallery Locate route their scroll
     *  through the function the dock registers (null on unmount). */
    registerScrollToMessage?: (fn: ((messageId: string) => void) | null) => void;
    /** Triggers a fresh discovery of models from configured providers. */
    onRefreshModels?: () => Promise<void>;
    /** The left sidebar (the order book), open/closed. Below lg the same
     *  toggle flips the surface mode instead, since there is no sidebar. */
    sidebarOpen?: boolean;
    /** Opens/closes that book. The activity bar used to own this on its active
     *  Trade icon; with the surfaces moved into the hamburger menu the control
     *  lives in this surface's own market row. */
    onToggleSidebar?: () => void;
    /** A request to flip this surface's mode (nonce-keyed so a repeat request
     *  applies). Consumed only <lg, where the book is a mode, not a column. */
    modeRequest?: { mode: TradeMode; n: number };
    /** Active profile — the persisted mobile mode is per-user, so a profile
     *  switch re-reads it instead of keeping the previous user's choice. */
    activeUsername?: string;
    /** Reports every mode change upward so App's toggle semantics (which
     *  mode is currently active) stay in sync with the user's own picks. */
    onTradeModeChange?: (mode: TradeMode) => void;
    /** Jump straight to the Chat surface from the dock header. */
    onOpenChat?: () => void;
    /** Which edge this surface arrived from, for the Chat ⇄ Chart AI hop.
     *  Consumed by useSurfaceEnter; see hooks/useSurfaceEnter.ts. */
    surfaceEnterFrom?: SurfaceEnterDirection;
    /** Toggles the 2D debate desk floor projection modal. */
    onToggleDeskScene?: () => void;
    isDeskSceneOpen?: boolean;
    hasDeskSceneMessage?: boolean;
    /** Pin/unpin a verdict to the Pinned list (App owns the watched flag). */
    onToggleWatch?: (messageId: string) => void;
    pinnedMessageIds?: ReadonlySet<string>;
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
// fmtPrice now comes from utils/formatters (audit 2026-09-16 dedupe — the
// hero/strip/ladder copy pair was byte-identical).

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
    <div className="flex min-w-0 flex-col px-3.5 first:pl-3">
        <span className="text-ui-2xs uppercase tracking-wider text-zinc-500">{label}</span>
        <span className="truncate font-mono text-ui-sm font-medium tabular-nums text-zinc-200">{value}</span>
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

/** Funding settles on an 8 h cadence; the strip's progress bar shows how far
 *  INTO the current window we are (fills as the next funding approaches). When
 *  under 30 minutes remain the bar goes amber and pulses — the "it's basically
 *  now" cue from the prototype. Approximate prev (next − 8 h) since Binance
 *  only exposes the NEXT time; good enough for a depleting meter. */
const FUNDING_WINDOW_MS = 8 * 3_600_000;
const fundingProgress = (nextFundingTime: number, nowMs: number): { frac: number; soon: boolean } => {
    const left = nextFundingTime - nowMs;
    if (!Number.isFinite(left) || left <= 0) return { frac: 1, soon: false };
    const frac = Math.min(1, Math.max(0, 1 - left / FUNDING_WINDOW_MS));
    return { frac, soon: left <= 30 * 60_000 };
};

/** Live (<lg) viewport flag — below the lg breakpoint the desk switches to
 *  the mobile 3-mode layout (Chart | AI | Book); at lg+ the original three-
 *  column arrangement renders untouched. Guarded for jsdom (no matchMedia →
 *  assume wide). */
const useIsBelowLg = (): boolean => {
    const [below, setBelow] = useState<boolean>(() => {
        try { return !window.matchMedia('(min-width: 1024px)').matches; } catch { return false; }
    });
    useEffect(() => {
        let mql: MediaQueryList;
        try { mql = window.matchMedia('(min-width: 1024px)'); } catch { return; }
        const onChange = (): void => setBelow(!mql.matches);
        onChange();
        mql.addEventListener('change', onChange);
        return () => { mql.removeEventListener('change', onChange); };
    }, []);
    return below;
};

/** Mobile trade surface mode (audit 2026-09-16, crosscheck §9.6 "Chart/AI/
 *  Book modes"): below lg the stacked chart + AI dock + book get flattened
 *  into ONE full-height pane chosen by a segmented control under the header.
 *  Last choice persists per user, same pattern as the timeframe bar. All
 *  three panes STAY MOUNTED in every mode (inactive ones are hidden, not
 *  unmounted) so the e2e/unit testid contract (trade-sidebar, trade-dock,
 *  trading-chart, trade-chat-panel presence) never changes with the mode. */
export type TradeMode = 'chart' | 'ai' | 'book';
const TRADE_MODES: readonly TradeMode[] = ['chart', 'ai', 'book'];
const TRADE_MODE_KEY = 'august_trade_mode_v1';
const tradeModeKey = (): string => `${TRADE_MODE_KEY}_${getActiveUsername()}`;
const readTradeMode = (): TradeMode => {
    try {
        const m = localStorage.getItem(tradeModeKey());
        return TRADE_MODES.includes(m as TradeMode) ? (m as TradeMode) : 'chart';
    } catch { return 'chart'; }
};
const writeTradeMode = (m: TradeMode): void => {
    try { localStorage.setItem(tradeModeKey(), m); } catch { /* private mode */ }
};

/** Prototype hero-row sparkline: the last ~48 closes of the chart's OWN
 *  timeframe, from one small fetch (KlineService's 30 s cache covers a coin
 *  round-trip). Null while loading/failed — the row never shows a fake line.
 *  The area under the curve carries a fading gradient and the newest close
 *  gets a dot, so the line reads as "where price is NOW" instead of a
 *  decoration; hovering it reports the window's real range. */
const SPARK_W = 120;
const SPARK_H = 30;
const Sparkline: React.FC<{ symbol: string; interval: ChartInterval }> = ({ symbol, interval }) => {
    const [closes, setCloses] = useState<number[] | null>(null);
    // useId gives `:r3:`-style ids; colons are legal in an SVG IRI but this
    // strips them so the reference stays unambiguous everywhere.
    const gradientId = `hero-spark-fill-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
    useEffect(() => {
        let cancelled = false;
        setCloses(null);
        void fetchKlines(symbol, toKlineInterval(interval), 60)
            .then(kl => { if (!cancelled) setCloses(kl.slice(-48).map(k => k.close)); })
            .catch(() => { /* no spark is fine — the number carries the read */ });
        return () => { cancelled = true; };
    }, [symbol, interval]);
    if (!closes || closes.length < 3) return null;
    const min = Math.min(...closes);
    const max = Math.max(...closes);
    const span = max - min || 1;
    const up = closes[closes.length - 1] >= closes[0];
    const stroke = up
        ? chartColor('--color-emerald-500', '#07b56a')
        : chartColor('--color-rose-500', '#f75d5f');
    const xAt = (i: number): number => (i / (closes.length - 1)) * (SPARK_W - 3) + 1;
    const yAt = (c: number): number => (SPARK_H - 2) - ((c - min) / span) * (SPARK_H - 6);
    const pts = closes.map((c, i) => `${xAt(i).toFixed(1)},${yAt(c).toFixed(1)}`).join(' ');
    const lastX = xAt(closes.length - 1);
    const lastY = yAt(closes[closes.length - 1]);
    return (
        <span className="tip tip-below hidden shrink-0 sm:block">
            <svg width={SPARK_W} height={SPARK_H} aria-hidden="true" data-testid="hero-spark">
                <defs>
                    <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={stroke} stopOpacity="0.26" />
                        <stop offset="100%" stopColor={stroke} stopOpacity="0" />
                    </linearGradient>
                </defs>
                <polygon fill={`url(#${gradientId})`} points={`1,${SPARK_H} ${pts} ${(SPARK_W - 2).toFixed(1)},${SPARK_H}`} />
                <polyline fill="none" stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" points={pts} />
                <circle cx={lastX.toFixed(1)} cy={lastY.toFixed(1)} r="1.9" fill={stroke} />
            </svg>
            <span className="tip-label">
                {fmtPrice(min)} – {fmtPrice(max)}
                <span className="text-zinc-500">· {closes.length} × {interval}</span>
            </span>
        </span>
    );
};

/** Smallest move (basis points from the last FLASHED print) that earns a
 *  flash, and the minimum gap between two. */
export const TICK_FLASH_MIN_BPS = 2;
export const TICK_FLASH_COOLDOWN_MS = 900;

/** Hero-price tick flash: a print that moved at least TICK_FLASH_MIN_BPS from
 *  the last one flashes emerald or rose. The mark streams at markPrice@1s, so
 *  without a threshold every sub-tick blip re-keyed the node — a strobe for the
 *  eye and a remount per second for the reconciler.
 *
 *  The baseline is the last price that FLASHED, not the last price seen, so a
 *  slow one-directional grind still registers instead of averaging itself into
 *  invisibility. `seq` bumps per flash so the caller can key the element —
 *  re-applying an already-running animation class does nothing. */
export const useTickFlash = (price: number | undefined): { cls: string; seq: number } => {
    const prevRef = useRef<number | undefined>(undefined);
    const lastAtRef = useRef(0);
    const [flash, setFlash] = useState<{ cls: string; seq: number }>({ cls: '', seq: 0 });
    useEffect(() => {
        if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return;
        const prev = prevRef.current;
        if (prev === undefined) {
            prevRef.current = price;
            return;
        }
        const deltaBps = (Math.abs(price - prev) / prev) * 10_000;
        const now = Date.now();
        if (deltaBps < TICK_FLASH_MIN_BPS || now - lastAtRef.current < TICK_FLASH_COOLDOWN_MS) return;
        prevRef.current = price;
        lastAtRef.current = now;
        setFlash(f => ({ cls: price > prev ? 'tick-up' : 'tick-down', seq: f.seq + 1 }));
    }, [price]);
    return flash;
};


const TradeView: React.FC<TradeViewProps> = ({ providers, selectedChatModel, onSelectChatModel, onRefreshModels, verdict, bots = [], trades = [], botSessionRequest, groupSessionRequest, onRunAnalysis, getAnalysisMessage, onLogProposedTrade, renderGroupSurface, groups = [], registerScrollToMessage, sidebarOpen = true, onToggleSidebar, modeRequest, activeUsername, onTradeModeChange, surfaceEnterFrom, onOpenChat, onToggleDeskScene, isDeskSceneOpen, hasDeskSceneMessage, onToggleWatch, pinnedMessageIds }) => {
    const [symbol, setSymbol] = useState('BTCUSDT');
    const [interval, setInterval_] = useState<ChartInterval>('15m');
    // Applies `.surface-enter-left` / `.surface-enter-right` to the surface
    // root for one cycle. The hook owns nothing else — App keeps the flag so
    // re-navigating animates again.
    const surfaceEnterClass = useSurfaceEnter(surfaceEnterFrom);
    const [strip, setStrip] = useState<StripData | null>(null);
    const [nowMs, setNowMs] = useState(() => Date.now());
    const [symbols, setSymbols] = useState<SymbolMeta[]>(FALLBACK_SYMBOLS);
    const [chartDrawings, setChartDrawings] = useState<ChartDrawing[]>([]);
    /** Shapes the MODEL drew via desk tools — rendered on the chart, never
     *  persisted into the user's drawing file, cleared on symbol change. */
    const [modelDrawings, setModelDrawings] = useState<ChartDrawing[]>([]);
    /** The `<sid>:<symbol>` bucket modelDrawings CURRENTLY holds. A turn may
     *  only merge into React state when its bucket matches this stamp — a
     *  stream-chunk tool call landing between a session-switch store emit
     *  and the re-render would otherwise merge the new session's drawings
     *  into the OLD bucket's state and persist that composite under the new
     *  key (audit R6 #12). Off-stamp turns go through load-merge-save. */
    const loadedBucketRef = useRef('');
    const chartHandleRef = useRef<ChartHandle | null>(null);
    const [dockWidth, setDockWidth] = useState<number>(readDockWidth);
    const [dockCollapsed, setDockCollapsed] = useState(false);
    const [dockExpanded, setDockExpanded] = useState(false);
    const [screenerOpen, setScreenerOpen] = useState(false);
    // Mobile 3-mode surface (<lg): the stacked panes collapse into one, and
    // the old `hidden md:block` sidebar + the below-md book overlay drawer the
    // md toggle used to summon are replaced by an explicit Chart | AI | Book
    // segmented control (the NavRail book toggle stays a lg+ control).
    const isBelowLg = useIsBelowLg();
    const [mode, setMode] = useState<TradeMode>(readTradeMode);
    const pickMode = useCallback((m: TradeMode): void => {
        setMode(m);
        writeTradeMode(m);
        onTradeModeChange?.(m);
    }, [onTradeModeChange]);
    // Segmented-control thumb: the pill is ONE surface that slides between
    // tabs, so the active read is motion rather than three backgrounds
    // swapping color. Measured from real geometry (labels differ in width) and
    // re-measured on resize; width stays 0 until measured, which simply hides
    // the thumb — the active label's color already carries the state.
    const switcherRef = useRef<HTMLDivElement>(null);
    const modeTabRefs = useRef<Partial<Record<TradeMode, HTMLButtonElement | null>>>({});
    const [thumb, setThumb] = useState<{ left: number; width: number }>({ left: 0, width: 0 });
    useLayoutEffect(() => {
        if (!isBelowLg) return;
        const measure = (): void => {
            const tab = modeTabRefs.current[mode];
            const box = switcherRef.current;
            if (!tab || !box) return;
            const a = tab.getBoundingClientRect();
            const b = box.getBoundingClientRect();
            // `left` on an absolutely-positioned child measures from the
            // PADDING box, but getBoundingClientRect reports the BORDER box —
            // without subtracting clientLeft the thumb sits 1px right.
            setThumb({ left: a.left - b.left - box.clientLeft, width: a.width });
        };
        measure();
        window.addEventListener('resize', measure);
        return () => window.removeEventListener('resize', measure);
    }, [mode, isBelowLg]);
    // App's activity-bar toggle below lg: apply each new nonce exactly once.
    const lastModeReqNRef = useRef<number | undefined>(undefined);
    useEffect(() => {
        if (!modeRequest) { lastModeReqNRef.current = undefined; return; }
        if (lastModeReqNRef.current === modeRequest.n) return;
        lastModeReqNRef.current = modeRequest.n;
        pickMode(modeRequest.mode);
    }, [modeRequest, pickMode]);
    // Profile switch: the persisted mode is per-user — re-read it so B gets
    // B's layout instead of inheriting A's until a reload (audit R6 #23).
    const prevModeUserRef = useRef<string | undefined>(activeUsername);
    useEffect(() => {
        if (prevModeUserRef.current === activeUsername) return;
        prevModeUserRef.current = activeUsername;
        setMode(readTradeMode());
    }, [activeUsername]);
    /** Key-level lines a Chat AI message card is currently SHOWING on the
     *  chart (toggle / pin / hover resolved by the dock). Transient view state
     *  — never persisted, stamped with its symbol so a coin switch blanks it. */
    const [chatLevels, setChatLevels] = useState<MessageLevelLines | null>(null);
    const handleChatLevels = useCallback((lines: MessageLevelLines | null): void => {
        setChatLevels(prev => {
            if (!lines || !prev) return lines;
            // Keep the old object only when the push is content-identical (a
            // hover tick) — a different symbol or different lines always land.
            if (lines.symbol === prev.symbol && JSON.stringify(lines.lines) === JSON.stringify(prev.lines)) return prev;
            return lines;
        });
    }, []);
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

    // Dynamic universe: EVERY tradable USDT perpetual (exchangeInfo ∩ 24hr
    // tickers, ~300+ symbols), one public call, 60s refresh; the static
    // fallback keeps the picker usable offline.
    useEffect(() => {
        let cancelled = false;
        const load = async (): Promise<void> => {
            const all = await fetchAllFuturesSymbols();
            if (!cancelled && all.length > 0) setSymbols(all);
        };
        void load();
        const poll = window.setInterval(() => void load(), 60_000);
        return () => { cancelled = true; window.clearInterval(poll); };
    }, []);

    // SYMBOL SWITCH: the strip must never print the previous coin's numbers.
    // Null it immediately, then one-shot fetch the NEW coin even while the
    // websocket is live — the socket re-subscribes within ~1s, but without
    // this the strip would show stale BTC prices on a ZEN chart (the data
    // discrepancy the model flagged) for as long as the socket stays up.
    useEffect(() => {
        setStrip(null);
        // Same doctrine for a chart card's level lines: the new coin starts
        // with the new coin's canvas — no leftover BTC tags floating on ZEN.
        setChatLevels(null);
        let cancelled = false;
        const load = async (): Promise<void> => {
            try {
                // Futures-native ticker: the strip's 24h change/volume used
                // to come from the SPOT ticker (fetchMarketData) while the
                // mark, oracle, funding and OI beside them are all perp-side
                // — the cross-market-mixing class. fetchFuturesTicker24h is
                // the perp counterpart; the live socket's <s>@ticker stream
                // already overrides this one-shot while connected.
                const [mi, market, deriv] = await Promise.all([
                    fetchMarkIndex(symbol),
                    fetchFuturesTicker24h(symbol),
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
            } catch { /* the socket or the poll will fill it */ }
        };
        void load();
        return () => { cancelled = true; };
    }, [symbol]);

    // Fallback strip (only while the socket is down): 15s refresh.
    useEffect(() => {
        if (live) return;
        let cancelled = false;
        const load = async (): Promise<void> => {
            try {
                const [mi, market, deriv] = await Promise.all([
                    fetchMarkIndex(symbol),
                    fetchFuturesTicker24h(symbol),
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
    // the rest of the strip is live. OI has no push stream, so it needs its
    // OWN slow poll (the comment always claimed this; the interval did not
    // exist — it only fetched once per [symbol, live] change, leaving OI
    // hours-stale while live).
    useEffect(() => {
        let cancelled = false;
        const load = async (): Promise<void> => {
            try {
                const d = await fetchDerivativesData(symbol);
                if (!cancelled) setStrip(prev => (prev ? { ...prev, oiValue: d.openInterestValue ?? prev.oiValue } : prev));
            } catch { /* keep last */ }
        };
        void load();
        const poll = window.setInterval(() => void load(), 15_000);
        return () => { cancelled = true; window.clearInterval(poll); };
    }, [symbol, live]);

    // A model drawing belongs to the symbol it was drawn on — switching
    // instruments wipes the canvas and drops the PREVIOUS symbol's level
    // watches (a remount of the same symbol keeps its plans alive — the
    // watch lives in the module singleton, and fired latches persist).
    const prevSymbolRef = useRef(symbol);
    useEffect(() => {
        if (prevSymbolRef.current !== symbol) levelWatch.disarmSymbol(prevSymbolRef.current);
        prevSymbolRef.current = symbol;
        // Reload THIS coin's model-drawn shapes (persisted per session+coin),
        // so the model's lines survive a coin switch — instead of the old
        // blanket wipe that made "what the AI drew" vanish on the next coin.
        loadedBucketRef.current = `${chatSnap.activeId}:${symbol}`;
        setModelDrawings(loadSessionModelDrawings(chatSnap.activeId, symbol));
    }, [symbol, chatSnap.activeId]);

    // Persist the model's shapes under the CURRENT coin+session whenever they
    // change (adds, erases, clear). Keyed on modelDrawings ONLY — not symbol —
    // so a coin switch (which loads a different list) never writes the
    // previous coin's shapes under the new coin's key.
    useEffect(() => {
        const sid = chatStore.getActiveId();
        if (sid) saveSessionModelDrawings(sid, symbolRef.current, modelDrawings);
    }, [modelDrawings]);

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
    const handlePlanPresented = useCallback((plan: WatchPlan, turn?: PanelTurnContext): void => {
        // A level watch is exactly "alert me when price gets there" — request
        // the OS notification permission NOW so the grant exists when the
        // level hits later (same treatment as the watch_price/wake_me tools).
        void ensureNotifyPermission();
        // The viewed mark is only authoritative for the viewed coin; a
        // background turn's plan gets a null anchor (plain first-tick touch
        // test) rather than another coin's price.
        const at = plan.symbol === symbolRef.current ? markPriceRef.current : undefined;
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
    const tickFlash = useTickFlash(markPrice);

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
     *  draw_on_chart / mark_trade_levels / clear_chart_drawings calls.
     *  A turn's drawings belong to the session+coin that turn RAN on, not
     *  whatever the user happens to be watching now (deep-dive chat/desk
     *  identity leak): when the turn is off-view, write straight into that
     *  session's bucket and leave the visible canvas untouched. */
    const isViewTurn = (turn?: PanelTurnContext): boolean =>
        !turn || (turn.sid === chatStore.getActiveId() && turn.symbol === symbolRef.current
            && loadedBucketRef.current === `${turn.sid}:${turn.symbol}`);
    const addModelDrawings = useCallback((drawings: ChartDrawing[], turn?: PanelTurnContext): void => {
        if (isViewTurn(turn)) {
            setModelDrawings(prev => [...prev, ...drawings].slice(-60));
            return;
        }
        const t = turn as PanelTurnContext;
        const merged = [...loadSessionModelDrawings(t.sid, t.symbol), ...drawings].slice(-60);
        saveSessionModelDrawings(t.sid, t.symbol, merged);
    }, []);
    const clearModelDrawings = useCallback((turn?: PanelTurnContext): void => {
        if (isViewTurn(turn)) {
            setModelDrawings([]);
            return;
        }
        const t = turn as PanelTurnContext;
        saveSessionModelDrawings(t.sid, t.symbol, []);
    }, []);
    // Erasing one of the model's shapes (the chart's eraser routes it here);
    // the persist effect re-saves the coin's model bucket minus this shape.
    const removeModelShape = useCallback((id: string): void => {
        setModelDrawings(prev => prev.filter(d => d.id !== id));
    }, []);
    const clearAllDrawings = useCallback((turn?: PanelTurnContext): void => {
        if (isViewTurn(turn)) {
            setModelDrawings([]);
            chartHandleRef.current?.clearUserDrawings();
            return;
        }
        // Off-view 'all': only the model bucket is ours to clear — the user's
        // own strokes belong to the canvas the user is looking at.
        const t = turn as PanelTurnContext;
        saveSessionModelDrawings(t.sid, t.symbol, []);
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
        onRunAnalysis,
        getAnalysisMessage,
        onLogProposedTrade,
        onPlanPresented: handlePlanPresented,
        onChatLevelsChange: handleChatLevels,
        renderGroupSurface,
        groups,
        onToggleDeskScene,
        isDeskSceneOpen,
        hasDeskSceneMessage,
        onToggleWatch,
        pinnedMessageIds,
        onRefreshModels,
        registerScrollToMessage,
    };

    return (
        <div className={`flex h-full min-h-0 flex-col bg-zinc-950 ${surfaceEnterClass}`} data-testid="trade-view">
            {/* ROW 1 · identity + hero (prototype's market row): instrument,
                spark, screener, feed state on the left; the big live price
                with its 24h delta + MARK caption on the right. */}
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/[0.06] bg-zinc-900/60 px-3 pb-1.5 pt-2">
                <div className="flex min-w-0 items-center gap-2.5">
                    {/* The book column's own open/close control. It used to be
                        the activity bar's active Trade icon; that icon now
                        opens the surface menu, so the toggle moved to the row
                        beside the panel it controls. */}
                    {onToggleSidebar && (
                        <button
                            type="button"
                            onClick={onToggleSidebar}
                            aria-pressed={isBelowLg ? mode === 'book' : sidebarOpen}
                            aria-label="Toggle order book"
                            title={isBelowLg ? 'Show the order book' : 'Show or hide the order book'}
                            data-testid="trade-book-toggle"
                            className={`hidden shrink-0 rounded-control border p-1.5 transition-colors duration-[120ms] ease-[var(--ease-snappy)] sm:flex ${
                                (isBelowLg ? mode === 'book' : sidebarOpen)
                                    ? 'border-white/20 bg-zinc-800 text-zinc-100'
                                    : 'border-white/10 bg-zinc-800/60 text-zinc-400 hover:border-white/20 hover:text-zinc-100'
                            }`}
                        >
                            <PanelRight className="h-3.5 w-3.5" />
                        </button>
                    )}
                    <SymbolPicker symbols={symbols} value={symbol} onChange={changeSymbol} />
                    <Sparkline symbol={symbol} interval={interval} />
                    <button
                        type="button"
                        onClick={() => setScreenerOpen(true)}
                        aria-label="Open market screener"
                        data-testid="screener-trigger"
                        className="shrink-0 rounded-control border border-white/10 bg-zinc-800 px-2 py-1 text-ui-dense font-semibold text-zinc-300 transition-colors hover:border-white/20 hover:text-zinc-100"
                    >
                        Screener
                    </button>
                    <StatusPill
                        data-testid="feed-status"
                        kicker
                        title={feed.status === 'live' ? 'Websocket push (markPrice@1s · depth20@100ms · ticker · kline)' : feed.status === 'connecting' ? 'Opening websockets…' : 'Websocket down — REST polling every 5s'}
                        tone={feed.status === 'live' ? 'up' : feed.status === 'connecting' ? 'neutral' : 'warn'}
                        icon={<span aria-hidden="true" className={`beacon ${feed.status === 'live' ? '' : 'is-quiet'}`.trim()} />}
                    >
                        {feed.status === 'live' ? 'live' : feed.status === 'connecting' ? 'connecting' : 'polling'}
                    </StatusPill>
                </div>
                <div className="shrink-0 text-right leading-none">
                    <div
                        key={tickFlash.seq}
                        data-testid="hero-price"
                        className={`-mx-1 rounded px-1 font-mono text-[22px] font-semibold tabular-nums ${changeTone} ${tickFlash.cls}`.trim()}
                    >
                        {Number.isFinite(markPrice) ? fmtPrice(markPrice!) : '—'}
                    </div>
                    <div className="mt-1 flex items-center justify-end gap-1 text-ui-xs text-zinc-500">
                        {Number.isFinite(changePct) && (
                            <span className={`inline-flex items-center gap-0.5 font-medium ${changeTone}`}>
                                {changePct! >= 0
                                    ? <TrendingUp className="h-3 w-3" aria-hidden="true" />
                                    : <TrendingDown className="h-3 w-3" aria-hidden="true" />}
                                {changePct! >= 0 ? '+' : ''}{changePct!.toFixed(2)}%
                            </span>
                        )}
                        <span>24h · MARK</span>
                    </div>
                </div>
            </div>

            {/* ROW 2 · metrics strip — the quiet numbers a perp desk checks
                without leaving the chart; Funding carries its own countdown +
                depleting-window bar (amber + pulse inside 30 min). */}
            <div className="flex shrink-0 items-center divide-x divide-white/[0.06] overflow-x-auto border-b border-white/[0.06] bg-zinc-900/40 py-1.5 pr-3">
                <Stat label="Mark" value={Number.isFinite(markPrice) ? fmtPrice(markPrice!) : '—'} />
                <Stat label="Oracle" value={Number.isFinite(indexPrice) ? fmtPrice(indexPrice!) : '—'} />
                <Stat label="24h Change" value={Number.isFinite(changePct) ? `${changePct! >= 0 ? '+' : ''}${changePct!.toFixed(2)}%` : '—'} />
                <Stat label="24h Volume" value={Number.isFinite(quoteVolume) ? fmtUsd(quoteVolume!) : '—'} />
                <Stat label="Open Interest" value={strip ? fmtUsd(strip.oiValue) : '—'} />
                <div className="flex w-[210px] shrink-0 flex-col px-3.5">
                    <span className="text-ui-2xs uppercase tracking-wider text-zinc-500">Funding · next in</span>
                    {Number.isFinite(fundingRate) ? (() => {
                        const { frac, soon } = fundingProgress(nextFundingTime ?? 0, nowMs);
                        return (
                            <>
                                <span className="flex items-baseline justify-between">
                                    <span className={`font-mono text-ui-sm font-medium tabular-nums ${fundingRate! >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                        {(fundingRate! * 100).toFixed(4)}%
                                    </span>
                                    <span className="font-mono text-ui-dense tabular-nums text-zinc-400">{fundingCountdown(nextFundingTime ?? 0, nowMs)}</span>
                                </span>
                                <span className="mt-1 block h-[3px] overflow-hidden rounded-full bg-zinc-800" aria-hidden="true" data-testid="funding-bar">
                                    {/* duration-300 is deliberate: the bar's width is a data value
                                        (funding countdown), not chrome. ui-doctrine motion exception. */}
                                    <span className={`block h-full rounded-full transition-[width,background-color] duration-300 ease-[var(--ease-snappy)] ${soon ? 'animate-pulse bg-amber-400 shadow-[0_0_6px_rgba(240,136,0,0.5)]' : 'bg-cyan-400/80'}`} style={{ width: `${Math.round(frac * 100)}%` }} />
                                </span>
                            </>
                        );
                    })() : <span className="font-mono text-ui-sm text-zinc-200">—</span>}
                </div>
            </div>

            {/* MOBILE MODE SWITCHER (<lg): Chart | AI | Book, pinned under the
                header; each mode shows exactly ONE full-height pane. Default
                Chart; the choice persists per user. At lg+ this row is not
                rendered at all. */}
            {isBelowLg && (
                <div
                    ref={switcherRef}
                    role="tablist"
                    aria-label="Trade surface mode"
                    data-testid="trade-mode-switcher"
                    className="relative flex shrink-0 items-center self-start rounded-full border border-white/[0.06] bg-zinc-800/60 p-1 ml-3 mb-1"
                >
                    {thumb.width > 0 && (
                        <span
                            aria-hidden="true"
                            className="seg-thumb"
                            style={{ left: thumb.left, width: thumb.width }}
                        />
                    )}
                    {TRADE_MODES.map(m => (
                        <button
                            key={m}
                            ref={el => { modeTabRefs.current[m] = el; }}
                            type="button"
                            role="tab"
                            aria-selected={mode === m}
                            data-testid={`trade-mode-${m}`}
                            onClick={() => pickMode(m)}
                            className={`relative z-10 rounded-full px-4 py-1 text-ui-dense font-semibold uppercase tracking-wider transition-colors duration-150 ease-[var(--ease-snappy)] active:scale-[0.97] ${
                                mode === m ? 'text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
                            }`}
                        >
                            {m === 'chart' ? 'Chart' : m === 'ai' ? 'AI' : 'Book'}
                        </button>
                    ))}
                </div>
            )}
            {/* Chart + book + AI chat (drag-resizable dock). BELOW lg exactly
                one pane shows (the mode switcher above); every pane stays
                MOUNTED-HIDDEN, and the container is overflow-hidden so the
                active pane fills the height. At lg+ the original stacked-
                scroll-then-row layout owns the height, untouched. */}
            <div className={isBelowLg
                ? 'flex min-h-0 flex-1 flex-col overflow-hidden'
                : 'flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-visible'}>
                {/* Left sidebar (Antigravity's Explorer position): the order
                    book, open/closed from the activity bar's active Trade
                    icon. Closed = the chart owns the whole middle. BELOW lg
                    it belongs to the Book mode instead: always mounted,
                    hidden unless the Book tab is active (sidebarOpen doesn't
                    gate it there — the mode switcher owns phone/tablet). */}
                <div
                    data-testid="trade-chart-pane"
                    className={isBelowLg
                        ? (mode === 'chart' ? 'min-h-0 flex-1' : 'hidden')
                        : `min-h-[420px] flex-1 lg:min-h-0 lg:min-w-0 ${dockExpanded ? 'lg:w-1/3 lg:flex-none' : ''}`}
                >
                    <TradingChart symbol={symbol} interval={interval} onIntervalChange={changeInterval} sessionId={chatSnap.activeId} verdict={verdict} live={live} liveKline={feed.kline}
                        lastPrice={Number.isFinite(lastPrice) ? lastPrice : null}
                        markPrice={Number.isFinite(markPrice) ? markPrice : null}
                        chatLevels={chatLevels}
                        chartHandle={chartHandleRef}
                        onDrawingsChange={setChartDrawings}
                        modelDrawings={modelDrawings}
                        onRemoveModelShape={removeModelShape} />
                </div>
                {/* The order book sits BETWEEN the chart and the AI dock, not
                    to the chart's left. The chart is the primary object on this
                    surface and the book is a column you read after it; that is
                    also the order Binance, Bybit and Minara all use. Below lg
                    the three panes stack with two `hidden`, so DOM order only
                    matters at lg+ — where the book is now a right-hand column.
                    `trade-sidebar` is a legacy testid name; renaming it is
                    cosmetic churn against two test files and buys nothing, so
                    it stays. */}
                {(sidebarOpen || isBelowLg) && (
                    <div
                        data-testid="trade-sidebar"
                        className={isBelowLg
                            ? (mode === 'book' ? 'min-h-0 w-full flex-1' : 'hidden')
                            : 'hidden w-[300px] shrink-0 md:block'}
                    >
                        <OrderBookPanel symbol={symbol} live={feed.depthLive} liveDepth={feed.depth} />
                    </div>
                )}
                {/* The dock belongs to the AI mode below lg (always mounted
                    there — the desktop collapse toggle is a lg+ affordance
                    and must never blank the chat pane on phones). */}
                {(!dockCollapsed || isBelowLg) && (
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
                            className={isBelowLg
                                ? (mode === 'ai' ? 'min-h-0 w-full flex-1' : 'hidden')
                                : `h-96 w-full shrink-0 lg:h-auto lg:w-[var(--dock-w)] lg:min-w-[300px] ${dockExpanded ? 'lg:!w-2/3 xl:!w-3/4' : ''}`}
                        >
                            <TradeChatPanel
                                {...dockProps}
                                collapsed={false}
                                onToggleCollapsed={isBelowLg ? undefined : () => { setDockCollapsed(true); setDockExpanded(false); }}
                                expanded={dockExpanded}
                                onToggleExpanded={() => setDockExpanded(v => !v)}
                                onOpenChat={onOpenChat}
                            />
                        </div>
                    </>
                )}
                {dockCollapsed && !isBelowLg && (
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
            {/* The pre-2026-09-16 below-md book overlay drawer lived here;
                the Book mode of the mobile switcher replaced it (same
                OrderBookPanel, no backdrop, no `orderbook-drawer` testid —
                grep of e2e/ + tests/ found zero references). */}
            <ScreenerPanel open={screenerOpen} onClose={() => setScreenerOpen(false)} onChangeSymbol={changeSymbol} trades={trades} />
        </div>
    );
};

export default TradeView;
