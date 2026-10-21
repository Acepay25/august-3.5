/**
 * Renders the trade detail screen to prove the excursion block actually
 * appears, and stays silent for rows that were never measured.
 *
 * The block used to be pinned alongside a peer-dissent tally read out of the
 * debate transcript. That tally went with the debate (2026-10-18); what is
 * left here is the half the journal still measures.
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

describe('trade detail — the measured excursion window', () => {
    it('shows the window and the capture share, on the row and in the detail', () => {
        const sample = trade({
            pnlPercent: 80,
            maxAdverseExcursion: 12,
            maxFavorableExcursion: 100,
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
        cleanup();
    });

    it('renders nothing excursion-shaped for a trade with no measured window', () => {
        renderList(trade({ pnlPercent: 40 }));
        expect(screen.getByTestId('virtuoso-list').textContent).not.toContain('cap ');
        fireEvent.click(screen.getByTestId('virtuoso-list').querySelector('button')!);
        expect(screen.queryByTestId('trade-excursions')).toBeNull();
        cleanup();
    });

    it('shows the window without capture when only the adverse side exists', () => {
        openDetail(trade({ maxAdverseExcursion: 30 }));
        const excursions = screen.getByTestId('trade-excursions');
        expect(excursions.textContent).toContain('worst −30.0%');
        expect(excursions.textContent).toContain('best +—');
        expect(excursions.textContent).not.toContain('captured');
        cleanup();
    });
});

// E-57 §1. The note the app writes at settlement has to be READ, or a journal the
// model can write into becomes an invisible edit to the trader's own record.
describe('trade detail — the post-mortem the app wrote (E-57 §1)', () => {
    const note = [
        'Post-mortem written by the app at settlement (gpt-x).',
        '',
        'The short was entered at 100 with the stop at 105 and never reached a target.',
        '',
        'Lesson: size the stop to the sweep, not to the round number.',
        '',
        'IF a short entry sits below a low whose reclaim would close above the stop THEN skip the entry.',
    ].join('\n');

    it('shows the reflection in the open, with who wrote it', () => {
        openDetail(trade({ postMortem: note, postMortemModel: 'gpt-x', postMortemCreatedAt: '2026-10-22T01:00:00.000Z' }));
        const section = screen.getByTestId('trade-post-mortem');
        expect(section.textContent).toContain('size the stop to the sweep');
        expect(section.textContent).toContain('IF a short entry sits below a low');
        // The byline reads off the FIELDS, not only the prose: the row carries
        // which model wrote it, and a reader who copy-pastes the note is not the
        // only audience that needs to know.
        expect(screen.getByTestId('trade-post-mortem-when').textContent).toContain('gpt-x');
        // And it is not behind a fold — the note is a sibling of the setup
        // details, visible when the detail screen opens.
        expect(section.closest('details')).toBeNull();
        cleanup();
    });

    it('control: a row with no reflection shows no post-mortem block', () => {
        openDetail(trade({}));
        expect(screen.queryByTestId('trade-post-mortem')).toBeNull();
        cleanup();
    });

    it('a legacy note still renders, and claims no model it never had', () => {
        openDetail(trade({ postMortem: 'Lesson: the old note, written before the app reflected on anything.' }));
        expect(screen.getByTestId('trade-post-mortem').textContent).toContain('the old note');
        expect(screen.getByTestId('trade-post-mortem-when').textContent).not.toContain('gpt');
        cleanup();
    });
});
