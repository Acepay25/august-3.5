#!/usr/bin/env node
/**
 * Every multi-line `run:` step in a WINDOWS job — and in a composite action,
 * which runs on both ubuntu and windows — must say which shell it runs under.
 *
 * WHY THIS EXISTS. A GitHub `run:` step with no `shell:` uses the runner's
 * default: bash on ubuntu, **pwsh on windows**. A step written with POSIX
 * conditionals therefore parses fine in `.github/workflows/guards.yml`
 * (ubuntu) and dies on the same characters in `release.yml` (windows).
 *
 * That is not hypothetical. The step that warns about a missing code-signing
 * certificate was written `if [ "x" != "y" ]; then ... fi`. Every gate in the
 * 1.0.31 release had already passed — tests, lint, boot probe, render probe,
 * installer smoke on the packaged exe — and the release still failed on that
 * two-line conditional, with `Missing '(' after 'if' in if statement`, after
 * roughly twenty minutes of CI. It is the worst possible place to find out:
 * the expensive gates all go green first, so the failure looks unrelated to
 * them.
 *
 * A single-line command (`npm run test`, `node scripts/x.cjs`) is
 * shell-agnostic and is left alone. What this flags is a MULTI-LINE `run:`
 * with no `shell:`, in a windows job — that is exactly the shape where an
 * author can reasonably assume bash because every other workflow in the repo
 * does run on bash.
 *
 * Usage: node scripts/check-workflow-shells.cjs
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const WORKFLOWS = path.join(__dirname, '..', '.github', 'workflows');
const ACTIONS = path.join(__dirname, '..', '.github', 'actions');

/** Windows runner labels. `windows-latest` and the pinned `-2022` style. */
const isWindowsRunner = (runsOn) => {
    const labels = Array.isArray(runsOn) ? runsOn : [runsOn];
    return labels.some(l => typeof l === 'string' && /^windows/i.test(l));
};

/**
 * @param {string} [dir] Workflow directory. Parameterised so the test can
 *  point this at a fixture containing a deliberate offender — without
  that, the guard is only ever exercised against files that already
  pass, which is exactly the shape of a gate that silently rots into
  a no-op.
 * @returns {string[]} One message per violation; empty means clean.
 */
const check = (dir = WORKFLOWS) => {
    const problems = [];
    const files = fs.existsSync(dir)
        ? fs.readdirSync(dir).filter(f => /\.ya?ml$/.test(f))
        : [];

    for (const file of files) {
        const full = path.join(dir, file);
        let doc;
        try {
            doc = yaml.load(fs.readFileSync(full, 'utf8'));
        } catch (e) {
            problems.push(`${file}: could not parse (${e.message})`);
            continue;
        }
        if (!doc || typeof doc !== 'object') continue;
        const jobs = doc.jobs || {};
        for (const [jobName, job] of Object.entries(jobs)) {
            if (!job || !isWindowsRunner(job['runs-on'])) continue;
            for (const [i, step] of (job.steps || []).entries()) {
                if (!step || typeof step.run !== 'string') continue;
                if (step.shell) continue;
                // A single-line run is shell-agnostic in practice; the whole
                // point is the multi-line block where syntax is chosen.
                if (step.run.trim().split('\n').length < 2) continue;
                const where = step.name ? `"${step.name}"` : `step ${i}`;
                problems.push(
                    `${file} → job "${jobName}" → ${where}: a multi-line \`run:\` on a windows runner with no \`shell:\`. `
                    + 'It will execute under pwsh, so POSIX syntax (if [ … ]; then, fi, &&, $VAR assignments) fails there '
                    + 'while passing in the ubuntu workflows. Add `shell: pwsh` (or `shell: bash`) explicitly.',
                );
            }
        }
    }
    return problems;
};

/**
 * Composite actions run on whatever runner calls them — the same action is
 * used by ubuntu CI and the windows release — so every multi-line `run:` in one
 * must declare its shell unconditionally.
 */
const checkActions = (dir = ACTIONS) => {
    const problems = [];
    if (!fs.existsSync(dir)) return problems;
    const walk = (d) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const p = path.join(d, e.name);
            if (e.isDirectory()) { walk(p); continue; }
            if (!/^action\.ya?ml$/.test(e.name)) continue;
            const rel = path.relative(path.join(__dirname, '..'), p);
            let doc;
            try {
                doc = yaml.load(fs.readFileSync(p, 'utf8'));
            } catch (err) {
                problems.push(`${rel}: could not parse (${err.message})`);
                continue;
            }
            const steps = doc?.runs?.steps || [];
            for (const [i, step] of steps.entries()) {
                if (!step || typeof step.run !== 'string') continue;
                if (step.shell) continue;
                if (step.run.trim().split('\n').length < 2) continue;
                const where = step.name ? `"${step.name}"` : `step ${i}`;
                problems.push(
                    `${rel} → ${where}: a multi-line \`run:\` with no \`shell:\`. `
                    + 'This action runs on both ubuntu (CI) and windows (release), so the shell is never '
                    + 'the runner default by luck. Add `shell: bash`.',
                );
            }
        }
    };
    walk(dir);
    return problems;
};

const problems = [...check(), ...checkActions()];
if (problems.length > 0) {
    console.error('[workflow-shells] FAIL — a step does not declare its shell:\n');
    for (const p of problems) console.error('  • ' + p);
    console.error('\nSee scripts/check-workflow-shells.cjs for why this fails a release, not a PR.');
    process.exit(1);
}
console.log('[workflow-shells] OK — every multi-line run: in a windows job and in a composite action declares its shell.');
module.exports = { check, checkActions };
