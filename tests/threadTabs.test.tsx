/**
 * ThreadTabs tests — GROUP threads only. The Team tab is structurally
 * gone (teams merged into groups: one room concept), and individual
 * bots/coach never get a tab.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThreadTabs } from '../components/chat/ThreadTabs';
import type { AgentBot, AgentGroup } from '../services/agents/agentRoster';
import type { ThreadSelection } from '../utils/agentThreads';

const bot = (over: Partial<AgentBot> = {}): AgentBot => ({
    id: 'b1',
    name: 'Raven',
    providerId: 'p1',
    modelId: 'm1',
    avatar: { kind: 'auto' },
    createdAt: new Date().toISOString(),
    ...over,
});

const group = (over: Partial<AgentGroup> = {}): AgentGroup => ({
    id: 'g1',
    memberIds: [],
    createdAt: new Date().toISOString(),
    ...over,
});

const base = {
    bots: [] as AgentBot[],
    groups: [] as AgentGroup[],
    onSelectGroup: () => {},
};

describe('ThreadTabs (group threads only — Team merged into groups)', () => {
    it('renders one tab per group — no Team tab, and individual bots NEVER get a tab', () => {
        render(
            <ThreadTabs
                {...base}
                selection={{ kind: 'group', groupId: 'g1' }}
                bots={[bot({ id: 'b1', name: 'Raven' }), bot({ id: 'b2', name: 'ergher' })]}
                groups={[group({ id: 'g1', memberIds: ['b1', 'b2'], name: 'Alpha Desk' })]}
            />,
        );
        // The Team tab is structurally impossible now.
        expect(screen.queryByTestId('thread-tab-team')).toBeNull();
        expect(screen.getByTestId('thread-tab-group-g1').textContent).toBe('Alpha Desk');
        // Individual bot tabs are structurally impossible now.
        expect(screen.queryByTestId('thread-tab-bot-b1')).toBeNull();
        expect(screen.queryByTestId('thread-tab-bot-b2')).toBeNull();
        // The Coach inbox has no tab either (sidebar row only).
        expect(screen.queryByTestId('thread-tab-coach')).toBeNull();
    });

    it('marks the active selection with data-active="1"', () => {
        const selection: ThreadSelection = { kind: 'group', groupId: 'g1' };
        render(
            <ThreadTabs
                {...base}
                selection={selection}
                bots={[bot({ id: 'b1' })]}
                groups={[group({ id: 'g1', memberIds: ['b1'] })]}
            />,
        );
        expect(screen.getByTestId('thread-tab-group-g1').getAttribute('data-active')).toBe('1');
    });

    it('clicking a tab selects the corresponding group', () => {
        const onSelectGroup = vi.fn();
        render(
            <ThreadTabs
                {...base}
                selection={{ kind: 'coach' }}
                bots={[bot({ id: 'b1' })]}
                groups={[group({ id: 'g1' })]}
                onSelectGroup={onSelectGroup}
            />,
        );
        fireEvent.click(screen.getByTestId('thread-tab-group-g1'));
        expect(onSelectGroup).toHaveBeenCalledWith('g1');
    });

    it('unnamed groups fall back to the member-name display name', () => {
        render(
            <ThreadTabs
                {...base}
                selection={{ kind: 'group', groupId: 'g1' }}
                bots={[bot({ id: 'b1', name: 'Raven' })]}
                groups={[group({ id: 'g1', memberIds: ['b1'] })]}
            />,
        );
        expect(screen.getByTestId('thread-tab-group-g1').textContent).toBe('Raven');
    });
});
