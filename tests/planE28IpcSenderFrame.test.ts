/**
 * E-28 — the sender-frame guard on every IPC handler.
 *
 * `electron/main.cjs` exposes the preload bridge to whatever document is
 * loaded in the window, so "which frame asked" is the only thing that tells
 * the app apart from something that merely looks like it. Before this, NOT
 * ONE of the eleven privileged channels validated `event.senderFrame`.
 *
 * This suite loads the REAL `electron/main.cjs` with `electron` and
 * `electron-updater` mocked, so the handlers are the ones that ship. It then
 * invokes them with three kinds of sender:
 *
 *   · the app window's MAIN frame      → the handler runs (contract intact)
 *   · a FOREIGN frame (an iframe)     → refused, and the handler body NEVER
 *                                       runs (the privileged action does not
 *                                       happen — that is the real assertion,
 *                                       not just the return value)
 *   · a same-origin but DIFFERENT frame → also refused, because the check is
 *                                       by frame identity, not by origin
 *
 * It is deliberately a BEHAVIOURAL test: a source-text assertion could only
 * prove the guard was mentioned, not that it fires.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';

const h = vi.hoisted(() => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const listeners = new Map<string, (event: unknown) => void>();
    const calls = { netFetch: 0, quitAndInstall: 0, encryptString: 0 };
    /** The app window's main frame — the ONLY trusted sender. */
    const MAIN_FRAME = { id: 'main-frame', url: 'app://./index.html' };
    /** A foreign frame: a different frame object, possibly a remote document. */
    const FOREIGN_FRAME = { id: 'foreign-frame', url: 'https://example.invalid/' };
    /** Same ORIGIN as the app, different frame object — an iframe. */
    const SAME_ORIGIN_IFRAME = { id: 'same-origin-iframe', url: 'app://./index.html' };
    return { handlers, listeners, calls, MAIN_FRAME, FOREIGN_FRAME, SAME_ORIGIN_IFRAME };
});

/** The fake `electron` module main.cjs will receive for `require('electron')`. */
const electronMock = (() => {
    const webContents = {
        mainFrame: h.MAIN_FRAME,
        send: vi.fn(),
        setWindowOpenHandler: vi.fn(),
        on: vi.fn(),
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
        loadURL = vi.fn(async () => { });
        static getAllWindows = () => [];
    }
    return {
        app: {
            isPackaged: true,
            commandLine: { appendSwitch: vi.fn() },
            // A path that does not exist: the module-level legacy-userData
            // migration only ever READS the filesystem here, but the test
            // must never be able to write to a real profile.
            getPath: () => resolve('C:', 'august-e28-test', 'no-such-userdata'),
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
            on: (channel: string, listener: (event: unknown) => void) => {
                h.listeners.set(channel, listener);
            },
        },
        protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() },
        net: {
            fetch: vi.fn(async () => {
                h.calls.netFetch += 1;
                return { ok: true, status: 200, text: async () => '', body: null };
            }),
        },
        safeStorage: {
            isEncryptionAvailable: () => true,
            encryptString: (s: string) => { h.calls.encryptString += 1; return Buffer.from(s, 'utf8'); },
            decryptString: (b: Buffer) => b.toString('utf8'),
        },
        session: {
            defaultSession: {
                setPermissionRequestHandler: vi.fn(),
                webRequest: { onBeforeRequest: vi.fn() },
            },
        },
        shell: { openExternal: vi.fn() },
        screen: { getAllDisplays: () => [] },
    };
})();

const updaterMock = {
    autoUpdater: {
        autoDownload: false,
        autoInstallOnAppQuit: false,
        on: vi.fn(),
        checkForUpdates: vi.fn(async () => { }),
        downloadUpdate: vi.fn(async () => { }),
        quitAndInstall: vi.fn(() => { h.calls.quitAndInstall += 1; }),
    },
};

/**
 * `electron/main.cjs` is CommonJS and calls `require('electron')` at load
 * time. Vitest's `vi.mock` only covers ESM imports, and `electron` is an
 * externalized node_modules package, so the real one would be executed (and
 * it throws outside an Electron runtime). Intercept the CommonJS loader
 * instead — the module main.cjs actually asks for.
 */
const nodeRequire = createRequire(import.meta.url);
const NodeModule = nodeRequire('module');
const originalLoad = NodeModule._load;
NodeModule._load = function patchedLoad(request: string, parent: unknown, isMain: boolean) {
    if (request === 'electron') return electronMock;
    if (request === 'electron-updater') return updaterMock;
    return originalLoad.call(this, request, parent, isMain);
};

const mainSource = readFileSync(resolve(__dirname, '..', 'electron', 'main.cjs'), 'utf8');

/** Every channel the preload bridge can reach. */
const PRELOAD_CHANNELS = [
    'update:check',
    'update:download',
    'update:install',
    'update:get-status',
    'app:get-version',
    'provider:discover',
    'provider:chat',
    'provider:cancel',
    'crypto:encrypt',
    'crypto:decrypt',
];

beforeAll(async () => {
    // Loading the real main process registers the handlers.
    await import('../electron/main.cjs');
    // app.whenReady().then(...) → createWindow() + setupAutoUpdater().
    await new Promise<void>(resolve => setTimeout(resolve, 0));
});

afterAll(() => {
    NodeModule._load = originalLoad;
});

describe('E-28 — every IPC handler refuses a frame that is not the app window', () => {
    it('registers a handler for every channel the preload can reach', () => {
        for (const channel of PRELOAD_CHANNELS) {
            expect(h.handlers.has(channel), `no handler registered for ${channel}`).toBe(true);
        }
        // The one fire-and-forget channel.
        expect(h.listeners.has('update:quit-now')).toBe(true);
    });

    it('refuses EVERY handle channel from a foreign frame', async () => {
        for (const channel of PRELOAD_CHANNELS) {
            const handler = h.handlers.get(channel)!;
            const result = await handler({ senderFrame: h.FOREIGN_FRAME }, 'arg');
            // A refusal is never a success: no handler may report "ok" to a
            // frame the app does not own.
            expect(result, `${channel} returned a value to a foreign frame`).not.toBe(true);
            if (result && typeof result === 'object' && 'ok' in result) {
                expect((result as { ok: boolean }).ok, `${channel} reported ok to a foreign frame`).toBe(false);
            }
        }
    });

    it('refuses a same-origin IFRAME too — the check is frame identity, not origin', async () => {
        const encrypt = h.handlers.get('crypto:encrypt')!;
        const result = await encrypt({ senderFrame: h.SAME_ORIGIN_IFRAME }, 'secret');
        expect(result).toBeNull();
    });

    it('refuses a frame with NO senderFrame at all', async () => {
        const encrypt = h.handlers.get('crypto:encrypt')!;
        expect(await encrypt({}, 'secret')).toBeNull();
        expect(await encrypt(undefined, 'secret')).toBeNull();
    });

    it('the privileged action NEVER HAPPENS for a foreign frame', async () => {
        // The strongest assertion: the handler body is not entered at all,
        // so nothing privileged runs — not "it ran and returned an error".
        const before = h.calls.netFetch;
        const chat = h.handlers.get('provider:chat')!;
        const result = await chat(
            { senderFrame: h.FOREIGN_FRAME, sender: {} },
            { config: { baseUrl: 'https://api.example.com/v1', selectedModel: 'm', apiFormat: 'chat_completions' }, messages: [] },
        );
        expect(h.calls.netFetch).toBe(before);
        expect(result).toMatchObject({ ok: false });
        expect((result as { message: string }).message).toMatch(/refused/i);

        // The crypto bridge is the other privileged surface.
        const encryptBefore = h.calls.encryptString;
        await h.handlers.get('crypto:encrypt')!({ senderFrame: h.FOREIGN_FRAME }, 'api-key');
        expect(h.calls.encryptString).toBe(encryptBefore);
    });

    it('the refusal SHAPE matches each handler own failure path, so the renderer contract is unchanged', async () => {
        const event = { senderFrame: h.FOREIGN_FRAME };
        // The crypto calls return null on their own failure.
        expect(await h.handlers.get('crypto:encrypt')!(event, 'x')).toBeNull();
        expect(await h.handlers.get('crypto:decrypt')!(event, 'enc:v1:xx')).toBeNull();
        // The boolean calls return false.
        expect(await h.handlers.get('provider:cancel')!(event, 'req-1')).toBe(false);
        expect(await h.handlers.get('update:install')!(event)).toBe(false);
        // The provider calls return {ok:false, message}.
        expect(await h.handlers.get('provider:chat')!(event, {})).toMatchObject({ ok: false });
        expect(await h.handlers.get('provider:discover')!(event, {})).toMatchObject({ ok: false });
        // The update calls return the status object.
        expect(await h.handlers.get('update:get-status')!(event)).toMatchObject({ status: expect.any(String) });
    });
});

describe('E-28 — the trusted path is untouched', () => {
    it('the app window main frame reaches the handler body', async () => {
        const event = { senderFrame: h.MAIN_FRAME };
        // crypto:encrypt is the cheapest privileged call that proves the
        // body ran: it returns the encrypted envelope.
        const encrypted = await h.handlers.get('crypto:encrypt')!(event, 'api-key');
        expect(typeof encrypted).toBe('string');
        expect(String(encrypted).startsWith('enc:v1:')).toBe(true);
        expect(h.calls.encryptString).toBeGreaterThan(0);
    });

    it('app:get-version still returns the version for the trusted frame', async () => {
        expect(await h.handlers.get('app:get-version')!({ senderFrame: h.MAIN_FRAME })).toBe('9.9.9');
    });
});

describe('E-28 — the update:quit-now listener checks the frame BEFORE it can quit', () => {
    // This one channel is an ipcMain.on (fire-and-forget), so it has no
    // return value to assert — the guard's ORDER is the assertion. (The
    // channel-COVERAGE half — every channel registered through the guard —
    // is pinned by tests/electronIpcContract.test.ts; this file is about the
    // guard FIRING.)
    it('the guard runs before the quit path', () => {
        const idx = mainSource.indexOf("ipcMain.on('update:quit-now'");
        expect(idx).toBeGreaterThan(-1);
        const block = mainSource.slice(idx, idx + 420);
        const guardAt = block.indexOf('isTrustedSenderFrame(event)');
        const quitAt = block.indexOf('pendingInstallerQuit');
        expect(guardAt).toBeGreaterThan(-1);
        expect(quitAt).toBeGreaterThan(-1);
        expect(guardAt).toBeLessThan(quitAt);
    });

    it('a foreign frame cannot fire the quit listener', () => {
        const listener = h.listeners.get('update:quit-now');
        expect(listener).toBeTypeOf('function');
        const before = h.calls.quitAndInstall;
        listener!({ senderFrame: h.FOREIGN_FRAME });
        expect(h.calls.quitAndInstall).toBe(before);
    });
});
