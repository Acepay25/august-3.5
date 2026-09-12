/**
 * candleFormations — the pure candle-formation + market-structure read that
 * feeds get_all_timeframes. Scripted OHLC arrays, no network.
 */

import { describe, it, expect } from 'vitest';
import { detectCandleFormations, describeMarketStructure, type FormationCandle } from '../services/trade/candleFormations';

const c = (over: Partial<FormationCandle>): FormationCandle => ({
    time: 1_700_000_000, open: 100, high: 101, low: 99, close: 100, ...over,
});

describe('detectCandleFormations', () => {
    it('returns nothing for a single candle', () => {
        expect(detectCandleFormations([c({})])).toEqual([]);
    });

    it('flags a bullish engulfing', () => {
        // prior bearish small body, current bullish body swallowing it.
        const candles = [
            c({ open: 100, high: 101, low: 98, close: 99 }),   // bearish
            c({ open: 98, high: 103, low: 97.5, close: 102 }), // bullish, engulfs
        ];
        const found = detectCandleFormations(candles);
        expect(found.some(l => l.includes('bullish engulfing'))).toBe(true);
    });

    it('flags a hammer (long lower wick, small body)', () => {
        const candles = [
            c({}),
            c({}),
            c({ open: 100, high: 100.6, low: 95, close: 100.4 }),
        ];
        expect(detectCandleFormations(candles).some(l => l.includes('hammer'))).toBe(true);
    });

    it('flags an inside bar (range inside the previous range)', () => {
        const candles = [
            c({}),
            c({ open: 100, high: 105, low: 95, close: 102 }),
            c({ open: 101, high: 103, low: 97, close: 102 }),
        ];
        expect(detectCandleFormations(candles).some(l => l.includes('inside bar'))).toBe(true);
    });

    it('flags a bearish impulse bar (range far above the recent average)', () => {
        const calm = Array.from({ length: 6 }, () => c({ open: 100, high: 101, low: 99, close: 100 }));
        const candles = [...calm, c({ open: 100, high: 100.5, low: 90, close: 90.5 })];
        expect(detectCandleFormations(candles).some(l => l.includes('bearish impulse'))).toBe(true);
    });
});

describe('describeMarketStructure', () => {
    it('reports not-enough for tiny series', () => {
        expect(describeMarketStructure([c({}), c({}), c({})])).toContain('not enough');
    });

    it('reads higher highs and higher lows as an uptrend', () => {
        // Two swing highs rising, two swing lows rising.
        const candles: FormationCandle[] = [
            c({ time: 1, open: 90, high: 92, low: 88, close: 91 }),
            c({ time: 2, open: 91, high: 93, low: 90, close: 92 }),
            c({ time: 3, open: 92, high: 94, low: 91, close: 92 }),   // swing high 94
            c({ time: 4, open: 92, high: 93, low: 90, close: 91 }),
            c({ time: 5, open: 91, high: 92, low: 89, close: 90 }),   // swing low 89
            c({ time: 6, open: 90, high: 95, low: 90, close: 94 }),
            c({ time: 7, open: 94, high: 96, low: 93, close: 95 }),   // swing high 96
            c({ time: 8, open: 95, high: 96, low: 92, close: 93 }),
            c({ time: 9, open: 93, high: 94, low: 91, close: 92 }),   // swing low 91
            c({ time: 10, open: 92, high: 97, low: 92, close: 96 }),
        ];
        expect(describeMarketStructure(candles)).toContain('higher highs and higher lows');
    });
});
