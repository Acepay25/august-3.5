/**
 * useSurface — Minara's top-level navigation model: the app is a set of
 * surfaces (Chat, Boards, Journal, Studio, Agents) chosen from the icon
 * rail, not a single page with modal everything. Persisted like uiMode;
 * unknown/absent values fall back to chat.
 */

import { useEffect, useState } from 'react';

export type AppSurface = 'chat' | 'trade' | 'journal' | 'studio' | 'agents';

const KEY = 'august_surface_v1';
const VALID: readonly string[] = ['chat', 'trade', 'journal', 'studio', 'agents'];

export const useSurface = (): { surface: AppSurface; setSurface: (s: AppSurface) => void } => {
    const [surface, setSurface] = useState<AppSurface>(() => {
        try {
            const stored = localStorage.getItem(KEY);
            // 'boards' was the first name of the trade surface — migrate it.
            if (stored === 'boards') return 'trade';
            return stored && VALID.includes(stored) ? stored as AppSurface : 'chat';
        } catch { return 'chat'; }
    });
    useEffect(() => {
        try { localStorage.setItem(KEY, surface); } catch { /* private mode */ }
    }, [surface]);
    return { surface, setSurface };
};
