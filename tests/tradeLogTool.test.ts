/**
 * get_trade_log — the seat's view of the journal as ROWS.
 *
 * The behavior that matters is that a seat reading its own history gets the
 * whole window it asked for, in log order, with each row's PnL in the unit it
 * was actually captured in. A clipped array or a silently-mixed unit is the
 * failure mode this suite exists to catch.
 */

import { describe, it, expect } from 'vitest';
import { executeDeskTool, ARBITER_ALLOWED_TOOLS } from '../services/analysis/DeskToolsService';
import { TradeOutcome, type LoggedTrade } from '../types';

type Analysis = LoggedTrade['analysis'];

const analysis = (over: Partial<Analysis> = {}): Analysis => ({
    coinName: 'BTCUSDT',
    direction: 'Long',
    probability: 60,
    strategy: 'Breakout retest',
    stopLoss: '100',
    takeProfit: [],
    ...over,
} as Analysis);

const trade = (over: Partial<LoggedTrade> = {}): LoggedTrade => ({
    id: over.id ?? `t-${Math.random().toString(36).slice(2)}`,
    analysis: analysis(),
    outcome: TradeOutcome.WIN,
    timestamp: '2026-10-01T10:00:00.000Z',
    ...over,
} as LoggedTrade);

const journal: LoggedTrade[] = [
    trade({ timestamp: '2026-10-05T09:00:00.000Z', outcome: TradeOutcome.LOSS, pnlAmount: -50, realizedR: -1 }),
    trade({ timestamp: '2026-10-01T09:00:00.000Z', outcome: TradeOutcome.WIN, pnlAmount: 100, realizedR: 2 }),
    trade({ timestamp: '2026-10-03T09:00:00.000Z', outcome: TradeOutcome.WIN, pnlPercent: 200, analysis: analysis({ coinName: 'SOLUSDT' }) }),
    trade({ timestamp: '2026-10-04T09:00:00.000Z', outcome: TradeOutcome.SKIPPED, analysis: analysis({ strategy: 'Range fade' }) }),
];

const call = (arguments_: Record<string, unknown> = {}) => executeDeskTool(
    { id: 'c1', name: 'get_trade_log', arguments: arguments_ },
    { trades: journal, allowedTools: ['get_trade_log'] },
);

describe('get_trade_log', () => {
    it('answers with the rows oldest-first and the ISO time each was logged', async () => {
        const res = await call();
        expect(res.ok).toBe(true);
        const parsed = JSON.parse(res.content) as { returned: number; rows: string[]; tally: string };
        expect(parsed.returned).toBe(4);
        expect(parsed.rows.map(r => r.slice(0, 24))).toEqual([
            '2026-10-01T09:00:00.000Z',
            '2026-10-03T09:00:00.000Z',
            '2026-10-04T09:00:00.000Z',
            '2026-10-05T09:00:00.000Z',
        ]);
        expect(parsed.tally).toContain('2W/1L');
        expect(parsed.tally).toContain('1 open/skipped');
    });

    it('keeps dollar and percent PnL in the units they were captured in', async () => {
        const parsed = JSON.parse((await call()).content) as { rows: string[] };
        expect(parsed.rows[0]).toContain('$100.00');
        expect(parsed.rows[1]).toContain('+200.0%');
        expect(parsed.rows[2]).toContain('pnl not captured');
        expect(parsed.rows[0]).not.toContain('200.0%');
    });

    it('filters by coin on the base symbol, by outcome, by strategy and by since', async () => {
        expect((JSON.parse((await call({ coin: 'sol' })).content) as { returned: number }).returned).toBe(1);
        expect((JSON.parse((await call({ outcome: 'WIN' })).content) as { returned: number }).returned).toBe(2);
        expect((JSON.parse((await call({ strategy: 'range fade' })).content) as { returned: number }).returned).toBe(1);
        expect((JSON.parse((await call({ since: '2026-10-04T00:00:00.000Z' })).content) as { returned: number }).returned).toBe(2);
    });

    it('limits to the MOST RECENT rows, not the first ones it found', async () => {
        const parsed = JSON.parse((await call({ limit: 2 })).content) as { rows: string[] };
        expect(parsed.rows).toHaveLength(2);
        expect(parsed.rows[0].startsWith('2026-10-04')).toBe(true);
        expect(parsed.rows[1].startsWith('2026-10-05')).toBe(true);
    });

    it('says "no match" instead of implying the journal is empty', async () => {
        const parsed = JSON.parse((await call({ coin: 'DOGE' })).content) as { returned: number; note?: string };
        expect(parsed.returned).toBe(0);
        expect(parsed.note).toContain('not evidence of inactivity');
    });

    it('carries a full 20-row window inside its own byte budget, still parseable', async () => {
        const wide = Array.from({ length: 25 }, (_, i) => trade({
            timestamp: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString(),
            outcome: i % 3 === 0 ? TradeOutcome.LOSS : TradeOutcome.WIN,
            pnlPercent: (i % 2 === 0 ? 1 : -1) * (100 + i),
            realizedR: (i % 2 === 0 ? 1 : -1) * (i / 10),
            mistakeTags: i % 4 === 0 ? ['moved_stop'] : undefined,
            analysis: analysis({ coinName: `COIN${i}USDT`, strategy: 'Breakout retest with a long descriptive name' }),
        }));
        const res = await executeDeskTool(
            { id: 'c2', name: 'get_trade_log', arguments: {} },
            { trades: wide, allowedTools: ['get_trade_log'] },
        );
        const parsed = JSON.parse(res.content) as { returned: number; rows: string[] };
        // The claim under test: twenty rows arrive whole. A budget that silently
        // shed rows would fail here while still parsing.
        expect(parsed.returned).toBe(20);
        expect(parsed.rows).toHaveLength(20);
        expect(res.content.length).toBeLessThanOrEqual(4000);
    });

    it('is offered to the arbiter seat, which is the one that judges the record', () => {
        expect([...ARBITER_ALLOWED_TOOLS]).toContain('get_trade_log');
    });

    it('is not cached, because a trade can be logged during the turn that reads the log', async () => {
        const first = await call();
        const extra = [...journal, trade({ timestamp: '2026-10-06T09:00:00.000Z' })];
        const second = await executeDeskTool(
            { id: 'c3', name: 'get_trade_log', arguments: {} },
            { trades: extra, allowedTools: ['get_trade_log'] },
        );
        expect(JSON.parse(second.content)).not.toEqual(JSON.parse(first.content));
    });

    it('rejects the call for a seat whose desk does not carry it', async () => {
        const res = await executeDeskTool(
            { id: 'c4', name: 'get_trade_log', arguments: {} },
            { trades: journal, allowedTools: ['recall'] },
        );
        expect(res.ok).toBe(false);
    });
});
