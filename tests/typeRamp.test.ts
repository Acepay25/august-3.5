import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * The `text-ui-*` ramp owns every pixel literal below the default base: it
 * replaced 9px/10px first (base − 5 / − 4), then 11px/12px/13px (base − 3 /
 * − 2 / − 1) — exact at the default `--ui-font-size: 14px`, so every migration
 * moved no pixels. Those five sizes were hundreds of occurrences across most
 * of the tree, which is exactly why the ramp could not scale while they
 * existed: moving `--ui-font-size` moves the roles and leaves a hard-coded
 * `text-[11px]` exactly where it was.
 *
 * 11px needed a design decision before it could be banned (see the token's own
 * comment): the ramp had no step there, so it became `text-ui-dense`
 * (base − 3) rather than being nudged onto `sm`/`xs`, which would have moved
 * 281 labels at once. 12px and 13px already had exact steps —
 * `text-ui-sm` and `text-ui-caption`.
 *
 * This keeps all five out. A new label has to name the ROLE it means —
 * `text-ui-dense`, `text-ui-xs`, `text-ui-2xs` — which is also the first time
 * that choice gets made deliberately rather than by typing a number.
 */

const walk = (dir: string): string[] => readdirSync(dir).flatMap(name => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
});

/**
 * Headings are the ramp's too.
 *
 * The 9-13px ban above covers body copy, and every one of the sizes it bans is
 * a role. Headings were the gap: a title could carry `text-[26px]` and pass, so
 * the surface name and the card under it had no declared relationship — and the
 * accessibility dial, which multiplies each element's own font-size, simply
 * could not reach them. Same rule, same reason.
 */
describe('headings are on the ramp', () => {
    const OPEN_TAG = /<h[1-6][\s\S]{0,400}?>/g;
    const LITERAL = /text-\[[0-9.]+px\]/;

    const offenders = SOURCES.flatMap(path => {
        const src = readFileSync(path, 'utf8');
        return [...src.matchAll(OPEN_TAG)]
            .filter(tag => LITERAL.test(tag[0]))
            .map(tag => `${path}: ${tag[0].replace(/\s+/g, ' ').slice(0, 78)}`);
    });

    it('carries no pixel literal on any heading tag', () => {
        expect(offenders).toEqual([]);
    });

    // Guard the guard: a scan that matched no headings at all would pass
    // vacuously, which is the failure mode this repo has already been bitten by.
    it('really looked at the headings in the tree', () => {
        const found = SOURCES.reduce((n, path) =>
            n + [...readFileSync(path, 'utf8').matchAll(/<h[1-6][ >]/g)].length, 0);
        expect(found).toBeGreaterThan(50);
    });

    it('declares the display roles the hero headings ask for', () => {
        const css = readFileSync('index.css', 'utf8');
        expect(css).toContain('--text-ui-lede: calc(var(--ui-font-size) + 1px)');
        expect(css).toContain('--text-ui-display: calc(var(--ui-font-size) + 12px)');
        expect(css).toContain('--text-ui-hero: calc(var(--ui-font-size) + 18px)');
    });
});

const SOURCES = [...walk('components'), 'App.tsx']
    .filter(p => /\.tsx?$/.test(p) && !p.includes('.test.'));

const BANNED = ['text-[9px]', 'text-[10px]', 'text-[11px]', 'text-[12px]', 'text-[13px]'];

describe('the type ramp owns 9–13px', () => {
    const offenders = SOURCES
        .flatMap(path => BANNED
            .map(token => ({ path, token, count: readFileSync(path, 'utf8').split(token).length - 1 }))
            .filter(hit => hit.count > 0));

    it('has no fixed-size 9–13px text left in the UI', () => {
        expect(offenders.map(o => `${o.path}: ${o.token} ×${o.count}`)).toEqual([]);
    });

    it('still exposes every role the ramp uses for them', () => {
        const css = readFileSync('index.css', 'utf8');
        expect(css).toContain('--text-ui-2xs: calc(var(--ui-font-size) - 5px)');
        expect(css).toContain('--text-ui-xs: calc(var(--ui-font-size) - 4px)');
        expect(css).toContain('--text-ui-dense: calc(var(--ui-font-size) - 3px)');
        expect(css).toContain('--text-ui-sm: calc(var(--ui-font-size) - 2px)');
        expect(css).toContain('--text-ui-caption: calc(var(--ui-font-size) - 1px)');
        // One dial, and it is the default the interface was laid out against.
        expect(css).toContain('--ui-font-size: 14px');
    });

    // Tailwind only emits a utility for a role that exists. A typo'd or
    // not-yet-added `text-ui-md` renders with NO font-size at all and silently
    // inherits whatever wrapped it, so banning the old literals is only half of
    // owning the ramp — the roles the UI reaches for have to be declared.
    it('defines every role the UI actually asks for', () => {
        const css = readFileSync('index.css', 'utf8');
        const used = new Set(SOURCES.flatMap(path =>
            [...readFileSync(path, 'utf8').matchAll(/\btext-ui-([a-z0-9-]+)/g)].map(m => m[1])));
        const undeclared = [...used].filter(role => !css.includes(`--text-ui-${role}:`));
        expect(undeclared).toEqual([]);
        // Guard the guard: a scan that found nothing would pass vacuously.
        expect(used.size).toBeGreaterThan(2);
    });
});
