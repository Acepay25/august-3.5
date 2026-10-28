/**
 * Shared numeric clamps. Only the two forms that appear verbatim across the
 * codebase live here — a caller with extra semantics (a NaN guard, a rounding
 * step) keeps its own expression rather than being forced through a helper
 * that would silently change it.
 */

/** Clamp to the unit interval [0, 1]. */
export const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

/** Clamp a percentage to [0, 100]. */
export const clamp100 = (n: number): number => Math.max(0, Math.min(100, n));
