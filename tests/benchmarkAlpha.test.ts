import { describe, it, expect } from 'vitest';
import {
    benchmarkForSymbol,
    benchmarkReturnPct,
    computeAlphaPct,
    beatTheTide,
    settleBenchmarkAlpha,
} from '../utils/benchmarkAlpha';
import type { BenchmarkAlpha } from '../utils/benchmarkAlpha';

describe('benchmark alpha (skill vs tide)', () => {
    it('picks BTC as the tide for most pairs, ETH for ETH', () => {
        expect(benchmarkForSymbol('SOLUSDT')).toBe('BTCUSDT');
        expect(benchmarkForSymbol('btcusdt')).toBe('BTCUSDT');
        expect(benchmarkForSymbol('ETHUSDT')).toBe('ETHUSDT');
        expect(benchmarkForSymbol('ETHPERP')).toBe('ETHUSDT');
    });

    it('buy-and-hold return is close-to-close percent', () => {
        expect(benchmarkReturnPct(100, 110)).toBeCloseTo(10, 6);
        expect(benchmarkReturnPct(100, 90)).toBeCloseTo(-10, 6);
        expect(Number.isNaN(benchmarkReturnPct(0, 100))).toBe(true);
    });

    it('alpha is trade return minus the tide', () => {
        // +20% trade in a +5% bull month: real edge is +15.
        expect(computeAlphaPct(20, 5)).toBeCloseTo(15, 6);
        // A WIN that just rides the tide (+5% trade in a +8% month) is NEGATIVE alpha.
        expect(computeAlphaPct(5, 8)).toBeCloseTo(-3, 6);
        expect(Number.isNaN(computeAlphaPct(NaN, 5))).toBe(true);
    });

    it('beatTheTide is null-safe on missing/NaN alpha', () => {
        expect(beatTheTide(undefined)).toBeNull();
        expect(beatTheTide({ alphaPct: NaN } as BenchmarkAlpha)).toBeNull();
        expect(beatTheTide({ alphaPct: 1 } as BenchmarkAlpha)).toBe(true);
        expect(beatTheTide({ alphaPct: -1 } as BenchmarkAlpha)).toBe(false);
    });
});

describe('settleBenchmarkAlpha', () => {
    it('rejects an invalid window without throwing (no fabricated alpha)', async () => {
        const r = await settleBenchmarkAlpha({ symbol: 'SOLUSDT', entryTimeMs: 2000, exitTimeMs: 1000, tradePct: 5 });
        expect(Number.isFinite(r.alphaPct)).toBe(false);
        expect(r.unavailableReason).toBe('invalid window');
        expect(r.benchmarkSymbol).toBe('BTCUSDT');
    });
});
