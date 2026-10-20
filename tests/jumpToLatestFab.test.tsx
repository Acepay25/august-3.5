/**
 * The jump control.
 *
 * One control, two homes, two states.
 *
 * The Chart AI dock had no way back to the newest row at all: a trader
 * reading up the transcript had no way to return to the answer that was still
 * arriving, while the Chat surface had a pill. So the control moved into one
 * component and both surfaces mount it.
 *
 * The ring is INDETERMINATE on purpose. A desk turn has no denominator
 * anyone could honestly draw — the model may call three tools or forty — so a
 * ring that claimed "60% done" would be a number the app invented. The ring
 * says "the desk is working", and nothing more.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import JumpToLatestFab, { JUMP_AWAY_PX } from '../components/shared/JumpToLatestFab';

describe('the jump control', () => {
    it('says nothing when there is nothing below', () => {
        render(<JumpToLatestFab visible={false} onJump={() => {}} />);
        expect(screen.queryByTestId('jump-to-latest')).toBeNull();
    });

    it('offers the way back when the trader has scrolled away', () => {
        const onJump = vi.fn();
        render(<JumpToLatestFab visible onJump={onJump} />);
        const button = screen.getByTestId('jump-to-latest');
        expect(button.getAttribute('data-state')).toBe('idle');
        expect(button.getAttribute('aria-label')).toBe('Jump to the latest');
        fireEvent.click(button);
        expect(onJump).toHaveBeenCalledTimes(1);
    });

    it('shows an INDETERMINATE ring while a turn runs — no percentage', () => {
        render(<JumpToLatestFab visible running onJump={() => {}} />);
        const button = screen.getByTestId('jump-to-latest');
        expect(button.getAttribute('data-state')).toBe('running');
        // A ring that is turning, not an arc that claims a share of a total.
        const ring = button.querySelector('svg circle');
        expect(ring).toBeTruthy();
        expect(ring?.getAttribute('stroke-dasharray')).toBeTruthy();
        // No denominator anywhere: a "70%" would be a number the app made up.
        expect(button.textContent).not.toMatch(/\d+%/);
        expect(button.outerHTML).not.toMatch(/\d+%/);
    });

    it('is round, and it is a real button', () => {
        render(<JumpToLatestFab visible onJump={() => {}} />);
        const button = screen.getByTestId('jump-to-latest');
        expect(button.tagName).toBe('BUTTON');
        expect(button.className).toMatch(/rounded-full/);
        // A 24px hit target is the floor the render probe measures.
        expect(button.className).toMatch(/h-8 w-8/);
    });

    it('names the state it is in', () => {
        const { rerender } = render(<JumpToLatestFab visible running onJump={() => {}} />);
        expect(screen.getByTestId('jump-to-latest').getAttribute('aria-label')).toMatch(/Working/);
        rerender(<JumpToLatestFab visible onJump={() => {}} />);
        expect(screen.getByTestId('jump-to-latest').getAttribute('aria-label')).toMatch(/Jump to the latest/);
    });
});

describe('one threshold for both homes', () => {
    it('is a number, and it is the one both surfaces read', () => {
        expect(JUMP_AWAY_PX).toBe(240);
    });
});
