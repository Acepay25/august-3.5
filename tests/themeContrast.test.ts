/**
 * Theme token guards for the Minara dark doctrine (index.css @theme).
 *
 * 1) AA contrast: `text-zinc-600` is the app's faintest live text (~250 sites
 *    at 9-11px). It used to resolve to Minara's ramp end #6e6e68 = 3.84:1 on
 *    the page background — below WCAG AA. The token was bumped to the nearest
 *    ramp-consistent warm step that clears 4.5:1 on BOTH page (#0b0b0a) and
 *    panels (#141412). This test pins the contract against the real index.css
 *    so a future theme change can't silently drop faint text back under AA.
 *
 * 2) Gray drift: `gray-*` utilities render stock cool Tailwind grays (never
 *    remapped by @theme) and break the warm-black doctrine. The owned
 *    fixed/insight pickers + image previews are pinned to zinc.
 *
 * Pure math + file reads — no DOM required.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const rootCss = readFileSync(resolve(__dirname, '../index.css'), 'utf8');

/** Resolve a hex color token from the @theme block (first definition wins). */
const themeColor = (name: string): string => {
    const m = rootCss.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\b`));
    if (!m) throw new Error(`token --${name} not found in index.css @theme`);
    return m[1].toLowerCase();
};

/** WCAG 2.x relative luminance. */
const relativeLuminance = (hex: string): number => {
    const channels = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map(v => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    const [r, g, b] = channels;
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** WCAG 2.x contrast ratio between two hex colors. */
const contrastRatio = (a: string, b: string): number => {
    const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
    return (light + 0.05) / (dark + 0.05);
};

describe('theme contrast tokens (index.css @theme)', () => {
    const PAGE_BG = themeColor('color-zinc-950');
    const PANEL_BG = themeColor('color-zinc-900');
    const FAINT_TEXT = themeColor('color-zinc-600');

    it('renders text-zinc-600 at AA (>= 4.5:1) on the page background', () => {
        expect(PAGE_BG).toBe('#0b0b0a');
        expect(contrastRatio(FAINT_TEXT, PAGE_BG)).toBeGreaterThanOrEqual(4.5);
    });

    it('renders text-zinc-600 at AA (>= 4.5:1) on panel surfaces too', () => {
        expect(PANEL_BG).toBe('#141412');
        expect(contrastRatio(FAINT_TEXT, PANEL_BG)).toBeGreaterThanOrEqual(4.5);
    });

    it('keeps the neutral ramp ordered + warm after the bump', () => {
        // 500 must stay dim, 600 must stay faint-but-legible, 700 stays hairline.
        expect(relativeLuminance(themeColor('color-zinc-500'))).toBeGreaterThan(relativeLuminance(FAINT_TEXT));
        expect(relativeLuminance(FAINT_TEXT)).toBeGreaterThan(relativeLuminance(themeColor('color-zinc-700')));
        // Warm neutral: R == G, B slightly below (the ramp's hue signature).
        const r = parseInt(FAINT_TEXT.slice(1, 3), 16);
        const g = parseInt(FAINT_TEXT.slice(3, 5), 16);
        const b = parseInt(FAINT_TEXT.slice(5, 7), 16);
        expect(r).toBe(g);
        expect(b).toBeLessThan(r);
    });
});

describe('theme gray-drift lockout', () => {
    const driftFiles = [
        '../components/dashboards/VersionHistoryDashboard.tsx',
        '../components/shared/ImagePreview.tsx',
    ];
    for (const file of driftFiles) {
        it(`${file} uses no cool gray-* utilities`, () => {
            const src = readFileSync(resolve(__dirname, file), 'utf8');
            expect(src).not.toMatch(/\b(?:hover:|focus:|sm:|md:)?(?:bg|text|border|ring|ring-offset|divide)-gray-\d{3}\b/);
        });
    }
});

/**
 * 3) Hue lockout — WS-5.3's "NEVER introduce new hues", enforced over the whole
 *    component tree instead of by review. Semantic colors are emerald (gain),
 *    rose/red (loss), amber/yellow (warning), cyan (info) and zinc (neutral);
 *    anything else in a class list is a new hue, and every one of the ~90 sites
 *    that predates this test was decorative — the state it colored was already
 *    named in words next to it.
 *
 * Scans source text rather than computed styles: Tailwind v4 generates the
 * utility on demand, so a stray class renders a real color and jsdom would
 * never see it. An exception has to be a fact about the file, not a preference.
 */
const FORBIDDEN_HUE = /(?:from|via|to|bg|text|border|ring|shadow|fill|stroke|divide|placeholder|decoration|outline|accent|caret|split|scrollbar-thumb)-(?:purple|violet|indigo|blue|sky|fuchsia|pink|teal|orange|lime|green)-\d{2,3}/;

/** file → why its hue is not UI chrome. Add only with a reason. */
const HUE_ALLOWLIST: Record<string, string> = {};

const tsxFilesUnder = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) return tsxFilesUnder(full);
    return entry.name.endsWith('.tsx') || entry.name.endsWith('.ts') ? [full] : [];
});

describe('theme hue lockout (WS-5.3)', () => {
    const offenders = tsxFilesUnder(resolve(__dirname, '../components'))
        .map(file => {
            const lines = readFileSync(file, 'utf8').split('\n');
            const hits = lines
                .map((line, i) => ({ line: i + 1, text: line }))
                .filter(l => FORBIDDEN_HUE.test(l.text));
            return { rel: relative(__dirname, file).replace(/\\/g, '/').replace(/^..\//, ''), hits };
        })
        .filter(o => o.hits.length > 0 && !HUE_ALLOWLIST[o.rel]);

    it('keeps every hue in components/ inside the semantic ramp', () => {
        const report = offenders
            .map(o => `${o.rel}\n${o.hits.map(h => `  ${h.line}: ${h.text.trim().slice(0, 120)}`).join('\n')}`)
            .join('\n');
        expect(report, `${offenders.length} file(s) still carry a non-doctrine hue`).toBe('');
    });
});

/**
 * 4) `transition-all` lockout — WS-5.4. `all` animates geometry as well as
 *    paint, so any state change that resizes a box (text growing a stream
 *    chunk at a time, a disclosure opening) slides the layout with it. Naming
 *    the properties is free: `transition-colors`, `transition-transform`,
 *    `transition-[width]`. Long durations are NOT pinned here on purpose — a
 *    duration that animates a data value (a progress bar's width, the
 *    tick-flash read) is correct at 300ms and each one carries a comment.
 */
describe('motion lockout (WS-5.4)', () => {
    const offenders = tsxFilesUnder(resolve(__dirname, '../components'))
        .map(file => {
            const lines = readFileSync(file, 'utf8').split('\n');
            const hits = lines
                .map((line, i) => ({ line: i + 1, text: line }))
                .filter(l => /\btransition-all\b/.test(l.text));
            return { rel: relative(__dirname, file).replace(/\\/g, '/').replace(/^..\//, ''), hits };
        })
        .filter(o => o.hits.length > 0);

    it('names every transition property in components/', () => {
        const report = offenders
            .map(o => `${o.rel}\n${o.hits.map(h => `  ${h.line}: ${h.text.trim().slice(0, 120)}`).join('\n')}`)
            .join('\n');
        expect(report, `${offenders.length} file(s) still use transition-all`).toBe('');
    });
});
