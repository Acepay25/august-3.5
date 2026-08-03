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
      'scripts/*.cjs',
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
    rules: {
      // Relax rules that would produce too many errors initially
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': 'off', // App uses console extensively; migrate to logger incrementally
    },
  },
);
