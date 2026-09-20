
import React, { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { BrainCircuit } from 'lucide-react';
import { LoggedTrade, TradeOutcome } from '../../types';
import { computeLearningProfile } from '../../services/learning/SelfLearningService';
import { initMemoryFiles, getMemoryFiles, computeTopLessons } from '../../services/learning/MemoryFilesService';
import { listSkills, reviewSkillEffectiveness, applyReviewRecommendation, refineSkillNow } from '../../services/learning/SkillMemoryService';
import { computeAllSkillLifts } from '../../services/learning/MemoryProvenanceService';
import { getRecentMemoryInjections, type MemoryInjectionRecord } from '../../services/learning/MemoryInjectionService';
import { useToastActions } from '../shared/Toast';
import { getActiveUsername } from '../../utils/activeUser';
import { EmptyState } from '../ui/EmptyState';
import { HarnessSection } from './learning/HarnessSection';
import { LessonsSection } from './learning/LessonsSection';
import { MemoryGraphSection } from './learning/MemoryGraphSection';
import { ProfileHeader } from './learning/ProfileHeader';
import { ReviewActionsSection } from './learning/ReviewActionsSection';
import { TraderProfileCards } from './learning/TraderProfileCards';
import { CalibrationSection } from './learning/CalibrationSection';
import type { Notebook } from './learning/shared';

interface LearningDashboardProps {
    trades: LoggedTrade[];
    /** Active user — loads the right Trader Notebook files. */
    username?: string;
}

const isClosed = (t: LoggedTrade): boolean => t.outcome === TradeOutcome.WIN || t.outcome === TradeOutcome.LOSS;

/**
 * The learning profile — every number here is a read of a store the loop
 * already writes. Data loading and the notebook refresh live in this
 * component; each card under ./learning takes what it renders and owns its
 * own filters.
 */
export const LearningDashboard: React.FC<LearningDashboardProps> = ({ trades, username }) => {
    const profile = useMemo(() => computeLearningProfile(trades), [trades]);

    // Trader Notebook — the markdown memory files the harness writes and the
    // model reads (diary entries, recurring mistakes, profile memory, AI notes).
    const [notebook, setNotebook] = useState<Notebook>({ folders: [], files: [] });
    const [notebookVersion, bumpNotebook] = useReducer((n: number) => n + 1, 0);
    const toast = useToastActions();
    const [applyingFileId, setApplyingFileId] = useState<string | null>(null);
    useEffect(() => {
        let cancelled = false;
        const user = username || getActiveUsername();
        initMemoryFiles(user).then(() => {
            if (cancelled) return;
            const { folders, files } = getMemoryFiles();
            setNotebook({ folders, files });
        });
        return () => { cancelled = true; };
    }, [username, notebookVersion]);

    /** Apply a review recommendation from the UI, then refresh the notebook. */
    const handleApplyRecommendation = useCallback(async (
        fileId: string,
        fileName: string,
        recommendation: 'promote' | 'demote' | 'retire',
    ) => {
        const user = username || getActiveUsername();
        setApplyingFileId(fileId);
        try {
            const ok = await applyReviewRecommendation(fileId, recommendation, user);
            if (ok) {
                toast.success(`Skill ${recommendation}d`, fileName.replace(/\.md$/i, ''));
                bumpNotebook();
            }
        } finally {
            setApplyingFileId(null);
        }
    }, [username, toast]);

    /** Run the on-demand refine pass for a 'refine' row.
     *  Only toast success when the skill actually changed. */
    const handleRefineSkill = useCallback(async (fileId: string, fileName: string) => {
        const user = username || getActiveUsername();
        setApplyingFileId(fileId);
        try {
            const changed = await refineSkillNow(fileId, trades, user);
            if (changed) {
                toast.success('Skill refined', fileName.replace(/\.md$/i, ''));
                bumpNotebook();
            } else {
                toast.warning?.('Nothing to refine', 'No provider was available, or the skill is already tight.');
            }
        } catch {
            toast.warning?.('Refine failed', 'The skill was left unchanged.');
        } finally {
            setApplyingFileId(null);
        }
    }, [username, toast, trades]);

    // Outcome-weighted clusters — losses first (fix list), then wins (repeat list).
    const topLessons = useMemo(() => computeTopLessons(trades, 6), [trades]);

    // ─── Harness accuracy (②): the similar-setup pool itself ───────────────
    // Time window on the top metrics so stale early-period data never
    // masquerades as current accuracy. The window is shared: it gates the
    // harness cards AND the trades behind each lesson.
    const [windowDays, setWindowDays] = useState<0 | 30 | 90>(0);
    const windowedTrades = useMemo(() => {
        if (windowDays === 0) return trades;
        const cutoff = Date.now() - windowDays * 86_400_000;
        return trades.filter(t => new Date(t.timestamp).getTime() >= cutoff);
    }, [trades, windowDays]);

    const closedWindowed = useMemo(() => windowedTrades.filter(isClosed), [windowedTrades]);

    const notebookSkills = useMemo(() => listSkills(), [notebook]);
    // What retrieval ACTUALLY injected (MemoryInjectionService) — drives the
    // "Learned Skills" list, the review caveat, and precise lift windows.
    const [injections, setInjections] = useState<MemoryInjectionRecord[]>([]);
    useEffect(() => {
        let cancelled = false;
        const user = username || getActiveUsername();
        getRecentMemoryInjections(user).then(recs => {
            if (!cancelled) setInjections(recs);
        });
        return () => { cancelled = true; };
    }, [username, notebook]);
    const injectedSkillFiles = useMemo(() => {
        const names = new Set<string>();
        for (const rec of injections) {
            for (const src of rec.sources) {
                if (src.path.startsWith('skills/')) names.add(src.path.slice('skills/'.length));
            }
        }
        return names;
    }, [injections]);
    const skillLifts = useMemo(() => computeAllSkillLifts(trades, injections), [trades, injections]);
    const liftByFileId = useMemo(() =>
        Object.fromEntries(skillLifts.map(l => [l.fileId, l])), [skillLifts]);
    const skillReview = useMemo(
        () => reviewSkillEffectiveness({ liftByFileId, injectedFileNames: injectedSkillFiles }),
        [notebook, liftByFileId, injectedSkillFiles],
    );

    const memoryGraphSection = (
        <MemoryGraphSection
            notebook={notebook}
            closedWindowed={closedWindowed}
            notebookSkills={notebookSkills}
            injectedSkillFiles={injectedSkillFiles}
        />
    );
    const harnessSection = (
        <HarnessSection
            closedWindowed={closedWindowed}
            windowDays={windowDays}
            onWindowDaysChange={setWindowDays}
        />
    );
    const lessonsSection = <LessonsSection topLessons={topLessons} closedWindowed={closedWindowed} />;
    const reviewActionsSection = (
        <ReviewActionsSection
            skillReview={skillReview}
            applyingFileId={applyingFileId}
            onApply={handleApplyRecommendation}
            onRefine={handleRefineSkill}
        />
    );

    if (profile.totalAnalyzedTrades < 3) {
        return (
            <div className="space-y-4 p-3 sm:p-4 overflow-y-auto custom-scrollbar">
                {memoryGraphSection}
                {harnessSection}
                {lessonsSection}
                {reviewActionsSection}
                <EmptyState
                    icon={<BrainCircuit className="w-8 h-8" />}
                    title="Building Your Profile"
                    description={`Log at least 3 trades (WIN or LOSS) to start seeing personalized AI learnings. Current: ${profile.totalAnalyzedTrades} / 3 trades.`}
                    className="h-64"
                />
            </div>
        );
    }

    return (
        <div className="space-y-4 sm:space-y-6 p-3 sm:p-4 overflow-y-auto custom-scrollbar">
            {memoryGraphSection}
            {harnessSection}
            {lessonsSection}
            {reviewActionsSection}
            <ProfileHeader profile={profile} username={username} />
            <TraderProfileCards
                trades={trades}
                closedWindowed={closedWindowed}
                notebook={notebook}
                username={username}
                profile={profile}
                notebookSkills={notebookSkills}
                skillReview={skillReview}
                skillLifts={skillLifts}
            />
            <CalibrationSection profile={profile} />
        </div>
    );
};

export default LearningDashboard;
