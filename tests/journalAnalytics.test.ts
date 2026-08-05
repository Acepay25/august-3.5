import { describe, it, expect } from 'vitest';
import { TradeOutcome, LoggedTrade } from '../types';
import { computeJournalStats } from '../utils/journalAnalytics';

const trade = (outcome: TradeOutcome, pnlPercent?: number, overrides: Partial<LoggedTrade> = {}): LoggedTrade => ({
  id: `t-${Math.random()}`,
  outcome,
  timestamp: new Date().toISOString(),
  analysis: {
    coinName: 'BTCUSDT',
    direction: 'Long',
    tradeType: 'swing',
    confidence: 'Medium',
    probability: 60,
    grade: 'C',
    strategy: 'Trend continuation',
    activeStrategies: [],
    entryPoints: [],
    stopLoss: '',
    takeProfit: [],
    marketConditions: { pattern: '', candleBehavior: '', timeframeAlignment: '', rsi: '', macd: '', sentiment: '' },
    historicalCorrelation: '',
    validityDurationMinutes: 330,
  },
  ...(pnlPercent !== undefined ? { pnlPercent } : {}),
  ...overrides,
});

describe('computeJournalStats', () => {
  it('computes win rate and expectancy over decided trades', () => {
    const stats = computeJournalStats([
      trade(TradeOutcome.WIN, 100),
      trade(TradeOutcome.WIN, 50),
      trade(TradeOutcome.LOSS, -25),
      trade(TradeOutcome.PENDING), // undecided — excluded
    ]);
    expect(stats.total).toBe(4);
    expect(stats.wins).toBe(2);
    expect(stats.losses).toBe(1);
    expect(stats.winRate).toBe(66.7);
    expect(stats.expectancyR).toBe(41.7); // (100 + 50 - 25) / 3
    expect(stats.avgWinR).toBe(75);
    expect(stats.avgLossR).toBe(-25);
  });

  it('tracks streaks across the log order', () => {
    const stats = computeJournalStats([
      trade(TradeOutcome.WIN, 10),
      trade(TradeOutcome.WIN, 10),
      trade(TradeOutcome.LOSS, -10),
      trade(TradeOutcome.LOSS, -10),
      trade(TradeOutcome.LOSS, -10),
      trade(TradeOutcome.WIN, 10),
    ]);
    expect(stats.currentStreak).toBe(1); // ended on a win
    expect(stats.bestWinStreak).toBe(2);
    expect(stats.bestLossStreak).toBe(-3);
  });

  it('groups by strategy and symbol', () => {
    const stats = computeJournalStats([
      trade(TradeOutcome.WIN, 100, { analysis: { ...trade(TradeOutcome.WIN).analysis, strategy: 'Momentum', coinName: 'BTCUSDT' } }),
      trade(TradeOutcome.LOSS, -50, { analysis: { ...trade(TradeOutcome.LOSS).analysis, strategy: 'Momentum', coinName: 'ETHUSDT' } }),
      trade(TradeOutcome.WIN, 40, { analysis: { ...trade(TradeOutcome.WIN).analysis, strategy: 'Mean Reversion', coinName: 'BTCUSDT' } }),
    ]);
    expect(stats.perStrategy.find(g => g.key === 'Momentum')).toMatchObject({ trades: 2, wins: 1, winRate: 50, pnlPercentSum: 50 });
    expect(stats.perSymbol.find(g => g.key === 'BTCUSDT')).toMatchObject({ trades: 2, wins: 2 });
  });

  it('handles an empty and an all-pending log', () => {
    expect(computeJournalStats([]).winRate).toBe(0);
    const pending = computeJournalStats([trade(TradeOutcome.PENDING), trade(TradeOutcome.ENTRY_NOT_HIT)]);
    expect(pending.wins).toBe(0);
    expect(pending.winRate).toBe(0);
    expect(pending.currentStreak).toBe(0);
  });
});
