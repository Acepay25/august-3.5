// Message and conversation display types

import { AccuracySubMode, MessageRole, TradeOutcome, DebateSpeaker } from './enums';
import { TradingStyle } from './lens';
import { TradeAnalysis } from './analysis';

export interface DebateTurn {
  speaker: DebateSpeaker;
  text: string;
  /** Public reasoning summary emitted by the model, when the provider supports it. */
  reasoning?: string;
  /**
   * 1-based debate round (real inter-model debates only): 1 = opening
   * statements, 2-3 = rebuttals, then clarification cycles (one question
   * round + one answer round each), last = moderator verdict.
   * Absent on legacy/simulated transcripts (grouped by moderator turns).
   */
  round?: number;
  /** When this turn started streaming (real debates only) — powers replay. */
  createdAt?: string;
}

export interface Kline {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface GroundingChunk {
  web: {
    uri: string;
    title: string;
  };
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

export type EnsembleAnalystProgressStatus = 'waiting' | 'analyzing' | 'complete' | 'error';

export interface EnsembleAnalystProgress {
  key: string;
  providerId: string;
  providerName: string;
  modelId: string;
  modelName: string;
  displayName: string;
  status: EnsembleAnalystProgressStatus;
  finalOutput?: string;
  thoughtProcess?: string;
  reasoning?: string;
  error?: string;
}

export interface EnsembleProgress {
  analysts: EnsembleAnalystProgress[];
  moderator: {
    status: 'waiting' | 'reviewing' | 'error';
    waitingFor?: string[];
    error?: string;
  };
}

/** Lightweight per-run summary — durations, gate cap, Monte Carlo snapshot. */
export interface RunStats {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  /** Gate confidence cap (0-1) applied during the run, if any. */
  gateCap?: number;
  /** First analyst's Monte Carlo win rate (%), if computed. */
  mcWinRate?: number;
  /** First analyst's Monte Carlo expected value (R), if computed. */
  mcEV?: number;
  /** How many analysts ran. */
  analystCount?: number;
  /** Live-backtest summary: similar historical setups found for this plan. */
  btMatches?: number;
  btWinRate?: number;
  btEV?: number;
  /**
   * Per-analyst cost & latency ledger: who actually ran, with which model,
   * how long they took, and how much text they produced. App-computed so the
   * run can be audited after the fact (and the count can never silently claim
   * analysts that dropped out mid-debate).
   */
  analysts?: RunAnalystStats[];
}

/** One analyst's entry in the run ledger. */
export interface RunAnalystStats {
  /** ProviderConfig.id — the key used across modelsUsed/calibration. */
  providerId: string;
  displayName: string;
  modelId: string;
  /** Wall-clock time for the initial analysis call, ms. */
  durationMs?: number;
  /** Combined output size (final output + thought process), chars. */
  charsOut?: number;
}

/** A candidate provider the user can pick to replace an analyst that dropped
 *  mid-debate. Transient UI state — never persisted. */
export interface ReplacementCandidate {
  providerId: string;
  displayName: string;
  modelId: string;
}

/** Mid-debate analyst-replacement offer: the debate generator suspends and
 *  shows this banner until the user picks a candidate or skips. */
export interface ReplacementOffer {
  /** Analyst that dropped out mid-debate. */
  droppedName: string;
  /** Round during which the drop happened. */
  round: number;
  /** Ready providers that can step in (active + moderator excluded). */
  candidates: ReplacementCandidate[];
  /** providerId the user picked; undefined until a choice is made. */
  chosenProviderId?: string;
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
  // Ensemble fields — keyed by provider id (ProviderConfig.id)
  modelsUsed?: Record<string, string>;       // providerId → model id used
  thoughtProcesses?: Record<string, string>; // providerId → thought process text
  reasoningProcesses?: Record<string, string>; // provider/model → provider reasoning content

  isDebating?: boolean; // Flag for showing the debate UI
  debateTurns?: DebateTurn[]; // Holds the live debate conversation
  /** Transient speaker -> round map for the live debate indicator. */
  activeDebateSpeakers?: Record<string, number>;
  /** Transient pre-debate analyst outputs and moderator waiting state. */
  ensembleProgress?: EnsembleProgress;

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
    feedback?: {
      pnlAmount?: number;
      correctedEntry?: string;
      correctedStopLoss?: string;
      correctedTakeProfit?: string;
    };
    summaries?: string[];
    imageUrls?: string[];
  };
  /** Failed-run retry: id of the user message whose prompt + charts can
   *  rebuild and re-dispatch the run (renders a Retry button on the error
   *  bubble). Undefined on successful runs. */
  retryOf?: { userMessageId: string };
  // Multi-Timeframe Confluence Score from Hybrid Intelligence
  confluenceData?: ConfluenceData;
  // Per-run execution summary (durations, gate cap, Monte Carlo snapshot)
  runStats?: RunStats;
  /** Transient mid-debate analyst-replacement offer (generator suspends until
   *  the user chooses). Cleared when the debate ends or is cancelled. */
  replacementOffer?: ReplacementOffer;
  /** "What would I do today?" — fresh forward-looking re-assessment of the
   *  closed trade's setup against the current market price. */
  todayReassessment?: TodayReassessment;
}

/** "What would I do today?" — fresh forward-looking re-assessment of a closed
 *  trade's setup against the current market price. */
export interface TodayReassessment {
  verdict: 'YES' | 'NO' | 'MAYBE';
  text: string;
  /** Current market price used for the reassessment (0 = unavailable). */
  price: number;
  createdAt: string;
}

export interface ImageMetadata {
  file: File;
  dataURL: string;
  summary?: string; // This will now be the minimal UI string
  fullAnalysisText?: string; // This will hold the full analysis payload text
  isLoading: boolean;
  ocrModelUsed?: string;
}

export interface LiveThoughts {
  [providerId: string]: string | null;
}
