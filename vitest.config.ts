import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
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
