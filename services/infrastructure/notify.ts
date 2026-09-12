/**
 * notify — ONE desktop-notification path for the whole app.
 *
 * Before this, notifications were duplicated inline (PriceAlertService had
 * its own web+native code, CompletionNotifications a native-only copy) and
 * the harness triggers never reached the OS at all — a watch firing only
 * queued a chat bubble, so if you'd tabbed away you'd never know. This is the
 * single helper every "tell the user's computer" call goes through.
 *
 * It covers all three runtimes the app ships in:
 *   • Web browser  → the Notifications API (permission-gated).
 *   • Electron     → same Notifications API (works in the renderer).
 *   • Capacitor    → @capacitor/local-notifications (native, fires backgrounded).
 *
 * Every failure is swallowed: a notification must never break the flow that
 * fired it. Permission is requested lazily on first use and cached; callers
 * that represent an EXPLICIT user intent to be alerted (arming a watch) should
 * call ensureNotifyPermission() up front so the grant exists before a trigger
 * fires minutes later.
 */

let permission: 'unknown' | 'granted' | 'denied' = 'unknown';
let nativeReady: boolean | null = null;

const isNative = async (): Promise<boolean> => {
    if (nativeReady !== null) return nativeReady;
    try {
        const { Capacitor } = await import('@capacitor/core');
        nativeReady = Capacitor.isNativePlatform();
    } catch {
        nativeReady = false;
    }
    return nativeReady;
};

/** Ask for notification permission once; safe to call repeatedly. Returns
 *  whether notifications are (or may become) available. */
export const ensureNotifyPermission = async (): Promise<boolean> => {
    if (permission === 'granted') return true;
    if (permission === 'denied') return false;
    try {
        if (await isNative()) {
            const { LocalNotifications } = await import('@capacitor/local-notifications');
            const check = await LocalNotifications.checkPermissions();
            if (check.display === 'granted') { permission = 'granted'; return true; }
            const req = await LocalNotifications.requestPermissions();
            permission = req.display === 'granted' ? 'granted' : 'denied';
            return permission === 'granted';
        }
        if (typeof window !== 'undefined' && 'Notification' in window) {
            if (Notification.permission === 'granted') { permission = 'granted'; return true; }
            if (Notification.permission === 'denied') { permission = 'denied'; return false; }
            const result = await Notification.requestPermission();
            permission = result === 'granted' ? 'granted' : 'denied';
            return permission === 'granted';
        }
    } catch {
        permission = 'unknown';
    }
    return false;
};

/**
 * Fire a desktop notification. `silent` keeps it in the notification center
 * without a sound (for non-urgent events). Returns true if a notification was
 * actually posted.
 */
export const notify = async (
    title: string,
    body: string,
    opts: { silent?: boolean; tag?: string } = {},
): Promise<boolean> => {
    if (!title && !body) return false;
    try {
        if (await isNative()) {
            const { LocalNotifications } = await import('@capacitor/local-notifications');
            const check = await LocalNotifications.checkPermissions();
            if (check.display !== 'granted') {
                const req = await LocalNotifications.requestPermissions();
                if (req.display !== 'granted') return false;
            }
            await LocalNotifications.schedule({
                notifications: [{
                    title, body,
                    id: Date.now() % 2147483647,
                    schedule: { at: new Date() },
                    sound: opts.silent ? null : undefined,
                } as never],
            });
            return true;
        }
        if (typeof window !== 'undefined' && 'Notification' in window) {
            if (Notification.permission !== 'granted') {
                const granted = await ensureNotifyPermission();
                if (!granted) return false;
            }
            const n = new Notification(title, {
                body,
                tag: opts.tag,
                icon: '/favicon.png',
                silent: opts.silent === true,
            });
            // Auto-close so the tray doesn't pile up; some browsers ignore this.
            n.onclick = () => { try { n.close(); } catch { /* noop */ } };
            window.setTimeout(() => { try { n.close(); } catch { /* noop */ } }, 12_000);
            return true;
        }
    } catch {
        // best-effort — never throw at the caller
    }
    return false;
};

/** Test hook: reset the cached permission/native probe. */
export const __resetNotifyForTests = (): void => { permission = 'unknown'; nativeReady = null; };
