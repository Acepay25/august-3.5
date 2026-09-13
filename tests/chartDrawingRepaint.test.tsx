/**
 * TradingChart — the overlay must REPAINT a coin's drawings after the chart's
 * candles reload on a symbol switch. Reported bug: draw on BTC → switch to ETH
 * → back to BTC → the drawing is gone. The data path is correct (the shapes
 * reload into state), but the overlay repaint is only wired to
 * [drawings, status, interval, range-change, resize]; a coin switch back lands
 * `status` still 'live', so when the new BTC candles arrive via cs.setData()
 * NOTHING repaints — the reloaded shapes stay invisible until the user pans.
 * A recording 2D context makes the paint observable.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, type RenderResult } from '@testing-library/react';

// Recording canvas ctx so we can SEE whether a drawing line was painted.
const ops = { stroke: 0 };
const makeCtx = (): any => {
    const noop = (): void => {};
    return new Proxy({}, {
        get: (t: any, prop: string) => {
            if (prop === 'stroke') return () => { ops.stroke += 1; };
            if (prop === 'measureText') return () => ({ width: 10 });
            if (prop === 'createLinearGradient') return () => ({ addColorStop: noop });
            if (typeof prop === 'string') return t[prop] ?? noop;
            return noop;
        },
        set: (t: any, prop: string, v: unknown) => { t[prop] = v; return true; },
    });
};

vi.mock('lightweight-charts', () => {
    const makeSeries = () => {
        let store: Array<{ time: number }> = [];
        return {
            setData: (d: Array<{ time: number }>) => { store = d; },
            update: () => {}, data: () => store,
            priceToCoordinate: () => 40, coordinateToPrice: () => 50000,
            createPriceLine: () => ({ applyOptions() {}, remove() {} }),
        };
    };
    const makeChart = () => ({
        addSeries: () => makeSeries(),
        removeSeries: () => {}, applyOptions: () => {},
        priceScale: () => ({ applyOptions() {} }),
        timeScale: () => ({
            fitContent() {}, applyOptions() {},
            logicalToCoordinate: (i: number) => 50 + i,
            coordinateToLogical: (x: number) => x - 50,
            getVisibleLogicalRange: () => ({ from: 0, to: 100 }),
            setVisibleLogicalRange() {},
            subscribeVisibleLogicalRangeChange() {}, unsubscribeVisibleLogicalRangeChange() {},
        }),
        resize() {}, remove() {}, takeScreenshot: () => document.createElement('canvas'),
    });
    return { createChart: vi.fn(makeChart), CandlestickSeries: { defaultOptions: {} }, HistogramSeries: { defaultOptions: {} }, LineSeries: { defaultOptions: {} } };
});

const BAR0 = 1_700_000_000;
vi.mock('../services/analysis/KlineService', () => ({
    fetchKlines: vi.fn(async () => Array.from({ length: 50 }, (_, i) => ({
        time: (BAR0 + i * 900) * 1000, open: 100, high: 101, low: 99, close: 100, volume: 10,
    }))),
}));
vi.mock('../utils/activeUser', () => ({ getActiveUsername: () => 'alice', LAST_ACTIVE_USER_KEY: 'last_active_user' }));

import TradingChart from '../components/trade/TradingChart';

beforeEach(() => {
    localStorage.clear();
    ops.stroke = 0;
    (HTMLCanvasElement.prototype as any).getContext = () => makeCtx();
});

const flush = async (): Promise<void> => { await act(async () => { await new Promise(r => setTimeout(r, 0)); }); };

const mount = (r: RenderResult | null, symbol: string): RenderResult => {
    const el = <TradingChart symbol={symbol} interval="15m" onIntervalChange={() => {}} sessionId="s1" live={false} lastPrice={100} />;
    if (r) { act(() => r.rerender(el)); return r; }
    return render(el);
};

describe('overlay repaints a coin after a symbol switch back', () => {
    it('paints the BTC shape again after BTC→ETH→BTC once the candles reload', async () => {
        let r = mount(null, 'BTCUSDT');
        await flush();

        // Draw one horizontal line on BTC.
        fireEvent.click(screen.getByLabelText('Horizontal line — click a price'));
        fireEvent.pointerDown(screen.getByTestId('draw-overlay'), { clientX: 60, clientY: 40 });
        await flush();

        // Reset the paint counter, then leave and come back.
        ops.stroke = 0;
        r = mount(r, 'ETHUSDT');
        await flush();
        r = mount(r, 'BTCUSDT');
        await flush(); // BTC candles reload here

        // The shape is reloaded AND must be repainted without a manual pan.
        expect(ops.stroke).toBeGreaterThan(0);
    });
});
