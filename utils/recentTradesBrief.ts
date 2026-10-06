/**
 * recentTradesBrief — the trade-level "what have I been doing lately" read.
 *
 * `computeJournalStats` answers the aggregate question over the WHOLE journal;
 * `ModelPerformanceService` answers it per MODEL. Neither answers the question a
 * seat actually asks mid-debate — "what happened in my last handful of trades" —
 * so this builds it from the log itself: an explicit timestamp sort (array order
 * is NOT the log order — restores, merges and outcome writes all reshuffle it),
 * a header of decided-only stats, and one line per trade.
 *
 * Units are kept apart on purpose. Manual captures store dollars (`pnlAmount`),
 * autopilot confirmations stored leveraged percent (`pnlPercent`) — averaging the
 * two counts a $150 win as 150R. A row shows whichever it has, labelled.
 */

import { LoggedTrade, TradeOutcome } from '../types';
import { computeJournalStats } from './journalAnalytics';

/** How many rows a brief carries by default — and how many the model may pull. */
export const RECENT_TRADES_WINDOW = 20;

export interface TradeLogFilter {
    coin?: string;
    outcome?: string;
    strategy?: string;
    /** ISO date/datetime; rows logged at or after it. */
    since?: string;
    limit?: number;
}

export interface TradeLogRow {
    id: string;
    /** The log time, verbatim from `LoggedTrade.timestamp`. */
    loggedAt: string;
    symbol: string;
    direction: string;
    outcome: string;
    pnlDollars?: number;
    pnlPercent?: number;
    realizedR?: number;
    strategy?: string;
    tags: string[];
    /** One line, ready for a prompt or a card. */
    line: string;
}

export interface RecentTradesBrief {
    rows: TradeLogRow[];
    /** Decided (WIN/LOSS) rows in the window. */
    decided: number;
    wins: number;
    losses: number;
    /** Still open, skipped or never filled — counted, never in the win rate. */
    unresolved: number;
    /** Percent over `decided`, or null when nothing has settled. */
    winRate: number | null;
    /** Mean `realizedR` over the rows that carry it — null if none do. */
    avgRealizedR: number | null;
    /** Sum of `pnlAmount` over the rows that carry it — null if none do. */
    netPnLDollars: number | null;
    /** Sum of leveraged `pnlPercent` over the rows that carry it. */
    netPnLPercent: number | null;
    /** +N consecutive wins / -N consecutive losses across the decided rows. */
    streak: number;
    /** Logged-at of the oldest and newest row in the window. */
    from: string | null;
    to: string | null;
}

const UNPARSEABLE = 0;

/** Log time as an epoch number. Rows without a readable stamp sort first. */
const logTime = (t: LoggedTrade): number => {
    const ms = Date.parse(t.timestamp ?? '');
    return Number.isFinite(ms) ? ms : UNPARSEABLE;
};

const isDecided = (t: LoggedTrade): boolean =>
    t.outcome === TradeOutcome.WIN || t.outcome === TradeOutcome.LOSS;

const mean = (nums: number[]): number | null =>
    nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;

const sum = (nums: number[]): number | null =>
    nums.length ? nums.reduce((a, b) => a + b, 0) : null;

const round = (n: number | null, places = 2): number | null =>
    n === null || !Number.isFinite(n) ? null : Math.round(n * 10 ** places) / 10 ** places;

const sameDay = (a: string, b: string): boolean => !!a && !!b && a.slice(0, 10) === b.slice(0, 10);

/**
 * The window the brief is built over: filtered, sorted by log time ASCENDING,
 * and cut to the most recent `limit` rows — so the caller reads them the way a
 * tape is read, oldest first.
 */
export const selectRecentTrades = (trades: LoggedTrade[], filter: TradeLogFilter = {}): LoggedTrade[] => {
    const coin = filter.coin?.trim().toUpperCase();
    const outcome = filter.outcome?.trim().toUpperCase();
    const strategy = filter.strategy?.trim().toLowerCase();
    const sinceMs = filter.since ? Date.parse(filter.since) : NaN;

    const kept = (trades ?? []).filter(t => {
        if (coin) {
            const symbol = (t.analysis?.coinName ?? '').toUpperCase();
            // "BTC" must match "BTCUSDT": compare on the base, not the whole string.
            if (symbol !== coin && !symbol.startsWith(coin)) return false;
        }
        if (outcome && (t.outcome ?? '').toUpperCase() !== outcome) return false;
        if (strategy) {
            const row = (t.analysis?.strategy ?? '').toLowerCase();
            const family = (t.analysis?.strategyFamily ?? '').toLowerCase();
            if (!row.includes(strategy) && family !== strategy) return false;
        }
        if (Number.isFinite(sinceMs) && logTime(t) < sinceMs) return false;
        return true;
    });

    const limit = filter.limit ?? RECENT_TRADES_WINDOW;
    if (!Number.isFinite(limit) || limit <= 0) return [];
    const sorted = [...kept].sort((a, b) => logTime(a) - logTime(b));
    return sorted.slice(Math.max(0, sorted.length - Math.floor(limit)));
};

const rowLine = (row: Omit<TradeLogRow, 'line'>): string => {
    const pnl = row.pnlDollars !== undefined
        ? ` · $${row.pnlDollars.toFixed(2)}`
        : row.pnlPercent !== undefined
            ? ` · ${row.pnlPercent >= 0 ? '+' : ''}${row.pnlPercent.toFixed(1)}%`
            : ' · pnl not captured';
    const r = typeof row.realizedR === 'number'
        ? ` · ${row.realizedR >= 0 ? '+' : ''}${row.realizedR.toFixed(2)}R`
        : '';
    const strategy = row.strategy ? ` · ${row.strategy}` : '';
    const tags = row.tags.length ? ` · [${row.tags.join(',')}]` : '';
    return `${row.loggedAt || '—'} ${row.symbol} ${row.direction} ${row.outcome}${pnl}${r}${strategy}${tags}`;
};

/** Header stats + one row per trade over the given (already-windowed) trades. */
export const buildRecentTradesBrief = (trades: LoggedTrade[]): RecentTradesBrief => {
    const ordered = [...(trades ?? [])].sort((a, b) => logTime(a) - logTime(b));
    const rows: TradeLogRow[] = ordered.map(t => {
        const tags = [
            ...(t.mistakeTags ?? []),
            ...(t.rootCauseClass ? [t.rootCauseClass] : []),
        ];
        const base: Omit<TradeLogRow, 'line'> = {
            id: t.id,
            loggedAt: t.timestamp,
            symbol: t.analysis?.coinName ?? '—',
            direction: t.analysis?.direction ?? '—',
            outcome: t.outcome ?? '—',
            ...(typeof t.pnlAmount === 'number' ? { pnlDollars: t.pnlAmount } : {}),
            ...(typeof t.pnlPercent === 'number' ? { pnlPercent: t.pnlPercent } : {}),
            ...(typeof t.realizedR === 'number' ? { realizedR: t.realizedR } : {}),
            ...(t.analysis?.strategy ? { strategy: t.analysis.strategy } : {}),
            tags,
        };
        return { ...base, line: rowLine(base) };
    });

    // computeJournalStats already owns win rate and streak arithmetic over a
    // decided subset — reuse it rather than publishing a second implementation.
    const stats = computeJournalStats(ordered);
    const dollarRows = ordered.filter(t => typeof t.pnlAmount === 'number');
    const percentRows = ordered.filter(t => typeof t.pnlPercent === 'number');
    const rRows = ordered.filter(t => typeof t.realizedR === 'number');

    return {
        rows,
        decided: stats.wins + stats.losses,
        wins: stats.wins,
        losses: stats.losses,
        unresolved: ordered.length - (stats.wins + stats.losses),
        winRate: stats.wins + stats.losses > 0 ? stats.winRate : null,
        avgRealizedR: round(mean(rRows.map(t => t.realizedR as number))),
        netPnLDollars: round(sum(dollarRows.map(t => t.pnlAmount as number))),
        netPnLPercent: round(sum(percentRows.map(t => t.pnlPercent as number)), 1),
        streak: stats.currentStreak,
        from: rows[0]?.loggedAt ?? null,
        to: rows[rows.length - 1]?.loggedAt ?? null,
    };
};

/**
 * The tape without the verdict: one line per trade, day-level time, outcome and
 * R — and NO win rate, no streak, no net PnL. An analyst seat is shown this so
 * it can check a claim about the record; it is not shown the framing, because
 * "you are three losses deep" is a nudge, and a nudge delivered by the system
 * into every opening prompt is not evidence, it is priming. The moderator and
 * the post-mortem, whose job IS to weigh the trader's recent form, get
 * `tallyLine` instead.
 */
export const neutralRowsText = (brief: RecentTradesBrief): string => {
    if (brief.rows.length === 0) return 'Logged trades: none.';
    const day = (iso: string): string => iso.slice(0, 10);
    return [
        `Logged trades, oldest first (${brief.rows.length}):`,
        ...brief.rows.map(r => {
            const r_ = typeof r.realizedR === 'number'
                ? ` ${r.realizedR >= 0 ? '+' : ''}${r.realizedR.toFixed(2)}R`
                : '';
            const pnl = typeof r.pnlDollars === 'number' ? ` $${r.pnlDollars.toFixed(2)}`
                : typeof r.pnlPercent === 'number' ? ` ${r.pnlPercent >= 0 ? '+' : ''}${r.pnlPercent.toFixed(1)}%`
                    : '';
            return `- ${day(r.loggedAt)} ${r.symbol} ${r.direction} ${r.outcome}${pnl}${r_}${r.tags.length ? ` [${r.tags.join(',')}]` : ''}`;
        }),
    ].join('\n');
};

/** Stable id for one rendered brief. The injection telemetry records it per run,
 *  and a trade row carries `sourceRunId`, so "which brief did this decision see"
 *  is answerable from the stored data rather than from what the code does today. */
export const briefFingerprint = (text: string): string => {
    let h = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    // 8 hex chars is enough to distinguish the two variants and any window shift,
    // and short enough to sit in an injection row without becoming a column.
    return (h >>> 0).toString(16).padStart(8, '0');
};

export const buildTradeLogBrief = (trades: LoggedTrade[], filter: TradeLogFilter = {}): RecentTradesBrief =>
    buildRecentTradesBrief(selectRecentTrades(trades, filter));

const money = (n: number): string => `${n >= 0 ? '+' : '-'}$${Math.abs(n).toFixed(2)}`;

/** The one tally line above the rows: what the window decided, not what it contains. */
export const tallyLine = (brief: RecentTradesBrief, title = `Last ${RECENT_TRADES_WINDOW} logged trades`): string => {
    if (brief.rows.length === 0) return `${title}: none logged.`;
    const parts = [
        `${title} (${sameDay(brief.from ?? '', brief.to ?? '') ? brief.to?.slice(0, 10) : `${brief.from?.slice(0, 10)} → ${brief.to?.slice(0, 10)}`})`,
        `${brief.wins}W/${brief.losses}L`,
        brief.winRate === null ? 'no settled trades' : `${brief.winRate.toFixed(1)}% win rate`,
        brief.avgRealizedR === null
            ? 'no price-measured R yet'
            : `avg realized R ${brief.avgRealizedR >= 0 ? '+' : ''}${brief.avgRealizedR.toFixed(2)}`,
        brief.netPnLDollars === null
            ? 'no dollar PnL captured'
            : `net ${money(brief.netPnLDollars)}`,
        brief.netPnLPercent === null
            ? null
            : `net ${brief.netPnLPercent >= 0 ? '+' : ''}${brief.netPnLPercent.toFixed(1)}% (leveraged)`,
        brief.streak === 0
            ? null
            : `streak ${Math.abs(brief.streak)}${brief.streak > 0 ? 'W' : 'L'}`,
        brief.unresolved > 0 ? `${brief.unresolved} open/skipped` : null,
    ].filter(Boolean);
    return `${parts.join(', ')}.`;
};

/** One paragraph: a tally line then one line per trade. Prompt-safe and flat. */
export const renderRecentTradesBrief = (brief: RecentTradesBrief, title?: string): string => {
    if (brief.rows.length === 0) return tallyLine(brief, title);
    return `${tallyLine(brief, title)}\n${brief.rows.map(r => r.line).join('\n')}`;
};
