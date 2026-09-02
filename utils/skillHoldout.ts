/**
 * §8.5a — permanent ε-holdout (plan §8.5a).
 *
 * The single most important long-run mechanism in the addendum: once a skill
 * is confirmed it is injected on every matching run, so its controlIds stop
 * growing and lift becomes a historical artifact measured on a window that no
 * longer exists. This module withholds skill injection on ~10% of runs,
 * forever, so the control group keeps accumulating and counterfactual lift
 * estimation stays honest after year one.
 *
 * The decision is seeded per run id and REPRODUCIBLE: the same run id always
 * yields the same decision (hash of the id, no randomness, no clock). It is
 * decided at the single retrieval entry point (getMemoryFilesContext) and the
 * same pure function is read by the pipeline for runStats, so every consumer
 * sees the same classification for the same run.
 *
 * Deliberately NO setting to disable it: a disablable holdout gets disabled
 * the first time a holdout run misses. The 10% expectation is the price of
 * honest lift.
 */

/** FNV-1a 32-bit — stable across runs and platforms. */
const fnv1a = (s: string): number => {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
};

/** ~10% of runs hold out. Missing run id (no per-run seed available) ⇒ no
 *  holdout — better to over-inject than to misclassify a run as held out. */
export const shouldSkillHoldout = (runId: string | undefined): boolean => {
    if (!runId) return false;
    return fnv1a(runId) % 100 < 10;
};
