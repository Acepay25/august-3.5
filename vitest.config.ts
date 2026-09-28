import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    // Worker fan-out is the remaining flake source. With ~370 files the cost is
    // dominated by per-file jsdom setup (measured: 541s of `environment` against
    // 33s of actual test time), so on a high-core machine unbounded forks all
    // contend for the same event loop and a VARYING handful of files blow the
    // per-test timeout while passing solo and passing serially. Capping the pool
    // trades wall-clock for determinism; raise it back only with evidence.
    pool: 'forks',
    maxWorkers: 4,
    // Harden against worker teardown flakes on heavy files (debateChat.test.tsx):
    // vitest 4's forks pool terminates workers after `teardownTimeout` (default
    // 10s) and logs "[vitest-pool]: Timeout terminating forks worker ..." when
    // teardown of a large suite occasionally exceeds it — the file itself always
    // passes. 30s gives generous headroom without delaying failure detection.
    teardownTimeout: 30000,
    // Different class of flake from the two above, and the one that actually
    // took a run red: `EnvironmentTeardownError: [vitest-worker]: Closing rpc
    // while "onUserConsoleLog" was pending`. Vitest intercepts console.* and
    // forwards every call from the worker to the main process over RPC so the
    // reporter can group it under the test title. When a test file is heavy
    // enough (agentsSurface: 48 tests, ~30s) a console call can still be in
    // flight when the forks pool tears the worker down, and the channel closes
    // mid-message. It is reported as an unhandled error, so it FAILS the step
    // even though every assertion passed — PR #39 went red on 4,165 passing
    // tests for this reason, and it reproduces on unmodified HEAD, so it is not
    // caused by whatever changed.
    //
    // Raising a timeout cannot fix it: the message is not a timeout, it is a
    // message in flight. The fix is to stop routing console output through a
    // channel that can close under it — with interception off the worker writes
    // straight to the process stdout and there is no RPC hop to race.
    //
    // This hides nothing. Assertion failures, unhandled rejections and
    // timeouts all still fail the run exactly as before; the only thing lost
    // is the reporter's per-test grouping of console output, which on this
    // suite is overwhelmingly expected-failure noise ([RealDebate] …,
    // [AutoCapture] …) that nobody reads per-test.
    disableConsoleIntercept: true,
    // Same class of flake, per-test: with ~210 files, heavy jsdom suites
    // (DeskScene/room portals) run at the edge of the default
    // 5s timeout when a worker draws a long queue — solo runs pass, full
    // runs time out a varying handful of files at exactly 5000ms. 15s
    // headroom keeps real hangs detectable while removing the scheduling
    // edge (proven: clean HEAD ran clean while the larger tree flaked).
    testTimeout: 15000,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.{test,spec}.{ts,tsx}', 'utils/**/*.{test,spec}.{ts,tsx}', 'services/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      // Ratchet floor — set just under the measured baseline (38.2% lines /
      // 30.0% statements) so the gate fails on regressions without failing
      // the existing suite. Raise as coverage grows.
      thresholds: {
        lines: 36,
        statements: 28,
        functions: 36,
        branches: 30,
      },
      exclude: [
        'tests/**',
        'dist/**',
        'dist_electron/**',
        'electron/**',
        'scripts/**',
        'e2e/**',
        '**/*.cjs',
        '**/*.worker.ts',
        'types/**',
        'vite.config.ts',
        'vitest.config.ts',
      ],
    },
  },
  resolve: {
    alias: {
      '@': process.cwd(),
    },
  },
});
