// Core enumerations and shared primitive types

export enum MessageRole {
  USER = 'user',
  AI = 'ai',
  SYSTEM = 'system',
}

export enum TradeOutcome {
  WIN = 'WIN',
  LOSS = 'LOSS',
  PENDING = 'PENDING',
  ENTRY_NOT_HIT = 'ENTRY_NOT_HIT', // Entry price was never reached
  SKIPPED = 'SKIPPED',           // User chose not to take the trade
}

/**
 * Provider identity is now a runtime-configured ProviderConfig id (a string).
 * `AIProvider` is kept as a const object of the legacy built-in ids plus a
 * type alias for backward-compatibility with code that still references them.
 * New user-added providers have ids like `prov-<timestamp>`.
 * Everywhere `AIProvider` was used as a type, it is now just `string`.
 */
export const AIProvider = {
  GEMINI: 'gemini',
  DEEPSEEK: 'deepseek',
  ZHIPU: 'zhipu',
  GROQ: 'groq',
  GROQ_NEW: 'groq_new',
  GROQ_ALT2: 'groq_alt2',
  OPENROUTER: 'openrouter',
  OPENAI: 'openai',
  GROK: 'grok',
} as const;

export type AIProvider = (typeof AIProvider)[keyof typeof AIProvider] | string;

/**
 * Display names for debate speakers.
 * Provider identities are now runtime-configured ProviderConfig ids (strings),
 * so this is a free-form display-name union for the debate UI.
 */
export type DebateSpeaker = string | 'Moderator';

// =============================================================================
// ANALYST LENS TYPES - Specialized roles for 3-analyst ensemble debates
// =============================================================================

/**
 * Analyst roles for specialized ensemble debates.
 * Each role focuses on a specific analytical domain.
 */
export enum AnalystRole {
  MACRO_VOLATILITY = 'macro_volatility',   // Macro & Volatility Analyst
  TECHNICAL_ANALYST = 'technical_analyst', // Technical Analyst (Patterns/SMC/Indicators)
  RISK_EXECUTION = 'risk_execution',       // Risk & Execution Specialist (Devil's Advocate)
  UNASSIGNED = 'unassigned',               // No special role, default behavior
}

export type AccuracySubMode = 'original' | 'pure_ai';
