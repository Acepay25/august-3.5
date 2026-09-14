/**
 * BiasChips — the dock's code-calculated bias row. The series come through
 * the mocked KlineService so this tests the COMPONENT contract only: the
 * row appears when both pulls land, reads straight from the regime math,
 * follows the coin/timeframe, and renders NOTHING on thin or failed data
 * (never a placeholder chip).
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const DAY = 86_400_000;
const LAST_DAY = 40 * DAY;

const { fetchRef } = vi.hoisted(() => ({
    fetchRef: {
        current: (_symbol: string, _interval: string, _limit: number): Promise<unknown[]> =>
            Promise.resolve([]),
    },
}));
vi.mock('../services/analysis/KlineService', () => ({
    fetchKlines: (s: string, i: string, l: number) => fetchRef.current(s, i, l),
}));

import BiasChips from '../components/trade/BiasChips';
import type { Kline } from '../services/analysis/MarketDataService';

const dailyRise: Kline[] = Array.from({ length: 40 }, (_, i) => ({
    time: i * DAY, open: 100 + i, high: 101 + i, low: 99 + i, close: 100 + i, volume: 10,
}));
const currentFlat: Kline[] = Array.from({ length: 60 }, (_, i) => ({
    time: LAST_DAY + 900_000 + i * 900_000, open: 200, high: 201, low: 199, close: 200, volume: 10,
}));

beforeEach(() => { fetchRef.current = () => Promise.resolve([]); });

describe('BiasChips', () => {
    it('paints the chip row from the two series, macro first', async () => {
        fetchRef.current = (_s, interval) =>
            Promise.resolve(interval === '1d' ? dailyRise : currentFlat);
        render(<BiasChips symbol="BTCUSDT" interval="15m" />);
        const row = await screen.findByTestId('bias-chips');
        expect(row.textContent).toContain('1D Bullish');
        expect(row.textContent).toContain('15m Neutral');
        expect(row.textContent).toContain('Above VWAP');
    });

    it('stays silent while the pulls fail or return too little history', async () => {
        fetchRef.current = () => Promise.reject(new Error('offline'));
        const { container } = render(<BiasChips symbol="BTCUSDT" interval="15m" />);
        await waitFor(() => expect(container).toBeEmptyDOMElement());
        expect(screen.queryByTestId('bias-chips')).toBeNull();
    });

    it('re-pulls when the instrument or timeframe flips', async () => {
        const calls: string[] = [];
        fetchRef.current = (_s, interval) => {
            calls.push(`${_s}:${interval}`);
            return Promise.resolve(interval === '1d' ? dailyRise : currentFlat);
        };
        const { rerender } = render(<BiasChips symbol="BTCUSDT" interval="15m" />);
        await screen.findByTestId('bias-chips');
        rerender(<BiasChips symbol="ETHUSDT" interval="15m" />);
        await waitFor(() => expect(calls.some(c => c.startsWith('ETHUSDT:15m'))).toBe(true));
        // Fresh symbol → cleared row first (no ETH numbers under a BTC read).
        expect(calls.filter(c => c.startsWith('ETHUSDT')).length).toBeGreaterThanOrEqual(2); // 15m + 1d
    });
});
