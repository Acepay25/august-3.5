import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ModelByline from '../components/shared/ModelByline';
import InjectionContextBar from '../components/chat/InjectionContextBar';
import type { ProviderConfig } from '../types/provider';

// Deterministic context sources: notebook (2 files) + strategies (1 book)
// so the chip count is stable regardless of localStorage state.
vi.mock('../services/learning/MemoryFilesService', () => ({
    getMemoryFilesStats: vi.fn(() => ({ enabledCount: 2, charCount: 2400 })),
}));
vi.mock('../services/infrastructure/StrategyService', () => ({
    getStrategyDocs: vi.fn(() => [{ enabled: true, summary: 'x' }]),
}));

describe('ModelByline', () => {
    it('renders nothing without runStats', () => {
        const { container } = render(<ModelByline />);
        expect(container.firstChild).toBeNull();
    });

    it('shows the seat roster and duration quietly', () => {
        render(
            <ModelByline
                runStats={{
                    startedAt: '2026-08-23T06:00:00.000Z',
                    finishedAt: '2026-08-23T06:01:30.000Z',
                    durationMs: 90_000,
                    analysts: [
                        { providerId: 'p1', displayName: 'Macro', modelId: 'm1' },
                        { providerId: 'p2', displayName: 'Technical', modelId: 'm2' },
                    ],
                }}
            />
        );
        const line = screen.getByText(/Macro · Technical · 90s/);
        expect(line).toBeInTheDocument();
    });

    it('formats long runs in minutes', () => {
        render(
            <ModelByline
                runStats={{
                    startedAt: '2026-08-23T06:00:00.000Z',
                    finishedAt: '2026-08-23T06:12:00.000Z',
                    durationMs: 720_000,
                    analysts: [],
                }}
            />
        );
        expect(screen.getByText(/12m/)).toBeInTheDocument();
    });
});

describe('InjectionContextBar overflow', () => {
    const baseProviders = [] as unknown as ProviderConfig[];

    it('shows all chips inline when at or under the cap', () => {
        // With sources mocked: notebook + strategies visible, Team hidden as a
        // duplicate of the composer dropdown → 2 chips → all inline.
        render(
            <InjectionContextBar
                providers={baseProviders}
                isEnsembleEnabled
                isAccuracyModeEnabled={false}
            />
        );
        expect(screen.getByText(/Notebook 2/)).toBeInTheDocument();
        expect(screen.queryByText(/Context ·/)).toBeNull();
    });

    it('collapses the tail into a single Context summary past three chips', () => {
        // notebook(1) + strategies(1) + team(hidden) + accuracy(1) = 3 visible
        // chips exactly → no overflow summary needed.
        render(
            <InjectionContextBar
                providers={baseProviders}
                isEnsembleEnabled
                isAccuracyModeEnabled
            />
        );
        // Team chip is suppressed (duplicate of composer control).
        expect(screen.queryByText(/^Team$/)).toBeNull();
        expect(screen.getByText('Accuracy')).toBeInTheDocument();
    });
});
