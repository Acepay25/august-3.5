/**
 * GroupChatView — the Hermes group-chat screen, copied: header with
 * stacked member faces + the member-name title + "N bots", a
 * collapsible Activity feed ("You sent a message / X is working… /
 * ✓ X replied / ○ X passed" with relative stamps), prompt threads
 * ("You: analyze btc" + each member's reply with its face, name and
 * time), "X is thinking…" lines while a member runs, and the bottom
 * composer "New thread in A, B, C… (@name to direct, @everyone for
 * all)" with a New Thread button.
 */

import React from 'react';
import { Settings, Trash2 } from 'lucide-react';
import { BotAvatar } from './BotAvatar';
import type { AgentBot, AgentGroup } from '../../services/agents/agentRoster';
import { groupDisplayName } from '../../services/agents/agentRoster';
import type { GroupActivityEntry } from '../../hooks/useAgentGroups';
import { GroupThread, splitGroupThreads, threadForGroup } from '../../utils/agentThreads';
import { MessageRole } from '../../types/enums';
import { Message } from '../../types/message';

export interface GroupChatViewProps {
    group: AgentGroup;
    bots: AgentBot[];
    messages: Message[];
    activity: GroupActivityEntry[];
    workingBotId: string | null;
    isRunning: boolean;
    onSendThread: (prompt: string) => void;
    /** The debate harness is itself a room: the title links to the Team
     *  transcript. Omit when this group has no Team backing. */
    onOpenTeam?: () => void;
    /** Open the group editor (roster membership). */
    onEditGroup?: () => void;
    /** Delete the room (App confirms). */
    onDeleteGroup?: () => void;
    /** Reply into an existing prompt thread — a direct @everyone round.
     *  Members' incremental context carries the prior thread (G2), so
     *  the round continues it in place. Omit to hide reply affordances. */
    onReplyInThread?: (prompt: string) => void;
}

const relTime = (iso: string | number): string => {
    const ms = Date.now() - (typeof iso === 'number' ? iso : Date.parse(iso));
    if (ms < 60_000) return 'now';
    if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
    if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
    return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
};

const ACTIVITY_ICON: Record<GroupActivityEntry['kind'], string> = {
    sent: '🗨',
    working: '↻',
    replied: '✓',
    passed: '○',
};

export const GroupChatView: React.FC<GroupChatViewProps> = ({
    group,
    bots,
    messages,
    activity,
    workingBotId,
    isRunning,
    onSendThread,
    onOpenTeam,
    onEditGroup,
    onDeleteGroup,
    onReplyInThread,
}) => {
    const [input, setInput] = React.useState('');
    const [replyDrafts, setReplyDrafts] = React.useState<Record<string, string>>({});
    const [openReplyId, setOpenReplyId] = React.useState<string | null>(null);
    const [activityOpen, setActivityOpen] = React.useState(true);
    const members = React.useMemo(
        () => group.memberIds
            .map(id => bots.find(b => b.id === id))
            .filter((b): b is AgentBot => Boolean(b)),
        [group.memberIds, bots],
    );
    const slice = React.useMemo(
        () => threadForGroup(messages, members.map(m => ({ providerId: m.providerId, modelId: m.modelId })))
            .filter(m => !m.hidden),
        [messages, members],
    );
    const threads = React.useMemo(() => splitGroupThreads(slice), [slice]);
    const scrollRef = React.useRef<HTMLDivElement | null>(null);

    // Follow the newest thread while a run streams in.
    React.useEffect(() => {
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [threads.length, workingBotId, slice.length]);

    const send = (): void => {
        const text = input.trim();
        if (!text || isRunning) return;
        setInput('');
        onSendThread(text);
    };

    // Per-thread reply: clears the draft, closes the composer, runs a
    // direct @everyone round (onReplyInThread). Guarded against double-fire.
    const sendReply = (promptId: string): void => {
        const text = (replyDrafts[promptId] ?? '').trim();
        if (!text || isRunning || !onReplyInThread) return;
        onReplyInThread(text);
        setReplyDrafts(d => ({ ...d, [promptId]: '' }));
        setOpenReplyId(null);
    };

    const memberByName = (name: string | undefined): AgentBot | undefined =>
        name ? members.find(m => m.name.toLowerCase() === name.toLowerCase()) : undefined;

    return (
        <div className="flex min-h-0 flex-1 flex-col bg-zinc-950" data-testid="group-chat-view">
            {/* Header — stacked faces, title, N bots, actions */}
            <div className="flex items-center gap-3 border-b border-white/[0.06] bg-zinc-950/80 px-4 py-2.5 backdrop-blur">
                <span className="relative flex shrink-0">
                    {members.slice(0, 2).map((m, i) => (
                        <span key={m.id} className={i === 0 ? 'z-10' : '-ml-2.5'}>
                            <BotAvatar bot={m} size={32} />
                        </span>
                    ))}
                </span>
                <div className="min-w-0 flex-1">
                    {onOpenTeam ? (
                        <button
                            type="button"
                            onClick={onOpenTeam}
                            data-testid="group-open-team"
                            title="The Team is a room too — open the full debate transcript"
                            className="block max-w-full truncate text-left text-[15px] font-semibold text-zinc-100 hover:text-white hover:underline"
                        >
                            {groupDisplayName(group, bots)}
                        </button>
                    ) : (
                        <p className="truncate text-[15px] font-semibold text-zinc-100">
                            {groupDisplayName(group, bots)}
                        </p>
                    )}
                </div>
                <span className="shrink-0 text-[11px] text-zinc-500">{members.length} bots</span>
                {onEditGroup && (
                    <button
                        type="button"
                        onClick={onEditGroup}
                        aria-label="Group settings"
                        data-testid="group-edit"
                        className="shrink-0 rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                    >
                        <Settings className="h-3.5 w-3.5" />
                    </button>
                )}
                {onDeleteGroup && (
                    <button
                        type="button"
                        onClick={onDeleteGroup}
                        aria-label="Delete group"
                        data-testid="group-delete"
                        className="shrink-0 rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-rose-300"
                    >
                        <Trash2 className="h-3.5 w-3.5" />
                    </button>
                )}
            </div>

            {/* Activity feed */}
            <div className="border-b border-white/[0.06] px-4 py-1.5" data-testid="group-activity">
                <button
                    type="button"
                    onClick={() => setActivityOpen(v => !v)}
                    aria-expanded={activityOpen}
                    className="flex w-full items-center gap-2 py-1 text-left"
                >
                    <span className="text-[11px] text-zinc-500">{activityOpen ? '▾' : '▸'}</span>
                    <span className="text-[11px] font-semibold text-zinc-400">Activity</span>
                    {isRunning && workingBotId && (
                        <span className="text-[11px] text-zinc-500">
                            {members.find(m => m.id === workingBotId)?.name} is working…
                        </span>
                    )}
                </button>
                {activityOpen && (
                    <ul className="max-h-32 space-y-0.5 overflow-y-auto pb-1">
                        {activity.length === 0 ? (
                            <li className="py-1 text-[11px] text-zinc-600">
                                Quiet room — send the first prompt below.
                            </li>
                        ) : (
                            [...activity].reverse().map(entry => {
                                const bot = memberByName(entry.botName);
                                return (
                                    <li key={entry.id} className="flex items-center gap-2 py-0.5 text-[11px]">
                                        <span
                                            className={`w-3 shrink-0 text-center ${
                                                entry.kind === 'replied' ? 'text-emerald-400' : entry.kind === 'passed' ? 'text-zinc-500' : 'text-zinc-400'
                                            }`}
                                        >
                                            {ACTIVITY_ICON[entry.kind]}
                                        </span>
                                        <span className="min-w-0 flex-1 truncate text-zinc-400">
                                            {entry.kind === 'sent' && 'You sent a message'}
                                            {entry.kind === 'working' && `${entry.botName} is working…`}
                                            {entry.kind === 'replied' && `${entry.botName} replied`}
                                            {entry.kind === 'passed' && `${entry.botName} passed${entry.detail ? ` (${entry.detail})` : ''}`}
                                            {bot && (
                                                <span className="ml-1.5 inline-block align-middle">
                                                    <BotAvatar bot={bot} size={14} />
                                                </span>
                                            )}
                                        </span>
                                        <span className="shrink-0 text-zinc-600">{relTime(entry.at)}</span>
                                    </li>
                                );
                            })
                        )}
                    </ul>
                )}
            </div>

            {/* Threads */}
            <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
                {threads.length === 0 ? (
                    <div className="flex h-full items-center justify-center">
                        <p className="max-w-sm text-center text-[12px] leading-relaxed text-zinc-500">
                            New thread in {groupDisplayName(group, bots)} — one prompt, every member answers in turn.
                        </p>
                    </div>
                ) : (
                    <div className="space-y-8">
                        {threads.map((thread: GroupThread, ti) => {
                            const isLast = ti === threads.length - 1;
                            return (
                                <div key={thread.prompt.id} className="space-y-3">
                                    {/* You */}
                                    <div className="relative flex justify-end">
                                        <div className="max-w-[85%] rounded-2xl bg-zinc-200 px-4 py-2.5 text-[13px] text-zinc-900">
                                            <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">You</p>
                                            {thread.prompt.text}
                                        </div>
                                        {onReplyInThread && (
                                            <button
                                                type="button"
                                                onClick={() => setOpenReplyId(id => (id === thread.prompt.id ? null : thread.prompt.id))}
                                                data-testid={`reply-link-${thread.prompt.id}`}
                                                className="absolute -bottom-5 right-0 text-[11px] text-zinc-500 transition-colors hover:text-zinc-200"
                                            >
                                                Reply in thread
                                            </button>
                                        )}
                                    </div>
                                    {/* Member replies */}
                                    {thread.replies.map(reply => {
                                        const bot = members.find(m =>
                                            Object.keys(reply.modelsUsed ?? {}).some(pid =>
                                                pid === m.providerId && reply.modelsUsed?.[pid] === m.modelId,
                                            ),
                                        );
                                        if (!bot) return null;
                                        return (
                                            <div key={reply.id} className="flex items-start gap-2.5">
                                                <BotAvatar bot={bot} size={28} working={reply.isStreaming} />
                                                <div className="min-w-0 flex-1">
                                                    <p className="text-[12px] font-semibold text-zinc-300">
                                                        {bot.name}
                                                        <span className="ml-2 font-normal text-zinc-600">{relTime(reply.createdAt)}</span>
                                                    </p>
                                                    <div className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-zinc-200">
                                                        {reply.text}
                                                        {reply.isStreaming && <span className="ml-1 animate-pulse text-zinc-500">▍</span>}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                    {/* Working line on the open thread */}
                                    {isLast && isRunning && workingBotId && (
                                        <p className="pl-1 text-[12px] italic text-zinc-500" data-testid="group-thinking">
                                            {members.find(m => m.id === workingBotId)?.name} is thinking…
                                        </p>
                                    )}
                                    {/* Inline reply composer (reference: Reply in thread) */}
                                    {onReplyInThread && openReplyId === thread.prompt.id && (
                                        <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-zinc-900 px-3 py-2" data-testid={`reply-composer-${thread.prompt.id}`}>
                                            <input
                                                type="text"
                                                value={replyDrafts[thread.prompt.id] ?? ''}
                                                onChange={e => setReplyDrafts(d => ({ ...d, [thread.prompt.id]: e.target.value }))}
                                                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply(thread.prompt.id); } }}
                                                placeholder={`Reply in thread… (@name to direct)`}
                                                aria-label="Reply in thread"
                                                className="min-w-0 flex-1 bg-transparent text-[13px] text-zinc-100 placeholder-zinc-600 outline-none"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => sendReply(thread.prompt.id)}
                                                disabled={!(replyDrafts[thread.prompt.id] ?? '').trim() || isRunning}
                                                data-testid={`reply-send-${thread.prompt.id}`}
                                                className="shrink-0 rounded-lg bg-zinc-200 px-3 py-1.5 text-[12px] font-bold text-zinc-900 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
                                            >
                                                Reply
                                            </button>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Composer — New thread in … (@name to direct, @everyone for all) */}
            <div className="border-t border-white/[0.06] px-4 py-3">
                <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-zinc-900 px-3 py-2">
                    <input
                        type="text"
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                        placeholder={`New thread in ${groupDisplayName(group, bots)}… (@name to direct, @everyone for all)`}
                        data-testid="group-composer"
                        aria-label="New group thread"
                        className="min-w-0 flex-1 bg-transparent text-[13px] text-zinc-100 placeholder-zinc-600 outline-none"
                    />
                    <button
                        type="button"
                        onClick={send}
                        disabled={!input.trim() || isRunning}
                        data-testid="new-thread-button"
                        className="shrink-0 rounded-lg bg-zinc-200 px-3 py-1.5 text-[12px] font-bold text-zinc-900 hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        New Thread
                    </button>
                </div>
            </div>
        </div>
    );
};

export default GroupChatView;
