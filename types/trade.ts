// Trade logging, conversation, and dashboard types

import { AIProvider, AccuracySubMode, TradeOutcome } from './enums';
import { TradeAnalysis } from './analysis';
import { Message } from './message';

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

export interface TradeSummary {
  id: string; // Corresponds to the LoggedTrade ID
  summaryText: string;
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
