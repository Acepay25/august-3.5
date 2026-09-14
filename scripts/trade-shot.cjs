/**
 * trade-shot — throwaway visual audit of the trade surface on the PRODUCTION
 * bundle: seed the probe profile, land on Trade, assert the new surfaces
 * exist (hero price, funding bar, bias chips, indicators button, chat dock)
 * and write a PNG for human eyes. Run with `vite preview` already listening
 * on PORT (PROBE_REUSE pattern from boot-probe.cjs).
 */
const { chromium } = require('@playwright/test');

const PORT = process.env.PROBE_PORT ? Number(process.env.PROBE_PORT) : 4183;
const BASE = `http://127.0.0.1:${PORT}`;

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
            conversations: [], tradeLog: [], savedAnalyses: [], tradeSummaries: [],
            finalTradeSummary: null, settings: { activeFrameworks: [] },
        });
        await new Promise((resolve, reject) => {
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
        db.close();
    });
}

async function main() {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', err => errors.push(String(err && err.stack || err)));
    await seedProfile(page);
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !document.querySelector('#splash'), null, { timeout: 25000 });
    await page.waitForSelector('[data-testid="trade-view"]', { timeout: 25000 });
    // Let the kline/ticker/mark fetches settle so strip + spark + chips fill.
    await page.waitForTimeout(6000);
    const presence = {};
    for (const sel of [
        '[data-testid="trade-view"]', '[data-testid="hero-price"]', '[data-testid="funding-bar"]',
        '[data-testid="bias-chips"]', '[data-testid="hero-spark"]', '[data-testid="trade-chat-panel"]',
        '[data-testid="trading-chart"]', '[data-testid="draw-overlay"]', '[data-testid="screener-trigger"]',
    ]) {
        presence[sel.replace(/["\[\]]/g, '')] = await page.locator(sel).count();
    }
    presence.heroText = await page.locator('[data-testid="hero-price"]').first().textContent().catch(() => null);
    presence.chipsText = await page.locator('[data-testid="bias-chips"]').first().textContent().catch(() => null);
    presence.indicatorsButton = await page.getByTitle('Toggle the SMA-20 overlay').count();
    presence.markCaption = (await page.getByText('24h · MARK').count()) > 0;
    await page.screenshot({ path: 'trade-shot.png' });
    await browser.close();
    console.log(JSON.stringify({ presence, pageErrors: errors }, null, 2));
    process.exit(errors.length ? 2 : 0);
}

main().catch(err => { console.error('trade-shot failed:', err); process.exit(1); });
