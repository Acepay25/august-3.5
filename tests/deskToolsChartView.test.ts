import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Chart-awareness desk tools — get_market_packet (the full hybrid pull the
 * model can call whenever it wants everything) and get_chart_view (exactly
 * what the user sees on the Trade chart: timeframe, candles, live mark,
 * drawn verdict levels). Services are mocked at the module boundary so these
 * are network-free unit tests; DATA_UNAVAILABLE sentinel + cache discipline
 * are asserted because they're the harness's honesty contract.
 */

vi.mock('../services/analysis/KlineService', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../services/analysis/KlineService')>();
    return { ...actual, fetchKlines: vi.fn() };
});
vi.mock('../services/analysis/MarketDataService', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../services/analysis/MarketDataService')>();
    return {
        ...actual,
        fetchMarkIndex: vi.fn(async () => ({
            markPrice: 104.7,
            indexPrice: 104.6,
            lastFundingRate: 0.0001,
            nextFundingTime: Date.now() + 3_600_000,
            available: true,
        })),
        fetchOrderBookDepth: vi.fn(async () => ({
            bestBid: 104.6, bestAsk: 104.8, spread: 0.2, spreadPercent: 0.19,
            bids: [], asks: [], bidDepth: 0, askDepth: 0, depthImbalance: 0,
            buyWalls: [{ price: 103.2, quantity: 50, usdValue: 516000 }],
            sellWalls: [{ price: 106.4, quantity: 80, usdValue: 851200 }],
            dominantSide: 'buyers', wallDistance: {},
        })),
    };
});
vi.mock('../services/analysis/HybridIntelligenceService', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../services/analysis/HybridIntelligenceService')>();
    return {
        ...actual,
        fetchHybridData: vi.fn(async () => ({ symbol: 'BTCUSDT' })),
        generateHybridPromptInjection: vi.fn(() => '## HYBRID PACKET (compact)'),
    };
});

import { executeDeskTool, clearDeskToolCache } from '../services/analysis/DeskToolsService';
import { fetchKlines } from '../services/analysis/KlineService';
import { fetchHybridData } from '../services/analysis/HybridIntelligenceService';

const candles = [
    { time: 1757500000000, open: 100, high: 105, low: 99, close: 104, volume: 10 },
    { time: 1757500900000, open: 104, high: 106, low: 103, close: 105.5, volume: 12 },
];

describe('desk tools — chart awareness', () => {
    beforeEach(() => {
        clearDeskToolCache();
        vi.mocked(fetchKlines).mockReset();
    });

    it('get_chart_view reports candles, mark price, levels and the symbol/interval', async () => {
        vi.mocked(fetchKlines).mockResolvedValue(candles as never);
        const result = await executeDeskTool(
            { id: 'c1', name: 'get_chart_view', arguments: { symbol: 'BTCUSDT', interval: '4h' } },
            { chartLevels: [{ label: 'Entry', price: 101.5 }, { label: 'Stop', price: 98 }] },
        );
        expect(result.ok).toBe(true);
        expect(result.content).toContain('CHART VIEW — BTCUSDT · 4h · last 2 candles');
        expect(result.content).toContain('Live mark price: 104.7');
        expect(result.content).toContain('Levels drawn on the chart: Entry 101.5 · Stop 98');
        expect(result.content).toContain('O100 H105 L99 C104 V10');
        expect(fetchKlines).toHaveBeenCalledWith('BTCUSDT', '4h', 60);
    });

    it('get_chart_view falls back to the context interval when the model omits one', async () => {
        vi.mocked(fetchKlines).mockResolvedValue(candles as never);
        const result = await executeDeskTool(
            { id: 'c2', name: 'get_chart_view', arguments: {} },
            { defaultSymbol: 'ETHUSDT', chartInterval: '1h' },
        );
        expect(result.content).toContain('CHART VIEW — ETHUSDT · 1h');
        expect(fetchKlines).toHaveBeenCalledWith('ETHUSDT', '1h', 60);
    });

    it('get_chart_view says no levels when none are drawn', async () => {
        vi.mocked(fetchKlines).mockResolvedValue(candles as never);
        const result = await executeDeskTool(
            { id: 'c3', name: 'get_chart_view', arguments: { symbol: 'BTCUSDT' } },
        );
        expect(result.content).toContain('No verdict levels are drawn on the chart right now.');
    });

    it('empty candles yield DATA_UNAVAILABLE — and are never cached', async () => {
        vi.mocked(fetchKlines).mockResolvedValue([] as never);
        const call = { id: 'c4', name: 'get_chart_view', arguments: { symbol: 'ETHUSDT', interval: '15m' } };
        const empty = await executeDeskTool(call);
        expect(empty.content).toContain('DATA_UNAVAILABLE');
        // The failed lookup must not poison the 30s cache: with data back,
        // the identical call reports the chart again.
        vi.mocked(fetchKlines).mockResolvedValue(candles as never);
        const healed = await executeDeskTool({ ...call, id: 'c5' });
        expect(healed.content).toContain('CHART VIEW — ETHUSDT · 15m');
    });

    it('get_market_packet returns the compact hybrid injection for the symbol', async () => {
        const result = await executeDeskTool(
            { id: 'c6', name: 'get_market_packet', arguments: { symbol: 'BTCUSDT' } },
        );
        expect(result.content).toBe('## HYBRID PACKET (compact)');
        expect(fetchHybridData).toHaveBeenCalledWith('BTCUSDT');
    });

    it('both tools are declared with model-facing schemas', async () => {
        const { DESK_TOOL_DEFINITIONS } = await import('../services/analysis/DeskToolsService');
        const names = DESK_TOOL_DEFINITIONS.map(t => t.function.name);
        expect(names).toContain('get_market_packet');
        expect(names).toContain('get_chart_view');
    });

    it('get_chart_view reports the ORDER BOOK the user watches', async () => {
        vi.mocked(fetchKlines).mockResolvedValue(candles as never);
        const result = await executeDeskTool(
            { id: 'c7', name: 'get_chart_view', arguments: { symbol: 'BTCUSDT' } },
        );
        expect(result.content).toContain('best bid 104.6 · best ask 104.8');
        expect(result.content).toContain('dominant side buyers');
        expect(result.content).toContain('Nearest buy wall: 103.2 ($516k)');
        expect(result.content).toContain('Nearest sell wall: 106.4 ($851k)');
    });

    it('get_chart_view translates the USER DRAWINGS into shape lines', async () => {
        vi.mocked(fetchKlines).mockResolvedValue(candles as never);
        const result = await executeDeskTool(
            { id: 'c8', name: 'get_chart_view', arguments: { symbol: 'BTCUSDT' } },
            {
                chartDrawings: [
                    { id: 'd1', kind: 'hline', points: [{ t: 1757500000, p: 99.5 }], color: '#f75d5f', createdAt: Date.now() },
                    { id: 'd2', kind: 'trend', points: [{ t: 1757500000, p: 100 }, { t: 1757503600, p: 105 }], color: '#07b56a', createdAt: Date.now() },
                ],
            },
        );
        expect(result.content).toContain('USER DRAWINGS ON THE CHART (2 shapes)');
        expect(result.content).toContain('horizontal line at price 99.5');
        expect(result.content).toContain('rising trendline');
    });
});
