
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

export const MASTER_TRADE_PLAN_JSON_SCHEMA = `{
      "coinName": "BTCUSDT",
      "direction": "Long/Short",
      "entryPoints": [{ "price": "95000", "description": "Support retest" }],
      "stopLoss": "94500",
      "takeProfit": [{ "price": "96000", "percentage": "2%" }, { "price": "97000", "percentage": "4%" }],
      "confidence": "Medium",
      "probability": 65,
      "strategy": "Trend continuation on pullback",
      "historicalCorrelation": "Similar to past winning setups",
      "marketConditions": { 
          "pattern": "Bull Flag", 
          "candleBehavior": "Higher lows forming", 
          "timeframeAlignment": "3 of 4 bullish", 
          "rsi": "55", 
          "macd": "Bullish crossover", 
          "sentiment": "Neutral",
          "prices": { "5m": "95100", "15m": "95050", "1h": "95000", "4h": "94800" }
      },
      "detectedPatterns": [
          { "name": "Bull Flag", "timeframe": "1h", "type": "Bullish", "confidence": "High", "description": "Consolidating above support" }
      ],
      "keyLevels": {
          "support": ["94500 (4h)", "94000 (1h)"],
          "resistance": ["96000 (4h)", "97000 (1h)"]
      },
      "detectedPatternFamily": "Family C",
      "levelProbabilities": {
          "slProbability": 25,
          "slReasoning": { "indicatorBasis": "RSI/MACD alignment", "volatilityFactor": "ATR within normal range", "patternMemoryInfluence": "Similar setups had 25% SL hit rate", "aiAdjustments": "None" },
          "tpProbabilities": [
              { "level": 1, "probability": 70, "reasoning": { "indicatorBasis": "Strong momentum", "volatilityFactor": "Close target", "patternMemoryInfluence": "70% hit rate historically", "aiAdjustments": "+5% for trend strength" } },
              { "level": 2, "probability": 55, "reasoning": { "indicatorBasis": "Moderate resistance", "volatilityFactor": "Normal range", "patternMemoryInfluence": "55% hit rate", "aiAdjustments": "None" } },
              { "level": 3, "probability": 35, "reasoning": { "indicatorBasis": "Major resistance zone", "volatilityFactor": "Extended target", "patternMemoryInfluence": "35% hit rate", "aiAdjustments": "-10% for distance" } }
          ]
      }
   }`;

export const PURE_AI_TRADE_PLAN_JSON_SCHEMA = `{
   "coinName": "BTCUSDT",
   "direction": "Long",
   "entryPoints": [{ "price": "95000", "description": "Key support level" }],
   "stopLoss": "94500",
   "takeProfit": [{ "price": "96000", "percentage": "2%" }, { "price": "97000", "percentage": "4%" }],
   "confidence": "Medium",
   "probability": 65,
   "strategy": "Pure AI trend analysis",
   "historicalCorrelation": "N/A - Pure AI Mode",
   "marketConditions": { 
       "pattern": "Custom structure identified", 
       "candleBehavior": "Bullish momentum", 
       "timeframeAlignment": "Mixed signals", 
       "rsi": "55", 
       "macd": "Bullish", 
       "sentiment": "Neutral",
       "prices": { "5m": "95100", "15m": "95050", "1h": "95000", "4h": "94800" }
   },
   "detectedPatterns": [
       { "name": "Custom Pattern", "timeframe": "1h", "type": "Bullish", "confidence": "Medium", "description": "AI-identified structure" }
   ],
   "keyLevels": {
       "support": ["94500 (4h)", "94000 (1h)"],
       "resistance": ["96000 (4h)", "97000 (1h)"]
   },
   "detectedPatternFamily": "Pure AI Analysis",
   "levelProbabilities": {
       "slProbability": 25,
       "slReasoning": { "indicatorBasis": "AI momentum analysis", "volatilityFactor": "ATR assessment", "patternMemoryInfluence": "N/A - Pure AI", "aiAdjustments": "AI confidence adjustment" },
       "tpProbabilities": [
           { "level": 1, "probability": 70, "reasoning": { "indicatorBasis": "Strong target identification", "volatilityFactor": "Close target", "patternMemoryInfluence": "N/A - Pure AI", "aiAdjustments": "AI pattern recognition" } },
           { "level": 2, "probability": 55, "reasoning": { "indicatorBasis": "Extended target analysis", "volatilityFactor": "Normal range", "patternMemoryInfluence": "N/A - Pure AI", "aiAdjustments": "Distance penalty" } }
       ]
   }
}`;

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
    "total": 0.15
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
