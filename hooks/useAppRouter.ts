import { useHashLocation } from 'wouter/use-hash-location';
import { useRoute } from 'wouter';
import { useEffect, useCallback } from 'react';

/**
 * Route definitions mapping hash paths to app screens.
 * Syncs with the existing boolean-flag navigation in App.tsx.
 */
export const ROUTES = {
  CHAT: '/',
  JOURNAL: '/journal',
  MARKET: '/market',
  SETTINGS: '/settings',
  SETTINGS_PROVIDERS: '/settings/providers',
} as const;

export type AppRoute = (typeof ROUTES)[keyof typeof ROUTES];

/**
 * Hook that provides route-aware navigation for the app.
 * Uses hash-based routing for compatibility with Electron and Capacitor WebView.
 *
 * Usage in App.tsx:
 *   const { route, navigate } = useAppRouter();
 *   // Sync route → boolean flags:
 *   useEffect(() => {
 *     setJournalState({ isOpen: route === '/journal', tab: 'log' });
 *     setIsLiveMarketVisible(route === '/market');
 *     setIsSettingsVisible(route.startsWith('/settings'));
 *   }, [route]);
 */
export function useAppRouter() {
  const [location, setLocation] = useHashLocation();

  const navigate = useCallback(
    (to: AppRoute) => {
      setLocation(to);
    },
    [setLocation]
  );

  const goBack = useCallback(() => {
    window.history.back();
  }, []);

  return {
    route: location,
    navigate,
    goBack,
    isChat: location === ROUTES.CHAT,
    isJournal: location === ROUTES.JOURNAL,
    isMarket: location === ROUTES.MARKET,
    isSettings: location.startsWith(ROUTES.SETTINGS),
    isProviderSettings: location === ROUTES.SETTINGS_PROVIDERS,
  };
}
