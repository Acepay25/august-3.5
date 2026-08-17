import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TradeAnalysis } from '../types';
import { WaitForConfirmationBanner, WhyAvoidPanel } from '../components/analysis/WhyAvoidPanel';

const makeAnalysis = (overrides: Partial<TradeAnalysis> = {}): TradeAnalysis => ({
    direction: 'Long',
    confidence: 'Avoid',
    probability: 45,
    strategy: '',
    activeStrategies: [],
    entryPoints: [{ price: '100', description: '' }],
    stopLoss: '95',
    takeProfit: [{ price: '110' }],
    marketConditions: { pattern: '', candleBehavior: '', timeframeAlignment: '', rsi: '', macd: '', sentiment: '' },
    historicalCorrelation: '',
    ...overrides,
});

describe('WhyAvoidPanel', () => {
    it('splits the verdict into hard blockers and confidence downgrades', () => {
        render(<WhyAvoidPanel analysis={makeAnalysis({
            riskVeto: 'GATE VETO: insufficient data — this signal must not be traded on its own.',
            validationWarnings: ['CALIBRATION ADJUSTMENT: Medium → Low', ' HARD VALIDATION: missing 1h klines'],
        })} />);
        expect(screen.getByText('Why Avoid?')).toBeDefined();
        expect(screen.getByText(/Hard blockers/)).toBeDefined();
        expect(screen.getByText(/GATE VETO/)).toBeDefined();
        expect(screen.getAllByText(/HARD VALIDATION/).length).toBeGreaterThan(0);
        expect(screen.getByText(/Confidence downgrades/)).toBeDefined();
        expect(screen.getAllByText(/CALIBRATION ADJUSTMENT/).length).toBeGreaterThan(0);
    });

    it('shows the condition that would make the setup valid', () => {
        render(<WhyAvoidPanel analysis={makeAnalysis({
            validationWarnings: ['CALIBRATION ADJUSTMENT: Medium → Low'],
            entryTimingScore: { score: 40, timingQuality: 'weak', suggestedEntry: { price: 102, reason: 'Wait for the 4H close above 101.5.' } },
        })} />);
        expect(screen.getByText(/Would be valid if/)).toBeDefined();
        expect(screen.getByText(/4H close above 101.5/)).toBeDefined();
    });

    it('renders the confidence timeline from original through final', () => {
        render(<WhyAvoidPanel analysis={makeAnalysis({
            originalConfidence: 'High',
            validationWarnings: ['CALIBRATION ADJUSTMENT: High → Low', 'GATE VETO: insufficient data'],
        })} />);
        expect(screen.getByText('Confidence timeline')).toBeDefined();
        expect(screen.getByText('Initial:')).toBeDefined();
        expect(screen.getByText('High')).toBeDefined();
        expect(screen.getByText('Final:')).toBeDefined();
        expect(screen.getByText('Avoid')).toBeDefined();
    });

    it('falls back to the flat no-trade line when nothing structured exists', () => {
        render(<WhyAvoidPanel analysis={makeAnalysis({ confidence: 'Avoid', validationWarnings: [] })} />);
        expect(screen.getByText('Why no trade')).toBeDefined();
        expect(screen.getByText(/Skip this setup/)).toBeDefined();
    });
});

describe('WaitForConfirmationBanner', () => {
    it('shows the trigger for a Low setup instead of treating it as Avoid', () => {
        render(<WaitForConfirmationBanner analysis={makeAnalysis({
            confidence: 'Low',
            entryTimingScore: { score: 40, timingQuality: 'weak', suggestedEntry: { price: 102, reason: 'Wait for the 4H close above 101.5.' } },
        })} />);
        expect(screen.getByText('Wait for confirmation')).toBeDefined();
        expect(screen.getByText(/4H close above 101.5/)).toBeDefined();
        expect(screen.getByText(/watch, not a no-trade/)).toBeDefined();
    });

    it('renders nothing when no trigger exists', () => {
        const { container } = render(<WaitForConfirmationBanner analysis={makeAnalysis({
            confidence: 'Low',
            validationWarnings: ['CALIBRATION ADJUSTMENT: Medium → Low'],
        })} />);
        expect(container.textContent).toBe('');
    });
});
