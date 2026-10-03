/**
 * drawingGeometry — the CALCULATION behind the drawn shapes, separated from the
 * canvas calls that consume it.
 *
 * These three kinds (channel, arrow, measured_move) were the only shapes whose
 * geometry could not be verified: each case was inline in a component closure
 * over `ctx`, so jsdom could not reach it and render-probe — which never draws a
 * shape — passed regardless. A plausible-but-wrong band or a measured-move
 * label in the wrong place is exactly the class of defect this repo cannot catch
 * by asserting a component rendered.
 *
 * Pure in, points/labels out. The component issues the canvas calls from what
 * these return, and the maths is unit-testable without a browser.
 */
import type { DrawKind } from '../../services/trade/chartDrawings';

export interface XY { x: number; y: number }

/** A polyline to stroke. */
export type Polyline = XY[];
/** A closed polygon to fill AND stroke. */
export interface Polygon { points: XY[]; fill?: string }
/** Text to draw, already positioned. */
export interface Label { at: XY; text: string; font: string; color: string; anchor?: 'left' | 'center' }

export interface ShapeGeometry {
    lines: Polyline[];
    dashed?: Polyline[];
    polygons: Polygon[];
    fills: Polygon[];
    labels: Label[];
}

const empty = (): ShapeGeometry => ({ lines: [], polygons: [], fills: [], labels: [] });

/**
 * A CHANNEL: two parallel lines through the two anchors, extended to the plot
 * edges, with the band between them filled. The second line is the first
 * translated by the anchor separation, so the band has a constant width — which
 * is what makes it a channel rather than a wedge.
 */
export const channelGeometry = (pts: XY[], plotW: number, stroke: string): ShapeGeometry => {
    const g = empty();
    if (pts.length < 2) return g;
    const [a, b] = pts;
    const dx = b.x - a.x;
    // A vertical pair has no slope to project; draw the segment itself rather
    // than dividing by ~0 and projecting to infinity.
    if (Math.abs(dx) < 0.001) {
        g.lines.push([a, b]);
        return g;
    }
    const slope = (b.y - a.y) / dx;
    // The SECOND line is the FIRST translated by a constant — the vertical
    // separation between the anchors. Anchoring it at `b` instead (as an
    // earlier version did) makes the two lines converge into a wedge: measured
    // across the plot, that band came out 52.5 wide instead of the 60 the
    // anchors specify, so the "range" the trader drew was not the range drawn.
    const offset = a.y - b.y;
    const lineY = (x: number, base: number): number => base + slope * x;
    const top: Polyline = [{ x: 0, y: lineY(0, a.y) }, { x: plotW, y: lineY(plotW, a.y) }];
    const bottom: Polyline = [{ x: 0, y: lineY(0, a.y) + offset }, { x: plotW, y: lineY(plotW, a.y) + offset }];
    g.lines.push(top, bottom);
    g.fills.push({ points: [top[0], top[1], bottom[1], bottom[0]], fill: `${stroke}1f` });
    return g;
};

/**
 * An ARROW: a shaft from a to b plus a triangular head at b. The head length is
 * clamped so a short arrow is still visible and a long one is not a spear.
 */
export const arrowGeometry = (pts: XY[], stroke: string): ShapeGeometry => {
    const g = empty();
    if (pts.length < 2) return g;
    const [a, b] = pts;
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const head = Math.max(7, Math.min(14, Math.hypot(b.x - a.x, b.y - a.y) * 0.32));
    g.lines.push([a, b]);
    g.fills.push({
        points: [
            b,
            { x: b.x - head * Math.cos(angle - 0.42), y: b.y - head * Math.sin(angle - 0.42) },
            { x: b.x - head * Math.cos(angle + 0.42), y: b.y - head * Math.sin(angle + 0.42) },
        ],
        fill: stroke,
    });
    return g;
};

/** Price-formatting a leg label, shared by the measured move and its tests. */
export const formatLeg = (from: number, to: number, entry: number): string => {
    const abs = (v: number): string => (Math.abs(v) >= 1000 ? Math.abs(v).toFixed(0) : Math.abs(v).toFixed(2));
    const pct = entry > 0 ? ` ${Math.abs(((to - from) / entry) * 100).toFixed(2)}%` : '';
    return `${abs(to - from)}${pct}`;
};

/**
 * A MEASURED MOVE: entry → stop (risk, dashed) and entry → target (reward),
 * both stacked on one bar, each labelled with its distance, its percentage and
 * — for the reward — the resulting R:R. The numbers are the point of the shape,
 * so they are computed here rather than in the draw loop.
 */
export const measuredMoveGeometry = (
    pts: XY[],
    priceAt: (y: number) => number,
    plotW: number,
    stroke: string,
    font = '9px ui-monospace, monospace',
): ShapeGeometry => {
    const g = empty();
    if (pts.length < 3) return g;
    const [entry, stop, target] = pts;
    const e = priceAt(entry.y);
    const s = priceAt(stop.y);
    const t = priceAt(target.y);
    const labelX = entry.x + 14;
    // The legs run from the entry to each level, offset so the two labels do
    // not sit on top of each other when stop and target are close.
    g.lines.push([{ x: entry.x - 4, y: entry.y }, { x: labelX, y: stop.y }]);
    g.lines.push([{ x: entry.x - 4, y: entry.y }, { x: labelX, y: target.y }]);
    const finite = [e, s, t].every(Number.isFinite);
    if (finite) {
        const risk = Math.abs(e - s);
        const reward = Math.abs(t - e);
        const ratio = risk > 0 ? reward / risk : 0;
        g.labels.push({
            at: { x: labelX, y: (entry.y + stop.y) / 2 },
            text: `risk ${formatLeg(e, s, e)}`,
            font,
            color: stroke,
        });
        g.labels.push({
            at: { x: labelX, y: (entry.y + target.y) / 2 },
            text: `reward ${formatLeg(e, t, e)}${ratio ? ` · ${ratio.toFixed(1)}:1` : ''}`,
            font,
            color: stroke,
        });
    }
    void plotW;
    return g;
};

/** Dispatch by kind, for the kinds whose maths lives here. */
export const shapeGeometry = (kind: DrawKind, pts: XY[], opts: {
    plotW: number; stroke: string; priceAt?: (y: number) => number;
}): ShapeGeometry | null => {
    switch (kind) {
        case 'channel': return channelGeometry(pts, opts.plotW, opts.stroke);
        case 'arrow': return arrowGeometry(pts, opts.stroke);
        case 'measured_move': return measuredMoveGeometry(pts, opts.priceAt ?? (() => NaN), opts.plotW, opts.stroke);
        default: return null;
    }
};
