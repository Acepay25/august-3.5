import { describe, it, expect } from 'vitest';
import { generateMandatoryPatternCheck, generatePatternMemoryEnforcementContext, calculateSimilarity, addAttributedInsight, loadAttributedInsights } from '../services/learning/PatternMemorySynthesisService';
import { LoggedTrade, TradeOutcome } from '../types';

// B7 regression tests: calculatePnlR used parseFloat (comma-formatted prices
// "69,000" → 69 → risk 0 → undefined R) and hardcoded -1.0 for every loss,
// which made the `worstR <= -1.5` REDUCE_SIZE gate unreachable.

const makeLossTrade = (overrides: Partial<LoggedTrade> = {}): LoggedTrade => ({
  id: `t-${Math.random()}`,
  timestamp: new Date(Date.now() - 60_000).toISOString(),
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
    entryPoints: [{ description: 'retest', price: '69,500' }],
    stopLoss: '69,000',
    takeProfit: [{ price: '71,000', percentage: '100%' }],
    marketConditions: { pattern: 'Breakout', candleBehavior: '', timeframeAlignment: '', rsi: '', macd: '', sentiment: '' },
    historicalCorrelation: '',
    validityDurationMinutes: 330,
    createdAt: new Date(Date.now() - 60_000).toISOString(),
  },
  ...overrides,
});

const setup = { coin: 'BTC', direction: 'Long' as const, family: 'Family C', pattern: 'Breakout' };

describe('generateMandatoryPatternCheck — extended-loss gate (B7)', () => {
  it('matches the crafted trade as relevant', () => {
    const trade = makeLossTrade();
    expect(calculateSimilarity(setup, trade)).toBeGreaterThan(20);
  });

  it('fires REDUCE_SIZE when a similar loss used a widened (corrected) stop', () => {
    // Corrected SL 2,000 wider than planned → -5R loss. The old hardcoded
    // -1.0 for every loss left worstR at -1.0 and this branch unreachable.
    const trade = makeLossTrade({ correctedStopLoss: '67,000' });
    const gate = generateMandatoryPatternCheck(setup, [trade]);
    expect(gate.gateResult).toBe('REDUCE_SIZE');
    expect(gate.reason).toContain('extended losses');
  });

  it('parses comma-formatted prices instead of collapsing them to 69/71', () => {
    // parseFloat("69,500") = 69 → risk = |69-69| = 0 → R undefined → no gate.
    // parsePrice keeps 69,500 → risk 500 → corrected stop 67,000 → -5R.
    const trade = makeLossTrade({ correctedStopLoss: '67,000' });
    const gate = generateMandatoryPatternCheck(setup, [trade]);
    expect(gate.gateResult).toBe('REDUCE_SIZE');
  });

  it('stays PASS-ish for a plain -1R loss (no widened stop)', () => {
    const trade = makeLossTrade();
    const gate = generateMandatoryPatternCheck(setup, [trade]);
    // 1 loss, sample 1: not HALT, not win-rate REDUCE_SIZE, worstR = -1 →
    // falls through to WARNING or PASS.
    expect(['WARNING', 'PASS']).toContain(gate.gateResult);
  });

  it('fires severity HALT on 2 losses that bleed -3R each (few-but-deep)', () => {
    // Dual-dimension: sumLossR = -6 with lossesWithR = 2 must HALT even
    // though the count-based HALT (3+) does not fire. Catches the case
    // where a user keeps getting stopped out at the deepest candle of
    // the move without enough repetition to trip the old frequency rule.
    const t1 = makeLossTrade({ id: 'a', correctedStopLoss: '68,000' }); // -3R
    const t2 = makeLossTrade({ id: 'b', correctedStopLoss: '68,000' }); // -3R
    const gate = generateMandatoryPatternCheck(setup, [t1, t2]);
    expect(gate.gateResult).toBe('HALT');
    expect(gate.reason).toContain('Cumulative R-loss');
    expect(gate.reason).toContain('-6R');
  });

  it('does NOT fire severity HALT on a single catastrophic outlier', () => {
    // Single -10R loss must not be enough on its own — the gate requires
    // both magnitude AND a minimum of 2 R-bearing losses so one freak
    // trade does not flip the verdict.
    const trade = makeLossTrade({ id: 'lone', correctedStopLoss: '64,500' }); // -10R
    const gate = generateMandatoryPatternCheck(setup, [trade]);
    expect(gate.gateResult).not.toBe('HALT');
  });

  it('does NOT fire severity HALT when cumulative loss is shallow (<= 4R)', () => {
    // 2 losses at -1R each → sumLossR = -2, below the -4R threshold.
    // Frequency-only path also doesn't fire (only 2 losses). Should not HALT.
    const t1 = makeLossTrade({ id: 'shallow1' });
    const t2 = makeLossTrade({ id: 'shallow2' });
    const gate = generateMandatoryPatternCheck(setup, [t1, t2]);
    expect(gate.gateResult).not.toBe('HALT');
  });

  it('surfaces avgR and sumLossR in the WARNING reason text', () => {
    // Two plain -1R losses: sumLossR = -2 (below -4 HALT threshold),
    // worstR = -1 (above -1.5 REDUCE_SIZE threshold), sampleSize = 2
    // (below winRate threshold of 3). So this is the WARNING branch.
    const t1 = makeLossTrade({ id: 'warn1' });
    const t2 = makeLossTrade({ id: 'warn2' });
    const gate = generateMandatoryPatternCheck(setup, [t1, t2]);
    expect(gate.gateResult).toBe('WARNING');
    expect(gate.reason).toContain('avgR');
    expect(gate.reason).toContain('sumLossR');
  });

  it('surfaces matching severity insights in the gate + builds severity mandatory question', () => {
    // Seed a severity insight into the store with the same family scope as
    // the current setup so the gate can quote it back verbatim.
    const seeded = addAttributedInsight({
      insight: 'Single -3R loss (Family C) — the SL placement is letting trades run to deep loss, not the pattern itself. Review stop placement.',
      sourceProvider: 'pattern-memory-severity-detector',
      category: 'family',
      scope: 'Family C',
      tradeId: 'seed-trade',
    });
    expect(seeded.sourceProvider).toBe('pattern-memory-severity-detector');

    // Two deep losses so the severity-aware HALT fires.
    const t1 = makeLossTrade({ id: 'sev1', correctedStopLoss: '68,000' }); // -3R
    const t2 = makeLossTrade({ id: 'sev2', correctedStopLoss: '68,000' }); // -3R
    const gate = generateMandatoryPatternCheck(setup, [t1, t2]);

    expect(gate.gateResult).toBe('HALT');
    expect(gate.severityInsights.length).toBeGreaterThan(0);
    // The mandatory question should quote the user's own past lesson
    const severityQuestion = gate.mandatoryQuestions.find(q => q.includes('Your pattern memory records'));
    expect(severityQuestion).toBeDefined();
    expect(severityQuestion).toContain('SL placement');
  });

  it('auto-records a cumulative-bleed insight when the enforcement context is built over a deep cluster', () => {
    const before = loadAttributedInsights().length;
    // Two -3R losses → sumLossR -6, lossesWithR 2 → cumulative bleed fires.
    const t1 = makeLossTrade({ id: 'auto-rec-1', correctedStopLoss: '68,000' });
    const t2 = makeLossTrade({ id: 'auto-rec-2', correctedStopLoss: '68,000' });
    generatePatternMemoryEnforcementContext(setup, [t1, t2]);
    const after = loadAttributedInsights();
    expect(after.length).toBe(before + 1);
    const recorded = after.find(i => i.sourceProvider === 'pattern-memory-severity-detector' && i.tradeId === t1.id);
    expect(recorded).toBeDefined();
    expect(recorded!.insight).toContain('-6R');
    expect(recorded!.insight).toContain('Family C');
  });

  it('auto-record writes nothing when the cluster is shallow', () => {
    const before = loadAttributedInsights().length;
    // Two -1R losses → sumLossR -2 (shallow) → no bleed insight, no write.
    const t1 = makeLossTrade({ id: 'auto-shallow-1' });
    const t2 = makeLossTrade({ id: 'auto-shallow-2' });
    generatePatternMemoryEnforcementContext(setup, [t1, t2]);
    expect(loadAttributedInsights().length).toBe(before);
  });

  it('marks surfaced severity insights as used (gate question + enforcement render)', () => {
    const seeded = addAttributedInsight({
      insight: 'Single -3R loss (Family C) — review stop placement.',
      sourceProvider: 'pattern-memory-severity-detector',
      category: 'family',
      scope: 'Family C',
      tradeId: 'use-seed',
    });
    const timesUsed = () => loadAttributedInsights().find(i => i.id === seeded.id)!.timesUsed;
    const before = timesUsed();

    const t1 = makeLossTrade({ id: 'use-1', correctedStopLoss: '68,000' }); // -3R
    const t2 = makeLossTrade({ id: 'use-2', correctedStopLoss: '68,000' }); // -3R

    // Gate quotes the seeded insight in the severity-HALT mandatory question → +1.
    const gate = generateMandatoryPatternCheck(setup, [t1, t2]);
    expect(gate.gateResult).toBe('HALT');
    expect(timesUsed()).toBe(before + 1);

    // Enforcement context re-quotes it (selection) AND renders the 🩸 block —
    // but "surfaced" marks are deduped within a run (15-min window), so the
    // same insight counts ONCE per debate run, not 3× (the old behavior
    // diluted qualityScore = timesHelpful / timesUsed to a third of its
    // true value).
    generatePatternMemoryEnforcementContext(setup, [t1, t2]);
    expect(timesUsed()).toBe(before + 1);
  });
});
