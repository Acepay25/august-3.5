import { describe, it, expect, beforeEach } from 'vitest';
import {
    extractSeverityInsightFromTrade,
    extractCumulativeBleedInsight,
    extractCumulativeBleedInsightForTrade,
    extractAndRecordSeverityInsights,
    recordSeverityInsight,
} from '../services/learning/InsightExtractionService';
import {
    addAttributedInsight,
    loadAttributedInsights
} from '../services/learning/PatternMemorySynthesisService';
import { LoggedTrade, TradeOutcome } from '../types';

const makeLoss = (overrides: Partial<LoggedTrade> = {}): LoggedTrade => ({
    id: `t-${Math.random()}`,
    timestamp: new Date().toISOString(),
    outcome: TradeOutcome.LOSS,
    analysis: {
        coinName: 'BTCUSDT',
        direction: 'Long',
        tradeType: 'swing',
        confidence: 'Medium',
        probability: 60,
        grade: 'C',
        strategy: 'Trend continuation',
        activeStrategies: [],
        entryPoints: [{ description: 'retest', price: '70,000' }],
        stopLoss: '69,000',
        takeProfit: [{ price: '72,000', percentage: '100%' }],
        marketConditions: { pattern: 'Breakout', candleBehavior: '', timeframeAlignment: '', rsi: '', macd: '', sentiment: '' },
        historicalCorrelation: '',
        validityDurationMinutes: 330,
        createdAt: new Date().toISOString(),
        detectedPatternFamily: 'Family C',
    },
    ...overrides,
});

const setup = { coin: 'BTC', direction: 'Long' as const, family: 'Family C', pattern: 'Breakout' };

describe('extractSeverityInsightFromTrade', () => {
    it('returns null for a winning trade', () => {
        const trade: LoggedTrade = { ...makeLoss(), outcome: TradeOutcome.WIN };
        expect(extractSeverityInsightFromTrade(trade)).toBeNull();
    });

    it('returns null for a shallow loss (R > -1.5)', () => {
        // Default loss: entry 70000, SL 69000, loss 1000, risk 1000, R = -1.
        // -1 > -1.5, so should NOT generate a severity insight.
        const trade = makeLoss();
        expect(extractSeverityInsightFromTrade(trade)).toBeNull();
    });

    it('generates a "deep_single_loss" insight for -1.5R or worse', () => {
        // Corrected SL 2,000 wider than planned (69,000 → 67,000) → -3R loss.
        const trade = makeLoss({ id: 'deep-1', correctedStopLoss: '67,000' });
        const insight = extractSeverityInsightFromTrade(trade);
        expect(insight).not.toBeNull();
        expect(insight!.kind).toBe('deep_single_loss');
        expect(insight!.pnlR).toBeLessThanOrEqual(-1.5);
        // The text should reference the coin + family + R magnitude
        expect(insight!.text).toContain('BTCUSDT');
        expect(insight!.text).toContain('Family C');
        expect(insight!.text).toContain('-3R');
        // Idempotency: same trade + same kind → same id
        const second = extractSeverityInsightFromTrade(trade);
        expect(second!.id).toBe(insight!.id);
    });

    it('text uses "bleeder" framing when avg per-loss is the failure mode', () => {
        // -2.5R bleeds
        const trade = makeLoss({ id: 'bleed', correctedStopLoss: '67,500' });
        const insight = extractSeverityInsightFromTrade(trade);
        expect(insight).not.toBeNull();
        expect(insight!.kind).toBe('deep_single_loss');
        // The deep_single_loss branch uses "SL placement" framing, not bleeder.
        expect(insight!.text).toMatch(/SL placement|stop/i);
    });

    it('returns null when trade has no parseable R (missing SL/entry)', () => {
        const trade = makeLoss({ id: 'nor', analysis: {
            ...makeLoss().analysis,
            entryPoints: [],
            stopLoss: '',
        } as any });
        expect(extractSeverityInsightFromTrade(trade)).toBeNull();
    });

    it('records the severity insight into the AttributedInsight store', () => {
        // Snapshot of the existing insight count so we can assert the delta
        const before = loadAttributedInsights().length;
        const trade = makeLoss({ id: 'rec', correctedStopLoss: '67,000' }); // -3R
        const insight = extractSeverityInsightFromTrade(trade)!;
        const stored = recordSeverityInsight(insight);
        const after = loadAttributedInsights();
        expect(after.length).toBe(before + 1);
        // The stored insight must carry the synthetic provider tag so the
        // gate can find it specifically.
        expect(stored.sourceProvider).toBe('pattern-memory-severity-detector');
        // The category should reflect the trade's analysis family
        expect(stored.category).toBe('family');
        expect(stored.scope).toBe('Family C');
    });
});

describe('extractCumulativeBleedInsight', () => {
    it('returns null when sumLossR is shallow (> -3R)', () => {
        const insight = extractCumulativeBleedInsight(
            {
                trades: [makeLoss(), makeLoss()],
                stats: { sumLossR: -2, lossesWithR: 2, avgR: -1, sampleSize: 2, winRate: 0 },
            },
            { coin: 'BTC', family: 'Family C' }
        );
        expect(insight).toBeNull();
    });

    it('returns null when fewer than 2 losses have R data', () => {
        const insight = extractCumulativeBleedInsight(
            {
                trades: [makeLoss()],
                stats: { sumLossR: -5, lossesWithR: 1, avgR: -5, sampleSize: 1, winRate: 0 },
            },
            { coin: 'BTC', family: 'Family C' }
        );
        expect(insight).toBeNull();
    });

    it('generates a "cumulative_bleed" insight for a deep cluster', () => {
        const trades = [makeLoss({ id: 'c1' }), makeLoss({ id: 'c2' })];
        const insight = extractCumulativeBleedInsight(
            {
                trades,
                stats: { sumLossR: -6, lossesWithR: 2, avgR: -3, sampleSize: 2, winRate: 0 },
            },
            { coin: 'BTC', family: 'Family C', direction: 'Long' }
        );
        expect(insight).not.toBeNull();
        expect(insight!.kind).toBe('cumulative_bleed');
        // Text should reference the cumulative magnitude and the family
        expect(insight!.text).toContain('-6R');
        expect(insight!.text).toContain('Family C');
        expect(insight!.text).toContain('severity is the failure mode');
    });

    it('cumulative-bleed insight id is stable across calls for the same setup', () => {
        const trades = [makeLoss({ id: 'c1' }), makeLoss({ id: 'c2' })];
        const setupArg = { coin: 'BTC', family: 'Family C', direction: 'Long' as const };
        const a = extractCumulativeBleedInsight(
            { trades, stats: { sumLossR: -6, lossesWithR: 2, avgR: -3, sampleSize: 2, winRate: 0 } },
            setupArg
        );
        const b = extractCumulativeBleedInsight(
            { trades: [...trades], stats: { sumLossR: -6, lossesWithR: 2, avgR: -3, sampleSize: 2, winRate: 0 } },
            setupArg
        );
        expect(a!.id).toBe(b!.id);
    });
});

describe('extractCumulativeBleedInsightForTrade (post-mortem cluster wiring)', () => {
    it('builds the setup from the trade and fires on a deep cluster', () => {
        const current = makeLoss({ id: 'cur-cluster', correctedStopLoss: '67,000' }); // -3R
        const prior = makeLoss({ id: 'prior-cluster', correctedStopLoss: '67,000' }); // -3R
        const insight = extractCumulativeBleedInsightForTrade(current, [prior]);
        expect(insight).not.toBeNull();
        expect(insight!.kind).toBe('cumulative_bleed');
        expect(insight!.text).toContain('-6R');
        expect(insight!.text).toContain('Family C');
    });

    it('counts the current trade exactly once even when it is already in history', () => {
        const current = makeLoss({ id: 'dup-me', correctedStopLoss: '67,000' }); // -3R
        const prior = makeLoss({ id: 'dup-prior', correctedStopLoss: '67,000' }); // -3R
        // Simulate the profile already containing the just-closed trade.
        const insight = extractCumulativeBleedInsightForTrade(current, [current, prior]);
        expect(insight).not.toBeNull();
        expect(insight!.text).toContain('-6R'); // -3 + -3 = -6, NOT -9
    });

    it('returns null when the cluster lacks a second R-bearing loss', () => {
        const current = makeLoss({ id: 'shallow-cur', correctedStopLoss: '67,000' }); // -3R
        const priorWin = { ...makeLoss({ id: 'shallow-prior', correctedStopLoss: '67,000' }), outcome: TradeOutcome.WIN };
        expect(extractCumulativeBleedInsightForTrade(current, [priorWin])).toBeNull();
    });

    it('returns null when the current trade has no analysis', () => {
        const trade = { ...makeLoss({ id: 'no-analysis' }), analysis: undefined } as any;
        expect(extractCumulativeBleedInsightForTrade(trade, [])).toBeNull();
    });
});

describe('recordSeverityInsight idempotency', () => {
    it('does not duplicate when the same severity insight is recorded twice', () => {
        const before = loadAttributedInsights().length;
        const trade = makeLoss({ id: 'idem-single', correctedStopLoss: '67,000' }); // -3R
        const insight = extractSeverityInsightFromTrade(trade)!;
        const first = recordSeverityInsight(insight);
        const second = recordSeverityInsight(insight);
        expect(loadAttributedInsights().length).toBe(before + 1);
        expect(second.id).toBe(first.id);
    });

    it('updates the stored cumulative text when the same cluster deepens', () => {
        const familyE = 'Family E';
        const mk = (id: string, stopLoss: string) => makeLoss({
            id,
            correctedStopLoss: stopLoss,
            analysis: { ...makeLoss().analysis, detectedPatternFamily: familyE },
        });

        const first = extractCumulativeBleedInsightForTrade(mk('e1', '67,000'), [mk('e2', '67,000')])!; // -6R
        recordSeverityInsight(first);

        // Same cluster (same coin/family/direction) deepens with a third loss.
        const deeper = extractCumulativeBleedInsightForTrade(
            mk('e1', '67,000'),
            [mk('e2', '67,000'), mk('e3', '67,000')]
        )!; // -9R
        recordSeverityInsight(deeper);

        const stored = loadAttributedInsights().find(i => i.id === deeper.id);
        expect(stored).toBeDefined();
        expect(stored!.insight).toContain('-9R');
        expect(loadAttributedInsights().filter(i => i.id === deeper.id)).toHaveLength(1);
    });
});

describe('extractAndRecordSeverityInsights (post-mortem job orchestrator)', () => {
    it('records single + cumulative for a deep loss inside a deep cluster', () => {
        const before = loadAttributedInsights().length;
        const current = makeLoss({ id: 'orch-cur', correctedStopLoss: '67,000' });
        const prior = makeLoss({ id: 'orch-prior', correctedStopLoss: '67,000' });
        const recorded = extractAndRecordSeverityInsights(current, [prior]);
        expect(recorded.length).toBe(2);
        expect(recorded.map(i => i.kind)).toEqual(expect.arrayContaining(['deep_single_loss', 'cumulative_bleed']));
        expect(loadAttributedInsights().length).toBe(before + 2);
    });

    it('records only the single-trade insight when the cluster has one R-bearing loss', () => {
        const before = loadAttributedInsights().length;
        const current = makeLoss({ id: 'orch-shallow', correctedStopLoss: '67,000' }); // -3R
        const priorWin = { ...makeLoss({ id: 'orch-shallow-prior' }), outcome: TradeOutcome.WIN };
        const recorded = extractAndRecordSeverityInsights(current, [priorWin]);
        expect(recorded.length).toBe(1);
        expect(recorded[0].kind).toBe('deep_single_loss');
        expect(loadAttributedInsights().length).toBe(before + 1);
    });

    it('records nothing for a winning trade', () => {
        const before = loadAttributedInsights().length;
        const win = { ...makeLoss({ id: 'orch-win' }), outcome: TradeOutcome.WIN };
        expect(extractAndRecordSeverityInsights(win, [])).toEqual([]);
        expect(loadAttributedInsights().length).toBe(before);
    });
});
