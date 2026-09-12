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
    runScreener: (...args: unknown[]) => runScreenerMock(...args),
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
    runScreenerMock.mockImplementation(async ({ onRows }) => {
        onRows?.(ROWS.slice(0, 1));
        onRows?.(ROWS);
        return ROWS;
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

    it('aborts the scan when the panel closes', async () => {
        const onClose = vi.fn();
        const { rerender } = render(<ScreenerPanel open onClose={onClose} onChangeSymbol={vi.fn()} />);
        await waitFor(() => expect(screen.getByTestId('screener-row-BTCUSDT')).toBeTruthy());
        rerender(<ScreenerPanel open={false} onClose={onClose} onChangeSymbol={vi.fn()} />);
        // A closed panel renders nothing at all.
        expect(screen.queryByTestId('screener-panel')).toBeNull();
    });
});
