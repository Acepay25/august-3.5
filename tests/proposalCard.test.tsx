/**
 * The proposal card during a concurrent gate scan.
 *
 * The plan's levels appear the instant the model names them; the probability, the
 * confidence tier and the grade appear only once the scan has answered — because
 * those three are the numbers the cap changes, and a card quoting an uncapped 72%
 * next to a row logged at 50% is the disagreement this design exists to prevent.
 */

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import TradeProposalCard from '../components/trade/panels/TradeProposalCard';
import type { TradeProposal } from '../services/trade/proposedTrade';

const proposal = (over: Partial<TradeProposal> = {}): TradeProposal => ({
    symbol: 'BTCUSDT',
    direction: 'Long',
    entry: 100,
    stopLoss: 95,
    takeProfits: [115],
    confidence: 'High',
    planId: 'btc-1',
    rationale: 'Reclaim of the daily VWAP with the funding still negative.',
    ...over,
});

const renderCard = (p: TradeProposal, opts: { awaiting?: boolean } = {}) => render(
    <TradeProposalCard
        proposal={p}
        canLog
        awaitingLog={opts.awaiting}
        onLog={vi.fn()}
        onCancel={vi.fn()}
    />,
);

afterEach(cleanup);

describe('the card while the scan is still running', () => {
    it('shows every level immediately', () => {
        renderCard(proposal());
        const card = screen.getByTestId('trade-proposal-card');
        expect(card.textContent).toContain('100');
        expect(card.textContent).toContain('95');
        expect(card.textContent).toContain('115');
        expect(card.textContent).toContain('R:R');
    });

    it('shows NO probability and no confidence tier until the stamp lands', () => {
        renderCard(proposal());
        expect(screen.queryByTestId('proposal-confidence')).toBeNull();
        expect(screen.getByTestId('proposal-gate-pending')).toHaveTextContent('checking');
        // Not the raw label either — "High" is the number the cap can change.
        expect(screen.getByTestId('trade-proposal-card').textContent).not.toContain('High');
    });

    it('shows the isolated-liquidation buffer beside the stop (E-41)', () => {
        // The app's new default is 10×; a 5 % stop leaves 5 % to liquidation.
        renderCard(proposal());
        expect(screen.getByTestId('proposal-liq-buffer')).toHaveTextContent(/Liq buffer 5\.0%/);
        // At the OLD 100× default the stop is already past liquidation, and
        // the card says so instead of staying silent.
        cleanup();
        render(
            <TradeProposalCard proposal={proposal()} canLog leverage={100}
                onLog={vi.fn()} onCancel={vi.fn()} />,
        );
        expect(screen.getByTestId('proposal-liq-buffer')).toHaveTextContent(/SL is past isolated liquidation at 100x/);
    });

    it('the Log button still works while the scan is pending', () => {
        const onLog = vi.fn();
        render(<TradeProposalCard proposal={proposal()} canLog onLog={onLog} onCancel={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: /Log this trade/ }));
        expect(onLog).toHaveBeenCalledTimes(1);
    });

    it('is disabled and self-explaining while the log awaits the scan', () => {
        renderCard(proposal(), { awaiting: true });
        const btn = screen.getByRole('button', { name: /Checking the gate/ });
        expect(btn).toBeDisabled();
        expect(screen.queryByRole('button', { name: /Log this trade/ })).toBeNull();
    });
});

describe('the card once the stamp has landed', () => {
    it('a REFUSED plan quotes the number and disables the Log button', () => {
        const onLog = vi.fn();
        render(<TradeProposalCard
            proposal={proposal({
                gate: {
                    status: 'evaluated', confidenceCap: 0.5, reason: '50% cap',
                    stampedAt: new Date().toISOString(),
                    refusal: 'net expectancy -0.44R at 44% is at or below your 0.00R floor',
                    netEdgeR: -0.44, minEdgeThresholdR: 0,
                },
            })}
            canLog onLog={onLog} onCancel={vi.fn()}
        />);
        expect(screen.getByTestId('proposal-refused')).toHaveTextContent(/net expectancy -0.44R/);
        const btn = screen.getByRole('button', { name: /Refused by your edge floor/ });
        expect(btn).toBeDisabled();
        fireEvent.click(btn);
        expect(onLog).not.toHaveBeenCalled();
    });

    it('renders the CAPPED probability and tier, from the row builder', () => {
        renderCard(proposal({
            gate: { status: 'evaluated', confidenceCap: 0.5, reason: '50% cap', stampedAt: new Date().toISOString() },
        }));
        expect(screen.queryByTestId('proposal-gate-pending')).toBeNull();
        expect(screen.getByTestId('proposal-confidence')).toHaveTextContent('50%');
        // The tier shown is the band the capped number earns (task 33), so a
        // 50% plan is never labelled "Medium" on the card the trader accepts.
        expect(screen.getByTestId('proposal-confidence')).toHaveTextContent('Low');
    });

    it('an unmeasurable plan says so on the card, next to the button', () => {
        renderCard(proposal({
            gate: { status: 'unavailable', confidenceCap: 1, reason: 'market data fetch returned nothing', stampedAt: new Date().toISOString() },
        }));
        expect(screen.getByTestId('proposal-gate-unavailable')).toHaveTextContent('UNCAPPED');
        expect(screen.getByTestId('proposal-gate-unavailable')).toHaveTextContent('confirm');
        // Unavailable means UNCAPPED, not zero: the model's own 72% is shown
        // with the warning, never a fabricated 0%.
        expect(screen.getByTestId('proposal-confidence')).toHaveTextContent('72%');
    });
});
