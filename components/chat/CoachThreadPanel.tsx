import React, { useEffect, useState } from 'react';
import { GraduationCap, Inbox } from 'lucide-react';
import { listSkillDrafts, type SkillDraft } from '../../utils/skillDrafts';
import type { SkillProofResult } from '../../services/learning/skillProof';
import { EmptyState } from '../ui/EmptyState';
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

/**
 * CoachThreadPanel — the Coach thread: the learning loop's inbox as
 * a conversation surface. Everything the harness wants the trader to decide
 * — skill drafts awaiting approval, and lifecycle proposals (cap
 * displacement, graveyard revival, zero-evidence demote, re-scope,
 * contradiction) — lands here as cards, in the reference's row vocabulary
 * (avatar + title + muted meta + inline actions). Approving a draft or
 * applying a proposal removes its card; the panel is the roster's answer to
 * "what does the system want from me right now".
 */

interface CoachThreadPanelProps {
    /** Same handler the Inbox modal uses: take the draft + ingest. */
    onAllowDraft: (draft: SkillDraft) => void;
    /** Same handler the Inbox modal uses: take + tombstone the trigger. */
    onDenyDraft: (draft: SkillDraft) => void;
    /** Focus a transcript card (jump-to-message from a draft's trade link). */
    onOpenTrade?: (tradeId: string) => void;
}

const timeAgo = (iso: string): string => {
    const ms = Date.now() - Date.parse(iso);
    if (!Number.isFinite(ms) || ms < 0) return 'now';
    if (ms < 3_600_000) return `${Math.max(1, Math.floor(ms / 60_000))} min. ago`;
    if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)} hr. ago`;
    return `${Math.floor(ms / 86_400_000)} days ago`;
};

const CardShell: React.FC<{ children: React.ReactNode; testId?: string }> = ({ children, testId }) => (
    <div
        data-testid={testId}
        className="rounded-xl border border-white/[0.06] bg-zinc-900/40 p-4"
    >
        {children}
    </div>
);

const ActionButton: React.FC<{
    onPress: () => void;
    variant?: 'solid' | 'ghost';
    children: React.ReactNode;
    testId?: string;
}> = ({ onPress, variant = 'ghost', children, testId }) => (
    <button
        type="button"
        data-testid={testId}
        onClick={onPress}
        className={`rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors ${
            variant === 'solid'
                ? 'bg-zinc-200 text-zinc-900 hover:bg-white'
                : 'border border-white/10 text-zinc-300 hover:bg-zinc-800 hover:text-white'
        }`}
    >
        {children}
    </button>
);

/**
 * History proof for a draft is a pure function of (coin, timeframe, clause
 * text) but costs a 1,000-candle fetch, so it is cached at module scope: a
 * chart-scan run that queues several drafts off the same tape, or a panel
 * re-open, must not re-hit the exchange.
 */
const proofCache = new Map<string, SkillProofResult>();

/** One draft card with its own lazy proof state. A hook cannot live inside
 *  `drafts.map`, hence the extraction. */
const DraftCard: React.FC<{
    draft: SkillDraft;
    onOpenTrade?: (tradeId: string) => void;
    onDiscard: () => void;
    onSave: () => void;
}> = ({ draft: d, onOpenTrade, onDiscard, onSave }) => {
    const [proofState, setProofState] = useState<'idle' | 'running' | 'done'>('idle');
    const [proof, setProof] = useState<SkillProofResult | null>(null);

    // Deliberately on demand: proving every draft the moment it was drafted
    // would fire one 1,000-candle fetch per draft, and a draft whose wording
    // misses every strategy-book detector returns no-match anyway — so the
    // common automatic case is a fetch that answers nothing.
    const runProof = async (): Promise<void> => {
        if (proofState === 'running') return;
        if (!d.coin) {
            setProof({ status: 'no-data', message: 'No coin on this draft, so there is no chart to replay.' });
            setProofState('done');
            return;
        }
        setProofState('running');
        setProof(null);
        try {
            const { proofSkillOnHistory, skillProofText } = await import('../../services/learning/skillProof');
            const timeframe = d.crafted.timeframe || '1h';
            const text = skillProofText({
                title: d.crafted.name,
                description: d.crafted.description,
                ifCondition: d.crafted.ifCondition,
                thenAction: d.crafted.thenAction,
            });
            const key = `${d.coin}|${timeframe}|${text}`;
            const cached = proofCache.get(key);
            if (cached) {
                setProof(cached);
            } else {
                const res = await proofSkillOnHistory({ coin: d.coin, timeframe, text });
                proofCache.set(key, res);
                setProof(res);
            }
        } catch (err) {
            setProof({ status: 'no-data', message: err instanceof Error ? err.message : String(err) });
        }
        setProofState('done');
    };

    return (
        <CardShell testId={`coach-draft-${d.id}`}>
            <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-zinc-800 text-ui-xs font-bold uppercase text-zinc-400">
                    {d.crafted.kind === 'avoid' ? 'AV' : 'RP'}
                </span>
                <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                        <p className="truncate text-[14px] font-semibold text-zinc-100">{d.crafted.name}</p>
                        <span className="ml-auto shrink-0 text-[11px] text-zinc-500">{timeAgo(d.createdAt)}</span>
                    </div>
                    <p className="mt-1 text-[12px] leading-relaxed text-zinc-400">
                        <span className="font-semibold text-zinc-300">If</span> {d.crafted.ifCondition}
                        <span className="font-semibold text-zinc-300"> → then</span> {d.crafted.thenAction}
                    </p>
                    <p className="mt-1 text-[11px] text-zinc-600">
                        {d.coin ? `${d.coin} · ` : ''}
                        {d.crafted.kind === 'avoid' ? 'avoid' : 'repeat'} skill · from trade {d.tradeId.slice(0, 8)}…
                    </p>
                    {proofState === 'done' && proof && (
                        <p className="mt-2 text-[11px] leading-relaxed text-zinc-500" data-testid={`coach-draft-proof-${d.id}`}>
                            {proof.status === 'ok'
                                ? <>Replay of {proof.proof.bars} {proof.proof.symbol} {proof.proof.timeframe} candles as <span className="text-zinc-300">{proof.proof.title}</span>: {proof.proof.hits} hits, {proof.proof.wins}W/{proof.proof.losses}L{proof.proof.winRate !== null ? ` (${Math.round(proof.proof.winRate * 100)}%)` : ' (no outcomes)'}, avg +{(proof.proof.avgMfe * 100).toFixed(1)}% in favor / −{Math.abs(proof.proof.avgMae * 100).toFixed(1)}% against. Historical readout — it does not grade the draft.</>
                                : proof.message}
                        </p>
                    )}
                </div>
            </div>
            <div className="mt-3 flex items-center gap-2">
                <button
                    type="button"
                    onClick={() => { void runProof(); }}
                    disabled={proofState === 'running'}
                    data-testid={`coach-draft-prove-${d.id}`}
                    title="Replay this coin's candle history and report what the matched detector behavior would have done"
                    className="text-[11px] text-zinc-500 hover:text-zinc-300 disabled:cursor-not-allowed disabled:opacity-40"
                >
                    {proofState === 'running' ? 'Replaying history…' : 'Prove on history'}
                </button>
                {onOpenTrade && (
                    <button
                        type="button"
                        onClick={() => onOpenTrade(d.tradeId)}
                        className="ml-auto text-[11px] text-zinc-500 hover:text-zinc-300"
                    >
                        View the trade
                    </button>
                )}
                {!onOpenTrade && <span className="ml-auto" />}
                <ActionButton onPress={onDiscard} testId={`coach-draft-deny-${d.id}`}>Discard</ActionButton>
                <ActionButton onPress={onSave} variant="solid" testId={`coach-draft-allow-${d.id}`}>
                    Save as skill
                </ActionButton>
            </div>
        </CardShell>
    );
};

const CoachThreadPanel: React.FC<CoachThreadPanelProps> = ({ onAllowDraft, onDenyDraft, onOpenTrade }) => {
    const [drafts, setDrafts] = useState<SkillDraft[]>([]);
    const [proposals, setProposals] = useState<LearningProposal[]>([]);
    const [busyId, setBusyId] = useState<string | null>(null);

    const refresh = (): void => {
        const user = getActiveUsername();
        setDrafts([...listSkillDrafts(user)].reverse());
        setProposals([...listLearningProposals(user)].reverse());
    };

    useEffect(() => {
        refresh();
        window.addEventListener('august-skill-drafts', refresh);
        window.addEventListener('august-learning-queue', refresh);
        return () => {
            window.removeEventListener('august-skill-drafts', refresh);
            window.removeEventListener('august-learning-queue', refresh);
        };
    }, []);

    const applyProposal = async (p: LearningProposal): Promise<void> => {
        setBusyId(p.id);
        const username = getActiveUsername();
        let ok = false;
        try {
            if (p.kind === 'displacement') {
                const payload = p.payload as { displacedSlug?: string; challenger?: never } | undefined;
                ok = await applyDisplacementProposal(payload?.displacedSlug || p.skillSlug || '', username, payload?.challenger as never);
            } else if (p.kind === 'revival') {
                ok = await applyRevivalProposal((p.payload as { slug?: string } | undefined)?.slug || p.skillSlug || '', username);
            } else if (p.kind === 'demote') {
                ok = await applyDemoteProposal((p.payload as { slug?: string } | undefined)?.slug || p.skillSlug || '', username);
            }
        } catch {
            ok = false;
        }
        setBusyId(null);
        if (ok) {
            dismissLearningProposal(p.id, username);
            refresh();
        }
    };

    const dismissProposal = (p: LearningProposal): void => {
        dismissLearningProposal(p.id, getActiveUsername());
        refresh();
    };

    const denyDraft = (d: SkillDraft): void => {
        onDenyDraft(d);
        refresh();
    };

    const allowDraft = (d: SkillDraft): void => {
        onAllowDraft(d);
        refresh();
    };

    const applyable = new Set(['displacement', 'revival', 'demote']);
    const empty = drafts.length === 0 && proposals.length === 0;

    return (
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-6">
            {/* Thread identity header — reference vocabulary: avatar, title,
                muted subtitle. */}
            <div className="flex items-center gap-3 pb-2">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-zinc-800 text-zinc-300">
                    <GraduationCap className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                    <p className="text-[15px] font-semibold leading-tight text-zinc-100">Coach</p>
                    <p className="text-[11px] leading-tight text-zinc-500">
                        The learning loop&apos;s inbox — drafts and proposals waiting on your call
                    </p>
                </div>
            </div>

            {empty && (
                <CardShell>
                    <EmptyState
                        compact
                        icon={<Inbox className="h-5 w-5" />}
                        title="Nothing needs your decision right now"
                        description="When the loop learns something worth installing — a repeated setup worth drafting, a skill that should displace another at the cap, a retired twin worth reviving — it lands here as a card. You approve or dismiss; the harness never mutates its own beliefs silently."
                    />
                </CardShell>
            )}

            {drafts.map(d => (
                <DraftCard
                    key={d.id}
                    draft={d}
                    onOpenTrade={onOpenTrade}
                    onDiscard={() => denyDraft(d)}
                    onSave={() => allowDraft(d)}
                />
            ))}

            {proposals.map(p => (
                <CardShell key={p.id} testId={`coach-proposal-${p.id}`}>
                    <div className="flex items-start gap-3">
                        <span className="mt-0.5 shrink-0 rounded-full border border-zinc-700 px-2 py-0.5 text-ui-2xs font-bold uppercase tracking-wider text-zinc-500">
                            {p.kind}
                        </span>
                        <div className="min-w-0 flex-1">
                            <p className="text-[12px] leading-relaxed text-zinc-300">{p.text}</p>
                            <p className="mt-1 text-[11px] text-zinc-600">{timeAgo(p.createdAt)}</p>
                        </div>
                    </div>
                    <div className="mt-3 flex items-center justify-end gap-2">
                        <ActionButton onPress={() => dismissProposal(p)} testId={`coach-proposal-dismiss-${p.id}`}>
                            Dismiss
                        </ActionButton>
                        {applyable.has(p.kind) && (
                            <ActionButton
                                onPress={() => void applyProposal(p)}
                                variant="solid"
                                testId={`coach-proposal-apply-${p.id}`}
                            >
                                {busyId === p.id ? 'Applying…' : 'Apply'}
                            </ActionButton>
                        )}
                    </div>
                </CardShell>
            ))}
        </div>
    );
};

export default CoachThreadPanel;
