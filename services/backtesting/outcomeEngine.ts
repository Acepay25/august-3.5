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
 *
 * The `excludeFormingCandle` option drops the final (still-forming) candle
 * when scanning live data fetched with endTime=now — a hit detected inside
 * the in-progress candle can vanish as it completes.
 */

import { Kline } from '../../types';

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
}

export interface OutcomeResolution {
  outcome: 'WIN' | 'LOSS' | 'OPEN';
  hitTarget: 'NONE' | 'SL' | 'TP1' | 'TP2' | 'TP3';
  exitPrice?: number;
  exitTime?: string;
  exitCandleIndex?: number;
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

  // --- Scan from the entry candle ---
  for (let i = entryTriggeredAtIndex; i < scanKlines.length; i++) {
    const candle = scanKlines[i];
    const candleTimeStr = new Date(candle.time).toISOString();

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
      } else if (!result.slTouched && candle.low <= stopLoss) {
        result.slTouched = true;
        result.slTouchIndex = i;
        result.slTouchTime = candleTimeStr;
        result.slTouchPrice = stopLoss;
        // DON'T break — continue scanning for TP or 150% breach.
      }

      // TPs count as REAL hits even after an SL touch (within the zone).
      if (!result.tpHits.some(h => h.level === 'TP1') && tp1 > 0 && candle.high >= tp1) {
        result.tpHits.push({ level: 'TP1', price: tp1, candleIndex: i, candleTime: candleTimeStr, timeAfterEntry: timeLabel(candle.time) });
        result.breakevenActive = true; // TP1 hit → scale out, stop to breakeven
      }
      // After a breakeven exit the remainder is FLAT — a later rally to
      // TP2/TP3 was never realized by a live position.
      if (!result.tpHits.some(h => h.level === 'TP2') && tp2 > 0 && !result.breakevenHit && candle.high >= tp2) {
        result.tpHits.push({ level: 'TP2', price: tp2, candleIndex: i, candleTime: candleTimeStr, timeAfterEntry: timeLabel(candle.time) });
      }
      if (!result.tpHits.some(h => h.level === 'TP3') && tp3 > 0 && !result.breakevenHit && candle.high >= tp3) {
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
      } else if (!result.slTouched && candle.high >= stopLoss) {
        result.slTouched = true;
        result.slTouchIndex = i;
        result.slTouchTime = candleTimeStr;
        result.slTouchPrice = stopLoss;
      }

      if (!result.tpHits.some(h => h.level === 'TP1') && tp1 > 0 && candle.low <= tp1) {
        result.tpHits.push({ level: 'TP1', price: tp1, candleIndex: i, candleTime: candleTimeStr, timeAfterEntry: timeLabel(candle.time) });
        result.breakevenActive = true;
      }
      if (!result.tpHits.some(h => h.level === 'TP2') && tp2 > 0 && !result.breakevenHit && candle.low <= tp2) {
        result.tpHits.push({ level: 'TP2', price: tp2, candleIndex: i, candleTime: candleTimeStr, timeAfterEntry: timeLabel(candle.time) });
      }
      if (!result.tpHits.some(h => h.level === 'TP3') && tp3 > 0 && !result.breakevenHit && candle.low <= tp3) {
        result.tpHits.push({ level: 'TP3', price: tp3, candleIndex: i, candleTime: candleTimeStr, timeAfterEntry: timeLabel(candle.time) });
        break;
      }
    }
  }

  return result;
};

/**
 * Resolve the neutral scan into the canonical outcome verdict.
 * - Same-candle SL+TP → LOSS (the resting stop filled first).
 * - TP on a later candle after an SL wick → WIN at the highest hit level.
 * - 150% zone breach → LOSS. SL touch with no TP → LOSS. Else OPEN.
 */
export const resolveOutcomeFromScan = (scan: TradeScanResult): OutcomeResolution => {
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
    return {
      outcome: 'WIN',
      hitTarget: lastTp.level,
      exitPrice: lastTp.price,
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
