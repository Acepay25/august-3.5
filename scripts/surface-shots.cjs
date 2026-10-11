/** surface-shots — one screenshot per nav surface, at 1440, for the redesign spec.
 *  Reuses render-probe's seeding exactly (profile + mock provider + seeded
 *  verdicts/journal) so every surface has content to render. Writes PNGs to
 *  .probe-artifacts/surface-*.png. Read-only: drives the UI, asserts nothing. */
const { spawn } = require('child_process');
const path = require('path');
const { chromium } = require('@playwright/test');

const PORT = process.env.PROBE_PORT ? Number(process.env.PROBE_PORT) : 4191;
const MOCK_PORT = process.env.MOCK_PORT ? Number(process.env.MOCK_PORT) : 8791;
// LIVE_BASE=http://127.0.0.1:3000 attaches to an ALREADY-RUNNING dev server
// instead of spawning a competing vite (strictPort would just die). The
// browser context is still throwaway — seeding never touches a real profile.
const BASE = process.env.LIVE_BASE || `http://127.0.0.1:${PORT}`;
const ROOT = path.join(__dirname, '..');
const SHOTS = path.join(ROOT, '.probe-artifacts');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForServer(url, timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try { const res = await fetch(url); if (res.ok || res.status === 404) return true; }
        catch { /* not up */ }
        await sleep(250);
    }
    return false;
}

async function seed(page) {
    await page.goto(`${BASE}/favicon.ico`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
        localStorage.clear();
        sessionStorage.clear();
        localStorage.setItem('august_surface_v1', 'trade');
        sessionStorage.setItem('activeUsername', 'Probe User');
    });
    await page.evaluate(async (mockPort) => {
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
        const tx = db.transaction('userProfiles', 'readwrite');
        tx.objectStore('userProfiles').put({
            username: 'Probe User', conversations: [], tradeLog: [], savedAnalyses: [],
            tradeSummaries: [], finalTradeSummary: null, settings: { activeFrameworks: [] },
        });
        await new Promise((resolve) => { tx.oncomplete = () => resolve(); });
        db.close();
        localStorage.setItem('provider_configs_v1', JSON.stringify([{
            id: 'mock', name: 'Mock', apiKey: 'mock-key',
            baseUrl: `http://127.0.0.1:${mockPort}/v1`, apiFormat: 'chat_completions',
            isEnabled: true, isBuiltIn: false, models: ['mock-mini'], selectedModel: 'mock-mini',
        }]));
    }, MOCK_PORT);
    // Seed a populated journal so the Journal surface has rows, and a chat so
    // the Agents surface renders a thread — the spec must judge real screens.
    await page.evaluate(async () => {
        const analysis = (over) => ({
            direction: 'Long', confidence: 'High', coinName: 'BTCUSDT',
            entryPoints: [{ price: '84210.5', description: 'reclaim' }],
            stopLoss: '83100', takeProfit: [{ price: '87900' }], probability: 62,
            reasoning: 'Holding above the 200-EMA into thin sell-side.',
            marketConditions: {}, activeStrategies: [], validationWarnings: [], ...over,
        });
        const row = (id, mins, outcome, type, dir, coin) => ({
            id, outcome, tradeType: type, timestamp: new Date(Date.now() - mins * 60000).toISOString(),
            leverage: 10, analysis: analysis({ direction: dir, coinName: coin }),
        });
        const conv = {
            id: 'shot-conv', timestamp: Date.now() - 600000, title: 'Shot seeded',
            messages: [
                { id: 'm1', role: 'user', text: 'What is the bias here?', createdAt: new Date(Date.now() - 120000).toISOString() },
                { id: 'm2', role: 'ai', text: 'Long bias into the reclaim, stop below the shelf.', createdAt: new Date(Date.now() - 110000).toISOString(), modelsUsed: { mock: 'mock-mini' }, analysis: analysis({}) },
            ],
        };
        const db = await new Promise((resolve, reject) => {
            const request = indexedDB.open('FuturesAI-DB', 1);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
        const store = db.transaction('userProfiles', 'readwrite').objectStore('userProfiles');
        const cur = await new Promise((resolve) => {
            const g = store.get('Probe User'); g.onsuccess = () => resolve(g.result); g.onerror = () => resolve(null);
        });
        store.put({
            ...(cur || { username: 'Probe User' }),
            conversations: [conv], lastActiveConversationId: conv.id,
            tradeLog: [
                row('t1', 300, 'WIN', 'scalp', 'Long', 'BTCUSDT'),
                row('t2', 280, 'LOSS', 'scalp', 'Short', 'BTCUSDT'),
                row('t3', 260, 'WIN', 'swing', 'Long', 'ETHUSDT'),
                row('t4', 240, 'ENTRY_NOT_HIT', 'swing', 'Short', 'SOLUSDT'),
            ],
            savedAnalyses: [], tradeSummaries: [], finalTradeSummary: null,
            settings: { activeFrameworks: [] },
        });
        await new Promise((resolve) => { setTimeout(resolve, 200); });
        db.close();
    });
}

async function main() {
    const viteBin = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
    const server = process.env.LIVE_BASE ? null : spawn(
        process.execPath, [viteBin, '--port', String(PORT), '--strictPort'],
        { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const mock = spawn(process.execPath, [path.join(ROOT, 'scripts', 'mock-provider.cjs'), String(MOCK_PORT)],
        { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let browser;
    try {
        if (!(await waitForServer(BASE)) || !(await waitForServer(`http://127.0.0.1:${MOCK_PORT}/models`))) {
            console.error('SURFACE SHOTS FAIL: server/mock did not come up');
            process.exitCode = 1; return;
        }
        browser = await chromium.launch({ headless: true });
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        const errors = [];
        page.on('pageerror', (e) => errors.push(String(e)));
        await seed(page);
        await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => !document.querySelector('#splash'), null, { timeout: 25000 });
        await page.waitForSelector('[data-testid="nav-rail"]', { timeout: 25000 });
        await sleep(2000);

        const navTo = async (name) => page.evaluate((n) => {
            const re = new RegExp('^' + n, 'i');
            const hit = [...document.querySelectorAll('[data-testid="surface-menu"] button')]
                .find(b => re.test((b.getAttribute('aria-label') || b.textContent || '').trim()));
            if (!hit) return 'not found';
            hit.click();
            return 'clicked';
        }, name);

        for (const surface of ['Trade', 'Journal', 'Skills', 'Chat', 'Learn']) {
            const how = await navTo(surface);
            await sleep(2500); // let lazy chunks + data settle
            // Settings overlay, opened the way a person does, for the spec.
            await page.screenshot({ path: path.join(SHOTS, `surface-${surface.toLowerCase()}.png`) });
            console.log(`  ${surface}: ${how} -> surface-${surface.toLowerCase()}.png`);
        }
        // Settings modal — opened the way a person does (the rail button);
        // there is no #/settings hash route, and the overlay mounts outside
        // <main> regardless.
        await page.locator('[data-testid="nav-settings"]').last().click();
        await page.waitForSelector('[aria-labelledby="settings-title"]', { timeout: 15000 });
        await sleep(1500);
        await page.screenshot({ path: path.join(SHOTS, 'surface-settings.png') });
        console.log('  Settings -> surface-settings.png');
        await page.keyboard.press('Escape');
        console.log(`pageerrors: ${errors.length}`);
        if (errors.length) console.log(errors.slice(0, 3).join('\n'));
    } catch (err) {
        console.error('SURFACE SHOTS FAIL:', err && err.stack || err);
        process.exitCode = 1;
    } finally {
        if (browser) await browser.close();
        if (server) server.kill();
        mock.kill();
    }
}
main().catch((e) => { console.error(e); process.exit(1); });
