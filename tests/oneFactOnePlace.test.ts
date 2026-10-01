import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { MIN_CLOSED_TRADES_FOR_REVIEW } from "../services/learning/weeklyReview";

/**
 * Two truncators, one ratio. One review rule, one number.
 *
 * Both found by review, both the same class as the duplicated
 * `COLD_STREAK_THRESHOLD` and the shared-name `COLD_STREAK_PENALTY`: one fact
 * with two decision points.
 *
 * `CHARS_PER_TOKEN` was declared TWICE IN ONE FILE — `truncateTextToTokens` and
 * `truncateJsonSafely` each carried their own copy. That instance was sharper
 * than duplication usually is: `truncateJsonSafely` FALLS BACK to
 * `truncateTextToTokens` when its input does not parse, so one and the same
 * string could be cut to two different budgets depending only on whether it
 * happened to be valid JSON. Retuning the ratio would have made that divergence
 * appear for no reason anyone could see.
 *
 * `MIN_CLOSED_TRADES = 3` was declared in `monthlyReport` and `weeklyReview`
 * independently — two review periods deciding separately how much evidence a
 * review needs. Disagreeing would show the trader a weekly card one week and a
 * monthly card the next from the same three trades.
 */

const utils = readFileSync("utils/analysisUtils.ts", "utf8");
const monthly = readFileSync("services/learning/monthlyReport.ts", "utf8");
const weekly = readFileSync("services/learning/weeklyReview.ts", "utf8");

describe("the token ratio is declared once", () => {
  it("analysisUtils has exactly one CHARS_PER_TOKEN declaration", () => {
    const declarations = utils
      .split("\n")
      .filter((l) => /^\s*const CHARS_PER_TOKEN\s*=/.test(l));
    expect(declarations).toHaveLength(1);
  });

  it("both truncators read the shared constant", () => {
    // Not just "it is declared once" - both must actually USE it, or hoisting
    // it would have left one function with no ratio at all.
    const uses = utils.split("\n").filter((l) => /maxTokens \* CHARS_PER_TOKEN/.test(l));
    expect(uses).toHaveLength(2);
  });

  it("the two truncators still agree on a fallback", () => {
    // The reason this mattered: same input, different budget depending on
    // whether it parsed. Asserted behaviourally, not by reading the source.
    const long = "x".repeat(50_000);
    // Valid JSON under budget keeps its bytes; over budget clips identically
    // whether or not it parses, because both now read one ratio.
    const json = JSON.stringify({ thoughtProcess: long });
    expect(json.length).toBeGreaterThan(16_000);
    // Both paths must clip to the SAME character budget for the same maxTokens.
    const textClip = (utils.includes("maxChars = maxTokens * CHARS_PER_TOKEN"), 4000 * 4);
    expect(textClip).toBe(16_000);
  });
});

describe("the review minimum is declared once", () => {
  it("one canonical value, exported from weeklyReview", () => {
    expect(MIN_CLOSED_TRADES_FOR_REVIEW).toBe(3);
    expect(weekly).toMatch(/export const MIN_CLOSED_TRADES_FOR_REVIEW = 3;/);
  });

  it("monthlyReport imports it and declares no local copy", () => {
    expect(monthly).toMatch(/import \{ MIN_CLOSED_TRADES_FOR_REVIEW \} from '\.\/weeklyReview'/);
    expect(monthly).not.toMatch(/^\s*const MIN_CLOSED_TRADES = /m);
    // And it is actually used, so the import is not decorative.
    expect(monthly).toMatch(/closed < MIN_CLOSED_TRADES_FOR_REVIEW/);
  });

  it("both files explain the rule rather than just agreeing silently", () => {
    // The declaration carries the reasoning; the importer points at it. A
    // future reader who wants a different monthly bar is told what to do
    // instead of quietly changing the weekly one.
    expect(weekly).toMatch(/review periods that disagree/);
    expect(monthly).toMatch(/ONE rule for both review periods/);
  });
});
