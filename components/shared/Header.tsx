import React, { memo, useState, useEffect, useRef } from 'react';
import { BotIcon, LoadingIcon, CheckIcon, EyeIcon, PinIcon, ActivityIcon, CloudOffIcon, HistoryIcon, SearchIcon } from './Icons';
import { getSessionContext, getAllSessionsStatus, SessionContext, SessionStatus } from '../../services/infrastructure/SessionService';
import { baseOf } from '../../utils/symbol';
import { surfaceLabel } from '../shell/SurfaceMenuList';
import type { AppSurface } from '../../hooks/useSurface';

interface HeaderProps {
    saveStatus: 'SAVED' | 'SAVING' | 'ERROR';
    isAnalysisInProgress: boolean;
    isPostMortemInProgress: boolean;
    currentVisionData: string[];
    /** The current surface, named in the header. Navigation itself moved to
     *  the persistent NavRail (D2) — this is the label that tells you where
     *  you are, not a control that moves you somewhere. */
    surface: AppSurface;
    setIsLivePostMortemVisible: (visible: boolean) => void;
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
    /** The instrument `liveMarketConditions` was sampled from. The label binds
     *  to it instead of naming a symbol of its own. */
    liveMarketSymbol?: string;
    // Toolbar entries that stayed in the header when the drawer was retired.
    onOpenJobs?: () => void;
    onOpenWatchList?: () => void;
    watchOpenCount?: number;
    watchOpenR?: string;
    /** Open the command palette. */
    onOpenCommandPalette?: () => void;
}

// Memoized: Header re-renders every time App does (typing, progress ticks);
// with stable props it only renders when something it actually shows changes.
export const Header: React.FC<HeaderProps> = memo(({
    saveStatus,
    isAnalysisInProgress,
    isPostMortemInProgress,
    currentVisionData,
    surface,
    setIsLivePostMortemVisible,
    onOpenVersionHistory,
    isOnline = true,
    pendingQueueCount = 0,
    liveMarketConditions,
    liveMarketSymbol,
    onOpenWatchList,
    watchOpenCount = 0,
    watchOpenR,
    onOpenJobs,
    onOpenCommandPalette,
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

    // Esc closes the session modal. This used to also close the navigation
    // drawer and trap Tab inside it — both of which died with the drawer (D2).
    // The trap in particular was correct there and is simply not a thing for a
    // panel that is always on screen: trapping focus inside navigation that
    // sits beside the content would make the app unusable.
    useEffect(() => {
        if (!isSessionModalOpen) return;
        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setIsSessionModalOpen(false);
        };
        document.addEventListener('keydown', handleEscape);
        return () => document.removeEventListener('keydown', handleEscape);
    }, [isSessionModalOpen]);

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
        <header className="sticky top-0 z-20 flex-shrink-0 border-b border-white/[0.06] bg-zinc-900/85 backdrop-blur px-4 py-1.5 sm:px-6 sm:py-2 pt-[calc(env(safe-area-inset-top,0px)+0.375rem)] sm:pt-[calc(env(safe-area-inset-top,0px)+0.5rem)]">
            <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0 flex items-center gap-3 sm:gap-4 relative">
                    {/* Where you are, not a control. Navigation is the persistent
                        NavRail to the left; this names the surface it moved you
                        to, which is the one thing the rail's active bar cannot
                        spell out at a glance. */}
                    <span
                        data-testid="header-surface-label"
                        className="shrink-0 select-none text-ui-dense font-semibold uppercase tracking-wider text-zinc-300"
                    >
                        {surfaceLabel(surface)}
                    </span>

                    <div className="flex flex-col justify-center">
                        <div className="flex items-center gap-3">
                            <h1 className="bg-gradient-to-r from-brand-start via-brand-mid to-brand-end bg-clip-text font-serif text-lg leading-none tracking-tight text-transparent sm:text-xl">August Trading</h1>

                            {/* Session Display */}
                            {sessionContext && (
                                <div className="static sm:relative" ref={sessionModalRef}>
                                    <button
                                        onClick={() => setIsSessionModalOpen(!isSessionModalOpen)}
                                        className="flex items-center gap-1.5 px-2 py-0.5 bg-zinc-800 hover:bg-zinc-700 rounded-full border border-white/5 hover:border-white/10 text-ui-xs font-medium text-zinc-400 whitespace-nowrap transition-colors duration-[150ms] ease-[var(--ease-snappy)] focus-visible:ring-2 focus-visible:ring-zinc-500"
                                        aria-expanded={isSessionModalOpen}
                                        aria-haspopup="dialog"
                                    >
                                        <span className={`w-1.5 h-1.5 rounded-full ${sessionContext.isKillZone ? 'bg-rose-500 animate-pulse' :
                                            sessionContext.currentSession === 'off_hours' ? 'bg-zinc-500' : 'bg-emerald-500'
                                            }`} />
                                        <span className={sessionContext.isKillZone ? 'text-rose-400' : ''}>
                                            {sessionContext.currentSession === 'overlap' ? 'Ldn/NY' :
                                                sessionContext.currentSession === 'new_york' ? 'NY' :
                                                    sessionContext.currentSession === 'london' ? 'London' :
                                                        sessionContext.currentSession === 'asian' ? 'Asia' : 'Off'}
                                        </span>
                                    </button>

                                    {/* Session Details Modal */}
                                    {isSessionModalOpen && (
                                             <div role="dialog" aria-label="Session details" className="absolute top-full left-0 sm:left-auto sm:right-0 mt-4 sm:mt-2 w-80 bg-zinc-900 border border-white/10 rounded-xl shadow-2xl overflow-hidden z-50 animate-fade-in">
                                            <div className="p-3 bg-zinc-900">
                                                {/* Live Market Conditions Section */}
                                                {liveMarketConditions && (
                                                    <div className="mb-3 p-2 bg-zinc-800 rounded-lg border border-white/5">
                                                        <div className="flex items-center justify-between mb-1.5">
                                                            <div className="text-ui-xs font-bold text-zinc-300 uppercase tracking-wider flex items-center gap-1">
                                                                <span className="w-1.5 h-1.5 rounded-full bg-zinc-300 animate-pulse" />
                                                                LIVE MARKET{liveMarketSymbol ? ` (${baseOf(liveMarketSymbol)})` : ''}
                                                            </div>
                                                        </div>
                                                        <div className="flex items-center gap-2">
                                                            <span className={`text-ui-xs px-2 py-0.5 rounded-full border font-medium ${liveMarketConditions.volatility === 'High' ? 'border-rose-500/40 text-rose-400 bg-rose-500/15' :
                                                                liveMarketConditions.volatility === 'Medium' ? 'border-amber-500/40 text-amber-400 bg-amber-500/15' :
                                                                    'border-emerald-500/40 text-emerald-400 bg-emerald-500/15'
                                                                }`}>
                                                                 {liveMarketConditions.volatility} Volatility
                                                            </span>
                                                            <span className={`text-ui-xs px-2 py-0.5 rounded-full border font-medium ${liveMarketConditions.liquidation === 'High' ? 'border-zinc-300/40 text-zinc-200 bg-zinc-300/15' :
                                                                liveMarketConditions.liquidation === 'Medium' ? 'border-zinc-500/40 text-zinc-400 bg-zinc-500/15' :
                                                                    'border-zinc-700/40 text-zinc-500 bg-zinc-700/15'
                                                                }`}>
                                                                 {liveMarketConditions.liquidation} Liq
                                                            </span>
                                                        </div>
                                                    </div>
                                                )}
                                                <div className="text-ui-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Sessions</div>
                                                <div className="space-y-2">
                                                    {allSessions.map(session => (
                                                        <div key={session.id} className="flex items-center justify-between text-xs py-0.5">
                                                            <div className="flex items-center gap-2 min-w-0">
                                                                <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${session.isOpen ? 'bg-emerald-500 shadow-[0_0_8px_rgba(7,181,106,0.6)]' : 'bg-zinc-700'}`} />
                                                                <span className={session.isOpen ? 'text-white font-medium truncate' : 'text-zinc-500 truncate'}>{session.name.replace(' Session', '')}</span>
                                                            </div>
                                                            <div className="flex items-center gap-1.5 flex-shrink-0">
                                                                <span className={`text-ui-2xs px-1.5 py-0 rounded-full border whitespace-nowrap ${session.volatility === 'High' ? 'border-rose-500/30 text-rose-400 bg-rose-500/10' :
                                                                    session.volatility === 'Medium' ? 'border-amber-500/30 text-amber-400 bg-amber-500/10' :
                                                                        'border-emerald-500/30 text-emerald-400 bg-emerald-500/10'
                                                                    }`}>
                                                                     {session.volatility}
                                                                </span>
                                                                <div className="text-right w-20 whitespace-nowrap relative">
                                                                    {session.isOpen ? (
                                                                        <span className="text-ui-xs text-emerald-400 font-mono">
                                                                            Closes in {formatDuration(session.closesInMinutes)}
                                                                        </span>
                                                                    ) : (
                                                                        <span className="text-ui-xs text-zinc-500 font-mono">
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
                                                            <span className="text-ui-xs font-bold">Market Condition</span>
                                                        </div>
                                                        <div className="text-ui-xs text-zinc-400 leading-tight">
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
                <div className=" flex items-center gap-2">
                    {saveStatus === 'SAVING' && (
                        <span role="status" aria-label="Saving">
                            <LoadingIcon className="h-4 w-4 text-zinc-500" />
                        </span>
                    )}
                    {saveStatus === 'SAVED' && (
                        <span role="status" aria-label="Saved">
                            <CheckIcon className="h-4 w-4 text-emerald-500" />
                        </span>
                    )}
                    {!isOnline && (
                        <span role="status" aria-label="Offline">
                            <CloudOffIcon className="h-4 w-4 text-amber-500" />
                        </span>
                    )}

                    {/* Desktop: Segmented Quick Action Tray. Approvals is NOT
                        here — the activity rail owns that drawer (WS-5.2), and
                        this tray used to repeat it under a second name. */}
                    {(onOpenJobs || onOpenWatchList) && (
                        <div className="hidden sm:inline-flex items-center rounded-xl border border-white/[0.08] bg-zinc-800/60 p-0.5 shadow-sm">
                            {onOpenJobs && (
                                <button
                                    type="button"
                                    onClick={onOpenJobs}
                                    className="inline-flex items-center rounded-lg px-2.5 py-1 text-ui-dense font-semibold text-zinc-400 hover:bg-zinc-700/60 hover:text-zinc-100 transition-colors"
                                    title="Background jobs — evals & learning passes"
                                    aria-label="Background jobs"
                                >
                                    <span>Jobs</span>
                                </button>
                            )}
                            {onOpenWatchList && (
                                <button
                                    type="button"
                                    onClick={onOpenWatchList}
                                    className="relative inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-ui-dense font-semibold text-zinc-400 hover:bg-zinc-700/60 hover:text-zinc-100 transition-colors"
                                    title={watchOpenR ? `Pinned · ${watchOpenR}` : 'Pinned signals'}
                                    aria-label={`Pinned signals, ${watchOpenCount} open`}
                                >
                                    <PinIcon className="h-3.5 w-3.5" />
                                    <span>Pinned</span>
                                    {watchOpenCount > 0 && (
                                        <span className="min-w-[1rem] rounded-full bg-zinc-200 px-1 text-ui-2xs font-mono font-bold leading-4 text-zinc-900">
                                            {watchOpenR || (watchOpenCount > 99 ? '99+' : watchOpenCount)}
                                        </span>
                                    )}
                                </button>
                            )}
                        </div>
                    )}

                    {/* Desktop: Command Palette Trigger */}
                    {onOpenCommandPalette && (
                        <button
                            type="button"
                            onClick={onOpenCommandPalette}
                            className="hidden md:inline-flex items-center gap-2 rounded-xl border border-white/[0.08] bg-zinc-800/40 px-2.5 py-1 text-xs text-zinc-400 hover:border-white/15 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
                            title="Command palette (Ctrl+K / Cmd+K)"
                            aria-label="Command palette"
                        >
                            <SearchIcon className="h-3.5 w-3.5 text-zinc-500" />
                            <span className="text-ui-dense">Search</span>
                            <kbd className="rounded border border-white/10 bg-zinc-800 px-1.5 py-0.2 font-mono text-ui-2xs text-zinc-400">⌘K</kbd>
                        </button>
                    )}

                    {/* System Intelligence */}
                    <button
                        type="button"
                        onClick={onOpenVersionHistory}
                        className="p-2 text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800 rounded-lg transition-colors"
                        title="System Intelligence"
                        aria-label="System Intelligence"
                    >
                        <HistoryIcon className="h-5 w-5" />
                    </button>

                    {isPostMortemInProgress && (
                        <button
                            onClick={() => setIsLivePostMortemVisible(true)}
                            className="p-2.5 bg-zinc-800 text-zinc-300 rounded-xl animate-pulse"
                            title="Live Post-Mortem"
                            aria-label="View live post-mortem progress"
                        >
                            <EyeIcon />
                        </button>
                    )}
                </div>

            </div>
        </header >
    );
});
