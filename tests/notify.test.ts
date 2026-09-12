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
});

describe('notify (web path)', () => {
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
