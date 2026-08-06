import { describe, it, expect, vi, beforeEach } from 'vitest';

// Force the native (SQLite) path of ThinkingStoreService and stub the db.
vi.mock('@capacitor/core', () => ({
    Capacitor: { isNativePlatform: () => true },
}));
vi.mock('@capacitor-community/sqlite', () => ({
    CapacitorSQLite: {},
    SQLiteConnection: class {},
    SQLiteDBConnection: class {},
}));
vi.mock('../services/infrastructure/SqliteServiceHelpers', () => ({
    getSqliteDb: vi.fn(),
    setSqliteDb: vi.fn(),
}));

import { getSqliteDb } from '../services/infrastructure/SqliteServiceHelpers';
import {
    saveThinkingBatch,
    getThinkingByTrade,
    getThinkingByMessage,
    getThinkingTrades,
    updateThinkingOutcome,
    getAllThinkingForExport,
} from '../services/infrastructure/ThinkingStoreService';
import { ThinkingRecord } from '../types/thinking';
import { TradeOutcome } from '../types';

/**
 * Minimal in-memory SQLite stand-in covering exactly the statements
 * ThinkingStoreService issues against the native connection.
 */
class FakeSqliteDb {
    rows: Record<string, any>[] = [];

    async execute(sql: string): Promise<void> {
        if (/BEGIN TRANSACTION/i.test(sql) || /COMMIT/i.test(sql)) return;
    }

    async run(sql: string, params: any[] = []): Promise<void> {
        if (/INSERT OR REPLACE INTO thinking_records/i.test(sql)) {
            const cols = [
                'id', 'tradeId', 'username', 'provider', 'role', 'modelName',
                'reasoning', 'finalOutput', 'rawReasoning', 'messageId',
                'analysisJson', 'debateTurnIndex', 'debateTurnSpeaker',
                'confidence', 'probability', 'outcome', 'createdAt',
            ];
            const row: Record<string, any> = {};
            cols.forEach((c, i) => {
                const v = params[i];
                if (v !== null && v !== undefined) row[c] = v;
            });
            const existing = this.rows.findIndex(r => r.id === row.id);
            if (existing >= 0) this.rows[existing] = row;
            else this.rows.push(row);
        } else if (/DELETE FROM thinking_records/i.test(sql)) {
            const keep = Number(params[0]);
            const sorted = [...this.rows].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
            this.rows = sorted.slice(0, keep);
        } else if (/UPDATE thinking_records SET outcome/i.test(sql)) {
            const outcome = params[0];
            const tradeId = params[1];
            const messageId = params[2];
            this.rows.forEach(r => {
                if (r.tradeId === tradeId || (messageId && r.messageId === messageId)) {
                    r.outcome = outcome;
                }
            });
        }
    }

    async query(sql: string, params: any[] = []): Promise<{ values: any[] }> {
        if (/WHERE messageId = /i.test(sql)) {
            return { values: this.rows.filter(r => r.messageId === params[0]) };
        }
        if (/WHERE tradeId = /i.test(sql)) {
            return { values: this.rows.filter(r => r.tradeId === params[0]) };
        }
        if (/GROUP BY tradeId/i.test(sql)) {
            const byTrade = new Map<string, any[]>();
            for (const r of this.rows) {
                if (r.username !== params[0]) continue;
                if (!byTrade.has(r.tradeId)) byTrade.set(r.tradeId, []);
                byTrade.get(r.tradeId)!.push(r);
            }
            const values = [...byTrade.entries()].map(([tradeId, recs]) => ({
                tradeId,
                createdAt: recs.reduce((mx, r) => (r.createdAt > mx ? r.createdAt : mx), ''),
                recordCount: recs.length,
                outcome: recs.reduce((o, r) => r.outcome || o, undefined),
            }));
            return { values };
        }
        if (/SELECT \* FROM thinking_records/i.test(sql)) {
            return { values: this.rows.filter(r => r.username === params[0]) };
        }
        return { values: [] };
    }
}

const makeRecord = (overrides: Partial<ThinkingRecord>): ThinkingRecord => ({
    id: `think-${Math.random().toString(36).slice(2, 10)}`,
    tradeId: 'trade-1',
    username: 'test-user',
    provider: 'gemini',
    role: 'analyst',
    reasoning: 'Market structure shows bullish continuation on the 4h.',
    createdAt: '2026-08-06T10:00:00.000Z',
    ...overrides,
});

describe('ThinkingStoreService (SQLite path)', () => {
    let fakeDb: FakeSqliteDb;

    beforeEach(() => {
        fakeDb = new FakeSqliteDb();
        (getSqliteDb as ReturnType<typeof vi.fn>).mockResolvedValue(fakeDb);
    });

    it('round-trips finalOutput, rawReasoning and messageId through save/get', async () => {
        const records: ThinkingRecord[] = [
            makeRecord({
                id: 'think-a1',
                provider: 'gemini:gemini-2.5-pro',
                modelName: 'gemini-2.5-pro',
                reasoning: '<THINKING> bullish structure </THINKING>',
                finalOutput: 'Long BTCUSDT targeting 70k with 1:2.5 RR.',
                rawReasoning: 'streamed chain of thought deltas...',
                messageId: 'msg-42',
                confidence: 'High',
                probability: 72,
                analysisJson: JSON.stringify({ direction: 'Neutral', strategy: 'Long BTCUSDT' }),
            }),
            makeRecord({
                id: 'think-m1',
                provider: 'moderator',
                role: 'moderator',
                modelName: 'deepseek-chat',
                reasoning: 'Full debate transcript with <JSON_PLAN> markers...',
                finalOutput: 'Final verdict: Long entry 68.5k, SL 67k, TP 70.5k.',
                rawReasoning: 'moderator reasoning deltas',
                messageId: 'msg-42',
                confidence: 'High',
                probability: 74,
            }),
        ];

        await saveThinkingBatch(records);

        const byTrade = await getThinkingByTrade('trade-1');
        expect(byTrade).toHaveLength(2);
        const analyst = byTrade.find(r => r.id === 'think-a1');
        expect(analyst?.finalOutput).toBe('Long BTCUSDT targeting 70k with 1:2.5 RR.');
        expect(analyst?.rawReasoning).toBe('streamed chain of thought deltas...');
        expect(analyst?.messageId).toBe('msg-42');
        const moderator = byTrade.find(r => r.id === 'think-m1');
        expect(moderator?.finalOutput).toBe('Final verdict: Long entry 68.5k, SL 67k, TP 70.5k.');
        expect(moderator?.messageId).toBe('msg-42');
    });

    it('gets records by the card (message) id', async () => {
        await saveThinkingBatch([
            makeRecord({ id: 'think-a1', messageId: 'msg-42', role: 'analyst' }),
            makeRecord({ id: 'think-a2', messageId: 'msg-99', role: 'analyst' }),
        ]);

        const byMessage = await getThinkingByMessage('msg-42');
        expect(byMessage).toHaveLength(1);
        expect(byMessage[0].id).toBe('think-a1');
    });

    it('updates outcomes via tradeId AND messageId (card linkage)', async () => {
        await saveThinkingBatch([
            makeRecord({ id: 'think-a1', tradeId: 'trade-1', messageId: 'msg-42' }),
            // Same card, but the timestamp key diverged — must still be updated.
            makeRecord({ id: 'think-a2', tradeId: 'trade-diverged', messageId: 'msg-42' }),
            // Different card — untouched.
            makeRecord({ id: 'think-a3', tradeId: 'trade-3', messageId: 'msg-99' }),
        ]);

        await updateThinkingOutcome('trade-1', TradeOutcome.WIN, 'msg-42');

        const all = await getThinkingByTrade('trade-1');
        expect(all.find(r => r.id === 'think-a1')?.outcome).toBe(TradeOutcome.WIN);
        const diverged = await getThinkingByTrade('trade-diverged');
        expect(diverged.find(r => r.id === 'think-a2')?.outcome).toBe(TradeOutcome.WIN);
        const untouched = await getThinkingByTrade('trade-3');
        expect(untouched.find(r => r.id === 'think-a3')?.outcome).toBeUndefined();
    });

    it('groups distinct trades with record counts and latest createdAt', async () => {
        await saveThinkingBatch([
            makeRecord({ id: 't1-a', tradeId: 'trade-1', createdAt: '2026-08-06T10:00:00.000Z', outcome: undefined }),
            makeRecord({ id: 't1-m', tradeId: 'trade-1', role: 'moderator', createdAt: '2026-08-06T10:00:01.000Z', outcome: undefined }),
            makeRecord({ id: 't2-a', tradeId: 'trade-2', createdAt: '2026-08-06T11:00:00.000Z' }),
            makeRecord({ id: 'other-a', tradeId: 'trade-1', username: 'other-user' }),
        ]);

        const trades = await getThinkingTrades('test-user');
        expect(trades).toHaveLength(2);
        const trade1 = trades.find(t => t.tradeId === 'trade-1');
        expect(trade1?.recordCount).toBe(2);
        expect(trade1?.createdAt).toBe('2026-08-06T10:00:01.000Z');
        // Newest first
        expect(trades[0].tradeId).toBe('trade-2');
    });

    it('includes finalOutput, rawReasoning and messageId in export rows', async () => {
        await saveThinkingBatch([
            makeRecord({
                id: 'think-a1',
                messageId: 'msg-42',
                finalOutput: 'Long BTCUSDT',
                rawReasoning: 'cot deltas',
                analysisJson: JSON.stringify({ direction: 'Long' }),
            }),
        ]);

        const rows = await getAllThinkingForExport('test-user');
        expect(rows).toHaveLength(1);
        expect(rows[0].finalOutput).toBe('Long BTCUSDT');
        expect(rows[0].rawReasoning).toBe('cot deltas');
        expect(rows[0].messageId).toBe('msg-42');
        expect(rows[0].analysis).toEqual({ direction: 'Long' });
    });
});
