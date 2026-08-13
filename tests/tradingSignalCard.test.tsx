import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import TradingSignalCard from '../components/analysis/TradingSignalCard';
import { TradeAnalysis } from '../types';

vi.mock('../components/shared/MarkdownContent', () => ({
    default: ({ content }: { content?: string }) => <div data-testid="md">{content}</div>,
}));

const analysis = (overrides: Partial<TradeAnalysis> = {}): TradeAnalysis => ({
    direction: 'Short',
    confidence: 'Avoid',
    probability: 58,
    entryPoints: [{ price: '63710' }],
    stopLoss: '64510',
    takeProfit: [{ price: '63210' }, { price: '62710' }, { price: '62200' }],
    rrRatio: 0.6,
    levelProbabilities: {
        slProbability: 28,
        slReasoning: { indicatorBasis: '', volatilityFactor: '', patternMemoryInfluence: '', aiAdjustments: '' },
        tpProbabilities: [
            { level: 1, probability: 62, reasoning: { indicatorBasis: '', volatilityFactor: '', patternMemoryInfluence: '', aiAdjustments: '' } },
            { level: 2, probability: 44, reasoning: { indicatorBasis: '', volatilityFactor: '', patternMemoryInfluence: '', aiAdjustments: '' } },
            { level: 3, probability: 28, reasoning: { indicatorBasis: '', volatilityFactor: '', patternMemoryInfluence: '', aiAdjustments: '' } },
        ],
    },
    strategy: 'Macro: You cite 1H HH/HL? Technical: Cite 15m? Risk: What SL?',
    ...overrides,
} as TradeAnalysis);

describe('TradingSignalCard', () => {
    it('renders colored levels and a structured final plan', () => {
        render(<TradingSignalCard analysis={analysis()} />);
        expect(screen.getByText('Trading signal')).toBeDefined();
        expect(screen.getAllByText('Sell').length).toBeGreaterThanOrEqual(1);
        expect(screen.getByText('63,710')).toBeDefined();
        expect(screen.getByText('64,510')).toBeDefined();
        expect(screen.getByText('63,210')).toBeDefined();
        expect(screen.getByText('62,710')).toBeDefined();
        expect(screen.getByText('62,200')).toBeDefined();
        expect(screen.getAllByText('28% hit').length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText('62% hit').length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText('44% hit').length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText('1:0.6').length).toBeGreaterThanOrEqual(1);
        expect(screen.getByText('Final trade plan')).toBeDefined();
        expect(screen.getByText('Take Profit 3:')).toBeDefined();
        expect(screen.getByText('Stop Loss:')).toBeDefined();
        expect(screen.queryByText(/What SL/)).toBeNull();
    });

    it('recovers hit odds from the moderator plan when levelProbabilities is missing', () => {
        render(
            <TradingSignalCard
                analysis={analysis({
                    levelProbabilities: undefined,
                    strategy: '**FINAL TRADE PLAN**\n- **SL Probability:** 31%\n- **TP1 Probability:** 68%\n- **TP2 Probability:** 49%\n- **TP3 Probability:** 22%',
                })}
            />,
        );
        expect(screen.getAllByText('31% hit').length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText('68% hit').length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText('49% hit').length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText('22% hit').length).toBeGreaterThanOrEqual(1);
    });

    it('shows the last moderator verdict as strategy, not clarification', () => {
        render(
            <TradingSignalCard
                analysis={analysis()}
                debateTurns={[
                    { speaker: 'Moderator', round: 4, text: 'Macro: What exact 1H BOS?\nTechnical: Cite 15m?\nRisk: What SL?' },
                    { speaker: 'Moderator', round: 6, text: 'Short from the 4H rejection.\n\n**FINAL TRADE PLAN**\n- Direction: Short' },
                ]}
            />,
        );
        expect(screen.getByTestId('md').textContent).toContain('Short from the 4H rejection');
        expect(screen.getByTestId('md').textContent).not.toContain('What exact 1H BOS');
        expect(screen.getByTestId('md').textContent).not.toContain('FINAL TRADE PLAN');
    });
});
