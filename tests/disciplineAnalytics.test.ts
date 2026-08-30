import { describe, it, expect } from 'vitest';

// Discipline analytics (Batch 5 §4.4): adherence split, mistake cost,
// post-first-red split, giveback days, R-multiple computation.

import {
    buildDisciplineAnalytics,
    computeRMultiple,
} from '../utils/disciplineAnalytics';
import { LoggedTrade } from '../types/trade';
import { TradeOutcome } from '../types/enums';
import { TradeAnalysis } from '../types';

const DAY = Date.UTC(2026, 7, 29);

const trade = (overrides: Partial<LoggedTrade> & { outcome: TradeOutcome }): LoggedTrade => ({
    id: `t-${Math.random().toString(36).slice(2)}`,
    analysis: {} as TradeAnalysis,
    timestamp: new Date(DAY + 3 * 3_600_000).toISOString(),
    ...overrides,
});

describe('buildDisciplineAnalytics', () => {
    it('adherence split: rule-following beats rule-breaking on win rate', () => {
        const trades = [
            trade({ outcome: TradeOutcome.WIN, followedPlan: true, pnlAmount: 200, rMultiple: 2 }),
            trade({ outcome: TradeOutcome.WIN, followedPlan: true, pnlAmount: 150, rMultiple: 1.5 }),
            trade({ outcome: TradeOutcome.LOSS, followedPlan: false, pnlAmount: -100, rMultiple: -1 }),
            trade({ outcome: TradeOutcome.LOSS, followedPlan: false, pnlAmount: -250, rMultiple: -2.5 }),
        ];
        const a = buildDisciplineAnalytics(trades);
        expect(a.adherence.followed.n).toBe(2);
        expect(a.adherence.followed.winRate).toBeCloseTo(100);
        expect(a.adherence.followed.avgR).toBeCloseTo(1.75);
        expect(a.adherence.broken.n).toBe(2);
        expect(a.adherence.broken.winRate).toBeCloseTo(0);
        expect(a.adherence.broken.profitFactor).toBe(0);
        expect(a.adherence.followed.totalPnlUsd).toBe(350);
        expect(a.adherence.broken.totalPnlUsd).toBe(-350);
    });

    it('mistake-cost table sorts most expensive first, sums per tag', () => {
        const trades = [
            trade({ outcome: TradeOutcome.LOSS, pnlAmount: -300, mistakeTags: ['revenge'] }),
            trade({ outcome: TradeOutcome.LOSS, pnlAmount: -80, mistakeTags: ['revenge', 'late_exit'] }),
            trade({ outcome: TradeOutcome.WIN, pnlAmount: 60, mistakeTags: ['late_exit'] }),
        ];
        const a = buildDisciplineAnalytics(trades);
        expect(a.mistakeCost[0].tag).toBe('revenge');
        expect(a.mistakeCost[0].totalPnlUsd).toBeCloseTo(-380);
        expect(a.mistakeCost[0].n).toBe(2);
        expect(a.mistakeCost[1].tag).toBe('late_exit');
        expect(a.mistakeCost[1].totalPnlUsd).toBeCloseTo(-20); // -80 + 60
    });

    it('post-first-red split buckets within each UTC day', () => {
        const trades = [
            // Day 1: WIN then LOSS then (post-red) LOSS
            trade({ outcome: TradeOutcome.WIN, pnlAmount: 100, timestamp: new Date(DAY + 1 * 3_600_000).toISOString() }),
            trade({ outcome: TradeOutcome.LOSS, pnlAmount: -50, timestamp: new Date(DAY + 2 * 3_600_000).toISOString() }),
            trade({ outcome: TradeOutcome.LOSS, pnlAmount: -200, timestamp: new Date(DAY + 3 * 3_600_000).toISOString() }),
            // Day 2 (no red): counts as "before"
            trade({ outcome: TradeOutcome.WIN, pnlAmount: 90, timestamp: new Date(DAY + 24 * 3_600_000 + 1 * 3_600_000).toISOString() }),
        ];
        const a = buildDisciplineAnalytics(trades);
        expect(a.afterFirstRed.before.n).toBe(3); // d1 WIN, d1 LOSS (the red itself), d2 WIN
        expect(a.afterFirstRed.after.n).toBe(1);
        expect(a.afterFirstRed.after.winRate).toBeCloseTo(0);
        expect(a.afterFirstRed.after.totalPnlUsd).toBe(-200);
    });

    it('giveback counts green-peaked days that finished red', () => {
        const trades = [
            // Day 1: peaks +100, finishes -50 → giveback
            trade({ outcome: TradeOutcome.WIN, pnlAmount: 100, timestamp: new Date(DAY + 1 * 3_600_000).toISOString() }),
            trade({ outcome: TradeOutcome.LOSS, pnlAmount: -150, timestamp: new Date(DAY + 2 * 3_600_000).toISOString() }),
            // Day 2: never green → not a giveback
            trade({ outcome: TradeOutcome.LOSS, pnlAmount: -70, timestamp: new Date(DAY + 26 * 3_600_000).toISOString() }),
        ];
        const a = buildDisciplineAnalytics(trades);
        expect(a.giveback.days).toBe(1);
        expect(a.giveback.dayPnls[0]).toBeCloseTo(-50);
    });

    it('pnlPercent-only rows convert through the risk base and count everywhere', () => {
        const trades = [
            trade({ outcome: TradeOutcome.LOSS, followedPlan: false, pnlPercent: -200 }), // -$200
        ];
        const a = buildDisciplineAnalytics(trades);
        expect(a.adherence.broken.totalPnlUsd).toBeCloseTo(-200);
    });
});

describe('computeRMultiple', () => {
    it('pnlPercent ÷ stop-move percent (leveraged percents)', () => {
        // Entry 100k, SL 95k → 5% stop move; +200% leveraged → 40R
        expect(computeRMultiple('100000', '95000', 200)).toBeCloseTo(40);
        expect(computeRMultiple('100000', '95000', -100)).toBeCloseTo(-20);
    });

    it('missing entry, SL, or pnl → undefined (never fabricated 0R)', () => {
        expect(computeRMultiple(undefined, '95000', 200)).toBeUndefined();
        expect(computeRMultiple('100000', undefined, 200)).toBeUndefined();
        expect(computeRMultiple('100000', '95000', undefined)).toBeUndefined();
    });
});
