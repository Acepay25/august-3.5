/**
 * OrderBookPanel — the DOM ladder column from Minara's perps screen: asks
 * (red) stacked above the spread row, bids (green) below, each level sized
 * by a depth bar, walls (≥3× avg level, flagged by the service) highlighted.
 * Polls fetchOrderBookDepth every 5s while mounted; the service's 30s cache
 * + futures rate budget keep the polling honest.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { fetchOrderBookDepth, type OrderBookData } from '../../services/analysis/MarketDataService';
import type { LiveDepth } from '../../services/trade/futuresStreams';

interface OrderBookPanelProps {
    symbol: string;
    /** Websocket depth20@100ms is up: the ladder comes from liveDepth and
     *  the 5s REST poll stops (it stays as the fallback). */
    live?: boolean;
    liveDepth?: LiveDepth | null;
}

const fmtQty = (n: number): string => n >= 1000 ? `${(n / 1000).toFixed(1)}K` : n.toFixed(n >= 10 ? 1 : 3);
const fmtPrice = (n: number): string => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: n >= 1000 ? 2 : 4 });

/** Wall = level ≥3× the average size of the visible ladder (the same rule
 *  the REST OrderBookData uses, recomputed locally for the live snapshot). */
const wallPrices = (levels: { price: number; qty: number }[]): Set<number> => {
    if (levels.length === 0) return new Set();
    const avg = levels.reduce((s, l) => s + l.qty, 0) / levels.length;
    return new Set(levels.filter(l => l.qty >= avg * 3).map(l => l.price));
};

const Row: React.FC<{ side: 'bid' | 'ask'; price: number; qty: number; maxQty: number; wall: boolean }> = ({ side, price, qty, maxQty, wall }) => (
    <div className="relative flex items-center justify-between px-2 py-[1.5px] font-mono text-[10.5px] tabular-nums">
        <span
            aria-hidden
            className={`absolute inset-y-0 ${side === 'bid' ? 'right-0' : 'right-0'} rounded-sm ${side === 'bid' ? 'bg-emerald-500/10' : 'bg-rose-500/10'}`}
            style={{ width: `${maxQty > 0 ? Math.min(100, (qty / maxQty) * 100) : 0}%` }}
        />
        <span className={`relative ${side === 'bid' ? 'text-emerald-400' : 'text-rose-400'} ${wall ? 'font-bold' : ''}`}>{fmtPrice(price)}</span>
        <span className={`relative text-zinc-400 ${wall ? 'font-bold text-zinc-200' : ''}`}>{fmtQty(qty)}</span>
    </div>
);

const OrderBookPanel: React.FC<OrderBookPanelProps> = ({ symbol, live = false, liveDepth }) => {
    const [book, setBook] = useState<OrderBookData | null>(null);

    // Fallback poll only while the socket is down.
    useEffect(() => {
        if (live) return;
        let cancelled = false;
        let timer = 0;
        const load = async (): Promise<void> => {
            try {
                const next = await fetchOrderBookDepth(symbol);
                if (!cancelled) setBook(next);
            } catch { /* keep the last ladder on a failed poll */ }
            if (!cancelled) timer = window.setTimeout(() => void load(), 5000);
        };
        void load();
        return () => { cancelled = true; window.clearTimeout(timer); };
    }, [symbol, live]);

    const usingLive = live && !!liveDepth;
    const asks = usingLive ? liveDepth!.asks : book?.asks ?? [];
    const bids = usingLive ? liveDepth!.bids : book?.bids ?? [];
    // Minara shows asks best-at-bottom: reverse so the spread sits between.
    const asksView = [...asks].reverse().slice(0, 12);
    const bidsView = bids.slice(0, 12);
    const maxQty = Math.max(1, ...asksView.map(a => a.qty), ...bidsView.map(b => b.qty));
    const sellWalls = useMemo(() => wallPrices(asksView), [asksView]);
    const buyWalls = useMemo(() => wallPrices(bidsView), [bidsView]);
    const bestBid = bidsView[0]?.price ?? book?.bestBid ?? 0;
    const bestAsk = asksView[asksView.length - 1]?.price ?? book?.bestAsk ?? 0;
    const spreadPercent = bestAsk && bestBid ? ((bestAsk - bestBid) / bestAsk) * 100 : 0;
    const dominant: 'buyers' | 'sellers' | 'balanced' = usingLive
        ? (bidsView.reduce((s, l) => s + l.qty, 0) > asksView.reduce((s, l) => s + l.qty, 0) * 1.15 ? 'buyers'
            : asksView.reduce((s, l) => s + l.qty, 0) > bidsView.reduce((s, l) => s + l.qty, 0) * 1.15 ? 'sellers' : 'balanced')
        : book?.dominantSide ?? 'balanced';

    return (
        <div className="flex h-full min-h-0 flex-col border-l border-white/[0.06] bg-zinc-900/40">
            <div className="flex shrink-0 items-center justify-between px-2 py-1.5">
                <span className="ui-kicker">Order Book</span>
                <span className={`font-mono text-[10px] ${usingLive ? 'text-emerald-400' : 'text-zinc-600'}`} title={usingLive ? 'depth20@100ms websocket' : 'REST poll every 5s'}>
                    {usingLive ? 'live' : `${dominant}`}
                </span>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
                {asksView.map(a => (
                    <Row key={`a${a.price}`} side="ask" price={a.price} qty={a.qty} maxQty={maxQty} wall={sellWalls.has(a.price)} />
                ))}
                <div className="my-1 flex items-center justify-between border-y border-white/[0.06] bg-zinc-900/60 px-2 py-1 font-mono text-[10px] tabular-nums text-zinc-400">
                    <span className={spreadPercent > 0.05 ? 'text-amber-400' : ''}>spread {spreadPercent.toFixed(3)}%</span>
                    <span className="text-zinc-300">{bestAsk ? fmtPrice(bestAsk) : '—'}</span>
                </div>
                {bidsView.map(b => (
                    <Row key={`b${b.price}`} side="bid" price={b.price} qty={b.qty} maxQty={maxQty} wall={buyWalls.has(b.price)} />
                ))}
                {asksView.length === 0 && bidsView.length === 0 && <p className="px-2 py-3 text-[11px] text-zinc-600">Loading book…</p>}
            </div>
        </div>
    );
};

export default React.memo(OrderBookPanel);
