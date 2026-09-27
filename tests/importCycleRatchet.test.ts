/**
 * Import-cycle ratchet — pins the edges that are deliberate, so nobody
 * "reduces the cycle count" by converting a lazy edge into a static one and
 * shipping a TDZ crash.
 *
 * The handoff (Block 2.5) says "28 circular dependencies, densest seam
 * SkillMemoryService ↔ SkillEvalScheduler, 12 of 28 traverse it". Both
 * numbers are wrong, and the plan built on them would have moved working code
 * for no benefit. Measured on this tree:
 *
 *     npx madge --circular --extensions ts,tsx --ts-config tsconfig.json App.tsx index.tsx
 *     -> Found 30 circular dependencies
 *
 * but hiding ONE line — the `await import('./SkillEvalScheduler')` at
 * `SkillMemoryService.ts` — takes it to 19. Eleven of the thirty are that
 * single deliberate lazy edge. And at least one of the remaining nineteen
 * (`chatSessions -> chatStore`) is a pure type artifact: the whole "edge" is
 * `import('./chatStore').OpenTradeRow` in a type position, which tsc erases.
 *
 * So the raw madge number is NOT a runtime-cycle count, and this repo already
 * knows the principle: `tests/notebookCycleGuard.test.ts` exists because a
 * VALUE re-export closed a runtime cycle and caused a boot-time TDZ crash, and
 * its first assertion says it outright — `export type` is erased by tsc,
 * `export { x }` is the line that closed the loop.
 *
 * These assertions pin the three edges that are correct today, so the
 * "obvious fix" of hoisting any of them to a static import fails here instead
 * of in production. Each has a sanity floor so a rename cannot make it pass
 * vacuously — the failure mode this repo keeps encoding guards against.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const read = (rel: string): string => readFileSync(resolve(__dirname, '..', rel), 'utf8');

const notebook = read('services/learning/SkillMemoryService.ts');
const schema = read('schemas/tradeAnalysis.ts');
const chatSessions = read('services/trade/chatSessions.ts');

describe('the deliberate SkillEvalScheduler edge stays lazy (11 of madge\'s 30)', () => {
    it('the file is the one we think it is', () => {
        // Floor: if this file were renamed or emptied, the three assertions
        // below would pass by finding nothing.
        expect(notebook.length).toBeGreaterThan(50_000);
        expect(notebook).toMatch(/export function parseSkillMarkdown/);
    });

    it('is reached by a DYNAMIC import, not a static one', () => {
        expect(notebook).toMatch(/await import\(['"]\.\/SkillEvalScheduler['"]\)/);
        // A static import here is the change that would silently become a
        // runtime cycle — the exact shape notebookCycleGuard exists to catch.
        expect(notebook).not.toMatch(/import\s*\{[^}]*\}\s*from\s*['"]\.\/SkillEvalScheduler['"]/);
        expect(notebook).not.toMatch(/import\s+[A-Za-z_$][\w$]*\s+from\s*['"]\.\/SkillEvalScheduler['"]/);
    });
});

describe('the deliberate tradeAnalysis <-> analysisUtils cycle stays namespace-resolved', () => {
    it('the schema reaches analysisUtils through the namespace, not a named import', () => {
        // `import * as analysisUtils` is what makes the cycle safe: the binding
        // is read at CALL time (parsePrice, ~:607), never while the module graph
        // is still evaluating, so a chunk-order flip cannot hit a TDZ.
        expect(schema).toMatch(/import \* as analysisUtils from ['"]\.\.\/utils\/analysisUtils['"]/);
        expect(schema).not.toMatch(/import\s*\{[^}]*\}\s*from\s*['"]\.\.\/utils\/analysisUtils['"]/);
        // …and the comment that explains it must survive the next refactor.
        expect(schema).toMatch(/DELIBERATE CYCLE/);
    });
});

describe('chatSessions -> chatStore is a type edge, not a runtime one', () => {
    it('has no value import of chatStore', () => {
        // The only mention is `import('./chatStore').OpenTradeRow` in a type
        // position. A `from './chatStore'` here would create a real cycle.
        expect(chatSessions).toMatch(/import\(['"]\.\/chatStore['"]\)/);
        expect(chatSessions).not.toMatch(/from\s*['"]\.\/chatStore['"]/);
    });
});
