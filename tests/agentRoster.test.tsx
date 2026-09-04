import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

import { AgentRosterRail } from '../components/chat/AgentRosterRail';
import { MessageRole } from '../types/enums';
import { Message } from '../types/message';
import { AgentBot, AgentGroup } from '../services/agents/agentRoster';

beforeAll(() => {
    if (typeof window !== 'undefined' && !window.matchMedia) {
        window.matchMedia = ((query: string) => ({
            matches: false, media: query, onchange: null,
            addListener: () => {}, removeListener: () => {},
            addEventListener: () => {}, removeEventListener: () => {},
            dispatchEvent: () => false,
        })) as unknown as typeof window.matchMedia;
    }
});

afterEach(() => {
    cleanup();
    if (typeof window !== 'undefined') window.localStorage.clear();
});

let seq = 0;
const msg = (over: Partial<Message>): Message => ({
    id: over.id ?? `m${seq += 1}`,
    role: over.role ?? MessageRole.USER,
    text: over.text ?? '',
    createdAt: over.createdAt ?? new Date(Date.now() - seq * 60_000).toISOString(),
    ...over,
});

const bot = (over: Partial<AgentBot>): AgentBot => ({
    id: over.id ?? `b${seq += 1}`,
    name: over.name ?? 'Scout',
    providerId: over.providerId ?? 'p1',
    modelId: over.modelId ?? 'gpt-test',
    avatar: over.avatar ?? { kind: 'auto' },
    createdAt: over.createdAt ?? new Date().toISOString(),
    ...over,
});

const group = (over: Partial<AgentGroup>): AgentGroup => ({
    id: over.id ?? `g${seq += 1}`,
    memberIds: over.memberIds ?? [],
    createdAt: over.createdAt ?? new Date().toISOString(),
    ...over,
});

const base = {
    messages: [] as Message[],
    bots: [] as AgentBot[],
    groups: [] as AgentGroup[],
    selection: { kind: 'coach' } as const,
    onSelectBot: () => {},
    onSelectGroup: () => {},
    onNewBot: () => {},
    onNewGroup: () => {},
};

describe('AgentRosterRail (bots + groups)', () => {
    it('renders one row per bot and one row per group — no Team row (merged into groups)', () => {
        render(
            <AgentRosterRail
                {...base}
                bots={[bot({ id: 'b1', name: 'Scout' }), bot({ id: 'b2', name: 'Ledger' })]}
                groups={[group({ id: 'g1', memberIds: ['b1', 'b2'] })]}
            />,
        );
        expect(screen.queryByTestId('roster-team')).toBeNull();
        expect(screen.getByTestId('roster-bot-b1')).toBeTruthy();
        expect(screen.getByTestId('roster-bot-b2')).toBeTruthy();
        expect(screen.getByTestId('roster-group-g1')).toBeTruthy();
        // Group display name defaults to member names joined.
        expect(screen.getByTestId('roster-group-g1').textContent).toContain('Scout, Ledger');
    });

    it('marks the active selection with data-active="1" (group thread)', () => {
        render(
            <AgentRosterRail
                {...base}
                selection={{ kind: 'group', groupId: 'g1' }}
                bots={[bot({ id: 'b1' })]}
                groups={[group({ id: 'g1', memberIds: ['b1'] })]}
            />,
        );
        expect(screen.getByTestId('roster-group-g1').getAttribute('data-active')).toBe('1');
        expect(screen.getByTestId('roster-bot-b1').getAttribute('data-active')).toBe('0');
    });

    it('clicking a bot row selects it', () => {
        const onSelectBot = vi.fn();
        render(
            <AgentRosterRail
                {...base}
                selection={{ kind: 'bot', botId: 'b2' }}
                onSelectBot={onSelectBot}
                bots={[bot({ id: 'b1' }), bot({ id: 'b2' })]}
            />,
        );
        fireEvent.click(screen.getByTestId('roster-bot-b2'));
        expect(onSelectBot).toHaveBeenCalledWith('b2');
    });

    it('search filters bot and group rows by name', () => {
        render(
            <AgentRosterRail
                {...base}
                bots={[bot({ id: 'b1', name: 'Scout' }), bot({ id: 'b2', name: 'Ledger' })]}
                groups={[group({ id: 'g1', memberIds: ['b1'], name: 'Alpha Desk' })]}
            />,
        );
        const search = screen.getByTestId('roster-search') as HTMLInputElement;
        fireEvent.change(search, { target: { value: 'ledger' } });
        expect(screen.queryByTestId('roster-bot-b1')).toBeNull();
        expect(screen.getByTestId('roster-bot-b2')).toBeTruthy();
        expect(screen.queryByTestId('roster-group-g1')).toBeNull();
    });

    it('scopes bot previews to provider+model: two bots on one provider keep separate threads', () => {
        const messages: Message[] = [
            msg({ role: MessageRole.USER, text: 'watch BTC order flow' }),
            msg({ role: MessageRole.AI, text: 'Buy wall holding at 94.8k.', modelsUsed: { p1: 'model-a' } }),
            msg({ role: MessageRole.USER, text: 'check ETH funding' }),
            msg({ role: MessageRole.AI, text: 'Funding is cooling off.', modelsUsed: { p1: 'model-b' } }),
        ];
        render(
            <AgentRosterRail
                {...base}
                bots={[
                    bot({ id: 'b1', name: 'Scout', providerId: 'p1', modelId: 'model-a' }),
                    bot({ id: 'b2', name: 'Ledger', providerId: 'p1', modelId: 'model-b' }),
                ]}
                messages={messages}
            />,
        );
        expect(screen.getByTestId('roster-bot-b1').textContent).toContain('Buy wall holding at 94.8k.');
        expect(screen.getByTestId('roster-bot-b1').textContent).not.toContain('Funding is cooling');
        expect(screen.getByTestId('roster-bot-b2').textContent).toContain('Funding is cooling off.');
        expect(screen.getByTestId('roster-bot-b2').textContent).not.toContain('Buy wall');
    });

    it('shows the group preview from the group slice (member replies, You: prefix on prompts)', () => {
        const messages: Message[] = [
            msg({ role: MessageRole.USER, text: 'analyze btc' }),
            msg({ role: MessageRole.AI, text: 'Trend is up.', modelsUsed: { p1: 'model-a' } }),
        ];
        render(
            <AgentRosterRail
                {...base}
                bots={[bot({ id: 'b1', providerId: 'p1', modelId: 'model-a' })]}
                groups={[group({ id: 'g1', memberIds: ['b1'] })]}
                messages={messages}
            />,
        );
        expect(screen.getByTestId('roster-group-g1').textContent).toContain('Trend is up.');
    });

    it('shows the active-now strip for the working bot', () => {
        render(
            <AgentRosterRail
                {...base}
                bots={[bot({ id: 'b1', name: 'Scout' })]}
                workingBotId="b1"
            />,
        );
        expect(screen.getByTestId('active-now').textContent).toContain('Scout is working');
    });

    it("the '+' menu exposes New Bot and New Group Chat", () => {
        const onNewBot = vi.fn();
        const onNewGroup = vi.fn();
        render(<AgentRosterRail {...base} bots={[]} onNewBot={onNewBot} onNewGroup={onNewGroup} />);
        fireEvent.click(screen.getByTestId('bots-add'));
        fireEvent.click(screen.getByTestId('menu-new-bot'));
        fireEvent.click(screen.getByTestId('bots-add'));
        fireEvent.click(screen.getByTestId('menu-new-group'));
        expect(onNewBot).toHaveBeenCalledTimes(1);
        expect(onNewGroup).toHaveBeenCalledTimes(1);
    });

    it('empty roster explains how to add a bot', () => {
        render(<AgentRosterRail {...base} bots={[]} groups={[]} />);
        expect(screen.getByTestId('agent-roster-rail').textContent).toContain('No bots yet');
    });
});

describe('AgentRosterRail delete affordance', () => {
    it('hover trash buttons call onDeleteBot / onDeleteGroup', () => {
        const onDeleteBot = vi.fn();
        const onDeleteGroup = vi.fn();
        render(
            <AgentRosterRail
                {...base}
                bots={[bot({ id: 'b1', name: 'Scout' })]}
                groups={[group({ id: 'g1', memberIds: ['b1'] })]}
                onDeleteBot={onDeleteBot}
                onDeleteGroup={onDeleteGroup}
            />,
        );
        fireEvent.click(screen.getByTestId('delete-bot-b1'));
        expect(onDeleteBot).toHaveBeenCalledWith('b1');
        fireEvent.click(screen.getByTestId('delete-group-g1'));
        expect(onDeleteGroup).toHaveBeenCalledWith('g1');
    });

    it('deleting does not select the row (stopPropagation)', () => {
        const onSelectBot = vi.fn();
        render(
            <AgentRosterRail
                {...base}
                bots={[bot({ id: 'b1', name: 'Scout' })]}
                onSelectBot={onSelectBot}
                onDeleteBot={vi.fn()}
            />,
        );
        fireEvent.click(screen.getByTestId('delete-bot-b1'));
        expect(onSelectBot).not.toHaveBeenCalled();
    });

    it('no trash without the delete callbacks', () => {
        render(<AgentRosterRail {...base} bots={[bot({ id: 'b1' })]} groups={[group({ id: 'g1' })]} />);
        expect(screen.queryByTestId('delete-bot-b1')).toBeNull();
        expect(screen.queryByTestId('delete-group-g1')).toBeNull();
    });
});

describe('AgentRosterRail group manage affordance (Team merge)', () => {
    it('hover gear opens group settings; groups delete via trash', () => {
        const onEditGroup = vi.fn();
        render(
            <AgentRosterRail
                {...base}
                groups={[group({ id: 'g1', memberIds: ['b1'] })]}
                bots={[bot({ id: 'b1' })]}
                onEditGroup={onEditGroup}
                onDeleteGroup={vi.fn()}
            />,
        );
        fireEvent.click(screen.getByTestId('edit-group-g1'));
        expect(onEditGroup).toHaveBeenCalledWith('g1');
        expect(screen.getByTestId('delete-group-g1')).toBeTruthy();
    });
});

describe('AgentRosterRail user teams (merged into groups — Team rows gone)', () => {
    it('no Team row or team affordances render — negative contract', () => {
        render(<AgentRosterRail {...base} bots={[bot({ id: 'b1' })]} />);
        expect(screen.queryByTestId('roster-team')).toBeNull();
        expect(screen.queryByTestId('roster-team-t1')).toBeNull();
        expect(screen.queryByTestId('edit-team-t1')).toBeNull();
        expect(screen.queryByTestId('delete-team-t1')).toBeNull();
        expect(screen.queryByTestId('new-team-button')).toBeNull();
        expect(screen.queryByTestId('menu-new-team')).toBeNull();
    });

    it('the "+" menu offers New Bot / New Group Chat only', () => {
        render(<AgentRosterRail {...base} bots={[bot({ id: 'b1' })]} />);
        fireEvent.click(screen.getByTestId('bots-add'));
        expect(screen.queryByTestId('menu-new-team')).toBeNull();
        expect(screen.getByTestId('menu-new-bot')).toBeTruthy();
        expect(screen.getByTestId('menu-new-group')).toBeTruthy();
    });
});

describe('AgentRosterRail embedded variant (unified sidebar BOTS pane)', () => {
    it('embedded keeps the roster rows but drops the standalone chrome (width, border, docked New Agent)', () => {
        render(
            <AgentRosterRail
                {...base}
                bots={[bot({ id: 'b1', name: 'Scout' })]}
                variant="embedded"
            />,
        );
        const rail = screen.getByTestId('agent-roster-rail');
        // Pane body, not a nested column: transparent fill, no fixed width.
        expect(rail.className).not.toContain('w-72');
        expect(rail.className).not.toContain('bg-zinc-900/50');
        expect(rail.className).toContain('bg-transparent');
        // The "+" menu still covers creation inside the pane.
        expect(screen.getByTestId('bots-add')).toBeTruthy();
        // No docked footer — the pane header owns creation.
        expect(screen.queryByTestId('new-agent-button')).toBeNull();
    });

    it('full variant keeps the standalone chrome (default unchanged)', () => {
        render(
            <AgentRosterRail
                {...base}
                bots={[bot({ id: 'b1', name: 'Scout' })]}
            />,
        );
        const rail = screen.getByTestId('agent-roster-rail');
        expect(rail.className).toContain('w-72');
        expect(screen.queryByTestId('new-agent-button')).toBeTruthy();
    });
});
