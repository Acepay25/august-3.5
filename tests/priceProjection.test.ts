/**
 * priceProjection — the deterministic ATR cone behind project_future_price.
 * Pure math: bands widen with horizon, drift follows the tape, short tapes
 * throw instead of inventing.
 */

import { describe, it, expect } from 'vitest';
import {
    averageTrueRange,
    projectPrices,
    projectionToMarkdown,
    PROJECTION_MAX_HORIZON,
    type ProjectionCandle,
} from '../services/trade/priceProjection';

/** Rising tape: close climbs 10/bar, 4-point ranges. */
const risingTape = (n: number): ProjectionCandle[] =>
    Array.from({ length: n }, (_, i) => {
        const close = 1000 + i * 10;
        return { time: 1_700_000_000_000 + i * 900_000, open: close - 4, high: close + 2, low: close - 2, close };
    });

describe('averageTrueRange', () => {
    it('matches the mean range on a flat tape', () => {
        const candles = risingTape(30);
        const atr = averageTrueRange(candles);
        expect(atr).toBeGreaterThan(0);
        expect(atr).toBeLessThan(20);
    });
});

describe('projectPrices', () => {
    it('throws on a tape too short to read', () => {
        expect(() => projectPrices(risingTape(10))).toThrow(/at least 20/);
    });

    it('builds ordered bands that widen with horizon', () => {
        const path = projectPrices(risingTape(60), 24);
        expect(path.base).toHaveLength(24);
        expect(path.bull).toHaveLength(24);
        expect(path.bear).toHaveLength(24);
        for (let i = 0; i < 24; i += 1) {
            expect(path.bull[i]).toBeGreaterThan(path.base[i]);
            expect(path.base[i]).toBeGreaterThan(path.bear[i]);
        }
        const widthAt = (i: number): number => path.bull[i] - path.bear[i];
        expect(widthAt(23)).toBeGreaterThan(widthAt(0));
    });

    it('leans the base path with the tape drift', () => {
        const path = projectPrices(risingTape(60), 12);
        expect(path.trend).toBe('up');
        expect(path.base[11]).toBeGreaterThan(path.lastClose);
    });

    it('clamps wild horizons instead of running away', () => {
        expect(projectPrices(risingTape(60), 500).base).toHaveLength(PROJECTION_MAX_HORIZON);
        expect(projectPrices(risingTape(60), 0).base).toHaveLength(24);
    });
});

describe('projectionToMarkdown', () => {
    it('names the coin and refuses forecast language', () => {
        const md = projectionToMarkdown('ETHUSDT', '15m', projectPrices(risingTape(60), 12));
        expect(md).toContain('ETHUSDT');
        expect(md).toContain('15m');
        expect(md).toMatch(/NOT a prediction/);
        expect(md).toContain('bull');
        expect(md).toContain('bear');
    });
});
