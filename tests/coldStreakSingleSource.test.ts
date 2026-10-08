import { describe, it, expect } from "vitest";

/**
 * One business rule, one decision point.
 *
 * Found by review, not by a failing test. `COLD_STREAK_THRESHOLD` — "how many
 * consecutive losses count as a cold streak" — was declared independently in
 * `ModelPerformanceService` (which demotes a model on it) and in
 * `UnderperformerFeedbackService` (which triggers feedback on it). Both read 3,
 * so nothing was broken.
 *
 * That is exactly why it was worth fixing. A duplicated constant that agrees is
 * invisible; it only matters the day someone changes one of them, at which
 * point "feedback fires" and "the model is demoted" disagree with nothing
 * pointing at the seam. Same failure shape as the v1.1.0 updater
 * (`artifactName` vs the manifest) and the v1.2.0 version (the tag vs
 * `package.json`): one fact, two places deciding it.
 *
 * The repo already documents the rule in AGENTS.md under "Canonical
 * single-source modules"; this makes the drift checkable rather than aspirational.
 *
 * The second half of this file used to assert that `UnderperformerFeedbackService`
 * CONSUMED the constant rather than redeclaring it. That module has since been
 * deleted outright — it had zero importers, so its feedback generator never ran
 * and nothing could have read its status. The rule it was policing is now
 * enforced for every module at once by the declaration scan below, which is the
 * stronger form anyway: a new redeclaration anywhere under `services/` fails,
 * not just one in a named file.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** Every .ts under services/, one level deep is enough — the rule is not nested. */
const sourceFiles = (): string[] => {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith(".ts")) out.push(p);
    }
  };
  walk("services");
  return out;
};

describe("cold-streak threshold is declared once", () => {
  it("exactly one module declares it", () => {
    const declarers = sourceFiles().filter((f) =>
      /^export const COLD_STREAK_THRESHOLD|^const COLD_STREAK_THRESHOLD/m.test(readFileSync(f, "utf8")),
    );
    // Named, because a failure that just says "2" leaves the reader hunting.
    expect(declarers.map((f) => f.replace(/\\/g, "/"))).toEqual([
      "services/backtesting/ModelPerformanceService.ts",
    ]);
  });

  it("and the canonical value is still the one the rule assumes", async () => {
    const { COLD_STREAK_THRESHOLD } = await import(
      "../services/backtesting/ModelPerformanceService"
    );
    expect(COLD_STREAK_THRESHOLD).toBe(3);
  });
});
