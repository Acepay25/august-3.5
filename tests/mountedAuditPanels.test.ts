import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * Four finished panels — the run-contract ladder, the verdict evidence card,
 * the why-avoid breakdown and the tooltip primitive — spent time with green
 * tests and no consumer, so nothing the user could see depended on them. They
 * are mounted now (`components/agents/AgentsView.tsx`,
 * `components/desk/DeskScene.tsx`); this is the tripwire against a later
 * refactor dropping an import and the panel quietly returning to being dead.
 *
 * A source scan rather than a render assertion, for the same reason
 * `themeContrast.test.ts` scans: the defect being guarded is "nobody imports
 * this any more", which is a property of the tree, not of one component's
 * behaviour.
 */

const walk = (dir: string): string[] => readdirSync(dir).flatMap(name => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
});

/** Every source file the app actually builds, minus the tests. */
const SOURCES: Array<{ path: string; text: string }> = [
    ...walk('components'),
    ...walk('hooks'),
    ...walk('services'),
    ...walk('utils'),
    'App.tsx',
]
    .filter(p => /\.tsx?$/.test(p) && !p.includes('.test.'))
    .map(p => ({ path: p.replace(/\\/g, '/'), text: readFileSync(p, 'utf8') }));

/**
 * One import statement: a default and/or namespace binding, and/or a named
 * list, from a specifier. `[^}]*` spans newlines, so the multi-line named
 * imports this codebase uses are matched.
 */
const IMPORT_RE = /import\s+(?:type\s+)?(?:([\w$]+)\s*,?\s*)?(?:\{([\s\S]*?)\})?\s*from\s*['"]([^'"]+)['"]/g;

interface Binding {
    symbol: string;
    /** The specifier's final path segment — the declaring file's stem. */
    fromModule: string;
}

const bindingsIn = (text: string): Binding[] => {
    const out: Binding[] = [];
    for (const match of text.matchAll(IMPORT_RE)) {
        const [, def, named, specifier] = match;
        const fromModule = (specifier.split('/').pop() ?? specifier).replace(/\.tsx?$/, '');
        if (def) out.push({ symbol: def, fromModule });
        for (const raw of (named ?? '').split(',')) {
            // `Foo as Bar` — the imported name is the left side.
            const name = raw.split(/\s+as\s+/)[0].trim();
            if (name && name !== 'type') out.push({ symbol: name, fromModule });
        }
    }
    return out;
};

/** symbol → the module that declares it. `WaitForConfirmationBanner` is a NAMED
 *  export of `WhyAvoidPanel.tsx`, so keying the search on the symbol alone
 *  would miss it — matching the module too is what makes this honest.
 *
 *  The three verdict panels are imported by `VerdictAudit`, which is the ONE
 *  host of that block; `VerdictAudit` itself must be mounted on both surfaces
 *  that show a settled verdict, or the audit is invisible where the trader
 *  actually spends their time. */
const MOUNTED: Array<{ symbol: string; from: string; host: string }> = [
    { symbol: 'RunContractPanel', from: 'RunContractPanel', host: 'components/analysis/VerdictAudit.tsx' },
    { symbol: 'EvidencePackCard', from: 'EvidencePackCard', host: 'components/analysis/VerdictAudit.tsx' },
    { symbol: 'WhyAvoidPanel', from: 'WhyAvoidPanel', host: 'components/analysis/VerdictAudit.tsx' },
    { symbol: 'WaitForConfirmationBanner', from: 'WhyAvoidPanel', host: 'components/analysis/VerdictAudit.tsx' },
    { symbol: 'Tip', from: 'Tip', host: 'components/desk/DeskScene.tsx' },
];

/** Every surface that has to reach the audit block. */
const AUDIT_HOSTS = [
    'components/agents/AgentsView.tsx',
    'components/trade/TradeChatPanel.tsx',
];

const BINDINGS = new Map(SOURCES.map(s => [s.path, bindingsIn(s.text)]));

const importersOf = (symbol: string, from: string): string[] => SOURCES
    .filter(s => !s.path.endsWith(`/${from}.tsx`) && !s.path.endsWith(`/${from}.ts`))
    .filter(s => (BINDINGS.get(s.path) ?? []).some(b => b.symbol === symbol && b.fromModule === from))
    .map(s => s.path);

describe('the audit panels are mounted, not merely tested', () => {
    it.each(MOUNTED.map(m => [m.symbol, m] as const))('%s is imported by a built source file', (symbol, { from, host }) => {
        const users = importersOf(symbol, from);
        expect(users, `${symbol} has no importer — it is an orphan again.`).toContain(host);
    });

    it('mounts the verdict audit on BOTH settled-verdict surfaces', () => {
        const users = importersOf('VerdictAudit', 'VerdictAudit');
        for (const surface of AUDIT_HOSTS) {
            expect(users, `the audit block is invisible on ${surface}`).toContain(surface);
        }
    });

    it('writes the declined/watch rule once, not once per surface', () => {
        // The rule for "is this a no-trade or a watch?" is the kind of thing
        // that silently diverges the second time it is written.
        const owners = SOURCES
            .filter(s => /WATCH_CONFIDENCES/.test(s.text))
            .map(s => s.path);
        expect(owners).toEqual(['components/analysis/VerdictAudit.tsx']);
    });
});

describe('one vocabulary for the run contract', () => {
    it('declares the stage-state union in exactly one place', () => {
        // A second copy is how a renamed state ends up rendering the pending
        // fallback instead of failing to compile.
        const declared = SOURCES
            .filter(s => /export\s+type\s+RunContractStageState\s*=/.test(s.text))
            .map(s => s.path);
        expect(declared).toEqual(['utils/runContract.ts']);
    });

    it('widens no stage prop to `state: string`', () => {
        // Matched on the prop shape itself, not the bare words: a comment
        // explaining WHY the widening is wrong must not fail the test that
        // forbids it.
        const widened = SOURCES
            .filter(s => /stages\??\s*:\s*Array<\{[^}]*state:\s*string/.test(s.text))
            .map(s => s.path);
        expect(widened).toEqual([]);
    });
});
