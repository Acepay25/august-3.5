import React, { useEffect, useState } from 'react';
import { Inbox, X } from '../shared/Icons';
import { listSkills, type SkillMeta } from '../../services/learning/SkillMemoryService';
import { EmptyState } from '../ui/EmptyState';

/**
 * Activity drawer: the app's autonomous work in one place — each skill's latest
 * detached-eval verdict. Scheduled automations were removed on 2026-10-24; the
 * header's Activity button is the drawer's only opener, at every breakpoint.
 *
 * It used to show a third source: the background job queue's insight-extraction
 * runs. The post-mortem that enqueued them is deleted, so the queue had no
 * producer left and its section went with it.
 */

const VERDICT_STYLE: Record<string, string> = {
    helps: 'bg-emerald-950/60 text-emerald-400',
    hurts: 'bg-rose-950/60 text-rose-400/90',
    mixed: 'bg-zinc-800 text-zinc-300',
    inconclusive: 'bg-zinc-800 text-zinc-500',
};

interface ActivityDrawerProps {
    open: boolean;
    onClose: () => void;
}

const JobsDrawer: React.FC<ActivityDrawerProps> = ({
    open,
    onClose,
}) => {
    const [evaluated, setEvaluated] = useState<Array<{ name: string; meta: SkillMeta }>>([]);

    useEffect(() => {
        if (!open) return;
        const refresh = (): void => {
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
    }, [open]);

    const hasContent = evaluated.length > 0;

    if (!open) return null;
    return (
        <div id="activity-drawer" data-testid="activity-drawer" className="fixed inset-y-0 right-0 z-drawer flex w-full max-w-sm flex-col border-l border-white/10 bg-zinc-950 shadow-2xl shadow-black/60 animate-fade-in">
            <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-4 py-3">
                <p className="text-ui-dense font-bold uppercase tracking-widest text-zinc-400">Activity</p>
                <button type="button" onClick={onClose} className="rounded-control p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 transition-colors" aria-label="Close activity">
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar px-4 py-3">
                {!hasContent && (
                    <EmptyState
                        compact
                        icon={<Inbox className="h-5 w-5" aria-hidden="true" />}
                        title="Nothing running"
                        description="Detached skill evaluations appear here."
                    />
                )}
                {evaluated.length > 0 && (
                    <>
                        <p className="pb-2 text-ui-2xs font-bold uppercase tracking-widest text-zinc-600">Recent skill audits</p>
                        <div className="space-y-2">
                            {evaluated.map(({ name, meta }) => (
                                <div key={name} data-eval-row className="rounded-control border border-white/5 bg-zinc-900/70 p-2.5">
                                    <div className="flex items-center gap-2">
                                        <span className="min-w-0 flex-1 truncate text-ui-sm font-semibold text-zinc-200" title={name}>{name}</span>
                                        {meta.evalVerdict && (
                                            <span className={`rounded-control px-1.5 py-0.5 text-ui-2xs font-bold uppercase tracking-wide ${VERDICT_STYLE[meta.evalVerdict] ?? 'bg-zinc-800 text-zinc-400'}`}>
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
