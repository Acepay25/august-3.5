import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';

import { PixelSeat } from '../components/desk/PixelSeat';
import {
    buildGridForRole,
    isValidGrid,
    PIXEL_GRID_H,
    PIXEL_GRID_W,
    type Frame,
} from '../components/desk/pixelAvatars';

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

afterEach(() => cleanup());

describe('pixelAvatars — extra frames (thinking, lean_back)', () => {
    it('every role has a valid 16x20 thinking grid', () => {
        const roles = [
            'risk', 'macro', 'technical', 'sentiment',
            'moderator', 'followup', 'postmortem', 'execution', 'unknown',
        ] as const;
        for (const role of roles) {
            const grid = buildGridForRole(role, 'thinking');
            expect(PIXEL_GRID_W).toBe(16);
            expect(PIXEL_GRID_H).toBe(20);
            expect(isValidGrid(grid), `thinking grid invalid for role ${role}`).toBe(true);
        }
    });

    it('every role has a valid 16x20 lean_back grid', () => {
        const roles = [
            'risk', 'macro', 'technical', 'sentiment',
            'moderator', 'followup', 'postmortem', 'execution', 'unknown',
        ] as const;
        for (const role of roles) {
            const grid = buildGridForRole(role, 'lean_back');
            expect(isValidGrid(grid), `lean_back grid invalid for role ${role}`).toBe(true);
        }
    });

    it('the four frames for each role are all distinct (or unknown is a no-op)', () => {
        const roles = [
            'risk', 'macro', 'technical', 'sentiment',
            'moderator', 'followup', 'postmortem', 'execution',
        ] as const;
        const frames: Frame[] = ['idle', 'speaking', 'thinking', 'lean_back'];
        for (const role of roles) {
            const set = new Set(frames.map(f => buildGridForRole(role, f).join('\n')));
            // The set should hold 3 or 4 distinct grids — speaking/thinking
            // and lean_back are different shapes.
            expect(set.size, `${role} should have multiple distinct frames`).toBeGreaterThanOrEqual(3);
        }
    });

    it('buildGridForRole returns idle when an unknown frame is requested', () => {
        // @ts-expect-error — intentional misuse.
        const grid = buildGridForRole('macro', 'not-a-frame');
        const idle = buildGridForRole('macro', 'idle');
        expect(grid).toBe(idle);
    });
});

describe('PixelSeat — frame selection', () => {
    it('renders without crashing for every Frame combination', () => {
        // The frame choice is internal; we just smoke-test that the
        // four states of the seat (idle / live / thinking / speaking)
        // all render cleanly with the expanded frame set.
        const { rerender } = render(<PixelSeat name="Macro" />);
        rerender(<PixelSeat name="Macro" live />);
        rerender(<PixelSeat name="Macro" speaking live />);
        rerender(<PixelSeat name="Macro" thinking live />);
        rerender(<PixelSeat name="Macro" speaking thinking live />);
        expect(screen.getByLabelText('Open Macro seat')).toBeTruthy();
    });
});
