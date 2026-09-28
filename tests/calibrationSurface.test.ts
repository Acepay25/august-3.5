/**
 * The calibration feature's public surface is exactly what is consumed.
 *
 * An unused `export` is invisible to the compiler — nothing warns, nothing
 * fails, and the symbol's only remaining reader is whoever next edits the file
 * and assumes it is called from somewhere. That is how `calibrationStore` /
 * `calibrationPolicy` / `calibrationPrompts` ended up publishing ~15 symbols
 * with no caller at all after the split in #34.
 *
 * The reverse mistake is worse and happens to reviewers: un-exporting something
 * that IS used. That one the compiler does catch — but only after you have
 * read the failure, and during a bulk edit the fastest reading of "no callers
 * found" is usually the wrong one.
 *
 * So this pins both directions against the source, using the same shape as
 * `tests/exportRawLocalStorage.test.ts`: scan for exports, resolve who names
 * them, and fail with `file:line` rather than a bare count.
 *
 * A symbol exported on purpose — a real external consumer, or a deliberate
 * public seam — goes in `ALLOWED_UNCONSUMED` WITH a reason, and the test fails
 * on an unjustified entry and on a stale one. A table nobody has to justify is
 * the same rot in a different shape.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const FEATURE_DIR = join(ROOT, 'services', 'validation');
const MODULES = ['calibrationStore.ts', 'calibrationPolicy.ts', 'calibrationPrompts.ts'];
const SELF = 'calibrationSurface.test.ts';

const walk = (dir: string): string[] => {
    if (!statSync(dir, { throwIfNoEntry: false })) return [];
    return readdirSync(dir).flatMap(name => {
        const full = join(dir, name).replace(/\\/g, '/');
        return statSync(full).isDirectory() ? walk(full) : [full];
    });
};

/**
 * Every file that could name a calibration symbol: the whole app plus the
 * feature's own SIBLING modules. Siblings count — `calibrationStore`'s
 * dimension slices are consumed by the policy and prompt layers, and that is a
 * real internal API of the feature, not an orphan. What makes a symbol dead is
 * having no reader OUTSIDE ITS OWN DECLARING FILE.
 */
const CONSUMERS = [
    ...walk(join(ROOT, 'services')),
    ...walk(join(ROOT, 'components')),
    ...walk(join(ROOT, 'hooks')),
    ...walk(join(ROOT, 'utils')),
    ...walk(join(ROOT, 'contexts')),
    ...walk(join(ROOT, 'tests')),
    join(ROOT, 'App.tsx'),
    join(ROOT, 'index.tsx'),
]
    .filter(p => /\.(ts|tsx)$/.test(p))
    .filter(p => !p.endsWith(SELF));

const EXPORTED = /export\s+(?:const|function|interface|type|class|enum)\s+([A-Za-z_$][\w$]*)/g;

const exportsOf = (): { name: string; where: string; path: string }[] => {
    const found: { name: string; where: string; path: string }[] = [];
    for (const m of MODULES) {
        const path = join(FEATURE_DIR, m).replace(/\\/g, '/');
        const src = readFileSync(path, 'utf8');
        for (const match of src.matchAll(EXPORTED)) {
            found.push({ name: match[1], where: `services/validation/${m}`, path });
        }
    }
    return found;
};

/**
 * Strip comments, so PROSE cannot satisfy the guard.
 *
 * These three modules carry long explanatory headers that name each other's
 * symbols constantly. Left in, a one-line sentence like "see
 * `getSessionAccuracyComparison`" would be enough to make a genuinely orphaned
 * export look consumed — a guard that can be satisfied by a sentence is a
 * guard nobody re-checks. The sibling `hookDestructureHygiene` guard was
 * rewritten for exactly this reason; leaving it unfixed here was an
 * inconsistency between two guards written minutes apart.
 *
 * Strings are not special-cased. Treating string contents as code is the
 * mirror-image false negative — a prompt that quotes a symbol name would
 * satisfy the guard — and neither is fully closable without a TypeScript AST.
 * That residual weakness is the reason this file is a test and not a lint
 * rule; the trade is recorded here rather than left to be discovered.
 */
const stripComments = (src: string): string => {
    let out = '';
    let inBlock = false;
    for (const line of src.split(/\r?\n/)) {
        let s = line;
        if (inBlock) {
            const close = s.indexOf('*/');
            if (close === -1) { out += '\n'; continue; }
            s = s.slice(close + 2);
            inBlock = false;
        }
        s = s.replace(/\/\*[\s\S]*?\*\//g, ' ');
        s = s.replace(/\/\/.*$/, '');
        out += `${s}\n`;
    }
    return out;
};

/**
 * Every identifier named by each file, in ONE pass.
 *
 * Per-FILE, not one global set: an export is only orphaned if no file OTHER
 * THAN ITS OWN MODULE names it, and `calibrationStore`'s dimension slices are
 * legitimately read by `calibrationPolicy` and `calibrationPrompts`. A single
 * merged set that skipped all three modules would miss exactly that, and a
 * single merged set that included them would let a module satisfy its own
 * export. Per-file keys are what express the rule.
 *
 * The first version of this test re-read every file once per symbol — roughly
 * 35 exports × ~700 files. It passed without coverage and took 25 seconds; under
 * the coverage instrumenter it failed, and in CI the slowness left the vitest
 * worker tearing down with console logs still in flight (12 unhandled
 * EnvironmentTeardownErrors, which fail the run). One read and one tokenise per
 * file turns ~24,500 reads into ~700.
 */
const IDENTIFIERS_BY_FILE = new Map<string, Set<string>>(CONSUMERS.map(p => [
    p.replace(/\\/g, '/'),
    new Set([...stripComments(readFileSync(p, 'utf8')).matchAll(/[A-Za-z_$][\w$]*/g)].map(m => m[0])),
]));

const DECLARING_MODULES = new Set(MODULES.map(m => join(FEATURE_DIR, m).replace(/\\/g, '/')));

/** Does any file other than THIS symbol's declaring module name it? Sibling
 *  modules count — the store's slices are read by policy and prompts. */
const hasReaderOutside = (name: string, declaredIn: string): boolean => {
    for (const [file, idents] of IDENTIFIERS_BY_FILE) {
        if (file === declaredIn) continue;
        if (idents.has(name)) return true;
    }
    return false;
};

/**
 * Exports that exist on purpose with no external caller today. Each needs a
 * reason, and a reason that goes stale is the failure mode — so a name listed
 * here that HAS gained a consumer also fails, forcing the entry to be removed.
 */
const ALLOWED_UNCONSUMED = new Map<string, string>([
    // `getCalibratedWinRateWithDecay` was removed in this change; it is listed
    // nowhere because it no longer exists.
]);

describe('the calibration feature publishes only what is consumed', () => {
    const all = exportsOf();

    it('found the three modules and a plausible number of exports', () => {
        // Floor: a scan that resolved nothing would make every assertion below
        // pass for the wrong reason.
        expect(all.length).toBeGreaterThan(20);
        expect(new Set(all.map(e => e.name)).size).toBe(all.length);
        expect(all.some(e => e.name === 'getCalibrationDrift')).toBe(true);
    });

    it('every export has a reader outside its own module', () => {
        const orphans = all
            .filter(e => !hasReaderOutside(e.name, e.path))
            .filter(e => !ALLOWED_UNCONSUMED.has(e.name))
            .map(e => `${e.where}  ${e.name}`);
        expect(orphans).toEqual([]);
    });

    it('an exemption carries a reason', () => {
        // An exemption with no justification is indistinguishable from a symbol
        // nobody looked at.
        expect([...ALLOWED_UNCONSUMED.values()].filter(r => r.trim().length < 12)).toEqual([]);
    });

    it('an exemption is not stale', () => {
        // If a symbol in the table has since gained a real consumer, remove the
        // entry — that is the point at which the symbol is no longer a
        // deliberate exception.
        const stale = [...ALLOWED_UNCONSUMED.keys()]
            .filter(n => all.some(e => e.name === n && hasReaderOutside(n, e.path)));
        expect(stale).toEqual([]);
    });
});
