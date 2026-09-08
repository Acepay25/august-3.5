/**
 * Controlled strategy-family vocabulary (Kakushadze & Serur, "151 Trading
 * Strategies" — SSRN 3247865).
 *
 * The book's core transferable idea is that every strategy belongs to a
 * small, named family, and each family behaves differently per market
 * regime. Until this existed, `TradeAnalysis.strategy` was free text, so
 * learning-loop statistics aggregated over strings the models invented —
 * "Trend continuation on pullback" and "pullback continuation (trend)" were
 * different buckets. This enum is the strategy-layer equivalent of what
 * PatternClassificationService already does for candle patterns: a fixed
 * vocabulary the whole harness keys on.
 *
 * Families are capability-agnostic (any provider/model can run any family)
 * and crypto-executable by construction — the book's fixed-income,
 * distressed-debt and tax-arbitrage families are deliberately absent.
 */

export const STRATEGY_FAMILIES = [
  'trend_following',
  'mean_reversion',
  'breakout',
  'range_fade',
  'pairs_stat_arb',
  'volatility',
  'event_driven',
  'market_neutral',
] as const;

export type StrategyFamily = (typeof STRATEGY_FAMILIES)[number];

export const isStrategyFamily = (v: unknown): v is StrategyFamily =>
  typeof v === 'string' && (STRATEGY_FAMILIES as readonly string[]).includes(v);

/**
 * Alias map for the many ways models and users name a family. Keys are the
 * normalized form (lowercase, `_` separators). Deliberately narrow: a value
 * that is neither a family nor a known alias is NOT guessed here — free text
 * goes through `classifyStrategyFamily` (utils/strategyFamily) instead.
 */
const FAMILY_ALIASES: Record<string, StrategyFamily> = {
  momentum: 'trend_following',
  trend: 'trend_following',
  trendfollowing: 'trend_following',
  trend_following: 'trend_following',
  trend_follower: 'trend_following',
  directional: 'trend_following',
  meanreversion: 'mean_reversion',
  mean_reversion: 'mean_reversion',
  mean_reverter: 'mean_reversion',
  reversion: 'mean_reversion',
  mr: 'mean_reversion',
  contrarian: 'mean_reversion',
  breakout: 'breakout',
  break_out: 'breakout',
  breakout_hunter: 'breakout',
  expansion: 'breakout',
  range_fade: 'range_fade',
  rangefade: 'range_fade',
  range_fader: 'range_fade',
  fade: 'range_fade',
  range_trading: 'range_fade',
  pairs: 'pairs_stat_arb',
  pair: 'pairs_stat_arb',
  stat_arb: 'pairs_stat_arb',
  statistical_arbitrage: 'pairs_stat_arb',
  cointegration: 'pairs_stat_arb',
  spread: 'pairs_stat_arb',
  volatility: 'volatility',
  vol: 'volatility',
  event_driven: 'event_driven',
  event: 'event_driven',
  news: 'event_driven',
  catalyst: 'event_driven',
  market_neutral: 'market_neutral',
  delta_neutral: 'market_neutral',
  neutral_basis: 'market_neutral',
  basis: 'market_neutral',
  carry: 'market_neutral',
  arbitrage: 'market_neutral',
};

/** Normalize free-form family text: trim, lowercase, `_` for separators. */
const normalizeKey = (v: string): string =>
  v.trim().toLowerCase().replace(/[\s\-/]+/g, '_').replace(/[^a-z0-9_]/g, '');

/**
 * Resolve anything family-shaped to a `StrategyFamily`: an exact enum value,
 * a known alias, or (via `classify` — injected to keep this module
 * dependency-free) a keyword scan of free text. Returns undefined when the
 * text carries no family signal; callers must NOT coerce to a default, so
 * "unknown" stays visibly unknown instead of polluting family statistics.
 */
export const normalizeStrategyFamily = (
  v: unknown,
  classify?: (text: string) => StrategyFamily | undefined,
): StrategyFamily | undefined => {
  if (typeof v !== 'string') return undefined;
  const key = normalizeKey(v);
  if (!key) return undefined;
  if (isStrategyFamily(key)) return key;
  const aliased = FAMILY_ALIASES[key] ?? FAMILY_ALIASES[key.replace(/_/g, '')];
  if (aliased) return aliased;
  return classify ? classify(v) : undefined;
};
