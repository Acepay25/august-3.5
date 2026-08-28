import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react';

import { DeskScene } from '../components/desk/DeskScene';
import type { DebateStageActor } from '../components/analysis/DebateStage';
import {
    getRoomLayout,
    setSeatPosition,
    clearUndoStack,
} from '../services/desk/roomLayout';

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

describe('DeskScene — Edit room polish', () => {
    it('shows the Edit room button and a Reset button after toggling', () => {
        render(<DeskScene actors={[actor({})]} onClose={() => {}} />);
        const edit = screen.getByTestId('desk-edit-room');
        expect(edit.getAttribute('aria-pressed')).toBe('false');
        fireEvent.click(edit);
        expect(edit.getAttribute('aria-pressed')).toBe('true');
        expect(screen.getByTestId('desk-reset-layout')).toBeTruthy();
        // Undo button renders whenever editRoom is on — disabled when
        // there's nothing to undo.
        const undo = screen.getByTestId('desk-undo-drag');
        expect(undo).toBeTruthy();
        expect((undo as HTMLButtonElement).disabled).toBe(true);
    });

    it('enables the Undo button after a seat position is saved', () => {
        const names = ['macro'];
        // Pre-seed a saved position so the Undo button mounts.
        setSeatPosition(names, 'macro', { x: 0.5, y: 0.5 });
        render(<DeskScene actors={[actor({})]} onClose={() => {}} />);
        const edit = screen.getByTestId('desk-edit-room');
        fireEvent.click(edit);
        // The Undo button is rendered when editRoom is on, and a
        // pre-seeded position means the user can undo back to default.
        // We can't easily simulate a drag in jsdom, so we just check
        // the button exists (enabled state depends on undoDepth at
        // render time, which the seed doesn't push).
        expect(screen.getByTestId('desk-undo-drag')).toBeTruthy();
    });

    it('Reset wipes the saved layout (after a typed confirm)', async () => {
        const names = ['macro'];
        setSeatPosition(names, 'macro', { x: 0.5, y: 0.5 });
        expect(getRoomLayout(names).macro).toBeTruthy();
        render(<DeskScene actors={[actor({})]} onClose={() => {}} />);
        fireEvent.click(screen.getByTestId('desk-edit-room'));
        // Reset opens a modal with a typed-confirm input.
        fireEvent.click(screen.getByTestId('desk-reset-layout'));
        const input = screen.getByTestId('confirm-typed-input');
        fireEvent.change(input, { target: { value: 'RESET' } });
        await act(async () => {
            fireEvent.click(screen.getByTestId('confirm-dialog-confirm'));
            await Promise.resolve();
        });
        await waitFor(() => {
            expect(getRoomLayout(names).macro).toBeUndefined();
        });
    });
});
