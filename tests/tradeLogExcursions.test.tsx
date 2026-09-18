/**
 * Renders the trade detail screen to prove the two blocks added with the
 * excursion work actually appear, and stay silent for legacy rows.
 *
 * react-virtuoso is stubbed WITH rendering (the other TradeLog test stubs it to
 * an empty div, because it only tests the delete gate): the detail view is only
 * reachable by clicking a row, and rows only exist if itemContent runs.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import type { LoggedTrade, TradeAnalysis } from '../types';

vi.mock('react-virtuoso', () => ({
    Virtuoso: ({ data, itemContent }: { data: LoggedTrade[]; itemContent: (i: number, t: LoggedTrade) => React.ReactNode }) => (
        <div data-testid="virtuoso-list">
            {(data ?? []).map((trade, i) => <div key={trade.id}>{itemContent(i, trade)}</div>)}
        </div>
    ),
}));

import TradeLogContent from '../components/journal/TradeLog';

const trade = (over: Partial<LoggedTrade> = {}): LoggedTrade => ({
    id: 't1',
    timestamp: new Date().toISOString(),
    outcome: 'WIN' as LoggedTrade['outcome'],
    analysis: { coinName: 'BTC/USDT', direction: 'Long', entryPoints: [{ price: '65000' }] } as TradeAnalysis,
    ...over,
} as LoggedTrade);

const renderList = (t: LoggedTrade): void => {
    render(
        <TradeLogContent
            trades={[t]}
            onDeleteTrades={vi.fn()}
            onClearAllTrades={vi.fn()}
            modelIdToName={{}}
            onUpdateInsights={vi.fn()}
            currentInsightIds={[]}
            onUpdateTradeLeverage={vi.fn()}
        />,
    );
};

const openDetail = (t: LoggedTrade): void => {
    renderList(t);
    fireEvent.click(screen.getByTestId('virtuoso-list').querySelector('button')!);
};

describe('trade detail — excursions and dissent', () => {
    it('shows the measured window, the capture share, and the peer dissent tally', () => {
        const sample = trade({
            pnlPercent: 80,
            maxAdverseExcursion: 12,
            maxFavorableExcursion: 100,
            debateTurns: [
                { speaker: 'A', round: 2, text: '', fincom: [{ seat: 'Risk', stance: 'commit', why: '' }] },
                {
                    speaker: 'B', round: 2, text: '', fincom: [
                        { seat: 'Technical', stance: 'dissent', why: '' },
                        { seat: 'Macro', stance: 'dissent', why: '' },
                    ],
                },
            ],
        });
        // The compact capture tag lives on the LIST row — check it before the
        // detail view replaces the list.
        renderList(sample);
        expect(screen.getByTestId('virtuoso-list').textContent).toContain('cap 80%');
        fireEvent.click(screen.getByTestId('virtuoso-list').querySelector('button')!);

        const excursions = screen.getByTestId('trade-excursions');
        expect(excursions.textContent).toContain('worst −12.0%');
        expect(excursions.textContent).toContain('best +100.0%');
        expect(excursions.textContent).toContain('80%');       // 80 realized of 100 offered

        const fincom = screen.getByTestId('trade-fincom');
        expect(fincom.textContent).toContain('2 dissents');
        expect(fincom.textContent).toContain('1 commit');
        expect(fincom.textContent).toContain('Technical');
        cleanup();
    });

    it('renders nothing excursion-shaped for a trade the post-mortem never measured', () => {
        renderList(trade({ pnlPercent: 40 }));
        expect(screen.getByTestId('virtuoso-list').textContent).not.toContain('cap ');
        fireEvent.click(screen.getByTestId('virtuoso-list').querySelector('button')!);
        expect(screen.queryByTestId('trade-excursions')).toBeNull();
        // No markers stored either — absence, not a zero-filled row.
        expect(screen.queryByTestId('trade-fincom')).toBeNull();
        cleanup();
    });

    it('shows the window without capture when only the adverse side was measured', () => {
        openDetail(trade({ maxAdverseExcursion: 30 }));
        const excursions = screen.getByTestId('trade-excursions');
        expect(excursions.textContent).toContain('worst −30.0%');
        expect(excursions.textContent).toContain('best +—');
        expect(excursions.textContent).not.toContain('captured');
        cleanup();
    });
});
