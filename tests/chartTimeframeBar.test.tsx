/**
 * TradingChart timeframe bar — TradingView-style customization: the pool of
 * intervals, the persisted per-user selection (defaults when unset/corrupt),
 * the active interval always shows, and the ⚙ popover toggles membership.
 * Also pins intervalSeconds/toKlineInterval for the new timeframes (the
 * 1M→1m live-feed footgun is covered in futuresStreams/kline tests).
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('lightweight-charts', () => {
    const series = () => ({ setData: vi.fn(), update: vi.fn(), createPriceLine: vi.fn(), data: () => [] });
    const chart = () => ({
        addSeries: vi.fn(series), removeSeries: vi.fn(), applyOptions: vi.fn(),
        priceScale: vi.fn(() => ({ applyOptions: vi.fn() })),
        timeScale: vi.fn(() => ({ fitContent: vi.fn(), applyOptions: vi.fn() })),
        resize: vi.fn(), remove: vi.fn(),
    });
    return {
        createChart: vi.fn(chart),
        CandlestickSeries: { defaultOptions: {} }, HistogramSeries: { defaultOptions: {} }, LineSeries: { defaultOptions: {} },
    };
});
vi.mock('../services/analysis/KlineService', () => ({ fetchKlines: vi.fn(async () => []) }));

import TradingChart, {
    CHART_INTERVALS, DEFAULT_CHART_INTERVALS, intervalSeconds, readTfBarSelection,
} from '../components/trade/TradingChart';
import TimeframeBar from '../components/trade/TimeframeBar';

beforeEach(() => localStorage.clear());

describe('timeframe pool + helpers', () => {
    it('offers the full Binance interval set including the multi-day ones', () => {
        expect(CHART_INTERVALS).toContain('1M');
        expect(CHART_INTERVALS).toContain('3D');
        expect(CHART_INTERVALS).toContain('1W');
    });
    it('intervalSeconds covers every pool entry (no silent 900 fallback)', () => {
        for (const tf of CHART_INTERVALS) expect(intervalSeconds(tf)).toBeGreaterThan(0);
        expect(intervalSeconds('1M')).toBe(2_592_000);
        expect(intervalSeconds('1W')).toBe(604_800);
    });
});

describe('readTfBarSelection', () => {
    it('defaults to the shipped set when nothing is stored', () => {
        expect(readTfBarSelection()).toEqual([...DEFAULT_CHART_INTERVALS]);
    });
    it('reads a stored selection and drops unknown values', () => {
        localStorage.setItem('trade_tf_bar_v1_default', JSON.stringify(['15m', 'bogus', '1M']));
        expect(readTfBarSelection()).toEqual(['15m', '1M']);
    });
    it('falls back to defaults on corrupt JSON', () => {
        localStorage.setItem('trade_tf_bar_v1_default', '{not json');
        expect(readTfBarSelection()).toEqual([...DEFAULT_CHART_INTERVALS]);
    });
});

describe('the timeframe bar + ⚙ popover', () => {
    const renderChart = () => render(
        <TradingChart symbol="BTCUSDT" interval="15m" onIntervalChange={() => {}} live={false} lastPrice={100} />,
    );

    it('shows the default intervals and hides the unselected ones', () => {
        renderChart();
        expect(screen.getByRole('button', { name: '15m' })).toBeTruthy();
        expect(screen.getByRole('button', { name: '4h' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: '1M' })).toBeNull();
    });

    it('the active interval always shows even if not in the selection', () => {
        localStorage.setItem('trade_tf_bar_v1_default', JSON.stringify(['1h']));
        renderChart();
        // 15m is the active interval but not selected — it must still render.
        expect(screen.getByRole('button', { name: '15m' })).toBeTruthy();
    });

    it('the cog opens a picker and toggling an interval adds it to the bar', () => {
        renderChart();
        // 1M is in the pool but not on the bar yet (default selection).
        expect(screen.queryByRole('button', { name: '1M' })).toBeNull();
        fireEvent.click(screen.getByLabelText('Customize timeframes'));
        const picker = screen.getByTestId('tf-picker');
        const toggle1M = Array.from(picker.querySelectorAll('button')).find(b => b.textContent?.startsWith('1M'))!;
        fireEvent.click(toggle1M);
        // The bar now renders 1M (the picker's toggle also reads 1M, so
        // assert "at least one" rather than a unique match).
        expect(screen.getAllByRole('button', { name: '1M' }).length).toBeGreaterThanOrEqual(1);
        // And it persisted — the real behavior.
        expect(readTfBarSelection()).toContain('1M');
    });
});

/**
 * Compact mode is the composer's shape: the reference's composer is ONE line,
 * and six interval buttons in it is what made August's read as a toolbar. The
 * claim pinned here is the one that makes that a regrouping rather than a
 * removal — every interval the bar can show is still reachable, and the
 * customize gear still customizes.
 */
describe('TimeframeBar in compact mode (the composer)', () => {
    const pick = vi.fn();

    it('collapses to one chip that carries the active interval', () => {
        render(<TimeframeBar interval="15m" onIntervalChange={pick} compact />);
        const chip = screen.getByTestId('tf-compact');
        expect(chip.textContent).toContain('15m');
        // The six buttons are gone from the resting view...
        expect(screen.queryByRole('button', { name: '4h' })).toBeNull();
        // ...and the gear is still there, so membership is still editable.
        expect(screen.getByLabelText('Customize timeframes')).toBeTruthy();
    });

    it('every interval on the bar is still reachable through the chip', () => {
        render(<TimeframeBar interval="15m" onIntervalChange={pick} compact />);
        fireEvent.click(screen.getByTestId('tf-compact'));
        const menu = screen.getByTestId('tf-compact-menu');
        const names = [...menu.querySelectorAll('button')].map(b => b.textContent?.trim());
        for (const tf of DEFAULT_CHART_INTERVALS) {
            expect(names).toContain(tf);
        }
        fireEvent.click(screen.getByRole('menuitem', { name: /4h/ }));
        expect(pick).toHaveBeenCalledWith('4h');
        // Choosing closes the menu — a menu you cannot get out of is a trap.
        expect(screen.queryByTestId('tf-compact-menu')).toBeNull();
    });

    it('Escape closes the menu — the keyboard must be able to undo the keyboard', () => {
        render(<TimeframeBar interval="15m" onIntervalChange={pick} compact />);
        fireEvent.click(screen.getByTestId('tf-compact'));
        expect(screen.getByTestId('tf-compact-menu')).toBeTruthy();
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByTestId('tf-compact-menu')).toBeNull();
    });
});
