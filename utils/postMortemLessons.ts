/**
 * Post-mortem lessons for the SAME coin — injected into the next debate on
 * that coin so the floor does not repeat a mistake it already paid for.
 * Derived from the trade journal (loggedTrades), zero AI cost.
 */

import { LoggedTrade, TradeOutcome } from '../types';
import { extractLessonFromPostMortem } from '../services/learning/MemoryFilesService';

const normalizeCoin = (coin?: string): string =>
    (coin || '').toUpperCase().replace(/USDT?$/, '').trim();

export interface CoinLessonRow {
    date: string;
    outcome: 'WIN' | 'LOSS';
    direction: string;
    lesson: string;
}

/** Latest post-mortem lessons for a coin (newest first, capped). */
export const collectCoinLessons = (
    loggedTrades: LoggedTrade[],
    coin?: string,
    max: number = 4,
): CoinLessonRow[] => {
    const target = normalizeCoin(coin);
    if (!target) return [];
    const rows: CoinLessonRow[] = [];
    const ordered = [...loggedTrades].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    for (const trade of ordered) {
        if (normalizeCoin(trade.analysis?.coinName) !== target) continue;
        if (trade.outcome !== TradeOutcome.WIN && trade.outcome !== TradeOutcome.LOSS) continue;
        const lesson = extractLessonFromPostMortem(trade.postMortem ?? '');
        if (!lesson) continue;
        rows.push({
            date: trade.timestamp,
            outcome: trade.outcome === TradeOutcome.WIN ? 'WIN' : 'LOSS',
            direction: trade.analysis?.direction || '—',
            lesson,
        });
        if (rows.length >= max) break;
    }
    return rows;
};

/** Prompt-ready block, or '' when the coin has no post-mortem lessons. */
export const buildCoinLessonsBlock = (
    loggedTrades: LoggedTrade[],
    coin?: string,
): string => {
    const rows = collectCoinLessons(loggedTrades, coin);
    if (rows.length === 0) return '';
    const lines = rows.map(r => {
        const date = new Date(r.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        return `- [${date} · ${r.outcome} · ${r.direction}] ${r.lesson}`;
    });
    return [
        `**POST-MORTEM LESSONS FOR ${normalizeCoin(coin)} (from your closed trades on this coin):**`,
        ...lines,
        'The verdict must account for these lessons — do not repeat a mistake this coin already taught you.',
    ].join('\n');
};
