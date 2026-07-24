/**
 * AIProviderService Interface
 *
 * Common contract for all AI provider services. Each provider
 * (Gemini, DeepSeek, Groq, OpenRouter, etc.) must implement this
 * interface, enabling the pipeline to treat them uniformly.
 *
 * This replaces the current pattern where each of the 9 provider
 * services independently declares its own function signatures,
 * making drift invisible until runtime.
 */

import { TradeAnalysis, Message, GroundingChunk, GlobalMemory, TradeOutcome, AccuracySubMode } from '../types';

// =============================================================================
// SHARED TYPES
// =============================================================================

export interface AnalysisResult {
  analysis: TradeAnalysis;
  thoughtProcess: string;
  sources: GroundingChunk[];
}

export interface AnalysisParams {
  prompt: string;
  images: { type: string; dataURL: string }[];
  imageSummaries: string[];
  messages: Message[];
  memory: GlobalMemory | undefined;
  recentInsights: string;
  patternMemoryContext: string;
  modelName: string;
  activeFrameworks: string[];
  isDeepAnalysis: boolean;
  signal?: AbortSignal;
}

export interface PostMortemParams {
  originalAnalysis: TradeAnalysis;
  outcome: TradeOutcome;
  feedback: {
    pnlAmount?: number;
    correctedEntry?: string;
    correctedStopLoss?: string;
    correctedTakeProfit?: string;
  };
  imageSummaries: string[];
  summaries: string[];
  modelName: string;
  signal?: AbortSignal;
}

export interface QuickResponseParams {
  prompt: string;
  messages: Message[];
  modelName: string;
  signal?: AbortSignal;
}

export interface ChartSummaryParams {
  image: { type: string; dataURL: string };
  modelName: string;
  signal?: AbortSignal;
}

// =============================================================================
// PROVIDER INTERFACE
// =============================================================================

/**
 * Every AI provider service must implement this interface.
 * The pipeline uses this to call any provider uniformly.
 */
export interface AIProviderService {
  /** Provider display name for logging and debate turns */
  readonly providerName: string;

  /**
   * Full trading analysis with structured JSON output.
   * This is the primary analysis function called during ensemble debates.
   */
  analyzeTradingView(params: AnalysisParams): Promise<AnalysisResult>;

  /**
   * Post-mortem analysis comparing prediction vs. actual outcome.
   */
  conductPostMortem(params: PostMortemParams): Promise<string>;

  /**
   * Quick conversational response (non-analysis chat).
   */
  getQuickResponse(params: QuickResponseParams): Promise<string>;

  /**
   * Summarize a chart image via vision/OCR.
   */
  summarizeChartImage(params: ChartSummaryParams): Promise<string>;

  /**
   * Update global memory with new trade insights.
   * Optional — not all providers support this.
   */
  updateGlobalMemory?(
    memory: GlobalMemory,
    tradeResult: { analysis: TradeAnalysis; outcome: TradeOutcome },
    modelName: string
  ): Promise<GlobalMemory>;

  /**
   * Get a strategy description for the strategy search feature.
   * Optional — not all providers support this.
   */
  getStrategyDescription?(
    strategyName: string,
    modelName: string
  ): Promise<string>;
}

// =============================================================================
// PROVIDER REGISTRY
// =============================================================================

/**
 * Registry of available provider services.
 * The pipeline uses this to look up providers by name.
 */
const providerRegistry = new Map<string, AIProviderService>();

export const registerProvider = (name: string, service: AIProviderService): void => {
  providerRegistry.set(name, service);
};

export const getProvider = (name: string): AIProviderService | undefined => {
  return providerRegistry.get(name);
};

export const getAllProviders = (): Map<string, AIProviderService> => {
  return new Map(providerRegistry);
};
