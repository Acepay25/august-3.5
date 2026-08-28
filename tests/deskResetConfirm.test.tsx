import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';

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
    vi.useRealTimers();
});

const actor = (over: Partial<DebateStageActor>): DebateStageActor => ({
    id: 'macro', name: 'Macro', ...over,
});

describe('DeskScene — Reset two-click confirm', () => {
    it('first click arms the button without resetting', () => {
        const names = ['macro'];
        setSeatPosition(names, 'macro', { x: 0.5, y: 0.5 });
        render(<DeskScene actors={[actor({})]} onClose={() => {}} />);
        fireEvent.click(screen.getByTestId('desk-edit-room'));
        const reset = screen.getByTestId('desk-reset-layout');
        // Initial label.
        expect(reset.textContent).toBe('Reset');
        expect(reset.getAttribute('data-armed')).toBe('0');
        // First click arms.
        fireEvent.click(reset);
        expect(reset.textContent).toBe('Click again…');
        expect(reset.getAttribute('data-armed')).toBe('1');
        // Layout NOT yet wiped.
        expect(getRoomLayout(names).macro).toBeTruthy();
    });

    it('second click within 1.5s confirms and resets', () => {
        const names = ['macro'];
        setSeatPosition(names, 'macro', { x: 0.5, y: 0.5 });
        render(<DeskScene actors={[actor({})]} onClose={() => {}} />);
        fireEvent.click(screen.getByTestId('desk-edit-room'));
        const reset = screen.getByTestId('desk-reset-layout');
        fireEvent.click(reset);
        // Click again to confirm.
        fireEvent.click(reset);
        expect(getRoomLayout(names).macro).toBeUndefined();
    });

    it('the armed state expires after 1.5s without a second click', () => {
        vi.useFakeTimers();
        const names = ['macro'];
        setSeatPosition(names, 'macro', { x: 0.5, y: 0.5 });
        render(<DeskScene actors={[actor({})]} onClose={() => {}} />);
        fireEvent.click(screen.getByTestId('desk-edit-room'));
        const reset = screen.getByTestId('desk-reset-layout');
        // Arm.
        fireEvent.click(reset);
        expect(reset.getAttribute('data-armed')).toBe('1');
        // Advance past the 1.5s timer.
        act(() => { vi.advanceTimersByTime(1600); });
        // Disarmed without a second click.
        expect(reset.getAttribute('data-armed')).toBe('0');
        // Layout NOT wiped.
        expect(getRoomLayout(names).macro).toBeTruthy();
    });

    it('the reset button does NOT render when editRoom is off', () => {
        render(<DeskScene actors={[actor({})]} onClose={() => {}} />);
        expect(screen.queryByTestId('desk-reset-layout')).toBeNull();
    });
});
