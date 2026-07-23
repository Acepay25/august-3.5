// Message and conversation display types

import { AccuracySubMode, MessageRole, TradeOutcome } from './enums';
import { TradingStyle } from './lens';
import { TradeAnalysis } from './analysis';

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
