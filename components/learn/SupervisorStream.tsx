/**
 * SupervisorStream — the live record of what the supervising model is doing.
 *
 * One streamed event per queue item (skill draft / forged tool / memory
 * amendment / ladder proposal) with its phase, the model's own verdict text,
 * and the decision — plus real intervention: any decision can be overridden
 * (reject an approved skill, or approve a rejected one from its stored
 * snapshot), the automation can be paused (finishes the current item, starts
 * nothing new), and "Run now" forces a pass even while paused.
 *
 * Extracted from SupervisorPanel so the dock overlay and the Learn surface's
 * Queue tab render the SAME stream from the SAME store, rather than the dock
 * being the only place a user can see the model govern itself.
 */

import React from 'react';
import { useSyncExternalStore } from 'react';
import {
    Brain, Gavel, ListChecks, Pause, Play, Search, ShieldCheck, X,
} from '../shared/Icons';
import * as supervisorStore from '../../services/learning/supervisorStore';
import {
    runSupervisorNow, overrideApproveSkill, overrideRejectSkill, abortSupervisorRun,
    overrideVerdict,
    getSupervisionSpend,
} from '../../services/learning/skillSupervisor';
import type { SupervisorEvent, SupervisorPhase } from '../../services/learning/supervisorStore';
import { skillIngestOverrideNote } from '../../services/learning/skillApproval';
import type { SkillIngestResult } from '../../services/learning/SkillMemoryService';
import { getActiveUsername } from '../../utils/activeUser';

const PHASE_ICON: Record<SupervisorPhase, React.ReactNode> = {
    idle: <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />,
    reviewing: <Search className="h-3.5 w-3.5" aria-hidden="true" />,
    verifying: <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />,
    enhancing: <Brain className="h-3.5 w-3.5" aria-hidden="true" />,
    deciding: <Gavel className="h-3.5 w-3.5" aria-hidden="true" />,
    learning: <Brain className="h-3.5 w-3.5" aria-hidden="true" />,
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

/** What walking a verdict back means in each kind's own store — the model
 *  decided, and the human is reversing exactly that (WS-2.3's "override any
 *  verdict", which used to be a skill-only affordance). */
const undoLabel = (kind: string | undefined, verdict: string): string => {
    const accepted = verdict === 'approved' || verdict === 'enhanced';
    if (kind === 'tool') return accepted ? 'Retire the tool' : 'Approve it yourself';
    if (kind === 'amendment') return accepted ? 'Reject the change' : 'Apply it yourself';
    return 'Put it back in the queue';
};

/** A proposal the model APPLIED cannot be reversed here: the rewrite already
 *  landed on a skill file, which has its own undo. Only a dropped one can come
 *  back, so offering a button for the other case would be a lie. */
const undoable = (kind: string | undefined, verdict: string): boolean =>
    kind === 'tool' || kind === 'amendment'
    || (kind === 'proposal' && (verdict === 'rejected' || verdict === 'skipped'));

const relTime = (atMs: number): string => {
    const s = Math.max(0, Math.round((Date.now() - atMs) / 1000));
    if (s < 60) return `${s}s ago`;
    return `${Math.round(s / 60)}m ago`;
};

const EventRow: React.FC<{ ev: SupervisorEvent }> = ({ ev }) => {
    const [busy, setBusy] = React.useState(false);
    const [note, setNote] = React.useState<{ kind: 'error' | 'info'; body: string } | null>(null);
    const decision = ev.decision;
    const overridable = !!decision && !decision.overriddenByUser && (!!ev.draftSnapshot || !!ev.itemId);
    /** `describe` reads what the override actually did. Only the skill override
     *  answers — the other kinds reverse store rows that cannot decline — so a
     *  press whose write was refused no longer looks like a press that worked. */
    const override = async (
        fn: (eventId: string, user: string) => Promise<unknown>,
        describe?: (result: unknown) => { kind: 'error' | 'info'; body: string } | null,
    ): Promise<void> => {
        setBusy(true);
        setNote(null);
        let result: unknown;
        let threw = false;
        try {
            result = await fn(ev.id, getActiveUsername());
        } catch (e) {
            threw = true;
            setNote({ kind: 'error', body: `Could not act on this: ${e instanceof Error ? e.message : String(e)}` });
        } finally {
            setBusy(false);
        }
        if (!threw && describe) {
            const said = describe(result);
            if (said) setNote(said);
        }
    };
    return (
        <div className="rounded-xl border border-white/[0.06] bg-zinc-900/60 p-2.5" data-testid={`supervisor-event-${ev.id}`}>
            <div className="flex items-center gap-1.5">
                <span className="text-cyan-300">{PHASE_ICON[decision ? 'deciding' : ev.phase] ?? PHASE_ICON[ev.phase]}</span>
                <span className="truncate text-ui-sm font-semibold text-zinc-100">{ev.itemTitle || ev.text}</span>
                {ev.itemKind && (
                    <span className="shrink-0 rounded-full border border-white/10 px-1.5 py-0.5 text-ui-2xs uppercase tracking-wider text-zinc-500">
                        {KIND_LABEL[ev.itemKind] || ev.itemKind}
                    </span>
                )}
                <span className="ml-auto shrink-0 font-mono text-ui-2xs text-zinc-600">{relTime(ev.atMs)}</span>
            </div>
            <p className="mt-1 text-ui-dense text-zinc-400">{ev.text}</p>
            {/* The model's verdict text for this item — live while streaming. */}
            {ev.streamText && (
                <pre className="mt-1.5 max-h-24 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-black/30 p-2 font-mono text-ui-xs leading-4 text-zinc-500 custom-scrollbar">
                    {ev.streamText}{ev.streaming ? '▍' : ''}
                </pre>
            )}
            {decision && (
                <div className="mt-1.5">
                    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-ui-xs font-bold uppercase tracking-wider ${VERDICT_STYLE[decision.verdict]}`}>
                        {decision.verdict}{decision.overriddenByUser ? ' (you)' : ''}
                    </span>
                    <p className="mt-1 text-ui-dense text-zinc-400">{decision.reason}</p>
                    {overridable && ev.itemKind === 'skill' && (
                        <div className="mt-1.5 flex gap-1.5">
                            {decision.verdict === 'rejected' || decision.verdict === 'skipped' ? (
                                <button type="button" disabled={busy}
                                    onClick={() => void override(overrideApproveSkill, r => r
                                        ? skillIngestOverrideNote(r as SkillIngestResult)
                                        // A null answer means the row kept no draft to
                                        // ingest — nothing was written, whatever the
                                        // button said.
                                        : { kind: 'error', body: 'Nothing to approve — this entry kept no draft snapshot, so there was nothing to write.' })}
                                    className="rounded-control inline-flex min-h-6 items-center border border-emerald-500/30 px-2.5 py-1 text-ui-xs font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/10 disabled:opacity-40">
                                    Approve anyway
                                </button>
                            ) : (
                                <button type="button" disabled={busy} onClick={() => void override(overrideRejectSkill)}
                                    className="rounded-control inline-flex min-h-6 items-center border border-rose-500/30 px-2.5 py-1 text-ui-xs font-semibold text-rose-300 transition-colors hover:bg-rose-500/10 disabled:opacity-40">
                                    Reject — undo this
                                </button>
                            )}
                        </div>
                    )}
                    {overridable && ev.itemKind !== 'skill' && undoable(ev.itemKind, decision.verdict) && (
                        <div className="mt-1.5 flex gap-1.5" data-testid={`supervisor-undo-${ev.id}`}>
                            <button type="button" disabled={busy} onClick={() => void override(overrideVerdict)}
                                className="rounded-control border border-zinc-600 px-2 py-0.5 text-ui-xs font-semibold text-zinc-200 transition-colors hover:bg-zinc-800 disabled:opacity-40">
                                {undoLabel(ev.itemKind, decision.verdict)}
                            </button>
                        </div>
                    )}
                    {note && (
                        <p
                            data-testid={`supervisor-override-note-${ev.id}`}
                            className={`mt-1.5 text-ui-dense leading-relaxed ${note.kind === 'error' ? 'text-amber-300/90' : 'text-zinc-400'}`}
                        >
                            {note.body}
                        </p>
                    )}
                </div>
            )}
        </div>
    );
};

interface SupervisorStreamProps {
    /** Present in the dock overlay; the Learn tab embeds without a close box. */
    onClose?: () => void;
}

const SupervisorStream: React.FC<SupervisorStreamProps> = ({ onClose }) => {
    const snap = useSyncExternalStore(supervisorStore.subscribe, supervisorStore.getSnapshot, supervisorStore.getSnapshot);
    // Read through the same subscription: the spend only changes when a pass
    // runs, and every pass notifies this store.
    const spend = getSupervisionSpend();
    const newestFirst = [...snap.events].reverse();
    return (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden" data-testid="supervisor-stream">
            <div className="flex shrink-0 items-center gap-2 border-b border-white/[0.06] px-4 py-2.5">
                <ListChecks className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                <span className="text-ui-caption font-semibold text-zinc-100">Skill supervisor</span>
                {snap.modelName && (
                    <span className="truncate rounded-full border border-white/10 px-1.5 py-0.5 text-ui-2xs font-semibold text-zinc-400">
                        {snap.modelName}
                    </span>
                )}
                {onClose && (
                    <button type="button" onClick={onClose} aria-label="Close supervisor panel"
                        className="ml-auto rounded-control p-1 text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-100">
                        <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                )}
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-white/[0.06] px-4 py-2">
                <button type="button"
                    onClick={() => supervisorStore.setAutoEnabled(!snap.autoEnabled)}
                    aria-pressed={snap.autoEnabled} data-testid="supervisor-auto-toggle"
                    className={`flex items-center gap-1 rounded-control border px-2 py-1 text-ui-xs font-semibold transition-colors ${
                        snap.autoEnabled ? 'border-emerald-500/30 text-emerald-300' : 'border-white/10 text-zinc-400'
                    }`}>
                    {snap.autoEnabled ? <Pause className="h-3 w-3" aria-hidden="true" /> : <Play className="h-3 w-3" aria-hidden="true" />}
                    {snap.autoEnabled ? 'Auto — on' : 'Auto — paused'}
                </button>
                <button type="button" onClick={() => void runSupervisorNow()} disabled={snap.running}
                    className="rounded-control border border-white/10 px-2 py-1 text-ui-xs font-semibold text-zinc-300 transition-colors hover:bg-white/[0.06] disabled:opacity-40">
                    Run now
                </button>
                {snap.running && (
                    <button type="button" onClick={() => abortSupervisorRun()}
                        className="rounded-control border border-rose-500/30 px-2 py-1 text-ui-xs font-semibold text-rose-300 transition-colors hover:bg-rose-500/10">
                        Stop
                    </button>
                )}
                {/* A per-pass call budget means a backlog can legitimately
                    survive a sweep — so the count rides the bar, not a tooltip. */}
                <span className="ml-auto truncate font-mono text-ui-2xs text-zinc-600"
                    title={`${spend.spent}/${spend.windowCap} supervised in the last hour`}
                    data-testid="supervisor-status">
                    {snap.running
                        ? snap.activity || 'supervising…'
                        : snap.pendingCount > 0 && spend.exhausted
                            ? `${snap.pendingCount} waiting · session budget spent`
                            : snap.pendingCount > 0
                                ? `${snap.pendingCount} waiting`
                                : snap.autoEnabled ? 'watching the queues' : 'paused'}
                </span>
            </div>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3 custom-scrollbar" data-testid="supervisor-log">
                {newestFirst.length === 0 ? (
                    <p className="px-1 py-6 text-center text-ui-dense leading-5 text-zinc-600">
                        The supervisor reviews new skill drafts, tool candidates, memory amendments and
                        ladder proposals automatically — verifying them against your catalog, graveyard and
                        memory, enhancing the salvageable, and approving the solid ones as candidates.
                        Everything it does lands here, and every decision is yours to undo.
                    </p>
                ) : newestFirst.map(ev => <EventRow key={ev.id} ev={ev} />)}
            </div>
        </div>
    );
};

export default SupervisorStream;
