import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Preferences layer so the ledger persists in-memory.
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
    hydrateRegimeLedger,
    recordRegimeDay,
    getRegimeSummary,
    regimeSummaryBlock,
    normalizeLedgerCoin,
    listLedgerCoins,
    marketRegimeToLedger,
} from '../services/learning/regimeLedger';

const USERNAME = 'regime-ledger-test';
const KEY = `regime_ledger_v1_${USERNAME}`;

describe('marketRegimeToLedger', () => {
    it('maps the hybrid MarketRegime trend variants to "trending"', () => {
        expect(marketRegimeToLedger('strong_trend_up')).toBe('trending');
        expect(marketRegimeToLedger('strong_trend_down')).toBe('trending');
        expect(marketRegimeToLedger('weak_trend_up')).toBe('trending');
        expect(marketRegimeToLedger('weak_trend_down')).toBe('trending');
    });
    it('maps volatile_chop to "volatile"', () => {
        expect(marketRegimeToLedger('volatile_chop')).toBe('volatile');
    });
    it('passes the canonical ledger regimes through unchanged', () => {
        expect(marketRegimeToLedger('ranging')).toBe('ranging');
        expect(marketRegimeToLedger('compression')).toBe('compression');
        expect(marketRegimeToLedger('trending')).toBe('trending');
        expect(marketRegimeToLedger('volatile')).toBe('volatile');
    });
    it('returns null for empty or uninformative labels', () => {
        expect(marketRegimeToLedger(undefined)).toBeNull();
        expect(marketRegimeToLedger('')).toBeNull();
        expect(marketRegimeToLedger('unknown_state')).toBeNull();
    });
});

describe('normalizeLedgerCoin', () => {
    it('strips USDT / USD suffixes and uppercases', () => {
        expect(normalizeLedgerCoin('BTCUSDT')).toBe('BTC');
        expect(normalizeLedgerCoin('btcusdt')).toBe('BTC');
        expect(normalizeLedgerCoin('ETHUSD')).toBe('ETH');
        expect(normalizeLedgerCoin('SOL')).toBe('SOL');
    });
    it('returns "" for empty input', () => {
        expect(normalizeLedgerCoin('')).toBe('');
    });
});

describe('recordRegimeDay + getRegimeSummary', () => {
    beforeEach(async () => {
        store = {};
        await hydrateRegimeLedger(USERNAME);
    });

    it('returns an empty summary for an unknown coin', () => {
        const s = getRegimeSummary('BTC', 90);
        expect(s.currentRegime).toBeNull();
        expect(s.currentStreak).toBe(0);
        expect(s.samples).toBe(0);
        expect(s.distribution).toEqual({});
    });

    it('records a day and reads back the current regime', async () => {
        await recordRegimeDay({ date: '2026-08-27', coin: 'BTCUSDT', regime: 'ranging' }, USERNAME);
        const s = getRegimeSummary('BTC', 90);
        expect(s.currentRegime).toBe('ranging');
        expect(s.currentStreak).toBe(1);
        expect(s.samples).toBe(1);
        expect(s.distribution.ranging).toBe(100);
    });

    it('persists entries to Preferences under the per-user key', async () => {
        await recordRegimeDay({ date: '2026-08-27', coin: 'BTC', regime: 'trending' }, USERNAME);
        const raw = store[KEY] as Array<{ date: string; coin: string; regime: string }>;
        expect(Array.isArray(raw)).toBe(true);
        expect(raw).toHaveLength(1);
        expect(raw[0]).toMatchObject({ date: '2026-08-27', coin: 'BTC', regime: 'trending' });
    });

    it('survives a reload from Preferences (persistence round-trip)', async () => {
        await recordRegimeDay({ date: '2026-08-27', coin: 'BTC', regime: 'volatile' }, USERNAME);
        // Drop the in-memory cache and rehydrate from the store.
        await hydrateRegimeLedger(USERNAME);
        const s = getRegimeSummary('BTC', 90);
        expect(s.currentRegime).toBe('volatile');
        expect(s.samples).toBe(1);
    });

    it('same-day re-observation overwrites (dedup per coin × day)', async () => {
        await recordRegimeDay({ date: '2026-08-27', coin: 'BTC', regime: 'ranging' }, USERNAME);
        await recordRegimeDay({ date: '2026-08-27', coin: 'BTC', regime: 'volatile' }, USERNAME);
        const s = getRegimeSummary('BTC', 90);
        expect(s.samples).toBe(1);
        expect(s.currentRegime).toBe('volatile');
        const raw = store[KEY] as unknown[];
        expect(raw).toHaveLength(1);
    });

    it('rejects an unknown regime value', async () => {
        await recordRegimeDay({ date: '2026-08-27', coin: 'BTC', regime: 'moonshot' }, USERNAME);
        expect(getRegimeSummary('BTC', 90).samples).toBe(0);
    });

    it('rejects an empty coin', async () => {
        await recordRegimeDay({ date: '2026-08-27', coin: '', regime: 'ranging' }, USERNAME);
        expect(listLedgerCoins()).toEqual([]);
    });

    it('computes a consecutive-day streak in the current regime', async () => {
        await recordRegimeDay({ date: '2026-08-24', coin: 'BTC', regime: 'trending' }, USERNAME);
        await recordRegimeDay({ date: '2026-08-25', coin: 'BTC', regime: 'ranging' }, USERNAME);
        await recordRegimeDay({ date: '2026-08-26', coin: 'BTC', regime: 'ranging' }, USERNAME);
        await recordRegimeDay({ date: '2026-08-27', coin: 'BTC', regime: 'ranging' }, USERNAME);
        const s = getRegimeSummary('BTC', 90);
        expect(s.currentRegime).toBe('ranging');
        // 08-27, 08-26, 08-25 are ranging; 08-24 is trending → streak stops at 3.
        expect(s.currentStreak).toBe(3);
        expect(s.samples).toBe(4);
    });

    it('a gap in calendar days breaks the streak', async () => {
        await recordRegimeDay({ date: '2026-08-24', coin: 'BTC', regime: 'ranging' }, USERNAME);
        // 08-25 and 08-26 missing.
        await recordRegimeDay({ date: '2026-08-27', coin: 'BTC', regime: 'ranging' }, USERNAME);
        const s = getRegimeSummary('BTC', 90);
        expect(s.currentRegime).toBe('ranging');
        expect(s.currentStreak).toBe(1);
    });

    it('computes the regime distribution as percentages', async () => {
        await recordRegimeDay({ date: '2026-08-24', coin: 'BTC', regime: 'trending' }, USERNAME);
        await recordRegimeDay({ date: '2026-08-25', coin: 'BTC', regime: 'ranging' }, USERNAME);
        await recordRegimeDay({ date: '2026-08-26', coin: 'BTC', regime: 'ranging' }, USERNAME);
        await recordRegimeDay({ date: '2026-08-27', coin: 'BTC', regime: 'ranging' }, USERNAME);
        const s = getRegimeSummary('BTC', 90);
        expect(s.distribution.ranging).toBe(75);
        expect(s.distribution.trending).toBe(25);
        expect(s.distribution.volatile).toBeUndefined();
    });

    it('keeps coins independent', async () => {
        await recordRegimeDay({ date: '2026-08-27', coin: 'BTC', regime: 'ranging' }, USERNAME);
        await recordRegimeDay({ date: '2026-08-27', coin: 'ETH', regime: 'trending' }, USERNAME);
        expect(getRegimeSummary('BTC', 90).currentRegime).toBe('ranging');
        expect(getRegimeSummary('ETH', 90).currentRegime).toBe('trending');
        expect(listLedgerCoins()).toEqual(['BTC', 'ETH']);
    });

    it('windows the summary to the requested number of days', async () => {
        // An old trending day far outside a 7-day window.
        await recordRegimeDay({ date: '2026-06-01', coin: 'BTC', regime: 'trending' }, USERNAME);
        await recordRegimeDay({ date: '2026-08-26', coin: 'BTC', regime: 'ranging' }, USERNAME);
        await recordRegimeDay({ date: '2026-08-27', coin: 'BTC', regime: 'ranging' }, USERNAME);
        const s = getRegimeSummary('BTC', 7);
        expect(s.samples).toBe(2);
        expect(s.distribution.ranging).toBe(100);
        expect(s.distribution.trending).toBeUndefined();
    });
});

describe('regimeSummaryBlock', () => {
    beforeEach(async () => {
        store = {};
        await hydrateRegimeLedger(USERNAME);
    });

    it('returns "" when there is no data or no coin', async () => {
        expect(regimeSummaryBlock(undefined)).toBe('');
        expect(regimeSummaryBlock('BTC')).toBe('');
        await recordRegimeDay({ date: '2026-08-27', coin: 'ETH', regime: 'ranging' }, USERNAME);
        expect(regimeSummaryBlock('BTC')).toBe('');
    });

    it('renders a one-line block naming regime, streak and mix', async () => {
        await recordRegimeDay({ date: '2026-08-26', coin: 'BTC', regime: 'ranging' }, USERNAME);
        await recordRegimeDay({ date: '2026-08-27', coin: 'BTC', regime: 'ranging' }, USERNAME);
        const block = regimeSummaryBlock('BTCUSDT', 90);
        expect(block).toContain('REGIME LEDGER');
        expect(block).toContain('BTC');
        expect(block).toContain('ranging now');
        expect(block).toContain('day 2');
    });

    it('caps the block at the requested length', async () => {
        await recordRegimeDay({ date: '2026-08-27', coin: 'BTC', regime: 'ranging' }, USERNAME);
        const block = regimeSummaryBlock('BTC', 90, 40);
        expect(block.length).toBeLessThanOrEqual(40);
        expect(block.endsWith('…')).toBe(true);
    });
});
