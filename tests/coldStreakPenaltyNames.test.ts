import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Two rules that once shared a name now say what they are.
 *
 * Found by review, and it is the same failure class as the duplicated
 * `COLD_STREAK_THRESHOLD` that preceded it — just wearing the opposite mask.
 * That one was the *same* rule declared twice; this one is *different* rules
 * wearing the *same* name:
 *
 *   ModelPerformanceService  COLD_STREAK_PENALTY = 0.5   multiplicative: score *= 0.5
 *   providerFitness          COLD_STREAK_PENALTY = 0.05  additive: winRate - streak * 0.05
 *
 * A reader meeting `COLD_STREAK_PENALTY` in either file would reasonably
 * assume both compute the same adjustment, and would carry one file's
 * semantics into the other during a refactor. The values are ten apart and the
 * units are not comparable, so that mistake would not look like a mistake.
 *
 * Renamed to say which is which. The threshold fix and this one are the same
 * job: the cold-streak rule family had three decision points where it should
 * have had one idea.
 */

const performance = readFileSync("services/backtesting/ModelPerformanceService.ts", "utf8");
const fitness = readFileSync("services/learning/providerFitness.ts", "utf8");

/** A name may appear in a comment explaining the rename; it may not be code. */
const codeReferences = (src: string, name: string): string[] =>
  src
    .split("\n")
    .filter((l) => new RegExp(`\\b${name}\\b`).test(l) && !l.trim().startsWith("//"))
    .map((l) => l.trim());

describe("the two cold-streak penalties cannot be confused again", () => {
  it("neither file uses the ambiguous name in code", () => {
    expect(codeReferences(performance, "COLD_STREAK_PENALTY")).toEqual([]);
    expect(codeReferences(fitness, "COLD_STREAK_PENALTY")).toEqual([]);
  });

  it("the multiplicative one says it multiplies", () => {
    expect(performance).toMatch(/const COLD_STREAK_SCORE_MULTIPLIER = 0\.5/);
    expect(performance).toMatch(/score \*= COLD_STREAK_SCORE_MULTIPLIER/);
  });

  it("the additive one says it is subtracted from win rate", () => {
    expect(fitness).toMatch(/const COLD_STREAK_WIN_RATE_PENALTY = 0\.05/);
    expect(fitness).toMatch(/\* COLD_STREAK_WIN_RATE_PENALTY/);
  });

  it("the value did not change in either file", () => {
    // A rename that quietly rescales a penalty would be a behaviour change
    // disguised as a cleanup. Pinned so the two cannot be confused for THAT.
    expect(performance).toContain("COLD_STREAK_SCORE_MULTIPLIER = 0.5");
    expect(fitness).toContain("COLD_STREAK_WIN_RATE_PENALTY = 0.05");
  });
});

describe("the cold-streak rule family now has one idea", () => {
  it("the threshold is declared once, and both penalties carry a matching note", () => {
    // The threshold lives in ModelPerformanceService and is imported by the
    // feedback service; the two penalties are genuinely different rules and now
    // say so. What must not come back is a second threshold or a shared name.
    const declarers = [performance, fitness].filter((s) =>
      /^\s*(?:export )?const COLD_STREAK_THRESHOLD/m.test(s),
    );
    expect(declarers).toHaveLength(1);
    // Each renamed penalty points at the other, so the next reader is told
    // rather than left to guess.
    expect(performance).toMatch(/shared with providerFitness/);
    expect(fitness).toMatch(/ModelPerformanceService also used/);
  });
});
