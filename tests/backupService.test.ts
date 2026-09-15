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
        deleteFile: vi.fn(async () => undefined),
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

import { restoreBackup } from '../services/infrastructure/BackupService';

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
        expect(result).toEqual({ success: true, username: USERNAME });
        expect(h.overwriteUserProfile).toHaveBeenCalledTimes(1);
        expect(h.importPreferencesData).toHaveBeenCalledTimes(1);
        expect(h.saveThinkingBatch).toHaveBeenCalledTimes(1);
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
