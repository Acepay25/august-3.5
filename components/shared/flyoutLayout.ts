/**
 * How far a flyout (dropdown, popover, menu) must stay from the viewport edge.
 *
 * EXTRACTED, because two shared components each carried `const
 * VIEWPORT_MARGIN = 8` and independently subtracted it when deciding whether a
 * flyout fits, flips, or clamps. Same number, same meaning, two files — so a
 * dropdown in `ModelPicker` and a dropdown in `SelectMenu` would sit at
 * different distances from the screen edge the moment either was edited, and
 * the inconsistency would be visible rather than merely wrong in the source.
 *
 * This is the shared RULE only. The positioning itself is still two
 * implementations and stays that way: `ModelPicker` also clamps horizontally
 * and reports a trigger rect, `SelectMenu` measures the window directly and
 * estimates its own height. Collapsing those is a larger change than the
 * duplication is worth, and is named here so the next reader treats it as a
 * decision rather than an oversight.
 *
 * Anything positioning a flyout should import this rather than re-deriving a
 * number that means "leave a finger's width of breathing room at the edge".
 */
export const FLYOUT_VIEWPORT_MARGIN = 8;
