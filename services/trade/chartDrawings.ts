/**
 * chartDrawings — persistence + model-facing description for the user's
 * TradingView-style drawings on the trade chart (trendlines, horizontal
 * lines, rays, rectangles, brush paths). Shapes are anchored in DATA space
 * (unix-second time + price), never screen pixels, so a drawing survives
 * reloads, interval changes, zoom and pan. Storage is per active user and
 * per symbol (a BTC trendline must not appear on ETH) with hard caps so the
 * blob can't grow forever. Pure module — no canvas, no React — so the
 * validation and the "what the model reads" formatter are unit-testable.
 */

import { getActiveUsername } from '../../utils/activeUser';
import { phtStamp } from '../../utils/timezone';

export type DrawKind = 'trend' | 'hline' | 'ray' | 'rect' | 'brush' | 'fib' | 'text';

/** One anchor point in data space: t = unix seconds, p = price. */
export interface DrawPoint { t: number; p: number }

export interface ChartDrawing {
    id: string;
    kind: DrawKind;
    points: DrawPoint[];
    /** CSS color the shape was drawn with. */
    color: string;
    /** Milliseconds when the user finished the shape (order for the model). */
    createdAt: number;
    /** Optional user label shown on the shape's first anchor. */
    label?: string;
}

export const MAX_DRAWINGS_PER_SYMBOL = 40;
export const MAX_POINTS_PER_DRAWING = 200;

const KINDS: readonly string[] = ['trend', 'hline', 'ray', 'rect', 'brush', 'fib', 'text'];

/** Fibonacci retracement ratios drawn between a fib's two anchors. */
export const FIB_RATIOS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] as const;

/** TradingView-style palette for the user's drawing tools (theme-aligned:
 *  emerald/rose/amber/sky/violet). Lives here (not in the chart component)
 *  so the tool rail and the chart share it without a cyclic import. */
export const DRAW_COLORS = ['#07b56a', '#f75d5f', '#f08800', '#399ef7', '#c084fc'] as const;

/** What the tool rail's pointer flow puts on the overlay: 'cursor' is the
 *  chart's native pan/zoom, 'erase' deletes a user shape, the rest are the
 *  DrawKinds themselves. */
export type DrawTool = 'cursor' | DrawKind | 'erase';

const storageKey = (username: string, symbol: string): string =>
    `trade_drawings_v1_${username}_${symbol.toUpperCase()}`;

const finiteNum = (v: unknown): number | null => {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : null;
};

const validPoint = (p: unknown): p is DrawPoint => {
    const v = p as DrawPoint;
    return !!v && typeof v === 'object' && finiteNum(v.t) !== null && finiteNum(v.p) !== null;
};

const validDrawing = (d: unknown): d is ChartDrawing => {
    const v = d as ChartDrawing;
    if (!v || typeof v !== 'object') return false;
    if (typeof v.id !== 'string' || !KINDS.includes(v.kind)) return false;
    if (!Array.isArray(v.points) || v.points.length === 0) return false;
    if (typeof v.color !== 'string') return false;
    return true;
};

/** Read + validate + bound the stored shapes for one symbol; garbage → []. */
export const loadDrawings = (symbol: string, username = getActiveUsername()): ChartDrawing[] => {
    try {
        const raw = localStorage.getItem(storageKey(username, symbol));
        if (!raw) return [];
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(validDrawing).map(d => ({
            ...d,
            points: d.points.filter(validPoint).slice(0, MAX_POINTS_PER_DRAWING),
        })).filter(d => d.points.length > 0).slice(-MAX_DRAWINGS_PER_SYMBOL);
    } catch {
        return [];
    }
};

export const saveDrawings = (symbol: string, drawings: ChartDrawing[], username = getActiveUsername()): void => {
    try {
        const trimmed = drawings.slice(-MAX_DRAWINGS_PER_SYMBOL)
            .map(d => ({ ...d, points: d.points.slice(0, MAX_POINTS_PER_DRAWING) }));
        localStorage.setItem(storageKey(username, symbol), JSON.stringify(trimmed));
    } catch {
        /* quota / private mode — drawings stay in memory this session */
    }
};

export const createDrawingId = (): string =>
    `d-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/** Palette names the model may use in draw_on_chart (mapped to the chart's
 *  TradingView-style DRAW_COLORS). */
export const MODEL_COLOR_NAMES = { emerald: '#07b56a', rose: '#f75d5f', amber: '#f08800', sky: '#399ef7', violet: '#c084fc' } as const;
export type ModelColorName = keyof typeof MODEL_COLOR_NAMES;

/** Default anchors: a line spans the last 40 bars → now. */
const DEFAULT_START_BARS_AGO = 40;

/**
 * Convert a model's draw_on_chart / mark_trade_levels call into data-space
 * drawings. The model expresses anchors as PRICES plus "bars ago" offsets
 * (it cannot know wall-clock bar times); `lastBarTime` (unix seconds of the
 * newest candle) + `barSeconds` re-anchor them onto the real axis. Pure so
 * the conversion is unit-testable.
 */
export const drawingFromChartTool = (
    args: {
        kind?: unknown;
        prices?: unknown;
        startBarsAgo?: unknown;
        endBarsAgo?: unknown;
        color?: unknown;
        label?: unknown;
    },
    ctx: { lastBarTime: number; barSeconds: number },
): { drawings: ChartDrawing[]; error?: string } => {
    const kindRaw = typeof args.kind === 'string' ? args.kind : '';
    const kindMap: Record<string, DrawKind> = { hline: 'hline', horizontal: 'hline', trend: 'trend', trendline: 'trend', line: 'trend', ray: 'ray', zone: 'rect', rect: 'rect', rectangle: 'rect', fib: 'fib', retracement: 'fib', 'fib-retracement': 'fib', text: 'text', note: 'text', annotation: 'text' };
    const kind = kindMap[kindRaw];
    if (!kind) return { drawings: [], error: `unknown kind "${kindRaw}" — use hline, trend, ray, zone, fib or text` };

    const prices = Array.isArray(args.prices) ? args.prices.map(p => Number(p)).filter(p => Number.isFinite(p)) : [];
    const need = kind === 'hline' || kind === 'text' ? 1 : 2;
    if (prices.length < need) return { drawings: [], error: `${kind} needs ${need} price(s) in "prices"` };

    const barAt = (barsAgo: number): number => Math.round(ctx.lastBarTime - barsAgo * ctx.barSeconds);
    const start = Number.isFinite(Number(args.startBarsAgo)) ? Math.max(0, Number(args.startBarsAgo)) : DEFAULT_START_BARS_AGO;
    const end = Number.isFinite(Number(args.endBarsAgo)) ? Math.max(0, Number(args.endBarsAgo)) : 0;
    if (kind !== 'hline' && kind !== 'text' && start <= end) return { drawings: [], error: 'startBarsAgo must be greater than endBarsAgo (start is the older anchor)' };

    const colorName = typeof args.color === 'string' && args.color in MODEL_COLOR_NAMES ? args.color as ModelColorName : 'sky';
    const color = MODEL_COLOR_NAMES[colorName];
    const label = typeof args.label === 'string' && args.label.trim() ? args.label.trim().slice(0, 40) : undefined;

    const points: DrawPoint[] = kind === 'hline' || kind === 'text'
        ? [{ t: barAt(end), p: prices[0] }]
        : [{ t: barAt(start), p: prices[0] }, { t: barAt(end), p: prices[1] }];

    return { drawings: [{ id: createDrawingId(), kind, points, color, createdAt: Date.now(), label }] };
};

/**
 * Convert a mark_trade_levels call into labeled horizontal lines: Entry
 * (sky), SL (rose), TPs (amber). One drawing per level, in that order.
 */
export const drawingsFromLevelTool = (
    args: { entry?: unknown; stopLoss?: unknown; takeProfits?: unknown },
): { drawings: ChartDrawing[]; error?: string } => {
    const num = (v: unknown): number | null => {
        const n = typeof v === 'number' ? v : Number(v);
        return Number.isFinite(n) ? n : null;
    };
    const entry = num(args.entry);
    const stop = num(args.stopLoss);
    const tps = Array.isArray(args.takeProfits) ? args.takeProfits.map(num).filter((n): n is number => n !== null).slice(0, 5) : [];
    if (entry === null) return { drawings: [], error: 'entry price is required' };
    if (stop === null && tps.length === 0) return { drawings: [], error: 'provide stopLoss and/or takeProfits' };

    const mk = (price: number, label: string, color: string): ChartDrawing => ({
        id: createDrawingId(), kind: 'hline', points: [{ t: Date.now() / 1000, p: price }], color, createdAt: Date.now(), label,
    });
    const drawings: ChartDrawing[] = [mk(entry, 'Entry', MODEL_COLOR_NAMES.sky)];
    if (stop !== null) drawings.push(mk(stop, 'SL', MODEL_COLOR_NAMES.rose));
    tps.forEach((tp, i) => drawings.push(mk(tp, `TP${i + 1}`, MODEL_COLOR_NAMES.amber)));
    return { drawings };
};

/** Minimum anchors per kind — guards against junk shapes reaching storage. */
export const pointsForKind = (kind: DrawKind, points: DrawPoint[]): DrawPoint[] | null => {
    if (kind === 'hline' || kind === 'text') return points.length >= 1 ? [points[0]] : null;
    if (kind === 'trend' || kind === 'ray') return points.length >= 2 ? points.slice(0, 2) : null;
    if (kind === 'rect' || kind === 'fib') return points.length >= 2 ? points.slice(0, 2) : null;
    if (kind === 'brush') return points.length >= 2 ? points.slice(0, MAX_POINTS_PER_DRAWING) : null;
    return null;
};

const fmt = (n: number): string => Number.isInteger(n) ? String(n) : n.toFixed(2);

/** A rough duration name for a trendline/ray's time span, so the model
 *  knows how wide a shape is without counting seconds. */
const spanName = (seconds: number): string => {
    const mins = seconds / 60;
    if (mins < 5) return 'a few minutes';
    if (mins < 60) return `${Math.round(mins)}m`;
    if (mins < 24 * 60) return `${(mins / 60).toFixed(1)}h`;
    return `${(mins / (60 * 24)).toFixed(1)}d`;
};

/**
 * The chart in words for the model: one line per shape with kind, anchors
 * and (for lines) the slope direction. Used by get_chart_view and the
 * per-message context packet so the model sees what the user drew.
 */
export const describeDrawingsForModel = (drawings: ChartDrawing[]): string => {
    if (drawings.length === 0) return '';
    // Times are Philippine (Manila) throughout — the model reads and repeats
    // the SAME clock the user sees on the chart.
    const lines = drawings.map(d => {
        const tag = d.label ? ` "${d.label}"` : '';
        const stamp = (unixSeconds: number): string => phtStamp(unixSeconds * 1000);
        switch (d.kind) {
            case 'hline':
                return `- horizontal line${tag} at price ${fmt(d.points[0].p)} (drawn ${phtStamp(d.createdAt)})`;
            case 'trend':
            case 'ray': {
                const [a, b] = d.points;
                const slope = b.p > a.p ? 'rising' : b.p < a.p ? 'falling' : 'flat';
                const kindName = d.kind === 'trend' ? 'trendline' : 'ray';
                return `- ${slope} ${kindName}${tag} from ${fmt(a.p)} (${stamp(a.t)}) through ${fmt(b.p)} (${stamp(b.t)}), spans ${spanName(Math.abs(b.t - a.t))}${d.kind === 'ray' ? ', extends right' : ''}`;
            }
            case 'rect': {
                const [a, b] = d.points;
                const top = Math.max(a.p, b.p);
                const bottom = Math.min(a.p, b.p);
                const left = Math.min(a.t, b.t);
                const right = Math.max(a.t, b.t);
                return `- supply/demand zone${tag} between prices ${fmt(bottom)} and ${fmt(top)}, from ${stamp(left)} to ${stamp(right)}`;
            }
            case 'brush': {
                const first = d.points[0];
                const last = d.points[d.points.length - 1];
                return `- freehand sketch${tag} (${d.points.length} points) starting at price ${fmt(first.p)} (${stamp(first.t)}), ending at ${fmt(last.p)}`;
            }
            case 'fib': {
                const [a, b] = d.points;
                const high = Math.max(a.p, b.p);
                const low = Math.min(a.p, b.p);
                return `- fibonacci retracement${tag} from ${fmt(low)} to ${fmt(high)}, levels at ${FIB_RATIOS.map(r => `${(r * 100).toFixed(1)}%`).join('/')}, spans ${spanName(Math.abs(b.t - a.t))}`;
            }
            case 'text':
                return `- text note${tag} at price ${fmt(d.points[0].p)} (${stamp(d.points[0].t)})${d.label ? `: ${d.label}` : ''}`;
            default:
                return null;
        }
    }).filter((l): l is string => Boolean(l));
    return [`USER DRAWINGS ON THE CHART (${drawings.length} shape${drawings.length === 1 ? '' : 's'}), times in Philippine time (UTC+8):`, ...lines].join('\n');
};
