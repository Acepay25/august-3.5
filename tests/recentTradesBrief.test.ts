/**
 * recentTradesBrief — the arithmetic the model and the Journal card both read.
 *
 * Pinned to VALUES, not "is it a number": a brief that reports a reversed
 * streak or a win rate over open trades is worse than no brief, because the
 * seat quotes it back with confidence.
 */

import { describe, it, expect } from 'vitest';
import { LoggedTrade, TradeOutcome } from '../types';
import {
    RECENT_TRADES_WINDOW,
    buildRecentTradesBrief,
    buildTradeLogBrief,
    renderRecentTradesBrief,
    selectRecentTrades,
} from '../utils/recentTradesBrief';

type Analysis = LoggedTrade['analysis'];

const analysis = (over: Partial<Analysis> = {}): Analysis => ({
    coinName: 'BTCUSDT',
    direction: 'Long',
    probability: 60,
    strategy: 'Trend continuation',
    stopLoss: '100',
    takeProfit: [],
    ...over,
} as Analysis);

/** `day` is the day-of-month so ISO stamps sort lexicographically too. */
const trade = (over: Partial<LoggedTrade> = {}): LoggedTrade => ({
    id: over.id ?? `t-${Math.random().toString(36).slice(2)}`,
    analysis: analysis(),
    outcome: TradeOutcome.WIN,
    timestamp: '2026-10-01T10:00:00.000Z',
    ...over,
} as LoggedTrade);

describe('selectRecentTrades', () => {
    it('sorts by log time, not array order, and keeps the NEWEST window', () => {
        const rows = [
            trade({ timestamp: '2026-10-05T10:00:00.000Z' }),
            trade({ timestamp: '2026-10-01T10:00:00.000Z' }),
            trade({ timestamp: '2026-10-04T10:00:00.000Z' }),
            trade({ timestamp: '2026-10-02T10:00:00.000Z' }),
        ];
        const picked = selectRecentTrades(rows, { limit: 2 });
        expect(picked.map(t => t.timestamp)).toEqual([
            '2026-10-04T10:00:00.000Z',
            '2026-10-05T10:00:00.000Z',
        ]);
    });

    it('defaults to the 20-row window', () => {
        const rows = Array.from({ length: 25 }, (_, i) =>
            trade({ timestamp: `2026-10-0${1 + Math.floor(i / 9)}T${String(i % 24).padStart(2, '0')}:00:00.000Z` }));
        expect(selectRecentTrades(rows)).toHaveLength(RECENT_TRADES_WINDOW);
    });

    it('matches a coin on its base symbol, not the whole string', () => {
        const rows = [
            trade({ analysis: analysis({ coinName: 'BTCUSDT' }) }),
            trade({ analysis: analysis({ coinName: 'ETHUSDT' }) }),
        ];
        expect(selectRecentTrades(rows, { coin: 'btc' })).toHaveLength(1);
        expect(selectRecentTrades(rows, { coin: 'ethusdt' })).toHaveLength(1);
        expect(selectRecentTrades(rows, { coin: 'SOL' })).toHaveLength(0);
    });

    it('filters by outcome, by strategy text or family, and by a since cutoff', () => {
        const rows = [
            trade({ outcome: TradeOutcome.WIN, timestamp: '2026-10-01T00:00:00.000Z', analysis: analysis({ strategy: 'Breakout retest', strategyFamily: 'breakout' as never }) }),
            trade({ outcome: TradeOutcome.LOSS, timestamp: '2026-10-03T00:00:00.000Z', analysis: analysis({ strategy: 'Range fade' }) }),
            trade({ outcome: TradeOutcome.LOSS, timestamp: '2026-10-09T00:00:00.000Z', analysis: analysis({ strategy: 'Breakout' }) }),
        ];
        expect(selectRecentTrades(rows, { outcome: 'loss' })).toHaveLength(2);
        expect(selectRecentTrades(rows, { strategy: 'breakout' })).toHaveLength(2);
        expect(selectRecentTrades(rows, { since: '2026-10-05T00:00:00.000Z' })).toHaveLength(1);
    });

    it('returns nothing for a non-positive limit rather than the whole journal', () => {
        expect(selectRecentTrades([trade()], { limit: 0 })).toEqual([]);
    });
});

describe('buildRecentTradesBrief header stats', () => {
    const four = [
        trade({ timestamp: '2026-10-01T00:00:00.000Z', outcome: TradeOutcome.WIN, realizedR: 1.5, pnlAmount: 100 }),
        trade({ timestamp: '2026-10-02T00:00:00.000Z', outcome: TradeOutcome.LOSS, realizedR: -1.0, pnlAmount: -50 }),
        trade({ timestamp: '2026-10-03T00:00:00.000Z', outcome: TradeOutcome.WIN, realizedR: 2.0, pnlAmount: 200 }),
        trade({ timestamp: '2026-10-04T00:00:00.000Z', outcome: TradeOutcome.WIN, realizedR: 0.5, pnlPercent: 25 }),
    ];

    it('counts wins/losses over DECIDED rows and pins the win rate', () => {
        const b = buildRecentTradesBrief(four);
        expect(b.decided).toBe(4);
        expect(b.wins).toBe(3);
        expect(b.losses).toBe(1);
        expect(b.winRate).toBe(75);
    });

    it('averages only the rows carrying realizedR', () => {
        // (1.5 - 1.0 + 2.0 + 0.5) / 4
        expect(buildRecentTradesBrief(four).avgRealizedR).toBe(0.75);
    });

    it('keeps dollar and percent PnL in separate totals', () => {
        const b = buildRecentTradesBrief(four);
        expect(b.netPnLDollars).toBe(250);
        expect(b.netPnLPercent).toBe(25);
    });

    it('reads the streak from the newest row backwards', () => {
        // Ascending log order here is W,L,W,W — so the live run is TWO wins,
        // not three: the brief sorts before it asks, and computeJournalStats
        // counts the trailing run of whatever order it is handed.
        expect(buildRecentTradesBrief(four).streak).toBe(2);
        const twoLossTail = [
            trade({ timestamp: '2026-10-01T00:00:00.000Z', outcome: TradeOutcome.WIN }),
            trade({ timestamp: '2026-10-02T00:00:00.000Z', outcome: TradeOutcome.WIN }),
            trade({ timestamp: '2026-10-03T00:00:00.000Z', outcome: TradeOutcome.LOSS }),
            trade({ timestamp: '2026-10-04T00:00:00.000Z', outcome: TradeOutcome.LOSS }),
        ];
        expect(buildRecentTradesBrief(twoLossTail).streak).toBe(-2);
    });

    it('excludes open and skipped rows from the win rate but counts them', () => {
        const b = buildRecentTradesBrief([
            trade({ timestamp: '2026-10-01T00:00:00.000Z', outcome: TradeOutcome.WIN }),
            trade({ timestamp: '2026-10-02T00:00:00.000Z', outcome: TradeOutcome.PENDING }),
            trade({ timestamp: '2026-10-03T00:00:00.000Z', outcome: TradeOutcome.SKIPPED }),
        ]);
        expect(b.decided).toBe(1);
        expect(b.winRate).toBe(100);
        expect(b.unresolved).toBe(2);
    });

    it('reports nulls instead of a fabricated zero when nothing is measured', () => {
        const b = buildRecentTradesBrief([trade({ outcome: TradeOutcome.PENDING })]);
        expect(b.winRate).toBeNull();
        expect(b.avgRealizedR).toBeNull();
        expect(b.netPnLDollars).toBeNull();
        expect(b.netPnLPercent).toBeNull();
    });

    it('carries the log time and the tags on each row', () => {
        const b = buildRecentTradesBrief([trade({
            timestamp: '2026-10-06T08:15:00.000Z',
            outcome: TradeOutcome.LOSS,
            mistakeTags: ['moved_stop'],
            rootCauseClass: 'execution' as never,
        })]);
        expect(b.rows[0].loggedAt).toBe('2026-10-06T08:15:00.000Z');
        expect(b.rows[0].tags).toEqual(['moved_stop', 'execution']);
        expect(b.from).toBe(b.rows[0].loggedAt);
        expect(b.to).toBe(b.rows[0].loggedAt);
    });
});

describe('renderRecentTradesBrief', () => {
    it('labels dollars with $ and percents with %, and says so when neither exists', () => {
        const b = buildRecentTradesBrief([
            trade({ timestamp: '2026-10-01T00:00:00.000Z', pnlAmount: 100 }),
            trade({ timestamp: '2026-10-02T00:00:00.000Z', pnlPercent: 200 }),
            trade({ timestamp: '2026-10-03T00:00:00.000Z' }),
        ]);
        expect(b.rows[0].line).toContain('· $100.00');
        expect(b.rows[1].line).toContain('· +200.0%');
        expect(b.rows[2].line).toContain('pnl not captured');
        expect(b.rows[2].line).not.toContain('$0.00');
    });

    it('prints one line per trade under a single tally line', () => {
        const text = renderRecentTradesBrief(buildRecentTradesBrief([
            trade({ timestamp: '2026-10-01T00:00:00.000Z', outcome: TradeOutcome.WIN, realizedR: 1.5, pnlAmount: 100 }),
            trade({ timestamp: '2026-10-02T00:00:00.000Z', outcome: TradeOutcome.LOSS, realizedR: -1, pnlAmount: -50 }),
        ]));
        const lines = text.split('\n');
        expect(lines).toHaveLength(3);
        expect(lines[0]).toContain('2026-10-01 → 2026-10-02');
        expect(lines[0]).toContain('1W/1L');
        expect(lines[0]).toContain('50.0% win rate');
        expect(lines[0]).toContain('avg realized R +0.25');
        expect(lines[0]).toContain('net +$50.00');
    });

    it('says "none logged" instead of an empty block', () => {
        expect(renderRecentTradesBrief(buildRecentTradesBrief([]), 'Last 20 logged trades'))
            .toBe('Last 20 logged trades: none logged.');
    });

    it('collapses the range when every row landed on the same day', () => {
        const text = renderRecentTradesBrief(buildRecentTradesBrief([
            trade({ timestamp: '2026-10-04T01:00:00.000Z' }),
            trade({ timestamp: '2026-10-04T09:00:00.000Z' }),
        ]));
        expect(text.split('\n')[0]).toContain('(2026-10-04)');
        expect(text).not.toContain('→');
    });
});

describe('buildTradeLogBrief', () => {
    it('filters then windows, so a coin-scoped ask reads that coin only', () => {
        const rows = [
            trade({ analysis: analysis({ coinName: 'BTCUSDT' }), timestamp: '2026-10-01T00:00:00.000Z' }),
            trade({ analysis: analysis({ coinName: 'ETHUSDT' }), timestamp: '2026-10-02T00:00:00.000Z' }),
            trade({ analysis: analysis({ coinName: 'BTCUSDT' }), timestamp: '2026-10-03T00:00:00.000Z' }),
        ];
        const b = buildTradeLogBrief(rows, { coin: 'BTC', limit: 5 });
        expect(b.rows).toHaveLength(2);
        expect(b.rows.map(r => r.symbol)).toEqual(['BTCUSDT', 'BTCUSDT']);
    });

    it('sorts a journal handed to it in any order', () => {
        const b = buildTradeLogBrief([
            trade({ timestamp: '2026-10-09T00:00:00.000Z' }),
            trade({ timestamp: '2026-10-02T00:00:00.000Z' }),
        ]);
        expect(b.from).toBe('2026-10-02T00:00:00.000Z');
        expect(b.to).toBe('2026-10-09T00:00:00.000Z');
    });
});
