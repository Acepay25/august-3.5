/**
 * SqliteServiceHelpers
 *
 * Exposes the internal SQLite db connection for use by other infrastructure
 * services (like ThinkingStoreService) without circular dependencies.
 *
 * The db connection is managed by SqliteService.ts via initSqlite().
 */

import { SQLiteDBConnection } from '@capacitor-community/sqlite';
import { isNativePlatform } from './SqliteService';

// This is set by SqliteService when it initializes the connection.
// We use a module-level variable that both modules can access.
let dbConnection: SQLiteDBConnection | null = null;

/**
 * Set the db connection (called by SqliteService.initSqlite)
 */
export const setSqliteDb = (db: SQLiteDBConnection | null): void => {
    dbConnection = db;
};

/**
 * Get the current SQLite db connection.
 * Returns null if not on native platform or not yet initialized.
 */
export const getSqliteDb = async (): Promise<SQLiteDBConnection | null> => {
    if (!isNativePlatform()) return null;
    return dbConnection;
};
