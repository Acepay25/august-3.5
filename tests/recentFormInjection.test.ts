/**
 * Recent form in the injected memory — the one line, in every stage, that says
 * what the last 20 trades did.
 *
 * Two failures this pins, both of which the repo has already been bitten by:
 * a block that spends the stage budget on rows a seat can pull itself, and a
 * replayed run reading trades that had not been logged yet at its own cutoff.
 */

import { describe, it, expect, vi } from 'vitest';
import { TradeOutcome, type LoggedTrade } from '../types';
import { listRetrievedMemorySources, recentFormBlock } from '../services/learning/MemoryRetrievalService';

vi.mock('../services/learning/MemoryFilesService', () => ({
    getMemoryFiles: () => ({ files: [], folders: [] }),
    searchNotebookNotes: () => [],
}));

const trade = (over: Partial<LoggedTrade> = {}): LoggedTrade => ({
    id: over.id ?? `t-${Math.random().toString(36).slice(2)}`,
    analysis: { coinName: 'BTCUSDT', direction: 'Long', probability: 60, strategy: 'Breakout', stopLoss: '', takeProfit: [] } as unknown as LoggedTrade['analysis'],
    outcome: TradeOutcome.WIN,
    timestamp: '2026-10-01T10:00:00.000Z',
    ...over,
} as LoggedTrade);

describe('recentFormBlock', () => {
    it('is empty when there is no journal, not a zero-filled lie', () => {
        expect(recentFormBlock([])).toBe('');
        expect(recentFormBlock(undefined)).toBe('');
    });

    it('carries the tally and no rows — the rows are one tool call away', () => {
        const many = Array.from({ length: 30 }, (_, i) => trade({
            timestamp: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString(),
            outcome: i % 2 === 0 ? TradeOutcome.WIN : TradeOutcome.LOSS,
        }));
        const block = recentFormBlock(many);
        expect(block).toContain('**Recent form**');
        expect(block).toContain('10W/10L');
        expect(block).toContain('50.0% win rate');
        // One header line plus the label: not 20 rows pasted into every prompt.
        expect(block.split('\n')).toHaveLength(2);
        expect(block).not.toContain('2026-10-01T00:00:00.000Z BTCUSDT');
        expect(block.length).toBeLessThan(220);
    });

    it('honours the point-in-time cutoff a replayed run is assembled under', () => {
        const rows = [
            trade({ timestamp: '2026-09-01T00:00:00.000Z', outcome: TradeOutcome.WIN }),
            trade({ timestamp: '2026-10-01T00:00:00.000Z', outcome: TradeOutcome.LOSS }),
        ];
        const cutoff = Date.parse('2026-09-15T00:00:00.000Z');
        const seen = recentFormBlock(rows, cutoff);
        expect(seen).toContain('1W/0L');
        expect(seen).not.toContain('0W/1L');
        expect(recentFormBlock(rows)).toContain('1W/1L');
    });

    it('is listed as a retrieved source when it is injected', () => {
        const sources = listRetrievedMemorySources(undefined, [trade()], 'analyst');
        expect(sources.some(s => s.path === 'journal/recent-form' && s.kind === 'similar')).toBe(true);
        expect(listRetrievedMemorySources(undefined, [], 'analyst')
            .some(s => s.path === 'journal/recent-form')).toBe(false);
    });
});
