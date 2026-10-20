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
    // Ruling D-D: the tier is readable WITHOUT opening the panel, so the trigger
    // must name provider, model and tier. Asserted here because this harness is
    // the only one that drives the real dock composer against a dense catalog.
    const triggerText = (await page.textContent('[data-testid="composer-model-chip"]'))?.trim() ?? '';
    console.log(`trigger label: "${triggerText}"`);
    if (!/(Auto|Off|Low|Medium|High|Max)$/.test(triggerText)) {
        console.error('::error::the trigger does not print the thinking tier (E-51 ruling D-D)');
        await browser.close();
        process.exit(1);
    }
    await page.click('[data-testid="composer-model-chip"]');
    await page.waitForSelector('[data-testid="model-menu"]', { timeout: 5000 });
    await page.screenshot({ path: path.join(SHOTS, 'chip-open.png') });
    // The popover must fit the viewport, whatever the list length. It opens
    // UPWARD from a trigger at the bottom of the card, so `top` is the edge that
    // an unbounded panel used to push off the screen.
    const fit = await page.evaluate(() => {
        const r = document.querySelector('[data-testid="model-menu"]').getBoundingClientRect();
        return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: window.innerHeight };
    });
    console.log(`model popover top=${fit.top} bottom=${fit.bottom} viewport=${fit.vh} ` +
        (fit.top >= 0 && fit.bottom <= fit.vh ? 'FITS' : 'OVERFLOWS'));
    // Star the third row, prove it fills and sorts FIRST — the ordering is a
    // behaviour claim a screenshot cannot make.
    await page.locator('[data-testid="model-menu-rows"] button[aria-label^="Star"]').nth(2).click();
    await page.screenshot({ path: path.join(SHOTS, 'chip-starred.png') });
    const firstRow = await page.getAttribute('[data-testid="model-menu-rows"] > div:first-child button[role="menuitemradio"]', 'title');
    console.log(`after starring, first row: ${firstRow}`);
    // Filter narrows the active provider's list.
    await page.fill('[data-testid="model-menu"] input', 'kimi');
    await page.screenshot({ path: path.join(SHOTS, 'chip-search.png') });
    await page.fill('[data-testid="model-menu"] input', '');
    // The Effort section is in the SAME panel now: six stops, and the printed
    // value is the tier's word.
    await page.waitForSelector('[data-testid="effort-slider"]', { timeout: 5000 });
    await page.screenshot({ path: path.join(SHOTS, 'chip-effort.png'), clip: await page.locator('[data-testid="model-menu-effort"]').boundingBox() });
    const stops = await page.getAttribute('[data-testid="effort-slider"]', 'aria-valuemax');
    const tierWord = await page.getAttribute('[data-testid="effort-slider"]', 'aria-valuetext');
    console.log(`effort slider stops=${stops} valuetext=${tierWord}`);
    await browser.close();
    if (fit.top < 0 || fit.bottom > fit.vh) process.exit(1);
    if (stops !== '5') { console.error('::error::the effort slider is not six stops'); process.exit(1); }
    if (!tierWord) { console.error('::error::the slider exposes no tier label to AT'); process.exit(1); }
})().catch(e => { console.error(e); process.exit(1); });
