import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

import { DeskScene } from '../components/desk/DeskScene';
import type { DebateStageActor } from '../components/analysis/DebateStage';

const actor = (over: Partial<DebateStageActor>): DebateStageActor => ({
    id: 'macro',
    name: 'Macro',
    ...over,
});

describe('DeskScene', () => {
    afterEach(() => cleanup());

    it('renders each seat as a SeatCard with the actor name and speech line', () => {
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
        expect(screen.getByText('Macro')).toBeTruthy();
        expect(screen.getByText('Technical')).toBeTruthy();
        expect(screen.getByText(/BTC 4H close below 94\.2k/)).toBeTruthy();
        expect(screen.getByText(/Two false breakouts in 30 days/)).toBeTruthy();
    });

    it('separates the moderator from analyst seats', () => {
        render(
            <DeskScene
                actors={[
                    actor({ id: 'macro', name: 'Macro' }),
                    actor({ id: 'moderator', name: 'Moderator' }),
                ]}
                onClose={() => {}}
            />,
        );
        // Both labels are visible; the layout groups moderator under its own header.
        expect(screen.getByText('Macro')).toBeTruthy();
        // The "Seats" and "Moderator" group headers should be present.
        expect(screen.getByText(/^Seats$/i)).toBeTruthy();
        // The Moderator section header is distinct from the seat card's
        // "Moderator" name — the section header is a small uppercase label.
        const sectionHeaders = screen.getAllByText(/^Moderator$/i);
        expect(sectionHeaders.length).toBeGreaterThanOrEqual(2);
        // The seat card renders the actor name as a button with the seat's
        // aria-label; use that to assert the moderator seat exists.
        expect(screen.getByRole('button', { name: /open Moderator transcript/i })).toBeTruthy();
    });

    it('renders the verdict block when a verdict string is provided', () => {
        render(
            <DeskScene
                actors={[actor({ id: 'macro', name: 'Macro' })]}
                verdict="Avoid · Risk lens vetoed"
                onClose={() => {}}
            />,
        );
        expect(screen.getByText('Avoid · Risk lens vetoed')).toBeTruthy();
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
});
