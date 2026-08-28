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

describe('DeskScene — tactile pulse on drop', () => {
    it('the is-dragging class is added while the seat is being held', () => {
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
            // The seat should carry the is-dragging class so the CSS
            // can hint the browser to allocate a transform layer.
            expect(seat.className).toContain('is-dragging');
        } finally {
            rafSpy.mockRestore();
        }
    });

    it('the desk-tactile-pulse class is added momentarily on drop and clears after 200ms', () => {
        vi.useFakeTimers();
        const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
            cb(0);
            return 0;
        });
        try {
            render(<DeskScene actors={[actor({})]} onClose={() => {}} />);
            fireEvent.click(screen.getByTestId('desk-edit-room'));
            const seat = screen.getByTestId('seat-macro');
            // Pointerdown + pointermove + pointerup sequence. We need
            // a real move event with clientX/Y to update the dragPos
            // map so the pointerup actually saves a position.
            const floor = screen.getByTestId('desk-floor');
            const floorRect = floor.getBoundingClientRect();
            act(() => {
                fireEvent.pointerDown(seat, { pointerId: 1 });
            });
            act(() => {
                fireEvent.pointerMove(floor, {
                    pointerId: 1,
                    clientX: floorRect.left + floorRect.width * 0.4,
                    clientY: floorRect.top + floorRect.height * 0.4,
                });
            });
            act(() => {
                fireEvent.pointerUp(floor, { pointerId: 1 });
            });
            // Right after the drop, the seat should have the pulse class.
            expect(seat.className).toContain('desk-tactile-pulse');
            // Advance past the 200ms timer.
            act(() => { vi.advanceTimersByTime(250); });
            expect(seat.className).not.toContain('desk-tactile-pulse');
        } finally {
            vi.useRealTimers();
            rafSpy.mockRestore();
        }
    });
});
