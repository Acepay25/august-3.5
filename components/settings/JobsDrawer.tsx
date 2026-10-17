import React, { useEffect, useState } from 'react';
import { Inbox, Plus, X } from '../shared/Icons';
import { listSkills, type SkillMeta } from '../../services/learning/SkillMemoryService';
import { EmptyState } from '../ui/EmptyState';
import type { AutomationConfig } from '../../types/automation';
import { humanizeCron } from '../../services/automation/cronParser';

/**
 * Activity drawer: the app's autonomous work in one place — each skill's latest
 * automated-eval verdict, and the scheduled automations with their card feeds.
 * The rail's AUTOMATIONS section landed here (stage 3): one drawer owns "things
 * the app does on its own", and the header's Activity button is its only
 * opener, at every breakpoint.
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
    automations?: AutomationConfig[];
    onOpenAutomation?: (id: string | null) => void;
    onCreateAutomation?: () => void;
}

const JobsDrawer: React.FC<ActivityDrawerProps> = ({
    open,
    onClose,
    automations = [],
    onOpenAutomation,
    onCreateAutomation,
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

    const hasContent =
        evaluated.length > 0 || automations.length > 0 || !!onCreateAutomation;

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
                        description="Learning passes, evals and scheduled automations appear here."
                    />
                )}
                {onCreateAutomation && (
                    <>
                        <div className="flex items-center justify-between pb-2">
                            <p className="text-ui-2xs font-bold uppercase tracking-widest text-zinc-600">Automations</p>
                            <button
                                type="button"
                                data-testid="activity-automation-new"
                                onClick={onCreateAutomation}
                                className="inline-flex items-center gap-1 rounded-control px-1.5 py-0.5 text-ui-xs text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-200"
                                title="New automation"
                                aria-label="New automation"
                            >
                                <Plus className="h-3 w-3" aria-hidden="true" />
                                New
                            </button>
                        </div>
                        <div className="space-y-2 pb-4">
                            {automations.length === 0 ? (
                                <p className="rounded-control border border-white/5 bg-zinc-900/70 p-2.5 text-ui-xs leading-5 text-zinc-500">
                                    No automations yet. Schedule an analysis to run itself.
                                </p>
                            ) : (
                                automations.map(a => (
                                    <button
                                        key={a.id}
                                        type="button"
                                        data-testid="activity-automation-row"
                                        onClick={() => onOpenAutomation?.(a.id)}
                                        className="flex w-full items-center gap-2 rounded-control border border-white/5 bg-zinc-900/70 p-2.5 text-left transition-colors hover:bg-zinc-900"
                                    >
                                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${a.enabled ? 'bg-emerald-400' : 'bg-zinc-700'}`} />
                                        <span className="min-w-0 flex-1 truncate text-ui-sm font-semibold text-zinc-200" title={a.name}>{a.name}</span>
                                        <span className="shrink-0 text-ui-2xs text-zinc-600">{humanizeCron(a.schedule.cron)}</span>
                                    </button>
                                ))
                            )}
                        </div>
                    </>
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
