/**
 * dbService must FORWARD the write permit it was issued to
 * sqliteSaveUserProfile.
 *
 * dbService's save paths are read-modify-writes, so they hold the write mutex
 * across the read and the write — and sqliteSaveUserProfile takes that mutex
 * itself (it opens BEGIN TRANSACTION on the shared connection, which cannot
 * nest). A save issued from inside a held lock therefore has to re-enter with
 * the holder's `WritePermit`; without it the save queues behind the very
 * promise the lock-holder is awaiting and the app's save path deadlocks
 * silently. See tests/sqliteWriteMutex.test.ts for the mutex behavior itself
 * and services/infrastructure/SqliteServiceHelpers.ts for the permit.
 *
 * The mutex here is stubbed to issue a permit the way the real one does, so
 * the assertion is on the ARGUMENT dbService passes down, not on timing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const PERMIT = { held: true } as const;

const { sqlite } = vi.hoisted(() => ({
    sqlite: {
        initSqlite: vi.fn(async (): Promise<boolean> => true),
        isNativePlatform: vi.fn((): boolean => true),
        sqliteGetAllUsernames: vi.fn(async (): Promise<string[]> => []),
        sqliteGetUserProfile: vi.fn(async (): Promise<null> => null),
        sqliteSaveUserProfile: vi.fn(async (): Promise<void> => {}),
        sqliteDeleteUser: vi.fn(async (): Promise<void> => {}),
        migrateFromIndexedDB: vi.fn(async (): Promise<{ migrated: boolean }> => ({ migrated: false })),
    },
}));

vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => 'web', isNativePlatform: () => true } }));
vi.mock('../services/infrastructure/SqliteService', () => sqlite);
vi.mock('../services/infrastructure/messageImageStore', () => ({
    putMessageImages: vi.fn(async (): Promise<boolean> => true),
    getConversationImages: vi.fn(async (): Promise<Record<string, string[]>> => ({})),
    deleteMessageImagesForConversations: vi.fn(async (): Promise<void> => {}),
}));
// Mirrors the real issuePermit(): the body receives a usable capability.
vi.mock('../services/infrastructure/SqliteServiceHelpers', () => ({
    runExclusiveWrite: async (fn: (permit: { held: true }) => Promise<unknown>): Promise<unknown> => fn(PERMIT),
}));
vi.mock('../services/infrastructure/PreferencesService', () => ({
    isSqliteMigrated: vi.fn(async (): Promise<boolean> => true),
    setSqliteMigrated: vi.fn(async (): Promise<void> => {}),
    migrateLocalStorageToPreferences: vi.fn(async (): Promise<void> => {}),
}));

import { saveUserProfile, overwriteUserProfile } from '../services/infrastructure/dbService';
import type { UserProfile } from '../types';

const profile = (username: string): UserProfile => ({
    username,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    settings: { activeFrameworks: [] },
    conversations: [],
    tradeLog: [],
    tradeSummaries: [],
    savedAnalyses: [],
    finalTradeSummary: null,
});

beforeEach(() => {
    vi.clearAllMocks();
    sqlite.sqliteGetUserProfile.mockResolvedValue(null);
});

describe('dbService → sqliteSaveUserProfile permit forwarding', () => {
    it('saveUserProfile hands the held permit to the nested save', async () => {
        await saveUserProfile('bob', { finalTradeSummary: 'x' });
        expect(sqlite.sqliteSaveUserProfile).toHaveBeenCalledTimes(1);
        const [, permit] = sqlite.sqliteSaveUserProfile.mock.calls[0] as unknown as [UserProfile, unknown];
        expect(permit).toBe(PERMIT);
    });

    it('overwriteUserProfile hands the held permit to the nested save', async () => {
        await overwriteUserProfile(profile('bob'));
        expect(sqlite.sqliteSaveUserProfile).toHaveBeenCalledTimes(1);
        const [, permit] = sqlite.sqliteSaveUserProfile.mock.calls[0] as unknown as [UserProfile, unknown];
        expect(permit).toBe(PERMIT);
    });
});
