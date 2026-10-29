/**
 * When a notebook change earns another model review.
 *
 * The review is a model call; the notebook changes in bursts (startup seeding,
 * a skill fold, a correction). The rule is "material change": a different
 * index signature, and the cooldown elapsed. Same signature is never material,
 * however long it has been. Pure so the review service and the contract read
 * one rule.
 */

export interface NotebookReviewState {
    at?: number;
    signature?: string;
}

export const NOTEBOOK_REVIEW_COOLDOWN_MS = 15 * 60_000;

export const notebookReviewDue = (
    prior: NotebookReviewState | null | undefined,
    signature: string,
    now: number,
    cooldownMs = NOTEBOOK_REVIEW_COOLDOWN_MS,
): boolean => {
    if (!prior) return true;
    if (prior.signature === signature) return false;
    return now - Number(prior.at ?? 0) >= cooldownMs;
};
