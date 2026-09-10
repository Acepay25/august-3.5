import { describe, it, expect } from 'vitest';
import { toCandles, toVolumes, verdictLevels } from '../services/trade/chartData';
import type { Kline } from '../services/analysis/MarketDataService';
import type { TradeAnalysis } from '../types';

const k = (over: Partial<Kline>): Kline => ({ time: 1_760_000_000_000, open: 100, high: 101, low: 99, close: 100.5, volume: 10, ...over });

describe('chartData mappers (local canvas chart)', () => {
    it('converts klines to second-based candles and drops malformed rows', () => {
        const out = toCandles([k({}), k({ close: NaN }), k({ time: 1_760_000_060_000 })]);
        expect(out).toHaveLength(2);
        expect(out[0].time).toBe(1_760_000_000);
        expect(out[0]).toMatchObject({ open: 100, high: 101, low: 99, close: 100.5 });
    });

    it('colors volume bars by candle direction', () => {
        const up = toVolumes([k({ close: 100.5 })])[0];   // close >= open -> up
        const down = toVolumes([k({ close: 99.9 })])[0];
        expect(up.color).toContain('106');   // green channel
        expect(down.color).toContain('247'); // red channel
    });

    it('verdictLevels only draws a verdict that matches the symbol', () => {
        const analysis = {
            coinName: 'BTCUSDT',
            entryPoints: [{ price: '95000' }],
            stopLoss: '$94,500',
            takeProfit: [{ price: '96000' }, { price: '97000' }],
        } as unknown as TradeAnalysis;
        const labels = verdictLevels(analysis, 'BTCUSDT').map(l => l.label);
        expect(labels).toEqual(['Entry', 'Stop', 'TP1', 'TP2']);
        expect(verdictLevels(analysis, 'ETHUSDT')).toEqual([]);
        expect(verdictLevels(null, 'BTCUSDT')).toEqual([]);
        // Unparseable levels are dropped, not drawn at zero.
        expect(verdictLevels({ coinName: 'BTCUSDT', entryPoints: [{ price: 'market' }], stopLoss: '', takeProfit: [] } as unknown as TradeAnalysis, 'BTCUSDT')).toEqual([]);
    });
});
