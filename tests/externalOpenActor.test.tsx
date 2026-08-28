/**
 * Verifies that the App's `externalOpenActor` request mechanism opens the
 * per-message DebateSidePanel for the matching message.
 *
 * We render MessageItem with a hand-built ChatContextProps that includes
 * the new fields, flip `externalOpenActor` between renders, and assert
 * that the panel mounts when the request matches and unmounts when it
 * doesn't.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import MessageItem, { ChatContextProps } from '../components/chat/MessageItem';
import { Message, MessageRole } from '../types';

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

beforeAll(() => {
    if (typeof window !== 'undefined' && !window.matchMedia) {
        window.matchMedia = ((query: string) => ({
            matches: false, media: query, onchange: null,
            addListener: vi.fn(), removeListener: vi.fn(),
            addEventListener: vi.fn(), removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
        })) as any;
    }
});

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

const ensemble = (id = 'msg-A'): Message => ({
    id,
    role: MessageRole.AI,
    text: 'Settled debate.',
    createdAt: new Date().toISOString(),
    modelsUsed: { 'prov-a': 'model-a', 'prov-b': 'model-b' },
    debateTurns: [
        { speaker: 'Macro', round: 1, text: 'Macro opening.' },
        { speaker: 'Risk', round: 1, text: 'Risk opening.' },
        { speaker: 'Moderator', round: 2, text: 'Verdict: Long BTC.' },
    ],
});

afterEach(() => cleanup());
beforeEach(() => vi.clearAllMocks());

describe('MessageItem — externalOpenActor plumbing', () => {
    it('opens the side panel for the matching message id when externalOpenActor is set', () => {
        const ctx: ChatContextProps = {
            ...baseContext,
            externalOpenActor: { messageId: 'msg-A', actorId: 'Macro' },
            externalOpenActorNonce: 1,
        };
        render(<MessageItem message={ensemble('msg-A')} context={ctx} />);
        // The DebateSidePanel mounts when the panel-actor is non-null.
        // We assert by checking for the panel's specific close button
        // (aria-label "Close debate panel" — unique to the side panel).
        expect(screen.queryByRole('button', { name: /close debate panel/i })).toBeTruthy();
    });

    it('does NOT open the panel when externalOpenActor targets a different message', () => {
        const ctx: ChatContextProps = {
            ...baseContext,
            externalOpenActor: { messageId: 'msg-B', actorId: 'Macro' },
            externalOpenActorNonce: 1,
        };
        render(<MessageItem message={ensemble('msg-A')} context={ctx} />);
        // The panel is keyed off `open={debatePanelActor !== null}`.
        // When the request targets a different message id, the local
        // state stays null, and the panel does NOT mount.
        expect(screen.queryByRole('button', { name: /close debate panel/i })).toBeNull();
    });

    it('re-fires the sync when the nonce bumps even if the request is unchanged', () => {
        const ctx: ChatContextProps = {
            ...baseContext,
            externalOpenActor: null,
            externalOpenActorNonce: 0,
        };
        const { rerender } = render(<MessageItem message={ensemble('msg-A')} context={ctx} />);
        expect(screen.queryByRole('button', { name: /close debate panel/i })).toBeNull();

        // First request: open Macro.
        const ctxOpen: ChatContextProps = {
            ...ctx,
            externalOpenActor: { messageId: 'msg-A', actorId: 'Macro' },
            externalOpenActorNonce: 1,
        };
        rerender(<MessageItem message={ensemble('msg-A')} context={ctxOpen} />);
        expect(screen.queryByRole('button', { name: /close debate panel/i })).toBeTruthy();

        // Second request: same {messageId, actorId} but bumped nonce.
        // The effect's dep array includes the nonce, so it re-fires and
        // the panel stays open.
        const ctxAgain: ChatContextProps = {
            ...ctx,
            externalOpenActor: { messageId: 'msg-A', actorId: 'Macro' },
            externalOpenActorNonce: 2,
        };
        rerender(<MessageItem message={ensemble('msg-A')} context={ctxAgain} />);
        expect(screen.queryByRole('button', { name: /close debate panel/i })).toBeTruthy();

        // Switch to a different actor — the panel re-aims.
        const ctxRisk: ChatContextProps = {
            ...ctx,
            externalOpenActor: { messageId: 'msg-A', actorId: 'Risk' },
            externalOpenActorNonce: 3,
        };
        rerender(<MessageItem message={ensemble('msg-A')} context={ctxRisk} />);
        expect(screen.queryByRole('button', { name: /close debate panel/i })).toBeTruthy();
    });
});
