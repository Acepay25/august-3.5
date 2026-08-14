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
    it('renders colored levels without a duplicate plan list', () => {
        render(<TradingSignalCard analysis={analysis()} />);
        expect(screen.getByText('Trading signal')).toBeDefined();
        expect(screen.getAllByText('No trade').length).toBeGreaterThanOrEqual(1);
        expect(screen.getByText(/Skip this setup/)).toBeDefined();
        expect(screen.getByText('63,710')).toBeDefined();
        expect(screen.getByText('64,510')).toBeDefined();
        expect(screen.getByText('63,210')).toBeDefined();
        expect(screen.getByText('62,710')).toBeDefined();
        expect(screen.getByText('62,200')).toBeDefined();
        expect(screen.getAllByText('28% hit').length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText('62% hit').length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText('44% hit').length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText('1:0.6').length).toBeGreaterThanOrEqual(1);
        expect(screen.queryByText('Final trade plan')).toBeNull();
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

    it('does not dump the moderator verdict recap into strategy', () => {
        render(
            <TradingSignalCard
                analysis={analysis({
                    strategy: '**MODERATOR VERDICT** Direction: Long, based on the Technical Analyst’s verified sweep and the Risk & Execution Specialist’s ranging-market read. The Macro & Volatility Analyst failed to provide any short entry.',
                })}
                debateTurns={[
                    { speaker: 'Moderator', round: 6, text: '**MODERATOR VERDICT** Direction: Long, based on the Technical Analyst’s verified sweep and the Risk & Execution Specialist’s ranging-market read.' },
                ]}
            />,
        );
        expect(screen.queryByTestId('md')?.textContent ?? '').not.toContain('Technical Analyst');
        expect(screen.queryByTestId('md')?.textContent ?? '').not.toContain('MODERATOR VERDICT');
        expect(screen.queryByText('Final trade plan')).toBeNull();
    });

    it('shows a one-line invalidation from the parsed plan', () => {
        render(
            <TradingSignalCard
                analysis={analysis({
                    invalidationCriteria: [{ level: '64510', condition: '15m close above the sweep high' }],
                })}
            />,
        );
        expect(screen.getByText('Invalidation')).toBeDefined();
        expect(screen.getByText(/15m close above the sweep high/)).toBeDefined();
    });

    it('explains the Avoid / Medium / High label on the card', () => {
        render(
            <TradingSignalCard
                analysis={analysis({
                    confidence: 'Avoid',
                    probability: 38,
                    riskVeto: 'Incomplete take-profit ladder',
                })}
            />,
        );
        expect(screen.getByText('Confidence')).toBeDefined();
        expect(screen.getByText(/Avoid because/)).toBeDefined();
        expect(screen.getAllByText(/Incomplete take-profit ladder/).length).toBeGreaterThanOrEqual(1);
    });

    it('shows Sell for a Short with Medium confidence', () => {
        render(<TradingSignalCard analysis={analysis({ confidence: 'Medium' })} />);
        expect(screen.getAllByText('Sell').length).toBeGreaterThanOrEqual(1);
        expect(screen.queryByText('No trade')).toBeNull();
    });

    it('does not put Watch on the signal header (pin lives on next steps)', () => {
        render(
            <TradingSignalCard
                analysis={analysis({ confidence: 'Avoid' })}
            />,
        );
        expect(screen.queryByText('Watch')).toBeNull();
        expect(screen.queryByText('Pin')).toBeNull();
    });
});
