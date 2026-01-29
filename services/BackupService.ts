/**
 * BackupService - Automated backup management
 * Handles auto-save, versioned backups, and import validation
 */

import { getUserProfile, saveUserProfile } from './dbService';

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

let autoBackupTimer: NodeJS.Timeout | null = null;

/**
 * Initialize the backup database
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
 * Create a backup of the current user profile
 */
export const createBackup = async (username: string): Promise<BackupMetadata | null> => {
    try {
        const db = await initBackupDB();
        const profile = await getUserProfile(username);

        if (!profile) {
            console.warn('[BackupService] No profile found for', username);
            return null;
        }

        const backupId = `backup-${username}-${Date.now()}`;
        const backupData = {
            id: backupId,
            username,
            timestamp: new Date().toISOString(),
            version: 1,
            profile: JSON.stringify(profile),
            sizeBytes: 0,
            conversationCount: profile.conversations?.length || 0,
            tradeCount: profile.tradeLog?.length || 0
        };

        backupData.sizeBytes = new Blob([backupData.profile]).size;

        // Store backup
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(BACKUP_STORE_NAME, 'readwrite');
            const store = tx.objectStore(BACKUP_STORE_NAME);
            const request = store.add(backupData);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });

        // Cleanup old backups (keep only MAX_BACKUPS)
        await cleanupOldBackups(username);

        console.log(`[BackupService] Created backup ${backupId} (${(backupData.sizeBytes / 1024).toFixed(1)}KB)`);

        return {
            id: backupId,
            username,
            timestamp: backupData.timestamp,
            version: backupData.version,
            sizeBytes: backupData.sizeBytes,
            conversationCount: backupData.conversationCount,
            tradeCount: backupData.tradeCount
        };
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
 * Restore profile from a backup
 */
export const restoreBackup = async (backupId: string): Promise<boolean> => {
    try {
        const db = await initBackupDB();

        const backup = await new Promise<any>((resolve, reject) => {
            const tx = db.transaction(BACKUP_STORE_NAME, 'readonly');
            const store = tx.objectStore(BACKUP_STORE_NAME);
            const request = store.get(backupId);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });

        if (!backup) {
            console.error('[BackupService] Backup not found:', backupId);
            return false;
        }

        const profile = JSON.parse(backup.profile);
        await saveUserProfile(backup.username, profile);

        console.log(`[BackupService] Restored backup ${backupId}`);
        return true;
    } catch (error) {
        console.error('[BackupService] Failed to restore backup:', error);
        return false;
    }
};

/**
 * Delete a specific backup
 */
export const deleteBackup = async (backupId: string): Promise<boolean> => {
    try {
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
        const db = await initBackupDB();

        const backup = await new Promise<any>((resolve, reject) => {
            const tx = db.transaction(BACKUP_STORE_NAME, 'readonly');
            const store = tx.objectStore(BACKUP_STORE_NAME);
            const request = store.get(backupId);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });

        if (!backup) {
            throw new Error('Backup not found');
        }

        const blob = new Blob([backup.profile], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `august_backup_${backup.username}_${new Date(backup.timestamp).toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
    } catch (error) {
        console.error('[BackupService] Failed to export backup:', error);
        throw error;
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
