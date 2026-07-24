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
import { LoggedTrade, UserProfile, Conversation, TradeSummary, GlobalMemory, UserSettings } from '../../types';

// Database configuration
const DB_NAME = 'futuresai_db';
const DB_VERSION = 4;

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

    // VERSION 2 MIGRATION: Add userPrompt if missing
    if (DB_VERSION >= 2) {
        try {
            // Check if column exists first to avoid error, or rely on catch
            await db.execute(`ALTER TABLE saved_analyses ADD COLUMN userPrompt TEXT;`);
        } catch (e) {
            // Ignore if column already exists
        }
    }

    // VERSION 3 MIGRATION: Add settings to conversations and meta to trades
    if (DB_VERSION >= 3) {
        try {
            await db.execute(`ALTER TABLE conversations ADD COLUMN settings TEXT;`);
        } catch (e) {
            // Ignore if exists
        }
        try {
            await db.execute(`ALTER TABLE trades ADD COLUMN meta TEXT;`);
        } catch (e) {
            // Ignore if exists
        }
    }

    // VERSION 4 MIGRATION: Add lastActiveConversationId to users and meta to saved_analyses
    if (DB_VERSION >= 4) {
        try {
            await db.execute(`ALTER TABLE users ADD COLUMN lastActiveConversationId TEXT;`);
        } catch (e) {
            // Ignore if exists
        }
        try {
            await db.execute(`ALTER TABLE saved_analyses ADD COLUMN meta TEXT;`);
        } catch (e) {
            // Ignore if exists
        }
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
        const meta = row.meta ? JSON.parse(row.meta) : {};
        // Ensure tradeType is restored cleanly if missing
        const tradeType = row.tradeType || meta.tradeType || undefined;

        return {
            id: row.id,
            timestamp: row.timestamp,
            outcome: row.outcome,
            analysis: row.analysis ? JSON.parse(row.analysis) : undefined,
            postMortem: row.postMortem,
            pnlAmount: row.pnlAmount,
            investmentAmount: row.investmentAmount,
            leverage: row.leverage,
            slOptimizationData: row.slOptimizationData ? JSON.parse(row.slOptimizationData) : undefined,
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
        const settings = row.settings ? JSON.parse(row.settings) : {};

        return {
            id: row.id,
            title: row.title,
            timestamp: new Date(row.createdAt).getTime(),
            messages: row.messages ? JSON.parse(row.messages) : [],
            // Supply default values, but allow settings to override
            geminiModel: '',
            deepseekModel: '',
            zhipuModel: '',
            groqModel: '',
            groqNewModel: '',
            groqAlt2Model: '',
            openrouterModel: '',
            openaiModel: '',
            grokNativeModel: '',
            ocrModel: '',
            isGeminiEnabled: false,
            isDeepSeekEnabled: false,
            isZhipuEnabled: false,
            isGroqEnabled: false,
            isGroqNewEnabled: false,
            isGroqAlt2Enabled: false,
            isOpenrouterEnabled: false,
            isOpenaiEnabled: false,
            isGrokNativeEnabled: false,
            moderatorProvider: 'gemini' as any,
            moderatorModel: '',
            leverage: 100,
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
        const meta = row.meta ? JSON.parse(row.meta) : {};

        return {
            id: row.id,
            analysis: row.analysis ? JSON.parse(row.analysis) : null,
            userPrompt: row.userPrompt || '',
            timestamp: row.timestamp,
            ...meta // Restore extended fields (models used, etc)
        }
    });

    return {
        username: userData.username,
        createdAt: userData.createdAt,
        updatedAt: userData.updatedAt,
        globalMemory: userData.globalMemory ? JSON.parse(userData.globalMemory) : undefined,
        settings: userData.settings ? JSON.parse(userData.settings) : { activeFrameworks: [] },
        finalTradeSummary: userData.finalTradeSummary,
        tradingWeaknesses: userData.tradingWeaknesses ? JSON.parse(userData.tradingWeaknesses) : undefined,
        insightKnowledgeBase: userData.insightKnowledgeBase ? JSON.parse(userData.insightKnowledgeBase) : undefined,
        learningRules: userData.learningRules ? JSON.parse(userData.learningRules) : undefined,
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
export const sqliteSaveUserProfile = async (profile: UserProfile): Promise<void> => {
    if (!db) throw new Error('Database not initialized');

    const now = new Date().toISOString();

    // Wrap all writes in a single transaction for performance.
    // Without this, each INSERT is a separate native-bridge round trip
    // (100 trades + 20 conversations = 120+ sequential awaits).
    await db.execute('BEGIN TRANSACTION');
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
                JSON.stringify(conv.messages),
                JSON.stringify(settings) // Save extended flags and models
            ]);
        }

        // Sync trade summaries
        for (const summary of profile.tradeSummaries || []) {
            await db.run(`
                INSERT OR REPLACE INTO trade_summaries (id, username, summaryText, timestamp)
                VALUES (?, ?, ?, ?)
            `, [summary.id, profile.username, summary.summaryText, summary.timestamp]);
        }

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

        await db.execute('COMMIT');
    } catch (error) {
        await db.execute('ROLLBACK');
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
        const meta = row.meta ? JSON.parse(row.meta) : {};
        // Ensure tradeType is restored cleanly if missing
        const tradeType = row.tradeType || meta.tradeType || undefined;

        return {
            id: row.id,
            timestamp: row.timestamp,
            outcome: row.outcome,
            analysis: row.analysis ? JSON.parse(row.analysis) : undefined,
            postMortem: row.postMortem,
            pnlAmount: row.pnlAmount,
            investmentAmount: row.investmentAmount,
            leverage: row.leverage,
            slOptimizationData: row.slOptimizationData ? JSON.parse(row.slOptimizationData) : undefined,
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
export const sqliteDeleteUser = async (username: string): Promise<void> => {
    if (!db) return;
    await db.run('DELETE FROM trades WHERE username = ?', [username]);
    await db.run('DELETE FROM conversations WHERE username = ?', [username]);
    await db.run('DELETE FROM trade_summaries WHERE username = ?', [username]);
    await db.run('DELETE FROM saved_analyses WHERE username = ?', [username]);
    await db.run('DELETE FROM users WHERE username = ?', [username]);
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
                await sqliteSaveUserProfile(profile);
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
