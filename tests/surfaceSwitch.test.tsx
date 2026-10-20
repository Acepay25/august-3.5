/**
 * The Chat surface's switch, and the one card both conversation homes draw.
 *
 * The switch changed shape once already and the reason is worth keeping. The
 * first build swapped a CHARTLESS COPY of the Chart AI panel into the chat's
 * column — same rows, same tools, no canvas — and the two states were
 * indistinguishable on screen, which is the inert-toggle failure this repo's own
 * doctrine refuses. So the pill routes: chat here, chart on Trade.
 *
 * The cases below therefore measure a destination, not a mode. The second half
 * holds the thing that survived the change: a verdict made on the Chat surface
 * still renders its decision table inside the dock, because `InlineVerdict` is
 * one renderer rather than two.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

import type { AgentBot, AgentGroup } from '../services/agents/agentRoster';
import type { AppSurface } from '../hooks/useSurface';
import type { Message } from '../types/message';
import { MessageRole } from '../types/enums';

vi.mock('../services/analysis/DeskToolsService', () => ({
    stripTextToolCalls: (t: string): string => t,
    streamChatWithDeskTools: vi.fn(),
}));
vi.mock('../services/analysis/HybridIntelligenceService', () => ({
    fetchHybridData: vi.fn(async () => ({})),
    generateHybridPromptInjection: vi.fn(() => ''),
}));
vi.mock('../services/analysis/KlineService', () => ({ fetchKlines: vi.fn(async () => []) }));
vi.mock('../services/learning/SkillMemoryService', () => ({ listSkills: () => [] }));
vi.mock('../utils/activeUser', () => ({
    getActiveUsername: () => 'alice',
    LAST_ACTIVE_USER_KEY: 'last_active_user',
}));

import AgentsView from '../components/agents/AgentsView';
import SurfaceSwitch from '../components/shell/SurfaceSwitch';
import ChatTranscriptList from '../components/trade/panels/ChatTranscriptList';
import * as chatStore from '../services/trade/chatStore';

const base = {
    username: 'rober',
    bots: [] as AgentBot[],
    groups: [] as AgentGroup[],
    messages: [] as Message[],
    selection: { kind: 'team' } as const,
    onSelect: () => {},
    onNewBot: () => {},
    onNewGroup: () => {},
    onSendBotTurn: vi.fn(async () => true),
    onAnalyze: vi.fn(),
    coachCount: 0,
};

beforeEach(() => {
    cleanup();
    localStorage.clear();
    chatStore.__resetForTests();
});

/**
 * The title-bar switch replaced both the sidebar's destination rows and the
 * ChatModePill, so it inherits both contracts: it ROUTES, it marks where you
 * are, and it never becomes a control that decides where a message goes.
 */
describe('SurfaceSwitch — a route, not a mode', () => {
    // Typed, because `npm run typecheck` is the only gate that reads a test
    // file's types — vitest strips them. An untyped `vi.fn()` is
    // `Mock<Procedure | Constructable>` and is not assignable to the callback.
    const newGo = () => vi.fn((_s: AppSurface) => {});
    let go = newGo();
    beforeEach(() => { go = newGo(); });
    const renderSwitch = (surface: 'agents' | 'trade' = 'agents') => render(
        <SurfaceSwitch surface={surface} onSelect={go} />,
    );

    it('names the group and puts the chord in every accessible name', () => {
        renderSwitch();
        expect(screen.getByRole('group', { name: 'Screens' })).toBeTruthy();
        // A <kbd> inside a Tip is aria-hidden, so a screen reader only hears the
        // shortcut if the button itself says it.
        expect(screen.getByRole('button', { name: 'Journal, shortcut Alt+2' })).toBeTruthy();
    });

    it('carries exactly the surfaces the keyboard chords carry', () => {
        renderSwitch();
        expect(screen.getAllByRole('button')).toHaveLength(4);
        for (const id of ['trade', 'journal', 'agents', 'learn']) {
            expect(screen.getByTestId(`surface-switch-${id}`)).toBeTruthy();
        }
    });

    it('a non-current entry asks for its destination, once per press', () => {
        renderSwitch();
        fireEvent.click(screen.getByTestId('surface-switch-trade'));
        expect(go).toHaveBeenCalledTimes(1);
        expect(go).toHaveBeenCalledWith('trade');
    });

    it('the current entry marks where you are instead of pretending to navigate', () => {
        // A button that "switches" to the screen already showing is the inert
        // control render-probe fails, so it is the current page, not a toggle.
        renderSwitch();
        const here = screen.getByTestId('surface-switch-agents');
        expect(here.getAttribute('aria-current')).toBe('page');
        fireEvent.click(here);
        expect(go).not.toHaveBeenCalled();
    });

    it('the count survives the rows: a waiting surface rides its own button', () => {
        render(
            <SurfaceSwitch
                surface="trade"
                onSelect={go}
                badges={{ learn: { count: 12, detail: '12 decisions waiting' } }}
            />,
        );
        expect(screen.getByRole('button', { name: /^Knowledge\. 12 decisions waiting/ })).toBeTruthy();
    });

    it('the Chat surface has no second hop control and no send-mode toggle', () => {
        // `tests/agentsSurface.test.tsx` pins that this surface has no control
        // deciding where a message goes. The pill that used to sit beside the
        // switch was a second route to the same place, so it is gone.
        render(<AgentsView {...base} surfaceSwitch={<div data-testid="the-switch" />} />);
        expect(screen.getByTestId('the-switch')).toBeTruthy();
        expect(screen.queryByTestId('chat-mode-chat')).toBeNull();
        expect(screen.queryByTestId('chat-mode-chart-ai')).toBeNull();
        expect(screen.queryByTestId('open-in-dock')).toBeNull();
        expect(screen.queryByText('Open in Chart AI')).toBeNull();
        expect(screen.queryByTestId('mode-chat')).toBeNull();
        expect(screen.queryByTestId('mode-analyze')).toBeNull();
        expect(screen.queryByText('Send mode')).toBeNull();
    });
});

describe('the Chat surface is only the chat', () => {
    it('renders the thread in flow and no chartless copy of the dock', () => {
        const messages = [
            { id: 'd1', role: MessageRole.USER, text: 'first question', createdAt: '2026-10-14T08:00:00.000Z' },
            { id: 'd2', role: MessageRole.AI, text: 'first answer', createdAt: '2026-10-14T08:01:00.000Z' },
        ] as Message[];
        render(<AgentsView {...base} messages={messages} />);
        const column = screen.getByTestId('agents-thread-column');
        expect(column.className).toContain('flex-1');
        expect(column.className).not.toContain('hidden');
        // Scoped to the thread: the conversation rail previews the same answer,
        // and an unscoped query would pass on the preview.
        const thread = screen.getByTestId('agent-thread');
        expect(thread.textContent).toContain('first question');
        expect(thread.textContent).toContain('first answer');
        // The pane this file used to test is gone, not hidden.
        expect(screen.queryByTestId('agents-desk-ai')).toBeNull();
    });

    it('is a live region a screen reader can actually follow (O-65)', () => {
        const messages = [
            { id: 'd1', role: MessageRole.USER, text: 'first question', createdAt: '2026-10-14T08:00:00.000Z' },
            { id: 'd2', role: MessageRole.AI, text: 'first answer', createdAt: '2026-10-14T08:01:00.000Z' },
        ] as Message[];
        const { rerender } = render(<AgentsView {...base} messages={messages} />);
        const thread = screen.getByTestId('agent-thread');
        // A transcript appends and scrolls away from the top — that is `log`,
        // and nothing in the app said so until now.
        expect(thread.getAttribute('role')).toBe('log');
        expect(thread.getAttribute('aria-live')).toBe('polite');
        expect(thread.getAttribute('aria-label')).toBe('Conversation');
        expect(thread.textContent).toContain('first answer');

        // BUSY is the half that makes it usable: the answer rewrites on every
        // token, and a polite live region without it re-announces the growing
        // sentence dozens of times. Held busy through the run, the settled
        // reply is read once.
        rerender(<AgentsView {...base} messages={messages} analysisRunning />);
        expect(screen.getByTestId('agent-thread').getAttribute('aria-busy')).toBe('true');
        rerender(<AgentsView {...base} messages={messages} />);
        expect(screen.getByTestId('agent-thread').getAttribute('aria-busy')).toBe('false');
    });
});

describe('a verdict projected into the dock keeps its decision card', () => {
    // The merge hands the dock the Chat conversation's own rows, keyed by their
    // Message ids. A row like that used to arrive as plain text, because the
    // panel drew `VerdictAudit` alone and that component returns null for a
    // plain Long/High verdict with no evidence pack. One renderer, both homes.
    const message = {
        id: 'msg-9', role: MessageRole.AI, text: 'Long bias into the reclaim.',
        createdAt: '2026-10-14T08:00:00.000Z',
        analysis: {
            direction: 'Long', confidence: 'High', coinName: 'BTCUSDT', probability: 62,
            entryPoints: [{ price: '84210.5', description: 'reclaim' }],
            stopLoss: '83100', takeProfit: [{ price: '87900' }],
            reasoning: 'Holding above the 200-EMA.', marketConditions: {},
            activeStrategies: [], validationWarnings: [],
        },
        // VerdictAudit declines to render a bare direction+confidence verdict; an
        // audit needs something to audit, so this is a real pipeline row.
        runContract: [{ id: 'packet', label: 'Market packet', state: 'done' }],
    } as unknown as Message;
    const entries = [
        { id: 'msg-9', role: 'ai', text: 'Long bias into the reclaim.', tools: [] },
    ] as never;
    const get = (id: string): Message | undefined => (id === 'msg-9' ? message : undefined);

    it('resolves by identity when the host says these are conversation rows', () => {
        render(
            <ChatTranscriptList entries={entries} send={async () => {}}
                getAnalysisMessage={get} getMark={() => null} onChatLevels={() => {}}
                resolveVerdictByIdentity symbol="BTCUSDT" />,
        );
        const card = screen.getByTestId('inline-verdict');
        expect(card.textContent).toContain('84210.5');
        expect(card.textContent).toContain('83100');
        // Folded into the card's own disclosure — never printed again beside it.
        expect(screen.queryAllByTestId('verdict-audit')).toHaveLength(1);
    });

    it('leaves a dock-native row on the audit it has always drawn', () => {
        // The id of an entry the dock ran itself is not a message id, so no card
        // is claimed from a conversation it never belonged to.
        render(
            <ChatTranscriptList entries={entries} send={async () => {}}
                getAnalysisMessage={get} getMark={() => null} onChatLevels={() => {}}
                symbol="BTCUSDT" />,
        );
        expect(screen.queryByTestId('inline-verdict')).toBeNull();
        expect(screen.queryByTestId('verdict-audit')).toBeNull();
    });
});
