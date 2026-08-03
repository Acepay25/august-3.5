import React from 'react';
import { Conversation, MessageRole } from '../../types';
import {
    ActivityIcon,
    BookmarkIcon,
    CodeIcon,
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
        className={`w-full flex items-center ${collapsed ? 'justify-center px-2' : 'gap-3 px-3'} py-2 rounded-lg text-sm text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#151515]`}
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
    onOpenSettings: () => void;
    onDeleteConversation: (id: string) => void;
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
    onOpenSettings,
    onDeleteConversation,
    onNavigate,
    collapsed = false,
}) => {
    const recentConversations = conversations.slice(0, 8);

    const getPreview = (conv: Conversation): string => {
        const firstUserMessage = (conv.messages || []).find(m => m.role === MessageRole.USER && m.text.trim());
        return firstUserMessage ? firstUserMessage.text : 'New Conversation';
    };

    const act = (fn: () => void) => () => {
        fn();
        onNavigate?.();
    };

    return (
        <div className="flex flex-col h-full min-h-0 bg-[#151515]">
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
                    <span className="text-[10px] font-medium text-zinc-400 uppercase tracking-widest">Quick actions</span>
                </div>}
                <div className="space-y-0.5">
                    <NavRow collapsed={collapsed} icon={<ActivityIcon className="h-4 w-4" />} label="Live Market" onClick={act(onOpenLiveMarket)} />
                    {hasVisionData && (
                        <NavRow collapsed={collapsed} icon={<CodeIcon className="h-4 w-4" />} label="View Vision Data" onClick={act(onOpenVisionData)} />
                    )}
                    <NavRow collapsed={collapsed} icon={<BookmarkIcon className="h-4 w-4" />} label="Trading Journal" onClick={act(onOpenJournal)} />
                </div>
            </nav>

            {/* Recent conversations */}
            {!collapsed && <div className="px-5 pb-1 pt-5">
                <span className="text-[10px] font-medium text-zinc-400 uppercase tracking-widest">Recent</span>
            </div>}
            <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2 space-y-0.5">
                {recentConversations.length === 0 ? (
                    !collapsed && <div className="px-3 py-2 text-xs text-zinc-400">No conversations yet</div>
                ) : (
                    recentConversations.map(conv => (
                        <div
                            key={conv.id}
                            className={`group w-full flex items-center ${collapsed ? 'justify-center px-2' : 'gap-2 px-3'} py-2 rounded-md text-left transition-colors ${conv.id === activeConversationId
                                ? 'bg-zinc-800 text-zinc-100'
                                : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/80'
                                }`}
                        >
                            <button
                                onClick={act(() => onLoadConversation(conv.id))}
                                className={`flex items-center ${collapsed ? 'justify-center' : 'gap-2'} flex-1 min-w-0 text-left`}
                                title={getPreview(conv)}
                                aria-label={getPreview(conv)}
                            >
                                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${conv.id === activeConversationId ? 'bg-zinc-300' : 'bg-zinc-700'}`} />
                                 {!collapsed && <span className="truncate text-sm">{getPreview(conv)}</span>}
                            </button>
                            {!collapsed && conv.id !== activeConversationId && (
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
