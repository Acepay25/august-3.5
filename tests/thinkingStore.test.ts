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
    runExclusiveWrite: (fn: () => Promise<any>) => fn(),
}));

import { getSqliteDb } from '../services/infrastructure/SqliteServiceHelpers';
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
                'confidence', 'probability', 'outcome', 'pnlAmount', 'pnlPercent', 'analystLens', 'createdAt',
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
            // The real query conditionally appends the PnL COALESCE pair, so
            // the param layout shifts when PnL is provided.
            const hasPnl = /pnlAmount = COALESCE/i.test(sql);
            const pnlAmount = hasPnl ? params[1] : undefined;
            const pnlPercent = hasPnl ? params[2] : undefined;
            const tradeId = params[hasPnl ? 3 : 1];
            const messageId = params[hasPnl ? 4 : 2];
            this.rows.forEach(r => {
                if (r.tradeId === tradeId || (messageId && r.messageId === messageId)) {
                    r.outcome = outcome;
                    // COALESCE semantics: null never overwrites an earlier value.
                    if (pnlAmount !== null && pnlAmount !== undefined) r.pnlAmount = pnlAmount;
                    if (pnlPercent !== null && pnlPercent !== undefined) r.pnlPercent = pnlPercent;
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
            const values = [...byTrade.entries()].map(([tradeId, recs]) => {
                // Mirrors the COALESCE(CASE…) priority in the real query:
                // resolved WIN/LOSS first, then ENTRY_NOT_HIT/SKIPPED, then
                // any remaining non-null outcome.
                const resolved = recs.find(r => r.outcome === 'WIN' || r.outcome === 'LOSS');
                const secondary = resolved
                    ? undefined
                    : recs.find(r => r.outcome === 'ENTRY_NOT_HIT' || r.outcome === 'SKIPPED');
                return {
                    tradeId,
                    createdAt: recs.reduce((mx, r) => (r.createdAt > mx ? r.createdAt : mx), ''),
                    recordCount: recs.length,
                    outcome: resolved?.outcome ?? secondary?.outcome ?? recs.reduce((o, r) => r.outcome || o, undefined),
                };
            });
            // Matches the real query's ORDER BY createdAt DESC (the old
            // always-run prune DELETE happened to sort rows as a side effect,
            // which masked this missing ordering).
            values.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
            return { values };
        }
        if (/GROUP BY provider/i.test(sql)) {
            const analysts = this.rows.filter(r => r.username === params[0] && r.role === 'analyst');
            const byProvider = new Map<string, any[]>();
            for (const r of analysts) {
                if (!byProvider.has(r.provider)) byProvider.set(r.provider, []);
                byProvider.get(r.provider)!.push(r);
            }
            const CONFIDENCE_SCORE: Record<string, number> = { High: 4, Medium: 3, Low: 2, Avoid: 1 };
            const values = [...byProvider.entries()].map(([provider, recs]) => {
                const wins = recs.filter(r => r.outcome === 'WIN').length;
                const losses = recs.filter(r => r.outcome === 'LOSS').length;
                const pending = recs.filter(r => !r.outcome || r.outcome === 'PENDING').length;
                const probs = recs.map(r => r.probability).filter((p): p is number => typeof p === 'number');
                const scores = recs
                    .map(r => (r.confidence ? CONFIDENCE_SCORE[r.confidence] : undefined))
                    .filter((s): s is number => s !== undefined);
                return {
                    provider,
                    total: recs.length,
                    wins,
                    losses,
                    pending,
                    avgProbability: probs.length > 0 ? probs.reduce((s, p) => s + p, 0) / probs.length : null,
                    avgConfidence: scores.length > 0 ? scores.reduce((s, v) => s + v, 0) / scores.length : null,
                    avgPnLPercent: (() => {
                        const pnls = recs.map(r => r.pnlPercent).filter((p): p is number => typeof p === 'number');
                        return pnls.length > 0 ? pnls.reduce((s, v) => s + v, 0) / pnls.length : null;
                    })(),
                };
            });
            // Matches ORDER BY total DESC in the real query.
            values.sort((a, b) => b.total - a.total);
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
                analystLens: 'macro',
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
        expect(analyst?.analystLens).toBe('macro');
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

    it('export survives a corrupted analysis JSON blob', async () => {
        await saveThinkingBatch([
            makeRecord({ id: 'think-bad', analysisJson: '{not-valid-json' }),
            makeRecord({ id: 'think-ok', analysisJson: JSON.stringify({ direction: 'Long' }) }),
        ]);

        const rows = await getAllThinkingForExport('test-user');
        // Corrupt blob falls back to the raw string instead of aborting the export.
        const bad = rows.find(r => r.analysis === '{not-valid-json');
        expect(bad).toBeDefined();
        const ok = rows.find(r => r.analysis && typeof r.analysis === 'object');
        expect(ok?.analysis).toEqual({ direction: 'Long' });
    });

    it('computes per-provider stats with resolved-only winRate and confidence average', async () => {
        await saveThinkingBatch([
            makeRecord({ id: 'a1', provider: 'gemini', outcome: TradeOutcome.WIN, confidence: 'High', probability: 80 }),
            makeRecord({ id: 'a2', provider: 'gemini', outcome: TradeOutcome.WIN, confidence: 'Medium', probability: 60 }),
            makeRecord({ id: 'a3', provider: 'gemini', outcome: TradeOutcome.LOSS, confidence: 'High', probability: 90 }),
            makeRecord({ id: 'a4', provider: 'gemini', outcome: TradeOutcome.PENDING, confidence: undefined, probability: undefined }),
            makeRecord({ id: 'a5', provider: 'gemini', outcome: undefined, confidence: 'Avoid', probability: 30 }),
            // Non-analyst records are excluded from the per-provider stats.
            makeRecord({ id: 'm1', provider: 'gemini', role: 'moderator', outcome: TradeOutcome.WIN }),
            makeRecord({ id: 'b1', provider: 'deepseek', outcome: TradeOutcome.LOSS }),
        ]);

        const stats = await getProviderReasoningStats('test-user');
        expect(stats).toHaveLength(2);
        const gemini = stats.find(s => s.provider === 'gemini');
        expect(gemini?.total).toBe(5);
        expect(gemini?.wins).toBe(2);
        expect(gemini?.losses).toBe(1);
        expect(gemini?.pending).toBe(2); // PENDING + null outcome
        // Win rate counts resolved outcomes only — pending records don't dilute it.
        expect(gemini?.winRate).toBe(66.7);
        // (4 + 3 + 4 + 1) / 4 over records that carry a confidence level.
        expect(gemini?.avgConfidence).toBe(3);
        // (80 + 60 + 90 + 30) / 4 — NULL probabilities excluded, like SQLite AVG.
        expect(gemini?.avgProbability).toBe(65);
        // No resolved outcomes → win rate 0, not 100.
        const deepseek = stats.find(s => s.provider === 'deepseek');
        expect(deepseek?.winRate).toBe(0);
        // ORDER BY total DESC
        expect(stats[0].provider).toBe('gemini');
    });

    it('prefers resolved outcomes over pending when grouping trades', async () => {
        await saveThinkingBatch([
            makeRecord({ id: 't1-a', tradeId: 'trade-1', outcome: TradeOutcome.WIN }),
            makeRecord({ id: 't1-b', tradeId: 'trade-1', outcome: TradeOutcome.PENDING }),
            makeRecord({ id: 't2-a', tradeId: 'trade-2', outcome: TradeOutcome.PENDING }),
            makeRecord({ id: 't2-b', tradeId: 'trade-2', outcome: TradeOutcome.LOSS }),
            makeRecord({ id: 't3-a', tradeId: 'trade-3', outcome: TradeOutcome.PENDING }),
            makeRecord({ id: 't3-b', tradeId: 'trade-3', outcome: TradeOutcome.SKIPPED }),
        ]);

        const trades = await getThinkingTrades('test-user');
        expect(trades.find(t => t.tradeId === 'trade-1')?.outcome).toBe(TradeOutcome.WIN);
        expect(trades.find(t => t.tradeId === 'trade-2')?.outcome).toBe(TradeOutcome.LOSS);
        expect(trades.find(t => t.tradeId === 'trade-3')?.outcome).toBe(TradeOutcome.SKIPPED);
    });
});

describe('ThinkingStoreService — PnL on thinking records', () => {
  let fakeDb: FakeSqliteDb;

  beforeEach(() => {
    fakeDb = new FakeSqliteDb();
    (getSqliteDb as ReturnType<typeof vi.fn>).mockResolvedValue(fakeDb);
  });

  it('round-trips pnlAmount/pnlPercent through save/get', async () => {
    await saveThinkingBatch([
      makeRecord({
        id: 'pnl-a1',
        tradeId: 'trade-pnl',
        reasoning: 'strong continuation thesis',
        pnlAmount: 1240.5,
        pnlPercent: 42,
      }),
    ]);
    const all = await getThinkingByTrade('trade-pnl');
    expect(all.find(r => r.id === 'pnl-a1')).toMatchObject({ pnlAmount: 1240.5, pnlPercent: 42 });
  });

  it('backfills PnL alongside the outcome', async () => {
    await saveThinkingBatch([
      makeRecord({ id: 'pnl-b1', tradeId: 'trade-pnl', messageId: 'msg-42' }),
    ]);
    await updateThinkingOutcome('trade-pnl', TradeOutcome.WIN, 'msg-42', 'test-user', { pnlAmount: 800, pnlPercent: 25 });
    const all = await getThinkingByTrade('trade-pnl');
    expect(all.find(r => r.id === 'pnl-b1')).toMatchObject({ outcome: TradeOutcome.WIN, pnlAmount: 800, pnlPercent: 25 });
  });

  it('preserves existing PnL when a later update omits it (COALESCE semantics)', async () => {
    await saveThinkingBatch([
      makeRecord({ id: 'pnl-c1', tradeId: 'trade-pnl', messageId: 'msg-42' }),
    ]);
    await updateThinkingOutcome('trade-pnl', TradeOutcome.WIN, 'msg-42', 'test-user', { pnlAmount: 800, pnlPercent: 25 });
    // Outcome-only correction (e.g. fixing a mis-logged WIN/LOSS) must not
    // wipe the PnL that was already backfilled.
    await updateThinkingOutcome('trade-pnl', TradeOutcome.LOSS, 'msg-42', 'test-user');
    const all = await getThinkingByTrade('trade-pnl');
    expect(all.find(r => r.id === 'pnl-c1')).toMatchObject({ outcome: TradeOutcome.LOSS, pnlAmount: 800, pnlPercent: 25 });
  });

  it('includes PnL in the training export rows', async () => {
    await saveThinkingBatch([
      makeRecord({
        id: 'pnl-d1',
        tradeId: 'trade-pnl',
        reasoning: 'thesis text',
        pnlAmount: -300,
        pnlPercent: -12.5,
      }),
    ]);
    const rows = await getAllThinkingForExport('test-user');
    const mine = rows.find(r => r.tradeId === 'trade-pnl');
    expect(mine).toMatchObject({ pnlAmount: -300, pnlPercent: -12.5 });
  });

  it('computes avgPnLPercent in provider stats (expectancy proxy)', async () => {
    await saveThinkingBatch([
      makeRecord({ id: 's1', tradeId: 't1', provider: 'gemini', pnlPercent: 40 }),
      makeRecord({ id: 's2', tradeId: 't2', provider: 'gemini', pnlPercent: -10 }),
      // No PnL yet — must not drag the average down (SQLite AVG ignores NULLs).
      makeRecord({ id: 's3', tradeId: 't3', provider: 'gemini' }),
    ]);
    const stats = await getProviderReasoningStats('test-user');
    const gemini = stats.find(s => s.provider === 'gemini');
    expect(gemini?.avgPnLPercent).toBe(15);
  });
});
