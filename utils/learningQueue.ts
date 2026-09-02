/**
 * Learning queue (plan §4.6 ruling 5 / §8.2b): the gate proposes, the inbox
 * disposes. Lifecycle machinery that wants to change a belief — displace the
 * weakest skill at the library cap, re-scope a conditional skill, revive a
 * retired twin — writes a PROPOSAL here instead of mutating the notebook.
 * A human approves or dismisses each one in Settings → Skills.
 *
 * localStorage-backed like skillDrafts (the approval inbox this shares a
 * surface with); proposals are small, bounded, and safe to lose.
 */

export type LearningProposalKind = 'displacement' | 'rescope' | 'revival' | 'contradiction' | 'demote' | 'distill';

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
