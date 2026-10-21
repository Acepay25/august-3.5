/**
 * The chart area's CHROME — the Claude-desktop frame the owner asked for.
 *
 * jsdom mounts markup and never resolves a stylesheet, so no render in this
 * repo can see whether a panel has a fill under it, whether a control is a
 * box or a bare label, or whether a caption is uppercased. Only the SOURCE
 * can. This file is that source contract, for the files that own the trading
 * chart area (the chart, its toolbar, the readout row and the order book).
 *
 * The four rules, and what each one is worth:
 *
 *  1. **A FLAT PAGE.** The reference separates its sections with HAIRLINES;
 *     it has almost no boxes. A panel is therefore a hairline, not a fill
 *     plus a border on every surface — and a control's state is its colour,
 *     not a frame around it.
 *  2. **ONE HAIRLINE between sections**, never a box around each part.
 *  3. **Labels by ROLE.** The reference's own section headings and captions
 *     are small, muted and SENTENCE CASE. The chart area's own navigation and
 *     section labels follow that. The DATA readouts do not, and the
 *     difference is deliberate: the uppercase letter-spaced micro-label is
 *     THIS app's data-density rule (87 sites across `components/`, the
 *     order book's own PRICE/SIZE/TOTAL header among them), and the type
 *     ramp names `text-ui-2xs` a dense-DATA floor. So the readout row keeps
 *     its uppercase labels and its `font-mono tabular-nums` figures, and
 *     those are PINNED here — a future "make it all sentence case" sweep
 *     must not half-apply it and leave the chart area self-contradicting.
 *  4. **Icons at ONE small size** in ONE row, rather than a row of buttons
 *     at three different scales.
 *
 * What is deliberately NOT pinned here: the floating OVERLAYS (the timeframe
 * menu, the symbol picker, the rail's flyouts, the note editor). Those are
 * cards and fields, and the reference draws its cards and its search field
 * as bordered boxes too.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (p: string): string => readFileSync(p, 'utf8');

const TRADE = read('components/trade/TradeView.tsx');
const BOOK = read('components/trade/OrderBookPanel.tsx');
const CHART = read('components/trade/TradingChart.tsx');
const BAR = read('components/trade/TimeframeBar.tsx');
const RAIL = read('components/trade/ChartToolRail.tsx');
const PICKER = read('components/trade/SymbolPicker.tsx');

/**
 * The class expression of the element that carries `needle`.
 *
 * The class strings here are template literals (a control's state is a
 * ternary inside one class list), so the expression is read to the tag's
 * closing `>` — and no class expression in these files contains a `>` of its
 * own, which is what makes that a safe terminator.
 */
const classAfter = (src: string, needle: string): string => {
    const at = src.indexOf(needle);
    expect(at, `could not find ${needle}`).toBeGreaterThan(-1);
    const from = src.indexOf('className', at);
    expect(from, `no className after ${needle}`).toBeGreaterThan(-1);
    const to = src.indexOf('>', from);
    return src.slice(from, to === -1 ? from + 600 : to);
};

describe("the chart area is a flat page, not a stack of boxes", () => {
    it('the market row and the readout row carry no panel fill', () => {
        // The two rows are SECTIONS of the page. A fill under them is the
        // second box in a row of two; the hairline under each is the
        // separator.
        expect(TRADE).not.toMatch(/bg-zinc-900\/\d/);
        expect(TRADE).toMatch(/border-b border-white\/\[0\.06\] px-3 pb-1\.5 pt-2/);
        expect(TRADE).toMatch(/divide-x divide-white\/\[0\.06\]/);
    });

    it('the order book is a section of the page, separated by one hairline', () => {
        expect(BOOK).toMatch(/flex h-full min-h-0 flex-col border-l border-white\/\[0\.06\]/);
        // No fill of its own, and no frame around the book.
        expect(BOOK).not.toMatch(/bg-zinc-9/);
    });

    it('the drawing rail is the page with a hairline, not a panel', () => {
        expect(RAIL).toMatch(/border-r border-white\/\[0\.06\] bg-zinc-950/);
    });

    it('the spread band is separated by hairlines and not by a colour', () => {
        // The band is a ROW of the ladder, so it is bounded by the two
        // hairlines that separate the two sides — and it is not a filled
        // strip on top of them.
        const band = classAfter(BOOK, 'data-testid="orderbook-spread"');
        expect(band).toMatch(/border-y border-white\/\[0\.06\]/);
        expect(band).not.toMatch(/bg-/);
    });
});

describe('the chart area\'s toolbar controls are flat, not boxed', () => {
    it('the market row\'s controls carry no border and no raised fill', () => {
        for (const needle of [
            'data-testid="trade-book-toggle"',
            'data-testid="screener-trigger"',
            'data-testid="trade-pinned-trigger"',
        ]) {
            const cls = classAfter(TRADE, needle);
            expect(cls, needle).not.toMatch(/border-white\//);
            expect(cls, needle).not.toMatch(/bg-zinc-8/);
        }
    });

    it('the instrument is a title with a chevron, not a pill', () => {
        const cls = classAfter(PICKER, 'data-testid="symbol-picker-trigger"');
        expect(cls).not.toMatch(/border-white\//);
        expect(cls).not.toMatch(/bg-zinc-8/);
    });

    it('the study toggle is a flat control whose state is the amber fill', () => {
        const cls = classAfter(CHART, 'title="Toggle the SMA-20 overlay"');
        expect(cls).not.toMatch(/border-/);
        expect(cls).toMatch(/bg-amber-500\/10/);
    });
});

describe('labels follow their ROLE', () => {
    it('navigation and section labels are sentence case, like the reference', () => {
        // The mode switcher's tabs.
        expect(classAfter(TRADE, 'data-testid="trade-mode-switcher"')).not.toMatch(/uppercase/);
        // The timeframe picker's own section heading.
        expect(classAfter(BAR, 'data-testid="tf-picker"')).not.toMatch(/uppercase/);
        // The verdict chip is a status badge, not a data readout.
        expect(classAfter(CHART, 'data-testid="verdict-overlay-chip"')).not.toMatch(/uppercase/);
    });

    it('the data readouts KEEP the uppercase letter-spaced micro-label', () => {
        // Pinned on purpose. This app's data-density rule, not an oversight:
        // the same treatment is on the order book's own column header, and
        // the reference's sentence-case headings are PROSE headings — a
        // different role from a figure's caption.
        expect(TRADE).toMatch(/text-ui-2xs uppercase tracking-wider text-zinc-500/);
        expect(BOOK).toMatch(/font-mono text-ui-2xs uppercase tracking-wider text-zinc-500/);
    });

    it('every figure in the readout row keeps the monospace tabular figures', () => {
        expect(TRADE).toMatch(/font-mono text-ui-sm font-medium tabular-nums text-zinc-200/);
        expect(TRADE).toMatch(/font-mono text-ui-dense tabular-nums text-zinc-400/);
    });
});
