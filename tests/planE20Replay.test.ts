/**
 * E-20 — the replay harness.
 *
 * Re-derives today's plan verdict from a stored row and reports drift against
 * what was recorded. It is read-only, provider-free, and deliberately counts
 * an UNSTAMPED row as unstamped rather than as a disagreement: absence of a
 * measurement is not a measurement.
 */

import { describe, it, expect } from 'vitest';
import type { LoggedTrade } from '../types';
import { replayTrades, replaySummaryLine, proposalFromTrade } from '../utils/planReplay';

const trade = (over: Partial<LoggedTrade> = {}, analysisOver: Record<string, unknown> = {}): LoggedTrade => ({
    id: over.id ?? 't1',
    outcome: 'WIN',
    timestamp: '2026-10-01T00:00:00.000Z',
    analysis: {
        coinName: 'BTCUSDT',
        direction: 'Long',
        confidence: 'High',
        probability: 72,
        grade: 'B',
        strategy: 'proposal',
        activeStrategies: [],
        entryPoints: [{ price: '100' }],
        stopLoss: '95',
        takeProfit: [{ price: '115' }],
        marketConditions: {},
        historicalCorrelation: '',
        rrRatio: 3,
        ...analysisOver,
    },
    ...over,
} as unknown as LoggedTrade);

const stamped = (): Record<string, unknown> => ({
    gate: { status: 'evaluated', confidenceCap: 0.5, reason: '50%', stampedAt: '2026-10-01T00:00:00.000Z' },
});

describe('proposalFromTrade', () => {
    it('rebuilds the levels and refuses a row with no usable plan', () => {
        expect(proposalFromTrade(trade())).toMatchObject({
            symbol: 'BTCUSDT', direction: 'Long', entry: 100, stopLoss: 95, takeProfits: [115],
        });
        expect(proposalFromTrade(trade({}, { direction: 'Neutral' }))).toBeNull();
        expect(proposalFromTrade(trade({}, { takeProfit: [] }))).toBeNull();
    });
});

describe('replayTrades', () => {
    it('reports a row whose recorded ratio and band no longer match', () => {
        const report = replayTrades([
            trade({ id: 'drift' }, { rrRatio: 2, confidence: 'High', probability: 72, ...stamped() }),
        ]);
        expect(report.compared).toBe(1);
        expect(report.drift).toHaveLength(1);
        expect(report.drift[0].fields).toEqual(['rr', 'confidence', 'probability']);
        expect(report.counts).toEqual({ rr: 1, confidence: 1, probability: 1 });
        expect(report.drift[0].replayed).toMatchObject({ rr: 3, confidence: 'Low', probability: 50 });
    });

    it('a row that agrees is not drift', () => {
        const report = replayTrades([
            trade({ id: 'same' }, { rrRatio: 3, confidence: 'Low', probability: 44, ...stamped() }),
        ]);
        expect(report.drift).toEqual([]);
        expect(report.compared).toBe(1);
    });

    it('an unstamped row is counted, not accused', () => {
        // No gate: the recorded probability predates today's builder, so only
        // ratio and confidence are compared.
        const report = replayTrades([
            trade({ id: 'legacy' }, { rrRatio: 3, confidence: 'High', probability: 61 }),
        ]);
        expect(report.unstamped).toBe(1);
        expect(report.drift).toEqual([]);
    });

    it('a row with no levels is skipped, and the summary says so', () => {
        const report = replayTrades([
            trade({ id: 'ok' }, { rrRatio: 3, confidence: 'Low', probability: 44, ...stamped() }),
            trade({ id: 'no-levels' }, { entryPoints: [] }),
        ]);
        expect(report.total).toBe(2);
        expect(report.compared).toBe(1);
        expect(report.skipped).toBe(1);
        expect(replaySummaryLine(report)).toMatch(/1\/2 compared · 0 drifted/);
        expect(replaySummaryLine(report)).toMatch(/1 skipped/);
    });
});
