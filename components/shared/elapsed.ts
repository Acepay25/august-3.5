/**
 * elapsed — the ONE way a duration is printed on a transcript row.
 *
 * "45s" under a minute, "1m 04s" above it (seconds padded so the label's
 * width does not twitch each tick). Both live rows — the thinking row and
 * the analyzed/work row — read the same clock source and must spell the
 * elapsed time the same way, or the two rows beside each other in one turn
 * would count the same second differently.
 */

export const formatElapsed = (seconds: number): string => {
    const s = Math.max(0, Math.round(seconds));
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const rest = s % 60;
    return `${m}m ${String(rest).padStart(2, '0')}s`;
};
