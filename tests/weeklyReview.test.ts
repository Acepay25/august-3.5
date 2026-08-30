import { describe, it, expect, vi, beforeEach } from 'vitest';

// Weekly review (Batch 5 §4.5): deterministic week-stats + one-impulse digest.

const sendMock = vi.fn();
vi.mock('../services/providers/GenericProviderService', () => ({
    sendChatRequest: (...args: any[]) => sendMock(...args),
}));

import {
    buildWeekStats,
    buildWeeklyImpulsePrompt,
    runWeeklyReview,
    isWeeklyReviewDue,
    loadWeeklyReview,
    WeeklyReviewDigest,
} from '../services/learning/weeklyReview';
import { LoggedTrade } from '../types/trade';
import { TradeOutcome } from '../types/enums';
import { TradeAnalysis } from '../types';
import type { ProviderConfig } from '../types/provider';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 7, 30, 12);

const trade = (over: Partial<LoggedTrade> & { outcome: TradeOutcome }): LoggedTrade => ({
    id: `t-${Math.random().toString(36).slice(2)}`,
    analysis: {} as TradeAnalysis,
    timestamp: new Date(NOW - DAY).toISOString(),
    ...over,
});

const provider = (): ProviderConfig => ({
    id: 'p1', name: 'P1', apiKey: 'k', baseUrl: 'https://x.test',
    apiFormat: 'chat_completions', isEnabled: true, isBuiltIn: false,
    models: ['m'], selectedModel: 'm',
});

describe('buildWeekStats', () => {
    it('counts only closed trades inside the 7-day window', () => {
        const stats = buildWeekStats([
            trade({ outcome: TradeOutcome.WIN, pnlAmount: 100 }),
            trade({ outcome: TradeOutcome.LOSS, pnlAmount: -50 }),
            trade({ outcome: TradeOutcome.SKIPPED }),
            trade({ outcome: TradeOutcome.WIN, pnlAmount: 999, timestamp: new Date(NOW - 10 * DAY).toISOString() }),
        ], NOW);
        expect(stats.closed).toBe(2);
        expect(stats.wins).toBe(1);
        expect(stats.losses).toBe(1);
        expect(stats.netPnlUsd).toBe(50);
    });
    it('adherence percent + top mistake come from the discipline analytics', () => {
        const stats = buildWeekStats([
            trade({ outcome: TradeOutcome.LOSS, pnlAmount: -80, followedPlan: false, mistakeTags: ['revenge'], rMultiple: -1 }),
            trade({ outcome: TradeOutcome.WIN, pnlAmount: 100, followedPlan: true, rMultiple: 2 }),
            trade({ outcome: TradeOutcome.LOSS, pnlAmount: -30, followedPlan: false, mistakeTags: ['greed'], rMultiple: -0.5 }),
        ], NOW);
        expect(stats.adherenceFollowedPct).toBe(33);
        expect(stats.topMistake).toBe('revenge');
        expect(stats.avgR).toBeCloseTo(0.1667, 3);
    });
    it('null adherence when nothing is tagged', () => {
        const stats = buildWeekStats([
            trade({ outcome: TradeOutcome.WIN, pnlAmount: 10 }),
            trade({ outcome: TradeOutcome.WIN, pnlAmount: 10 }),
        ], NOW);
        expect(stats.adherenceFollowedPct).toBeNull();
        expect(stats.topMistake).toBeNull();
    });
});

describe('buildWeeklyImpulsePrompt', () => {
    it('cites the computed numbers and demands ONE impulse', () => {
        const p = buildWeeklyImpulsePrompt({
            closed: 5, wins: 2, losses: 3, netPnlUsd: -120, avgR: -0.4,
            adherenceFollowedPct: 40, topMistake: 'revenge', givebackDays: 1,
        });
        expect(p).toContain('5 (2W/3L)');
        expect(p).toContain('-120');
        expect(p).toContain('40% followed');
        expect(p).toContain('revenge');
        expect(p).toContain('EXACTLY ONE improvement impulse');
        expect(p).toContain('never "urgent", "easy", "guaranteed"');
    });
});

describe('runWeeklyReview', () => {
    beforeEach(() => { localStorage.clear(); sendMock.mockReset(); });

    const closedTrades = [
        trade({ outcome: TradeOutcome.LOSS, pnlAmount: -80, followedPlan: false, mistakeTags: ['revenge'] }),
        trade({ outcome: TradeOutcome.WIN, pnlAmount: 100, followedPlan: true }),
        trade({ outcome: TradeOutcome.LOSS, pnlAmount: -30, followedPlan: false, mistakeTags: ['greed'] }),
    ];

    it('gates on >=3 closed trades', async () => {
        const r = await runWeeklyReview('u1', [trade({ outcome: TradeOutcome.WIN, pnlAmount: 5 })], [provider()], NOW);
        expect(r).toBeNull();
        expect(sendMock).not.toHaveBeenCalled();
    });
    it('gates on a ready provider', async () => {
        const dead = { ...provider(), isEnabled: false };
        const r = await runWeeklyReview('u1', closedTrades, [dead], NOW);
        expect(r).toBeNull();
    });
    it('stores the digest and returns it', async () => {
        sendMock.mockResolvedValue('Take no trade within 2 hours of a loss.');
        const r = await runWeeklyReview('u1', closedTrades, [provider()], NOW);
        expect(r).not.toBeNull();
        expect(r!.impulse).toContain('Take no trade');
        expect(r!.stats.closed).toBe(3);
        expect(r!.providerName).toBe('P1');
        const loaded = await loadWeeklyReview('u1');
        expect(loaded?.impulse).toBe(r!.impulse);
    });
    it('a failed provider call leaves no digest', async () => {
        sendMock.mockRejectedValue(new Error('boom'));
        const r = await runWeeklyReview('u1', closedTrades, [provider()], NOW);
        expect(r).toBeNull();
        expect(await loadWeeklyReview('u1')).toBeNull();
    });
});

describe('isWeeklyReviewDue', () => {
    beforeEach(() => localStorage.clear());
    it('due when never generated', async () => {
        expect(await isWeeklyReviewDue('u2', NOW)).toBe(true);
    });
    it('not due within 7 days of the last digest', async () => {
        const digest: WeeklyReviewDigest = {
            generatedAt: new Date(NOW - 2 * DAY).toISOString(),
            stats: { closed: 3, wins: 1, losses: 2, netPnlUsd: -10, avgR: null, adherenceFollowedPct: null, topMistake: null, givebackDays: 0 },
            impulse: 'x', providerName: 'P1',
        };
        localStorage.setItem(`weekly_review_v1_u2`, JSON.stringify(digest));
        expect(await isWeeklyReviewDue('u2', NOW)).toBe(false);
        expect(await isWeeklyReviewDue('u2', NOW + 6 * DAY)).toBe(true);
    });
});
