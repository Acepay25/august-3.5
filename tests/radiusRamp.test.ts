import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * The radius tokens are `rounded-control` (8px), `rounded-bubble` (12px) and
 * `rounded-full` — the three legal radii (docs/plans/
 * redesign-plan-claude-chatgpt-haze-2026-10-10.md, Part 3.5). Everything else
 * — `rounded-lg`/`xl`/`2xl`/`md`, bare `rounded`, px literals — is drift from
 * before the tokens existed: 662 sites at this gate's birth, the survivors of
 * the old 650-vs-110 census.
 *
 * The sweep finished on 2026-10-12: every one of those sites was migrated
 * per-role onto a token, site by site (cards/popovers/modals → bubble; buttons,
 * inputs, rows, chips, icon frames → control), and the baseline came down to
 * what the sweep could not legally touch. The floor is 9 and it is not slack —
 * the regex cannot tell these from drift, the doctrine forbids changing them:
 * 4 directional classes (`rounded-t-2xl`, `rounded-t-lg`, `rounded-t-md`,
 * `rounded-r-full`), 2 `rounded-none` (the `[&_code]` reset and a `sm:` reset),
 * and 3 comments that use the English word "rounded".
 *
 * Like themeContrast's clipped-text ratchet, this holds the count at or under
 * the baseline — and separately pins the floor BY NAME, so rewording one of
 * those three comments cannot quietly hand the sweep 1 slot of slack: the
 * inventory assertion fails and the next author lowers `BASELINE` on purpose.
 *
 * Chart geometry stays out of this gate on purpose: a Recharts bar's
 * `radius={[0, 6, 6, 0]}` (`WinRateDashboard.tsx:454`) and an SVG glyph's `rx`
 * (`BotFace.tsx:71`) round DATA shapes, not chrome, and the doctrine's
 * "nothing else invents a radius" was never about them.
 */

const BASELINE = 9;

/** The floor, by identity — `path|class` for every site the doctrine forbids touching. */
const FLOOR_INVENTORY = [
    'components/analysis/WatchListPanel.tsx|rounded-none',
    'components/analysis/WatchListPanel.tsx|rounded-t-2xl',
    'components/shared/ImagePreview.tsx|rounded-t-lg',
    'components/shared/MarkdownRenderer.tsx|rounded',
    'components/shared/MarkdownRenderer.tsx|rounded-none',
    'components/shell/RightPanel.tsx|rounded-t-md',
    'components/shell/SurfaceMenuList.tsx|rounded-r-full',
    'components/trade/BiasChips.tsx|rounded',
    'components/trade/panels/ChatWorkTimeline.tsx|rounded',
];

const OFF_TOKEN = /rounded-(?!control\b|bubble\b|full\b)[a-z0-9[\]/.%-]*|(?<![-\w])rounded(?![-\w])/g;

const walk = (dir: string): string[] => readdirSync(dir).flatMap(name => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
});

describe('radius tokens own every non-token radius', () => {
    it(`holds the off-token radius count at or under ${BASELINE}`, () => {
        const offenders: string[] = [];
        let count = 0;
        for (const path of [...walk('components'), 'App.tsx']) {
            if (!path.endsWith('.tsx')) continue;
            const src = readFileSync(path, 'utf8');
            const matches = src.match(OFF_TOKEN) ?? [];
            count += matches.length;
            if (matches.length > 0) {
                offenders.push(`${relative(process.cwd(), path)}: ${matches.length}`);
            }
        }
        expect(count, offenders.sort((a, b) => b.localeCompare(a)).slice(0, 12).join(' | ')).toBeLessThanOrEqual(BASELINE);
    });

    it('knows its floor by name, not only by number', () => {
        const found: string[] = [];
        for (const path of [...walk('components'), 'App.tsx']) {
            if (!path.endsWith('.tsx')) continue;
            const matches = readFileSync(path, 'utf8').match(OFF_TOKEN) ?? [];
            const rel = relative(process.cwd(), path).replace(/\\/g, '/');
            for (const m of matches) found.push(`${rel}|${m}`);
        }
        // Fails BOTH ways on purpose: a new off-token class lands here as an
        // unexpected entry, and deleting one of these (a reworded comment)
        // leaves a gap that has to be closed by editing BASELINE deliberately.
        expect(found.sort()).toEqual(FLOOR_INVENTORY);
    });

    it('really sees an off-token radius when one is typed', () => {
        expect('rounded-lg rounded-xl rounded-2xl rounded-md rounded'.match(OFF_TOKEN)).toHaveLength(5);
        expect('rounded-control rounded-bubble rounded-full'.match(OFF_TOKEN)).toBeNull();
    });

    /**
     * The class sweep could not be the whole story: a fourth radius can also
     * ship as an inline style or inside a `<style>` block, and neither reaches
     * `OFF_TOKEN`. When this was written the audit found exactly that —
     * `AnalystLensSettings.tsx` carrying 10px and 6px in scoped CSS, and the two
     * chart tooltips disagreeing (8 vs 12px) for one role. All eight values in
     * scope are now 8 or 12, so this asserts legality rather than ratcheting a
     * count: a new invented radius in a style attribute fails outright.
     */
    const LEGAL_RADIUS = new Set(['0', '0px', '8', '8px', '12', '12px', '999', '999px', '50%']);
    const RADIUS_VALUE = /(?:border-radius|borderRadius)\s*:?\s*['"]?([0-9.]+(?:px|rem|%)?)?/g;

    const illegalRadiusValues = (src: string): string[] => {
        const found: string[] = [];
        let m: RegExpExecArray | null;
        RADIUS_VALUE.lastIndex = 0;
        while ((m = RADIUS_VALUE.exec(src)) !== null) {
            // No captured number means nothing to judge (a `var(--radius-bubble)`
            // or a value on the next line) — that is not an invented radius.
            if (m[1] && !LEGAL_RADIUS.has(m[1])) found.push(m[1]);
        }
        return found;
    };

    it('lets no inline or scoped-CSS radius invent a value off the two tokens', () => {
        const offenders: string[] = [];
        for (const path of [...walk('components'), 'App.tsx']) {
            if (!path.endsWith('.tsx')) continue;
            const bad = illegalRadiusValues(readFileSync(path, 'utf8'));
            if (bad.length > 0) offenders.push(`${relative(process.cwd(), path)}: ${bad.join(', ')}`);
        }
        expect(offenders, offenders.join(' | ')).toEqual([]);
    });

    it('really sees an invented radius in a style', () => {
        expect(illegalRadiusValues("style={{ borderRadius: 10 }}")).toEqual(['10']);
        expect(illegalRadiusValues('border-radius: 6px;')).toEqual(['6px']);
        expect(illegalRadiusValues("borderRadius: '12px'")).toEqual([]);
        expect(illegalRadiusValues('borderRadius: 8,')).toEqual([]);
        // A bare `borderRadius:` with the value on the next line is not a value
        // this can judge, and no source writes one — say so rather than guess.
        expect(illegalRadiusValues('borderRadius:')).toEqual([]);
    });

    /**
     * The theme file is where a fourth radius actually hid: `.ui-panel` drew
     * `1rem` (16px) on a panel root, and the scrollbar thumb `10px`, while the
     * class-based gate could only ever see `rounded-*`. A `border-radius` here is
     * legal when it is a token (`var(--radius-*)`, or the 8px/12px/999px it
     * stands for) or a micro-rounding of a hairline mark — 4px and under, which
     * is what the splash candles (1.5px), the progress tracks (1–2px), the
     * reasoning caret (1px), the `kbd` cap (4px) and the scrollbar thumb (4px)
     * actually are. Anything between 5px and 11px, or above 12px that is not a
     * pill, is an invented radius.
     */
    const CSS_RADIUS_DECL = /border-radius:\s*([^;}]+)/g;

    /** Judge EVERY corner in a declaration — `14px 8px 8px 8px` must not pass on
     *  the strength of its last three. A token this cannot read is refused, not
     *  waved through: the theme file today writes only numbers and the two vars,
     *  so a refusal means a new form arrived and someone should look at it. */
    const illegalThemeRadii = (css: string): string[] => {
        const bad: string[] = [];
        for (const decl of css.matchAll(CSS_RADIUS_DECL)) {
            for (const tok of decl[1].trim().split(/\s+/).filter(Boolean)) {
                if (/^var\(--radius-(control|bubble)\)$/.test(tok)) continue;
                const num = /^([0-9.]+)(px|rem|%)?$/.exec(tok);
                if (!num) { bad.push(`unreadable:${tok}`); continue; }
                const px = num[2] === 'rem' ? parseFloat(num[1]) * 16 : parseFloat(num[1]);
                const legal = num[2] === '%' || px <= 4 || px === 8 || px === 12 || px === 999;
                if (!legal) bad.push(tok);
            }
        }
        return bad;
    };

    it('keeps index.css on the same two radii the classes use', () => {
        expect(illegalThemeRadii(readFileSync('index.css', 'utf8')), 'invented radii in the theme file').toEqual([]);
    });

    it('really sees an invented radius in the theme file', () => {
        expect(illegalThemeRadii('border-radius: 1rem;')).toEqual(['1rem']);
        expect(illegalThemeRadii('border-radius: 10px;')).toEqual(['10px']);
        expect(illegalThemeRadii('border-radius: 14px 8px 8px 8px;')).toEqual(['14px']);
        expect(illegalThemeRadii('border-radius: var(--radius-bubble);')).toEqual([]);
        expect(illegalThemeRadii('border-radius: var(--radius-bubble) 0 0 0;')).toEqual([]);
        expect(illegalThemeRadii('border-radius: 0.5rem;')).toEqual([]);   // 8px
        expect(illegalThemeRadii('border-radius: 1.5px;')).toEqual([]);    // hairline mark
        expect(illegalThemeRadii('border-radius: 999px;')).toEqual([]);    // pill
        expect(illegalThemeRadii('border-radius: 50%;')).toEqual([]);      // circle
        expect(illegalThemeRadii('border-radius: inherit;')).toEqual(['unreadable:inherit']);
    });
});
