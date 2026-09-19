/**
 * WS-6 — the Agents surface is a chat, not a bounce to the Trade dock.
 *
 * Contract under test: the three regions mount, there is no dead-end state,
 * Chat mode round-trips through the bot's own transport, Analyze mode hands
 * the text to the real pipeline, and every roster action the old rail owned
 * (new/edit/delete/routines) is still reachable from the rows.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

import AgentsView from '../components/agents/AgentsView';
import type { AgentBot, AgentGroup } from '../services/agents/agentRoster';
import type { Message } from '../types/message';
import { MessageRole } from '../types/enums';

let seq = 0;
const bot = (over: Partial<AgentBot> & Pick<AgentBot, 'id'>): AgentBot => ({
    name: 'Macro', providerId: `p-${over.id}`, modelId: 'm1',
    avatar: { kind: 'auto' }, createdAt: new Date().toISOString(), ...over,
} as AgentBot);

const group = (id: string, memberIds: string[], name = 'Room'): AgentGroup => ({
    id, name, memberIds, createdAt: new Date().toISOString(),
});

const msg = (over: Partial<Message> & Pick<Message, 'role'>): Message => ({
    id: `m${seq += 1}`, text: '', createdAt: new Date().toISOString(), isThinking: false, ...over,
} as Message);

const base = {
    username: 'rober',
    bots: [] as AgentBot[],
    groups: [] as AgentGroup[],
    messages: [] as Message[],
    selection: { kind: 'coach' } as const,
    onSelect: () => {},
    onNewBot: () => {},
    onNewGroup: () => {},
    onSendBotTurn: vi.fn(async () => true),
    onAnalyze: vi.fn(),
    coachCount: 0,
};

beforeEach(() => { localStorage.clear(); seq = 0; });
afterEach(cleanup);

describe('AgentsView layout', () => {
    it('renders the rail, the pane and the pill composer', () => {
        render(<AgentsView {...base} />);
        expect(screen.getByTestId('agents-view')).toBeTruthy();
        expect(screen.getByTestId('agents-rail')).toBeTruthy();
        expect(screen.getByTestId('composer-send')).toBeTruthy();
    });

    it('shows a greeting instead of a dead-end when nothing is open', () => {
        render(<AgentsView {...base} bots={[bot({ id: 'b1' })]} />);
        const pane = screen.getByTestId('agents-view').textContent ?? '';
        expect(pane).toMatch(/Morning|Afternoon|Evening|Still up/);
        expect(pane).not.toMatch(/Pick an agent to open it as a Chart AI session/);
    });

    it('surfaces the roster actions the old rail owned', () => {
        const bots = [bot({ id: 'b1', name: 'Sweeper' })];
        const onDeleteBot = vi.fn();
        const onRunRoutine = vi.fn();
        render(<AgentsView {...base} bots={bots} onDeleteBot={onDeleteBot}
            botRoutines={{ b1: [{ id: 'r1', name: 'Morning brief', enabled: true } as never] }}
            onRunRoutine={onRunRoutine} />);
        fireEvent.click(screen.getByTestId('rail-new'));
        fireEvent.click(screen.getByLabelText('Delete Sweeper'));
        expect(onDeleteBot).toHaveBeenCalledWith('b1');
    });

    it('opens the routines disclosure and runs one', () => {
        const onRunRoutine = vi.fn();
        render(<AgentsView {...base} bots={[bot({ id: 'b1' })]}
            botRoutines={{ b1: [{ id: 'r1', name: 'Morning brief', enabled: true, schedule: { cron: '0 9 * * 1-5' } } as never] }}
            onRunRoutine={onRunRoutine} />);
        fireEvent.click(screen.getByTestId('row-routines'));
        fireEvent.click(screen.getByText('Run'));
        expect(onRunRoutine).toHaveBeenCalledOnce();
    });

    it('keeps group edit and delete reachable from the room row', () => {
        const onEditGroup = vi.fn();
        render(<AgentsView {...base} groups={[group('g1', ['b1'], 'War room')]} onEditGroup={onEditGroup} />);
        fireEvent.click(screen.getByTestId('rail-edit-group'));
        expect(onEditGroup).toHaveBeenCalledWith('g1');
    });

    it('pins reorder the rail and survive a remount', () => {
        const { unmount } = render(<AgentsView {...base} bots={[bot({ id: 'b1', name: 'Pinned me' })]} />);
        fireEvent.click(screen.getByLabelText('Pin Pinned me'));
        unmount();
        render(<AgentsView {...base} bots={[bot({ id: 'b1', name: 'Pinned me' })]} />);
        expect(screen.getByText('Pinned')).toBeTruthy();
    });
});

describe('AgentsView composer', () => {
    it('Chat mode sends through the bot transport, not the pipeline', async () => {
        const onSendBotTurn = vi.fn(async () => true);
        const b = bot({ id: 'b1', name: 'Macro' });
        render(<AgentsView {...base} bots={[b]} selection={{ kind: 'bot', botId: 'b1' }}
            messages={[msg({ role: MessageRole.USER, text: 'reading the tape' })]}
            onSendBotTurn={onSendBotTurn} />);
        fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'what about BTC?' } });
        fireEvent.click(screen.getByTestId('composer-send'));
        await waitFor(() => expect(onSendBotTurn).toHaveBeenCalledWith(b, 'what about BTC?'));
        expect(screen.getByTestId('mode-chat').getAttribute('aria-pressed')).toBe('true');
    });

    it('Analyze mode hands the same text to the real pipeline', () => {
        const onAnalyze = vi.fn();
        const b = bot({ id: 'b1' });
        render(<AgentsView {...base} bots={[b]} selection={{ kind: 'bot', botId: 'b1' }} onAnalyze={onAnalyze} />);
        fireEvent.click(screen.getByTestId('mode-analyze'));
        fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'BTC setup' } });
        fireEvent.click(screen.getByTestId('composer-send'));
        expect(onAnalyze).toHaveBeenCalledWith('BTC setup');
    });

    it('renders an inline verdict from the thread — no second renderer', () => {
        // A bot thread claims only AI replies whose single modelsUsed entry
        // names that bot's provider + model (utils/agentThreads), so the
        // seeded verdict has to carry it.
        render(<AgentsView {...base} bots={[bot({ id: 'b1' })]}
            selection={{ kind: 'bot', botId: 'b1' }}
            messages={[msg({
                role: MessageRole.USER, text: 'BTC?',
            }), msg({
                role: MessageRole.AI, text: 'Short BTC here.',
                modelsUsed: { 'p-b1': 'm1' },
                analysis: {
                    direction: 'Short', coinName: 'BTCUSDT', confidence: 'High',
                    entryPoints: [{ price: 61000 }], stopLoss: 62500, takeProfit: [{ price: 58000 }],
                } as never,
            })]} />);
        const card = screen.getByTestId('inline-verdict');
        expect(card.textContent).toMatch(/Short/);
        expect(card.textContent).toMatch(/61000/);
        expect(card.textContent).toMatch(/62500/);
        // The user prompt that the reply answered rides in the same thread.
        expect(screen.getByTestId('agents-view').textContent).toMatch(/BTC\?/);
    });

    it('delegates a room thread to the existing group view', () => {
        const g = group('g1', ['b1'], 'War room');
        const renderGroup = vi.fn(() => <div data-testid="room-view">room</div>);
        render(<AgentsView {...base} groups={[g]} selection={{ kind: 'group', groupId: 'g1' }}
            renderGroup={renderGroup as never} />);
        expect(screen.getByTestId('room-view')).toBeTruthy();
        expect(renderGroup).toHaveBeenCalledWith(g);
    });
});

describe('WS-3.4 per-bot learning stats', () => {
    const stats = [{ id: 'b1', name: 'Sweeper', lessons: 4, skillsAuthored: 2, evidence: 9, lastLessonAt: '2026-09-18' }];

    it('shows what the active bot has learned in its header', () => {
        render(<AgentsView {...base} bots={[bot({ id: 'b1', name: 'Sweeper' })]}
            selection={{ kind: 'bot', botId: 'b1' }} botStats={stats} />);
        const line = screen.getByTestId('bot-learning-stats');
        expect(line.textContent).toContain('4 lessons');
        expect(line.textContent).toContain('2 skills');
        expect(line.textContent).toContain('9 evidence');
        expect(line.getAttribute('title')).toContain('2026-09-18');
    });

    it('badges the rail row with the skills that bot authored', () => {
        render(<AgentsView {...base} bots={[bot({ id: 'b1' })]} botStats={stats} />);
        expect(screen.getByTestId('row-skills').textContent).toBe('2');
    });

    it('shows no badge for a bot that has authored nothing', () => {
        render(<AgentsView {...base} bots={[bot({ id: 'b1' })]}
            botStats={[{ ...stats[0], skillsAuthored: 0 }]} />);
        expect(screen.queryByTestId('row-skills')).toBeNull();
    });
});

describe('WS-6 focus and mobile drawer', () => {
    it("'/` opens the rail and focuses the search", () => {
        render(<AgentsView {...base} bots={[bot({ id: 'b1' })]} />);
        fireEvent.keyDown(document, { key: '/' });
        // Focus lands from an effect after the open commits: below md the
        // closed rail is visibility:hidden and a hidden subtree refuses focus.
        expect(screen.getByTestId('rail-search')).toBe(document.activeElement);
    });

    it("'/` is left alone while the user is typing somewhere", () => {
        render(<AgentsView {...base} bots={[bot({ id: 'b1' })]} />);
        const composer = screen.getByLabelText('Message');
        composer.focus();
        fireEvent.keyDown(composer, { key: '/' });
        expect(screen.getByTestId('rail-search')).not.toBe(document.activeElement);
        expect(composer).toBe(document.activeElement);
    });

    it('picking a thread closes the drawer, and the backdrop closes it too', () => {
        const onSelect = vi.fn();
        render(<AgentsView {...base} bots={[bot({ id: 'b1', name: 'Sweeper' })]} onSelect={onSelect} />);
        fireEvent.click(screen.getByTestId('rail-open'));
        expect(screen.getByTestId('rail-backdrop')).toBeTruthy();
        fireEvent.click(screen.getByTestId('rail-backdrop'));
        expect(screen.queryByTestId('rail-backdrop')).toBeNull();

        fireEvent.click(screen.getByTestId('rail-open'));
        fireEvent.click(screen.getByTestId('agent-row'));
        expect(onSelect).toHaveBeenCalledWith({ kind: 'bot', botId: 'b1' });
        expect(screen.queryByTestId('rail-backdrop')).toBeNull();
    });

    // jsdom lays nothing out, so the off-canvas contract can only be pinned on
    // the class list: the rail's children need a flex container (the scroll
    // pane is flex-1/min-h-0) and a closed drawer must not stay tabbable.
    it('stays a flex column, and is hidden from the tab order while closed', () => {
        render(<AgentsView {...base} bots={[bot({ id: 'b1' })]} />);
        const tokens = (): string[] => screen.getByTestId('agents-rail').className.split(/\s+/);
        expect(tokens()).toContain('flex');
        expect(tokens()).toContain('flex-col');
        expect(tokens()).toContain('invisible');

        fireEvent.click(screen.getByTestId('rail-open'));
        expect(tokens()).not.toContain('invisible');
    });
});
