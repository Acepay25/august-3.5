#!/usr/bin/env node
/**
 * Hunt the load-sensitive flake, and keep the evidence.
 *
 * WHY A SCRIPT. This flake has now reproduced at least three times and was
 * caught zero, and the reason was never the flake — it was the evidence. Each
 * attempt ran the suite in the background and read the tool's own output file
 * afterwards, by which point it had been rotated away, so every run ended in
 * "it passed this time" and nothing was learned.
 *
 * So the rule here is simple: a run's structured result is written to a file
 * BEFORE the next run starts, and a run that fails is never overwritten. Any
 * failure found in the directory is printed with its own path.
 *
 * `--reporter=json --outputFile` is what makes this reliable: the JSON carries
 * the failing test names, the assertion, and the stack, so a single captured
 * file is enough to diagnose from — no need to have been watching.
 *
 * Usage:  node scripts/flake-hunt.cjs [runs]
 */

'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const runs = Number(process.argv[2]) || 4;
const outDir = path.join(__dirname, '..', '.flake-hunt');
fs.mkdirSync(outDir, { recursive: true });

const failures = [];

for (let i = 1; i <= runs; i++) {
    const json = path.join(outDir, `run-${i}.json`);
    process.stdout.write(`[flake-hunt] run ${i}/${runs} -> ${json}\n`);
    try {
        execFileSync('npx', ['vitest', 'run', '--reporter=json', `--outputFile=${json}`], {
            stdio: 'ignore',
            shell: true,
        });
    } catch {
        // vitest exits non-zero on failure; the JSON is the evidence either way.
    }

    let report;
    try {
        report = JSON.parse(fs.readFileSync(json, 'utf8'));
    } catch {
        process.stdout.write(`[flake-hunt] run ${i} produced no parsable JSON\n`);
        continue;
    }

    const failed = (report.testResults || []).filter(r => r.status === 'failed');
    const total = report.numTotalTests ?? 0;
    const passed = report.numPassedTests ?? 0;
    process.stdout.write(`[flake-hunt] run ${i}: ${passed}/${total} passed\n`);

    for (const f of failed) {
        const name = f.name || f.assertionResults?.map(a => a.fullName).join(', ') || '(unnamed)';
        const msg = (f.message || String(f)).split('\n').slice(0, 6).join('\n');
        // Keep the evidence: a failing run is never overwritten, and its file
        // is named so it sorts before the passing ones.
        const keep = path.join(outDir, `FAILED-run-${i}.json`);
        fs.copyFileSync(json, keep);
        failures.push({ run: i, name, msg, file: keep });
    }
}

if (failures.length === 0) {
    process.stdout.write(`\n[flake-hunt] no failure in ${runs} runs. That is not proof it is gone —\n`
        + 'it is only what a bounded number of runs can say. Re-run when convenient.\n');
    process.exit(0);
}

process.stdout.write(`\n[flake-hunt] ${failures.length} FAILING RUN(S) — evidence on disk:\n\n`);
for (const f of failures) {
    process.stdout.write(`── run ${f.run}: ${f.name}\n${f.msg}\n   full JSON: ${f.file}\n\n`);
}
process.exit(1);
