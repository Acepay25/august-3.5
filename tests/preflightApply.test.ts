import { describe, it, expect, vi, beforeEach } from 'vitest';

// Preferences-backed store for the preflight result ledger (same idiom as
// the other learning-service suites: in-memory map, reset per test).
let store: Record<string, unknown> = {};
vi.mock('../services/infrastructure/PreferencesService', () => ({
    getPreferenceObject: vi.fn(async <T,>(key: string): Promise<T | null> =>
        (store[key] as T | undefined) ?? null),
    setPreferenceObject: vi.fn(async (key: string, value: unknown): Promise<void> => {
        store[key] = value;
    }),
    removePreference: vi.fn(async (key: string): Promise<void> => {
        delete store[key];
    }),
}));

// providerFitness imports the rolling-window stats at module level; the
// pass-rate path under test here never calls it, but the mock keeps the
// import side-effect-free.
vi.mock('../services/backtesting/ModelPerformanceService', () => ({
    getRollingWindowStats: vi.fn(() => ({
        last20WinRate: 0,
        last20Total: 0,
        last20Wins: 0,
        coldStreakCount: 0,
        hotStreakCount: 0,
        isDemoted: false,
    })),
}));

import {
    applyPreflightGate,
    preflightFailureLine,
    buildPreflightBlock,
} from '../services/learning/preflight';
import { recordPreflightResult, getPreflightPassRate } from '../services/learning/providerFitness';

const PASSING_OPENING = `DATA: BTC 4H close below 94200
SOURCE: chart 4h bar
FALSIFICATION: a 4H close back above 94500`;

beforeEach(() => {
    store = {};
});

describe('applyPreflightGate', () => {
    it('passes a valid opening through unchanged', () => {
        const gate = applyPreflightGate(PASSING_OPENING);
        expect(gate.passed).toBe(true);
        expect(gate.output).toBe(PASSING_OPENING);
        expect(gate.reason).toBeUndefined();
    });

    it('substitutes the NO CLAIM line when the opening lacks preflight', () => {
        const gate = applyPreflightGate('I think BTC looks bullish here, buying pressure is strong.');
        expect(gate.passed).toBe(false);
        expect(gate.reason).toBe('no_preflight');
        expect(gate.output).toBe(preflightFailureLine('no_preflight'));
        expect(gate.output).toContain('NO CLAIM');
    });

    it('substitutes when the DATA line is a placeholder', () => {
        const gate = applyPreflightGate(`DATA: N/A
SOURCE: chart
FALSIFICATION: a 4H close back above 94500`);
        expect(gate.passed).toBe(false);
        expect(gate.reason).toBe('junk_data');
        expect(gate.output).toContain('junk DATA');
    });

    it('substitutes when the DATA line has no number, level, or pattern', () => {
        const gate = applyPreflightGate(`DATA: looks pretty bearish to me
SOURCE: chart
FALSIFICATION: a 4H close back above 94500`);
        expect(gate.passed).toBe(false);
        expect(gate.reason).toBe('non_specific_data');
    });

    it('treats empty and missing text as no_preflight failures', () => {
        expect(applyPreflightGate('').passed).toBe(false);
        expect(applyPreflightGate(undefined).passed).toBe(false);
        expect(applyPreflightGate(null).passed).toBe(false);
        expect(applyPreflightGate(null).output).toBe(preflightFailureLine('no_preflight'));
    });

    it('never substitutes on pass even when the input was undefined-safe', () => {
        const gate = applyPreflightGate(PASSING_OPENING);
        expect(gate.output).not.toContain('NO CLAIM');
    });
});

describe('preflight gate → provider fitness recording', () => {
    it('records pass and fail outcomes per provider and reads them back as a pass rate', async () => {
        // The wiring shape used by the pipeline: gate the opening, then record.
        const good = applyPreflightGate(PASSING_OPENING);
        await recordPreflightResult('alice', 'prov-a', good.passed);
        const bad = applyPreflightGate('no evidence at all, just vibes');
        await recordPreflightResult('alice', 'prov-a', bad.passed);
        await recordPreflightResult('alice', 'prov-a', true);

        const rate = await getPreflightPassRate('alice', 'prov-a');
        expect(rate.total).toBe(3);
        expect(rate.rate).toBeCloseTo(2 / 3, 5);
    });

    it('keeps providers separate in the pass-rate ledger', async () => {
        await recordPreflightResult('alice', 'prov-a', false);
        await recordPreflightResult('alice', 'prov-b', true);

        expect((await getPreflightPassRate('alice', 'prov-a')).rate).toBe(0);
        expect((await getPreflightPassRate('alice', 'prov-b')).rate).toBe(1);
        expect((await getPreflightPassRate('bob', 'prov-a')).rate).toBeNull();
    });
});

describe('buildPreflightBlock', () => {
    it('demands all three lines so a lens prompt can prepend it verbatim', () => {
        const block = buildPreflightBlock();
        expect(block).toMatch(/DATA:/);
        expect(block).toMatch(/SOURCE:/);
        expect(block).toMatch(/FALSIFICATION:/);
        expect(block).toMatch(/rejected/i);
    });
});
