import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';

/**
 * Suite-wide teardown discipline, in the one place every test file inherits.
 *
 * This file used to be a single import line, which meant all cleanup was
 * something 437 individual files had to remember. The one rule worth enforcing
 * globally is fake timers: a file that installs them and does not restore them
 * leaves every subsequent test — and the worker's own teardown — running on a
 * frozen clock, which surfaces as a timeout in a file that has nothing to do
 * with it. That is precisely the signature of the heavy-file flakes the
 * `testTimeout` / `teardownTimeout` comments above this setup describe, and it
 * is cheap to make structurally impossible instead of chasing per file.
 *
 * Deliberately NOT done here:
 *  - `vi.restoreAllMocks()`. Several suites build their mocks in `beforeAll`
 *    and rely on them for the whole file; a blanket restore would break them.
 *  - any console silencing. See `disableConsoleIntercept` in vitest.config.ts
 *    for why the teardown race is fixed at the channel instead.
 */
afterEach(() => {
    vi.useRealTimers();
});
