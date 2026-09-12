/**
 * boot-probe — verify the PRODUCTION bundle boots, not just the dev server.
 *
 * Why this exists (v1.0.20 lesson): the e2e smoke runs `npm run dev`, and a
 * prod-only TDZ/cyclic-import crash (splash hang) shipped past it once. This
 * probe serves `dist/` through vite preview and drives the real app with
 * Playwright: seeds a profile so the user modal is skipped, lands on the
 * Trade surface (which lazy-imports chatStore / levelWatchService /
 * tradePlanLevels / the Chart AI dock), and fails on ANY pageerror — plus a
 * double-sample so a post-mount crash can't slip through between "rendered"
 * and "reported".
 *
 * Usage:  npm run build && node scripts/boot-probe.cjs
 * (self-hosts vite preview on PROBE_PORT, default 4183; exits non-zero on
 * failure — safe to wire into release CI)
 */

const { spawn } = require('child_process');
const { chromium } = require('@playwright/test');

const PORT = process.env.PROBE_PORT ? Number(process.env.PROBE_PORT) : 4183;
const BASE = `http://127.0.0.1:${PORT}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForServer(url, timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const res = await fetch(url);
            if (res.ok || res.status === 404) return true;
        } catch { /* not up yet */ }
        await sleep(250);
    }
    return false;
}

/** Seed the same FuturesAI-DB profile store the e2e smoke uses, then flip
 *  the profile marker + surface BEFORE the app bundle evaluates. */
async function seedProfile(page) {
    await page.goto(`${BASE}/favicon.ico`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
        localStorage.clear();
        sessionStorage.clear();
        localStorage.setItem('last_active_user', 'Probe User');
        localStorage.setItem('august_surface_v1', 'trade');
        sessionStorage.setItem('activeUsername', 'Probe User');
    });
    await page.evaluate(async () => {
        const db = await new Promise((resolve, reject) => {
            const request = indexedDB.open('FuturesAI-DB', 1);
            request.onupgradeneeded = () => {
                if (!request.result.objectStoreNames.contains('userProfiles')) {
                    request.result.createObjectStore('userProfiles', { keyPath: 'username' });
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
        const transaction = db.transaction('userProfiles', 'readwrite');
        transaction.objectStore('userProfiles').put({
            username: 'Probe User',
            conversations: [],
            tradeLog: [],
            savedAnalyses: [],
            tradeSummaries: [],
            finalTradeSummary: null,
            settings: { activeFrameworks: [] },
        });
        await new Promise((resolve, reject) => {
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
        db.close();
    });
}

async function main() {
    // PROBE_REUSE=1 → expect a vite preview already serving BASE (dev loop).
    // Spawn vite's bin through node directly (no shell) so the finally-kill
    // reaps vite itself, not just an npx wrapper whose child would orphan
    // and hang this script on Windows.
    const VITE_BIN = require('path').join(__dirname, '..', 'node_modules', 'vite', 'bin', 'vite.js');
    const server = process.env.PROBE_REUSE
        ? null
        : spawn(process.execPath, [VITE_BIN, 'preview', '--port', String(PORT), '--strictPort'], {
            cwd: require('path').join(__dirname, '..'),
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
        });
    let serverOut = '';
    if (server) {
        server.stdout.on('data', (d) => { serverOut += String(d); });
        server.stderr.on('data', (d) => { serverOut += String(d); });
    }

    try {
        if (!(await waitForServer(BASE))) {
            console.error('BOOT PROBE FAIL: vite preview never came up on', BASE, '\n', serverOut);
            process.exit(1);
        }
        console.log('[probe] server reachable');

        const browser = await chromium.launch({ headless: true });
        console.log('[probe] browser launched');
        const page = await browser.newPage();
        const pageErrors = [];
        page.on('pageerror', (err) => pageErrors.push(String(err && err.stack || err)));

        await seedProfile(page);
        console.log('[probe] profile seeded');
        await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });

        // Splash must clear (the v1.0.20 crash symptom WAS a splash hang)…
        await page.waitForFunction(() => !document.querySelector('#splash'), null, { timeout: 20000 });
        // …and the lazy Trade surface must actually mount — this loads the
        // new chatStore/levelWatch modules from the PRODUCTION chunks.
        await page.waitForSelector('[data-testid="trade-view"]', { timeout: 20000 });

        // Double-sample liveness: the surface is still there seconds later
        // (a post-mount TDZ/abort crash would take the tree down or hang).
        await sleep(3000);
        const aliveAfter = await page.locator('[data-testid="trade-view"]').count();
        const dockCount = await page.locator('[data-testid="trade-chat-panel"]').count();

        await browser.close();

        if (pageErrors.length > 0) {
            console.error('BOOT PROBE FAIL: page errors during prod boot:');
            for (const e of pageErrors) console.error('---\n' + e);
            process.exit(1);
        }
        if (aliveAfter !== 1) {
            console.error('BOOT PROBE FAIL: trade surface gone on the liveness re-sample');
            process.exit(1);
        }
        if (dockCount < 1) {
            console.error('BOOT PROBE FAIL: Chart AI dock did not render');
            process.exit(1);
        }
        console.log('BOOT PROBE OK — prod bundle boots, trade surface + Chart AI dock render, zero pageerrors.');
    } finally {
        if (server) server.kill('SIGTERM');
    }
}

main().catch((err) => {
    console.error('BOOT PROBE FAIL (driver):', err);
    process.exit(1);
});
