/**
 * Direction-aware TP/SL ordering gate (Tier-0 #7, deep-dive 2026-09-15).
 *
 * There was NO ordering validation anywhere in the gate → backtest → outcome
 * chain: a Long with the stop ABOVE the entry passed R:R checks (Math.abs
 * masking) and the outcome scanner credited the inverted plan's "TP below
 * entry" as an instant same-candle WIN. This module is the single rule
 * source, reused by:
 *  - schemas/tradeAnalysis.ts   — sanitize-time REPAIR (mirror + re-sort)
 *  - AccuracyValidationService  — direction-aware R:R validation
 *  - outcomeEngine              — defense-in-depth refusal to score inverted plans
 *
 * Canonical rules (tolerant of missing legs):
 *  - Long:  stopLoss < entry <= tp1 <= tp2 <= tp3
 *  - Short: stopLoss > entry >= tp1 >= tp2 >= tp3
 *
 * A mirror (reflect across the entry) is the repair that best preserves the
 * model's stated risk/reward MAGNITUDES when it flipped a side: a stop 500
 * above a 95000 long entry becomes 500 below it, a TP 1000 below entry
 * becomes 1000 above. Degenerate cases (level exactly on the entry) have no
 * mirror counterpart — they are reported, not fabricated.
 *
 * Hoisted `function` declarations only (TDZ discipline — AGENTS/README pitfalls).
 */

export type LevelOrderDirection = 'Long' | 'Short' | 'Neutral';

export interface LevelOrderingResult {
  /** True when the INPUT ordering was already valid (fixes empty). */
  ok: boolean;
  /** Repaired stop (mirrored when inverted); null/passthrough when missing. */
  correctedStopLoss: number | null;
  /** Repaired take-profits, same length/order slot semantics as the input. */
  correctedTakeProfits: Array<number | null>;
  /** Human-readable description of every repair performed (empty when ok). */
  fixes: string[];
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Round away float mirror noise (2*95000 - 94500.1 → 95499.90000000001). */
function roundLevel(value: number): number {
  return parseFloat(value.toFixed(10));
}

function fmt(value: number | null): string {
  return value === null ? 'missing' : String(value);
}

/**
 * Validate and (where repairable) correct SL/TP ordering for a direction.
 * Returns the repaired levels plus fix strings; NEVER mutates the inputs.
 * `Neutral`, an unusable entry, or missing legs pass through untouched
 * (nothing to validate — the caller decides whether an incomplete plan is OK).
 */
export function sanitizeLevelOrdering(
  direction: LevelOrderDirection,
  entry: number | null | undefined,
  stopLoss: number | null | undefined,
  takeProfitLevels: Array<number | null | undefined>,
): LevelOrderingResult {
  const passthroughStop = isFiniteNumber(stopLoss) ? stopLoss : null;
  const passthroughTps = takeProfitLevels.map((tp) => (isFiniteNumber(tp) ? tp : null));
  if (direction === 'Neutral' || !isFiniteNumber(entry) || entry <= 0) {
    return { ok: true, correctedStopLoss: passthroughStop, correctedTakeProfits: passthroughTps, fixes: [] };
  }

  const fixes: string[] = [];
  const isLong = direction === 'Long';

  // ── Stop loss: must sit on the risk side of the entry ──
  let correctedStopLoss: number | null = passthroughStop;
  if (correctedStopLoss !== null) {
    const stopOnRiskSide = isLong ? correctedStopLoss < entry : correctedStopLoss > entry;
    if (!stopOnRiskSide) {
      if (correctedStopLoss === entry) {
        fixes.push(
          `${direction} stop loss sits exactly on the ${fmt(entry)} entry — zero risk distance; ` +
          'cannot be mirrored, plan left as-is and flagged.',
        );
      } else {
        const mirrored = roundLevel(2 * entry - correctedStopLoss);
        fixes.push(
          `${direction} stop loss ${fmt(correctedStopLoss)} is on the wrong side of the ${fmt(entry)} entry` +
          ` (a ${isLong ? 'long stop must sit below' : 'short stop must sit above'} it)` +
          ` — mirrored to ${fmt(mirrored)}.`,
        );
        correctedStopLoss = mirrored;
      }
    }
  }

  // ── Take profits: must sit on the reward side of the entry ──
  const correctedTakeProfits = passthroughTps.map((tp) => {
    if (tp === null) return null;
    const tpOnRewardSide = isLong ? tp >= entry : tp <= entry;
    if (tpOnRewardSide) return tp;
    const mirrored = roundLevel(2 * entry - tp);
    fixes.push(
      `${direction} take-profit ${fmt(tp)} is on the wrong side of the ${fmt(entry)} entry` +
      ` (a ${isLong ? 'long target must sit at/above' : 'short target must sit at/below'} it)` +
      ` — mirrored to ${fmt(mirrored)}.`,
    );
    return mirrored;
  });

  // ── TP ladder: TP1..TP3 must move progressively into profit ──
  const present = correctedTakeProfits
    .map((tp, index) => ({ tp, index }))
    .filter((item): item is { tp: number; index: number } => item.tp !== null);
  const ladderBroken = present.some((item, i) => {
    const prev = present[i - 1];
    return i > 0 && prev !== undefined && (isLong ? item.tp < prev.tp : item.tp > prev.tp);
  });
  if (ladderBroken) {
    const sortedValues = present.map((p) => p.tp).sort((a, b) => (isLong ? a - b : b - a));
    // The k-th present slot (in original order = TP1, TP2, TP3...) receives
    // the k-th value progressing into profit.
    present.forEach((p, k) => {
      correctedTakeProfits[p.index] = sortedValues[k];
    });
    fixes.push(
      `${direction} take-profit ladder was not monotonic (${present.map((p) => fmt(p.tp)).join(' → ')})` +
      ` — re-sorted so TP1..TP3 ${isLong ? 'ascend' : 'descend'} away from entry.`,
    );
  }

  return { ok: fixes.length === 0, correctedStopLoss, correctedTakeProfits, fixes };
}
