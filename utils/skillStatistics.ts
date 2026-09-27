/**
 * Wilson score interval + the confirmation CI gate.
 *
 * A 4-1 record at N=5 is statistically indistinguishable from a coin flip,
 * yet the raw ladder confirmed it. This module supplies the interval math
 * and the gate deriveStatus consults IN ADDITION to the raw thresholds (the
 * ladder stays as a floor; the CI is the gate).
 *
 * Pure functions — no storage, no LLM.
 */

/**
 * The one-sided 95% normal quantile. ONE constant, used as the default of
 * BOTH bounds: a lower and an upper bound are mirrors of the same one-sided
 * test, so they cannot carry different confidence. They used to (1.645 lower,
 * 1.96 upper — a two-sided value the docstring then described as "one-sided
 * 95%"), which made the AVOID path, whose interval has to stay NARROW to pass,
 * the stricter of the two for no stated reason. A different z is a deliberate
 * two-sided interval and must be passed explicitly.
 */
export const Z_ONE_SIDED = 1.645;

/** One-sided 95% Wilson lower bound of a binomial proportion. */
export const wilsonLowerBound = (wins: number, n: number, z = Z_ONE_SIDED): number => {
    if (n <= 0) return 0;
    const p = wins / n;
    const z2 = z * z;
    const denom = 1 + z2 / n;
    const centre = p + z2 / (2 * n);
    const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
    return Math.max(0, (centre - margin) / denom);
};

/** One-sided 95% Wilson upper bound (mirror of the lower bound, same z). */
export const wilsonUpperBound = (wins: number, n: number, z = Z_ONE_SIDED): number => {
    if (n <= 0) return 1;
    const p = wins / n;
    const z2 = z * z;
    const denom = 1 + z2 / n;
    const centre = p + z2 / (2 * n);
    const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
    return Math.min(1, (centre + margin) / denom);
};

/**
 * Settled CONTROL outcomes required before the lift comparison may be used.
 *
 * A control rate is a point estimate, and a point estimate is not a baseline:
 * at controlN = 1 a single losing control puts the rate at 0, so ANY treated
 * skill clears `lowerBound > 0` and confirms against a comparison that could
 * never have said anything. Five is where a control rate stops being a coin
 * flip on one trade — below it the rate can only take the values 0, 0.5, 1
 * (n = 2) and a single outcome moves it by half — and it matches the sample
 * floor the cold-start bar already puts on the TREATED side, so neither side
 * of the comparison is ever graded off a smaller sample than the other.
 */
export const CONTROL_MIN_SAMPLE = 5;

/** Followed outcomes required before the cold-start band can exclude 50%. */
export const COLD_START_MIN_SAMPLE = 8;

/**
 * Does the followed-evidence record separate from the comparison rate?
 *   repeat skills  → lower bound must sit ABOVE the control (or 50% cold start)
 *   avoid  skills  → upper bound must sit BELOW the control (or 50% cold start)
 *     (an avoid skill "wins" when the setups it steered away from lose)
 * Cold start (no usable control evidence): require N >= 8 AND the raw interval
 * to exclude 50% on the skill's side.
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
    if (controlN >= CONTROL_MIN_SAMPLE) {
        // Lift comparison: the followed interval must exclude the control
        // win rate on the skill's side.
        const controlRate = control!.wins / controlN;
        return kind === 'avoid'
            ? wilsonUpperBound(wins, n) < controlRate
            : wilsonLowerBound(wins, n) > controlRate;
    }
    // Too little control evidence to compare against — fall through to the
    // cold-start bar rather than grade the skill against a 1- or 2-trade rate.
    if (n < COLD_START_MIN_SAMPLE) return false;
    return kind === 'avoid'
        ? wilsonUpperBound(wins, n) < 0.5
        : wilsonLowerBound(wins, n) > 0.5;
};
