import React from 'react';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import TranscriptRow from '../components/chat/TranscriptRow';
import type { ChatContextProps } from '../components/chat/MessageItem';
import { Message, MessageRole } from '../types';

// jsdom does not implement matchMedia (several children read it for reduced motion).
beforeAll(() => {
    if (typeof window !== 'undefined' && !window.matchMedia) {
        window.matchMedia = ((query: string) => ({
            matches: false,
            media: query,
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
        })) as any;
    }
});

// Stub every heavy analysis surface so the test asserts the row contract,
// not the internals of the cards. Only TradingSignalCard renders a probe.
vi.mock('../components/shared/Icons', () => ({
    ChevronDownIcon: ({ className }: { className?: string }) => <span className={className} />,
    LinkIcon: () => <span />,
    CheckIcon: ({ className }: { className?: string }) => <span className={className} />,
}));
vi.mock('../components/shared/ReasoningRow', () => ({ default: () => null }));
vi.mock('../components/shared/ModelByline', () => ({ default: () => null }));
vi.mock('../components/market/LiveMarketDataView', () => ({ default: () => null }));
vi.mock('../components/analysis/DebateSummary', () => ({ default: () => null }));
vi.mock('../components/analysis/TradingSignalCard', () => ({
    default: ({ analysis }: { analysis?: { direction?: string } }) => (
        <div data-testid="signal-card" data-direction={analysis?.direction ?? ''} />
    ),
}));
vi.mock('../components/analysis/DebateReplay', () => ({ default: () => null }));
vi.mock('../components/analysis/DebateStage', () => ({ default: () => null }));
vi.mock('../components/analysis/DebateSidePanel', () => ({ default: () => null }));
vi.mock('../components/analysis/ReplacementOfferCard', () => ({ default: () => null }));
vi.mock('../components/analysis/DebateRunLog', () => ({ default: () => null }));
vi.mock('../components/analysis/RunContractPanel', () => ({ default: () => null }));
vi.mock('../components/analysis/EvidencePackCard', () => ({ default: () => null }));
vi.mock('../components/analysis/AnalysisTracePanel', () => ({ default: () => null }));
vi.mock('../components/analysis/SetupLifecycleCard', () => ({ default: () => null }));
vi.mock('../components/chat/InlineApprovalCard', () => ({ default: () => null }));
vi.mock('../components/chat/AnalysisDetails', () => ({ default: () => null }));

const baseContext = {
    typingMessageState: null,
    setTypingMessageState: vi.fn(),
    handleTypingComplete: vi.fn(),
    highlightedAnalysisId: null,
    expandedPostMortems: {},
    setExpandedPostMortems: vi.fn(),
    expandedPostMortemImages: {},
    setExpandedPostMortemImages: vi.fn(),
    savedAnalyses: [],
    activeFrameworks: [],
    copiedMessageId: null,
    modelIdToName: {},
    ocrModelIdToName: {},
    providerNameToId: {},
    handleInitiateLogTrade: vi.fn(),
    handleInitiateSkipTrade: vi.fn(),
    handleViewStrategyDetails: vi.fn(),
    handleApplyStrategy: vi.fn(),
    handleSaveAnalysis: vi.fn(),
    handleCopy: vi.fn(),
    handleInitiateUpdateTrade: vi.fn(),
} as unknown as ChatContextProps;

const analysisMessage = (overrides: Partial<Message> = {}): Message => ({
    id: 'msg-analysis',
    role: MessageRole.AI,
    text: 'The ensemble has concluded its debate.',
    createdAt: new Date().toISOString(),
    analysis: { coinName: 'BTC', direction: 'Long', confidence: 'High' } as any,
    ...overrides,
});

describe('TranscriptRow — settled analysis row', () => {
    it('renders the signal card for a settled analysis message', () => {
        render(<TranscriptRow message={analysisMessage()} context={baseContext} />);
        expect(screen.getAllByTestId('signal-card').length).toBeGreaterThan(0);
        expect(screen.getAllByTestId('signal-card')[0].getAttribute('data-direction')).toBe('Long');
    });

    it('renders nothing when the message has no analysis (dispatch guard)', () => {
        const { container } = render(
            <TranscriptRow message={analysisMessage({ analysis: undefined })} context={baseContext} />,
        );
        expect(container.firstChild).toBeNull();
    });

    it('surfaces a non-PASS pattern-memory gate', () => {
        const message = analysisMessage({
            patternMemoryGate: {
                gateResult: 'HALT',
                reason: 'Two near-identical setups stopped out last week.',
                mandatoryQuestions: ['What changed since the last loss?'],
                historicalFailures: [
                    { coinName: 'BTC', direction: 'Long', outcome: 'LOSS', keyLesson: 'Chased into resistance.' },
                ],
            },
        });
        render(<TranscriptRow message={message} context={baseContext} />);
        expect(screen.getByText(/Memory gate: halted/)).toBeDefined();
        expect(screen.getByText(/Two near-identical setups stopped out last week\./)).toBeDefined();
    });

    it('does not render the gate for a PASS result', () => {
        const message = analysisMessage({
            patternMemoryGate: {
                gateResult: 'PASS',
                reason: 'No conflicting history.',
                mandatoryQuestions: [],
                historicalFailures: [],
            },
        });
        render(<TranscriptRow message={message} context={baseContext} />);
        expect(screen.queryByText(/Memory gate:/)).toBeNull();
    });
});
