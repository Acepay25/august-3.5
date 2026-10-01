import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { PRICE_POLL_INTERVAL_MS } from "../services/trade/levelWatchService";

/**
 * The poll interval is one number, and the loops that are not.
 *
 * Found by review. `PRICE_POLL_INTERVAL_MS = 5_000` was declared in both
 * `levelWatchService` and `watchService`, and the surrounding code is
 * near-identical: both ask "is this symbol's price fresh, and is a poll already
 * in flight?", both read the same `priceBySymbol` map, both guard on the same
 * `pollInFlight` set, and both carry the identical `// feed is fresh` comment.
 *
 * What made this more than a style note: the declaration in `levelWatchService`
 * said, in prose —
 *
 *     Same 5s cadence as watchService's cross-symbol poll.
 *
 * That is the invariant written as a COMMENT. True on the day it was written,
 * and a silent drift the moment either file was edited. An import cannot rot
 * that way, so the interval is now imported rather than asserted.
 *
 * What is deliberately NOT shared: the throttle loops. `levelWatchService`
 * walks armed trade plans; `watchService` walks price watches. Different
 * inputs, different latching, different exported surfaces (`disarm`/`list`,
 * `firedLevelsFor`/`cancelWhere`). Collapsing them is a larger change than the
 * duplication is currently worth — and it is named in the declaration so it is
 * a decision rather than an oversight.
 *
 * `PRICE_MAX_AGE_MS` was checked and left alone: it is unique to `watchService`
 * and answers a different question (has the feed DIED, rather than is it stale).
 */

const level = readFileSync("services/trade/levelWatchService.ts", "utf8");
const watch = readFileSync("services/trade/watchService.ts", "utf8");

describe("the poll interval has one home", () => {
  it("exactly one module declares it", () => {
    const declarers = [level, watch].filter((s) =>
      /^\s*(?:export )?const PRICE_POLL_INTERVAL_MS\s*=/m.test(s),
    );
    expect(declarers).toHaveLength(1);
    expect(level).toMatch(/export const PRICE_POLL_INTERVAL_MS = 5_000;/);
  });

  it("watchService imports it rather than redeclaring it", () => {
    expect(watch).toMatch(/import \{ PRICE_POLL_INTERVAL_MS \} from '\.\/levelWatchService'/);
    // And it still uses the name, so the import is not decorative.
    expect(watch).toMatch(/nowMs - entry\.at < PRICE_POLL_INTERVAL_MS/);
  });

  it("the value is unchanged", () => {
    // A consolidation that quietly re-times the poll would be a behaviour
    // change dressed as a cleanup.
    expect(PRICE_POLL_INTERVAL_MS).toBe(5_000);
  });

  it("PRICE_MAX_AGE_MS stays local to watchService", () => {
    // Checked and deliberately left alone: "is the feed dead" is a different
    // question from "is the feed stale", and only one service asks it.
    expect(watch).toMatch(/const PRICE_MAX_AGE_MS = 10_000/);
    expect(level).not.toMatch(/PRICE_MAX_AGE_MS\s*=/);
  });
});

describe("the invariant is enforced, not asserted in prose", () => {
  it("the old comment claiming the cadences match is gone", () => {
    // A comment that says two numbers are the same is exactly the kind that
    // becomes false without anyone noticing. The import is the check now.
    expect(level).not.toMatch(/Same 5s cadence as watchService/);
  });

  it("the declaration says what IS and is not shared", () => {
    // Stating the limit is what stops the next reader treating the remaining
    // duplicated loop as an oversight they should quietly "fix".
    expect(level).toMatch(/Only the interval is shared/);
    expect(level).toMatch(/different latching/);
  });

  it("the shared interval did not create an import cycle", () => {
    // watchService now reaches into levelWatchService; the reverse edge must
    // not exist, or these two singletons would initialise in an order that
    // depends on which one the bundler reached first.
    expect(level).not.toMatch(/from '\.\/watchService'/);
  });
});
