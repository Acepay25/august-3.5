import { describe, it, expect, beforeEach } from 'vitest';

// Monthly report card (Batch 5 remainder, plan §4.5): deterministic
// month-stats + grade-the-panel (per-provider / moderator / ensemble Brier).

import {
    buildMonthReport,
    ensembleLineFromTranscript,
    runMonthlyReport,
    isMonthlyReportDue,
    loadMonthlyReport,
} from '../services/learning/monthlyReport';
import { LoggedTrade } from '../types/trade';
import { TradeOutcome } from '../types/enums';
import { TradeAnalysis } from '../types';
import { DebateTurn } from '../types/message';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 7, 30, 12);

const trade = (over: Partial<LoggedTrade> & { outcome: TradeOutcome }): LoggedTrade => ({
    id: `t-${Math.random().toString(36).slice(2)}`,
    analysis: {} as TradeAnalysis,
    timestamp: new Date(NOW - DAY).toISOString(),
    ...over,
});

const turn = (speaker: string, text: string): DebateTurn => ({ speaker, text });

describe('ensembleLineFromTranscript', () => {
    it('recomputes the line from each seat\'s LAST conviction line', () => {
        const line = ensembleLineFromTranscript([
            turn('Alpha', 'CONVICTION: 60\nopening'),
            turn('Beta', 'CONVICTION: 80\nopening'),
            turn('Alpha', 'CONVICTION: 70\nfinal rebuttal'),
            turn('Moderator', 'verdict text'),
        ]);
        // log-odds mean of 70 and 80 (alpha=1) = 75.
        expect(line).not.toBeNull();
        expect(line!).toBeCloseTo(75, 0);
    });
    it('null when no seat declared a conviction or no turns', () => {
        expect(ensembleLineFromTranscript([turn('Alpha', 'no marker here')])).toBeNull();
        expect(ensembleLineFromTranscript([])).toBeNull();
        expect(ensembleLineFromTranscript(undefined)).toBeNull();
    });
});

describe('buildMonthReport', () => {
    it('windows on analysis.createdAt (open time) with timestamp fallback', () => {
        const within = trade({
            outcome: TradeOutcome.WIN, pnlAmount: 100,
            analysis: { createdAt: new Date(NOW - 5 * DAY).toISOString() } as TradeAnalysis,
            timestamp: new Date(NOW - 40 * DAY).toISOString(), // closed late, opened inside
        });
        const outside = trade({
            outcome: TradeOutcome.LOSS, pnlAmount: -50,
            analysis: { createdAt: new Date(NOW - 35 * DAY).toISOString() } as TradeAnalysis,
        });
        const noCreatedAt = trade({ outcome: TradeOutcome.WIN, pnlAmount: 20 }); // falls back to timestamp
        const r = buildMonthReport([within, outside, noCreatedAt], NOW);
        expect(r.whatHappened.closed).toBe(2);
        expect(r.whatHappened.wins).toBe(2);
        expect(r.whatHappened.losses).toBe(0);
    });
    it('grades the panel: per-provider Brier from the confidence anchor', () => {
        const mk = (provider: string, confidence: 'High' | 'Medium' | 'Low', win: boolean) =>
            trade({
                outcome: win ? TradeOutcome.WIN : TradeOutcome.LOSS,
                pnlAmount: win ? 50 : -50,
                analysis: { confidence } as TradeAnalysis,
                modelsUsed: { [provider]: 'model-x' },
            });
        // gemini: 3 High-confidence rows, 2 wins → Brier = (2*0.09 + 0.49)/3 = 0.2267
        const trades = [
            mk('gemini', 'High', true), mk('gemini', 'High', true), mk('gemini', 'High', false),
            mk('deepseek', 'Low', false), mk('deepseek', 'Low', false), mk('deepseek', 'Low', true),
        ];
        const r = buildMonthReport(trades, NOW);
        const gem = r.panel.seats.find(s => s.label === 'gemini')!;
        const dp = r.panel.seats.find(s => s.label === 'deepseek')!;
        expect(gem.n).toBe(3);
        expect(gem.brier).not.toBeNull();
        expect(gem.brier!).toBeCloseTo((0.09 + 0.09 + 0.49) / 3, 4);
        expect(gem.quality).toBe('fair');
        // deepseek claims Low (0.40) but wins 1/3 → (0.16+0.16+0.36)/3 = 0.2267 too
        expect(dp.brier!).toBeCloseTo((0.16 + 0.16 + 0.36) / 3, 4);
    });
    it('below MIN_BRIER_SAMPLE the seat is ungraded but still counted', () => {
        const r = buildMonthReport([
            trade({ outcome: TradeOutcome.WIN, pnlAmount: 10, modelsUsed: { gemini: 'm' } }),
            trade({ outcome: TradeOutcome.LOSS, pnlAmount: -10, modelsUsed: { gemini: 'm' } }),
            trade({ outcome: TradeOutcome.WIN, pnlAmount: 10 }),
        ], NOW);
        const gem = r.panel.seats.find(s => s.label === 'gemini')!;
        expect(gem.n).toBe(2);
        expect(gem.brier).toBeNull();
        expect(gem.quality).toBe('none');
    });
    it('moderator row scores the declared verdict probability', () => {
        const r = buildMonthReport([
            trade({ outcome: TradeOutcome.WIN, pnlAmount: 10, analysis: { probability: 70 } as TradeAnalysis }),
            trade({ outcome: TradeOutcome.LOSS, pnlAmount: -10, analysis: { probability: 70 } as TradeAnalysis }),
            trade({ outcome: TradeOutcome.WIN, pnlAmount: 10, analysis: { probability: 70 } as TradeAnalysis }),
        ], NOW);
        expect(r.panel.moderator).not.toBeNull();
        // (0.09 + 0.49 + 0.09)/3 = 0.2233
        expect(r.panel.moderator!.brier!).toBeCloseTo((0.09 + 0.49 + 0.09) / 3, 4);
        expect(r.panel.moderator!.winRate).toBeCloseTo(200 / 3, 1);
    });
    it('ensemble-line row recomputed from journaled transcripts', () => {
        const withDebate = (win: boolean) => trade({
            outcome: win ? TradeOutcome.WIN : TradeOutcome.LOSS,
            pnlAmount: win ? 10 : -10,
            debateTurns: [
                turn('Alpha', 'CONVICTION: 80'),
                turn('Beta', 'CONVICTION: 80'),
                turn('Moderator', 'grade B'),
            ],
        });
        const r = buildMonthReport([withDebate(true), withDebate(true), withDebate(false)], NOW);
        expect(r.panel.ensembleLine).not.toBeNull();
        expect(r.panel.ensembleLine!.n).toBe(3);
        // line = 80% vs outcomes 1,1,0 → (0.04+0.04+0.64)/3 = 0.24
        expect(r.panel.ensembleLine!.brier!).toBeCloseTo(0.24, 4);
    });
    it('needs-attention flags low adherence and the costliest mistake', () => {
        const r = buildMonthReport([
            trade({ outcome: TradeOutcome.LOSS, pnlAmount: -90, followedPlan: false, mistakeTags: ['revenge'] }),
            trade({ outcome: TradeOutcome.LOSS, pnlAmount: -10, followedPlan: false }),
            trade({ outcome: TradeOutcome.WIN, pnlAmount: 20, followedPlan: true }),
        ], NOW);
        expect(r.needsAttention.some(l => l.includes('adherence'))).toBe(true);
        expect(r.needsAttention.some(l => l.includes('revenge'))).toBe(true);
        expect(r.whatLearned.biggestMistake).toBe('revenge');
        expect(r.whatLearned.bestTrade).toEqual({ label: 'trade', pnlUsd: 20 });
    });
});

describe('runMonthlyReport + due-check', () => {
    beforeEach(() => localStorage.clear());

    const closedTrades = [
        trade({ outcome: TradeOutcome.WIN, pnlAmount: 50 }),
        trade({ outcome: TradeOutcome.LOSS, pnlAmount: -30 }),
        trade({ outcome: TradeOutcome.WIN, pnlAmount: 20 }),
    ];

    it('gates on >=3 closed trades', async () => {
        expect(await runMonthlyReport('u1', [closedTrades[0]], NOW)).toBeNull();
    });
    it('stores the card and loads it back', async () => {
        const card = await runMonthlyReport('u1', closedTrades, NOW);
        expect(card).not.toBeNull();
        expect(card!.whatHappened.closed).toBe(3);
        const loaded = await loadMonthlyReport('u1');
        expect(loaded?.generatedAt).toBe(card!.generatedAt);
    });
    it('not due within 30 days of the last card', async () => {
        await runMonthlyReport('u3', closedTrades, NOW);
        expect(await isMonthlyReportDue('u3', NOW + 10 * DAY)).toBe(false);
        expect(await isMonthlyReportDue('u3', NOW + 31 * DAY)).toBe(true);
    });
});
