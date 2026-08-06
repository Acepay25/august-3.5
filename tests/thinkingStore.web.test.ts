import { describe, it, expect, vi, beforeEach } from 'vitest';

// Force the web (IndexedDB) path of ThinkingStoreService and stub the
// 'idb' library with an in-memory stand-in — jsdom has no IndexedDB and
// fake-indexeddb is not a dependency.
vi.mock('@capacitor/core', () => ({
    Capacitor: { isNativePlatform: () => false },
}));
vi.mock('@capacitor-community/sqlite', () => ({
    CapacitorSQLite: {},
    SQLiteConnection: class {},
    SQLiteDBConnection: class {},
}));
vi.mock('idb', () => ({
    openDB: vi.fn(),
}));

/**
 * Minimal in-memory IndexedDB stand-in covering exactly the calls
 * ThinkingStoreService makes on the web path: the openDB upgrade callback
 * (createObjectStore / objectStoreNames), direct put/getAllFromIndex, and
 * readwrite transactions (store.put / store.getAll / store.delete / done).
 */
class FakeIndexedDB {
    stores: Record<string, Map<string, any>> = {};

    // ── openDB upgrade surface ────────────────────────────────────────────
    get objectStoreNames() {
        return { contains: (name: string) => name in this.stores };
    }
    createObjectStore(name: string): { createIndex: () => void } {
        this.stores[name] = new Map();
        return { createIndex: () => undefined };
    }

    // ── read/write surface (db-level) ─────────────────────────────────────
    async put(store: string, record: any): Promise<void> {
        (this.stores[store] ||= new Map()).set(record.id, record);
    }
    async getAllFromIndex(store: string, indexName: string, key: unknown): Promise<any[]> {
        const all = this.stores[store] ? [...this.stores[store].values()] : [];
        return all.filter(r => r[indexName] === key);
    }
    async getAll(store: string): Promise<any[]> {
        return this.stores[store] ? [...this.stores[store].values()] : [];
    }
    async delete(store: string, id: string): Promise<void> {
        this.stores[store]?.delete(id);
    }

    // ── transaction surface ───────────────────────────────────────────────
    transaction(store: string, _mode: string) {
        return {
            store: {
                put: (record: any) => this.put(store, record),
                getAll: () => this.getAll(store),
                delete: (id: string) => this.delete(store, id),
            },
            done: Promise.resolve(),
        };
    }

    clear() {
        this.stores = {};
    }
}

import { openDB } from 'idb';
import {
    saveThinkingBatch,
    getThinkingByTrade,
    getThinkingByMessage,
    getThinkingTrades,
    updateThinkingOutcome,
    getAllThinkingForExport,
    getProviderReasoningStats,
} from '../services/infrastructure/ThinkingStoreService';
import { ThinkingRecord } from '../types/thinking';
import { TradeOutcome } from '../types';

// The service caches its IndexedDB connection at module level, so one shared
// fake with a per-test clear() keeps state isolated between tests.
const fakeDb = new FakeIndexedDB();
(openDB as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    async (_name: string, _version?: number, options?: { upgrade?: (db: any) => void }) => {
        options?.upgrade?.(fakeDb);
        return fakeDb;
    }
);

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

describe('ThinkingStoreService (IndexedDB path)', () => {
    beforeEach(() => {
        fakeDb.clear();
    });

    it('round-trips records with finalOutput, rawReasoning and messageId', async () => {
        await saveThinkingBatch([
            makeRecord({
                id: 'think-a1',
                provider: 'gemini:gemini-2.5-pro',
                modelName: 'gemini-2.5-pro',
                finalOutput: 'Long BTCUSDT targeting 70k with 1:2.5 RR.',
                rawReasoning: 'streamed chain of thought deltas...',
                messageId: 'msg-42',
                confidence: 'High',
                probability: 72,
                analysisJson: JSON.stringify({ direction: 'Neutral', strategy: 'Long BTCUSDT' }),
            }),
            makeRecord({ id: 'think-m1', role: 'moderator', messageId: 'msg-42' }),
        ]);

        const byTrade = await getThinkingByTrade('trade-1');
        expect(byTrade).toHaveLength(2);
        expect(byTrade.find(r => r.id === 'think-a1')?.rawReasoning).toBe('streamed chain of thought deltas...');
        expect(byTrade.find(r => r.id === 'think-m1')?.messageId).toBe('msg-42');

        const byMessage = await getThinkingByMessage('msg-42');
        expect(byMessage).toHaveLength(2);
    });

    it('orders records like SQLite: records without a turn index first, then turns by index', async () => {
        await saveThinkingBatch([
            makeRecord({ id: 'turn-1', role: 'debate_turn', debateTurnIndex: 1, createdAt: '2026-08-06T10:00:02.000Z' }),
            makeRecord({ id: 'analyst', createdAt: '2026-08-06T10:00:00.000Z' }),
            makeRecord({ id: 'turn-0', role: 'debate_turn', debateTurnIndex: 0, createdAt: '2026-08-06T10:00:01.000Z' }),
        ]);

        const records = await getThinkingByTrade('trade-1');
        expect(records.map(r => r.id)).toEqual(['analyst', 'turn-0', 'turn-1']);
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

    it('computes per-provider stats with the same semantics as the SQLite path', async () => {
        await saveThinkingBatch([
            makeRecord({ id: 'a1', provider: 'gemini', outcome: TradeOutcome.WIN, confidence: 'High', probability: 80 }),
            makeRecord({ id: 'a2', provider: 'gemini', outcome: TradeOutcome.WIN, confidence: 'Medium', probability: 60 }),
            makeRecord({ id: 'a3', provider: 'gemini', outcome: TradeOutcome.LOSS, confidence: 'High', probability: 90 }),
            makeRecord({ id: 'a4', provider: 'gemini', outcome: TradeOutcome.PENDING, confidence: undefined, probability: undefined }),
            makeRecord({ id: 'a5', provider: 'gemini', outcome: undefined, confidence: 'Avoid', probability: 30 }),
            makeRecord({ id: 'm1', provider: 'gemini', role: 'moderator', outcome: TradeOutcome.WIN }),
            makeRecord({ id: 'b1', provider: 'deepseek', outcome: TradeOutcome.LOSS }),
        ]);

        const stats = await getProviderReasoningStats('test-user');
        expect(stats).toHaveLength(2);
        const gemini = stats.find(s => s.provider === 'gemini');
        expect(gemini?.total).toBe(5);
        expect(gemini?.wins).toBe(2);
        expect(gemini?.losses).toBe(1);
        expect(gemini?.pending).toBe(2);
        // Win rate over resolved outcomes only — identical to the SQLite path.
        expect(gemini?.winRate).toBe(66.7);
        expect(gemini?.avgConfidence).toBe(3);
        expect(gemini?.avgProbability).toBe(65);
        expect(stats.find(s => s.provider === 'deepseek')?.winRate).toBe(0);
        // Sorted by total desc, like ORDER BY total DESC.
        expect(stats[0].provider).toBe('gemini');
    });

    it('prefers resolved outcomes over pending when grouping trades', async () => {
        await saveThinkingBatch([
            makeRecord({ id: 't1-a', tradeId: 'trade-1', outcome: TradeOutcome.WIN }),
            makeRecord({ id: 't1-b', tradeId: 'trade-1', outcome: TradeOutcome.PENDING }),
            makeRecord({ id: 't2-a', tradeId: 'trade-2', outcome: TradeOutcome.PENDING }),
            makeRecord({ id: 't2-b', tradeId: 'trade-2', outcome: TradeOutcome.LOSS }),
            makeRecord({ id: 't3-a', tradeId: 'trade-3', outcome: TradeOutcome.PENDING }),
            makeRecord({ id: 't3-b', tradeId: 'trade-3', outcome: TradeOutcome.ENTRY_NOT_HIT }),
        ]);

        const trades = await getThinkingTrades('test-user');
        expect(trades.find(t => t.tradeId === 'trade-1')?.outcome).toBe(TradeOutcome.WIN);
        expect(trades.find(t => t.tradeId === 'trade-2')?.outcome).toBe(TradeOutcome.LOSS);
        expect(trades.find(t => t.tradeId === 'trade-3')?.outcome).toBe(TradeOutcome.ENTRY_NOT_HIT);
    });

    it('export survives a corrupted analysis JSON blob', async () => {
        await saveThinkingBatch([
            makeRecord({ id: 'think-bad', analysisJson: '{not-valid-json' }),
            makeRecord({ id: 'think-ok', analysisJson: JSON.stringify({ direction: 'Long' }) }),
        ]);

        const rows = await getAllThinkingForExport('test-user');
        const bad = rows.find(r => r.analysis === '{not-valid-json');
        expect(bad).toBeDefined();
        const ok = rows.find(r => r.analysis && typeof r.analysis === 'object');
        expect(ok?.analysis).toEqual({ direction: 'Long' });
    });
});
