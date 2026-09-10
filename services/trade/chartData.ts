/**
 * chartData — pure mappers feeding the local canvas chart (lightweight-charts)
 * from the app's own kline fetchers. Keeping the conversions pure means the
 * chart's data contract is unit-tested without a canvas or the network.
 */

import { Kline } from '../analysis/MarketDataService';
import { TradeAnalysis } from '../../types';

export interface CandlePoint {
    time: number; // unix seconds (lightweight-charts UTCTimestamp)
    open: number;
    high: number;
    low: number;
    close: number;
}

export interface VolumePoint {
    time: number;
    value: number;
    color: string;
}

const UP = 'rgba(7, 181, 106, 0.45)';   // theme green
const DOWN = 'rgba(247, 93, 95, 0.45)'; // theme red

export const toCandles = (klines: Kline[]): CandlePoint[] => klines
    .filter(k => Number.isFinite(k.open) && Number.isFinite(k.high) && Number.isFinite(k.low) && Number.isFinite(k.close))
    .map(k => ({ time: Math.floor(k.time / 1000), open: k.open, high: k.high, low: k.low, close: k.close }));

export const toVolumes = (klines: Kline[]): VolumePoint[] => klines
    .filter(k => Number.isFinite(k.volume))
    .map(k => ({ time: Math.floor(k.time / 1000), value: k.volume, color: k.close >= k.open ? UP : DOWN }));

export interface ChartLevel {
    label: string;
    price: number;
    color: string;
    dashed: boolean;
}

const parsePrice = (v: string | number | undefined): number | null => {
    if (v === undefined || v === null) return null;
    const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[$,\s]/g, ''));
    return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * The verdict overlay: draw the CURRENT analysis' Entry/SL/TPs on the chart
 * so the surface shows August's own read of the tape, not just candles.
 * Returns [] when there is no verdict or it belongs to a different coin.
 */
export const verdictLevels = (analysis: TradeAnalysis | null | undefined, symbol: string): ChartLevel[] => {
    if (!analysis) return [];
    const aCoin = (analysis.coinName || '').toUpperCase().replace(/USD(T|P|C|E)?$/, '');
    const sCoin = symbol.toUpperCase().replace(/USD(T|P|C|E)?$/, '');
    if (!aCoin || aCoin !== sCoin) return [];
    const levels: ChartLevel[] = [];
    const entry = parsePrice(analysis.entryPoints?.[0]?.price);
    if (entry) levels.push({ label: 'Entry', price: entry, color: '#399ef7', dashed: false });
    const sl = parsePrice(analysis.stopLoss);
    if (sl) levels.push({ label: 'Stop', price: sl, color: '#f75d5f', dashed: true });
    (analysis.takeProfit || []).forEach((tp, i) => {
        const p = parsePrice(tp.price);
        if (p) levels.push({ label: `TP${i + 1}`, price: p, color: '#07b56a', dashed: true });
    });
    return levels;
};
