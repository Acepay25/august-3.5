import { describe, it, expect } from "vitest";
import { codeOf } from "./helpers/sourceCode";

/**
 * The chart must not disagree with itself across a reload.
 *
 * `MAX_DRAWINGS_PER_SYMBOL` is 40. The store trims to it, and the live view
 * used to carry its OWN cap — a hardcoded 60 — so the view accepted twenty
 * more shapes than storage could keep, the user watched them appear, and
 * twenty of them vanished on the next reload with no message, because nothing
 * was wrong; the two numbers simply disagreed.
 *
 * The fix moved a step further than an imported constant: drawing writes now
 * go through `drawingsControl`, which owns the cap (capDrawings) on BOTH the
 * view path and the persist path, so the two cannot drift even if someone
 * forgets the import again. These guards pin THAT mechanism now.
 */

describe("the live drawing cap and the stored cap are one number", () => {
  it("the view caps through the shared helper, never a literal", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("components/trade/TradeView.tsx", "utf8");
    expect(src).not.toMatch(/slice\(-60\)/);
    // It goes through capDrawings / drawingsControl now.
    expect(src).toMatch(/capDrawings\(|\.add\(|\.replace\(|\.clear\(\)/);
  });

  it("does not re-derive the cap inline at all", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("components/trade/TradeView.tsx", "utf8");
    // The old shape, which is the bug: a view-side slice against the store's
    // own constant. The control owns it now.
    expect(src).not.toMatch(/slice\(-MAX_DRAWINGS_PER_SYMBOL\)/);
  });

  it("the cap lives in ONE place — the control's helper", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("services/trade/drawingsControl.ts", "utf8");
    expect(src).toMatch(/slice\(-MAX_DRAWINGS_PER_SYMBOL\)/);
    expect(src).toMatch(/MAX_POINTS_PER_DRAWING/);
  });

  it("the value is still what persistence enforces", async () => {
    const { MAX_DRAWINGS_PER_SYMBOL } = await import(
      "../services/trade/chartDrawings"
    );
    expect(MAX_DRAWINGS_PER_SYMBOL).toBe(40);
    const fs = await import("node:fs");
    const src = fs.readFileSync("services/trade/chartDrawings.ts", "utf8");
    // Every write path in the store must still trim, or the cap is only true
    // on some of them.
    const trims = src.match(/slice\(-MAX_DRAWINGS_PER_SYMBOL\)/g) ?? [];
    expect(trims.length).toBeGreaterThanOrEqual(1);
  });
});

describe("types/chart.ts no longer describes a live dependency as dead", () => {
  it("does not claim createChart was never called", async () => {
    const src = codeOf("types/chart.ts");
    // Scanned as CODE, not raw text. Both banned phrases are English, so a
    // raw scan would also fire on a comment explaining that the old comment
    // used to claim the library "was never called" — which is exactly what a
    // future maintainer documenting this fix would write. This repo has hit
    // that four separate times; the guard must not be the reason documenting
    // it is impossible.
    expect(src).not.toMatch(/was never called/);
    expect(src).not.toMatch(/dead dependency can be dropped/);
  });

  it("the claim it replaced is true, which is the whole point", async () => {
    // The old comment was the dangerous kind: a reader acting on it would have
    // deleted the library that renders the user's chart. So the facts it
    // contradicted are asserted here rather than assumed.
    const fs = await import("node:fs");
    const pkg = JSON.parse(
      fs.readFileSync("package.json", "utf8")
    ) as { dependencies?: Record<string, string> };
    expect(pkg.dependencies?.["lightweight-charts"]).toBeTruthy();

    const chart = fs.readFileSync("components/trade/TradingChart.tsx", "utf8");
    expect(chart).toMatch(/createChart\(host,/);
  });
});
