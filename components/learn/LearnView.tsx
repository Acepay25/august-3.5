/**
 * Learn — one surface for everything the system knows and how it decided that
 * (WS-5.1).
 *
 * Before this, the learning UI was scattered across nine components in three
 * places: the queue in the Studio, the notebook in Settings, the supervisor in
 * the Chart AI dock, the graveyard nowhere reachable, stats on a dashboard
 * nobody opened. The information architecture here is the loop's own order:
 *
 *   Queue → Skills → Memory → Health
 *   what it's deciding   what it believes   where it lives   whether it's sound
 *
 * Chosen over a Studio tab on purpose: a tab inside Studio would still require
 * knowing that Studio is where learning hides, and the whole complaint this
 * fixes is discoverability. Alt+5 from anywhere.
 *
 * Skills and Memory mount Studio's and Settings' existing components rather
 * than reimplementing them — one owner for the skill table and the notebook
 * browser, this file only decides where they appear.
 */

import React, { lazy, Suspense, useEffect, useState } from 'react';
import { BookOpen, Gauge, ListChecks, Library } from 'lucide-react';
import type { LoggedTrade } from '../../types';
import type { ProviderConfig } from '../../types/provider';
import SupervisorStream from './SupervisorStream';
import LearningQueuePanel from '../skills/LearningQueuePanel';
import AmendmentsInbox from '../settings/AmendmentsInbox';
import MemoryHealthCard from './MemoryHealthCard';

const StrategyStudio = lazy(() => import('../dashboards/StrategyStudio'));
const MemoryFilesManager = lazy(() => import('../settings/MemoryFilesManager'));
const HarnessLessonsBrowser = lazy(() =>
    import('../settings/HarnessLessonsBrowser').then(m => ({ default: m.HarnessLessonsBrowser })));

type LearnTab = 'queue' | 'skills' | 'memory' | 'health';

const TAB_KEY = 'learn_tab_v1';

const TABS: Array<{ id: LearnTab; label: string; Icon: React.FC<{ className?: string }> }> = [
    { id: 'queue', label: 'Queue', Icon: ListChecks },
    { id: 'skills', label: 'Skills', Icon: Library },
    { id: 'memory', label: 'Memory', Icon: BookOpen },
    { id: 'health', label: 'Health', Icon: Gauge },
];

const Fallback: React.FC = () => (
    <div className="p-6 text-[11px] text-zinc-600">Loading…</div>
);

interface LearnViewProps {
    username: string;
    trades: LoggedTrade[];
    memoryConfig?: ProviderConfig | null;
    /** Current market regime from hybrid intelligence — the Studio's tilt. */
    currentRegime?: string;
}

const LearnView: React.FC<LearnViewProps> = ({ username, trades, memoryConfig = null, currentRegime }) => {
    const [tab, setTab] = useState<LearnTab>(() => {
        const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(TAB_KEY) : null;
        return TABS.some(t => t.id === saved) ? (saved as LearnTab) : 'queue';
    });

    useEffect(() => {
        try { localStorage.setItem(TAB_KEY, tab); } catch { /* private mode */ }
    }, [tab]);

    return (
        <div className="flex h-full min-h-0 flex-col bg-[#0b0b0a]" data-testid="learn-view">
            <nav className="flex shrink-0 items-center gap-1 border-b border-zinc-800/80 px-3" aria-label="Learn sections">
                {TABS.map(({ id, label, Icon }) => {
                    const active = tab === id;
                    return (
                        <button key={id} type="button" onClick={() => setTab(id)}
                            aria-current={active ? 'true' : undefined} data-testid={`learn-tab-${id}`}
                            className={`-mb-px flex items-center gap-1.5 border-b-2 px-2.5 py-2.5 text-[12px] font-semibold transition-colors duration-[120ms] ${
                                active
                                    ? 'border-zinc-100 text-zinc-100'
                                    : 'border-transparent text-zinc-500 hover:text-zinc-300'
                            }`}>
                            <Icon className="h-3.5 w-3.5" />
                            {label}
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

                {tab === 'skills' && (
                    <Suspense fallback={<Fallback />}>
                        <StrategyStudio trades={trades} username={username}
                            currentRegime={currentRegime} memoryConfig={memoryConfig} />
                    </Suspense>
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
                        <Suspense fallback={<Fallback />}>
                            <HarnessLessonsBrowser />
                        </Suspense>
                    </div>
                )}
            </div>
        </div>
    );
};

export default React.memo(LearnView);
