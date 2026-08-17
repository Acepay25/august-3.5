import React from 'react';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import MessageItem, { ChatContextProps } from '../components/chat/MessageItem';
import { Message, MessageRole } from '../types';

// jsdom does not implement matchMedia (SmoothText reads it for reduced motion).
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

vi.mock('../components/shared/MarkdownContent', () => ({
    default: ({ content }: { content?: string }) => <div data-testid="md">{content}</div>,
}));
vi.mock('../components/shared/StreamingMarkdown', () => ({
    default: ({ text }: { text?: string }) => <div data-testid="stream-md">{text}</div>,
}));
vi.mock('../components/shared/Icons', () => ({
    ChevronDownIcon: ({ className }: { className?: string }) => <span className={className} />,
    LinkIcon: () => <span />,
    CheckIcon: ({ className }: { className?: string }) => <span className={className} />,
}));
vi.mock('../components/market/LiveMarketDataView', () => ({ default: () => null }));
vi.mock('../components/analysis/EnsembleProgressChat', () => ({ default: () => <div data-testid="floor" /> }));
vi.mock('../components/analysis/DebateSummary', () => ({ default: () => null }));
vi.mock('../components/analysis/TradingSignalCard', () => ({
    default: ({ analysis }: { analysis?: { direction?: string } }) => (
        <div data-testid="signal-card" data-direction={analysis?.direction ?? ''} />
    ),
}));
vi.mock('../components/analysis/DebateRunLog', () => ({ default: () => null }));
vi.mock('../components/analysis/AnalysisTracePanel', () => ({ default: () => null }));
vi.mock('../components/chat/AnalysisDetails', () => ({ default: () => null }));
vi.mock('../components/chat/SetupLifecycleCard', () => ({ default: () => null }));
vi.mock('../components/chat/TodayReassessmentPanel', () => ({ default: () => null }));

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

const ensembleMessage = (overrides: Partial<Message> = {}): Message => ({
    id: 'msg-1',
    role: MessageRole.AI,
    text: 'The ensemble has concluded its debate.',
    createdAt: new Date().toISOString(),
    modelsUsed: { 'prov-a': 'model-a', 'prov-b': 'model-b' },
    debateTurns: [
        { speaker: 'Analyst A', round: 1, text: 'Long the breakout.' },
        { speaker: 'Moderator', round: 4, text: 'Verdict: Long BTC. The breakout holds above support with funding flat.' },
    ],
    reasoningProcesses: { moderator: 'Weighing the sweep against the funding rate before calling it.' },
    ...overrides,
});

describe('MessageItem — ensemble thinking + final output in the chat area', () => {
    it('shows the moderator thinking row for a settled ensemble message', () => {
        render(<MessageItem message={ensembleMessage()} context={baseContext} />);
        expect(screen.getByText('Moderator thinking')).toBeDefined();
        expect(screen.getByText(/Weighing the sweep against the funding rate/)).toBeDefined();
    });

    it('shows the final verdict prose under a Final output label once settled', () => {
        render(<MessageItem message={ensembleMessage()} context={baseContext} />);
        expect(screen.getByText('Final output')).toBeDefined();
        expect(screen.getByText(/Verdict: Long BTC/)).toBeDefined();
    });

    it('does not show the verdict prose while the debate is still live', () => {
        render(<MessageItem message={ensembleMessage({ isDebating: true })} context={baseContext} />);
        expect(screen.queryByText('Final output')).toBeNull();
        // The moderator thinking row still streams live.
        expect(screen.getByText('Moderator thinking')).toBeDefined();
    });

    it('streams casual replies live with a running Thinking row and live markdown', () => {
        const message: Message = {
            id: 'msg-2',
            role: MessageRole.AI,
            text: 'Partial answer so far',
            createdAt: new Date().toISOString(),
            isStreaming: true,
            thoughtProcesses: { 'prov-a': 'thinking about it' },
        };
        render(<MessageItem message={message} context={baseContext} />);
        // Live markdown path is used while streaming.
        expect(screen.getByTestId('stream-md')).toBeDefined();
        // The Thinking row is in its running state.
        expect(document.querySelector('.reasoning-row')?.getAttribute('data-state')).toBe('running');
    });

    it('shows generating dots when a streaming reply has no text yet', () => {
        const message: Message = {
            id: 'msg-3',
            role: MessageRole.AI,
            text: '',
            createdAt: new Date().toISOString(),
            isStreaming: true,
        };
        const { container } = render(<MessageItem message={message} context={baseContext} />);
        expect(container.querySelector('.streaming-dots')).toBeDefined();
    });

    const provisional = {
        coinName: 'BTCUSDT',
        direction: 'Long',
        confidence: 'Medium',
        probability: 60,
        strategy: 'Trend continuation',
    } as any;

    it('renders the provisional verdict card while the moderator is still writing', () => {
        render(<MessageItem message={ensembleMessage({
            isDebating: true,
            provisionalAnalysis: provisional,
        })} context={baseContext} />);
        expect(screen.getByText('Verdict drafting')).toBeDefined();
        const card = screen.getByTestId('signal-card');
        expect(card.getAttribute('data-direction')).toBe('Long');
    });

    it('does not render the provisional card once the final analysis lands', () => {
        render(<MessageItem message={ensembleMessage({
            isDebating: false,
            analysis: provisional,
            provisionalAnalysis: provisional,
        })} context={baseContext} />);
        expect(screen.queryByText('Verdict drafting')).toBeNull();
    });

    it('does not render the provisional card before any plan has parsed', () => {
        render(<MessageItem message={ensembleMessage({ isDebating: true })} context={baseContext} />);
        expect(screen.queryByText('Verdict drafting')).toBeNull();
    });
});
