// Trade logging, conversation, and dashboard types

import { AccuracySubMode, TradeOutcome } from './enums';
import { TradeAnalysis } from './analysis';
import { Message, DebateTurn, PatternMemoryGateView } from './message';
import { RootCauseClass } from './learning';

export interface LoggedTrade {
  id: string;
  analysis: TradeAnalysis;
  /** Pattern-memory gate outcome at analysis time (journal badge). */
  patternMemoryGate?: PatternMemoryGateView;
  /** Prompt-layer fingerprint from the originating run (journal A/B). */
  promptVersion?: string;
  promptLane?: 'live' | 'control';
  tradeType?: 'scalp' | 'swing';  // Denormalized for filtering/stats
  outcome: TradeOutcome;
  timestamp: string;
  leverage?: number;
  postMortem?: string;
  postMortemCreatedAt?: string; // Timestamp for post-mortem analysis
  postMortemImages?: string[]; // To store screenshots from the post-mortem upload
  /**
   * Per-provider post-mortem analyst reports, keyed by provider display
   * name. Captured at generation time so the EXTRACT_INSIGHTS job can
   * attribute knowledge-base insights to the AI that produced them
   * (by-provider quality tracking in the Knowledge Base card).
   */
  postMortemByProvider?: Record<string, string>;
  /**
   * Forensic class from the post-mortem blame split. Execution and macro
   * shocks must not become technical playbook rules.
   */
  rootCauseClass?: RootCauseClass;
  correctedEntry?: string;
  correctedStopLoss?: string;
  correctedTakeProfit?: string;
  investmentAmount?: number;
  pnlAmount?: number;
  /**
   * PnL expressed as a leveraged percent (e.g. +200 = +200%) when only a
   * percent is known (outcome autopilot). Distinct from pnlAmount (dollars) —
   * writing a percent into pnlAmount corrupts dashboard PnL math.
   */
  pnlPercent?: number;
  marketSnapshot?: unknown; // Stored market context for algorithmic recalculation
  // Ensemble fields — keyed by provider id (ProviderConfig.id)
  modelsUsed?: Record<string, string>;       // providerId → model id
  thoughtProcesses?: Record<string, string>; // providerId → thought process text
  // Legacy per-provider fields (kept for historical data migration)
  geminiModelUsed?: string;
  deepseekModelUsed?: string;
  zhipuModelUsed?: string;
  groqModelUsed?: string;
  groqNewModelUsed?: string;
  groqAlt2ModelUsed?: string;
  openrouterModelUsed?: string;

  ocrModelUsed?: string;
  moderatorProvider?: string;  // ProviderConfig id (historical values like 'gemini' remain valid strings)
  moderatorModel?: string;

  // Debate transcript — the full debate turns and moderator synthesis
  // Stored for training data and outcome-correlated reasoning analysis
  debateTurns?: DebateTurn[];
  moderatorSynthesis?: string;

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

  // ===== Journal discipline fields (Batch 5, plan §4.1 — all optional) =====
  /** What went wrong, in the trader's own taxonomy. Drives the mistake-cost table. */
  mistakeTags?: ('failed_thesis' | 'boredom' | 'overtrading' | 'greed' | 'revenge' | 'moved_stop' | 'early_entry' | 'late_exit')[];
  /** Self-rated state at entry (quick-tap at capture time). */
  emotionalState?: 'calm' | 'confident' | 'anxious' | 'frustrated' | 'tilted' | 'fomo';
  /** Did the executed trade match the published plan? Drives the adherence split. */
  followedPlan?: boolean;
  /** What deviated, when followedPlan is false. */
  planDeviationNote?: string;
  /** Realized R-multiple — computed at log time from entry/SL/pnl (deterministic util). */
  rMultiple?: number;
  /** Best price the trade offered before exit, as leveraged percent (MFE). With pnlPercent it yields capture efficiency. */
  maxFavorableExcursion?: number;
  /** Why a SKIPPED trade was passed on ("watched, chose not to") — passes become data. */
  skipReason?: string;
  /** Pre-trade checklist completion at log time (plan §4.3): items checked / shown. */
  checklistCompleted?: { done: number; total: number };
}

export interface StrategySearchResult {
  name: string;
  description: string;
  rationale?: string;
  backtestData?: string;
  pitfalls?: string;
  implementationSteps?: string[];
}

/**
 * Discipline tags captured at trade-logging time (Batch 5 quick-tag UI).
 * Everything optional — the capture flow must stay ≤3 taps.
 */
export interface CaptureJournalTags {
  mistakeTags?: LoggedTrade['mistakeTags'];
  emotionalState?: LoggedTrade['emotionalState'];
  followedPlan?: boolean;
  planDeviationNote?: string;
  /** Pre-trade checklist completion (plan §4.3): items checked / items shown. */
  checklistCompleted?: { done: number; total: number };
  /** Why a pass was taken (plan §4.1) — rides the capture modal's skip path. */
  skipReason?: string;
}

export interface SavedAnalysis {
  id: string; // Corresponds to the message ID of the analysis
  analysis: TradeAnalysis;
  userPrompt: string;
  timestamp: string;
  // Ensemble fields — keyed by provider id (ProviderConfig.id)
  modelsUsed?: Record<string, string>; // providerId → model id
  // Legacy per-provider fields (kept for historical data migration)
  geminiModelUsed?: string;
  deepseekModelUsed?: string;
  zhipuModelUsed?: string;
  groqModelUsed?: string;
  groqNewModelUsed?: string;
  groqAlt2ModelUsed?: string;

  ocrModelUsed?: string;
  moderatorProvider?: string;  // ProviderConfig id
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
  ocrModel: string;              // Vision/OCR model id (from the vision provider's models)
  moderatorProviderId: string;   // ProviderConfig id of the debate moderator
  moderatorModel: string;        // Moderator model id
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
