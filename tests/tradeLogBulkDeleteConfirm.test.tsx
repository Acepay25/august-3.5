/**
 * TradeLog bulk "Delete Selected" confirm gate (audit-2026-09-15): the
 * cascade-delete (trades + reasoning + autopilot watchers, no undo) used to
 * fire on a single click while "Clear all" demanded a typed CLEAR. It now
 * rides the app's shared ConfirmDialog. Rows render behind react-virtuoso
 * (stubbed — layout APIs are absent in jsdom); selection happens through
 * the "Select N memory trades" shortcut so the gate itself is what's tested.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { LoggedTrade, TradeAnalysis } from '../types';

vi.mock('react-virtuoso', () => ({
    Virtuoso: () => <div data-testid="virtuoso-stub" />,
}));

import TradeLogContent from '../components/journal/TradeLog';

const mk = (id: string): LoggedTrade => ({
    id,
    analysis: { coinName: id, direction: 'Long' } as TradeAnalysis,
    outcome: 'WIN' as LoggedTrade['outcome'],
    timestamp: new Date().toISOString(),
});

const renderLog = (): { onDeleteTrades: ReturnType<typeof vi.fn> } => {
    const onDeleteTrades = vi.fn();
    render(
        <TradeLogContent
            trades={[mk('a'), mk('b')]}
            onDeleteTrades={onDeleteTrades}
            onClearAllTrades={vi.fn()}
            modelIdToName={{}}
            onUpdateInsights={vi.fn()}
            currentInsightIds={['a', 'b']}
            onUpdateTradeLeverage={vi.fn()}
        />
    );
    return { onDeleteTrades };
};

const selectBothAndAskDelete = (): void => {
    fireEvent.click(screen.getByText(/Select 2 memory trades/));
    fireEvent.click(screen.getByRole('button', { name: /Delete Selected/ }));
};

describe('TradeLog bulk delete confirm gate', () => {
    it('Delete Selected asks first — nothing is deleted before the confirm', async () => {
        const { onDeleteTrades } = renderLog();
        selectBothAndAskDelete();
        // The gate: no cascade fired yet…
        expect(onDeleteTrades).not.toHaveBeenCalled();
        // …and the in-app confirm dialog is open.
        expect(await screen.findByText('Delete 2 selected trades?')).toBeInTheDocument();
    });

    it('Cancel keeps every trade; confirming deletes exactly the selection', async () => {
        const { onDeleteTrades } = renderLog();
        selectBothAndAskDelete();
        await screen.findByText('Delete 2 selected trades?');
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(onDeleteTrades).not.toHaveBeenCalled();
        // Second attempt, confirmed this time.
        fireEvent.click(screen.getByRole('button', { name: /Delete Selected/ }));
        await screen.findByText('Delete 2 selected trades?');
        fireEvent.click(screen.getByTestId('confirm-dialog-confirm'));
        await waitFor(() => expect(onDeleteTrades).toHaveBeenCalledWith(['a', 'b']));
    });

    it('is scoped to the selection — "Clear all" keeps its own typed-CLEAR gate', async () => {
        const onClearAllTrades = vi.fn();
        const onDeleteTrades = vi.fn();
        render(
            <TradeLogContent
                trades={[mk('a'), mk('b')]}
                onDeleteTrades={onDeleteTrades}
                onClearAllTrades={onClearAllTrades}
                modelIdToName={{}}
                onUpdateInsights={vi.fn()}
                currentInsightIds={['a', 'b']}
                onUpdateTradeLeverage={vi.fn()}
            />
        );
        fireEvent.click(screen.getByText('Clear all'));
        await screen.findByText('Clear all logged trades?');
        // The wipe-everything path still demands the typed confirmation…
        expect(screen.getByTestId('confirm-typed-input')).toBeInTheDocument();
        expect(screen.getByTestId('confirm-dialog-confirm')).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(onClearAllTrades).not.toHaveBeenCalled();
        // …and the bulk gate is a separate dialog that never touches the
        // whole log.
        expect(onDeleteTrades).not.toHaveBeenCalled();
    });
});
