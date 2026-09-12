/**
 * useSurface — Minara's top-level navigation model: the app is a set of
 * surfaces (Trade, Journal, Studio, Agents) chosen from the icon rail, not a
 * single page with modal everything. The Chat surface was removed — the
 * trade surface's Chart AI dock carries the conversations now — so a stored
 * 'chat' value migrates to 'trade'. Persisted like uiMode; unknown/absent
 * values fall back to trade.
 */

import { useEffect, useState } from 'react';

export type AppSurface = 'chat' | 'trade' | 'journal' | 'studio' | 'agents';

const KEY = 'august_surface_v1';
const VALID: readonly string[] = ['trade', 'journal', 'studio', 'agents'];

export const useSurface = (): { surface: AppSurface; setSurface: (s: AppSurface) => void } => {
    const [surface, setSurface] = useState<AppSurface>(() => {
        try {
            const stored = localStorage.getItem(KEY);
            // 'boards' was the first name of the trade surface; 'chat' lost
            // its surface — both land on trade.
            if (stored === 'boards' || stored === 'chat') return 'trade';
            return stored && VALID.includes(stored) ? stored as AppSurface : 'trade';
        } catch { return 'trade'; }
    });
    useEffect(() => {
        try { localStorage.setItem(KEY, surface); } catch { /* private mode */ }
    }, [surface]);
    return { surface, setSurface };
};
