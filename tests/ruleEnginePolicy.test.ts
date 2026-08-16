import { describe, expect, it } from 'vitest';
import { validateAllRules } from '../services/learning/RuleEngineService';

const analysis = {
  coinName: 'BTCUSDT',
  direction: 'Long',
  confidence: 'Low',
  entryPoints: [{ price: '100' }],
  stopLoss: '90',
  takeProfit: [{ price: '112' }],
} as any;

const hybridData = { regime: { regime: 'trending' } } as any;

const strictLossRule = (overrides: Record<string, unknown> = {}) => ({
  id: 'rule-1',
  ifCondition: 'this setup is active',
  thenAction: 'must require at least 2 R:R',
  sourceTradeId: 'trade-1',
  outcome: 'LOSS',
  useCount: 0,
  constraints: { minRR: 2 },
  isStrictMode: true,
  ...overrides,
});

describe('hybrid rules and skills policy', () => {
  it('keeps a one-off strict post-mortem rule advisory', () => {
    const result = validateAllRules(analysis, hybridData, [strictLossRule()] as any);

    expect(result.adjustedConfidence).toBeNull();
    expect(result.blockingViolations).toBe(false);
    expect(result.warnings.join(' ')).toMatch(/Advisory only/i);
  });

  it('allows repeated confirmed loss evidence to hard-block', () => {
    const result = validateAllRules(
      analysis,
      hybridData,
      [strictLossRule({ status: 'confirmed', wins: 1, losses: 4 })] as any,
    );

    expect(result.adjustedConfidence).toBe('Avoid');
    expect(result.blockingViolations).toBe(true);
    expect(result.errors.join(' ')).toMatch(/RULE VIOLATION/i);
  });
});
