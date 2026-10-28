/**
 * useSurface — the app is a set of surfaces (Analyze, Journal, Agents, Learning)
 * chosen from the rail, not a single page with modal everything. Two surfaces
 * have been removed and their stored values migrate: 'chat' (the Chart AI dock
 * carried the conversations) and 'skills' (the Strategy Studio is the Skills
 * SETTINGS tab now, reachable from the rail's Customize row — a tab is not a
 * surface, so there is nothing to land on). Persisted like uiMode;
 * unknown/absent values fall back to trade.
 */

import { useEffect, useState } from 'react';

export type AppSurface = 'chat' | 'trade' | 'journal' | 'agents' | 'learn';

const KEY = 'august_surface_v1';
const VALID: readonly string[] = ['trade', 'journal', 'agents', 'learn'];

export const useSurface = (): { surface: AppSurface; setSurface: (s: AppSurface) => void } => {
    const [surface, setSurface] = useState<AppSurface>(() => {
        try {
            const stored = localStorage.getItem(KEY);
            // 'boards' was the first name of the trade surface; 'chat' and
            // 'skills' lost their surface — all three land on trade.
            if (stored === 'boards' || stored === 'chat' || stored === 'skills') return 'trade';
            return stored && VALID.includes(stored) ? stored as AppSurface : 'trade';
        } catch { return 'trade'; }
    });
    useEffect(() => {
        try { localStorage.setItem(KEY, surface); } catch { /* private mode */ }
    }, [surface]);
    return { surface, setSurface };
};
