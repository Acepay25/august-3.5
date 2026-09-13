/**
 * TradingChart — user drawings survive a coin switch. Reported bug: draw on
 * BTC → switch to ETH → switch back to BTC → the drawing is gone. This drives
 * a real horizontal-line draw through the overlay and flips the `symbol` prop
 * (same session) to prove the shape is saved per coin and restored on return.
 * The rail's "Undo last drawing" button is enabled only when shapes are
 * loaded, so it's a faithful proxy for the canvas's drawing count.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, type RenderResult } from '@testing-library/react';

vi.mock('lightweight-charts', () => {
    const makeSeries = () => {
        let store: Array<{ time: number }> = [];
        return {
            setData: (d: Array<{ time: number }>) => { store = d; },
            update: () => {},
            data: () => store,
            priceToCoordinate: () => 40,
            coordinateToPrice: () => 50000,
            createPriceLine: () => ({ applyOptions() {}, remove() {} }),
        };
    };
    const makeChart = () => ({
        addSeries: () => makeSeries(),
        removeSeries: () => {},
        applyOptions: () => {},
        priceScale: () => ({ applyOptions() {} }),
        timeScale: () => ({
            fitContent() {}, applyOptions() {},
            logicalToCoordinate: (i: number) => 50 + i,
            coordinateToLogical: (x: number) => x - 50,
            getVisibleLogicalRange: () => ({ from: 0, to: 100 }),
            setVisibleLogicalRange() {},
            subscribeVisibleLogicalRangeChange() {}, unsubscribeVisibleLogicalRangeChange() {},
        }),
        resize() {}, remove() {},
        takeScreenshot: () => document.createElement('canvas'),
    });
    return {
        createChart: vi.fn(makeChart),
        CandlestickSeries: { defaultOptions: {} }, HistogramSeries: { defaultOptions: {} }, LineSeries: { defaultOptions: {} },
    };
});

// Real bars so the draw's data-space time maps onto the axis.
const BAR0 = 1_700_000_000;
vi.mock('../services/analysis/KlineService', () => ({
    fetchKlines: vi.fn(async () => Array.from({ length: 50 }, (_, i) => ({
        time: (BAR0 + i * 900) * 1000, open: 100, high: 101, low: 99, close: 100, volume: 10,
    }))),
}));
vi.mock('../utils/activeUser', () => ({ getActiveUsername: () => 'alice', LAST_ACTIVE_USER_KEY: 'last_active_user' }));

import TradingChart from '../components/trade/TradingChart';
import { loadSessionDrawings } from '../services/trade/chartDrawings';

const undoBtn = (): HTMLButtonElement => screen.getByLabelText('Undo last drawing') as HTMLButtonElement;

const mount = (r: RenderResult | null, symbol: string): RenderResult => {
    const el = (
        <TradingChart symbol={symbol} interval="15m" onIntervalChange={() => {}} sessionId="s1" live={false} lastPrice={100} />
    );
    if (r) { act(() => r.rerender(el)); return r; }
    return render(el);
};

beforeEach(() => { localStorage.clear(); });

describe('drawings survive a coin switch (same session)', () => {
    it('BTC → ETH → BTC keeps the BTC shape', async () => {
        const r = mount(null, 'BTCUSDT');
        await act(async () => { await Promise.resolve(); }); // let the data effect settle

        // Select the horizontal-line tool and click the chart → one hline.
        fireEvent.click(screen.getByLabelText('Horizontal line — click a price'));
        fireEvent.pointerDown(screen.getByTestId('draw-overlay'), { clientX: 60, clientY: 40 });
        await act(async () => { await Promise.resolve(); });

        expect(loadSessionDrawings('s1', 'BTCUSDT')).toHaveLength(1);
        expect(undoBtn().disabled).toBe(false);

        // Flip to ETH — that coin is empty, canvas blanks.
        mount(r, 'ETHUSDT');
        await act(async () => { await Promise.resolve(); });
        expect(undoBtn().disabled).toBe(true);

        // Flip BACK to BTC — the shape must return.
        mount(r, 'BTCUSDT');
        await act(async () => { await Promise.resolve(); });
        expect(loadSessionDrawings('s1', 'BTCUSDT')).toHaveLength(1); // never clobbered
        expect(undoBtn().disabled).toBe(false); // and reloaded onto the canvas
    });
});
