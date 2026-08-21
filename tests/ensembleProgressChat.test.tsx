import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import EnsembleProgressChat from '../components/analysis/EnsembleProgressChat';
import { botFillForKey } from '../components/analysis/DebateBotAvatar';
import { EnsembleProgress, EnsembleAnalystProgress } from '../types';

// Mock Icons
vi.mock('../components/shared/Icons', () => ({
    BotIcon: () => <span data-testid="bot-icon" />,
    ChevronDownIcon: ({ className }: { className?: string }) => <span data-testid="chevron-icon" className={className} />,
}));

// Mock MarkdownContent
vi.mock('../components/shared/MarkdownContent', () => ({
    default: ({ content, children }: { content?: string; children?: string }) => <span>{content ?? children}</span>,
}));

const makeAnalyst = (overrides: Partial<EnsembleAnalystProgress> = {}): EnsembleAnalystProgress => ({
    key: 'analyst-1',
    displayName: 'Macro Analyst',
    providerId: 'gemini',
    providerName: 'Gemini',
    modelId: 'gemini-2.0-flash',
    modelName: 'Gemini Flash',
    status: 'complete',
    finalOutput: 'Bullish outlook',
    reasoning: 'Strong support at key level',
    ...overrides,
});

const makeProgress = (analysts: EnsembleAnalystProgress[] = []): EnsembleProgress => ({
    analysts: analysts.length > 0 ? analysts : [makeAnalyst()],
    moderator: { status: 'waiting' },
});

const openSeat = (name: string): void => {
    fireEvent.click(screen.getByLabelText(`Open ${name} analysis`));
};
const openSeatFromThread = openSeat;

describe('EnsembleProgressChat', () => {
    it('renders analyst cards with display names', () => {
        const progress = makeProgress([
            makeAnalyst({ key: 'a1', displayName: 'Analyst Alpha', status: 'complete' }),
            makeAnalyst({ key: 'a2', displayName: 'Analyst Beta', status: 'complete' }),
        ]);
        render(<EnsembleProgressChat progress={progress} />);
        expect(screen.getAllByText('Analyst Alpha').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Analyst Beta').length).toBeGreaterThan(0);
    });

    it('shows typing indicator for active analysts in live mode', () => {
        const progress = makeProgress([
            makeAnalyst({ key: 'a1', displayName: 'Analyst A', status: 'analyzing' }),
        ]);
        render(<EnsembleProgressChat progress={progress} isLive={true} />);
        // Should show "X is typing" or similar - multiple elements may match
        const typingElements = screen.getAllByText(/thinking|Waiting for|Preparing/);
        expect(typingElements.length).toBeGreaterThan(0);
    });

    it('renders analyst cards with reasoning', () => {
        const progress = makeProgress([
            makeAnalyst({ key: 'a1', displayName: 'Analyst A', status: 'complete', reasoning: 'Strong support at 95k' }),
        ]);
        render(<EnsembleProgressChat progress={progress} />);
        openSeat('Analyst A');
        expect(screen.getAllByText('Thinking').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Strong support at 95k')[0].closest('details')).toBeDefined();
        expect(screen.getAllByText('Bullish outlook')[0].closest('details')).toBeNull();
    });

    it('shows live CoT in Thinking before any answer exists', () => {
        const progress = makeProgress([
            makeAnalyst({
                key: 'a1',
                displayName: 'Analyst A',
                status: 'analyzing',
                finalOutput: '',
                reasoning: 'Still weighing the sweep.',
            }),
        ]);
        render(<EnsembleProgressChat progress={progress} isLive />);
        openSeat('Analyst A');
        expect(screen.getAllByText('Thinking').length).toBeGreaterThan(0);
        {
          const dialog = screen.getByRole('dialog', { name: 'Analyst A analysis' });
          expect(within(dialog).getByText('Still weighing the sweep.').closest('details')).toBeDefined();
          expect(within(dialog).getByText('Still weighing the sweep.').closest('.mx-2')).toBeNull();
        }
    });

    it('shows a neutral moderator Thinking bubble before reasoning or public text', () => {
        const progress = makeProgress([
            makeAnalyst({ key: 'a1', displayName: 'Analyst A', status: 'complete' }),
        ]);
        render(
            <EnsembleProgressChat
                progress={{ ...progress, moderator: { status: 'reviewing' } }}
                isLive
                activeDebateSpeakers={{ Moderator: 2 }}
            />,
        );
        openSeat('Moderator');
        expect(screen.getAllByText('Thinking').length).toBeGreaterThan(0);
    });

    it('displays a readable model name instead of the raw id', () => {
        const progress = makeProgress([
            makeAnalyst({ key: 'a1', displayName: 'Analyst A', modelId: 'deepseek-v4-flash', modelName: 'deepseek-v4-flash' }),
        ]);
        render(<EnsembleProgressChat progress={progress} />);
        openSeat('Analyst A');
        expect(screen.getAllByText(/Deepseek V4 Flash/).length).toBeGreaterThan(0);
    });

    it('shows completed status visual indicators', () => {
        const progress = makeProgress([
            makeAnalyst({ key: 'a1', displayName: 'Analyst A', status: 'complete' }),
            makeAnalyst({ key: 'a2', displayName: 'Analyst B', status: 'error' }),
        ]);
        render(<EnsembleProgressChat progress={progress} />);
        expect(screen.getAllByText('Analyst A').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Analyst B').length).toBeGreaterThan(0);
    });

    it('renders with empty analysts array gracefully', () => {
        const progress: EnsembleProgress = { analysts: [], moderator: { status: 'waiting' } };
        render(<EnsembleProgressChat progress={progress} />);
        // Should not crash
    });

    it('cycles through typing analysts in live mode', () => {
        const progress = makeProgress([
            makeAnalyst({ key: 'a1', displayName: 'Analyst A', status: 'analyzing' }),
            makeAnalyst({ key: 'a2', displayName: 'Analyst B', status: 'analyzing' }),
        ]);
        render(<EnsembleProgressChat progress={progress} isLive={true} />);
        expect(screen.getAllByText(/thinking/).length).toBeGreaterThan(0);
    });

    it('shows collapsible thinking + final output on expand (harness style)', () => {
        const progress = makeProgress([
            makeAnalyst({ key: 'a1', displayName: 'Analyst A', status: 'complete', reasoning: 'Chain of thought trace', finalOutput: 'Bullish call' }),
        ]);
        render(<EnsembleProgressChat progress={progress} />);
        openSeat('Analyst A');
        {
          const dialog2 = screen.getByRole('dialog', { name: 'Analyst A analysis' });
          expect(within(dialog2).getByText('Final output')).toBeDefined();
          expect(within(dialog2).getByText('Bullish call')).toBeDefined();
          expect(within(dialog2).getByText('Chain of thought trace').closest('details')?.open).toBe(false);
          fireEvent.click(within(dialog2).getByText(/Thinking/));
          expect(within(dialog2).getByText('Chain of thought trace').closest('details')?.open).toBe(true);
        }
    });

    it('opens live Thinking while an analyst is streaming', () => {
        const progress = makeProgress([
            makeAnalyst({ key: 'a1', displayName: 'Analyst A', status: 'analyzing', reasoning: 'Live trace in progress' }),
        ]);
        render(<EnsembleProgressChat progress={progress} isLive={true} />);
        openSeat('Analyst A');
        expect(screen.getAllByText('Thinking').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Live trace in progress')[0].closest('details')?.open).toBe(true);
        expect(screen.getAllByText('Bullish outlook').length).toBeGreaterThan(0);
    });

    it('renders a timeline for each analyst plus the moderator', () => {
        const progress = makeProgress([
            makeAnalyst({ key: 'a1', displayName: 'Macro', status: 'analyzing' }),
        ]);
        render(<EnsembleProgressChat progress={progress} isLive />);
        expect(screen.getByLabelText('Floor')).toBeDefined();
        expect(screen.getAllByText('Macro').length).toBeGreaterThan(0);
        expect(screen.getByText('Moderator')).toBeDefined();
    });

    it('opens a seat chat modal and closes it', () => {
        const progress = makeProgress([
            makeAnalyst({ key: 'a1', displayName: 'Analyst A', status: 'complete' }),
        ]);
        render(<EnsembleProgressChat progress={progress} />);
        expect(screen.queryByRole('dialog', { name: 'Analyst A analysis' })).toBeNull();
        openSeat('Analyst A');
        expect(screen.getByRole('dialog', { name: 'Analyst A analysis' })).toBeDefined();
        expect(screen.getAllByText(/Completed/).length).toBeGreaterThan(0);
        fireEvent.click(screen.getByLabelText('Close Analyst A analysis'));
        expect(screen.queryByRole('dialog', { name: 'Analyst A analysis' })).toBeNull();
    });

    it('collapses the modal when the header is clicked', () => {
        const progress = makeProgress([
            makeAnalyst({ key: 'a1', displayName: 'Analyst A', status: 'complete' }),
        ]);
        render(<EnsembleProgressChat progress={progress} />);
        openSeat('Analyst A');
        fireEvent.click(screen.getByLabelText('Collapse Analyst A analysis'));
        expect(screen.queryByRole('dialog', { name: 'Analyst A analysis' })).toBeNull();
    });

    it('opens the seat modal from the roster', () => {
        const progress = makeProgress([makeAnalyst({ key: 'a1', displayName: 'Analyst A', status: 'analyzing', reasoning: 'Weigh the sweep.' })]);
        render(<EnsembleProgressChat progress={progress} isLive />);
        openSeat('Analyst A');
        expect(screen.getByRole('dialog', { name: 'Analyst A analysis' })).toBeDefined();
    });

    it('defaults to the flat thread view', () => {
        const progress = makeProgress([
            makeAnalyst({ key: 'a1', displayName: 'Analyst A', status: 'complete' }),
        ]);
        render(<EnsembleProgressChat progress={progress} />);
        // Default: flat roster, no animated stage, no expand/collapse controls.
        expect(screen.getByText('Analyst A')).toBeDefined();
        expect(document.querySelector('.debate-floor-body')).toBeDefined();
        expect(document.querySelector('.debate-stage')).toBeNull();
        // The stage (and its seat-modal trigger) is opt-in.
        expect(screen.getByLabelText('Open Analyst A analysis')).toBeDefined();
        expect(screen.queryByLabelText('Expand Analyst A analysis')).toBeNull();
        expect(screen.queryByLabelText('Collapse Analyst A analysis')).toBeNull();
    });

    it('renders debate turns as a chronological group-chat thread by default', () => {
        const progress = makeProgress([
            makeAnalyst({ key: 'a1', displayName: 'Analyst A', status: 'complete' }),
            makeAnalyst({ key: 'a2', displayName: 'Analyst B', status: 'complete' }),
        ]);
        render(
            <EnsembleProgressChat
                progress={progress}
                debateTurns={[
                    { speaker: 'Analyst A', text: 'Long above the reclaim.', round: 1, createdAt: new Date(Date.now() - 120_000).toISOString() },
                    { speaker: 'Analyst B', text: 'I fade it — sellers hold 73k.', round: 1, createdAt: new Date(Date.now() - 60_000).toISOString() },
                ]}
            />,
        );
        // Thread rows show speaker name + relative time + plain body.
        expect(screen.getByText('Analyst A')).toBeDefined();
        expect(screen.getByText('Analyst B')).toBeDefined();
        expect(screen.getByText(/2 min ago/)).toBeDefined();
        expect(screen.getByText(/Long above the reclaim\./)).toBeDefined();
        expect(screen.getByText(/I fade it — sellers hold 73k\./)).toBeDefined();
        // The per-seat lanes are hidden until the user toggles Seats.
        expect(screen.queryByText('Filter bots')).toBeNull();
    });

    it('shows "{name} is thinking…" for a live speaker without text yet', () => {
        const progress = makeProgress([
            makeAnalyst({ key: 'a1', displayName: 'Analyst A', status: 'analyzing' }),
        ]);
        render(
            <EnsembleProgressChat
                progress={progress}
                isLive
                activeDebateSpeakers={{ 'Analyst A': 2 }}
                debateTurns={[
                    { speaker: 'Moderator', text: 'Defend or drop the long.', round: 2 },
                ]}
            />,
        );
        expect(screen.getByText(/Analyst A is thinking…/)).toBeDefined();
    });

    it('opens the seat modal from a thread row and switches to the lanes view', () => {
        const progress = makeProgress([
            makeAnalyst({ key: 'a1', displayName: 'Analyst A', status: 'complete', finalOutput: 'Opening call' }),
        ]);
        render(
            <EnsembleProgressChat
                progress={progress}
                debateTurns={[{ speaker: 'Analyst A', text: 'Opening call.', round: 1 }]}
            />,
        );
        fireEvent.click(screen.getByLabelText('Open Analyst A analysis'));
        expect(screen.getByRole('dialog', { name: 'Analyst A analysis' })).toBeDefined();

        fireEvent.click(screen.getByRole('button', { name: 'seats' }));
        expect(screen.getByPlaceholderText('Filter bots')).toBeDefined();
        fireEvent.click(screen.getByRole('button', { name: 'thread' }));
        // The thread row is back (the modal may still be up, hence getAll).
        expect(screen.getAllByText(/Opening call\./).length).toBeGreaterThan(0);
    });

    it('does not label openings as reply-to tape', () => {
        const progress = makeProgress([
            makeAnalyst({ key: 'a1', displayName: 'Analyst A', status: 'complete', finalOutput: 'Bullish outlook' }),
        ]);
        render(<EnsembleProgressChat progress={progress} />);
        openSeat('Analyst A');
        expect(screen.queryByText(/reply to tape/i)).toBeNull();
        expect(screen.getAllByText('Bullish outlook').length).toBeGreaterThan(0);
    });

    it('labels rebuttals as reply to Moderator only', () => {
        const progress = makeProgress([
            makeAnalyst({ key: 'a1', displayName: 'Analyst A', status: 'complete', finalOutput: 'Opening call' }),
        ]);
        render(
            <EnsembleProgressChat
                progress={progress}
                debateTurns={[{
                    speaker: 'Analyst A',
                    text: 'I still fade the wick.',
                    round: 2,
                }]}
            />,
        );
        openSeat('Analyst A');
        expect(screen.getAllByText('reply to Moderator').length).toBeGreaterThan(0);
        expect(screen.queryByText(/reply to tape/i)).toBeNull();
    });

    it('splits moderator turns into reply-to blocks', () => {
        const progress = makeProgress([
            makeAnalyst({ key: 'a1', displayName: 'Macro Analyst', status: 'complete' }),
            makeAnalyst({ key: 'a2', displayName: 'Technical Analyst', status: 'complete' }),
        ]);
        render(
            <EnsembleProgressChat
                progress={progress}
                debateTurns={[{
                    speaker: 'Moderator',
                    text: 'Macro Analyst: Fix the entry.\nTechnical Analyst: Hold the sweep high.',
                    round: 4,
                }]}
            />,
        );
        openSeat('Moderator');
        expect(screen.getAllByText('reply to Macro Analyst').length).toBeGreaterThan(0);
        expect(screen.getAllByText('reply to Technical Analyst').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Fix the entry.').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Fix the entry.')[0].closest('.border')).toBeDefined();
        expect(screen.getAllByText('Hold the sweep high.')[0].closest('.border')).toBeDefined();
    });

    it('keeps streamed moderator CoT in Thinking, not in the reply', () => {
        const progress = makeProgress([
            makeAnalyst({ key: 'a1', displayName: 'Analyst A', status: 'complete' }),
        ]);
        render(
            <EnsembleProgressChat
                progress={progress}
                reasoningProcesses={{ moderator: 'Weigh size before asking about entry.' }}
                debateTurns={[{
                    speaker: 'Moderator',
                    text: 'What is the entry?',
                    reasoning: 'Ask for a number, not a vibe.',
                }]}
            />,
        );
        openSeat('Moderator');
        expect(screen.getAllByText('What is the entry?').length).toBeGreaterThan(0);
        expect(screen.getAllByText(/Ask for a number, not a vibe/)[0].closest('details')).toBeDefined();
        expect(screen.getAllByText(/Weigh size before asking about entry/)[0].closest('details')).toBeDefined();
        expect(screen.getAllByText('What is the entry?')[0].closest('details')).toBeNull();
    });

    it('shows live moderator thinking in the modal', () => {
        const progress = makeProgress([
            makeAnalyst({ key: 'a1', displayName: 'Analyst A', status: 'complete' }),
        ]);
        render(
            <EnsembleProgressChat
                progress={progress}
                isLive
                activeDebateSpeakers={{ Moderator: 2 }}
                reasoningProcesses={{ moderator: 'Weigh size before asking about entry.' }}
            />,
        );
        openSeat('Moderator');
        expect(screen.getAllByText(/Weigh size before asking about entry/)[0].closest('details')).toBeDefined();
        expect(screen.getAllByText(/Weigh size before asking about entry/)[0].closest('.mx-2')).toBeNull();
    });

    it.skip('keeps moderator thinking visible while questions fly to receivers', async () => {
        const progress = makeProgress([
            makeAnalyst({ key: 'a1', displayName: 'Macro Analyst', status: 'complete' }),
            makeAnalyst({ key: 'a2', displayName: 'Technical Analyst', status: 'complete' }),
        ]);
        const { container } = render(
            <EnsembleProgressChat
                progress={progress}
                isLive
                activeDebateSpeakers={{ Moderator: 4 }}
                reasoningProcesses={{ moderator: 'Weigh size before asking about entry.' }}
                debateTurns={[{
                    speaker: 'Moderator',
                    text: 'Macro Analyst: Fix the entry.\nTechnical Analyst: Hold the sweep high.',
                    round: 4,
                }]}
            />,
        );
        expect(container.querySelector('[data-thought]')?.getAttribute('data-thought')).toMatch(/Weigh size/);
        await waitFor(() => {
            expect(container.querySelector('.debate-stage-packet')?.getAttribute('data-packet')).toMatch(/Fix the entry/i);
        });
        openSeat('Moderator');
        expect(screen.getAllByText(/Weigh size before asking about entry/)[0].closest('details')).toBeDefined();
    });

    it('keeps the live round open and collapses earlier rounds', () => {
        const progress = makeProgress([
            makeAnalyst({ key: 'a1', displayName: 'Analyst A', status: 'analyzing', finalOutput: 'Opening call' }),
        ]);
        render(
            <EnsembleProgressChat
                progress={progress}
                isLive
                activeDebateSpeakers={{ 'Analyst A': 2 }}
                debateTurns={[{
                    speaker: 'Analyst A',
                    text: 'I still fade the wick.',
                    round: 2,
                }]}
            />,
        );
        openSeat('Analyst A');
        expect(screen.getAllByText('I still fade the wick.').length).toBeGreaterThan(0);
        expect(screen.getAllByText('I still fade the wick.')[0].closest('details')).toBeNull();
        expect(screen.getAllByText('Opening call')[0].closest('details')?.open).toBe(false);
        fireEvent.click(screen.getAllByText(/Openings ·/)[0]);
        expect(screen.getAllByText('Opening call')[0].closest('details')?.open).toBe(true);
    });

    it('does not paint Thinking into the Final output bubble', () => {
        const cot = 'Weigh HTF vs LTF and fade the failed sweep.';
        const progress = makeProgress([
            makeAnalyst({
                key: 'a1',
                displayName: 'Analyst A',
                status: 'complete',
                reasoning: cot,
                finalOutput: `${cot}\n\n**Direction:** Short\n**Entry:** 63748\n**Stop Loss:** 63971\n**Take Profit 1:** 63251`,
            }),
        ]);
        render(<EnsembleProgressChat progress={progress} />);
        openSeat('Analyst A');
        {
          const dialog = screen.getByRole('dialog', { name: 'Analyst A analysis' });
          expect(within(dialog).getByText('Final output')).toBeDefined();
          expect(within(dialog).getByText(/Weigh HTF vs LTF/).closest('details')).toBeDefined();
        }
        {
          const dialog = screen.getByRole('dialog', { name: 'Analyst A analysis' });
          expect(within(dialog).getByText(/Weigh HTF vs LTF/).closest('.mx-2')).toBeNull();
          expect(within(dialog).getByText(/Direction/).closest('.mx-2')).toBeDefined();
        }
    });

    it('does not label a live debate reply as Final output', () => {
        const progress = makeProgress([
            makeAnalyst({ key: 'a1', displayName: 'Analyst A', status: 'complete', finalOutput: 'Opening call' }),
        ]);
        render(
            <EnsembleProgressChat
                progress={progress}
                isLive
                activeDebateSpeakers={{ 'Analyst A': 2 }}
                debateTurns={[{
                    speaker: 'Analyst A',
                    text: 'I still fade the wick.',
                    round: 2,
                }]}
            />,
        );
        openSeat('Analyst A');
        {
          const dialog = screen.getByRole('dialog', { name: 'Analyst A analysis' });
          expect(within(dialog).getAllByText('Opening call')[0].closest('.mx-2')?.textContent).toMatch(/Final output/);
          expect(within(dialog).getAllByText('I still fade the wick.')[0].closest('.mx-2')?.textContent).not.toMatch(/Final output/);
        }
    });

    it('parks a prompt-echo clarification dump in Thinking, not Final output', () => {
        const dump = `Here's a thinking process:

Analyze User Input: I'm in a debate/ensemble scenario. Role: Risk & Execution Specialist. Current Round: Round 5. Moderator's question: "State TP2 and TP3." There's a LIVE PRICE REFRESH note. I need to answer directly, 60-100 words max.

Deconstruct the Context: Entry 63694 SL 63420.`;
        const progress = makeProgress([
            makeAnalyst({ key: 'a1', displayName: 'Risk & Execution Specialist', status: 'complete', finalOutput: '' }),
        ]);
        render(
            <EnsembleProgressChat
                progress={progress}
                debateTurns={[{ speaker: 'Risk & Execution Specialist', text: dump, round: 5 }]}
            />,
        );
        openSeat('Risk & Execution Specialist');
        expect(screen.getAllByText('Thinking').length).toBeGreaterThan(0);
        expect(screen.getAllByText(/Analyze User Input/i)[0].closest('details')).toBeDefined();
        expect(screen.queryByText('Final output')).toBeNull();
        expect(screen.getAllByText(/Analyze User Input/i)[0].closest('.mx-2')).toBeNull();
    });

    it('shows a finished scratchpad-only seat as "No public answer" instead of hiding it', () => {
        const progress = makeProgress([
            makeAnalyst({ key: 'a1', displayName: 'Analyst A', status: 'complete', finalOutput: '' }),
        ]);
        render(
            <EnsembleProgressChat
                progress={progress}
                debateTurns={[{
                    speaker: 'Analyst A',
                    text: "Here's a thinking process:\n\nAnalyze User Input: debate turn.",
                    round: 3,
                }]}
            />,
        );
        openSeat('Analyst A');
        {
          const dialog = screen.getByRole('dialog', { name: 'Analyst A analysis' });
          expect(within(dialog).getByText(/No public answer/i)).toBeDefined();
        }
    });

    it('renders bot avatars in the flat roster', () => {
        const progress = makeProgress([
            makeAnalyst({ key: 'a1', displayName: 'Analyst A', status: 'analyzing', reasoning: 'Weigh the sweep.' }),
        ]);
        const { container } = render(<EnsembleProgressChat progress={progress} isLive />);
        expect(container.querySelectorAll('.bot-avatar').length).toBeGreaterThan(1);
        expect(screen.queryByRole('dialog')).toBeNull();
        openSeat('Analyst A');
        expect(screen.getByRole('dialog', { name: 'Analyst A analysis' })).toBeDefined();
        expect(screen.getAllByText(/Weigh the sweep/)[0].closest('details')).toBeDefined();
        expect(screen.getAllByText(/Weigh the sweep/)[0].closest('.mx-2')).toBeNull();
    });

    it('gives each model a distinct bot fill and keeps the moderator black', () => {
        expect(botFillForKey('moderator')).toBe('#111111');
        expect(botFillForKey('gemini-2.0-flash')).not.toBe(botFillForKey('deepseek-v4-flash'));
        expect(botFillForKey('gemini-2.0-flash')).toBe(botFillForKey('gemini-2.0-flash'));
    });

    it('opens thinking and output in a chat modal', () => {
        const progress = makeProgress([
            makeAnalyst({ key: 'a1', displayName: 'Analyst A', status: 'analyzing', reasoning: 'Weigh the sweep and the failed reclaim.' }),
        ]);
        render(<EnsembleProgressChat progress={progress} isLive />);
        openSeat('Analyst A');
        const dialog = screen.getByRole('dialog', { name: 'Analyst A analysis' });
        expect(dialog.textContent).toMatch(/Weigh the sweep and the failed reclaim/);
        fireEvent.click(screen.getByLabelText('Close Analyst A analysis'));
        expect(screen.queryByRole('dialog', { name: 'Analyst A analysis' })).toBeNull();
    });

    it.skip('flies a reply packet from the speaker to the receiver and shows sent!', async () => {});

    it('opens the seat modal from the roster row', () => {
        const progress = makeProgress([
            makeAnalyst({ key: 'a1', displayName: 'Analyst A', status: 'complete', finalOutput: 'Opening call' }),
        ]);
        render(
            <EnsembleProgressChat
                progress={progress}
                isLive
                activeDebateSpeakers={{ 'Analyst A': 2 }}
                debateTurns={[{ speaker: 'Analyst A', text: 'I still fade the wick.', round: 2 }]}
            />,
        );
        openSeat('Analyst A');
        expect(screen.getByRole('dialog', { name: 'Analyst A analysis' })).toBeDefined();
    });

    it('keeps the seat in thinking state while CoT streams before any output', () => {
        const progress = makeProgress([
            makeAnalyst({ key: 'a1', displayName: 'Analyst A', status: 'analyzing', finalOutput: '', reasoning: 'Weighing the failed reclaim.' }),
        ]);
        render(
            <EnsembleProgressChat
                progress={progress}
                isLive
                activeDebateSpeakers={{ 'Analyst A': 1 }}
                debateTurns={[{ speaker: 'Analyst A', text: '', reasoning: 'Weighing the failed reclaim.', round: 1 }]}
            />,
        );
        expect(screen.getAllByText(/Thinking/).length).toBeGreaterThan(0);
        openSeat('Analyst A');
        expect(screen.getAllByText(/Weighing the failed reclaim/)[0].closest('details')).toBeDefined();
    });

    it('shows speaking output once text streams', () => {
        const progress = makeProgress([makeAnalyst({ key: 'a1', displayName: 'Analyst A', status: 'analyzing' })]);
        render(<EnsembleProgressChat progress={progress} isLive activeDebateSpeakers={{ 'Analyst A': 1 }} debateTurns={[{ speaker: 'Analyst A', text: 'Long the breakout with SL below 95k.', round: 1 }]} />);
        expect(screen.getByText(/Long the breakout/)).toBeDefined();
    });

    it('shows streamed text without ticker reset', () => {
        const progress = makeProgress([makeAnalyst({ key: 'a1', displayName: 'Analyst A', status: 'analyzing' })]);
        const { rerender } = render(<EnsembleProgressChat progress={progress} isLive activeDebateSpeakers={{ 'Analyst A': 1 }} debateTurns={[{ speaker: 'Analyst A', text: 'Long the breakout.', round: 1 }]} />);
        expect(screen.getByText(/Long the breakout/)).toBeDefined();
        rerender(<EnsembleProgressChat progress={progress} isLive activeDebateSpeakers={{ 'Analyst A': 1 }} debateTurns={[{ speaker: 'Analyst A', text: 'Long the breakout, stop below support.', round: 1 }]} />);
        expect(screen.getByText(/Long the breakout, stop below support/)).toBeDefined();
    });
});
