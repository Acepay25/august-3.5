import { describe, it, expect } from "vitest";
import { calculateEntryTimingScore } from "../services/analysis/EntryTimingService";
import type { TradeAnalysis } from "../types";

/**
 * The stop and the targets get a location check too.
 *
 * Only the ENTRY was ever measured against chart structure, and it was worth
 * 20 of 100 points. The stop and the take-profits - the two numbers that
 * decide the entire P&L - got no location check at all. A take-profit far
 * outside the range the market has actually traded scored exactly like one
 * sitting on a measured level, and a plan could pass as "healthy" with a stop
 * placed in empty air.
 *
 * This module had ZERO test references before now, so the check is exercised
 * through the real entry point rather than a private helper: a private test
 * would prove the arithmetic and not that the warning reaches the result the
 * caller reads.
 *
 * Reported as WARNINGS, not points. The scorer's weighting is a judgement made
 * elsewhere; re-splitting 100 points here would silently change every score in
 * the app.
 */

/**
 * A packet carrying the levels at exactly the prices given, so the distances
 * are predictable. The shape is `collectKeyLevels`' real input - it reads
 * `enhancedKeyLevels.support`/`.resistance` - which the first version of this
 * fixture guessed wrong and the test caught.
 */
const packetWith = (
    support: number[],
    resistance: number[],
    currentPrice = 100,
): never =>
  ({
    marketData: { currentPrice, high24h: currentPrice, low24h: currentPrice },
    // These are always present in a real packet and are read unconditionally,
    // so the fixture supplies them rather than letting the test die on a shape
    // it invented. Two earlier versions of this fixture guessed the packet
    // wrong and the test caught it each time.
    vwap: { "1h": { vwap: currentPrice } },
    advancedVolume: { volumeProfile: { poc: currentPrice } },
    indicators: {
      "1h": { rsi: { rsi14: 50 } },
      "15m": { macd: { histogram: 0, macdLine: 0, signalLine: 0 } },
    },
    momentum: { "1h": { momentum: "neutral" }, "15m": { momentum: "neutral" } },
    enhancedKeyLevels: {
      support: support.map(price => ({ price, source: "pivot" })),
      resistance: resistance.map(price => ({ price, source: "pivot" })),
      pivotPoints: {
        daily: { pp: currentPrice, s1: currentPrice, s2: currentPrice, r1: currentPrice, r2: currentPrice },
      },
    },
    ichimoku: undefined,
  }) as never;

const analysisWith = (over: Partial<TradeAnalysis>): TradeAnalysis =>
  ({
    direction: "Long",
    entryPoints: [{ price: "100" }],
    stopLoss: "98",
    takeProfit: [{ price: "105" }],
    confidence: "Medium",
    ...over,
  }) as unknown as TradeAnalysis;

describe("the stop and targets are checked against real structure", () => {
  it("warns when a take-profit sits outside everything the chart traded", () => {
    // Structure lives 98-102. A TP at 140 is beyond the range entirely.
    const support = [98];
    const resistance = [102];
    const r = calculateEntryTimingScore(
      analysisWith({ takeProfit: [{ price: "140" }] }),
      packetWith(support, resistance)
    );
    const tpWarning = r.warnings.find((w) => /TP1/.test(w));
    expect(tpWarning).toBeDefined();
    // It must say the target is likely invented, and by how much.
    expect(tpWarning).toMatch(/140/);
    expect(tpWarning).toMatch(/invented/i);
  });

  it("warns when a stop sits in empty air", () => {
    // A long's stop belongs near SUPPORT. 60 is nowhere near anything here.
    const support = [98];
    const resistance = [102];
    const r = calculateEntryTimingScore(
      analysisWith({ stopLoss: "60" }),
      packetWith(support, resistance)
    );
    expect(r.warnings.some((w) => /Stop loss 60/.test(w))).toBe(true);
  });

  it("says nothing when the levels ARE grounded", () => {
    // Stop just under support, target just over resistance — both inside 1%.
    const support = [98];
    const resistance = [102];
    const r = calculateEntryTimingScore(
      analysisWith({ stopLoss: "97.5", takeProfit: [{ price: "102.5" }] }),
      packetWith(support, resistance)
    );
    expect(r.warnings.some((w) => /TP1|Stop loss/.test(w))).toBe(false);
  });

  it("checks a Short against the mirror structure", () => {
    // A short's stop belongs near RESISTANCE and its targets near SUPPORT.
    // The same prices that were fine for a Long are wrong for a Short.
    const support = [98];
    const resistance = [102];
    const short = calculateEntryTimingScore(
      analysisWith({ direction: "Short", stopLoss: "104", takeProfit: [{ price: "80" }] }),
      packetWith(support, resistance)
    );
    expect(short.warnings.some((w) => /Stop loss 104/.test(w))).toBe(true);
    expect(short.warnings.some((w) => /TP1 80/.test(w))).toBe(true);
  });

  it("stays silent for a Neutral direction", () => {
    // No direction means no "this side" to check against, and guessing one
    // would invent a warning the plan never made.
    const r = calculateEntryTimingScore(
      analysisWith({ direction: "Neutral", stopLoss: "60" }),
      packetWith([98], [102])
    );
    expect(r.warnings.some((w) => /Stop loss/.test(w))).toBe(false);
  });

  it("does not change the score, only the warnings", () => {
    // The weighting is a judgement made elsewhere. A grounded and an ungrounded
    // plan must score identically, or this change would have silently re-split
    // 100 points across the whole app.
    const support = [98];
    const resistance = [102];
    const grounded = calculateEntryTimingScore(
      analysisWith({ stopLoss: "97.5", takeProfit: [{ price: "102.5" }] }),
      packetWith(support, resistance)
    );
    const invented = calculateEntryTimingScore(
      analysisWith({ stopLoss: "60", takeProfit: [{ price: "140" }] }),
      packetWith(support, resistance)
    );
    expect(invented.score).toBe(grounded.score);
    expect(invented.warnings.length).toBeGreaterThan(grounded.warnings.length);
  });
});
