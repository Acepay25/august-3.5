/**
 * Directional surface transitions for the Chat ⇄ Chart AI hop.
 *
 * These exist as CSS keyframes rather than `Element.animate()` on purpose:
 * the global `prefers-reduced-motion` block in index.css zeroes every
 * animation, so the OS setting wins with no JS check. The surface FLIP
 * (`useSurfaceMorph`) is WAAPI and therefore has to poll matchMedia by hand —
 * this path deliberately does not inherit that obligation.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { useSurfaceEnter } from '../hooks/useSurfaceEnter';

const css = readFileSync(resolve(__dirname, '../index.css'), 'utf8');

describe('surface enter keyframes', () => {
    it('declares both directions', () => {
        expect(css).toMatch(/@keyframes\s+surfaceEnterFromRight/);
        expect(css).toMatch(/@keyframes\s+surfaceEnterFromLeft/);
        expect(css).toMatch(/\.surface-enter-right\s*\{[^}]*surfaceEnterFromRight/);
        expect(css).toMatch(/\.surface-enter-left\s*\{[^}]*surfaceEnterFromLeft/);
    });

    it('moves in OPPOSITE directions, and both fade in', () => {
        const right = css.match(/@keyframes\s+surfaceEnterFromRight\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
        const left = css.match(/@keyframes\s+surfaceEnterFromLeft\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
        // Chat → Chart AI arrives from the right; Chart AI → Chat from the left.
        expect(right).toMatch(/translateX\(28px\)/);
        expect(left).toMatch(/translateX\(-28px\)/);
        // Both start transparent and land opaque, so the hop reads as a fade.
        expect(right).toMatch(/opacity:\s*0/);
        expect(right).toMatch(/opacity:\s*1/);
        expect(left).toMatch(/opacity:\s*0/);
        expect(left).toMatch(/opacity:\s*1/);
    });

    it('is covered by the global reduced-motion kill switch', () => {
        // There are SEVERAL `prefers-reduced-motion` blocks in this file — the
        // component-specific ones (`.chat-fade-in`, the streaming caret) come
        // first. Only the blanket one matters here, and source order is
        // irrelevant: its `animation-duration: 0.01ms !important` beats the
        // animation shorthand's non-important duration wherever it appears.
        // What matters is that it is BLANKET, so a new animation cannot opt out.
        // `String.match` without /g returns only the FIRST block, which here is
        // the component-specific `.chat-fade-in` one — so iterate all of them
        // and pick the blanket guard.
        const blocks = [...css.matchAll(
            /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\n\}/g,
        )].map(m => m[0]);
        const blanket = blocks.find(m => /\*,\s*\*::before/.test(m) && /animation-duration/.test(m));
        expect(blanket, 'no blanket reduced-motion guard found in index.css').toBeTruthy();
        expect(blanket).toMatch(/animation-duration:\s*0\.01ms\s*!important/);
        expect(blanket).toMatch(/transition-duration:\s*0\.01ms\s*!important/);
        // `*` plus its pseudo-element twins, rather than a named class.
        expect(blanket).toMatch(/\*,\s*\*::before,\s*\*::after/);
    });
});

describe('useSurfaceEnter', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    const Probe: React.FC<{ direction?: 'left' | 'right' | null }> = ({ direction }) => (
        <div data-testid="probe" className={useSurfaceEnter(direction)} />
    );

    it('applies the right class for the direction it was given', () => {
        render(<Probe direction="right" />);
        expect(screen.getByTestId('probe').className).toBe('surface-enter-right');
        render(<Probe direction="left" />);
        const both = screen.getAllByTestId('probe');
        expect(both[1].className).toBe('surface-enter-left');
    });

    it('is empty with no direction', () => {
        render(<Probe />);
        expect(screen.getByTestId('probe').className).toBe('');
        render(<Probe direction={null} />);
        expect(screen.getAllByTestId('probe')[1].className).toBe('');
    });

    it('clears the class after one cycle so a later visit re-animates', () => {
        // The animation is 220ms in index.css; 260ms clears the applied class.
        render(<Probe direction="right" />);
        expect(screen.getByTestId('probe').className).toBe('surface-enter-right');
        act(() => { vi.advanceTimersByTime(300); });
        expect(screen.getByTestId('probe').className).toBe('');
    });

    it('does not re-fire when an unrelated prop changes', () => {
        const { rerender } = render(<Probe direction="right" />);
        act(() => { vi.advanceTimersByTime(300); });
        expect(screen.getByTestId('probe').className).toBe('');
        // Same direction again after the class cleared: the effect deps are
        // [direction], so a plain re-render must NOT restart the animation.
        rerender(<Probe direction="right" />);
        expect(screen.getByTestId('probe').className).toBe('');
    });
});
