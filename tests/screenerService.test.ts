/**
 * Screener service: grade the top-N USDT-perp universe with August's own
 * machinery — RSI(14) + EMA regime + the strategy-book detectors + the
 * trader's personal edge — progressively, with bounded concurrency.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

const { universeMock, klinesMock, clusterMock } = vi.hoisted(() => ({
    universeMock: vi.fn() as Mock<(...args: any[]) => any>,
    klinesMock: vi.fn() as Mock<(...args: any[]) => any>,
    clusterMock: vi.fn() as Mock<(...args: any[]) => any>,
}));

vi.mock('../services/analysis/MarketDataService', () => ({
    fetchAllFuturesSymbols: (...args: unknown[]) => universeMock(...args),
}));
vi.mock('../services/analysis/KlineService', () => ({
    fetchKlines: (...args: unknown[]) => klinesMock(...args),
}));
vi.mock('../services/learning/EvidencePackService', () => ({
    computeSetupClusterStats: (...args: unknown[]) => clusterMock(...args),
}));

import { runScreener, screenerToMarkdown } from '../services/trade/screener';
import type { Kline } from '../services/analysis/MarketDataService';

const UNIVERSE = [
    { symbol: 'BTCUSDT', baseAsset: 'BTC', lastPrice: 77295, changePercent24h: 1.2, quoteVolume: 1.4e9 },
    { symbol: 'ETHUSDT', baseAsset: 'ETH', lastPrice: 3140, changePercent24h: -0.8, quoteVolume: 9.2e8 },
    { symbol: 'SOLUSDT', baseAsset: 'SOL', lastPrice: 151, changePercent24h: 4.1, quoteVolume: 4.4e8 },
];

/** Candles with the last `rises` closes climbing (monotonic → RSI 100). */
const klines = (closes: number[]): Kline[] =>
    closes.map((close, i) => ({ time: 1700000000 + i * 900, open: close, high: close + 1, low: close - 1, close, volume: 10 }));

beforeEach(() => {
    universeMock.mockReset().mockResolvedValue(UNIVERSE);
    klinesMock.mockReset();
    clusterMock.mockReset().mockReturnValue(null);
});

describe('runScreener', () => {
    it('grades every coin: RSI, regime, setups and the personal edge', async () => {
        // BTC rising hard (RSI ~100, up regime), ETH falling (RSI ~0, down), SOL no candles.
        klinesMock.mockImplementation(async (symbol: string) => {
            if (symbol === 'BTCUSDT') return klines(Array.from({ length: 60 }, (_, i) => 100 + i));
            if (symbol === 'ETHUSDT') return klines(Array.from({ length: 60 }, (_, i) => 200 - i));
            return [];
        });
        clusterMock.mockImplementation((coin: string) =>
            coin === 'BTC' ? { sample: 12, wins: 7, losses: 5 } : null);

        const rows = await runScreener({ trades: [] });

        expect(rows.map(r => r.symbol)).toEqual(['BTCUSDT', 'ETHUSDT', 'SOLUSDT']);
        expect(rows[0].rsi14).toBe(100);
        expect(rows[0].regime).toBe('up');
        expect(rows[0].edge).toBe('7W/5L');
        expect(rows[1].rsi14).toBe(0);
        expect(rows[1].regime).toBe('down');
        expect(rows[1].edge).toBe('');
        // SOL: klines failed → price/volume row only, never a thrown scan.
        expect(rows[2].rsi14).toBeNull();
        expect(rows[2].regime).toBe('range');
        expect(Array.isArray(rows[2].setups)).toBe(true);
    });

    it('respects the limit and reports rows progressively', async () => {
        klinesMock.mockResolvedValue(klines(Array.from({ length: 60 }, (_, i) => 100 + i)));
        const seen: number[] = [];
        const rows = await runScreener({ limit: 2, onRows: r => seen.push(r.length) });
        expect(rows).toHaveLength(2);
        expect(seen).toEqual([1, 2]);
    });

    it('detects live setups through the strategy-book detectors', async () => {
        // A clean pin-bar at the end of a range → the detector should flag it.
        const base = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 6) * 2);
        const candles = klines(base);
        const last = candles[candles.length - 1];
        candles[candles.length - 1] = { ...last, open: 100, close: 100.2, high: 100.4, low: 92 };
        klinesMock.mockResolvedValue(candles);
        const rows = await runScreener({});
        expect(Array.isArray(rows[0].setups)).toBe(true);
        rows[0].setups.forEach(s => expect(['long', 'short', 'watch']).toContain(s.side));
    });
});

describe('screenerToMarkdown', () => {
    it('renders a compact self-labeled table for the model', () => {
        const md = screenerToMarkdown([{
            symbol: 'BTCUSDT', baseAsset: 'BTC', price: 77295, change24h: 1.2, quoteVolume: 1.4e9,
            rsi14: 61.3, regime: 'up', setups: [{ title: 'Failed breakout', side: 'short' }], edge: '7W/5L',
        }]);
        expect(md).toContain('SCREENER — 1 coins');
        expect(md).toContain('BTCUSDT | 77,295 | +1.2% | 61.3 | ▲ up | Failed breakout (short) | 7W/5L');
    });

    it('says UNKNOWN when the universe fetch failed', () => {
        expect(screenerToMarkdown([])).toContain('UNKNOWN');
    });
});
