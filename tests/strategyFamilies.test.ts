import { describe, it, expect } from 'vitest';
import { classifyStrategyFamily } from '../utils/strategyFamily';
import { normalizeStrategyFamily, isStrategyFamily, STRATEGY_FAMILIES } from '../types/strategy';

describe('classifyStrategyFamily — keyword scoring', () => {
  it.each([
    ['Trend continuation on pullback', 'trend_following'],
    ['momentum ride with the HTF trend', 'trend_following'],
    ['Mean reversion fade of stretched RSI', 'mean_reversion'],
    ['snap back to VWAP after the stretch', 'mean_reversion'],
    ['Breakout of the compressed range on volume', 'breakout'],
    ['fakeout sweep of the liquidity pocket', 'breakout'],
    ['Range trading: fade the boundary', 'range_fade'],
    ['sell the rip sideways chop', 'range_fade'],
    ['ETH/BTC spread dislocation, stat arb', 'pairs_stat_arb'],
    ['Volatility squeeze expansion play', 'volatility'],
    ['news-driven listing pump', 'event_driven'],
    ['delta-neutral funding carry', 'market_neutral'],
  ])('classifies "%s" → %s', (text, expected) => {
    expect(classifyStrategyFamily(text)).toBe(expected);
  });

  it('prefers mean reversion over trend on "counter-trend fade"', () => {
    expect(classifyStrategyFamily('counter-trend fade at the extreme')).toBe('mean_reversion');
  });

  it('does not let a bare "range" steal a breakout description', () => {
    expect(classifyStrategyFamily('range breakout with volume expansion')).toBe('breakout');
  });

  it('returns undefined when no keyword matches — unknown stays unknown', () => {
    expect(classifyStrategyFamily('a nice setup today')).toBeUndefined();
    expect(classifyStrategyFamily('')).toBeUndefined();
    expect(classifyStrategyFamily(undefined)).toBeUndefined();
    expect(classifyStrategyFamily(null)).toBeUndefined();
  });

  it('never returns a family outside the controlled vocabulary', () => {
    for (const text of ['trend', 'fade', 'basis', 'squeeze', 'random']) {
      const fam = classifyStrategyFamily(text);
      if (fam !== undefined) expect(STRATEGY_FAMILIES).toContain(fam);
    }
  });
});

describe('normalizeStrategyFamily — enum, aliases, free text', () => {
  it('accepts exact enum values', () => {
    for (const fam of STRATEGY_FAMILIES) {
      expect(normalizeStrategyFamily(fam)).toBe(fam);
    }
  });

  it('maps common aliases', () => {
    expect(normalizeStrategyFamily('momentum')).toBe('trend_following');
    expect(normalizeStrategyFamily('Momentum')).toBe('trend_following');
    expect(normalizeStrategyFamily('Trend-Follower')).toBe('trend_following');
    expect(normalizeStrategyFamily('stat-arb')).toBe('pairs_stat_arb');
    expect(normalizeStrategyFamily('Stat Arb')).toBe('pairs_stat_arb');
    expect(normalizeStrategyFamily('carry')).toBe('market_neutral');
    expect(normalizeStrategyFamily('contrarian')).toBe('mean_reversion');
  });

  it('falls through to the classifier for free text', () => {
    expect(normalizeStrategyFamily('trend continuation on pullback', classifyStrategyFamily))
      .toBe('trend_following');
  });

  it('returns undefined for non-strings and family-less text', () => {
    expect(normalizeStrategyFamily(42)).toBeUndefined();
    expect(normalizeStrategyFamily(undefined)).toBeUndefined();
    expect(normalizeStrategyFamily('a nice setup today', classifyStrategyFamily)).toBeUndefined();
  });

  it('isStrategyFamily guards the vocabulary', () => {
    expect(isStrategyFamily('breakout')).toBe(true);
    expect(isStrategyFamily('Breakout')).toBe(false);
    expect(isStrategyFamily('arbitrage')).toBe(false);
  });
});
