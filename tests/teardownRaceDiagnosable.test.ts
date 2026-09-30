import { describe, it, expect } from "vitest";

/**
 * The teardown race is still unexplained, so it must at least be REACHABLE.
 *
 * `EnvironmentTeardownError: Closing rpc while "onUserConsoleLog" was pending`
 * is intermittent and load-dependent. It has now taken a red build twice
 * (PR #39 on 4,165 passing tests; the CI teardown race that
 * `disableConsoleIntercept` was introduced to stop). It could not be reproduced
 * locally in any configuration, and no leaking file has been identified.
 *
 * The mitigation removes the RPC hop the race closes — and in doing so also
 * removes the reporter's per-test console grouping, which is the only evidence
 * that would NAME the culprit. So the symptom is hidden and the cause is
 * unreachable.
 *
 * This job is therefore `continue-on-error: true` and must STAY that way: a
 * diagnostic that can go red turns an intermittent flake into a flaky build,
 * and the gate must never depend on the race not firing.
 */

const CONFIG = "vitest.config.ts";
const CI = ".github/workflows/ci.yml";

describe("the teardown race is diagnosable when it happens", () => {
  it("the mitigation is an escape hatch, not a hardcoded constant", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(CONFIG, "utf8");
    // A bare `true` means the symptom can be switched off but never switched
    // back ON, which is the direction you need to investigate.
    expect(src).toMatch(
      /disableConsoleIntercept: process\.env\.VITEST_CONSOLE_INTERCEPT !== '1'/
    );
    expect(src).not.toMatch(/disableConsoleIntercept: true,/);
  });

  it("defaults to OFF, so the gate never depends on the race not firing", async () => {
    // Asserted as logic, not by setting the variable: the default must hold for
    // every gate and every developer who has not opted in.
    const fs = await import("node:fs");
    const src = fs.readFileSync(CONFIG, "utf8");
    const line = /disableConsoleIntercept: (.*),/.exec(src)?.[1] ?? "";
    expect(line).toContain("!== '1'");
  });

  it("CI actually runs the diagnostic mode", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(CI, "utf8");
    expect(src).toMatch(/VITEST_CONSOLE_INTERCEPT: '1'/);
    expect(src).toMatch(/teardown-race-hunt:/);
  });

  it("the diagnostic can never fail the build", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(CI, "utf8");
    // Both the job and the step. Either one alone still lets a red run through.
    //
    // Scoped to the job's own lines rather than matched across the file with
    // `(?:\s+.*\n)*?`: `\s` includes newlines, so that form backtracks
    // exponentially on a 130-line file and hangs the run — which is exactly
    // what it did the first three times this was executed.
    const jobBlock = src.slice(src.indexOf("  teardown-race-hunt:"));
    const header = jobBlock.slice(0, jobBlock.indexOf("steps:"));
    expect(header).toMatch(/continue-on-error: true/);
    // An explicit character class rather than \s+, so this asserts the
    // step-level flag at ITS indentation instead of matching a newline-plus-
    // anything run somewhere else. `[ ]{8}` rather than ` {8}` because
    // no-regex-spaces only permits a two-space quantifier.
    expect(src).toMatch(/id: hunt\n[ ]{8}continue-on-error: true/);
    // And it must be a SEPARATE job: an extra step inside `verify` would fail
    // the gate the moment the race fired, which is the whole problem.
    expect(src).toMatch(/\n[ ]{2}teardown-race-hunt:/);
  });

  it("an occurrence is captured, not just tolerated", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(CI, "utf8");
    // Tolerating a failure is useless without the evidence. The name is the
    // thing worth more than any number of clean runs.
    expect(src).toMatch(/EnvironmentTeardownError/);
    expect(src).toMatch(/GITHUB_STEP_SUMMARY/);
    expect(src).toMatch(/upload-artifact/);
    // `if: always()` on both evidence steps — an evidence step gated on
    // success never runs on exactly the run it exists for.
    expect((src.match(/if: always\(\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("the config comment still refuses to claim the cause is known", async () => {
    const fs = await import("node:fs");
    // Read the comment as prose: a line break in a wrapped comment is not part
    // of the sentence, and trailing spaces before the break would otherwise
    // leave a double space inside the phrase. Matching across a line wrap is a
    // test of formatting; collapsing first tests the intent.
    const prose = fs
      .readFileSync(CONFIG, "utf8")
      .replace(/\r?\n\s*\/\//g, " ")
      .replace(/\s+/g, " ");
    // The honest framing is the value here. If someone later "fixes" this by
    // writing that the leak is understood, this fails.
    expect(prose).toMatch(/trigger is still unexplained/);
    expect(prose).toMatch(/no leaking file has been identified/);
  });
});
