/**
 * A dedicated flat config for the probe/tooling scripts.
 *
 * The root `eslint.config.js` ignores the CJS files in this directory — they
 * are one-off tooling that never ships, so the React/TS rule set would drown
 * them. The
 * consequence was that ~1,900 lines of PROBE logic — the gates this repo
 * relies on most — got no lint and no parse check at all, and a selector
 * that silently matched nothing would reduce coverage without failing
 * anything.
 *
 * This config is intentionally narrow: error-level correctness rules only,
 * with no stylistic opinions. A gate script that cannot lint cleanly is a
 * gate that will eventually be skipped.
 *
 * Run it with:
 *   npx eslint --config scripts/eslint.config.mjs "scripts/*.cjs"
 *
 * (The quotes matter here, and so does this comment: a glob pattern written
 * inside a block comment is harmless to the shell, but a `*` followed by `/`
 * closes the comment early — which is exactly what happened twice while
 * writing this file.)
 */
export default [
    {
        files: ['**/*.cjs'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'commonjs',
            globals: {
                require: 'readonly',
                module: 'writable',
                exports: 'writable',
                process: 'readonly',
                console: 'readonly',
                Buffer: 'readonly',
                __dirname: 'readonly',
                __filename: 'readonly',
                setTimeout: 'readonly',
                clearTimeout: 'readonly',
                setInterval: 'readonly',
                clearInterval: 'readonly',
                URL: 'readonly',
                TextEncoder: 'readonly',
                TextDecoder: 'readonly',
                fetch: 'readonly',
                AbortController: 'readonly',
                structuredClone: 'readonly',
                // Browser globals. These appear ONLY inside `page.evaluate(...)`
                // callbacks, whose bodies are serialized and run in the page,
                // not in Node — so they are genuinely defined at runtime and
                // genuinely undefined here. ESLint cannot scope a rule to a
                // callback argument, so they are declared for the file with
                // this note rather than suppressed per line. A NEW use of
                // `document` outside an evaluate callback would slip through;
                // that is the accepted cost of linting browser-injected code
                // without a browser-aware parser.
                window: 'readonly',
                document: 'readonly',
                localStorage: 'readonly',
                sessionStorage: 'readonly',
                indexedDB: 'readonly',
                Event: 'readonly',
                MouseEvent: 'readonly',
                KeyboardEvent: 'readonly',
                HTMLElement: 'readonly',
                navigator: 'readonly',
                location: 'readonly',
            },
        },
        rules: {
            'no-undef': 'error',
            'no-unused-vars': ['error', { args: 'none' }],
            'no-dupe-keys': 'error',
            'no-dupe-args': 'error',
            'no-duplicate-case': 'error',
            'no-unreachable': 'error',
            'no-constant-condition': 'error',
            'no-func-assign': 'error',
            'no-import-assign': 'error',
            'no-self-assign': 'error',
            'no-sparse-arrays': 'error',
            'no-cond-assign': 'error',
            'no-dupe-else-if': 'error',
            'no-unsafe-negation': 'error',
            'use-isnan': 'error',
            'valid-typeof': 'error',
        },
    },
];
