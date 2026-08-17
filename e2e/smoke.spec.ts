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

const floorMessage = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: 'e2e-floor',
    role: 'ai',
    text: '',
    createdAt: new Date().toISOString(),
    isDebating: true,
    ensembleProgress: {
        analysts: [
            { key: 'analyst-a', providerId: 'a', providerName: 'Model A', modelId: 'a-model', modelName: 'A', displayName: 'Model A', status: 'analyzing', reasoning: 'Checking the opening structure.' },
            { key: 'analyst-b', providerId: 'b', providerName: 'Model B', modelId: 'b-model', modelName: 'B', displayName: 'Model B', status: 'analyzing', reasoning: 'Comparing the supplied levels.' },
        ],
        moderator: { status: 'reviewing' },
    },
    reasoningProcesses: { moderator: 'Waiting for the opening evidence.' },
    activeDebateSpeakers: { Moderator: 1, 'Model A': 1, 'Model B': 1 },
    ...overrides,
});

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

const seedWorkspace = async (page: import('@playwright/test').Page, name = 'Smoke Workspace', withAnalysis = false, withFloor = false): Promise<void> => {
    const messages = withFloor
        ? [floorMessage()]
        : withAnalysis
            ? [analysisMessage()]
            : [];
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
    await expect(page.locator('body')).toContainText(/August 3.5|Trading|Journal|Select|Profile|User/i, {
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

test('seeded analysis can log a WIN through the capture dialog', async ({ page }) => {
    await seedWorkspace(page, 'Journal Workspace', true);
    await expect(page.getByText('BTCUSDT')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('R:R')).toBeVisible();
    await page.getByRole('button', { name: 'Win', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Capture trade data' })).toBeVisible({ timeout: 10_000 });
    await page.locator('#pnl-amount').fill('25');
    await page.getByRole('button', { name: /Log without data capture/i }).click();
    await expect(page.getByRole('dialog', { name: 'Capture trade data' })).toHaveCount(0, { timeout: 10_000 });
});

test('seeded analysis exposes an inspectable analysis trace', async ({ page }) => {
    await seedWorkspace(page, 'Trace Workspace', true);
    await expect(page.getByText('BTCUSDT')).toBeVisible({ timeout: 15_000 });
    const trace = page.getByText(/Analysis trace ·/i);
    await expect(trace).toBeVisible();
    await trace.click();
    await expect(page.getByText('Confidence adjusted', { exact: true })).toBeVisible();
    await expect(page.getByText(/2 public debate turns attached/i)).toBeVisible();
});

test('Floor shows analyst and moderator thinking before public text exists', async ({ page }) => {
    await seedWorkspace(page, 'Floor Workspace', false, true);
    const floor = page.getByLabel('Floor');
    await expect(floor).toBeVisible({ timeout: 15_000 });
    await expect(floor).toContainText('Waiting for the opening evidence.');
    await expect(floor.locator('.debate-stage-bubble')).toHaveCount(3);
});

test('Floor keeps the moderator to one bubble: public speech wins over thinking', async ({ page }) => {
    await seedMessages(page, 'Floor Single Bubble Workspace', [floorMessage({
        debateTurns: [{ speaker: 'Moderator', round: 2, text: 'I want your strongest counter, please.' }],
    })]);
    const floor = page.getByLabel('Floor');
    await expect(floor).toBeVisible({ timeout: 15_000 });

    // One bubble per seat: two analyst thought bubbles + one moderator balloon.
    await expect(floor.locator('.debate-stage-bubble')).toHaveCount(3);
    const moderatorBubble = page.getByRole('button', { name: 'Open Moderator analysis' }).locator('.debate-stage-bubble');
    await expect(moderatorBubble).toHaveCount(1);
    await expect(moderatorBubble).toHaveClass(/debate-stage-balloon/);
    await expect(moderatorBubble).toContainText('I want your strongest counter, please.');

    // The thinking trace stays in the thought channel — no second bubble.
    await expect(moderatorBubble).not.toContainText('Waiting for the opening evidence.');
    await expect(floor.locator('.debate-stage-thought')).toHaveCount(2);
});

test('Floor bubble tickers rotate to the newest sentence and reveal it fully', async ({ page }) => {
    await seedMessages(page, 'Floor Ticker Workspace', [floorMessage({
        debateTurns: [{ speaker: 'Moderator', round: 2, text: 'The reclaim failed. The sweep is shallow. Wait for the close above 95,500.' }],
    })]);
    const ticker = page.getByRole('button', { name: 'Open Moderator analysis' }).locator('.debate-stage-ticker');
    await expect(ticker).toBeVisible({ timeout: 15_000 });

    // The ticker bounds the bubble to the newest sentence (no stale rotation)
    // and reveals the full sentence instead of freezing at the width limit.
    await expect.poll(() => ticker.getAttribute('aria-label'), { timeout: 5_000 })
        .toBe('Wait for the close above 95,500.');
    await expect(ticker).not.toContainText('The reclaim failed');
});

test('final verdict stays separate from the moderator thinking lane', async ({ page }) => {
    await seedMessages(page, 'Floor Verdict Workspace', [floorMessage({
        debateTurns: [{ speaker: 'Moderator', round: 4, text: 'FINAL TRADE PLAN: Long BTCUSDT.' }],
        reasoningProcesses: { moderator: 'Weighing the sweep against the failed retest.' },
        activeDebateSpeakers: { Moderator: 1 },
        ensembleProgress: {
            analysts: [
                { key: 'analyst-a', providerId: 'a', providerName: 'Model A', modelId: 'a-model', modelName: 'A', displayName: 'Model A', status: 'complete', reasoning: 'Alpha sees support holding at 95k.', finalOutput: 'Long the reclaim.' },
                { key: 'analyst-b', providerId: 'b', providerName: 'Model B', modelId: 'b-model', modelName: 'B', displayName: 'Model B', status: 'complete', reasoning: 'Beta sees the sweep failing at 95k.', finalOutput: 'Short the sweep.' },
            ],
            moderator: { status: 'reviewing' },
        },
    })]);
    const moderatorBubble = page.getByRole('button', { name: 'Open Moderator analysis' }).locator('.debate-stage-bubble');
    await expect(moderatorBubble).toBeVisible({ timeout: 15_000 });

    // Public verdict in the speech balloon only…
    await expect(moderatorBubble).toContainText('Long BTCUSDT');
    await expect(moderatorBubble).not.toContainText('Weighing the sweep');
    // …and the thinking lane survives in the thought channel, never mixed in.
    await expect(moderatorBubble).toHaveAttribute('data-thought', /Weighing the sweep/);
    await expect(moderatorBubble).not.toHaveAttribute('data-thought', /FINAL TRADE PLAN/);
});

test('analyst identity never crosses seats in the Floor', async ({ page }) => {
    await seedMessages(page, 'Floor Seats Workspace', [floorMessage({
        ensembleProgress: {
            analysts: [
                { key: 'analyst-a', providerId: 'a', providerName: 'Model A', modelId: 'a-model', modelName: 'A', displayName: 'Model A', status: 'analyzing', reasoning: 'Alpha sees support holding at 95k.' },
                { key: 'analyst-b', providerId: 'b', providerName: 'Model B', modelId: 'b-model', modelName: 'B', displayName: 'Model B', status: 'analyzing', reasoning: 'Beta sees the sweep failing at 95k.' },
            ],
            moderator: { status: 'waiting' },
        },
        reasoningProcesses: {},
        activeDebateSpeakers: { 'Model A': 1, 'Model B': 1 },
    })]);
    const floor = page.getByLabel('Floor');
    await expect(floor).toBeVisible({ timeout: 15_000 });

    // Stage bubbles carry only their own seat's reasoning.
    const actorA = page.getByRole('button', { name: 'Open Model A analysis' });
    await expect(actorA.locator('.debate-stage-thought')).toContainText('Alpha sees support holding at 95k.');
    await expect(actorA.locator('.debate-stage-thought')).not.toContainText('Beta sees');

    // Seat transcripts do not leak the neighbouring analyst's reasoning.
    await actorA.click();
    const seatA = page.getByRole('dialog', { name: 'Model A analysis' });
    await expect(seatA).toContainText('Alpha sees support holding at 95k.');
    await expect(seatA).not.toContainText('Beta sees');
    await page.getByLabel('Close Model A analysis').click();

    await page.getByRole('button', { name: 'Open Model B analysis' }).click();
    const seatB = page.getByRole('dialog', { name: 'Model B analysis' });
    await expect(seatB).toContainText('Beta sees the sweep failing at 95k.');
    await expect(seatB).not.toContainText('Alpha sees');
});

test('journal and live market are reachable as labelled dialogs', async ({ page }) => {
    await seedWorkspace(page, 'Navigation Workspace');

    await page.getByRole('button', { name: 'Trading Journal', exact: true }).first().click();
    const settings = page.getByRole('dialog', { name: 'Settings' });
    await expect(settings).toBeVisible({ timeout: 10_000 });
    await settings.getByRole('button', { name: 'Journal', exact: true }).click();
    await expect(settings.getByRole('heading', { name: 'Journal' })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: /Back to workspace/i }).click();

    await page.getByRole('button', { name: 'Live Market', exact: true }).first().click();
    await expect(page.getByRole('dialog', { name: 'Live Market' })).toBeVisible({ timeout: 10_000 });
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
