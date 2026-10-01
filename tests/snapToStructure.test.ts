import { describe, it, expect } from "vitest";
import {
  findPivots,
  snapPriceToStructure,
  SNAP_TOLERANCE_PCT,
} from "../utils/patternDetection";
import { drawingFromChartTool, PRICE_ALREADY_PAST_PCT } from "../services/trade/chartDrawings";

/**
 * The model names a structure; the code measures it.
 *
 * A seat reading "support at 62150" off a chart that printed 62147.3 is not
 * wrong by a trading decision — it is wrong by a transcription. It cannot see
 * the digits, so it can only ever be approximately right, and the gap between
 * "approximately" and "exactly" is what makes a level miss by a tick and read as
 * an unrespected line.
 *
 * This generalises `draw_detected` (where the code places the pattern the model
 * named) to an arbitrary hline. Three decisions the tests pin, each a way to be
 * wrong:
 *
 * 1. NO structure nearby → the model's price stands. Snapping onto whatever is
 *    nearest would invent a level the chart does not support.
 * 2. Only hlines snap. A trend needs BOTH anchors to keep its slope; moving one
 *    end of a line tilts it rather than correcting it.
 * 3. The "price is already past it" note states a gap and does NOT claim the
 *    level is wrong. A broken level is how a model discovers it is wrong.
 */

/**
 * A flat series with one unambiguous swing low at bar 6 and high at bar 10.
 *
 * The positions are not arbitrary: `findPivots` scans `i` from `leftBars` to
 * `length - rightBars`, so with the default 5/2 a swing below index 5 is never
 * examined. The first version of this fixture put its low at bar 3 and the
 * tests failed for a reason that had nothing to do with snapping.
 */
const series = (): { high: number; low: number }[] => {
  const out = Array.from({ length: 14 }, () => ({ high: 100, low: 100 }));
  out[6] = { high: 103, low: 97 }; // swing low
  out[10] = { high: 111, low: 107 }; // swing high
  return out;
};

describe("snapPriceToStructure", () => {
  it("snaps a near-miss onto the swing the model was describing", () => {
    // Swing low is 97. The model said 97.1 — a transcription, not a decision.
    const r = snapPriceToStructure(97.1, series());
    expect(r.snapped).toBe(true);
    expect(r.price).toBe(97);
    expect(r.pivot?.index).toBe(6);
  });

  it("snaps onto a swing HIGH as readily as a swing low", () => {
    const r = snapPriceToStructure(111.1, series());
    expect(r.snapped).toBe(true);
    expect(r.price).toBe(111);
  });

  it("leaves the price alone when nothing is within tolerance", () => {
    // 200 is nowhere near a swing. Snapping it onto the nearest thing would be
    // inventing structure the chart does not have.
    const r = snapPriceToStructure(200, series());
    expect(r.snapped).toBe(false);
    expect(r.price).toBe(200);
    expect(r.pivot).toBeNull();
  });

  it("respects the tolerance boundary rather than snapping by proximity", () => {
    // Just inside tolerance snaps; just outside must not. A tolerance that is
    // advisory rather than enforced is a tolerance the model cannot reason about.
    const inside = snapPriceToStructure(97 * (1 + (SNAP_TOLERANCE_PCT / 100) * 0.9), series());
    expect(inside.snapped).toBe(true);
    const outside = snapPriceToStructure(97 * (1 + (SNAP_TOLERANCE_PCT / 100) * 1.1), series());
    expect(outside.snapped).toBe(false);
  });

  it("refuses a price that is not a price", () => {
    for (const p of [0, -5, Number.NaN]) {
      const r = snapPriceToStructure(p, series());
      expect(r.snapped).toBe(false);
      expect(r.price).toBe(p);
    }
  });

  it("does not crash on an empty series", () => {
    expect(snapPriceToStructure(100, []).snapped).toBe(false);
  });
});

describe("findPivots is exported and still finds what the detector needs", () => {
  it("returns the swings the pattern detector relies on", () => {
    // Exporting it must not have changed what it finds — a second swing finder
    // finding DIFFERENT pivots is how the two would drift.
    const { highs, lows } = findPivots(series(), 5, 2);
    expect(lows.some((l) => l.price === 97 && l.index === 6)).toBe(true);
    expect(highs.some((h) => h.price === 111 && h.index === 10)).toBe(true);
  });
});

describe("draw_on_chart wires it up", () => {
  const ctx = (over: Record<string, unknown> = {}) => ({
    lastBarTime: 1_700_000_000,
    barSeconds: 60,
    drawnPrice: 100,
    klines: series(),
    ...over,
  });

  it("snaps an hline and says it snapped", () => {
    const { drawings, note } = drawingFromChartTool({ kind: "hline", prices: [97.1] }, ctx());
    expect(drawings[0].points[0].p).toBe(97);
    // Silence here would leave the model believing its own number was drawn.
    expect(note).toMatch(/snapped to the swing/);
  });

  it("does NOT snap a trendline", () => {
    // Both anchors matter: moving one end of a line tilts it instead of
    // correcting it, so a snapped trend is a different line, not a fixed one.
    const { drawings } = drawingFromChartTool(
      { kind: "trend", prices: [97.1, 111.1], startBarsAgo: 10, endBarsAgo: 0 },
      ctx(),
    );
    expect(drawings[0].points[0].p).toBe(97.1);
    expect(drawings[0].points[1].p).toBe(111.1);
  });

  it("notes when price is already well past the level, without calling it wrong", () => {
    // The model drew 200 while price is at 100 — a whole 50% away.
    const { note } = drawingFromChartTool({ kind: "hline", prices: [200] }, ctx({ drawnPrice: 100 }));
    expect(note).toMatch(/is not it/);
    // It must NOT assert the level is invalid: a target far above is normal,
    // and the model has to be free to draw one.
    expect(note).not.toMatch(/invalid|cannot exist/i);
  });

  it("stays quiet when price is sitting on the level", () => {
    // Warning on the ordinary case would train the model to ignore the receipt.
    const { note } = drawingFromChartTool({ kind: "hline", prices: [100.2] }, ctx({ drawnPrice: 100 }));
    expect(note).not.toMatch(/is not it/);
  });

  it("does nothing without candles — an absent snapshot is not an error", () => {
    const { drawings, error, note } = drawingFromChartTool(
      { kind: "hline", prices: [97.1] },
      ctx({ klines: undefined }),
    );
    expect(error).toBeUndefined();
    expect(note).toBe("");
    expect(drawings[0].points[0].p).toBe(97.1);
  });

  it("keeps the stale-drift threshold named rather than inlined", () => {
    // A bare 2 in the comparison would drift from the constant silently.
    expect(PRICE_ALREADY_PAST_PCT).toBeGreaterThan(1);
  });
});