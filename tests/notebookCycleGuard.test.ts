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

/**
 * The second un-ratcheted TDZ-capable cycle (deep-dive 2026-09-15, cycle
 * hygiene): SkillMemoryService ↔ skillGraveyard. The graveyard imports the
 * notebook module (recordTombstone/…) while exporting helpers the notebook
 * calls — and it resolves `parseSkillMarkdown` through the module namespace
 * AT CALL TIME. That defense only holds while the export itself is a HOISTED
 * `function` declaration: a `const` arrow is hoisted-but-uninitialized
 * (TDZ) during cyclic evaluation, so a Rollup/dev chunk-order flip could
 * dereference it before its declaration runs (the exact v1.0.20 crash
 * class). This ratchet pins the declaration form.
 */
describe('SkillMemoryService ↔ skillGraveyard TDZ ratchet', () => {
    const notebook = readFileSync(
        resolve(__dirname, '../services/learning/SkillMemoryService.ts'),
        'utf8',
    );
    const graveyard = readFileSync(
        resolve(__dirname, '../services/learning/skillGraveyard.ts'),
        'utf8',
    );

    it('exports parseSkillMarkdown as a hoisted function declaration', () => {
        expect(notebook).toMatch(/export function parseSkillMarkdown\s*\(/);
        expect(notebook).not.toMatch(/export const parseSkillMarkdown\s*=/);
    });

    it('graveyard reaches it only through a hoisted function via the namespace', () => {
        // The graveyard must not import it as a bare binding used at module
        // evaluation time — it resolves SkillMemoryService.parseSkillMarkdown
        // inside a hoisted `function`.
        expect(graveyard).toMatch(/function [A-Za-z_$][\w$]*\([^)]*\)[^{]*\{\s*return SkillMemoryService\.parseSkillMarkdown/);
        expect(graveyard).not.toMatch(/import \{[^}]*parseSkillMarkdown[^}]*\} from/);
    });
});
