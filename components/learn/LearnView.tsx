/**
 * Learn — one surface for everything the system knows and how it decided that
 * (WS-5.1).
 *
 * Before this, the learning UI was scattered across nine components in three
 * places: the queue in the Studio, the notebook in Settings, the supervisor in
 * the Chart AI dock, the graveyard nowhere reachable, and the Coach inbox on a
 * Chat | Coach switch inside the dock. The information architecture here is the
 * loop's own order:
 *
 *   Queue → Memory → Health → Coach
 *   what it's deciding   where it lives   whether it's sound   your call
 *
 * The playbook LIBRARY is deliberately not a tab here: StrategyStudio is the
 * one owner of that table, it has its own surface (Alt+3), and mounting it a
 * second time from here left it without the onClose the Studio surface passes —
 * which made its "Try in chat" a dead button. Memory mounts this surface's own
 * notebook browser rather than reimplementing it.
 */

import React, { lazy, Suspense, useEffect, useState } from 'react';
import { BookOpen, ClipboardCheck, Gauge, ListChecks } from 'lucide-react';
import type { LoggedTrade } from '../../types';
import type { ProviderConfig } from '../../types/provider';
import SupervisorStream from './SupervisorStream';
import LearningQueuePanel from '../skills/LearningQueuePanel';
import AmendmentsInbox from './AmendmentsInbox';
import MemoryHealthCard from './MemoryHealthCard';

const MemoryFilesManager = lazy(() => import('./MemoryFilesManager'));
const HarnessLessonsBrowser = lazy(() =>
    import('../settings/HarnessLessonsBrowser').then(m => ({ default: m.HarnessLessonsBrowser })));
const LearningDashboard = lazy(() => import('../dashboards/LearningDashboard'));

type LearnTab = 'queue' | 'memory' | 'health' | 'coach';

export type { LearnTab };

const TAB_KEY = 'learn_tab_v1';

const TABS: Array<{ id: LearnTab; label: string; Icon: React.FC<{ className?: string }> }> = [
    { id: 'queue', label: 'Queue', Icon: ListChecks },
    { id: 'memory', label: 'Memory', Icon: BookOpen },
    { id: 'health', label: 'Health', Icon: Gauge },
    { id: 'coach', label: 'Coach', Icon: ClipboardCheck },
];

const Fallback: React.FC = () => (
    <div className="p-6 text-[11px] text-zinc-600">Loading…</div>
);

interface LearnViewProps {
    username: string;
    trades: LoggedTrade[];
    memoryConfig?: ProviderConfig | null;
    /** Set by a caller that wants a SPECIFIC tab (Settings → "open the
     *  notebook"). Cleared by onInitialTabConsumed once applied — same contract
     *  the Journal uses for its deep link — so a later mount honours the user's
     *  own last tab instead of re-firing a stale link. */
    initialTab?: LearnTab | null;
    onInitialTabConsumed?: () => void;
    /** The Coach inbox — the learning loop's decision queue, merged in from the
     *  Chart AI dock. App renders the panel (it owns the allow/deny handlers);
     *  this surface only hosts the slot, and shows no Coach tab at all without
     *  it. */
    renderCoach?: () => React.ReactNode;
    /** Decisions waiting, shown as the Coach tab's badge. */
    coachCount?: number;
}

const LearnView: React.FC<LearnViewProps> = ({
    username, trades, memoryConfig = null, initialTab, onInitialTabConsumed,
    renderCoach, coachCount = 0,
}) => {
    const showCoach = !!renderCoach;
    const tabs = showCoach ? TABS : TABS.filter(t => t.id !== 'coach');
    const [tab, setTab] = useState<LearnTab>(() => {
        const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(TAB_KEY) : null;
        return TABS.some(t => t.id === saved) ? (saved as LearnTab) : 'queue';
    });

    // A stored 'coach' choice must not leave the surface on an invisible tab —
    // the Coach tab only exists while App hands in the panel.
    useEffect(() => {
        if (!showCoach && tab === 'coach') setTab('queue');
    }, [showCoach, tab]);

    useEffect(() => {
        if (!initialTab) return;
        setTab(initialTab);
        onInitialTabConsumed?.();
    }, [initialTab, onInitialTabConsumed]);

    useEffect(() => {
        try { localStorage.setItem(TAB_KEY, tab); } catch { /* private mode */ }
    }, [tab]);

    return (
        <div className="flex h-full min-h-0 flex-col bg-[#0b0b0a]" data-testid="learn-view">
            <nav className="flex shrink-0 items-center gap-1 border-b border-zinc-800/80 px-3" aria-label="Learn sections">
                {tabs.map(({ id, label, Icon }) => {
                    const active = tab === id;
                    return (
                        <button key={id} type="button" onClick={() => setTab(id)}
                            aria-current={active ? 'true' : undefined} data-testid={`learn-tab-${id}`}
                            title={id === 'coach' && coachCount > 0 ? `${coachCount} awaiting your decision` : undefined}
                            className={`-mb-px flex items-center gap-1.5 border-b-2 px-2.5 py-2.5 text-[12px] font-semibold transition-colors duration-[120ms] ease-[var(--ease-snappy)] ${
                                active
                                    ? 'border-zinc-100 text-zinc-100'
                                    : 'border-transparent text-zinc-500 hover:text-zinc-300'
                            }`}>
                            <Icon className="h-3.5 w-3.5" />
                            {label}
                            {id === 'coach' && coachCount > 0 && (
                                <span className="rounded-full bg-amber-500 px-1.5 font-mono text-[9px] font-bold leading-[14px] text-zinc-950">
                                    {coachCount > 99 ? '99+' : coachCount}
                                </span>
                            )}
                        </button>
                    );
                })}
            </nav>

            <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar">
                {tab === 'queue' && (
                    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 p-3">
                        <div className="flex h-[46vh] min-h-0 flex-col overflow-hidden rounded-control border border-zinc-800/80 bg-zinc-900">
                            <SupervisorStream />
                        </div>
                        <LearningQueuePanel />
                        <AmendmentsInbox />
                    </div>
                )}

                {tab === 'memory' && (
                    <Suspense fallback={<Fallback />}>
                        <div className="mx-auto w-full max-w-4xl p-3">
                            <MemoryFilesManager username={username} memoryConfig={memoryConfig} />
                        </div>
                    </Suspense>
                )}

                {tab === 'health' && (
                    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 p-3">
                        <MemoryHealthCard username={username} />
                        {/* WS-5.1: this is the learning analytics that used to
                            live on a SECOND surface also called "Learn", tucked
                            into the Journal. One surface now. */}
                        <div data-testid="learn-signals">
                            <Suspense fallback={<Fallback />}>
                                <LearningDashboard trades={trades} username={username} />
                            </Suspense>
                        </div>
                        <Suspense fallback={<Fallback />}>
                            <HarnessLessonsBrowser />
                        </Suspense>
                    </div>
                )}

                {/* The Coach inbox — App owns the allow/deny handlers and hands
                    the panel in; it brings its own max-width column. */}
                {tab === 'coach' && renderCoach && (
                    <div data-testid="learn-coach">{renderCoach()}</div>
                )}
            </div>
        </div>
    );
};

export default React.memo(LearnView);
