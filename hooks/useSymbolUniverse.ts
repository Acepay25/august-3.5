import { useEffect, useState } from 'react';
import { fetchAllFuturesSymbols, type SymbolMeta } from '../services/analysis/MarketDataService';
import { baseOf } from '../utils/symbol';

/** The perps the picker offers when the exchange list cannot be reached —
 *  enough that a first run is not an empty control, and the majors a trader
 *  actually asks about. */
export const FALLBACK_SYMBOLS: SymbolMeta[] = [
    'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'DOGEUSDT', 'XRPUSDT', 'BNBUSDT', 'ADAUSDT', 'AVAXUSDT',
].map(symbol => ({ symbol, baseAsset: baseOf(symbol), lastPrice: 0, changePercent24h: 0, quoteVolume: 0 }));

/**
 * The futures symbol universe, polled once a minute.
 *
 * This used to live in `TradeView` as local state, which meant a second
 * surface wanting the same picker would have had to either duplicate the poll
 * or reach into the trade surface. Hoisted so the Chat surface and the trade
 * header can each hold a `SymbolPicker` over one shared list.
 *
 * The poll is deliberately coarse and never replaces a good list with an empty
 * one — a transient fetch failure must not empty a working picker.
 */
export const useSymbolUniverse = (): SymbolMeta[] => {
    const [symbols, setSymbols] = useState<SymbolMeta[]>(FALLBACK_SYMBOLS);

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

    return symbols;
};
