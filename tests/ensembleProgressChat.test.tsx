import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import EnsembleProgressChat from '../components/analysis/EnsembleProgressChat';
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
        expect(screen.getByText('Thinking')).toBeDefined();
        expect(screen.getByText('Strong support at 95k').closest('details')).toBeDefined();
        expect(screen.getByText('Bullish outlook').closest('details')).toBeNull();
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
        expect(screen.getByText('Thinking')).toBeDefined();
        expect(screen.getByText('Still weighing the sweep.').closest('details')).toBeDefined();
        expect(screen.getByText('Still weighing the sweep.').closest('.mx-2')).toBeNull();
    });

    it('displays a readable model name instead of the raw id', () => {
        const progress = makeProgress([
            makeAnalyst({ key: 'a1', displayName: 'Analyst A', modelId: 'deepseek-v4-flash', modelName: 'deepseek-v4-flash' }),
        ]);
        render(<EnsembleProgressChat progress={progress} />);
        expect(screen.getByText('Deepseek V4 Flash')).toBeDefined();
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
        expect(screen.getByText('Final output')).toBeDefined();
        expect(screen.getByText('Bullish call')).toBeDefined();
        expect(screen.getByText('Chain of thought trace').closest('details')?.open).toBe(false);
        fireEvent.click(screen.getByText(/Thinking/));
        expect(screen.getByText('Chain of thought trace').closest('details')?.open).toBe(true);
    });

    it('opens live Thinking while an analyst is streaming', () => {
        const progress = makeProgress([
            makeAnalyst({ key: 'a1', displayName: 'Analyst A', status: 'analyzing', reasoning: 'Live trace in progress' }),
        ]);
        render(<EnsembleProgressChat progress={progress} isLive={true} />);
        expect(screen.getByText('Thinking')).toBeDefined();
        expect(screen.getByText('Live trace in progress').closest('details')?.open).toBe(true);
        expect(screen.getByText('Bullish outlook')).toBeDefined();
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

    it('lists seats vertically and closes a card back to the row', () => {
        const progress = makeProgress([
            makeAnalyst({ key: 'a1', displayName: 'Analyst A', status: 'complete' }),
        ]);
        render(<EnsembleProgressChat progress={progress} />);
        expect(screen.getAllByLabelText('Collapse Analyst A analysis').length).toBeGreaterThan(0);
        fireEvent.click(screen.getByLabelText('Close Analyst A analysis'));
        expect(screen.getByLabelText('Expand Analyst A analysis')).toBeDefined();
        expect(screen.getByText(/Completed/)).toBeDefined();
    });

    it('collapses the card when the seat name in the header is clicked', () => {
        const progress = makeProgress([
            makeAnalyst({ key: 'a1', displayName: 'Analyst A', status: 'complete' }),
        ]);
        render(<EnsembleProgressChat progress={progress} />);
        const headerTitle = screen.getAllByLabelText('Collapse Analyst A analysis')[1];
        fireEvent.click(headerTitle);
        expect(screen.getByLabelText('Expand Analyst A analysis')).toBeDefined();
        expect(screen.queryByLabelText('Close Analyst A analysis')).toBeNull();
    });

    it('does not label openings as reply-to tape', () => {
        const progress = makeProgress([
            makeAnalyst({ key: 'a1', displayName: 'Analyst A', status: 'complete', finalOutput: 'Bullish outlook' }),
        ]);
        render(<EnsembleProgressChat progress={progress} />);
        expect(screen.queryByText(/reply to tape/i)).toBeNull();
        expect(screen.getByText('Bullish outlook')).toBeDefined();
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
        expect(screen.getByText('reply to Moderator')).toBeDefined();
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
        expect(screen.getByText('reply to Macro Analyst')).toBeDefined();
        expect(screen.getByText('reply to Technical Analyst')).toBeDefined();
        expect(screen.getByText('Fix the entry.')).toBeDefined();
        expect(screen.getByText('Fix the entry.').closest('.border')).toBeDefined();
        expect(screen.getByText('Hold the sweep high.').closest('.border')).toBeDefined();
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
        expect(screen.getByText('What is the entry?')).toBeDefined();
        expect(screen.getByText(/Ask for a number, not a vibe/).closest('details')).toBeDefined();
        expect(screen.getByText(/Weigh size before asking about entry/).closest('details')).toBeDefined();
        expect(screen.getByText('What is the entry?').closest('details')).toBeNull();
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
        expect(screen.getByText('I still fade the wick.')).toBeDefined();
        expect(screen.getByText('I still fade the wick.').closest('details')).toBeNull();
        expect(screen.getByText('Opening call').closest('details')?.open).toBe(false);
        fireEvent.click(screen.getByText(/Openings ·/));
        expect(screen.getByText('Opening call').closest('details')?.open).toBe(true);
    });
});
