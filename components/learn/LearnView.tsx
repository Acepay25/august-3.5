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
import { BookOpen, ClipboardCheck, Gauge } from '../shared/Icons';
import type { LoggedTrade } from '../../types';
import type { ProviderConfig } from '../../types/provider';
import SupervisorStream from './SupervisorStream';
import AmendmentsInbox from './AmendmentsInbox';
import { useViewDensity } from '../shell/StatusBar';
import MemoryHealthCard from './MemoryHealthCard';
import PatternMemoryCard from './PatternMemoryCard';

const MemoryFilesManager = lazy(() => import('./MemoryFilesManager'));
const HarnessLessonsBrowser = lazy(() =>
    import('../settings/HarnessLessonsBrowser').then(m => ({ default: m.HarnessLessonsBrowser })));
const LearningDashboard = lazy(() => import('../dashboards/LearningDashboard'));
const VersionHistoryDashboardLazy = lazy(() =>
    import('../dashboards/VersionHistoryDashboard').then(m => ({ default: m.VersionHistoryDashboard })));
const SessionUsagePanel = lazy(() => import('../settings/SessionUsagePanel'));
const DiagnosticsPanel = lazy(() =>
    import('../settings/DiagnosticsPanel').then(m => ({ default: m.DiagnosticsPanel })));

type LearnTab = 'coach' | 'memory' | 'health';

export type { LearnTab };

const TAB_KEY = 'learn_tab_v1';

const TABS: Array<{ id: LearnTab; label: string; Icon: React.FC<{ className?: string }> }> = [
    // Named for the decision it holds, not the persona that explains it. It
    // holds ALL of them now — action permissions, skill drafts, proposals,
    // memory amendments — which is why it leads the row and is the default tab.
    { id: 'coach', label: 'Approvals', Icon: ClipboardCheck },
    { id: 'memory', label: 'Memory', Icon: BookOpen },
    { id: 'health', label: 'Health', Icon: Gauge },
];


const Fallback: React.FC = () => (
    <div className="p-6 text-ui-dense text-zinc-600">Loading…</div>
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
    /** The autopilot's pending permission requests (log / replace / re-validate a
     *  trade). These used to live in a drawer the nav rail opened, which made two
     *  approval surfaces for two kinds of decision; they are handed in here so a
     *  press that changes what the app does sits beside the presses that change
     *  what it believes. */
    renderActionApprovals?: () => React.ReactNode;
    /** Decisions waiting, shown as the Coach tab's badge. */
    coachCount?: number;
    /** The journal review's pattern synthesis — moved out of the Journal's
     *  trade log (2026-10-07). App supplies the review text, its loading flag
     *  and the regenerate handler; without them the card still reads the
     *  notebook file, minus the regenerate affordance. */
    reviewSummary?: string | null;
    reviewLoading?: boolean;
    onRegenerateReview?: () => void;
}

const LearnView: React.FC<LearnViewProps> = ({
    username, trades, memoryConfig = null, initialTab, onInitialTabConsumed,
    renderCoach, renderActionApprovals, coachCount = 0,
    reviewSummary = null, reviewLoading = false, onRegenerateReview,
}) => {
    const { density, setDensity } = useViewDensity();
    const [tab, setTab] = useState<LearnTab>(() => {
        const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(TAB_KEY) : null;
        // A pending decision is the reason to open this surface, so the tab that
        // holds them is the default — and a stored id from before the merge
        // ('queue', 'system') falls through the TABS check to here.
        return TABS.some(t => t.id === saved) ? (saved as LearnTab) : 'coach';
    });

    useEffect(() => {
        if (!initialTab) return;
        setTab(initialTab);
        onInitialTabConsumed?.();
    }, [initialTab, onInitialTabConsumed]);

    useEffect(() => {
        try { localStorage.setItem(TAB_KEY, tab); } catch { /* private mode */ }
    }, [tab]);

    return (
        <div className="flex h-full min-h-0 flex-col bg-surface-page" data-testid="learn-view">
            <nav className="flex shrink-0 items-center gap-1 border-b border-zinc-800/80 px-3" aria-label="Learn sections">
                {TABS.map(({ id, label, Icon }) => {
                    const active = tab === id;
                    return (
                        <button key={id} type="button" onClick={() => setTab(id)}
                            aria-current={active ? 'true' : undefined} data-testid={`learn-tab-${id}`}
                            title={id === 'coach' && coachCount > 0 ? `${coachCount} awaiting your decision` : undefined}
                            className={`-mb-px flex items-center gap-1.5 border-b-2 px-2.5 py-2.5 text-ui-sm font-semibold transition-colors duration-[120ms] ease-[var(--ease-snappy)] ${
                                active
                                    ? 'border-zinc-100 text-zinc-100'
                                    : 'border-transparent text-zinc-500 hover:text-zinc-300'
                            }`}>
                            <Icon className="h-3.5 w-3.5" />
                            {label}
                            {id === 'coach' && coachCount > 0 && (
                                <span className="rounded-full bg-amber-500 px-1.5 font-mono text-ui-2xs font-bold leading-[14px] text-zinc-950">
                                    {coachCount > 99 ? '99+' : coachCount}
                                </span>
                            )}
                        </button>
                    );
                })}
            </nav>

            <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar">
                {/* Approvals — every decision waiting on you, in one column,
                    ordered by what a press costs: first a live action the
                    autopilot wants permission to take, then the skill drafts
                    and proposals that change what the harness believes, then
                    the memory amendments. Nothing else in the app can change a
                    belief, which is the point of putting them on one screen. */}
                {tab === 'coach' && (
                    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 p-3">
                        {renderActionApprovals
                            ? <div data-testid="learn-actions">{renderActionApprovals()}</div>
                            : null}
                        {renderCoach
                            ? <div data-testid="learn-coach">{renderCoach()}</div>
                            : null}
                        <AmendmentsInbox />
                    </div>
                )}

                {tab === 'memory' && (
                    <Suspense fallback={<Fallback />}>
                        <div className="mx-auto w-full max-w-4xl space-y-3 p-3">
                            {/* The synthesis first — it is what the memory is FOR;
                                the notebook browser below holds the raw files. */}
                            <PatternMemoryCard
                                trades={trades}
                                finalSummary={reviewSummary}
                                isLoading={reviewLoading}
                                onRegenerate={onRegenerateReview}
                            />
                            <MemoryFilesManager username={username} memoryConfig={memoryConfig} />
                        </div>
                    </Suspense>
                )}

                {tab === 'health' && (
                    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 p-3">
                        <MemoryHealthCard username={username} />
                        {density === 'detail' ? (
                            <div data-testid="learn-signals">
                                <Suspense fallback={<Fallback />}>
                                    <LearningDashboard trades={trades} username={username} />
                                </Suspense>
                            </div>
                        ) : null}
                        {density === 'detail' ? (
                            <Suspense fallback={<Fallback />}>
                                <HarnessLessonsBrowser />
                            </Suspense>
                        ) : null}

                        {/* What the loop has been doing, not what it knows: the
                            supervisor's running log used to sit beside the
                            drafts, where it competed with them for attention and
                            made the inbox read like a dashboard. */}
                        <div className="flex h-[46vh] min-h-0 flex-col overflow-hidden rounded-control border border-zinc-800/80 bg-zinc-900">
                            <SupervisorStream />
                        </div>


                        {/* Runtime telemetry — the old System tab. Focus rests all
                            three together (that is what a whole-view preset means:
                            one decision, not six toggles) and says what is resting,
                            so the shorter screen never reads as "the health data
                            disappeared". Nothing here is deleted. */}
                        {density === 'detail' ? (
                            <div className="flex flex-col gap-3" data-testid="learn-system">
                                <Suspense fallback={<Fallback />}>
                                    <VersionHistoryDashboardLazy />
                                </Suspense>
                                <Suspense fallback={<Fallback />}>
                                    <SessionUsagePanel />
                                </Suspense>
                                <Suspense fallback={<Fallback />}>
                                    <DiagnosticsPanel />
                                </Suspense>
                            </div>
                        ) : (
                            <div className="flex flex-wrap items-center gap-2 rounded-control border border-zinc-800/80 bg-zinc-900 px-3 py-2.5" data-testid="learn-resting">
                                <p className="text-ui-dense text-zinc-500">
                                    Learning analytics, the lesson browser and the runtime telemetry are resting.
                                </p>
                                <button
                                    type="button"
                                    onClick={() => setDensity('detail')}
                                    data-testid="learn-show-detail"
                                    className="ml-auto inline-flex min-h-6 items-center rounded-control border border-white/10 px-2.5 py-1 text-ui-dense font-semibold text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white"
                                >
                                    Show Detail
                                </button>
                            </div>
                        )}
                    </div>
                )}

            </div>
        </div>
    );
};

export default React.memo(LearnView);
