/**
 * The family × regime heatmap strip. Its whole job is a mapping from
 * (win rate, sample count) to how full a cell looks, so that is what these
 * pin down — plus the two silence cases: an empty matrix renders nothing, and
 * a family with no trades in one regime shows a placeholder, not a fake 0%.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RegimeMatrixStrip } from '../components/dashboards/StrategyStudio';
import type { StrategyRegimeMatrix } from '../services/learning/strategyRegimeMatrix';

/** The tint percentage out of the inline `color-mix(... N%, transparent)`. */
const tintPct = (el: HTMLElement): number =>
    Number((el.style.background || '').match(/(\d+(?:\.\d+)?)%/)?.[1] ?? -1);

describe('RegimeMatrixStrip', () => {
    it('renders nothing when there is no evidence at all', () => {
        const { container } = render(<RegimeMatrixStrip matrix={{} as StrategyRegimeMatrix} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('lists only families that actually have settled trades', () => {
        render(
            <RegimeMatrixStrip
                matrix={{
                    trend_following: { trending: { w: 12, l: 4 }, ranging: { w: 1, l: 3 } },
                    mean_reversion: { compression: { w: 9, l: 9 } },
                    breakout: {},
                } as StrategyRegimeMatrix}
            />,
        );
        expect(screen.getByText('trend following')).toBeInTheDocument();
        expect(screen.getByText('mean reversion')).toBeInTheDocument();
        // `breakout` carries no tallies, so it never earns a row.
        expect(screen.queryByText('breakout')).toBeNull();
    });

    it('tints a winning cell green, a losing cell red, and never invents a cell', () => {
        render(
            <RegimeMatrixStrip
                matrix={{
                    trend_following: { trending: { w: 18, l: 2 }, volatile: { w: 1, l: 15 } },
                } as StrategyRegimeMatrix}
            />,
        );
        const win = screen.getByTitle(/trending: 18W\/2L/);
        const loss = screen.getByTitle(/volatile: 1W\/15L/);
        expect(win.textContent).toBe('90%');
        expect(loss.textContent).toBe('6%');
        expect(win.className).toContain('text-emerald-400');
        expect(loss.className).toContain('text-rose-400');

        // A regime with no trades shows a dot on a bare cell — not a 0% that
        // would read as a catastrophic record.
        const empty = screen.getByTitle(/ranging: no settled trades/);
        expect(empty.textContent).toBe('·');
        expect(empty.style.background).toBe('');
    });

    it('fades a thin sample below the trustworthy edge of a fat one', () => {
        render(
            <RegimeMatrixStrip
                matrix={{
                    trend_following: { trending: { w: 5, l: 1 }, ranging: { w: 50, l: 10 } },
                } as StrategyRegimeMatrix}
            />,
        );
        const thin = screen.getByTitle(/trending: 5W\/1L.*thin sample/);
        const fat = screen.getByTitle(/ranging: 50W\/10L/);
        // Identical 83% edge — the only difference the tint may carry is
        // evidence, so the 6-trade cell must stay visibly fainter.
        expect(thin.textContent).toBe('83%');
        expect(fat.textContent).toBe('83%');
        expect(tintPct(thin)).toBeGreaterThan(0);
        expect(tintPct(fat)).toBeGreaterThan(tintPct(thin));
    });

    it('marks the live regime column so the current tape read pops', () => {
        render(
            <RegimeMatrixStrip
                matrix={{ trend_following: { trending: { w: 5, l: 1 } } } as StrategyRegimeMatrix}
                currentRegime="trending"
            />,
        );
        expect(screen.getByTitle(/trending: 5W\/1L/).className).toContain('ring-cyan-500/30');
        expect(screen.getByTitle(/volatile: no settled trades/).className).not.toContain('ring-cyan-500/30');
    });
});
