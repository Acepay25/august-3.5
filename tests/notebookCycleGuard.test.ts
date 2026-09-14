/**
 * Architecture guard — the notebook import cycle that caused the v1.0.20/v1.0.21
 * "stuck on loading" boot crash (a value re-export closed a runtime cycle and
 * Rollup's chunk order flipped a TDZ crash past the dev-server e2e smoke).
 *
 * The production fix removed `MemoryFilesService`'s value re-export of
 * `getMemoryFilesContext` and pointed its consumers at `MemoryRetrievalService`
 * directly, so MemoryFilesService no longer imports the retrieval module at
 * runtime at all. This test is the ratchet: it fails if anyone re-adds a
 * RUNTIME (value) edge from MemoryFilesService → MemoryRetrievalService (the
 * only edge that closed the loop; the `export type` line stays allowed — it's
 * erased by tsc, not a runtime import). No new dev dependency, runs under the
 * existing vitest CI step.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(
    resolve(__dirname, '../services/learning/MemoryFilesService.ts'),
    'utf8',
);

// Strip block comments + line comments so doc text mentioning the module
// doesn't trip the assertion (we only care about real import/export edges).
const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('notebook cycle guard (v1.0.20 TDZ regression)', () => {
    it('does NOT re-export a value from MemoryRetrievalService', () => {
        // `export type { X } from './MemoryRetrievalService'` is fine (erased);
        // `export { getMemoryFilesContext } from './MemoryRetrievalService'` is
        // the exact line that closed the runtime cycle.
        const valueReExport = /export\s+(?!type\s)\{[^}]*\}\s+from\s+['"]\.\/MemoryRetrievalService['"]/;
        expect(code).not.toMatch(valueReExport);
    });

    it('does NOT runtime-import from MemoryRetrievalService', () => {
        // A plain `import { … } from './MemoryRetrievalService'` is a runtime
        // edge. `import type { … }` is erased by tsc and won't match (there's
        // the literal word `type` between `import` and `{`).
        const valueImport = /import\s+\{[^}]*\}\s+from\s+['"]\.\/MemoryRetrievalService['"]/;
        const valueDefaultImport = /import\s+[A-Za-z_$][\w$]*\s+from\s+['"]\.\/MemoryRetrievalService['"]/;
        expect(code).not.toMatch(valueImport);
        expect(code).not.toMatch(valueDefaultImport);
    });
});
