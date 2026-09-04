import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Conversation, MessageRole } from '../../types';
import { AutomationConfig } from '../../types/automation';
import { humanizeCron } from '../../services/automation/cronParser';
import { searchChatHistory, ChatSearchHit } from '../../services/infrastructure/sessionSearch';
import type { SidebarPane } from '../../hooks/useSidebarPane';
import JobsPane from '../settings/JobsPane';
import {
    ActivityIcon,
    BotIcon,
    BookmarkIcon,
    ChevronDownIcon,
    CodeIcon,
    EyeIcon,
    PlusIcon,
    SearchIcon,
    SettingsIcon,
    TrashIcon,
} from './Icons';

/** App version for the account-popover footer (best-effort import). */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const APP_VERSION: string = (() => {
    try {
        // Vite injects this at build time; fall back gracefully elsewhere.
        return (typeof import.meta !== 'undefined' && (import.meta as { env?: { PACKAGE_VERSION?: string } }).env?.PACKAGE_VERSION) || '';
    } catch {
        return '';
    }
})();

interface NavRowProps {
    icon: React.ReactNode;
    label: string;
    onClick: () => void;
    collapsed?: boolean;
}

/** Reference-style relative age for session rows ("now", "51m", "21h", "3d"). */
const relTime = (ms: number): string => {
    if (!ms) return '';
    const diff = Date.now() - ms;
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'now';
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h`;
    return `${Math.floor(h / 24)}d`;
};

const lastActivityMs = (conv: Conversation): number => {
    const last = conv.messages?.[conv.messages.length - 1];
    const parsed = last?.createdAt ? Date.parse(last.createdAt) : NaN;
    return Number.isFinite(parsed) ? parsed : conv.timestamp || 0;
};

// Recency buckets for the session list.
const BUCKET_ORDER = ['Today', 'Yesterday', 'Previous 7 days', 'Previous 30 days', 'Older'] as const;

const bucketOf = (ms: number): string => {
    if (!ms) return 'Older';
    const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const days = Math.floor((dayStart(new Date()) - dayStart(new Date(ms))) / 86_400_000);
    if (days <= 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return 'Previous 7 days';
    if (days < 30) return 'Previous 30 days';
    return 'Older';
};

/** Tiny bordered keyboard hint ("Ctrl+N" / "Ctrl+K") for the top rows. */
const Kbd: React.FC<{ children: string }> = ({ children }) => (
    <span className="shrink-0 rounded border border-white/10 px-1 py-px text-[9px] leading-4 text-zinc-600">
        {children}
    </span>
);

const NavRow: React.FC<NavRowProps> = ({ icon, label, onClick, collapsed = false }) => (
    <button
        onClick={onClick}
        className={`w-full flex items-center ${collapsed ? 'justify-center px-2' : 'gap-2.5 px-2.5'} py-1.5 rounded-lg text-[13px] text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06] transition-colors focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#1a1a1a]`}
        title={collapsed ? label : undefined}
        aria-label={collapsed ? label : undefined}
    >
        <span className="shrink-0 text-zinc-500">{icon}</span>
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
    // Unified-pane props (desktop sidebar only). When `sidebarPane` is
    // provided the sidebar renders the SESSIONS | BOTS | TERMINAL tab bar
    // and swaps its body by pane — BOTS embeds the full agent roster rail
    // (variant="embedded"), TERMINAL the background-jobs pane. The mobile
    // drawer omits these and keeps the classic sessions-only body.
    sidebarPane?: SidebarPane;
    onSetSidebarPane?: (pane: SidebarPane) => void;
    /** Bots-pane content: the <AgentRosterRail variant="embedded" .../>
     *  element, built by App (which owns roster state). Optional — omit in
     *  the mobile drawer; the pane bar hides BOTS/TERMINAL without these
     *  props so no dead tab can render. */
    rosterSlot?: React.ReactNode;
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
    sidebarPane,
    onSetSidebarPane,
    rosterSlot,
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

    // F5: conversation search — backed by sessionSearch.searchChatHistory
    // (the recall_chat engine): full-text over ALL stored messages, ranked.
    // The plain list only shows the first 8 until "Show more".
    const [searchOpen, setSearchOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchHits, setSearchHits] = useState<ChatSearchHit[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const [showAllConversations, setShowAllConversations] = useState(false);
    const [isSelectionMode, setIsSelectionMode] = useState(false);
    const [selectedConversationIds, setSelectedConversationIds] = useState<Set<string>>(new Set());
    // Account popover on the footer row.
    const [userMenuOpen, setUserMenuOpen] = useState(false);

    useEffect(() => {
        const validIds = new Set(conversations.map(conversation => conversation.id));
        setSelectedConversationIds(previous => new Set([...previous].filter(id => validIds.has(id))));
    }, [conversations]);

    useEffect(() => {
        if (collapsed) {
            setIsSelectionMode(false);
            setSelectedConversationIds(new Set());
            setSearchOpen(false);
            setSearchQuery('');
        }
    }, [collapsed]);

    useEffect(() => {
        if (searchOpen) searchInputRef.current?.focus();
    }, [searchOpen]);

    // Debounced recall_chat query — top hit per conversation (clicking loads
    // that session).
    useEffect(() => {
        const q = searchQuery.trim();
        if (!searchOpen || !q) {
            setSearchHits([]);
            setIsSearching(false);
            return;
        }
        setIsSearching(true);
        let cancelled = false;
        const timer = setTimeout(async () => {
            try {
                const hits = await searchChatHistory(q, undefined, 12);
                if (cancelled) return;
                const seen = new Set<string>();
                setSearchHits(hits.filter(h => !seen.has(h.conversationId) && seen.add(h.conversationId)));
            } catch {
                if (!cancelled) setSearchHits([]);
            } finally {
                if (!cancelled) setIsSearching(false);
            }
        }, 250);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [searchQuery, searchOpen]);

    const sortedConversations = useMemo(
        () => [...conversations].sort((a, b) => lastActivityMs(b) - lastActivityMs(a)),
        [conversations]
    );
    const visibleConversations = useMemo(
        () => (showAllConversations ? sortedConversations : sortedConversations.slice(0, 8)),
        [sortedConversations, showAllConversations]
    );
    const groupedConversations = useMemo(() => {
        const map = new Map<string, Conversation[]>();
        for (const conv of visibleConversations) {
            const bucket = bucketOf(lastActivityMs(conv));
            const arr = map.get(bucket) ?? [];
            arr.push(conv);
            map.set(bucket, arr);
        }
        return BUCKET_ORDER
            .filter(bucket => map.has(bucket))
            .map(bucket => ({ label: bucket, items: map.get(bucket)! }));
    }, [visibleConversations]);

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

    const isSearchingQuery = searchOpen && searchQuery.trim().length > 0;

    // Unified panes: when the desktop shell provides sidebarPane, the body
    // swaps between SESSIONS (classic content below), BOTS (the embedded
    // agent roster rail), and TERMINAL (background jobs). The mobile drawer
    // omits the props → showUnified stays false → identical to before.
    // A collapsed rail (w-16) has no room for tabs or roster rows — the
    // compact sessions body shows instead; the pane returns on expand.
    const showUnified = Boolean(sidebarPane && onSetSidebarPane) && !collapsed;
    // Bots pane without roster content (e.g. floor mode passes null) falls
    // back to the sessions body — a pane tab never shows an empty column.
    const showSessionsBody = !showUnified || sidebarPane === 'sessions' || (sidebarPane === 'bots' && !rosterSlot);
    const showBotsBody = showUnified && sidebarPane === 'bots' && Boolean(rosterSlot);
    const showTerminalBody = showUnified && sidebarPane === 'terminal';
    const panes: [SidebarPane, string][] = rosterSlot
        ? [['sessions', 'Sessions'], ['bots', 'Bots'], ['terminal', 'Terminal']]
        : [['sessions', 'Sessions'], ['terminal', 'Terminal']];

    const renderConversationRow = (conv: Conversation) => (
        <div
            key={conv.id}
            // Session rows: bullet + title; the ACTIVE session is
            // the ~#37373d fill (zinc-700), hover is a whisper of white.
            className={`group w-full flex items-center ${collapsed ? 'justify-center px-2' : 'gap-2 px-3'} py-2 rounded-md text-left transition-colors ${conv.id === activeConversationId
                ? 'bg-zinc-700 text-zinc-100'
                : 'text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.04]'
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
                {/* Reference rows carry a small neutral bullet per chat title. */}
                {!collapsed && <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${conv.id === activeConversationId ? 'bg-zinc-300' : 'bg-zinc-600'}`} />}
                {!collapsed && <span className="truncate text-sm">{getPreview(conv)}</span>}
            </button>
            {!collapsed && (
                <span className="ml-auto shrink-0 text-[10px] text-zinc-600" title={new Date(lastActivityMs(conv)).toLocaleString()}>
                    {relTime(lastActivityMs(conv))}
                </span>
            )}
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
    );

    return (
        <div className="flex flex-col h-full min-h-0 bg-zinc-900">
            {/* Unified pane tabs (SESSIONS | BOTS | TERMINAL) — desktop
                only; the mobile drawer (no sidebarPane) has no tabs. */}
            {showUnified && (
                <div className="flex shrink-0 items-center gap-4 px-4 pt-3" role="tablist" aria-label="Sidebar panes">
                    {panes.map(([pane, label]) => {
                        const active = sidebarPane === pane;
                        return (
                            <button
                                key={pane}
                                type="button"
                                role="tab"
                                aria-selected={active}
                                data-testid={`sidebar-pane-${pane}`}
                                onClick={() => onSetSidebarPane?.(pane)}
                                className={`-mb-px border-b pb-1.5 text-[10px] font-bold uppercase tracking-widest transition-colors ${active
                                    ? 'border-zinc-200 text-zinc-100'
                                    : 'border-transparent text-zinc-500 hover:text-zinc-300'}`}
                            >
                                {label}
                            </button>
                        );
                    })}
                </div>
            )}

            {showSessionsBody && (<>
            {/* Top rows: New chat + Search with kbd hints, then
                the quick actions as plain icon rows (no section header). */}
            <div className={collapsed ? 'p-2 pb-1' : 'px-2 pt-3 pb-1'}>
                <button
                    onClick={act(onNewConversation)}
                    disabled={isFreshSession}
                    className={`w-full flex items-center ${collapsed ? 'justify-center px-2' : 'gap-2.5 px-2.5'} py-2 rounded-lg text-[13px] text-zinc-300 transition-colors hover:bg-white/[0.06] hover:text-zinc-100 disabled:opacity-30 disabled:cursor-not-allowed`}
                    title={isFreshSession ? 'Start typing to begin a conversation' : 'Start a new conversation'}
                    aria-label="Start a new conversation"
                >
                    <PlusIcon className="h-4 w-4 shrink-0 text-zinc-500" />
                    {!collapsed && (
                        <>
                            <span className="truncate flex-1 text-left">New chat</span>
                            <Kbd>Ctrl+N</Kbd>
                        </>
                    )}
                </button>
                {!collapsed && (
                    <>
                        <button
                            type="button"
                            onClick={() => {
                                setSearchOpen(open => !open);
                                setSearchQuery('');
                            }}
                            aria-expanded={searchOpen}
                            aria-label="Search your chat history"
                            title="Search sessions (full-text via recall)"
                            className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-[13px] text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06] transition-colors"
                        >
                            <SearchIcon className="h-4 w-4 shrink-0 text-zinc-500" />
                            <span className="truncate flex-1 text-left">Search</span>
                        </button>
                        {searchOpen && (
                            <div className="px-1 pt-1 pb-0.5">
                                <input
                                    ref={searchInputRef}
                                    type="text"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Escape') {
                                            setSearchOpen(false);
                                            setSearchQuery('');
                                        }
                                    }}
                                    placeholder="Search your history…"
                                    aria-label="Search your full chat history"
                                    className="w-full rounded-lg border border-transparent bg-zinc-950/60 px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 transition-colors focus:border-white/10 focus:outline-none"
                                />
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* Quick actions */}
            <nav className="px-2">
                <div className="space-y-0">
                    <NavRow collapsed={collapsed} icon={<ActivityIcon className="h-4 w-4" />} label="Live Market" onClick={act(onOpenLiveMarket)} />
                    {hasVisionData && (
                        <NavRow collapsed={collapsed} icon={<CodeIcon className="h-4 w-4" />} label="View Vision Data" onClick={act(onOpenVisionData)} />
                    )}
                    <NavRow collapsed={collapsed} icon={<BookmarkIcon className="h-4 w-4" />} label="Trading Journal" onClick={act(onOpenJournal)} />
                    {onOpenBotManager && (
                        <NavRow collapsed={collapsed} icon={<BotIcon className="h-4 w-4" />} label="Bots" onClick={act(onOpenBotManager)} />
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
                                className="rounded px-1.5 py-0.5 text-[10px] text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-200"
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
                                className="w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-left transition-colors hover:bg-white/[0.05] group"
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

            {/* Sessions */}
            {!collapsed && <div className="flex items-center justify-between px-5 pb-1 pt-5">
                <span className="ui-kicker">Sessions</span>
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
            {!collapsed && isSelectionMode && (
                <div className="mx-3 mb-2 flex items-center justify-between gap-2 rounded-lg bg-zinc-800 px-2.5 py-2">
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
                {collapsed ? (
                    visibleConversations.map(renderConversationRow)
                ) : isSearchingQuery ? (
                    // recall_chat results — full-text hits across every stored
                    // message, ranked; clicking a hit opens that session.
                    isSearching ? (
                        <div className="px-3 py-2 text-xs text-zinc-500">Searching your history…</div>
                    ) : searchHits.length === 0 ? (
                        <div className="px-3 py-2 text-xs text-zinc-400">No matches in your history</div>
                    ) : (
                        searchHits.map(hit => (
                            <button
                                key={`${hit.conversationId}-${hit.at}`}
                                type="button"
                                onClick={act(() => {
                                    onLoadConversation(hit.conversationId);
                                    setSearchQuery('');
                                })}
                                className="w-full rounded-md px-3 py-2 text-left transition-colors hover:bg-zinc-800/40"
                            >
                                <div className="flex items-baseline gap-2">
                                    <span className="min-w-0 truncate text-[13px] text-zinc-200">{hit.conversationTitle}</span>
                                    <span className="ml-auto shrink-0 text-[10px] text-zinc-600">{relTime(Date.parse(hit.at) || 0)}</span>
                                </div>
                                <p className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-zinc-500">
                                    <span className="mr-1 text-[9px] uppercase tracking-wide text-zinc-600">{hit.speaker}</span>
                                    {hit.excerpt}
                                </p>
                            </button>
                        ))
                    )
                ) : groupedConversations.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-zinc-400">No conversations yet</div>
                ) : (
                    groupedConversations.map(group => (
                        <div key={group.label} className="pt-1">
                            <div className="px-3 pb-0.5 pt-1.5 text-[10px] font-medium uppercase tracking-wider text-zinc-600">
                                {group.label}
                            </div>
                            {group.items.map(renderConversationRow)}
                        </div>
                    ))
                )}
                {!collapsed && !isSearchingQuery && !searchQuery.trim() && conversations.length > 8 && (
                    <button
                        type="button"
                        onClick={() => setShowAllConversations(v => !v)}
                        className="w-full px-3 py-2 text-left text-xs text-zinc-500 transition-colors hover:text-zinc-200"
                    >
                        {showAllConversations ? 'Show less' : 'Show more'}
                    </button>
                )}
            </div>
            </>)}

            {/* BOTS pane — the full agent roster rail, embedded. App builds
                the element (it owns the roster state); here it just mounts. */}
            {showBotsBody && rosterSlot}

            {/* TERMINAL pane — the status stack of background work. */}
            {showTerminalBody && <JobsPane />}

            {/* User footer — opens an account popover (Settings,
                New chat, version). The footer no longer navigates
                directly; it reveals the account menu. */}
            {activeUsername && (
                <div className="relative border-t border-white/[0.06]">
                    <button
                        onClick={() => setUserMenuOpen(open => !open)}
                        aria-expanded={userMenuOpen}
                        aria-haspopup="menu"
                        className={`${collapsed ? 'p-2 justify-center' : 'p-3 gap-2.5'} flex items-center w-full hover:bg-white/[0.06] transition-colors text-left`}
                        title="Account"
                        aria-label="Open account menu"
                    >
                        <div className="w-8 h-8 rounded-full bg-zinc-700/70 flex items-center justify-center text-xs font-bold text-zinc-200 uppercase shrink-0">
                            {activeUsername.charAt(0)}
                        </div>
                        {!collapsed && (
                            <>
                                <span className="flex-1 truncate text-sm font-medium text-zinc-300">{activeUsername}</span>
                                <ChevronDownIcon className={`h-3.5 w-3.5 shrink-0 text-zinc-500 transition-transform ${userMenuOpen ? 'rotate-180' : ''}`} />
                            </>
                        )}
                    </button>
                    {userMenuOpen && !collapsed && (
                        <>
                            {/* Click-away layer */}
                            <div className="fixed inset-0 z-30" onClick={() => setUserMenuOpen(false)} aria-hidden="true" />
                            <div role="menu" aria-label="Account" className="absolute bottom-full left-2 right-2 z-40 mb-2 rounded-xl bg-zinc-800 p-1.5 shadow-2xl animate-fade-in">
                                <button
                                    type="button"
                                    role="menuitem"
                                    onClick={() => { setUserMenuOpen(false); act(onOpenSettings)(); }}
                                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-zinc-200 transition-colors hover:bg-white/[0.06]"
                                >
                                    <SettingsIcon className="h-4 w-4 shrink-0 text-zinc-500" />
                                    <span className="flex-1">Settings</span>
                                    <Kbd>Ctrl+,</Kbd>
                                </button>
                                {!isFreshSession && (
                                    <button
                                        type="button"
                                        role="menuitem"
                                        onClick={() => { setUserMenuOpen(false); act(onNewConversation)(); }}
                                        className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-zinc-200 transition-colors hover:bg-white/[0.06]"
                                    >
                                        <PlusIcon className="h-4 w-4 shrink-0 text-zinc-500" />
                                        <span className="flex-1">New chat</span>
                                        <Kbd>Ctrl+N</Kbd>
                                    </button>
                                )}
                                <p className="border-t border-white/[0.06] px-2.5 pb-1 pt-2 font-mono text-[10px] text-zinc-600">
                                    August v{typeof APP_VERSION === 'string' ? APP_VERSION : ''}
                                </p>
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
};
