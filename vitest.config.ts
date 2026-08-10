import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    // Harden against worker teardown flakes on heavy files (debateChat.test.tsx):
    // vitest 4's forks pool terminates workers after `teardownTimeout` (default
    // 10s) and logs "[vitest-pool]: Timeout terminating forks worker ..." when
    // teardown of a large suite occasionally exceeds it — the file itself always
    // passes. 30s gives generous headroom without delaying failure detection.
    teardownTimeout: 30000,
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
