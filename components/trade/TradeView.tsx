/**
 * TradeView — August's take on Minara's /app/trade/perps/BTC screen, dark:
 * a stats strip (Mark / Oracle / 24h / Volume / OI / Funding + countdown)
 * over a full-height TradingView chart, with the order-book ladder and the
 * live-context Chart AI chat docked to the right. Presentation over the
 * existing Binance services — no order execution (there is none to hang).
 */

import React, { useEffect, useMemo, useState } from 'react';
import { ProviderConfig } from '../../types/provider';
import { TradeAnalysis } from '../../types';
import { fetchMarkIndex, fetchMarketData, fetchDerivativesData, fetchTopFuturesSymbols, type SymbolTicker } from '../../services/analysis/MarketDataService';
import TradingChart, { CHART_INTERVALS, type ChartInterval } from './TradingChart';
import OrderBookPanel from './OrderBookPanel';
import TradeChatPanel from './TradeChatPanel';

const FALLBACK_SYMBOLS: SymbolTicker[] = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'DOGEUSDT', 'XRPUSDT', 'BNBUSDT', 'ADAUSDT', 'AVAXUSDT']
    .map(symbol => ({ symbol, lastPrice: 0, changePercent24h: 0, quoteVolume: 0 }));

interface TradeViewProps {
    providers: ProviderConfig[];
    selectedChatModel: string;
    onSelectChatModel: (modelId: string) => void;
    /** The currently projected verdict — its Entry/SL/TP lines are drawn on
     *  the chart when it belongs to the selected symbol. */
    verdict?: TradeAnalysis | null;
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

const TradeView: React.FC<TradeViewProps> = ({ providers, selectedChatModel, onSelectChatModel, verdict }) => {
    const [symbol, setSymbol] = useState('BTCUSDT');
    const [interval, setInterval_] = useState<ChartInterval>('15m');
    const [strip, setStrip] = useState<StripData | null>(null);
    const [nowMs, setNowMs] = useState(() => Date.now());
    const [symbols, setSymbols] = useState<SymbolTicker[]>(FALLBACK_SYMBOLS);

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

    // Stats strip: 15s refresh (service caches dedupe the fan-out), 1s tick
    // only for the funding countdown.
    useEffect(() => {
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
        const tick = window.setInterval(() => setNowMs(Date.now()), 1000);
        return () => { cancelled = true; window.clearInterval(poll); window.clearInterval(tick); };
    }, [symbol]);

    const changeTone = useMemo(() => {
        const v = strip?.changePercent24h ?? 0;
        return v > 0 ? 'text-emerald-400' : v < 0 ? 'text-rose-400' : 'text-zinc-300';
    }, [strip]);

    return (
        <div className="flex h-full min-h-0 flex-col bg-zinc-950" data-testid="trade-view">
            {/* Stats strip (Minara perps header) */}
            <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-white/[0.06] bg-zinc-900/60 py-2 pr-3">
                <div className="pl-3 pr-1">
                    <select
                        value={symbol}
                        onChange={e => setSymbol(e.target.value)}
                        aria-label="Trade symbol"
                        className="rounded-control border border-white/10 bg-zinc-800 px-2 py-1 text-[13px] font-bold text-zinc-100 focus:outline-none"
                    >
                        {symbols.map(s => <option key={s.symbol} value={s.symbol}>
                            {s.symbol.replace(/USDT$/, '/USDT')}{s.changePercent24h ? `  ${s.changePercent24h >= 0 ? '+' : ''}${s.changePercent24h.toFixed(1)}%` : ''}
                        </option>)}
                    </select>
                </div>
                <Stat label="Mark" value={strip?.markPrice ? fmtPrice(strip.markPrice) : '—'} />
                <Stat label="Oracle" value={strip?.indexPrice ? fmtPrice(strip.indexPrice) : '—'} />
                <Stat label="24h Change" value={strip ? `${strip.changePercent24h >= 0 ? '+' : ''}${strip.changePercent24h.toFixed(2)}%` : '—'} />
                <Stat label="24h Volume" value={strip ? fmtUsd(strip.volume24h) : '—'} />
                <Stat label="Open Interest" value={strip ? fmtUsd(strip.oiValue) : '—'} />
                <Stat label="Funding / Countdown" value={strip ? (
                    <span className={strip.lastFundingRate >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                        {(strip.lastFundingRate * 100).toFixed(4)}% <span className="text-zinc-500">{fundingCountdown(strip.nextFundingTime, nowMs)}</span>
                    </span>
                ) : '—'} />
                <span className={`ml-auto hidden shrink-0 pr-1 font-mono text-[15px] font-bold tabular-nums sm:block ${changeTone}`}>
                    {strip?.markPrice ? fmtPrice(strip.markPrice) : ''}
                </span>
            </div>

            {/* Chart + book + AI chat */}
            <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
                <div className="min-h-[420px] flex-1 lg:min-h-0">
                    <TradingChart symbol={symbol} interval={interval} onIntervalChange={setInterval_} verdict={verdict} />
                </div>
                <div className="hidden w-48 shrink-0 md:block">
                    <OrderBookPanel symbol={symbol} />
                </div>
                <div className="h-96 w-full shrink-0 lg:h-auto lg:w-80 xl:w-96">
                    <TradeChatPanel
                        symbol={symbol}
                        interval={interval}
                        providers={providers}
                        selectedChatModel={selectedChatModel}
                        onSelectChatModel={onSelectChatModel}
                    />
                </div>
            </div>
        </div>
    );
};

export default TradeView;
