import { describe, it, expect } from "vitest";
import {
  countTouchesOnLine,
  detectChartPatterns,
  patternStatus,
} from "../utils/patternDetection";
import type { Kline } from "../types";

/**
 * `touches` was a literal, and the three-touch rule is a claim about geometry.
 *
 * Every branch hard-coded `touches: 3` (2 for double tops) the moment the shape
 * matched, so `patternStatus()` returned "confirmed" for a triangle whose edges
 * nobody counted — and the hybrid packet then told the model it was looking at
 * a confirmed setup, with an "ASSUMPTION, not a setup" caveat that could never
 * fire on a triangle. A confirmation that is not measured is worse than none.
 *
 * `countTouchesOnLine` walks the candles against the line instead. The tests
 * below vary the GEOMETRY and require the answer to follow, because a count
 * that ignores its input is the same defect wearing a measurement's clothes.
 */

const bar = (i: number, high: number, low: number): Kline => ({
  time: 1_700_000_000 + i * 60,
  open: (high + low) / 2,
  high,
  low,
  close: (high + low) / 2,
  volume: 10,
});

/** `n` bars, every one reaching exactly the line's price. */
const onTheLine = (n: number, price: number): Kline[] =>
  Array.from({ length: n }, (_, i) => bar(i, price + 0.1, price - 0.1));

describe("countTouchesOnLine measures, it does not assert", () => {
  it("counts one touch when the market never returns", () => {
    // Bars stay well below the line after the first.
    const klines = [
      bar(0, 101, 99),
      ...Array.from({ length: 20 }, (_, i) => bar(i + 1, 60, 40)),
    ];
    expect(countTouchesOnLine(klines, { price: 100, index: 0 }, { price: 100, index: 20 }, 0.35, "high")).toBe(1);
  });

  it("counts three when the market returns three separate times", () => {
    // Three separate visits: price climbs from the floor to the line, touches
    // it, then falls back to the floor before the next climb. The excursion
    // ENDS at the line rather than dwelling on it — a visit that sat on the
    // line would fuse with the next climb's first bar (also at the line) and
    // book one visit for two, which is a property of the fixture, not of the
    // market. It also starts below the line, since a series whose first bar
    // already sits on it books a spurious opening visit.
    const prices: number[] = [];
    for (let visit = 0; visit < 3; visit++) {
      for (let s = 0; s < 8; s++) prices.push(50 + s * 7);
      prices.push(100);
    }
    const klines = prices.map((p, i) => bar(i, p + 0.1, p - 0.1));
    expect(
      countTouchesOnLine(klines, { price: 100, index: 0 }, { price: 100, index: prices.length - 1 }, 0.35, "high")
    ).toBe(3);
  });

  it("collapses a defended level into ONE touch, not one per bar", () => {
    // Twenty bars pinned to the line is a single visit. Counting 20 here would
    // make every flat level look "confirmed", which is the mirror image of the
    // bug being fixed.
    const klines = onTheLine(20, 100);
    expect(countTouchesOnLine(klines, { price: 100, index: 0 }, { price: 100, index: 19 }, 0.35, "high")).toBe(1);
  });

  it("follows the SLOPED line, not a flat average of it", () => {
    // Line rises 100 -> 200 across 60 bars. Price sits at 50 except for three
    // spikes that reach the line at bars 0, 30 and 60 — at 100, 150 and 200.
    // A function that ignored the slope (used a flat level, or the mean of the
    // endpoints) would miss the middle spike or miscount the ends.
    const SPAN = 60;
    const klines: Kline[] = [];
    for (let i = 0; i <= SPAN; i++) {
      const linePrice = 100 + (i / SPAN) * 100;
      const onLine = i === 0 || i === 30 || i === SPAN;
      klines.push(bar(i, onLine ? linePrice + 0.1 : 51, onLine ? linePrice - 0.1 : 49));
    }
    expect(
      countTouchesOnLine(klines, { price: 100, index: 0 }, { price: 200, index: SPAN }, 0.35, "high")
    ).toBe(3);
  });

  it("degrades safely on a degenerate input rather than throwing", () => {
    // Zero-length and out-of-order anchors both appear in practice once pivots
    // are filtered.
    expect(countTouchesOnLine(onTheLine(5, 100), { price: 100, index: 3 }, { price: 100, index: 3 }, 0.35, "high")).toBe(0);
    expect(countTouchesOnLine(onTheLine(5, 100), { price: 100, index: 4 }, { price: 100, index: 0 }, 0.35, "high")).toBeGreaterThan(0);
  });
});

describe("no branch returns a literal touch count", () => {
  it("detector source contains no hard-coded touches", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("utils/patternDetection.ts", "utf8");
    // Comment lines are excluded: this file explains the old literals in prose,
    // and prose must not read as a second implementation.
    const code = src
      .split(/\r?\n/)
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join("\n");
    expect(code).not.toMatch(/touches:\s*\d/);
  });

  it("every detected pattern carries anchors", () => {
    // findPivots always computed them; they were discarded into a sentence.
    const klines: Kline[] = [];
    for (let i = 0; i < 120; i++) {
      const base = 100 + Math.sin(i / 6) * 12;
      klines.push(bar(i, base + 1, base - 1));
    }
    for (const p of detectChartPatterns(klines)) {
      expect(p.anchors?.length ?? 0).toBeGreaterThan(0);
      for (const a of p.anchors ?? []) {
        expect(Number.isFinite(a.price)).toBe(true);
        expect(Number.isFinite(a.time)).toBe(true);
      }
    }
  });

  it("patternStatus follows the measured count, not a shape name", () => {
    const mk = (touches: number) => ({
      name: "X", type: "neutral" as const, confidence: 0.5,
      description: "", significance: "", touches,
    });
    expect(patternStatus(mk(2))).toBe("assumption");
    expect(patternStatus(mk(3))).toBe("confirmed");
    // A single touch must NOT read as confirmed just because it is a pattern.
    expect(patternStatus(mk(1))).toBe("assumption");
  });
});
