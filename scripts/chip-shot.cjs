/** chip-shot — opens the dock composer's model+effort chip against a dense
 *  provider list (the exact overflow case: 24 models on one provider) and
 *  screenshots the OPEN popover, then the search-filtered state. Attaches to
 *  LIVE_BASE when set (the running dev server); otherwise spawns nothing —
 *  point it at any running instance. Throws if the popover overflows the
 *  viewport (the bug this guards: bottom-anchored + unbounded height). */
const { chromium } = require('@playwright/test');
const path = require('path');

const BASE = process.env.LIVE_BASE || 'http://127.0.0.1:4193';
const SHOTS = path.join(__dirname, '..', '.probe-artifacts');
const MODELS = [
    'GLM 5.3 Flash', 'GLM 5.3 Flashx', 'Kimi K3', 'GLM 5.3', 'Mimo V2.6 Flash',
    'Mimo V2.5 Pro', 'Mimo V2.5', 'Kimi K2.8 Preview', 'Kimi K2.6', 'Hy3',
    'Qwen3.8 Flash', 'Qwen3.8 Max', 'Qwen3.8 27b', 'Jev 113.0', 'Deepseek V4.1 Flash',
    'Deepseek V4 Pro', 'Jev Latest', 'Mimo V2.6 Pro', 'Kimi K2.2', 'GLM 4.6',
    'Deepseek V3.2', 'Qwen3.8 Coder', 'Jev 112.0', 'Kimi K1.5',
];

(async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${BASE}/favicon.ico`, { waitUntil: 'domcontentloaded' });
    await page.evaluate((models) => {
        localStorage.clear();
        sessionStorage.clear();
        localStorage.setItem('august_surface_v1', 'trade');
        sessionStorage.setItem('activeUsername', 'Probe User');
        localStorage.setItem('provider_configs_v1', JSON.stringify([{
            id: 'bai', name: 'B.AI', apiKey: 'k', baseUrl: 'http://127.0.0.1:9/v1',
            apiFormat: 'chat_completions', isEnabled: true, isBuiltIn: false,
            models, selectedModel: 'GLM 5.3 Flash',
        }]));
    }, MODELS);
    // A profile, or the app opens on the profile-selection overlay and the
    // dock behind it is unreachable.
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
        const tx = db.transaction('userProfiles', 'readwrite');
        tx.objectStore('userProfiles').put({
            username: 'Probe User', conversations: [], tradeLog: [],
            tradeSummaries: [], finalTradeSummary: null, settings: { activeFrameworks: [] },
        });
        await new Promise((resolve) => { tx.oncomplete = () => resolve(); });
        db.close();
    });
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !document.querySelector('#splash'), null, { timeout: 25000 });
    await page.waitForSelector('[data-testid="composer-model-chip"]', { timeout: 25000 });
    await page.click('[data-testid="composer-model-chip"]');
    await page.waitForSelector('[data-testid="composer-model-menu"]', { timeout: 5000 });
    await page.screenshot({ path: path.join(SHOTS, 'chip-open.png') });
    // The popover must fit the viewport, whatever the list length.
    const fit = await page.evaluate(() => {
        const r = document.querySelector('[data-testid="composer-model-menu"]').getBoundingClientRect();
        return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: window.innerHeight };
    });
    console.log(`model popover top=${fit.top} bottom=${fit.bottom} viewport=${fit.vh} ` +
        (fit.top >= 0 && fit.bottom <= fit.vh ? 'FITS' : 'OVERFLOWS'));
    // Star the third row, prove it fills and sorts first.
    await page.locator('[data-testid="composer-model-menu"] button[aria-label^="Star"]').nth(2).click();
    await page.screenshot({ path: path.join(SHOTS, 'chip-starred.png') });
    // Search filters.
    await page.fill('[data-testid="composer-model-menu"] input', 'kimi');
    await page.screenshot({ path: path.join(SHOTS, 'chip-search.png') });
    // The effort chip is its own popover now.
    await page.keyboard.press('Escape');
    await page.click('[data-testid="composer-effort-chip"]');
    await page.waitForSelector('[data-testid="effort-menu"]', { timeout: 5000 });
    await page.screenshot({ path: path.join(SHOTS, 'chip-effort.png') });
    await browser.close();
    if (fit.top < 0 || fit.bottom > fit.vh) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
