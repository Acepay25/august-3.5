/**
 * ThinkingStoreService
 *
 * Stores and retrieves per-model reasoning records for each trade.
 * Enables outcome-correlated reasoning analysis and model training data export.
 *
 * Cross-platform: SQLite on native (Android/iOS), IndexedDB on web.
 */

import { Capacitor } from '@capacitor/core';
import { isNativePlatform } from './SqliteService';
import { openDB } from 'idb';
import { ThinkingRecord, ThinkingRecordStats, ThinkingExportRow } from '../../types/thinking';
import { TradeOutcome } from '../../types';

// =============================================================================
// CONSTANTS
// =============================================================================

const DB_NAME = 'FuturesAI-DB';
const STORE_NAME = 'thinking_records';
const DB_VERSION = 2;

let idbDb: any = null;

// =============================================================================
// INITIALIZATION
// =============================================================================

const initIndexedDB = async (): Promise<any> => {
    if (idbDb) return idbDb;
    idbDb = await openDB(DB_NAME, DB_VERSION, {
        upgrade(db) {
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                store.createIndex('tradeId', 'tradeId');
                store.createIndex('provider', 'provider');
                store.createIndex('outcome', 'outcome');
                store.createIndex('username', 'username');
            }
        },
    });
    return idbDb;
};

// =============================================================================
// SAVE OPERATIONS
// =============================================================================

/**
 * Save a single thinking record.
 */
export const saveThinkingRecord = async (record: ThinkingRecord): Promise<void> => {
    if (isNativePlatform()) {
        await saveThinkingRecordSqlite(record);
    } else {
        const db = await initIndexedDB();
        await db.put(STORE_NAME, record);
    }
};

/**
 * Save multiple thinking records in a single transaction.
 */
export const saveThinkingBatch = async (records: ThinkingRecord[]): Promise<void> => {
    if (records.length === 0) return;

    if (isNativePlatform()) {
        // SQLite path — use the same db connection as SqliteService
        // We import dynamically to avoid circular dependency
        const { getSqliteDb } = await import('./SqliteServiceHelpers');
        const db = await getSqliteDb();
        if (!db) throw new Error('SQLite database not initialized');

        await db.execute('BEGIN TRANSACTION');
        try {
            for (const record of records) {
                await db.run(`
                    INSERT OR REPLACE INTO thinking_records (
                        id, tradeId, username, provider, role, modelName,
                        reasoning, analysisJson, debateTurnIndex, debateTurnSpeaker,
                        confidence, probability, outcome, createdAt
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    record.id,
                    record.tradeId,
                    record.username,
                    record.provider,
                    record.role,
                    record.modelName || null,
                    record.reasoning,
                    record.analysisJson || null,
                    record.debateTurnIndex ?? null,
                    record.debateTurnSpeaker || null,
                    record.confidence || null,
                    record.probability ?? null,
                    record.outcome || null,
                    record.createdAt,
                ]);
            }
            await db.execute('COMMIT');
        } catch (error) {
            await db.execute('ROLLBACK');
            throw error;
        }
    } else {
        const db = await initIndexedDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        for (const record of records) {
            await tx.store.put(record);
        }
        await tx.done;
    }
};

/**
 * SQLite-specific save (used when db is already available).
 */
const saveThinkingRecordSqlite = async (record: ThinkingRecord): Promise<void> => {
    const { getSqliteDb } = await import('./SqliteServiceHelpers');
    const db = await getSqliteDb();
    if (!db) throw new Error('SQLite database not initialized');

    await db.run(`
        INSERT OR REPLACE INTO thinking_records (
            id, tradeId, username, provider, role, modelName,
            reasoning, analysisJson, debateTurnIndex, debateTurnSpeaker,
            confidence, probability, outcome, createdAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
        record.id,
        record.tradeId,
        record.username,
        record.provider,
        record.role,
        record.modelName || null,
        record.reasoning,
        record.analysisJson || null,
        record.debateTurnIndex ?? null,
        record.debateTurnSpeaker || null,
        record.confidence || null,
        record.probability ?? null,
        record.outcome || null,
        record.createdAt,
    ]);
};

// =============================================================================
// READ OPERATIONS
// =============================================================================

/**
 * Get all thinking records for a specific trade.
 */
export const getThinkingByTrade = async (tradeId: string): Promise<ThinkingRecord[]> => {
    if (isNativePlatform()) {
        const { getSqliteDb } = await import('./SqliteServiceHelpers');
        const db = await getSqliteDb();
        if (!db) return [];

        const result = await db.query(
            'SELECT * FROM thinking_records WHERE tradeId = ? ORDER BY debateTurnIndex ASC, createdAt ASC',
            [tradeId]
        );
        return (result.values || []).map(rowToRecord);
    } else {
        const db = await initIndexedDB();
        const all = await db.getAllFromIndex(STORE_NAME, 'tradeId', tradeId);
        return all.sort((a: ThinkingRecord, b: ThinkingRecord) =>
            (a.debateTurnIndex ?? 0) - (b.debateTurnIndex ?? 0)
        );
    }
};

/**
 * Get thinking records for a specific provider, optionally filtered by outcome.
 */
export const getThinkingByProvider = async (
    provider: string,
    options?: { limit?: number; outcome?: TradeOutcome }
): Promise<ThinkingRecord[]> => {
    const limit = options?.limit || 100;

    if (isNativePlatform()) {
        const { getSqliteDb } = await import('./SqliteServiceHelpers');
        const db = await getSqliteDb();
        if (!db) return [];

        let query = 'SELECT * FROM thinking_records WHERE provider = ?';
        const params: any[] = [provider];

        if (options?.outcome) {
            query += ' AND outcome = ?';
            params.push(options.outcome);
        }

        query += ' ORDER BY createdAt DESC LIMIT ?';
        params.push(limit);

        const result = await db.query(query, params);
        return (result.values || []).map(rowToRecord);
    } else {
        const db = await initIndexedDB();
        const all = await db.getAllFromIndex(STORE_NAME, 'provider', provider);
        let filtered = all;
        if (options?.outcome) {
            filtered = filtered.filter((r: ThinkingRecord) => r.outcome === options.outcome);
        }
        return filtered.slice(0, limit);
    }
};

/**
 * Get all thinking records for a user (for export).
 */
export const getAllThinkingForExport = async (username: string): Promise<ThinkingExportRow[]> => {
    if (isNativePlatform()) {
        const { getSqliteDb } = await import('./SqliteServiceHelpers');
        const db = await getSqliteDb();
        if (!db) return [];

        const result = await db.query(
            'SELECT * FROM thinking_records WHERE username = ? ORDER BY createdAt ASC',
            [username]
        );
        return (result.values || []).map(rowToExportRow);
    } else {
        const db = await initIndexedDB();
        const all = await db.getAllFromIndex(STORE_NAME, 'username', username);
        return all.map((r: ThinkingRecord) => recordToExportRow(r));
    }
};

/**
 * Get aggregate stats per provider for the reasoning dashboard.
 */
export const getProviderReasoningStats = async (
    username: string
): Promise<ThinkingRecordStats[]> => {
    if (isNativePlatform()) {
        const { getSqliteDb } = await import('./SqliteServiceHelpers');
        const db = await getSqliteDb();
        if (!db) return [];

        const result = await db.query(`
            SELECT
                provider,
                COUNT(*) as total,
                SUM(CASE WHEN outcome = 'WIN' THEN 1 ELSE 0 END) as wins,
                SUM(CASE WHEN outcome = 'LOSS' THEN 1 ELSE 0 END) as losses,
                SUM(CASE WHEN outcome = 'PENDING' OR outcome IS NULL THEN 1 ELSE 0 END) as pending,
                AVG(probability) as avgProbability
            FROM thinking_records
            WHERE username = ? AND role = 'analyst'
            GROUP BY provider
            ORDER BY total DESC
        `, [username]);

        return (result.values || []).map((row: any) => ({
            provider: row.provider,
            total: row.total,
            wins: row.wins || 0,
            losses: row.losses || 0,
            pending: row.pending || 0,
            avgConfidence: 0, // Computed below
            avgProbability: Math.round((row.avgProbability || 0) * 10) / 10,
            winRate: row.wins && row.total > 0
                ? Math.round(((row.wins / row.total) * 100) * 10) / 10
                : 0,
        }));
    } else {
        const db = await initIndexedDB();
        const all: ThinkingRecord[] = await db.getAllFromIndex(STORE_NAME, 'username', username);
        const analysts = all.filter(r => r.role === 'analyst');

        const byProvider = new Map<string, ThinkingRecord[]>();
        for (const r of analysts) {
            if (!byProvider.has(r.provider)) byProvider.set(r.provider, []);
            byProvider.get(r.provider)!.push(r);
        }

        const stats: ThinkingRecordStats[] = [];
        for (const [provider, records] of byProvider) {
            const wins = records.filter(r => r.outcome === TradeOutcome.WIN).length;
            const losses = records.filter(r => r.outcome === TradeOutcome.LOSS).length;
            const pending = records.filter(r => !r.outcome || r.outcome === TradeOutcome.PENDING).length;
            const avgProb = records.reduce((sum, r) => sum + (r.probability || 0), 0) / records.length;
            stats.push({
                provider,
                total: records.length,
                wins,
                losses,
                pending,
                avgConfidence: 0,
                avgProbability: Math.round(avgProb * 10) / 10,
                winRate: wins > 0 ? Math.round((wins / (wins + losses)) * 1000) / 10 : 0,
            });
        }
        return stats.sort((a, b) => b.total - a.total);
    }
};

// =============================================================================
// UPDATE OPERATIONS
// =============================================================================

/**
 * Update the outcome for all thinking records belonging to a trade.
 * Called when a trade is logged with a WIN/LOSS result.
 */
export const updateThinkingOutcome = async (
    tradeId: string,
    outcome: TradeOutcome
): Promise<void> => {
    if (isNativePlatform()) {
        const { getSqliteDb } = await import('./SqliteServiceHelpers');
        const db = await getSqliteDb();
        if (!db) return;

        await db.run(
            'UPDATE thinking_records SET outcome = ? WHERE tradeId = ?',
            [outcome, tradeId]
        );
    } else {
        const db = await initIndexedDB();
        const records = await db.getAllFromIndex(STORE_NAME, 'tradeId', tradeId);
        const tx = db.transaction(STORE_NAME, 'readwrite');
        for (const record of records) {
            record.outcome = outcome;
            await tx.store.put(record);
        }
        await tx.done;
    }
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

const rowToRecord = (row: any): ThinkingRecord => ({
    id: row.id,
    tradeId: row.tradeId,
    username: row.username,
    provider: row.provider,
    role: row.role,
    modelName: row.modelName || undefined,
    reasoning: row.reasoning || '',
    analysisJson: row.analysisJson || undefined,
    debateTurnIndex: row.debateTurnIndex ?? undefined,
    debateTurnSpeaker: row.debateTurnSpeaker || undefined,
    confidence: row.confidence || undefined,
    probability: row.probability ?? undefined,
    outcome: row.outcome || undefined,
    createdAt: row.createdAt,
});

const rowToExportRow = (row: any): ThinkingExportRow => ({
    provider: row.provider,
    modelName: row.modelName || undefined,
    role: row.role,
    reasoning: row.reasoning || '',
    analysis: row.analysisJson ? JSON.parse(row.analysisJson) : undefined,
    confidence: row.confidence || undefined,
    probability: row.probability ?? undefined,
    outcome: row.outcome || undefined,
    tradeId: row.tradeId,
    createdAt: row.createdAt,
});

const recordToExportRow = (r: ThinkingRecord): ThinkingExportRow => ({
    provider: r.provider,
    modelName: r.modelName,
    role: r.role,
    reasoning: r.reasoning,
    analysis: r.analysisJson ? JSON.parse(r.analysisJson) : undefined,
    confidence: r.confidence,
    probability: r.probability,
    outcome: r.outcome,
    tradeId: r.tradeId,
    createdAt: r.createdAt,
});

/**
 * Generate a unique record ID.
 */
export const generateThinkingId = (): string => {
    return `think-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
};
