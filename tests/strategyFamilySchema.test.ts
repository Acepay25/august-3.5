import { describe, it, expect } from 'vitest';
import { parseTradeAnalysis } from '../schemas/tradeAnalysis';
import { parseMarkdownTradePlan, tradePlanToAnalysis } from '../utils/analysisUtils';

/** Minimal valid-ish raw analysis; override fields per test. */
const rawAnalysis = (overrides: Record<string, unknown> = {}) => ({
  coinName: 'BTCUSDT',
  direction: 'Long',
  confidence: 'Medium',
  probability: 65,
  strategy: 'Breakout',
  entryPoints: [{ price: '95000', description: 'retest' }],
  stopLoss: '94500',
  takeProfit: [{ price: '96000', percentage: '+10%' }],
  ...overrides,
});

describe('parseTradeAnalysis — strategyFamily coercion', () => {
  it('accepts an explicit enum value', () => {
    expect(parseTradeAnalysis(rawAnalysis({ strategyFamily: 'trend_following' })).strategyFamily)
      .toBe('trend_following');
  });

  it('resolves aliases ("momentum" → trend_following)', () => {
    expect(parseTradeAnalysis(rawAnalysis({ strategyFamily: 'momentum' })).strategyFamily)
      .toBe('trend_following');
  });

  it('backfills from the free-text strategy when the field is absent', () => {
    expect(parseTradeAnalysis(rawAnalysis({ strategy: 'Mean reversion fade at the extreme' })).strategyFamily)
      .toBe('mean_reversion');
  });

  it('an unresolvable strategyFamily falls back to classifying the strategy text', () => {
    expect(parseTradeAnalysis(rawAnalysis({ strategyFamily: 'gibberish', strategy: 'delta-neutral carry' })).strategyFamily)
      .toBe('market_neutral');
  });

  it('non-string family values are ignored, not coerced', () => {
    expect(parseTradeAnalysis(rawAnalysis({ strategyFamily: 42, strategy: 'a nice setup today' })).strategyFamily)
      .toBeUndefined();
  });

  it('legacy "Analysis unavailable" default carries no family', () => {
    expect(parseTradeAnalysis(rawAnalysis({ strategy: 'Analysis unavailable' })).strategyFamily)
      .toBeUndefined();
  });
});

describe('parseMarkdownTradePlan — Strategy Family line', () => {
  const planText = `**FINAL TRADE PLAN**

**Setup**
- **Coin:** BTCUSDT
- **Direction:** Long

**Strategy**
- **Strategy:** Trend continuation on pullback
- **Strategy Family:** trend_following
- **Historical Correlation:** Similar to past winning setups
`;

  it('extracts the explicit Strategy Family label', () => {
    const plan = parseMarkdownTradePlan(planText);
    expect(plan?.strategyFamily).toBe('trend_following');
  });

  it('the Strategy label does not steal the Strategy Family line', () => {
    const plan = parseMarkdownTradePlan(planText);
    expect(plan?.strategy).toBe('Trend continuation on pullback');
  });

  it('tradePlanToAnalysis normalizes the family and classifies the fallback', () => {
    const analysis = tradePlanToAnalysis({
      strategy: 'range fade at the boundary',
      strategyFamily: 'momentum',
    } as never);
    // Explicit line wins over the free-text classification.
    expect(analysis.strategyFamily).toBe('trend_following');
    const fallback = tradePlanToAnalysis({ strategy: 'range fade at the boundary' } as never);
    expect(fallback.strategyFamily).toBe('range_fade');
  });

  it('a plan without the family line still gets a family from the strategy text', () => {
    const plan = parseMarkdownTradePlan(`**Strategy**
- **Strategy:** Volatility squeeze expansion
`);
    const analysis = tradePlanToAnalysis(plan!);
    expect(analysis.strategyFamily).toBe('volatility');
  });
});
