/**
 * A row has to SHOW the class the filter filters on (2026-09-22).
 *
 * Finalization now labels each verdict scalp-or-swing, but `tradeType` appeared
 * in exactly one place in the whole component tree: the filter predicate. So a
 * trader could narrow the journal to ◆ scalp and see a list of rows, none of
 * which said whether they were scalps — the label existed only as something to
 * filter by, and the filter's own result could not be checked by eye.
 *
 * react-virtuoso is stubbed WITH rendering here (as in tradeLogExcursions): rows
 * only exist at all if `itemContent` runs.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import type { LoggedTrade, TradeAnalysis } from '../types';

vi.mock('react-virtuoso', () => ({
    Virtuoso: ({ data, itemContent }: { data: LoggedTrade[]; itemContent: (i: number, t: LoggedTrade) => React.ReactNode }) => (
        <div data-testid="virtuoso-list">
            {(data ?? []).map((trade, i) => <div key={trade.id}>{itemContent(i, trade)}</div>)}
        </div>
    ),
}));

import TradeLogContent from '../components/journal/TradeLog';

const trade = (id: string, over: Partial<LoggedTrade> = {}, analysisOver: Partial<TradeAnalysis> = {}): LoggedTrade => ({
    id,
    timestamp: new Date().toISOString(),
    outcome: 'WIN' as LoggedTrade['outcome'],
    analysis: { coinName: id, direction: 'Long', ...analysisOver } as TradeAnalysis,
    ...over,
});

const renderRows = (trades: LoggedTrade[]) => render(
    <TradeLogContent
        trades={trades}
        onDeleteTrades={vi.fn()}
        onClearAllTrades={vi.fn()}
        modelIdToName={{}}
        onUpdateInsights={vi.fn()}
        currentInsightIds={trades.map(t => t.id)}
        onUpdateTradeLeverage={vi.fn()}
    />,
);

/** Scoped to the list on purpose: the filter chips read "◆ scalp" / "◇ swing"
 *  too — the row reuses that vocabulary deliberately — so an unscoped query
 *  matches the control and the content at once. */
const rows = () => within(screen.getByTestId('virtuoso-list'));

describe('the journal row shows its detected class', () => {
    it('marks a scalp with the same glyph the filter chip uses', () => {
        renderRows([trade('scalp-row', { tradeType: 'scalp' })]);
        expect(rows().getByText(/◆ scalp/)).toBeInTheDocument();
    });

    it('marks a swing with ◇', () => {
        renderRows([trade('swing-row', { tradeType: 'swing' })]);
        expect(rows().getByText(/◇ swing/)).toBeInTheDocument();
    });

    it('reads the class off the nested analysis too, not only the denormalized copy', () => {
        // `LoggedTrade.tradeType` is a denormalization for stats; older rows
        // carry the value only inside `analysis`.
        renderRows([trade('nested', {}, { tradeType: 'scalp' })]);
        expect(rows().getByText(/◆ scalp/)).toBeInTheDocument();
    });

    it('shows no glyph on an unclassified row, matching the empty-state story', () => {
        renderRows([trade('legacy')]);
        expect(rows().queryByText(/◆|◇/)).not.toBeInTheDocument();
        // The row still renders its direction — this is about the missing label,
        // not a missing row.
        expect(rows().getByText(/Long/)).toBeInTheDocument();
    });
});

/** The counterweight to labelling every verdict automatically: without an
 *  editor the class is something you can filter by but never disagree with, and
 *  `tradeTypeManualOverride` — the flag the detector honours — has no writer. */
describe('the trade detail can override the detected class', () => {
    const openDetail = (onUpdateTradeType: (id: string, t: 'scalp' | 'swing') => void) => {
        render(
            <TradeLogContent
                trades={[trade('editable', { tradeType: 'scalp' })]}
                onDeleteTrades={vi.fn()}
                onClearAllTrades={vi.fn()}
                modelIdToName={{}}
                onUpdateInsights={vi.fn()}
                currentInsightIds={['editable']}
                onUpdateTradeLeverage={vi.fn()}
                onUpdateTradeType={onUpdateTradeType}
                onUpdateOutcome={vi.fn()}
            />,
        );
        fireEvent.click(screen.getByText('editable.md'));
    };

    it('offers both classes and marks the detected one as pressed', () => {
        openDetail(vi.fn());
        const editor = screen.getByTestId('trade-type-editor');
        expect(within(editor).getByRole('button', { name: /◆ scalp/ })).toHaveAttribute('aria-pressed', 'true');
        expect(within(editor).getByRole('button', { name: /◇ swing/ })).toHaveAttribute('aria-pressed', 'false');
    });

    it('reports the correction against the right trade', () => {
        const onUpdateTradeType = vi.fn();
        openDetail(onUpdateTradeType);
        fireEvent.click(within(screen.getByTestId('trade-type-editor')).getByRole('button', { name: /◇ swing/ }));
        expect(onUpdateTradeType).toHaveBeenCalledWith('editable', 'swing');
    });

    it('says MANUAL once the trader has overridden the detector', () => {
        render(
            <TradeLogContent
                trades={[trade('manual', { tradeType: 'swing' }, { tradeType: 'swing', tradeTypeManualOverride: true })]}
                onDeleteTrades={vi.fn()}
                onClearAllTrades={vi.fn()}
                modelIdToName={{}}
                onUpdateInsights={vi.fn()}
                currentInsightIds={['manual']}
                onUpdateTradeLeverage={vi.fn()}
                onUpdateTradeType={vi.fn()}
            />,
        );
        fireEvent.click(screen.getByText('manual.md'));
        expect(within(screen.getByTestId('trade-type-editor')).getByText('manual')).toBeInTheDocument();
    });

    it('shows no manual badge while the class is still the detector’s', () => {
        openDetail(vi.fn());
        expect(within(screen.getByTestId('trade-type-editor')).queryByText('manual')).not.toBeInTheDocument();
    });
});
