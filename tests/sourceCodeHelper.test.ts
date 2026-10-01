import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { codeOf, codeContains } from "./helpers/sourceCode";

/**
 * The guards must not fire on prose describing what they forbid.
 *
 * This repo has hit that exact failure FOUR times — `calibrationSurface`, then
 * `oneClock`, then the stale `chart.ts` comment, then my own AI-trendlines
 * guard. In every case a comment explaining the fix contained the very text the
 * guard was banning, and the suite went red for documentation that was correct.
 *
 * It is the worst kind of brittleness because the failure is BACKWARDS: a
 * maintainer documenting the fix trips the guard protecting the fix, and the
 * error looks like a regression when nothing is wrong with the code.
 *
 * This suite uses a real temp file rather than a string, so the assertions are
 * about the helper's behaviour on disk and not about a fixture that could
 * itself drift from the parsing rules.
 */

const write = (contents: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "srccode-"));
  const p = join(dir, "sample.ts");
  writeFileSync(p, contents, "utf8");
  return p;
};

describe("codeOf hides comments", () => {
  it("a line comment does not count as code", () => {
    const p = write(`const a = 1;\n// const a = 2;\nexport { a };\n`);
    expect(codeOf(p)).not.toContain("const a = 2");
    expect(codeOf(p)).toContain("const a = 1");
  });

  it("a block comment does not count as code", () => {
    const p = write("/** was never called */\nexport const x = 1;\n");
    expect(codeOf(p)).not.toContain("was never called");
    expect(codeOf(p)).toContain("export const x = 1");
  });

  it("a multi-line block comment is removed whole", () => {
    const p = write("/**\n * slice(-60) used to live here\n * across two lines\n */\nconst c = 3;\n");
    const out = codeOf(p);
    expect(out).not.toContain("slice(-60)");
    expect(out).toContain("const c = 3");
  });

  it("preserves line count, so a line-anchored regex still works", () => {
    // Line numbers matter: a guard anchored to `^\s*const X = 3` must keep
    // matching a declaration that was on line 4, not be shifted to line 1.
    const p = write("a\nb\nc\nconst d = 4;\n");
    const out = codeOf(p);
    expect(out.split("\n")).toHaveLength(5);
    expect(/^\s*const d = 4;/m.test(out)).toBe(true);
  });
});

describe("the trap this exists to prevent", () => {
  it("documenting the removed text does not fail the guard", () => {
    // Exactly the shape that has bitten four times: the code no longer
    // contains the phrase, and a comment explains that it once did.
    const p = write(
      `// The old comment claimed the library "was never called" — that was\n` +
      `// false and the comment is gone.\n` +
      `export const chart = createChart(host);\n`,
    );
    expect(codeContains(p, /was never called/)).toBe(false);
    // And the thing the guard is actually protecting is still there.
    expect(codeContains(p, /createChart/)).toBe(true);
  });

  it("but a guard that must ban a COMMENT can still do so on the raw file", () => {
    // Some bans are genuinely about prose — the teardown-race test forbids a
    // stale sentence in a comment. That test reads the file directly, and this
    // proves the escape hatch is real rather than theoretical.
    const p = write("// cannot drift from what the chart format would have drawn\nconst k = 1;\n");
    const raw = readFileSync(p, "utf8");
    expect(raw).toMatch(/cannot drift from/);
    expect(codeOf(p)).not.toMatch(/cannot drift from/);
  });
});

describe("the helper is honest about its limits", () => {
  it("documents the string-literal limitation it does not handle", () => {
    // A `//` inside a string is treated as a comment. Stated in the module doc
    // so the next person knows what to replace if a caller needs it.
    const src = readFileSync(join(__dirname, "helpers", "sourceCode.ts"), "utf8");
    expect(src).toMatch(/does NOT understand string/);
    expect(src).toMatch(/no such literal/);
  });
});
