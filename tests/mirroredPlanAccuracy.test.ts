import { describe, it, expect } from "vitest";

/**
 * A plan the code mirrored is not the model's plan.
 *
 * `utils/levelOrder` repairs an inverted stop or target by reflecting it
 * across the entry, because that preserves the stated risk/reward magnitudes
 * for a number the model mistyped. The schema flags the repair
 * (`levelsCorrected` + `levelFixes`) — and, until now, nothing ever READ it.
 * The mirrored plan then reached the model-performance ledger and the Brier
 * confidence calibration as if the model had proposed it, so a model that
 * consistently got its side backwards scored as though it were right: the
 * mirror hid the error and the ledger recorded the corrected plan.
 *
 * The flag was not even reachable from application code — it existed on the
 * zod schema and not on `TradeAnalysis` — so no amount of care at the writer
 * could have excluded it.
 */

const ACCURACY = "hooks/useTradeLogging.ts";
const TYPES = "types/analysis.ts";

describe("a mirrored plan does not train the model", () => {
  it("the flag is reachable from application code at all", async () => {
    // The premise. Without it on TradeAnalysis, `analysis.levelsCorrected` is
    // a type error and the exclusion cannot be written at all.
    const fs = await import("node:fs");
    const types = fs.readFileSync(TYPES, "utf8");
    expect(types).toMatch(/levelsCorrected\?: boolean;/);
    expect(types).toMatch(/levelFixes\?: string\[\];/);
  });

  it("the model-performance ledger skips a corrected plan", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(ACCURACY, "utf8");
    // The providers list that feeds trackTradeOutcome is emptied for a
    // corrected plan, rather than each writer re-checking the flag — one gate,
    // so the two ledgers cannot drift apart.
    expect(src).toMatch(
      /const levelsMirrored = analysis\.levelsCorrected === true;/
    );
    expect(src).toMatch(
      /const providers = levelsMirrored \? \[\] : getTradeProviders\(trade\);/
    );
  });

  it("the Brier confidence calibration skips it too", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(ACCURACY, "utf8");
    // This is the one that matters most for the user: confidence-vs-outcome is
    // the number that says how well a seat's confidence tracks reality, and a
    // mirrored plan would put a fabricated outcome into it.
    expect(src).toMatch(
      /if \(message\.analysis\?\.confidence && !message\.analysis\.levelsCorrected\)/
    );
  });

  it("a plan that needed no correction is unaffected", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(ACCURACY, "utf8");
    // Guard against the exclusion over-reaching into every write.
    expect(src).toMatch(/analysis\.levelsCorrected === true/);
    // `=== true` rather than truthiness: an absent flag is the normal case and
    // must mean "not corrected", not "unknown, so skip".
    expect(src).not.toMatch(/if \(analysis\.levelsCorrected\)/);
  });
});

describe("the mirror itself is unchanged and still justified", () => {
  it("levelOrder still repairs rather than rejects, and says why", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("utils/levelOrder.ts", "utf8");
    // This is NOT being changed. Mirroring is the right repair for a mistyped
    // number because it preserves the stated risk/reward magnitudes; the bug
    // was that the repair was invisible to the accuracy writers, not that it
    // happened.
    expect(src).toMatch(/mirrored to/);
    // And the flag is what travels with it.
    expect(src).toMatch(/ok:\s*boolean/);
  });

  it("the trade still reaches the journal", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(ACCURACY, "utf8");
    // Hiding the trade would be its own lie: the user took it. The exclusion is
    // about who gets credit, not about whether it happened.
    expect(src).not.toMatch(/levelsMirrored[\s\S]{0,200}return;[\s\S]{0,80}(without|skip)/i);
    expect(src).toMatch(/providers\.forEach/);
  });
});
