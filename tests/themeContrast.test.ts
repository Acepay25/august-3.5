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
 * 5) Focus-modality lockout — C1/DSH. A focus ring is a keyboard affordance;
 * painting one on every mouse click trains people to ignore it, which costs
 * the indicator its whole job. `:focus-visible` is modality-aware on its own,
 * so the rule is simply that no call site may opt out by writing a bare
 * `focus:ring-*`. 19 sites did exactly that (checkboxes, text fields, a
 * close button) and each lit up on click.
 *
 * Scanned the same way as the hue and motion lockouts: source text, not
 * computed styles, because Tailwind generates the utility on demand and jsdom
 * would never see it.
 */
describe('focus-modality lockout (C1)', () => {
    const offenders = tsxFilesUnder(resolve(__dirname, '../components'))
        .map(file => {
            const lines = readFileSync(file, 'utf8').split('\n');
            const hits = lines
                .map((line, i) => ({ line: i + 1, text: line }))
                // `focus:ring` but NOT `focus-visible:ring` — the negative
                // lookahead is the whole rule.
                .filter(l => /focus:ring/.test(l.text) && !/focus-visible:ring/.test(l.text));
            return { rel: relative(__dirname, file).replace(/\\/g, '/').replace(/^..\//, ''), hits };
        })
        .filter(o => o.hits.length > 0);

    it('paints no focus ring without the keyboard having asked for one', () => {
        const report = offenders
            .map(o => `${o.rel}\n${o.hits.map(h => `  ${h.line}: ${h.text.trim().slice(0, 120)}`).join('\n')}`)
            .join('\n');
        expect(report, `${offenders.length} file(s) use a bare focus:ring`).toBe('');
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

/**
 * Clipped text has to name its fallback (arrangement pass, 2026-10-07).
 *
 * `truncate` and `line-clamp` are the two classes that can make information
 * unreadable while the layout still looks perfect: the row renders, the
 * sentence stops mid-word, and nothing on screen says the rest exists. Measured
 * across the tree on 2026-10-07, 105 of 125 clipped elements carried no `title`,
 * no `aria-label` and no `Tip` — which is most of what "this looks messy" means
 * in practice, and no other gate can see it (jsdom lays nothing out).
 * Re-measured 2026-10-12: the offenders are still exactly 105, but the tagged
 * population has grown to 128 — so this baseline sits at reality rather than
 * having been earned down, and the denominator above is the older census.
 *
 * This is a RATCHET, not a clean bill: the baseline is the count at the time it
 * was written, so the number can only fall. Fixing a file should lower the
 * constant in the same commit that fixes it, and leaving it pinned while the
 * count drops is the failure mode this repo already calls the "green check that
 * encodes the bug".
 */describe('clipped text names its fallback', () => {
    const CLIP = /truncate|line-clamp/;
    const FB = /\s(?:title|aria-label|aria-labelledby)=/;
    const EMPTY_FB = /\s(?:title|aria-label|aria-labelledby)=(?:\{\s*undefined\s*\}|""|''|"")/;

    /**
     * The count this gate holds is only as honest as its scanner, and the scanner
     * that shipped with it was not honest. It read `<tag` plus 600 characters and
     * stopped at the FIRST `>`, which means:
     *
     *  - `<button onClick={() => x()} className="truncate">` is cut at the arrow,
     *    so the `truncate` and its `title=` land on opposite sides of the cut and
     *    the element passes or fails at random;
     *  - a tag whose attributes span several lines is never parsed at all, so its
     *    clipping was invisible to the count (`TradeChatPanel.tsx:963,970`);
     *  - the 600-char window could be satisfied by a NEIGHBOUR's `title=`.
     *
     * The real residual is measured here with a scanner that knows JSX: strings,
     * template literals, `${…}` and `{…}` attribute expressions are traversed, a
     * `=>` is not a tag end, comments are skipped, and closing tags maintain a real
     * ancestor stack. The first honest measurement was 107 — two MORE than the old
     * gate's 105, because the old gate could not see every tag. Every one of those
     * 107 now names its own text, so BASELINE is 0 and this is a ban: a new clipped
     * element anywhere in `components/` fails the build.
     *
     * The last 9 were the interesting ones. They clipped inside an ancestor that
     * already carried a `title`, and a browser shows the DEEPEST title — so the
     * obvious move (give the child a tooltip) would have DELETED information: in
     * `MemoryHealthCard` the only copy of the byte-policy explanation, in
     * `BiasChips` the only statement that a chip is code-calculated rather than the
     * model's opinion. Each was resolved by putting both strings on one element
     * (label + explanation, chip + claim, name + "signed in as"), or by noticing the
     * ancestor tooltip merely restated text already visible in the row
     * (`JobsDrawer`'s schedule, `NavRail`'s "Signed in as X", `UpdateButton`'s error)
     * and dropping it. Nothing was exempted to reach zero, and there is no ancestor
     * exemption to hide behind — see the rationale on `clippedWithoutFallback`.
     */
    const BASELINE = 0;
    const BS = String.fromCharCode(92);
    const BT = String.fromCharCode(96);

    /** Index just past the depth-0 `>` that ends the tag opened at `lt`, or -1. */
    function tagEnd(src: string, lt: number): number {
        const stack: { kind: string; ch?: string; depth: number }[] = [{ kind: 'code', depth: 0 }];
        let i = lt + 1;
        while (i < src.length) {
            const top = stack[stack.length - 1];
            const c = src[i];
            if (top.kind === 'str') {
                if (c === BS) { i += 2; continue; }
                if (c === top.ch) stack.pop();
                i++; continue;
            }
            if (top.kind === 'tmpl') {
                if (c === BS) { i += 2; continue; }
                if (c === BT) { stack.pop(); i++; continue; }
                if (c === '$' && src[i + 1] === '{') { stack.push({ kind: 'expr', depth: 1 }); i += 2; continue; }
                i++; continue;
            }
            if (c === '"' || c === "'" || c === BT) {
                stack.push(c === BT ? { kind: 'tmpl', depth: 0 } : { kind: 'str', ch: c, depth: 0 });
                i++; continue;
            }
            if (c === '{') { top.depth++; i++; continue; }
            if (c === '}') {
                top.depth--;
                if (top.kind === 'expr' && top.depth === 0) { stack.pop(); i++; continue; }
                if (top.depth < 0) return -1;
                i++; continue;
            }
            if (c === '>' && top.kind === 'code' && top.depth === 0) {
                if (src[i - 1] === '=') { i++; continue; }
                return i + 1;
            }
            i++;
        }
        return -1;
    }

    /** Next element opening tag, skipping comments and top-level strings. */
    function nextTag(src: string, from: number): { start: number; end: number; name: string; attrs: string } | null {
        let i = from;
        while (i < src.length) {
            const c = src[i];
            if (c === '/' && src[i + 1] === '/') { const n = src.indexOf('\n', i); i = n < 0 ? src.length : n + 1; continue; }
            if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 2; continue; }
            if (c === '"' || c === "'" || c === BT) {
                i++;
                while (i < src.length && src[i] !== c) { if (src[i] === BS) i++; i++; }
                i++; continue;
            }
            if (c === '<' && /[a-zA-Z]/.test(src[i + 1] || '') && src[i - 1] !== '/') {
                const m = /^<([a-zA-Z][\w.]*)/.exec(src.slice(i, i + 80));
                if (!m) { i++; continue; }
                const end = tagEnd(src, i);
                if (end < 0) { i++; continue; }
                return { start: i, end, name: m[1], attrs: src.slice(i + m[1].length + 1, end - 1) };
            }
            i++;
        }
        return null;
    }

    /**
     * An offender is a clipped element whose OWN tag names no text. There is no
     * ancestor exemption on purpose: a browser shows the DEEPEST `title`, so an
     * ancestor tooltip does not describe what this element truncated — and a
     * first draft of this rule accepted any-depth, ever-open, even `title={undefined}`
     * ancestors, which turned `BASELINE = 0` into a rubber stamp. Elements sitting
     * under an ancestor title are counted here and fixed by giving one element both
     * strings, or a second hover target — not by exempting the child.
     */
    const clippedWithoutFallback = (src: string): string[] => {
        const found: string[] = [];
        const stack: { name: string; attrs: string }[] = [];
        let cur = 0;
        for (let guard = 0; guard < 20000; guard++) {
            const open = nextTag(src, cur);
            if (!open) break;
            const closeRe = /<\/([a-zA-Z][\w.]*)>/g;
            closeRe.lastIndex = cur;
            const nc = closeRe.exec(src);
            if (nc && nc.index < open.start) {
                for (let k = stack.length - 1; k >= 0; k--) if (stack[k].name === nc[1]) { stack.length = k; break; }
                cur = nc.index + nc[0].length;
                continue;
            }
            if (CLIP.test(open.attrs) && (!FB.test(open.attrs) || EMPTY_FB.test(open.attrs))) {
                const line = src.slice(0, open.start).split('\n').length;
                found.push(`L${line} <${open.name}> ${open.attrs.replace(/\s+/g, ' ').slice(0, 60)}`);
            }
            if (!open.attrs.trimEnd().endsWith('/')) stack.push({ name: open.name, attrs: open.attrs });
            cur = open.end;
        }
        return found;
    };

    const offenders: string[] = [];
    for (const path of tsxFilesUnder('components')) {
        for (const hit of clippedWithoutFallback(readFileSync(resolve(path), 'utf8'))) {
            offenders.push(`${relative(process.cwd(), path)}: ${hit}`);
        }
    }

    it(`holds the clipped-without-fallback count at or under ${BASELINE}`, () => {
        expect(offenders.length, offenders.slice(0, 8).join(' | ')).toBeLessThanOrEqual(BASELINE);
    });

    // Guard the guard. The removed assertion was `offenders.length > 10`, which
    // could only pass while the debt existed and would have failed the day the
    // tree was clean — and a scanner that matched nothing would have passed at
    // every count. These probe the detector itself instead.
    it('reads a tag to its real end, not to the first angle bracket', () => {
        expect(clippedWithoutFallback('<span className="truncate">{name}</span>')).toHaveLength(1);
        expect(clippedWithoutFallback('<p className="line-clamp-2">{body}</p>')).toHaveLength(1);
        expect(clippedWithoutFallback('<span className="truncate" title={name}>{name}</span>')).toHaveLength(0);
        expect(clippedWithoutFallback('<span className="truncate" aria-label={name}>{name}</span>')).toHaveLength(0);
        expect(clippedWithoutFallback('<span data-title="x" className="truncate">{name}</span>')).toHaveLength(1);
        // A fallback that names nothing is not a fallback.
        expect(clippedWithoutFallback('<span className="truncate" title={undefined}>{name}</span>')).toHaveLength(1);
        // The bug class: an arrow function must not cut the tag in half.
        expect(clippedWithoutFallback('<button onClick={() => open(id)} className="truncate" title={full}>{x}</button>')).toHaveLength(0);
        expect(clippedWithoutFallback('<button onClick={() => open(id)} className="truncate">{x}</button>')).toHaveLength(1);
        // A `[...]` variant selector containing `>` must not end the tag either.
        expect(clippedWithoutFallback('<p className="[&>span]:truncate truncate">{x}</p>')).toHaveLength(1);
        // Neither a neighbour's nor an ancestor's tooltip covers this element.
        expect(clippedWithoutFallback('<div>\n  <span title="a">{a}</span>\n  <span className="truncate">{b}</span>\n</div>')).toHaveLength(1);
        expect(clippedWithoutFallback('<summary title="3 awaiting review">\n  <span className="truncate">{label}</span>\n</summary>')).toHaveLength(1);
        // A comment that merely mentions truncating is not markup.
        expect(clippedWithoutFallback('// never truncated here\nconst x = 1;')).toHaveLength(0);
    });

    it('sees a tag whose attributes span several lines', () => {
        // The old scanner read only to the first `>`, so a multi-line opening tag
        // was invisible to it. This used to be asserted against TradeChatPanel.tsx,
        // which is now fixed — a guard must not depend on the debt still existing.
        const multiLine = [
            '<button',
            '    key={g.id}',
            '    onClick={() => pick(g.id)}',
            '    className="block w-full truncate text-ui-dense"',
            '>',
            '    {g.name}',
            '</button>',
        ].join('\n');
        expect(clippedWithoutFallback(multiLine)).toHaveLength(1);
        expect(clippedWithoutFallback(multiLine.replace('w-full truncate', 'w-full') + '\n')).toHaveLength(0);
    });
});
