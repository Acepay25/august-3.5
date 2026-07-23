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

export enum AIProvider {
  GEMINI = 'gemini',
  DEEPSEEK = 'deepseek',
  ZHIPU = 'zhipu',
  GROQ = 'groq',
  GROQ_NEW = 'groq_new',
  GROQ_ALT2 = 'groq_alt2',
  OPENROUTER = 'openrouter',
  OPENAI = 'openai',
  GROK = 'grok',
}

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
