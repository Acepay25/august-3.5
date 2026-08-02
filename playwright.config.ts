import { defineConfig } from '@playwright/test';

/**
 * E2E smoke tests for August 3.5.
 * Boots the Vite dev server, opens the app and verifies the core render path
 * (boot, user modal/chat, onboarding card, settings).
 *
 * Run:   npx playwright install chromium   (once)
 *        npm run e2e
 */
export default defineConfig({
    testDir: './e2e',
    timeout: 60_000,
    retries: 0,
    use: {
        baseURL: 'http://localhost:3000',
        headless: true,
    },
    webServer: {
        command: 'npm run dev',
        port: 3000,
        reuseExistingServer: true,
        timeout: 60_000,
    },
});
