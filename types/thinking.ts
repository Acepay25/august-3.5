/**
 * ThinkingRecord — stores how each AI model reasoned about a trade.
 *
 * One record per (trade × provider × role). This enables:
 * - Offline analysis of which reasoning patterns correlate with wins
 * - Per-model training datasets (reasoning → outcome pairs)
 * - Debate strategy learning (which debate moves lead to wins)
 */

import { TradeOutcome } from './enums';

export type ThinkingRole = 'analyst' | 'moderator' | 'debate_turn';

export interface ThinkingRecord {
  /** Unique record ID */
  id: string;
  /** The trade this reasoning belongs to (matches LoggedTrade.id or analysis.createdAt) */
  tradeId: string;
  /** Username for multi-user isolation */
  username: string;
  /** AI provider: 'gemini' | 'deepseek' | 'zhipu' | 'groq' | 'moderator' | etc. */
  provider: string;
  /** Role in the analysis: individual analyst, moderator synthesis, or a debate turn */
  role: ThinkingRole;
  /** Model name used (e.g., 'gemini-2.5-pro', 'deepseek-chat') */
  modelName?: string;
  /** The reasoning/thought process text */
  reasoning: string;
  /** The model's final output (analyst answer after reasoning, moderator verdict prose) */
  finalOutput?: string;
  /** Raw provider-streamed chain of thought (reasoning_content / thinking blocks), when available */
  rawReasoning?: string;
  /** The analysis card (message) this reasoning belongs to — links to the prediction card */
  messageId?: string;
  /** The structured TradeAnalysis JSON (for analysts and moderator) */
  analysisJson?: string;
  /** For debate turns: the turn index in the debate */
  debateTurnIndex?: number;
  /** For debate turns: who spoke ('Gemini' | 'DeepSeek' | 'Moderator' | etc.) */
  debateTurnSpeaker?: string;
  /** Confidence level assigned: 'High' | 'Medium' | 'Low' | 'Avoid' */
  confidence?: string;
  /** Probability assigned (0-100) */
  probability?: number;
  /** Trade outcome — filled when the trade resolves (WIN/LOSS/PENDING/etc.) */
  outcome?: TradeOutcome;
  /** Realized PnL in dollars — backfilled at outcome time (risk-weighted
   *  training signal: a WIN at +4R is not the same as a WIN at +0.5R). */
  pnlAmount?: number;
  /** Realized PnL as a leveraged percent (e.g. +200 = +200%). */
  pnlPercent?: number;
  /** When this reasoning was recorded */
  createdAt: string;
}

export interface ThinkingRecordStats {
  provider: string;
  total: number;
  wins: number;
  losses: number;
  pending: number;
  /**
   * Average confidence over records that have one, on the scale
   * High=4 / Medium=3 / Low=2 / Avoid=1; 0 when no record has a level.
   */
  avgConfidence: number;
  avgProbability: number;
  /** Average realized PnL (leveraged %) over records that carry one — an
   *  expectancy proxy per provider; 0 when none resolved with PnL. */
  avgPnLPercent: number;
  /** Wins / (wins + losses) over resolved records; 0 when none resolved. */
  winRate: number;
}

/**
 * One analysis run (trade/card) in the reasoning browser — groups the
 * thinking records written for a single prediction.
 */
export interface ThinkingTradeSummary {
  /** The trade key all records of this run share (analysis.createdAt) */
  tradeId: string;
  /** Latest record createdAt (≈ when the analysis ran) */
  createdAt: string;
  recordCount: number;
  /** Outcome of the trade (WIN/LOSS/PENDING/…) — filled when logged */
  outcome?: TradeOutcome;
}

/**
 * Export format for model training — one line per record (JSONL).
 * Each record is a complete (reasoning → outcome) training example.
 */
export interface ThinkingExportRow {
  provider: string;
  modelName?: string;
  role: ThinkingRole;
  reasoning: string;
  finalOutput?: string;
  rawReasoning?: string;
  messageId?: string;
  analysis: unknown;
  confidence?: string;
  probability?: number;
  outcome?: TradeOutcome;
  /** Realized PnL (risk-weighted training label — see ThinkingRecord). */
  pnlAmount?: number;
  pnlPercent?: number;
  tradeId: string;
  createdAt: string;
}
