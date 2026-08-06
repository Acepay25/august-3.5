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

// ─── Write serialization ─────────────────────────────────────────────────────
// The shared SQLite connection cannot nest BEGIN TRANSACTION. Overlapping
// writes (data debounce, settings debounce, 15s heartbeat, unload flush, and
// thinking-record batches) used to hit "cannot start a transaction within a
// transaction", and one flow's ROLLBACK then rolled back the OTHER flow's
// uncommitted writes. Every transactional writer funnels through this single
// promise chain so at most one transaction is open at a time.
let writeQueue: Promise<unknown> = Promise.resolve();

/**
 * Run a write while holding the serialized write queue.
 * The queue survives failures — one rejected write never blocks later ones.
 */
export const runExclusiveWrite = <T>(write: () => Promise<T>): Promise<T> => {
    const result = writeQueue.then(write, write);
    writeQueue = result.then(() => undefined, () => undefined);
    return result;
};
