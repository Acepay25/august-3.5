// =============================================================================
// Analysis constants — frameworks, pattern-family UI data, ensemble roles.
//
// Provider/model definitions used to live here as hardcoded per-provider
// arrays (GEMINI_MODELS, OCR_MODELS, modelIdToName, ACCURACY_MODE_DEFAULTS…).
// They were removed in the dynamic-provider migration: providers and their
// models are now user-configured (see services/infrastructure/ProviderConfigService.ts
// and utils/providerUtils.ts for display-name helpers).
// =============================================================================

export const DEFAULT_FRAMEWORKS = [
   'Gap Trading',
   'Momentum Trading',
   'Reversal Trading',
   'Range Trading',
   'Positional Trading',
   'Mean Reversion Trading',
];

export const FAMILY_UI_DATA = [
   {
      id: 'family-a',
      name: 'Family A',
      tag: 'Reversal Trap',
      color: 'red',
      nickname: 'Exhaustion / Failure Family',
      personality: 'Market is losing strength, likely to reverse, or produce sudden trap moves.',
      features: [
         'RSI overstretched then collapsing',
         'MACD momentum sharply fading',
         'EMA stack flattening',
         'Big wick rejection candles',
         'Volume spike followed by immediate retrace',
         'Liquidity grab before reversal'
      ],
      tendency: 'Low win rate for continuation setups. Higher probability of reversal or SL hunt.',
      examples: 'Fake breakout, SFP, V-Top'
   },
   {
      id: 'family-b',
      name: 'Family B',
      tag: 'Trend Shift',
      color: 'emerald',
      nickname: 'Directional Flip Family',
      personality: 'Market is preparing to flip bias from uptrend to downtrend or vice versa.',
      features: [
         'RSI crossing 50 decisively',
         'MACD cross + multi-bar confirmation',
         'EMA 13/20/50 flipping alignment',
         'SAR flip with follow-through',
         'Break of structure (BOS) + retest'
      ],
      tendency: 'Strong moves, but must confirm structure shift. Win rate improves with high-volume confirmation.',
      examples: 'Trend reversal, early cycle start'
   },
   {
      id: 'family-c',
      name: 'Family C',
      tag: 'Continuation',
      color: 'blue',
      nickname: 'Omega Continuation Family',
      personality: 'Market already trending and simply continuing the move. This is the family where you get your highest probability trades.',
      features: [
         'Strong EMA alignment (5 > 13 > 20 > 50 for uptrend)',
         'RSI between 55–70 (healthy)',
         'MACD green histogram rising',
         'Compression breakout → retest → follow-through',
         'Micro pullbacks respecting EMAs'
      ],
      tendency: 'Highest win rate (~86%). Source of most profitable trades.',
      examples: 'ETH Long #2, LINK Long, GRASS Long'
   },
   {
      id: 'family-omega',
      name: 'Family Omega',
      tag: 'High-Vol Expansion',
      color: 'purple',
      nickname: 'Momentum Burst Family',
      personality: 'Trend becomes extremely strong and accelerates violently.',
      features: [
         'RSI 65–88 (no reversal signs)',
         'MACD vertical expansion',
         'EMAs extremely spread out',
         'Parabolic SAR with wide gaps',
         'Volume continuously rising',
         'Each pullback is shallow and bought aggressively'
      ],
      tendency: 'Very high continuation probability. Requires wider SL. Failures lead to violent reversals.',
      examples: 'ETH extreme volatility runs, BTC post-crash retest'
   }
];

/**
 * Human-readable labels for each role (used in UI and debate transcript)
 */
export const ENSEMBLE_ROLE_LABELS: Record<string, string> = {
   technical_structure: '📊 Technical Structure',
   market_context: '🌐 Market Context',
   risk_management: '⚠️ Risk Management'
};

/**
 * Maps roles to specific rules that should be injected.
 * Only role-relevant rules are injected to avoid information overload.
 */
export const ROLE_RULE_INJECTION: Record<string, string[]> = {
   technical_structure: [],
   market_context: ['REGIME_TRADING_RULES', 'STRESS_TEST_PROTOCOL', 'DEVILS_ADVOCATE_PROMPT'],
   risk_management: ['RISK_MANAGEMENT_RULES', 'STRESS_TEST_PROTOCOL', 'DEVILS_ADVOCATE_PROMPT']
};
