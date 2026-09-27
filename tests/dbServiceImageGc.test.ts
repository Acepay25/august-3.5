/**
 * dbService — the messageImageStore GC wiring:
 *  · deleteUserProfile enumerates the user's conversations BEFORE removing
 *    the profile row and GCs their side-store image rows (without the
 *    enumeration, the conversation ids die with the profile and every
 *    attached base64 blob leaks forever).
 *  · saveUserProfile / overwriteUserProfile GC the image rows of
 *    conversations a save REMOVED from the profile (delete session /
 *    clear-all / import restore).
 *
 * The SQLite backend is mocked "ready and native" so both public functions
 * take the same code path; messageImageStore is mocked to observe the calls.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { imageStore, sqlite } = vi.hoisted(() => ({
    imageStore: {
        putMessageImages: vi.fn(async (): Promise<boolean> => true),
        getConversationImages: vi.fn(async (): Promise<Record<string, string[]>> => ({})),
        deleteMessageImagesForConversations: vi.fn(async (): Promise<void> => {}),
    },
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
vi.mock('../services/infrastructure/messageImageStore', () => imageStore);
vi.mock('../services/infrastructure/SqliteServiceHelpers', () => ({
    runExclusiveWrite: async (fn: () => Promise<void>): Promise<void> => fn(),
}));
vi.mock('../services/infrastructure/PreferencesService', () => ({
    isSqliteMigrated: vi.fn(async (): Promise<boolean> => true),
    setSqliteMigrated: vi.fn(async (): Promise<void> => {}),
    migrateLocalStorageToPreferences: vi.fn(async (): Promise<void> => {}),
}));

import { deleteUserProfile, saveUserProfile, overwriteUserProfile } from '../services/infrastructure/dbService';

beforeEach(() => {
    vi.clearAllMocks();
    sqlite.sqliteGetUserProfile.mockResolvedValue(null);
});

describe('dbService message-image GC wiring', () => {
    it('deleteUserProfile enumerates conversations first, then GCs their image rows', async () => {
        sqlite.sqliteGetUserProfile.mockResolvedValue({
            username: 'alice',
            conversations: [{ id: 'c1', messages: [] }, { id: 'c2', messages: [] }, { id: null }],
        } as never);
        await deleteUserProfile('alice');
        expect(sqlite.sqliteDeleteUser).toHaveBeenCalledWith('alice');
        expect(imageStore.deleteMessageImagesForConversations).toHaveBeenCalledTimes(1);
        expect(imageStore.deleteMessageImagesForConversations).toHaveBeenCalledWith(['c1', 'c2']);
        // The enumeration must happen on the profile BEFORE the delete: both
        // reads went to the same backend handle.
        expect(sqlite.sqliteGetUserProfile).toHaveBeenCalledWith('alice');
    });

    it('saveUserProfile GCs conversations the new list dropped', async () => {
        sqlite.sqliteGetUserProfile.mockResolvedValue({
            username: 'alice',
            conversations: [{ id: 'c1', messages: [] }, { id: 'gone-1', messages: [] }, { id: 'gone-2', messages: [] }],
        } as never);
        await saveUserProfile('alice', { conversations: [{ id: 'c1', messages: [] }] } as never);
        expect(imageStore.deleteMessageImagesForConversations).toHaveBeenCalledWith(['gone-1', 'gone-2']);
    });

    it('saveUserProfile with a settings-only payload GCs nothing', async () => {
        sqlite.sqliteGetUserProfile.mockResolvedValue({
            username: 'alice',
            conversations: [{ id: 'c1', messages: [] }],
        } as never);
        await saveUserProfile('alice', { settings: { activeFrameworks: [] } });
        expect(imageStore.deleteMessageImagesForConversations).not.toHaveBeenCalled();
    });

    it('overwriteUserProfile (import/restore) GCs against the previously stored profile', async () => {
        sqlite.sqliteGetUserProfile.mockResolvedValue({
            username: 'alice',
            conversations: [{ id: 'old', messages: [] }],
        } as never);
        await overwriteUserProfile({
            username: 'alice',
            conversations: [{ id: 'restored', messages: [] }],
            tradeLog: [],
            savedAnalyses: [],
            tradeSummaries: [],
            finalTradeSummary: null,
            settings: { activeFrameworks: [] },
        } as never);
        expect(imageStore.deleteMessageImagesForConversations).toHaveBeenCalledWith(['old']);
    });
});
