/**
 * BackupService - Automated backup management
 * Handles auto-save, versioned backups, and import validation
 *
 * P1-9: On native platforms (Android/iOS), backups are persisted via the
 * Capacitor Filesystem API to a non-evictable directory, because WebView
 * IndexedDB can be cleared by the OS under storage pressure. On web, the
 * original IndexedDB store is used.
 */

import { Capacitor } from '@capacitor/core';
import { getUserProfile, saveUserProfile, overwriteUserProfile } from './dbService';
import { isValidUserProfile } from '../../utils/profileUtils';
import { exportPreferencesData, importPreferencesData } from './ExportService';
import { getAllThinkingRecordsByUser, saveThinkingBatch } from './ThinkingStoreService';

export interface BackupMetadata {
    id: string;
    username: string;
    timestamp: string;
    version: number;
    sizeBytes: number;
    conversationCount: number;
    tradeCount: number;
}

const BACKUP_STORE_NAME = 'backups';
const MAX_BACKUPS = 5;
const AUTO_BACKUP_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const NATIVE_BACKUP_DIR = 'AugustBackups';

let autoBackupTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Whether to use the native (Filesystem) backup store instead of IndexedDB.
 * Resolved lazily so tests / SSR don't crash on a missing Capacitor bridge.
 */
const useNativeStorage = (): boolean => {
    try {
        return Capacitor.isNativePlatform();
    } catch {
        return false;
    }
};

/**
 * Initialize the backup database (web fallback only).
 * On native, backups live in the Filesystem directory, so no init is needed.
 */
const initBackupDB = (): Promise<IDBDatabase> => {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('AugustBackups', 1);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);

        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains(BACKUP_STORE_NAME)) {
                const store = db.createObjectStore(BACKUP_STORE_NAME, { keyPath: 'id' });
                store.createIndex('username', 'username', { unique: false });
                store.createIndex('timestamp', 'timestamp', { unique: false });
            }
        };
    });
};

/**
 * Read a Capacitor Filesystem file result as a string, handling both the
 * string and Blob return shapes across plugin versions. (Newer typings
 * return Blob; TextDecoder.decode() won't accept a Blob directly.)
 */
const readFileAsString = async (data: string | Blob): Promise<string> => {
    if (typeof data === 'string') return data;
    // Blob path — convert via arrayBuffer, then decode.
    const buf = await (data as Blob).arrayBuffer();
    return new TextDecoder().decode(buf);
};

/**
 * Lazy-load the Filesystem API so web builds don't pay the import cost and
 * tests don't fail when the plugin is absent.
 */
const getFilesystem = async () => {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
    return { Filesystem, Directory, Encoding };
};

/**
 * Ensure the native backup directory exists.
 */
const ensureNativeDir = async (): Promise<void> => {
    const { Filesystem, Directory } = await getFilesystem();
    try {
        await Filesystem.mkdir({
            path: NATIVE_BACKUP_DIR,
            directory: Directory.Documents,
            recursive: true,
        });
    } catch (err: any) {
        // Already-exists is expected; rethrow real failures.
        if (!String(err?.message || '').toLowerCase().includes('exist')) {
            throw err;
        }
    }
};

/**
 * Create a backup of the current user profile
 */
export const createBackup = async (username: string): Promise<BackupMetadata | null> => {
    try {
        const profile = await getUserProfile(username);

        if (!profile) {
            console.warn('[BackupService] No profile found for', username);
            return null;
        }

        // The id embeds the SANITIZED username — the raw name can contain
        // characters that collide after filename sanitization ("a.b" vs "a_b"
        // both become "a_b"), letting one user list/delete the other's backups.
        const safeUser = username.replace(/[^a-zA-Z0-9_-]/g, '_');
        const backupId = `backup-${safeUser}-${Date.now()}`;
        const timestamp = new Date().toISOString();
        const profileJson = JSON.stringify(profile);
        // F6: preferences sidecar — provider configs (with keys), learning
        // rules, price alerts, autopilot state. Restoring a backup previously
        // only restored the profile, silently dropping all of these.
        const preferencesJson = JSON.stringify(await exportPreferencesData());
        // Thinking sidecar — the outcome-correlated reasoning corpus lives in
        // its own store that is NOT part of UserProfile; a restore without it
        // silently dropped every reasoning record.
        const thinkingJson = JSON.stringify(await getAllThinkingRecordsByUser(username));
        const sizeBytes = new Blob([profileJson]).size;
        const metadata: BackupMetadata = {
            id: backupId,
            username,
            timestamp,
            version: 1,
            sizeBytes,
            conversationCount: profile.conversations?.length || 0,
            tradeCount: profile.tradeLog?.length || 0,
        };

        if (useNativeStorage()) {
            // P1-9: Persist to Filesystem (non-evictable) on native.
            await ensureNativeDir();
            const { Filesystem, Directory, Encoding } = await getFilesystem();
            // Write the profile + a sidecar metadata file. We encode the
            // metadata in the filename so list operations don't need to read
            // every full backup just to show metadata.
            const baseName = `${safeUser}_${backupId}`;
            // CRITICAL: encoding: Encoding.UTF8 is required when passing a
            // string. Without it, Capacitor treats data as base64 binary and
            // throws on native (silently caught → backup returns null).
            await Filesystem.writeFile({
                path: `${NATIVE_BACKUP_DIR}/${baseName}.json`,
                data: profileJson,
                directory: Directory.Documents,
                encoding: Encoding.UTF8,
            });
            await Filesystem.writeFile({
                path: `${NATIVE_BACKUP_DIR}/${baseName}.meta.json`,
                data: JSON.stringify(metadata),
                directory: Directory.Documents,
                encoding: Encoding.UTF8,
            });
            await Filesystem.writeFile({
                path: `${NATIVE_BACKUP_DIR}/${baseName}.prefs.json`,
                data: preferencesJson,
                directory: Directory.Documents,
                encoding: Encoding.UTF8,
            });
            await Filesystem.writeFile({
                path: `${NATIVE_BACKUP_DIR}/${baseName}.thinking.json`,
                data: thinkingJson,
                directory: Directory.Documents,
                encoding: Encoding.UTF8,
            });
        } else {
            // Web fallback: IndexedDB (subject to eviction under storage
            // pressure, but acceptable on desktop browsers).
            const db = await initBackupDB();
            await new Promise<void>((resolve, reject) => {
                const tx = db.transaction(BACKUP_STORE_NAME, 'readwrite');
                const store = tx.objectStore(BACKUP_STORE_NAME);
                const request = store.add({
                    id: backupId,
                    username,
                    timestamp,
                    version: 1,
                    profile: profileJson,
                    preferences: preferencesJson,
                    thinking: thinkingJson,
                    sizeBytes,
                    conversationCount: metadata.conversationCount,
                    tradeCount: metadata.tradeCount,
                });
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });
        }

        // Cleanup old backups (keep only MAX_BACKUPS)
        await cleanupOldBackups(username);

        console.log(`[BackupService] Created backup ${backupId} (${(sizeBytes / 1024).toFixed(1)}KB)${useNativeStorage() ? ' [native]' : ''}`);

        return metadata;
    } catch (error) {
        console.error('[BackupService] Failed to create backup:', error);
        return null;
    }
};

/**
 * Get all backups for a user
 */
export const getBackups = async (username: string): Promise<BackupMetadata[]> => {
    try {
        if (useNativeStorage()) {
            const { Filesystem, Directory, Encoding } = await getFilesystem();
            const result = await Filesystem.readdir({
                path: NATIVE_BACKUP_DIR,
                directory: Directory.Documents,
            });
            const safeUser = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '_');
            const prefix = `${safeUser(username)}_`;
            // Read only the .meta.json sidecar files for this user. The
            // prefix is a cheap pre-filter — the AUTHORITATIVE check is the
            // username stored in the metadata (usernames sharing a sanitized
            // prefix, e.g. "bob" vs "bob_2", must not see each other's).
            const metaFiles = result.files
                .map(f => f.name)
                .filter(name => name.startsWith(prefix) && name.endsWith('.meta.json'));
            const metas: BackupMetadata[] = [];
            for (const metaFile of metaFiles) {
                try {
                    const { data } = await Filesystem.readFile({
                        path: `${NATIVE_BACKUP_DIR}/${metaFile}`,
                        directory: Directory.Documents,
                        encoding: Encoding.UTF8,
                    });
                    const meta = JSON.parse(await readFileAsString(data)) as BackupMetadata;
                    if (meta.username === username) metas.push(meta);
                } catch (err) {
                    console.warn(`[BackupService] Failed to read native meta ${metaFile}:`, err);
                }
            }
            return metas.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        }

        const db = await initBackupDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(BACKUP_STORE_NAME, 'readonly');
            const store = tx.objectStore(BACKUP_STORE_NAME);
            const index = store.index('username');
            const request = index.getAll(username);

            request.onsuccess = () => {
                const backups = request.result
                    .map((b: any) => ({
                        id: b.id,
                        username: b.username,
                        timestamp: b.timestamp,
                        version: b.version,
                        sizeBytes: b.sizeBytes,
                        conversationCount: b.conversationCount,
                        tradeCount: b.tradeCount
                    }))
                    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
                resolve(backups);
            };
            request.onerror = () => reject(request.error);
        });
    } catch (error) {
        console.error('[BackupService] Failed to get backups:', error);
        return [];
    }
};

/**
 * Read the full profile JSON for a backup (from either storage backend).
 * Used by exportBackupToFile.
 */
const readBackupProfile = async (backupId: string): Promise<{ username: string; timestamp: string; profileJson: string; preferencesJson?: string | null; thinkingJson?: string | null } | null> => {
    if (useNativeStorage()) {
        const { Filesystem, Directory, Encoding } = await getFilesystem();
        // Find the .json (non-meta) file whose name ends with the backupId.
        const result = await Filesystem.readdir({
            path: NATIVE_BACKUP_DIR,
            directory: Directory.Documents,
        });
        const match = result.files.find(f => f.name.endsWith(`${backupId}.json`) && !f.name.endsWith('.meta.json'));
        if (!match) return null;
        const { data } = await Filesystem.readFile({
            path: `${NATIVE_BACKUP_DIR}/${match.name}`,
            directory: Directory.Documents,
            encoding: Encoding.UTF8,
        });
        const profileJson = await readFileAsString(data);
        // Recover username + timestamp from the sidecar meta if present.
        let username = '';
        let timestamp = new Date().toISOString();
        try {
            const metaResult = await Filesystem.readFile({
                path: `${NATIVE_BACKUP_DIR}/${match.name.replace('.json', '.meta.json')}`,
                directory: Directory.Documents,
                encoding: Encoding.UTF8,
            });
            const meta = JSON.parse(await readFileAsString(metaResult.data));
            username = meta.username || '';
            timestamp = meta.timestamp || timestamp;
        } catch { /* meta missing — best effort */ }
        // Preferences sidecar (F6) — old backups don't have one.
        let preferencesJson: string | null = null;
        try {
            const prefsResult = await Filesystem.readFile({
                path: `${NATIVE_BACKUP_DIR}/${match.name.replace('.json', '.prefs.json')}`,
                directory: Directory.Documents,
                encoding: Encoding.UTF8,
            });
            preferencesJson = await readFileAsString(prefsResult.data);
        } catch { /* prefs sidecar missing — pre-F6 backup */ }
        // Thinking sidecar — old backups don't have one.
        let thinkingJson: string | null = null;
        try {
            const thinkingResult = await Filesystem.readFile({
                path: `${NATIVE_BACKUP_DIR}/${match.name.replace('.json', '.thinking.json')}`,
                directory: Directory.Documents,
                encoding: Encoding.UTF8,
            });
            thinkingJson = await readFileAsString(thinkingResult.data);
        } catch { /* thinking sidecar missing — pre-thinking backup */ }
        return { username, timestamp, profileJson, preferencesJson, thinkingJson };
    }

    const db = await initBackupDB();
    const backup = await new Promise<any>((resolve, reject) => {
        const tx = db.transaction(BACKUP_STORE_NAME, 'readonly');
        const store = tx.objectStore(BACKUP_STORE_NAME);
        const request = store.get(backupId);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
    if (!backup) return null;
    return { username: backup.username, timestamp: backup.timestamp, profileJson: backup.profile, preferencesJson: backup.preferences ?? null, thinkingJson: backup.thinking ?? null };
};

/**
 * Delete a specific backup
 */
export const deleteBackup = async (backupId: string): Promise<boolean> => {
    try {
        if (useNativeStorage()) {
            const { Filesystem, Directory } = await getFilesystem();
            const result = await Filesystem.readdir({
                path: NATIVE_BACKUP_DIR,
                directory: Directory.Documents,
            });
            // Match the id followed by the extension separator — a bare
            // `includes(backupId)` also matched OTHER backups whose ids share
            // the string as a prefix ("backup-bob-1000" matched
            // "backup-bob-10000"), deleting the wrong user's/version's data.
            const toDelete = result.files.filter(f => f.name.includes(`${backupId}.`));
            for (const f of toDelete) {
                await Filesystem.deleteFile({
                    path: `${NATIVE_BACKUP_DIR}/${f.name}`,
                    directory: Directory.Documents,
                });
            }
            console.log(`[BackupService] Deleted backup ${backupId}`);
            return true;
        }

        const db = await initBackupDB();
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(BACKUP_STORE_NAME, 'readwrite');
            const store = tx.objectStore(BACKUP_STORE_NAME);
            const request = store.delete(backupId);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });

        console.log(`[BackupService] Deleted backup ${backupId}`);
        return true;
    } catch (error) {
        console.error('[BackupService] Failed to delete backup:', error);
        return false;
    }
};

/**
 * Export backup to downloadable file
 */
export const exportBackupToFile = async (backupId: string): Promise<void> => {
    try {
        const record = await readBackupProfile(backupId);
        if (!record) {
            throw new Error('Backup not found');
        }

        // Include the preferences sidecar in the downloadable artifact. Keep
        // the profile-shaped envelope for compatibility with the existing
        // import flow, while avoiding a second opaque file users can forget.
        const profile = JSON.parse(record.profileJson) as Record<string, unknown>;
        const preferences = record.preferencesJson ? JSON.parse(record.preferencesJson) : undefined;
        const exportPayload = {
            ...profile,
            _backupExportedAt: new Date().toISOString(),
            ...(preferences ? { _preferencesBackup: preferences } : {}),
        };
        const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `august_backup_${record.username}_${new Date(record.timestamp).toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
    } catch (error) {
        console.error('[BackupService] Failed to export backup:', error);
        throw error;
    }
};

/**
 * Restore a backup — REPLACES the profile stored under the backup's username
 * with the backed-up snapshot (delete-sync in sqliteSaveUserProfile removes
 * rows absent from the backup, so a smaller/older backup truly restores).
 */
export const restoreBackup = async (
    backupId: string
): Promise<{ success: boolean; error?: string; username?: string }> => {
    try {
        const record = await readBackupProfile(backupId);
        if (!record) {
            return { success: false, error: 'Backup not found' };
        }
        let profile: unknown;
        try {
            profile = JSON.parse(record.profileJson);
        } catch (e) {
            return { success: false, error: 'Backup file is corrupted (invalid JSON)' };
        }
        if (!isValidUserProfile(profile)) {
            return { success: false, error: 'Backup contains an invalid profile' };
        }
        await overwriteUserProfile(profile);
        // F6: restore the preferences sidecar (provider configs, learning
        // rules, alerts, autopilot state). Old backups don't have one — the
        // profile restore still succeeds without it.
        if (record.preferencesJson) {
            try {
                const preferences = JSON.parse(record.preferencesJson);
                if (preferences && typeof preferences === 'object') {
                    await importPreferencesData(preferences);
                }
            } catch (e) {
                console.warn('[BackupService] Preferences sidecar could not be restored:', e);
            }
        }
        // Restore the thinking sidecar (reasoning corpus). Old backups don't
        // have one — the profile restore still succeeds without it.
        if (record.thinkingJson) {
            try {
                const parsed = JSON.parse(record.thinkingJson);
                if (Array.isArray(parsed)) {
                    await saveThinkingBatch(parsed);
                    console.log(`[BackupService] Restored ${parsed.length} thinking records`);
                }
            } catch (e) {
                console.warn('[BackupService] Thinking sidecar could not be restored:', e);
            }
        }
        return { success: true, username: profile.username };
    } catch (error) {
        console.error('[BackupService] Restore failed:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Restore failed',
        };
    }
};

/**
 * Cleanup old backups, keeping only the most recent MAX_BACKUPS
 */
const cleanupOldBackups = async (username: string): Promise<void> => {
    const backups = await getBackups(username);

    if (backups.length > MAX_BACKUPS) {
        const toDelete = backups.slice(MAX_BACKUPS);
        for (const backup of toDelete) {
            await deleteBackup(backup.id);
        }
        console.log(`[BackupService] Cleaned up ${toDelete.length} old backups`);
    }
};

/**
 * Start automatic backup scheduler
 */
export const startAutoBackup = (username: string, onBackupCreated?: (metadata: BackupMetadata) => void): void => {
    stopAutoBackup(); // Clear any existing timer

    console.log(`[BackupService] Starting auto-backup for ${username} (every ${AUTO_BACKUP_INTERVAL_MS / 60000} minutes)`);

    autoBackupTimer = setInterval(async () => {
        const metadata = await createBackup(username);
        if (metadata && onBackupCreated) {
            onBackupCreated(metadata);
        }
    }, AUTO_BACKUP_INTERVAL_MS);
};

/**
 * Stop automatic backup scheduler
 */
export const stopAutoBackup = (): void => {
    if (autoBackupTimer) {
        clearInterval(autoBackupTimer);
        autoBackupTimer = null;
        console.log('[BackupService] Stopped auto-backup');
    }
};

/**
 * Validate import data structure
 */
export const validateImportData = (data: any): { valid: boolean; errors: string[] } => {
    const errors: string[] = [];

    if (!data || typeof data !== 'object') {
        return { valid: false, errors: ['Invalid data format - expected JSON object'] };
    }

    // Check required fields
    if (!data.username || typeof data.username !== 'string') {
        errors.push('Missing or invalid username');
    }

    if (data.conversations && !Array.isArray(data.conversations)) {
        errors.push('conversations must be an array');
    }

    if (data.tradeLog && !Array.isArray(data.tradeLog)) {
        errors.push('tradeLog must be an array');
    }

    if (data.savedAnalyses && !Array.isArray(data.savedAnalyses)) {
        errors.push('savedAnalyses must be an array');
    }

    if (data.settings && typeof data.settings !== 'object') {
        errors.push('settings must be an object');
    }

    // Validate conversation structure
    if (Array.isArray(data.conversations)) {
        data.conversations.forEach((conv: any, index: number) => {
            if (!conv.id || !conv.title) {
                errors.push(`Conversation at index ${index} missing id or title`);
            }
            if (!Array.isArray(conv.messages)) {
                errors.push(`Conversation at index ${index} has invalid messages array`);
            }
        });
    }

    return {
        valid: errors.length === 0,
        errors
    };
};

/**
 * Get import preview (summary of what will be imported)
 */
export const getImportPreview = (data: any): {
    username: string;
    conversationCount: number;
    messageCount: number;
    tradeCount: number;
    savedAnalysesCount: number;
} => {
    const messageCount = data.conversations?.reduce((sum: number, conv: any) =>
        sum + (conv.messages?.length || 0), 0) || 0;

    return {
        username: data.username || 'Unknown',
        conversationCount: data.conversations?.length || 0,
        messageCount,
        tradeCount: data.tradeLog?.length || 0,
        savedAnalysesCount: data.savedAnalyses?.length || 0
    };
};
