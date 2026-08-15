import { TradeAnalysis, TradeOutcome } from '../types';
import { WatchedSignal } from './watchList';

const parseNum = (value?: string): number | undefined => {
    if (!value) return undefined;
    const n = Number(String(value).replace(/[$,\s]/g, ''));
    return Number.isFinite(n) ? n : undefined;
};

/** Open R vs last price. Positive = in favor of the ticket. */
export const paperPnlR = (analysis: TradeAnalysis, lastPrice?: number): { r: number; line: string } | null => {
    if (!lastPrice || analysis.confidence === 'Avoid' || analysis.direction === 'Neutral') return null;
    const entry = parseNum(analysis.entryPoints?.[0]?.price);
    const sl = parseNum(analysis.stopLoss);
    if (entry === undefined || sl === undefined) return null;
    const risk = Math.abs(entry - sl);
    if (risk <= 0) return null;
    const move = analysis.direction === 'Short' ? entry - lastPrice : lastPrice - entry;
    const r = move / risk;
    const sign = r >= 0 ? '+' : '';
    return { r, line: `${sign}${r.toFixed(2)}R @ ${lastPrice}` };
};

export const describeOpenBookRisk = (signals: WatchedSignal[]): string => {
    const open = signals.filter(s =>
        (!s.outcome || s.outcome === TradeOutcome.PENDING)
        && s.analysis.direction !== 'Neutral'
        && s.analysis.confidence !== 'Avoid',
    );
    const longs = open.filter(s => s.analysis.direction === 'Long');
    const shorts = open.filter(s => s.analysis.direction === 'Short');
    const alts = (rows: WatchedSignal[]) => rows.filter(s => !/BTC/i.test(s.analysis.coinName || ''));
    if (alts(longs).length >= 2) {
        return `${alts(longs).length} open Long alts — one BTC dump hits all of them.`;
    }
    if (alts(shorts).length >= 2) {
        return `${alts(shorts).length} open Short alts — a BTC squeeze squeezes the book.`;
    }
    if (longs.length >= 2 && shorts.length === 0) {
        return `${longs.length} open Longs, no hedge.`;
    }
    return '';
};

export const ticketExpiryLine = (analysis: TradeAnalysis, nowMs = Date.now()): { expired: boolean; line: string } | null => {
    if (!analysis.createdAt || !analysis.validityDurationMinutes) return null;
    const expires = new Date(analysis.createdAt).getTime() + analysis.validityDurationMinutes * 60_000;
    const left = Math.round((expires - nowMs) / 60_000);
    if (left <= 0) return { expired: true, line: 'Ticket expired' };
    return { expired: false, line: left >= 60 ? `Valid ${Math.floor(left / 60)}h ${left % 60}m` : `Valid ${left}m` };
};
