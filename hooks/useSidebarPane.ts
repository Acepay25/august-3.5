/**
 * useSidebarPane — which tab the unified sidebar shows: 'bots' (agent
 * roster) or 'sessions' (legacy fallback). SESSIONS was removed per user
 * decision — the desktop sidebar now shows the BOTS roster directly; the
 * pane state is kept for backward-compat with the stored preference.
 *
 * Same persistence pattern as useUiMode: synchronous localStorage read
 * in the useState initializer (no flash of the wrong tab on reload)
 * plus a fire-and-forget Preferences write for durability.
 */

import { useCallback, useState } from 'react';
import { setPreference } from '../services/infrastructure/PreferencesService';

export type SidebarPane = 'sessions' | 'bots';

const LOCAL_KEY = 'august_sidebar_pane';
const PREF_KEY = 'sidebar_pane_v1';

const isPane = (value: string | null): value is SidebarPane =>
    value === 'sessions' || value === 'bots';

const readStoredPane = (): SidebarPane => {
    try {
        const stored = window.localStorage.getItem(LOCAL_KEY);
        return isPane(stored) ? stored : 'bots';
    } catch {
        // Restricted browser context — default to bots.
        return 'bots';
    }
};

export interface UseSidebarPaneResult {
    sidebarPane: SidebarPane;
    setSidebarPane: (pane: SidebarPane) => void;
}

export const useSidebarPane = (): UseSidebarPaneResult => {
    const [sidebarPane, setSidebarPaneState] = useState<SidebarPane>(readStoredPane);

    const setSidebarPane = useCallback((pane: SidebarPane) => {
        setSidebarPaneState(pane);
        try {
            window.localStorage.setItem(LOCAL_KEY, pane);
        } catch {
            // Optional in restricted contexts.
        }
        setPreference(PREF_KEY, pane).catch(() => {
            // Preferences are optional (web fallbacks already handled inside).
        });
    }, []);

    return { sidebarPane, setSidebarPane };
};
