/**
 * The one user-data mutation the approval gate makes, and the guard around it:
 * no recovery point, no stamping.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

let store: Record<string, unknown> = {};
vi.mock('../services/infrastructure/PreferencesService', () => ({
    getPreferenceObject: vi.fn(async (key: string) => store[key] ?? null),
    getPreference: vi.fn(async (key: string) => store[key] ?? null),
    getPreferenceArray: vi.fn(async () => []),
    setPreferenceObject: vi.fn(async (key: string, value: unknown) => { store[key] = value; }),
    removePreference: vi.fn(async (key: string) => { delete store[key]; }),
}));

const backups = vi.hoisted(() => ({ createBackup: vi.fn(async () => ({ id: 'backup-1' })) }));
vi.mock('../services/infrastructure/BackupService', () => ({ createBackup: backups.createBackup }));

import { initMemoryFiles, getMemoryFiles, createMemoryFile } from '../services/learning/MemoryFilesService';
import { parseSkillMarkdown } from '../services/learning/SkillMemoryService';
import { runApprovalMigration, approvalMigrationRan, APPROVAL_MIGRATION_KEY_PREFIX } from '../services/learning/approvalMigration';

const USER = 'migrate-user';

const plant = async (name: string, extra = '') => {
    const folder = getMemoryFiles().folders.find(f => f.name === 'skills')!;
    await createMemoryFile(folder.id, `${name}.md`, `---
status: candidate
kind: repeat
coin: BTCUSDT
family: Family A
wins: 1
losses: 1
tradeIds: a,b
${extra}ifCondition: BTC reclaims the swept low on a 1h close
thenAction: go long with the stop under the wick
---

# ${name}

**My rule:** when BTC reclaims the swept low on a 1h close, I go long with the stop under the wick
`, USER, true);
};

beforeEach(async () => {
    store = {};
    localStorage.clear();
    backups.createBackup.mockClear();
    backups.createBackup.mockResolvedValue({ id: 'backup-1' } as never);
    await initMemoryFiles(USER);
});

describe('the approval migration runner', () => {
    it('backs up BEFORE it stamps, and stamps once', async () => {
        await plant('legacy-1');
        const report = await runApprovalMigration(USER);
        expect(report.ran).toBe(true);
        expect(report.backedUp).toBe(true);
        expect(report.stamped).toBe(1);
        expect(backups.createBackup).toHaveBeenCalledTimes(1);
        expect(parseSkillMarkdown(getMemoryFiles().files.find(f => f.name === 'legacy-1.md')!.content)!.approvedBy)
            .toBe('grandfathered');
        expect(approvalMigrationRan(USER)).toBe(true);
    });

    it('does nothing on a second boot', async () => {
        await plant('legacy-2');
        await runApprovalMigration(USER);
        backups.createBackup.mockClear();
        const again = await runApprovalMigration(USER);
        expect(again.ran).toBe(false);
        expect(again.reason).toBe('already-ran');
        expect(backups.createBackup).not.toHaveBeenCalled();
    });

    it('REFUSES to stamp when no backup could be written', async () => {
        // The point of ordering the backup first: a migration with no recovery point
        // is not a migration. Nothing is touched, and the library stays exactly as
        // unapproved as it was — which is the fail-closed direction.
        await plant('legacy-3');
        const before = getMemoryFiles().files.find(f => f.name === 'legacy-3.md')!.content;
        backups.createBackup.mockResolvedValueOnce(null as never);

        const report = await runApprovalMigration(USER);

        expect(report.ran).toBe(false);
        expect(report.reason).toBe('backup-failed');
        expect(getMemoryFiles().files.find(f => f.name === 'legacy-3.md')!.content).toBe(before);
        expect(approvalMigrationRan(USER)).toBe(false);
    });

    it('marks the run with a raw-localStorage key the backup registry knows about', async () => {
        await plant('legacy-4');
        await runApprovalMigration(USER);
        expect(localStorage.getItem(`${APPROVAL_MIGRATION_KEY_PREFIX}${USER}`)).toBe('1');
    });
});
