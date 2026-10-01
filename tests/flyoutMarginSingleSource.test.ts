import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { FLYOUT_VIEWPORT_MARGIN } from "../components/shared/flyoutLayout";

/**
 * One margin for every flyout.
 *
 * Found by review, closing out the constant scan. `ModelPicker` and
 * `SelectMenu` each declared `const VIEWPORT_MARGIN = 8` and independently
 * subtracted it when deciding whether a dropdown fits, flips, or clamps.
 *
 * Unlike most of this class, this one is not merely a maintenance hazard — it
 * is VISIBLE. A dropdown in one component sitting 8px from the screen edge and
 * a dropdown in the other sitting 12px is something a user can see, and it is
 * the kind of inconsistency that gets reported as "the menus look off" with no
 * way to point at the cause.
 *
 * Both are the shared RULE only. The positioning itself remains two
 * implementations, and deliberately so: `ModelPicker` clamps horizontally and
 * is handed a trigger rect, `SelectMenu` measures the window directly and
 * estimates its own height. That difference is stated in the module so the
 * next reader treats it as a decision rather than an oversight.
 */

const picker = readFileSync("components/shared/ModelPicker.tsx", "utf8");
const menu = readFileSync("components/shared/SelectMenu.tsx", "utf8");
const layout = readFileSync("components/shared/flyoutLayout.ts", "utf8");

describe("the flyout margin has one home", () => {
  it("neither component declares its own", () => {
    for (const src of [picker, menu]) {
      expect(src).not.toMatch(/^\s*const VIEWPORT_MARGIN = \d+;/m);
      expect(src).toMatch(/const VIEWPORT_MARGIN = FLYOUT_VIEWPORT_MARGIN;/);
    }
  });

  it("both import the canonical value", () => {
    expect(picker).toMatch(/import \{ FLYOUT_VIEWPORT_MARGIN \} from '\.\/flyoutLayout'/);
    expect(menu).toMatch(/import \{ FLYOUT_VIEWPORT_MARGIN \} from '\.\/flyoutLayout'/);
  });

  it("the value is unchanged", () => {
    // A consolidation that nudged the margin would move every dropdown on
    // screen for no stated reason.
    expect(FLYOUT_VIEWPORT_MARGIN).toBe(8);
    expect(layout).toMatch(/FLYOUT_VIEWPORT_MARGIN = 8/);
  });

  it("both still USE it, so the alias is not decorative", () => {
    // The components kept their local name for readability. Asserting only
    // the import would pass even if every usage had been deleted.
    expect(picker).toMatch(/- VIEWPORT_MARGIN/);
    expect(menu).toMatch(/- VIEWPORT_MARGIN/);
  });

  it("the module says what is NOT shared", () => {
    // The reason the two positioning implementations survive is written down.
    // Without it, the next reader would reasonably "fix" the duplication.
    expect(layout).toMatch(/The positioning itself is still two/);
    expect(layout).toMatch(/decision rather than an oversight/);
  });
});
