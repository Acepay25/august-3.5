/**
 * Recent form in the injected memory — and the shape each audience is allowed.
 *
 * Three failures this pins: an analyst being handed streak/win-rate framing
 * (priming), a replayed run reading trades logged after its own cutoff, and a
 * brief that cannot be traced back from the decision it informed.
 */

import { describe, it, expect, vi } from 'vitest';
import { TradeOutcome, type LoggedTrade } from '../types';
import { listRetrievedMemorySources, recentFormBlock } from '../services/learning/MemoryRetrievalService';
import { briefFingerprint, buildRecentTradesBrief, neutralRowsText, selectRecentTrades } from '../utils/recentTradesBrief';

vi.mock('../services/learning/MemoryFilesService', () => ({
    getMemoryFiles: () => ({ files: [], folders: [] }),
    searchNotebookNotes: () => [],
}));

const trade = (over: Partial<LoggedTrade> = {}): LoggedTrade => ({
    id: over.id ?? `t-${Math.random().toString(36).slice(2)}`,
    analysis: {
        coinName: 'BTCUSDT', direction: 'Long', probability: 60,
        strategy: 'Breakout', stopLoss: '', takeProfit: [],
    } as unknown as LoggedTrade['analysis'],
    outcome: TradeOutcome.WIN,
    timestamp: '2026-10-01T10:00:00.000Z',
    ...over,
} as LoggedTrade);

const ten = Array.from({ length: 12 }, (_, i) => trade({
    timestamp: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString(),
    outcome: i % 3 === 0 ? TradeOutcome.LOSS : TradeOutcome.WIN,
    realizedR: i % 3 === 0 ? -1 : 1.5,
    pnlPercent: i % 3 === 0 ? -100 : 200,
}));

describe('recentFormBlock — analyst seats get the tape, not the verdict', () => {
    it('says nothing about streak, win rate or net PnL to an analyst', () => {
        const block = recentFormBlock(ten, undefined, 'analyst');
        expect(block).toContain('**Your logged trades**');
        expect(block).not.toMatch(/streak/i);
        expect(block).not.toMatch(/win rate/i);
        expect(block).not.toMatch(/net /i);
        // …but it is still the record, row by row.
        expect(block.split('\n').length).toBeGreaterThan(4);
        expect(block).toContain('BTCUSDT Long WIN');
    });

    it('gives the moderator the framing an analyst is denied', () => {
        const block = recentFormBlock(ten, undefined, 'moderator');
        expect(block).toContain('**Recent form**');
        expect(block).toMatch(/win rate/i);
        expect(block).toMatch(/streak/i);
    });

    it('is empty when there is no journal, not a zero-filled lie', () => {
        expect(recentFormBlock([])).toBe('');
        expect(recentFormBlock(undefined, undefined, 'moderator')).toBe('');
    });

    it('honours the point-in-time cutoff a replayed run is assembled under', () => {
        const rows = [
            trade({ timestamp: '2026-09-01T00:00:00.000Z', outcome: TradeOutcome.WIN }),
            trade({ timestamp: '2026-10-01T00:00:00.000Z', outcome: TradeOutcome.LOSS }),
        ];
        const analyst = recentFormBlock(rows, Date.parse('2026-09-15T00:00:00.000Z'), 'analyst');
        expect(analyst).toContain('WIN');
        expect(analyst).not.toContain('LOSS');
        const tally = recentFormBlock(rows, Date.parse('2026-09-15T00:00:00.000Z'), 'moderator');
        expect(tally).toContain('1W/0L');
    });

    it('is listed as a retrieved source, per audience', () => {
        expect(listRetrievedMemorySources(undefined, [trade()], 'analyst')
            .some(s => s.path === 'journal/recent-form')).toBe(true);
        expect(listRetrievedMemorySources(undefined, [], 'moderator')
            .some(s => s.path === 'journal/recent-form')).toBe(false);
    });

    it('fits the stage budget an analyst pays for it in', () => {
        // 20 rows at day granularity is the whole promise; if this grows back
        // toward the full ISO line it is competing with skills for bytes again.
        const wide = Array.from({ length: 40 }, (_, i) => trade({
            timestamp: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString(),
        }));
        const block = recentFormBlock(wide, undefined, 'analyst');
        // label line + window line + 20 rows, and nothing beyond the window.
        expect(block.split('\n')).toHaveLength(22);
        expect(block.length).toBeLessThan(1400);
    });
});

describe('briefFingerprint', () => {
    it('identifies the exact brief a run saw, and differs by audience', () => {
        const analyst = recentFormBlock(ten, undefined, 'analyst');
        const moderator = recentFormBlock(ten, undefined, 'moderator');
        expect(briefFingerprint(analyst)).toBe(briefFingerprint(analyst));
        expect(briefFingerprint(analyst)).not.toBe(briefFingerprint(moderator));
        expect(briefFingerprint(analyst)).toMatch(/^[0-9a-f]{8}$/);
    });

    it('changes when the window changes, so a stale corpus cannot claim it', () => {
        const a = neutralRowsText(buildRecentTradesBrief(selectRecentTrades(ten, { limit: 5 })));
        const b = neutralRowsText(buildRecentTradesBrief(selectRecentTrades(ten, { limit: 10 })));
        expect(briefFingerprint(a)).not.toBe(briefFingerprint(b));
    });
});
