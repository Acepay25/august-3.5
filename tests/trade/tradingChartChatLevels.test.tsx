/**
 * TradingChart — the chat-pushed key-level layer (chatLevels). The dock's
 * message card resolves every visibility state (shown / pinned / preview /
 * hidden) and pushes the list here; the chart diffs it into real price
 * lines: hidden ones are removed, new ones created, the rest updated — and a
 * payload stamped for ANOTHER coin never paints (BTC levels must not appear
 * on an ETH chart). The mock records every create/apply/remove so the diff
 * itself is the thing under test.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const calls = { created: [] as Array<{ title: string; price: number; color: string; lineStyle: number; lineWidth: number }>, applied: [] as Array<{ title: string; color: string; lineWidth: number; lineStyle: number }>, removed: [] as string[] };

vi.mock('lightweight-charts', () => {
    const makeSeries = (isCandles: boolean) => {
        let store: Array<{ time: number }> = [];
        return {
            setData: (d: Array<{ time: number }>) => { store = d; },
            update: () => {}, data: () => store,
            priceToCoordinate: () => 40, coordinateToPrice: () => 50000,
            createPriceLine: (opts: { title: string; price: number; color: string; lineStyle: number; lineWidth: number }) => {
                if (isCandles) calls.created.push(opts);
                const pl = {
                    applyOptions: (o: { color: string; lineWidth: number; lineStyle: number }) => { if (isCandles && opts) calls.applied.push({ title: opts.title, ...o }); },
                    __title: opts.title,
                };
                return pl;
            },
            removePriceLine: (pl: { __title?: string }) => { if (pl?.__title) calls.removed.push(pl.__title); },
        };
    };
    const makeChart = () => {
        let n = 0;
        return {
            addSeries: () => makeSeries((n += 1) === 1),
            removeSeries: () => {}, applyOptions: () => {},
            priceScale: () => ({ applyOptions() {} }),
            timeScale: () => ({
                fitContent() {}, applyOptions() {},
                logicalToCoordinate: (i: number) => 50 + i, coordinateToLogical: (x: number) => x - 50,
                getVisibleLogicalRange: () => ({ from: 0, to: 100 }),
                setVisibleLogicalRange() {}, subscribeVisibleLogicalRangeChange() {}, unsubscribeVisibleLogicalRangeChange() {},
            }),
            resize() {}, remove() {}, takeScreenshot: () => document.createElement('canvas'),
        };
    };
    return {
        createChart: vi.fn(makeChart),
        CandlestickSeries: { defaultOptions: {} }, HistogramSeries: { defaultOptions: {} }, LineSeries: { defaultOptions: {} },
    };
});

const BAR0 = 1_700_000_000;
vi.mock('../../services/analysis/KlineService', () => ({
    fetchKlines: vi.fn(async () => Array.from({ length: 50 }, (_, i) => ({
        time: (BAR0 + i * 900) * 1000, open: 100, high: 101, low: 99, close: 100, volume: 10,
    }))),
}));
vi.mock('../../utils/activeUser', () => ({ getActiveUsername: () => 'alice', LAST_ACTIVE_USER_KEY: 'last_active_user' }));

import TradingChart from '../../components/trade/TradingChart';
import type { MessageLevelLines } from '../../services/trade/keyLevels';

const lines = (state: 'shown' | 'hidden' | 'pinned'): MessageLevelLines => ({
    symbol: 'BTCUSDT',
    lines: [
        { id: 'kl0', label: 'R2', price: 77841, color: '#f75d5f', state },
        { id: 'kl1', label: 'S1', price: 77427, color: '#07b56a', state: 'hidden' },
    ],
});

beforeEach(() => {
    localStorage.clear();
    calls.created.length = 0;
    calls.applied.length = 0;
    calls.removed.length = 0;
});

describe('TradingChart chat-level layer', () => {
    it('draws only non-hidden lines, updates in place, clears on coin switch', async () => {
        const { rerender } = render(
            <TradingChart symbol="BTCUSDT" interval="15m" onIntervalChange={() => {}} chatLevels={null} />,
        );
        await screen.findByTestId('trading-chart');
        expect(calls.created.filter(c => c.title !== 'mark')).toHaveLength(0);

        // Master toggle on: the R2 line appears dashed + dim; S1 (hidden) never does.
        rerender(<TradingChart symbol="BTCUSDT" interval="15m" onIntervalChange={() => {}} chatLevels={lines('shown')} />);
        await waitFor(() => {
            const level = calls.created.find(c => c.title === 'R2');
            expect(level).toBeTruthy();
            expect(level!.price).toBe(77841);
            expect(level!.color).toBe('#f75d5f80'); // dimmed while merely shown
            expect(calls.created.some(c => c.title === 'S1')).toBe(false);
        });

        // Pin: SAME line object gets applyOptions at full strength — no
        // destroy/recreate flash on every state change.
        rerender(<TradingChart symbol="BTCUSDT" interval="15m" onIntervalChange={() => {}} chatLevels={lines('pinned')} />);
        await waitFor(() => {
            expect(calls.applied.some(a => a.title === 'R2' && a.color === '#f75d5f')).toBe(true);
            expect(calls.created.filter(c => c.title === 'R2')).toHaveLength(1);
        });

        // A card pushed for the PREVIOUS coin after a switch: everything off.
        rerender(
            <TradingChart symbol="ETHUSDT" interval="15m" onIntervalChange={() => {}}
                chatLevels={{ ...lines('pinned'), symbol: 'BTCUSDT' }} />,
        );
        await waitFor(() => expect(calls.removed).toContain('R2'));
    });
});
