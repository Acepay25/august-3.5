import { LoggedTrade, TradeOutcome } from '../types';
import { describeOpenBookRisk, paperPnlR } from './paperPnl';
import { WatchedSignal } from './watchList';

export interface RiskBookLine {
    watchR?: string;
    corr?: string;
    journalPending: number;
}

export const buildRiskBook = (
    watched: WatchedSignal[],
    trades: LoggedTrade[],
    priceOf: (symbol: string) => number | undefined,
): RiskBookLine => {
    let r = 0;
    let n = 0;
    for (const signal of watched) {
        if (signal.outcome && signal.outcome !== TradeOutcome.PENDING) continue;
        const raw = (signal.analysis.coinName || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (!raw) continue;
        const symbol = raw.includes('USDT') ? raw : `${raw}USDT`;
        const paper = paperPnlR(signal.analysis, priceOf(symbol));
        if (!paper) continue;
        r += paper.r;
        n += 1;
    }
    const journalPending = trades.filter(t => t.outcome === TradeOutcome.PENDING).length;
    return {
        watchR: n > 0 ? `${r >= 0 ? '+' : ''}${r.toFixed(1)}R` : undefined,
        corr: describeOpenBookRisk(watched) || undefined,
        journalPending,
    };
};

export const formatRiskBookBadge = (book: RiskBookLine): string | undefined => {
    if (book.watchR) return book.corr ? `${book.watchR} · ${book.corr}` : book.watchR;
    if (book.corr) return book.corr;
    return undefined;
};
