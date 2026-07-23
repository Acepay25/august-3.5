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
