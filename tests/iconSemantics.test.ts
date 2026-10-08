import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Icons are decoration or they are the control — and the app was announcing
 * both. A glyph sitting next to a visible word is read twice by a screen
 * reader, and six glyphs for one status is a shape vocabulary the interface
 * never teaches. So the rule here is the one the reference clients follow:
 * a word for anything you act on or that describes state, an icon for identity,
 * and a decorative glyph is hidden from assistive tech.
 *
 * Measured, not intended: the scan counts the JSX that is decorative BY
 * CONSTRUCTION — an element that closes itself and carries only a class, so it
 * has no children, no title and no name of its own.
 */

const walk = (dir: string): string[] => readdirSync(dir).flatMap(name => {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.(tsx|ts)$/.test(p) && !p.includes('.test.') ? [p] : [];
});

const SOURCES = [...walk('components'), 'App.tsx'].filter(p => /\.tsx?$/.test(p));

/** `<Brain className="h-4 w-4" />` — nothing but a class, then closed. */
const UNMARKED = /<([A-Z][A-Za-z0-9_]*)\s+className="[^"]*"\s*\/>/g;

describe('decorative icons are hidden from assistive tech', () => {
    const offenders = SOURCES
        .flatMap(path => [...readFileSync(path, 'utf8').matchAll(UNMARKED)]
            .map(m => `${path}: <${m[1]} />`));

    it('every self-closing glyph says it is decoration', () => {
        expect(offenders).toEqual([]);
    });

    it('the scan still finds an unmarked glyph', () => {
        // Guard the guard: 325 of these were found and fixed, and a regex that
        // had quietly stopped matching would let every one of them come back.
        expect([...'<Eye className="h-4 w-4" />'.matchAll(UNMARKED)].length).toBe(1);
        expect([...'<Eye className="h-4 w-4" aria-hidden="true" />'.matchAll(UNMARKED)].length).toBe(0);
    });
});

describe('one status is one signal', () => {
    it('the supervisor indicator no longer swaps a glyph per phase', () => {
        const src = readFileSync('components/trade/panels/SupervisorIndicator.tsx', 'utf8');
        expect(src).not.toMatch(/PHASE_ICON/);
        // The phase is a word now, so it is readable without learning shapes.
        expect(src).toMatch(/PHASE_WORD/);
        expect(src).toContain('supervisor-phase-word');
    });
});
