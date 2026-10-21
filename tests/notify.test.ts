/**
 * notify — the shared desktop-notification helper. In jsdom (web path), it
 * must request permission and post a Notification; failures must be swallowed
 * so a notification never breaks the flow that fired it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { notify, ensureNotifyPermission, __resetNotifyForTests } from '../services/infrastructure/notify';

class FakeNotification {
    static permission: NotificationPermission = 'default';
    static requestPermission: () => Promise<NotificationPermission> = async () => 'granted';
    static instances: FakeNotification[] = [];
    title: string; options: NotificationOptions;
    onclick: (() => void) | null = null;
    constructor(title: string, options: NotificationOptions) { this.title = title; this.options = options; FakeNotification.instances.push(this); }
    close() { /* noop */ }
}

beforeEach(() => {
    __resetNotifyForTests();
    FakeNotification.permission = 'default';
    FakeNotification.instances = [];
    vi.stubGlobal('Notification', FakeNotification);
    // Force the web path: make the Capacitor probe resolve non-native.
    vi.doMock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }));
    // jsdom reports a visible document; a notification is for a tab the user
    // has left, so the posting cases have to say so explicitly.
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    // The page is hidden, so focus is irrelevant for the posting cases; the
    // foreground case below sets both.
    Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => false });
});

describe('notify (web path)', () => {
    it('posts nothing while the app is in the foreground', async () => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: false });
        Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => true });
        FakeNotification.requestPermission = vi.fn(async (): Promise<NotificationPermission> => { FakeNotification.permission = 'granted'; return 'granted'; });
        const ok = await notify('settled', 'the analysis is ready');
        expect(ok).toBe(false);
        expect(FakeNotification.instances.length).toBe(0);
    });

    it('posts when the window is visible but does NOT have focus', async () => {
        // The Electron case this fix exists for: a window behind another app is
        // visible (`hidden === false`) but the trader is not looking at it.
        Object.defineProperty(document, 'hidden', { configurable: true, value: false });
        Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => false });
        FakeNotification.requestPermission = vi.fn(async (): Promise<NotificationPermission> => { FakeNotification.permission = 'granted'; return 'granted'; });
        const ok = await notify('BTC watch fired', 'BTCUSDT above 112000');
        expect(ok).toBe(true);
        expect(FakeNotification.instances.length).toBe(1);
    });

    it('requests permission then posts a Notification with title + body', async () => {
        FakeNotification.requestPermission = vi.fn(async (): Promise<NotificationPermission> => { FakeNotification.permission = 'granted'; return 'granted'; });
        const ok = await notify('BTC watch fired', 'BTCUSDT above 112000');
        expect(ok).toBe(true);
        expect(FakeNotification.instances.length).toBe(1);
        expect(FakeNotification.instances[0].title).toBe('BTC watch fired');
        expect(FakeNotification.instances[0].options.body).toBe('BTCUSDT above 112000');
    });

    it('returns false (and posts nothing) when permission is denied', async () => {
        FakeNotification.requestPermission = vi.fn(async (): Promise<NotificationPermission> => 'denied');
        const ok = await notify('t', 'b');
        expect(ok).toBe(false);
        expect(FakeNotification.instances.length).toBe(0);
    });

    it('ensureNotifyPermission grants once and caches', async () => {
        FakeNotification.requestPermission = vi.fn(async (): Promise<NotificationPermission> => { FakeNotification.permission = 'granted'; return 'granted'; });
        expect(await ensureNotifyPermission()).toBe(true);
        expect(await ensureNotifyPermission()).toBe(true); // cached, no second prompt
        expect(FakeNotification.requestPermission).toHaveBeenCalledTimes(1);
    });
});
