/**
 * The Chat ⇄ Chart AI surface transition.
 *
 * The mental model: the Chat surface and the Chart AI dock are the SAME panel
 * at two sizes, so the hop is a container RESIZE — the dock's left edge
 * travels out to the viewport's left edge, and back. Both surfaces are
 * right-pinned, so a panel that slides in from the right IS that travel.
 *
 * This is the hamburger's own motion (`.animate-slide-in-left` in index.css),
 * mirrored. THREE attempts have been rejected as "still the old transition" or
 * "a pop up on the left": a small directional translate, then a
 * `transform-origin: 100% 50%` scale. The scale was the real culprit — scaling
 * a full-width surface makes it balloon in place instead of travelling. A
 * WAAPI morph (`hooks/useSurfaceMorph`) also ran alongside the keyframe with
 * its own translate+scale, so two animations fought on one element; it is
 * deleted, and these tests are the only thing animating this hop.
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

describe('surface enter — one slide, matching the hamburger', () => {
    it('declares one slide animation, shared by both hop classes', () => {
        expect(css).toMatch(/@keyframes\s+surfaceSlideFromRight/);
        // App still sets a direction flag, so both classes are applied — but a
        // resize has no handedness, so they resolve to the same animation.
        for (const cls of ['.surface-enter-right', '.surface-enter-left']) {
            expect(ruleFor(cls), cls).toMatch(/surfaceSlideFromRight/);
        }
    });

    it('slides in from the RIGHT edge, the mirror of the hamburger', () => {
        const slide = keyframeBody('surfaceSlideFromRight');
        // The dock is the right-hand panel, so "expand out of the dock" and
        // "slide in from the right" are the same motion.
        expect(slide).toMatch(/transform:\s*translateX\(100%\)/);
        expect(slide).toMatch(/transform:\s*translateX\(0\)/);
        // A scale here is what made the surface balloon in place. Pin it.
        expect(slide).not.toMatch(/scale\(/);
        expect(slide).not.toMatch(/translateY|translate3d/);
    });

    it('carries no transform-origin — a translate does not pivot', () => {
        // The `transform-origin: 100% 50%` left over from the scale made the
        // panel look like it was rotating about its edge rather than sliding.
        for (const cls of ['.surface-enter-right', '.surface-enter-left']) {
            expect(ruleFor(cls), cls).not.toMatch(/transform-origin/);
        }
    });

    it("matches the hamburger's own motion so they feel like one system", () => {
        const hamburger = ruleFor('.animate-slide-in-left');
        // The rule references the keyframe by name; `@keyframes slideInLeft`
        // is its own block, so assert the two really are the same motion.
        expect(hamburger).toMatch(/animation:\s*slideInLeft/);
        expect(keyframeBody('slideInLeft')).toMatch(/translateX\(-100%\)/);
        const useEaseOut = /ease-out/.test(ruleFor('.surface-enter-right'));
        expect(useEaseOut, 'the hamburger uses ease-out; the surface hop should too')
            .toBe(/ease-out/.test(hamburger));
    });

    it('the grow keyframe is gone, not merely unused', () => {
        expect(css).not.toMatch(/@keyframes\s+surfaceGrowFromDock/);
        expect(css).not.toMatch(/surfaceGrowFromDock/);
    });

    it("the CSS duration and the hook's clear timer cannot drift apart", () => {
        // The class is removed on a timer derived from SURFACE_ENTER_MS. If
        // the CSS animation is longer, the class comes off mid-flight and the
        // surface SNAPS to its resting transform — which looks like the old
        // broken transition rather than a timing bug. This failed silently once
        // already, when the duration moved 220 → 340ms and the timer did not.
        const declared = Number(/animation:\s*surfaceSlideFromRight\s+([\d.]+)s/.exec(
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
