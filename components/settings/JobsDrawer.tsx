import React, { useEffect, useState } from 'react';
import { Inbox, X } from 'lucide-react';
import { jobQueue, Job } from '../../services/infrastructure/JobQueueService';
import { listSkills, type SkillMeta } from '../../services/learning/SkillMemoryService';
import { EmptyState } from '../ui/EmptyState';

/**
 * JobsDrawer: a "status stack" of background work — the insight-extraction
 * jobs the queue has run or is running, plus each skill's latest automated-eval
 * verdict. Autonomy you can see.
 *
 * (The sidebar's TERMINAL tab was removed — this drawer is the only
 * surface for the job queue again.)
 *
 * Two sources, deliberately side by side: the JobQueue snapshot is work that
 * went through the queue, while the skill audits are read straight from skill
 * meta — an eval never touches the queue.
 */

const JOB_LABEL: Record<string, string> = {
    EXTRACT_INSIGHTS: 'Insight extraction',
};

const STATUS_STYLE: Record<Job['status'], string> = {
    pending: 'bg-zinc-800 text-zinc-400',
    processing: 'bg-zinc-700 text-zinc-100',
    completed: 'bg-emerald-950/60 text-emerald-400',
    failed: 'bg-rose-950/60 text-rose-400/90',
};

const VERDICT_STYLE: Record<string, string> = {
    helps: 'bg-emerald-950/60 text-emerald-400',
    hurts: 'bg-rose-950/60 text-rose-400/90',
    mixed: 'bg-zinc-800 text-zinc-300',
    inconclusive: 'bg-zinc-800 text-zinc-500',
};

const JobsDrawer: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
    const [jobs, setJobs] = useState<Job[]>([]);
    const [evaluated, setEvaluated] = useState<Array<{ name: string; meta: SkillMeta }>>([]);

    useEffect(() => {
        if (!open) return;
        const refresh = (): void => {
            setJobs(jobQueue.getJobs());
            try {
                setEvaluated(
                    listSkills()
                        .map(({ file, meta }) => ({ name: file.name.replace(/\.md$/i, ''), meta }))
                        .filter(r => r.meta.evalVerdict && r.meta.lastEvalAt)
                        .sort((a, b) => Date.parse(b.meta.lastEvalAt ?? '') - Date.parse(a.meta.lastEvalAt ?? ''))
                        .slice(0, 20),
                );
            } catch {
                setEvaluated([]);
            }
        };
        refresh();
        const unsubscribe = jobQueue.onJobComplete(() => refresh());
        return unsubscribe;
    }, [open]);

    const hasContent = jobs.length > 0 || evaluated.length > 0;

    if (!open) return null;
    return (
        <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col border-l border-white/10 bg-zinc-950 shadow-2xl shadow-black/60 animate-fade-in">
            <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-4 py-3">
                <p className="text-ui-dense font-bold uppercase tracking-widest text-zinc-400">Background jobs</p>
                <button type="button" onClick={onClose} className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 transition-colors" aria-label="Close background jobs">
                    <X className="h-3.5 w-3.5" />
                </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar px-4 py-3">
                {!hasContent && (
                    <EmptyState
                        compact
                        icon={<Inbox className="h-5 w-5" />}
                        title="Nothing running"
                        description="Learning passes (evals, doctrine, insight extraction) appear here."
                    />
                )}
                {jobs.length > 0 && (
                    <>
                        <p className="pb-2 text-ui-2xs font-bold uppercase tracking-widest text-zinc-600">Queued / recent</p>
                        <div className="space-y-2 pb-4">
                            {jobs.map(job => (
                                <div key={job.id} data-job-row className="rounded-lg border border-white/5 bg-zinc-900/70 p-2.5">
                                    <div className="flex items-center gap-2">
                                        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-zinc-200">
                                            {JOB_LABEL[job.type] ?? job.type}
                                        </span>
                                        <span className={`rounded-md px-1.5 py-0.5 text-ui-2xs font-bold uppercase tracking-wide ${STATUS_STYLE[job.status]}`}>
                                            {job.status}
                                        </span>
                                    </div>
                                    {job.result?.error && (
                                        <p className="mt-1 line-clamp-2 text-ui-xs text-rose-400/80">
                                            {String(job.result.error?.message ?? job.result.error).slice(0, 200)}
                                        </p>
                                    )}
                                </div>
                            ))}
                        </div>
                    </>
                )}
                {evaluated.length > 0 && (
                    <>
                        <p className="pb-2 text-ui-2xs font-bold uppercase tracking-widest text-zinc-600">Recent skill audits</p>
                        <div className="space-y-2">
                            {evaluated.map(({ name, meta }) => (
                                <div key={name} data-eval-row className="rounded-lg border border-white/5 bg-zinc-900/70 p-2.5">
                                    <div className="flex items-center gap-2">
                                        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-zinc-200">{name}</span>
                                        {meta.evalVerdict && (
                                            <span className={`rounded-md px-1.5 py-0.5 text-ui-2xs font-bold uppercase tracking-wide ${VERDICT_STYLE[meta.evalVerdict] ?? 'bg-zinc-800 text-zinc-400'}`}>
                                                {meta.evalVerdict}
                                            </span>
                                        )}
                                    </div>
                                    <p className="mt-0.5 text-ui-xs text-zinc-600">
                                        {[meta.evalDetail ? `${meta.evalDetail} flips` : '', meta.lastEvalAt ? new Date(meta.lastEvalAt).toLocaleString() : ''].filter(Boolean).join(' · ')}
                                    </p>
                                </div>
                            ))}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default JobsDrawer;
