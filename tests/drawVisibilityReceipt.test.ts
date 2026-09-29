import { describe, it, expect } from "vitest";

/**
 * The draw receipt must not claim the user can see a shape that was clipped.
 *
 * `repaint()` clips every shape to `ctx.rect(0, 0, plotW, plotH)`. A price
 * outside the visible scale projects outside that rect and is discarded
 * silently; a trend whose anchor sits past the visible window never appears at
 * all. The receipt was unconditional — "The user sees these lines now." — so
 * the model was told its work landed and had no way to learn otherwise.
 *
 * The existing repaint test stubs `priceToCoordinate: () => 40`, a CONSTANT.
 * That is precisely why no test could observe an off-screen shape: a check
 * whose measurement is identical across two different states measures the
 * wrong thing. The helper here is therefore a pure function of the range, so
 * both states are actually distinguishable without a canvas.
 */

type Vis = {
  priceLow: number;
  priceHigh: number;
  timeLow: number;
  timeHigh: number;
  barsLoaded: number;
  barsVisible: number;
};

/** The receipt's visibility clause, as the runner computes it. */
const visibility = (
  vis: Vis | null,
  pts: number[][],
): string => {
  if (!vis) return "";
  const inView = (p: number) => p >= vis.priceLow && p <= vis.priceHigh;
  const off = pts.filter((d) => !d.every(inView));
  if (off.length === 0) return " The user sees these now.";
  if (off.length === pts.length)
    return ` WARNING: every price is OUTSIDE the visible range ${Math.round(vis.priceLow)}–${Math.round(vis.priceHigh)} — repaint() clips there, so the user will NOT see this until the chart is scrolled or zoomed out.`;
  return ` WARNING: ${off.length} of ${pts.length} shapes fall outside the visible range ${Math.round(vis.priceLow)}–${Math.round(vis.priceHigh)} and will be clipped until the user scrolls or zooms out.`;
};

const VIS: Vis = {
  priceLow: 59800,
  priceHigh: 62400,
  timeLow: 1_756_000_000,
  timeHigh: 1_757_000_000,
  barsLoaded: 1000,
  barsVisible: 120,
};

describe("the draw receipt tells the truth about visibility", () => {
  it("claims visibility when every price is inside the window", () => {
    expect(visibility(VIS, [[61500]])).toMatch(/sees these now/);
    expect(visibility(VIS, [[59800], [62400]])).toMatch(/sees these now/);
  });

  it("warns when a price is clipped, and names the range", () => {
    const out = visibility(VIS, [[5]]);
    expect(out).toMatch(/OUTSIDE the visible range 59800–62400/);
    // It must not also claim the user sees it. That contradiction is the bug.
    expect(out).not.toMatch(/sees these now/);
  });

  it("counts partial clipping rather than hiding it behind the whole-set case", () => {
    const out = visibility(VIS, [[61500], [5], [62400]]);
    expect(out).toMatch(/1 of 3 shapes fall outside/);
  });

  it("stays silent about visibility when the range is unknown", () => {
    // null means the chart has not fitted a range. Claiming either way would be
    // a guess; claiming nothing is the honest option.
    expect(visibility(null, [[5]])).toBe("");
    expect(visibility(null, [[61500]])).toBe("");
  });

  it("the OLD unconditional receipt is gone from the source", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("services/trade/chatTurnRunner.ts", "utf8");
    // This is the exact lie the fix removes.
    expect(src).not.toMatch(/The user sees these lines now\./);
    expect(src).not.toMatch(/The user sees it now\./);
    // And the replacement must consult the visible range.
    expect(src).toMatch(/snap\?\.visibleRange/);
  });
});

describe("[ON SCREEN] states the window the model is drawing into", () => {
  const snap = {
    candles: [
      { time: 1_757_000_000, open: 1, high: 2, low: 0.5, close: 1.5 },
    ],
    markPrice: 61500,
    levels: [],
    capturedAt: 0,
  };

  it("prints the visible price range and how many bars are loaded", async () => {
    const { describeChartSnapshotForModel } = await import(
      "../services/trade/tradeChatContext"
    );
    const out = describeChartSnapshotForModel({ ...snap, visibleRange: VIS });
    expect(out).toMatch(/Visible window: 59800–62400/);
    expect(out).toMatch(/120 of 1000 loaded bars/);
    // And it says the clip exists, so a draw outside it is foreseeable.
    expect(out).toMatch(/clipped by the renderer/);
  });

  it("omits the line entirely when there is no range, rather than guessing", async () => {
    const { describeChartSnapshotForModel } = await import(
      "../services/trade/tradeChatContext"
    );
    const out = describeChartSnapshotForModel(snap);
    expect(out).not.toMatch(/Visible window/);
  });

  it("the snapshot type carries the range the receipt depends on", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("components/trade/TradingChart.tsx", "utf8");
    expect(src).toMatch(/visibleRange\?:/);
    expect(src).toMatch(/barsLoaded: number;/);
    // And the snapshot must actually populate it from the live chart, or the
    // receipt silently degrades to the old unconditional claim.
    expect(src).toMatch(/visibleRange: readVisibleRange\(\)/);
    // coordinateToPrice maps pixels -> price; priceToCoordinate is the
    // opposite direction and would answer the wrong question.
    expect(src).toMatch(/series\.coordinateToPrice\(0\)/);
  });
});
