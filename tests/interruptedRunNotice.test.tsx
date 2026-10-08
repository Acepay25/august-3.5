import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ChatTranscriptRow, { type ChatRowView } from '../components/shared/ChatTranscriptRow';

/**
 * An interrupted run is a half-written answer with no way forward.
 *
 * Before this, a stopped turn settled to a partial bubble and the only recovery
 * was retyping the question by hand. The reference shows an IN-FLOW notice with
 * Edit prompt / Try again, and the honest rule is that a row which stops must say
 * so where the user is already looking — not in a toast, not on hover.
 */

vi.mock('lucide-react', () => ({
    Wrench: () => <span />, Check: () => <span />, Copy: () => <span />,
    Pin: () => <span />, RotateCcw: () => <span />, Square: () => <span />,
    Volume2: () => <span />, Pencil: () => <span />,
}));

const base: ChatRowView = {
    id: 'a1',
    role: 'ai',
    text: 'partial answer that stopped mid',
    interrupted: true,
    interruptedPrompt: 'what is the setup on ETHUSDT?',
};

describe('the interrupted-run notice', () => {
    it('renders in flow on an interrupted row', () => {
        render(<ChatTranscriptRow row={base} onRetry={() => {}} />);
        expect(screen.getByTestId('interrupted-run-notice')).toBeDefined();
        expect(screen.getByText('Run stopped')).toBeDefined();
    });

    it('is absent when NO handler is wired — a label with no button is a dead notice', () => {
        // Naming a problem and offering no way out is worse than saying nothing.
        render(<ChatTranscriptRow row={base} />);
        expect(screen.queryByTestId('interrupted-run-notice')).toBeNull();
    });

    it('offers Edit prompt, prefilling with what was actually asked', () => {
        // The whole point: the composer gets the REAL prompt, not a blank box
        // the user has to reconstruct.
        const onEditPrompt = vi.fn();
        render(<ChatTranscriptRow row={base} onRetry={() => {}} onEditPrompt={onEditPrompt} />);
        screen.getByRole('button', { name: /edit prompt/i }).click();
        expect(onEditPrompt).toHaveBeenCalledWith('what is the setup on ETHUSDT?');
    });

    it('offers Try again, reusing the same re-dispatch as the post-mortem retry', () => {
        const onRetry = vi.fn();
        render(<ChatTranscriptRow row={base} onRetry={onRetry} onEditPrompt={() => {}} />);
        screen.getByRole('button', { name: /try again/i }).click();
        expect(onRetry).toHaveBeenCalled();
    });

    it('is absent on a normal, settled answer', () => {
        // THE REGRESSION GUARD. A notice on every row is worse than none: it
        // would teach the user that "Run stopped" means nothing.
        render(<ChatTranscriptRow row={{ id: 'x', role: 'ai', text: 'a complete answer' }} />);
        expect(screen.queryByTestId('interrupted-run-notice')).toBeNull();
    });

    it('omits Edit prompt when the prompt was not captured — no dead control', () => {
        // Renders Try again alone rather than a button that prefills nothing.
        render(<ChatTranscriptRow row={{ ...base, interruptedPrompt: undefined }} onRetry={() => {}} onEditPrompt={() => {}} />);
        expect(screen.queryByRole('button', { name: /edit prompt/i })).toBeNull();
        expect(screen.getByRole('button', { name: /try again/i })).toBeDefined();
    });

    it('is not rendered on the user\'s own turn', () => {
        // The notice belongs to the ANSWER that stopped, not to the question.
        render(<ChatTranscriptRow row={{ ...base, role: 'user' }} onRetry={() => {}} />);
        expect(screen.queryByTestId('interrupted-run-notice')).toBeNull();
    });

    it('every control clears the 24px hit-target floor', () => {
        // render-probe fails any clickable under 24px — the only gate that can
        // measure a target size, since jsdom reports every element as 0x0.
        render(<ChatTranscriptRow row={base} onRetry={() => {}} onEditPrompt={() => {}} />);
        for (const name of [/edit prompt/i, /try again/i]) {
            expect(screen.getByRole('button', { name }).className).toContain('hit-target');
        }
    });
});
