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
