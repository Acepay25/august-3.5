/**
 * A feature nothing in the app calls is not a feature (2026-09-21).
 *
 * This repo's habit is to add a capability with its own unit suite, and a unit
 * suite can be entirely self-contained: it imports the module, calls the export,
 * asserts, and the product never touches it. That is how the memory-budget
 * workstream ended up with `cleanupIsDue` written, tested, and with ZERO
 * production callers — the byte pressure that was supposed to trigger a cleanup
 * instead only logged a warning, and every test stayed green.
 *
 * So this is the ratchet. Each name below is a capability that must be reachable
 * from running code, not from `tests/`. Comments are stripped before matching, so
 * a doc comment that merely mentions a function does not discharge its duty.
 *
 * Adding an entry means the capability is load-bearing; if it is ever genuinely
 * retired, delete the export AND the row — do not exempt it here.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/** Strips line and block comments. Blind to string literals (a double slash in a
 *  URL truncates the rest of that line), which can only make a name look LESS
 *  used, never more — so it fails loudly rather than silently. */
const codeOnly = (src: string): string => {
    let inBlock = false;
    return src.split('\n').map(line => {
        let out = '';
        let i = 0;
        while (i < line.length) {
            if (inBlock) {
                const end = line.indexOf('*/', i);
                if (end === -1) { i = line.length; } else { inBlock = false; i = end + 2; }
                continue;
            }
            if (line.startsWith('/*', i)) { inBlock = true; i += 2; continue; }
            if (line.startsWith('//', i)) break;
            out += line[i];
            i += 1;
        }
        return out;
    }).join('\n');
};

const PROD_ROOTS = ['App.tsx', 'components', 'hooks', 'services', 'utils', 'constants', 'shared'];

const productionFiles = (() => {
    const found: string[] = [];
    const walk = (p: string): void => {
        let st;
        try { st = statSync(p); } catch { return; }
        if (st.isDirectory()) readdirSync(p).forEach(f => walk(join(p, f)));
        else if (/\.(c)?[jt]sx?$/.test(p) && !p.endsWith('.d.ts')) found.push(p);
    };
    PROD_ROOTS.forEach(walk);
    return found.map(p => ({ path: p.split(/[\\/]/).join('/'), code: codeOnly(readFileSync(p, 'utf8')) }));
})();

describe('the scan itself is looking at the tree', () => {
    it('found the production sources it needs to be meaningful', () => {
        // A guard that scans nothing passes vacuously — the failure mode this
        // file exists to prevent.
        expect(productionFiles.length).toBeGreaterThan(300);
        expect(productionFiles.some(f => f.path === 'App.tsx')).toBe(true);
    });
});

/** name -> the file that defines it. Consumers must be a DIFFERENT file. */
const CAPABILITIES: Array<{ name: string; definedIn: string; why: string }> = [
    { name: 'cleanupIsDue', definedIn: 'utils/memoryBudget.ts', why: 'the budget’s dedup gate — orphaned once, on purpose watched now' },
    { name: 'runSkillIdleSweep', definedIn: 'services/learning/skillIdleLifecycle.ts', why: 'the idle sweep must actually run' },
    { name: 'listSuspendedSkills', definedIn: 'services/learning/skillIdleLifecycle.ts', why: 'a suspended skill is invisible unless health reports it' },
    { name: 'measureNotebook', definedIn: 'utils/memoryBudget.ts', why: 'the budget has to be measured to be enforced' },
    { name: 'describePressure', definedIn: 'utils/memoryBudget.ts', why: 'pressure must reach a human, not only a branch' },
    { name: 'notebookWantsCleanup', definedIn: 'services/learning/MemoryFilesService.ts', why: 'trigger-tier pressure must schedule a cleanup' },
    { name: 'getNotebookWriteFailure', definedIn: 'services/learning/MemoryFilesService.ts', why: 'a refused memory write must reach the Health report' },
    { name: 'isHygieneDue', definedIn: 'services/learning/memoryHygiene.ts', why: 'the scheduler the Health card renders' },
    { name: 'runMemoryHygieneIfDue', definedIn: 'services/learning/memoryHygiene.ts', why: 'the boot hook that makes hygiene happen' },
    { name: 'storeToolArtifact', definedIn: 'services/analysis/toolArtifactStore.ts', why: 'a clipped payload is only recoverable if it is stored' },
    { name: 'readToolArtifact', definedIn: 'services/analysis/toolArtifactStore.ts', why: 'the read-back tool must be reachable from a tool call' },
    { name: 'clearToolArtifacts', definedIn: 'services/analysis/toolArtifactStore.ts', why: 'otherwise spilled bytes outlive the run' },
    { name: 'getStorageInfo', definedIn: 'services/infrastructure/dbService.ts', why: 'the journal’s eviction risk has to be visible somewhere' },
    { name: 'withDetectedTradeType', definedIn: 'services/analysis/ScalpDetectionService.ts', why: 'the journal scalp/swing filter needs a producer' },
    { name: 'importBackupFromText', definedIn: 'services/infrastructure/BackupService.ts', why: 'an exported journal file must be restorable' },
    { name: 'convertToLineData', definedIn: 'services/analysis/AITrendlineService.ts', why: 'the AI’s trendline endpoints reach the screen through it' },
    { name: 'clipNote', definedIn: 'utils/harnessMarks.ts', why: 'the single clip dialect must be the one shipped' },
    { name: 'dataUnavailable', definedIn: 'utils/harnessMarks.ts', why: 'the sentinel must be emitted, not just defined' },
    { name: 'harnessNoteLegend', definedIn: 'utils/harnessMarks.ts', why: 'the fence allowance is generated from it' },
    { name: 'harnessTurn', definedIn: 'utils/harnessMarks.ts', why: 'harness-authored user turns must be marked' },
    { name: 'deskThread', definedIn: 'utils/agentThreads.ts', why: 'the Agents desk pane renders from it' },
    { name: 'threadForProvider', definedIn: 'utils/agentThreads.ts', why: 'a bot thread renders from it' },
];

describe('every load-bearing capability is reachable from running code', () => {
    it.each(CAPABILITIES)('$name — $why', ({ name, definedIn }) => {
        const self = definedIn.split(/[\\/]/).join('/');
        const re = new RegExp(`\\b${name}\\b`);
        const consumers = productionFiles
            .filter(f => f.path !== self && re.test(f.code))
            .map(f => f.path);
        expect(
            consumers.length,
            `${name} has no production consumer outside ${self} — it is implemented for its own tests`,
        ).toBeGreaterThan(0);
    });
});
