/**
 * klineInterval — the app timeframe → Binance websocket stream suffix map.
 * The footgun it pins: naive lowercasing turns '1M' (monthly) into '1m'
 * (one-minute), silently subscribing the monthly chart to the 1m stream.
 */

import { describe, it, expect } from 'vitest';
import { klineInterval } from '../hooks/useFuturesLiveFeed';

describe('klineInterval', () => {
    it('lowercases the plain intraday/daily forms', () => {
        expect(klineInterval('15m')).toBe('15m');
        expect(klineInterval('1h')).toBe('1h');
        expect(klineInterval('4h')).toBe('4h');
        expect(klineInterval('1D')).toBe('1d');
    });

    it('maps the multi-day suffixes WITHOUT lowercasing them', () => {
        expect(klineInterval('3D')).toBe('3d');
        expect(klineInterval('1W')).toBe('1w');
        // The critical one: monthly must stay '1M', never collapse to '1m'.
        expect(klineInterval('1M')).toBe('1M');
    });
});
