/**
 * The workflow-shell contract, and the guard that enforces it.
 *
 * A GitHub `run:` step with no `shell:` is bash on ubuntu and **pwsh on
 * windows**. This repo runs `guards.yml` on ubuntu and `release.yml` on
 * windows, so a step written with POSIX syntax is valid in one and fatal in
 * the other.
 *
 * That is not theoretical: the 1.0.31 release failed with `Missing '(' after
 * 'if' in if statement` from a two-line `if [ … ]; then … fi` — and it failed
 * AFTER tests, lint, boot probe, render probe and installer-smoke had all
 * passed, because the step sits near the end of the job. The worst possible
 * place to learn a workflow runs a different shell than you assumed.
 *
 * The guard is the fix. The fixture tests below are what stop the guard itself
 * from rotting into a no-op: a gate that is only ever exercised against
 * already-clean input is indistinguishable from a gate that does nothing.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { check } = require('../scripts/check-workflow-shells.cjs') as { check: (dir?: string) => string[] };

const releaseSrc = readFileSync('.github/workflows/release.yml', 'utf8');
const guardsSrc = readFileSync('.github/workflows/guards.yml', 'utf8');

/** Run the guard over a throwaway workflow containing `lines`. */
const guardOn = (lines: string[]): string[] => {
    const dir = mkdtempSync(join(tmpdir(), 'wf-shells-'));
    try {
        writeFileSync(join(dir, 'fixture.yml'), lines.join('\n') + '\n');
        return check(dir);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
};

describe('the workflow-shell guard', () => {
    it('passes on the workflows as they stand', () => {
        const problems = check();
        expect(problems, problems.join('\n')).toEqual([]);
    });

    it('flags a multi-line run: with no shell: in a windows job', () => {
        // The exact shape that failed the release.
        const problems = guardOn([
            'name: T', 'jobs:', '  j:', '    runs-on: windows-latest', '    steps:',
            '      - name: bad',
            '        run: |',
            '          if [ "a" != "b" ]; then',
            '            echo x',
            '          fi',
        ]);
        expect(problems).toHaveLength(1);
        expect(problems[0]).toMatch(/fixture\.yml/);
        expect(problems[0]).toMatch(/windows runner with no/);
    });

    it('accepts the same step once it declares its shell', () => {
        expect(guardOn([
            'name: T', 'jobs:', '  j:', '    runs-on: windows-latest', '    steps:',
            '      - name: good',
            '        shell: pwsh',
            '        run: |',
            '          if ("a" -ne "b") {',
            '            Write-Host x',
            '          }',
        ])).toEqual([]);
    });

    it('leaves an ubuntu job alone — its default really is bash', () => {
        expect(guardOn([
            'name: T', 'jobs:', '  j:', '    runs-on: ubuntu-latest', '    steps:',
            '      - name: bash is fine here',
            '        run: |',
            '          set -euo pipefail',
            '          for f in scripts/*.cjs; do',
            '            echo "$f"',
            '          done',
        ])).toEqual([]);
    });

    it('leaves a single-line run: alone — it is shell-agnostic', () => {
        expect(guardOn([
            'name: T', 'jobs:', '  j:', '    runs-on: windows-latest', '    steps:',
            '      - name: one liner',
            '        run: npm run test',
        ])).toEqual([]);
    });

    it('the repo genuinely runs the two workflows on different runners', () => {
        // The whole premise: the same syntax is valid in one and not the other.
        expect(releaseSrc).toMatch(/runs-on: windows-latest/);
        expect(guardsSrc).toMatch(/runs-on: ubuntu-latest/);
        expect(guardsSrc).toMatch(/set -euo pipefail/);
    });
});

describe('release.yml states its shells', () => {
    it('the signing-detection step runs pwsh, not the windows default by luck', () => {
        // This is the step that broke 1.0.31. Pinned by name so the old body
        // cannot come back.
        expect(releaseSrc).toMatch(
            /- name: Build signed Electron installer\s+shell: pwsh/,
        );
    });

    it('carries no POSIX conditional in a step left to the default', () => {
        const offenders = [...releaseSrc.matchAll(/- name: ([^\n]+)\n((?:(?!- name:)[\s\S])*)/g)]
            .map(m => ({ name: m[1], body: m[2] }))
            .filter(s => !/shell:/.test(s.body))
            .filter(s => /\bif \[|^\s*fi\s*$/m.test(s.body))
            .map(s => s.name);
        expect(offenders).toEqual([]);
    });

    it('runs the guard itself, so the release cannot regress this way again', () => {
        expect(releaseSrc).toMatch(/node scripts\/check-workflow-shells\.cjs/);
        expect(guardsSrc).toMatch(/node scripts\/check-workflow-shells\.cjs/);
    });
});
