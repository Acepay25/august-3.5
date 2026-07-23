// Types definition

export enum MessageRole {
  USER = 'user',
  AI = 'ai',
  SYSTEM = 'system',
}

export enum TradeOutcome {
  WIN = 'WIN',
  LOSS = 'LOSS',
  PENDING = 'PENDING',
  ENTRY_NOT_HIT = 'ENTRY_NOT_HIT', // Entry price was never reached
  SKIPPED = 'SKIPPED',           // User chose not to take the trade
}

export enum AIProvider {
  GEMINI = 'gemini',
  DEEPSEEK = 'deepseek',
  ZHIPU = 'zhipu',
  GROQ = 'groq',
  GROQ_NEW = 'groq_new',
  GROQ_ALT2 = 'groq_alt2',
  OPENROUTER = 'openrouter',
  OPENAI = 'openai',
  GROK = 'grok',
}

// =============================================================================
// ANALYST LENS TYPES - Specialized roles for 3-analyst ensemble debates
// =============================================================================

/**
 * Analyst roles for specialized ensemble debates.
 * Each role focuses on a specific analytical domain.
 */
export enum AnalystRole {
  MACRO_VOLATILITY = 'macro_volatility',   // Macro & Volatility Analyst
  TECHNICAL_ANALYST = 'technical_analyst', // Technical Analyst (Patterns/SMC/Indicators)
  RISK_EXECUTION = 'risk_execution',       // Risk & Execution Specialist (Devil's Advocate)
  UNASSIGNED = 'unassigned',               // No special role, default behavior
}

/**
 * User's role assignment configuration.
 * Maps a role to a specific AI provider.
 */
export interface AnalystRoleAssignment {
  role: AnalystRole;
  assignedProvider: AIProvider | null;
  assignedModel?: string;  // Optional specific model override
}

/**
 * Trading style for analyst lenses
 * - position: Long-term position trades (Daily/Weekly focus)
 * - swing: Standard swing/intraday trading (4H/Daily focus)
 * - scalp: Quick scalp trades (1m/5m/15m focus)
 * - auto: Automatically detect based on market conditions
 */
export type TradingStyle = 'position' | 'swing' | 'scalp' | 'auto';

/**
 * Full configuration for analyst lenses.
 */
export interface AnalystLensConfig {
  enabled: boolean;
  assignments: AnalystRoleAssignment[];
  tradingStyle: TradingStyle;  // Trading style mode
}

export interface DebateTurn {
  speaker: 'Gemini' | 'DeepSeek' | 'Zhipu' | 'Groq' | 'Groq (Alt)' | 'Groq (Alt 2)' | 'OpenRouter' | 'OpenAI' | 'Claude' | 'GPT' | 'Grok' | 'Moderator';
  text: string;
}

export interface Kline {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Message {
  id: string;
  role: MessageRole;
  text: string;
  createdAt: string; // ISO string timestamp for when the message was created
  images?: string[];
  imageSummaries?: string[];
  analysis?: TradeAnalysis;
  sources?: GroundingChunk[];
  postMortem?: string;
  postMortemCreatedAt?: string; // Timestamp for post-mortem analysis
  postMortemImages?: string[]; // To store screenshots from the post-mortem upload
  postMortemDebateTurns?: DebateTurn[]; // NEW: Holds the debate for the post-mortem
  outcome?: TradeOutcome;
  ocrModelUsed?: string;
  correctedEntry?: string; // To store the user-provided correct entry price
  correctedStopLoss?: string; // To store user-provided corrected stop loss
  correctedTakeProfit?: string; // To store user-provided corrected take profit
  // Ensemble fields
  geminiModelUsed?: string;
  deepseekModelUsed?: string;
  zhipuModelUsed?: string;
  groqModelUsed?: string;
  groqNewModelUsed?: string;
  groqAlt2ModelUsed?: string;
  openrouterModelUsed?: string;
  grokNativeModelUsed?: string;

  isDebating?: boolean; // Flag for showing the debate UI
  debateTurns?: DebateTurn[]; // Holds the live debate conversation
  // Individual thought processes for ensemble pre-synthesis display
  geminiThoughtProcess?: string;
  deepseekThoughtProcess?: string;
  zhipuThoughtProcess?: string;
  groqThoughtProcess?: string;
  groqNewThoughtProcess?: string;
  groqAlt2ThoughtProcess?: string;
  openrouterThoughtProcess?: string;
  grokNativeThoughtProcess?: string;

  // Mode Tracking
  isAccuracyMode?: boolean;
  isLensMode?: boolean; // Was this analysis created with Analyst Lenses enabled?
  tradingStyle?: Exclude<TradingStyle, 'auto'>; // Trading style used for this analysis
  accuracySubMode?: AccuracySubMode;
  isPostMortem?: boolean; // Flag to identify if this message is a Post-Mortem Analysis bubble
  // Data for retrying a failed post-mortem analysis
  postMortemFailedCandidate?: {
    message: Message;
    outcome: TradeOutcome;
    feedback: {
      pnlAmount?: number;
      correctedEntry?: string;
      correctedStopLoss?: string;
      correctedTakeProfit?: string;
    };
    summaries?: string[];
    imageUrls?: string[];
  };
  // Multi-Timeframe Confluence Score from Hybrid Intelligence
  confluenceData?: ConfluenceData;
}

export interface ImageMetadata {
  file: File;
  dataURL: string;
  summary?: string; // This will now be the minimal UI string
  fullAnalysisText?: string; // This will hold the full analysis payload text
  isLoading: boolean;
  ocrModelUsed?: string;
}

// Multi-Timeframe Confluence Data for UI display
export interface ConfluenceData {
  score: number;  // 0-100
  direction: 'bullish' | 'bearish' | 'neutral';
  strength: 'strong' | 'moderate' | 'weak';
  alignedSignals: string[];
  conflictingSignals: string[];
  timeframeCount: number;
}

// Dashboard Statistics for Win Rate Dashboard
export interface DashboardStats {
  winRate: number;
  totalTrades: number;
  wins: number;
  losses: number;
  totalPnL: number;
  avgWinSize: number;
  avgLossSize: number;
  profitFactor: number;
  currentStreak: { type: 'win' | 'loss'; count: number };
  bestWinStreak: number;
  worstLossStreak: number;
}

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

export interface LoggedTrade {
  id: string;
  analysis: TradeAnalysis;
  tradeType?: 'scalp' | 'swing';  // Denormalized for filtering/stats
  outcome: TradeOutcome;
  timestamp: string;
  leverage?: number;
  postMortem?: string;
  postMortemCreatedAt?: string; // Timestamp for post-mortem analysis
  postMortemImages?: string[]; // To store screenshots from the post-mortem upload
  correctedEntry?: string;
  correctedStopLoss?: string;
  correctedTakeProfit?: string;
  investmentAmount?: number;
  pnlAmount?: number;
  marketSnapshot?: unknown; // Stored market context for algorithmic recalculation
  // Ensemble fields
  geminiModelUsed?: string;
  deepseekModelUsed?: string;
  zhipuModelUsed?: string;
  groqModelUsed?: string;
  groqNewModelUsed?: string;
  groqAlt2ModelUsed?: string;
  openrouterModelUsed?: string;

  ocrModelUsed?: string;
  moderatorProvider?: AIProvider;
  moderatorModel?: string;
  // Individual thought processes
  geminiThoughtProcess?: string;
  deepseekThoughtProcess?: string;
  zhipuThoughtProcess?: string;
  groqThoughtProcess?: string;
  groqNewThoughtProcess?: string;
  groqAlt2ThoughtProcess?: string;
  openrouterThoughtProcess?: string;

  // Mode Tracking
  isAccuracyMode?: boolean;
  accuracySubMode?: AccuracySubMode;
  /**
   * Indicates if this trade hit the 150% extended SL zone.
   * true = hit 150% zone (REAL LOSS in live trading)
   * undefined/false = normal SL behavior
   */
  extendedSLZoneBreach?: boolean;
  /**
   * Market regime at time of trade for accurate performance tracking.
   */
  marketRegime?: 'trending' | 'ranging' | 'volatile' | 'compression';
  /**
   * Post-mortem insight quality scores per provider (0-100).
   * Used to track which models provide actionable post-mortem insights.
   */
  postMortemProviderScores?: Record<string, number>;
  /**
   * SL Optimization Data - tracks stop loss behavior for optimization.
   * Populated when trade outcome is recorded with price data.
   */
  slOptimizationData?: {
    slWasTouched: boolean;             // Did price touch original SL?
    extendedZoneBreached: boolean;     // Exceeded 150% zone?
    missedWinDueToTightSL: boolean;    // Would have won with wider SL?
    maxAdverseExcursion: number;       // Max price movement against position (%)
    minSlDistanceNeeded?: number;      // If missed win, what SL % would have saved it
    atrMultiplierUsed: number;         // ATR multiplier of original SL
  };
  /**
   * Indices of which entry points were actually triggered/filled.
   * When trade has multiple entries, tracks which one(s) the user confirmed were hit.
   * Example: [0] = Entry 1 only, [1] = Entry 2 only, [0, 1] = Both entries filled.
   */
  triggeredEntryIndices?: number[];
}

export interface GroundingChunk {
  web: {
    uri: string;
    title: string;
  };
}

export interface StrategySearchResult {
  name: string;
  description: string;
  rationale?: string;
  backtestData?: string;
  pitfalls?: string;
  implementationSteps?: string[];
}

export interface SavedAnalysis {
  id: string; // Corresponds to the message ID of the analysis
  analysis: TradeAnalysis;
  userPrompt: string;
  timestamp: string;
  geminiModelUsed?: string;
  deepseekModelUsed?: string;
  zhipuModelUsed?: string;
  groqModelUsed?: string;
  groqNewModelUsed?: string;
  groqAlt2ModelUsed?: string;

  ocrModelUsed?: string;
  moderatorProvider?: AIProvider;
  moderatorModel?: string;
}

export interface GlobalMemory {
  totalTradesAnalyzed: number;
  familyPerformance: Record<string, string>;
  aiPatternMemory: string[];
  userPreferences: {
    leverageDefault: number;
    favoriteAssets: string[];
    preferredSetup: string;
  };
  globalCorrections: string[];
  insightKnowledgeBase?: InsightKnowledgeBase; // New: Structured insights knowledge base
  lastUpdated: string;
}

export interface TradeContextSummary {
  tradeId: string;
  asset: string;
  direction: string;
  entry: string;
  stopLoss: string;
  takeProfit: string[];
  outcome: string;
  leverage: number;
  aiInsights: Record<string, string>;
  postMortem?: { reason: string; corrections: string };
  family?: string;
  timestamp: string;
}

export interface Conversation {
  id: string;
  timestamp: number;
  title?: string;
  messages: Message[];
  threadSummary?: string; // Layer 2: Compressed Conversation Summary
  geminiModel: string;
  deepseekModel: string;
  zhipuModel: string;
  groqModel: string;
  groqNewModel: string;
  groqAlt2Model: string;

  openrouterModel: string;
  openaiModel: string;
  grokNativeModel: string;

  ocrModel: string;
  isGeminiEnabled: boolean;
  isDeepSeekEnabled: boolean;
  isZhipuEnabled: boolean;
  isGroqEnabled: boolean;
  isGroqNewEnabled: boolean;
  isGroqAlt2Enabled: boolean;

  isOpenrouterEnabled: boolean;
  isOpenaiEnabled: boolean;
  isGrokNativeEnabled: boolean;
  moderatorProvider: AIProvider;
  moderatorModel: string;
  leverage: number;
}

export type AccuracySubMode = 'original' | 'pure_ai';

export interface CustomInstruction {
  id: string;
  title: string;
  content: string;
  isActive: boolean;
}

export interface CustomInstructionsMap {
  general: CustomInstruction[];
  accuracyOriginal: CustomInstruction[];
  accuracyPure: CustomInstruction[];
}

// Confidence Calibration - tracks actual outcomes per AI confidence level

/**
 * Individual calibration entry for time-decay calculations.
 * Each logged trade creates a new entry to enable recency weighting.
 */
export interface CalibrationEntry {
  timestamp: string;  // ISO string when trade was logged
  confidence: 'High' | 'Medium' | 'Low' | 'Avoid';
  outcome: 'WIN' | 'LOSS';
}

/**
 * Extended calibration entry with granular tracking dimensions.
 * Tracks accuracy by coin, pattern, timeframe, regime, and AI provider.
 */
/**
 * Trading session based on UTC time
 * - Asian: 00:00-08:00 UTC (Tokyo/Singapore)
 * - London: 08:00-16:00 UTC
 * - New York: 13:00-21:00 UTC
 * - Overlap: 13:00-16:00 UTC (London/NY overlap - highest volume)
 */
export type TradingSession = 'asian' | 'london' | 'new_york' | 'overlap';

export interface GranularCalibrationEntry extends CalibrationEntry {
  coin?: string;                    // e.g., "BTCUSDT"
  pattern?: string;                 // e.g., "Family C", "Bull Flag"
  timeframe?: string;               // e.g., "1h", "4h"
  regime?: 'trending' | 'ranging' | 'volatile' | 'compression';
  provider?: AIProvider;            // Which AI made this prediction
  session?: TradingSession;         // Trading session when trade was taken
}

/**
 * Provider-specific calibration stats
 */
export interface ProviderCalibration {
  [providerId: string]: ConfidenceCalibrationStats;
}

/**
 * Granular calibration data for multi-dimensional accuracy tracking
 */
export interface GranularCalibration {
  byCoin: { [coin: string]: ConfidenceCalibrationStats };
  byPattern: { [pattern: string]: ConfidenceCalibrationStats };
  byTimeframe: { [tf: string]: ConfidenceCalibrationStats };
  byRegime: { [regime: string]: ConfidenceCalibrationStats };
  byProvider: ProviderCalibration;
  bySession: { [session: string]: ConfidenceCalibrationStats }; // Asian/London/NY/Overlap
  byDayOfWeek: { [day: string]: ConfidenceCalibrationStats };   // Monday, Tuesday, etc.
}

/**
 * Correlation risk assessment result
 */
export interface CorrelationRiskResult {
  btcDominance: number;             // Current BTC dominance %
  btcDominanceTrend: 'rising' | 'falling' | 'stable';
  btcAtMajorLevel: boolean;
  btcLevelType: 'support' | 'resistance' | 'none';
  btcLevelPrice: number | null;
  correlationRiskScore: number;     // 0-100, higher = more risk
  warnings: string[];
}

/**
 * Backtest simulation result for a trade signal
 */
export interface BacktestResult {
  wouldHaveTriggered: boolean;      // Did price reach entry?
  outcome: 'WIN' | 'LOSS' | 'NOT_TRIGGERED';
  hitTarget: 'TP1' | 'TP2' | 'TP3' | 'SL' | 'NONE';
  maxDrawdown: number;              // % drawdown during trade
  timeToOutcome: number;            // Candles until outcome
  priceAtExit: number;
  simulationDetails: string;
}

export interface ConfidenceCalibrationStats {
  wins: number;
  losses: number;
  total: number;
}

export interface ConfidenceCalibration {
  high: ConfidenceCalibrationStats;
  medium: ConfidenceCalibrationStats;
  low: ConfidenceCalibrationStats;
  avoid: ConfidenceCalibrationStats;
  lastUpdated?: string;
  /**
   * Individual timestamped entries for time-decay calibration.
   * Used by getCalibratedWinRateWithDecay() to weight recent trades more heavily.
   */
  entries?: CalibrationEntry[];
  /**
   * Granular calibration data for multi-dimensional accuracy tracking.
   * Tracks accuracy by coin, pattern, timeframe, regime, and provider.
   */
  granular?: GranularCalibration;
  /**
   * Extended entries with granular dimensions for detailed analysis.
   */
  granularEntries?: GranularCalibrationEntry[];
}

export interface UserSettings {
  activeFrameworks: string[];
  summaryCharLimit?: number;
  summarizationProvider?: AIProvider;
  summarizationModel?: string;
  isGlobalMemoryEnabled?: boolean; // Layer 3 Toggle
  isAccuracyModeEnabled?: boolean; // Accuracy Mode Toggle
  accuracySubMode?: AccuracySubMode; // Sub-mode selection
  customInstructions?: CustomInstructionsMap; // User-defined behavior overrides per mode
  isPlaybookEnabledInPureAI?: boolean; // Toggle playbook in Pure AI mode
  isFamiliesEnabledInPureAI?: boolean; // Toggle Market Families in Pure AI mode
  isMemoryEnabledInPureAI?: boolean; // Toggle trade log in Pure AI mode
  isHybridIntelligenceEnabled?: boolean; // Hybrid Intelligence: Real-time data + programmatic TA
  confidenceCalibration?: ConfidenceCalibration; // Tracks AI confidence vs actual outcomes
  memoryProvider?: string; // Memory core AI provider (e.g., 'gemini', 'groq')
  memoryModel?: string; // Model for memory operations
}

export interface TradeSummary {
  id: string; // Corresponds to the LoggedTrade ID
  summaryText: string;
  timestamp: string;
}

export interface UserProfile {
  username: string;
  conversations: Conversation[];
  tradeLog: LoggedTrade[];
  savedAnalyses: SavedAnalysis[];
  tradeSummaries: TradeSummary[];
  finalTradeSummary: string | null;
  globalMemory?: GlobalMemory; // Layer 3: Global Long-Term Memory
  settings: UserSettings;
  lastActiveConversationId?: string;
  createdAt?: string;
  updatedAt?: string;
  // AI Learning Features
  tradingWeaknesses?: TradingWeaknesses;       // Mistake pattern analysis
  insightKnowledgeBase?: InsightKnowledgeBase; // Post-mortem insights
  learningRules?: { rules: LearningRule[]; lastUpdated: string }; // IF/THEN rules from post-mortems
}

export interface LiveThoughts {
  gemini: string | null;
  deepseek: string | null;
  zhipu: string | null;
  groq: string | null;
  groqNew: string | null;
  groqAlt2: string | null;
  openrouter: string | null;
  openai: string | null;
  grokNative: string | null;

}

// =============================================================================
// AI LEARNING TYPES - Adaptive Learning, Mistake Patterns, Insight Extraction
// =============================================================================

/**
 * Lessons extracted from similar historical trades
 * Used by AdaptiveLearningService
 */
export interface TradeLessons {
  similarCount: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  commonFailures: string[];
  successPatterns: string[];
}

/**
 * A recurring trading mistake detected from losing trades
 * Used by MistakePatternService
 */
export interface RecurringMistake {
  type: 'timing' | 'direction' | 'setup' | 'risk' | 'exit';
  description: string;
  occurrences: number;
  affectedTrades: string[]; // Trade IDs
  severity: 'high' | 'medium' | 'low';
}

/**
 * Summary of trading weaknesses for UI display
 */
export interface TradingWeaknesses {
  mistakes: RecurringMistake[];
  worstPerformingSetups: { setup: string; winRate: number; count: number }[];
  lastUpdated: string;
}

/**
 * A single insight extracted from a post-mortem analysis
 * Used by InsightExtractionService
 */
export interface TradeInsight {
  id: string;
  category: 'entry_timing' | 'exit_strategy' | 'pattern_recognition' | 'risk_management' | 'general';
  insight: string;
  sourceTradeId: string;
  coin?: string;
  pattern?: string;
  direction?: 'Long' | 'Short';
  createdAt: string;
  useCount: number; // How many times this insight was surfaced
}

/**
 * Knowledge base for storing extracted insights
 */
export interface InsightKnowledgeBase {
  insights: TradeInsight[];
  lastUpdated: string;
}


/**
 * A learning rule extracted from post-mortem analysis
 */
export interface LearningRule {
  id: string;
  ifCondition: string;              // The condition part of the rule
  thenAction: string;               // The action/consequence part
  sourceTradeId: string;            // Trade ID this rule came from
  outcome: 'WIN' | 'LOSS';          // Outcome of the source trade
  coin?: string;                    // Specific coin (optional)
  pattern?: string;                 // Pattern family (optional)
  direction?: 'Long' | 'Short';     // Trade direction (optional)
  createdAt: string;                // ISO timestamp
  useCount: number;                 // Times this rule was injected
  lastUsed?: string;                // Last time rule was used
}

/**
 * Enhanced structured rule with enforceable constraints
 */
export interface StructuredRule extends LearningRule {
  constraints?: {
    minRR?: number;               // Minimum R:R ratio
    maxRisk?: number;             // Maximum risk percentage
    requiredConfidence?: string;  // Minimum confidence level
    requiredTimeframes?: number;  // Minimum number of aligned timeframes
    stopLossType?: 'Tight' | 'Wide' | 'ATR'; // Required stop loss type
  };
  isStrictMode: boolean;            // Whether this rule causes auto-rejection
}
