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
import { openTags, filesWalkedShortOfTheirEnd, type Open } from './jsxScan';

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
 *
 * It shipped as a ratchet — a constant that can only fall — and stayed one for
 * five days: re-measured 2026-10-12 the count was still exactly 105 while the
 * tagged population had grown to 128, because the scanner holding the number
 * could not read a real JSX tag (see the rationale on `BASELINE`). With a
 * JSX-aware scanner it measured 107, two MORE than the ratchet could see. All
 * 107 now name their own text, the constant is 0, and the guard tests below
 * probe the detector rather than the debt, because the count is only as honest
 * as the parser holding it up.
 */
describe('clipped text names its fallback', () => {
    const CLIP = /truncate|line-clamp/;
    const FB = /\s(?:title|aria-label|aria-labelledby)=/;
    const EMPTY_FB = /\s(?:title|aria-label|aria-labelledby)=(?:\{\s*(?:undefined|null|false|''|"")\s*\}|\{\s*``\s*\}|""|'')/;
    /**
     * A fallback that truncates is not a fallback: the tooltip exists to show the
     * tail the row clipped, and `title={x.slice(0, 200)}` on `{x.slice(0, 200)}`
     * shows the same cut text in a second place. Found three times while closing
     * the 107 (`JobsDrawer`, `AgentsView`, `VersionHistoryDashboard`), each one
     * written by the reasonable-looking instinct to make the tooltip "as long as
     * the row". Only the direct call forms are refused — `.slice(`, `.substring(`,
     * `.substr(` — because a fallback that hides its cut behind a named
     * `const short = x.slice(...)` is a different (and much rarer) shape, and an
     * inline date projection (`last served ${d.slice(0, 10)}`) is legitimate on an
     * element that is not clipped, which is why this is checked against `CLIP`.
     */
    const TRUNCATING_FB = /\s(?:title|aria-label|aria-labelledby)=\{[^}]*(?:\.slice\(|\.substring\(|\.substr\()/;

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
     * The real residual is measured with the walker in `./jsxScan`: strings, template
     * literals, `${…}` and `{…}` attribute expressions, comments, regex literals and
     * JSX text are each read as what they are, and every opening tag is reported with
     * its attribute text and ancestry. The first honest measurement was 107 — two MORE
     * than the old gate's 105. A second correction came later: this block kept its own
     * copy of the scanner, that copy read `/```[\s\S]*?```/g` as three template
     * literals, and the strategy cards in `StrategyStudio.tsx` went unread from line 36
     * of the file onward — which is where the 108th clipped element was hiding. The
     * population today is 131 and every one of them names its own text, so BASELINE is
     * 0 and this is a ban: a new clipped element anywhere in `components/` fails the
     * build.
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

    /**
     * The walk lives in `./jsxScan`: one lexer for both source-shape gates, because
     * the copy that lived here could not read a regex literal or an apostrophe and
     * went blind inside `UpdateOverlay.tsx` (8 of that file's 239 lines were read),
     * which is exactly how a clipped element hiding in a blind region could keep the
     * ban passing while the rule looked satisfied.
     */
    const clipped = (src: string): Open[] => openTags(src).filter(t => CLIP.test(t.attrs));

    /**
     * An offender is a clipped element whose OWN tag names no text, or names a
     * cut of it. There is no ancestor exemption on purpose: a browser shows the
     * DEEPEST `title`, so an ancestor tooltip does not describe what this element
     * truncated — and a first draft of this rule accepted any-depth, ever-open,
     * even `title={undefined}` ancestors, which turned `BASELINE = 0` into a
     * rubber stamp. Elements sitting under an ancestor title are counted here and
     * fixed by giving one element both strings, or a second hover target — not by
     * exempting the child.
     */
    const clippedWithoutFallback = (src: string): string[] =>
        clipped(src)
            .filter(t => !FB.test(t.attrs) || EMPTY_FB.test(t.attrs) || TRUNCATING_FB.test(t.attrs))
            .map(t => `L${t.line} <${t.name}> ${t.attrs.replace(/\s+/g, ' ').slice(0, 60)}`);

    // The ban covers every surface that can clip: `components/` and `App.tsx`.
    // App.tsx carries no clip class today (measured 2026-10-13), which is exactly
    // why it belongs in the list — the rule is about the shape, not the census.
    const CLIP_FILES = [...tsxFilesUnder('components'), resolve(__dirname, '../App.tsx')];

    const offenders: string[] = [];
    let clippedSeen = 0;
    for (const path of CLIP_FILES) {
        const src = readFileSync(resolve(path), 'utf8');
        clippedSeen += clipped(src).length;
        for (const hit of clippedWithoutFallback(src)) {
            offenders.push(`${relative(process.cwd(), path)}: ${hit}`);
        }
    }

    it(`holds the clipped-without-fallback count at or under ${BASELINE}`, () => {
        expect(offenders.length, offenders.slice(0, 8).join(' | ')).toBeLessThanOrEqual(BASELINE);
    });

    /**
     * The control for the control. A ban at 0 passes just as happily when the
     * scanner reads no tags at all, and this scanner has been caught twice: reading
     * only to the first `>`, and — in the copy that lived here until the walker moved
     * to `./jsxScan` — going blind after a regex literal. The measured population is
     * in the test NAME, so the run reports the census instead of leaving it as a
     * comment; the floor sits well under it and exists to catch a parser that stops
     * parsing, not to police the layout, so it should not move when someone un-clips
     * a row.
     */
    it(`sees the clipped population it is guarding (${clippedSeen} clipped)`, () => {
        expect(clippedSeen).toBeGreaterThanOrEqual(100);
    });

    /**
     * Same reach control as `jsxNesting`, for this gate's own file set: a file whose
     * second half clips an element the walk never reported was not read to the end,
     * and a ban at 0 over it would be a measurement of nothing.
     */
    it('walks to the end of every file it reads', () => {
        const blind = filesWalkedShortOfTheirEnd(
            CLIP_FILES.map(p => ({ path: relative(process.cwd(), p), src: readFileSync(resolve(p), 'utf8') })),
        );
        expect(blind, blind.join('\n')).toEqual([]);
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
        // Every other way to write a fallback that carries no text.
        expect(clippedWithoutFallback('<span className="truncate" title={null}>{name}</span>')).toHaveLength(1);
        expect(clippedWithoutFallback('<span className="truncate" title={false}>{name}</span>')).toHaveLength(1);
        expect(clippedWithoutFallback('<span className="truncate" title={``}>{name}</span>')).toHaveLength(1);
        expect(clippedWithoutFallback('<span className="truncate" title={\'\'}>{name}</span>')).toHaveLength(1);
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

    it('refuses a fallback that truncates the text it was added to reveal', () => {
        // The three shapes written while closing the 107, all planted here: each
        // one made the tooltip and the row agree on the SAME cut, so the tail
        // stayed hidden in a second place.
        expect(clippedWithoutFallback('<span className="truncate" title={x.slice(0, 200)}>{x.slice(0, 200)}</span>')).toHaveLength(1);
        expect(clippedWithoutFallback('<span className="truncate" aria-label={`Talk: ${r.title.substring(0, 40)}`}>{r.title}</span>')).toHaveLength(1);
        expect(clippedWithoutFallback('<span className="truncate" title={x.substr(0, 9)}>{x}</span>')).toHaveLength(1);
        // The accepted shape: the row clips, the fallback carries the whole string.
        expect(clippedWithoutFallback('<span className="truncate" title={x}>{x}</span>')).toHaveLength(0);
        expect(clippedWithoutFallback('<span className="truncate" title={x}>{x.slice(0, 200)}</span>')).toHaveLength(0);
        // A cut inside a fallback is fine on an element that never clips — the
        // `last served ${date.slice(0, 10)}` projection in MemoryHealthCard is one.
        expect(clippedWithoutFallback('<Row label={p} title={`served ${d.slice(0, 10)}`} />')).toHaveLength(0);
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
