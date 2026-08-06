/**
 * SqliteService.ts
 * 
 * Native SQLite storage service for reliable Android data persistence.
 * Falls back to IndexedDB on web for development.
 * 
 * Uses @capacitor-community/sqlite which maps to native SQLite on Android/iOS.
 * This ensures data survives cache clears and is never deleted by the OS.
 */

import { Capacitor } from '@capacitor/core';
import { CapacitorSQLite, SQLiteConnection, SQLiteDBConnection } from '@capacitor-community/sqlite';
import { LoggedTrade, UserProfile, Conversation, TradeSummary, GlobalMemory, UserSettings, Message } from '../../types';
import { setSqliteDb, runExclusiveWrite } from './SqliteServiceHelpers';
import { DEFAULT_LEVERAGE } from '../../utils/conversationUtils';

/**
 * Parse a stored JSON blob defensively. A single corrupt cell (e.g. from an
 * interrupted native write) must not abort the entire profile load — the row
 * is skipped with a warning instead of throwing (which previously also broke
 * every subsequent save, since saves read the profile first).
 * Returns `any` to mirror the original `JSON.parse(...)` inference at the
 * call sites (fallbacks of `{}`/`[]`/`undefined` would otherwise narrow the
 * generic and break LoggedTrade/Conversation assignability).
 */
const safeParseJson = (json: string | null | undefined, fallback: any): any => {
    if (!json) return fallback;
    try {
        return JSON.parse(json);
    } catch (e) {
        console.warn('[SqliteService] Corrupt JSON row skipped:', e instanceof Error ? e.message : e);
        return fallback;
    }
};

// Database configuration
const DB_NAME = 'futuresai_db';
const DB_VERSION = 5;

// SQLite connection singleton
let sqliteConnection: SQLiteConnection | null = null;
let db: SQLiteDBConnection | null = null;
let isInitialized = false;

/**
 * Check if running on native platform (Android/iOS)
 */
export const isNativePlatform = (): boolean => {
    return Capacitor.isNativePlatform();
};

/**
 * Initialize SQLite database
 * Creates tables if they don't exist
 */
export const initSqlite = async (): Promise<boolean> => {
    if (isInitialized) return true;

    if (!isNativePlatform()) {
        console.log('[SqliteService] Running on web - SQLite not available, using IndexedDB fallback');
        return false;
    }

    try {
        console.log('[SqliteService] Initializing SQLite database...');

        // Create SQLite connection
        sqliteConnection = new SQLiteConnection(CapacitorSQLite);

        // Check connection consistency
        const retCC = (await sqliteConnection.checkConnectionsConsistency()).result;
        const isConn = (await sqliteConnection.isConnection(DB_NAME, false)).result;

        if (retCC && isConn) {
            db = await sqliteConnection.retrieveConnection(DB_NAME, false);
        } else {
            db = await sqliteConnection.createConnection(
                DB_NAME,
                false,
                'no-encryption',
                DB_VERSION,
                false
            );
        }

        await db.open();

        // Expose the connection to other infrastructure services
        setSqliteDb(db);

        // Create tables
        await createTables();

        isInitialized = true;
        console.log('[SqliteService] SQLite initialized successfully');
        return true;
    } catch (error) {
        console.error('[SqliteService] Failed to initialize SQLite:', error);
        return false;
    }
};

/**
 * Create database tables
 */
const createTables = async (): Promise<void> => {
    if (!db) throw new Error('Database not initialized');

    // Users table
    await db.execute(`
        CREATE TABLE IF NOT EXISTS users (
            username TEXT PRIMARY KEY,
            createdAt TEXT,
            updatedAt TEXT,
            globalMemory TEXT,
            settings TEXT,
            finalTradeSummary TEXT,
            tradingWeaknesses TEXT,
            insightKnowledgeBase TEXT,
            learningRules TEXT,
            lastActiveConversationId TEXT
        );
    `);

    // Trades table - indexed for fast queries
    await db.execute(`
        CREATE TABLE IF NOT EXISTS trades (
            id TEXT PRIMARY KEY,
            username TEXT NOT NULL,
            timestamp TEXT,
            outcome TEXT,
            coinName TEXT,
            direction TEXT,
            entry REAL,
            stopLoss REAL,
            takeProfit TEXT,
            pnlAmount REAL,
            investmentAmount REAL,
            leverage REAL,
            analysis TEXT,
            postMortem TEXT,
            confidenceVsActual TEXT,
            slOptimizationData TEXT,
            tradeType TEXT,
            meta TEXT
        );
        
        CREATE INDEX IF NOT EXISTS idx_trades_username ON trades(username);
        CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON trades(timestamp);
        CREATE INDEX IF NOT EXISTS idx_trades_outcome ON trades(outcome);
    `);

    // Conversations table
    await db.execute(`
        CREATE TABLE IF NOT EXISTS conversations (
            id TEXT PRIMARY KEY,
            username TEXT NOT NULL,
            title TEXT,
            createdAt TEXT,
            messages TEXT,
            settings TEXT
        );
        
        CREATE INDEX IF NOT EXISTS idx_conversations_username ON conversations(username);
    `);

    // Trade summaries table
    await db.execute(`
        CREATE TABLE IF NOT EXISTS trade_summaries (
            id TEXT PRIMARY KEY,
            username TEXT NOT NULL,
            summaryText TEXT,
            timestamp TEXT
        );
        
        CREATE INDEX IF NOT EXISTS idx_summaries_username ON trade_summaries(username);
    `);

    // Saved analyses table
    await db.execute(`
        CREATE TABLE IF NOT EXISTS saved_analyses (
            id TEXT PRIMARY KEY,
            username TEXT NOT NULL,
            analysis TEXT,
            userPrompt TEXT,
            timestamp TEXT,
            meta TEXT
        );
    `);

    // Thinking records table — stores per-model reasoning for training & analysis
    await db.execute(`
        CREATE TABLE IF NOT EXISTS thinking_records (
            id TEXT PRIMARY KEY,
            tradeId TEXT NOT NULL,
            username TEXT NOT NULL,
            provider TEXT NOT NULL,
            role TEXT,
            modelName TEXT,
            reasoning TEXT,
            finalOutput TEXT,
            rawReasoning TEXT,
            messageId TEXT,
            analysisJson TEXT,
            debateTurnIndex INTEGER,
            debateTurnSpeaker TEXT,
            confidence TEXT,
            probability REAL,
            outcome TEXT,
            createdAt TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_thinking_trade ON thinking_records(tradeId);
        CREATE INDEX IF NOT EXISTS idx_thinking_provider ON thinking_records(provider);
        CREATE INDEX IF NOT EXISTS idx_thinking_outcome ON thinking_records(outcome);
        CREATE INDEX IF NOT EXISTS idx_thinking_username ON thinking_records(username);
        CREATE INDEX IF NOT EXISTS idx_thinking_message ON thinking_records(messageId);
    `);

    // Schema migration tracking — must exist before the gated blocks below.
    // Records which ALTER migrations have already been applied so the blocks
    // run once per install instead of on every startup.
    await db.execute(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL
        );
    `);

    const migrationResult = await db.query('SELECT COALESCE(MAX(version), 0) as v FROM schema_migrations');
    const appliedVersion = migrationResult.values?.[0]?.v || 0;

    // Record a migration as applied. Called even when the ALTER was a
    // no-op duplicate — pre-migration installs already carry the columns.
    const recordMigration = async (version: number): Promise<void> => {
        await db!.run(
            'INSERT OR REPLACE INTO schema_migrations (version, applied_at) VALUES (?, ?)',
            [version, new Date().toISOString()]
        );
    };

    // VERSION 2 MIGRATION: Add userPrompt if missing
    // ALTER TABLE ADD COLUMN has no IF NOT EXISTS in SQLite, so "duplicate
    // column" failures are expected on re-runs — anything else is logged.
    const isDuplicateColumnError = (e: unknown): boolean =>
        e instanceof Error && /duplicate column/i.test(e.message);
    const swallowDuplicateColumn = (e: unknown, migration: string): void => {
        if (!isDuplicateColumnError(e)) {
            console.warn(`[SqliteService] Migration "${migration}" failed:`, e);
        }
    };

    if (appliedVersion < 2) {
        try {
            await db.execute(`ALTER TABLE saved_analyses ADD COLUMN userPrompt TEXT;`);
        } catch (e) {
            swallowDuplicateColumn(e, 'v2 saved_analyses.userPrompt');
        }
        await recordMigration(2);
    }

    // VERSION 3 MIGRATION: Add settings to conversations and meta to trades
    if (appliedVersion < 3) {
        try {
            await db.execute(`ALTER TABLE conversations ADD COLUMN settings TEXT;`);
        } catch (e) {
            swallowDuplicateColumn(e, 'v3 conversations.settings');
        }
        try {
            await db.execute(`ALTER TABLE trades ADD COLUMN meta TEXT;`);
        } catch (e) {
            swallowDuplicateColumn(e, 'v3 trades.meta');
        }
        await recordMigration(3);
    }

    // VERSION 4 MIGRATION: Add lastActiveConversationId to users and meta to saved_analyses
    if (appliedVersion < 4) {
        try {
            await db.execute(`ALTER TABLE users ADD COLUMN lastActiveConversationId TEXT;`);
        } catch (e) {
            swallowDuplicateColumn(e, 'v4 users.lastActiveConversationId');
        }
        try {
            await db.execute(`ALTER TABLE saved_analyses ADD COLUMN meta TEXT;`);
        } catch (e) {
            swallowDuplicateColumn(e, 'v4 saved_analyses.meta');
        }
        await recordMigration(4);
    }

    // VERSION 5 MIGRATION: Enrich thinking_records with final output, raw
    // chain-of-thought, and the analysis card (message) id so each reasoning
    // set is linked to its trade/card prediction.
    if (appliedVersion < 5) {
        try {
            await db.execute(`ALTER TABLE thinking_records ADD COLUMN finalOutput TEXT;`);
        } catch (e) {
            swallowDuplicateColumn(e, 'v5 thinking_records.finalOutput');
        }
        try {
            await db.execute(`ALTER TABLE thinking_records ADD COLUMN rawReasoning TEXT;`);
        } catch (e) {
            swallowDuplicateColumn(e, 'v5 thinking_records.rawReasoning');
        }
        try {
            await db.execute(`ALTER TABLE thinking_records ADD COLUMN messageId TEXT;`);
        } catch (e) {
            swallowDuplicateColumn(e, 'v5 thinking_records.messageId');
        }
        try {
            await db.execute(`CREATE INDEX IF NOT EXISTS idx_thinking_message ON thinking_records(messageId);`);
        } catch (e) {
            console.warn('[SqliteService] Migration "v5 thinking_records.messageId index" failed:', e);
        }
        await recordMigration(5);
    }

    console.log('[SqliteService] Tables created successfully');
};

/**
 * Close database connection
 */
export const closeSqlite = async (): Promise<void> => {
    if (db) {
        await db.close();
        await sqliteConnection?.closeConnection(DB_NAME, false);
        db = null;
        setSqliteDb(null);
        isInitialized = false;
    }
};

// ============================================================================
// USER OPERATIONS
// ============================================================================

/**
 * Get all usernames
 */
export const sqliteGetAllUsernames = async (): Promise<string[]> => {
    if (!db) return [];

    const result = await db.query('SELECT username FROM users');
    return result.values?.map(row => row.username) || [];
};

/**
 * Get user profile
 */
export const sqliteGetUserProfile = async (username: string): Promise<UserProfile | null> => {
    if (!db) return null;

    // Get user data
    const userResult = await db.query(
        'SELECT * FROM users WHERE username = ?',
        [username]
    );

    if (!userResult.values || userResult.values.length === 0) {
        return null;
    }

    const userData = userResult.values[0];

    // Get trades
    const tradesResult = await db.query(
        'SELECT * FROM trades WHERE username = ? ORDER BY timestamp DESC',
        [username]
    );
    const trades: LoggedTrade[] = (tradesResult.values || []).map(row => {
        const meta = safeParseJson(row.meta, {});
        // Ensure tradeType is restored cleanly if missing
        const tradeType = row.tradeType || meta.tradeType || undefined;

        return {
            id: row.id,
            timestamp: row.timestamp,
            outcome: row.outcome,
            analysis: safeParseJson(row.analysis, undefined),
            postMortem: row.postMortem,
            pnlAmount: row.pnlAmount,
            investmentAmount: row.investmentAmount,
            leverage: row.leverage,
            slOptimizationData: safeParseJson(row.slOptimizationData, undefined),
            tradeType,
            ...meta // Spread metadata to restore extended fields
        };
    });

    // Get conversations
    const convResult = await db.query(
        'SELECT * FROM conversations WHERE username = ? ORDER BY createdAt DESC',
        [username]
    );
    const conversations: Conversation[] = (convResult.values || []).map(row => {
        const settings = safeParseJson(row.settings, {});

        return {
            id: row.id,
            title: row.title,
            timestamp: new Date(row.createdAt).getTime(),
            messages: safeParseJson(row.messages, []),
            // Defaults for current Conversation fields; saved settings override.
            ocrModel: '',
            moderatorProviderId: settings.moderatorProvider || '', // legacy column name compat
            moderatorModel: '',
            leverage: DEFAULT_LEVERAGE,
            ...settings // Override defaults with saved settings
        } as Conversation;

    });

    // Get trade summaries
    const summariesResult = await db.query(
        'SELECT * FROM trade_summaries WHERE username = ?',
        [username]
    );
    const tradeSummaries: TradeSummary[] = (summariesResult.values || []).map(row => ({
        id: row.id,
        summaryText: row.summaryText,
        timestamp: row.timestamp
    }));

    // Get saved analyses
    const analysesResult = await db.query(
        'SELECT * FROM saved_analyses WHERE username = ?',
        [username]
    );
    const savedAnalyses = (analysesResult.values || []).map(row => {
        const meta = safeParseJson(row.meta, {});

        return {
            id: row.id,
            analysis: safeParseJson(row.analysis, null),
            userPrompt: row.userPrompt || '',
            timestamp: row.timestamp,
            ...meta // Restore extended fields (models used, etc)
        }
    });

    return {
        username: userData.username,
        createdAt: userData.createdAt,
        updatedAt: userData.updatedAt,
        globalMemory: safeParseJson(userData.globalMemory, undefined),
        settings: safeParseJson(userData.settings, { activeFrameworks: [] }),
        finalTradeSummary: userData.finalTradeSummary,
        tradingWeaknesses: safeParseJson(userData.tradingWeaknesses, undefined),
        insightKnowledgeBase: safeParseJson(userData.insightKnowledgeBase, undefined),
        learningRules: safeParseJson(userData.learningRules, undefined),
        lastActiveConversationId: userData.lastActiveConversationId, // Restore state
        tradeLog: trades,
        conversations,
        tradeSummaries,
        savedAnalyses
    };
};

/**
 * Save user profile (upsert)
 */
const serializeConversationMessages = (messages: Message[]): string => JSON.stringify(
    messages.map(({ activeDebateSpeakers, ensembleProgress, ...message }) => message)
);

/**
 * Delete rows of a collection that are absent from the profile being saved.
 * INSERT OR REPLACE can't remove rows; without this, deletions never
 * propagate to SQLite (stale snapshots and imports resurrected deleted rows).
 * The IN list is chunked: SQLite's default variable limit is 999 and large
 * profiles (1000+ trades) would otherwise throw "too many SQL variables"
 * inside the caller's transaction, rolling back the whole save.
 */
const deleteAbsentRows = async (
    table: string,
    username: string,
    presentIds: string[]
): Promise<void> => {
    if (!db) return;
    if (presentIds.length === 0) {
        await db.run(`DELETE FROM ${table} WHERE username = ?`, [username]);
        return;
    }
    const CHUNK_SIZE = 400;
    for (let i = 0; i < presentIds.length; i += CHUNK_SIZE) {
        const chunk = presentIds.slice(i, i + CHUNK_SIZE);
        const placeholders = chunk.map(() => '?').join(',');
        await db.run(
            `DELETE FROM ${table} WHERE username = ? AND id NOT IN (${placeholders})`,
            [username, ...chunk]
        );
    }
};

export const sqliteSaveUserProfile = async (profile: UserProfile): Promise<void> => {
    if (!db) throw new Error('Database not initialized');

    const now = new Date().toISOString();

    // Wrap all writes in a single transaction for performance.
    // Without this, each INSERT is a separate native-bridge round trip
    // (100 trades + 20 conversations = 120+ sequential awaits).
    // Callers serialize via runExclusiveWrite (dbService), so BEGIN can no
    // longer collide with another open transaction on this connection.
    await db.execute('BEGIN TRANSACTION');
    let transactionOpen = true;
    try {
        // Upsert user
        await db.run(`
            INSERT OR REPLACE INTO users (
                username, createdAt, updatedAt, globalMemory, settings,
                finalTradeSummary, tradingWeaknesses, insightKnowledgeBase, learningRules, lastActiveConversationId
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            profile.username,
            profile.createdAt || now,
            now,
            profile.globalMemory ? JSON.stringify(profile.globalMemory) : null,
            JSON.stringify(profile.settings),
            profile.finalTradeSummary,
            profile.tradingWeaknesses ? JSON.stringify(profile.tradingWeaknesses) : null,
            profile.insightKnowledgeBase ? JSON.stringify(profile.insightKnowledgeBase) : null,
            profile.learningRules ? JSON.stringify(profile.learningRules) : null,
            profile.lastActiveConversationId
        ]);

        // Sync trades
        for (const trade of profile.tradeLog || []) {
            await sqliteSaveTrade(profile.username, trade);
        }
        // INSERT OR REPLACE only upserts — rows deleted from the profile
        // (deleted trades, imported-over data) must be removed explicitly,
        // or they'd resurrect on the next full load (and web/native would
        // diverge: IndexedDB replaces the whole record, SQLite did not).
        await deleteAbsentRows(
            'trades',
            profile.username,
            (profile.tradeLog || []).map(t => t.id)
        );

        // Sync conversations
        for (const conv of profile.conversations || []) {
            // Extract settings (everything that is not a core column)
            const { id, title, timestamp, messages, ...settings } = conv;

            await db.run(`
                INSERT OR REPLACE INTO conversations (id, username, title, createdAt, messages, settings)
                VALUES (?, ?, ?, ?, ?, ?)
            `, [
                conv.id,
                profile.username,
                conv.title,
                new Date(conv.timestamp).toISOString(),
                 serializeConversationMessages(conv.messages),
                JSON.stringify(settings) // Save extended flags and models
            ]);
        }
        await deleteAbsentRows(
            'conversations',
            profile.username,
            (profile.conversations || []).map(c => c.id)
        );

        // Sync trade summaries
        for (const summary of profile.tradeSummaries || []) {
            await db.run(`
                INSERT OR REPLACE INTO trade_summaries (id, username, summaryText, timestamp)
                VALUES (?, ?, ?, ?)
            `, [summary.id, profile.username, summary.summaryText, summary.timestamp]);
        }
        await deleteAbsentRows(
            'trade_summaries',
            profile.username,
            (profile.tradeSummaries || []).map(s => s.id)
        );

        // Sync saved analyses
        for (const analysis of profile.savedAnalyses || []) {
            // Extract meta (everything not in core columns)
            const { id, analysis: content, userPrompt, timestamp, ...meta } = analysis;

            await db.run(`
                INSERT OR REPLACE INTO saved_analyses (id, username, analysis, userPrompt, timestamp, meta)
                VALUES (?, ?, ?, ?, ?, ?)
            `, [
                id,
                profile.username,
                JSON.stringify(content),
                userPrompt,
                timestamp,
                JSON.stringify(meta) // Save extended fields like modelUsed
            ]);
        }
        await deleteAbsentRows(
            'saved_analyses',
            profile.username,
            (profile.savedAnalyses || []).map(a => a.id)
        );

        await db.execute('COMMIT');
        transactionOpen = false;
    } catch (error) {
        // Only roll back when we own an open transaction — a failed BEGIN or
        // an already-rolled-back transaction would make this ROLLBACK throw
        // and mask the original error.
        if (transactionOpen) {
            try {
                await db.execute('ROLLBACK');
            } catch (rollbackError) {
                console.error('[SqliteService] ROLLBACK failed:', rollbackError);
            }
        }
        console.error('[SqliteService] Save failed, transaction rolled back:', error);
        throw error;
    }
};

// ============================================================================
// TRADE OPERATIONS
// ============================================================================

/**
 * Save a single trade
 */
export const sqliteSaveTrade = async (username: string, trade: LoggedTrade): Promise<void> => {
    if (!db) throw new Error('Database not initialized');

    const entry = trade.analysis?.entryPoints?.[0]?.price
        ? parseFloat(trade.analysis.entryPoints[0].price.replace(/[^0-9.]/g, ''))
        : null;
    const stopLoss = trade.analysis?.stopLoss
        ? parseFloat(trade.analysis.stopLoss.replace(/[^0-9.]/g, ''))
        : null;

    // Extract meta fields (everything not in the core columns)
    const {
        id, timestamp, outcome, analysis, postMortem,
        pnlAmount, investmentAmount, leverage, slOptimizationData, tradeType,
        ...meta
    } = trade;

    await db.run(`
        INSERT OR REPLACE INTO trades (
            id, username, timestamp, outcome, coinName, direction,
            entry, stopLoss, takeProfit, pnlAmount, investmentAmount,
            leverage, analysis, postMortem, slOptimizationData, tradeType, meta
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
        trade.id,
        username,
        trade.timestamp,
        trade.outcome,
        trade.analysis?.coinName || null,
        trade.analysis?.direction || null,
        entry,
        stopLoss,
        trade.analysis?.takeProfit ? JSON.stringify(trade.analysis.takeProfit) : null,
        trade.pnlAmount,
        trade.investmentAmount,
        trade.leverage,
        trade.analysis ? JSON.stringify(trade.analysis) : null,
        trade.postMortem,
        trade.slOptimizationData ? JSON.stringify(trade.slOptimizationData) : null,
        trade.tradeType,
        JSON.stringify(meta) // Save extended fields like thought processes, models used, etc.
    ]);
};

/**
 * Get trades for a user
 */
export const sqliteGetTrades = async (username: string): Promise<LoggedTrade[]> => {
    if (!db) return [];

    const result = await db.query(
        'SELECT * FROM trades WHERE username = ? ORDER BY timestamp DESC',
        [username]
    );

    return (result.values || []).map(row => {
        const meta = safeParseJson(row.meta, {});
        // Ensure tradeType is restored cleanly if missing
        const tradeType = row.tradeType || meta.tradeType || undefined;

        return {
            id: row.id,
            timestamp: row.timestamp,
            outcome: row.outcome,
            analysis: safeParseJson(row.analysis, undefined),
            postMortem: row.postMortem,
            pnlAmount: row.pnlAmount,
            investmentAmount: row.investmentAmount,
            leverage: row.leverage,
            slOptimizationData: safeParseJson(row.slOptimizationData, undefined),
            tradeType,
            ...meta // Restore extended fields
        };
    });
};

/**
 * Delete a trade
 */
export const sqliteDeleteTrade = async (tradeId: string): Promise<void> => {
    if (!db) return;
    await db.run('DELETE FROM trades WHERE id = ?', [tradeId]);
};

/**
 * Delete a user and all associated data across all tables
 */
/**
 * Delete a user and all associated data across all tables.
 * Serialized through the write mutex and wrapped in one transaction: an
 * in-flight save (heartbeat/debounce/unload) reading the profile, then
 * re-inserting it after these DELETEs, would resurrect the deleted user.
 */
export const sqliteDeleteUser = async (username: string): Promise<void> => {
    if (!db) return;
    // Narrow the module-level connection inside the closure (it's mutable).
    const connection = db;
    await runExclusiveWrite(async () => {
        await connection.execute('BEGIN TRANSACTION');
        let transactionOpen = true;
        try {
            await connection.run('DELETE FROM trades WHERE username = ?', [username]);
            await connection.run('DELETE FROM conversations WHERE username = ?', [username]);
            await connection.run('DELETE FROM trade_summaries WHERE username = ?', [username]);
            await connection.run('DELETE FROM saved_analyses WHERE username = ?', [username]);
            await connection.run('DELETE FROM thinking_records WHERE username = ?', [username]);
            await connection.run('DELETE FROM users WHERE username = ?', [username]);
            await connection.execute('COMMIT');
            transactionOpen = false;
        } catch (error) {
            if (transactionOpen) {
                try {
                    await connection.execute('ROLLBACK');
                } catch (rollbackError) {
                    console.error('[SqliteService] Delete ROLLBACK failed:', rollbackError);
                }
            }
            throw error;
        }
    });
};

/**
 * Get trade count for a user
 */
export const sqliteGetTradeCount = async (username: string): Promise<number> => {
    if (!db) return 0;
    const result = await db.query(
        'SELECT COUNT(*) as count FROM trades WHERE username = ?',
        [username]
    );
    return result.values?.[0]?.count || 0;
};

// ============================================================================
// GRANULAR READ API — lazy-load individual entities instead of full profile
// ============================================================================

/**
 * Get a single trade by ID
 */
export const sqliteGetTrade = async (tradeId: string): Promise<LoggedTrade | null> => {
    if (!db) return null;
    const result = await db.query('SELECT * FROM trades WHERE id = ?', [tradeId]);
    if (!result.values || result.values.length === 0) return null;

    const row = result.values[0];
    const meta = safeParseJson(row.meta, {});
    const tradeType = row.tradeType || meta.tradeType || undefined;

    return {
        id: row.id,
        timestamp: row.timestamp,
        outcome: row.outcome,
        analysis: safeParseJson(row.analysis, undefined),
        postMortem: row.postMortem,
        pnlAmount: row.pnlAmount,
        investmentAmount: row.investmentAmount,
        leverage: row.leverage,
        slOptimizationData: safeParseJson(row.slOptimizationData, undefined),
        tradeType,
        ...meta
    };
};

/**
 * List conversations with pagination (newest first)
 */
export const sqliteListConversations = async (
    username: string,
    options?: { limit?: number; before?: number }
): Promise<Conversation[]> => {
    if (!db) return [];

    const limit = options?.limit || 20;
    let query = 'SELECT * FROM conversations WHERE username = ?';
    const params: any[] = [username];

    if (options?.before) {
        query += ' AND createdAt < ?';
        params.push(new Date(options.before).toISOString());
    }

    query += ' ORDER BY createdAt DESC LIMIT ?';
    params.push(limit);

    const result = await db.query(query, params);
    return (result.values || []).map(row => {
        const settings = safeParseJson(row.settings, {});
        return {
            id: row.id,
            title: row.title,
            timestamp: new Date(row.createdAt).getTime(),
            messages: safeParseJson(row.messages, []),
            ...settings
        } as Conversation;
    });
};

/**
 * List trade summaries with pagination
 */
export const sqliteListSummaries = async (
    username: string,
    options?: { limit?: number }
): Promise<TradeSummary[]> => {
    if (!db) return [];

    const limit = options?.limit || 50;
    const result = await db.query(
        'SELECT * FROM trade_summaries WHERE username = ? ORDER BY timestamp DESC LIMIT ?',
        [username, limit]
    );
    return (result.values || []).map(row => ({
        id: row.id,
        summaryText: row.summaryText,
        timestamp: row.timestamp
    }));
};

// ============================================================================
// MIGRATION HELPER
// ============================================================================

/**
 * Migrate data from IndexedDB to SQLite
 * Called once on app upgrade
 */
export const migrateFromIndexedDB = async (
    getUserProfile: (username: string) => Promise<UserProfile | undefined>,
    getAllUsernames: () => Promise<string[]>
): Promise<{ migrated: boolean; userCount: number; tradeCount: number }> => {
    if (!isNativePlatform() || !isInitialized) {
        return { migrated: false, userCount: 0, tradeCount: 0 };
    }

    try {
        console.log('[SqliteService] Starting migration from IndexedDB...');

        const usernames = await getAllUsernames();
        let totalTrades = 0;

        for (const username of usernames) {
            // Check if already migrated
            const existingProfile = await sqliteGetUserProfile(username);
            if (existingProfile && existingProfile.tradeLog.length > 0) {
                console.log(`[SqliteService] User ${username} already migrated, skipping`);
                continue;
            }

            // Get from IndexedDB
            const profile = await getUserProfile(username);
            if (profile) {
                // Serialized like every other writer — the migration opens
                // BEGIN/COMMIT on the shared connection.
                await runExclusiveWrite(async () => {
                    await sqliteSaveUserProfile(profile);
                });
                totalTrades += profile.tradeLog?.length || 0;
                console.log(`[SqliteService] Migrated user ${username} with ${profile.tradeLog?.length || 0} trades`);
            }
        }

        console.log(`[SqliteService] Migration complete: ${usernames.length} users, ${totalTrades} trades`);
        return { migrated: true, userCount: usernames.length, tradeCount: totalTrades };
    } catch (error) {
        console.error('[SqliteService] Migration failed:', error);
        return { migrated: false, userCount: 0, tradeCount: 0 };
    }
};
