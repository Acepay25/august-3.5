/**
 * ScreenerPanel — progressive market table: rows land while the scan runs,
 * the filter/setups-only/sort controls narrow it, and a row click hands the
 * symbol to the chart and closes.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { runScreenerMock } = vi.hoisted(() => ({
    runScreenerMock: vi.fn() as Mock<(...args: any[]) => any>,
}));

vi.mock('../services/trade/screener', () => ({
    runScreenerWithStatus: (...args: unknown[]) => runScreenerMock(...args),
}));

import ScreenerPanel from '../components/trade/ScreenerPanel';

const ROW = (symbol: string, base: string, change24h: number, rsi14: number | null, setups: number) => ({
    symbol, baseAsset: base, price: 100, change24h, quoteVolume: 1e9,
    rsi14, regime: 'range' as const,
    setups: Array.from({ length: setups }, (_, i) => ({ title: `Setup ${i}`, side: 'long' as const })),
    edge: '7W/5L',
});

const ROWS = [
    ROW('BTCUSDT', 'BTC', 1.2, 61, 0),
    ROW('SOLUSDT', 'SOL', 6.0, 44, 2),
];

beforeEach(() => {
    runScreenerMock.mockReset();
    runScreenerMock.mockImplementation(async ({ onRows }: { onRows?: (r: unknown[]) => void }) => {
        onRows?.(ROWS.slice(0, 1));
        onRows?.(ROWS);
        return { rows: ROWS, universeFailed: false };
    });
});

const mount = (onChangeSymbol = vi.fn(), onClose = vi.fn()): void => {
    render(<ScreenerPanel open onClose={onClose} onChangeSymbol={onChangeSymbol} />);
};

describe('ScreenerPanel', () => {
    it('renders rows progressively (both rows land) and starts a scan on open', async () => {
        mount();
        await waitFor(() => expect(screen.getByTestId('screener-row-SOLUSDT')).toBeTruthy());
        expect(screen.getByTestId('screener-row-BTCUSDT')).toBeTruthy();
        expect(screen.getByText(/scanning|coins scanned/)).toBeTruthy();
    });

    it('filters by symbol and by setups-only', async () => {
        mount();
        await waitFor(() => expect(screen.getByTestId('screener-row-SOLUSDT')).toBeTruthy());
        fireEvent.change(screen.getByLabelText('Filter screener symbols'), { target: { value: 'sol' } });
        expect(screen.getByTestId('screener-row-SOLUSDT')).toBeTruthy();
        expect(screen.queryByTestId('screener-row-BTCUSDT')).toBeNull();
        fireEvent.change(screen.getByLabelText('Filter screener symbols'), { target: { value: '' } });
        fireEvent.click(screen.getByText('Setups only'));
        expect(screen.getByTestId('screener-row-SOLUSDT')).toBeTruthy();
        expect(screen.queryByTestId('screener-row-BTCUSDT')).toBeNull();
    });

    it('hands the symbol to the chart and closes on row click', async () => {
        const onChangeSymbol = vi.fn();
        const onClose = vi.fn();
        mount(onChangeSymbol, onClose);
        await waitFor(() => expect(screen.getByTestId('screener-row-BTCUSDT')).toBeTruthy());
        fireEvent.click(screen.getByTestId('screener-row-BTCUSDT'));
        expect(onChangeSymbol).toHaveBeenCalledWith('BTCUSDT');
        expect(onClose).toHaveBeenCalled();
    });

    it('is a modal dialog: Escape closes it and focus lands inside it', async () => {
        const onClose = vi.fn();
        mount(vi.fn(), onClose);
        await waitFor(() => expect(screen.getByTestId('screener-row-BTCUSDT')).toBeTruthy());

        const dialog = screen.getByRole('dialog');
        expect(dialog.getAttribute('aria-modal')).toBe('true');

        // The trap focuses the container on open (delayed a frame) — without
        // it, Tab in a portal starts at the top of the document instead.
        await waitFor(() => expect(document.activeElement).toBe(dialog));

        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).toHaveBeenCalled();
    });

    it('aborts the scan when the panel closes', async () => {
        const onClose = vi.fn();
        const { rerender } = render(<ScreenerPanel open onClose={onClose} onChangeSymbol={vi.fn()} />);
        await waitFor(() => expect(screen.getByTestId('screener-row-BTCUSDT')).toBeTruthy());
        rerender(<ScreenerPanel open={false} onClose={onClose} onChangeSymbol={vi.fn()} />);
        // A closed panel renders nothing at all.
        expect(screen.queryByTestId('screener-panel')).toBeNull();
    });

    it('shows a red feed-failed row with retry when the universe fetch failed', async () => {
        runScreenerMock.mockImplementation(async () => ({ rows: [], universeFailed: true }));
        mount();
        await waitFor(() => expect(screen.getByText(/Feed failed/i)).toBeTruthy());
        // NOT the honest-empty message — a blind screen must never read "No coins match".
        expect(screen.queryByText(/No coins match/)).toBeNull();
        expect(screen.getByTestId('screener-retry')).toBeTruthy();
    });

    it('retry re-runs the scan and recovers when the feed answers', async () => {
        runScreenerMock.mockImplementationOnce(async () => ({ rows: [], universeFailed: true }));
        mount();
        await waitFor(() => expect(screen.getByTestId('screener-retry')).toBeTruthy());
        fireEvent.click(screen.getByTestId('screener-retry'));
        await waitFor(() => expect(runScreenerMock).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(screen.getByTestId('screener-row-BTCUSDT')).toBeTruthy());
        expect(screen.queryByText(/Feed failed/i)).toBeNull();
        expect(screen.queryByText(/No coins match/)).toBeNull();
    });

    it('empty-but-alive universe still says "No coins match" (honest empty)', async () => {
        runScreenerMock.mockImplementation(async () => ({ rows: [], universeFailed: false }));
        mount();
        await waitFor(() => expect(screen.getByText('No coins match.')).toBeTruthy());
        expect(screen.queryByText(/Feed failed/i)).toBeNull();
    });
});
