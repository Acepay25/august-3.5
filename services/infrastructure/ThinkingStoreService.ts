/**
 * ThinkingStoreService
 *
 * Stores and retrieves per-model reasoning records for each trade.
 * Enables outcome-correlated reasoning analysis and model training data export.
 *
 * Cross-platform: SQLite on native (Android/iOS), IndexedDB on web.
 */

import { isNativePlatform } from './SqliteService';
import { openDB } from 'idb';
import { ThinkingRecord, ThinkingRecordStats, ThinkingExportRow, ThinkingTradeSummary } from '../../types/thinking';
import { TradeOutcome } from '../../types';

// =============================================================================
// CONSTANTS
// =============================================================================

// Dedicated database: this store must NOT share 'FuturesAI-DB' with dbService.
// A shared DB forces one version number across both services — the thinking
// store once bumped it to 3, which made dbService's v1 open fail with a
// VersionError and broke profile loading on web.
const DB_NAME = 'FuturesAI-Thinking-DB';
const STORE_NAME = 'thinking_records';
const DB_VERSION = 1;

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
                store.createIndex('messageId', 'messageId');
            }
        },
    });
    return idbDb;
};

/**
 * Canonical key for a prediction card's reasoning set.
 *
 * Every writer (analysis save, post-mortem, outcome update) and reader
 * (dashboard grouping, History tab, card deep-link) must derive the tradeId
 * through this single formula so the keys can never drift apart. The analysis
 * createdAt is the display key; the card (message) id is the stable fallback
 * when the AI omitted it.
 */
export const getThinkingTradeId = (
    analysisCreatedAt: string | undefined | null,
    messageId: string
): string => analysisCreatedAt || messageId;

/**
 * Cross-platform ordering for a reasoning set: debate turns by index first
 * (records without an index sort before index 0, matching SQLite's NULL-first
 * ORDER BY), then by creation time as a tiebreak.
 */
const compareThinkingRecords = (a: ThinkingRecord, b: ThinkingRecord): number => {
    const turnA = a.debateTurnIndex ?? -1;
    const turnB = b.debateTurnIndex ?? -1;
    if (turnA !== turnB) return turnA - turnB;
    return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
};

// Numeric scale for averaging confidence strings ('High' > 'Medium' > 'Low' > 'Avoid').
const CONFIDENCE_LEVEL_SCORE: Record<string, number> = {
    High: 4,
    Medium: 3,
    Low: 2,
    Avoid: 1,
};

/**
 * Representative outcome for a group of records (all records of a trade are
 * updated atomically, but legacy/diverged records can disagree). Priority:
 * resolved WIN/LOSS first, then ENTRY_NOT_HIT/SKIPPED, then anything else —
 * this mirrors the COALESCE(CASE…) expression used by the SQLite query.
 */
const pickRepresentativeOutcome = (records: ThinkingRecord[]): TradeOutcome | undefined => {
    const priority = (o: TradeOutcome | undefined): number => {
        if (o === TradeOutcome.WIN || o === TradeOutcome.LOSS) return 0;
        if (o === TradeOutcome.ENTRY_NOT_HIT || o === TradeOutcome.SKIPPED) return 1;
        return 2;
    };
    let best: TradeOutcome | undefined;
    for (const r of records) {
        if (!r.outcome) continue;
        if (!best || priority(r.outcome) < priority(best)) best = r.outcome;
    }
    return best;
};

/**
 * Parse a stored analysis JSON blob. One corrupt record must not abort the
 * whole export — on failure the raw string is returned so the training row
 * stays usable.
 */
const safeParseAnalysis = (json: string | null | undefined): unknown => {
    if (!json) return undefined;
    try {
        return JSON.parse(json);
    } catch {
        return json;
    }
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

// Retention cap: beyond this many records the oldest are pruned so the
// store doesn't grow unboundedly (every analysis appends ~3-5 records).
const MAX_THINKING_RECORDS = 5000;

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
                        reasoning, finalOutput, rawReasoning, messageId,
                        analysisJson, debateTurnIndex, debateTurnSpeaker,
                        confidence, probability, outcome, createdAt
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    record.id,
                    record.tradeId,
                    record.username,
                    record.provider,
                    record.role,
                    record.modelName || null,
                    record.reasoning,
                    record.finalOutput || null,
                    record.rawReasoning || null,
                    record.messageId || null,
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
            // Prune the oldest records beyond the cap (best-effort).
            try {
                await db.run(
                    `DELETE FROM thinking_records WHERE id NOT IN (SELECT id FROM thinking_records ORDER BY createdAt DESC LIMIT ?)`,
                    [MAX_THINKING_RECORDS]
                );
            } catch (e) {
                console.warn('[ThinkingStore] Prune failed:', e);
            }
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

        // Prune the oldest records beyond the cap (best-effort).
        try {
            const cleanupTx = db.transaction(STORE_NAME, 'readwrite');
            const all = await cleanupTx.store.getAll();
            const sorted = all.sort((a: ThinkingRecord, b: ThinkingRecord) => (a.createdAt < b.createdAt ? 1 : -1));
            for (const rec of sorted.slice(MAX_THINKING_RECORDS)) {
                await cleanupTx.store.delete(rec.id);
            }
            await cleanupTx.done;
        } catch (e) {
            console.warn('[ThinkingStore] Prune failed:', e);
        }
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
            reasoning, finalOutput, rawReasoning, messageId,
            analysisJson, debateTurnIndex, debateTurnSpeaker,
            confidence, probability, outcome, createdAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
        record.id,
        record.tradeId,
        record.username,
        record.provider,
        record.role,
        record.modelName || null,
        record.reasoning,
        record.finalOutput || null,
        record.rawReasoning || null,
        record.messageId || null,
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
 * When `username` is provided, results are scoped to that user — tradeId
 * keys are timestamp-derived and can theoretically collide across users.
 */
export const getThinkingByTrade = async (tradeId: string, username?: string): Promise<ThinkingRecord[]> => {
    if (isNativePlatform()) {
        const { getSqliteDb } = await import('./SqliteServiceHelpers');
        const db = await getSqliteDb();
        if (!db) return [];

        const result = await db.query(
            username
                ? 'SELECT * FROM thinking_records WHERE tradeId = ? AND username = ? ORDER BY COALESCE(debateTurnIndex, -1) ASC, createdAt ASC'
                : 'SELECT * FROM thinking_records WHERE tradeId = ? ORDER BY COALESCE(debateTurnIndex, -1) ASC, createdAt ASC',
            username ? [tradeId, username] : [tradeId]
        );
        return (result.values || []).map(rowToRecord);
    } else {
        const db = await initIndexedDB();
        const all = await db.getAllFromIndex(STORE_NAME, 'tradeId', tradeId);
        const scoped = username ? all.filter((r: ThinkingRecord) => r.username === username) : all;
        return scoped.sort(compareThinkingRecords);
    }
};

/**
 * Get all thinking records for a specific analysis card (message id).
 * Links a prediction card directly to its reasoning set.
 */
export const getThinkingByMessage = async (messageId: string, username?: string): Promise<ThinkingRecord[]> => {
    if (isNativePlatform()) {
        const { getSqliteDb } = await import('./SqliteServiceHelpers');
        const db = await getSqliteDb();
        if (!db) return [];

        const result = await db.query(
            username
                ? 'SELECT * FROM thinking_records WHERE messageId = ? AND username = ? ORDER BY COALESCE(debateTurnIndex, -1) ASC, createdAt ASC'
                : 'SELECT * FROM thinking_records WHERE messageId = ? ORDER BY COALESCE(debateTurnIndex, -1) ASC, createdAt ASC',
            username ? [messageId, username] : [messageId]
        );
        return (result.values || []).map(rowToRecord);
    } else {
        const db = await initIndexedDB();
        const all = await db.getAllFromIndex(STORE_NAME, 'messageId', messageId);
        const scoped = username ? all.filter((r: ThinkingRecord) => r.username === username) : all;
        return scoped.sort(compareThinkingRecords);
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
 * Get a browsable list of analysis runs (distinct tradeIds) for a user —
 * one entry per card prediction, with record count and outcome.
 */
export const getThinkingTrades = async (username: string): Promise<ThinkingTradeSummary[]> => {
    if (isNativePlatform()) {
        const { getSqliteDb } = await import('./SqliteServiceHelpers');
        const db = await getSqliteDb();
        if (!db) return [];

        const result = await db.query(`
            SELECT
                tradeId,
                MAX(createdAt) as createdAt,
                COUNT(*) as recordCount,
                COALESCE(
                    MAX(CASE WHEN outcome IN ('WIN','LOSS') THEN outcome END),
                    MAX(CASE WHEN outcome IN ('ENTRY_NOT_HIT','SKIPPED') THEN outcome END),
                    MAX(outcome)
                ) as outcome
            FROM thinking_records
            WHERE username = ?
            GROUP BY tradeId
            ORDER BY createdAt DESC
        `, [username]);

        return (result.values || []).map((row: any) => ({
            tradeId: row.tradeId,
            createdAt: row.createdAt || '',
            recordCount: row.recordCount || 0,
            outcome: row.outcome || undefined,
        }));
    } else {
        const db = await initIndexedDB();
        const all: ThinkingRecord[] = await db.getAllFromIndex(STORE_NAME, 'username', username);
        const byTrade = new Map<string, ThinkingRecord[]>();
        for (const r of all) {
            if (!byTrade.has(r.tradeId)) byTrade.set(r.tradeId, []);
            byTrade.get(r.tradeId)!.push(r);
        }
        const summaries: ThinkingTradeSummary[] = [];
        for (const [tradeId, records] of byTrade) {
            const sorted = [...records].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
            summaries.push({
                tradeId,
                createdAt: sorted[0]?.createdAt || '',
                recordCount: records.length,
                outcome: pickRepresentativeOutcome(records),
            });
        }
        return summaries.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
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
                AVG(probability) as avgProbability,
                AVG(CASE confidence
                    WHEN 'High' THEN 4 WHEN 'Medium' THEN 3
                    WHEN 'Low' THEN 2 WHEN 'Avoid' THEN 1
                END) as avgConfidence
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
            avgConfidence: row.avgConfidence
                ? Math.round(row.avgConfidence * 10) / 10
                : 0,
            avgProbability: Math.round((row.avgProbability || 0) * 10) / 10,
            winRate: row.wins + row.losses > 0
                ? Math.round(((row.wins / (row.wins + row.losses)) * 100) * 10) / 10
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
            // SQLite AVG() ignores NULLs — mirror that by averaging only
            // records that carry a probability (never treating missing as 0).
            const probabilities = records
                .map(r => r.probability)
                .filter((p): p is number => typeof p === 'number');
            const confidenceScores = records
                .map(r => r.confidence ? CONFIDENCE_LEVEL_SCORE[r.confidence] : undefined)
                .filter((s): s is number => s !== undefined);
            stats.push({
                provider,
                total: records.length,
                wins,
                losses,
                pending,
                avgConfidence: confidenceScores.length > 0
                    ? Math.round((confidenceScores.reduce((sum, s) => sum + s, 0) / confidenceScores.length) * 10) / 10
                    : 0,
                avgProbability: probabilities.length > 0
                    ? Math.round((probabilities.reduce((sum, p) => sum + p, 0) / probabilities.length) * 10) / 10
                    : 0,
                winRate: wins + losses > 0
                    ? Math.round(((wins / (wins + losses)) * 100) * 10) / 10
                    : 0,
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
 * Matches by tradeId AND/OR messageId so the outcome lands on the records
 * even if the two keys ever diverge (timestamp key vs card id).
 */
export const updateThinkingOutcome = async (
    tradeId: string,
    outcome: TradeOutcome,
    messageId?: string,
    username?: string
): Promise<void> => {
    if (isNativePlatform()) {
        const { getSqliteDb } = await import('./SqliteServiceHelpers');
        const db = await getSqliteDb();
        if (!db) return;

        const scopeSql = username ? ' AND username = ?' : '';
        const scopeParams = username ? [username] : [];
        if (messageId) {
            await db.run(
                `UPDATE thinking_records SET outcome = ? WHERE (tradeId = ? OR messageId = ?)${scopeSql}`,
                [outcome, tradeId, messageId, ...scopeParams]
            );
        } else {
            await db.run(
                `UPDATE thinking_records SET outcome = ? WHERE tradeId = ?${scopeSql}`,
                [outcome, tradeId, ...scopeParams]
            );
        }
    } else {
        const db = await initIndexedDB();
        const records = await db.getAllFromIndex(STORE_NAME, 'tradeId', tradeId);
        let byMessage: ThinkingRecord[] = [];
        if (messageId) {
            byMessage = await db.getAllFromIndex(STORE_NAME, 'messageId', messageId);
        }
        const seen = new Set<string>();
        const all = [...records, ...byMessage].filter(r => {
            if (seen.has(r.id)) return false;
            seen.add(r.id);
            return true;
        }).filter(r => !username || r.username === username);
        const tx = db.transaction(STORE_NAME, 'readwrite');
        for (const record of all) {
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
    finalOutput: row.finalOutput || undefined,
    rawReasoning: row.rawReasoning || undefined,
    messageId: row.messageId || undefined,
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
    finalOutput: row.finalOutput || undefined,
    rawReasoning: row.rawReasoning || undefined,
    messageId: row.messageId || undefined,
    analysis: safeParseAnalysis(row.analysisJson),
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
    finalOutput: r.finalOutput,
    rawReasoning: r.rawReasoning,
    messageId: r.messageId,
    analysis: safeParseAnalysis(r.analysisJson),
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
