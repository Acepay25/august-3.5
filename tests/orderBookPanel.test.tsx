/**
 * OrderBookPanel — the DOM ladder. Binance delivers asks ASCENDING (best
 * nearest the spread first, index 0). The panel must show the 12 NEAREST asks
 * with the best ask sitting right under the spread row. A prior
 * `[...asks].reverse().slice(0,12)` kept the 12 FARTHEST asks and discarded the
 * near-spread ones, so bestAsk / spread% / walls / dominance were all computed
 * on deep liquidity. Regression-guarded here.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import OrderBookPanel from '../components/trade/OrderBookPanel';
import type { LiveDepth } from '../services/trade/futuresStreams';

// Asks ascending, best (lowest) first: 100, 101, … 119.
// Bids descending, best (highest) first: 99, 98, … 80.
const depth: LiveDepth = {
    asks: Array.from({ length: 20 }, (_, i) => ({ price: 100 + i, qty: 5 })),
    bids: Array.from({ length: 20 }, (_, i) => ({ price: 99 - i, qty: 5 })),
};

describe('OrderBookPanel ladder slicing', () => {
    it('shows the 12 NEAREST asks (best ask adjacent to the spread)', () => {
        render(<OrderBookPanel symbol="BTCUSDT" live liveDepth={depth} />);
        // Nearest asks (100..111) are present; the best ask sits by the spread.
        expect(screen.getAllByText('100.00').length).toBeGreaterThan(0); // best ask
        expect(screen.getAllByText('111.00').length).toBeGreaterThan(0); // 12th ask
        // The 12 FARTHEST asks (112..119) must be discarded, not shown.
        expect(screen.queryByText('112.00')).toBeNull();
        expect(screen.queryByText('119.00')).toBeNull();
    });

    it('computes the spread against the true best ask', () => {
        render(<OrderBookPanel symbol="BTCUSDT" live liveDepth={depth} />);
        // best ask 100, best bid 99 → the band shows BOTH figures: the
        // absolute spread (1.00) in the Size column and 1.000% in Total.
        const band = screen.getByTestId('orderbook-spread');
        expect(band).toBeTruthy();
        expect(within(band).getByText('spread')).toBeTruthy();
        expect(within(band).getByText('1.00')).toBeTruthy();
        expect(within(band).getByText('1.000%')).toBeTruthy();
    });
});

/**
 * The three-column ladder. Total is a running sum from the spread outward —
 * neither the REST ladder (MarketDataService) nor the live stream
 * (futuresStreams) carries a cumulative field, so this is computed in the
 * panel, and it is what the depth bar is scaled to.
 */
describe('OrderBookPanel cumulative ladder', () => {
    it('renders the Price / Size / Total headers', () => {
        render(<OrderBookPanel symbol="BTCUSDT" live liveDepth={depth} />);
        const head = screen.getByTestId('orderbook-header');
        expect(within(head).getByText('Price')).toBeTruthy();
        expect(within(head).getByText('Size')).toBeTruthy();
        expect(within(head).getByText('Total')).toBeTruthy();
    });

    it('paints 12 rows per side plus the spread band', () => {
        render(<OrderBookPanel symbol="BTCUSDT" live liveDepth={depth} />);
        expect(screen.getAllByTestId('orderbook-row')).toHaveLength(24);
        expect(screen.getByTestId('orderbook-spread')).toBeTruthy();
    });

    it('accumulates outward from the spread on both sides', () => {
        // Total is the sum of every level BETWEEN that row and the spread, so
        // the row hugging the band shows one level and the far row shows the
        // whole side. That is why the ask ladder — rendered top-farthest —
        // gets WIDER going up, and the bid ladder — rendered top-nearest —
        // gets wider going down. Both are the same staircase, mirrored.
        const { container } = render(<OrderBookPanel symbol="BTCUSDT" live liveDepth={depth} />);
        const rows = [...container.querySelectorAll('[data-testid="orderbook-row"]')] as HTMLElement[];
        const totals = rows.map(r => {
            const cells = r.querySelectorAll('span.relative');
            return Number((cells[cells.length - 1].textContent || '').replace(/,/g, ''));
        });

        // Asks are rows 0-11, rendered top-FARTHEST: the stacked end is at
        // the top of the block and the row hugging the band shows one level.
        expect(totals[0]).toBe(60);           // 12 levels × qty 5
        expect(totals[11]).toBe(5);
        // Bids are rows 12-23, rendered top-NEAREST: the mirror image. The
        // row hugging the band is the best bid, so the stacked end is the
        // LAST row.
        expect(totals[12]).toBe(5);
        expect(totals[23]).toBe(60);
    });

    it('scales the depth bar to the cumulative total, not the single level', () => {
        const { container } = render(<OrderBookPanel symbol="BTCUSDT" live liveDepth={depth} />);
        const rows = [...container.querySelectorAll('[data-testid="orderbook-row"]')] as HTMLElement[];
        const width = (i: number): number => {
            const bar = rows[i].firstElementChild as HTMLElement;
            return Number((bar.style.width || '0').replace('%', ''));
        };
        // Both sides hold 60, so the shared scale tops out at 100. The bar
        // grows AWAY from the band on both sides, so the two ladders read as
        // one staircase mirrored across the spread.
        expect(width(0)).toBeCloseTo(100, 5);                    // farthest ask
        expect(width(11)).toBeCloseTo((5 / 60) * 100, 5);        // ask at the band
        expect(width(12)).toBeCloseTo((5 / 60) * 100, 5);        // best bid
        expect(width(23)).toBeCloseTo(100, 5);                   // farthest bid
    });

    it('survives a one-sided book (no NaN widths, no throw)', () => {
        const { container } = render(
            <OrderBookPanel symbol="BTCUSDT" live liveDepth={{ asks: [], bids: depth.bids }} />,
        );
        const bars = [...container.querySelectorAll('[data-testid="orderbook-row"] span[aria-hidden]')] as HTMLElement[];
        expect(bars.length).toBe(12);
        for (const b of bars) expect(b.style.width).not.toContain('NaN');
        // With no asks the band has no spread to show.
        expect(within(screen.getByTestId('orderbook-spread')).getByText('—')).toBeTruthy();
    });

    it('shows the empty state before the first book arrives', () => {
        render(<OrderBookPanel symbol="BTCUSDT" live liveDepth={{ asks: [], bids: [] }} />);
        expect(screen.getByTestId('orderbook-empty')).toBeTruthy();
        expect(screen.queryAllByTestId('orderbook-row')).toHaveLength(0);
    });

    it('never rounds a real perps spread down to a bare 0.000%', () => {
        // BTC perps quote a tick well under 0.001%. A fixed 3-decimal format
        // printed that as "0.000%", which reads as "no spread" rather than
        // "one tick" — a plausible-looking wrong number in the exact spot a
        // trader reads for liquidity. Widen only when 3dp would round to zero.
        const oneTick: LiveDepth = {
            asks: [{ price: 84_170.10, qty: 1 }],
            bids: [{ price: 84_170.00, qty: 1 }],
        };
        const { unmount } = render(<OrderBookPanel symbol="BTCUSDT" live liveDepth={oneTick} />);
        const band = screen.getByTestId('orderbook-spread');
        expect(within(band).getByText('0.0001%')).toBeTruthy();
        expect(within(band).queryByText('0.000%')).toBeNull();
        unmount();

        // A wide spread keeps the compact form — no needless precision.
        const wide: LiveDepth = {
            asks: [{ price: 110, qty: 1 }],
            bids: [{ price: 100, qty: 1 }],
        };
        render(<OrderBookPanel symbol="BTCUSDT" live liveDepth={wide} />);
        expect(within(screen.getByTestId('orderbook-spread')).getByText('9.091%')).toBeTruthy();
    });
});
