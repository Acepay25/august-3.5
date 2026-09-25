/**
 * The browser's view of the shared wire policy must not drift from Node's.
 *
 * `shared/providerRequestPolicy.cjs` is required by `electron/main.cjs`, loaded
 * as CJS by vitest, and imported as ESM by the bundled renderer. The last of
 * those does not work on its own: the browser cannot execute `module.exports`,
 * so `vite.config.ts` appends a hardcoded `export { … }` list to the transformed
 * module. That list is a SECOND, hand-maintained copy of the module's export
 * surface, and the two disagree silently.
 *
 * What that cost: `requestReasoningSideChannel` was added to the CJS exports,
 * so `tsc` passed, `vitest` passed (vite-node's CJS interop ignores the list),
 * and the parity test passed — while every renderer build failed at rollup with
 * "not exported by shared/providerRequestPolicy.cjs". The app did not boot.
 * Nothing in the test suite could see it; only `npm run build` did.
 *
 * So this asserts the list against the module itself, in both directions. A new
 * export must be added to the list in the same commit, and a stale name in the
 * list is as loud as a missing one.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { execSync } from 'child_process';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const policy = require('../shared/providerRequestPolicy.cjs');
const viteConfigSrc = readFileSync('vite.config.ts', 'utf8');

/** Pull the literal array out of the config source — the transform builds its
 *  `export {}` clause from it at config-load time, so the list is data, not
 *  behaviour, and reading it directly avoids running a vite build in a test. */
const listFromSource = (): string[] => {
    const start = viteConfigSrc.indexOf('const SHARED_POLICY_EXPORTS = [');
    expect(start).toBeGreaterThan(-1);
    const open = viteConfigSrc.indexOf('[', start);
    const close = viteConfigSrc.indexOf('];', open);
    return viteConfigSrc.slice(open + 1, close)
        .split(',')
        .map(s => s.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
};

describe('the shared wire policy reaches the browser', () => {
    const listed = listFromSource();

    /** Every name the RENDERER imports from this module. The list does not have
     *  to mirror the whole CJS surface — `geminiThinkingBudget` is exported for
     *  electron/main.cjs and no renderer code asks for it, so demanding it
     *  would only add dead ESM surface. What must never be missing is a name
     *  something actually imports, because that is a build failure. */
    const rendererImports = (): string[] => {
        const files = [
            'App.tsx',
            ...execSync('git ls-files "services/**/*.ts" "components/**/*.tsx" "hooks/**/*.ts" "utils/**/*.ts"')
                .toString().trim().split('\n').filter(Boolean),
        ];
        const names = new Set<string>();
        for (const f of files) {
            let src: string;
            try { src = readFileSync(f, 'utf8'); } catch { continue; }
            // import { a, b } from '…/shared/providerRequestPolicy.cjs'
            for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*'[^']*shared\/providerRequestPolicy\.cjs'/g)) {
                for (const raw of (m[1] ?? '').split(',')) {
                    const n = raw.trim().split(/\s+as\s+/)[0].trim();
                    if (n) names.add(n);
                }
            }
        }
        return [...names];
    };

    it('re-exports every name the renderer actually imports', () => {
        const needed = rendererImports();
        expect(needed.length, 'the scan found no imports — has the import path changed?')
            .toBeGreaterThan(0);
        const missing = needed.filter(k => !listed.includes(k));
        expect(missing, `add these to SHARED_POLICY_EXPORTS in vite.config.ts: ${missing.join(', ')}`)
            .toEqual([]);
    });

    it('lists no name the module does not export', () => {
        const stale = listed.filter(k => !(k in policy));
        expect(stale, `remove these from SHARED_POLICY_EXPORTS: ${stale.join(', ')}`).toEqual([]);
    });

    it('keeps the reasoning side-channel in the list', () => {
        // The specific regression: the flag the packaged app must send, and the
        // one whose absence is invisible until a build fails.
        expect(listed).toContain('requestReasoningSideChannel');
        expect(typeof policy.requestReasoningSideChannel).toBe('function');
    });

    it('is not silently duplicated — the renderer import resolves to the same fn', () => {
        // The point of the shared module: one implementation across all three
        // transports. A second literal copy in the renderer is the bug this
        // whole arrangement exists to prevent.
        const svcSrc = readFileSync('services/providers/GenericProviderService.ts', 'utf8');
        const definitions = (svcSrc.match(/function requestReasoningSideChannel/g) ?? []).length;
        expect(definitions).toBe(0);
        expect(svcSrc).toMatch(/import \{[\s\S]*?requestReasoningSideChannel,[\s\S]*?\} from '\.\.\/\.\.\/shared\/providerRequestPolicy\.cjs'/);
    });
});
