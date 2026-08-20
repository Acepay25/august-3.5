import React, { useEffect, useMemo, useState } from 'react';
import { Conversation, MessageRole } from '../../types';
import { AutomationConfig } from '../../types/automation';
import { humanizeCron } from '../../services/automation/cronParser';
import {
    ActivityIcon,
    BookmarkIcon,
    CodeIcon,
    EyeIcon,
    PlusIcon,
    TrashIcon,
} from './Icons';

interface NavRowProps {
    icon: React.ReactNode;
    label: string;
    onClick: () => void;
    collapsed?: boolean;
}

const NavRow: React.FC<NavRowProps> = ({ icon, label, onClick, collapsed = false }) => (
    <button
        onClick={onClick}
        className={`w-full flex items-center ${collapsed ? 'justify-center px-2' : 'gap-3 px-3'} py-2 rounded-lg text-sm text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950`}
        title={collapsed ? label : undefined}
        aria-label={collapsed ? label : undefined}
    >
        <span className="shrink-0">{icon}</span>
        {!collapsed && <span className="truncate">{label}</span>}
    </button>
);

interface SidebarContentProps {
    activeUsername: string | null;
    conversations: Conversation[];
    activeConversationId: string | null;
    hasVisionData: boolean;
    // Fresh session = the active conversation has no messages yet; starting
    // another new conversation from that state is pointless.
    isFreshSession: boolean;
    onNewConversation: () => void;
    onLoadConversation: (id: string) => void;
    onOpenLiveMarket: () => void;
    onOpenVisionData: () => void;
    onOpenJournal: () => void;
    onOpenWatchList?: () => void;
    onOpenSettings: () => void;
    onDeleteConversation: (id: string) => void;
    onDeleteConversations?: (ids: string[]) => Promise<boolean> | boolean;
    onOpenBotManager?: () => void;
    // Automations — scheduled analyses. The section lists them inline; a
    // click opens the automation's own card feed.
    automations?: AutomationConfig[];
    onOpenAutomation?: (id: string | null) => void;
    onCreateAutomation?: () => void;
    // Called after every action so the mobile drawer can close itself;
    // a no-op for the persistent desktop sidebar.
    onNavigate?: () => void;
    collapsed?: boolean;
}

// Shared sidebar body, rendered both as the persistent desktop column
// (App.tsx) and inside the mobile slide-out drawer (Header.tsx).
export const SidebarContent: React.FC<SidebarContentProps> = ({
    activeUsername,
    conversations,
    activeConversationId,
    hasVisionData,
    isFreshSession,
    onNewConversation,
    onLoadConversation,
    onOpenLiveMarket,
    onOpenVisionData,
    onOpenJournal,
    onOpenWatchList,
    onOpenSettings,
    onDeleteConversation,
    onDeleteConversations,
    onOpenBotManager,
    automations = [],
    onOpenAutomation,
    onCreateAutomation,
    onNavigate,
    collapsed = false,
}) => {
    const getPreview = (conv: Conversation): string => {
        const firstUserMessage = (conv.messages || []).find(m => m.role === MessageRole.USER && m.text.trim());
        return firstUserMessage ? firstUserMessage.text : 'New Conversation';
    };

    // F5: conversation search — typing a query searches the FULL history
    // (the recent list only shows the first 8).
    const [searchQuery, setSearchQuery] = useState('');
    const [isSelectionMode, setIsSelectionMode] = useState(false);
    const [selectedConversationIds, setSelectedConversationIds] = useState<Set<string>>(new Set());

    useEffect(() => {
        const validIds = new Set(conversations.map(conversation => conversation.id));
        setSelectedConversationIds(previous => new Set([...previous].filter(id => validIds.has(id))));
    }, [conversations]);

    useEffect(() => {
        if (collapsed) {
            setIsSelectionMode(false);
            setSelectedConversationIds(new Set());
        }
    }, [collapsed]);
    const previews = useMemo(() => {
        const map = new Map<string, string>();
        for (const conv of conversations) map.set(conv.id, getPreview(conv));
        return map;
    }, [conversations]);
    const recentConversations = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        if (!q) return conversations.slice(0, 8);
        return conversations.filter(conv => (previews.get(conv.id) ?? '').toLowerCase().includes(q));
    }, [conversations, searchQuery, previews]);

    const act = (fn: () => void) => () => {
        fn();
        onNavigate?.();
    };

    const toggleConversationSelection = (id: string) => {
        setSelectedConversationIds(previous => {
            const next = new Set(previous);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const handleDeleteSelected = async () => {
        if (!onDeleteConversations || selectedConversationIds.size === 0) return;
        const deleted = await onDeleteConversations([...selectedConversationIds]);
        if (deleted !== false) {
            setSelectedConversationIds(new Set());
            setIsSelectionMode(false);
            onNavigate?.();
        }
    };

    return (
        <div className="flex flex-col h-full min-h-0 bg-zinc-950">
            {/* New Conversation — highlighted row (disabled in a fresh
                session: nothing exists yet to branch from) */}
            <div className={collapsed ? 'p-2 pb-1' : 'p-3 pb-2'}>
                <button
                    onClick={act(onNewConversation)}
                    disabled={isFreshSession}
                    className={`w-full flex items-center ${collapsed ? 'justify-center px-2' : 'gap-3 px-3'} py-2.5 rounded-lg bg-zinc-800/80 hover:bg-zinc-700 text-sm font-medium text-zinc-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-zinc-800`}
                    title={isFreshSession ? 'Start typing to begin a conversation' : 'Start a new conversation'}
                    aria-label="Start a new conversation"
                >
                    <PlusIcon className="h-4 w-4 text-zinc-400" />
                    {!collapsed && 'New Conversation'}
                </button>
            </div>

            {/* Quick actions */}
            <nav className="px-2">
                {!collapsed && <div className="px-3 pb-1 pt-2">
                    <span className="ui-kicker">Quick actions</span>
                </div>}
                <div className="space-y-0.5">
                    <NavRow collapsed={collapsed} icon={<ActivityIcon className="h-4 w-4" />} label="Live Market" onClick={act(onOpenLiveMarket)} />
                    {hasVisionData && (
                        <NavRow collapsed={collapsed} icon={<CodeIcon className="h-4 w-4" />} label="View Vision Data" onClick={act(onOpenVisionData)} />
                    )}
                    <NavRow collapsed={collapsed} icon={<BookmarkIcon className="h-4 w-4" />} label="Trading Journal" onClick={act(onOpenJournal)} />
                    {onOpenBotManager && (
                        <NavRow collapsed={collapsed} icon={<ActivityIcon className="h-4 w-4" />} label="Bots" onClick={act(onOpenBotManager)} />
                    )}
                    {onOpenWatchList && (
                        <NavRow collapsed={collapsed} icon={<EyeIcon className="h-4 w-4" />} label="Watch list" onClick={act(onOpenWatchList)} />
                    )}
                </div>
            </nav>

            {/* Automations — scheduled analyses, one card feed each */}
            <div className={collapsed ? 'px-2 pt-3' : 'px-2 pt-4'}>
                {!collapsed && (
                    <div className="flex items-center justify-between px-3 pb-1">
                        <span className="ui-kicker">Automations</span>
                        {onCreateAutomation && (
                            <button
                                type="button"
                                onClick={act(onCreateAutomation)}
                                className="rounded px-1.5 py-0.5 text-[10px] text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
                                title="New automation"
                                aria-label="New automation"
                            >
                                + New
                            </button>
                        )}
                    </div>
                )}
                <div className="space-y-0.5">
                    {collapsed ? (
                        onOpenAutomation && (
                            <NavRow
                                collapsed
                                icon={<span className="text-[10px] font-black">⏱</span>}
                                label="Automations"
                                onClick={act(() => onOpenAutomation(automations[0]?.id ?? null))}
                            />
                        )
                    ) : automations.length === 0 ? (
                        <p className="px-3 py-1.5 text-[10px] text-zinc-600">
                            No automations — <button type="button" onClick={act(onCreateAutomation ?? (() => {}))} className="text-zinc-300 hover:text-zinc-100 underline underline-offset-2">create one</button> to schedule analyses.
                        </p>
                    ) : (
                        automations.map(a => (
                            <button
                                key={a.id}
                                type="button"
                                onClick={() => act(() => onOpenAutomation?.(a.id))()}
                                className="w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-left transition-colors hover:bg-zinc-800/80 group"
                                title={`${a.name} — ${humanizeCron(a.schedule.cron)}`}
                            >
                                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${a.enabled ? 'bg-emerald-400' : 'bg-zinc-700'}`} />
                                <span className="truncate text-[11px] text-zinc-400 group-hover:text-zinc-200">{a.name}</span>
                                <span className="ml-auto text-[9px] text-zinc-600 group-hover:text-zinc-400 shrink-0">{humanizeCron(a.schedule.cron)}</span>
                            </button>
                        ))
                    )}
                </div>
            </div>

            {/* Recent conversations */}
            {!collapsed && <div className="flex items-center justify-between px-5 pb-1 pt-5">
                <span className="ui-kicker">Recent</span>
                {onDeleteConversations && (
                    <button
                        type="button"
                        onClick={() => {
                            setIsSelectionMode(previous => !previous);
                            setSelectedConversationIds(new Set());
                        }}
                        className="rounded px-1.5 py-1 text-[10px] text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200 focus-visible:ring-2 focus-visible:ring-cyan-400"
                    >
                        {isSelectionMode ? 'Cancel' : 'Select'}
                    </button>
                )}
            </div>}
            {!collapsed && (
                <div className="px-3 pb-2">
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search conversations…"
                        aria-label="Search conversations"
                        className="w-full rounded-lg border border-white/10 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-white/25"
                    />
                </div>
            )}
            {!collapsed && isSelectionMode && (
                <div className="mx-3 mb-2 flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-zinc-900 px-2.5 py-2">
                    <span className="text-[11px] text-zinc-400">
                        {selectedConversationIds.size} selected
                    </span>
                    <button
                        type="button"
                        onClick={handleDeleteSelected}
                        disabled={selectedConversationIds.size === 0}
                        className="rounded-md bg-rose-500/10 px-2 py-1 text-[10px] font-medium text-rose-300 transition-colors hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-rose-400"
                    >
                        Delete selected
                    </button>
                </div>
            )}
            <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2 space-y-0.5">
                {recentConversations.length === 0 ? (
                    !collapsed && <div className="px-3 py-2 text-xs text-zinc-400">{searchQuery.trim() ? 'No matching conversations' : 'No conversations yet'}</div>
                ) : (
                    recentConversations.map(conv => (
                        <div
                            key={conv.id}
                            className={`group w-full flex items-center ${collapsed ? 'justify-center px-2' : 'gap-2 px-3'} py-2 rounded-md text-left transition-colors ${conv.id === activeConversationId
                                ? 'bg-zinc-800 text-zinc-100'
                                : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/80'
                                }`}
                        >
                            {!collapsed && isSelectionMode && (
                                <input
                                    type="checkbox"
                                    checked={selectedConversationIds.has(conv.id)}
                                    onChange={() => toggleConversationSelection(conv.id)}
                                    onClick={(event) => event.stopPropagation()}
                                    className="h-3.5 w-3.5 shrink-0 accent-cyan-400"
                                    aria-label={`Select ${getPreview(conv)} for deletion`}
                                />
                            )}
                            <button
                                onClick={() => {
                                    if (isSelectionMode) toggleConversationSelection(conv.id);
                                    else act(() => onLoadConversation(conv.id))();
                                }}
                                className={`flex items-center ${collapsed ? 'justify-center' : 'gap-2'} flex-1 min-w-0 text-left`}
                                title={getPreview(conv)}
                                aria-label={getPreview(conv)}
                            >
                                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${conv.id === activeConversationId ? 'bg-zinc-300' : 'bg-zinc-700'}`} />
                                 {!collapsed && <span className="truncate text-sm">{getPreview(conv)}</span>}
                            </button>
                            {!collapsed && !isSelectionMode && conv.id !== activeConversationId && (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onDeleteConversation(conv.id);
                                        onNavigate?.();
                                    }}
                                     className="p-1 rounded-md text-zinc-400 hover:text-red-400 hover:bg-red-500/10 transition-colors opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 focus-visible:ring-2 focus-visible:ring-cyan-400 shrink-0"
                                    title="Delete session"
                                    aria-label={`Delete ${getPreview(conv)}`}
                                >
                                    <TrashIcon />
                                </button>
                            )}
                        </div>
                    ))
                )}
            </div>

            {/* User footer — clickable to open Settings */}
            {activeUsername && (
                <button
                    onClick={act(onOpenSettings)}
                    className={`border-t border-white/5 ${collapsed ? 'p-2 justify-center' : 'p-3 gap-2.5'} flex items-center w-full hover:bg-zinc-800 transition-colors text-left`}
                    title="Open settings"
                    aria-label="Open settings"
                >
                    <div className="w-8 h-8 rounded-full bg-zinc-800 border border-white/10 flex items-center justify-center text-xs font-bold text-zinc-300 uppercase shrink-0">
                        {activeUsername.charAt(0)}
                    </div>
                    {!collapsed && <span className="text-sm font-medium text-zinc-300 truncate">{activeUsername}</span>}
                </button>
            )}
        </div>
    );
};
