import { test, expect } from '@playwright/test';

/**
 * Seed the web profile store before React boots. This keeps navigation
 * tests independent from the slow, asynchronous first-run initialization
 * path while the dedicated boot test still covers the profile picker.
 */
const seedMessages = async (page: import('@playwright/test').Page, username: string, messages: Record<string, unknown>[], beforeAppLoad?: (page: import('@playwright/test').Page) => Promise<void>): Promise<void> => {
    await page.goto('/favicon.ico');
    await page.evaluate(async ({ username, messages }) => {
        localStorage.clear();
        sessionStorage.clear();
        sessionStorage.setItem('activeUsername', username);
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
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
            username,
            conversations: [{
                id: 'e2e-conversation',
                timestamp: Date.now(),
                messages,
                ocrModel: '',
                moderatorProviderId: '',
                moderatorModel: '',
                leverage: 100,
            }],
            tradeLog: [],
            savedAnalyses: [],
            tradeSummaries: [],
            finalTradeSummary: null,
            settings: { activeFrameworks: [] },
            lastActiveConversationId: 'e2e-conversation',
        });
        await new Promise<void>((resolve, reject) => {
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
        db.close();
    }, { username, messages });
    // Registered only now: the helper's own navigation is to /favicon.ico, a
    // non-HTML top-level document, and Chromium aborts that as soon as request
    // interception is on the context — even when no pattern matches it. Measured:
    // registering before this line fails with net::ERR_ABORTED, after it passes.
    if (beforeAppLoad) await beforeAppLoad(page);
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#splash')).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByRole('dialog', { name: 'User profile selection' })).toHaveCount(0, { timeout: 15_000 });
};

const analysisMessage = (): Record<string, unknown> => ({
    id: 'e2e-ai',
    role: 'ai',
    text: 'Setup',
    createdAt: new Date().toISOString(),
    outcome: 'PENDING',
    analysis: {
        coinName: 'BTCUSDT',
        direction: 'Long',
        confidence: 'Medium',
        probability: 60,
        strategy: 'e2e',
        activeStrategies: [],
        historicalCorrelation: '',
        marketConditions: { pattern: '', candleBehavior: '', timeframeAlignment: '', rsi: '', macd: '', sentiment: '' },
        entryPoints: [{ price: '100', description: 'e' }],
        stopLoss: '90',
        takeProfit: [{ price: '120' }],
        originalConfidence: 'High',
        validationWarnings: ['CALIBRATION ADJUSTMENT: High → Medium'],
    },
    runStats: {
        startedAt: new Date(Date.now() - 2500).toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: 2500,
        analystCount: 3,
    },
    debateTurns: [
        { speaker: 'Analyst A', round: 1, text: 'Long thesis.', createdAt: new Date().toISOString() },
        { speaker: 'Moderator', round: 2, text: 'Verdict review.', createdAt: new Date().toISOString() },
    ],
});

const seedWorkspace = async (page: import('@playwright/test').Page, name = 'Smoke Workspace', withAnalysis = false, beforeAppLoad?: (page: import('@playwright/test').Page) => Promise<void>): Promise<void> => {
    const messages = withAnalysis ? [analysisMessage()] : [];
    await seedMessages(page, name, messages, beforeAppLoad);
};

/** Pin the market-data hosts so a boot assertion cannot be decided by this
 *  machine's route to Binance. Each host is answered with the smallest body its
 *  shape allows — klines are arrays, a ticker is an object — so the app still
 *  parses what it expects and an error thrown on boot still fails the test.
 *  Found the hard way: the same commit passed, then failed on CORS from
 *  `fapi2.binance.com`, then passed again. A gate that flips with the network
 *  gets ignored, and this one is the only thing standing between a white screen
 *  and a green run. WebSocket hosts are NOT intercepted (Playwright needs
 *  routeWebSocket for those); a live-feed failure logs nothing to console, so it
 *  is not the flake this stub removes. */
const stubMarketData = async (page: import('@playwright/test').Page): Promise<void> => {
    await page.route(/binance/, (route) => {
        const url = route.request().url();
        const body = /\/klines/.test(url)
            ? '[]'
            : /ticker\/(price|24hr)/.test(url)
                ? '{"symbol":"BTCUSDT","price":"100000.0","lastPrice":"100000.0","openPrice":"100000.0"}'
                : '{}';
        return route.fulfill({ status: 200, contentType: 'application/json', body });
    });
};

/**
 * Smoke tests for the renderer boot path. Fresh profile (empty localStorage),
 * so the app should show the user-selection modal, then the chat with the
 * first-run onboarding card (no providers configured in a fresh profile).
 */

test('app boots and shows the user modal on first run', async ({ page }) => {
    const errors: string[] = [];
    await stubMarketData(page);
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
    });

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Splash → React mounts → user modal or chat appears.
    await expect(page.locator('body')).toContainText(/August Trading|Trading|Journal|Select|Profile|User/i, {
        timeout: 15_000,
    });

    // No white screen: the splash element must be removed once React mounts.
    await expect(page.locator('#splash')).toHaveCount(0, { timeout: 15_000 });

    expect(errors).toEqual([]);
});

test('first-run chat explains provider setup when no providers are configured', async ({ page }) => {
    await seedWorkspace(page);

    await expect(page.getByTestId('trade-view')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByPlaceholder('Configure a provider in Settings first')).toBeVisible({ timeout: 15_000 });

    // Settings lives on the rail's account row, not behind a hamburger and an
    // account menu: the rail is persistent at desktop width (it auto-collapses
    // only below NAV_RAIL_AUTO_COLLAPSE_PX = 1024), so the path is one click.
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: 'AI setup', exact: true })).toBeVisible({ timeout: 10_000 });
});

test('a profile with a seeded analysis boots clean', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await seedWorkspace(page, 'Analysis Workspace', true, stubMarketData);
    // Legacy seeded analyses (old chat-surface cards with Win/Loss buttons and
    // the analysis-trace panel) no longer render anywhere — the smoke contract
    // is that a profile carrying one boots to the trade surface with ZERO
    // page errors. The capture dialog itself is reachable only through the
    // outcome autopilot (price-driven), which smoke does not simulate.
    await expect(page.getByTestId('trade-view')).toBeVisible({ timeout: 15_000 });
    expect(errors).toEqual([]);
});

// NOTE: the Floor surface was removed from the app (the activity rail's four
// surfaces are Trade/Journal/Studio/Agents) — its seat-card smoke specs went
// with it.

test('the nav rail reaches the journal and back to the trade chart', async ({ page }) => {
    await seedWorkspace(page, 'Navigation Workspace');

    // The surfaces no longer live behind a header drawer that has to be opened
    // and dismissed around every jump — the rail is persistent, so its `<nav
    // aria-label="Surfaces">` rows are simply clickable. Matched by prefix
    // because each row's accessible name also carries its shortcut
    // ("Journal, shortcut Alt+2"), which an exact string cannot hit.
    const surfaces = () => page.getByRole('navigation', { name: 'Surfaces' });

    await surfaces().getByRole('button', { name: /^Journal/ }).click();
    await expect(page.getByRole('heading', { name: 'Journal', exact: true })).toBeVisible({ timeout: 10_000 });
    await surfaces().getByRole('button', { name: /^Trade/ }).click();
    await expect(page.getByTestId('trade-view')).toBeVisible({ timeout: 10_000 });
    // Where you are is marked on the row now, not spelled out in a toggle's
    // label: `aria-current="page"` is the contract the rail owns.
    await expect(surfaces().getByRole('button', { name: /^Trade/ })).toHaveAttribute('aria-current', 'page');
});

test('the collapsed rail expands, marks the surface, and fills the viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedWorkspace(page, 'Mobile Workspace');

    // Below NAV_RAIL_AUTO_COLLAPSE_PX the rail rests collapsed and is
    // aria-hidden + inert, so its rows are unreachable until the header's toggle
    // opens it. Querying by role while closed would match nothing and prove
    // nothing, so the closed state is asserted on the toggle itself.
    const rail = page.getByTestId('nav-rail');
    const toggle = page.getByTestId('nav-rail-toggle');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(rail).toBeHidden();

    await page.getByRole('button', { name: 'Expand navigation' }).click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    // A narrow-viewport rail is an OVERLAY: it floats above the content rather
    // than squeezing a 390px screen into 110px of chart.
    await expect(page.getByTestId('rail-backdrop')).toBeVisible();

    const surfaces = page.getByRole('navigation', { name: 'Surfaces' });
    await expect(surfaces.getByRole('button', { name: /^Journal/ })).toBeVisible();
    await expect(surfaces.getByRole('button', { name: /^Trade/ })).toHaveAttribute('aria-current', 'page');
    // Approvals and Settings are the rail's two non-surface actions. Live Market
    // used to be listed here: it is an app-level overlay now
    // (`isLiveMarketVisible`), not a navigation entry, so asserting it in the
    // rail would be asserting a control that was deliberately removed.
    await expect(page.getByTestId('nav-approvals')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();

    // Geometry, not visibility. The old drawer was portaled to <body> because the
    // header's backdrop-filter made the header its containing block, and
    // `toBeVisible` passed while the panel was clipped to one 53px row. The rail
    // is not portaled, so it has to measure the viewport on its own.
    const box = await rail.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(800);

    // Using the drawer is the intent — it must put itself down.
    await surfaces.getByRole('button', { name: /^Journal/ }).click();
    await expect(page.getByRole('heading', { name: 'Journal', exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('rail-backdrop')).toHaveCount(0);
    await expect(rail).toBeHidden();
});
