/**
 * Debate protocol markers — the machine-readable control strings seats emit
 * and the pipeline matches/strips. One home so a prompt tweak can never
 * silently break this cross-module contract.
 *
 * These strings appear INSIDE model output. constants/prompts/debatePrompts.ts
 * instructs the model to emit them verbatim — keep both sides in sync.
 */

export const MODERATOR_RETRY_MARKER = '<MODERATOR_RETRY>';
/**
 * Emitted by a seat BEFORE its conviction-retry reply. The
 * pipeline strips the marker AND everything before it in that seat's turn —
 * the truncated attempt is replaced, not concatenated with the retry.
 */
export const CONVICTION_RETRY_MARKER = '<CONVICTION_RETRY>';
export const CONVICTION_RETRY_CUTOFF_RE = /^[\s\S]*?<CONVICTION_RETRY>\s*/i;
export const REPLACEMENT_TIMEOUT_MARKER = '<REPLACEMENT_TIMEOUT>';
export const CLARIFICATION_DONE_MARKER = '<CLARIFICATION_DONE>';
export const CLARIFICATION_SATISFIED_MARKER = '<CLARIFICATION_SATISFIED>';
export const CLARIFICATION_UNSATISFIED_MARKER = '<CLARIFICATION_UNSATISFIED>';

/** Any clarification verdict marker (DONE | SATISFIED | UNSATISFIED). */
export const CLARIFICATION_MARKERS_RE = /<CLARIFICATION_(?:DONE|SATISFIED|UNSATISFIED)>/gi;
export const MODERATOR_RETRY_RE = /<MODERATOR_RETRY>/gi;

/** Failed-verdict wrapper: everything between open and close is discarded. */
export const MODERATOR_ERROR_OPEN_MARKER = '<MODERATOR_ERROR>';
export const MODERATOR_ERROR_BLOCK_RE = /<MODERATOR_ERROR>[\s\S]*?<\/MODERATOR_ERROR>/gi;
/** Debate-end sentinel(s) the model may emit around the verdict. */
export const DEBATE_END_MARKERS_RE = /<\/?DEBATE_END>/gi;
/** Trailing raw-JSON plan after the markdown verdict — cut everything from it. */
export const JSON_PLAN_CUTOFF_RE = /<JSON_PLAN>[\s\S]*/i;

/** System-event line emitted when a mid-debate replacement wait expires. */
export const replacementTimeoutText = (name: string): string =>
    `${REPLACEMENT_TIMEOUT_MARKER} No replacement selected for ${name} within the wait window — the debate continues without them.`;
