/**
 * drawingsControl — the ONE place that mutates stored drawings.
 *
 * Before this, every call site did the same four steps by hand:
 *
 *     load…(sid, symbol) → [...existing, ...incoming] → .slice(-CAP) → save…
 *
 * which is easy to get subtly wrong: the cap is applied in a different place
 * per call site, `symbolRef.current` vs `t.symbol` can disagree after a coin
 * switch, and a save that skips the cap leaves the blob to grow. This is the
 * same shape as Vela's `chart.drawings` control (`add`/`remove`/`update`/
 * `setTool` + doc persistence), adapted to what August actually stores:
 * per session, per coin, in TWO buckets that must not clobber each other —
 * the user's shapes and the model's own.
 *
 * It is a thin object, not a store: it holds no canvas and no React state, so
 * the merge/cap/persist rules stay unit-testable.
 */
import {
    loadSessionDrawings,
    saveSessionDrawings,
    loadSessionModelDrawings,
    saveSessionModelDrawings,
    MAX_DRAWINGS_PER_SYMBOL,
    MAX_POINTS_PER_DRAWING,
    type ChartDrawing,
} from './chartDrawings';
import { getActiveUsername } from '../../utils/activeUser';

export type DrawingBucket = 'user' | 'model';

interface BucketIo {
    load: (sessionId: string, symbol: string, username?: string) => ChartDrawing[];
    save: (sessionId: string, symbol: string, drawings: ChartDrawing[], username?: string) => void;
}

const BUCKETS: Record<DrawingBucket, BucketIo> = {
    user: { load: loadSessionDrawings, save: saveSessionDrawings },
    model: { load: loadSessionModelDrawings, save: saveSessionModelDrawings },
};

/** Trim to the storage contract: newest N drawings, newest N points each. */
export const capDrawings = (drawings: ChartDrawing[]): ChartDrawing[] =>
    drawings
        .slice(-MAX_DRAWINGS_PER_SYMBOL)
        .map(d => (d.points.length > MAX_POINTS_PER_DRAWING
            ? { ...d, points: d.points.slice(0, MAX_POINTS_PER_DRAWING) }
            : d));

/**
 * A control bound to one session + coin + bucket. Construct it where the
 * symbol is already known — passing `symbolRef.current` at call time is what
 * let a coin switch write shapes under the wrong coin.
 */
export interface DrawingsControl {
    readonly bucket: DrawingBucket;
    readonly sessionId: string;
    readonly symbol: string;
    list(): ChartDrawing[];
    add(drawings: ChartDrawing[]): ChartDrawing[];
    replace(drawings: ChartDrawing[]): ChartDrawing[];
    remove(ids: string[]): ChartDrawing[];
    clear(): void;
    /** Rename a shape's label/color in place — the control's `update`. */
    update(id: string, patch: Partial<Pick<ChartDrawing, 'label' | 'color'>>): ChartDrawing | null;
}

export const drawingsControl = (
    bucket: DrawingBucket,
    sessionId: string,
    symbol: string,
    username = getActiveUsername(),
): DrawingsControl => {
    const io = BUCKETS[bucket];
    const persist = (next: ChartDrawing[]): ChartDrawing[] => {
        const capped = capDrawings(next);
        io.save(sessionId, symbol, capped, username);
        return capped;
    };
    return {
        bucket,
        sessionId,
        symbol,
        list: () => io.load(sessionId, symbol, username),
        add: incoming => persist([...io.load(sessionId, symbol, username), ...incoming]),
        replace: persist,
        remove: ids => persist(io.load(sessionId, symbol, username).filter(d => !ids.includes(d.id))),
        clear: () => persist([]),
        update: (id, patch) => {
            const current = io.load(sessionId, symbol, username);
            let updated: ChartDrawing | null = null;
            const next = current.map(d => {
                if (d.id !== id) return d;
                updated = { ...d, ...patch };
                return updated;
            });
            persist(next);
            return updated;
        },
    };
};