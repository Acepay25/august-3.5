import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';

import { DeskScene } from '../components/desk/DeskScene';
import type { DebateStageActor } from '../components/analysis/DebateStage';

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

const actor = (over: Partial<DebateStageActor>): DebateStageActor => ({
    id: 'macro',
    name: 'Macro',
    ...over,
});

describe('DeskScene', () => {
    afterEach(() => cleanup());

    it('renders each seat as a PixelSeat with the actor name (via aria-label)', () => {
        render(
            <DeskScene
                actors={[
                    actor({ id: 'macro', name: 'Macro', speech: 'BTC 4H close below 94.2k' }),
                    actor({ id: 'technical', name: 'Technical', speech: 'Two false breakouts in 30 days' }),
                ]}
                caption="Round 1"
                phase="Opening"
                onClose={() => {}}
            />,
        );
        // The seat buttons are now aria-labelled; the visible name plate is
        // the same string, so both are findable.
        expect(screen.getByLabelText('Open Macro seat')).toBeTruthy();
        expect(screen.getByLabelText('Open Technical seat')).toBeTruthy();
        // Seat statusText should show the speech excerpt.
        expect(screen.getByText(/BTC 4H close below 94\.2k/)).toBeTruthy();
        expect(screen.getByText(/Two false breakouts in 30 days/)).toBeTruthy();
    });

    it('places the moderator seat at the center anchor', () => {
        const { container } = render(
            <DeskScene
                actors={[
                    actor({ id: 'macro', name: 'Macro' }),
                    actor({ id: 'moderator', name: 'Moderator' }),
                ]}
                onClose={() => {}}
            />,
        );
        const moderatorSeat = screen.getByLabelText('Open Moderator seat');
        // Walk up to the positioned wrapper; it has the inline left/top
        // style we set on the floor.
        let el: HTMLElement | null = moderatorSeat;
        let positioned: HTMLElement | null = null;
        while (el) {
            const style = (el as HTMLElement).style;
            if (style && style.left && style.top) {
                positioned = el;
                break;
            }
            el = el.parentElement;
        }
        expect(positioned).toBeTruthy();
        // Moderator anchor is x=0.5, y=0.55 — toBeCloseTo handles the
        // 0.55 * 100 -> 55.00000000000001% float round-trip.
        const leftPct = parseFloat(positioned!.style.left);
        const topPct = parseFloat(positioned!.style.top);
        expect(leftPct).toBeCloseTo(50, 5);
        expect(topPct).toBeCloseTo(55, 5);
        // Suppress the unused container warning — kept so the DOM is alive
        // when the assertion runs.
        expect(container).toBeTruthy();
    });

    it('renders the verdict card with direction + confidence when verdictDetail is provided', () => {
        render(
            <DeskScene
                actors={[actor({ id: 'macro', name: 'Macro' })]}
                verdictDetail={{ direction: 'Avoid', confidence: 'Risk lens vetoed' }}
                onClose={() => {}}
            />,
        );
        // The verdict card pins inside the floor; the testid is the anchor.
        const verdict = screen.getByTestId('desk-verdict');
        expect(within(verdict).getByText('Avoid')).toBeTruthy();
        expect(within(verdict).getByText('Risk lens vetoed')).toBeTruthy();
    });

    it('does NOT render the verdict card when verdictDetail is omitted', () => {
        render(
            <DeskScene
                actors={[actor({ id: 'macro', name: 'Macro' })]}
                onClose={() => {}}
            />,
        );
        expect(screen.queryByTestId('desk-verdict')).toBeNull();
    });

    it('close button calls onClose', () => {
        let closed = 0;
        render(
            <DeskScene
                actors={[actor({ id: 'macro', name: 'Macro' })]}
                onClose={() => { closed += 1; }}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: /close desk view/i }));
        expect(closed).toBe(1);
    });

    it('renders the run-contract stage strip when stages are provided', () => {
        render(
            <DeskScene
                actors={[actor({ id: 'macro', name: 'Macro' })]}
                stages={[
                    { id: 'open', label: 'Openings', state: 'done' },
                    { id: 'rebut', label: 'Rebuttals', state: 'running' },
                    { id: 'verdict', label: 'Verdict', state: 'pending' },
                ]}
                onClose={() => {}}
            />,
        );
        expect(screen.getByText('Openings')).toBeTruthy();
        expect(screen.getByText('Rebuttals')).toBeTruthy();
        expect(screen.getByText('Verdict')).toBeTruthy();
    });

    it('renders the exchange map when exchanges are provided', () => {
        render(
            <DeskScene
                actors={[
                    actor({ id: 'macro', name: 'Macro' }),
                    actor({ id: 'risk', name: 'Risk' }),
                ]}
                exchanges={[
                    { from: 'Macro', to: 'Risk', count: 2 },
                    { from: 'Risk', to: 'Macro', count: 1 },
                ]}
                onClose={() => {}}
            />,
        );
        // Each exchange row has a "X addressed Y N×" tooltip.
        expect(screen.getByTitle(/Macro addressed Risk 2×/)).toBeTruthy();
        expect(screen.getByTitle(/Risk addressed Macro 1×/)).toBeTruthy();
    });

    it('fires onSteerSeat from the inline input when at least one seat is live', () => {
        const onSteerSeat = vi.fn();
        render(
            <DeskScene
                actors={[
                    actor({ id: 'macro', name: 'Macro', live: true }),
                    actor({ id: 'risk', name: 'Risk' }),
                ]}
                onSteerSeat={onSteerSeat}
                onClose={() => {}}
            />,
        );
        const input = screen.getByPlaceholderText(/note for the selected seat/i);
        fireEvent.change(input, { target: { value: 'flag the funding rate' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(onSteerSeat).toHaveBeenCalledWith('Macro', 'flag the funding rate');
    });

    it('hides the steer input when no seat is live', () => {
        render(
            <DeskScene
                actors={[
                    actor({ id: 'macro', name: 'Macro' }),
                ]}
                onSteerSeat={vi.fn()}
                onClose={() => {}}
            />,
        );
        expect(screen.queryByPlaceholderText(/note for the selected seat/i)).toBeNull();
    });
});
