/**
 * DataIntegrityService - Data validation and recovery utilities
 * Protects against data loss during updates and provides recovery options
 */

import { getUserProfile, saveUserProfile } from '../infrastructure/dbService';
import { createBackup, getBackups, BackupMetadata } from '../infrastructure/BackupService';
import { getPreference, setPreference, getPreferenceObject, setPreferenceObject, PREF_KEYS } from '../infrastructure/PreferencesService';

// Current data schema version
const CURRENT_DATA_VERSION = 1;

/**
 * Data integrity check result
 */
export interface IntegrityCheckResult {
    valid: boolean;
    issues: string[];
    tradeCountChanged: boolean;
    previousTradeCount: number;
    currentTradeCount: number;
    hasBackups: boolean;
    latestBackup: BackupMetadata | null;
}

/**
 * Run data integrity check on user profile
 * Call this at startup after loading user data
 */
export const checkDataIntegrity = async (
    username: string,
    currentTradeCount: number
): Promise<IntegrityCheckResult> => {
    const issues: string[] = [];

    // Get last known trade count
    const lastTradeCountStr = await getPreference(`${PREF_KEYS.LAST_TRADE_COUNT}_${username}`);
    const previousTradeCount = lastTradeCountStr ? parseInt(lastTradeCountStr, 10) : 0;

    // Check if trade count decreased (potential data loss)
    const tradeCountChanged = previousTradeCount > 0 && currentTradeCount < previousTradeCount;

    if (tradeCountChanged) {
        const lostTrades = previousTradeCount - currentTradeCount;
        issues.push(`Trade count decreased from ${previousTradeCount} to ${currentTradeCount} (${lostTrades} trades missing)`);
    }

    // Check for existing backups
    const backups = await getBackups(username);
    const hasBackups = backups.length > 0;
    const latestBackup = backups.length > 0 ? backups[0] : null;

    // If trade count dropped and we have backups, suggest recovery
    if (tradeCountChanged && hasBackups && latestBackup) {
        if (latestBackup.tradeCount > currentTradeCount) {
            issues.push(`Latest backup (${new Date(latestBackup.timestamp).toLocaleString()}) has ${latestBackup.tradeCount} trades - recovery possible`);
        }
    }

    // Update last known trade count for next session
    await setPreference(`${PREF_KEYS.LAST_TRADE_COUNT}_${username}`, String(currentTradeCount));

    // Update session timestamp
    await setPreference(`${PREF_KEYS.LAST_SESSION}_${username}`, new Date().toISOString());

    return {
        valid: issues.length === 0,
        issues,
        tradeCountChanged,
        previousTradeCount,
        currentTradeCount,
        hasBackups,
        latestBackup,
    };
};

/**
 * Create a startup backup
 * Should be called immediately after user login to preserve current state
 */
export const createStartupBackup = async (username: string): Promise<BackupMetadata | null> => {
    console.log(`[DataIntegrity] Creating startup backup for ${username}`);

    try {
        const metadata = await createBackup(username);
        if (metadata) {
            console.log(`[DataIntegrity] Startup backup created: ${metadata.id} (${metadata.tradeCount} trades)`);
        }
        return metadata;
    } catch (error) {
        console.error('[DataIntegrity] Failed to create startup backup:', error);
        return null;
    }
};

/**
 * Update the stored trade count
 * Call this after any trade log modification
 */
export const updateTradeCount = async (username: string, tradeCount: number): Promise<void> => {
    await setPreference(`${PREF_KEYS.LAST_TRADE_COUNT}_${username}`, String(tradeCount));
};

/**
 * Get stored data version for migration handling
 */
export const getDataVersion = async (username: string): Promise<number> => {
    const versionStr = await getPreference(`${PREF_KEYS.DATA_VERSION}_${username}`);
    return versionStr ? parseInt(versionStr, 10) : 0;
};

/**
 * Set data version after migration
 */
export const setDataVersion = async (username: string, version: number): Promise<void> => {
    await setPreference(`${PREF_KEYS.DATA_VERSION}_${username}`, String(version));
};

/**
 * Check if data migration is needed
 */
export const needsMigration = async (username: string): Promise<boolean> => {
    const currentVersion = await getDataVersion(username);
    return currentVersion < CURRENT_DATA_VERSION;
};

/**
 * Run any necessary data migrations
 */
export const runMigrations = async (username: string): Promise<void> => {
    const currentVersion = await getDataVersion(username);

    if (currentVersion < 1) {
        // Version 1 migration: Add data version tracking
        console.log('[DataIntegrity] Running migration to version 1');
        await setDataVersion(username, 1);
    }

    // Future migrations can be added here
    // if (currentVersion < 2) { ... }
};

/**
 * Get recovery options for a user
 */
export const getRecoveryOptions = async (username: string): Promise<{
    hasBackups: boolean;
    backups: BackupMetadata[];
    recommendedBackup: BackupMetadata | null;
}> => {
    const backups = await getBackups(username);

    // Recommend the backup with the most trades
    let recommendedBackup: BackupMetadata | null = null;
    if (backups.length > 0) {
        recommendedBackup = backups.reduce((best, current) =>
            current.tradeCount > best.tradeCount ? current : best
            , backups[0]);
    }

    return {
        hasBackups: backups.length > 0,
        backups,
        recommendedBackup,
    };
};

/**
 * Log integrity event for debugging
 */
/**
 * Log integrity event for debugging
 */
export const logIntegrityEvent = async (event: string, data?: any): Promise<void> => {
    const logKey = PREF_KEYS.DATA_INTEGRITY_LOG;
    try {
        const existingLog = await getPreferenceObject<any[]>(logKey);
        const log = existingLog || [];

        log.push({
            timestamp: new Date().toISOString(),
            event,
            data,
        });

        // Keep only last 50 entries
        const trimmedLog = log.slice(-50);
        await setPreferenceObject(logKey, trimmedLog);
    } catch (error) {
        console.error('[DataIntegrity] Failed to log event:', error);
    }
};
