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
      'electron/**',
      '*.cjs',
    ],
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
