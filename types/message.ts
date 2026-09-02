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
  /** Per-turn speed metrics: time to first token and
   *  output rate. Present on live-debate turns once measurable. */
  metrics?: {
    ttftMs?: number;
    tokensPerSec?: number;
  };
  /** FinCom disagree-or-commit markers parsed from this turn (Batch 4):
   *  the mandatory COMMIT:/DISSENT: skeleton each seat emits per peer.
   *  Feeds future conformity stats; absent on legacy turns. */
  fincom?: import('./learning').FinComMarker[];
  /** Addressed routing: the seats this turn was sent to, parsed
   *  from the speaker's REPLY-TO line. Absent = floor-wide (everyone reads). */
  to?: string[];
}

export interface Kline {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** Taker-buy base-asset volume (Binance kline field 9) — present on
   *  spot/futures klines fetched after the CVD detector; older cached rows
   *  and synthetic tests may omit it. volume − takerBuyVolume = taker sell. */
  takerBuyVolume?: number;
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
  /** §8.3a: id of the user message that triggered this run — the join key
   *  between injection records and trades logged from this verdict. */
  runId?: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  /** Gate confidence cap (0-1) applied during the run, if any. */
  gateCap?: number;
  /**
   * Fingerprint of the effective prompt layers for this run (registry
   * overrides + mode + lens state + hybrid toggle). Lets prompt changes be
   * MEASURED against outcomes later (per-version win/calibration stats) —
   * without it, editing a prompt globally could never be evaluated.
   */
  promptVersion?: string;
  /** live = registry overrides; control = built-in prompts (A/B). */
  promptLane?: 'live' | 'control';
  /** Debate-structure lane used by this run (standard/extended/efficient).
   * Deterministically assigned per setup — surfaced on the
   * signal card as a provenance chip.
   */
  protocol?: string;
  /** §8.5a: true when this run was an ε-holdout run — skill injection was
   * withheld so the run's outcomes belong to the CONTROL group for lift. */
  skillHoldout?: boolean;
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
  promptTokens?: number;
  completionTokens?: number;
  costUsd?: number;
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
  promptTokens?: number;
  completionTokens?: number;
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
  /** Chart OCR text from the first vision pass — reuse instead of re-sending images. */
  ocrCache?: { texts: string[] };
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
  /** True while a single-model reply is actively streaming into the bubble.
   *  Cleared when the stream settles — drives live markdown rendering and the
   *  Thinking row's running state (perceived speed). */
  isStreaming?: boolean;
  /** Provisional verdict parsed from the moderator's stream WHILE it is still
   *  writing (progressive rendering). Replaced by the final `analysis` when
   *  the debate concludes — never persisted as the source of truth. */
  provisionalAnalysis?: TradeAnalysis;
  /** Partial labeled plan fields seen so far in the moderator's stream —
   *  skeleton-fills the verdict card before the plan is binding. */
  provisionalPlanFields?: {
    coin?: string;
    direction?: string;
    entry?: string;
    stopLoss?: string;
    takeProfits?: string[];
    confidence?: string;
  };
  /** Transient speaker -> round map for the live debate indicator. */
  activeDebateSpeakers?: Record<string, number>;
  /** Transient live desk-tool chips: speaker -> latest tool line ("calling
   *  order book…" / "buy wall $1.2M @ 94.8k"). Cleared when the debate ends. */
  liveToolEvents?: Record<string, string>;
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
  /** Pattern-memory gate outcome (HALT / REDUCE_SIZE / WARNING / PASS) —
   *  rendered as a banner on the analysis card. */
  patternMemoryGate?: PatternMemoryGateView;
  // Multi-Timeframe Confluence Score from Hybrid Intelligence
  confluenceData?: ConfluenceData;
  // Per-run execution summary (durations, gate cap, Monte Carlo snapshot)
  runStats?: RunStats;
  /** Transient mid-debate analyst-replacement offer (generator suspends until
   *  the user chooses). Cleared when the debate ends or is cancelled. */
  replacementOffer?: ReplacementOffer;
  /** User pinned this setup to the Watch list (priority UI). Autopilot still
   *  tracks every PENDING Long/Short the same way. */
  watched?: boolean;
  watchedAt?: string;
  /** NAC-style watch-thread episodes (pin, autopilot, log) — not a new outcome path. */
  watchEpisodes?: WatchEpisode[];
  /** Append-only debate run log (model-visible facts for replay). */
  debateRunLog?: DebateRunEvent[];
  /** ── Bot Mode (plan botmode-scan G1) ──
   *  A user-role row that is a teammate DM (rendered as an envelope, not a
   *  user bubble). The target's turn runs from it; the reply wakes the
   *  sender with a `dmNotice` row in THEIR thread instead. */
  dmFrom?: boolean;
  /** A system notice produced by the DM machinery (reply wake-up, refusal,
   *  hop-cap hold). Rendered muted; never fed back into a model prompt. */
  dmNotice?: boolean;
  /** G2: a room turn that resolved to "(pass)" — the row exists for thread
   *  attribution but renders nowhere (silence is a first-class outcome). */
  hidden?: boolean;
  /** Notebook files / skills retrieved for this run (inspectable on the card). */
  memoryRetrieved?: Array<{ path: string; kind: string }>;
  /** Verdict evidence pack: the journal evidence assembled for
   *  the moderator's verdict — cluster record, similar trades, matched skills,
   *  doctrine header. Mirrors the prompt-side block for auditability. */
  evidencePack?: {
    statsLine: string;
    causePattern: string;
    similar: Array<{ outcome: string; coin: string; direction: string; date: string; lesson: string; similarity: number }>;
    skills: string[];
    doctrineHeader: string;
  };
  /** Run contract: the run's stage ladder with honest skip
   *  notes, persisted for replay audit. */
  runContract?: Array<{ id: string; label: string; state: 'pending' | 'running' | 'done' | 'skipped' | 'failed'; note?: string }>;
  /** Crash-resume: last completed debate round (cleared when a verdict lands). */
  debateCheckpoint?: DebateCheckpoint;
  /** "What would I do today?" — fresh forward-looking re-assessment of the
   *  closed trade's setup against the current market price. */
  todayReassessment?: TodayReassessment;
  /** Pre-read capture (Batch 5 §5a, opt-in training mode): the user's own
   *  direction + confidence committed BEFORE the verdict card revealed.
   *  Rides the message so the journal can show user-prior vs verdict vs
   *  outcome — the human-Brier vs ensemble-Brier anti-automation display. */
  userPriorCall?: UserPriorCall;
}

/** A committed pre-read call (plan §5a). `confidencePct` is the user's own
 *  0-100 belief that their direction plays out (TP before SL). */
export interface UserPriorCall {
  direction: 'Long' | 'Short' | 'Flat';
  confidencePct: number;
  /** ISO timestamp at commit (before the reveal). */
  createdAt: string;
}

export interface WatchEpisode {
  at: string;
  kind: 'watched' | 'unwatched' | 'autopilot' | 'logged' | 'price' | 'invalidation' | 'expired';
  detail: string;
}

export interface DebateCheckpoint {
  lastCompletedRound: number;
  savedAt: string;
  analystNames: string[];
  /** In-flight lane text for the next incomplete round (resume mid-rebuttal). */
  laneDrafts?: Record<string, { round: number; text: string }>;
}

export type DebateRunEventKind = 'round' | 'episode' | 'gate' | 'steer' | 'drop' | 'pre_step' | 'verdict' | 'resume' | 'budget' | 'tool';

export interface DebateRunEvent {
  at: string;
  kind: DebateRunEventKind;
  speaker?: string;
  round?: number;
  detail: string;
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

/**
 * Pattern-memory gate outcome, surfaced on the analysis card and journal row
 * so the user can audit when memory HALTED / downsized / warned a trade —
 * previously the gate was prompt-only and invisible.
 */
export interface PatternMemoryGateView {
  gateResult: 'PASS' | 'WARNING' | 'HALT' | 'REDUCE_SIZE';
  /** Human-readable reason (includes the emoji severity prefix). */
  reason: string;
  /** Questions the moderator was forced to address. */
  mandatoryQuestions: string[];
  /** The most similar historical trades (compact, serializable). */
  historicalFailures: {
    coinName?: string;
    direction?: string;
    /** Display-only outcome label (the gate's synthesis uses its own set). */
    outcome?: string;
    /** Extracted lesson from the matched trade's post-mortem. */
    keyLesson?: string;
  }[];
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
