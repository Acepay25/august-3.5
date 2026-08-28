import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';

import { DeskScene } from '../components/desk/DeskScene';
import type { DebateStageActor } from '../components/analysis/DebateStage';
import { clearUndoStack, pushUndo, undoDepth } from '../services/desk/roomLayout';

beforeAll(() => {
    if (typeof window !== 'undefined' && !window.matchMedia) {
        window.matchMedia = ((query: string) => ({
            matches: false, media: query, onchange: null,
            addListener: vi.fn(), removeListener: vi.fn(),
            addEventListener: vi.fn(), removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
        })) as any;
    }
});

afterEach(() => {
    cleanup();
    if (typeof window !== 'undefined') window.localStorage.clear();
    window.localStorage.setItem('last_active_user', 'default');
    clearUndoStack();
});

const actor = (over: Partial<DebateStageActor>): DebateStageActor => ({
    id: 'macro', name: 'Macro', ...over,
});

describe('DeskScene — Undo/Redo popover', () => {
    it('right-click on the Undo button toggles the popover open (when entries exist)', () => {
        // Seed an undo entry so the button is enabled.
        pushUndo({ seatName: 'Macro', previous: null, next: { x: 0.5, y: 0.5 } });
        expect(undoDepth()).toBe(1);
        render(<DeskScene actors={[actor({})]} onClose={() => {}} />);
        fireEvent.click(screen.getByTestId('desk-edit-room'));
        const undo = screen.getByTestId('desk-undo-drag');
        // Popover is hidden initially.
        expect(screen.queryByTestId('desk-undo-drag-popover')).toBeNull();
        // Right-click (contextmenu) toggles the popover open.
        fireEvent.contextMenu(undo);
        expect(screen.getByTestId('desk-undo-drag-popover')).toBeTruthy();
    });

    it('the popover auto-closes when the user clicks outside', () => {
        pushUndo({ seatName: 'Macro', previous: null, next: { x: 0.5, y: 0.5 } });
        render(<DeskScene actors={[actor({})]} onClose={() => {}} />);
        fireEvent.click(screen.getByTestId('desk-edit-room'));
        const undo = screen.getByTestId('desk-undo-drag');
        fireEvent.contextMenu(undo);
        expect(screen.getByTestId('desk-undo-drag-popover')).toBeTruthy();
        // mousedown on the document (outside the popover) closes it.
        act(() => {
            document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        });
        expect(screen.queryByTestId('desk-undo-drag-popover')).toBeNull();
    });

    it('the popover does NOT render when the stack is empty', () => {
        render(<DeskScene actors={[actor({})]} onClose={() => {}} />);
        fireEvent.click(screen.getByTestId('desk-edit-room'));
        const undo = screen.getByTestId('desk-undo-drag');
        fireEvent.contextMenu(undo);
        // No entries → popover stays closed.
        expect(screen.queryByTestId('desk-undo-drag-popover')).toBeNull();
    });
});
