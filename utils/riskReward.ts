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
