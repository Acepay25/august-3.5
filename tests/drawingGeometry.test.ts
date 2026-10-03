/**
 * drawingGeometry — the maths behind channel / arrow / measured_move.
 *
 * These three were the only shapes that could not be verified: their geometry
 * lived inline in a component closure over the canvas context, so jsdom could
 * not reach it and render-probe never draws a shape. A wrong band or a
 * mislabelled risk leg would have shipped green.
 *
 * The properties worth pinning are the ones a plausible-looking error breaks:
 * a channel whose two lines CONVERGE (a wedge is not a channel), an arrow
 * whose head points the wrong way, and a measured move whose risk or R:R
 * disagrees with the three prices it was given.
 */
import { describe, it, expect } from 'vitest';
import {
    channelGeometry, arrowGeometry, measuredMoveGeometry, formatLeg, shapeGeometry,
} from '../components/trade/drawingGeometry';

const PLOT_W = 800;

describe('channel geometry', () => {
    it('produces two parallel lines of constant separation', () => {
        const g = channelGeometry([{ x: 100, y: 200 }, { x: 300, y: 260 }], PLOT_W, '#0f0');
        expect(g.lines).toHaveLength(2);
        const [top, bottom] = g.lines;
        // Both lines are projected to the plot edges, so the gap measured at
        // any x is the same. A converging pair would mean a wedge.
        const gapAt = (x: number): number => Math.abs(
            top[0].y + (top[1].y - top[0].y) * (x / PLOT_W)
            - (bottom[0].y + (bottom[1].y - bottom[0].y) * (x / PLOT_W)),
        );
        expect(gapAt(0)).toBeCloseTo(60, 6);
        expect(gapAt(200)).toBeCloseTo(60, 6);
        expect(gapAt(PLOT_W)).toBeCloseTo(60, 6);
    });

    it('fills the band between the lines', () => {
        const g = channelGeometry([{ x: 0, y: 100 }, { x: 400, y: 140 }], PLOT_W, '#07b56a');
        expect(g.fills).toHaveLength(1);
        // The fill's corners are the four projected line ends, so it spans the
        // band rather than sitting somewhere inside it.
        expect(g.fills[0].points).toHaveLength(4);
    });

    it('draws the raw segment for a vertical pair instead of projecting infinity', () => {
        const g = channelGeometry([{ x: 200, y: 100 }, { x: 200, y: 300 }], PLOT_W, '#0f0');
        expect(g.lines).toHaveLength(1);
        expect(g.lines[0][0]).toEqual({ x: 200, y: 100 });
        expect(g.lines[0][1]).toEqual({ x: 200, y: 300 });
        expect(g.fills).toHaveLength(0);
    });

    it('needs two anchors', () => {
        expect(channelGeometry([{ x: 1, y: 1 }], PLOT_W, '#0f0').lines).toHaveLength(0);
    });
});

describe('arrow geometry', () => {
    it('draws the shaft from a to b and a head AT b', () => {
        const g = arrowGeometry([{ x: 10, y: 10 }, { x: 110, y: 60 }], '#399ef7');
        expect(g.lines[0]).toEqual([{ x: 10, y: 10 }, { x: 110, y: 60 }]);
        // The head's tip is the arrow's endpoint — a head at the START would
        // point the wrong way and still look like a shape.
        expect(g.fills[0].points[0]).toEqual({ x: 110, y: 60 });
        const [, l, r] = g.fills[0].points;
        // Both barbs sit BEHIND the tip along the shaft.
        expect(l.x).toBeLessThan(110);
        expect(r.x).toBeLessThan(110);
    });

    it('keeps the head visible on a very short arrow and bounded on a long one', () => {
        const short = arrowGeometry([{ x: 0, y: 0 }, { x: 2, y: 0 }], '#0f0');
        const long = arrowGeometry([{ x: 0, y: 0 }, { x: 5000, y: 0 }], '#0f0');
        const headLen = (g: ReturnType<typeof arrowGeometry>): number =>
            Math.hypot(g.fills[0].points[1].x - g.fills[0].points[0].x, g.fills[0].points[1].y - g.fills[0].points[0].y);
        expect(headLen(short)).toBeGreaterThanOrEqual(7);
        expect(headLen(long)).toBeLessThan(14.001); // float noise, not a spear
    });
});

describe('measured move geometry', () => {
    // y=400 -> 100000, y=300 -> 101000, y=100 -> 103000
    const priceAt = (y: number): number => 100000 + (400 - y) * 10;

    it('labels risk and reward from the three prices, with the ratio', () => {
        const g = measuredMoveGeometry(
            [{ x: 300, y: 400 }, { x: 300, y: 300 }, { x: 300, y: 100 }],
            priceAt, PLOT_W, '#f08800',
        );
        const texts = g.labels.map(l => l.text);
        // entry 100000, stop 99000, target 103000 -> risk 1000 (1%), reward
        // 3000 (3%), i.e. 3.0:1. A label derived from anything but these three
        // numbers would disagree here.
        expect(texts[0]).toContain('risk 1000');
        expect(texts[0]).toContain('1.00%');
        expect(texts[1]).toContain('reward 3000');
        expect(texts[1]).toContain('3.00%');
        expect(texts[1]).toContain('3.0:1');
    });

    it('needs all three anchors', () => {
        const g = measuredMoveGeometry([{ x: 0, y: 400 }, { x: 0, y: 300 }], priceAt, PLOT_W, '#0f0');
        expect(g.labels).toHaveLength(0);
        expect(g.lines).toHaveLength(0);
    });

    it('labels nothing when a price cannot be read — a wrong number is worse than none', () => {
        const g = measuredMoveGeometry(
            [{ x: 0, y: 400 }, { x: 0, y: 300 }, { x: 0, y: 100 }],
            () => NaN, PLOT_W, '#0f0',
        );
        expect(g.labels).toHaveLength(0);
        // The legs still draw, so the shape is not simply missing.
        expect(g.lines).toHaveLength(2);
    });

    it('formatLeg is absolute and sign-safe', () => {
        expect(formatLeg(100, 90, 100)).toBe('10.00 10.00%');
        expect(formatLeg(100, 110, 100)).toBe('10.00 10.00%');
        // A six-figure instrument drops the decimals.
        expect(formatLeg(100000, 99000, 100000)).toBe('1000 1.00%');
        // A zero entry cannot produce a percentage, so it must not emit NaN.
        expect(formatLeg(0, 10, 0)).toBe('10.00');
    });
});

describe('shapeGeometry dispatch', () => {
    it('covers the three computed kinds and defers the rest', () => {
        const opts = { plotW: PLOT_W, stroke: '#0f0', priceAt: (y: number) => y };
        const two = [{ x: 0, y: 10 }, { x: 100, y: 40 }];
        expect(shapeGeometry('channel', two, opts)).not.toBeNull();
        expect(shapeGeometry('arrow', two, opts)).not.toBeNull();
        expect(shapeGeometry('measured_move', [...two, { x: 100, y: 0 }], opts)).not.toBeNull();
        // These still render through their own canvas code, not here.
        for (const k of ['hline', 'trend', 'ray', 'rect', 'brush', 'fib', 'text'] as const) {
            expect(shapeGeometry(k, two, opts), k).toBeNull();
        }
    });
});