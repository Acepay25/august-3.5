import React from 'react';
import { TradeAnalysis } from '../../types/analysis';
import { TradeOutcome } from '../../types/enums';
import { getSetupLifecycle, SetupLifecycleStage } from '../../utils/setupLifecycle';

interface SetupLifecycleCardProps {
    analysis: TradeAnalysis;
    outcome?: TradeOutcome;
    triggeredEntryIndices?: number[];
    compact?: boolean;
}

const STEPS: Array<{ stage: SetupLifecycleStage; label: string }> = [
    { stage: 'draft', label: 'Draft' },
    { stage: 'watching', label: 'Watching' },
    { stage: 'active', label: 'Active' },
    { stage: 'resolved', label: 'Resolved' },
];

const isStepComplete = (current: SetupLifecycleStage, step: SetupLifecycleStage): boolean => {
    if (current === 'expired' || current === 'skipped') return false;
    const currentIndex = STEPS.findIndex(item => item.stage === current);
    const stepIndex = STEPS.findIndex(item => item.stage === step);
    return stepIndex >= 0 && currentIndex >= stepIndex;
};

export const SetupLifecycleCard: React.FC<SetupLifecycleCardProps> = ({ analysis, outcome, triggeredEntryIndices, compact = false }) => {
    const lifecycle = getSetupLifecycle(analysis, outcome, Date.now(), triggeredEntryIndices);
    const isTerminalException = lifecycle.stage === 'expired' || lifecycle.stage === 'skipped';

    return (
        <section className={`status-surface mb-4 rounded-2xl border ${isTerminalException ? 'border-amber-500/25 bg-amber-950/15' : 'border-white/10 bg-zinc-900/70'} ${compact ? 'px-3 py-3' : 'px-4 py-4'}`} aria-label="Setup lifecycle">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Setup lifecycle</span>
                        <span className="rounded-full border border-white/10 bg-zinc-800 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-zinc-200">{lifecycle.label}</span>
                    </div>
                    <p className="mt-1 text-xs text-zinc-300">{lifecycle.summary}</p>
                </div>
                {!compact && <span className="shrink-0 text-[10px] text-zinc-500">Advisory only</span>}
            </div>

            {!isTerminalException && (
                <div className="mt-3 grid grid-cols-4 gap-1" aria-label="Lifecycle progress">
                    {STEPS.map(step => (
                        <div key={step.stage} className="min-w-0">
                            <div className={`h-1 rounded-full ${isStepComplete(lifecycle.stage, step.stage) ? 'bg-zinc-300' : 'bg-zinc-800'}`} />
                            <span className={`mt-1 block truncate text-[9px] ${isStepComplete(lifecycle.stage, step.stage) ? 'text-zinc-200' : 'text-zinc-600'}`}>{step.label}</span>
                        </div>
                    ))}
                </div>
            )}

            <div className="mt-2 text-[10px] text-zinc-500">
                <span className="font-semibold text-zinc-400">Next:</span> {lifecycle.nextAction}
                {lifecycle.expiresAt && !lifecycle.isTerminal && <span className="ml-2">Window ends {new Date(lifecycle.expiresAt).toLocaleString()}</span>}
            </div>
        </section>
    );
};

export default SetupLifecycleCard;
