/**
 * Background completion notifications (native only).
 *
 * When a long analysis finishes while the app is backgrounded on Android/iOS,
 * the user has no way to know — fire a local notification (same pattern as
 * PriceAlertService). Web and Electron foreground runs skip silently; every
 * failure is swallowed because notifications must never break the flow.
 */
export const notifyAnalysisComplete = async (title: string, body: string): Promise<void> => {
  try {
    if (typeof document === 'undefined' || !document.hidden) return; // foreground — UI is visible
    const { Capacitor } = await import('@capacitor/core');
    if (!Capacitor.isNativePlatform()) return;

    const { LocalNotifications } = await import('@capacitor/local-notifications');
    const permission = await LocalNotifications.checkPermissions();
    if (permission.display !== 'granted') {
      const requested = await LocalNotifications.requestPermissions();
      if (requested.display !== 'granted') return;
    }
    await LocalNotifications.schedule({
      notifications: [{
        title,
        body,
        id: Date.now() % 2147483647,
        schedule: { at: new Date() },
      }],
    });
  } catch {
    // best-effort
  }
};
