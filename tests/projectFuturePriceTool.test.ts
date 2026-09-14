/**
 * project_future_price — execution-level proof of the desk tool: mocked
 * kline source, real cone math, real receipt. Covers the happy path, the
 * horizon clamp, and the DATA_UNAVAILABLE contract (never invent paths).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../services/analysis/KlineService', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../services/analysis/KlineService')>();
    return { ...actual, fetchKlines: vi.fn() };
});

import { executeDeskTool, clearDeskToolCache } from '../services/analysis/DeskToolsService';
import { fetchKlines } from '../services/analysis/KlineService';

const bar = (time: number, open: number, high: number, low: number, close: number) =>
    ({ time, open, high, low, close, volume: 10 });

/** Rising tape: 60 bars, +10/bar, 4-point ranges → trend 'up', real ATR. */
const risingTape = (n = 60) => Array.from({ length: n }, (_, i) => {
    const close = 1000 + i * 10;
    return bar(1_700_000_000_000 + i * 900_000, close - 4, close + 2, close - 2, close);
});

beforeEach(() => {
    localStorage.clear();
    clearDeskToolCache();
    vi.mocked(fetchKlines).mockReset();
});

describe('project_future_price tool', () => {
    it('draws the cone from the chart default and refuses forecast framing', async () => {
        vi.mocked(fetchKlines).mockResolvedValue(risingTape() as never);
        const r = await executeDeskTool(
            { id: 'p1', name: 'project_future_price', arguments: {} },
            { defaultSymbol: 'ETHUSDT', chartInterval: '15m' },
        );
        expect(r.ok).toBe(true);
        expect(r.content).toContain('PRICE PROJECTION ETHUSDT 15m');
        expect(r.content).toMatch(/trend up/);
        expect(r.content).toContain('bull');
        expect(r.content).toContain('bear');
        expect(r.content).toMatch(/NOT a prediction/);
        expect(fetchKlines).toHaveBeenCalledWith('ETHUSDT', '15m', 300);
    });

    it('honors an explicit symbol/interval and clamps a runaway horizon', async () => {
        vi.mocked(fetchKlines).mockResolvedValue(risingTape() as never);
        const r = await executeDeskTool({
            id: 'p2', name: 'project_future_price',
            arguments: { symbol: 'SOLUSDT', interval: '1h', horizon_bars: 5000 },
        });
        expect(r.content).toContain('SOLUSDT 1h');
        expect(r.content).toContain('horizon 96 bars');
        expect(fetchKlines).toHaveBeenCalledWith('SOLUSDT', '1h', 300);
    });

    it('surfaces DATA_UNAVAILABLE when the candles do not come back', async () => {
        vi.mocked(fetchKlines).mockResolvedValue([] as never);
        const r = await executeDeskTool({ id: 'p3', name: 'project_future_price', arguments: {} });
        expect(r.content).toContain('DATA_UNAVAILABLE');
        expect(r.content).toMatch(/do not infer a flat market/);
    });
});
