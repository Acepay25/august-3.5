import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';

import { SpeechBubble, SPEECH_BUBBLE_FADE_MS } from '../components/desk/SpeechBubble';
import { VerdictCard, extractConvictions } from '../components/desk/VerdictCard';

afterEach(() => cleanup());

describe('SpeechBubble', () => {
    it('renders the speaker and the truncated text', () => {
        render(<SpeechBubble text="BTC 4H close below 94.2k — bear flag" speaker="Macro" side="left" />);
        // The aria-label carries the speaker + text.
        const bubble = screen.getByRole('status');
        expect(bubble.getAttribute('aria-label')).toMatch(/Macro says/);
        expect(bubble.textContent).toContain('BTC 4H close below 94.2k');
    });

    it('truncates very long lines to BUBBLE_MAX_CHARS', () => {
        const long = 'a'.repeat(200);
        render(<SpeechBubble text={long} speaker="Macro" />);
        const bubble = screen.getByRole('status');
        // 64 chars + an ellipsis char.
        const text = bubble.querySelector('p')?.textContent ?? '';
        expect(text.length).toBeLessThanOrEqual(65);
        expect(text.endsWith('…')).toBe(true);
    });

    it('renders nothing when the text is empty', () => {
        const { container } = render(<SpeechBubble text="" speaker="Macro" />);
        expect(container.firstChild).toBeNull();
    });

    it('exposes a sensible default fade window', () => {
        expect(SPEECH_BUBBLE_FADE_MS).toBe(4000);
    });

    it('renders a conviction chip when the seat sealed a stake', () => {
        render(<SpeechBubble text="Macro 4H bias: down" speaker="Macro" conviction={72} toneKey="macro" />);
        const bubble = screen.getByRole('status');
        expect(bubble.textContent).toContain('Conv');
        expect(bubble.textContent).toContain('72');
    });
});

describe('VerdictCard', () => {
    it('extracts the LAST sealed conviction per seat (ignores Moderator / System)', () => {
        const seats = extractConvictions([
            { speaker: 'Macro', text: 'Bias 4H down.\nCONVICTION: 60' },
            { speaker: 'Risk', text: 'Lev cap 5x.\nCONVICTION: 80' },
            { speaker: 'Macro', text: 'Refined.\nCONVICTION: 75' }, // overwrites Macro
            { speaker: 'Moderator', text: 'CONVICTION: 99' }, // ignored
            { speaker: 'System', text: 'CONVICTION: 42' }, // ignored
        ]);
        const macro = seats.find(s => s.name === 'Macro');
        const risk = seats.find(s => s.name === 'Risk');
        expect(macro?.value).toBe(75);
        expect(risk?.value).toBe(80);
    });

    it('clamps the conviction to 0..100', () => {
        const seats = extractConvictions([
            { speaker: 'Macro', text: 'CONVICTION: 999' },
            { speaker: 'Risk', text: 'CONVICTION: 5' },
        ]);
        const macro = seats.find(s => s.name === 'Macro');
        const risk = seats.find(s => s.name === 'Risk');
        expect(macro?.value).toBe(100);
        expect(risk?.value).toBe(5);
    });

    it('renders the verdict card with direction, confidence, and the auction', () => {
        render(
            <VerdictCard
                direction="Long"
                confidence="High"
                grade="A"
                seats={[
                    { name: 'Macro', value: 80 },
                    { name: 'Risk', value: 75 },
                ]}
            />,
        );
        expect(screen.getByText('Long')).toBeTruthy();
        expect(screen.getByText('High')).toBeTruthy();
        // Grade is rendered as the bare letter "A" in a pill.
        expect(screen.getByText('A')).toBeTruthy();
        expect(screen.getByText('Macro')).toBeTruthy();
        expect(screen.getByText('Risk')).toBeTruthy();
    });

    it('renders nothing when direction is empty', () => {
        const { container } = render(<VerdictCard direction="" confidence="" seats={[]} />);
        expect(container.firstChild).toBeNull();
    });
});
