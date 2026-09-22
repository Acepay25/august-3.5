/**
 * The Journal's scalp/swing filter must not report an absent measurement as an
 * absent fact (2026-09-21).
 *
 * The filter reads `tradeType`, a field the analysis pipeline used to never
 * write: the detector existed with no caller and no tests, and the manual
 * override it defers to had no editor either. So "Scalp" always showed zero
 * rows while the panel said "Nothing matches the current filters" — a sentence
 * telling a trader he made no scalp trades when the truth was that nothing had
 * ever been classified. Verdicts are classified at finalization now, so this
 * empty state is about trades logged before that, and the copy says so.
 *
 * Same doctrine the desk tools follow for a failed fetch: DATA_UNAVAILABLE is
 * not evidence that no news exists, and an unclassified journal is not evidence
 * that you made no scalps. These pin the two messages apart.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { LoggedTrade, TradeAnalysis } from '../types';

vi.mock('react-virtuoso', () => ({
    Virtuoso: () => <div data-testid="virtuoso-stub" />,
}));

import TradeLogContent from '../components/journal/TradeLog';

const trade = (id: string, type?: 'scalp' | 'swing'): LoggedTrade => ({
    id,
    analysis: { coinName: id, direction: 'Long', tradeType: type } as TradeAnalysis,
    outcome: 'WIN' as LoggedTrade['outcome'],
    timestamp: new Date().toISOString(),
});

const renderLog = (trades: LoggedTrade[]) => render(
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

const pickScalp = (): void => {
    fireEvent.click(screen.getByRole('button', { name: /◆ scalp/ }));
};

describe('the trade-type filter tells the truth about why it is empty', () => {
    it('says nothing is classified, not nothing matched, when no row has a label', () => {
        renderLog([trade('a'), trade('b'), trade('c')]);
        pickScalp();
        expect(screen.getByText('Nothing is classified yet')).toBeInTheDocument();
        expect(screen.queryByText('No matching trades')).not.toBeInTheDocument();
        // It must not claim a judgment about how the trader actually traded.
        expect(screen.getByText(/says nothing about how you traded/)).toBeInTheDocument();
    });

    it('offers a way out, and taking it restores the table', () => {
        renderLog([trade('a'), trade('b')]);
        pickScalp();
        fireEvent.click(screen.getByTestId('journal-clear-type-filter'));
        expect(screen.queryByText('Nothing is classified yet')).not.toBeInTheDocument();
        expect(screen.getByTestId('virtuoso-stub')).toBeInTheDocument();
    });

    it('falls back to the ordinary message when labels exist but none match', () => {
        // One genuinely classified swing trade: "no scalps" is now a real fact,
        // so it must read as a filter result, not as a missing measurement.
        renderLog([trade('a', 'swing'), trade('b')]);
        pickScalp();
        expect(screen.getByText('No matching trades')).toBeInTheDocument();
        expect(screen.queryByText('Nothing is classified yet')).not.toBeInTheDocument();
    });

    it('shows the rows when a classification matches', () => {
        renderLog([trade('a', 'scalp'), trade('b')]);
        pickScalp();
        expect(screen.queryByText('Nothing is classified yet')).not.toBeInTheDocument();
        expect(screen.queryByText('No matching trades')).not.toBeInTheDocument();
        expect(screen.getByTestId('virtuoso-stub')).toBeInTheDocument();
    });

    it('leaves the unfiltered journal alone', () => {
        renderLog([trade('a'), trade('b')]);
        expect(screen.queryByText('Nothing is classified yet')).not.toBeInTheDocument();
        expect(screen.getByTestId('virtuoso-stub')).toBeInTheDocument();
    });
});
