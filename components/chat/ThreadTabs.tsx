/**
 * ThreadTabs — the reference's document-tab strip across the top of the
 * chat pane: one tab per addressable thread (Team, Coach, each bot's
 * 1:1, each group room). The active selection is underlined; clicking a
 * tab selects that thread. Monochrome; scrolls horizontally when many
 * threads are open. Hidden in floor mode (the floor is the surface).
 */

import React from 'react';
import type { AgentBot, AgentGroup } from '../../services/agents/agentRoster';
import { groupDisplayName } from '../../services/agents/agentRoster';
import type { ThreadSelection } from '../../utils/agentThreads';

export interface ThreadTabsProps {
    selection: ThreadSelection;
    bots: AgentBot[];
    groups: AgentGroup[];
    onSelectTeam: () => void;
    onSelectBot: (botId: string) => void;
    onSelectGroup: (groupId: string) => void;
    onSelectCoach: () => void;
}

const TAB_BASE = '-mb-px shrink-0 border-b pb-1.5 text-[10px] font-bold uppercase tracking-widest transition-colors';
const TAB_ACTIVE = 'border-zinc-200 text-zinc-100';
const TAB_IDLE = 'border-transparent text-zinc-500 hover:text-zinc-300';

export const ThreadTabs: React.FC<ThreadTabsProps> = ({
    selection,
    bots,
    groups,
    onSelectTeam,
    onSelectBot,
    onSelectGroup,
    onSelectCoach,
}) => (
    <div
        className="flex shrink-0 items-center gap-4 overflow-x-auto border-b border-white/[0.06] px-4 pt-2.5"
        role="tablist"
        aria-label="Open threads"
        data-testid="thread-tabs"
    >
        <button
            type="button"
            role="tab"
            aria-selected={selection.kind === 'team'}
            data-testid="thread-tab-team"
            data-active={selection.kind === 'team' ? '1' : '0'}
            onClick={onSelectTeam}
            className={`${TAB_BASE} ${selection.kind === 'team' ? TAB_ACTIVE : TAB_IDLE}`}
        >
            Team
        </button>
        <button
            type="button"
            role="tab"
            aria-selected={selection.kind === 'coach'}
            data-testid="thread-tab-coach"
            data-active={selection.kind === 'coach' ? '1' : '0'}
            onClick={onSelectCoach}
            className={`${TAB_BASE} ${selection.kind === 'coach' ? TAB_ACTIVE : TAB_IDLE}`}
        >
            Coach
        </button>
        {bots.map(bot => {
            const active = selection.kind === 'bot' && selection.botId === bot.id;
            return (
                <button
                    key={bot.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    data-testid={`thread-tab-bot-${bot.id}`}
                    data-active={active ? '1' : '0'}
                    onClick={() => onSelectBot(bot.id)}
                    className={`${TAB_BASE} max-w-[10rem] truncate ${active ? TAB_ACTIVE : TAB_IDLE}`}
                >
                    {bot.name}
                </button>
            );
        })}
        {groups.map(group => {
            const active = selection.kind === 'group' && selection.groupId === group.id;
            return (
                <button
                    key={group.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    data-testid={`thread-tab-group-${group.id}`}
                    data-active={active ? '1' : '0'}
                    onClick={() => onSelectGroup(group.id)}
                    className={`${TAB_BASE} max-w-[10rem] truncate ${active ? TAB_ACTIVE : TAB_IDLE}`}
                >
                    {groupDisplayName(group, bots)}
                </button>
            );
        })}
    </div>
);

export default ThreadTabs;
