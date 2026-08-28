import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';

import { DeskScene } from '../components/desk/DeskScene';
import type { DebateStageActor } from '../components/analysis/DebateStage';

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
});

const actor = (over: Partial<DebateStageActor>): DebateStageActor => ({
    id: 'macro', name: 'Macro', ...over,
});

describe('DeskScene — touch drag preview (rAF bump on pointerdown)', () => {
    it('schedules a requestAnimationFrame on pointerdown to lift the seat', () => {
        const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
            // Invoke the callback synchronously so setDragTick fires
            // inside the same tick — the test sees the lift state
            // without waiting for the next frame.
            cb(0);
            return 0;
        });
        try {
            render(<DeskScene actors={[actor({})]} onClose={() => {}} />);
            fireEvent.click(screen.getByTestId('desk-edit-room'));
            const seat = screen.getByTestId('seat-macro');
            act(() => {
                fireEvent.pointerDown(seat, { pointerId: 1 });
            });
            expect(rafSpy).toHaveBeenCalled();
        } finally {
            rafSpy.mockRestore();
        }
    });

    it('after pointerdown, the seat carries the lift classes (scale + ring)', () => {
        const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
            cb(0);
            return 0;
        });
        try {
            render(<DeskScene actors={[actor({})]} onClose={() => {}} />);
            fireEvent.click(screen.getByTestId('desk-edit-room'));
            const seat = screen.getByTestId('seat-macro');
            act(() => {
                fireEvent.pointerDown(seat, { pointerId: 1 });
            });
            // The rAF callback bumped dragTick, which forces a re-render.
            // The seat should now have the lift classes.
            expect(seat.className).toContain('scale-110');
            expect(seat.className).toContain('ring-2');
            expect(seat.className).toContain('cursor-grabbing');
        } finally {
            rafSpy.mockRestore();
        }
    });
});
