import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DebateSidePanel, { DebateSidePanelProps, cleanSpeakerPrefix } from '../components/analysis/DebateSidePanel';

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

// Mock transcript export so downloads/copies are observable, not DOM side effects.
const exportMocks = vi.hoisted(() => ({
    buildTranscriptMarkdown: vi.fn(() => 'MD'),
    buildTranscriptJson: vi.fn(() => 'JSON'),
    buildTranscriptFilename: vi.fn((_a: unknown, ext: string) => `file.${ext}`),
    downloadTextFile: vi.fn(),
}));
vi.mock('../utils/transcriptExport', () => exportMocks);

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

describe('DebateSidePanel tool-event rows', () => {
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

    it('renders addressed rebuttals as tool-style reply rows with clickable @chips, collapsed by default', () => {
        const onSelectActor = vi.fn();
        render(
            <DebateSidePanel
                {...baseProps}
                actorIds={['Macro Analyst', 'Risk Analyst']}
                onSelectActor={onSelectActor}
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
        expect(screen.getByText(/replied to/)).toBeTruthy();
        // Every addressee renders as a clickable @chip…
        const chip = screen.getByRole('button', { name: /jump to risk analyst/i });
        expect(chip.textContent).toBe('@Risk Analyst');
        // Body hidden until expanded.
        expect(screen.queryByText(/rebuttal sentence 30/)).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: /expand reply/i }));
        expect(screen.queryByText(/rebuttal sentence 30/)).toBeNull(); // truncated
        fireEvent.click(screen.getByRole('button', { name: /show full reply/i }));
        expect(screen.getByText(/rebuttal sentence 30/)).toBeTruthy();
        // …and clicking the chip jumps to the addressee's tab.
        fireEvent.click(chip);
        expect(onSelectActor).toHaveBeenCalledWith('Risk Analyst');
    });

    it('keeps plain statements (no `to`) as readable markdown, not tool rows', () => {
        render(<DebateSidePanel {...baseProps} turns={[makeTurn()]} isLive={false} />);
        expect(screen.getByText('Short public statement.')).toBeTruthy();
        expect(screen.queryByText(/replied/)).toBeNull();
    });
});

describe('cleanSpeakerPrefix', () => {
    it('strips a bolded "Name:" prefix', () => {
        expect(cleanSpeakerPrefix('**Macro Analyst:** Prices swept the lows.', 'Macro Analyst'))
            .toBe('Prices swept the lows.');
    });

    it('strips a plain "Name:" prefix case-insensitively', () => {
        expect(cleanSpeakerPrefix('macro analyst: liquidity is thin', 'Macro Analyst'))
            .toBe('liquidity is thin');
    });

    it('strips a literal {{NAME}} template remnant', () => {
        expect(cleanSpeakerPrefix('{{NAME}}: Holding the level.', 'Macro Analyst'))
            .toBe('Holding the level.');
    });

    it('strips a leading bold-asterisk remnant', () => {
        expect(cleanSpeakerPrefix('** Holding the level.', 'Macro Analyst'))
            .toBe('Holding the level.');
    });

    it('leaves text without a prefix untouched', () => {
        expect(cleanSpeakerPrefix('Prices swept the lows.', 'Macro Analyst'))
            .toBe('Prices swept the lows.');
    });

    it('escapes regex metacharacters in the speaker name', () => {
        expect(cleanSpeakerPrefix('Risk (v2): edge case', 'Risk (v2)'))
            .toBe('edge case');
    });
});

describe('DebateSidePanel header actions menu', () => {
    const twoTurns = [
        makeTurn({ speaker: 'Macro Analyst', round: 1, text: 'Opening view.' }),
        makeTurn({ speaker: 'Macro Analyst', round: 2, text: 'Final stance.' }),
    ];

    it('hides the kebab when there is nothing to export or fork', () => {
        render(<DebateSidePanel {...baseProps} turns={[]} isLive={false} />);
        expect(screen.queryByRole('button', { name: /transcript actions/i })).toBeNull();
    });

    it('opens the menu with copy + export items when turns exist', () => {
        render(<DebateSidePanel {...baseProps} turns={twoTurns} isLive={false} />);
        fireEvent.click(screen.getByRole('button', { name: /transcript actions/i }));
        expect(screen.getByRole('button', { name: /copy transcript/i })).toBeTruthy();
        expect(screen.getByRole('button', { name: /export markdown/i })).toBeTruthy();
        expect(screen.getByRole('button', { name: /export json/i })).toBeTruthy();
    });

    it('exports markdown through the transcript helpers', () => {
        render(<DebateSidePanel {...baseProps} turns={twoTurns} isLive={false} />);
        fireEvent.click(screen.getByRole('button', { name: /transcript actions/i }));
        fireEvent.click(screen.getByRole('button', { name: /export markdown/i }));
        expect(exportMocks.buildTranscriptMarkdown).toHaveBeenCalledWith(twoTurns, undefined);
        expect(exportMocks.downloadTextFile).toHaveBeenCalled();
    });

    it('lists a fork item per round and forks on click', () => {
        const onForkDebate = vi.fn();
        const onClose = vi.fn();
        render(
            <DebateSidePanel
                {...baseProps}
                turns={twoTurns}
                isLive={false}
                messageId="msg-1"
                onForkDebate={onForkDebate}
                onClose={onClose}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: /transcript actions/i }));
        const fork2 = screen.getByRole('button', { name: /fork from round 2/i });
        fireEvent.click(fork2);
        expect(onForkDebate).toHaveBeenCalledWith('msg-1', 2);
        expect(onClose).toHaveBeenCalled();
    });

    it('does not offer fork while the debate is live', () => {
        render(
            <DebateSidePanel
                {...baseProps}
                turns={twoTurns}
                isLive
                messageId="msg-1"
                onForkDebate={vi.fn()}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: /transcript actions/i }));
        expect(screen.queryByRole('button', { name: /fork from round/i })).toBeNull();
    });
});

describe('DebateSidePanel replacement offer', () => {
    it('renders the replacement card at the top of the panel', () => {
        const onReplacementChoice = vi.fn();
        render(
            <DebateSidePanel
                {...baseProps}
                turns={[makeTurn()]}
                isLive
                replacementOffer={{
                    droppedName: 'Risk Analyst',
                    round: 2,
                    candidates: [{ providerId: 'p1', displayName: 'Provider One', modelId: 'm1' }],
                }}
                onReplacementChoice={onReplacementChoice}
            />,
        );
        expect(screen.getByText(/Risk Analyst dropped out \(round 2\)/)).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: /provider one · m1/i }));
        expect(onReplacementChoice).toHaveBeenCalledWith('p1');
    });
});
