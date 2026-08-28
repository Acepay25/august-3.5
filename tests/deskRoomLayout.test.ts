import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    getRoomLayout,
    setSeatPosition,
    clearSeatPosition,
    setRoomLayout,
    resetRoomLayout,
    subscribeRoomLayout,
    applyRoomLayout,
    type SeatPosition,
} from '../services/desk/roomLayout';

const STORAGE_KEY_PREFIX = 'desk_room_layout_v1';

beforeEach(() => {
    if (typeof window !== 'undefined') window.localStorage.clear();
    window.localStorage.setItem('last_active_user', 'default');
});

afterEach(() => {
    if (typeof window !== 'undefined') window.localStorage.clear();
});

describe('roomLayout', () => {
    const names = ['Macro', 'Risk', 'Moderator'];

    it('starts empty when no layout has been saved', () => {
        expect(getRoomLayout(names)).toEqual({});
    });

    it('setSeatPosition persists and notifies subscribers', () => {
        const cb = vi.fn();
        const unsubscribe = subscribeRoomLayout(cb);
        const pos: SeatPosition = { x: 0.42, y: 0.71 };
        setSeatPosition(names, 'Macro', pos);
        expect(getRoomLayout(names)).toEqual({ Macro: pos });
        expect(cb).toHaveBeenCalledTimes(1);
        unsubscribe();
    });

    it('clearSeatPosition removes a single seat', () => {
        setSeatPosition(names, 'Macro', { x: 0.1, y: 0.2 });
        setSeatPosition(names, 'Risk', { x: 0.3, y: 0.4 });
        clearSeatPosition(names, 'Macro');
        expect(getRoomLayout(names)).toEqual({ Risk: { x: 0.3, y: 0.4 } });
    });

    it('resetRoomLayout wipes the whole roster layout', () => {
        setSeatPosition(names, 'Macro', { x: 0.1, y: 0.2 });
        setSeatPosition(names, 'Risk', { x: 0.3, y: 0.4 });
        resetRoomLayout(names);
        expect(getRoomLayout(names)).toEqual({});
    });

    it('setRoomLayout replaces the entire layout', () => {
        setSeatPosition(names, 'Macro', { x: 0.1, y: 0.2 });
        setRoomLayout(names, { Risk: { x: 0.5, y: 0.5 } });
        expect(getRoomLayout(names)).toEqual({ Risk: { x: 0.5, y: 0.5 } });
    });

    it('rejects positions with NaN / out-of-range coords', () => {
        setSeatPosition(names, 'Bad', { x: 1.5, y: 0.5 }); // out of range
        setSeatPosition(names, 'Bad2', { x: 0.5, y: -0.1 }); // out of range
        setSeatPosition(names, 'Bad3', { x: Number.NaN, y: 0.5 });
        expect(getRoomLayout(names)).toEqual({});
    });

    it('honors a roster hash — different rosters have separate layouts', () => {
        const teamA = ['Macro', 'Risk'];
        const teamB = ['Macro', 'Technical'];
        setSeatPosition(teamA, 'Macro', { x: 0.1, y: 0.2 });
        setSeatPosition(teamB, 'Macro', { x: 0.7, y: 0.8 });
        expect(getRoomLayout(teamA)).toEqual({ Macro: { x: 0.1, y: 0.2 } });
        expect(getRoomLayout(teamB)).toEqual({ Macro: { x: 0.7, y: 0.8 } });
    });

    it('order-insensitive roster hash — swapping seat order returns the same layout', () => {
        const a = ['Macro', 'Risk', 'Moderator'];
        const b = ['Moderator', 'Macro', 'Risk'];
        setSeatPosition(a, 'Macro', { x: 0.1, y: 0.2 });
        expect(getRoomLayout(b)).toEqual({ Macro: { x: 0.1, y: 0.2 } });
    });

    it('isolates the layout per active user', () => {
        const a = ['Macro'];
        const b = ['Macro'];
        setSeatPosition(a, 'Macro', { x: 0.1, y: 0.2 });
        window.localStorage.setItem('last_active_user', 'alice2');
        setSeatPosition(b, 'Macro', { x: 0.7, y: 0.8 });
        window.localStorage.setItem('last_active_user', 'default');
        expect(getRoomLayout(a)).toEqual({ Macro: { x: 0.1, y: 0.2 } });
        window.localStorage.setItem('last_active_user', 'alice2');
        expect(getRoomLayout(b)).toEqual({ Macro: { x: 0.7, y: 0.8 } });
    });

    it('applyRoomLayout returns a copy with anchors replaced where the user has a saved override', () => {
        const seats = [
            { name: 'Macro', anchor: { x: 0.18, y: 0.32 } },
            { name: 'Risk', anchor: { x: 0.10, y: 0.55 } },
        ];
        const layout = { Macro: { x: 0.5, y: 0.5 } };
        const out = applyRoomLayout(seats, layout);
        expect(out[0].anchor).toEqual({ x: 0.5, y: 0.5 });
        expect(out[1].anchor).toEqual({ x: 0.10, y: 0.55 });
        // Original seats array is not mutated.
        expect(seats[0].anchor).toEqual({ x: 0.18, y: 0.32 });
    });

    it('survives a corrupted localStorage entry', () => {
        window.localStorage.setItem(`${STORAGE_KEY_PREFIX}_default_abc`, 'not json');
        expect(getRoomLayout(['Macro'])).toEqual({});
    });
});
