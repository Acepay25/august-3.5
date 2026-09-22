import { describe, it, expect, vi, beforeEach } from 'vitest';

// Force the NATIVE (Filesystem) backup path: the web path needs IndexedDB,
// which jsdom does not implement (see thinkingStore.web.test.ts).
vi.mock('@capacitor/core', () => ({
    Capacitor: { isNativePlatform: () => true },
}));

// vi.hoisted so the mock factories below (which vitest hoists above the
// module imports) can reference these eagerly without TDZ errors.
const h = vi.hoisted(() => ({
    files: new Map<string, string>(),
    getUserProfile: vi.fn(),
    overwriteUserProfile: vi.fn(async () => undefined),
    exportPreferencesData: vi.fn(async (): Promise<Record<string, unknown>> => ({})),
    importPreferencesData: vi.fn(async () => ({
        keysWritten: 0,
        skippedKeys: [] as string[],
        failedKeys: [] as string[],
        providersImported: 0,
        providersDropped: 0,
        providersKeyGrafted: 0,
        providersRequiringKeyReentry: 0,
    })),
    getAllThinkingRecordsByUser: vi.fn(async () : Promise<unknown[]> => []),
    saveThinkingBatch: vi.fn(async () => undefined),
}));

vi.mock('@capacitor/filesystem', () => ({
    Filesystem: {
        mkdir: vi.fn(async () => undefined),
        writeFile: vi.fn(async (opts: { path: string; data: string }) => {
            h.files.set(opts.path, opts.data);
            return { uri: `app://${opts.path}` };
        }),
        deleteFile: vi.fn(async (opts: { path: string }) => { h.files.delete(opts.path); }),
        readdir: vi.fn(async () => ({
            files: [...h.files.keys()]
                .filter(p => p.startsWith('AugustBackups/'))
                .map(p => ({ name: p.replace('AugustBackups/', '') })),
        })),
        readFile: vi.fn(async (opts: { path: string }) => {
            const data = h.files.get(opts.path);
            if (data === undefined) throw new Error(`ENOENT ${opts.path}`);
            return { data };
        }),
    },
    Directory: { Documents: 'DOCUMENTS', Cache: 'CACHE' },
    Encoding: { UTF8: 'utf8' },
}));

vi.mock('../services/infrastructure/dbService', () => ({
    getUserProfile: h.getUserProfile,
    saveUserProfile: vi.fn(),
    overwriteUserProfile: h.overwriteUserProfile,
}));

vi.mock('../services/infrastructure/ExportService', () => ({
    exportPreferencesData: h.exportPreferencesData,
    importPreferencesData: h.importPreferencesData,
}));

vi.mock('../services/infrastructure/ThinkingStoreService', () => ({
    getAllThinkingRecordsByUser: h.getAllThinkingRecordsByUser,
    saveThinkingBatch: h.saveThinkingBatch,
}));

import {
    restoreBackup, createBackup, getBackups, selectBackupsToDelete,
} from '../services/infrastructure/BackupService';

const USERNAME = 'alice';
const BACKUP_ID = `backup-${USERNAME}-1000`;
const BASE = `AugustBackups/${USERNAME}_${BACKUP_ID}`;

const profileFixture = {
    username: USERNAME,
    conversations: [],
    tradeLog: [],
    savedAnalyses: [],
    settings: { activeFrameworks: [] },
};

const seedBackupFiles = (opts: { prefs?: boolean; thinking?: boolean } = {}) => {
    h.files.set(`${BASE}.json`, JSON.stringify(profileFixture));
    h.files.set(`${BASE}.meta.json`, JSON.stringify({ username: USERNAME, timestamp: new Date().toISOString(), id: BACKUP_ID }));
    if (opts.prefs !== false) h.files.set(`${BASE}.prefs.json`, JSON.stringify({ price_alerts: [] }));
    if (opts.thinking !== false) h.files.set(`${BASE}.thinking.json`, JSON.stringify([{ id: 't1' }]));
};

beforeEach(() => {
    h.files.clear();
    // No CURRENT profile by default → the best-effort safety snapshot no-ops.
    h.getUserProfile.mockResolvedValue(null as never);
    h.overwriteUserProfile.mockClear();
    h.importPreferencesData.mockClear();
    h.importPreferencesData.mockResolvedValue({
        keysWritten: 1,
        skippedKeys: [],
        failedKeys: [],
        providersImported: 0,
        providersDropped: 0,
        providersKeyGrafted: 0,
        providersRequiringKeyReentry: 0,
    });
    h.saveThinkingBatch.mockClear();
    h.saveThinkingBatch.mockResolvedValue(undefined);
});

describe('BackupService.restoreBackup — step failures are loud (no silent partial restore)', () => {
    it('restores all three generations and reports success', async () => {
        seedBackupFiles();
        const result = await restoreBackup(BACKUP_ID);
        expect(result).toEqual({
            success: true,
            username: USERNAME,
            message: undefined,
            skippedPreferenceKeys: [],
        });
        expect(h.overwriteUserProfile).toHaveBeenCalledTimes(1);
        expect(h.importPreferencesData).toHaveBeenCalledTimes(1);
        expect(h.saveThinkingBatch).toHaveBeenCalledTimes(1);
    });

    it('surfaces allow-list SKIPPED keys in the success result (non-silent skip, audit F12)', async () => {
        seedBackupFiles();
        h.importPreferencesData.mockResolvedValueOnce({
            keysWritten: 5,
            skippedKeys: ['attacker_planted_key', 'some_future_namespace'],
            failedKeys: [],
            providersImported: 0,
            providersDropped: 0,
            providersKeyGrafted: 0,
            providersRequiringKeyReentry: 0,
        });
        const result = await restoreBackup(BACKUP_ID);
        // Skips are data the current build cannot name — they must NOT abort
        // the restore, but they must NOT vanish without a trace either.
        expect(result.success).toBe(true);
        expect(result.skippedPreferenceKeys).toEqual(['attacker_planted_key', 'some_future_namespace']);
        expect(result.message).toContain('2 backup key(s)');
        expect(result.message).toContain('attacker_planted_key');
        expect(result.message).toContain('some_future_namespace');
    });

    it('an old backup WITHOUT sidecars still restores cleanly', async () => {
        seedBackupFiles({ prefs: false, thinking: false });
        const result = await restoreBackup(BACKUP_ID);
        expect(result.success).toBe(true);
        expect(h.importPreferencesData).not.toHaveBeenCalled();
        expect(h.saveThinkingBatch).not.toHaveBeenCalled();
    });

    it('FAILS with a step-named error when the preferences sidecar fails — never reports success', async () => {
        seedBackupFiles();
        h.importPreferencesData.mockRejectedValueOnce(new Error('graft guard tripped'));
        const result = await restoreBackup(BACKUP_ID);
        expect(result.success).toBe(false);
        expect(result.error).toContain('"preferences" step');
        expect(result.error).toContain('graft guard tripped');
        // The thinking generation was NOT applied on top of a failed prefs gen.
        expect(h.saveThinkingBatch).not.toHaveBeenCalled();
    });

    it('treats a partial preference write (failedKeys in the import report) as a failed step', async () => {
        seedBackupFiles();
        h.importPreferencesData.mockResolvedValueOnce({
            keysWritten: 3,
            skippedKeys: [],
            failedKeys: ['price_alerts'],
            providersImported: 0,
            providersDropped: 0,
            providersKeyGrafted: 0,
            providersRequiringKeyReentry: 0,
        });
        const result = await restoreBackup(BACKUP_ID);
        expect(result.success).toBe(false);
        expect(result.error).toContain('"preferences" step');
        expect(result.error).toContain('price_alerts');
        expect(h.saveThinkingBatch).not.toHaveBeenCalled();
    });

    it('FAILS with a step-named error when the thinking sidecar fails', async () => {
        seedBackupFiles();
        h.saveThinkingBatch.mockRejectedValueOnce(new Error('idb exploded'));
        const result = await restoreBackup(BACKUP_ID);
        expect(result.success).toBe(false);
        expect(result.error).toContain('"thinking" step');
        expect(result.error).toContain('idb exploded');
    });

    it('FAILS with a step-named error when the profile write fails, before any other generation is applied', async () => {
        seedBackupFiles();
        h.overwriteUserProfile.mockRejectedValueOnce(new Error('sqlite down'));
        const result = await restoreBackup(BACKUP_ID);
        expect(result.success).toBe(false);
        expect(result.error).toContain('"profile" step');
        expect(result.error).toContain('sqlite down');
        expect(h.importPreferencesData).not.toHaveBeenCalled();
        expect(h.saveThinkingBatch).not.toHaveBeenCalled();
    });

    it('failure messages reference the pre-restore safety backup when one could be created', async () => {
        seedBackupFiles();
        // A CURRENT profile exists → the best-effort safety snapshot succeeds.
        h.getUserProfile.mockResolvedValue(profileFixture as never);
        h.saveThinkingBatch.mockRejectedValueOnce(new Error('boom'));
        const result = await restoreBackup(BACKUP_ID);
        expect(result.success).toBe(false);
        expect(result.error).toContain('"thinking" step');
        expect(result.error).toContain('pre-restore safety backup');
    });
});

const DAY = 86_400_000;
/** Fixed so the day/week bucketing is not a function of wall-clock drift. */
const NOW = Date.UTC(2026, 8, 22, 12, 0, 0);
const row = (id: string, ageDays: number) => ({
    id,
    timestamp: new Date(NOW - ageDays * DAY).toISOString(),
});
const ages = (ids: string[], all: Array<{ id: string; timestamp: string }>): number[] =>
    all.filter(r => ids.includes(r.id))
        // rounded: the ISO stamp is exact, but the assertion reads as days
        .map(r => Math.round((NOW - Date.parse(r.timestamp)) / DAY))
        .sort((a, b) => a - b);

describe('BackupService retention — a recovery point has to still exist', () => {
    it('does not let one long session pile up unbounded', () => {
        // Auto-backups land every 30 minutes, so a trading day is dozens of
        // same-day records. The tiered keeps must not turn that into dozens.
        const sameDay = Array.from({ length: 12 }, (_, i) => row(`backup-alice-${i}`, i * 0.02));
        const deleted = selectBackupsToDelete(sameDay, NOW);
        // newest five, plus one more for the day the other six came from.
        expect(deleted).toHaveLength(6);
    });

    it('keeps one backup per day past the newest five, inside the daily window', () => {
        const week = Array.from({ length: 8 }, (_, i) => row(`backup-alice-d${i}`, i));
        const deleted = selectBackupsToDelete(week, NOW);
        expect(ages(deleted, week)).toEqual([]);
    });

    it('drops what has aged past both tiers', () => {
        const history = [
            ...Array.from({ length: 6 }, (_, i) => row(`backup-alice-d${i}`, i)),
            row('backup-alice-month', 60),
        ];
        expect(selectBackupsToDelete(history, NOW)).toEqual(['backup-alice-month']);
    });

    it('never lets an import evict the backups already on the machine', () => {
        // The claim `importBackupFromText` documents. Newest record is the
        // import, so a plain newest-5 window would spend a machine backup on it.
        const auto = Array.from({ length: 5 }, (_, i) => row(`backup-alice-${i}`, 2 + i));
        const mixed = [...auto, row('imported-alice-999', 1)];
        const deleted = selectBackupsToDelete(mixed, NOW);
        expect(deleted.filter(id => !id.startsWith('imported-'))).toEqual([]);
    });

    it('bounds imports too, oldest first', () => {
        const imports = Array.from({ length: 5 }, (_, i) => row(`imported-alice-${i}`, i));
        const deleted = selectBackupsToDelete(imports, NOW);
        expect(deleted).toEqual(['imported-alice-3', 'imported-alice-4']);
    });

    it('cannot place an undated record in a time tier, so it does not survive by it', () => {
        const history = [
            ...Array.from({ length: 6 }, (_, i) => row(`backup-alice-${i}`, i)),
            { id: 'backup-alice-no-stamp', timestamp: 'not a date' },
        ];
        expect(selectBackupsToDelete(history, NOW)).toContain('backup-alice-no-stamp');
    });

    it('keeps the whole policy through the real create → sweep path', async () => {
        // Seven daily backups plus an import: the newest-five window alone would
        // have spent four of them, including the import the user just loaded.
        for (const ageDays of [1, 2, 3, 4, 5, 6, 7]) {
            const id = `backup-alice-${1_700_000_000_000 + ageDays}`;
            const base = `AugustBackups/${USERNAME}_${id}`;
            const ts = new Date(Date.now() - ageDays * DAY).toISOString();
            h.files.set(`${base}.json`, JSON.stringify(profileFixture));
            h.files.set(`${base}.meta.json`, JSON.stringify({
                id, username: USERNAME, timestamp: ts, version: 1,
                sizeBytes: 10, conversationCount: 0, tradeCount: 0,
            }));
        }
        const importId = `imported-${USERNAME}-123`;
        h.files.set(`AugustBackups/${USERNAME}_${importId}.json`, JSON.stringify(profileFixture));
        h.files.set(`AugustBackups/${USERNAME}_${importId}.meta.json`, JSON.stringify({
            id: importId, username: USERNAME,
            timestamp: new Date(Date.now() - 30 * 60_000).toISOString(),
            version: 1, sizeBytes: 10, conversationCount: 0, tradeCount: 0,
        }));

        h.getUserProfile.mockResolvedValue(profileFixture as never);
        expect(await createBackup(USERNAME)).not.toBeNull();

        const survivors = (await getBackups(USERNAME)).map(b => b.id);
        expect(survivors.filter(id => id.startsWith('backup-'))).toHaveLength(8);
        expect(survivors).toContain(importId);
    });
});
