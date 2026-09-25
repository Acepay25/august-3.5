/**
 * Only CI may build and publish a release.
 *
 * The published installer is the artifact every user installs, so where it is
 * BUILT is a correctness property, not a preference. `.github/workflows/
 * release.yml` runs on a GitHub windows runner and builds the installer after
 * the whole gate chain: typechecks, tests, lint, vite build, source-map
 * rejection, e2e smoke, boot probe, render probe, packaged installer smoke,
 * and the Authenticode signature gate. A build made anywhere else bypasses
 * every one of those.
 *
 * `package.json` used to carry an `electron:release` script that ran
 * `electron-builder --publish always` on whichever machine invoked it, and no
 * workflow called it — so it existed purely to let a laptop publish, over a
 * CI-built release, having passed nothing. It now refuses and prints the tag
 * flow.
 *
 * The assertions below are the durable part: they fail if a `--publish` ever
 * reappears in a local script, which is the only way this could regress.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { execFileSync } from 'child_process';

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string; scripts: Record<string, string> };
const scripts = pkg.scripts;
const releaseSrc = readFileSync('.github/workflows/release.yml', 'utf8');

describe('releases are built by CI only', () => {
    it('no npm script can publish', () => {
        // The whole guard. A local `--publish` is a laptop uploading the binary
        // users install, with no gate run against it.
        const publishers = Object.entries(scripts)
            .filter(([, cmd]) => /--publish/.test(cmd))
            .map(([name]) => name);
        expect(publishers, `these scripts publish locally: ${publishers.join(', ')}`).toEqual([]);
    });

    it('electron:release refuses rather than shipping', () => {
        expect(scripts['electron:release']).toBe('node scripts/release-is-ci-only.cjs');
        // And it actually refuses: a script that only prints would be a trap
        // that looks closed.
        let code = 0;
        try {
            execFileSync(process.execPath, ['scripts/release-is-ci-only.cjs'], { stdio: 'ignore' });
        } catch (e) {
            code = (e as { status?: number }).status ?? 0;
        }
        expect(code).toBe(1);
    });

    it('the refusal explains itself and prints the real path', () => {
        // The message goes to stderr, and it is the only thing the person
        // running it will see — so it has to name the actual flow and the
        // current version, not just say no.
        let stderr = '';
        try {
            execFileSync(process.execPath, ['scripts/release-is-ci-only.cjs'], {
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'pipe'],
            });
        } catch (e) {
            stderr = String((e as { stderr?: string }).stderr ?? '');
        }
        expect(stderr).toMatch(/built and published by CI/i);
        expect(stderr).toMatch(/git tag -a v<version>/);
        expect(stderr).toMatch(/release\.yml/);
        expect(stderr).toContain(pkg.version);
        // It must be explicit that a local publish skips the gates, or the
        // obvious next question is "but I can just run it here".
        expect(stderr).toMatch(/skips every gate/i);
    });

    it('local builds are still possible, they just cannot publish', () => {
        // Verifying a build on your own machine is legitimate and useful; only
        // publishing is fenced off. Removing electron:build entirely would be
        // over-correction.
        expect(scripts['electron:build']).toContain('electron-builder');
        expect(scripts['electron:build']).not.toMatch(/--publish/);
    });
});

describe('the release workflow is the builder', () => {
    it('is driven by a version tag on a GitHub runner', () => {
        expect(releaseSrc).toMatch(/tags:\s*\n\s*- 'v\*'/);
        expect(releaseSrc).toMatch(/runs-on: windows-latest/);
    });

    it('publishes only after the gates', () => {
        const publish = releaseSrc.indexOf('--publish always');
        expect(publish).toBeGreaterThan(-1);
        // The signature gate must come BEFORE the publish step, or the gate is
        // decoration.
        const gate = releaseSrc.indexOf('verify-release-signature.cjs');
        expect(gate).toBeGreaterThan(-1);
        expect(gate).toBeLessThan(publish);
        // And so must the packaged-app smoke, which is the only gate that
        // exercises the real exe.
        const smoke = releaseSrc.indexOf('installer-smoke');
        expect(smoke).toBeGreaterThan(-1);
        expect(smoke).toBeLessThan(publish);
    });

    it('checks the tag against package.json before anything expensive', () => {
        expect(releaseSrc).toMatch(/does not match package version/);
    });
});
