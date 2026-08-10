import React from 'react';
import { AutomationConfig, AutomationRun } from '../../types/automation';
import { ChevronLeftIcon, TrashIcon, EditIcon, LoadingIcon, RefreshIcon } from '../shared/Icons';
import { EmptyState } from '../ui/EmptyState';
import AutomationRunCard from './AutomationRunCard';
import { ToggleSwitch } from '../shared/ToggleSwitch';
import { Bookmark, Play } from 'lucide-react';

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
    onRefresh: () => void;
    modelIdToName: Record<string, string>;
}> = ({ config, runs, isLoadingRuns, isRunning, onBack, onEdit, onDelete, onRunNow, onToggleEnabled, onRefresh, modelIdToName }) => {
    return (
        <div className="flex flex-col h-full bg-zinc-950">
            {/* Header — Back returns to the sidebar view */}
            <div className="px-4 py-2.5 border-b border-white/5 bg-zinc-900 shrink-0 flex items-center justify-between gap-3 flex-wrap">
                <button
                    onClick={onBack}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/10 transition-colors"
                    aria-label="Back to automations"
                >
                    <ChevronLeftIcon className="w-3.5 h-3.5" /> Back
                </button>
                <div className="flex items-center gap-2.5 min-w-0">
                    <span className="w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_6px_#22d3ee66]" />
                    <h3 className="text-sm font-bold text-white truncate">{config.name}</h3>
                    <span className="text-[10px] font-mono text-zinc-500 hidden sm:inline">{config.schedule.cron}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-widest border ${config.enabled ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-zinc-800 border-white/10 text-zinc-500'}`}>
                        {config.enabled ? 'On' : 'Off'}
                    </span>
                </div>
            </div>

            {/* Controls */}
            <div className="px-4 py-2.5 border-b border-white/5 bg-zinc-900/60 shrink-0 flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap text-[10px] text-zinc-500 font-mono">
                    <span>Mode: <span className="text-zinc-300 uppercase">{config.mode === 'standard' ? 'Standard' : config.mode === 'pure_ai' ? 'Pure AI' : 'Accuracy'}</span></span>
                    <span>·</span>
                    <span>Lenses: <span className="text-zinc-300">{config.useLenses ? 'On' : 'Off'}</span></span>
                    <span>·</span>
                    <span>Analysts: <span className="text-zinc-300">{config.analystModels.length}</span></span>
                    <span>·</span>
                    <span>Runs: <span className="text-zinc-300">{config.runCount}</span></span>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    <button
                        onClick={onRunNow}
                        disabled={isRunning || !config.enabled}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-[10px] font-bold uppercase tracking-widest transition-colors"
                        title={config.enabled ? 'Run this automation now' : 'Enable the automation first'}
                    >
                        {isRunning ? <LoadingIcon className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                        {isRunning ? 'Running…' : 'Run now'}
                    </button>
                    <button
                        onClick={onRefresh}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-white/10 text-zinc-300 hover:text-white hover:border-white/25 text-[10px] font-bold uppercase tracking-widest transition-colors"
                        title="Refresh runs"
                        aria-label="Refresh runs"
                    >
                        <RefreshIcon className="w-3 h-3" /> Refresh
                    </button>
                    <button
                        onClick={onEdit}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-white/10 text-zinc-300 hover:text-white hover:border-white/25 text-[10px] font-bold uppercase tracking-widest transition-colors"
                    >
                        <EditIcon className="w-3 h-3" /> Edit
                    </button>
                    <button
                        onClick={onDelete}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 text-[10px] font-bold uppercase tracking-widest transition-colors"
                    >
                        <TrashIcon className="w-3 h-3" /> Delete
                    </button>
                    <div className="flex items-center gap-2 pl-2 border-l border-white/10">
                        <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">Scheduled</span>
                        <ToggleSwitch checked={config.enabled} onChange={onToggleEnabled} label="Toggle automation" />
                    </div>
                </div>
            </div>

            {/* Card feed */}
            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-4 sm:p-5 space-y-3">
                {isLoadingRuns ? (
                    <div className="flex justify-center py-10"><LoadingIcon className="w-6 h-6 text-zinc-500 animate-spin" /></div>
                ) : runs.length === 0 ? (
                    <EmptyState
                        icon={<Bookmark className="w-8 h-8" />}
                        title={config.enabled ? 'No runs yet' : 'Automation is off'}
                        description={config.enabled
                            ? `Scheduled ${config.schedule.cron} — the first run's card will appear here. Click "Run now" to trigger one immediately.`
                            : 'Enable the automation to start generating analysis cards here.'}
                        className="h-full"
                    />
                ) : (
                    runs.map(run => (
                        <AutomationRunCard key={run.id} run={run} modelIdToName={modelIdToName} />
                    ))
                )}
            </div>
        </div>
    );
};

export default React.memo(AutomationView);
