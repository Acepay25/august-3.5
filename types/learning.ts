// =============================================================================
// AI LEARNING TYPES - Adaptive Learning, Mistake Patterns, Insight Extraction
// =============================================================================

import { AIProvider } from './enums';

/**
 * FinCom disagree-or-commit marker (Batch 4): one line per peer in a debate
 * turn — the seat either commits to the peer's current position (with why)
 * or dissents (with why). Parsed into DebateTurn.fincom for conformity stats.
 */
export interface FinComMarker {
  seat: string;
  stance: 'commit' | 'dissent';
  why: string;
}

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
 * Used by AlgorithmicMemoryService (GlobalMemory.insightKnowledgeBase)
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
 * An insight with provider attribution and usage tracking. Lives in the
 * trader notebook as a distilled/ memory file (plan §8.1 store unification —
 * the old standalone `attributed_insights_kb` preference store was folded
 * into the notebook so one store, one cap, one UI owns it).
 */
export interface AttributedInsight {
  id: string;
  insight: string;
  sourceProvider: AIProvider | string;
  category: 'global' | 'coin' | 'pattern' | 'regime' | 'family';
  scope?: string; // e.g., "BTCUSDT" for coin-specific, "Family C" for family-specific
  qualityScore: number; // 0-100, based on user feedback or outcome correlation
  wasValidated: boolean; // Did following this advice help?
  timesUsed: number;
  timesHelpful: number;
  /** Negative explicit feedback — lets qualityScore reflect feedback only,
   *  not mere surface marks (timesUsed counts displays, which inflated the
   *  denominator and diluted the ratio). */
  timesNotHelpful?: number;
  /** Dedupe guard for "surfaced to a prompt" marks. Session-scoped since the
   *  notebook store — cross-restart re-marks cost one counter tick at most. */
  lastSurfacedAt?: number;
  createdAt: string;
  tradeId: string;
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
  wins?: number;                    // Later outcomes that matched this rule
  losses?: number;
  status?: 'candidate' | 'confirmed' | 'retired';
}

/**
 * Why a closed trade failed or succeeded. Only SETUP_EDGE_FAILURE may
 * write a technical IF/THEN into LearningRules / skills.
 */
export type RootCauseClass = 'SETUP_EDGE_FAILURE' | 'EXECUTION_ERROR' | 'MACRO_SHOCK' | 'UNCLEAR';

/**
 * A single markdown file in the Trader Notebook (Settings → Personal edge).
 * The harness AND the user write these; matching enabled files are retrieved
 * into analyst, moderator, and post-mortem prompts (not a full dump).
 */
export interface MemoryFile {
  id: string;
  folderId: string;
  /** File name including the .md extension (e.g. "memory.md"). */
  name: string;
  content: string;
  /** When true the full content is injected into prompts. */
  enabled: boolean;
  /**
   * Harness-managed file (trade diary, profile memory, recurring mistakes) —
   * the app rewrites these; the UI labels them "auto" so the user knows.
   */
  autoManaged?: boolean;
  createdAt: number;
  updatedAt: number;
}

/** A folder in the Trader Notebook (profile, trader-diary, …). */
export interface MemoryFolder {
  id: string;
  name: string;
  /** Lower-order folders are injected first (profile is always first). */
  order: number;
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
