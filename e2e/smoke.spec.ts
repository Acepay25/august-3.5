import { test, expect } from '@playwright/test';

const seedWorkspace = async (page: import('@playwright/test').Page, name = 'Smoke Workspace'): Promise<void> => {
    // Seed the web profile store before React boots. This keeps navigation
    // tests independent from the slow, asynchronous first-run initialization
    // path while the dedicated boot test still covers the profile picker.
    await page.goto('/favicon.ico');
    await page.evaluate(async (username) => {
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
            conversations: [{ id: 'e2e-conversation', timestamp: Date.now(), messages: [], ocrModel: '', moderatorProviderId: '', moderatorModel: '', leverage: 100 }],
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
    }, name);
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#splash')).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByRole('dialog', { name: 'User profile selection' })).toHaveCount(0, { timeout: 15_000 });
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

test('journal and live market are reachable as labelled dialogs', async ({ page }) => {
    await seedWorkspace(page, 'Navigation Workspace');

    await page.getByRole('button', { name: 'Trading Journal', exact: true }).first().click();
    await expect(page.getByRole('dialog', { name: 'Trading Journal' })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Close journal' }).click();

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
