import { describe, it, expect, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

import { ThreadTabs } from '../components/chat/ThreadTabs';
import { AgentBot, AgentGroup } from '../services/agents/agentRoster';
import { ThreadSelection } from '../utils/agentThreads';

afterEach(cleanup);

let seq = 0;
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
    bots: [] as AgentBot[],
    groups: [] as AgentGroup[],
    onSelectTeam: () => {},
    onSelectBot: () => {},
    onSelectGroup: () => {},
    onSelectCoach: () => {},
};

describe('ThreadTabs (open-thread document tabs)', () => {
    it('renders Team, Coach, one tab per bot, and one tab per group', () => {
        render(
            <ThreadTabs
                {...base}
                selection={{ kind: 'team' }}
                bots={[bot({ id: 'b1', name: 'Scout' }), bot({ id: 'b2', name: 'Ledger' })]}
                groups={[group({ id: 'g1', memberIds: ['b1', 'b2'], name: 'Alpha Desk' })]}
            />,
        );
        expect(screen.getByTestId('thread-tab-team').textContent).toBe('Team');
        expect(screen.getByTestId('thread-tab-coach').textContent).toBe('Coach');
        expect(screen.getByTestId('thread-tab-bot-b1').textContent).toBe('Scout');
        expect(screen.getByTestId('thread-tab-bot-b2').textContent).toBe('Ledger');
        expect(screen.getByTestId('thread-tab-group-g1').textContent).toBe('Alpha Desk');
    });

    it('marks the active selection with data-active="1"', () => {
        const selection: ThreadSelection = { kind: 'bot', botId: 'b2' };
        render(
            <ThreadTabs
                {...base}
                selection={selection}
                bots={[bot({ id: 'b1' }), bot({ id: 'b2' })]}
            />,
        );
        expect(screen.getByTestId('thread-tab-bot-b2').getAttribute('data-active')).toBe('1');
        expect(screen.getByTestId('thread-tab-team').getAttribute('data-active')).toBe('0');
    });

    it('clicking tabs selects the corresponding thread', () => {
        const onSelectTeam = vi.fn();
        const onSelectBot = vi.fn();
        const onSelectGroup = vi.fn();
        const onSelectCoach = vi.fn();
        render(
            <ThreadTabs
                {...base}
                selection={{ kind: 'team' }}
                bots={[bot({ id: 'b1' })]}
                groups={[group({ id: 'g1' })]}
                onSelectTeam={onSelectTeam}
                onSelectBot={onSelectBot}
                onSelectGroup={onSelectGroup}
                onSelectCoach={onSelectCoach}
            />,
        );
        fireEvent.click(screen.getByTestId('thread-tab-coach'));
        expect(onSelectCoach).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByTestId('thread-tab-bot-b1'));
        expect(onSelectBot).toHaveBeenCalledWith('b1');
        fireEvent.click(screen.getByTestId('thread-tab-group-g1'));
        expect(onSelectGroup).toHaveBeenCalledWith('g1');
        fireEvent.click(screen.getByTestId('thread-tab-team'));
        expect(onSelectTeam).toHaveBeenCalledTimes(1);
    });

    it('unnamed groups fall back to the member-name display name', () => {
        render(
            <ThreadTabs
                {...base}
                selection={{ kind: 'team' }}
                bots={[bot({ id: 'b1', name: 'Scout' })]}
                groups={[group({ id: 'g1', memberIds: ['b1'] })]}
            />,
        );
        expect(screen.getByTestId('thread-tab-group-g1').textContent).toBe('Scout');
    });
});
