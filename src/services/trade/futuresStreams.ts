/**
 * futuresStreams — pure parsers for the Binance FUTURES websocket payloads
 * the trade surface consumes (wss://fstream.binance.com). Kept pure +
 * exported so the wire contract is unit-tested against recorded payloads
 * without opening a socket. All numeric fields arrive as strings.
 */

export interface LiveMarkIndex {
    markPrice: number;
    indexPrice: number;
    fundingRate: number;
    nextFundingTime: number;
}

export interface LiveTicker {
    lastPrice: number;
    changePercent24h: number;
    quoteVolume24h: number;
}

export interface LiveLevel { price: number; qty: number }
export interface LiveDepth { bids: LiveLevel[]; asks: LiveLevel[] }

export interface LiveKline {
    openTime: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    closed: boolean;
}

const num = (v: unknown): number => {
    const n = typeof v === 'string' || typeof v === 'number' ? Number(v) : NaN;
    return Number.isFinite(n) ? n : NaN;
};

/** markPrice@1s: { e:'markPriceUpdate', p: mark, i: index, P: funding, T: next } */
export const parseMarkPrice = (msg: any): LiveMarkIndex | null => {
    if (!msg || msg.e !== 'markPriceUpdate') return null;
    const markPrice = num(msg.p);
    if (!Number.isFinite(markPrice)) return null;
    return { markPrice, indexPrice: num(msg.i), fundingRate: num(msg.P), nextFundingTime: num(msg.T) };
};

/** 24hrTicker: { e:'24hrTicker', c: last, P: pct, q: quoteVolume } */
export const parseTicker = (msg: any): LiveTicker | null => {
    if (!msg || msg.e !== '24hrTicker') return null;
    const lastPrice = num(msg.c);
    if (!Number.isFinite(lastPrice)) return null;
    return { lastPrice, changePercent24h: num(msg.P), quoteVolume24h: num(msg.q) };
};

const toLevels = (rows: unknown): LiveLevel[] => Array.isArray(rows)
    ? rows.map(r => ({ price: num(Array.isArray(r) ? r[0] : NaN), qty: num(Array.isArray(r) ? r[1] : NaN) }))
        .filter(l => Number.isFinite(l.price) && Number.isFinite(l.qty))
    : [];

/** depth20@100ms (diff-style update): { e:'depthUpdate', b: bids, a: asks } —
 *  a zero qty means "remove that level" and is filtered out. */
export const parseDepth = (msg: any): LiveDepth | null => {
    if (!msg || msg.e !== 'depthUpdate') return null;
    const bids = toLevels(msg.b).filter(l => l.qty > 0);
    const asks = toLevels(msg.a).filter(l => l.qty > 0);
    if (bids.length === 0 && asks.length === 0) return null;
    return { bids, asks };
};

/** kline_<interval>: { e:'kline', k: { t,o,h,l,c,v,x } } */
export const parseKline = (msg: any): LiveKline | null => {
    const k = msg?.k;
    if (!msg || msg.e !== 'kline' || !k) return null;
    const open = num(k.o), close = num(k.c);
    if (!Number.isFinite(open) || !Number.isFinite(close)) return null;
    return {
        openTime: num(k.t),
        open,
        high: num(k.h),
        low: num(k.l),
        close,
        volume: num(k.v),
        closed: !!k.x,
    };
};

/** Combined-stream envelope: { stream, data } → the inner payload. */
export const unwrapCombined = (raw: string): any => {
    try {
        const parsed = JSON.parse(raw);
        return parsed && parsed.data !== undefined ? parsed.data : parsed;
    } catch { return null; }
};
