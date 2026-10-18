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
    await page.goto('/', { waitUntil: 'domcontentloaded' });
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

    await page.goto('/', { waitUntil: 'domcontentloaded' });

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

test('the title-bar switch reaches the journal and back to the trade chart', async ({ page }) => {
    await seedWorkspace(page, 'Navigation Workspace');

    // The destination rows are gone: the switch in the content column's title
    // bar is the navigation, addressed by surface id rather than by a label that
    // also carries the keyboard chord.
    await page.getByTestId('surface-switch-journal').click();
    await expect(page.getByRole('heading', { name: 'Journal', exact: true })).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('surface-switch-trade').click();
    await expect(page.getByTestId('trade-view')).toBeVisible({ timeout: 10_000 });
    // Where you are is marked on the switch: `aria-current="page"` is the
    // contract that moved from the rail row to the switch button.
    await expect(page.getByTestId('surface-switch-trade')).toHaveAttribute('aria-current', 'page');
    // And the sidebar's destination list is really gone from a surface that has
    // a sidebar at all — asserted on the Chat surface, where the column still
    // exists and used to hold it.
    await page.getByTestId('surface-switch-agents').click();
    await expect(page.getByTestId('agents-view')).toBeVisible({ timeout: 15_000 });
    const column = page.getByTestId('agents-rail');
    // Scoped to the LIST's own root, not to a button name. On this surface the
    // title-bar switch renders INSIDE the rail (AgentsView's `switchInRail`),
    // so a bare /^Journal/ query matches the switch that is meant to be there
    // and can no longer see the destination rows that were deleted. What the
    // contract is about: SurfaceMenuList (`surface-menu`) renders Customize and
    // nothing else.
    await expect(column.getByTestId('surface-menu').getByRole('button', { name: /^Journal/ })).toHaveCount(0);
    await expect(column.getByTestId('surface-switch-journal')).toBeVisible();
    // Same root, opposite answer — without this the count above would pass
    // vacuously if the list were not in the rail at all.
    await expect(column.getByTestId('surface-menu').getByRole('button', { name: /^Customize/ })).toBeVisible();
});

test('the title-bar switch navigates on a phone, and the conversation column is a drawer', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedWorkspace(page, 'Mobile Workspace');

    // The rail is gone, so navigation on a phone is the switch in the title bar.
    // It must be reachable and must say which screen you are on — the
    // `aria-current="page"` contract moved with it.
    const trade = page.getByTestId('surface-switch-trade');
    await expect(trade).toBeVisible();
    await expect(trade).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('surface-switch-journal')).toBeVisible();
    await expect(page.getByTestId('surface-switch-learn')).toBeVisible();

    await page.getByTestId('surface-switch-agents').click();
    await expect(page.getByTestId('agents-view')).toBeVisible({ timeout: 15_000 });

    // Below md the conversation column is an OVERLAY, not a squeezed third of a
    // 390px screen. Querying its rows while closed would match nothing and prove
    // nothing, so the closed state is asserted on the opener.
    await expect(page.getByTestId('agents-rail')).toBeHidden();
    await page.getByRole('button', { name: 'Open conversations' }).click();
    await expect(page.getByTestId('rail-backdrop')).toBeVisible();
    const column = page.getByTestId('agents-rail');
    await expect(column.getByRole('button', { name: /^Customize/ })).toBeVisible();
    await expect(column.getByTestId('rail-new-chat')).toBeVisible();

    // Geometry, not visibility. A drawer portaled behind a backdrop-filtered
    // ancestor reported visible while clipped to one row, so the panel has to
    // measure the viewport on its own.
    const box = await column.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(800);

    // The backdrop is the other way to put it down.
    await page.getByTestId('rail-backdrop').click({ position: { x: 300, y: 400 } });
    await expect(page.getByTestId('rail-backdrop')).toHaveCount(0);
});
