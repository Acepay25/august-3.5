/**
 * AgentChatView — per-agent chat slide-over. Inspired by the
 * "Sales Outbound" reference: a list of agents on the left, a
 * right pane with the message list + a composer that targets a
 * single selected agent.
 *
 * The view renders INSIDE the existing chat pane (right column),
 * not as a new layout. When `open` is true, the right column
 * shows the agent list + the active agent's slice of the
 * conversation; the existing team-mode desk view stays the same
 * but the composer targets a single provider instead of running a
 * full ensemble debate.
 *
 * The actual routing into single-agent chat is handled by the
 * composer (an "agent dropdown" sits to the left of the textarea).
 * This component is a focused, full-width variant that traders
 * can pull up when they want a deeper 1:1 conversation with one
 * analyst instead of the team debate.
 */

import React from 'react';
import { ChevronDownIcon } from '../shared/Icons';
import { ProviderConfig } from '../../types/provider';
import { formatModelDisplayName } from '../../utils/providerUtils';

export interface AgentSummary {
    /** Provider id, matches ProviderConfig.id. */
    providerId: string;
    /** Display name for the seat — typically the model name or a custom name. */
    displayName: string;
    /** Optional tagline. */
    tagline?: string;
    /** Last message timestamp (ms since epoch). */
    lastActiveAt?: number;
    /** Total messages this agent has been part of in the current thread. */
    messageCount?: number;
}

export interface AgentChatViewProps {
    open: boolean;
    onClose: () => void;
    providers: ProviderConfig[];
    agents: AgentSummary[];
    activeAgentId: string | null;
    onSelectAgent: (providerId: string) => void;
}

const formatRelative = (ms: number | undefined): string => {
    if (!ms) return '—';
    const diff = Date.now() - ms;
    if (diff < 60_000) return 'just now';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return `${Math.floor(diff / 86_400_000)}d ago`;
};

export const AgentChatView: React.FC<AgentChatViewProps> = ({
    open, onClose, providers, agents, activeAgentId, onSelectAgent,
}) => {
    if (!open) return null;
    return (
        <div
            data-testid="agent-chat-view"
            role="dialog"
            aria-label="Per-agent chat"
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[640px] flex-col border-l border-white/10 bg-zinc-950 shadow-2xl"
        >
            <div className="flex items-center justify-between gap-2 border-b border-white/5 bg-zinc-900 px-4 py-3">
                <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                        Per-agent chat
                    </p>
                    <p className="truncate text-sm text-zinc-200">
                        {activeAgentId
                            ? `Talking to ${providers.find(p => p.id === activeAgentId)?.name ?? 'agent'}`
                            : 'Pick an agent to talk to'}
                    </p>
                </div>
                <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close per-agent chat"
                    className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                >
                    ✕
                </button>
            </div>
            <div className="flex flex-1 min-h-0">
                <aside className="w-44 shrink-0 overflow-y-auto border-r border-white/5 bg-zinc-900/40 p-2">
                    <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                        Agents
                    </p>
                    <ul className="space-y-1">
                        {agents.map(agent => {
                            const isActive = agent.providerId === activeAgentId;
                            return (
                                <li key={agent.providerId}>
                                    <button
                                        type="button"
                                        onClick={() => onSelectAgent(agent.providerId)}
                                        data-testid={`agent-chat-item-${agent.providerId}`}
                                        data-active={isActive ? '1' : '0'}
                                        className={`flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
                                            isActive
                                                ? 'bg-zinc-800 text-zinc-100 ring-1 ring-amber-400/40'
                                                : 'text-zinc-300 hover:bg-zinc-800/60'
                                        }`}
                                    >
                                        <span
                                            className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${
                                                isActive ? 'bg-emerald-400' : 'bg-zinc-600'
                                            }`}
                                            aria-hidden="true"
                                        />
                                        <span className="min-w-0 flex-1">
                                            <span className="block truncate text-[12px] font-semibold">
                                                {agent.displayName}
                                            </span>
                                            {agent.tagline && (
                                                <span className="block truncate text-[10px] text-zinc-500">
                                                    {agent.tagline}
                                                </span>
                                            )}
                                            <span className="mt-0.5 block text-[9px] uppercase tracking-widest text-zinc-500">
                                                {formatRelative(agent.lastActiveAt)} · {agent.messageCount ?? 0} msgs
                                            </span>
                                        </span>
                                    </button>
                                </li>
                            );
                        })}
                        {agents.length === 0 && (
                            <li className="px-2 py-3 text-[11px] text-zinc-500">
                                No ready providers — open Settings to add one.
                            </li>
                        )}
                    </ul>
                </aside>
                <main className="flex-1 overflow-y-auto p-4">
                    <p className="text-[11px] text-zinc-500">
                        Use the composer below to send a message to the selected agent. The existing
                        message list stays in the main chat view; this panel is a focused 1:1.
                    </p>
                </main>
            </div>
        </div>
    );
};

export default AgentChatView;
