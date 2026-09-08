import { describe, it, expect, vi, beforeEach } from 'vitest';

let store: Record<string, unknown> = {};
vi.mock('../services/infrastructure/PreferencesService', () => ({
  getPreferenceObject: vi.fn(async (key: string) => store[key] ?? null),
  setPreferenceObject: vi.fn(async (key: string, value: unknown) => {
    store[key] = value;
  }),
  removePreference: vi.fn(async (key: string) => {
    delete store[key];
  }),
}));

import {
  recordSettledTradeForMatrix,
  hydrateStrategyRegimeMatrix,
  familyRegimeEdge,
  familyEdgeFactor,
  matrixSummaryBlock,
  familyForTrade,
  MATRIX_MIN_SAMPLES,
  MATRIX_FAVOR_FACTOR,
  MATRIX_AGAINST_FACTOR,
} from '../services/learning/strategyRegimeMatrix';
import { LoggedTrade, TradeOutcome } from '../types';

const USER = 'matrix-user';

const trade = (
  outcome: TradeOutcome,
  family: string | undefined,
  regime: string | undefined,
  strategyText?: string,
): LoggedTrade => ({
  id: `t-${Math.random().toString(36).slice(2)}`,
  analysis: { coinName: 'BTCUSDT', direction: 'Long', strategy: strategyText ?? '', strategyFamily: family } as never,
  outcome,
  marketRegime: regime,
  timestamp: '2026-09-01T12:00:00.000Z',
} as LoggedTrade);

describe('strategyRegimeMatrix — accumulation', () => {
  beforeEach(async () => {
    store = {};
    await hydrateStrategyRegimeMatrix(USER);
  });

  it('records WIN/LOSS tallies per family × regime', async () => {
    for (let i = 0; i < 6; i++) await recordSettledTradeForMatrix(trade(TradeOutcome.WIN, 'trend_following', 'trending'), USER);
    for (let i = 0; i < 2; i++) await recordSettledTradeForMatrix(trade(TradeOutcome.LOSS, 'trend_following', 'trending'), USER);
    const edge = familyRegimeEdge('trend_following', 'trending');
    expect(edge).toEqual({ winRate: 0.75, samples: 8 });
  });

  it('ignores pending trades, unknown regimes and family-less strategies', async () => {
    await recordSettledTradeForMatrix(trade(TradeOutcome.PENDING, 'trend_following', 'trending'), USER);
    await recordSettledTradeForMatrix(trade(TradeOutcome.WIN, 'trend_following', undefined), USER);
    await recordSettledTradeForMatrix(trade(TradeOutcome.WIN, undefined, 'trending', 'a nice setup today'), USER);
    expect(familyRegimeEdge('trend_following', 'trending')).toBeNull();
  });

  it('classifies the family from free text when the analysis has no enum', async () => {
    expect(familyForTrade(trade(TradeOutcome.WIN, undefined, 'ranging', 'mean reversion fade at the extreme')))
      .toBe('mean_reversion');
    await recordSettledTradeForMatrix(trade(TradeOutcome.WIN, undefined, 'ranging', 'mean reversion fade'), USER);
    expect(familyRegimeEdge('mean_reversion', 'ranging')?.samples).toBe(1);
  });

  it('survives a re-hydrate from persisted preferences', async () => {
    await recordSettledTradeForMatrix(trade(TradeOutcome.WIN, 'breakout', 'compression'), USER);
    await hydrateStrategyRegimeMatrix('other-user');
    expect(familyRegimeEdge('breakout', 'compression')).toBeNull();
    await hydrateStrategyRegimeMatrix(USER);
    expect(familyRegimeEdge('breakout', 'compression')?.samples).toBe(1);
  });
});

describe('strategyRegimeMatrix — ranking factor', () => {
  const fill = async (family: string, regime: string, wins: number, losses: number) => {
    for (let i = 0; i < wins; i++) await recordSettledTradeForMatrix(trade(TradeOutcome.WIN, family, regime), USER);
    for (let i = 0; i < losses; i++) await recordSettledTradeForMatrix(trade(TradeOutcome.LOSS, family, regime), USER);
  };

  beforeEach(async () => {
    store = {};
    await hydrateStrategyRegimeMatrix(USER);
  });

  it('is neutral below the minimum sample bar', async () => {
    await fill('trend_following', 'trending', 3, 0);
    expect(familyEdgeFactor('trend_following', 'trending')).toBe(1);
  });

  it('favors a family with ≥60% edge once the bar is met', async () => {
    await fill('trend_following', 'trending', MATRIX_MIN_SAMPLES, 0);
    expect(familyEdgeFactor('trend_following', 'trending')).toBe(MATRIX_FAVOR_FACTOR);
  });

  it('disfavors a family that has decayed to ≤40% in the regime', async () => {
    await fill('mean_reversion', 'ranging', 2, MATRIX_MIN_SAMPLES - 2);
    expect(familyEdgeFactor('mean_reversion', 'ranging')).toBe(MATRIX_AGAINST_FACTOR);
  });

  it('is neutral for unknown family/regime or no evidence', () => {
    expect(familyEdgeFactor(undefined, 'trending')).toBe(1);
    expect(familyEdgeFactor('trend_following', undefined)).toBe(1);
    expect(familyEdgeFactor('nonsense', 'trending')).toBe(1);
  });
});

describe('strategyRegimeMatrix — prompt scoreboard', () => {
  beforeEach(async () => {
    store = {};
    await hydrateStrategyRegimeMatrix(USER);
  });

  it('renders the regime\'s families sorted by evidence, capped', async () => {
    for (let i = 0; i < 5; i++) await recordSettledTradeForMatrix(trade(TradeOutcome.WIN, 'trend_following', 'trending'), USER);
    for (let i = 0; i < 3; i++) await recordSettledTradeForMatrix(trade(TradeOutcome.LOSS, 'mean_reversion', 'trending'), USER);
    const block = matrixSummaryBlock('trending');
    expect(block).toContain('STRATEGY-FAMILY EDGE in trending');
    expect(block).toContain('trend following 100% (5)');
    expect(block).toContain('mean reversion 0% (3)');
    expect(block.indexOf('trend following')).toBeLessThan(block.indexOf('mean reversion'));
  });

  it('is empty when the regime has no evidence', async () => {
    await recordSettledTradeForMatrix(trade(TradeOutcome.WIN, 'trend_following', 'trending'), USER);
    expect(matrixSummaryBlock('ranging')).toBe('');
    expect(matrixSummaryBlock(undefined)).toBe('');
  });
});
