/**
 * The Chat ⇄ Chart AI surface transition.
 *
 * The mental model: the Chat surface and the Chart AI dock are the SAME panel
 * at two sizes, so the hop is a container RESIZE. The arriving surface grows
 * out of the dock's own footprint on the right and settles to fill the screen;
 * going back, it collapses into the same edge.
 *
 * This replaced an earlier directional slide. It read as two unrelated
 * surfaces passing each other, which was wrong: nothing about it said "one
 * conversation, two sizes". So there is deliberately NO translate here, and
 * the test asserts that.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { useSurfaceEnter, SURFACE_ENTER_MS } from '../hooks/useSurfaceEnter';

const css = readFileSync(resolve(__dirname, '../index.css'), 'utf8');

/** The full body of a keyframe, matching braces rather than stopping at the
 *  first '}' — a non-greedy regex read only the first block, which would have
 *  missed the `to` half of a multi-stop animation entirely. */
const keyframeBody = (name: string): string => {
    const at = css.indexOf(`@keyframes ${name}`);
    if (at < 0) return '';
    const open = css.indexOf('{', at);
    let depth = 0;
    for (let i = open; i < css.length; i++) {
        if (css[i] === '{') depth++;
        else if (css[i] === '}') { depth--; if (depth === 0) return css.slice(open + 1, i); }
    }
    return '';
};

/** A class RULE, not the first mention of the name — the CSS comments
 *  describe these classes by name and would match first. */
const ruleFor = (cls: string): string => {
    const m = new RegExp(`^${cls.replace('.', '\\.')}\\b`, 'm').exec(css);
    if (!m) return '';
    const open = css.indexOf('{', m.index);
    if (open < 0) return '';
    let depth = 0;
    for (let i = open; i < css.length; i++) {
        if (css[i] === '{') depth++;
        else if (css[i] === '}') { depth--; if (depth === 0) return css.slice(open, i + 1); }
    }
    return '';
};

describe('surface enter — a resize, not a slide', () => {
    it('declares one grow animation, shared by both hop classes', () => {
        expect(css).toMatch(/@keyframes\s+surfaceGrowFromDock/);
        // App still sets a direction flag, so both classes are applied — but a
        // container resize has no left/right to it, so they resolve to the
        // same animation.
        for (const cls of ['.surface-enter-right', '.surface-enter-left']) {
            expect(ruleFor(cls), cls).toMatch(/surfaceGrowFromDock/);
        }
    });

    it('grows out of the dock rather than sliding across the screen', () => {
        const grow = keyframeBody('surfaceGrowFromDock');
        expect(grow).toMatch(/transform:\s*scale\(0\.62\)/);
        expect(grow).toMatch(/transform:\s*scale\(1\)/);
        // The defining property of a RESIZE, and the thing that killed the
        // old version: a translate is a slide, and a slide reads as two
        // surfaces passing each other rather than one panel changing size.
        expect(grow).not.toMatch(/translateX|translate3d|translateY/);
        // Opacity clears early so the resize carries the transition.
        expect(grow).toMatch(/40%\s*\{\s*opacity:\s*1/);
    });

    it('anchors the grow to the dock right edge, so it reads as coming OUT of it', () => {
        for (const cls of ['.surface-enter-right', '.surface-enter-left']) {
            expect(ruleFor(cls), cls).toMatch(/transform-origin:\s*100% 50%/);
        }
    });

    it('the old directional slide is gone, not merely unused', () => {
        expect(css).not.toMatch(/@keyframes\s+surfaceEnterFrom/);
    });

    it('the CSS duration and the hook\'s clear timer cannot drift apart', () => {
        // The class is removed on a timer derived from SURFACE_ENTER_MS. If
        // the CSS animation is longer, the class comes off mid-flight and the
        // surface SNAPS to its resting transform — which looks like the old
        // broken transition rather than a timing bug. This failed silently once
        // already, when the duration moved 220 → 340ms and the timer did not.
        const declared = Number(/animation:\s*surfaceGrowFromDock\s+([\d.]+)s/.exec(
            ruleFor('.surface-enter-right'),
        )?.[1] ?? NaN);
        expect(Number.isFinite(declared), 'could not read the CSS duration').toBe(true);
        expect(Math.round(declared * 1000)).toBe(SURFACE_ENTER_MS);
    });

    it('is covered by the global reduced-motion kill switch', () => {
        // There are SEVERAL `prefers-reduced-motion` blocks in this file — the
        // component-specific ones come first. Only the blanket one matters, and
        // it must be blanket or a new animation could opt out of it.
        const blocks = [...css.matchAll(
            /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\n\}/g,
        )].map(m => m[0]);
        const blanket = blocks.find(m => /\*/.test(m) && /animation-duration/.test(m));
        expect(blanket, 'no blanket reduced-motion guard found in index.css').toBeTruthy();
        expect(blanket).toMatch(/animation-duration:\s*0\.01ms\s*!important/);
        expect(blanket).toMatch(/transition-duration:\s*0\.01ms\s*!important/);
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
        expect(screen.getAllByTestId('probe')[1].className).toBe('surface-enter-left');
    });

    it('is empty with no direction', () => {
        render(<Probe />);
        expect(screen.getByTestId('probe').className).toBe('');
        render(<Probe direction={null} />);
        expect(screen.getAllByTestId('probe')[1].className).toBe('');
    });

    it('clears the class after one cycle so a later visit re-animates', () => {
        render(<Probe direction="right" />);
        expect(screen.getByTestId('probe').className).toBe('surface-enter-right');
        act(() => { vi.advanceTimersByTime(SURFACE_ENTER_MS + 60); });
        expect(screen.getByTestId('probe').className).toBe('');
    });

    it('does not re-fire when an unrelated prop changes', () => {
        const { rerender } = render(<Probe direction="right" />);
        act(() => { vi.advanceTimersByTime(SURFACE_ENTER_MS + 60); });
        expect(screen.getByTestId('probe').className).toBe('');
        rerender(<Probe direction="right" />);
        expect(screen.getByTestId('probe').className).toBe('');
    });
});
