/**
 * messageVersions — the arithmetic behind reverting and versioning a transcript.
 *
 * WHY A SEPARATE PURE MODULE. One conversation has two homes: the dock stores a
 * `StoredChatEntry`, the Chat surface stores a pipeline `Message`. They do not
 * share field NAMES (`tools` vs `toolEvents`, `reasoning` vs `thoughtProcesses`),
 * so no single function can read both rows. What they MUST share is the
 * mechanics — which generation is live, how a step moves, where a parked tail
 * goes — because that is exactly the part that drifts when it is written twice,
 * and drift here means the two homes disagree about what the trader's thread
 * looks like after a click.
 *
/**
 * So: this module owns the counting and the list surgery and knows nothing about
 * either row's shape. Each host adapts its own fields to `TurnSnapshot` and
 * renders from the snapshot the index selects. Flipping a generation therefore
 * flips the WHOLE turn — the answer, its reasoning, its tool trail, its plan,
 * its tier and its cost — in both homes at once, which is the property that
 * makes the versions worth keeping.
 *
 * Reverting is NON-DESTRUCTIVE by construction: `splitAt` returns the tail
 * rather than discarding it, and the caller is required to store what it gets
 * back. A caller that ignored the tail would be throwing away the trader's own
 * turns, which is the defect this module exists to make awkward.
 */

import type { ToolAction } from '../types/message';
import type { ReasoningEffort } from '../types/provider';

/** One generation of one answer, in the shape BOTH hosts can produce.
 *
 *  The field types are the ROW's own types, not stringified stand-ins: a
 *  superseded generation has to render through the same components as the live
 *  one, and a snapshot that flattened `actions` to text would need a second
 *  renderer — which is how two versions of one answer start looking different
 *  for reasons that have nothing to do with the answer. */
export interface TurnSnapshot {
    text: string;
    /** The thinking trace, already joined to a single string by the caller. */
    reasoning: string;
    /** The per-provider trace map, when the host keeps one — the Chat surface's
     *  `thoughtProcesses`. `reasoning` is what a row RENDERS; this is the
     *  original shape, and without it a round-trip through a generation would
     *  collapse a multi-model run's separate traces into one anonymous seat and
     *  lose which model thought what. */
    processes?: Record<string, string>;
    /** The settled tool trail, one entry per line, in call order. */
    tools: string[];
    /** One payload id per line of `tools`, same order ('' = that line kept no
     *  bytes). Zipped by position, exactly as the row stores it. */
    toolIds: string[];
    /** The model's persisted side effects, verbatim. KEPT, not undone: a
     *  revert changes the transcript and nothing else. */
    actions?: ToolAction[];
    /** Wall-clock ms the answering work took, frozen at settle. */
    workedMs?: number;
    /** The resolved thinking tier this generation was produced under. */
    effort?: ReasoningEffort;
    /** The provider's own words when this generation FAILED. A failed
     *  generation is still a generation — it is what the trader saw. */
    error?: string;
    /** Epoch-ms this generation settled. */
    at: number;
}

/** A row that carries generations. Structural, so both row types satisfy it
 *  without either importing the other. */
export interface Versioned {
    /** Superseded generations, OLDEST FIRST. The live fields on the row are the
     *  newest generation and are deliberately NOT in this array, so a row that
     *  was never re-run has no version furniture at all. */
    gens?: TurnSnapshot[];
    /** Which generation is being shown. Absent means the newest (the live one). */
    gen?: number;
}

/** How many versions this row has: the kept ones plus the live one. */
export const versionCount = (row: Versioned): number => (row.gens?.length ?? 0) + 1;

/** True when there is more than one version to step between — the only
 *  condition under which a stepper may appear. A "1 of 1" control is a control
 *  that advertises a choice the app does not have. */
export const hasVersions = (row: Versioned): boolean => (row.gens?.length ?? 0) > 0;

/** The index being shown, clamped into range. The newest generation is the last
 *  index, and an absent `gen` means exactly that. */
export const activeIndex = (row: Versioned): number => {
    const last = versionCount(row) - 1;
    const raw = typeof row.gen === 'number' && Number.isFinite(row.gen) ? row.gen : last;
    return Math.min(last, Math.max(0, Math.trunc(raw)));
};

/** Step through the versions. WRAPS, like the effort dial: a row with three
 *  generations should be walkable with repeated presses of one key, and a
 *  control that stops at the end forces the trader to reverse direction to get
 *  back to where they started. */
export const stepIndex = (row: Versioned, delta: number): number => {
    const n = versionCount(row);
    if (n <= 1) return 0;
    return ((activeIndex(row) + Math.trunc(delta)) % n + n) % n;
};

/** A prior prompt text, kept because the trader edited the message and the
 *  words they first sent are part of the record. */
export interface PromptEdit {
    text: string;
    at: number;
}

/** Record the prompt a row carried BEFORE this edit, oldest first. */
export const pushEdit = (
    prior: PromptEdit[] | undefined,
    text: string,
    at: number,
): PromptEdit[] => [...(prior ?? []), { text, at }];

/** A turn taken off the live thread by a revert, with enough identity to put it
 *  back in the same place. Generic over the row type so each home parks its own
 *  shape rather than mapping into a common one and losing fields on the way. */
export interface ParkedTail<T> {
    /** The live row the tail was cut AFTER — the restore point. */
    afterId: string;
    at: number;
    rows: T[];
}

/** Cut a thread at `afterId`. Returns the rows to keep AND the rows removed;
 *  the caller must store the second, not drop it.
 *
 *  An unknown id keeps the thread exactly as it is and reports `parked: null`,
 *  because silently truncating on a stale id would destroy a transcript over a
 *  bookkeeping miss. */
export const splitAt = <T extends { id: string }>(
    rows: T[],
    afterId: string,
    at: number = Date.now(),
): { keep: T[]; parked: ParkedTail<T> | null } => {
    const idx = rows.findIndex(r => r.id === afterId);
    if (idx < 0) return { keep: rows, parked: null };
    const tail = rows.slice(idx + 1);
    if (tail.length === 0) return { keep: rows, parked: null };
    return { keep: rows.slice(0, idx + 1), parked: { afterId, at, rows: tail } };
};

/** Put the most recent parked tail back. Newest-first on purpose: a thread that
 *  was reverted twice has two tails, and "bring back the newer turns" means the
 *  one taken away last. Returns the tail it consumed so the caller can say what
 *  came back, and null when there is nothing parked. */
export const popParked = <T>(
    parked: ParkedTail<T>[] | undefined,
): { rows: T[]; rest: ParkedTail<T>[] | null } => {
    if (!parked?.length) return { rows: [], rest: null };
    const last = parked[parked.length - 1];
    return { rows: last.rows, rest: parked.slice(0, -1) };
};

/** Re-attach a parked tail to the thread it came from, dropping any rows whose
 *  id is already live — a turn that was re-run since the revert must not come
 *  back as a second copy of itself. */
export const mergeParked = <T extends { id: string }>(live: T[], parkedRows: T[]): T[] => {
    const have = new Set(live.map(r => r.id));
    return [...live, ...parkedRows.filter(r => !have.has(r.id))];
};

/** How many side effects a parked tail produced, for the honest notice. This
 *  module does NOT undo them — reverting the transcript is one thing; silently
 *  reversing a logged trade or a notebook write is another, and the owner ruled
 *  that a revert changes the messages and nothing else. */
export const countActions = (rows: Array<{ actions?: ToolAction[] }>): number =>
    rows.reduce((n, r) => n + (r.actions?.length ?? 0), 0);
