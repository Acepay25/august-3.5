import { describe, it, expect } from "vitest";
import { codeOf } from "./helpers/sourceCode";

/**
 * The AI trendlines now exist ON the chart, not only in a list of prices.
 *
 * `analyzeWithAI` is a second AI path with its own prompt and its own extra
 * provider call. Its result was rendered as an HTML row of price ranges, and
 * the comment above that row claimed the row "cannot drift from what the chart
 * format would have drawn" — a statement about a drawing that did not exist.
 * The comment described an aspiration and was written as a fact.
 *
 * Rather than delete a working feature, the shapes are now handed to the chart
 * as `modelDrawings`. The service already returns DATA-SPACE endpoints, so this
 * is exactly the conversion the comment always assumed. The side row remains as
 * the readable summary of the same numbers.
 *
 * Folding rather than deleting is also what keeps the second path honest: the
 * alternative was either a dead service or a duplicate of the desk tools.
 */

const LIVE = "components/market/LiveMarket.tsx";

describe("the AI trendlines are drawn", () => {
  it("passes them to the chart as model drawings", async () => {
    const src = codeOf(LIVE);
    // The single fact this change is about.
    expect(src).toMatch(/modelDrawings=\{trendlineDrawings\}/);
    expect(src).toMatch(/const \[trendlineDrawings, setTrendlineDrawings\]/);
  });

  it("builds the shapes from the service's own data-space endpoints", async () => {
    const src = codeOf(LIVE);
    // startTime/startPrice/endTime/endPrice are already unix-seconds + price,
    // which is what a ChartDrawing point is. Re-deriving them from candles
    // would be the drift the old comment claimed to prevent.
    expect(src).toMatch(/t: line\.startTime, p: line\.startPrice/);
    expect(src).toMatch(/t: line\.endTime, p: line\.endPrice/);
  });

  it("no longer claims a drawing it does not make", async () => {
    const { readFileSync } = await import("node:fs");
    // TWO READS, on purpose.
    //
    // The banned phrase is still in the file — as a COMMENT explaining what the
    // old comment wrongly said. That is correct and should stay: a reader who
    // finds the phrase needs to know it was removed and why. So the ban applies
    // to CODE only, while the replacement is asserted in the PROSE, because
    // both live in comments and only the ban needed protecting.
    //
    // A single raw read of the file passes or fails on which of those two you
    // happened to point the test at, which is how this suite ended up
    // documenting a phrase it also forbade.
    const code = codeOf(LIVE);
    expect(code).not.toMatch(/cannot drift from what the\s+chart format would have drawn/);

    const prose = readFileSync(LIVE, "utf8");
    // The replacement must say the shapes ARE on the chart, so the row reads as
    // a summary rather than as the feature itself.
    expect(prose).toMatch(/SHAPES themselves are on/);
  });

  it("the second path still exists, deliberately", async () => {
    const src = codeOf(LIVE);
    // Folding is not deleting: this is still a distinct analysis, and removing
    // the call would delete a working feature rather than fix a defect.
    expect(src).toMatch(/analyzeWithAI\(/);
  });

  it("colours come from the shared palette, not a second copy", async () => {
    const src = codeOf(LIVE);
    // A local hex map here would be a second definition of the app's colours,
    // which is how they drift.
    expect(src).toMatch(/MODEL_COLOR_NAMES/);
  });
});
