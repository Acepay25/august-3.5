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

    it('labels clarification as one phase', () => {
        const turns = [
            makeTurn('Analyst A', 'Opening', 1),
            makeTurn('Moderator', 'What about volume?', 4),
            makeTurn('Analyst A', 'Volume is strong', 5),
            makeTurn('Moderator', 'Verdict: Long', 6),
        ];
        render(<DebateChat {...baseProps} debateTurns={turns} />);
        expect(screen.getAllByText('Clarification').length).toBeGreaterThanOrEqual(1);
        expect(screen.queryByText('Clarification questions')).toBeNull();
        expect(screen.queryByText('Analyst responses')).toBeNull();
    });

    it('shows Verdict heading for the last moderator round', () => {
        const turns = [
            makeTurn('Analyst A', 'Opening', 1),
            makeTurn('Moderator', 'Final verdict: Long', 3),
        ];
        render(<DebateChat {...baseProps} debateTurns={turns} />);
        expect(screen.getAllByText('Verdict').length).toBeGreaterThanOrEqual(1);
    });

    it('does not pin a TL;DR above the briefing (board lives next to the signal)', () => {
        const analysis = makeAnalysis();
        const turns = [
            makeTurn('Analyst A', 'Opening', 1),
            makeTurn('Moderator', 'Verdict', 2),
        ];
        render(<DebateChat {...baseProps} debateTurns={turns} analysis={analysis} isDebating={false} />);
        expect(screen.queryByText('TL;DR')).toBeNull();
        expect(screen.getByRole('button', { name: 'Openings' })).toBeDefined();
        expect(screen.getByRole('button', { name: 'All' })).toBeDefined();
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
        expect(screen.queryByText(/Now speaking/)).toBeNull();
        expect(screen.getByText('Speaking')).toBeDefined();
        expect(screen.getByText('Writing')).toBeDefined();
    });

    it('streams a thinking-only opening turn live (analysis phase)', () => {
        const turns = [{
            speaker: 'Macro Analyst' as DebateTurn['speaker'],
            round: 1,
            text: '',
            reasoning: 'Weighing the 4H structure and the failed reclaim.',
            createdAt: '2025-01-01T12:00:00Z',
        }];
        render(<DebateChat {...baseProps} debateTurns={turns} isDebating activeDebateSpeakers={{ 'Macro Analyst': 1 }} />);
        // ROUND-39: thinking row stays COLLAPSED while live — the collapsed
        // ticker AND the in-DOM body both carry the trace text.
        const hits = screen.getAllByText('Weighing the 4H structure and the failed reclaim.');
        expect(hits.length).toBeGreaterThanOrEqual(1);
        expect(hits[0].closest('details')?.open).toBe(false);
        // …the answer area shows the live "Writing…" placeholder, not a
        // final-output label or a scratchpad notice.
        expect(screen.getByText('Writing')).toBeDefined();
        expect(screen.queryByText(/No public answer/i)).toBeNull();
        expect(screen.queryByText('Final output')).toBeNull();
    });

    it('does not mark an earlier turn as speaking when a later round is live', () => {
        const turns = [makeTurn('Analyst A', 'Opening', 1)];
        render(<DebateChat {...baseProps} debateTurns={turns} isDebating={true} activeDebateSpeakers={{ 'Analyst A': 2 }} />);
        const speakingChips = screen.getAllByText('Speaking');
        expect(speakingChips).toHaveLength(1);
        expect(screen.getByText('Opening')).toBeDefined();
        expect(screen.getByText('Done')).toBeDefined();
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
        expect(screen.getByText('→ Analyst A')).toBeDefined();
        expect(screen.getByText('→ Analyst B')).toBeDefined();
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
        expect(screen.getByText('Final output')).toBeDefined();
        expect(screen.getByText('Final verdict text')).toBeDefined();
        const details = screen.getAllByText('Chain of thought for macro call')[0].closest('details');
        expect(details?.open).toBe(false);
        fireEvent.click(screen.getByText(/Thinking/));
        expect(screen.getAllByText('Chain of thought for macro call')[0].closest('details')?.open).toBe(true);
    });

    it('strips leftover {{NAME}}: prompt placeholders from turn text', () => {
        const turns = [makeTurn('Macro Analyst', '**{{NAME}}:** Short from the 4H supply zone', 1)];
        render(<DebateChat {...baseProps} debateTurns={turns} />);
        expect(screen.queryByText(/\{\{NAME\}\}/)).toBeNull();
        expect(screen.getByText('Short from the 4H supply zone')).toBeDefined();
    });

    it('keeps the final output when the reply echoes its own stored reasoning', () => {
        // The pipeline already split this turn once (reasoning = thinking,
        // text = public output). A display-level re-peel must not drop the
        // reply paragraph just because it restates the scratchpad.
        const turns = [{
            speaker: 'Macro Analyst' as DebateTurn['speaker'],
            round: 1,
            reasoning: 'The 4H structure is bullish — higher low at 95k holds.',
            text: 'The 4H structure is bullish — higher low at 95k holds. Long the retest into 95.5k, SL 94.8k.',
            createdAt: '2025-01-01T12:00:00Z',
        }];
        render(<DebateChat {...baseProps} debateTurns={turns} />);
        expect(screen.getByText(/Long the retest into 95\.5k/)).toBeDefined();
        expect(screen.queryByText(/No public answer/i)).toBeNull();
    });

    it('still surfaces thinking as Thinking and body as Final output for a split turn', () => {
        const turns = [{
            speaker: 'Macro Analyst' as DebateTurn['speaker'],
            round: 1,
            reasoning: 'Chain of thought: momentum is rolling over on the 4H.',
            text: 'Short the failed sweep with SL above 95k.',
            createdAt: '2025-01-01T12:00:00Z',
        }];
        render(<DebateChat {...baseProps} debateTurns={turns} />);
        expect(screen.getByText('Final output')).toBeDefined();
        expect(screen.getByText('Short the failed sweep with SL above 95k.')).toBeDefined();
        const details = screen.getAllByText('Chain of thought: momentum is rolling over on the 4H.')[0].closest('details');
        expect(details?.open).toBe(false);
    });

    it('hides a leaked thinking-process dump from the debate floor', () => {
        const turns = [makeTurn(
            'Risk & Execution Specialist',
            "Here's a thinking process:\n\nAnalyze User Input: I'm in a debate. Current Round: Round 5.",
            5,
        )];
        render(<DebateChat {...baseProps} debateTurns={turns} />);
        expect(screen.getByText(/No public answer/i)).toBeDefined();
        expect(screen.queryByText('Final output')).toBeNull();
        fireEvent.click(screen.getByText('Thinking'));
        expect(screen.getByText(/Analyze User Input/i)).toBeDefined();
    });

    it('filters to a phase when the round tab is clicked', () => {
        const turns = [
            makeTurn('Analyst A', 'Opening', 1),
            makeTurn('Analyst A', 'Rebuttal', 2),
        ];
        render(<DebateChat {...baseProps} debateTurns={turns} />);
        fireEvent.click(screen.getByRole('button', { name: 'Rebuttals' }));
        expect(screen.getByText('Rebuttal')).toBeDefined();
        expect(screen.queryByText('Opening')).toBeNull();
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
        const details = screen.getAllByText('Weighed the extended SL zone and missed-win flag…')[0].closest('details');
        expect(details?.open).toBe(false);
        fireEvent.click(screen.getByText(/Thinking/));
        expect(screen.getAllByText('Weighed the extended SL zone and missed-win flag…')[0].closest('details')?.open).toBe(true);
    });

    it('renders moderator reasoning before public moderator text exists', () => {
        render(
            <DebateChat
                {...baseProps}
                isDebating
                reasoningProcesses={{ moderator: 'Comparing the analyst levels before asking a question.' }}
            />,
        );
        const reasoningHits = screen.getAllByText('Comparing the analyst levels before asking a question.');
        // ROUND-39: collapsed by default even for the moderator's pre-text
        // reasoning — the row exists (trace in DOM), just not auto-opened.
        expect(reasoningHits[0].closest('details')?.open).toBe(false);
        expect(screen.queryByText('Final output')).toBeNull();
    });
});
