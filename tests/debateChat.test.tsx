import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DebateChat from '../components/analysis/DebateChat';
import { DebateTurn, TradeAnalysis } from '../types';

// Mock Icons module
vi.mock('../components/shared/Icons', () => ({
    BotIcon: () => <span data-testid="bot-icon" />,
    ChevronDownIcon: ({ className }: { className?: string }) => <span data-testid="chevron-icon" className={className} />,
    KebabMenuIcon: ({ className }: { className?: string }) => <span data-testid="kebab-icon" className={className} />,
}));

// Mock AnalystLensService
vi.mock('../services/ui/AnalystLensService', () => ({
    getRoleDisplayForProvider: () => ({ role: 'Technical', shortName: 'Technical', label: 'Technical Analyst' }),
}));

vi.mock('../components/shared/MarkdownContent', () => ({
    default: ({ content }: { content?: string }) => <div>{content}</div>,
}));

const makeTurn = (speaker: string, text: string, round?: number): DebateTurn => ({
    speaker: speaker as DebateTurn['speaker'],
    text,
    round,
    createdAt: '2025-01-01T12:00:00Z',
});

const baseProps = {
    debateTurns: [] as DebateTurn[],
    modelsUsed: {},
    reasoningProcesses: {},
    thoughtProcesses: {},
    modelIdToName: {},
    providerNameToId: {},
    isDebating: false,
    activeDebateSpeakers: {},
    analysis: null as TradeAnalysis | null,
};

const makeAnalysis = (overrides: Partial<TradeAnalysis> = {}): TradeAnalysis => ({
    direction: 'Long',
    confidence: 'High',
    probability: 78,
    strategy: 'Breakout retest',
    activeStrategies: ['Breakout'],
    entryPoints: [{ description: 'Retest', price: '95000' }],
    stopLoss: '94000',
    takeProfit: [{ price: '97000' }],
    marketConditions: { pattern: 'Ascending Triangle', candleBehavior: 'Bullish', timeframeAlignment: 'Aligned', rsi: '55', macd: 'Bullish', sentiment: 'Positive' },
    historicalCorrelation: 'High',
    rrRatio: 2.0,
    grade: 'A',
    ...overrides,
});

describe('DebateChat', () => {
    it('renders empty state with no turns', () => {
        render(<DebateChat {...baseProps} />);
        expect(screen.queryByText('Round 1')).toBeNull();
    });

    it('renders analyst and moderator turns', () => {
        const turns = [
            makeTurn('Macro Analyst', 'Bullish on BTC', 1),
            makeTurn('Technical Analyst', 'Bearish divergence', 1),
            makeTurn('Moderator', 'Both present valid points', 2),
        ];
        render(<DebateChat {...baseProps} debateTurns={turns} />);
        expect(screen.getByText('Macro Analyst')).toBeDefined();
        expect(screen.getByText('Technical Analyst')).toBeDefined();
        expect(screen.getByText('Strategist')).toBeDefined();
    });

    it('shows round separators', () => {
        const turns = [
            makeTurn('Analyst A', 'Opening', 1),
            makeTurn('Analyst B', 'Opening', 1),
            makeTurn('Analyst A', 'Rebuttal', 2),
        ];
        render(<DebateChat {...baseProps} debateTurns={turns} />);
        expect(screen.getAllByText('Openings').length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText('Rebuttals').length).toBeGreaterThanOrEqual(1);
    });

    it('labels clarification rounds with speaker context', () => {
        const turns = [
            makeTurn('Analyst A', 'Opening', 1),
            makeTurn('Moderator', 'What about volume?', 4),
            makeTurn('Analyst A', 'Volume is strong', 5),
            makeTurn('Moderator', 'Verdict: Long', 6),
        ];
        render(<DebateChat {...baseProps} debateTurns={turns} />);
        expect(screen.getByText('Clarification questions')).toBeDefined();
        expect(screen.getByText('Analyst responses')).toBeDefined();
    });

    it('shows Final Verdict label for the last moderator round', () => {
        const turns = [
            makeTurn('Analyst A', 'Opening', 1),
            makeTurn('Moderator', 'Final verdict: Long', 3),
        ];
        render(<DebateChat {...baseProps} debateTurns={turns} />);
        expect(screen.getByText('Final verdict')).toBeDefined();
    });

    it('shows TL;DR summary when analysis is provided and debate is complete', () => {
        const analysis = makeAnalysis();
        const turns = [
            makeTurn('Analyst A', 'Opening', 1),
            makeTurn('Moderator', 'Verdict', 2),
        ];
        render(<DebateChat {...baseProps} debateTurns={turns} analysis={analysis} isDebating={false} />);
        expect(screen.getByText('TL;DR')).toBeDefined();
        // "Long" appears in both consensus strip and TL;DR card
        expect(screen.getAllByText('Buy').length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText('High').length).toBeGreaterThanOrEqual(1);
    });

    it('does not show TL;DR while debating', () => {
        const analysis = makeAnalysis();
        const turns = [makeTurn('Analyst A', 'Opening', 1)];
        render(<DebateChat {...baseProps} debateTurns={turns} analysis={analysis} isDebating={true} />);
        expect(screen.queryByText('TL;DR')).toBeNull();
    });

    it('shows replay button when analysis is provided', () => {
        const analysis = makeAnalysis();
        const turns = [makeTurn('Analyst A', 'Opening', 1)];
        render(<DebateChat {...baseProps} debateTurns={turns} analysis={analysis} />);
        fireEvent.click(screen.getByLabelText('Debate actions'));
        expect(screen.getByText('Replay')).toBeDefined();
    });

    it('shows replay controls when replaying', () => {
        const analysis = makeAnalysis();
        const turns = [makeTurn('Analyst A', 'Opening', 1)];
        render(<DebateChat {...baseProps} debateTurns={turns} analysis={analysis} />);
        fireEvent.click(screen.getByLabelText('Debate actions'));
        fireEvent.click(screen.getByText('Replay'));
        expect(screen.getByText('Pause')).toBeDefined();
        expect(screen.getByText('Step')).toBeDefined();
        expect(screen.getByText('Exit')).toBeDefined();
    });

    it('shows speed controls during replay', () => {
        const analysis = makeAnalysis();
        const turns = [makeTurn('Analyst A', 'Opening', 1)];
        render(<DebateChat {...baseProps} debateTurns={turns} analysis={analysis} />);
        fireEvent.click(screen.getByLabelText('Debate actions'));
        fireEvent.click(screen.getByText('Replay'));
        expect(screen.getByText('0.5x')).toBeDefined();
        expect(screen.getByText('1x')).toBeDefined();
        expect(screen.getByText('2x')).toBeDefined();
    });

    it('shows jump-to-round buttons when multiple rounds exist', () => {
        const analysis = makeAnalysis();
        const turns = [
            makeTurn('Analyst A', 'Opening', 1),
            makeTurn('Analyst A', 'Rebuttal', 2),
            makeTurn('Analyst A', 'Response', 3),
        ];
        render(<DebateChat {...baseProps} debateTurns={turns} analysis={analysis} />);
        fireEvent.click(screen.getByLabelText('Debate actions'));
        fireEvent.click(screen.getByText('Replay'));
        expect(screen.getByText('R1')).toBeDefined();
        expect(screen.getByText('R2')).toBeDefined();
        expect(screen.getByText('R3')).toBeDefined();
    });

    it('shows thinking indicator during live debate', () => {
        const turns = [makeTurn('Analyst A', 'Opening', 1)];
        const activeSpeakers = { 'Analyst A': 2 };
        render(<DebateChat {...baseProps} debateTurns={turns} isDebating={true} activeDebateSpeakers={activeSpeakers} />);
        expect(screen.getByText(/writing/)).toBeDefined();
    });

    it('shows copy transcript button when analysis is provided', () => {
        const analysis = makeAnalysis();
        const turns = [makeTurn('Analyst A', 'Text', 1)];
        render(<DebateChat {...baseProps} debateTurns={turns} analysis={analysis} />);
        fireEvent.click(screen.getByLabelText('Debate actions'));
        expect(screen.getByText('Copy')).toBeDefined();
    });

    it('renders verdict turn with DECISION badge', () => {
        const turns = [
            makeTurn('Analyst A', 'Opening', 1),
            makeTurn('Moderator', 'Final: Long', 2),
        ];
        render(<DebateChat {...baseProps} debateTurns={turns} />);
        expect(screen.getAllByText('Verdict').length).toBeGreaterThanOrEqual(1);
    });

    it('splits moderator turns by analyst labels', () => {
        const turns = [
            makeTurn('Analyst A', 'Opening', 1),
            makeTurn('Analyst B', 'Opening', 1),
            makeTurn('Moderator', '**Analyst A:** What about risk?\n**Analyst B:** What about entry?', 2),
        ];
        render(<DebateChat {...baseProps} debateTurns={turns} />);
        // Both analyst-targeted segments should appear
        expect(screen.getByText('To Analyst A')).toBeDefined();
        expect(screen.getByText('To Analyst B')).toBeDefined();
    });

    it('shows collapsible per-turn thinking above the final text (harness style)', () => {
        const turns = [makeTurn('Macro Analyst', 'Final verdict text', 1)];
        const props = {
            ...baseProps,
            debateTurns: turns,
            reasoningProcesses: { 'Macro Analyst': 'Chain of thought for macro call' },
        };
        render(<DebateChat {...props} />);
        // Final output is always visible; thinking sits behind its toggle
        // (closed <details> keeps children in the DOM, so assert `open`).
        expect(screen.getByText('Final verdict text')).toBeDefined();
        const details = screen.getByText('Chain of thought for macro call').closest('details');
        expect(details?.open).toBe(false);
        fireEvent.click(screen.getByText(/Thinking/));
        expect(screen.getByText('Chain of thought for macro call').closest('details')?.open).toBe(true);
    });

    it('shows moderator thinking keyed to lowercase moderator (post-mortem transcript)', () => {
        // Post-mortem debates are single moderator-driven streams; the wiring
        // stores the captured chain of thought under reasoningProcesses.moderator.
        const turns = [
            makeTurn('Moderator', 'Master Strategist verdict', 1),
        ];
        const props = {
            ...baseProps,
            debateTurns: turns,
            reasoningProcesses: { moderator: 'Weighed the extended SL zone and missed-win flag…' },
        };
        render(<DebateChat {...props} />);
        expect(screen.getByText('Master Strategist verdict')).toBeDefined();
        const details = screen.getByText('Weighed the extended SL zone and missed-win flag…').closest('details');
        expect(details?.open).toBe(false);
        fireEvent.click(screen.getByText(/Thinking/));
        expect(screen.getByText('Weighed the extended SL zone and missed-win flag…').closest('details')?.open).toBe(true);
    });
});
