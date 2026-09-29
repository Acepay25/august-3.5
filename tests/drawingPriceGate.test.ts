import { describe, it, expect } from "vitest";

/**
 * A price the chart cannot show must be refused, not drawn.
 *
 * The drawing tools filtered on `Number.isFinite`, which is not a price test.
 * Zero is finite. -1 is finite. Both produced a horizontal line at a value
 * that cannot exist, and the caller reported success — "Drew on the chart" —
 * for a shape the user will never see. The model was told its work landed.
 *
 * `parsePriceWatch` already had the right rule (`> 0`). Rather than write a
 * third copy, both now go through `priceArgError`, which lives with the other
 * pure level rules in tradePlanLevels.
 */

describe("draw_on_chart refuses prices that cannot exist", () => {
  it("rejects zero and negatives on every kind", async () => {
    const { drawingFromChartTool } = await import(
      "../services/trade/chartDrawings"
    );
    const ctx = { lastBarTime: 1_757_000_000, barSeconds: 900 };

    // hline takes one price, trend takes two — both must be gated.
    const cases: Array<[string, unknown[]]> = [
      ["hline", [0]],
      ["hline", [-5]],
      ["trend", [100, 0]],
      ["trend", [0, 100]],
      ["trend", [-1, -2]],
    ];

    for (const [kind, prices] of cases) {
      const r = drawingFromChartTool({ kind, prices }, ctx);
      expect(r.error, `${kind} accepted ${JSON.stringify(prices)}`).toBeTruthy();
      // The load-bearing part: nothing is drawn AND success is not implied.
      expect(r.drawings).toHaveLength(0);
    }
  });

  it("still accepts real prices, and says nothing about the guard", async () => {
    const { drawingFromChartTool } = await import(
      "../services/trade/chartDrawings"
    );
    const ctx = { lastBarTime: 1_757_000_000, barSeconds: 900 };

    const h = drawingFromChartTool({ kind: "hline", prices: [62150.5] }, ctx);
    expect(h.error).toBeUndefined();
    expect(h.drawings).toHaveLength(1);
    expect(h.drawings[0]!.points[0]!.p).toBe(62150.5);

    const t = drawingFromChartTool(
      { kind: "trend", prices: [62000, 62500], startBarsAgo: 40 },
      ctx
    );
    expect(t.error).toBeUndefined();
    expect(t.drawings).toHaveLength(1);
    expect(t.drawings[0]!.points.map((p) => p.p)).toEqual([62000, 62500]);
  });

  it("names WHICH price is wrong, so the model does not re-guess all of them", async () => {
    const { drawingFromChartTool } = await import(
      "../services/trade/chartDrawings"
    );
    const ctx = { lastBarTime: 1_757_000_000, barSeconds: 900 };

    const r = drawingFromChartTool({ kind: "trend", prices: [62000, 0] }, ctx);
    expect(r.error).toMatch(/prices\[1\]/);
  });
});

describe("mark_trade_levels refuses impossible levels", () => {
  it("rejects a zero or negative entry", async () => {
    const { drawingsFromLevelTool } = await import(
      "../services/trade/chartDrawings"
    );

    for (const entry of [0, -1]) {
      const r = drawingsFromLevelTool({ entry, stopLoss: 61000 });
      expect(r.error, `accepted entry ${entry}`).toBeTruthy();
      expect(r.drawings).toHaveLength(0);
    }
  });

  it("drops a bad take-profit but still draws the good ones", async () => {
    const { drawingsFromLevelTool } = await import(
      "../services/trade/chartDrawings"
    );

    // One unusable target should not discard the two valid ones — the model
    // gets partial credit instead of losing the whole plan.
    const r = drawingsFromLevelTool({
      entry: 62000,
      stopLoss: 61000,
      takeProfits: [64000, 0, 66000],
    });
    expect(r.error).toBeUndefined();
    const labels = r.drawings.map((d) => d.label);
    expect(labels).toEqual(["Entry", "SL", "TP1", "TP2"]);
    expect(r.drawings.map((d) => d.points[0]!.p)).not.toContain(0);
  });
});

describe("one rule, three call sites", () => {
  it("the watch path and both drawing paths share the same definition", async () => {
    const { priceArgError, usablePrice } = await import(
      "../services/trade/tradePlanLevels"
    );
    const { parsePriceWatch } = await import("../services/trade/chartTriggers");

    // The rule itself, stated once.
    expect(priceArgError(0)).toMatch(/positive/);
    expect(priceArgError(-1)).toMatch(/positive/);
    expect(priceArgError(Number.NaN)).toMatch(/number/);
    expect(priceArgError('nope')).toMatch(/number/);
    expect(priceArgError(62150)).toBeNull();
    expect(priceArgError('62150')).toBeNull();
    expect(usablePrice(0)).toBeNull();

    // And the watch path still rejects what it always rejected — the
    // refactor must not have loosened a path that was already correct.
    const defaults = { symbol: 'BTCUSDT', makeId: () => 'w1', nowMs: 0 };
    expect(parsePriceWatch({ price: 0, condition: 'above' }, defaults).error)
      .toBeTruthy();
    expect(parsePriceWatch({ price: 112000, condition: 'above' }, defaults).watch)
      .toBeDefined();
  });

  it("no drawing call site re-implements the check", async () => {
    // A second inline `Number.isFinite` filter is how this happened: the
    // drawing tools had their own, looser rule. Pin the single definition.
    const fs = await import("node:fs");
    const src = fs.readFileSync("services/trade/chartDrawings.ts", "utf8");
    // Comment lines are excluded — this file explains the old bug in prose,
    // and prose naming `Number.isFinite` must not count as a second rule.
    const code = src
      .split(/\r?\n/)
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join("\n");
    expect(code).not.toMatch(/filter\(\s*\w+\s*=>\s*Number\.isFinite\(/);
  });
});
