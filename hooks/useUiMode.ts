/**
 * useUiMode — which presentation the trader is in: 'chat' (converse
 * with the agents) or 'floor' (watch them work on the trading floor).
 *
 * Persistence follows the sidebar-collapse pattern: synchronous
 * localStorage read in the useState initializer (no flash of the wrong
 * mode on reload) plus a fire-and-forget Preferences write for
 * durability in native shells where localStorage can be evicted.
 */

import { useCallback, useEffect, useState } from 'react';
import { setPreference } from '../services/infrastructure/PreferencesService';

export type UiMode = 'chat' | 'floor';

const LOCAL_KEY = 'august_ui_mode';
const PREF_KEY = 'ui_mode_v1';

const readStoredMode = (): UiMode => {
    try {
        return window.localStorage.getItem(LOCAL_KEY) === 'floor' ? 'floor' : 'chat';
    } catch {
        // Restricted browser context — default to chat.
        return 'chat';
    }
};

export interface UseUiModeResult {
    uiMode: UiMode;
    setUiMode: (mode: UiMode) => void;
    toggleUiMode: () => void;
}

export const useUiMode = (): UseUiModeResult => {
    const [uiMode, setUiModeState] = useState<UiMode>(readStoredMode);

    // Persist on change (also runs once on mount — harmless rewrite).
    useEffect(() => {
        try {
            window.localStorage.setItem(LOCAL_KEY, uiMode);
        } catch {
            // Optional in restricted contexts.
        }
        setPreference(PREF_KEY, uiMode).catch(() => {
            // Preferences are optional (web fallbacks already handled inside).
        });
    }, [uiMode]);

    const setUiMode = useCallback((mode: UiMode) => setUiModeState(mode), []);
    const toggleUiMode = useCallback(
        () => setUiModeState(prev => (prev === 'floor' ? 'chat' : 'floor')),
        [],
    );

    return { uiMode, setUiMode, toggleUiMode };
};
