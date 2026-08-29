import { describe, it, expect } from 'vitest';

// SessionGuardService (Batch 2): deterministic session-state guardrails.
// All time is injected — the UTC boundary and cooldown windows are pinned.

import {
    DEFAULT_SESSION_GUARD,
    FTMO_SESSION_GUARD,
    assessSession,
    formatGuardContextBlock,
    nextUtcMidnight,
    utcDayStart,
} from '../services/validation/SessionGuardService';
import { LoggedTrade } from '../types/trade';
import { TradeOutcome } from '../types/enums';

const NOW = new Date('2026-08-29T14:30:00Z'); // 14:30 UTC on a known day
const DAY_START = Date.UTC(2026, 7, 29);     // 2026-08-29T00:00:00Z
const iso = (ms: number): string => new Date(ms).toISOString();

const trade = (overrides: Partial<LoggedTrade> = {}): LoggedTrade => ({
    id: `t-${Math.random().toString(36).slice(2)}`,
    analysis: {} as LoggedTrade['analysis'],
    outcome: TradeOutcome.WIN,
    timestamp: iso(DAY_START + 3 * 3_600_000), // 03:00 UTC today
    ...overrides,
});

describe('utcDayStart / nextUtcMidnight', () => {
    it('UTC midnight of the containing day', () => {
        expect(utcDayStart(NOW).getTime()).toBe(DAY_START);
    });

    it('a trade logged at 23:59 UTC still belongs to today', () => {
        const late = new Date('2026-08-29T23:59:59Z');
        expect(utcDayStart(late).getTime()).toBe(DAY_START);
    });

    it('a trade at 00:01 UTC belongs to the new day', () => {
        const early = new Date('2026-08-30T00:01:00Z');
        expect(utcDayStart(early).getTime()).toBe(DAY_START + 86_400_000);
    });

    it('nextUtcMidnight is +24h from day start', () => {
        expect(nextUtcMidnight(NOW).getTime()).toBe(DAY_START + 86_400_000);
    });
});

describe('assessSession — clean states', () => {
    it('an empty journal is clear with no warnings', () => {
        const v = assessSession([], 10_000, DEFAULT_SESSION_GUARD, NOW);
        expect(v.level).toBe('clear');
        expect(v.warnings).toEqual([]);
        expect(v.tradesToday).toBe(0);
        expect(v.lossStreak).toBe(0);
    });

    it("yesterday's trades do not count today (UTC boundary)", () => {
        const yesterday = [
            trade({ outcome: TradeOutcome.LOSS, pnlAmount: -800, timestamp: iso(DAY_START - 3_600_000) }),
            trade({ outcome: TradeOutcome.LOSS, pnlAmount: -800, timestamp: iso(DAY_START - 2 * 3_600_000) }),
        ];
        const v = assessSession(yesterday, 10_000, DEFAULT_SESSION_GUARD, NOW);
        expect(v.tradesToday).toBe(0);
        expect(v.dayPnlUsd).toBe(0);
        // The streak is time-independent though — yesterday's losses still
        // count toward the CURRENT loss streak.
        expect(v.lossStreak).toBe(2);
    });

    it('a green day never trips the loss breaker', () => {
        const green = [trade({ outcome: TradeOutcome.WIN, pnlAmount: +400 })];
        const v = assessSession(green, 10_000, DEFAULT_SESSION_GUARD, NOW);
        expect(v.dayPnlUsd).toBe(400);
        expect(v.lossBudgetUsed).toBe(0);
        expect(v.dailyLossHit).toBe(false);
        // The level is notice — but from the 1/2-trades line, never the breaker.
        expect(v.level).toBe('notice');
        expect(v.warnings.join(' ')).not.toContain('loss budget');
    });
});

describe('assessSession — day P&L breaker tiers', () => {
    const eq = 10_000;
    // 2% daily limit → $200 budget. warn 50% ($100 lost), hard 80% ($160), standdown 100% ($200).

    it('50% of the loss budget → notice', () => {
        const v = assessSession([trade({ outcome: TradeOutcome.LOSS, pnlAmount: -100 })], eq, DEFAULT_SESSION_GUARD, NOW);
        expect(v.lossBudgetUsed).toBeCloseTo(0.5);
        expect(v.level).toBe('notice');
        expect(v.warnings.join(' ')).toContain('50%');
    });

    it('80% of the loss budget → warning + interstitial-tier line', () => {
        const v = assessSession([trade({ outcome: TradeOutcome.LOSS, pnlAmount: -160 })], eq, DEFAULT_SESSION_GUARD, NOW);
        expect(v.level).toBe('warning');
        expect(v.warnings.join(' ')).toContain('one more loss');
    });

    it('100% of the loss budget → stand-down', () => {
        const v = assessSession([trade({ outcome: TradeOutcome.LOSS, pnlAmount: -200 })], eq, DEFAULT_SESSION_GUARD, NOW);
        expect(v.dailyLossHit).toBe(true);
        expect(v.level).toBe('standdown');
        expect(v.warnings.join(' ')).toContain('stand down');
    });

    it('pnlPercent rows count when pnlAmount is missing (autopilot rows)', () => {
        // pnlPercent is a LEVERAGED percent (types/trade.ts: "+200 = +200%"),
        // converted through the 1%-of-equity risk base — so -200 on $10k is
        // the full $200 loss budget.
        const v = assessSession([trade({ outcome: TradeOutcome.LOSS, pnlAmount: undefined, pnlPercent: -200 })], eq, DEFAULT_SESSION_GUARD, NOW);
        expect(v.dayPnlUsd).toBeCloseTo(-200);
        expect(v.dailyLossHit).toBe(true);
        expect(v.level).toBe('standdown');
    });
});

describe('assessSession — trade cap', () => {
    it('the default cap is 2 trades/day (FTMO preset is 3)', () => {
        expect(DEFAULT_SESSION_GUARD.maxTradesPerDay).toBe(2);
        expect(FTMO_SESSION_GUARD.maxTradesPerDay).toBe(3);
        expect(FTMO_SESSION_GUARD.dailyLossLimitPct).toBe(0.03);
    });

    it('skipped and entry-not-hit rows do NOT consume the cap', () => {
        const rows = [
            trade({ outcome: TradeOutcome.SKIPPED }),
            trade({ outcome: TradeOutcome.ENTRY_NOT_HIT }),
        ];
        const v = assessSession(rows, 10_000, DEFAULT_SESSION_GUARD, NOW);
        expect(v.tradesToday).toBe(0);
    });

    it('one trade under the cap → notice; reaching the cap → stand-down', () => {
        const one = assessSession([trade({})], 10_000, DEFAULT_SESSION_GUARD, NOW);
        expect(one.level).toBe('notice');
        expect(one.warnings.join(' ')).toContain('1/2 trades');

        const two = assessSession([trade({}), trade({})], 10_000, DEFAULT_SESSION_GUARD, NOW);
        expect(two.tradeCapHit).toBe(true);
        expect(two.level).toBe('standdown');
    });

    it('the looser FTMO preset allows a third trade', () => {
        const rows = [trade({}), trade({})];
        const v = assessSession(rows, 10_000, FTMO_SESSION_GUARD, NOW);
        expect(v.tradeCapHit).toBe(false);
    });
});

describe('assessSession — loss streak + cooldown', () => {
    it('two consecutive losses trip the streak pause', () => {
        // Yesterday's rows: the streak is time-independent, and keeping them
        // out of today avoids the 2-trade cap masking the streak level.
        const rows = [
            trade({ outcome: TradeOutcome.WIN, pnlAmount: 50, timestamp: iso(DAY_START - 3 * 3_600_000) }),
            trade({ outcome: TradeOutcome.LOSS, pnlAmount: -50, timestamp: iso(DAY_START - 2 * 3_600_000) }),
            trade({ outcome: TradeOutcome.LOSS, pnlAmount: -50, timestamp: iso(DAY_START - 1 * 3_600_000) }),
        ];
        const v = assessSession(rows, 10_000, DEFAULT_SESSION_GUARD, NOW);
        expect(v.lossStreak).toBe(2);
        expect(v.streakPauseActive).toBe(true);
        expect(v.level).toBe('warning');
    });

    it('a win resets the streak', () => {
        const rows = [
            trade({ outcome: TradeOutcome.LOSS, timestamp: iso(DAY_START + 3_600_000) }),
            trade({ outcome: TradeOutcome.LOSS, timestamp: iso(DAY_START + 2 * 3_600_000) }),
            trade({ outcome: TradeOutcome.WIN, timestamp: iso(DAY_START + 3 * 3_600_000) }),
        ];
        const v = assessSession(rows, 10_000, DEFAULT_SESSION_GUARD, NOW);
        expect(v.lossStreak).toBe(0);
        expect(v.streakPauseActive).toBe(false);
    });

    it('a loss 1h ago → 4h cooldown active with ~180m left', () => {
        const rows = [trade({
            outcome: TradeOutcome.LOSS,
            timestamp: iso(NOW.getTime() - 3_600_000), // 13:30 UTC
        })];
        const v = assessSession(rows, 10_000, DEFAULT_SESSION_GUARD, NOW);
        expect(v.cooldownActiveUntil).toBeDefined();
        const left = Date.parse(v.cooldownActiveUntil!) - NOW.getTime();
        expect(left).toBeCloseTo(3 * 3_600_000, -3);
        expect(v.warnings.join(' ')).toContain('cooldown');
    });

    it('a loss 5h ago → cooldown has elapsed', () => {
        const rows = [trade({
            outcome: TradeOutcome.LOSS,
            timestamp: iso(NOW.getTime() - 5 * 3_600_000),
        })];
        const v = assessSession(rows, 10_000, DEFAULT_SESSION_GUARD, NOW);
        expect(v.cooldownActiveUntil).toBeUndefined();
    });

    it('a recent WIN does not start a cooldown', () => {
        const rows = [trade({
            outcome: TradeOutcome.WIN,
            timestamp: iso(NOW.getTime() - 3_600_000),
        })];
        const v = assessSession(rows, 10_000, DEFAULT_SESSION_GUARD, NOW);
        expect(v.cooldownActiveUntil).toBeUndefined();
    });
});

describe('formatGuardContextBlock (debate injection)', () => {
    it('a clear quiet day injects nothing (no prompt bloat)', () => {
        expect(formatGuardContextBlock(assessSession([], 10_000, DEFAULT_SESSION_GUARD, NOW))).toBe('');
    });

    it('an active guard produces a labeled block with the numbers', () => {
        const rows = [
            trade({ outcome: TradeOutcome.LOSS, pnlAmount: -150 }),
            trade({ outcome: TradeOutcome.LOSS, pnlAmount: -50, timestamp: iso(DAY_START + 4 * 3_600_000) }),
        ];
        const block = formatGuardContextBlock(assessSession(rows, 10_000, DEFAULT_SESSION_GUARD, NOW));
        expect(block).toContain('TRADER SESSION STATE');
        expect(block).toContain('Trades today: 2');
        expect(block).toContain('loss streak');
        expect(block).toContain('stand down');
    });
});
