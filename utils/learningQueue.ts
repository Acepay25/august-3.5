/**
 * Learning queue (plan ruling 5 /): the gate proposes, the inbox
 * disposes. Lifecycle machinery that wants to change a belief — displace the
 * weakest skill at the library cap, re-scope a conditional skill, revive a
 * retired twin — writes a PROPOSAL here instead of mutating the notebook.
 * A human approves or dismisses each one in Settings → Skills.
 *
 * localStorage-backed like skillDrafts (the approval inbox this shares a
 * surface with); proposals are small, bounded, and safe to lose.
 */

export type LearningProposalKind = 'displacement' | 'rescope' | 'revival' | 'contradiction' | 'demote';

/**
 * The kinds a HUMAN can act on with one press, because the actuation is
 * deterministic and everything it needs is already in `payload`.
 *
 * This is the single source for it: both approval surfaces (the Coach thread and
 * the Strategy Studio's queue strip) used to keep their own copy, which is how
 * `rescope` came to be wired into one and left Dismiss-only in the other.
 * `contradiction` is deliberately absent — its payload is a slug pair
 * (`contradictionSweep.ts:116`) or a list of contradicting notes
 * (`beliefChallenge.ts:119`), so there is no clause text to apply.
 */
export const APPLYABLE_PROPOSAL_KINDS: readonly LearningProposalKind[] = [
    'displacement', 'revival', 'demote', 'rescope',
];

/** Does THIS row carry what its actuation path needs?
 *
 * A per-row question, not a per-kind one: the regime/recurrence pass queues a
 * `rescope` with no clause payload at all (`SkillMemoryService.ts:1622`, while
 * `revise_skill` at `DeskToolsService.ts:2364` writes one). Offering Apply on the
 * clause-less row means a press that can only answer "nothing to apply" — so those
 * rows show Dismiss only, exactly as they did before A2, and the button that IS
 * shown promises something real. */
export const isApplyableProposal = (p: LearningProposal): boolean => {
    if (!APPLYABLE_PROPOSAL_KINDS.includes(p.kind)) return false;
    if (p.kind !== 'rescope') return true;
    const c = p.payload as { ifCondition?: string; thenAction?: string } | undefined;
    return Boolean(c?.ifCondition?.trim() && c?.thenAction?.trim());
};

/** Why an apply wrote nothing. Named by the writer that refused, not guessed by
 *  the UI — the same rule `skillApproval.ts` follows for drafts. */
export type ProposalApplyFailure =
    /** No live skill carries that slug: renamed, retired or deleted since queuing. */
    | 'no-target'
    /** A file with that name exists but no longer parses as a skill. */
    | 'unreadable'
    /** The proposal carries no clause text (a rescope queued without a rewrite). */
    | 'no-clauses'
    /** The clause exists but fails `validateIfThen` — too short or generic. */
    | 'below-bar'
    /** Displacement only: the challenger could not be installed, so the incumbent stands. */
    | 'challenger-blocked'
    /** The write returned but the library does not show the new value. */
    | 'not-written'
    /** The write threw. */
    | 'write-failed';

export type ProposalApplyResult =
    | { applied: true }
    | { applied: false; reason: ProposalApplyFailure; error?: string };

/** What the trader reads when an apply did not apply. One copy for one reason,
 *  shared by both surfaces so they cannot disagree about the same refusal. */
export const proposalApplyFailureMessage = (
    reason: ProposalApplyFailure,
    error?: string,
): string => {
    switch (reason) {
        case 'no-target': return 'No live skill by that name any more — it was renamed, retired or deleted. Nothing was changed.';
        case 'unreadable': return 'That notebook file is no longer a readable skill, so nothing was changed.';
        case 'no-clauses': return 'This proposal carries no rewritten IF/THEN to apply — only the supervisor model can rewrite it.';
        case 'below-bar': return 'The proposed clause is below the bar a new skill must clear (too short or too generic) — nothing was changed.';
        case 'challenger-blocked': return 'The skill that would take the slot could not be created, so the incumbent was left alone.';
        case 'not-written': return 'The library does not show the new clause after the write, so nothing was claimed.';
        case 'write-failed': return `The notebook write failed: ${error ?? 'unknown error'}. Nothing was changed.`;
    }
};

export interface LearningProposal {
    id: string;
    kind: LearningProposalKind;
    /** One-paragraph plain-English claim the human reads. */
    text: string;
    /** Skill (file slug) the proposal acts on, when known. */
    skillSlug?: string;
    /** For displacement: the challenger that would take the slot. */
    relatedSlug?: string;
    createdAt: string;
    /** Dedupe key — the same pair/claim is not re-queued every pass. */
    fingerprint: string;
    /** Machine-readable actuation data (displacement carries the winner's
     *  clauses + prediction so approval can create it verbatim). */
    payload?: Record<string, unknown>;
}

const KEY_PREFIX = 'learning_proposals_v1';
const MAX_PROPOSALS = 30;

const storageKey = (username?: string): string =>
    `${KEY_PREFIX}:${(username || 'default').trim() || 'default'}`;

const read = (username?: string): LearningProposal[] => {
    try {
        const raw = localStorage.getItem(storageKey(username));
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};

const write = (items: LearningProposal[], username?: string): void => {
    try {
        localStorage.setItem(storageKey(username), JSON.stringify(items.slice(-MAX_PROPOSALS)));
        if (typeof window !== 'undefined') window.dispatchEvent(new Event('august-learning-queue'));
    } catch { /* ignore */ }
};

export const listLearningProposals = (username?: string): LearningProposal[] =>
    typeof localStorage === 'undefined' ? [] : read(username);

/**
 * Queue a proposal. Returns null when an identical fingerprint is already
 * pending (dedupe — the contradiction sweep must not re-queue the same pair
 * every week).
 */
export const queueLearningProposal = (
    proposal: Omit<LearningProposal, 'id' | 'createdAt'>,
    username?: string,
): LearningProposal | null => {
    const items = listLearningProposals(username);
    if (items.some(p => p.fingerprint === proposal.fingerprint)) return null;
    const next: LearningProposal = {
        ...proposal,
        id: `lp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        createdAt: new Date().toISOString(),
    };
    write([...items, next], username);
    return next;
};

export const dismissLearningProposal = (id: string, username?: string): void =>
    write(listLearningProposals(username).filter(p => p.id !== id), username);
