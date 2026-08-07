import { describe, it, expect } from 'vitest';
import { generateMandatoryPatternCheck, calculateSimilarity } from '../services/learning/PatternMemorySynthesisService';
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
});
