/**
 * TradingChart — the VERDICT level layer (O-117, E-57 §7).
 *
 * August's own Entry / Stop / TP overlay is the highest-stakes pixels in the
 * app: a line drawn one digit wrong moves the trader's stop, their reward and
 * their size. Until now no gate asserted it at all. The data half was covered
 * (`tests/chartData.test.ts` reads the labels, `tests/chartVerdictSource.test.ts`
 * reads the prices and the coin match), but the step from that array to the
 * canvas was unwatched — and `scripts/render-probe.cjs` never named these
 * levels, so a broken mapping passed 5,244 tests and a browser probe alike.
 *
 * Why this needed its own mock: the chat-level layer paints with
 * `series.createPriceLine()`, which is what `tradingChartChatLevels.test.tsx`
 * spies on. The verdict layers paint with `chart.addSeries(LineSeries, opts)`
 * plus a two-point `setData()` across the visible bars
 * (`components/trade/TradingChart.tsx:628-645`), so the existing recorder is
 * blind to them by construction. Here every added series is captured with the
 * options it was given AND the prices it was fed.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

interface DrawnSeries {
    kind: string;
    opts: Record<string, unknown>;
    data: Array<{ time: number; value?: number; open?: number }>;
    /** The handle the chart got back, so `removeSeries` can identify WHICH
     *  line went away. Without this the recorder would keep listing retired
     *  series as if they were still on the canvas. */
    api?: unknown;
}

let drawn: DrawnSeries[] = [];
let removed: string[] = [];

vi.mock('lightweight-charts', () => {
    const CANDLE = { __name: 'candles', defaultOptions: {} };
    const HIST = { __name: 'volume', defaultOptions: {} };
    const LINE = { __name: 'line', defaultOptions: {} };
    const makeSeries = (entry: DrawnSeries) => ({
        setData: (d: Array<{ time: number; value?: number; open?: number }>) => { entry.data = d; },
        update: (d: { time: number; value?: number }) => { if (d && 'value' in d) entry.data = [...entry.data, d]; },
        data: () => entry.data,
        priceToCoordinate: () => 40,
        coordinateToPrice: () => 50000,
        createPriceLine: () => ({ applyOptions: () => {}, __title: 'unused' }),
        removePriceLine: () => {},
    });
    const makeChart = () => ({
        addSeries: (def: { __name?: string }, opts: Record<string, unknown> = {}) => {
            const entry: DrawnSeries = { kind: def?.__name ?? 'unknown', opts, data: [] };
            drawn.push(entry);
            entry.api = makeSeries(entry);
            return entry.api;
        },
        removeSeries: (s: unknown) => {
            const i = drawn.findIndex(d => d.api === s);
            if (i >= 0) {
                removed.push(drawn[i].kind);
                // Retired: it is no longer a line the trader can see.
                drawn.splice(i, 1);
            }
        },
        applyOptions: () => {},
        priceScale: () => ({ applyOptions() {} }),
        timeScale: () => ({
            fitContent() {}, applyOptions() {},
            getVisibleLogicalRange: () => ({ from: 0, to: 100 }),
            setVisibleLogicalRange() {}, subscribeVisibleLogicalRangeChange() {}, unsubscribeVisibleLogicalRangeChange() {},
        }),
        resize() {}, remove() {}, takeScreenshot: () => document.createElement('canvas'),
    });
    return { createChart: vi.fn(makeChart), CandlestickSeries: CANDLE, HistogramSeries: HIST, LineSeries: LINE };
});

const BAR0 = 1_700_000_000;
vi.mock('../../services/analysis/KlineService', () => ({
    fetchKlines: vi.fn(async () => Array.from({ length: 50 }, (_, i) => ({
        time: (BAR0 + i * 900) * 1000, open: 100, high: 101, low: 99, close: 100, volume: 10,
    }))),
    mapBinanceInterval: (i: string) => i,
}));
vi.mock('../../utils/activeUser', () => ({ getActiveUsername: () => 'alice', LAST_ACTIVE_USER_KEY: 'last_active_user' }));

import TradingChart from '../../components/trade/TradingChart';
import { buildProposedTradeAnalysis } from '../../services/trade/proposedTrade';
import type { TradeProposal } from '../../services/trade/proposedTrade';

/** A BTC plan through the app's ONE plan builder — the same object the card,
 *  the gate and the journal read, so this test cannot drift from that shape.
 *  The fixture is the shape `tests/chartVerdictSource.test.ts` already uses. */
const proposal = (over: Partial<TradeProposal> = {}): TradeProposal => ({
    symbol: 'BTCUSDT',
    direction: 'Long',
    entry: 100000,
    stopLoss: 98000,
    takeProfits: [104000, 108000],
    confidence: 'Medium',
    ...over,
});

const verdictFor = (over: Partial<TradeProposal> = {}) => buildProposedTradeAnalysis(proposal(over));

/** The drawn lines that carry a single flat price — the verdict overlay. */
const levelLines = () => drawn
    .filter(d => d.kind === 'line')
    .map(d => ({
        color: d.opts.color as string,
        style: d.opts.lineStyle as number,
        price: d.data[0]?.value as number,
        span: d.data.length,
    }))
    .filter(l => l.price !== undefined);

beforeEach(() => {
    localStorage.clear();
    drawn = [];
    removed = [];
});

describe('TradingChart verdict levels — the pixels the trader stops out at', () => {
    it('draws Entry, Stop and one line per target, in that order, at the plan\'s own prices', async () => {
        render(<TradingChart symbol="BTCUSDT" interval="15m" onIntervalChange={() => {}} verdict={verdictFor()} />);
        await screen.findByTestId('trading-chart');

        await waitFor(() => expect(levelLines().length).toBe(4));
        const lines = levelLines();
        expect(lines.map(l => l.price)).toEqual([100000, 98000, 104000, 108000]);

        // The colours are the plan's roles, not arbitrary paint: sky entry,
        // rose stop, green targets — and a target reads dashed like the stop.
        expect(lines.map(l => l.color)).toEqual(['#399ef7', '#f75d5f', '#07b56a', '#07b56a']);
        expect(lines.map(l => l.style)).toEqual([0, 2, 2, 2]);

        // Each level is a flat line spanning the WHOLE loaded window; a
        // one-point series would draw nothing the eye can follow.
        for (const l of lines) expect(l.span).toBe(2);
    });

    it('draws nothing for a plan that belongs to another coin', async () => {
        const ethPlan = verdictFor({ symbol: 'ETHUSDT', entry: 3000, stopLoss: 2900, takeProfits: [3200] });
        render(<TradingChart symbol="BTCUSDT" interval="15m" onIntervalChange={() => {}} verdict={ethPlan} />);
        await screen.findByTestId('trading-chart');
        await waitFor(() => expect(drawn.some(d => d.kind === 'candles')).toBe(true));
        expect(levelLines()).toEqual([]);
    });

    it('retires the overlay when the chart moves to another coin', async () => {
        // The failure this exists to catch: BTC's stop still painted on an ETH
        // chart. Assert the lines EXIST first, so the disappearance below is a
        // measurement and not a suite that never drew anything at all.
        const btc = verdictFor();
        const { rerender } = render(
            <TradingChart symbol="BTCUSDT" interval="15m" onIntervalChange={() => {}} verdict={btc} />,
        );
        await screen.findByTestId('trading-chart');
        await waitFor(() => expect(levelLines().length).toBe(4));

        rerender(<TradingChart symbol="ETHUSDT" interval="15m" onIntervalChange={() => {}} verdict={btc} />);
        await waitFor(() => expect(levelLines()).toEqual([]));
        expect(removed.filter(k => k === 'line').length).toBeGreaterThanOrEqual(4);
    });

    it('replaces the overlay when the plan changes — it never accumulates a dead stop', async () => {
        const { rerender } = render(
            <TradingChart symbol="BTCUSDT" interval="15m" onIntervalChange={() => {}} verdict={verdictFor()} />,
        );
        await screen.findByTestId('trading-chart');
        await waitFor(() => expect(levelLines().length).toBe(4));

        // A tighter stop on the next read: the old line must be gone, not left
        // under the new one, or the chart shows two stops for one plan.
        rerender(<TradingChart symbol="BTCUSDT" interval="15m" onIntervalChange={() => {}} verdict={verdictFor({ stopLoss: 99000 })} />);
        await waitFor(() => {
            const stops = levelLines().filter(l => l.color === '#f75d5f');
            expect(stops.map(s => s.price)).toEqual([99000]);
        });
        expect(levelLines().length).toBe(4);
        expect(removed).toContain('line');
    });

    it('draws nothing at all when there is no verdict', async () => {
        render(<TradingChart symbol="BTCUSDT" interval="15m" onIntervalChange={() => {}} verdict={null} />);
        await screen.findByTestId('trading-chart');
        await waitFor(() => expect(drawn.some(d => d.kind === 'candles')).toBe(true));
        expect(levelLines()).toEqual([]);
    });
});
