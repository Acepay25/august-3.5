import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: [
      'dist/**',
      'dist_electron/**',
      'node_modules/**',
      'android/**',
      'coverage/**',
      'test-results/**',
      'playwright-report/**',
      'tests/test-rl.cjs',
      'tests/test-rule-extraction.cjs',
      // Desk tooling — one-off CJS scripts, never shipped.
      'scripts/**/*.cjs',
    ],
  },
  {
    files: ['electron/**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        Buffer: 'readonly',
        __dirname: 'readonly',
        console: 'readonly',
        process: 'readonly',
        require: 'readonly',
        setImmediate: 'readonly',
        Response: 'readonly',
        URL: 'readonly',
        setTimeout: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      'no-undef': 'off',
    },
  },
  {
    // Test files mix the jsdom Window + Node globals (vi.advanceTimersByTime
    // pulls setTimeout, the live-feed harness instantiates WebSocket + setInterval,
    // a few helpers touch process / require). One block gives the whole tests/
    // tree the union so no per-file eslint-env directive is ever needed.
    files: ['tests/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        // Node
        process: 'readonly',
        Buffer: 'readonly',
        console: 'readonly',
        require: 'readonly',
        setImmediate: 'readonly',
        // Browser DOM
        window: 'readonly',
        document: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        fetch: 'readonly',
        WebSocket: 'readonly',
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        Event: 'readonly',
        CustomEvent: 'readonly',
        HTMLElement: 'readonly',
        HTMLDivElement: 'readonly',
        HTMLButtonElement: 'readonly',
        HTMLInputElement: 'readonly',
        Element: 'readonly',
        Response: 'readonly',
        URL: 'readonly',
        Blob: 'readonly',
        File: 'readonly',
        FormData: 'readonly',
        Headers: 'readonly',
        Request: 'readonly',
        URLSearchParams: 'readonly',
        crypto: 'readonly',
        MutationObserver: 'readonly',
        ResizeObserver: 'readonly',
        IntersectionObserver: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        performance: 'readonly',
        // vitest testing API
        vi: 'readonly',
      },
    },
    rules: {
      // Test files can use whatever they want — the test runner cares.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
  {
    rules: {
      // Relax rules that would produce too many errors initially.
      //
      // WARNING RATCHET: `npm run lint` runs with --max-warnings 949 in
      // package.json. The number must EQUAL the warning count on a clean main,
      // because the cap is only a ratchet if it actually binds.
      //
      // It did not, for a long time: the cap sat at 1020 while the tree stood
      // at 949, so 71 warnings could be added and CI would still pass. That is
      // why `tests/hookDestructureHygiene.test.ts` had to exist — the repo was
      // hand-rolling a dead-binding guard because the installed AST rule that
      // already does the job was gated by a cap with slack in it. The guard was
      // removed when the cap was corrected.
      //
      // Re-measure on a clean checkout after touching this file, and LOWER the
      // number when you pay warnings down; never raise it to go green.
      // `npm run lint:loose` lists them without the cap for a cleanup pass.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': 'off', // App uses console extensively; migrate to logger incrementally
    },
  },
);
