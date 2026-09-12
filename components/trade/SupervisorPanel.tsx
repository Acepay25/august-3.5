/**
 * SupervisorPanel — click the supervisor indicator and this opens: a live
 * window into what the supervising model is doing RIGHT NOW. One streamed
 * event per queue item (skill draft / forged tool / memory amendment /
 * ladder proposal) with its phase, the model's streamed verdict text, and
 * the decision — plus REAL-TIME INTERVENTION: any decision can be overridden
 * (reject an approved skill — tombstone + delete the created candidate; or
 * approve a rejected one from its stored snapshot), the automation can be
 * paused (finishes the current item, starts nothing new) and "Run now"
 * forces a pass even while paused.
 */

import React from 'react';
import { useSyncExternalStore } from 'react';
import {
    Brain, Gavel, ListChecks, Pause, Play, Search, ShieldCheck, Sparkles, X,
} from 'lucide-react';
import * as supervisorStore from '../../services/learning/supervisorStore';
import {
    runSupervisorNow, overrideApproveSkill, overrideRejectSkill, abortSupervisorRun,
} from '../../services/learning/skillSupervisor';
import type { SupervisorEvent, SupervisorPhase } from '../../services/learning/supervisorStore';
import { getActiveUsername } from '../../utils/activeUser';

const PHASE_ICON: Record<SupervisorPhase, React.ReactNode> = {
    idle: <Sparkles className="h-3.5 w-3.5" />,
    reviewing: <Search className="h-3.5 w-3.5" />,
    verifying: <ShieldCheck className="h-3.5 w-3.5" />,
    enhancing: <Sparkles className="h-3.5 w-3.5" />,
    deciding: <Gavel className="h-3.5 w-3.5" />,
    learning: <Brain className="h-3.5 w-3.5" />,
};

const VERDICT_STYLE: Record<string, string> = {
    approved: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
    enhanced: 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300',
    rejected: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
    skipped: 'border-white/10 bg-zinc-800 text-zinc-400',
};

const KIND_LABEL: Record<string, string> = {
    skill: 'skill draft', tool: 'tool candidate', amendment: 'memory amendment', proposal: 'ladder proposal',
};

const relTime = (atMs: number): string => {
    const s = Math.max(0, Math.round((Date.now() - atMs) / 1000));
    if (s < 60) return `${s}s ago`;
    return `${Math.round(s / 60)}m ago`;
};

const EventRow: React.FC<{ ev: SupervisorEvent }> = ({ ev }) => {
    const [busy, setBusy] = React.useState(false);
    const decision = ev.decision;
    const overridable = !!decision && !decision.overriddenByUser && (ev.itemKind === 'skill' || !!ev.draftSnapshot);
    const override = async (fn: (eventId: string, user: string) => Promise<void>): Promise<void> => {
        setBusy(true);
        try { await fn(ev.id, getActiveUsername()); } finally { setBusy(false); }
    };
    return (
        <div className="rounded-xl border border-white/[0.06] bg-zinc-900/60 p-2.5" data-testid={`supervisor-event-${ev.id}`}>
            <div className="flex items-center gap-1.5">
                <span className="text-cyan-300">{PHASE_ICON[decision ? 'deciding' : ev.phase] ?? PHASE_ICON[ev.phase]}</span>
                <span className="truncate text-[12px] font-semibold text-zinc-100">{ev.itemTitle || ev.text}</span>
                {ev.itemKind && (
                    <span className="shrink-0 rounded-full border border-white/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-zinc-500">
                        {KIND_LABEL[ev.itemKind] || ev.itemKind}
                    </span>
                )}
                <span className="ml-auto shrink-0 font-mono text-[9px] text-zinc-600">{relTime(ev.atMs)}</span>
            </div>
            <p className="mt-1 text-[11px] text-zinc-400">{ev.text}</p>
            {/* The model's verdict text for this item — live while streaming. */}
            {ev.streamText && (
                <pre className="mt-1.5 max-h-24 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-black/30 p-2 font-mono text-[10px] leading-4 text-zinc-500 custom-scrollbar">
                    {ev.streamText}{ev.streaming ? '▍' : ''}
                </pre>
            )}
            {decision && (
                <div className="mt-1.5">
                    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${VERDICT_STYLE[decision.verdict]}`}>
                        {decision.verdict}{decision.overriddenByUser ? ' (you)' : ''}
                    </span>
                    <p className="mt-1 text-[11px] text-zinc-400">{decision.reason}</p>
                    {overridable && ev.itemKind === 'skill' && (
                        <div className="mt-1.5 flex gap-1.5">
                            {decision.verdict === 'rejected' || decision.verdict === 'skipped' ? (
                                <button type="button" disabled={busy} onClick={() => void override(overrideApproveSkill)}
                                    className="rounded-control border border-emerald-500/30 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/10 disabled:opacity-40">
                                    Approve anyway
                                </button>
                            ) : (
                                <button type="button" disabled={busy} onClick={() => void override(overrideRejectSkill)}
                                    className="rounded-control border border-rose-500/30 px-2 py-0.5 text-[10px] font-semibold text-rose-300 transition-colors hover:bg-rose-500/10 disabled:opacity-40">
                                    Reject — undo this
                                </button>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export const SupervisorPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
    const snap = useSyncExternalStore(supervisorStore.subscribe, supervisorStore.getSnapshot, supervisorStore.getSnapshot);
    const newestFirst = [...snap.events].reverse();
    return (
        <div className="absolute inset-0 z-40 flex items-start justify-center bg-black/50 px-6 pt-14 pb-6" data-testid="supervisor-panel">
            <div className="flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-white/10 bg-zinc-950 shadow-xl">
                <div className="flex shrink-0 items-center gap-2 border-b border-white/[0.06] px-4 py-2.5">
                    <ListChecks className="h-4 w-4 text-cyan-300" />
                    <span className="text-[13px] font-semibold text-zinc-100">Skill supervisor</span>
                    {snap.modelName && (
                        <span className="truncate rounded-full border border-white/10 px-1.5 py-0.5 text-[9px] font-semibold text-zinc-400">
                            {snap.modelName}
                        </span>
                    )}
                    <button type="button" onClick={onClose} aria-label="Close supervisor panel"
                        className="ml-auto rounded-control p-1 text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-100">
                        <X className="h-4 w-4" />
                    </button>
                </div>
                <div className="flex shrink-0 items-center gap-1.5 border-b border-white/[0.06] px-4 py-2">
                    <button type="button"
                        onClick={() => supervisorStore.setAutoEnabled(!snap.autoEnabled)}
                        aria-pressed={snap.autoEnabled} data-testid="supervisor-auto-toggle"
                        className={`flex items-center gap-1 rounded-control border px-2 py-1 text-[10px] font-semibold transition-colors ${
                            snap.autoEnabled ? 'border-emerald-500/30 text-emerald-300' : 'border-white/10 text-zinc-400'
                        }`}>
                        {snap.autoEnabled ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                        {snap.autoEnabled ? 'Auto — on' : 'Auto — paused'}
                    </button>
                    <button type="button" onClick={() => void runSupervisorNow()} disabled={snap.running}
                        className="rounded-control border border-white/10 px-2 py-1 text-[10px] font-semibold text-zinc-300 transition-colors hover:bg-white/[0.06] disabled:opacity-40">
                        Run now
                    </button>
                    {snap.running && (
                        <button type="button" onClick={() => abortSupervisorRun()}
                            className="rounded-control border border-rose-500/30 px-2 py-1 text-[10px] font-semibold text-rose-300 transition-colors hover:bg-rose-500/10">
                            Stop
                        </button>
                    )}
                    <span className="ml-auto truncate font-mono text-[9px] text-zinc-600" title={snap.activity}>
                        {snap.running ? snap.activity || 'supervising…' : snap.autoEnabled ? 'watching the queues' : 'paused'}
                    </span>
                </div>
                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3 custom-scrollbar" data-testid="supervisor-log">
                    {newestFirst.length === 0 ? (
                        <p className="px-1 py-6 text-center text-[11px] leading-5 text-zinc-600">
                            The supervisor reviews new skill drafts, tool candidates, memory amendments and
                            ladder proposals automatically — verifying them against your catalog, graveyard and
                            memory, enhancing the salvageable, and approving the solid ones as candidates.
                            Everything it does lands here, and every decision is yours to undo.
                        </p>
                    ) : newestFirst.map(ev => <EventRow key={ev.id} ev={ev} />)}
                </div>
            </div>
        </div>
    );
};

export default SupervisorPanel;
