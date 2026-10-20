/**
 * E-24 — behavioural coverage for `electron/main.cjs`.
 *
 * `tsc` cannot see the file (the include globs only match .ts/.tsx), and
 * `node --check` proves it parses, not that it behaves. The main process owns
 * the only privileged surface in the app, so these tests load the REAL file
 * with `electron` mocked and drive the three things a unit test previously
 * could not reach:
 *
 *   · the `app://` protocol's path containment (traversal and host checks),
 *   · the navigation/window-open policy,
 *   · the window hardening options the shell boots with.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { resolve } from 'path';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { createRequire } from 'module';

const h = vi.hoisted(() => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const protocolHandlers = new Map<string, (request: Request) => Promise<Response>>();
    const windowOn = new Map<string, (...args: unknown[]) => void>();
    const windowOptions: Array<Record<string, unknown>> = [];
    const openExternal = vi.fn();
    const netFetch = vi.fn(async (url: string) => new Response(`fetched:${url}`, { status: 200 }));
    const setWindowOpenHandler = vi.fn();
    return {
        handlers, protocolHandlers, windowOn, windowOptions,
        openExternal, netFetch, setWindowOpenHandler,
    };
});

const userData = mkdtempSync(resolve(tmpdir(), 'august-e24-'));

const electronMock = (() => {
    const webContents = {
        mainFrame: { id: 'main', url: 'app://./index.html' },
        send: vi.fn(),
        setWindowOpenHandler: (fn: unknown) => { h.setWindowOpenHandler(fn); },
        on: (event: string, fn: (...args: unknown[]) => void) => { h.windowOn.set(event, fn); },
        openDevTools: vi.fn(),
    };
    class FakeBrowserWindow {
        webContents = webContents;
        once = vi.fn();
        on = vi.fn();
        setMenuBarVisibility = vi.fn();
        isDestroyed = () => false;
        isMinimized = () => false;
        restore = vi.fn();
        focus = vi.fn();
        maximize = vi.fn();
        show = vi.fn();
        getNormalBounds = () => ({ width: 1200, height: 800, x: 0, y: 0 });
        isMaximized = () => false;
        loadURL = vi.fn(async () => {});
        constructor(options: Record<string, unknown>) {
            h.windowOptions.push(options);
        }
        static getAllWindows = () => [];
    }
    return {
        app: {
            isPackaged: true,
            commandLine: { appendSwitch: vi.fn() },
            getPath: () => userData,
            getVersion: () => '9.9.9',
            requestSingleInstanceLock: () => true,
            on: vi.fn(),
            whenReady: () => Promise.resolve(),
            quit: vi.fn(),
        },
        BrowserWindow: FakeBrowserWindow,
        ipcMain: {
            handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => {
                h.handlers.set(channel, handler);
            },
            on: vi.fn(),
        },
        protocol: {
            registerSchemesAsPrivileged: vi.fn(),
            handle: (scheme: string, handler: (request: Request) => Promise<Response>) => {
                h.protocolHandlers.set(scheme, handler);
            },
        },
        net: { fetch: h.netFetch },
        safeStorage: {
            isEncryptionAvailable: () => true,
            encryptString: (s: string) => Buffer.from(s, 'utf8'),
            decryptString: (b: Buffer) => b.toString('utf8'),
        },
        session: {
            defaultSession: {
                setPermissionRequestHandler: vi.fn(),
                webRequest: { onBeforeRequest: vi.fn() },
            },
        },
        shell: { openExternal: h.openExternal },
        screen: { getAllDisplays: () => [] },
    };
})();

const updaterMock = {
    autoUpdater: {
        autoDownload: false,
        autoInstallOnAppQuit: false,
        on: vi.fn(),
        checkForUpdates: vi.fn(async () => {}),
        downloadUpdate: vi.fn(async () => {}),
        quitAndInstall: vi.fn(),
    },
};

const nodeRequire = createRequire(import.meta.url);
const NodeModule = nodeRequire('module');
const originalLoad = NodeModule._load;
NodeModule._load = function patchedLoad(request: string, parent: unknown, isMain: boolean) {
    if (request === 'electron') return electronMock;
    if (request === 'electron-updater') return updaterMock;
    return originalLoad.call(this, request, parent, isMain);
};

beforeAll(async () => {
    await import('../electron/main.cjs');
    await new Promise<void>(r => setTimeout(r, 0));
});

afterAll(() => {
    NodeModule._load = originalLoad;
    try { rmSync(userData, { recursive: true, force: true }); } catch { /* best-effort */ }
});

describe('the app:// protocol is contained to dist', () => {
    const appHandler = () => h.protocolHandlers.get('app')!;

    it('serves a real dist path through net.fetch', async () => {
        h.netFetch.mockClear();
        const res = await appHandler()(new Request('app://./index.html'));
        expect(res.status).toBe(200);
        expect(h.netFetch).toHaveBeenCalledTimes(1);
        const url = String(h.netFetch.mock.calls[0][0]);
        expect(url).toMatch(/dist\/index\.html$/);
    });

    it('a traversal never reaches net.fetch', async () => {
        h.netFetch.mockClear();
        // An ENCODED slash survives WHATWG URL path normalisation and becomes
        // a separator only at decodeURIComponent — the exact ordering the
        // containment check must survive.
        const res = await appHandler()(new Request('app://./..%2f..%2fpackage.json'));
        expect(res.status).toBe(403);
        expect(h.netFetch).not.toHaveBeenCalled();
    });

    it('a foreign host is not the app origin', async () => {
        const res = await appHandler()(new Request('app://evil/index.html'));
        expect(res.status).toBe(404);
    });

    it('malformed percent-encoding is a 400, not a crash', async () => {
        const res = await appHandler()(new Request('app://./%E0%A4%A'));
        expect(res.status).toBe(400);
    });
});

describe('the navigation and window-open policy', () => {
    it('a foreign navigation is prevented; the app origin is allowed', () => {
        const handler = h.windowOn.get('will-navigate')!;
        const foreign = { preventDefault: vi.fn() };
        handler(foreign, 'https://example.invalid/');
        expect(foreign.preventDefault).toHaveBeenCalledTimes(1);

        const own = { preventDefault: vi.fn() };
        handler(own, 'app://./index.html');
        expect(own.preventDefault).not.toHaveBeenCalled();
    });

    it('external https opens in the OS browser; every window is denied', () => {
        const open = h.setWindowOpenHandler.mock.calls[0][0] as (d: { url: string }) => { action: string };
        expect(open({ url: 'https://example.com/docs' })).toEqual({ action: 'deny' });
        expect(h.openExternal).toHaveBeenCalledWith('https://example.com/docs');
        h.openExternal.mockClear();
        expect(open({ url: 'javascript:alert(1)' })).toEqual({ action: 'deny' });
        expect(h.openExternal).not.toHaveBeenCalled();
    });
});

describe('the shell boots with its hardening options', () => {
    it('floors the window and never flashes white', () => {
        const options = h.windowOptions[0];
        expect(options).toMatchObject({
            minWidth: 800,
            minHeight: 600,
            show: false,
            backgroundColor: '#0b0b0a',
        });
    });
});
