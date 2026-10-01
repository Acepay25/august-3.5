/**
 * Read a source file for ASSERTION about code, with comments removed.
 *
 * Several guards in this suite assert that a phrase is ABSENT from a source
 * file. That is the right shape for "this text must not say X" — but it has a
 * failure mode that has bitten this repo four separate times: the guard fires
 * on a COMMENT describing the thing it forbids.
 *
 * A comment saying "this used to claim the library was dead" contains "dead".
 * A comment explaining a removed line quotes the removed line. A future
 * maintainer documenting the fix trips the guard that was protecting the fix,
 * and the failure looks like a regression when it is the opposite — the code
 * is fine and the documentation is doing its job.
 *
 * So: scan CODE, not prose. `codeOf()` strips both line and block comments
 * first. Use it for any absence assertion. When you genuinely need to assert
 * something about a COMMENT (the teardown-race test bans a specific stale
 * sentence on purpose), read the file directly and say so in the test.
 *
 * Not a parser, and deliberately not: it is good enough to make a comment
 * invisible to a regex, which is the whole job. It does NOT understand string
 * literals, so a `//` inside a string is treated as a comment. Every current
 * caller scans files that have no such literal; if one appears, this is the
 * thing to replace, not the callers.
 */
import { readFileSync } from "node:fs";

/** Source with `//` and block comments blanked out, line structure preserved. */
export const codeOf = (path: string): string =>
  readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length));

/** True when `needle` appears in the file's CODE, ignoring every comment. */
export const codeContains = (path: string, needle: string | RegExp): boolean => {
  const src = codeOf(path);
  return typeof needle === "string" ? src.includes(needle) : needle.test(src);
};

/**
 * Assert-shaped helper for the common case: a guard that must not see a
 * phrase. Returns the comment-free source so a test can also assert on what
 * IS there in the same read.
 */
export const codeWithout = (path: string): string => codeOf(path);
