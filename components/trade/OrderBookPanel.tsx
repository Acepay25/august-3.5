/**
 * OrderBookPanel — the DOM ladder column from Minara's perps screen: asks
 * (red) stacked above the spread row, bids (green) below, each level sized
 * by a depth bar, walls (≥3× avg level, flagged by the service) highlighted.
 * Polls fetchOrderBookDepth every 5s while mounted; the service's 30s cache
 * + futures rate budget keep the polling honest.
 */

import React, { useEffect, useState } from 'react';
import { fetchOrderBookDepth, type OrderBookData } from '../../services/analysis/MarketDataService';

interface OrderBookPanelProps {
    symbol: string;
}

const fmtQty = (n: number): string => n >= 1000 ? `${(n / 1000).toFixed(1)}K` : n.toFixed(n >= 10 ? 1 : 3);
const fmtPrice = (n: number): string => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: n >= 1000 ? 2 : 4 });

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

const isWall = (level: { price: number }, walls: { price: number }[]): boolean => walls.some(w => w.price === level.price);

const OrderBookPanel: React.FC<OrderBookPanelProps> = ({ symbol }) => {
    const [book, setBook] = useState<OrderBookData | null>(null);

    useEffect(() => {
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
    }, [symbol]);

    const asks = book?.asks ?? [];
    const bids = book?.bids ?? [];
    // Minara shows asks best-at-bottom: reverse so the spread sits between.
    const asksView = [...asks].reverse().slice(0, 12);
    const bidsView = bids.slice(0, 12);
    const maxQty = Math.max(1, ...asksView.map(a => a.qty), ...bidsView.map(b => b.qty));

    return (
        <div className="flex h-full min-h-0 flex-col border-l border-white/[0.06] bg-zinc-900/40">
            <div className="flex shrink-0 items-center justify-between px-2 py-1.5">
                <span className="ui-kicker">Order Book</span>
                {book?.available && (
                    <span className={`font-mono text-[10px] tabular-nums ${book.dominantSide === 'buyers' ? 'text-emerald-400' : book.dominantSide === 'sellers' ? 'text-rose-400' : 'text-zinc-500'}`}>
                        {book.dominantSide}
                    </span>
                )}
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
                {asksView.map(a => (
                    <Row key={`a${a.price}`} side="ask" price={a.price} qty={a.qty} maxQty={maxQty} wall={isWall(a, book?.sellWalls ?? [])} />
                ))}
                <div className="my-1 flex items-center justify-between border-y border-white/[0.06] bg-zinc-900/60 px-2 py-1 font-mono text-[10px] tabular-nums text-zinc-400">
                    <span className={book && book.spreadPercent > 0.05 ? 'text-amber-400' : ''}>spread {book ? `${book.spreadPercent.toFixed(3)}%` : '—'}</span>
                    <span className="text-zinc-300">{book?.bestAsk ? fmtPrice(book.bestAsk) : '—'}</span>
                </div>
                {bidsView.map(b => (
                    <Row key={`b${b.price}`} side="bid" price={b.price} qty={b.qty} maxQty={maxQty} wall={isWall(b, book?.buyWalls ?? [])} />
                ))}
                {!book && <p className="px-2 py-3 text-[11px] text-zinc-600">Loading book…</p>}
            </div>
        </div>
    );
};

export default React.memo(OrderBookPanel);
