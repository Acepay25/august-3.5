/**
 * floorLayout — pure positioning logic for the 2D desk floor.
 *
 * The floor is a reference canvas (default 960×540, configurable). Each
 * seat gets a normalized `{x, y}` anchor in 0..1 space; the parent
 * multiplies by the measured container size on mount/resize.
 *
 * The layout has 8 named anchors — one per role preset. When a debate
 * has fewer than 8 actors, the missing anchors are simply empty. When
 * it has MORE than 8 (a custom roster), the extras fan out to "wing"
 * positions on the left and right edges.
 *
 * Why normalized coords? So the layout is responsive — the same 0..1
 * values map to a 720×420 phone screen or a 1600×900 ultrawide. The
 * parent uses a `ResizeObserver` to recompute the actual CSS sizes.
 */

import { roleForName, type RolePreset } from './pixelAvatars';
import { resolveRole } from '../../services/desk/roleOverrides';
import { applyRoomLayout, type RoomLayout, type SeatPosition } from '../../services/desk/roomLayout';

export interface SeatAnchor {
    x: number; // 0..1
    y: number; // 0..1
}

export interface FloorSeat {
    id: string;
    name: string;
    role: RolePreset;
    anchor: SeatAnchor;
    /** Side the seat is on — used to flip the speech-bubble tail. */
    side: 'left' | 'right' | 'center';
}

const ROLE_ANCHORS: Record<RolePreset, SeatAnchor> = {
    risk:        { x: 0.10, y: 0.55 },
    macro:       { x: 0.18, y: 0.32 },
    technical:   { x: 0.32, y: 0.30 },
    sentiment:   { x: 0.18, y: 0.78 },
    moderator:   { x: 0.50, y: 0.55 },
    followup:    { x: 0.78, y: 0.32 },
    postmortem:  { x: 0.86, y: 0.55 },
    execution:   { x: 0.78, y: 0.78 },
    unknown:     { x: 0.50, y: 0.78 },
};

const ROLE_SIDE: Record<RolePreset, FloorSeat['side']> = {
    risk: 'left',
    macro: 'left',
    technical: 'left',
    sentiment: 'left',
    moderator: 'center',
    followup: 'right',
    postmortem: 'right',
    execution: 'right',
    unknown: 'center',
};

/** Anchor for a given role preset. */
export const anchorForRole = (role: RolePreset): SeatAnchor => ROLE_ANCHORS[role];

/** Side classification for the role (used by the speech bubble tail). */
export const sideForRole = (role: RolePreset): FloorSeat['side'] => ROLE_SIDE[role];

/**
 * Pick a side from a normalized `x` — left if x < 0.4, right if x > 0.6,
 * center otherwise. Useful for fan-out seats that don't have a role preset.
 */
export const sideForX = (x: number): FloorSeat['side'] => {
    if (x < 0.4) return 'left';
    if (x > 0.6) return 'right';
    return 'center';
};

/**
 * Wing anchors for fan-out seats beyond the 8 named roles. We add rows
 * below the existing seats on each side. Up to 4 wing seats per side.
 */
const LEFT_WINGS: SeatAnchor[] = [
    { x: 0.04, y: 0.32 },
    { x: 0.04, y: 0.78 },
    { x: 0.10, y: 0.20 },
    { x: 0.10, y: 0.86 },
];
const RIGHT_WINGS: SeatAnchor[] = [
    { x: 0.96, y: 0.32 },
    { x: 0.96, y: 0.78 },
    { x: 0.90, y: 0.20 },
    { x: 0.90, y: 0.86 },
];

/**
 * Map a list of actor names to FloorSeats. Honors the role preset when
 * known, and falls back to fan-out anchors for unknown roles. Per-user
 * overrides (Settings → Roles) win over the heuristic. Per-user room
 * layouts (dragged positions) win over the role anchor.
 */
export const layoutFloor = (names: string[], layout?: RoomLayout): FloorSeat[] => {
    const seats: FloorSeat[] = [];
    const taken = new Set<RolePreset>();
    const unknownNames: string[] = [];
    for (const n of names) {
        const role = resolveRole(n);
        if (role === 'unknown' || taken.has(role)) {
            unknownNames.push(n);
            continue;
        }
        taken.add(role);
        seats.push({
            id: n,
            name: n,
            role,
            anchor: ROLE_ANCHORS[role],
            side: ROLE_SIDE[role],
        });
    }
    let leftWingIdx = 0;
    let rightWingIdx = 0;
    for (let i = 0; i < unknownNames.length; i++) {
        const n = unknownNames[i];
        const wing = i % 2 === 0 ? LEFT_WINGS : RIGHT_WINGS;
        const idx = i % 2 === 0 ? leftWingIdx++ : rightWingIdx++;
        const anchor = wing[idx % wing.length];
        seats.push({
            id: n,
            name: n,
            role: 'unknown',
            anchor,
            side: i % 2 === 0 ? 'left' : 'right',
        });
    }
    if (layout && Object.keys(layout).length > 0) {
        return applyRoomLayout(seats, layout);
    }
    return seats;
};

/** Reference canvas dimensions. The parent multiplies normalized coords
 *  by the measured container size; these are the *default* if measurement
 *  hasn't happened yet. */
export const FLOOR_REFERENCE_W = 960;
export const FLOOR_REFERENCE_H = 540;
