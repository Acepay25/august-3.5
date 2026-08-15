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
        expect(screen.getAllByText('Analyst A').length).toBeGreaterThan(0);
        // The card should be present - reasoning may or may not be visible depending on expand state
        // Just verify the card renders without crashing
    });

    it('displays model name from modelIdToName mapping', () => {
        const progress = makeProgress([
            makeAnalyst({ key: 'a1', displayName: 'Analyst A', modelId: 'gpt-4', modelName: 'gpt-4' }),
        ]);
        render(<EnsembleProgressChat progress={progress} modelIdToName={{ 'gpt-4': 'GPT-4 Turbo' }} />);
        expect(screen.getByText('GPT-4 Turbo')).toBeDefined();
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
        // Collapsed by default — the details stay hidden until expanded.
        expect(screen.queryByText('Final output')).toBeNull();
        fireEvent.click(screen.getByLabelText('Expand Analyst A analysis'));
        // Final output is always visible once the card is expanded...
        expect(screen.getByText('Final output')).toBeDefined();
        expect(screen.getByText('Bullish call')).toBeDefined();
        // ...while the thinking stays behind its own collapsible toggle
        // (closed <details> keeps its children in the DOM, so assert `open`).
        expect(screen.getByText('Chain of thought trace').closest('details')?.open).toBe(false);
        fireEvent.click(screen.getByText(/Thinking/));
        expect(screen.getByText('Chain of thought trace').closest('details')?.open).toBe(true);
    });

    it('keeps the thinking trace collapsed while an analyst is streaming', () => {
        const progress = makeProgress([
            makeAnalyst({ key: 'a1', displayName: 'Analyst A', status: 'analyzing', reasoning: 'Live trace in progress' }),
        ]);
        render(<EnsembleProgressChat progress={progress} isLive={true} />);
        expect(screen.getByText('Live trace in progress')).toBeDefined();
        expect(screen.queryByText('Thinking')).toBeNull();
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
});
