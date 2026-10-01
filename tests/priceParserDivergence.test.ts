import { describe, it, expect } from "vitest";
import { usablePrice, priceArgError } from "../services/trade/tradePlanLevels";
import { readFileSync } from "node:fs";

/**
 * The drawing tools now read prices the way the rest of the app reads them.
 *
 * Found by review, hunting the "one fact, two places" class. Three modules
 * implement the same rule — "a value is a usable price iff it is finite and
 * greater than zero" — and they were NOT the same function:
 *
 *   chartData.ts    parsePriceCanonical(String(v))  then the >0 gate
 *   keyLevels.ts    parsePriceCanonical(raw)        then the >0 gate
 *   tradePlanLevels Number(raw)                     then the >0 gate
 *
 * `parsePriceCanonical` is `analysisUtils.parsePrice`, which strips commas and
 * understands ranges. Plain `Number()` does not — so "69,000" is NaN.
 *
 * The user-visible bug: a model writing `prices: ["69,000"]`, which is a
 * perfectly ordinary way to write a price and a format this app accepts
 * everywhere else, was told "prices[0] must be a positive number". Nothing in
 * that message mentions the comma, so the model had no way to work out what it
 * had done wrong and would emit the same string again.
 *
 * The fix was not to invent comma handling. `analysisUtils.parsePrice` already
 * does it and two of the three call sites already used it — the drawing tools
 * were simply the one that never got the memo.
 */

describe("a comma is a formatting detail, not an invalid price", () => {
  it("reads a thousands-separated price", () => {
    expect(usablePrice("69,000")).toBe(69000);
    expect(usablePrice("1,234.5")).toBe(1234.5);
  });

  it("still reads a plain number exactly as before", () => {
    // The fast path must not have changed: numbers are numbers.
    expect(usablePrice(69000)).toBe(69000);
    expect(usablePrice(0)).toBeNull();
    expect(usablePrice(-1)).toBeNull();
    expect(usablePrice(Number.NaN)).toBeNull();
  });

  it("accepts the same text the canonical parser accepts", () => {
    // A range is a price the app already resolves to its midpoint everywhere
    // else; the drawing tools should not be stricter.
    expect(usablePrice("94500 - 4h")).toBe(94500);
  });

  it("still refuses things that are not prices at all", () => {
    // The fix must not have turned into leniency for its own sake.
    expect(usablePrice("no number here")).toBeNull();
    expect(usablePrice("")).toBeNull();
    expect(usablePrice(null)).toBeNull();
    expect(usablePrice(undefined)).toBeNull();
    expect(usablePrice({})).toBeNull();
    expect(usablePrice(0)).toBeNull();
    expect(usablePrice(-5)).toBeNull();
  });

  it("accepts the comma, so the error is no longer misleading", () => {
    expect(priceArgError("69,000", "prices[0]")).toBeNull();
  });
});

describe("the drawing tools are no longer the odd one out", () => {
  it("every price gate routes through the canonical parser", () => {
    // The defect was three implementations of one rule. This pins the
    // implementation count so a fourth cannot appear.
    const src = readFileSync("services/trade/tradePlanLevels.ts", "utf8");
    expect(src).toMatch(/import \{ parsePrice \} from '\.\.\/\.\.\/utils\/analysisUtils'/);
    // The old bare Number() coercion is what made this module stricter than its
    // two siblings. It must not come back.
    const body = src.slice(src.indexOf("export const usablePrice"));
    expect(body.slice(0, 400)).not.toMatch(/typeof raw === 'number' \? raw : Number\(raw\)/);
  });
});
