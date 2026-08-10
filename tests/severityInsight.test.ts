import { describe, it, expect, beforeEach } from 'vitest';
import {
    extractSeverityInsightFromTrade,
    extractCumulativeBleedInsight,
    extractCumulativeBleedInsightForTrade,
    extractAndRecordSeverityInsights,
    extractAndRecordProviderInsights,
    buildSeverityPostMortemContext,
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

    it('returns null for a shallow loss (R > -1.0)', () => {
        // Corrected SL 500 wide of entry on a 1,000-risk trade → -0.5R.
        // The severity floor is the -1.0R bleeder threshold — a -0.5R loss
        // must not pollute the store with severity insights.
        const trade = makeLoss({ correctedStopLoss: '69,500' });
        expect(extractSeverityInsightFromTrade(trade)).toBeNull();
    });

    it('generates a "bleeder_avg" insight for a -1.0R..-1.5R loss', () => {
        // Default loss is exactly -1R (entry 70000, SL 69000, risk 1000).
        // The old guard used the -1.5R deep threshold, which made the
        // bleeder branch unreachable — -1R..-1.5R losses generated nothing.
        const trade = makeLoss({ id: 'bleeder-1' });
        const insight = extractSeverityInsightFromTrade(trade);
        expect(insight).not.toBeNull();
        expect(insight!.kind).toBe('bleeder_avg');
        expect(insight!.pnlR).toBeCloseTo(-1, 5);
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

    it('marks recorded insights used so the quality ratio can move', () => {
        // Distinct family so the derived cluster id (coin-family-direction)
        // is fresh and the store rows are genuinely new.
        const mk = (id: string) => makeLoss({
            id,
            correctedStopLoss: '67,000', // -3R
            analysis: { ...makeLoss().analysis, detectedPatternFamily: 'Family Mark' },
        });
        const recorded = extractAndRecordSeverityInsights(mk('orch-mark'), [mk('orch-mark-prior')]);
        expect(recorded.length).toBe(2);
        for (const si of recorded) {
            const stored = loadAttributedInsights().find(i => i.id === si.id);
            expect(stored).toBeDefined();
            // Just created by the post-mortem loop → counts as one usage so
            // recordInsightFeedback can derive a real quality score.
            expect(stored!.timesUsed).toBe(1);
        }
    });

    it('re-running the job increments usage without duplicating rows', () => {
        const before = loadAttributedInsights().length;
        const mk = (id: string) => makeLoss({
            id,
            correctedStopLoss: '67,000', // -3R
            analysis: { ...makeLoss().analysis, detectedPatternFamily: 'Family Rerun' },
        });
        const first = extractAndRecordSeverityInsights(mk('orch-rerun'), [mk('orch-rerun-prior')]);
        const second = extractAndRecordSeverityInsights(mk('orch-rerun'), [mk('orch-rerun-prior')]);
        expect(loadAttributedInsights().length).toBe(before + 2); // still idempotent
        for (const si of first) {
            const stored = loadAttributedInsights().find(i => i.id === si.id);
            // Each surfacing counts; the row itself is never duplicated.
            expect(stored!.timesUsed).toBe(2);
            expect(loadAttributedInsights().filter(i => i.id === si.id)).toHaveLength(1);
        }
        expect(second.length).toBe(2);
    });
});

describe('buildSeverityPostMortemContext (severity-aware post-mortem generation)', () => {
    it('returns a severity-framed block for a deep cluster', () => {
        const current = makeLoss({ id: 'pm-cur', correctedStopLoss: '67,000' }); // -3R
        const prior = makeLoss({ id: 'pm-prior', correctedStopLoss: '67,000' }); // -3R
        const ctx = buildSeverityPostMortemContext(current, [prior]);
        expect(ctx).not.toBe('');
        expect(ctx).toContain('-6R');
        expect(ctx).toContain('SEVERITY, NOT FREQUENCY');
        expect(ctx).toContain('STRUCTURALLY change');
    });

    it('returns empty for a shallow cluster', () => {
        const current = makeLoss({ id: 'pm-shallow-cur', correctedStopLoss: '67,000' }); // -3R
        const priorWin = { ...makeLoss({ id: 'pm-shallow-prior' }), outcome: TradeOutcome.WIN };
        expect(buildSeverityPostMortemContext(current, [priorWin])).toBe('');
    });

    it('returns empty when the trade has no analysis', () => {
        const trade = { ...makeLoss({ id: 'pm-no-an' }), analysis: undefined } as any;
        expect(buildSeverityPostMortemContext(trade, [])).toBe('');
    });

    it('quotes a recorded severity lesson scoped to the same family', () => {
        addAttributedInsight({
            insight: 'This setup bleeds — tighten the stop.',
            sourceProvider: 'pattern-memory-severity-detector',
            category: 'family',
            scope: 'Family C',
            tradeId: 'pm-seed',
        });
        const current = makeLoss({ id: 'pm-quote-cur', correctedStopLoss: '67,000' });
        const prior = makeLoss({ id: 'pm-quote-prior', correctedStopLoss: '67,000' });
        const ctx = buildSeverityPostMortemContext(current, [prior]);
        expect(ctx).toContain('This setup bleeds — tighten the stop.');
    });

    it('marks quoted severity lessons as used (surfaced to the post-mortem model)', () => {
        addAttributedInsight({
            id: 'pm-lesson-seed',
            insight: 'This family bleeds on stop hunts — widen the invalidation.',
            sourceProvider: 'pattern-memory-severity-detector',
            category: 'family',
            scope: 'Family C',
            tradeId: 'pm-seed-2',
        });
        const current = makeLoss({ id: 'pm-mark-cur', correctedStopLoss: '67,000' });
        const prior = makeLoss({ id: 'pm-mark-prior', correctedStopLoss: '67,000' });
        const ctx = buildSeverityPostMortemContext(current, [prior]);
        // The lesson was actually quoted in the block → it counts as used.
        expect(ctx).toContain('This family bleeds on stop hunts');
        const stored = loadAttributedInsights().find(i => i.id === 'pm-lesson-seed');
        expect(stored!.timesUsed).toBe(1);
    });

    it('does not mark lessons when the cluster is too shallow to quote', () => {
        addAttributedInsight({
            id: 'pm-noquote-seed',
            insight: 'Shallow cluster — should never be quoted or marked.',
            sourceProvider: 'pattern-memory-severity-detector',
            category: 'family',
            scope: 'Family C',
            tradeId: 'pm-seed-3',
        });
        const current = makeLoss({ id: 'pm-nomark-cur', correctedStopLoss: '67,000' }); // -3R
        const priorWin = { ...makeLoss({ id: 'pm-nomark-prior' }), outcome: TradeOutcome.WIN };
        expect(buildSeverityPostMortemContext(current, [priorWin])).toBe('');
        const stored = loadAttributedInsights().find(i => i.id === 'pm-noquote-seed');
        expect(stored!.timesUsed).toBe(0);
    });
});

describe('extractAndRecordProviderInsights (provider attribution)', () => {
    // Sentences crafted to hit the post-mortem insight patterns: entry
    // timing, risk management, pattern recognition.
    const pmText = [
        'Next time the entry should wait for the retest to confirm.',
        'Entered too early on a weak impulse.',
        'Position size was too large for the volatility.',
        'Risk was too high relative to the setup.',
        'The false breakout invalidated the thesis.',
    ].join(' ');

    it('records attributed insights per provider with scope categorization', () => {
        const before = loadAttributedInsights().length;
        const trade = makeLoss({
            id: 'attr-1',
            correctedStopLoss: '67,000',
            postMortemByProvider: {
                Gemini: pmText,
                'Custom LLM': 'Missed the reversal signal before the breakdown.',
            },
        });
        const recorded = extractAndRecordProviderInsights(trade);
        // Gemini text → 5 pattern hits; Custom LLM text → 1.
        expect(recorded.length).toBe(6);
        expect(recorded.filter(i => i.sourceProvider === 'Gemini')).toHaveLength(5);
        expect(recorded.filter(i => i.sourceProvider === 'Custom LLM')).toHaveLength(1);
        expect(loadAttributedInsights().length).toBe(before + 6);

        // Scope categorization: the false-breakout lesson is pattern-scoped.
        const breakout = recorded.find(i => i.insight.includes('false breakout'))!;
        expect(breakout.category).toBe('pattern');
        expect(breakout.scope).toBe('Breakout');

        // Created by the job → marked used once so the quality ratio can move.
        expect(loadAttributedInsights().find(i => i.id === breakout.id)!.timesUsed).toBe(1);
    });

    it('is idempotent — re-running updates in place, never duplicates', () => {
        const before = loadAttributedInsights().length;
        const trade = makeLoss({ id: 'attr-2', correctedStopLoss: '67,000', postMortemByProvider: { Gemini: pmText } });
        const first = extractAndRecordProviderInsights(trade);
        const second = extractAndRecordProviderInsights(trade);
        expect(loadAttributedInsights().length).toBe(before + 5);
        expect(second.length).toBe(5);
        for (const insight of first) {
            const stored = loadAttributedInsights().find(s => s.id === insight.id);
            expect(stored).toBeDefined();
            expect(loadAttributedInsights().filter(s => s.id === insight.id)).toHaveLength(1);
            // Each surfacing counts; the row itself is never duplicated.
            expect(stored!.timesUsed).toBe(2);
        }
    });

    it('records nothing without contributions, without analysis, or for tiny texts', () => {
        expect(extractAndRecordProviderInsights(makeLoss({ id: 'attr-none' }))).toEqual([]);
        const noAnalysis = { ...makeLoss({ id: 'attr-no-an' }), analysis: undefined } as any;
        expect(extractAndRecordProviderInsights(noAnalysis)).toEqual([]);
        const shortTrade = makeLoss({ id: 'attr-short', postMortemByProvider: { Gemini: 'Too short.' } });
        expect(extractAndRecordProviderInsights(shortTrade)).toEqual([]);
    });
});
