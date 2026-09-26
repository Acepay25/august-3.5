/**
 * No lucide Sparkles anywhere in the app.
 *
 * The trader asked for it to be gone, and "gone" is the kind of instruction
 * that decays: the next person adding a "magic" affordance reaches for the
 * obvious glyph, and six months later it is back in four places. A test is the
 * only thing that makes the request durable.
 *
 * The check is over SOURCE, not the DOM, because the glyph can hide in a
 * rarely-opened surface (an update overlay, a settings row behind a tab, the
 * supervisor's stream) that no probe visits. A rendered check would pass while
 * the icon still existed.
 *
 * It also refuses the RENAMED form. `Sparkles as SparklesIcon` through a
 * barrel is the same glyph with a paper trail, and `SparklesIcon` was how the
 * nav rail marked Studio — so the alias is matched too.
 *
 * The WORKING TREE is read, not HEAD: the point is to fail on the change being
 * made now, not only once it has been committed.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';

const tracked = execFileSync('git', ['ls-files', '*.ts', '*.tsx'], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    // This test file legitimately NAMES the glyph in order to forbid it.
    .filter(f => !f.replace(/\\/g, '/').endsWith('tests/noSparkles.test.ts'));

const offenders = (pattern: RegExp): string[] => tracked.filter(f => {
    try { return pattern.test(readFileSync(f, 'utf8')); } catch { return false; }
});

describe('the Sparkles glyph is gone', () => {
    it('no tracked source file mentions it, in any form', () => {
        const found = offenders(/\bSparkles\b|SparklesIcon/);
        expect(found, `Sparkles is back in: ${found.join(', ')}`).toEqual([]);
    });

    it('is not pulled in from the lucide barrel', () => {
        // States the intent directly, so a rename that keeps the glyph cannot
        // slip past a test that only ever checked a display name.
        const importing = offenders(/from\s+'lucide-react'[^;]*\bSparkles\b/);
        expect(importing, `lucide Sparkles imported in: ${importing.join(', ')}`).toEqual([]);
    });

    it('Studio still has an identity glyph, it is just not this one', () => {
        // Sparkles WAS the Studio marker in the nav rail. Removing it without
        // replacing it would have left the surface with no icon at all.
        const shell = readFileSync('components/shell/SurfaceMenuList.tsx', 'utf8');
        const studio = /id:\s*'studio'[^}]*Icon:\s*(\w+)/.exec(shell);
        expect(studio, 'the Studio nav row has no icon').not.toBeNull();
        expect(studio![1]).not.toBe('SparklesIcon');
        expect(studio![1]).toMatch(/^\w+$/);
    });
});
