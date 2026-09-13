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
import { render, screen } from '@testing-library/react';
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
        // best ask 100, best bid 99 → spread 1.000%.
        expect(screen.getByText('spread 1.000%')).toBeTruthy();
    });
});
