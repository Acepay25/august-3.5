/**
 * chartDrawings — the user's TradingView-style shapes persist in DATA space
 * per symbol, validate on load, and reach the model as a readable list.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    loadDrawings, saveDrawings, pointsForKind, describeDrawingsForModel,
    drawingFromChartTool, drawingsFromLevelTool, MODEL_COLOR_NAMES,
    MAX_DRAWINGS_PER_SYMBOL,
    type ChartDrawing,
} from '../services/trade/chartDrawings';

const shape = (over: Partial<ChartDrawing> = {}): ChartDrawing => ({
    id: `d-${Math.random().toString(36).slice(2, 7)}`,
    kind: 'trend',
    points: [{ t: 1_700_000_000, p: 60_000 }, { t: 1_700_003_600, p: 61_000 }],
    color: '#07b56a',
    createdAt: Date.now(),
    ...over,
});

describe('chartDrawings storage', () => {
    beforeEach(() => localStorage.clear());

    it('round-trips shapes for one symbol only', () => {
        saveDrawings('BTCUSDT', [shape()]);
        expect(loadDrawings('BTCUSDT')).toHaveLength(1);
        expect(loadDrawings('ETHUSDT')).toHaveLength(0);
    });

    it('drops corrupt rows and unknown kinds on load', () => {
        localStorage.setItem('trade_drawings_v1_default_BTCUSDT', JSON.stringify([
            shape(),
            { id: 'x', kind: 'parabola', points: [], color: '#fff' },
            null,
            { id: 'y', kind: 'hline', points: [{ t: 'nan', p: 'nan' }], color: '#fff', createdAt: 0 },
        ]));
        const loaded = loadDrawings('BTCUSDT');
        expect(loaded).toHaveLength(1);
    });

    it('bounds the stored count', () => {
        const many = Array.from({ length: MAX_DRAWINGS_PER_SYMBOL + 12 }, () => shape());
        saveDrawings('BTCUSDT', many);
        expect(loadDrawings('BTCUSDT').length).toBeLessThanOrEqual(MAX_DRAWINGS_PER_SYMBOL);
    });

    it('survives garbage JSON', () => {
        localStorage.setItem('trade_drawings_v1_default_BTCUSDT', '{not json');
        expect(loadDrawings('BTCUSDT')).toEqual([]);
    });
});

describe('pointsForKind', () => {
    const pts = [
        { t: 1_700_000_000, p: 60_000 },
        { t: 1_700_003_600, p: 61_000 },
        { t: 1_700_007_200, p: 62_000 },
    ];
    it('needs one anchor for hline, two for lines, many for brush', () => {
        expect(pointsForKind('hline', pts)).toHaveLength(1);
        expect(pointsForKind('trend', pts)).toHaveLength(2);
        expect(pointsForKind('ray', pts)).toHaveLength(2);
        expect(pointsForKind('rect', pts)).toHaveLength(2);
        expect(pointsForKind('brush', pts)).toHaveLength(3);
        expect(pointsForKind('trend', [pts[0]])).toBeNull();
        expect(pointsForKind('hline', [])).toBeNull();
    });
    it('fib takes two anchors, text takes one', () => {
        expect(pointsForKind('fib', pts)).toHaveLength(2);
        expect(pointsForKind('fib', [pts[0]])).toBeNull();
        expect(pointsForKind('text', pts)).toHaveLength(1);
        expect(pointsForKind('text', [])).toBeNull();
    });
});

describe('describeDrawingsForModel', () => {
    it('returns empty text when nothing is drawn', () => {
        expect(describeDrawingsForModel([])).toBe('');
    });

    it('names kind, direction and price anchors', () => {
        const text = describeDrawingsForModel([
            shape({ kind: 'trend' }),
            shape({ kind: 'hline', points: [{ t: 1_700_000_000, p: 59_500 }] }),
            shape({ kind: 'rect', points: [{ t: 1_700_000_000, p: 60_000 }, { t: 1_700_003_600, p: 59_000 }] }),
        ]);
        expect(text).toContain('USER DRAWINGS ON THE CHART');
        expect(text).toContain('3 shapes');
        expect(text).toContain('rising trendline');
        expect(text).toContain('horizontal line');
        expect(text).toContain('59500');
        expect(text).toContain('supply/demand zone between prices 59000 and 60000');
    });

    it('describes a fib retracement with its ratios and a text note with its content', () => {
        const text = describeDrawingsForModel([
            shape({ kind: 'fib', points: [{ t: 1_700_000_000, p: 58_000 }, { t: 1_700_003_600, p: 62_000 }] }),
            shape({ kind: 'text', points: [{ t: 1_700_000_000, p: 60_250 }], label: 'reclaim watch' }),
        ]);
        expect(text).toContain('fibonacci retracement from 58000 to 62000');
        expect(text).toContain('61.8%');
        expect(text).toContain('text note "reclaim watch" at price 60250');
    });
});

describe('drawingFromChartTool (model draw_on_chart → data-space shape)', () => {
    const ctx = { lastBarTime: 1_700_003_600, barSeconds: 900 };

    it('builds an hline at the newest bar from one price', () => {
        const { drawings, error } = drawingFromChartTool({ kind: 'hline', prices: [60_000], color: 'emerald', label: 'range high' }, ctx);
        expect(error).toBeUndefined();
        expect(drawings).toHaveLength(1);
        expect(drawings[0].kind).toBe('hline');
        expect(drawings[0].points[0].p).toBe(60_000);
        expect(drawings[0].color).toBe(MODEL_COLOR_NAMES.emerald);
        expect(drawings[0].label).toBe('range high');
    });

    it('anchors a trendline by bars-ago offsets against the newest candle', () => {
        const { drawings } = drawingFromChartTool({ kind: 'trend', prices: [58_000, 60_000], startBarsAgo: 10, endBarsAgo: 2 }, ctx);
        expect(drawings[0].points[0].t).toBe(1_700_003_600 - 10 * 900);
        expect(drawings[0].points[1].t).toBe(1_700_003_600 - 2 * 900);
    });

    it('maps zone to a rect and rejects a non-increasing span', () => {
        expect(drawingFromChartTool({ kind: 'zone', prices: [59_000, 61_000] }, ctx).drawings[0].kind).toBe('rect');
        expect(drawingFromChartTool({ kind: 'trend', prices: [1, 2], startBarsAgo: 1, endBarsAgo: 5 }, ctx).error).toMatch(/startBarsAgo must be greater/);
    });

    it('rejects an unknown kind and missing prices', () => {
        expect(drawingFromChartTool({ kind: 'nonsense', prices: [1] }, ctx).error).toMatch(/unknown kind/);
        expect(drawingFromChartTool({ kind: 'trend', prices: [1] }, ctx).error).toMatch(/needs 2 price/);
    });

    it('builds a fib from two prices and a text note from one', () => {
        const fib = drawingFromChartTool({ kind: 'fib-retracement', prices: [58_000, 62_000], startBarsAgo: 20, endBarsAgo: 5 }, ctx);
        expect(fib.drawings[0].kind).toBe('fib');
        expect(fib.drawings[0].points).toHaveLength(2);
        const note = drawingFromChartTool({ kind: 'text', prices: [60_250], label: 'watch here', endBarsAgo: 0 }, ctx);
        expect(note.drawings[0].kind).toBe('text');
        expect(note.drawings[0].points[0].p).toBe(60_250);
        expect(note.drawings[0].label).toBe('watch here');
    });
});

describe('drawingsFromLevelTool (model mark_trade_levels → labeled lines)', () => {
    it('lays Entry (sky), SL (rose) and TPs (amber) in order', () => {
        const { drawings, error } = drawingsFromLevelTool({ entry: 60_000, stopLoss: 59_000, takeProfits: [61_000, 62_000] });
        expect(error).toBeUndefined();
        expect(drawings.map(d => d.label)).toEqual(['Entry', 'SL', 'TP1', 'TP2']);
        expect(drawings[0].color).toBe(MODEL_COLOR_NAMES.sky);
        expect(drawings[1].color).toBe(MODEL_COLOR_NAMES.rose);
        expect(drawings[2].color).toBe(MODEL_COLOR_NAMES.amber);
    });

    it('requires an entry and at least one of SL/TPs', () => {
        expect(drawingsFromLevelTool({ stopLoss: 1 }).error).toMatch(/entry price is required/);
        expect(drawingsFromLevelTool({ entry: 60_000 }).error).toMatch(/stopLoss and\/or takeProfits/);
    });
});
