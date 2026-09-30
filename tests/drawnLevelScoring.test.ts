import { describe, it, expect } from "vitest";
import {
  scoreDrawnLevel,
  levelAccuracy,
  describeLevelAccuracyForModel,
} from "../services/trade/tradePlanLevels";

/**
 * A model can put twenty levels on a chart and every one was unmeasured.
 *
 * `chartDrawings` persists the shapes and `describeDrawingsForModel` narrates
 * them, but nothing ever asked whether price REACHED them. So a seat drawing
 * nonsense and a seat drawing structure were indistinguishable, the user had no
 * way to learn which one they were talking to, and the model itself never
 * learned. This is that measurement.
 *
 * Three decisions the tests below pin, because each is a way to be wrong:
 *
 * - a bar's RANGE, not its close — a level traded through intrabar is reached
 * - only bars AFTER the shape was drawn — otherwise history the model could
 *   already see lets it claim credit for a level that worked later
 * - 'pending' rather than 'untouched' when there is not yet a fair test
 */

const bar = (time: number, high: number, low: number) => ({ time, high, low });

describe("scoreDrawnLevel measures what the market actually did", () => {
  it("counts a level the market traded through intrabar", () => {
    // Every close is BELOW the level, but bar 2's range spans it. A close-only
    // test would have reported this level as never reached.
    const candles = [bar(1, 99, 97), bar(2, 103, 99), bar(3, 99, 97)];
    expect(scoreDrawnLevel(100, candles, 0).verdict).toBe("touched");
  });

  it("counts a level the market reached from below", () => {
    const candles = [bar(1, 100, 98), bar(2, 104, 101), bar(3, 103, 100)];
    expect(scoreDrawnLevel(100, candles, 0).verdict).toBe("touched");
  });

  it("reports untouched with how near it came", () => {
    // Price never gets above 95, so a 100 level is missed by 4%.
    const candles = [bar(1, 95, 93), bar(2, 95, 94), bar(3, 96, 95)];
    const s = scoreDrawnLevel(100, candles, 0);
    expect(s.verdict).toBe("untouched");
    expect(s.missPct).toBeCloseTo(4, 1);
  });

  it("ignores history from BEFORE the level was drawn", () => {
    // The market hit 100 hard at t=1, then stayed far below. Drawing the level
    // at t=5 means the old swing is not evidence about this level — otherwise
    // a model could bank credit for a level that only worked before it
    // thought of it. Three bars after the draw, so the verdict is judgeable
    // and the test is about WHICH bars counted, not about pending.
    const candles = [
      bar(1, 110, 90),
      bar(2, 95, 93),
      bar(6, 95, 94),
      bar(7, 96, 95),
      bar(8, 95, 93),
    ];
    const s = scoreDrawnLevel(100, candles, 5);
    expect(s.verdict).toBe("untouched");
    expect(s.barsSince).toBe(3);
  });

  it("says 'pending' rather than 'untouched' before a fair test", () => {
    // Two bars is not evidence of anything. Calling that 'untouched' is the
    // same measurement failure pointed the other way.
    const s = scoreDrawnLevel(100, [bar(1, 95, 93), bar(2, 95, 94)], 0);
    expect(s.verdict).toBe("pending");
    expect(s.barsSince).toBe(2);
  });

  it("refuses to score a price that is not one", () => {
    for (const p of [0, -5, Number.NaN]) {
      expect(scoreDrawnLevel(p, [bar(1, 9, 1), bar(2, 9, 1), bar(3, 9, 1)], 0).verdict)
        .toBe("untouched");
    }
  });
});

describe("levelAccuracy", () => {
  const touched = { verdict: "touched" as const, missPct: 0, barsSince: 5 };
  const missed = { verdict: "untouched" as const, missPct: 3, barsSince: 5 };
  const pending = { verdict: "pending" as const, missPct: Infinity, barsSince: 1 };

  it("counts only judged levels", () => {
    const r = levelAccuracy([touched, missed, pending, pending]);
    expect(r.judged).toBe(2);
    expect(r.reached).toBe(1);
    expect(r.ratio).toBe(0.5);
  });

  it("returns null, not 0, when nothing has been judged", () => {
    // "0% of nothing" reads as a failure of the model when it is a failure of
    // the sample.
    const r = levelAccuracy([pending, pending]);
    expect(r.ratio).toBeNull();
    expect(r.judged).toBe(0);
  });
});

describe("the model is told its own standing", () => {
  it("names the counts and frames a level as a hypothesis", () => {
    const line = describeLevelAccuracyForModel([
      { verdict: "touched", missPct: 0, barsSince: 5 },
      { verdict: "untouched", missPct: 4, barsSince: 5 },
    ]);
    expect(line).toMatch(/2 judged/);
    expect(line).toMatch(/reached 1/);
    expect(line).toMatch(/hypothesis, not a fact/);
  });

  it("says nothing at all when there is nothing to judge", () => {
    // Silence is the point: a standing score over two fresh bars is noise, and
    // a model that learned to trust it would be learning a habit.
    const line = describeLevelAccuracyForModel([
      { verdict: "pending", missPct: Infinity, barsSince: 1 },
    ]);
    expect(line).toMatch(/say nothing about their accuracy/i);
  });
});

describe("the receipt actually carries it", () => {
  it("the runner scores the model's own hlines and stays silent when pending", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("services/trade/chatTurnRunner.ts", "utf8");
    // Wired, not merely implemented: this is the difference between a
    // measurement that exists and one the model ever sees.
    expect(src).toMatch(/scoreDrawnLevel\(x\.points\[0\]\.p, s\.candles, x\.createdAt \/ 1000\)/);
    expect(src).toMatch(/describeLevelAccuracyForModel/);
    // Guarded so a two-bar sample cannot produce a number.
    expect(src).toMatch(/if \(levelAccuracy\(scores\)\.judged === 0\) return '';/);
  });
});
