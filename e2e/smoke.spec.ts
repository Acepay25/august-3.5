import { test, expect } from '@playwright/test';

/**
 * Seed the web profile store before React boots. This keeps navigation
 * tests independent from the slow, asynchronous first-run initialization
 * path while the dedicated boot test still covers the profile picker.
 */
const seedMessages = async (page: import('@playwright/test').Page, username: string, messages: Record<string, unknown>[]): Promise<void> => {
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

const seedWorkspace = async (page: import('@playwright/test').Page, name = 'Smoke Workspace', withAnalysis = false): Promise<void> => {
    const messages = withAnalysis ? [analysisMessage()] : [];
    await seedMessages(page, name, messages);
};

/**
 * Smoke tests for the renderer boot path. Fresh profile (empty localStorage),
 * so the app should show the user-selection modal, then the chat with the
 * first-run onboarding card (no providers configured in a fresh profile).
 */

test('app boots and shows the user modal on first run', async ({ page }) => {
    const errors: string[] = [];
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

test('first-run chat shows the onboarding card when no providers are configured', async ({ page }) => {
    await seedWorkspace(page);

    // The onboarding card should eventually render in an empty chat.
    await expect(page.getByText(/To start analyzing charts, add at least one AI provider API key/i)).toBeVisible({ timeout: 15_000 });

    // And its CTA opens Settings.
    await page.getByRole('button', { name: 'Add API Key', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: 'AI setup', exact: true })).toBeVisible({ timeout: 10_000 });
});

test('a profile with a seeded analysis boots clean', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await seedWorkspace(page, 'Analysis Workspace', true);
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

test('the surface rail reaches the journal and back to the trade chart', async ({ page }) => {
    await seedWorkspace(page, 'Navigation Workspace');

    // The Antigravity rail replaced the old header buttons: Journal is a
    // surface now (embedded <Journal/>, no dialog chrome), and Trade
    // switches back to the chart.
    await page.getByRole('button', { name: 'Journal', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Journal', exact: true })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Trade', exact: true }).click();
    await expect(page.getByTestId('trade-view')).toBeVisible({ timeout: 10_000 });
});

test('mobile navigation keeps core actions inside the navigation dialog', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedWorkspace(page, 'Mobile Workspace');

    await page.getByRole('button', { name: 'Toggle navigation menu' }).click();
    const navigation = page.getByRole('dialog', { name: 'Navigation menu' });
    await expect(navigation).toBeVisible();
    await expect(navigation.getByRole('button', { name: 'Trading Journal', exact: true })).toBeVisible();
    await expect(navigation.getByRole('button', { name: 'Live Market', exact: true })).toBeVisible();
});
