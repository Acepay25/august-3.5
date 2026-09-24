/**
 * Shared trade-outcome engine.
 *
 * The three outcome paths (post-mortem validation, backtest simulation and
 * auto-capture verification) previously each implemented their own scan loop,
 * and the semantics drifted: `simulateFromAnalysisTime` kept counting TP2/TP3
 * after TP1 (no breakeven stop) and left the 150% zone armed after a TP, so
 * the same trade could resolve "WIN @ TP3" in the backtest panel and
 * "WIN @ TP1 + breakeven" in the post-mortem.
 *
 * This module is the single source of truth for the canonical semantics
 * (previously only validateTradeOutcome / AutoCaptureService had them):
 *
 * - Entry trigger: first candle touching the entry level.
 * - SL-first same-candle fills: a resting stop fills before any TP realized
 *   by the same candle → same-candle SL+TP is a LOSS.
 * - Initial SL touch does NOT end the scan — price may recover within the
 *   150% extended-SL zone (documented recovery case → WIN if a TP follows on
 *   a later candle).
 * - 150% zone breach before TP1 → hard-stop LOSS.
 * - TP1 hit → scale out, effective stop moves to breakeven (entry). The
 *   150% zone is DISARMED (the breakeven stop manages the remainder) and a
 *   later breakeven touch means the remainder exited flat — TP2/TP3 are only
 *   realized before that touch.
 * - Outcome priority: TP(s) → zone breach → SL touch → OPEN.
 * - Inverted plans are NEVER scored: a plan whose SL/TP ordering contradicts
 *   the direction (Long stop above entry, target below it, ...) is refused
 *   with an INVALID verdict (see utils/levelOrder) instead of the phantom
 *   same-candle WIN the abs-distance math used to hand out.
 *
 * The `excludeFormingCandle` option drops the final (still-forming) candle
 * when scanning live data fetched with endTime=now — a hit detected inside
 * the in-progress candle can vanish as it completes.
 */

import { Kline } from '../../types';
import { sanitizeLevelOrdering } from '../../utils/levelOrder';

export type ScanTpLevel = 'TP1' | 'TP2' | 'TP3';

export interface TradeScanHit {
  level: ScanTpLevel;
  price: number;
  candleIndex: number;
  candleTime: string;
  /** Duration since the entry candle (entry-relative label). */
  timeAfterEntry: string;
}

export interface TradeScanResult {
  entryTriggered: boolean;
  entryTriggeredAtIndex: number;
  /** 150% extended-SL price (the hard-stop level before TP1). */
  extendedSlPrice: number;
  maxDrawdown: number;
  slTouched: boolean;
  slTouchIndex?: number;
  slTouchTime?: string;
  slTouchPrice?: number;
  extendedSlExceeded: boolean;
  slExceededIndex?: number;
  slExceededTime?: string;
  tpHits: TradeScanHit[];
  /** TP1 hit → scale out; the effective stop moved to breakeven. */
  breakevenActive: boolean;
  breakevenHit: boolean;
  breakevenIndex?: number;
  breakevenTime?: string;
  /** Defense-in-depth (Tier-0 #7): the plan's SL/TP ordering violates the
   *  direction even after the sanitizer — the scan is refused outright
   *  (nothing triggered), so an inverted plan can never earn WIN/LOSS. */
  planInvalid?: boolean;
  /** Human-readable reason(s) from utils/levelOrder when `planInvalid`. */
  planInvalidReason?: string;
}

export interface OutcomeResolution {
  outcome: 'WIN' | 'LOSS' | 'OPEN' | 'INVALID';
  hitTarget: 'NONE' | 'SL' | 'TP1' | 'TP2' | 'TP3';
  exitPrice?: number;
  exitTime?: string;
  exitCandleIndex?: number;
  /** Present when `outcome === 'INVALID'` — why the plan was not scored. */
  invalidReason?: string;
}

/** Format duration in human-readable form (shared by all engines). */
export const formatDurationMs = (ms: number): string => {
  const minutes = Math.floor(ms / 60000);
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours > 0) return `${hours}h ${remainingMinutes}m`;
  return `${minutes}m`;
};

/**
 * Scan candles for entry trigger, SL/zone touches and TP hits using the
 * canonical semantics above. Callers map the neutral result onto their own
 * output shapes (post-mortem validation, backtest simulation, auto-capture).
 *
 * `options.startIndex` skips entry detection (the caller already resolved a
 * multi-entry trigger) and treats that candle as the entry candle.
 */
export const scanTradeOutcome = (
  klines: Kline[],
  entryPrice: number,
  stopLoss: number,
  takeProfits: number[],
  isLong: boolean,
  options?: { excludeFormingCandle?: boolean; startIndex?: number },
): TradeScanResult => {
  const scanKlines = options?.excludeFormingCandle && klines.length > 1 ? klines.slice(0, -1) : klines;
  const [tp1, tp2, tp3] = takeProfits;

  const slDistance = Math.abs(entryPrice - stopLoss);
  const extendedSlPrice = isLong
    ? stopLoss - slDistance * 0.5  // 150% of SL distance below entry for Long
    : stopLoss + slDistance * 0.5; // 150% of SL distance above entry for Short

  const empty: TradeScanResult = {
    entryTriggered: false,
    entryTriggeredAtIndex: -1,
    extendedSlPrice,
    maxDrawdown: 0,
    slTouched: false,
    extendedSlExceeded: false,
    tpHits: [],
    breakevenActive: false,
    breakevenHit: false,
  };

  // --- Inverted-plan refusal (defense-in-depth, Tier-0 #7) ---
  // The AI-boundary sanitizer already repairs SL/TP ordering; a plan that
  // still arrives inverted bypassed it (prose-parsed, hand-edited, legacy
  // row). The abs/zone math below cannot tell a Long whose "TP" sits BELOW
  // entry from a real target, so scanning it would hand out phantom
  // same-candle WINs. Refuse to score: nothing triggers, and
  // resolveOutcomeFromScan maps the scan to INVALID (never WIN/LOSS).
  // Levels of 0/NaN mean "leg absent" (caller convention), not a price.
  const orderCheck = sanitizeLevelOrdering(
    isLong ? 'Long' : 'Short',
    Number.isFinite(entryPrice) && entryPrice > 0 ? entryPrice : null,
    Number.isFinite(stopLoss) && stopLoss > 0 ? stopLoss : null,
    takeProfits.map((tp) => (Number.isFinite(tp) && tp > 0 ? tp : null)),
  );
  if (!orderCheck.ok) {
    return { ...empty, planInvalid: true, planInvalidReason: orderCheck.fixes.join('; ') };
  }

  if (scanKlines.length === 0) return empty;

  // --- Entry trigger: first candle touching the entry level ---
  // Limit-fill semantics (matches all three engines): a Long fills when
  // price comes DOWN to the level; a Short fills when price goes UP to it.
  let entryTriggeredAtIndex = -1;
  if (options?.startIndex !== undefined) {
    entryTriggeredAtIndex = options.startIndex;
  } else {
    for (let i = 0; i < scanKlines.length; i++) {
      const candle = scanKlines[i];
      if (isLong) {
        if (candle.low <= entryPrice) { entryTriggeredAtIndex = i; break; }
      } else {
        if (candle.high >= entryPrice) { entryTriggeredAtIndex = i; break; }
      }
    }
  }
  if (entryTriggeredAtIndex === -1) return empty;
  empty.entryTriggered = true;
  empty.entryTriggeredAtIndex = entryTriggeredAtIndex;

  const result = empty;
  const entryCandleTime = scanKlines[entryTriggeredAtIndex].time;
  const timeLabel = (t: number): string => formatDurationMs(t - entryCandleTime);

  // ORDER-AWARE ENTRY-CANDLE CREDITING (look-ahead fix). A limit entry fills
  // SOMEWHERE INSIDE its candle, so a TP that prints on the SAME candle may
  // have touched BEFORE the fill — a 1h bar can wick up through TP then drop to
  // fill the limit, and the old code banked that as a WIN that never traded.
  // Only the candle we FILL on is ambiguous, and only when it did not open
  // already executable (open ≤ entry for a Long / ≥ entry for a Short → the
  // whole bar is genuinely post-fill). `startIndex` callers hand us an
  // ALREADY-filled position, so that candle is never gated.
  const entryCandle = scanKlines[entryTriggeredAtIndex];
  const entryCandleAmbiguous = options?.startIndex === undefined
    && !(isLong ? entryCandle.open <= entryPrice : entryCandle.open >= entryPrice);

  // --- Scan from the entry candle ---
  for (let i = entryTriggeredAtIndex; i < scanKlines.length; i++) {
    const candle = scanKlines[i];
    const candleTimeStr = new Date(candle.time).toISOString();
    // A take-profit may only be banked on the fill candle if that candle opened
    // executable — otherwise the touch could have preceded the fill (see above).
    const canCreditTp = i !== entryTriggeredAtIndex || !entryCandleAmbiguous;

    if (isLong) {
      const dd = (entryPrice - candle.low) / entryPrice * 100;
      result.maxDrawdown = Math.max(result.maxDrawdown, dd);

      // 150% extended zone exceeded — hard stop LOSS (disarmed after TP1;
      // the breakeven stop manages the remainder).
      if (!result.breakevenActive && candle.low <= extendedSlPrice) {
        result.extendedSlExceeded = true;
        result.slExceededIndex = i;
        result.slExceededTime = candleTimeStr;
        break;
      }

      // After TP1 the effective stop is breakeven (entry).
      if (result.breakevenActive) {
        if (!result.breakevenHit && candle.low <= entryPrice) {
          result.breakevenHit = true;
          result.breakevenIndex = i;
          result.breakevenTime = candleTimeStr;
        }
      } else if (candle.low <= stopLoss) {
        // Track the LATEST touch index, not the first: price can wick the
        // stop, recover, then touch it again. resolveOutcomeFromScan
        // compares the TP candle index against slTouchIndex, so a same-candle
        // SL+TP after a re-touch must resolve LOSS (the resting stop fills
        // first) — recording only the first touch turned those into WINS.
        result.slTouched = true;
        result.slTouchIndex = i;
        result.slTouchTime = candleTimeStr;
        result.slTouchPrice = stopLoss;
        // DON'T break — continue scanning for TP or 150% breach.
      }

      // TPs count as REAL hits even after an SL touch (within the zone).
      if (canCreditTp && !result.tpHits.some(h => h.level === 'TP1') && tp1 > 0 && candle.high >= tp1) {
        result.tpHits.push({ level: 'TP1', price: tp1, candleIndex: i, candleTime: candleTimeStr, timeAfterEntry: timeLabel(candle.time) });
        result.breakevenActive = true; // TP1 hit → scale out, stop to breakeven
      }
      // After a breakeven exit the remainder is FLAT — a later rally to
      // TP2/TP3 was never realized by a live position.
      if (canCreditTp && !result.tpHits.some(h => h.level === 'TP2') && tp2 > 0 && !result.breakevenHit && candle.high >= tp2) {
        result.tpHits.push({ level: 'TP2', price: tp2, candleIndex: i, candleTime: candleTimeStr, timeAfterEntry: timeLabel(candle.time) });
      }
      if (canCreditTp && !result.tpHits.some(h => h.level === 'TP3') && tp3 > 0 && !result.breakevenHit && candle.high >= tp3) {
        result.tpHits.push({ level: 'TP3', price: tp3, candleIndex: i, candleTime: candleTimeStr, timeAfterEntry: timeLabel(candle.time) });
        break; // All TPs hit — stop scanning
      }
    } else {
      // Short position (mirrored)
      const dd = (candle.high - entryPrice) / entryPrice * 100;
      result.maxDrawdown = Math.max(result.maxDrawdown, dd);

      if (!result.breakevenActive && candle.high >= extendedSlPrice) {
        result.extendedSlExceeded = true;
        result.slExceededIndex = i;
        result.slExceededTime = candleTimeStr;
        break;
      }

      if (result.breakevenActive) {
        if (!result.breakevenHit && candle.high >= entryPrice) {
          result.breakevenHit = true;
          result.breakevenIndex = i;
          result.breakevenTime = candleTimeStr;
        }
      } else if (candle.high >= stopLoss) {
        // Latest-touch semantics — see the Long branch above.
        result.slTouched = true;
        result.slTouchIndex = i;
        result.slTouchTime = candleTimeStr;
        result.slTouchPrice = stopLoss;
      }

      if (canCreditTp && !result.tpHits.some(h => h.level === 'TP1') && tp1 > 0 && candle.low <= tp1) {
        result.tpHits.push({ level: 'TP1', price: tp1, candleIndex: i, candleTime: candleTimeStr, timeAfterEntry: timeLabel(candle.time) });
        result.breakevenActive = true;
      }
      if (canCreditTp && !result.tpHits.some(h => h.level === 'TP2') && tp2 > 0 && !result.breakevenHit && candle.low <= tp2) {
        result.tpHits.push({ level: 'TP2', price: tp2, candleIndex: i, candleTime: candleTimeStr, timeAfterEntry: timeLabel(candle.time) });
      }
      if (canCreditTp && !result.tpHits.some(h => h.level === 'TP3') && tp3 > 0 && !result.breakevenHit && candle.low <= tp3) {
        result.tpHits.push({ level: 'TP3', price: tp3, candleIndex: i, candleTime: candleTimeStr, timeAfterEntry: timeLabel(candle.time) });
        break;
      }
    }
  }

  return result;
};

/**
 * Resolve the neutral scan into the canonical outcome verdict.
 * - Inverted plan (scan refused) → INVALID: no credit, never WIN/LOSS.
 * - Same-candle SL+TP → LOSS (the resting stop filled first).
 * - TP on a later candle after an SL wick → WIN at the highest hit level.
 * - 150% zone breach → LOSS. SL touch with no TP → LOSS. Else OPEN.
 */
export const resolveOutcomeFromScan = (scan: TradeScanResult): OutcomeResolution => {
  if (scan.planInvalid) {
    return {
      outcome: 'INVALID',
      hitTarget: 'NONE',
      invalidReason: scan.planInvalidReason,
    };
  }
  if (scan.tpHits.length > 0) {
    const firstTp = scan.tpHits[0];
    const sameCandleSlFill = scan.slTouched && firstTp.candleIndex === scan.slTouchIndex;
    if (sameCandleSlFill) {
      return {
        outcome: 'LOSS',
        hitTarget: 'SL',
        exitPrice: scan.slTouchPrice ?? undefined,
        exitTime: scan.slTouchTime,
        exitCandleIndex: scan.slTouchIndex,
      };
    }
    const lastTp = scan.tpHits[scan.tpHits.length - 1];
    // The FULL position did not exit at the last TP. TP1 is a partial exit
    // (stop moves to breakeven), so a run to TP2/TP3 captured roughly half at
    // TP1 and the remainder at the last target. Returning lastTp.price made
    // every caller multiply the full entry→last-TP move by full size —
    // measured 1.67× on a three-TP ladder — and it fed `realizedR`, which
    // types/trade.ts calls the only R safe to accumulate into the skill
    // ledger, plus position sizing and batchBacktest.avgRR.
    //
    // PnL is linear in price, so the blended exit is the midpoint of TP1 and
    // the last target. Same arithmetic OutcomeAutopilotService already used
    // for its own resolution; the shared engine is the right home so the two
    // cannot disagree about the same trade. A single-TP run is unchanged
    // (first === last), and so is the TP1→breakeven case, which resolves on
    // the breakeven branch above with its own exit price.
    const scaleOutEntryTp = scan.tpHits[0];
    const blendedExit = scan.tpHits.length > 1
      && Number.isFinite(scaleOutEntryTp.price) && Number.isFinite(lastTp.price)
      ? (scaleOutEntryTp.price + lastTp.price) / 2
      : lastTp.price;
    return {
      outcome: 'WIN',
      hitTarget: lastTp.level,
      exitPrice: blendedExit,
      exitTime: lastTp.candleTime,
      exitCandleIndex: lastTp.candleIndex,
    };
  }
  if (scan.extendedSlExceeded && scan.slExceededIndex !== undefined) {
    return {
      outcome: 'LOSS',
      hitTarget: 'SL',
      exitPrice: scan.extendedSlPrice,
      exitTime: scan.slExceededTime,
      exitCandleIndex: scan.slExceededIndex,
    };
  }
  if (scan.slTouched && scan.slTouchIndex !== undefined) {
    return {
      outcome: 'LOSS',
      hitTarget: 'SL',
      exitPrice: scan.slTouchPrice ?? undefined,
      exitTime: scan.slTouchTime,
      exitCandleIndex: scan.slTouchIndex,
    };
  }
  return { outcome: 'OPEN', hitTarget: 'NONE' };
};

/** Realized excursion over the live position window, in raw price percent. */
export interface TradeExcursions {
  /** Worst move against the position while it was open. 0 = never adverse. */
  maePercent: number;
  /** Best move in favor before the exit. 0 = never favorable. */
  mfePercent: number;
}

/**
 * MAE / MFE bounded to the candles the position actually occupied:
 * `[entryIndex, exitIndex]`, inclusive.
 *
 * Deliberately NOT derived from `TradeScanResult.maxDrawdown`. The scan keeps
 * running past an SL touch on purpose (it must still observe later TP prints
 * and the 150% zone breach, and `resolveOutcomeFromScan` compares those
 * indices), so `maxDrawdown` accumulates movement from candles a closed
 * position never held. Callers that already know the exit pass through here.
 *
 * Raw price percent — the trade row applies leverage where it is known.
 */
export const computeTradeExcursions = (
  klines: Kline[],
  entryIndex: number,
  exitIndex: number,
  entryPrice: number,
  isLong: boolean,
): TradeExcursions | null => {
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) return null;
  if (!Number.isInteger(entryIndex) || !Number.isInteger(exitIndex)) return null;
  const from = Math.max(0, entryIndex);
  const to = Math.min(klines.length - 1, Math.max(from, exitIndex));
  // An empty window means there was no tape to measure, which is not the same
  // fact as "the position never moved". Report null, never a clean-looking 0.
  if (to < from) return null;

  let maePercent = 0;
  let mfePercent = 0;
  for (let i = from; i <= to; i++) {
    const { high, low } = klines[i];
    // Skip a malformed bar rather than folding it in: Math.max(0, NaN) is NaN,
    // so one bad candle sticks for every later bar and the whole pair reports
    // NaN — which the trade card then prints as "worst −NaN%".
    if (!Number.isFinite(high) || !Number.isFinite(low)) continue;
    if (isLong) {
      maePercent = Math.max(maePercent, ((entryPrice - low) / entryPrice) * 100);
      mfePercent = Math.max(mfePercent, ((high - entryPrice) / entryPrice) * 100);
    } else {
      maePercent = Math.max(maePercent, ((high - entryPrice) / entryPrice) * 100);
      mfePercent = Math.max(mfePercent, ((entryPrice - low) / entryPrice) * 100);
    }
  }
  return { maePercent, mfePercent };
};
