import { describe, it, expect } from "vitest";
import { codeOf } from "./helpers/sourceCode";

/**
 * The chart must not disagree with itself across a reload.
 *
 * `MAX_DRAWINGS_PER_SYMBOL` is 40 and the store trims to it at four separate
 * sites. The live view's own cap was a hardcoded 60. So the view accepted
 * twenty more shapes than the store could keep, the user watched them appear,
 * and twenty of them vanished on the next reload — with no message, because
 * nothing was wrong; the two numbers simply disagreed.
 *
 * This is the same class as the rest of this batch: a number that was correct
 * when written and silently stopped describing reality. The fix is one imported
 * constant so the two cannot drift again.
 */

describe("the live drawing cap and the stored cap are one number", () => {
  it("TradeView trims by the shared constant, not a literal", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("components/trade/TradeView.tsx", "utf8");
    // The old shape, which is the bug.
    expect(src).not.toMatch(/slice\(-60\)/);
    expect(src).toMatch(/slice\(-MAX_DRAWINGS_PER_SYMBOL\)/);
  });

  it("imports the constant rather than redeclaring it", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("components/trade/TradeView.tsx", "utf8");
    // A re-declared local `const MAX_DRAWINGS_PER_SYMBOL = 40` would pass the
    // test above and drift again the moment one side changed.
    expect(src).toMatch(
      /import \{[^}]*MAX_DRAWINGS_PER_SYMBOL[^}]*\} from '.*chartDrawings'/
    );
    expect(src).not.toMatch(
      /(?:const|let)\s+MAX_DRAWINGS_PER_SYMBOL\s*=/
    );
  });

  it("the value is still what persistence enforces", async () => {
    const { MAX_DRAWINGS_PER_SYMBOL } = await import(
      "../services/trade/chartDrawings"
    );
    expect(MAX_DRAWINGS_PER_SYMBOL).toBe(40);
    const fs = await import("node:fs");
    const src = fs.readFileSync("services/trade/chartDrawings.ts", "utf8");
    // Every write path must trim, or the cap is only true on some of them.
    const trims = src.match(/slice\(-MAX_DRAWINGS_PER_SYMBOL\)/g) ?? [];
    expect(trims.length).toBeGreaterThanOrEqual(4);
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
