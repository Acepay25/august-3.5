import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';

import { PixelSeat } from '../components/desk/PixelSeat';

afterEach(() => cleanup());

describe('PixelSeat motion classes', () => {
    it('applies is-speaking when speaking is true', () => {
        render(<PixelSeat name="Macro" speaking live={false} thinking={false} />);
        const seat = screen.getByLabelText('Open Macro seat');
        expect(seat.className).toContain('is-speaking');
        expect(seat.className).not.toContain('is-thinking');
        expect(seat.className).not.toContain('is-live');
    });

    it('applies is-thinking when thinking is true', () => {
        render(<PixelSeat name="Macro" speaking={false} live thinking={false} />);
        const seat = screen.getByLabelText('Open Macro seat');
        expect(seat.className).toContain('is-live');
    });

    it('applies is-thinking (not is-live) when thinking is true and live is false', () => {
        render(<PixelSeat name="Macro" speaking={false} live={false} thinking />);
        const seat = screen.getByLabelText('Open Macro seat');
        expect(seat.className).toContain('is-thinking');
        expect(seat.className).not.toContain('is-live');
    });

    it('renders the monitor-flicker overlay when thinking', () => {
        const { container } = render(
            <PixelSeat name="Macro" speaking={false} live={false} thinking />
        );
        const overlay = container.querySelector('.seat-monitor-overlay');
        expect(overlay).toBeTruthy();
    });

    it('does NOT render the monitor-flicker overlay when speaking', () => {
        const { container } = render(<PixelSeat name="Macro" speaking live={false} thinking={false} />);
        const overlay = container.querySelector('.seat-monitor-overlay');
        expect(overlay).toBeNull();
    });

    it('does NOT render the monitor-flicker overlay when idle', () => {
        const { container } = render(<PixelSeat name="Macro" />);
        const overlay = container.querySelector('.seat-monitor-overlay');
        expect(overlay).toBeNull();
    });

    it('sets --avatar-cell-h to the pixelSize (default 5)', () => {
        const { container } = render(<PixelSeat name="Macro" />);
        const pixelArt = container.querySelector('.pixelArt') as HTMLElement;
        expect(pixelArt).toBeTruthy();
        expect(pixelArt.style.getPropertyValue('--avatar-cell-h')).toBe('5px');
    });

    it('respects a custom pixelSize for the cell-size variable', () => {
        const { container } = render(<PixelSeat name="Macro" pixelSize={8} />);
        const pixelArt = container.querySelector('.pixelArt') as HTMLElement;
        expect(pixelArt.style.getPropertyValue('--avatar-cell-h')).toBe('8px');
    });
});
