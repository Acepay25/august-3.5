/**
 * The dev-proxy routing guard (audit crosscheck 2026-09-15 §4.5):
 * /__provider_proxy only exists in the vite DEV server's configureServer.
 * A packaged Capacitor WebView reports hostname 'localhost' too, so the old
 * hostname-only check sent production mobile provider calls into a 404
 * dead-end. The guard must require DEV (or tests would stop exercising the
 * proxy branch — jsdom's hostname is 'localhost' and vitest runs with DEV).
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { usesDevProviderProxy } from '../services/providers/GenericProviderService';

describe('usesDevProviderProxy', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('routes through the dev proxy on a loopback host in DEV', () => {
        expect(window.location.hostname).toBe('localhost');
        expect(usesDevProviderProxy()).toBe(true);
    });

    it('never targets the dev-only middleware in a production build', () => {
        vi.stubEnv('DEV', false);
        // Same hostname as a packaged Capacitor WebView — the guard must
        // fall through to the direct-call branches instead of 404'ing.
        expect(usesDevProviderProxy()).toBe(false);
    });
});
