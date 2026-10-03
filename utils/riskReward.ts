/**
 * The single definition of a PLANNED risk/reward ratio.
 *
 * This app computed R:R four different ways and showed all of them to the
 * user: nearest-TP ÷ stop (analysisUtils), `takeProfits[0]` ÷ stop by ARRAY
 * ORDER (proposedTrade, ScenarioSimulator), and highest-TP-hit ÷ stop
 * (BacktestingService). The first two disagree whenever the model emits its
 * targets out of order — which it does — so the same trade could read 1.8R on
 * the card and 3.1R in the journal.
 *
 * Planned R:R is now defined once, here: distance to the take-profit CLOSEST
 * to entry, over distance to the stop. That is the "reward if the first target
 * fills" a trader actually quotes, and it is deliberately independent of array
 * order.
 *
 * The realized ratio in `BacktestingService` is a DIFFERENT quantity (which
 * target the market actually reached) and must not be routed through here.
 */

const finiteOrNull = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null;

/** Nearest-to-entry target, or null when none is usable. */
export const firstTargetDistance = (
    entry: number,
    takeProfits: Array<number | null | undefined>,
): number | null => {
    const distances = takeProfits
        .map(finiteOrNull)
        .filter((tp): tp is number => tp !== null)
        .map(tp => Math.abs(tp - entry))
        .filter(d => d > 0);
    return distances.length > 0 ? Math.min(...distances) : null;
};

export interface RiskRewardInput {
    entry: unknown;
    stopLoss: unknown;
    takeProfits: Array<number | null | undefined>;
}

/**
 * Planned reward:risk, rounded to 2 decimals. Returns 0 — never NaN, never a
 * negative — when the levels are missing, equal, or have no usable target, so
 * callers can keep using `0` as "not computable" the way the gate clamps
 * already do.
 */
export const plannedRiskReward = (input: RiskRewardInput): number => {
    const entry = finiteOrNull(input.entry);
    const stop = finiteOrNull(input.stopLoss);
    if (entry === null || stop === null) return 0;

    const risk = Math.abs(entry - stop);
    if (risk <= 0) return 0;

    const reward = firstTargetDistance(entry, input.takeProfits);
    if (reward === null) return 0;

    return Math.round((reward / risk) * 100) / 100;
};

/** Same input, expressed as the raw price distances the ticket needs. */
export const riskRewardDistances = (input: {
    entry: number;
    stopLoss: number;
    takeProfits: Array<number | null | undefined>;
}): { risk: number; reward: number; ratio: number } => {
    const risk = Math.abs(input.entry - input.stopLoss);
    const reward = firstTargetDistance(input.entry, input.takeProfits) ?? 0;
    return {
        risk,
        reward,
        ratio: risk > 0 && reward > 0 ? Math.round((reward / risk) * 100) / 100 : 0,
    };
};

/**
 * The ONE display shape for a planned ratio: `2.4:1`, REWARD FIRST, always
 * over one unit of risk.
 *
 * Before this, the same number reached the trader three ways — `1:2.0` and
 * `R:R: 1:2` (risk-first, which reads as "one unit of reward for two of risk"
 * to anyone skimming) against `2.00:1` (reward-first). Order is the whole
 * meaning of a ratio, so it now lives in one function.
 *
 * `digits` is a required argument, as in `fmtPercent`: the shape is canonical,
 * the precision belongs to the surface. A canvas chip quotes `3.0:1`, the
 * verdict markdown quotes `1.37:1` because that is what `plannedRiskReward`
 * actually computed, and neither should be re-rounded to fit the other.
 */
export const fmtRiskReward = (ratio: number, digits: number): string =>
    Number.isFinite(ratio) ? `${ratio.toFixed(digits)}:1` : '—';

/**
 * The REALIZED multiple — `avg R 1.80` — which is a different quantity from
 * the planned ratio above (BacktestingService asks which target the market
 * actually reached; this module asks what the ticket promised). It deliberately
 * has no `:1` suffix: a multiple of risk is not a ratio of two prices, and
 * printing it as one is how the two got confused in the first place.
 */
export const fmtRMultiple = (r: number): string =>
    Number.isFinite(r) ? r.toFixed(2) : '—';
