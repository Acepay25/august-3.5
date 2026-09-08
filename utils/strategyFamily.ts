/**
 * Deterministic keyword classifier: free text → StrategyFamily.
 *
 * This is the bridge that lets the controlled vocabulary work on LEGACY
 * data and on models that ignore the enum: every free-text `strategy`
 * string (old logged trades, verdict prose, plan lines) is scored against
 * per-family keyword lists and assigned the best-matching family — or
 * undefined when nothing matches, so unknown stays unknown.
 *
 * Pure and synchronous by design: it runs inside schema coercion (every
 * parseTradeAnalysis) and inside retrieval ranking, so it must never throw,
 * never await, and never hallucinate a family for empty input.
 */

import { StrategyFamily, STRATEGY_FAMILIES } from '../types/strategy';

/**
 * Keyword lists per family. Multi-word phrases are matched as substrings of
 * the lowercased, separator-normalized text. Order of STRATEGY_FAMILIES is
 * the tie-break priority (earlier wins) — trend_following first because
 * crypto verdict prose leans directional and over-claims momentum.
 */
const FAMILY_KEYWORDS: Record<StrategyFamily, string[]> = {
  trend_following: [
    'trend', 'momentum', 'continuation', 'pullback', 'higher high', 'higher low',
    'lower low', 'ema cross', 'moving average', 'ride the', 'with the trend',
    'golden cross', 'death cross', 'adx', 'trendline', 'structure bias',
  ],
  mean_reversion: [
    'mean reversion', 'reversion', 'oversold', 'overbought', 'snap back',
    'rubber band', 'stretch', 'extended', 'vwap', 'bollinger', 'z score',
    'deviation from mean', 'retrace', 'reversion to', 'counter trend',
    'countertrend', 'against the trend',
  ],
  breakout: [
    'breakout', 'break out', 'break of structure', 'bos', 'range high',
    'range low', 'level break', 'breaks above', 'breaks below', 'fakeout',
    'sweep', 'liquidity grab', 'expansion break',
  ],
  range_fade: [
    'fade', 'chop', 'sell the rip', 'buy the dip', 'boundary',
    'resistance sell', 'support buy', 'oscillat', 'no trend', 'sideways',
    'range trading', 'range top', 'range bottom', 'within range', 'trading range',
  ],
  pairs_stat_arb: [
    'pair', 'spread', 'cointegration', 'relative value', 'relative strength',
    'stat arb', 'ratio trade', 'eth btc ratio', 'divergence between',
  ],
  volatility: [
    'volatility', 'vol squeeze', 'squeeze', 'implied vol', 'iv rank',
    'straddle', 'strangle', 'vol expansion', 'vol regime', 'atr expansion',
  ],
  event_driven: [
    'news', 'event', 'listing', 'halving', 'etf approval', 'liquidation cascade',
    'unlock', 'sell the news', 'catalyst', 'funding round', 'upgrade', 'fork',
  ],
  market_neutral: [
    'market neutral', 'delta neutral', 'basis', 'funding rate', 'carry',
    'hedge', 'hedged', 'perp spot', 'cash and carry', 'arbitrage',
  ],
};

const normalizeText = (text: string): string =>
  ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;

/**
 * Score every family by keyword hits in `text` and return the best, or
 * undefined when no keyword matches. Longer phrases score more (a hit on
 * "mean reversion" outweighs a stray "reversion"), and a family only wins
 * if it has at least one hit.
 */
export const classifyStrategyFamily = (text: string | undefined | null): StrategyFamily | undefined => {
  if (!text || typeof text !== 'string') return undefined;
  const hay = normalizeText(text);
  if (hay.trim().length === 0) return undefined;
  let best: StrategyFamily | undefined;
  let bestScore = 0;
  for (const family of STRATEGY_FAMILIES) {
    let score = 0;
    for (const kw of FAMILY_KEYWORDS[family]) {
      const needle = ` ${kw.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
      // Substring match with padded boundaries so "range" does not match
      // inside "exchange"; count each distinct keyword at most once.
      if (hay.includes(needle)) score += kw.includes(' ') ? 2 : 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = family;
    }
  }
  return best;
};
