/**
 * useFloorMarketData — light polling quotes for the floor's ticker
 * strip and Big Board. One 24hr-ticker fetch per symbol per tick,
 * paused while the tab is hidden (same policy as useMarketData).
 *
 * Every symbol degrades independently: a failed fetch leaves that
 * row's quote undefined and the floor renders dashes — the floor
 * never shows a market-data error and works fully offline.
 */

import { useEffect, useState } from 'react';
import { fetchMarketData } from '../services/analysis/MarketDataService';

export interface FloorQuote {
    symbol: string;
    last?: number;
    changePct?: number;
}

export const useFloorMarketData = (
    symbols: string[],
    enabled: boolean,
    intervalMs = 60_000,
): FloorQuote[] => {
    const [quotes, setQuotes] = useState<Record<string, FloorQuote>>({});
    // Joined key keeps the effect stable across parent re-renders that
    // rebuild the array (the memoized floorTickers changes identity only
    // when the symbol set actually changes, but this is belt and braces).
    const symbolsKey = symbols.join(',');

    useEffect(() => {
        const list = symbolsKey.split(',').filter(Boolean);
        if (!enabled || list.length === 0) return undefined;
        let cancelled = false;
        const refresh = async (): Promise<void> => {
            await Promise.all(list.map(async sym => {
                try {
                    const md = await fetchMarketData(sym);
                    if (cancelled) return;
                    setQuotes(prev => ({
                        ...prev,
                        [sym]: { symbol: sym, last: md.currentPrice, changePct: md.priceChangePercent24h },
                    }));
                } catch {
                    // Keep whatever the row had (dashes on first load).
                }
            }));
        };
        void refresh();
        const id = window.setInterval(() => {
            if (document.visibilityState === 'visible') void refresh();
        }, intervalMs);
        return () => {
            cancelled = true;
            window.clearInterval(id);
        };
    }, [symbolsKey, enabled, intervalMs]);

    // Return in input order; unknown symbols render as dashes.
    return symbolsKey.split(',').filter(Boolean).map(s => quotes[s] ?? { symbol: s });
};
