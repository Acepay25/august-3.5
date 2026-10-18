import { defineConfig } from '@playwright/test';

/**
 * E2E smoke tests for August Trading.
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
    // One browser at a time. Every spec boots the whole app against a single
    // `npm run dev`; four parallel Chromium instances on one Vite server is how
    // the first two specs timed out in `page.goto` while the later ones passed.
    // Contention here manufactures failures, and a flaky gate gets ignored.
    workers: 1,
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
