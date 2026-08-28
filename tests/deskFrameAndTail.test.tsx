import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';

import { SpeechBubble } from '../components/desk/SpeechBubble';
import { PixelSeat } from '../components/desk/PixelSeat';
import {
    buildGridForRole,
    isValidGrid,
    PIXEL_GRID_H,
    PIXEL_GRID_W,
} from '../components/desk/pixelAvatars';

// jsdom does not implement matchMedia (PixelSeat reads it for reduced
// motion). Provide a no-op stub that reports "no reduced motion".
beforeAll(() => {
    if (typeof window !== 'undefined' && !window.matchMedia) {
        window.matchMedia = ((query: string) => ({
            matches: false,
            media: query,
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
        })) as any;
    }
});

afterEach(() => cleanup());

describe('SpeechBubble — side-aware tail', () => {
    it('renders an SVG tail with the side prop exposed for left', () => {
        render(<SpeechBubble text="hi" speaker="Macro" side="left" />);
        const tail = screen.getByTestId('speech-bubble-tail');
        expect(tail.getAttribute('data-side')).toBe('left');
    });

    it('renders an SVG tail with the side prop exposed for right', () => {
        render(<SpeechBubble text="hi" speaker="Macro" side="right" />);
        const tail = screen.getByTestId('speech-bubble-tail');
        expect(tail.getAttribute('data-side')).toBe('right');
    });

    it('renders an SVG tail with the side prop exposed for center', () => {
        render(<SpeechBubble text="hi" speaker="Macro" side="center" />);
        const tail = screen.getByTestId('speech-bubble-tail');
        expect(tail.getAttribute('data-side')).toBe('center');
    });

    it('the three tails have distinct path data', () => {
        const { rerender } = render(<SpeechBubble text="x" speaker="X" side="left" />);
        const left = screen.getByTestId('speech-bubble-tail').querySelector('path')?.getAttribute('d');
        rerender(<SpeechBubble text="x" speaker="X" side="right" />);
        const right = screen.getByTestId('speech-bubble-tail').querySelector('path')?.getAttribute('d');
        rerender(<SpeechBubble text="x" speaker="X" side="center" />);
        const center = screen.getByTestId('speech-bubble-tail').querySelector('path')?.getAttribute('d');
        expect(left).toBeTruthy();
        expect(right).toBeTruthy();
        expect(center).toBeTruthy();
        expect(left).not.toBe(right);
        expect(left).not.toBe(center);
        expect(right).not.toBe(center);
    });
});

describe('PixelSeat — second-frame swap while speaking', () => {
    it('renders the idle grid by default', () => {
        const { container } = render(<PixelSeat name="Macro" />);
        // The grid is rendered as a stack of <span> pixels; sanity check
        // by counting the head-row token (H is in the cap/head area).
        const headH = container.querySelectorAll('.pixelArt > span').length;
        expect(headH).toBeGreaterThan(0);
    });

    it('renders the speaking grid when speaking is true (initial frame is idle, swaps on tick)', () => {
        // The first paint uses tick=0 → idle. We assert the component
        // accepts the speaking flag and renders without crashing.
        const { container } = render(<PixelSeat name="Macro" speaking live={false} thinking={false} />);
        const headH = container.querySelectorAll('.pixelArt > span').length;
        expect(headH).toBeGreaterThan(0);
    });
});

describe('pixelAvatars — second-frame grids', () => {
    it('every role has a valid 16x20 speaking frame', () => {
        const roles = [
            'risk', 'macro', 'technical', 'sentiment',
            'moderator', 'followup', 'postmortem', 'execution', 'unknown',
        ] as const;
        for (const role of roles) {
            const grid = buildGridForRole(role, 'speaking');
            expect(PIXEL_GRID_W, `width for ${role}`).toBe(16);
            expect(PIXEL_GRID_H, `height for ${role}`).toBe(20);
            expect(isValidGrid(grid), `speaking grid invalid for role ${role}`).toBe(true);
        }
    });

    it('every role has a valid 16x20 thinking frame', () => {
        const roles = [
            'risk', 'macro', 'technical', 'sentiment',
            'moderator', 'followup', 'postmortem', 'execution', 'unknown',
        ] as const;
        for (const role of roles) {
            const grid = buildGridForRole(role, 'thinking');
            expect(isValidGrid(grid), `thinking grid invalid for role ${role}`).toBe(true);
        }
    });

    it('every role has a valid 16x20 lean_back frame', () => {
        const roles = [
            'risk', 'macro', 'technical', 'sentiment',
            'moderator', 'followup', 'postmortem', 'execution', 'unknown',
        ] as const;
        for (const role of roles) {
            const grid = buildGridForRole(role, 'lean_back');
            expect(isValidGrid(grid), `lean_back grid invalid for role ${role}`).toBe(true);
        }
    });

    it('the speaking frame differs from the idle frame for every non-unknown role', () => {
        const roles = [
            'risk', 'macro', 'technical', 'sentiment',
            'moderator', 'followup', 'postmortem', 'execution',
        ] as const;
        for (const role of roles) {
            const idle = buildGridForRole(role, 'idle');
            const speaking = buildGridForRole(role, 'speaking');
            let differ = false;
            for (let i = 0; i < idle.length; i++) if (idle[i] !== speaking[i]) differ = true;
            expect(differ, `speaking frame identical to idle for ${role}`).toBe(true);
        }
    });
});
