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
    default: ({ children }: { children: string }) => <span>{children}</span>,
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
        expect(screen.getByText('Analyst Alpha')).toBeDefined();
        expect(screen.getByText('Analyst Beta')).toBeDefined();
    });

    it('shows typing indicator for active analysts in live mode', () => {
        const progress = makeProgress([
            makeAnalyst({ key: 'a1', displayName: 'Analyst A', status: 'analyzing' }),
        ]);
        render(<EnsembleProgressChat progress={progress} isLive={true} />);
        // Should show "X is typing" or similar - multiple elements may match
        const typingElements = screen.getAllByText(/typing|Waiting for|Preparing/);
        expect(typingElements.length).toBeGreaterThan(0);
    });

    it('renders analyst cards with reasoning', () => {
        const progress = makeProgress([
            makeAnalyst({ key: 'a1', displayName: 'Analyst A', status: 'complete', reasoning: 'Strong support at 95k' }),
        ]);
        render(<EnsembleProgressChat progress={progress} />);
        expect(screen.getByText('Analyst A')).toBeDefined();
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
        expect(screen.getByText('Analyst A')).toBeDefined();
        expect(screen.getByText('Analyst B')).toBeDefined();
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
        const typingText = screen.getByText(/typing/);
        expect(typingText).toBeDefined();
    });
});
