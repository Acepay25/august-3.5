#!/usr/bin/env node
/**
 * Releases are published by CI, from a tag. This script refuses to do it here.
 *
 * WHY THIS EXISTS. `package.json` had an `electron:release` script that ran
 * `electron-builder --publish always` on whatever machine invoked it. No
 * workflow called it, so it existed only to let a developer's laptop publish —
 * which is the exact opposite of how releases are meant to happen, and it
 * bypassed every gate that protects a release: the render probe, the packaged
 * installer smoke, and the signature gate. A locally-built installer could
 * overwrite a CI-built release without passing a single one of them.
 *
 * The published build must come from `.github/workflows/release.yml` on a
 * GitHub runner, triggered by a `v*` tag, after the full gate chain.
 *
 * Usage: node scripts/release-is-ci-only.cjs
 */

'use strict';

const path = require('node:path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(require('node:fs').readFileSync(path.join(root, 'package.json'), 'utf8'));

const lines = [
    'Releases are built and published by CI, not by this machine.',
    '',
    'To ship a release:',
    '  1. npm run electron:build          # local build ONLY — verify locally, publish nothing',
    '  2. git push origin main',
    '  3. git tag -a v<version> -m "..." && git push origin v<version>',
    '',
    'The tag drives .github/workflows/release.yml, which runs on a GitHub',
    'windows runner and executes the full chain: typechecks, tests, lint,',
    'vite build, source-map rejection, e2e smoke, boot probe, render probe,',
    'packaged installer smoke, the Authenticode signature gate, and only then',
    '`electron-builder --publish always`.',
    '',
    `Current version in package.json: ${pkg.version}`,
    'The tag must match it, or the release workflow fails at "Validate release tag".',
    '',
    'A local `--publish` is not a shortcut: it skips every gate above, and the',
    'artifact it uploads is the one users install.',
];

console.error(lines.join('\n'));
process.exit(1);
