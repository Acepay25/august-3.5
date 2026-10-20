/**
 * effortDial — who is showing a thinking-tier control right now.
 *
 * `Ctrl/Cmd+Shift+E` (E-51 ruling D-B) writes the tier, so it may fire only
 * where the trader can also SEE the tier they are setting. That is a different
 * question from "is a chat surface mounted": a panel session has no dial,
 * because its seats pick their own models, and a bot turn has none either,
 * because a bot answers on its own config through a transport that never reads
 * this field. A key that edits an unread value is the same lie as a hint for a
 * key nobody bound.
 *
 * So the panel that renders the Effort section registers itself here, and the
 * chord asks. A refcount rather than a boolean because both homes can be
 * mounted at once while one is hidden — the surface that unmounts must not
 * switch the key off for the one still on screen.
 */

let holders = 0;

export const retainEffortDial = (): void => { holders += 1; };

/** Never below zero: a double release (a strict-mode remount, an effect that
 *  ran twice) must not put the count into a state where the chord is off
 *  forever. */
export const releaseEffortDial = (): void => { holders = Math.max(0, holders - 1); };

export const effortDialUp = (): boolean => holders > 0;

/** Test seam — the count is module state, so suites that mount a panel would
 *  otherwise leak it into the next file. */
export const resetEffortDial = (): void => { holders = 0; };
