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
 *   Approvals → Skills → Memory → Health
 *   what it's deciding   where it lives   whether it's sound   your call
 *
 * The playbook LIBRARY is deliberately not a tab here: StrategyStudio is the
 * one owner of that table, it has its own surface (Alt+3), and mounting it a
 * second time from here left it without the onClose the Studio surface passes —
 * which made its "Try in chat" a dead button. Memory mounts this surface's own
 * notebook browser rather than reimplementing it.
 */

import React, { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, ClipboardCheck, Gauge, Layers } from '../shared/Icons';
import type { LoggedTrade } from '../../types';
import type { ProviderConfig } from '../../types/provider';
import SupervisorStream from './SupervisorStream';
import AmendmentsInbox from './AmendmentsInbox';
import MemoryHealthCard from './MemoryHealthCard';
import PatternMemoryCard from './PatternMemoryCard';
import SkillsCatalog from './SkillsCatalog';
import MemoryTopicsCard from './MemoryTopicsCard';
import RightPanel from '../shell/RightPanel';
import { useRightPanel } from '../../hooks/useRightPanel';
import { listSkills } from '../../services/learning/SkillMemoryService';
import SkillViewerPanel, { type SkillViewerRecord } from './SkillViewerPanel';
import MemoryTopicPanel from './MemoryTopicPanel';

const MemoryFilesManager = lazy(() => import('./MemoryFilesManager'));
const HarnessLessonsBrowser = lazy(() =>
    import('../settings/HarnessLessonsBrowser').then(m => ({ default: m.HarnessLessonsBrowser })));
const LearningDashboard = lazy(() => import('../dashboards/LearningDashboard'));
const VersionHistoryDashboardLazy = lazy(() =>
    import('../dashboards/VersionHistoryDashboard').then(m => ({ default: m.VersionHistoryDashboard })));
const SessionUsagePanel = lazy(() => import('../settings/SessionUsagePanel'));
const DiagnosticsPanel = lazy(() =>
    import('../settings/DiagnosticsPanel').then(m => ({ default: m.DiagnosticsPanel })));

type LearnTab = 'coach' | 'skills' | 'memory' | 'health';

export type { LearnTab };

const TAB_KEY = 'learn_tab_v1';

/** The one dock this surface can show. The shell was built for panels; this is
 *  the first one to use it, and it opens from a SkillsCatalog row. */
const SKILL_VIEWER_DOCK = 'skill-viewer';
/** The notebook entry's detail — same shell, second dock. With both open the
 *  shell draws its capsule strip, which is what it was built for. */
const MEMORY_TOPIC_DOCK = 'memory-topic';

const TABS: Array<{ id: LearnTab; label: string; Icon: React.FC<{ className?: string }> }> = [
    // Named for the decision it holds, not the persona that explains it. It
    // holds ALL of them now — action permissions, skill drafts, proposals,
    // memory amendments — which is why it leads the row and is the default tab.
    { id: 'coach', label: 'Approvals', Icon: ClipboardCheck },
    // The library the desk learns FROM, moved here from Settings — one view for
    // everything the app believes, rather than a tab in a dialog about the app.
    { id: 'skills', label: 'Skills', Icon: Layers },
    { id: 'memory', label: 'Memory', Icon: BookOpen },
    { id: 'health', label: 'Health', Icon: Gauge },
];


const Fallback: React.FC = () => (
    <div className="p-6 text-ui-dense text-zinc-600">Loading…</div>
);

interface LearnViewProps {
    username: string;
    trades: LoggedTrade[];
    /** The global-memory switch's state, handed straight through to
     *  MemoryFilesManager — which is the ONE writer of this flag (Settings →
     *  Memory kept only a link here). Both optional so the Memory tab still
     *  mounts in tests that don't care; the switch itself only renders when the
     *  setter is supplied. */
    isGlobalMemoryEnabled?: boolean;
    setIsGlobalMemoryEnabled?: (enabled: boolean) => void;
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
    /** The skill library (Studio + trade plans + forged tools). Handed in as a
     *  node because the Studio reads the live regime and owns the strategy
     *  search, neither of which this surface has — the same reason the Coach
     *  slot is a node. */
    renderSkills?: () => React.ReactNode;
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
    /** Opens the skill-DRAFT path in the Approvals inbox. Routed rather than
     *  reimplemented: a second approval surface is the exact IA defect the
     *  2026-10-07 audit named, and `probe-skill-approval.cjs` drives the
     *  existing one byte-for-byte. */
    onAddSkill?: () => void;
    /** Settings → Skills, for the catalog's gear. */
    onOpenSkillsSettings?: () => void;
}

const LearnView: React.FC<LearnViewProps> = ({
    username, trades, isGlobalMemoryEnabled, setIsGlobalMemoryEnabled,
    memoryConfig = null, initialTab, onInitialTabConsumed,
    renderCoach, renderSkills, renderActionApprovals, coachCount = 0,
    reviewSummary = null, reviewLoading = false, onRegenerateReview,
    onAddSkill, onOpenSkillsSettings,
}) => {
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

    // ── The skill viewer panel (gap 1) ───────────────────────────────────
    // Right-panel contract: the hook owns geometry and lifecycle, the layout
    // below owns where the width lands, and the panel itself owns what a skill
    // record looks like when it is READ rather than edited.
    const rightPanel = useRightPanel({ surface: 'learn', defaultWidth: 480, minWidth: 340, maxWidth: 760 });
    const [viewerFileId, setViewerFileId] = useState<string | null>(null);

    useEffect(() => {
        // `register` is stable; the hook object changes identity on every width
        // commit, and re-announcing per drag tick is pure noise.
        rightPanel.register({ id: SKILL_VIEWER_DOCK, label: 'Skill' });
        rightPanel.register({ id: MEMORY_TOPIC_DOCK, label: 'Entry' });
    }, [rightPanel.register]);

    // Re-read the record from the store on each open: the viewer is a browser,
    // not a cache, so a skill edited in the Studio after the panel last showed
    // is current the moment it opens again.
    const viewerSkill = useMemo<SkillViewerRecord | null>(() => {
        if (!viewerFileId) return null;
        const found = listSkills().find(({ file }) => file.id === viewerFileId);
        return found ?? null;
    }, [viewerFileId]);

    // ── The memory topic detail (gaps 2 + 3) ─────────────────────────────
    const [topicFileId, setTopicFileId] = useState<string | null>(null);

    const openSkillViewer = useCallback((fileId: string): void => {
        setViewerFileId(fileId);
        rightPanel.open(SKILL_VIEWER_DOCK);
    }, [rightPanel]);

    const openMemoryTopic = useCallback((fileId: string): void => {
        setTopicFileId(fileId);
        rightPanel.open(MEMORY_TOPIC_DOCK);
    }, [rightPanel]);

    const closePanel = useCallback((id: string): void => {
        rightPanel.close(id);
    }, [rightPanel]);

    return (
        <div className="flex h-full min-h-0 flex-col bg-surface-page" data-testid="learn-view">
            <nav className="flex shrink-0 items-center gap-1.5 border-b border-zinc-800/80 bg-zinc-900/30 px-4 py-2" aria-label="Learn sections">
                <span className="mr-3 hidden text-ui-caption font-semibold tracking-[-0.01em] text-zinc-200 lg:inline">Knowledge</span>
                {TABS.map(({ id, label, Icon }) => {
                    const active = tab === id;
                    return (
                        <button key={id} type="button" onClick={() => setTab(id)}
                            aria-current={active ? 'true' : undefined} data-testid={`learn-tab-${id}`}
                            aria-label={id === 'coach' && coachCount > 0
                                ? `${label} — ${coachCount} awaiting your decision` : undefined}
                            title={id === 'coach' && coachCount > 0 ? `${coachCount} awaiting your decision` : undefined}
                            className={`flex items-center gap-1.5 rounded-control px-3 py-1.5 text-ui-sm font-medium transition-colors duration-[120ms] ease-[var(--ease-snappy)] ${
                                active
                                    ? 'bg-zinc-800 text-zinc-100 ring-1 ring-white/[0.06]'
                                    : 'text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-300'
                            }`}>
                            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                            {label}
                            {/* No count chip here. The Knowledge rail row already
                                carries the same number, and once you are inside
                                this surface the drafts are the list on screen —
                                so the tab was printing a second "12" for the
                                thing you had just navigated to read. The `title`
                                above keeps the count where it is useful: on
                                hover, in words. */}
                        </button>
                    );
                })}
            </nav>

            {/* `relative` anchors the panel's hidden (out-of-flow) state, which
                is how the shell preserves a panel's scroll offset without a
                closed one taking a column of width. */}
            <div className="relative flex min-h-0 flex-1">
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

                {tab === 'skills' && (
                    <div className="min-h-0 flex-1" data-testid="learn-skills">
                        {renderSkills ? renderSkills() : null}
                    </div>
                )}

                {tab === 'memory' && (
                    <div className="mx-auto w-full max-w-4xl space-y-3 p-3">
                        {/* The synthesis first — it is what the memory is FOR;
                            the notebook browser below holds the raw files. */}
                            <PatternMemoryCard
                                trades={trades}
                                finalSummary={reviewSummary}
                                isLoading={reviewLoading}
                                onRegenerate={onRegenerateReview}
                            />
                            {/* CONTENT before STORAGE: the topic index reads the
                                notebook the way the reference reads memory — named
                                entries with summaries — and only then does the raw
                                file manager follow. */}
                            <MemoryTopicsCard onOpenTopic={openMemoryTopic} />
                            <SkillsCatalog
                            onAddSkill={onAddSkill}
                            onOpenSettings={onOpenSkillsSettings}
                            onOpenSkill={openSkillViewer}
                        />
                        {/* The boundary wraps ONLY the lazy file manager. One
                            boundary over the whole tab made the catalog — and every
                            skill row in it — wait on a chunk nothing above it needs,
                            so the tab painted "Loading…" instead of its content. */}
                        <Suspense fallback={<Fallback />}>
                            <MemoryFilesManager
                                username={username}
                                memoryConfig={memoryConfig}
                                isGlobalMemoryEnabled={isGlobalMemoryEnabled}
                                setIsGlobalMemoryEnabled={setIsGlobalMemoryEnabled}
                            />
                        </Suspense>
                    </div>
                )}

                {tab === 'health' && (
                    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 p-3">
                        <MemoryHealthCard username={username} />
                        <div data-testid="learn-signals">
                            <Suspense fallback={<Fallback />}>
                                <LearningDashboard trades={trades} username={username} />
                            </Suspense>
                        </div>
                        <Suspense fallback={<Fallback />}>
                            <HarnessLessonsBrowser />
                        </Suspense>

                        {/* What the loop has been doing, not what it knows: the
                            supervisor's running log used to sit beside the
                            drafts, where it competed with them for attention and
                            made the inbox read like a dashboard. */}
                        <div className="flex h-[46vh] min-h-0 flex-col overflow-hidden rounded-control border border-zinc-800/80 bg-zinc-900">
                            <SupervisorStream />
                        </div>


                        {/* Runtime telemetry — the old System tab. */}
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
                    </div>
                )}

                </div>

                <RightPanel
                    presentation={rightPanel.presentation}
                    isResizing={rightPanel.isResizing}
                    width={rightPanel.width}
                    isActive={rightPanel.isOpen}
                    isHidden={!rightPanel.isOpen}
                    docks={rightPanel.docks}
                    openIds={rightPanel.openIds}
                    activeId={rightPanel.activeId}
                    onSelectDock={rightPanel.setActive}
                    onCloseDock={closePanel}
                    onResizeStart={rightPanel.startResize}
                    onResizeReset={rightPanel.resetWidth}
                    label="Learn panels"
                    testId="learn-right-panel"
                    className="border-l border-zinc-800/80 bg-zinc-900 lg:w-[var(--panel-w)]"
                >
                    {rightPanel.activeId === SKILL_VIEWER_DOCK && viewerSkill
                        ? <SkillViewerPanel skill={viewerSkill}
                            onClose={() => closePanel(SKILL_VIEWER_DOCK)} />
                        : null}
                    {rightPanel.activeId === MEMORY_TOPIC_DOCK && topicFileId
                        ? <MemoryTopicPanel fileId={topicFileId}
                            username={username}
                            memoryConfig={memoryConfig}
                            onClose={() => closePanel(MEMORY_TOPIC_DOCK)} />
                        : null}
                    {/* Neither dock selected but the shell is open (a stale id):
                        say so rather than rendering an empty box that reads as a
                        broken feature. */}
                    {rightPanel.isOpen && rightPanel.activeId !== SKILL_VIEWER_DOCK && rightPanel.activeId !== MEMORY_TOPIC_DOCK
                        ? <p className="p-4 text-ui-dense text-zinc-500">Nothing selected to read.</p>
                        : null}
                </RightPanel>
            </div>
        </div>
    );
};

export default React.memo(LearnView);
