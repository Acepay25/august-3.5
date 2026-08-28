import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    snapToGrid,
    snapSeatPosition,
    setSeatPosition,
    getRoomLayout,
    clearSeatPosition,
    pushUndo,
    popUndo,
    undoDepth,
    clearUndoStack,
} from '../services/desk/roomLayout';

beforeEach(() => {
    if (typeof window !== 'undefined') window.localStorage.clear();
    window.localStorage.setItem('last_active_user', 'default');
    clearUndoStack();
});

afterEach(() => {
    if (typeof window !== 'undefined') window.localStorage.clear();
    clearUndoStack();
});

describe('snapToGrid', () => {
    it('rounds to the nearest 0.05 cell by default', () => {
        expect(snapToGrid(0)).toBe(0);
        expect(snapToGrid(0.024)).toBe(0);
        expect(snapToGrid(0.025)).toBeCloseTo(0.05, 10);
        expect(snapToGrid(0.074)).toBeCloseTo(0.05, 10);
        expect(snapToGrid(0.076)).toBeCloseTo(0.1, 10);
        expect(snapToGrid(1)).toBe(1);
    });

    it('clamps values past the boundary (avoids 1.0000001)', () => {
        expect(snapToGrid(1.0000001)).toBe(1);
        // -0.0001 should clamp to 0, NOT signed-zero. Object.is would
        // distinguish -0 from +0, so we normalize via the + 0 trick.
        expect(snapToGrid(-0.0001) + 0).toBe(0);
    });

    it('returns 0 for non-finite input', () => {
        expect(snapToGrid(Number.NaN)).toBe(0);
        expect(snapToGrid(Number.POSITIVE_INFINITY)).toBe(0);
    });

    it('respects a custom step', () => {
        expect(snapToGrid(0.3, 0.1)).toBeCloseTo(0.3, 10);
        expect(snapToGrid(0.34, 0.1)).toBeCloseTo(0.3, 10);
        expect(snapToGrid(0.36, 0.1)).toBeCloseTo(0.4, 10);
    });

    it('snapSeatPosition snaps both axes', () => {
        const out = snapSeatPosition({ x: 0.123, y: 0.876 }, 0.1);
        expect(out.x).toBeCloseTo(0.1, 10);
        expect(out.y).toBeCloseTo(0.9, 10);
    });
});

describe('roomLayout — undo stack', () => {
    const names = ['Macro', 'Risk'];

    it('starts empty', () => {
        expect(undoDepth()).toBe(0);
    });

    it('pushUndo + popUndo round-trips an entry', () => {
        pushUndo({ seatName: 'Macro', previous: null, next: { x: 0.5, y: 0.5 } });
        expect(undoDepth()).toBe(1);
        const popped = popUndo();
        expect(popped?.seatName).toBe('Macro');
        expect(popped?.next).toEqual({ x: 0.5, y: 0.5 });
        expect(undoDepth()).toBe(0);
    });

    it('popUndo returns null on empty', () => {
        expect(popUndo()).toBeNull();
    });

    it('clearUndoStack wipes everything', () => {
        pushUndo({ seatName: 'A', previous: null, next: { x: 0, y: 0 } });
        pushUndo({ seatName: 'B', previous: null, next: { x: 0, y: 0 } });
        expect(undoDepth()).toBe(2);
        clearUndoStack();
        expect(undoDepth()).toBe(0);
    });

    it('integrates with the persistence layer — undo restores the previous position', () => {
        // Drag 1: from default (null) to (0.5, 0.5).
        pushUndo({ seatName: 'Macro', previous: null, next: { x: 0.5, y: 0.5 } });
        setSeatPosition(names, 'Macro', { x: 0.5, y: 0.5 });
        // Drag 2: from (0.5, 0.5) to (0.7, 0.7).
        pushUndo({ seatName: 'Macro', previous: { x: 0.5, y: 0.5 }, next: { x: 0.7, y: 0.7 } });
        setSeatPosition(names, 'Macro', { x: 0.7, y: 0.7 });
        // Undo: should land back on (0.5, 0.5).
        const entry1 = popUndo();
        expect(entry1?.seatName).toBe('Macro');
        expect(entry1?.previous).toEqual({ x: 0.5, y: 0.5 });
        if (entry1?.previous) setSeatPosition(names, entry1.seatName, entry1.previous);
        expect(getRoomLayout(names).Macro).toEqual({ x: 0.5, y: 0.5 });
        // Undo again: previous was null (the default), so we clear.
        const entry2 = popUndo();
        expect(entry2?.previous).toBeNull();
        if (entry2) clearSeatPosition(names, entry2.seatName);
        expect(getRoomLayout(names).Macro).toBeUndefined();
    });
});
