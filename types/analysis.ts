// Trade analysis types

export interface MarketConditions {
  pattern: string;
  candleBehavior: string;
  timeframeAlignment: string;
  rsi: string;
  macd: string;
  sentiment: string;
  prices?: Record<string, string>; // New field for timeframe-specific prices
}

export interface EntryPoint {
  description: string;
  price: string;
}

export interface TakeProfitTarget {
  price: string;
  percentage?: string;
  originalPercentage?: string;
}

export interface PatternDetail {
  name: string;
  timeframe: string;
  type: 'Bullish' | 'Bearish' | 'Neutral';
  confidence?: string;
  description?: string;
}

export interface KeyLevels {
  support: string[];
  resistance: string[];
}

// Devil's Advocate analysis - mandatory section for accuracy
export interface DevilsAdvocateData {
  bearCaseReasons: string[];       // 3 reasons why this trade could fail
  failureScenarios: string[];      // Specific failure scenarios
  crowdedTradeWarning: string | null;  // Funding rate / L/S ratio warning
  riskScore: number;               // 0-100, higher = riskier
}

// =============================================================================
// DUAL SCENARIO ANALYSIS - Bullish vs Bearish evaluation before direction choice
// =============================================================================

/**
 * Definition of a single scenario (bullish or bearish)
 */
export interface ScenarioDefinition {
  trigger: string;           // e.g., "Break above 95500"
  confirmation: string;      // e.g., "4H candle close above level with volume"
  target: string;            // e.g., "97000"
  invalidation: string;      // e.g., "Close below 94500"
}

/**
 * Complete dual scenario analysis from the AI debate
 */
export interface DualScenarioAnalysis {
  bullish: ScenarioDefinition;
  bearish: ScenarioDefinition;
  selectedScenario: 'bullish' | 'bearish' | 'neutral';
  selectionReasoning: string;  // Why this scenario was chosen over the alternative
  confidenceInSelection: number; // 0-100, how confident in the selection
}

export interface TradeAnalysis {
  coinName?: string;
  direction: 'Long' | 'Short' | 'Neutral';
  tradeType?: 'scalp' | 'swing';  // Auto-detected or manually overridden
  tradeTypeManualOverride?: boolean;  // True if user manually set the trade type
  confidence: 'High' | 'Medium' | 'Low' | 'Avoid';
  probability: number;
  grade?: 'A' | 'B' | 'C' | 'D' | 'F'; // Trade setup grade (A=80-95%, B=70-79%, C=55-69%, D=40-54%, F=<40%)
  strategy: string;
  activeStrategies: string[];
  entryPoints: EntryPoint[];
  stopLoss: string;
  stopLossPercentage?: string;
  originalStopLossPercentage?: string;
  takeProfit: TakeProfitTarget[];
  marketConditions: MarketConditions;
  historicalCorrelation: string;
  createdAt?: string; // Timestamp for when the analysis was generated
  rrRatio?: number;
  detectedPatternFamily?: string; // New field for Market Classification Family
  detectedPatterns?: PatternDetail[]; // New: List of specific patterns
  keyLevels?: KeyLevels; // New: Support and Resistance Zones
  isUpdate?: boolean; // NEW: Flag to indicate if this is an updated setup
  updateInterval?: string; // NEW: Time duration string (e.g. "2h 15m") since original setup
  // Accuracy validation fields
  devilsAdvocate?: DevilsAdvocateData; // Devil's advocate analysis
  validationWarnings?: string[]; // Warnings from validation gate
  originalConfidence?: 'High' | 'Medium' | 'Low' | 'Avoid'; // Original confidence before validation adjustments
  // Entry Timing Score (display only, calculated during validation)
  entryTimingScore?: {
    score: number;
    timingQuality: string;
    suggestedEntry?: {
      price: number;
      reason: string;
    } | null;
  };
  // Trade validity window - how long this setup remains valid from createdAt
  validityDurationMinutes?: number; // e.g., 330 = 5h 30m valid from analysis time
  // Gate Keeper result - two-stage scan data
  gateResult?: {
    passed: boolean;
    confidenceCap: number;
    penalties: {
      dataIntegrity: number;
      patternMemory: number;
      htfConflict: number;
      volumeContext: number;
      rawTotal: number;
      effectiveTotal: number;
    };
    familyBias: {
      A: number;
      B: number;
      C: number;
      Omega: number;
      reasoning: string[];
    };
    suggestedDirection?: 'Long' | 'Short' | 'Neutral';
    warnings: string[];
    insights: string[];
  };
  // Dual Scenario Analysis - both bullish and bearish scenarios considered
  dualScenarioAnalysis?: DualScenarioAnalysis;
  // SL/TP Probability Estimation with Reasoning
  levelProbabilities?: LevelProbabilities;
  /**
   * Snapshot of market data at the time of analysis.
   * Type is HybridDataPacket (from HybridIntelligenceService), but using 'unknown' to avoid strict circular dependency.
   */
  marketSnapshot?: unknown;
}

/**
 * Reasoning breakdown for probability estimation
 * Provides transparency into how SL/TP probabilities were calculated
 */
export interface ProbabilityReasoning {
  indicatorBasis: string;        // e.g., "RSI oversold at 28, MACD bullish crossover"
  volatilityFactor: string;      // e.g., "ATR 1.2% - normal volatility, no adjustment"
  patternMemoryInfluence: string; // e.g., "Similar Family C setups: 72% hit TP1"
  aiAdjustments: string;         // e.g., "Reduced TP2 probability due to major resistance"
}

/**
 * Individual probability estimation for a specific take-profit level
 */
export interface TPProbability {
  level: number;                 // e.g., 1 for TP1, 2 for TP2
  probability: number;           // 0-100
  reasoning: ProbabilityReasoning;
}

/**
 * Probability estimation for stop-loss and take-profit levels
 */
export interface LevelProbabilities {
  slProbability: number;         // 0-100, probability of hitting stop-loss
  slReasoning: ProbabilityReasoning; // Explicit reasoning for SL
  tpProbabilities: TPProbability[]; // Dynamic array supporting any number of TPs

  // Legacy fields for backward compatibility
  tp1Probability?: number;
  tp2Probability?: number;
  tp3Probability?: number;
  reasoning?: {
    sl: ProbabilityReasoning;
    tp1: ProbabilityReasoning;
    tp2?: ProbabilityReasoning;
    tp3?: ProbabilityReasoning;
  };
  calculationMode?: 'AI' | 'Algo'; // 'AI' = LLM Reasoning, 'Algo' = Deterministic
}
