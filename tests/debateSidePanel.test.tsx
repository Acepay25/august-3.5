import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DebateSidePanel, { DebateSidePanelProps } from '../components/analysis/DebateSidePanel';

// Mock Icons
vi.mock('../components/shared/Icons', () => ({
    ChevronDownIcon: ({ className }: { className?: string }) => (
        <span data-testid="chevron-icon" className={className} />
    ),
}));

// Mock MarkdownContent / StreamingMarkdown — render the raw text so the
// truncation and Show-more assertions can read it.
vi.mock('../components/shared/MarkdownContent', () => ({
    default: ({ content }: { content?: string }) => <span>{content}</span>,
}));
vi.mock('../components/shared/StreamingMarkdown', () => ({
    default: ({ text }: { text?: string }) => <span>{text}</span>,
}));

const longThinking = Array.from({ length: 40 }, (_, i) => `reasoning line ${i + 1}`).join('\n');
const longReply = Array.from({ length: 30 }, (_, i) => `rebuttal sentence ${i + 1}.`).join(' ');

const makeTurn = (overrides: Partial<DebateSidePanelProps['turns'][number]> = {}): DebateSidePanelProps['turns'][number] => ({
    speaker: 'Macro Analyst',
    text: 'Short public statement.',
    round: 1,
    createdAt: '2026-08-25T05:00:00.000Z',
    ...overrides,
});

const baseProps: DebateSidePanelProps = {
    open: true,
    onClose: () => {},
    turns: [],
    actorIds: ['Macro Analyst'],
    activeActor: 'Macro Analyst',
    onSelectActor: () => {},
};

describe('DebateSidePanel (zcode-style rows)', () => {
    it('renders nothing when closed', () => {
        const { container } = render(<DebateSidePanel {...baseProps} open={false} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('shows a runtime header for seats with timestamped turns', () => {
        render(<DebateSidePanel {...baseProps} turns={[makeTurn()]} isLive={false} />);
        expect(screen.getByText(/Worked for/)).toBeTruthy();
    });

    it('collapses Thought rows by default and hides the full trace', () => {
        render(<DebateSidePanel {...baseProps} turns={[makeTurn({ reasoning: longThinking })]} isLive={false} />);
        const toggle = screen.getByRole('button', { name: /expand thought/i });
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        // Full trace hidden while collapsed…
        expect(screen.queryByText(/reasoning line 40/)).toBeNull();
        // …and the truncated first-line snippet is visible instead.
        expect(screen.getByText(/reasoning line 1/)).toBeTruthy();
    });

    it('expands a Thought row to a truncated body with Show full reasoning', () => {
        render(<DebateSidePanel {...baseProps} turns={[makeTurn({ reasoning: longThinking })]} isLive={false} />);
        fireEvent.click(screen.getByRole('button', { name: /expand thought/i }));
        // Expanded but still truncated past TRUNCATE_LIMIT.
        expect(screen.queryByText(/reasoning line 40/)).toBeNull();
        expect(screen.getByText(/\u2026/)).toBeTruthy();
        const more = screen.getByRole('button', { name: /show full reasoning/i });
        fireEvent.click(more);
        expect(screen.getByText(/reasoning line 40/)).toBeTruthy();
        expect(screen.getByRole('button', { name: /show less/i })).toBeTruthy();
    });

    it('renders addressed rebuttals as tool-style reply rows, collapsed by default', () => {
        render(
            <DebateSidePanel
                {...baseProps}
                turns={[
                    makeTurn({
                        round: 2,
                        to: ['Risk Analyst'],
                        text: longReply,
                    }),
                ]}
                isLive={false}
            />,
        );
        expect(screen.getByText(/replied to Risk Analyst/)).toBeTruthy();
        // Body hidden until expanded.
        expect(screen.queryByText(/rebuttal sentence 30/)).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: /expand reply/i }));
        expect(screen.queryByText(/rebuttal sentence 30/)).toBeNull(); // truncated
        fireEvent.click(screen.getByRole('button', { name: /show full reply/i }));
        expect(screen.getByText(/rebuttal sentence 30/)).toBeTruthy();
    });

    it('keeps plain statements (no `to`) as readable markdown, not tool rows', () => {
        render(<DebateSidePanel {...baseProps} turns={[makeTurn()]} isLive={false} />);
        expect(screen.getByText('Short public statement.')).toBeTruthy();
        expect(screen.queryByText(/replied/)).toBeNull();
    });
});
