/**
 * Wilson score interval + the confirmation CI gate (plan §8.3d).
 *
 * A 4-1 record at N=5 is statistically indistinguishable from a coin flip,
 * yet the raw ladder confirmed it. This module supplies the interval math
 * and the gate deriveStatus consults IN ADDITION to the raw thresholds (the
 * ladder stays as a floor; the CI is the gate).
 *
 * Pure functions — no storage, no LLM.
 */

/** One-sided 95% Wilson lower bound of a binomial proportion (z=1.645). */
export const wilsonLowerBound = (wins: number, n: number, z = 1.645): number => {
    if (n <= 0) return 0;
    const p = wins / n;
    const z2 = z * z;
    const denom = 1 + z2 / n;
    const centre = p + z2 / (2 * n);
    const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
    return Math.max(0, (centre - margin) / denom);
};

/** One-sided 95% Wilson upper bound (mirror of the lower bound). */
export const wilsonUpperBound = (wins: number, n: number, z = 1.96): number => {
    if (n <= 0) return 1;
    const p = wins / n;
    const z2 = z * z;
    const denom = 1 + z2 / n;
    const centre = p + z2 / (2 * n);
    const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
    return Math.min(1, (centre + margin) / denom);
};

/**
 * Does the followed-evidence record separate from the comparison rate?
 *   repeat skills  → lower bound must sit ABOVE the control (or 50% cold start)
 *   avoid  skills  → upper bound must sit BELOW the control (or 50% cold start)
 *     (an avoid skill "wins" when the setups it steered away from lose)
 * Cold start (no control evidence): require N >= 8 AND the raw interval to
 * exclude 50% on the skill's side.
 */
export const ciGatePasses = (
    kind: 'repeat' | 'avoid',
    wins: number,
    losses: number,
    control?: { wins: number; losses: number },
): boolean => {
    const n = wins + losses;
    if (n <= 0) return false;
    const controlN = control ? control.wins + control.losses : 0;
    if (controlN > 0) {
        // Lift comparison: the followed interval must exclude the control
        // win rate on the skill's side.
        const controlRate = control!.wins / controlN;
        return kind === 'avoid'
            ? wilsonUpperBound(wins, n) < controlRate
            : wilsonLowerBound(wins, n) > controlRate;
    }
    // Cold start: raw interval must exclude 50% AND a minimum sample.
    if (n < 8) return false;
    return kind === 'avoid'
        ? wilsonUpperBound(wins, n) < 0.5
        : wilsonLowerBound(wins, n) > 0.5;
};
