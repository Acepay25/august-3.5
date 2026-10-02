/**
 * The three shapes a seat asks for when it annotates a setup, plus the control
 * that owns drawing persistence.
 *
 * The control matters as much as the shapes: the cap used to be applied by
 * hand at each call site, and one of them had a hardcoded 60 against the
 * store's 40 — so the view accepted more shapes than storage could keep and
 * the user watched them disappear on reload. These tests pin that the cap is
 * now the store's, applied once.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

let store: Record<string, string> = {};
beforeEach(() => {
    store = {};
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(k => store[k] ?? null);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k, v) => { store[k] = String(v); });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(k => { delete store[k]; });
});

import { drawingFromChartTool, DRAW_COLORS, MAX_DRAWINGS_PER_SYMBOL, type ChartDrawing } from '../services/trade/chartDrawings';
import { drawingsControl, capDrawings } from '../services/trade/drawingsControl';

const LAST = 1_700_000_000;
const CTX = { lastBarTime: LAST, barSeconds: 3600, drawnPrice: 100, klines: undefined as never };

const call = (kind: string, prices: number[], over: Record<string, unknown> = {}) =>
    drawingFromChartTool(
        { kind, prices, color: 'sky', startBarsAgo: 20, endBarsAgo: 0, ...over },
        CTX,
    );

describe('new drawing kinds', () => {
    it('accepts the natural names a seat uses for a range', () => {
        for (const name of ['channel', 'range', 'band', 'corridor', 'Channel']) {
            const out = call(name, [100, 120]);
            expect(out.error, name).toBeUndefined();
            expect(out.drawings[0].kind).toBe('channel');
        }
    });

    it('accepts arrow synonyms and points one at a level', () => {
        for (const name of ['arrow', 'pointer', 'marker']) {
            const out = call(name, [100, 110]);
            expect(out.error, name).toBeUndefined();
            expect(out.drawings[0].kind).toBe('arrow');
            expect(out.drawings[0].points).toHaveLength(2);
        }
    });

    it('a measured move needs THREE prices and says so when it does not get them', () => {
        const two = call('measured_move', [100, 90]);
        expect(two.drawings).toEqual([]);
        expect(two.error).toMatch(/3 prices/);
        const three = call('measured_move', [100, 90, 120]);
        expect(three.error).toBeUndefined();
        expect(three.drawings[0].points.map(p => p.p)).toEqual([100, 90, 120]);
    });

    it('a measured move stacks on one bar — it has no start/end ordering to violate', () => {
        const out = call('measured_move', [100, 90, 120], { startBarsAgo: 0, endBarsAgo: 0 });
        expect(out.error).toBeUndefined();
        expect(out.drawings[0].points.every(p => p.t === LAST)).toBe(true);
    });

    it('still refuses a zero or negative price for the new kinds', () => {
        // The rule is shared and was the source of a "drew a line at zero" bug.
        expect(call('channel', [0, 120]).error).toBeTruthy();
        expect(call('arrow', [100, -5]).error).toBeTruthy();
        expect(call('measured_move', [100, 0, 120]).error).toBeTruthy();
    });

    it('lists the new kinds in the rejection message so the model can self-correct', () => {
        const out = call('shading', [100, 120]);
        expect(out.error).toMatch(/channel/);
        expect(out.error).toMatch(/arrow/);
        expect(out.error).toMatch(/measured_move/);
    });
});

describe('drawingsControl', () => {
    const shape = (id: string): ChartDrawing => ({
        id, kind: 'hline', points: [{ t: LAST, p: 100 }], color: DRAW_COLORS[0], createdAt: 1,
    });

    it('adds and reads back through the control', () => {
        const ctl = drawingsControl('model', 's1', 'BTCUSDT');
        ctl.add([shape('a')]);
        expect(ctl.list().map(d => d.id)).toEqual(['a']);
    });

    it('applies the storage cap, so the view and the store cannot disagree', () => {
        const ctl = drawingsControl('model', 's1', 'BTCUSDT');
        const many = Array.from({ length: MAX_DRAWINGS_PER_SYMBOL + 25 }, (_, i) => shape(`d${i}`));
        const kept = ctl.add(many);
        expect(kept).toHaveLength(MAX_DRAWINGS_PER_SYMBOL);
        expect(ctl.list()).toHaveLength(MAX_DRAWINGS_PER_SYMBOL);
    });

    it('keeps the NEWEST shapes when the cap bites', () => {
        const ctl = drawingsControl('model', 's1', 'BTCUSDT');
        ctl.add(Array.from({ length: MAX_DRAWINGS_PER_SYMBOL + 5 }, (_, i) => shape(`d${i}`)));
        const ids = ctl.list().map(d => d.id);
        expect(ids[ids.length - 1]).toBe(`d${MAX_DRAWINGS_PER_SYMBOL + 4}`);
        expect(ids).not.toContain('d0');
    });

    it('trims a drawing with too many points on the way in', () => {
        const long: ChartDrawing = { ...shape('x'), points: Array.from({ length: 500 }, (_, i) => ({ t: LAST - i, p: 100 })) };
        const ctl = drawingsControl('model', 's1', 'BTCUSDT');
        ctl.add([long]);
        expect(ctl.list()[0].points.length).toBeLessThan(500);
    });

    it('removes by id and clears the bucket', () => {
        const ctl = drawingsControl('model', 's1', 'BTCUSDT');
        ctl.add([shape('a'), shape('b')]);
        ctl.remove(['a']);
        expect(ctl.list().map(d => d.id)).toEqual(['b']);
        ctl.clear();
        expect(ctl.list()).toEqual([]);
    });

    it('updates a label without touching the rest', () => {
        const ctl = drawingsControl('model', 's1', 'BTCUSDT');
        ctl.add([shape('a')]);
        ctl.update('a', { label: 'range high' });
        expect(ctl.list()[0].label).toBe('range high');
    });

    it('never lets the user bucket and the model bucket clobber each other', () => {
        // Two buckets on purpose: the user's eraser and the model's
        // clear_chart_drawings must not touch one another.
        const user = drawingsControl('user', 's1', 'BTCUSDT');
        const model = drawingsControl('model', 's1', 'BTCUSDT');
        user.add([shape('mine')]);
        model.add([shape('theirs')]);
        model.clear();
        expect(user.list().map(d => d.id)).toEqual(['mine']);
        expect(model.list()).toEqual([]);
    });

    it('scopes by coin — a BTC shape does not appear on ETH', () => {
        const btc = drawingsControl('model', 's1', 'BTCUSDT');
        btc.add([shape('btc-shape')]);
        expect(drawingsControl('model', 's1', 'ETHUSDT').list()).toEqual([]);
        expect(drawingsControl('model', 's1', 'BTCUSDT').list()).toHaveLength(1);
    });

    it('capDrawings leaves a compliant list unchanged', () => {
        const one = [shape('a')];
        expect(capDrawings(one)).toEqual(one);
    });
});

describe('the model can read back what it drew', () => {
    it('describes the new kinds instead of dropping them from the packet', async () => {
        // describeDrawingsForModel had a `default: return null`, so an unknown
        // kind was drawn on the chart and then SILENTLY absent from what the
        // seat reads back. A shape it cannot see is worse than no shape.
        const { describeDrawingsForModel } = await import('../services/trade/chartDrawings');
        const at = (p: number) => ({ t: LAST, p });
        const shapes: ChartDrawing[] = [
            { id: 'c', kind: 'channel', points: [at(100), at(120)], color: DRAW_COLORS[0], createdAt: LAST },
            { id: 'a', kind: 'arrow', points: [at(100), at(110)], color: DRAW_COLORS[0], createdAt: LAST },
            { id: 'm', kind: 'measured_move', points: [at(100), at(90), at(120)], color: DRAW_COLORS[0], createdAt: LAST },
        ];
        const text = describeDrawingsForModel(shapes);
        expect(text).toMatch(/channel/);
        expect(text).toMatch(/arrow/);
        expect(text).toMatch(/measured move/);
        // The measured move states the numbers that matter.
        expect(text).toMatch(/2\.00:1|1\.00:1|0\.00:1/);
    });

    it('accepts the new kinds when validating stored shapes on load', async () => {
        const { pointsForKind } = await import('../services/trade/chartDrawings');
        const at = (p: number) => ({ t: LAST, p });
        expect(pointsForKind('channel', [at(1), at(2)])).toHaveLength(2);
        expect(pointsForKind('arrow', [at(1), at(2)])).toHaveLength(2);
        expect(pointsForKind('measured_move', [at(1), at(2), at(3)])).toHaveLength(3);
        // ...and still refuses a shape that cannot exist.
        expect(pointsForKind('measured_move', [at(1), at(2)])).toBeNull();
    });
});
