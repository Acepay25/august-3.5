import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    peekUndo,
    peekRedo,
    pushUndo,
    popUndoN,
    popRedoN,
    undoDepth,
    redoDepth,
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

describe('peekUndo / peekRedo', () => {
    const names = ['Macro'];

    it('peekUndo returns the most recent N entries newest-first WITHOUT mutating the stack', () => {
        pushUndo({ seatName: 'A', previous: null, next: { x: 0.1, y: 0.1 } });
        pushUndo({ seatName: 'B', previous: null, next: { x: 0.2, y: 0.2 } });
        pushUndo({ seatName: 'C', previous: null, next: { x: 0.3, y: 0.3 } });
        const top3 = peekUndo(3);
        expect(top3.map(e => e.seatName)).toEqual(['C', 'B', 'A']);
        // Undo stack is unchanged.
        expect(undoDepth()).toBe(3);
    });

    it('peekUndo(0) and negative N return []', () => {
        pushUndo({ seatName: 'A', previous: null, next: { x: 0.1, y: 0.1 } });
        expect(peekUndo(0)).toEqual([]);
        expect(peekUndo(-2)).toEqual([]);
    });

    it('peekUndo(N) caps at the stack depth', () => {
        pushUndo({ seatName: 'A', previous: null, next: { x: 0.1, y: 0.1 } });
        const out = peekUndo(10);
        expect(out).toHaveLength(1);
    });

    it('peekRedo mirrors peekUndo but for the redo stack', () => {
        pushUndo({ seatName: 'A', previous: null, next: { x: 0.1, y: 0.1 } });
        popUndoN(1);
        expect(redoDepth()).toBe(1);
        // Note: the second pushUndo CLEARS the redo stack (branching
        // history), so we can't chain undos. Instead, pop one entry,
        // then peek.
        const top = peekRedo(1);
        expect(top.map(e => e.seatName)).toEqual(['A']);
        expect(redoDepth()).toBe(1); // peek did not mutate
    });
});
