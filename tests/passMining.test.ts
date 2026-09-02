import { describe, it, expect, vi, beforeEach } from 'vitest';

// §8.2c — pass mining: SKIPPED trades were invisible to the learning loop
// (skill creation required a closed-trade cluster). This service resolves a
// pass post-hoc against post-skip klines: SL first = CORRECT_PASS (clusters
// of ≥3 draft an avoid-skill through the approval inbox); TP first =
// MISSED_OPPORTUNITY (a journal counter-metric ONLY — never a skill).

let store: Record<string, unknown> = {};
vi.mock('../services/infrastructure/PreferencesService', () => ({
    getPreferenceObject: vi.fn(async (key: string) => store[key] ?? null),
    setPreferenceObject: vi.fn(async (key: string, value: unknown) => {
        store[key] = value;
    }),
    removePreference: vi.fn(async (key: string) => {
        delete store[key];
    }),
}));

import {
    resolvePassOutcome,
    passClusterKey,
    correctPassClusters,
    missedOpportunityCount,
    correctPassCount,
    runPassMiningSweep,
    loadPassRecords,
    MIN_CLUSTER_FOR_CORRECT_PASSES,
    PASS_MINING_MAX_FETCHES_PER_SWEEP,
    type PassRecord,
} from '../services/learning/passMining';
import { listSkillDrafts } from '../utils/skillDrafts';
import type { LoggedTrade } from '../types';
import { TradeOutcome } from '../types/enums';
import type { Kline } from '../types/message';

const T0 = Date.UTC(2026, 7, 1, 0, 0, 0);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// The sweep filters candidates to a 30-day lookback from NOW, so sweep-test
// trades must be recent (the pure resolvePassOutcome tests keep fixed T0).
const SKIP_TS = Date.now() - 2 * DAY;

/** Candles at hourly offsets from T0. */
const kl = (offsetH: number, low: number, high: number): Kline => ({
    time: T0 + offsetH * HOUR,
    open: (low + high) / 2,
    high,
    low,
    close: (low + high) / 2,
    volume: 1,
});

/** Candles at hourly offsets from SKIP_TS (for the sweep tests). */
const klAt = (offsetH: number, low: number, high: number): Kline => ({
    time: SKIP_TS + offsetH * HOUR,
    open: (low + high) / 2,
    high,
    low,
    close: (low + high) / 2,
    volume: 1,
});

const skipTrade = (id: string, over: Partial<LoggedTrade> = {}): LoggedTrade => ({
    id,
    timestamp: new Date(SKIP_TS).toISOString(),
    outcome: TradeOutcome.SKIPPED,
    skipReason: 'no fresh confirmation',
    analysis: {
        coinName: 'BTC',
        direction: 'Long',
        entryPoints: [{ price: '100' }],
        stopLoss: '90',
        takeProfit: [{ price: '120' }],
        detectedPatternFamily: 'breakout',
    },
    ...over,
} as LoggedTrade);

beforeEach(() => {
    store = {};
    localStorage.clear();
    vi.restoreAllMocks();
});

describe('resolvePassOutcome (synthetic klines)', () => {
    it('SL touched first → CORRECT_PASS (the discipline was vindicated)', () => {
        // Long 100 / SL 90 / TP 120: price dips to the stop, never reaches TP.
        const klines = [kl(0, 99, 101), kl(1, 89, 99), kl(2, 95, 100)];
        expect(resolvePassOutcome(klines, T0, 100, 90, 120, true)).toBe('CORRECT_PASS');
    });

    it('TP reached first → MISSED_OPPORTUNITY', () => {
        const klines = [kl(0, 99, 101), kl(1, 100, 121), kl(2, 110, 125)];
        expect(resolvePassOutcome(klines, T0, 100, 90, 120, true)).toBe('MISSED_OPPORTUNITY');
    });

    it('entry never filled → OPEN (the would-be limit never traded)', () => {
        // Long entry at 100 fills on a DIP to 100; a rally never touches it.
        const klines = [kl(0, 105, 110), kl(1, 108, 115)];
        expect(resolvePassOutcome(klines, T0, 100, 90, 120, true)).toBe('OPEN');
    });

    it('short side mirrors: SL above entry → CORRECT_PASS', () => {
        const klines = [kl(0, 99, 101), kl(1, 100, 111), kl(2, 105, 109)];
        expect(resolvePassOutcome(klines, T0, 100, 110, 80, false)).toBe('CORRECT_PASS');
    });

    it('candles before the skip are ignored', () => {
        // The pre-skip candle hits TP; the post-skip path hits SL. The
        // resolution must follow the AFTER-skip candles only.
        const klines = [kl(-2, 100, 130), kl(0, 99, 101), kl(1, 89, 99)];
        expect(resolvePassOutcome(klines, T0, 100, 90, 120, true)).toBe('CORRECT_PASS');
    });

    it('no candles after the skip → OPEN; degenerate levels → NO_PLAN', () => {
        expect(resolvePassOutcome([kl(-1, 80, 130)], T0, 100, 90, 120, true)).toBe('OPEN');
        expect(resolvePassOutcome([kl(0, 99, 101)], T0, 0, 90, 120, true)).toBe('NO_PLAN');
    });
});

describe('passClusterKey + correctPassClusters', () => {
    const rec = (over: Partial<PassRecord>): PassRecord => ({
        tradeId: over.tradeId ?? 'x',
        coin: 'BTC',
        direction: 'Long',
        family: 'breakout',
        resolution: 'CORRECT_PASS',
        ...over,
    } as PassRecord);

    it('normalizes the coin (USDT suffix off, case) and groups by {coin|dir|family}', () => {
        expect(passClusterKey({ coin: 'btcusdt', direction: 'Long', family: 'break' }))
            .toBe('BTC|Long|break');
        const clusters = correctPassClusters([
            rec({ tradeId: '1' }), rec({ tradeId: '2' }), rec({ tradeId: '3' }),
            rec({ tradeId: '4', direction: 'Short' }),
        ], 3);
        expect(clusters).toHaveLength(1);
        expect(clusters[0].records).toHaveLength(3);
    });

    it('MISSED_OPPORTUNITY records never cluster (no skill from a miss)', () => {
        const misses = [1, 2, 3].map(i => rec({ tradeId: `m${i}`, resolution: 'MISSED_OPPORTUNITY' }));
        expect(correctPassClusters(misses, 3)).toHaveLength(0);
        expect(missedOpportunityCount(misses)).toBe(3);
        expect(correctPassCount(misses)).toBe(0);
    });

    it('a cluster below the minimum is not draft-eligible', () => {
        expect(correctPassClusters([rec({ tradeId: '1' }), rec({ tradeId: '2' })], MIN_CLUSTER_FOR_CORRECT_PASSES))
            .toHaveLength(0);
    });
});

describe('runPassMiningSweep', () => {
    it('resolves skips, persists records, and drafts ONE avoid-skill per cluster', async () => {
        const trades = [1, 2, 3].map(i => skipTrade(`t${i}`));
        // SL-first path for every fetch.
        const fetchKlines = vi.fn(async () => [klAt(0, 99, 101), klAt(1, 89, 99)]);
        const res = await runPassMiningSweep(trades, 'pm', fetchKlines);
        expect(res.resolved).toBe(3);
        expect(res.correctPasses).toBe(3);
        expect(res.draftedClusters).toEqual(['BTC|Long|breakout']);
        const drafts = listSkillDrafts('pm');
        expect(drafts).toHaveLength(1);
        expect(drafts[0].crafted.kind).toBe('avoid');
        expect(drafts[0].crafted.name).toMatch(/Avoid BTC Long breakout/);
        // Re-running the sweep must not re-draft (drafted flags persist).
        const res2 = await runPassMiningSweep(trades, 'pm', fetchKlines);
        expect(res2.draftedClusters).toHaveLength(0);
        expect(listSkillDrafts('pm')).toHaveLength(1);
    });

    it('REGRESSION: resolving a first-time skip must not drop the newest stored record', async () => {
        // Seed one already-resolved record, then resolve a NEW skip. The
        // splice(findIndex(...) === -1) bug deleted the LAST record —
        // silently discarding the seeded one.
        await runPassMiningSweep([skipTrade('seed')], 'pm', async () => [klAt(0, 99, 101), klAt(1, 89, 99)]);
        const before = await loadPassRecords('pm');
        expect(before).toHaveLength(1);
        await runPassMiningSweep([skipTrade('seed'), skipTrade('fresh')], 'pm', async () => [klAt(0, 99, 101), klAt(1, 89, 99)]);
        const after = await loadPassRecords('pm');
        expect(after.map(r => r.tradeId).sort()).toEqual(['fresh', 'seed']);
    });

    it('drafts nothing when the cluster is missed opportunities', async () => {
        const trades = [1, 2, 3].map(i => skipTrade(`t${i}`));
        const res = await runPassMiningSweep(trades, 'pm', async () => [klAt(0, 99, 101), klAt(1, 100, 121)]);
        expect(res.missed).toBe(3);
        expect(res.correctPasses).toBe(0);
        expect(res.draftedClusters).toHaveLength(0);
        expect(listSkillDrafts('pm')).toHaveLength(0);
    });

    it('caps kline fetches per sweep and skips trades with no plan/reason', async () => {
        const trades = Array.from({ length: PASS_MINING_MAX_FETCHES_PER_SWEEP + 3 }, (_, i) => skipTrade(`t${i}`));
        const fetchKlines = vi.fn(async () => [klAt(0, 99, 101), klAt(1, 89, 99)]);
        await runPassMiningSweep(trades, 'pm', fetchKlines);
        expect(fetchKlines).toHaveBeenCalledTimes(PASS_MINING_MAX_FETCHES_PER_SWEEP);
        // No skip reason → never a candidate.
        const noReason = [skipTrade('nr', { skipReason: '  ' })];
        const f2 = vi.fn(async () => [klAt(0, 99, 101)]);
        await runPassMiningSweep(noReason, 'pm2', f2);
        expect(f2).not.toHaveBeenCalled();
    });

    it('a fetch failure leaves the skip unresolved for a later sweep', async () => {
        const trades = [skipTrade('t1')];
        const res = await runPassMiningSweep(trades, 'pm', async () => { throw new Error('network'); });
        expect(res.resolved).toBe(0);
        expect(await loadPassRecords('pm')).toHaveLength(0);
    });
});
