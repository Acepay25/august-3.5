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
import NavRail from '../components/shell/NavRail';
import type { AgentBot, AgentGroup } from '../services/agents/agentRoster';
import type { Message } from '../types/message';
import { MessageRole, TradeOutcome } from '../types/enums';

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
    selection: { kind: 'team' } as const,
    onSelect: () => {},
    onNewBot: () => {},
    onNewGroup: () => {},
    onSendBotTurn: vi.fn(async () => true),
    onAnalyze: vi.fn(),
    coachCount: 0,
};

beforeEach(() => { localStorage.clear(); seq = 0; });

/** Renders the column and puts it on the BOTS tab. The roster and the
 *  conversations are no longer one scroll — the column splits them the way
 *  the reference splits SESSIONS and BOTS — so a test that reaches for a
 *  bot row has to ask for the tab that shows it. */
const renderBots = (ui: React.ReactElement): ReturnType<typeof render> => {
    const r = render(ui);
    fireEvent.click(screen.getByTestId('rail-tab-bots'));
    return r;
};

afterEach(cleanup);

describe('AgentsView layout', () => {
    it('renders the rail, the pane and the pill composer', () => {
        renderBots(<AgentsView {...base} />);
        expect(screen.getByTestId('agents-view')).toBeTruthy();
        expect(screen.getByTestId('agents-rail')).toBeTruthy();
        expect(screen.getByTestId('composer-send')).toBeTruthy();
    });

    it('shows a greeting instead of a dead-end when nothing is open', () => {
        renderBots(<AgentsView {...base} bots={[bot({ id: 'b1' })]} />);
        const pane = screen.getByTestId('agents-view').textContent ?? '';
        expect(pane).toMatch(/Morning|Afternoon|Evening|Still up/);
        expect(pane).not.toMatch(/Pick an agent to open it as a Chart AI session/);
    });

    it('surfaces the roster actions the old rail owned', () => {
        const bots = [bot({ id: 'b1', name: 'Sweeper' })];
        const onDeleteBot = vi.fn();
        const onRunRoutine = vi.fn();
        renderBots(<AgentsView {...base} bots={bots} onDeleteBot={onDeleteBot}
            botRoutines={{ b1: [{ id: 'r1', name: 'Morning brief', enabled: true } as never] }}
            onRunRoutine={onRunRoutine} />);
        fireEvent.click(screen.getByLabelText('Delete Sweeper'));
        expect(onDeleteBot).toHaveBeenCalledWith('b1');
    });

    it('opens the routines disclosure and runs one', () => {
        const onRunRoutine = vi.fn();
        const routine = { id: 'r1', name: 'Morning brief', enabled: true, schedule: { cron: '0 9 * * 1-5' } } as never;
        renderBots(<AgentsView {...base} bots={[bot({ id: 'b1' })]}
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
        renderBots(<AgentsView {...base} bots={[bot({ id: 'b1' })]} botRoutines={{ b1: [] }} />);
        expect(screen.queryByTestId('row-routines')).toBeNull();
    });

    it('lists the schedule but offers no Run without the run handler', () => {
        renderBots(<AgentsView {...base} bots={[bot({ id: 'b1' })]}
            botRoutines={{ b1: [{ id: 'r1', name: 'Morning brief', enabled: true, schedule: { cron: '0 9 * * 1-5' } } as never] }} />);
        fireEvent.click(screen.getByTestId('row-routines'));
        expect(screen.getByText('Morning brief')).toBeTruthy();
        expect(screen.queryByText('Run')).toBeNull();
    });

    it('tolerates foreign ids in its pin list (Stage 8 reuses the key)', () => {
        // The Chart AI session rail stores `s-…` ids in THIS key namespace
        // (`agent_pins_v1_<user>`). A mixed list is the steady state, not the
        // edge case: bot ids, chat-session ids and anything else must all be
        // no-ops for the roster rows, never a crash or a phantom row.
        localStorage.setItem('agent_pins_v1_rober', JSON.stringify(['b1', 's-1720000000-abc', 'garbage', 42]));
        render(<AgentsView {...base} bots={[bot({ id: 'b1' })]} groups={[group('g1', ['b1'])]} />);
        expect(screen.getByTestId('agents-view')).toBeTruthy();
        // Every real row still renders; the foreign ids render nothing.
        expect(screen.getByTestId('rail-pinned').textContent).toContain('Macro');
        expect(screen.getByTestId('chart-ai-row')).toBeTruthy();
        // …and the pin TOGGLE on a real row still round-trips through the
        // shared key without disturbing the foreign entries.
        fireEvent.click(screen.getByRole('button', { name: 'Unpin Macro' }));
        const pins: unknown = JSON.parse(localStorage.getItem('agent_pins_v1_rober') ?? '[]');
        expect(pins).toEqual(['s-1720000000-abc', 'garbage', 42]);
    });

    it('keeps group edit and delete reachable from the room row', () => {
        const onEditGroup = vi.fn();
        render(<AgentsView {...base} groups={[group('g1', ['b1'], 'War room')]} onEditGroup={onEditGroup} />);
        fireEvent.click(screen.getByTestId('rail-edit-group'));
        expect(onEditGroup).toHaveBeenCalledWith('g1');
    });

    it('pins reorder the rail and survive a remount', () => {
        // The pin control lives on the roster row, so the first half is on the
        // Bots tab; the Pinned header it feeds is a Chats-tab section.
        const { unmount } = renderBots(<AgentsView {...base} bots={[bot({ id: 'b1', name: 'Pinned me' })]} />);
        fireEvent.click(screen.getByLabelText('Pin Pinned me'));
        unmount();
        render(<AgentsView {...base} bots={[bot({ id: 'b1', name: 'Pinned me' })]} />);
        expect(screen.getByText('Pinned')).toBeTruthy();
    });
});

describe('AgentsView composer', () => {
    it('a selected bot takes the send, not the pipeline', async () => {
        const onSendBotTurn = vi.fn(async () => true);
        const onAnalyze = vi.fn();
        const b = bot({ id: 'b1', name: 'Macro' });
        render(<AgentsView {...base} bots={[b]} selection={{ kind: 'bot', botId: 'b1' }}
            messages={[msg({ role: MessageRole.USER, text: 'reading the tape' })]}
            onSendBotTurn={onSendBotTurn} onAnalyze={onAnalyze} />);
        fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'what about BTC?' } });
        fireEvent.click(screen.getByTestId('composer-send'));
        await waitFor(() => expect(onSendBotTurn).toHaveBeenCalledWith(b, 'what about BTC?'));
        expect(onAnalyze).not.toHaveBeenCalled();
    });

    it('no bot selected sends the same text to the full analysis pipeline', () => {
        const onAnalyze = vi.fn();
        render(<AgentsView {...base} onAnalyze={onAnalyze} />);
        fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'BTC setup' } });
        fireEvent.click(screen.getByTestId('composer-send'));
        expect(onAnalyze).toHaveBeenCalledWith('BTC setup', []);
    });

    it('has no Chat/Analyze switch — the rail is the only selector', () => {
        // The toggle said the same thing the rail already says. A second
        // control for one decision is one more thing to read, and it was the
        // reason the attach button had to explain itself.
        //
        // NOT the same thing as `chat-mode-chat` / `chat-mode-desk-ai`
        // (components/shell/ChatModePill.tsx), which choose which PANE is in
        // front and never touch the send path. Do not merge the two: this one
        // forbids a second answer to "where does this message go".
        render(<AgentsView {...base} />);
        expect(screen.queryByTestId('mode-chat')).toBeNull();
        expect(screen.queryByTestId('mode-analyze')).toBeNull();
        expect(screen.queryByRole('group', { name: 'Send mode' })).toBeNull();
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
        renderBots(<AgentsView {...base} bots={[bot({ id: 'b1', name: 'Sweeper' })]}
            selection={{ kind: 'bot', botId: 'b1' }} botStats={stats} />);
        const line = screen.getByTestId('bot-learning-stats');
        expect(line.textContent).toContain('4 lessons');
        expect(line.textContent).toContain('2 skills');
        expect(line.textContent).toContain('9 evidence');
        expect(line.getAttribute('title')).toContain('2026-09-18');
    });

    it('badges the rail row with the skills that bot authored', () => {
        renderBots(<AgentsView {...base} bots={[bot({ id: 'b1' })]} botStats={stats} />);
        expect(screen.getByTestId('row-skills').textContent).toBe('2');
    });

    it('shows no badge for a bot that has authored nothing', () => {
        renderBots(<AgentsView {...base} bots={[bot({ id: 'b1' })]}
            botStats={[{ ...stats[0], skillsAuthored: 0 }]} />);
        expect(screen.queryByTestId('row-skills')).toBeNull();
    });

    it('says whether the bot is synced with the shared notebook', () => {
        renderBots(<AgentsView {...base} bots={[bot({ id: 'b1' })]}
            selection={{ kind: 'bot', botId: 'b1' }} botStats={stats} />);
        const pill = screen.getByTestId('bot-notebook-sync');
        expect(pill.textContent).toBe('notebook');
        expect(pill.getAttribute('title')).toContain('Last lesson 2026-09-18');
    });

    it('an isolated bot reads as isolated — in the pill and in the empty state', () => {
        renderBots(<AgentsView {...base} bots={[bot({ id: 'b1', name: 'Sweeper', memoryScope: 'isolated' })]}
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
        renderBots(<AgentsView {...base} messages={messages} selection={{ kind: 'team' }} />);
        expect(screen.getByTestId('agents-view').textContent).toContain('skip the short');
    });

    it('has no coach pane — the Coach inbox is a Learn tab, reached from its own row', () => {
        renderBots(<AgentsView {...base} onOpenCoach={() => {}} coachCount={2} />);
        expect(screen.queryByTestId('coach-pane')).toBeNull();
        // The row replaced the menu item that used to be the only way here.
        expect(screen.getByTestId('rail-coach-inbox').textContent).toContain('Coach inbox');
    });

    it('renames a bot from its own row', () => {
        const onRenameBot = vi.fn();
        renderBots(<AgentsView {...base} bots={[bot({ id: 'b1', name: 'Macro' })]} onRenameBot={onRenameBot} />);
        fireEvent.click(screen.getByTestId('rail-rename'));
        fireEvent.change(screen.getByTestId('bot-rename-input'), { target: { value: '  Sweeper  ' } });
        fireEvent.click(screen.getByText('Save'));
        expect(onRenameBot).toHaveBeenCalledWith('b1', 'Sweeper');
    });

    it('sorts by name and back to recency', () => {
        renderBots(<AgentsView {...base} bots={[bot({ id: 'b1', name: 'Alpha' }), bot({ id: 'b2', name: 'Zeta' })]}
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
        renderBots(<AgentsView {...base} modelPicker={<button data-testid="model-picker">Gemini · flash</button>} />);
        expect(screen.getByTestId('model-picker')).toBeTruthy();
        expect(screen.queryByTestId('composer-model')).toBeNull();
    });

    /**
     * The Chat ⇄ Chart AI hop is a MODE switch, so it must not restack the
     * shell. This column used to keep its own width and its own per-profile
     * collapse key, which made the sidebar jump when the pill moved you to the
     * chart — and left the header's "Expand navigation" driving a rail that was
     * not mounted on this surface at all. Three claims, all measured against
     * the rail itself rather than against a number this file could copy.
     */
    it('is the same width as the rail, so the hop cannot shift the shell', () => {
        render(
            <>
                <NavRail
                    expanded
                    onToggleExpanded={() => {}}
                    activeUsername="rober"
                    surface="agents"
                    onSelectSurface={() => {}}
                    onOpenSettings={() => {}}
                />
                <AgentsView {...base} bots={[bot({ id: 'b1' })]} />
            </>,
        );
        const railPx = screen.getByTestId('nav-rail').style.width;
        const chatPx = screen.getByTestId('agents-rail').style.getPropertyValue('--rail-w');
        expect(railPx).not.toBe('');
        expect(chatPx).toBe(railPx);
        // The mobile drawer keeps its own wider width; only md+ is shared.
        expect(screen.getByTestId('agents-rail').className).toContain('md:w-[var(--rail-w)]');
    });

    it('collapses through the state the shell hands in, not a switch of its own', () => {
        const onToggleRailExpanded = vi.fn();
        renderBots(
            <AgentsView
                {...base}
                bots={[bot({ id: 'b1' })]}
                railExpanded={false}
                onToggleRailExpanded={onToggleRailExpanded}
            />,
        );
        expect(screen.getByTestId('agents-rail').className).toContain('md:hidden');
        fireEvent.click(screen.getByTestId('rail-collapse'));
        expect(onToggleRailExpanded).toHaveBeenCalledTimes(1);
        // Controlled: pressing put-away cannot un-hide it behind the shell's back.
        expect(screen.getByTestId('agents-rail').className).toContain('md:hidden');
    });

    it('draws no put-away control it has nothing to act on', () => {
        renderBots(<AgentsView {...base} bots={[bot({ id: 'b1' })]} />);
        expect(screen.queryByTestId('rail-collapse')).toBeNull();
        expect(screen.queryByTestId('rail-expand')).toBeNull();
    });
});

describe('the composer’s Stop', () => {
    // The pipeline card used to be the only Stop on this surface, and it floated
    // over the reading column — covering the answer it was waiting for. Stop is
    // the send button's other state now, so the run that started here is ended
    // from the same place. Pinned in jsdom because the mock provider answers
    // faster than a browser probe can poll.
    it('is the send button while idle and Stop while the run is in flight', async () => {
        const onStopRun = vi.fn();
        render(<AgentsView {...base}
            onAnalyze={() => new Promise<never>(() => {})} onStopRun={onStopRun} />);
        const send = () => screen.getByTestId('composer-send');
        expect(send().getAttribute('aria-label')).toBe('Send');
        fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'is BTC heavy here' } });
        fireEvent.click(send());
        await waitFor(() => expect(send().getAttribute('aria-label')).toBe('Stop'));
        fireEvent.click(send());
        expect(onStopRun).toHaveBeenCalledTimes(1);
    });
});

describe('the mode switch has exactly one home', () => {
    // The reference's chat ⇄ code switch sits at the LEFT edge of the sidebar,
    // which is the same x the rail-less surfaces put it — so the hop moves the
    // content and not the control. Two homes would be two navigations; no home
    // would be a surface you cannot leave.
    const sw = <div data-testid="the-switch" />;

    it('sits in the conversation column while the column is open', () => {
        render(<AgentsView {...base} railExpanded onToggleRailExpanded={() => {}} surfaceSwitch={sw} />);
        const hits = screen.getAllByTestId('the-switch');
        expect(hits.length).toBe(1);
        expect(hits[0].closest('[data-testid="agents-rail"]')).toBeTruthy();
        expect(hits[0].closest('[data-testid="chat-header"]')).toBeNull();
    });

    it('moves to the header when the column is put away, and is never doubled', () => {
        render(<AgentsView {...base} railExpanded={false} onToggleRailExpanded={() => {}} surfaceSwitch={sw} />);
        const hits = screen.getAllByTestId('the-switch');
        expect(hits.length).toBe(1);
        expect(hits[0].closest('[data-testid="chat-header"]')).toBeTruthy();
    });
});

describe('composer attachments (WS-6)', () => {
    const png = (): File => new File(['pretend-bytes'], 'chart.png', { type: 'image/png' });

    /**
     * Picking a file reads it through a real `FileReader`, so "the chip
     * appeared" is an EVENTUAL state, not a latency claim — but the default
     * `waitFor` timeout is one second, which is exactly a latency budget.
     *
     * These three assertions were therefore timing-dependent, not
     * correctness-dependent: they passed in isolation and failed intermittently
     * when the whole suite ran under the coverage instrumenter on a loaded
     * machine. That is how a 48-test file failed a CI run twice while the
     * product code was never wrong. The generous timeout keeps the assertion
     * about WHAT must eventually be true; it does not stop failing when the
     * chip never arrives.
     */
    const EVENTUALLY = { timeout: 5_000 };

    it('offers attach for analysis sends, and says why it is off for a bot', () => {
        render(<AgentsView {...base} />);
        expect(screen.getByTestId('composer-attach').hasAttribute('disabled')).toBe(false);
        // The old tooltip had to explain the mode; there is no mode to explain.
        expect(screen.getByTestId('composer-attach').getAttribute('title')).not.toContain('Analyze mode');
        // A bot turn drops attachments silently (they run only with the
        // pipeline) — stage 3 makes the control say so instead of lying.
        cleanup();
        render(<AgentsView {...base} selection={{ kind: 'bot', botId: 'b1' }} bots={[bot({ id: 'b1', name: 'Sweeper' })]} />);
        const attach = screen.getByTestId('composer-attach');
        expect(attach.hasAttribute('disabled')).toBe(true);
        expect(attach.getAttribute('title')).toContain('text-only');
    });

    it('reads a picked image into a chip and sends it with the prompt, then clears', async () => {
        const onAnalyze = vi.fn();
        render(<AgentsView {...base} onAnalyze={onAnalyze} />);
        fireEvent.change(screen.getByTestId('composer-file'), { target: { files: [png()] } });
        await waitFor(() => expect(screen.getByTestId('composer-attachments')).toBeTruthy(), EVENTUALLY);

        fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'look at this tape' } });
        fireEvent.click(screen.getByTestId('composer-send'));
        await waitFor(() => expect(onAnalyze).toHaveBeenCalledWith(
            'look at this tape',
            [{ name: 'chart.png', dataURL: expect.stringMatching(/^data:image\/png/) }],
        ), EVENTUALLY);
        await waitFor(() => expect(screen.queryByTestId('composer-attachments')).toBeNull(), EVENTUALLY);
    });

    it('drops one chip without touching the others', async () => {
        render(<AgentsView {...base} />);
        fireEvent.change(screen.getByTestId('composer-file'), { target: { files: [png()] } });
        await waitFor(() => expect(screen.getByTestId('composer-attachments')).toBeTruthy(), EVENTUALLY);
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
        // The field is revealed on demand now, so "the shortcut did not fire"
        // is visible as the field never appearing at all — a stronger claim
        // than "it exists but is not focused", and the one that matters: the
        // sidebar must not hijack a `/` typed into a sentence.
        expect(screen.queryByTestId('rail-search')).toBeNull();
        expect(composer).toBe(document.activeElement);
    });

    it('the magnifier reveals the field, and Escape on an empty one hides it', () => {
        render(<AgentsView {...base} bots={[bot({ id: 'b1' })]} />);
        expect(screen.queryByTestId('rail-search')).toBeNull();
        fireEvent.click(screen.getByTestId('rail-search-toggle'));
        const field = screen.getByTestId('rail-search');
        expect(field).toBe(document.activeElement);
        fireEvent.keyDown(field, { key: 'Escape' });
        expect(screen.queryByTestId('rail-search')).toBeNull();
    });

    it('picking a thread closes the drawer, and the backdrop closes it too', () => {
        const onSelect = vi.fn();
        render(<AgentsView {...base} bots={[bot({ id: 'b1', name: 'Sweeper' })]} onSelect={onSelect} />);
        fireEvent.click(screen.getByTestId('rail-open'));
        expect(screen.getByTestId('rail-backdrop')).toBeTruthy();
        fireEvent.click(screen.getByTestId('rail-backdrop'));
        expect(screen.queryByTestId('rail-backdrop')).toBeNull();

        fireEvent.click(screen.getByTestId('rail-open'));
        fireEvent.click(screen.getByTestId('rail-tab-bots'));
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
 * Coach hop count) that nothing else asserted. What was NOT ported was either
 * already covered above (row click selects, room edit, bot delete, pin,
 * rename, routines) or was chrome of the deleted rail itself (its embedded
 * variant, its “+” menu popover, the Team row it carried before rooms subsumed
 * it, and the room's last-message preview — this surface hands a room's
 * transcript to GroupChatView instead of painting one in the row).
 */
describe('AgentsView rail rows (ported from the roster-rail suite)', () => {
    it('lists the roster on its own tab and the rooms on the chat tab', () => {
        const unnamed: AgentGroup = { id: 'g1', memberIds: ['b1', 'b2'], createdAt: new Date().toISOString() };
        renderBots(<AgentsView {...base}
            bots={[bot({ id: 'b1', name: 'Scout' }), bot({ id: 'b2', name: 'Ledger' })]}
            groups={[unnamed]} />);
        expect(screen.getAllByTestId('agent-row')).toHaveLength(2);
        fireEvent.click(screen.getByTestId('rail-tab-chats'));
        expect(screen.getAllByTestId('agent-row')).toHaveLength(1);
        expect(screen.getByText('Scout, Ledger')).toBeTruthy();
    });

    it('marks the open thread and leaves the others idle', () => {
        renderBots(<AgentsView {...base} bots={[bot({ id: 'b1', name: 'Scout' })]}
            groups={[group('g1', ['b1'], 'War room')]} selection={{ kind: 'group', groupId: 'g1' }} />);
        const botRow = screen.getByTestId('agent-row');
        // The active fill is on the row shell, two levels above the button.
        const shellOf = (row: HTMLElement): string => row.parentElement?.parentElement?.className ?? '';
        expect(shellOf(botRow)).not.toContain('bg-zinc-800/70');
        fireEvent.click(screen.getByTestId('rail-tab-chats'));
        expect(shellOf(screen.getByTestId('agent-row'))).toContain('bg-zinc-800/70');
    });

    it('filters the bot and room rows by name from the rail search', () => {
        renderBots(<AgentsView {...base}
            bots={[bot({ id: 'b1', name: 'Scout' }), bot({ id: 'b2', name: 'Ledger' })]}
            groups={[group('g1', ['b1', 'b2'], 'Alpha Desk')]} />);
        fireEvent.click(screen.getByTestId('rail-search-toggle'));
        fireEvent.change(screen.getByTestId('rail-search'), { target: { value: 'ledger' } });
        expect(screen.queryByText('Scout')).toBeNull();
        expect(screen.getByText('Ledger')).toBeTruthy();
        expect(screen.queryByText('Alpha Desk')).toBeNull();
    });

    it('scopes a row to its bot’s provider + model: two bots on one provider keep separate threads', () => {
        renderBots(<AgentsView {...base}
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

    it('marks the row of the bot that is working', () => {
        // The row's identity graphic is the bot's own `BotFace`, so "working"
        // rides on the face — the eyes blink — rather than on an amber ring
        // around a generic glyph. Same signal, one fewer vocabulary.
        renderBots(<AgentsView {...base}
            bots={[bot({ id: 'b1', name: 'Scout' }), bot({ id: 'b2', name: 'Ledger' })]}
            workingBotId="b1" />);
        const blinking = (name: string): boolean => {
            const row = screen.getByText(name).closest('button') as HTMLElement;
            return [...row.querySelectorAll('g')]
                .some(g => /botface-blink/.test(g.getAttribute('style') || ''));
        };
        expect(blinking('Scout')).toBe(true);
        expect(blinking('Ledger')).toBe(false);
    });

    it('creates both kinds of thread from their own list header', () => {
        const onNewBot = vi.fn();
        const onNewGroup = vi.fn();
        renderBots(<AgentsView {...base} onNewBot={onNewBot} onNewGroup={onNewGroup} />);
        fireEvent.click(screen.getByTestId('rail-new-bot'));
        expect(onNewBot).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByTestId('rail-tab-chats'));
        fireEvent.click(screen.getByTestId('rail-new-room'));
        expect(onNewGroup).toHaveBeenCalledTimes(1);
    });

    it('says what will appear on an empty desk', () => {
        renderBots(<AgentsView {...base} />);
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
        renderBots(<AgentsView {...base} bots={[bot({ id: 'b1', name: 'Scout' })]}
            groups={[group('g1', [], 'War room')]} />);
        expect(screen.queryByLabelText('Delete Scout')).toBeNull();
        expect(screen.queryByLabelText('Delete War room')).toBeNull();
    });

    it('counts what the Coach hop is waiting on, and jumps to the Learn tab', () => {
        const onOpenCoach = vi.fn();
        const { rerender } = render(<AgentsView {...base} onOpenCoach={onOpenCoach} />);
        expect(screen.getByTestId('rail-coach-inbox').textContent).toContain('Coach inbox');
        rerender(<AgentsView {...base} coachCount={2} onOpenCoach={onOpenCoach} />);
        // The count rides in the accessible name, not just the badge, so a
        // screen reader hears the queue depth rather than a bare row label.
        expect(screen.getByLabelText('Coach inbox. 2 awaiting your decision')).toBeTruthy();
        fireEvent.click(screen.getByTestId('rail-coach-inbox'));
        expect(onOpenCoach).toHaveBeenCalledTimes(1);
    });
});

describe('WS-6 §5 row context menu', () => {
    const routine = { id: 'r1', name: 'Morning brief', enabled: true, schedule: { cron: '0 9 * * 1-5' } } as never;

    it('right-clicking a bot row lists pin, rename, routines and delete', () => {
        const onDeleteBot = vi.fn();
        const onRenameBot = vi.fn();
        renderBots(<AgentsView {...base} bots={[bot({ id: 'b1', name: 'Sweeper' })]}
            onDeleteBot={onDeleteBot} onRenameBot={onRenameBot}
            botRoutines={{ b1: [routine] }} />);
        expect(screen.queryByTestId('row-menu-popover')).toBeNull();
        fireEvent.contextMenu(screen.getByTestId('agent-row'));
        const menu = screen.getByTestId('row-menu-popover');
        expect(menu.getAttribute('role')).toBe('menu');
        expect([...menu.querySelectorAll('[role="menuitem"]')].map(b => b.textContent)).toEqual(
            ['Pin', 'Rename', 'Routines (1)', 'Delete bot'],
        );
        fireEvent.click(screen.getByRole('menuitem', { name: 'Delete bot' }));
        expect(onDeleteBot).toHaveBeenCalledWith('b1');
        // Choosing an item is also a dismissal — a menu that stays after the
        // action is a menu the user has to close by hand.
        expect(screen.queryByTestId('row-menu-popover')).toBeNull();
    });

    it('the ⋯ trigger reaches the same actions, and Rename opens the inline form', () => {
        renderBots(<AgentsView {...base} bots={[bot({ id: 'b1', name: 'Sweeper' })]}
            onRenameBot={vi.fn()} />);
        fireEvent.click(screen.getByTestId('row-menu'));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
        expect(screen.getByTestId('bot-rename-input').getAttribute('value')).toBe('Sweeper');
    });

    it('Escape closes it, and a row with no actions gets no trigger', () => {
        renderBots(<AgentsView {...base} bots={[bot({ id: 'b1' })]} />);
        fireEvent.contextMenu(screen.getByTestId('agent-row'));
        expect(screen.getByTestId('row-menu-popover')).toBeTruthy();
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(screen.queryByTestId('row-menu-popover')).toBeNull();
        // The desk's own thread has nothing to rename or delete — right-click
        // there must stay the browser's.
        expect(screen.queryByLabelText('Chart AI options')).toBeNull();
    });

    it('rooms list edit and delete from the menu, pinned ones too', () => {
        const onDeleteGroup = vi.fn();
        localStorage.setItem('agent_pins_v1_rober', JSON.stringify(['g1']));
        render(<AgentsView {...base} groups={[group('g1', [], 'War room')]} onDeleteGroup={onDeleteGroup} />);
        expect(screen.getByTestId('rail-pinned').textContent).toContain('War room');
        fireEvent.contextMenu(screen.getByTestId('agent-row'));
        expect(screen.getByRole('menuitem', { name: 'Unpin' })).toBeTruthy();
        fireEvent.click(screen.getByRole('menuitem', { name: 'Delete room' }));
        expect(onDeleteGroup).toHaveBeenCalledWith('g1');
    });
});

describe('AgentsView elapsed labels', () => {
    // §1b.1 of docs/plans/ui-ux-target-plan-2026-10-11.md: `relTime` computed
    // a DURATION (`Date.now() - Date.parse(iso)`) and handed it to `relTimeMs`,
    // which subtracted `Date.now()` again — so an 8-day-old row printed
    // `20731d`, the epoch leaking through a double subtraction. The suite could
    // not catch it because nothing asserted the string; these pin it.
    const daysAgo = (d: number): string => new Date(Date.now() - d * 86_400_000).toISOString();

    const pane = (): string => screen.getByTestId('agents-view').textContent ?? '';

    it('an 8-day-old answer reads `8d`, not an epoch-leaked day count', () => {
        render(<AgentsView {...base} bots={[bot({ id: 'b1' })]} selection={{ kind: 'bot', botId: 'b1' }}
            messages={[
                msg({ role: MessageRole.USER, text: 'look at BTC', createdAt: daysAgo(8) }),
                msg({ role: MessageRole.AI, text: 'short it', createdAt: daysAgo(8), botId: 'b1', modelsUsed: { 'p-b1': 'm1' } }),
            ]} />);
        expect(pane()).toContain('8d');
        // The exact defect signature: any 5+ digit day count.
        expect(pane()).not.toMatch(/\b\d{5,}d\b/);
    });

    it('an 8-day-old conversation row reads `8d` too', () => {
        render(<AgentsView {...base} selection={{ kind: 'team' }}
            conversations={[{
                id: 'c1', title: 'hello', timestamp: Date.now() - 8 * 86_400_000,
                messages: [msg({ role: MessageRole.USER, text: 'hello', createdAt: daysAgo(8) })],
            } as never]}
            onLoadConversation={vi.fn()} activeConversationId={null} />);
        const row = screen.getByTestId('conversation-row');
        expect(row.textContent).toContain('8d');
        expect(row.textContent).not.toMatch(/\b\d{5,}d\b/);
    });

    it('fresh, minutes and hours buckets all read as elapsed time', () => {
        render(<AgentsView {...base} bots={[bot({ id: 'b1' })]} selection={{ kind: 'bot', botId: 'b1' }}
            messages={[
                msg({ role: MessageRole.AI, text: 'just now', createdAt: new Date().toISOString(),
                    botId: 'b1', modelsUsed: { 'p-b1': 'm1' } }),
                msg({ role: MessageRole.USER, text: 'forty five', createdAt: new Date(Date.now() - 45 * 60_000).toISOString() }),
            ]} />);
        expect(pane()).toContain('now');
        expect(pane()).toContain('45m');
    });

    it('a missing or unparseable stamp prints no label rather than a wrong one', () => {
        render(<AgentsView {...base} bots={[bot({ id: 'b1' })]} selection={{ kind: 'bot', botId: 'b1' }}
            messages={[msg({ role: MessageRole.AI, text: 'no stamp', botId: 'b1' })]} />);
        expect(pane()).not.toMatch(/\d+d\b/);
    });
});

describe('AgentsView decision card furniture', () => {
    // §1b.2–§1b.5 of docs/plans/ui-ux-target-plan-2026-10-11.md, all pinned
    // against the desk pane: one card per turn, a labelled confidence, and a
    // sentence-case disclosure.
    const analysisFor = (): Message['analysis'] => ({
        coinName: 'BTCUSDT', direction: 'Short', confidence: 'Medium',
        entryPoints: [{ description: 'x', price: '85175' }],
        stopLoss: '85295', takeProfit: [{ price: '85000' }],
        probability: 0.62,
    } as Message['analysis']);

    const pane = (): string => screen.getByTestId('agents-view').textContent ?? '';

    it('renders the card ONCE per turn — the logging receipt is not a second card', () => {
        // "Log this trade" appends a receipt row carrying a COPY of the plan's
        // analysis (the journal row and the autopilot read it). Rendering it
        // drew the identical ENTRY/STOP/TARGET/PROBABILITY card a second time
        // in the same turn — two rows, one fact.
        const a = analysisFor();
        render(<AgentsView {...base} selection={{ kind: 'team' }}
            messages={[
                msg({ role: MessageRole.AI, text: 'short it here', modelsUsed: { 'p-1': 'm1' }, analysis: a }),
                msg({ role: MessageRole.AI, text: 'Logged from Chart AI — Short BTCUSDT · plan btc-abc',
                    analysis: a, planId: 'btc-abc', outcome: TradeOutcome.PENDING }),
            ]} />);
        expect(screen.getAllByTestId('inline-verdict')).toHaveLength(1);
        // The receipt row itself still renders — only its duplicate card is gone.
        expect(pane()).toContain('Logged from Chart AI');
    });

    it('labels the confidence value instead of printing a bare MEDIUM', () => {
        render(<AgentsView {...base} selection={{ kind: 'team' }}
            messages={[msg({ role: MessageRole.AI, text: 'short it here', modelsUsed: { 'p-1': 'm1' }, analysis: analysisFor() })]} />);
        const card = screen.getByTestId('inline-verdict');
        expect(card.textContent).toContain('confidence');
        expect(card.textContent).toContain('Medium');
        // …and it sits beside its label, not floating alone.
        expect(card.textContent).toMatch(/confidence\s*Medium/i);
    });

    it('keeps the audit disclosure sentence case — no uppercase shout', () => {
        // The `uppercase tracking-wider text-ui-2xs` texture the rail headings
        // lost was still on this summary, so a sentence-case source shouted.
        render(<AgentsView {...base} selection={{ kind: 'team' }}
            messages={[msg({ role: MessageRole.AI, text: 'short it here', modelsUsed: { 'p-1': 'm1' }, analysis: analysisFor() })]} />);
        const summary = screen.getByText('Inspect debate audit & evidence');
        expect(summary.parentElement?.className).not.toMatch(/uppercase|tracking-wider/);
    });
});
