import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * The `text-ui-*` ramp replaced every 9px and 10px literal in the UI
 * (`text-[9px]` = base − 5, `text-[10px]` = base − 4, exact at the default
 * `--ui-font-size: 14px`, so the migration moved no pixels). Those two sizes
 * were 622 occurrences across 105 files, which is why the ramp could not
 * actually scale the interface while they existed: moving `--ui-font-size`
 * moves the roles, and leaves a hard-coded `text-[10px]` exactly where it was.
 *
 * This keeps them out. A new micro-label has to name the ROLE it means —
 * `text-ui-xs` or `text-ui-2xs` — which is also the first time that choice gets
 * made deliberately rather than by typing a number.
 *
 * 11px is NOT covered, on purpose: the ramp has no step there, so picking a
 * role for it is a design decision rather than a find-and-replace, and pinning
 * it here would force a visual change through the back door of a test.
 *
 * 12px and 13px DO have exact steps — `text-ui-sm` (base − 2) and
 * `text-ui-caption` (base − 1) — so those literals convert with no pixel
 * movement. They are left alone because they are body and caption copy, not
 * micro-labels; that migration is a separate pass, not a lint decision.
 */

const walk = (dir: string): string[] => readdirSync(dir).flatMap(name => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
});

const SOURCES = [...walk('components'), 'App.tsx']
    .filter(p => /\.tsx?$/.test(p) && !p.includes('.test.'));

const BANNED = ['text-[9px]', 'text-[10px]'];

describe('the type ramp owns 9px and 10px', () => {
    const offenders = SOURCES
        .flatMap(path => BANNED
            .map(token => ({ path, token, count: readFileSync(path, 'utf8').split(token).length - 1 }))
            .filter(hit => hit.count > 0));

    it('has no fixed-size 9px or 10px text left in the UI', () => {
        expect(offenders.map(o => `${o.path}: ${o.token} ×${o.count}`)).toEqual([]);
    });

    it('still exposes both roles the ramp uses for them', () => {
        const css = readFileSync('index.css', 'utf8');
        expect(css).toContain('--text-ui-2xs: calc(var(--ui-font-size) - 5px)');
        expect(css).toContain('--text-ui-xs: calc(var(--ui-font-size) - 4px)');
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
