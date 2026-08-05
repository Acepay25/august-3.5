import React, { useState, useEffect, useRef } from 'react';
import { BotIcon, LoadingIcon, CheckIcon, EyeIcon, HamburgerIcon, ActivityIcon, CloudOffIcon } from './Icons';
import { getSessionContext, getAllSessionsStatus, SessionContext, SessionStatus } from '../../services/infrastructure/SessionService';
import { UpdateButton } from './UpdateButton';
import { SidebarContent } from './Sidebar';
import { Conversation } from '../../types';

interface HeaderProps {
    activeUsername: string | null;
    saveStatus: 'SAVED' | 'SAVING' | 'ERROR';
    isAnalysisInProgress: boolean;
    isPostMortemInProgress: boolean;
    currentVisionData: string[];
    // Fresh session = active conversation has no messages (Sidebar gates
    // New Conversation on this).
    isFreshSession: boolean;
    isMobileMenuOpen: boolean;
    mobileMenuRef: React.RefObject<HTMLDivElement | null>;
    setIsMobileMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
    setIsVisionDataVisible: (visible: boolean) => void;
    setJournalState: (state: { isOpen: boolean; tab: 'log' | 'performance' | 'analytics' }) => void;
    setIsSettingsVisible: (visible: boolean) => void;
    setIsLivePostMortemVisible: (visible: boolean) => void;
    isLoading: boolean;
    isRateLimited: boolean;
    onOpenLiveMarket: () => void;
    onOpenVersionHistory: () => void; // New prop for Changelog
    // Network status
    isOnline?: boolean;
    pendingQueueCount?: number;
    // Live market conditions
    liveMarketConditions?: {
        volatility: 'High' | 'Medium' | 'Low';
        liquidation: 'High' | 'Medium' | 'Low';
        lastUpdated: string;
    } | null;
    // Sidebar (shared with the persistent desktop column)
    conversations: Conversation[];
    activeConversationId: string | null;
    onNewConversation: () => void;
    onLoadConversation: (id: string) => void;
    onDeleteConversation: (id: string) => void;
}

export const Header: React.FC<HeaderProps> = ({
    activeUsername,
    saveStatus,
    isAnalysisInProgress,
    isPostMortemInProgress,
    currentVisionData,
    isFreshSession,
    isMobileMenuOpen,
    mobileMenuRef,
    setIsMobileMenuOpen,
    setIsVisionDataVisible,
    setJournalState,
    setIsSettingsVisible,
    setIsLivePostMortemVisible,
    isLoading,
    isRateLimited,
    onOpenLiveMarket,
    onOpenVersionHistory,
    isOnline = true,
    pendingQueueCount = 0,
    liveMarketConditions,
    conversations,
    activeConversationId,
    onDeleteConversation,
    onNewConversation,
    onLoadConversation
}) => {
    const [sessionContext, setSessionContext] = useState<SessionContext | null>(null);
    const [allSessions, setAllSessions] = useState<SessionStatus[]>([]);
    const [isSessionModalOpen, setIsSessionModalOpen] = useState(false);
    const sessionModalRef = useRef<HTMLDivElement>(null);

    // Update session context periodically.
    // Pause when the tab is hidden to save CPU/battery on mobile,
    // and use a 5s interval instead of 1s to reduce re-renders.
    useEffect(() => {
        const updateSessions = () => {
            setSessionContext(getSessionContext());
            setAllSessions(getAllSessionsStatus());
        };

        updateSessions();

        let interval: ReturnType<typeof setInterval>;
        const startInterval = () => {
            interval = setInterval(updateSessions, 5000);
        };
        const stopInterval = () => {
            clearInterval(interval);
        };

        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                updateSessions(); // Refresh immediately on return
                startInterval();
            } else {
                stopInterval();
            }
        };

        startInterval();
        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            stopInterval();
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, []);

    useEffect(() => {
        if (!isMobileMenuOpen) return;
        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setIsSessionModalOpen(false);
                setIsMobileMenuOpen(false);
                return;
            }
            if (event.key !== 'Tab' || !mobileMenuRef.current) return;
            const focusable = mobileMenuRef.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
            if (!focusable.length) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        };
        document.addEventListener('keydown', handleEscape);
        requestAnimationFrame(() => mobileMenuRef.current?.querySelector<HTMLElement>('button')?.focus());
        return () => document.removeEventListener('keydown', handleEscape);
    }, [isMobileMenuOpen, setIsMobileMenuOpen]);

    // Close session modal when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (sessionModalRef.current && !sessionModalRef.current.contains(event.target as Node)) {
                setIsSessionModalOpen(false);
            }
        };

        if (isSessionModalOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isSessionModalOpen]);

    // Format minutes into hours/min
    const formatDuration = (minutes: number) => {
        const h = Math.floor(minutes / 60);
        const m = minutes % 60;
        if (h > 0) return `${h}h ${m}m`;
        return `${m}m`;
    };

    return (
        <header className="glass status-surface sticky top-0 z-20 px-4 py-1.5 sm:px-6 sm:py-2 border-b border-transparent shadow-sm flex-shrink-0 pt-[calc(env(safe-area-inset-top,0px)+0.375rem)] sm:pt-[calc(env(safe-area-inset-top,0px)+0.5rem)]">
            <div className="max-w-7xl mx-auto flex items-center justify-between">
                <div className="flex-1 min-w-0 flex items-center gap-3 sm:gap-4 relative">
                    {/* Hamburger Menu Button */}
                    <button
                        onClick={() => setIsMobileMenuOpen(prev => !prev)}
                        className="p-2.5 text-zinc-400 hover:text-cyan-400 rounded-xl hover:bg-zinc-800 transition-colors lg:hidden focus-visible:ring-2 focus-visible:ring-cyan-400"
                        title="Menu"
                        aria-label="Toggle navigation menu"
                        aria-expanded={isMobileMenuOpen}
                        aria-controls="mobile-navigation-menu"
                    >
                        <HamburgerIcon className="h-5 w-5" />
                    </button>

                    <div className="flex flex-col justify-center">
                        <div className="flex items-center gap-3">
                            <h1 className="text-base sm:text-lg font-bold tracking-tight text-zinc-100 leading-none">August <span className="text-cyan-500">3.5</span></h1>

                            {/* Session Display */}
                            {sessionContext && (
                                <div className="static sm:relative" ref={sessionModalRef}>
                                    <button
                                        onClick={() => setIsSessionModalOpen(!isSessionModalOpen)}
                                        className="flex items-center gap-1.5 px-2 py-0.5 bg-zinc-800 hover:bg-zinc-700 rounded-full border border-white/5 hover:border-white/10 text-[10px] font-medium text-zinc-400 whitespace-nowrap transition-all focus-visible:ring-2 focus-visible:ring-cyan-400"
                                        aria-expanded={isSessionModalOpen}
                                        aria-haspopup="dialog"
                                    >
                                        <span className={`w-1.5 h-1.5 rounded-full ${sessionContext.isKillZone ? 'bg-red-500 animate-pulse' :
                                            sessionContext.currentSession === 'off_hours' ? 'bg-zinc-500' : 'bg-emerald-500'
                                            }`} />
                                        <span className={sessionContext.isKillZone ? 'text-red-400' : ''}>
                                            {sessionContext.currentSession === 'overlap_london_ny' ? 'Ldn/NY' :
                                                sessionContext.currentSession === 'new_york' ? 'NY' :
                                                    sessionContext.currentSession === 'london' ? 'London' :
                                                        sessionContext.currentSession === 'asia' ? 'Asia' : 'Off'}
                                        </span>
                                    </button>

                                    {/* Session Details Modal */}
                                    {isSessionModalOpen && (
                                             <div role="dialog" aria-label="Session details" className="absolute top-full left-0 sm:left-auto sm:right-0 mt-4 sm:mt-2 w-80 bg-zinc-900 border border-white/10 rounded-xl shadow-2xl overflow-hidden z-50 animate-in fade-in zoom-in-95 duration-200">
                                            <div className="p-3 bg-zinc-900">
                                                {/* Live Market Conditions Section */}
                                                {liveMarketConditions && (
                                                    <div className="mb-3 p-2 bg-zinc-800 rounded-lg border border-white/5">
                                                        <div className="flex items-center justify-between mb-1.5">
                                                            <div className="text-[10px] font-bold text-cyan-400 uppercase tracking-wider flex items-center gap-1">
                                                                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                                                                LIVE MARKET (BTC)
                                                            </div>
                                                        </div>
                                                        <div className="flex items-center gap-2">
                                                            <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${liveMarketConditions.volatility === 'High' ? 'border-red-500/40 text-red-400 bg-red-500/15' :
                                                                liveMarketConditions.volatility === 'Medium' ? 'border-amber-500/40 text-amber-400 bg-amber-500/15' :
                                                                    'border-emerald-500/40 text-emerald-400 bg-emerald-500/15'
                                                                }`}>
                                                                 {liveMarketConditions.volatility} Volatility
                                                            </span>
                                                            <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${liveMarketConditions.liquidation === 'High' ? 'border-purple-500/40 text-purple-400 bg-purple-500/15' :
                                                                liveMarketConditions.liquidation === 'Medium' ? 'border-blue-500/40 text-blue-400 bg-blue-500/15' :
                                                                    'border-zinc-500/40 text-zinc-400 bg-zinc-500/15'
                                                                }`}>
                                                                 {liveMarketConditions.liquidation} Liq
                                                            </span>
                                                        </div>
                                                    </div>
                                                )}
                                                <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-2">Sessions</div>
                                                <div className="space-y-2">
                                                    {allSessions.map(session => (
                                                        <div key={session.id} className="flex items-center justify-between text-xs py-0.5">
                                                            <div className="flex items-center gap-2 min-w-0">
                                                                <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${session.isOpen ? 'bg-emerald-500 shadow-[0_0_8px_rgba(176, 176, 182,0.5)]' : 'bg-zinc-700'}`} />
                                                                <span className={session.isOpen ? 'text-white font-medium truncate' : 'text-zinc-500 truncate'}>{session.name.replace(' Session', '')}</span>
                                                            </div>
                                                            <div className="flex items-center gap-1.5 flex-shrink-0">
                                                                <span className={`text-[9px] px-1.5 py-0 rounded-full border whitespace-nowrap ${session.volatility === 'High' ? 'border-red-500/30 text-red-400 bg-red-500/10' :
                                                                    session.volatility === 'Medium' ? 'border-amber-500/30 text-amber-400 bg-amber-500/10' :
                                                                        'border-emerald-500/30 text-emerald-400 bg-emerald-500/10'
                                                                    }`}>
                                                                     {session.volatility}
                                                                </span>
                                                                <div className="text-right w-20 whitespace-nowrap relative">
                                                                    {session.isOpen ? (
                                                                        <span className="text-[10px] text-emerald-400 font-mono">
                                                                            Closes in {formatDuration(session.closesInMinutes)}
                                                                        </span>
                                                                    ) : (
                                                                        <span className="text-[10px] text-zinc-500 font-mono">
                                                                            Opens in {formatDuration(session.opensInMinutes)}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                                {sessionContext.warnings.length > 0 && (
                                                    <div className="mt-3 pt-2 border-t border-white/5">
                                                        <div className="flex items-center gap-1.5 text-amber-400 mb-1">
                                                            <ActivityIcon className="w-3 h-3" />
                                                            <span className="text-[10px] font-bold">Market Condition</span>
                                                        </div>
                                                        <div className="text-[10px] text-zinc-400 leading-tight">
                                                            {sessionContext.warnings[0]}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
                {/* Right Side: Minimal Actions */}
                <div className="flex items-center gap-2">
                    {saveStatus === 'SAVING' && <LoadingIcon className="h-4 w-4 text-zinc-500" />}
                    {saveStatus === 'SAVED' && <CheckIcon className="h-4 w-4 text-emerald-500" />}
                    {!isOnline && <CloudOffIcon className="h-4 w-4 text-yellow-500" />}

                    {/* Desktop: Update button */}
                    <div className="hidden sm:block">
                        <UpdateButton />
                    </div>

                    {/* Changelog / Version History Button */}
                    <button
                        onClick={onOpenVersionHistory}
                        className="p-2 text-zinc-400 hover:text-cyan-400 hover:bg-zinc-800 rounded-lg transition-colors"
                        title="Changelog & Features"
                        aria-label="Changelog and features"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></svg>
                    </button>

                    {isPostMortemInProgress && (
                        <button
                            onClick={() => setIsLivePostMortemVisible(true)}
                            className="p-2.5 bg-cyan-500/10 text-cyan-400 rounded-xl animate-pulse"
                            title="Live Post-Mortem"
                            aria-label="View live post-mortem progress"
                        >
                            <EyeIcon />
                        </button>
                    )}
                </div>

                {/* Slide-out Menu Panel */}
                {isMobileMenuOpen && (
                    <div className="fixed inset-0 z-50 lg:hidden">
                        {/* Backdrop */}
                        <div
                            className="absolute inset-0 bg-black/50"
                            onClick={() => setIsMobileMenuOpen(false)}
                        />

                        {/* Menu Panel */}
                         <div id="mobile-navigation-menu" ref={mobileMenuRef} className="absolute left-0 top-0 h-full w-72 bg-zinc-900 border-r border-white/10 shadow-2xl animate-slide-in-left flex flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]" role="dialog" aria-modal="true" aria-label="Navigation menu">
                            <div className="p-5 border-b border-white/10 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-full bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
                                        <BotIcon />
                                    </div>
                                    <div>
                                        <h2 className="font-bold text-white">August 3.5</h2>
                                        <span className="text-[10px] text-zinc-500">{activeUsername}</span>
                                    </div>
                                </div>
                            </div>

                            <div className="flex-1 min-h-0 overflow-y-auto py-3">
                                <SidebarContent
                                    activeUsername={activeUsername}
                                    conversations={conversations}
                                    activeConversationId={activeConversationId}
                                    hasVisionData={currentVisionData.length > 0}
                                    isFreshSession={isFreshSession}
                                    onNewConversation={onNewConversation}
                                    onLoadConversation={onLoadConversation}
                                    onDeleteConversation={onDeleteConversation}
                                    onOpenLiveMarket={onOpenLiveMarket}
                                    onOpenVisionData={() => setIsVisionDataVisible(true)}
                                    onOpenJournal={() => setJournalState({ isOpen: true, tab: 'log' })}
                                    onOpenSettings={() => setIsSettingsVisible(true)}
                                    onNavigate={() => setIsMobileMenuOpen(false)}
                                />
                            </div>

                            <div className="px-5 py-3 border-t border-white/5">
                                <UpdateButton />
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </header >
    );
};
