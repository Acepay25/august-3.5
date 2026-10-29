/**
 * Which skill drafts an automatic supervisor pass may judge.
 *
 * Book-seeded drafts are speculative shelf items, one per starter skill. An
 * automatic pass used to judge every one at startup (12 model calls in the
 * live capture). They are deferred to a MANUAL pass, which the inbox mount
 * runs; every other source keeps its automatic triage.
 */

export const shouldDeferSupervision = (
    draft: { tradeId?: string },
    manual: boolean,
): boolean => !manual && Boolean(draft.tradeId?.startsWith('book:'));
