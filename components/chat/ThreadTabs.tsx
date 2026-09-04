/**
 * ThreadTabs — the reference's document-tab strip across the top of the
 * chat pane: one tab per GROUP thread. Individual bot 1:1s never appear
 * here — selecting a bot opens its chat directly with no strip (reference
 * BOT CHAT style); the Coach inbox is reached from its sidebar row.
 * Active selection is underlined. Hidden outside group threads entirely.
 *
 * (Team tab removed — teams merged into groups: one room concept. A
 * group's tab already shows its member names, reference-style.)
 */

import React from 'react';
import type { AgentBot, AgentGroup } from '../../services/agents/agentRoster';
import { groupDisplayName } from '../../services/agents/agentRoster';
import type { ThreadSelection } from '../../utils/agentThreads';

export interface ThreadTabsProps {
    selection: ThreadSelection;
    bots: AgentBot[];
    groups: AgentGroup[];
    onSelectGroup: (groupId: string) => void;
}

const TAB_BASE = '-mb-px shrink-0 border-b pb-1.5 text-[10px] font-bold uppercase tracking-widest transition-colors';
const TAB_ACTIVE = 'border-zinc-200 text-zinc-100';
const TAB_IDLE = 'border-transparent text-zinc-500 hover:text-zinc-300';

export const ThreadTabs: React.FC<ThreadTabsProps> = ({
    selection,
    bots,
    groups,
    onSelectGroup,
}) => (
    <div
        className="flex shrink-0 items-center gap-4 overflow-x-auto border-b border-white/[0.06] px-4 pt-2.5"
        role="tablist"
        aria-label="Open group threads"
        data-testid="thread-tabs"
    >
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
                    title={groupDisplayName(group, bots)}
                    className={`${TAB_BASE} max-w-[14rem] truncate ${active ? TAB_ACTIVE : TAB_IDLE}`}
                >
                    {groupDisplayName(group, bots)}
                </button>
            );
        })}
    </div>
);

export default ThreadTabs;
