/**
 * SymbolPicker — TradingView-style instrument search for the Trade surface.
 * The whole USDT-perp universe (/fapi/v1/exchangeInfo ∩ 24hr tickers) sits
 * behind one button: a search field filters by ticker or base asset, rows
 * show last price + 24h change, and ↑↓/↵/Esc navigate — no more 20-symbol
 * dropdown.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Search } from 'lucide-react';
import type { SymbolMeta } from '../../services/analysis/MarketDataService';

export interface SymbolPickerProps {
    symbols: SymbolMeta[];
    value: string;
    onChange: (symbol: string) => void;
}

const display = (symbol: string): string => symbol.replace(/USDT$/, '/USDT');

export const SymbolPicker: React.FC<SymbolPickerProps> = ({ symbols, value, onChange }) => {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [cursor, setCursor] = useState(0);
    const [anchor, setAnchor] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
    const triggerRef = useRef<HTMLButtonElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);

    // startsWith ranks above includes; each group keeps the volume order the
    // feed already arrives in, so liquid names lead both.
    const filtered = useMemo(() => {
        const q = query.trim().toUpperCase();
        if (!q) return symbols;
        const starts: SymbolMeta[] = [];
        const includes: SymbolMeta[] = [];
        for (const s of symbols) {
            if (s.symbol.startsWith(q) || s.baseAsset.startsWith(q)) starts.push(s);
            else if (s.symbol.includes(q) || s.baseAsset.toUpperCase().includes(q)) includes.push(s);
        }
        return [...starts, ...includes];
    }, [symbols, query]);

    // Fresh search + cursor every open; the field takes focus after paint.
    useEffect(() => {
        if (open) {
            setQuery('');
            setCursor(0);
            window.setTimeout(() => inputRef.current?.focus(), 0);
        }
    }, [open]);

    // Keep the cursor row in view while arrowing (scrollIntoView is
    // optional-called: jsdom embeds don't implement it).
    useEffect(() => {
        if (!open) return;
        const row = listRef.current?.querySelector<HTMLElement>(`[data-idx="${cursor}"]`);
        row?.scrollIntoView?.({ block: 'nearest' });
    }, [cursor, open]);

    const commit = (symbol: string): void => {
        onChange(symbol);
        setOpen(false);
    };

    // The popover PORTALS to <body> and pins to the trigger's rect — the
    // stats strip is an overflow-x container that would otherwise clip the
    // dropdown to its own box (the later-5 menu-clip bug, again).
    const toggle = (): void => {
        const r = triggerRef.current?.getBoundingClientRect();
        if (r) setAnchor({ left: Math.min(r.left, Math.max(8, window.innerWidth - 336)), top: r.bottom + 4 });
        setOpen(o => !o);
    };

    const active = filtered[cursor];
    const valueMeta = symbols.find(s => s.symbol === value);

    return (
        <div className="relative">
            <button
                ref={triggerRef}
                type="button"
                aria-label="Trade symbol"
                aria-expanded={open}
                data-testid="symbol-picker-trigger"
                onClick={toggle}
                className="flex items-center gap-1.5 rounded-control border border-white/10 bg-zinc-800 px-2 py-1 text-[13px] font-bold text-zinc-100 transition-colors hover:border-white/20 focus:outline-none"
            >
                {display(value)}
                {valueMeta && valueMeta.changePercent24h !== 0 && (
                    <span className={`font-mono text-[10px] font-semibold tabular-nums ${valueMeta.changePercent24h >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {valueMeta.changePercent24h >= 0 ? '+' : ''}{valueMeta.changePercent24h.toFixed(1)}%
                    </span>
                )}
                <ChevronDown className="h-3.5 w-3.5 text-zinc-500" aria-hidden="true" />
            </button>
            {open && createPortal(
                <>
                    <div className="fixed inset-0 z-40" aria-hidden="true" onClick={() => setOpen(false)} />
                    <div
                        data-testid="symbol-picker"
                        className="fixed z-50 w-80 overflow-hidden rounded-xl border border-white/10 bg-zinc-900 shadow-2xl"
                        style={{ left: anchor.left, top: anchor.top }}
                    >
                        <div className="flex items-center gap-2 border-b border-white/[0.06] px-3 py-2">
                            <Search className="h-3.5 w-3.5 shrink-0 text-zinc-500" aria-hidden="true" />
                            <input
                                ref={inputRef}
                                value={query}
                                onChange={e => { setQuery(e.target.value); setCursor(0); }}
                                onKeyDown={e => {
                                    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(c + 1, filtered.length - 1)); }
                                    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)); }
                                    else if (e.key === 'Enter') { e.preventDefault(); if (active) commit(active.symbol); }
                                    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
                                }}
                                placeholder="Search symbol…"
                                aria-label="Search symbols"
                                className="min-w-0 flex-1 bg-transparent text-[13px] text-zinc-100 placeholder-zinc-500 focus:outline-none"
                            />
                        </div>
                        <div ref={listRef} className="max-h-80 overflow-y-auto custom-scrollbar" data-testid="symbol-picker-list">
                            {filtered.length === 0 ? (
                                <p className="px-3 py-6 text-center text-[11px] text-zinc-500" data-testid="symbol-picker-empty">
                                    No symbol matches &quot;{query}&quot;.
                                </p>
                            ) : filtered.map((s, i) => (
                                <button
                                    key={s.symbol}
                                    type="button"
                                    data-idx={i}
                                    data-testid={`symbol-row-${s.symbol}`}
                                    onMouseEnter={() => setCursor(i)}
                                    onClick={() => commit(s.symbol)}
                                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left ${i === cursor ? 'bg-white/[0.06]' : ''}`}
                                >
                                    <span className="w-28 shrink-0 truncate font-mono text-[12px] font-bold text-zinc-100">{display(s.symbol)}</span>
                                    <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-500">{s.baseAsset} perpetual</span>
                                    <span className="shrink-0 font-mono text-[11px] tabular-nums text-zinc-300">
                                        {s.lastPrice > 0 ? s.lastPrice.toLocaleString(undefined, { maximumFractionDigits: s.lastPrice < 1 ? 6 : 2 }) : '—'}
                                    </span>
                                    <span className={`w-14 shrink-0 text-right font-mono text-[10px] tabular-nums ${s.changePercent24h >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                        {s.changePercent24h >= 0 ? '+' : ''}{s.changePercent24h.toFixed(1)}%
                                    </span>
                                </button>
                            ))}
                        </div>
                        <div className="border-t border-white/[0.06] px-3 py-1.5 text-[9px] text-zinc-600">
                            ↑↓ navigate · ↵ select · esc close · {filtered.length} of {symbols.length} USDT perps
                        </div>
                    </div>
                </>,
                document.body,
            )}
        </div>
    );
};

export default React.memo(SymbolPicker);
