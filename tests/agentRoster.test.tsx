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
    selection: { kind: 'team' } as const,
    onSelectTeam: () => {},
    onSelectBot: () => {},
    onSelectGroup: () => {},
    onNewBot: () => {},
    onNewGroup: () => {},
};

describe('AgentRosterRail (bots + groups)', () => {
    it('renders the pinned Team row, one row per bot, and one row per group', () => {
        render(
            <AgentRosterRail
                {...base}
                bots={[bot({ id: 'b1', name: 'Scout' }), bot({ id: 'b2', name: 'Ledger' })]}
                groups={[group({ id: 'g1', memberIds: ['b1', 'b2'] })]}
            />,
        );
        expect(screen.getByTestId('roster-team')).toBeTruthy();
        expect(screen.getByTestId('roster-bot-b1')).toBeTruthy();
        expect(screen.getByTestId('roster-bot-b2')).toBeTruthy();
        expect(screen.getByTestId('roster-group-g1')).toBeTruthy();
        // Group display name defaults to member names joined.
        expect(screen.getByTestId('roster-group-g1').textContent).toContain('Scout, Ledger');
    });

    it('marks the active selection with data-active="1" (team default)', () => {
        render(
            <AgentRosterRail
                {...base}
                bots={[bot({ id: 'b1' })]}
            />,
        );
        expect(screen.getByTestId('roster-team').getAttribute('data-active')).toBe('1');
        expect(screen.getByTestId('roster-bot-b1').getAttribute('data-active')).toBe('0');
    });

    it('clicking a bot row selects it; clicking Team selects the team', () => {
        const onSelectBot = vi.fn();
        const onSelectTeam = vi.fn();
        render(
            <AgentRosterRail
                {...base}
                selection={{ kind: 'bot', botId: 'b2' }}
                onSelectBot={onSelectBot}
                onSelectTeam={onSelectTeam}
                bots={[bot({ id: 'b1' }), bot({ id: 'b2' })]}
            />,
        );
        fireEvent.click(screen.getByTestId('roster-bot-b2'));
        expect(onSelectBot).toHaveBeenCalledWith('b2');
        fireEvent.click(screen.getByTestId('roster-team'));
        expect(onSelectTeam).toHaveBeenCalledTimes(1);
    });

    it('search filters bot and group rows by name but keeps Team visible', () => {
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
        expect(screen.getByTestId('roster-team')).toBeTruthy();
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

describe('AgentRosterRail Team row (derived from the live ensemble config)', () => {
    const teamMembers = [
        { label: 'Macro', model: 'OpenAI · GPT', initial: 'M', role: 'macro' as const },
        { label: 'Technical', model: 'OpenAI · GPT', initial: 'T', role: 'technical' as const },
        { label: 'Risk', model: 'Anthropic · Claude', initial: 'R', role: 'risk' as const },
    ];

    it('subtitle lists the configured seats — never a hardcoded description', () => {
        render(<AgentRosterRail {...base} teamMembers={teamMembers} />);
        const row = screen.getByTestId('roster-team');
        expect(row.textContent).toContain('Macro · Technical · Risk');
        expect(row.textContent).not.toContain('Debates and team analysis');
    });

    it('without a configured roster it says how to configure one', () => {
        render(<AgentRosterRail {...base} />);
        expect(screen.getByTestId('roster-team').textContent).toContain('No analysts configured');
    });

    it('renders stacked identity discs for the team seats', () => {
        const { container } = render(<AgentRosterRail {...base} teamMembers={teamMembers} />);
        const row = screen.getByTestId('roster-team');
        // One identity disc per seat (up to 3) — spans with the role
        // accent background, not the gray fallback circle.
        const discs = row.querySelectorAll('span > span');
        expect(discs.length).toBeGreaterThanOrEqual(3);
        void container;
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

describe('AgentRosterRail Team manage affordance', () => {
    it('hover gear opens seat management (the Team is managed, never deleted)', () => {
        const onManageTeam = vi.fn();
        render(<AgentRosterRail {...base} teamMembers={[{ label: 'Kilocode', model: 'K', initial: '1', role: 'macro' as const }] } onManageTeam={onManageTeam} />);
        fireEvent.click(screen.getByTestId('manage-team'));
        expect(onManageTeam).toHaveBeenCalledTimes(1);
    });

    it('the Team row has no delete trash — only bots and groups delete', () => {
        render(
            <AgentRosterRail
                {...base}
                teamMembers={[{ label: 'Macro', model: 'M', initial: 'M', role: 'macro' as const }]}
                onDeleteBot={vi.fn()}
                onDeleteGroup={vi.fn()}
                onManageTeam={vi.fn()}
            />,
        );
        expect(screen.queryByTestId('delete-team')).toBeNull();
        expect(screen.getByTestId('manage-team')).toBeTruthy();
    });

    it('subtitle dedupes identical seat labels ("Kilocode ×3", not a stutter)', () => {
        const threeK = [
            { label: 'Kilocode', model: 'a', initial: '1', role: 'macro' as const },
            { label: 'Kilocode', model: 'b', initial: '2', role: 'technical' as const },
            { label: 'Kilocode', model: 'c', initial: '3', role: 'risk' as const },
        ];
        render(<AgentRosterRail {...base} teamMembers={threeK} />);
        const row = screen.getByTestId('roster-team');
        expect(row.textContent).toContain('Kilocode ×3');
        expect(row.textContent).not.toContain('Kilocode · Kilocode');
    });
});

describe('AgentRosterRail user teams (the Team is one of these)', () => {
    const teamSlots = [
        { label: 'OpenAI', model: 'GPT', initial: '1', role: 'macro' as const },
        { label: 'Anthropic', model: 'Claude', initial: '2', role: 'risk' as const },
    ];
    const userTeam = {
        team: { id: 't1', name: 'Alpha Desk', seats: [], createdAt: new Date().toISOString() },
        slots: teamSlots,
    };
    const teamBase = { ...base, teams: [userTeam], activeTeamId: 't1' };

    it('teams replace the pinned Settings-derived row', () => {
        render(<AgentRosterRail {...teamBase} teamMembers={[{ label: 'Legacy', model: '', initial: '1', role: 'macro' as const }]} />);
        expect(screen.queryByTestId('roster-team')).toBeNull();
        expect(screen.getByTestId('roster-team-t1')).toBeTruthy();
        expect(screen.getByTestId('roster-team-t1').textContent).toContain('Alpha Desk');
    });

    it('clicking a team activates it; gear edits; trash deletes', () => {
        const onActivateTeam = vi.fn();
        const onEditTeam = vi.fn();
        const onDeleteTeam = vi.fn();
        render(
            <AgentRosterRail
                {...teamBase}
                onActivateTeam={onActivateTeam}
                onEditTeam={onEditTeam}
                onDeleteTeam={onDeleteTeam}
            />,
        );
        fireEvent.click(screen.getByTestId('roster-team-t1'));
        expect(onActivateTeam).toHaveBeenCalledWith('t1');
        fireEvent.click(screen.getByTestId('edit-team-t1'));
        expect(onEditTeam).toHaveBeenCalledWith('t1');
        fireEvent.click(screen.getByTestId('delete-team-t1'));
        expect(onDeleteTeam).toHaveBeenCalledWith('t1');
    });

    it("'+ New Team' row and the '+' menu entry open the create dialog", () => {
        const onNewTeam = vi.fn();
        render(<AgentRosterRail {...teamBase} onNewTeam={onNewTeam} />);
        fireEvent.click(screen.getByTestId('new-team-button'));
        expect(onNewTeam).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByTestId('bots-add'));
        expect(screen.getByTestId('menu-new-team')).toBeTruthy();
    });

    it('team search filters by name', () => {
        render(<AgentRosterRail {...teamBase} />);
        fireEvent.change(screen.getByTestId('roster-search'), { target: { value: 'nomatch' } });
        expect(screen.queryByTestId('roster-team-t1')).toBeNull();
    });
});
