import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    snapToGrid,
    setSeatPosition,
    getRoomLayout,
    clearSeatPosition,
    pushUndo,
    popUndo,
    popUndoN,
    applyUndoEntries,
    undoDepth,
    clearUndoStack,
    subscribeUndo,
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

describe('multi-level undo (popUndoN)', () => {
    const names = ['Macro', 'Risk'];

    it('pops the most recent N entries (LIFO order)', () => {
        // Three sequential drags.
        pushUndo({ seatName: 'Macro', previous: null, next: { x: 0.1, y: 0.1 } });
        pushUndo({ seatName: 'Macro', previous: { x: 0.1, y: 0.1 }, next: { x: 0.2, y: 0.2 } });
        pushUndo({ seatName: 'Risk', previous: null, next: { x: 0.3, y: 0.3 } });
        expect(undoDepth()).toBe(3);
        const popped = popUndoN(2);
        expect(popped).toHaveLength(2);
        // The most recent is Risk, then Macro (0.2, 0.2).
        expect(popped[0].seatName).toBe('Risk');
        expect(popped[1].seatName).toBe('Macro');
        expect(popped[1].next).toEqual({ x: 0.2, y: 0.2 });
        expect(undoDepth()).toBe(1);
    });

    it('clamps to the stack depth (asking for 5 with only 2 returns 2)', () => {
        pushUndo({ seatName: 'Macro', previous: null, next: { x: 0.1, y: 0.1 } });
        pushUndo({ seatName: 'Risk', previous: null, next: { x: 0.2, y: 0.2 } });
        const popped = popUndoN(5);
        expect(popped).toHaveLength(2);
        expect(undoDepth()).toBe(0);
    });

    it('asking for 0 returns an empty array and is a no-op', () => {
        pushUndo({ seatName: 'Macro', previous: null, next: { x: 0.1, y: 0.1 } });
        const popped = popUndoN(0);
        expect(popped).toEqual([]);
        expect(undoDepth()).toBe(1);
    });

    it('negative N also returns empty', () => {
        pushUndo({ seatName: 'Macro', previous: null, next: { x: 0.1, y: 0.1 } });
        const popped = popUndoN(-1);
        expect(popped).toEqual([]);
        expect(undoDepth()).toBe(1);
    });

    it('notifies subscribers once per popUndoN call (not per entry)', () => {
        const cb = vi.fn();
        const unsubscribe = subscribeUndo(cb);
        pushUndo({ seatName: 'A', previous: null, next: { x: 0, y: 0 } });
        pushUndo({ seatName: 'B', previous: null, next: { x: 0, y: 0 } });
        cb.mockClear();
        popUndoN(2);
        expect(cb).toHaveBeenCalledTimes(1);
        unsubscribe();
    });

    it('applyUndoEntries restores positions in LIFO order', () => {
        // Save initial state: Macro at default, Risk at (0.9, 0.9).
        setSeatPosition(names, 'Risk', { x: 0.9, y: 0.9 });
        // Drag Macro: null -> (0.1, 0.1).
        pushUndo({ seatName: 'Macro', previous: null, next: { x: 0.1, y: 0.1 } });
        setSeatPosition(names, 'Macro', { x: 0.1, y: 0.1 });
        // Drag Risk: (0.9, 0.9) -> (0.2, 0.2).
        pushUndo({ seatName: 'Risk', previous: { x: 0.9, y: 0.9 }, next: { x: 0.2, y: 0.2 } });
        setSeatPosition(names, 'Risk', { x: 0.2, y: 0.2 });
        // Undo both — should restore Macro to default (null) and Risk to (0.9, 0.9).
        const entries = popUndoN(2);
        // applyUndoEntries walks LIFO order. The most-recent is Risk.
        applyUndoEntries(names, entries);
        expect(getRoomLayout(names).Risk).toEqual({ x: 0.9, y: 0.9 });
        expect(getRoomLayout(names).Macro).toBeUndefined();
    });
});
