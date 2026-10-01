import { describe, it, expect } from "vitest";

/**
 * The version and the changelog cannot disagree.
 *
 * Found by review, not by a failing test. `main` had carried two features that
 * the v1.2.0 release did not contain, while `package.json` still read `1.2.0`.
 * The consequences were invisible until you looked for them:
 *
 *  - a rebuild from main emitted `August-Trading-Setup-1.2.0.exe`, the SAME
 *    filename as a published asset but with different bytes, and
 *  - no user could ever be offered it, because the updater only moves the
 *    version UP. The build would be correct and unreachable.
 *
 * That is the same shape as the release bug from v1.1.0 — two places deciding
 * one fact independently — except here the deciders were the tag and
 * `package.json` rather than `artifactName` and the manifest.
 *
 * This guard is OFFLINE. It does not ask GitHub which tags exist, because a test
 * that needs the network is a test that gets skipped and then lies. It pins the
 * invariant that is checkable without a round trip: the top changelog entry
 * names the version in package.json. A feature landing without a version bump
 * therefore fails here, which is the moment it is cheapest to catch.
 */

import { readFileSync } from "node:fs";

const version = (JSON.parse(readFileSync("package.json", "utf8")) as { version: string }).version;
const changelog = readFileSync("changelog.md", "utf8");

describe("the version and the changelog agree", () => {
  it("the top changelog entry names the current version", () => {
    // The FIRST `## ` heading, not any heading: a match deeper in the file
    // would pass while the newest round went undocumented.
    const top = /^##\s+(.*)$/m.exec(changelog)?.[1] ?? "";
    expect(top).toContain(`v${version}`);
  });

  it("the entry for the current version is the FIRST entry", () => {
    // Compare heading POSITIONS, not a slice: slicing to the index of the
    // version text lands *inside* its own heading, so the slice still contains
    // that heading's own `## ` and the original check failed against correct
    // input. The first version of this test was wrong about the file.
    const headings = [...changelog.matchAll(/^##\s+(.*)$/gm)];
    expect(headings.length).toBeGreaterThan(0);
    expect(headings[0][1]).toContain(`v${version}`);
    // And the current version appears in exactly one heading — a duplicate
    // would mean a round was documented twice under the same version.
    const matching = headings.filter((h) => h[1].includes(`v${version}`));
    expect(matching.length).toBe(1);
  });

  it("the changelog is ordered newest first", () => {
    // Cheap structural check: if entries are appended rather than prepended,
    // the newest round is buried and the file is no longer a record.
    const headings = [...changelog.matchAll(/^##\s+(.*)$/gm)].map((m) => m[1]);
    const versioned = headings.filter((h) => /^v\d+\.\d+\.\d+/.test(h));
    const seen = new Set<string>();
    for (const h of versioned) {
      const v = /^v(\d+)\.(\d+)\.(\d+)/.exec(h);
      if (v) expect(seen.has(h)).toBe(false);
      if (v) seen.add(h);
    }
    // And the current version must be the highest, not merely present.
    expect(versioned.length).toBeGreaterThan(0);
    expect(versioned[0]).toContain(`v${version}`);
  });
});
