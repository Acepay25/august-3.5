import { describe, it, expect } from "vitest";
import { drawingsFromDetectedPattern } from "../services/trade/chartDrawings";
import type { Kline } from "../types";

/**
 * The model picks WHICH structure; the code decides where it goes.
 *
 * The round trip this removes: a pattern reached the model as the sentence
 * "Shoulders at ~62150.00", and the model passed 62150 back as a price. When
 * the read or the restatement lost a digit, the level was wrong by
 * construction — and nothing could detect it, because the drawing and the
 * pattern were never related to each other. `draw_detected` gives them one
 * source: the anchors the touch count was measured on.
 *
 * Pure: no canvas, no React, so the conversion itself is unit-testable.
 */

const anchor = (price: number, time: number) => ({ price, index: time, time });

describe("drawingsFromDetectedPattern places a shape from measured anchors", () => {
  it("uses the pattern's defining line, not the first and last anchor", () => {
    // A triangle groups anchors BY SIDE. First-to-last across that list would
    // draw from a high to a low that nobody described.
    const r = drawingsFromDetectedPattern({
      name: "Ascending Triangle",
      touches: 3,
      anchors: [
        anchor(150, 1_700_000_000),
        anchor(150, 1_700_057_600),
        anchor(150, 1_700_115_200),
        anchor(120, 1_700_028_800),
        anchor(130, 1_700_086_400),
      ],
      line: { a: anchor(150, 1_700_000_000), b: anchor(150, 1_700_115_200) },
    });

    expect(r.error).toBeUndefined();
    expect(r.drawings).toHaveLength(1);
    // Flat edge -> a LEVEL, not a zero-slope trendline smudge.
    expect(r.drawings[0]!.kind).toBe("hline");
    expect(r.drawings[0]!.points).toHaveLength(1);
    expect(r.drawings[0]!.points[0]!.p).toBe(150);
  });

  it("draws a sloped line with BOTH endpoints", () => {
    const r = drawingsFromDetectedPattern({
      name: "Double Bottom",
      touches: 2,
      line: { a: anchor(61800, 1_700_000_000), b: anchor(62050, 1_700_057_600) },
    });
    expect(r.error).toBeUndefined();
    expect(r.drawings[0]!.kind).toBe("trend");
    expect(r.drawings[0]!.points.map((p) => p.p)).toEqual([61800, 62050]);
    // The anchors carry the BAR TIME, not "bars ago" guesses.
    expect(r.drawings[0]!.points.map((p) => p.t)).toEqual([
      1_700_000_000, 1_700_057_600,
    ]);
  });

  it("carries the measured touch count onto the label", () => {
    const r = drawingsFromDetectedPattern({
      name: "Head and Shoulders",
      touches: 2,
      line: { a: anchor(62150, 1), b: anchor(62200, 2) },
    });
    // The confidence is legible on the chart, not only in the receipt.
    expect(r.drawings[0]!.label).toMatch(/Head and Shoulders/);
    expect(r.drawings[0]!.label).toMatch(/2 touches/);
  });

  it("refuses honestly when the detector kept no anchors", () => {
    const r = drawingsFromDetectedPattern({ name: "Double Top", touches: 2 });
    expect(r.drawings).toHaveLength(0);
    // The message must offer the way forward, not just refuse.
    expect(r.error).toMatch(/draw_on_chart/);
  });

  it("falls back to the first/last anchor only when there is no line", () => {
    const r = drawingsFromDetectedPattern({
      name: "Something",
      touches: 2,
      anchors: [anchor(100, 10), anchor(110, 20), anchor(120, 30)],
    });
    expect(r.error).toBeUndefined();
    expect(r.drawings[0]!.points.map((p) => p.p)).toEqual([100, 120]);
  });

  it("stamps the live mark so staleness is readable later", () => {
    const r = drawingsFromDetectedPattern(
      { name: "X", touches: 3, line: { a: anchor(100, 1), b: anchor(110, 2) } },
      { drawnPrice: 99.5 }
    );
    expect(r.drawings[0]!.drawnPrice).toBe(99.5);
  });

  it("every pattern the DETECTOR emits carries a drawable line", async () => {
    // The gap a hand-built pattern cannot cover: the converter works on a
    // `line` field, but if a detector branch forgets to set one the tool would
    // refuse every pattern of that shape at runtime and no unit test of the
    // converter would notice. So run the real detector and check its OUTPUT.
    const { detectChartPatterns } = await import("../utils/patternDetection");
    const SEG = 16;
    const throughPivots = (anchors: number[]): Kline[] => {
      const prices: number[] = [];
      for (let a = 0; a < anchors.length - 1; a++) {
        for (let s = 0; s < SEG; s++) {
          prices.push(anchors[a] + (anchors[a + 1] - anchors[a]) * (s / SEG));
        }
      }
      prices.push(anchors[anchors.length - 1]);
      return prices.map((p, i) => ({
        time: 1_700_000_000 + i * 60,
        open: p, high: p + 0.1, low: p - 0.1, close: p, volume: 10,
      }));
    };

    // Double top, symmetrical triangle, ascending triangle, and their mirrors.
    const series = [
      throughPivots([100, 130, 110, 130.5, 128]),
      throughPivots([100, 150, 110, 140, 120, 133, 126, 131]),
      throughPivots([110, 150, 120, 150, 130, 150, 140, 145]),
      throughPivots([130, 100, 120, 99.5, 110, 100, 120, 115]),
    ];

    let seen = 0;
    for (const klines of series) {
      for (const p of detectChartPatterns(klines)) {
        seen += 1;
        expect(p.line, `${p.name} carried no drawable line`).toBeDefined();
        expect(p.line!.a.time).toBeGreaterThan(0);
        expect(p.line!.b.time).toBeGreaterThan(0);
        // And the line's prices must be real prices, not the zeros a missing
        // kline index would produce.
        expect(p.line!.a.price).toBeGreaterThan(0);
        expect(p.line!.b.price).toBeGreaterThan(0);
        // The converter must accept what the detector produced.
        const r = drawingsFromDetectedPattern(p);
        expect(r.error, `${p.name}: ${r.error}`).toBeUndefined();
        expect(r.drawings).toHaveLength(1);
      }
    }
    // Guard against the assertion being vacuous: no patterns, no coverage.
    expect(seen).toBeGreaterThan(0);
  });

  it("the tool is declared and reachable, not just implemented", async () => {
    const fs = await import("node:fs");
    // Declared as a tool...
    const tools = fs.readFileSync("services/analysis/DeskToolsService.ts", "utf8");
    expect(tools).toMatch(/name: 'draw_detected'/);
    // ...offered to the dock...
    const runner = fs.readFileSync("services/trade/chatTurnRunner.ts", "utf8");
    expect(runner).toMatch(/'draw_detected'/);
    // ...and passing the panel-tool WHITELIST, which is a separate list from
    // the declaration and silently returns null for anything missing from it.
    // That is the guard that would have made this tool a no-op.
    expect(runner).toMatch(/name !== 'draw_on_chart' && name !== 'draw_detected'/);
  });
});
