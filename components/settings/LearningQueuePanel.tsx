import React, { useEffect, useState } from 'react';
import {
    listLearningProposals,
    dismissLearningProposal,
    type LearningProposal,
} from '../../utils/learningQueue';
import {
    applyDisplacementProposal,
    applyRevivalProposal,
    applyDemoteProposal,
} from '../../services/learning/SkillMemoryService';
import { getActiveUsername } from '../../utils/activeUser';

/** Same event ChatInput listens for (see trySkillInChat in SkillsGrid) —
 *  dispatched directly to keep the module graph acyclic. */
const trySkillInChat = (slug: string): void => {
    window.dispatchEvent(new CustomEvent('august:try-skill', { detail: { slug } }));
};

/**
 * LearningQueuePanel (§4.6 loop E / §8.4) — "the gate proposes, the inbox
 * disposes." Five lifecycle passes (cap displacement, graveyard revival,
 * zero-evidence demote, regime/recurrence re-scope, contradiction/belief
 * challenge) queue proposals; this is the ONLY surface that reads them.
 * Without it the queue is write-only and every proposal is silently lost.
 *
 * Apply exists where a deterministic actuation path exists (displacement,
 * revival, demote). Re-scope and contradiction proposals are HUMAN EDIT
 * prompts — the honest actions are "open the skill" or "dismiss", never an
 * automatic rewrite of a belief's text.
 */

const KIND_LABEL: Record<string, string> = {
    displacement: 'cap',
    revival: 'revival',
    demote: 'demote',
    rescope: 're-scope',
    contradiction: 'conflict',
    distill: 'distill',
};

const APPLYABLE = new Set(['displacement', 'revival', 'demote']);

interface LearningQueuePanelProps {
    /** Bump to force a refresh from outside (e.g. after approving a draft). */
    refreshKey?: number;
}

const LearningQueuePanel: React.FC<LearningQueuePanelProps> = ({ refreshKey }) => {
    const [proposals, setProposals] = useState<LearningProposal[]>([]);
    const [open, setOpen] = useState(true);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [errorId, setErrorId] = useState<string | null>(null);

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
        setErrorId(null);
        const username = getActiveUsername();
        let ok = false;
        try {
            if (p.kind === 'displacement') {
                const payload = p.payload as { displacedSlug?: string; challenger?: never } | undefined;
                const displaced = payload?.displacedSlug || p.skillSlug || '';
                ok = await applyDisplacementProposal(displaced, username, payload?.challenger as never);
            } else if (p.kind === 'revival') {
                const slug = (p.payload as { slug?: string } | undefined)?.slug || p.skillSlug || '';
                ok = await applyRevivalProposal(slug, username);
            } else if (p.kind === 'demote') {
                const slug = (p.payload as { slug?: string } | undefined)?.slug || p.skillSlug || '';
                ok = await applyDemoteProposal(slug, username);
            }
        } catch {
            ok = false;
        }
        setBusyId(null);
        if (ok) dismiss(p);
        else setErrorId(p.id); // target vanished (skill edited/retired since queuing)
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
                    <span className="ml-2 rounded-full border border-zinc-700 px-1.5 py-0.5 text-[10px] font-normal normal-case tracking-normal text-zinc-500 tabular-nums">
                        {proposals.length}
                    </span>
                </span>
                <span className="text-[10px] text-zinc-600">{open ? 'hide' : 'show'}</span>
            </button>
            {open && (
                <ul className="max-h-64 space-y-2 overflow-y-auto custom-scrollbar border-t border-zinc-800/80 px-3 py-3">
                    {proposals.map(p => (
                        <li key={p.id} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-2.5">
                            <div className="flex items-start gap-2">
                                <span className="mt-0.5 shrink-0 rounded-full border border-zinc-700 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-zinc-500">
                                    {KIND_LABEL[p.kind] ?? p.kind}
                                </span>
                                <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-zinc-300">{p.text}</p>
                            </div>
                            <div className="mt-2 flex items-center gap-2 pl-1">
                                <span className="mr-auto text-[10px] text-zinc-600">
                                    {new Date(p.createdAt).toLocaleDateString()}
                                </span>
                                {p.skillSlug && (
                                    <button
                                        type="button"
                                        onClick={() => trySkillInChat(p.skillSlug!)}
                                        className="rounded-md border border-zinc-800 px-2 py-1 text-[10px] text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
                                    >
                                        Open in chat
                                    </button>
                                )}
                                {APPLYABLE.has(p.kind) && (
                                    <button
                                        type="button"
                                        disabled={busyId === p.id}
                                        onClick={() => void apply(p)}
                                        className="rounded-md border border-zinc-600 px-2 py-1 text-[10px] font-semibold text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
                                    >
                                        {busyId === p.id ? 'Applying…' : 'Apply'}
                                    </button>
                                )}
                                <button
                                    type="button"
                                    onClick={() => dismiss(p)}
                                    className="rounded-md border border-zinc-800 px-2 py-1 text-[10px] text-zinc-500 hover:border-zinc-600 hover:text-zinc-300"
                                >
                                    Dismiss
                                </button>
                            </div>
                            {errorId === p.id && (
                                <p className="mt-1.5 pl-1 text-[10px] text-zinc-500">
                                    Target skill no longer exists — the proposal was left in place; dismiss it if it is stale.
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
