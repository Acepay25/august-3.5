import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import AnalysisDetails from '../components/chat/AnalysisDetails';
import { TradeAnalysis, TradeOutcome } from '../types';

vi.mock('../components/analysis/ShareMenu', () => ({
    default: () => <span>Share</span>,
}));

vi.mock('../components/analysis/SetupWatchControl', () => ({
    default: () => <button type="button">Re-debate</button>,
}));

const analysis = {
    coinName: 'BTCUSDT',
    direction: 'Long',
    confidence: 'Medium',
    probability: 62,
} as TradeAnalysis;

describe('AnalysisDetails next steps', () => {
    beforeEach(() => {
        localStorage.setItem('august_next_steps_hint_dismissed', 'true');
    });

    it('shows Win, Loss, Skip, and Pin as primary actions', () => {
        const onLog = vi.fn();
        const onSkip = vi.fn();
        const onPin = vi.fn();
        render(
            <AnalysisDetails
                messageId="m1"
                analysis={analysis}
                outcome={TradeOutcome.PENDING}
                onLogTrade={onLog}
                onSkipTrade={onSkip}
                onToggleWatch={onPin}
            />,
        );
        fireEvent.click(screen.getByText('Skip'));
        expect(onSkip).toHaveBeenCalledWith('m1');
        fireEvent.click(screen.getByText('Pin'));
        expect(onPin).toHaveBeenCalledWith('m1');
        expect(screen.getByText('Re-debate')).toBeDefined();
        expect(screen.getByText('More')).toBeDefined();
        fireEvent.click(screen.getByText('More'));
        expect(screen.getByText('Set alerts')).toBeDefined();
        expect(screen.queryByText('View Probabilities')).toBeNull();
    });

    it('labels an already pinned setup as Pinned', () => {
        render(
            <AnalysisDetails
                messageId="m1"
                analysis={analysis}
                outcome={TradeOutcome.PENDING}
                onLogTrade={vi.fn()}
                watched
                onToggleWatch={vi.fn()}
            />,
        );
        expect(screen.getByText('Pinned')).toBeDefined();
    });
});
