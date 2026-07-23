/**
 * dbService.ts
 * 
 * Unified database service that uses:
 * - SQLite on native platforms (Android/iOS) for reliable persistence
 * - IndexedDB on web for development/testing
 * 
 * Automatically migrates data from IndexedDB to SQLite on first native run.
 */

import { openDB, IDBPDatabase } from 'idb';
import { UserProfile } from '../../types';
import { Capacitor } from '@capacitor/core';
import {
  initSqlite,
  isNativePlatform,
  sqliteGetAllUsernames,
  sqliteGetUserProfile,
  sqliteSaveUserProfile,
  sqliteDeleteUser,
  migrateFromIndexedDB
} from './SqliteService';
import {
  isSqliteMigrated,
  setSqliteMigrated,
  migrateLocalStorageToPreferences
} from './PreferencesService';

// IndexedDB configuration (fallback for web)
const DB_NAME = 'FuturesAI-DB';
const STORE_NAME = 'userProfiles';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase> | null = null;
let sqliteReady = false;
let dbReadyPromise: Promise<void> | null = null;

/**
 * Await database initialization and return whether SQLite is available.
 * Safe to call before or after initDatabase().
 */
const ensureDbReady = async (): Promise<boolean> => {
  if (dbReadyPromise) {
    await dbReadyPromise;
  }
  return sqliteReady;
};

/**
 * Initialize IndexedDB (web fallback)
 */
const initIndexedDB = () => {
  if (dbPromise) return dbPromise;
  dbPromise = openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'username' });
      }
    },
  });
  return dbPromise;
};

/**
 * Initialize database - call this on app startup
 * On native: Initializes SQLite and migrates data if needed
 * On web: Uses IndexedDB
 */
export const initDatabase = async (): Promise<void> => {
  if (!dbReadyPromise) {
    dbReadyPromise = (async () => {
      if (isNativePlatform()) {
        console.log('[dbService] Native platform detected, initializing SQLite...');
        sqliteReady = await initSqlite();

        if (sqliteReady) {
          // Check if we need to migrate
          const alreadyMigrated = await isSqliteMigrated();

          if (!alreadyMigrated) {
            console.log('[dbService] Running one-time migration...');

            // Migrate localStorage to Preferences
            await migrateLocalStorageToPreferences();

            // Migrate IndexedDB to SQLite
            await migrateFromIndexedDB(
              idbGetUserProfile,
              idbGetAllUsernames
            );

            // Mark as migrated
            await setSqliteMigrated();
            console.log('[dbService] Migration complete!');
          }
        }
      } else {
        console.log('[dbService] Web platform, using IndexedDB');
        await initIndexedDB();
      }
    })();
  }
  return dbReadyPromise;
};

// ============================================================================
// IndexedDB OPERATIONS (for web and migration source)
// ============================================================================

const idbGetAllUsernames = async (): Promise<string[]> => {
  const db = await initIndexedDB();
  const allKeys = await db.getAllKeys(STORE_NAME);
  return allKeys as string[];
};

const idbGetUserProfile = async (username: string): Promise<UserProfile | undefined> => {
  const db = await initIndexedDB();
  return db.get(STORE_NAME, username);
};

const idbSaveUserProfile = async (username: string, data: Partial<Omit<UserProfile, 'username'>>): Promise<void> => {
  const db = await initIndexedDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  const existingProfile = await store.get(username) || {};

  const updatedProfile: UserProfile = {
    username,
    conversations: [],
    tradeLog: [],
    savedAnalyses: [],
    tradeSummaries: [],
    finalTradeSummary: null,
    settings: { activeFrameworks: [] },
    ...existingProfile,
    ...data,
    updatedAt: new Date().toISOString(),
  };

  if (!updatedProfile.createdAt) {
    updatedProfile.createdAt = new Date().toISOString();
  }

  await store.put(updatedProfile);
  await tx.done;
};

const idbOverwriteUserProfile = async (profile: UserProfile): Promise<void> => {
  const db = await initIndexedDB();
  await db.put(STORE_NAME, profile);
};

const idbDeleteUserProfile = async (username: string): Promise<void> => {
  const db = await initIndexedDB();
  await db.delete(STORE_NAME, username);
};

// ============================================================================
// UNIFIED PUBLIC API - Routes to SQLite on native, IndexedDB on web
// ============================================================================

/**
 * Get all usernames
 */
export const getAllUsernames = async (): Promise<string[]> => {
  if (await ensureDbReady()) {
    return sqliteGetAllUsernames();
  }
  return idbGetAllUsernames();
};

/**
 * Get user profile
 */
export const getUserProfile = async (username: string): Promise<UserProfile | undefined> => {
  if (await ensureDbReady()) {
    const profile = await sqliteGetUserProfile(username);
    return profile || undefined;
  }
  return idbGetUserProfile(username);
};

/**
 * Save user profile (partial update)
 */
export const saveUserProfile = async (username: string, data: Partial<Omit<UserProfile, 'username'>>): Promise<void> => {
  if (await ensureDbReady()) {
    // For SQLite, we need to get existing and merge
    const existing = await sqliteGetUserProfile(username);
    const updatedProfile: UserProfile = {
      username,
      conversations: [],
      tradeLog: [],
      savedAnalyses: [],
      tradeSummaries: [],
      finalTradeSummary: null,
      settings: { activeFrameworks: [] },
      ...existing,
      ...data,
      updatedAt: new Date().toISOString(),
    };
    if (!updatedProfile.createdAt) {
      updatedProfile.createdAt = new Date().toISOString();
    }
    await sqliteSaveUserProfile(updatedProfile);
    return;
  }
  return idbSaveUserProfile(username, data);
};

/**
 * Overwrite entire user profile
 */
export const overwriteUserProfile = async (profile: UserProfile): Promise<void> => {
  if (await ensureDbReady()) {
    await sqliteSaveUserProfile(profile);
    return;
  }
  return idbOverwriteUserProfile(profile);
};

/**
 * Delete user profile
 */
export const deleteUserProfile = async (username: string): Promise<void> => {
  if (await ensureDbReady()) {
    await sqliteDeleteUser(username);
    return;
  }
  return idbDeleteUserProfile(username);
};

/**
 * Check if using native SQLite storage
 */
export const isUsingSqlite = (): boolean => sqliteReady;

/**
 * Get storage info for debugging
 */
export const getStorageInfo = async (): Promise<{
  platform: string;
  storageType: 'sqlite' | 'indexeddb';
  userCount: number;
}> => {
  const usernames = await getAllUsernames();
  const usingSqlite = await ensureDbReady();
  return {
    platform: Capacitor.getPlatform(),
    storageType: usingSqlite ? 'sqlite' : 'indexeddb',
    userCount: usernames.length
  };
};