import { describe, it, expect } from "vitest";

/**
 * One clock, everywhere the model is shown a time.
 *
 * The terminal speaks Philippine time and `utils/timezone.ts` exists so the
 * chart axes, the [ON SCREEN] block, the drawing notes and the desk tools all
 * agree. Three candle-row sites in DeskToolsService were still calling
 * `toISOString()`, i.e. UTC, while the [ON SCREEN] block and the drawing notes
 * beside them printed PHT.
 *
 * The result was a single message carrying the SAME bar at two clocks eight
 * hours apart — a model reading a candle stamped 14:30 and a drawing stamped
 * 22:30 for the same moment, with no way to reconcile them and no marker
 * saying the difference was intentional.
 *
 * `phtStamp` takes MILLISECONDS; the kline feeds carry unix SECONDS. Getting
 * that wrong renders 1970, which is why the seconds->millis conversion is
 * asserted here rather than trusted.
 */

describe("every model-facing candle stamp is PHT", () => {
  const source = `services/analysis/DeskToolsService.ts`;

  it("no candle row is still rendered through toISOString", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(source, "utf8");

    // Whole LINES, not the tail of a match: `const at = new Date().toISOString();`
    // ends at the semicolon, so matching from the call captures only the call
    // and the context that would identify it as machine-facing is lost.
    //
    // Comment lines are excluded. This guard flagged its own explanatory
    // comment first, which names the old call in order to say it was removed —
    // the same "a sentence satisfies the check" trap that hit the calibration
    // surface guard earlier in this repo. A guard that can be satisfied, or
    // tripped, by prose is a guard nobody keeps.
    const lines = src
      .split(/\r?\n/)
      .filter((l) => l.includes("toISOString()"))
      .map((l) => l.trim())
      .filter((l) => !/^(\/\/|\*|\/\*)/.test(l));

    for (const line of lines) {
      const isMachineStamp =
        /checkedAt/.test(line) ||
        /const at = new Date\(\)\.toISOString\(\);/.test(line);
      expect(
        isMachineStamp,
        `model-facing UTC clock left in the file: ${line}`
      ).toBe(true);
    }
  });

  it("renders the same instant as the [ON SCREEN] block", async () => {
    const { phtStamp } = await import("../utils/timezone");

    // A bar the model is shown in BOTH the packet and the chart view.
    const unixSeconds = 1_757_000_000;
    const onScreen = phtStamp(unixSeconds * 1000);

    // Before the fix get_chart_view printed the UTC clock of that same bar.
    const utcHour = new Date(unixSeconds * 1000).getUTCHours();
    const phtHour = Number(
      /(\d{2}):\d{2}$/.exec(onScreen)![1]
    );
    // The two clocks differ, which is the whole point: a test that only
    // asserted "some stamp exists" would pass on either.
    expect((phtHour - utcHour + 24) % 24).toBe(8);
  });

  it("converts kline seconds to the millis phtStamp expects", async () => {
    const { phtStamp } = await import("../utils/timezone");

    const unixSeconds = 1_757_000_000;
    // The bug this guards: passing SECONDS to a millis formatter yields 1970.
    expect(phtStamp(unixSeconds * 1000)).not.toMatch(/1970|Jan 1/);
    expect(phtStamp(unixSeconds * 1000)).toBe(
      phtStamp(new Date(unixSeconds * 1000))
    );
  });

  it("the chart-view row still carries the OHLCV payload it did before", async () => {
    // Changing the clock must not quietly change the SHAPE: the model and the
    // deskToolsChartView suite both parse these rows.
    const fs = await import("node:fs");
    const src = fs.readFileSync(source, "utf8");
    expect(src).toMatch(
      /\$\{phtStamp\(k\.time \* 1000\)\} O\$\{k\.open\} H\$\{k\.high\} L\$\{k\.low\} C\$\{k\.close\} V\$\{k\.volume\}/
    );
    // compactCandleRow keeps its own rounding, unchanged.
    expect(src).toMatch(
      /compactCandleRow[\s\S]{0,400}const stamp = phtStamp\(k\.time \* 1000\);/
    );
  });
});
