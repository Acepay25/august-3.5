import { describe, it, expect, vi, beforeEach } from 'vitest';

// One in-memory Preferences store for BOTH the regime ledger and the matrix —
// they are separate keys of the same store, and the rebuild reads one to fill
// the other, which is the whole behaviour under test.
let store: Record<string, unknown> = {};
vi.mock('../services/infrastructure/PreferencesService', () => ({
    getPreferenceObject: vi.fn(async (key: string) => store[key] ?? null),
    getPreference: vi.fn(async (key: string) => store[key] ?? null),
    getPreferenceArray: vi.fn(async () => []),
    setPreferenceObject: vi.fn(async (key: string, value: unknown) => { store[key] = value; }),
    setPreference: vi.fn(async (key: string, value: unknown) => { store[key] = value; }),
    removePreference: vi.fn(async (key: string) => { delete store[key]; }),
}));

import {
    hydrateRegimeLedger,
    recordRegimeDay,
    regimeOnDay,
    resolveTradeRegime,
    marketRegimeToLedger,
} from '../services/learning/regimeLedger';
import {
    hydrateStrategyRegimeMatrix,
    rebuildMatrixFromJournal,
    recordSettledTradeForMatrix,
    familyRegimeEdge,
    familyEdgeFactor,
    MATRIX_MIN_SAMPLES,
    MATRIX_FAVOR_FACTOR,
} from '../services/learning/strategyRegimeMatrix';
import { phtDayKey } from '../utils/timezone';
import { LoggedTrade, TradeOutcome } from '../types';

const USER = 'regime-backfill-user';

/** A fixed instant and its ledger day key — the trade and the ledger row must
 *  land on the same bucket, and the bucket is the trader's local day. */
const DAY_MS = Date.parse('2026-09-15T06:30:00Z');
const DAY = phtDayKey(DAY_MS);
const shift = (days: number) => Date.parse(`${DAY}T00:00:00Z`) + days * 86400000;

const closed = (over: Partial<LoggedTrade> & { id: string }): LoggedTrade => ({
    outcome: TradeOutcome.WIN,
    timestamp: new Date(DAY_MS).toISOString(),
    outcomeResolvedAt: new Date(DAY_MS).toISOString(),
    analysis: {
        coinName: 'BTCUSDT',
        direction: 'Long',
        strategy: 'buy the breakout',
        strategyFamily: 'trend_following',
    } as never,
    ...over,
});

beforeEach(async () => {
    store = {};
    await hydrateRegimeLedger(USER);
    await hydrateStrategyRegimeMatrix(USER);
});

describe('the regime a closed trade was settled in', () => {
    it('prefers the regime already on the row', () => {
        const r = resolveTradeRegime(closed({ id: 'a', marketRegime: 'volatile' }));
        expect(r).toEqual({ regime: 'volatile', source: 'snapshot' });
    });

    it('reads the snapshot still on the analysis when the derived field is missing', () => {
        // Older writers stored marketSnapshot without the derived key. The
        // regime WAS observed; treating the row as unknown would throw away
        // real evidence.
        const trade = closed({
            id: 'b',
            analysis: {
                coinName: 'BTCUSDT',
                strategyFamily: 'trend_following',
                marketSnapshot: { regime: { regime: 'strong_trend_up' } },
            } as never,
        });
        expect(resolveTradeRegime(trade)).toEqual({ regime: 'trending', source: 'snapshot' });
    });

    it('falls back to the ledger when nothing was captured at log time', async () => {
        await recordRegimeDay({ date: DAY, coin: 'BTC', regime: 'compression' }, USER);
        const r = resolveTradeRegime(closed({ id: 'c' }));
        expect(r).toEqual({ regime: 'compression', source: 'ledger', ledgerAgeDays: 0 });
    });

    it('accepts a nearby ledger day and refuses a far one', async () => {
        await recordRegimeDay({ date: phtDayKey(shift(-3)), coin: 'BTC', regime: 'ranging' }, USER);
        expect(resolveTradeRegime(closed({ id: 'near' })).regime).toBe('ranging');

        store = {};
        await hydrateRegimeLedger(USER);
        await recordRegimeDay({ date: phtDayKey(shift(-9)), coin: 'BTC', regime: 'ranging' }, USER);
        // A nine-day-old label is not this trade's market. Null, not a guess.
        expect(resolveTradeRegime(closed({ id: 'far' }))).toEqual({ regime: null, source: null });
    });

    it('never uses an observation from after the trade', async () => {
        await recordRegimeDay({ date: phtDayKey(shift(2)), coin: 'BTC', regime: 'trending' }, USER);
        expect(regimeOnDay('BTCUSDT', DAY)).toBeNull();
    });

    it('takes the analysis text only when the ledger is silent', async () => {
        const trade = closed({
            id: 'd',
            analysis: {
                coinName: 'BTCUSDT',
                strategyFamily: 'trend_following',
                marketConditions: { pattern: 'tight consolidation before the break' },
            } as never,
        });
        expect(resolveTradeRegime(trade).source).toBe('analysis');
        await recordRegimeDay({ date: DAY, coin: 'BTC', regime: 'volatile' }, USER);
        expect(resolveTradeRegime(trade)).toEqual({ regime: 'volatile', source: 'ledger', ledgerAgeDays: 0 });
    });

    it('leaves an unobserved regime a gap — never a default', () => {
        const r = resolveTradeRegime(closed({
            id: 'e',
            analysis: { coinName: 'BTCUSDT', strategyFamily: 'trend_following', marketConditions: { pattern: 'no idea' } } as never,
        }));
        expect(r.regime).toBeNull();
        // The bug this guards: mapRegimeToKey answered 'ranging' for anything
        // it could not read, so an unobserved market became a ranging trade.
        expect(marketRegimeToLedger('no idea')).toBeNull();
    });

    it('reads the range vocabulary the other mapper already accepted', () => {
        expect(marketRegimeToLedger('consolidating')).toBe('ranging');
        expect(marketRegimeToLedger('vol_chop')).toBe('volatile');
        expect(marketRegimeToLedger('squeeze')).toBe('compression');
    });
});

describe('rebuilding the family × regime matrix from the journal', () => {
    it('counts historical closes that carry no regime', async () => {
        await recordRegimeDay({ date: DAY, coin: 'BTC', regime: 'trending' }, USER);
        const trades = Array.from({ length: MATRIX_MIN_SAMPLES }, (_, i) => closed({ id: `h${i}` }));
        expect(familyRegimeEdge('trend_following', 'trending')).toBeNull();

        const r = await rebuildMatrixFromJournal(trades, USER);
        expect(r.resolvedFromHistory).toBe(MATRIX_MIN_SAMPLES);
        expect(r.samples).toBe(MATRIX_MIN_SAMPLES);
        const edge = familyRegimeEdge('trend_following', 'trending');
        expect(edge?.samples).toBe(MATRIX_MIN_SAMPLES);
        // The point of the whole pass: retrieval can now tilt on it.
        expect(familyEdgeFactor('trend_following', 'trending')).toBe(MATRIX_FAVOR_FACTOR);
    });

    it('recomputes, so a second pass cannot double-count', async () => {
        await recordRegimeDay({ date: DAY, coin: 'BTC', regime: 'ranging' }, USER);
        const trades = [closed({ id: 'x1' }), closed({ id: 'x2', outcome: TradeOutcome.LOSS })];
        const first = await rebuildMatrixFromJournal(trades, USER);
        const second = await rebuildMatrixFromJournal(trades, USER);
        expect(first.samples).toBe(2);
        expect(second.samples).toBe(2);
        expect(familyRegimeEdge('trend_following', 'ranging')?.samples).toBe(2);
    });

    it('drops a trade that is no longer in the journal', async () => {
        await recordRegimeDay({ date: DAY, coin: 'BTC', regime: 'ranging' }, USER);
        const trades = [closed({ id: 'y1' }), closed({ id: 'y2' })];
        await rebuildMatrixFromJournal(trades, USER);
        const after = await rebuildMatrixFromJournal([trades[0]], USER);
        expect(after.samples).toBe(1);
    });

    it('skips unsettled trades and trades with no observed regime', async () => {
        await recordRegimeDay({ date: DAY, coin: 'BTC', regime: 'ranging' }, USER);
        const r = await rebuildMatrixFromJournal([
            closed({ id: 'pending', outcome: 'PENDING' as TradeOutcome }),
            closed({ id: 'nocombo', analysis: { direction: 'Long' } as never }),
        ], USER);
        expect(r.samples).toBe(0);
        expect(r.unresolved).toBe(1);
    });

    it('survives a reload — the rebuild is persisted, not just cached', async () => {
        await recordRegimeDay({ date: DAY, coin: 'BTC', regime: 'compression' }, USER);
        await rebuildMatrixFromJournal([closed({ id: 'z1' })], USER);
        await hydrateStrategyRegimeMatrix(USER);
        expect(familyRegimeEdge('trend_following', 'compression')?.samples).toBe(1);
    });

    it('a live settle with no snapshot regime now counts', async () => {
        // Before the resolver, recordSettledTradeForMatrix read only
        // trade.marketRegime and early-returned here.
        await recordRegimeDay({ date: DAY, coin: 'BTC', regime: 'volatile' }, USER);
        await recordSettledTradeForMatrix(closed({ id: 'live1' }), USER);
        expect(familyRegimeEdge('trend_following', 'volatile')?.samples).toBe(1);
    });
});
