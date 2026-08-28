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

describe('DeskScene — Reset typed-confirm modal', () => {
    it('clicking Reset opens a modal with a typed-confirm input', () => {
        render(<DeskScene actors={[actor({})]} onClose={() => {}} />);
        fireEvent.click(screen.getByTestId('desk-edit-room'));
        fireEvent.click(screen.getByTestId('desk-reset-layout'));
        // The modal renders the typed input. Default hint is the
        // typedConfirm value.
        const input = screen.getByTestId('confirm-typed-input');
        expect(input).toBeTruthy();
        expect(input.getAttribute('placeholder')).toBe('RESET');
        // The confirm button is disabled until the input matches.
        const confirmBtn = screen.getByTestId('confirm-dialog-confirm');
        expect((confirmBtn as HTMLButtonElement).disabled).toBe(true);
    });

    it('the confirm button stays disabled while the typed input is wrong', () => {
        render(<DeskScene actors={[actor({})]} onClose={() => {}} />);
        fireEvent.click(screen.getByTestId('desk-edit-room'));
        fireEvent.click(screen.getByTestId('desk-reset-layout'));
        const input = screen.getByTestId('confirm-typed-input');
        const confirmBtn = screen.getByTestId('confirm-dialog-confirm');
        fireEvent.change(input, { target: { value: 'reset' } });
        expect((confirmBtn as HTMLButtonElement).disabled).toBe(true);
    });

    it('typing the correct string enables the confirm button and resets on click', async () => {
        const names = ['macro'];
        setSeatPosition(names, 'macro', { x: 0.5, y: 0.5 });
        expect(getRoomLayout(names).macro).toBeTruthy();
        render(<DeskScene actors={[actor({})]} onClose={() => {}} />);
        fireEvent.click(screen.getByTestId('desk-edit-room'));
        fireEvent.click(screen.getByTestId('desk-reset-layout'));
        const input = screen.getByTestId('confirm-typed-input');
        const confirmBtn = screen.getByTestId('confirm-dialog-confirm');
        fireEvent.change(input, { target: { value: 'RESET' } });
        expect((confirmBtn as HTMLButtonElement).disabled).toBe(false);
        await act(async () => {
            fireEvent.click(confirmBtn);
            // Let the promise microtask run.
            await Promise.resolve();
        });
        // Layout wiped.
        await waitFor(() => {
            expect(getRoomLayout(names).macro).toBeUndefined();
        });
    });

    it('the reset button does NOT render when editRoom is off', () => {
        render(<DeskScene actors={[actor({})]} onClose={() => {}} />);
        expect(screen.queryByTestId('desk-reset-layout')).toBeNull();
    });
});
