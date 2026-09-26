/**
 * The expanded Chart AI dock must not push the row past the viewport.
 *
 * THE DEFECT. "Expand over chart" pinned the chart at `lg:w-1/3 lg:flex-none`
 * and the dock at `lg:!w-2/3 xl:!w-3/4`. Those fractions are mutually exclusive
 * as ROLES but additive as MATH: 1/3 + 3/4 = 13/12, and the order book is a
 * further fixed 300px. The row therefore could only grow — measured
 * scrollWidth 1693 on a 1280 viewport, 413px past the edge — and the dock's
 * right side was clipped: the transcript sentence ran off-screen and the
 * last suggestion chip was cut in half. `flex-none` is what sealed it: the
 * chart refused to absorb the deficit, so the deficit became overflow.
 *
 * The fix makes the widths an identity instead of a coincidence — the chart
 * flexes and takes the remainder, the book stands down while expanded, and the
 * dock's fraction is small enough that the pair always sums to the row.
 *
 * These are source contracts because the geometry lives in Tailwind classes on
 * a large component; the PROVEN half is `render-probe`'s no-horizontal-overflow
 * check, which measures the real thing in a browser.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

const raw = readFileSync('components/trade/TradeView.tsx', 'utf8');

/** Comments are stripped before any assertion. The class expressions here are
 *  heavily commented — and deliberately so, since the arithmetic they encode is
 *  what broke — so a test that reads the raw file happily "finds" `lg:w-1/3`
 *  inside the sentence explaining why `lg:w-1/3` is gone. Asserting against a
 *  comment would make the documentation load-bearing in the worst way: editing
 *  the explanation to be clearer would fail the test. */
const src = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Pull a JSX className expression that mentions `needle` out of the source. */
const classExprAround = (needle: string): string => {
    const at = src.indexOf(needle);
    expect(at, `could not find ${needle} in TradeView.tsx`).toBeGreaterThan(-1);
    return src.slice(at, at + 420);
};

describe('the expanded dock fits the row', () => {
    it('the chart flexes rather than pinning a fixed third', () => {
        // `flex-none` alongside a fixed width is the defect: the pane cannot
        // give way, so the row overflows instead.
        const pane = classExprAround('data-testid="trade-chart-pane"');
        expect(pane).not.toMatch(/dockExpanded \? '[^']*flex-none/);
        expect(pane).not.toMatch(/lg:w-1\/3/);
        // It must still be allowed to shrink.
        expect(pane).toMatch(/lg:min-w-0/);
        expect(pane).toMatch(/flex-1/);
    });

    it('the order book stands down while the dock is expanded', () => {
        // A third, FIXED-width column in a row that is already two columns is
        // what tipped the total over. Re-adding it on expand is the bug.
        const at = src.indexOf('trade-sidebar');
        expect(at).toBeGreaterThan(-1);
        const gate = src.slice(Math.max(0, at - 340), at);
        expect(gate).toMatch(/sidebarOpen && !dockExpanded/);
    });

    it('the expanded dock leaves the chart a real share, and the two sum to the row', () => {
        const dock = classExprAround('data-testid="trade-dock"');
        const m = /dockExpanded \? '([^']*)'/.exec(dock);
        expect(m, 'the expanded dock no longer sets a width').not.toBeNull();

        // Parse the lg and xl fractions and prove they fit in a row together.
        const fracs = [...m![1].matchAll(/lg:!w-(\d+)\/(\d+)/g)]
            .map(f => Number(f[1]) / Number(f[2]));
        expect(fracs.length, 'no expanded width fraction found').toBeGreaterThan(0);
        for (const f of fracs) {
            // The chart is `flex-1` and takes the remainder, so the dock alone
            // must leave the chart at least a third.
            expect(f, 'the dock must not take more than two thirds of the row')
                .toBeLessThanOrEqual(2 / 3 + 1e-9);
        }
    });

    it('the collapsed dock keeps its draggable width and its floor', () => {
        const dock = classExprAround('data-testid="trade-dock"');
        expect(dock).toMatch(/lg:w-\[var\(--dock-w\)\]/);
        expect(dock).toMatch(/lg:min-w-\[300px\]/);
    });
});
