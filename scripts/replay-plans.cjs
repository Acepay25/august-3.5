#!/usr/bin/env node
/**
 * replay-plans.cjs — run the TS replay harness against a journal export.
 *
 * The harness itself lives in `utils/planReplay.ts` and imports the app's real
 * plan builder. This wrapper bundles it with esbuild (already a dependency)
 * and runs it on Node, so the report is the app's arithmetic, not a copy.
 */
const esbuild = require('esbuild');
const fs = require('fs');
const os = require('os');
const path = require('path');

const outfile = path.join(os.tmpdir(), `august-replay-plans-${process.pid}.cjs`);
try {
    esbuild.buildSync({
        entryPoints: [path.join(__dirname, 'replay-plans.entry.ts')],
        bundle: true,
        platform: 'node',
        format: 'cjs',
        target: 'node22',
        outfile,
        logLevel: 'warning',
    });
    require(outfile);
} catch (e) {
    console.error('replay-plans: build/run failed:', e && e.message ? e.message : e);
    process.exitCode = 1;
} finally {
    try { fs.unlinkSync(outfile); } catch { /* already gone */ }
}
