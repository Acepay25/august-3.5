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
    // while "onUserConsoleLog" was pending`. It is reported as an unhandled
    // error, so it FAILS the step even though every assertion passed — PR #39
    // went red on 4,165 passing tests, and it reproduced on unmodified HEAD, so
    // it was not caused by whatever changed.
    //
    // WHAT IS ESTABLISHED: vitest intercepts console.* and forwards each call
    // from the worker to the main process over RPC so the reporter can group it
    // under the test title. A message still on that wire when the forks pool
    // tears the worker down closes the channel mid-message. Raising a timeout
    // cannot help — this is not a timeout, it is a message already in flight.
    // Turning interception off removes the RPC hop, so there is nothing to close
    // under it.
    //
    // VERIFIED, with the flag both on and off: a failing assertion still fails
    // the run, and an unhandled rejection still fails the run. The only
    // behavioural difference is reporting format — console output loses the
    // reporter's per-test grouping, which on this suite is overwhelmingly
    // expected-failure noise ([RealDebate] …, [AutoCapture] …). Note that
    // `console.error` never failed the run in either configuration; that is
    // stock Vitest behaviour, not a consequence of this flag.
    //
    // NOT ESTABLISHED, and deliberately not claimed: WHICH file leaked the
    // call. The original comment blamed agentsSurface for emitting console
    // output across a ~30s run; measured, that file emits zero console lines,
    // solo and under the coverage instrumenter, and the error could not be
    // reproduced locally at all. It is CI- and load-dependent, and no leaking
    // file has been identified.
    //
    // So this is a fix for a failure mode whose trigger is still unexplained,
    // not a fix for a diagnosed leak. If a teardown race ever reappears, REMOVE
    // THIS FLAG FIRST while investigating — it would be concealing the symptom,
    // and the real console output would be the clue.
    //
    // ESCAPE HATCH, because "unexplained" should not mean "unreachable". Set
    // VITEST_CONSOLE_INTERCEPT=1 to turn interception BACK ON and reproduce the
    // race with the reporter's per-test grouping intact — that grouping is what
    // names the offending file, and losing it is what made this undiagnosable in
    // the first place. The `guards` workflow runs that as a non-blocking
    // diagnostic job, so an occurrence produces its own evidence instead of
    // waiting for someone to remember. Default stays OFF: the gate must not
    // depend on an intermittent race not firing.
    disableConsoleIntercept: process.env.VITEST_CONSOLE_INTERCEPT !== '1',
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
