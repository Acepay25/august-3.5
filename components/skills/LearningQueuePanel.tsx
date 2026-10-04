import React, { useEffect, useState } from 'react';
import {
    listLearningProposals,
    dismissLearningProposal,
    proposalApplyFailureMessage,
    APPLYABLE_PROPOSAL_KINDS,
    type LearningProposal,
    type ProposalApplyResult,
} from '../../utils/learningQueue';
import * as supervisorStore from '../../services/learning/supervisorStore';
import StatusPill from '../ui/StatusPill';
import {
    applyDisplacementProposal,
    applyRevivalProposal,
    applyDemoteProposal,
    applyRescopeProposal,
} from '../../services/learning/SkillMemoryService';
import { getActiveUsername } from '../../utils/activeUser';
import { requestSkillTry as trySkillInChat } from '../chat/skillDeepLink';

/**
 * LearningQueuePanel (loop E /) — "the gate proposes, the inbox
 * disposes." Five lifecycle passes (cap displacement, graveyard revival,
 * zero-evidence demote, regime/recurrence re-scope, contradiction/belief
 * challenge) queue proposals; mounted as the top strip of the Strategy
 * Studio. Without it the queue is write-only and every proposal is lost.
 *
 * Nobody HAS to act here. The skill supervisor reviews every one of these
 * automatically: displacement/revival/demote through their deterministic
 * apply paths, re-scope/contradiction only when the model supplies a
 * rewritten clause that clears the same IF/THEN bar a fresh draft must clear.
 * Anything it can't apply stays queued — so these buttons are overrides and
 * a second pair of hands, not the required path.
 */

const KIND_LABEL: Record<string, string> = {
    displacement: 'cap',
    revival: 'revival',
    demote: 'demote',
    rescope: 're-scope',
    contradiction: 'conflict',
};

/** Kinds with a deterministic actuation path, from the one shared list — the
 *  Coach thread reads the same set, so a kind cannot be applyable in one surface
 *  and Dismiss-only in the other (that drift is why `rescope` stayed unusable). */
const APPLYABLE = new Set<string>(APPLYABLE_PROPOSAL_KINDS);

interface LearningQueuePanelProps {
    /** Bump to force a refresh from outside (e.g. after approving a draft). */
    refreshKey?: number;
}

const LearningQueuePanel: React.FC<LearningQueuePanelProps> = ({ refreshKey }) => {
    const [proposals, setProposals] = useState<LearningProposal[]>([]);
    const [open, setOpen] = useState(true);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [failure, setFailure] = useState<{ id: string; message: string } | null>(null);
    // Which review state to label each row with: auto decides them, paused does
    // not — the difference the user needs before deciding to act at all.
    const [auto, setAuto] = useState(() => supervisorStore.getSnapshot().autoEnabled);
    useEffect(() => supervisorStore.subscribe(() => {
        setAuto(supervisorStore.getSnapshot().autoEnabled);
    }), []);

    const refresh = (): void => {
        setProposals([...listLearningProposals(getActiveUsername())].reverse());
    };

    useEffect(() => {
        refresh();
        window.addEventListener('august-learning-queue', refresh);
        return () => window.removeEventListener('august-learning-queue', refresh);
        // refreshKey: parent-triggered reload (e.g. after a draft approval).
    }, [refreshKey]);

    const dismiss = (p: LearningProposal): void => {
        dismissLearningProposal(p.id, getActiveUsername());
        refresh();
    };

    const apply = async (p: LearningProposal): Promise<void> => {
        setBusyId(p.id);
        setFailure(null);
        const username = getActiveUsername();
        let result: ProposalApplyResult;
        try {
            if (p.kind === 'displacement') {
                const payload = p.payload as { displacedSlug?: string; challenger?: never } | undefined;
                const displaced = payload?.displacedSlug || p.skillSlug || '';
                result = await applyDisplacementProposal(displaced, username, payload?.challenger as never);
            } else if (p.kind === 'revival') {
                const slug = (p.payload as { slug?: string } | undefined)?.slug || p.skillSlug || '';
                result = await applyRevivalProposal(slug, username);
            } else if (p.kind === 'demote') {
                const slug = (p.payload as { slug?: string } | undefined)?.slug || p.skillSlug || '';
                result = await applyDemoteProposal(slug, username);
            } else if (p.kind === 'rescope') {
                // The clauses the PROPOSER wrote, applied as written. This is
                // what makes `revise_skill` actionable by a person at all.
                const c = p.payload as { ifCondition?: string; thenAction?: string; predicate?: string } | undefined;
                result = await applyRescopeProposal(p.skillSlug || '', {
                    ifCondition: c?.ifCondition,
                    thenAction: c?.thenAction,
                    predicate: c?.predicate,
                }, username);
            } else {
                result = { applied: false, reason: 'no-clauses' };
            }
        } catch (e) {
            result = { applied: false, reason: 'write-failed', error: e instanceof Error ? e.message : String(e) };
        }
        setBusyId(null);
        // Never drain a row the library did not act on, and never claim a bare
        // "failed": the reason comes from the writer that refused.
        if (result.applied) dismiss(p);
        else setFailure({ id: p.id, message: proposalApplyFailureMessage(result.reason, result.error) });
    };

    if (proposals.length === 0) return null;

    return (
        <div className="mb-4 rounded-xl border border-zinc-800 bg-zinc-900/60">
            <button
                type="button"
                onClick={() => setOpen(v => !v)}
                className="flex w-full items-center justify-between px-3 py-2 text-left"
                aria-expanded={open}
            >
                <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                    Learning queue
                    <span className="ml-2 rounded-full border border-zinc-700 px-1.5 py-0.5 text-ui-xs font-normal normal-case tracking-normal text-zinc-500 tabular-nums">
                        {proposals.length}
                    </span>
                </span>
                <span className="text-ui-xs text-zinc-600">{open ? 'hide' : 'show'}</span>
            </button>
            {open && (
                <p className="px-3 pt-2 text-ui-xs leading-relaxed text-zinc-600">
                    The supervisor decides these: each one is pending review until it does, and only what it
                    cannot act on safely stays here. Apply and Dismiss are overrides, not the required path.
                </p>
            )}
            {open && (
                <ul className="max-h-64 space-y-2 overflow-y-auto custom-scrollbar border-t border-zinc-800/80 px-3 py-3">
                    {proposals.map(p => (
                        <li key={p.id} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-2.5">
                            <div className="flex items-start gap-2">
                                <span className="mt-0.5 shrink-0 rounded-full border border-zinc-700 px-1.5 py-0.5 text-ui-2xs font-bold uppercase tracking-wider text-zinc-500">
                                    {KIND_LABEL[p.kind] ?? p.kind}
                                </span>
                                <p className="min-w-0 flex-1 text-ui-dense leading-relaxed text-zinc-300">{p.text}</p>
                                <StatusPill tone={auto ? 'info' : 'warn'} kicker
                                    data-testid="proposal-review-state"
                                    title={auto
                                        ? 'The supervisor reviews this automatically — Apply and Dismiss are your overrides.'
                                        : 'Auto-review is paused: nothing moves here unless you act.'}>
                                    {auto ? 'pending review' : 'needs you'}
                                </StatusPill>
                            </div>
                            <div className="mt-2 flex items-center gap-2 pl-1">
                                <span className="mr-auto text-ui-xs text-zinc-600">
                                    {new Date(p.createdAt).toLocaleDateString()}
                                </span>
                                {p.skillSlug && (
                                    <button
                                        type="button"
                                        onClick={() => trySkillInChat(p.skillSlug!)}
                                        className="rounded-md border border-zinc-800 px-2 py-1 text-ui-xs text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
                                    >
                                        Open in chat
                                    </button>
                                )}
                                {APPLYABLE.has(p.kind) && (
                                    <button
                                        type="button"
                                        disabled={busyId === p.id}
                                        onClick={() => void apply(p)}
                                        className="rounded-md border border-zinc-600 px-2 py-1 text-ui-xs font-semibold text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
                                    >
                                        {busyId === p.id ? 'Applying…' : 'Apply'}
                                    </button>
                                )}
                                <button
                                    type="button"
                                    onClick={() => dismiss(p)}
                                    className="rounded-md border border-zinc-800 px-2 py-1 text-ui-xs text-zinc-500 hover:border-zinc-600 hover:text-zinc-300"
                                >
                                    Dismiss
                                </button>
                            </div>
                            {failure?.id === p.id && (
                                <p className="mt-1.5 pl-1 text-ui-xs text-amber-300/90" data-testid="proposal-apply-error">
                                    {failure.message}
                                </p>
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};

export default LearningQueuePanel;
