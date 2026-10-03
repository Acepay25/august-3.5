/**
 * Icon-layer guards.
 *
 * The icon rule in this app is not "use lucide" — it is "there is exactly one
 * place icons come from", because 78 files each importing the library
 * directly is how a size drift and a mixed stroke weight get in without
 * anyone deciding them. Three consequences are mechanically checkable, and
 * this test checks them:
 *
 * 1) `components/shared/Icons.tsx` is the ONLY module allowed to import
 *    'lucide-react'. Everything else imports from the layer. Before the
 *    migration this was true of zero files; it is now true of all of them,
 *    which means the rule can be enforced rather than merely stated.
 *
 * 2) Hand-rolled SVG glyphs use stroke 2. The doctrine has one weight, and
 *    the 1.8 variants that coexisted with it were drift with a comment
 *    explaining nothing.
 *
 * 3) No icon renders below the 12px floor (h-2 and under). 10px icons are
 *    smaller than `text-ui-xs` micro-labels, which the theme already bumps
 *    specifically so faint small text clears WCAG AA — an icon below that
 *    floor fails the same test with no such excuse.
 *
 * What this deliberately does NOT pin: the {h-3, h-4, h-5} size set itself.
 * The tree currently carries ~87 icons at h-3.5 (14px), and folding those to
 * 12 or 16 moves pixels across most of the app. That is a per-site design
 * decision, not a lint fix, so it is left to a deliberate pass rather than
 * enforced here — pinning it today would only record the current mess as law.
 *
 * Identity and data graphics are not icons and are not covered: bot avatars
 * (BotFace, PixelSeat, pixelAvatars), sparklines, donut charts, the desk
 * floor grid and the speech-bubble tail are deliberately custom artwork.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');

const sourceFiles = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) && !entry.name.includes('.test.') ? [full] : [];
});

/** Every production source file the rules apply to. */
const SOURCES = [
    ...sourceFiles(join(ROOT, 'components')),
    ...sourceFiles(join(ROOT, 'hooks')),
    ...sourceFiles(join(ROOT, 'services')),
    ...sourceFiles(join(ROOT, 'utils')),
    join(ROOT, 'App.tsx'),
];

const rel = (file: string): string => relative(ROOT, file).replace(/\\/g, '/');
const read = (file: string): string => readFileSync(file, 'utf8');

describe('Icons.tsx is the only import surface', () => {
    it('has no file outside the layer importing lucide-react directly', () => {
        const offenders = SOURCES
            .filter(f => rel(f) !== 'components/shared/Icons.tsx')
            .filter(f => /from\s+['"]lucide-react['"]/.test(read(f)))
            .map(rel);
        expect(offenders, `${offenders.length} file(s) bypass the icon layer`).toEqual([]);
    });

    // Guard the guard: the scan above passes vacuously if it walks nothing.
    it('actually scanned the tree', () => {
        expect(SOURCES.length).toBeGreaterThan(100);
    });
});

describe('icon stroke weight', () => {
    // Scoped to real <svg> glyphs on purpose. A recharts <Area strokeWidth={1.8}>
    // is a chart LINE's width and is governed by the chart spec (C9), not by
    // the icon doctrine — a broader match here would flag the wrong artifact.
    it('has no 1.8-stroke glyphs left beside the 2px doctrine', () => {
        const offenders = SOURCES
            .map(f => {
                const glyphs = read(f).match(/<svg[\s\S]*?<\/svg>/g) ?? [];
                return { file: rel(f), hits: glyphs.filter(g => /strokeWidth=\{?["']?1\.8/.test(g)) };
            })
            .filter(o => o.hits.length > 0)
            .map(o => `${o.file} (${o.hits.length} glyph(s))`);
        expect(offenders, `${offenders.length} file(s) still draw a glyph at 1.8`).toEqual([]);
    });

    it('still finds the hand-rolled glyphs it is protecting', () => {
        const withGlyphs = SOURCES.filter(f => /<svg[\s\S]*?<\/svg>/.test(read(f)));
        expect(withGlyphs.length, 'no hand-rolled SVG found — the guard would pass vacuously')
            .toBeGreaterThan(0);
    });
});

describe('icon size floor', () => {
    // h-2 (8px) and under. Deliberately h-2.5 is NOT included: 10px is a
    // judgement call the tree still has sites for, whereas 8px icons are
    // never a deliberate choice.
    it('draws no icon at 8px or smaller', () => {
        const offenders = SOURCES
            .map(f => {
                const hits = read(f)
                    .split('\n')
                    .map((text, i) => ({ line: i + 1, text }))
                    .filter(l => /<[A-Z][A-Za-z0-9]*\b[^>]*className=["`][^"`]*\b[hw]-2(\s|["`/])/.test(l.text));
                return { file: rel(f), hits };
            })
            .filter(o => o.hits.length > 0)
            .map(o => `${o.file}\n${o.hits.map(h => `  ${h.line}: ${h.text.trim().slice(0, 110)}`).join('\n')}`);
        expect(offenders.join('\n')).toBe('');
    });
});