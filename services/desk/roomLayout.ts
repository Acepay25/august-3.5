/**
 * roomLayout — per-user, per-roster seat (x, y) overrides for the desk
 * floor. The default anchors in `floorLayout.ts` cover the 8 role
 * presets at hand-tuned positions. When the trader wants to rearrange
 * the room (drag a seat to a new spot), the custom position is saved
 * here and honored on every render. The state is keyed by a roster
 * hash so different rosters (8 default seats vs 4 custom seats) don't
 * collide.
 *
 * Persistence: localStorage under `desk_room_layout_v1_<user>_<hash>`.
 * Each entry in the JSON value is `{ "SeatName": { "x": 0.42, "y": 0.71 } }`.
 *
 * The DeskScene subscribes to layout changes via `subscribeRoomLayout`
 * so a drag from the floor immediately reflects on Settings / a re-render.
 */

import { getActiveUsername } from '../../utils/activeUser';

const STORAGE_KEY_PREFIX = 'desk_room_layout_v1';

export interface SeatPosition { x: number; y: number; }
export type RoomLayout = Record<string, SeatPosition>;

/** Snap a normalized coordinate to the nearest grid cell. `step` is in
 *  0..1 units; default 0.05 (5% of the canvas, ~50px on a 960-wide floor).
 *  Values are clamped to [0, 1] AFTER snapping so the result is always
 *  in-range. The `+ 0` trick normalizes the result to non-negative zero
 *  (Object.is(-0, 0) is false; tests rely on a positive zero). */
export const snapToGrid = (n: number, step = 0.05): number => {
    if (!Number.isFinite(n)) return 0;
    const snapped = Math.round(n / step) * step;
    if (snapped <= 0) return 0;
    if (snapped >= 1) return 1;
    return snapped + 0;
};

/** Snap a seat position to the grid. Convenience wrapper. */
export const snapSeatPosition = (pos: SeatPosition, step = 0.05): SeatPosition => ({
    x: snapToGrid(pos.x, step),
    y: snapToGrid(pos.y, step),
});

const isFinite01 = (n: unknown): n is number =>
    typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1;

const sanitize = (raw: string | null): RoomLayout => {
    if (!raw) return {};
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
        const out: RoomLayout = {};
        for (const [name, pos] of Object.entries(parsed)) {
            if (typeof name !== 'string' || !name) continue;
            if (!pos || typeof pos !== 'object') continue;
            const p = pos as { x?: unknown; y?: unknown };
            if (isFinite01(p.x) && isFinite01(p.y)) {
                out[name] = { x: p.x, y: p.y };
            }
        }
        return out;
    } catch {
        return {};
    }
};

const rosterHash = (names: string[]): string => {
    // Simple order-insensitive hash so a {Macro, Risk, Moderator, ...}
    // roster hashes the same regardless of seat order. FNV-1a 32-bit.
    const sorted = [...names].sort();
    const joined = sorted.join('\u0001');
    let h = 0x811c9dc5;
    for (let i = 0; i < joined.length; i += 1) {
        h ^= joined.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16);
};

const storageKey = (names: string[]): string =>
    `${STORAGE_KEY_PREFIX}_${getActiveUsername()}_${rosterHash(names)}`;

const read = (names: string[]): RoomLayout => {
    if (typeof window === 'undefined' || !window.localStorage) return {};
    return sanitize(window.localStorage.getItem(storageKey(names)));
};

const write = (names: string[], layout: RoomLayout): void => {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
        window.localStorage.setItem(storageKey(names), JSON.stringify(layout));
    } catch {
        // Ignore quota / private mode.
    }
};

// Pub/sub.
type Listener = () => void;
const listeners = new Set<Listener>();
const notify = (): void => {
    for (const l of listeners) l();
};

/** Read the layout for a roster (current user). */
export const getRoomLayout = (names: string[]): RoomLayout => read(names);

/** Replace the entire layout for a roster. */
export const setRoomLayout = (names: string[], layout: RoomLayout): void => {
    write(names, layout);
    notify();
};

/** Update a single seat's position. */
export const setSeatPosition = (
    names: string[],
    seatName: string,
    pos: SeatPosition,
): void => {
    const next = { ...read(names), [seatName]: { x: pos.x, y: pos.y } };
    write(names, next);
    notify();
};

/** Remove a single seat's custom position. */
export const clearSeatPosition = (names: string[], seatName: string): void => {
    const next = { ...read(names) };
    delete next[seatName];
    write(names, next);
    notify();
};

/** Clear all custom positions for a roster (revert to defaults). */
export const resetRoomLayout = (names: string[]): void => {
    write(names, {});
    notify();
};

export const subscribeRoomLayout = (l: Listener): (() => void) => {
    listeners.add(l);
    return () => { listeners.delete(l); };
};

/** Apply custom positions on top of role-anchor fallbacks. Returns a
 *  copy of the input seats with the `anchor` replaced where the user
 *  has a saved override. */
export const applyRoomLayout = <T extends { name: string; anchor: SeatPosition }>(
    seats: T[],
    layout: RoomLayout,
): T[] => seats.map(s => (layout[s.name] ? { ...s, anchor: layout[s.name] } : s));

// ─── Undo stack ────────────────────────────────────────────────────────────

/** One undo entry: a single seat's previous + next position. The
 *  undo stack is a per-desk-session in-memory LIFO; it doesn't
 *  survive a reload by design (a stale undo on a fresh session
 *  would be confusing). */
export interface UndoEntry {
    seatName: string;
    previous: SeatPosition | null;
    next: SeatPosition;
}

const undoStack: UndoEntry[] = [];
const undoListeners = new Set<Listener>();

/** Push an undo entry. Use the previous position returned by
 *  `getSeatPosition`, or `null` if the seat was at its default. */
export const pushUndo = (entry: UndoEntry): void => {
    undoStack.push(entry);
    for (const l of undoListeners) l();
};

/** Pop the most recent undo entry. Returns null when empty. */
export const popUndo = (): UndoEntry | null => undoStack.pop() ?? null;

/**
 * Pop the most recent N undo entries (or all of them when N is larger
 * than the stack depth). Returns an empty array when the stack is
 * empty. Used by the multi-level Undo button — each click pops one
 * entry, so a user can keep clicking to peel back further.
 */
export const popUndoN = (n: number): UndoEntry[] => {
    if (n <= 0) return [];
    const out: UndoEntry[] = [];
    const take = Math.min(n, undoStack.length);
    for (let i = 0; i < take; i += 1) {
        const entry = undoStack.pop();
        if (!entry) break;
        out.push(entry);
    }
    if (out.length > 0) {
        for (const l of undoListeners) l();
    }
    return out;
};

/**
 * Apply an array of undo entries in REVERSE order (most recent first),
 * restoring each seat to its previous position (or clearing if the
 * previous was null). This is the natural inverse of a series of
 * pushes and matches the way the user thinks about Undo: "undo the
 * last thing, then the thing before that, etc."
 */
export const applyUndoEntries = (names: string[], entries: UndoEntry[]): void => {
    for (const entry of entries) {
        if (entry.previous) {
            setSeatPosition(names, entry.seatName, entry.previous);
        } else {
            clearSeatPosition(names, entry.seatName);
        }
    }
};

/** Number of pending undos. */
export const undoDepth = (): number => undoStack.length;

/** Clear the undo stack (e.g. when the desk closes). */
export const clearUndoStack = (): void => {
    undoStack.length = 0;
    for (const l of undoListeners) l();
};

export const subscribeUndo = (l: Listener): (() => void) => {
    undoListeners.add(l);
    return () => { undoListeners.delete(l); };
};
