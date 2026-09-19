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
        const routine = { id: 'r1', name: 'Morning brief', enabled: true, schedule: { cron: '0 9 * * 1-5' } } as never;
        render(<AgentsView {...base} bots={[bot({ id: 'b1' })]}
            botRoutines={{ b1: [routine] }} onRunRoutine={onRunRoutine} />);
        // Collapsed by default: the count sits on the row, the schedule list does not.
        const toggle = screen.getByTestId('row-routines');
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        expect(screen.queryByText('Morning brief')).toBeNull();
        fireEvent.click(toggle);
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        expect(screen.getByText('Morning brief')).toBeTruthy();
        expect(screen.getByText('0 9 * * 1-5')).toBeTruthy();
        fireEvent.click(screen.getByText('Run'));
        expect(onRunRoutine).toHaveBeenCalledWith(routine);
    });

    it('has no disclosure at all for a bot with no routines', () => {
        render(<AgentsView {...base} bots={[bot({ id: 'b1' })]} botRoutines={{ b1: [] }} />);
        expect(screen.queryByTestId('row-routines')).toBeNull();
    });

    it('lists the schedule but offers no Run without the run handler', () => {
        render(<AgentsView {...base} bots={[bot({ id: 'b1' })]}
            botRoutines={{ b1: [{ id: 'r1', name: 'Morning brief', enabled: true, schedule: { cron: '0 9 * * 1-5' } } as never] }} />);
        fireEvent.click(screen.getByTestId('row-routines'));
        expect(screen.getByText('Morning brief')).toBeTruthy();
        expect(screen.queryByText('Run')).toBeNull();
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
        expect(onAnalyze).toHaveBeenCalledWith('BTC setup', []);
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

    it('says whether the bot is synced with the shared notebook', () => {
        render(<AgentsView {...base} bots={[bot({ id: 'b1' })]}
            selection={{ kind: 'bot', botId: 'b1' }} botStats={stats} />);
        const pill = screen.getByTestId('bot-notebook-sync');
        expect(pill.textContent).toBe('notebook');
        expect(pill.getAttribute('title')).toContain('Last lesson 2026-09-18');
    });

    it('an isolated bot reads as isolated — in the pill and in the empty state', () => {
        render(<AgentsView {...base} bots={[bot({ id: 'b1', name: 'Sweeper', memoryScope: 'isolated' })]}
            selection={{ kind: 'bot', botId: 'b1' }} />);
        expect(screen.getByTestId('bot-notebook-sync').textContent).toBe('own notes');
        expect(screen.getByTestId('agents-view').textContent)
            .toContain('it is isolated from the shared notebook');
    });

    it('the desk status dot reports provider readiness rather than claiming one', () => {
        const { unmount } = render(<AgentsView {...base} bots={[bot({ id: 'b1' })]} providerReady={false} />);
        const off = screen.getByTestId('desk-status');
        expect(off.className).toContain('bg-zinc-600');
        expect(off.getAttribute('title')).toContain('No provider ready');
        unmount();
        render(<AgentsView {...base} bots={[bot({ id: 'b1' })]} providerReady />);
        expect(screen.getByTestId('desk-status').className).toContain('bg-emerald-500');
    });
});

describe('WS-6 rail completeness', () => {
    it('lists the desk’s own conversation as a row that selects it', () => {
        const onSelect = vi.fn();
        const messages = [msg({ role: MessageRole.USER, text: 'is BTC heavy here' })];
        render(<AgentsView {...base} messages={messages} onSelect={onSelect} />);
        const row = screen.getByTestId('chart-ai-row');
        expect(row.textContent).toContain('Chart AI');
        expect(row.textContent).toContain('is BTC heavy here');
        fireEvent.click(row);
        expect(onSelect).toHaveBeenCalledWith({ kind: 'team' });
    });

    it('the Chart AI pane shows the shared messages, not an empty launcher', () => {
        const messages = [msg({ role: MessageRole.AI, text: 'Verdict: skip the short.', modelsUsed: { p1: 'm1' } })];
        render(<AgentsView {...base} messages={messages} selection={{ kind: 'team' }} />);
        expect(screen.getByTestId('agents-view').textContent).toContain('skip the short');
    });

    it('renders the coach pane for the coach shortcut instead of a blank desk', () => {
        render(<AgentsView {...base} selection={{ kind: 'coach' }}
            renderCoach={() => <div data-testid="coach-pane">the coach</div>} />);
        expect(screen.getByTestId('coach-pane')).toBeTruthy();
    });

    it('renames a bot from its own row', () => {
        const onRenameBot = vi.fn();
        render(<AgentsView {...base} bots={[bot({ id: 'b1', name: 'Macro' })]} onRenameBot={onRenameBot} />);
        fireEvent.click(screen.getByTestId('rail-rename'));
        fireEvent.change(screen.getByTestId('bot-rename-input'), { target: { value: '  Sweeper  ' } });
        fireEvent.click(screen.getByText('Save'));
        expect(onRenameBot).toHaveBeenCalledWith('b1', 'Sweeper');
    });

    it('sorts by name and back to recency', () => {
        render(<AgentsView {...base} bots={[bot({ id: 'b1', name: 'Alpha' }), bot({ id: 'b2', name: 'Zeta' })]}
            messages={[
                msg({ role: MessageRole.AI, text: 'a', createdAt: '2026-01-01T00:00:00.000Z', modelsUsed: { 'p-b1': 'm1' } }),
                msg({ role: MessageRole.AI, text: 'z', createdAt: '2026-09-01T00:00:00.000Z', modelsUsed: { 'p-b2': 'm1' } }),
            ]} />);
        const first = () => screen.getAllByTestId('agent-row')[0].textContent ?? '';
        // Default is recency: Zeta's September reply beats Alpha's January one.
        expect(first()).toContain('Zeta');
        fireEvent.click(screen.getByTestId('rail-sort'));
        expect(first()).toContain('Alpha');
        fireEvent.click(screen.getByTestId('rail-sort'));
        expect(first()).toContain('Zeta');
    });

    it('pins a room up into the Pinned section, next to the desk row', () => {
        render(<AgentsView {...base} bots={[bot({ id: 'b1' })]} groups={[group('g1', ['b1'], 'Team')]} />);
        const sectionText = () => screen.getByTestId('rail-pinned').textContent ?? '';
        expect(sectionText()).toContain('Chart AI');
        expect(sectionText()).not.toContain('Team');
        fireEvent.click(screen.getByLabelText('Pin Team'));
        expect(sectionText()).toContain('Team');
        fireEvent.click(screen.getByLabelText('Unpin Team'));
        expect(sectionText()).not.toContain('Team');
    });

    it('mounts the model picker App hands in, instead of a chip that leaves the surface', () => {
        render(<AgentsView {...base} modelPicker={<button data-testid="model-picker">Gemini · flash</button>} />);
        expect(screen.getByTestId('model-picker')).toBeTruthy();
        expect(screen.queryByTestId('composer-model')).toBeNull();
    });

    it('collapses the rail at md+ and brings it back', () => {
        render(<AgentsView {...base} bots={[bot({ id: 'b1' })]} />);
        fireEvent.click(screen.getByTestId('rail-collapse'));
        expect(screen.getByTestId('agents-rail').className).toContain('md:hidden');
        fireEvent.click(screen.getByTestId('rail-expand'));
        expect(screen.getByTestId('agents-rail').className).not.toContain('md:hidden');
    });
});

describe('composer attachments (WS-6)', () => {
    const png = (): File => new File(['pretend-bytes'], 'chart.png', { type: 'image/png' });

    it('offers attach only in Analyze mode', () => {
        render(<AgentsView {...base} />);
        expect(screen.getByTestId('composer-attach').hasAttribute('disabled')).toBe(true);
        expect(screen.getByTestId('composer-attach').getAttribute('title')).toContain('Analyze mode');
        fireEvent.click(screen.getByTestId('mode-analyze'));
        expect(screen.getByTestId('composer-attach').hasAttribute('disabled')).toBe(false);
    });

    it('reads a picked image into a chip and sends it with the prompt, then clears', async () => {
        const onAnalyze = vi.fn();
        render(<AgentsView {...base} onAnalyze={onAnalyze} />);
        fireEvent.click(screen.getByTestId('mode-analyze'));
        fireEvent.change(screen.getByTestId('composer-file'), { target: { files: [png()] } });
        await waitFor(() => expect(screen.getByTestId('composer-attachments')).toBeTruthy());

        fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'look at this tape' } });
        fireEvent.click(screen.getByTestId('composer-send'));
        await waitFor(() => expect(onAnalyze).toHaveBeenCalledWith(
            'look at this tape',
            [{ name: 'chart.png', dataURL: expect.stringMatching(/^data:image\/png/) }],
        ));
        await waitFor(() => expect(screen.queryByTestId('composer-attachments')).toBeNull());
    });

    it('drops one chip without touching the others', async () => {
        render(<AgentsView {...base} />);
        fireEvent.click(screen.getByTestId('mode-analyze'));
        fireEvent.change(screen.getByTestId('composer-file'), { target: { files: [png()] } });
        await waitFor(() => expect(screen.getByTestId('composer-attachments')).toBeTruthy());
        fireEvent.click(screen.getByLabelText('Remove chart.png'));
        expect(screen.queryByTestId('composer-attachments')).toBeNull();
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

/**
 * Ported from the deleted components/chat/AgentRosterRail.tsx suite: coverage
 * of live row behaviour (identity, active state, name filter, per-bot thread
 * scoping, the working ring, creation, emptiness, delete affordances, the
 * Coach count) that nothing else asserted. What was NOT ported was either
 * already covered above (row click selects, room edit, bot delete, pin,
 * rename, routines) or was chrome of the deleted rail itself (its embedded
 * variant, its “+” menu popover, the Team row it carried before rooms subsumed
 * it, and the room's last-message preview — this surface hands a room's
 * transcript to GroupChatView instead of painting one in the row).
 */
describe('AgentsView rail rows (ported from the roster-rail suite)', () => {
    it('lists one row per bot and one per room, naming an unnamed room by its members', () => {
        const unnamed: AgentGroup = { id: 'g1', memberIds: ['b1', 'b2'], createdAt: new Date().toISOString() };
        render(<AgentsView {...base}
            bots={[bot({ id: 'b1', name: 'Scout' }), bot({ id: 'b2', name: 'Ledger' })]}
            groups={[unnamed]} />);
        expect(screen.getAllByTestId('agent-row')).toHaveLength(3);
        expect(screen.getByText('Scout, Ledger')).toBeTruthy();
    });

    it('marks the open thread and leaves the others idle', () => {
        render(<AgentsView {...base} bots={[bot({ id: 'b1', name: 'Scout' })]}
            groups={[group('g1', ['b1'], 'War room')]} selection={{ kind: 'group', groupId: 'g1' }} />);
        const [botRow, roomRow] = screen.getAllByTestId('agent-row');
        // The active fill is on the row shell, two levels above the button.
        const shellOf = (row: HTMLElement): string => row.parentElement?.parentElement?.className ?? '';
        expect(shellOf(roomRow)).toContain('bg-zinc-800/70');
        expect(shellOf(botRow)).not.toContain('bg-zinc-800/70');
    });

    it('filters the bot and room rows by name from the rail search', () => {
        render(<AgentsView {...base}
            bots={[bot({ id: 'b1', name: 'Scout' }), bot({ id: 'b2', name: 'Ledger' })]}
            groups={[group('g1', ['b1', 'b2'], 'Alpha Desk')]} />);
        fireEvent.change(screen.getByTestId('rail-search'), { target: { value: 'ledger' } });
        expect(screen.queryByText('Scout')).toBeNull();
        expect(screen.getByText('Ledger')).toBeTruthy();
        expect(screen.queryByText('Alpha Desk')).toBeNull();
    });

    it('scopes a row to its bot’s provider + model: two bots on one provider keep separate threads', () => {
        render(<AgentsView {...base}
            bots={[
                bot({ id: 'b1', name: 'Scout', providerId: 'p1', modelId: 'model-a' }),
                bot({ id: 'b2', name: 'Ledger', providerId: 'p1', modelId: 'model-b' }),
            ]}
            messages={[
                msg({ role: MessageRole.USER, text: 'watch BTC order flow' }),
                msg({ role: MessageRole.AI, text: 'Buy wall holding at 94.8k.', modelsUsed: { p1: 'model-a' } }),
                msg({ role: MessageRole.USER, text: 'check ETH funding' }),
                msg({ role: MessageRole.AI, text: 'Funding is cooling off.', modelsUsed: { p1: 'model-b' } }),
            ]} />);
        const rowOf = (name: string): string =>
            (screen.getByText(name).closest('button') as HTMLElement).textContent ?? '';
        expect(rowOf('Scout')).toContain('Buy wall holding at 94.8k.');
        expect(rowOf('Scout')).not.toContain('Funding is cooling');
        expect(rowOf('Ledger')).toContain('Funding is cooling off.');
        expect(rowOf('Ledger')).not.toContain('Buy wall');
    });

    it('rings the row of the bot that is working', () => {
        render(<AgentsView {...base}
            bots={[bot({ id: 'b1', name: 'Scout' }), bot({ id: 'b2', name: 'Ledger' })]}
            workingBotId="b1" />);
        const discOf = (name: string): string =>
            (screen.getByText(name).closest('button')?.querySelector('span') as HTMLElement).className;
        expect(discOf('Scout')).toContain('border-amber-500/40');
        expect(discOf('Ledger')).not.toContain('border-amber-500/40');
    });

    it('creates both kinds of thread from the rail header', () => {
        const onNewBot = vi.fn();
        const onNewGroup = vi.fn();
        render(<AgentsView {...base} onNewBot={onNewBot} onNewGroup={onNewGroup} />);
        fireEvent.click(screen.getByTestId('rail-new'));
        expect(onNewBot).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByRole('button', { name: /Rooms/ }));
        expect(onNewGroup).toHaveBeenCalledTimes(1);
    });

    it('says what will appear on an empty desk', () => {
        render(<AgentsView {...base} />);
        expect(screen.getByText(/No agents yet/)).toBeTruthy();
    });

    it('deletes a room without selecting it', () => {
        const onDeleteGroup = vi.fn();
        const onSelect = vi.fn();
        render(<AgentsView {...base} groups={[group('g1', ['b1'], 'War room')]}
            onDeleteGroup={onDeleteGroup} onSelect={onSelect} />);
        fireEvent.click(screen.getByLabelText('Delete War room'));
        expect(onDeleteGroup).toHaveBeenCalledWith('g1');
        expect(onSelect).not.toHaveBeenCalled();
    });

    it('shows no trash the surface was not given a handler for', () => {
        render(<AgentsView {...base} bots={[bot({ id: 'b1', name: 'Scout' })]}
            groups={[group('g1', [], 'War room')]} />);
        expect(screen.queryByLabelText('Delete Scout')).toBeNull();
        expect(screen.queryByLabelText('Delete War room')).toBeNull();
    });

    it('counts what the Coach shortcut is waiting on, and opens that thread', () => {
        const onSelect = vi.fn();
        const { rerender } = render(<AgentsView {...base} onSelect={onSelect} />);
        expect(screen.getByTestId('rail-coach').textContent?.trim()).toBe('Coach');
        rerender(<AgentsView {...base} coachCount={2} onSelect={onSelect} />);
        expect(screen.getByTestId('rail-coach').textContent?.trim()).toBe('Coach · 2');
        fireEvent.click(screen.getByTestId('rail-coach'));
        expect(onSelect).toHaveBeenCalledWith({ kind: 'coach' });
    });
});
