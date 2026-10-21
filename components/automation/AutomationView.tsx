import React from 'react';
import { AutomationConfig, AutomationRun } from '../../types/automation';
import {ChevronLeftIcon, TrashIcon, EditIcon, LoadingIcon, RefreshIcon, Bookmark, Play} from '../shared/Icons';
import { EmptyState } from '../ui/EmptyState';
import StatusPill from '../ui/StatusPill';
import AutomationRunCard, { RunOutcomeConfirm } from './AutomationRunCard';
import { ToggleSwitch } from '../shared/ToggleSwitch';
import { getNextRunAt } from '../../services/automation/AutomationService';
import { humanizeCron } from '../../services/automation/cronParser';
import { phtClock } from '../../utils/timezone';


/**
 * Automation detail view — a card feed of everything this automation has
 * generated (like a chat thread, but isolated from the main conversation).
 * Has a Back button to return to the sidebar, plus Run now / Edit / Delete
 * and the enable toggle.
 */
const AutomationView: React.FC<{
    config: AutomationConfig;
    runs: AutomationRun[];
    isLoadingRuns: boolean;
    isRunning: boolean;
    onBack: () => void;
    onEdit: () => void;
    onDelete: () => void;
    onRunNow: () => void;
    onToggleEnabled: () => void;
    onPauseUntil?: (untilMs: number) => void;
    onRefresh: () => void;
    modelIdToName: Record<string, string>;
    onConfirmOutcome?: (run: AutomationRun, outcome: RunOutcomeConfirm) => void;
}> = ({ config, runs, isLoadingRuns, isRunning, onBack, onEdit, onDelete, onRunNow, onToggleEnabled, onPauseUntil, onRefresh, modelIdToName, onConfirmOutcome }) => {
    return (
        <div className="flex flex-col h-full bg-zinc-950">
            {/* Header — Back returns to the sidebar view */}
            <div className="px-4 py-2.5 border-b border-white/5 bg-zinc-900 shrink-0 flex items-center justify-between gap-3 flex-wrap">
                <button
                    onClick={onBack}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-control text-ui-sm font-bold text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/10 transition-colors"
                    aria-label="Back to automations"
                >
                    <ChevronLeftIcon className="w-3.5 h-3.5" aria-hidden="true" /> Back
                </button>
                <div className="flex items-center gap-2.5 min-w-0">
                    <span className="w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_6px_#22d3ee66]" />
                    <h3 className="text-ui-base font-bold text-white truncate" title={config.name}>{config.name}</h3>
                    <span className="text-ui-xs font-mono text-zinc-500 hidden sm:inline">{humanizeCron(config.schedule.cron)}</span>
                    {config.enabled && (() => {
                        const next = getNextRunAt(config);
                        const paused = config.pauseUntil && config.pauseUntil > Date.now();
                        return next ? (
                            <span className="text-ui-xs text-zinc-500">
                                {paused ? 'Paused until ' : 'Next '}
                                {phtClock(paused ? config.pauseUntil! : next)}
                            </span>
                        ) : null;
                    })()}
                    <StatusPill tone={config.enabled ? 'up' : 'neutral'} kicker>
                        {config.enabled ? 'On' : 'Off'}
                    </StatusPill>
                </div>
            </div>

            {/* Controls */}
            <div className="px-4 py-2.5 border-b border-white/5 bg-zinc-900/60 shrink-0 flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap text-ui-xs text-zinc-500 font-mono">
                    <span>·</span>
                    <span>Runs: <span className="text-zinc-300">{config.runCount}</span></span>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    <button
                        onClick={onRunNow}
                        disabled={isRunning || !config.enabled}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-control bg-cyan-600 hover:bg-cyan-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-ui-xs font-bold uppercase tracking-widest transition-colors"
                        title={config.enabled ? 'Run this automation now' : 'Enable the automation first'}
                    >
                        {isRunning ? <LoadingIcon className="w-3 h-3 animate-spin" aria-hidden="true" /> : <Play className="w-3 h-3" aria-hidden="true" />}
                        {isRunning ? 'Running…' : 'Run now'}
                    </button>
                    {onPauseUntil && (
                        <button
                            type="button"
                            onClick={() => onPauseUntil(Date.now() + 8 * 60 * 60 * 1000)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-control border border-white/10 text-zinc-300 hover:text-white hover:border-white/25 text-ui-xs font-bold uppercase tracking-widest transition-colors"
                        >
                            Pause 8h
                        </button>
                    )}
                    <button
                        onClick={onRefresh}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-control border border-white/10 text-zinc-300 hover:text-white hover:border-white/25 text-ui-xs font-bold uppercase tracking-widest transition-colors"
                        title="Refresh runs"
                        aria-label="Refresh runs"
                    >
                        <RefreshIcon className="w-3 h-3" aria-hidden="true" /> Refresh
                    </button>
                    <button
                        onClick={onEdit}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-control border border-white/10 text-zinc-300 hover:text-white hover:border-white/25 text-ui-xs font-bold uppercase tracking-widest transition-colors"
                    >
                        <EditIcon className="w-3 h-3" aria-hidden="true" /> Edit
                    </button>
                    <button
                        onClick={onDelete}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-control border border-rose-500/30 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 text-ui-xs font-bold uppercase tracking-widest transition-colors"
                    >
                        <TrashIcon className="w-3 h-3" aria-hidden="true" /> Delete
                    </button>
                    <div className="flex items-center gap-2 pl-2 border-l border-white/10">
                        <span className="text-ui-2xs font-bold uppercase tracking-widest text-zinc-500">Scheduled</span>
                        <ToggleSwitch checked={config.enabled} onChange={onToggleEnabled} label="Toggle automation" />
                    </div>
                </div>
            </div>

            {/* The breaker's own words, on the schedule's own surface and not in
                a tooltip: a schedule that turned ITSELF off after producing
                nothing must not look like one the trader merely switched off. */}
            {!config.enabled && config.disabledReason && (
                <div className="px-4 py-2.5 border-b border-white/5 bg-rose-500/[0.07] shrink-0" data-testid="automation-disabled-reason">
                    <p className="text-ui-2xs font-bold uppercase tracking-widest text-rose-400">Turned off after runs that produced nothing</p>
                    <p className="mt-1 text-ui-sm leading-relaxed text-rose-200/85">{config.disabledReason}</p>
                </div>
            )}

            {/* Card feed */}
            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-4 sm:p-5 space-y-3">
                {isLoadingRuns ? (
                    <div className="flex justify-center py-10"><LoadingIcon className="w-6 h-6 text-zinc-500 animate-spin" aria-hidden="true" /></div>
                ) : runs.length === 0 ? (
                    <EmptyState
                        icon={<Bookmark className="w-8 h-8" aria-hidden="true" />}
                        title={config.enabled ? 'No runs yet' : 'Automation is off'}
                        description={config.enabled
                            ? `Scheduled ${config.schedule.cron} — the first run's card will appear here. Click "Run now" to trigger one immediately.`
                            : 'Enable the automation to start generating analysis cards here.'}
                        className="h-full"
                    />
                ) : (
                    runs.map(run => (
                        <AutomationRunCard key={run.id} run={run} modelIdToName={modelIdToName} onConfirmOutcome={onConfirmOutcome} />
                    ))
                )}
            </div>
        </div>
    );
};

export default React.memo(AutomationView);
