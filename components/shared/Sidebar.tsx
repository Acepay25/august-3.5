import React from 'react';
import { Conversation, MessageRole } from '../../types';
import {
    ActivityIcon,
    ArchiveIcon,
    BookmarkIcon,
    CodeIcon,
    PlusIcon,
} from './Icons';

interface NavRowProps {
    icon: React.ReactNode;
    label: string;
    onClick: () => void;
}

const NavRow: React.FC<NavRowProps> = ({ icon, label, onClick }) => (
    <button
        onClick={onClick}
        className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
    >
        <span className="shrink-0">{icon}</span>
        <span className="truncate">{label}</span>
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
    onOpenHistory: () => void;
    onOpenSettings: () => void;
    // Called after every action so the mobile drawer can close itself;
    // a no-op for the persistent desktop sidebar.
    onNavigate?: () => void;
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
    onOpenHistory,
    onOpenSettings,
    onNavigate,
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
        <div className="flex flex-col h-full min-h-0">
            {/* New Conversation — highlighted row (disabled in a fresh
                session: nothing exists yet to branch from) */}
            <div className="p-3 pb-2">
                <button
                    onClick={act(onNewConversation)}
                    disabled={isFreshSession}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl bg-zinc-800 border border-white/10 hover:bg-zinc-700 text-sm font-medium text-zinc-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-zinc-800"
                    title={isFreshSession ? 'Start typing to begin a conversation' : 'Start a new conversation'}
                >
                    <PlusIcon className="h-4 w-4 text-zinc-400" />
                    New Conversation
                </button>
            </div>

            {/* Quick actions */}
            <nav className="px-3">
                <div className="px-3 pb-1 pt-2">
                    <span className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest">Quick Actions</span>
                </div>
                <div className="space-y-0.5">
                    <NavRow icon={<ActivityIcon className="h-4 w-4" />} label="Live Market" onClick={act(onOpenLiveMarket)} />
                    {hasVisionData && (
                        <NavRow icon={<CodeIcon className="h-4 w-4" />} label="View Vision Data" onClick={act(onOpenVisionData)} />
                    )}
                    <NavRow icon={<BookmarkIcon className="h-4 w-4" />} label="Trading Journal" onClick={act(onOpenJournal)} />
                    <NavRow icon={<ArchiveIcon className="h-4 w-4" />} label="Conversation History" onClick={act(onOpenHistory)} />
                </div>
            </nav>

            {/* Recent conversations */}
            <div className="px-6 pb-1 pt-4">
                <span className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest">Recent</span>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-2 space-y-0.5">
                {recentConversations.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-zinc-600">No conversations yet</div>
                ) : (
                    recentConversations.map(conv => (
                        <button
                            key={conv.id}
                            onClick={act(() => onLoadConversation(conv.id))}
                            className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-colors ${conv.id === activeConversationId
                                ? 'bg-zinc-800 text-zinc-100'
                                : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800'
                                }`}
                        >
                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${conv.id === activeConversationId ? 'bg-zinc-300' : 'bg-zinc-700'}`} />
                            <span className="truncate text-sm">{getPreview(conv)}</span>
                        </button>
                    ))
                )}
            </div>

            {/* User footer — clickable to open Settings */}
            {activeUsername && (
                <button
                    onClick={act(onOpenSettings)}
                    className="border-t border-white/5 p-3 flex items-center gap-2.5 w-full hover:bg-zinc-800 transition-colors text-left"
                    title="Open settings"
                >
                    <div className="w-8 h-8 rounded-full bg-zinc-800 border border-white/10 flex items-center justify-center text-xs font-bold text-zinc-300 uppercase shrink-0">
                        {activeUsername.charAt(0)}
                    </div>
                    <span className="text-sm font-medium text-zinc-300 truncate">{activeUsername}</span>
                </button>
            )}
        </div>
    );
};
