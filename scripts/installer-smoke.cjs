/**
 * installer-smoke — verify the PACKAGED Electron app actually boots and
 * renders the production Trade surface + Chart AI dock.
 *
 * Why this exists (v1.0.20 / v1.0.25 lessons):
 *   - The e2e smoke runs against `vite preview` against the production
 *     renderer bundle, and the boot-probe does the same. Both miss class of
 *     bugs that only surface inside the packaged Electron runtime: the
 *     app:// custom protocol registration, safeStorage availability, the
 *     auto-update IPC handshake, the packaged main-process provider wire,
 *     and the window-state persistence path.
 *   - v1.0.20 shipped a splash hang whose root cause was a prod-only TDZ
 *     crash inside the packaged main → app:// → renderer chain. v1.0.25
 *     shipped a desktop CoT-echo bug and a price-staleness bug whose
 *     renderer-only tests passed. Real installs caught both.
 *
 * Usage:
 *   # Build (electron-builder --dir) + probe in one shot:
 *   node scripts/installer-smoke.cjs
 *
 *   # CI step: reuse a previously built exe (set this in your workflow
 *   # when the same runner already ran `electron-builder`):
 *   AUGUST_SMOKE_APP=dist_electron/win-unpacked/August Trading.exe \
 *       node scripts/installer-smoke.cjs
 *
 * Behavior:
 *   - Builds the unpacked Electron app to dist_electron/ (electron-builder
 *     --dir) when AUGUST_SMOKE_APP is not set.
 *   - Creates a SCRATCH user-data-dir under the OS temp dir; never touches
 *     the real %APPDATA%/August Trading folder.
 *   - Spawns the packaged exe with AUGUST_SMOKE_TEST=1,
 *     --remote-debugging-port=<port>, and the scratch user-data-dir.
 *   - Connects Playwright over CDP, seeds the same profile the renderer
 *     smoke uses, and verifies the DETERMINISTIC boot contract:
 *       * splash element is removed,
 *       * [data-testid="trade-view"] mounts,
 *       * [data-testid="trade-chat-panel"] mounts,
 *       * no pageerror and no main-process crash banner fires,
 *       * every app:// (packaged-resource) load succeeds,
 *       * both surfaces survive a 3-second liveness re-sample.
 *     console.error/warning diagnostics are RETAINED and printed in full
 *     before the verdict, but never gate it — network unavailability
 *     (offline runner, CORS from origins that don't whitelist `app://`,
 *     DNS) is environmental and must not fail a boot smoke.
 *   - Quits the app cleanly (IPC `app:quit` preferred, fallback SIGTERM),
 *     removes the scratch user-data-dir, and exits non-zero on any
 *     failure.
 */

const { spawn, spawnSync } = require('child_process');
const { chromium } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CDP_PORT = Number(process.env.AUGUST_SMOKE_CDP_PORT || 9222);
const SCRATCH_PARENT = path.join(os.tmpdir(), 'august-smoke');
const APP_ID = 'august-smoke';
const APP_PRODUCT = 'August Trading';

let failed = false;
let scratchDir = null;
let exePath = null;
let appProcess = null;
const failures = [];

function fail(msg, err) {
    failed = true;
    failures.push(err ? `${msg}: ${err.stack || err}` : msg);
    console.error(`INSTALLER SMOKE FAIL: ${msg}`, err ? err.stack || err : '');
}

async function resolveExePath() {
    if (process.env.AUGUST_SMOKE_APP) {
        const p = path.resolve(process.env.AUGUST_SMOKE_APP);
        if (!fs.existsSync(p)) throw new Error(`AUGUST_SMOKE_APP does not exist: ${p}`);
        return p;
    }
    // electron-builder --dir writes to dist_electron/win-unpacked/<product>.exe.
    const candidates = [
        path.resolve('dist_electron', 'win-unpacked', `${APP_PRODUCT}.exe`),
        path.resolve('dist_electron', `${APP_PRODUCT}.exe`),
        path.resolve('dist_electron', 'win-unpacked', 'AugustTrading.exe'),
        path.resolve('dist_electron', 'AugustTrading.exe'),
    ];
    for (const p of candidates) {
        if (fs.existsSync(p)) return p;
    }
    throw new Error(`No packaged exe found. Looked at: ${candidates.join(', ')}. ` +
        `Either build with \`electron-builder --dir\` first or set AUGUST_SMOKE_APP.`);
}

async function buildExe() {
    console.log('[smoke] building unpacked Electron app (electron-builder --dir)…');
    const r = spawnSync(process.execPath, [
        path.join(__dirname, '..', 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js'),
        '--dir',
        '--win',
    ], {
        cwd: path.resolve(__dirname, '..'),
        stdio: 'inherit',
        windowsHide: true,
        env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
    });
    if (r.status !== 0) throw new Error(`electron-builder exited with ${r.status}`);
}

async function waitForCdp(port, timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs;
    const url = `http://127.0.0.1:${port}/json/version`;
    while (Date.now() < deadline) {
        try {
            const res = await fetch(url);
            if (res.ok) {
                const body = await res.json();
                if (body.webSocketDebuggerUrl) return body;
            }
        } catch { /* CDP not ready yet */ }
        await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`CDP did not come up on ${url} within ${timeoutMs}ms`);
}

async function waitFor(predicate, timeoutMs = 20000, intervalMs = 250) {
    const deadline = Date.now() + timeoutMs;
    let last;
    while (Date.now() < deadline) {
        try {
            const v = await predicate();
            if (v) return v;
            last = v;
        } catch (e) {
            last = e;
        }
        await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Error(`waitFor timed out after ${timeoutMs}ms (last=${JSON.stringify(last)})`);
}

// Only runtime fatal-error banners gate stderr; ordinary Chromium/network
// diagnostics are still printed, but are not evidence of a failed boot.
function isMainProcessFatal(text) {
    return /App threw an error during load|Uncaught Exception:|UnhandledPromiseRejection(?:Warning|:)/i.test(text);
}

async function seedProfile(page) {
    // addInitScript runs before any page script on every navigation, so the
    // first render already sees the seeded profile and skips the user-modal.
    await page.addInitScript(() => {
        try {
            localStorage.clear();
            sessionStorage.clear();
            localStorage.setItem('last_active_user', 'Probe User');
            localStorage.setItem('august_surface_v1', 'trade');
            sessionStorage.setItem('activeUsername', 'Probe User');
            // IndexedDB seed is async; fire-and-forget. The store is created
            // on first read if missing, so this is safe even on the very
            // first navigation where the DB hasn't been opened yet.
            const request = indexedDB.open('FuturesAI-DB', 1);
            request.onupgradeneeded = () => {
                if (!request.result.objectStoreNames.contains('userProfiles')) {
                    request.result.createObjectStore('userProfiles', { keyPath: 'username' });
                }
            };
            request.onsuccess = () => {
                try {
                    const db = request.result;
                    const tx = db.transaction('userProfiles', 'readwrite');
                    tx.objectStore('userProfiles').put({
                        username: 'Probe User',
                        conversations: [], tradeLog: [], savedAnalyses: [],
                        tradeSummaries: [], finalTradeSummary: null,
                        settings: { activeFrameworks: [] },
                    });
                    tx.oncomplete = () => db.close();
                } catch { /* a later reload will re-seed */ }
            };
        } catch { /* init-script failure should not crash the probe */ }
    });
}

async function launchApp(exe, userDataDir) {
    const args = [
        `--user-data-dir=${userDataDir}`,
        `--remote-debugging-port=${CDP_PORT}`,
        // --no-sandbox is required when running headless on CI as root /
        // elevated; harmless on Windows-latest.
        '--no-sandbox',
        '--disable-gpu',
    ];
    console.log(`[smoke] launching ${exe}`);
    const child = spawn(exe, args, {
        cwd: path.dirname(exe),
        env: {
            ...process.env,
            AUGUST_SMOKE_TEST: '1',
            ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
    });
    let stderr = '';
    child.stdout.on('data', (d) => process.stdout.write(`[app] ${d}`));
    child.stderr.on('data', (d) => { stderr += String(d); process.stderr.write(`[app!] ${d}`); });
    child.on('error', (err) => fail('packaged main process error', err));
    child.on('exit', (code, signal) => {
        console.log(`[smoke] app exited code=${code} signal=${signal}`);
    });
    // Keep the live buffer, including banners split across stderr chunks.
    appProcess = { child, get stderr() { return stderr; } };
    await waitForCdp(CDP_PORT, 30000);
    return child;
}

async function killApp() {
    if (!appProcess || !appProcess.child) return;
    const { child } = appProcess;
    if (process.platform === 'win32') {
        // tree-kill via taskkill so any child renderers are reaped too.
        try { spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* ignore */ }
    } else {
        try { child.kill('SIGTERM'); } catch { /* ignore */ }
    }
}

function cleanup() {
    if (scratchDir) {
        try { fs.rmSync(scratchDir, { recursive: true, force: true }); } catch { /* best-effort */ }
        scratchDir = null;
    }
}

async function main() {
    try {
        fs.mkdirSync(SCRATCH_PARENT, { recursive: true });
        scratchDir = fs.mkdtempSync(path.join(SCRATCH_PARENT, `${APP_ID}-${process.pid}-`));
        console.log(`[smoke] scratch user-data: ${scratchDir}`);

        if (!process.env.AUGUST_SMOKE_APP) {
            await buildExe();
        }
        exePath = await resolveExePath();
        console.log(`[smoke] exe: ${exePath}`);

        await launchApp(exePath, scratchDir);
        console.log('[smoke] CDP up');

        const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
        // Wait for the first renderer page (Electron's main BrowserWindow).
        let page = null;
        const pageErrors = [];
        await waitFor(() => {
            const contexts = browser.contexts();
            for (const ctx of contexts) {
                for (const p of ctx.pages()) {
                    if (p.url().startsWith('app://')) {
                        page = p;
                        return true;
                    }
                }
            }
            return false;
        }, 30000, 500);

        if (!page) throw new Error('No app:// page found over CDP within 30s');
        console.log(`[smoke] connected to ${page.url()}`);

        // The seeded reload must not cancel first-navigation asset requests.
        await page.waitForLoadState('load');
        const appResourceFailures = [];
        page.on('pageerror', (err) => pageErrors.push(String(err && err.stack || err)));
        page.on('console', (msg) => {
            if (msg.type() === 'error' || msg.type() === 'warning') {
                // Diagnostics only: boot health must not depend on network
                // availability. Packaged resource failures are checked by URL.
                console.error(`[renderer ${msg.type()}] ${msg.text()}`);
            }
        });
        // A failed PACKAGED resource (missing production chunk, 404 on an
        // app:// URL) is a build bug — deterministic, so it gates. Failures
        // on https:// (market data, providers) are environmental and do not.
        page.on('requestfailed', (request) => {
            if (request.url().startsWith('app://')) {
                appResourceFailures.push(`${request.url()} → ${request.failure()?.errorText || 'unknown error'}`);
            }
        });
        // The app protocol handler can also return 404/403 Responses without
        // a network-level failure; catch those via the response event.
        page.on('response', (response) => {
            if (response.url().startsWith('app://') && response.status() >= 400) {
                appResourceFailures.push(`${response.url()} → HTTP ${response.status()}`);
            }
        });

        await seedProfile(page);
        // Reload so the seed (set by addInitScript before each navigation) is
        // visible to the app's first real render.
        await page.reload({ waitUntil: 'domcontentloaded' });
        console.log('[smoke] reloaded with seeded profile');

        // Splash must clear (v1.0.20 symptom)…
        await waitFor(async () => (await page.locator('#splash').count()) === 0, 20000);
        // …and the lazy Trade surface must actually mount — this loads the
        // chatStore / levelWatch modules from the PRODUCTION chunks.
        await waitFor(async () => (await page.locator('[data-testid="trade-view"]').count()) === 1, 20000);
        const dockInitial = await page.locator('[data-testid="trade-chat-panel"]').count();
        if (dockInitial < 1) throw new Error('Chart AI dock did not render on first paint');

        // Double-sample liveness (post-mount TDZ/abort crash would take the
        // tree down or hang within seconds).
        await new Promise((r) => setTimeout(r, 3000));
        const tradeAfter = await page.locator('[data-testid="trade-view"]').count();
        const dockAfter = await page.locator('[data-testid="trade-chat-panel"]').count();
        if (tradeAfter !== 1) throw new Error(`Trade surface gone on liveness re-sample (count=${tradeAfter})`);
        if (dockAfter < 1) throw new Error(`Chart AI dock gone on liveness re-sample (count=${dockAfter})`);

        if (pageErrors.length > 0) {
            console.error('INSTALLER SMOKE FAIL: page errors during packaged boot:');
            for (const e of pageErrors) console.error('---\n' + e);
            throw new Error(`${pageErrors.length} pageerror(s) during packaged boot`);
        }

        if (appResourceFailures.length > 0) {
            throw new Error(`Packaged resource failures: ${appResourceFailures.join('; ')}`);
        }

        if (isMainProcessFatal(appProcess.stderr)) {
            throw new Error(`Main-process fatal banner in stderr: ${appProcess.stderr.slice(-400)}`);
        }

        await browser.close();
        console.log('INSTALLER SMOKE OK — packaged Electron boots, Trade surface + Chart AI dock render, zero pageerrors.');
    } catch (err) {
        fail(err.message || String(err), err);
    } finally {
        try { await killApp(); } catch (e) { fail('killApp failed', e); }
        cleanup();
    }

    if (failed) {
        console.error('---');
        console.error(`INSTALLER SMOKE FAILED (${failures.length} failure(s))`);
        for (const f of failures) console.error(' - ' + f.split('\n')[0]);
        process.exit(1);
    }
    process.exit(0);
}

// Belt-and-suspenders: main() handles its own failures; reaching the catch
// below means something threw OUTSIDE its try (e.g. module load).
main().catch((err) => {
    fail('top-level driver threw', err);
    try { killApp(); } catch { /* ignore */ }
    cleanup();
    console.error('INSTALLER SMOKE FAILED (driver)');
    process.exit(1);
});
