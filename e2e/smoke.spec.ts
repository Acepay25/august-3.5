import { test, expect } from '@playwright/test';

/**
 * Smoke tests for the renderer boot path. Fresh profile (empty localStorage),
 * so the app should show the user-selection modal, then the chat with the
 * first-run onboarding card (no providers configured in a fresh profile).
 */

test('app boots and shows the user modal on first run', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

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
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // If the user modal appears, dismiss it by selecting the default flow:
    // find any "new user"/"continue" style button. On fresh profiles the modal
    // asks for a username — accept the default if present.
    const continueButton = page.getByRole('button', { name: /continue|start|new user|create/i }).first();
    if (await continueButton.isVisible().catch(() => false)) {
        await continueButton.click();
    }

    // The onboarding card should eventually render in an empty chat.
    await expect(page.getByText(/Connect an AI provider to start analyzing/i)).toBeVisible({ timeout: 15_000 });

    // And its CTA opens Settings.
    await page.getByRole('button', { name: /open settings/i }).first().click();
    await expect(page.getByText(/AI Models & Providers|Settings/i).first()).toBeVisible({ timeout: 10_000 });
});
