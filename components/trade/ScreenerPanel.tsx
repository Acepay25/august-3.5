/**
 * ScreenerPanel — the market-wide discovery table: every scanned coin with
 * price, 24h change, RSI(14), EMA regime, live strategy-book setups and the
 * trader's own logged edge, sortable + filterable, one click from row to
 * chart. Runs progressively — rows land while the scan is still walking the
 * universe — and can be closed mid-scan (the scan aborts with it).
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, Search, X } from 'lucide-react';
import { runScreener, type ScreenerRow } from '../../services/trade/screener';
import type { LoggedTrade } from '../../types/trade';

export interface ScreenerPanelProps {
    open: boolean;
    onClose: () => void;
    /** Row click: load this coin onto the chart and close. */
    onChangeSymbol: (symbol: string) => void;
    trades?: LoggedTrade[];
}

type SortKey = 'volume' | 'movers' | 'rsi' | 'setups';

const fmtPrice = (v: number): string =>
    v.toLocaleString(undefined, { maximumFractionDigits: v < 1 ? 6 : 2 });

export const ScreenerPanel: React.FC<ScreenerPanelProps> = ({ open, onClose, onChangeSymbol, trades = [] }) => {
    const [rows, setRows] = useState<ScreenerRow[]>([]);
    const [scanned, setScanned] = useState(0);
    const [scanTotal, setScanTotal] = useState(0);
    const [running, setRunning] = useState(false);
    const [query, setQuery] = useState('');
    const [setupsOnly, setSetupsOnly] = useState(false);
    const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'volume', desc: true });
    const runIdRef = useRef(0);

    // Each open starts a FRESH scan; closing aborts the in-flight one.
    useEffect(() => {
        if (!open) return;
        const runId = runIdRef.current + 1;
        runIdRef.current = runId;
        const controller = new AbortController();
        setRows([]);
        setScanned(0);
        setRunning(true);
        void runScreener({
            limit: 100,
            trades,
            signal: controller.signal,
            onRows: latest => {
                if (runIdRef.current !== runId) return;
                setRows(latest);
                setScanned(latest.length);
            },
        }).then(all => {
            if (runIdRef.current !== runId) return;
            setScanTotal(all.length);
        }).finally(() => {
            if (runIdRef.current !== runId) return;
            setRunning(false);
        });
        return () => controller.abort();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const visible = useMemo(() => {
        const q = query.trim().toUpperCase();
        const filtered = rows.filter(r =>
            (!q || r.symbol.includes(q) || r.baseAsset.toUpperCase().includes(q))
            && (!setupsOnly || r.setups.length > 0));
        const dir = sort.desc ? -1 : 1;
        const sorted = [...filtered];
        if (sort.key === 'movers') sorted.sort((a, b) => dir * (Math.abs(b.change24h) - Math.abs(a.change24h)));
        else if (sort.key === 'rsi') sorted.sort((a, b) => dir * ((a.rsi14 ?? 50) - (b.rsi14 ?? 50)));
        else if (sort.key === 'setups') sorted.sort((a, b) => dir * (b.setups.length - a.setups.length));
        else sorted.sort((a, b) => dir * (b.quoteVolume - a.quoteVolume));
        return sorted;
    }, [rows, query, setupsOnly, sort]);

    if (!open) return null;

    const header = (key: SortKey, label: string): React.ReactNode => (
        <button
            type="button"
            onClick={() => setSort(s => ({ key, desc: s.key === key ? !s.desc : true }))}
            className={`shrink-0 text-left text-[9px] font-bold uppercase tracking-widest transition-colors hover:text-zinc-200 ${sort.key === key ? 'text-zinc-200' : 'text-zinc-500'}`}
        >
            {label}{sort.key === key ? (sort.desc ? ' ↓' : ' ↑') : ''}
        </button>
    );

    return createPortal(
        <>
            <div className="fixed inset-0 z-40 bg-black/70" aria-hidden="true" onClick={onClose} />
            <div
                role="dialog"
                aria-label="Market screener"
                data-testid="screener-panel"
                className="fixed left-1/2 top-1/2 z-50 flex max-h-[82vh] w-[min(880px,94vw)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-white/10 bg-zinc-900 shadow-2xl"
            >
                <div className="flex shrink-0 items-center gap-3 border-b border-white/[0.06] px-4 py-2.5">
                    <h2 className="text-[13px] font-bold text-zinc-100">Screener</h2>
                    <div className="flex min-w-0 flex-1 items-center gap-2 rounded-control border border-white/10 bg-zinc-800 px-2 py-1">
                        <Search className="h-3 w-3 shrink-0 text-zinc-500" aria-hidden="true" />
                        <input
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            placeholder="Filter symbol…"
                            aria-label="Filter screener symbols"
                            className="min-w-0 flex-1 bg-transparent text-[12px] text-zinc-100 placeholder-zinc-500 focus:outline-none"
                        />
                    </div>
                    <button
                        type="button"
                        onClick={() => setSetupsOnly(s => !s)}
                        aria-pressed={setupsOnly}
                        className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-colors ${setupsOnly ? 'border-amber-500/40 bg-amber-500/10 text-amber-300' : 'border-white/10 text-zinc-400 hover:text-zinc-200'}`}
                    >
                        Setups only
                    </button>
                    <button type="button" onClick={onClose} aria-label="Close screener"
                        className="shrink-0 rounded p-1 text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-200">
                        <X className="h-4 w-4" />
                    </button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar">
                    <table className="w-full border-collapse text-[11px]">
                        <thead className="sticky top-0 bg-zinc-900">
                            <tr className="border-b border-white/[0.06]">
                                <th className="px-4 py-1.5">{header('volume', 'Symbol')}</th>
                                <th className="px-3 py-1.5"><span className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">Price</span></th>
                                <th className="px-3 py-1.5">{header('movers', '24h')}</th>
                                <th className="px-3 py-1.5">{header('rsi', 'RSI')}</th>
                                <th className="px-3 py-1.5"><span className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">Regime</span></th>
                                <th className="px-3 py-1.5">{header('setups', 'Setups')}</th>
                                <th className="px-3 py-1.5"><span className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">You</span></th>
                            </tr>
                        </thead>
                        <tbody>
                            {visible.map(r => (
                                <tr
                                    key={r.symbol}
                                    data-testid={`screener-row-${r.symbol}`}
                                    onClick={() => { onChangeSymbol(r.symbol); onClose(); }}
                                    className="cursor-pointer border-b border-white/[0.03] transition-colors hover:bg-white/[0.04]"
                                >
                                    <td className="px-4 py-1.5">
                                        <span className="font-mono font-bold text-zinc-100">{r.symbol.replace(/USDT$/, '/USDT')}</span>
                                        <span className="ml-2 text-zinc-600">{r.baseAsset}</span>
                                    </td>
                                    <td className="px-3 py-1.5 font-mono tabular-nums text-zinc-300">{r.price > 0 ? fmtPrice(r.price) : '—'}</td>
                                    <td className={`px-3 py-1.5 font-mono tabular-nums ${r.change24h >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                        {r.change24h >= 0 ? '+' : ''}{r.change24h.toFixed(1)}%
                                    </td>
                                    <td className={`px-3 py-1.5 font-mono tabular-nums ${r.rsi14 == null ? 'text-zinc-600' : r.rsi14 >= 70 ? 'text-rose-400' : r.rsi14 <= 30 ? 'text-emerald-400' : 'text-zinc-300'}`}>
                                        {r.rsi14 ?? '—'}
                                    </td>
                                    <td className="px-3 py-1.5 text-zinc-400">
                                        {r.regime === 'up' ? '▲ up' : r.regime === 'down' ? '▼ down' : '· range'}
                                    </td>
                                    <td className="px-3 py-1.5">
                                        {r.setups.length > 0
                                            ? <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300" title={r.setups.map(s => `${s.title} (${s.side})`).join('; ')}>
                                                {r.setups.length} · {r.setups[0].title}
                                            </span>
                                            : <span className="text-zinc-600">—</span>}
                                    </td>
                                    <td className="px-3 py-1.5 font-mono tabular-nums text-zinc-500">{r.edge || '—'}</td>
                                </tr>
                            ))}
                            {visible.length === 0 && !running && (
                                <tr><td colSpan={7} className="px-4 py-8 text-center text-[11px] text-zinc-500">No coins match the filter.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
                <div className="flex shrink-0 items-center gap-2 border-t border-white/[0.06] px-4 py-1.5 text-[10px] text-zinc-500">
                    {running && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}
                    <span>
                        {running
                            ? `scanning ${scanned}${scanTotal ? `/${scanTotal}` : ''}… rows fill in as they land`
                            : `${rows.length} coins scanned · click a row to load it on the chart`}
                    </span>
                    <span className="ml-auto">sorted by {sort.key}{sort.desc ? ' ↓' : ' ↑'}</span>
                </div>
            </div>
        </>,
        document.body,
    );
};

export default React.memo(ScreenerPanel);
