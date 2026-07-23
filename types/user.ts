// User profile, settings, and custom instruction types

import { AIProvider, AccuracySubMode } from './enums';
import { ConfidenceCalibration } from './calibration';
import { Conversation, LoggedTrade, SavedAnalysis, TradeSummary } from './trade';
import { GlobalMemory, InsightKnowledgeBase, LearningRule, TradingWeaknesses } from './learning';

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
