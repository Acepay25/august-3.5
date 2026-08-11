
/**
 * CENTRALIZED JSON SCHEMAS
 * 
 * These schemas are injected into system prompts to ensure consistent output formats
 * across different AI models and modes.
 */

export const DUAL_SCENARIO_JSON_SCHEMA = `{
  "dualScenarioAnalysis": {
    "bullish": { "trigger": "95500", "confirmation": "4H close above with volume", "target": "97000", "invalidation": "94500" },
    "bearish": { "trigger": "94000", "confirmation": "4H close below", "target": "92000", "invalidation": "95500" },
    "selectedScenario": "bullish",
    "selectionReasoning": "HTF trend bullish, volume supporting breakout, Pattern Memory shows 70% win rate in similar setups",
    "confidenceInSelection": 75
  }
}`;

/**
 * The moderator's final trade plan — MARKDOWN ONLY (no JSON anywhere in the
 * output contract). Carries EVERY field the old JSON schema carried, organized
 * in labeled sections that `parseMarkdownTradePlan` extracts deterministically.
 * The block itself renders as the card's strategy markdown, so what the model
 * writes IS what the user sees.
 */
export const MASTER_TRADE_PLAN_MARKDOWN = `**FINAL TRADE PLAN**

**Setup**
- **Coin:** BTCUSDT
- **Direction:** Long
- **Grade:** B
- **Pattern Family:** Family C
- **Validity Window:** 4h

**Levels**
- **Entry:** 95000 — Key support retest
- **Stop Loss:** 94500
- **Take Profit 1:** 96000 (2%)
- **Take Profit 2:** 97000 (4%)
- **Take Profit 3:** 98500 (6%)

**Odds**
- **Confidence:** Medium
- **Probability:** 65%
- **SL Probability:** 25%
- **TP1 Probability:** 70%
- **TP2 Probability:** 55%
- **TP3 Probability:** 35%

**Strategy**
- **Strategy:** Trend continuation on pullback
- **Historical Correlation:** Similar to past winning setups

**Market Conditions**
- **Pattern:** Bull Flag
- **Candle Behavior:** Higher lows forming
- **Timeframe Alignment:** 3 of 4 bullish
- **RSI:** 55
- **MACD:** Bullish crossover
- **Sentiment:** Neutral
- **Prices:** 5m 95100 · 15m 95050 · 1h 95000 · 4h 94800

**Detected Patterns**
- **Pattern 1:** Bull Flag (1h, bullish, high confidence) — Consolidating above support

**Key Levels**
- **Support:** 94500 (4h), 94000 (1h)
- **Resistance:** 96000 (4h), 97000 (1h)

**Dual Scenario**
- **Bullish Trigger:** 95500 — 4H close above with volume
- **Bullish Target:** 97000
- **Bullish Invalidation:** 94500
- **Bearish Trigger:** 94000 — 4H close below
- **Bearish Target:** 92000
- **Bearish Invalidation:** 95500
- **Selected Scenario:** Bullish — HTF trend bullish, volume supports breakout
- **Scenario Confidence:** 75%

**Invalidation Criteria**
- **Invalidation 1:** 94500 (price) — 4H close below support — Bullish thesis dead
- **Invalidation 2:** 5h30m (time) — No breakout before validity expiry

**Devil's Advocate**
- **Bear Case:** Liquidity sweep risk below entry
- **Failure Scenarios:** Wick through 94500 before reversal
- **Crowded Trade Warning:** Funding elevated — long crowd
- **Risk Score:** 45

**Evidence**
- **Evidence 1:** 1H structure bullish (HH/HL) with EMA20/50 aligned — observed — sources: 1H EMA20/50, RSI(14) 58
- **Evidence 2:** Volume confirms the breakout — partial — sources: Volume 1.8x 20-period average`;

export const GATE_SCAN_JSON_SCHEMA = `{
  "symbol": "BTCUSDT",
  "pass": true,
  "reason": "Passed with 15% confidence reduction",
  "allowedFamilies": ["A", "B", "C", "Omega"],
  "confidenceCap": 0.85,
  "confidencePenalties": {
    "dataIntegrity": 0.00,
    "patternMemory": 0.15,
    "htfConflict": 0.00,
    "volumeContext": 0.00,
    "rawTotal": 0.15,
    "effectiveTotal": 0.15
  },
  "warnings": ["Pattern Memory: 75% similar to failed Long"],
  "insights": ["Strong trend continuation potential"],
  "suggestedDirection": "Short",
  "patternRecall": {
      "similarTradeId": "TX-102",
      "outcome": "LOSS",
      "similarity": 75,
      "lesson": "Don't chase breakouts in low volume"
  }
}`;
