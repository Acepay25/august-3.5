/**
 * Binding a name is a contract. A dead binding is a second thing to keep
 * correct.
 *
 * `useTradeLogging` returned 42 names; `App.tsx` destructured all 42; **13 were
 * never referenced again**. Every one of those was a silent liability — a
 * handler renamed in the hook, or a state field that moves, and the destructuring
 * line has to be found and edited by someone who has no way to know the name
 * mattered. The compiler does not report it, because the binding is perfectly
 * valid; nothing tests it, because nothing observes it.
 *
 * This scans `App.tsx` for `const { … } = useSomething(` and fails when a bound
 * name appears nowhere else in the file.
 *
 * Scoped to the DESTRUCTURE on purpose. A hook may legitimately publish more
 * than the app binds — `useTradeLogging` returns `logTradeWithFeedback` and
 * `logEntryNotHitTrade`, which only the Journal auto-review and logged-trade
 * harness suites use. That is a real test seam and belongs in the hook's
 * return. The contract being policed here is "if you bind it, you use it", which
 * is a statement about the caller, not about the callee.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const APP = join(process.cwd(), 'App.tsx');
const SOURCE = readFileSync(APP, 'utf8');
const LINES = SOURCE.split(/\r?\n/);

/** `    } = useThing({` — the closing line of a hook destructure. */
const DESTRUCTURE_END = /^\s*\}\s*=\s*use([A-Z]\w*)\s*\(/;

interface Binding { hook: string; name: string; line: number }

/**
 * Walk backwards from each `} = useX(` to its opening `const {`, then read the
 * bound names. Handles `const {` on its own line and `const {\n  a, b,\n}`.
 */
const bindings = (): Binding[] => {
    const found: Binding[] = [];
    for (let i = 0; i < LINES.length; i++) {
        const end = LINES[i].match(DESTRUCTURE_END);
        if (!end) continue;

        let open = -1;
        for (let j = i; j >= 0; j--) {
            if (/^\s*const\s*\{\s*$/.test(LINES[j])) { open = j; break; }
        }
        if (open === -1) continue;

        const hook = end[1];
        for (let j = open + 1; j < i; j++) {
            for (const name of LINES[j].split(',')) {
                const clean = name.replace(/\/\/.*$/, '').trim();
                if (/^[A-Za-z_$][\w$]*$/.test(clean)) {
                    found.push({ hook: `use${hook}`, name: clean, line: j + 1 });
                }
            }
        }
    }
    return found;
};

/** How often the identifier appears in App.tsx outside its own binding line. */
const usesElsewhere = (name: string, bindingLine: number): number => {
    const re = new RegExp(`\\b${name}\\b`, 'g');
    let count = 0;
    for (let i = 0; i < LINES.length; i++) {
        if (i + 1 === bindingLine) continue;
        count += (LINES[i].match(re) || []).length;
    }
    return count;
};

describe('App.tsx binds no dead hook names', () => {
    const all = bindings();

    it('found App.tsx and a plausible number of bindings', () => {
        // Floor: a scan that matched nothing would make every assertion below
        // pass for the wrong reason. This is the same guard that would have
        // hidden a broken regex, so it is not optional.
        expect(SOURCE.length).toBeGreaterThan(50_000);
        expect(all.length).toBeGreaterThan(150);
        expect(all.some(b => b.hook === 'useTradeLogging')).toBe(true);
        expect(all.some(b => b.hook === 'useConversations')).toBe(true);
    });

    it('every bound name is referenced somewhere else in App.tsx', () => {
        const dead = all
            .filter(b => usesElsewhere(b.name, b.line) === 0)
            .map(b => `App.tsx:${b.line}  ${b.hook} -> ${b.name}`);
        expect(dead).toEqual([]);
    });
});
