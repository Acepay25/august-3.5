import { describe, it, expect } from 'vitest';
import {
    parseMarkPrice, parseTicker, parseDepth, parseKline, unwrapCombined,
} from '../services/trade/futuresStreams';

// Recorded-shape Binance futures websocket payloads (string numerics on the
// wire — the parsers must handle exactly this).

describe('futuresStreams parsers (websocket wire contract)', () => {
    it('markPrice@1s → mark/index/funding/next', () => {
        const r = parseMarkPrice({
            e: 'markPriceUpdate', E: 1760000000000, s: 'BTCUSDT',
            p: '78064.46000000', i: '78064.08243902', P: '0.00006800', T: 1760025300000,
        });
        expect(r).toEqual({ markPrice: 78064.46, indexPrice: 78064.08243902, fundingRate: 0.000068, nextFundingTime: 1760025300000 });
        expect(parseMarkPrice({ e: 'kline' })).toBeNull();
        expect(parseMarkPrice({ e: 'markPriceUpdate', p: 'nope' })).toBeNull();
    });

    it('24hrTicker → last/change/volume', () => {
        const r = parseTicker({ e: '24hrTicker', s: 'BTCUSDT', c: '78064.46', P: '-1.43', q: '1124567890.12' });
        expect(r).toEqual({ lastPrice: 78064.46, changePercent24h: -1.43, quoteVolume24h: 1124567890.12 });
    });

    it('depth20 snapshot → ladders, zero-qty removals filtered', () => {
        const r = parseDepth({
            e: 'depthUpdate', s: 'BTCUSDT',
            b: [['78063.90', '2.026'], ['78063.80', '0'], ['78063.70', '0.084']],
            a: [['78064.40', '1.086'], ['78064.50', '0.005']],
        });
        expect(r!.bids.map(l => l.price)).toEqual([78063.9, 78063.7]);
        expect(r!.asks).toHaveLength(2);
        expect(parseDepth({ e: 'depthUpdate', b: [], a: [] })).toBeNull();
    });

    it('kline update → bar + closed flag', () => {
        const r = parseKline({ e: 'kline', k: { t: 1760000000000, T: 1760000899999, o: '78000.00', h: '78100.00', l: '77900.00', c: '78064.00', v: '12.5', x: false } });
        expect(r).toMatchObject({ openTime: 1760000000000, open: 78000, high: 78100, low: 77900, close: 78064, volume: 12.5, closed: false });
        expect(parseKline({ e: 'kline' })).toBeNull();
    });

    it('combined envelope unwraps data; junk returns null', () => {
        expect(unwrapCombined(JSON.stringify({ stream: 'btcusdt@ticker', data: { e: '24hrTicker' } }))).toEqual({ e: '24hrTicker' });
        expect(unwrapCombined('not json')).toBeNull();
    });
});
