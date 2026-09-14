/**
 * scan_chart_skills desk tool — wiring only: the symbol/interval/username
 * resolution and the receipt passthrough. The scan pipeline itself is
 * covered in chartScanSkills.test.ts, so the service is mocked here.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../services/learning/chartScanSkills', () => ({
    scanChartForSkills: vi.fn(),
    scanChartAcrossIntervals: vi.fn(),
}));
vi.mock('../utils/activeUser', () => ({
    getActiveUsername: () => 'carol',
}));

import { executeDeskTool, DESK_TOOL_DEFINITIONS, clearDeskToolCache } from '../services/analysis/DeskToolsService';
import { scanChartForSkills, scanChartAcrossIntervals } from '../services/learning/chartScanSkills';

const RESULT = {
    symbol: 'ETHUSDT', interval: '1h', bars: 54, candidates: 2, queued: 1,
    outcomes: [], receipt: 'CHART SKILL SCAN ETHUSDT 1h — receipt',
};

beforeEach(() => {
    localStorage.clear();
    clearDeskToolCache();
    vi.mocked(scanChartForSkills).mockReset();
    vi.mocked(scanChartForSkills).mockResolvedValue(RESULT as never);
    vi.mocked(scanChartAcrossIntervals).mockReset();
    vi.mocked(scanChartAcrossIntervals).mockResolvedValue({ ...RESULT, interval: '15m,1h', receipt: 'MULTI — receipt' } as never);
});

describe('scan_chart_skills tool definition', () => {
    it('is offered to the model with symbol/interval/max_skills args', () => {
        const def = DESK_TOOL_DEFINITIONS.find(d => d.function.name === 'scan_chart_skills');
        expect(def).toBeTruthy();
        expect(def!.function.description).toContain('INBOX');
        const props = def!.function.parameters.properties as Record<string, unknown>;
        expect(Object.keys(props).sort()).toEqual(['interval', 'max_skills', 'symbol', 'timeframes']);
    });
});

describe('scan_chart_skills handler', () => {
    it('defaults to the live chart context and passes the receipt through', async () => {
        const r = await executeDeskTool(
            { id: 't1', name: 'scan_chart_skills', arguments: {} },
            { defaultSymbol: 'ETHUSDT', chartInterval: '1h' },
        );
        expect(r.ok).toBe(true);
        expect(scanChartForSkills).toHaveBeenCalledWith(expect.objectContaining({
            symbol: 'ETHUSDT', interval: '1h', username: 'carol',
        }));
        expect(r.content).toContain('receipt');
    });

    it('honors an explicit symbol and max_skills', async () => {
        await executeDeskTool(
            { id: 't2', name: 'scan_chart_skills', arguments: { symbol: 'SOLUSDT', interval: '15m', max_skills: 5 } },
            { defaultSymbol: 'ETHUSDT', chartInterval: '1h' },
        );
        expect(scanChartForSkills).toHaveBeenCalledWith(expect.objectContaining({
            symbol: 'SOLUSDT', interval: '15m', maxSkills: 5,
        }));
        expect(scanChartAcrossIntervals).not.toHaveBeenCalled();
    });

    it('routes an explicit timeframes[] list to the multi-interval scan', async () => {
        const r = await executeDeskTool(
            { id: 't3', name: 'scan_chart_skills', arguments: { symbol: 'BTCUSDT', timeframes: ['15m', '1h'] } },
            { defaultSymbol: 'ETHUSDT', chartInterval: '1h' },
        );
        expect(r.ok).toBe(true);
        expect(scanChartAcrossIntervals).toHaveBeenCalledWith(expect.objectContaining({
            symbol: 'BTCUSDT', intervals: ['15m', '1h'],
        }));
        expect(scanChartForSkills).not.toHaveBeenCalled();
        expect(r.content).toContain('MULTI');
    });
});
