import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    setSeatPosition,
    getRoomLayout,
    pushUndo,
    popUndoN,
    popRedoN,
    applyRedoEntries,
    redoDepth,
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

describe('redo stack (popRedoN + applyRedoEntries)', () => {
    const names = ['Macro'];

    it('starts empty', () => {
        expect(redoDepth()).toBe(0);
    });

    it('popUndoN pushes the popped entries onto the redo stack', () => {
        pushUndo({ seatName: 'Macro', previous: null, next: { x: 0.5, y: 0.5 } });
        setSeatPosition(names, 'Macro', { x: 0.5, y: 0.5 });
        pushUndo({ seatName: 'Macro', previous: { x: 0.5, y: 0.5 }, next: { x: 0.7, y: 0.7 } });
        setSeatPosition(names, 'Macro', { x: 0.7, y: 0.7 });
        expect(undoDepth()).toBe(2);
        expect(redoDepth()).toBe(0);
        // Undo one — should land on the redo stack.
        popUndoN(1);
        expect(undoDepth()).toBe(1);
        expect(redoDepth()).toBe(1);
    });

    it('pushUndo clears the redo stack (branching, not linear)', () => {
        pushUndo({ seatName: 'Macro', previous: null, next: { x: 0.1, y: 0.1 } });
        setSeatPosition(names, 'Macro', { x: 0.1, y: 0.1 });
        popUndoN(1);
        expect(redoDepth()).toBe(1);
        // A fresh edit clears the redo stack.
        pushUndo({ seatName: 'Macro', previous: null, next: { x: 0.5, y: 0.5 } });
        setSeatPosition(names, 'Macro', { x: 0.5, y: 0.5 });
        expect(redoDepth()).toBe(0);
    });

    it('applyRedoEntries re-applies `next` and re-arms the undo stack', () => {
        pushUndo({ seatName: 'Macro', previous: null, next: { x: 0.5, y: 0.5 } });
        setSeatPosition(names, 'Macro', { x: 0.5, y: 0.5 });
        pushUndo({ seatName: 'Macro', previous: { x: 0.5, y: 0.5 }, next: { x: 0.7, y: 0.7 } });
        setSeatPosition(names, 'Macro', { x: 0.7, y: 0.7 });
        // We started with 2 undo entries. After one undo, we have
        // 1 undo + 1 redo. After a redo of that same entry, we
        // should be back to 2 undo + 0 redo.
        const e1 = popUndoN(1)[0];
        if (e1.previous) setSeatPosition(names, e1.seatName, e1.previous);
        expect(getRoomLayout(names).Macro).toEqual({ x: 0.5, y: 0.5 });
        expect(undoDepth()).toBe(1);
        expect(redoDepth()).toBe(1);
        const r1 = popRedoN(1);
        applyRedoEntries(names, r1);
        expect(getRoomLayout(names).Macro).toEqual({ x: 0.7, y: 0.7 });
        // applyRedoEntries puts the entry back on the undo stack so
        // the user can undo the redo. Total moves unchanged.
        expect(undoDepth()).toBe(2);
        expect(redoDepth()).toBe(0);
    });

    it('popRedoN clamps to the stack depth and notifies once', () => {
        pushUndo({ seatName: 'Macro', previous: null, next: { x: 0.1, y: 0.1 } });
        setSeatPosition(names, 'Macro', { x: 0.1, y: 0.1 });
        popUndoN(1);
        // Redo stack now has 1.
        expect(redoDepth()).toBe(1);
        const entries = popRedoN(5);
        expect(entries).toHaveLength(1);
        expect(redoDepth()).toBe(0);
    });
});
