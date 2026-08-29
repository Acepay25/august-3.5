// =============================================================================
// PROVIDER CONFIGURATION TYPES
// Runtime-configurable AI provider settings with custom provider support
// =============================================================================

/**
 * API format determines how requests are sent to the provider.
 * - chat_completions: OpenAI-compatible /v1/chat/completions (most providers)
 * - messages: Anthropic-style /v1/messages
 * - responses: OpenAI Responses API /responses
 * - google: Gemini generateContent (generativelanguage.googleapis.com)
 */
export type ApiFormat = 'chat_completions' | 'messages' | 'responses' | 'google';

/**
 * Configuration for a single AI provider.
 * Built-in providers have isBuiltIn=true and cannot be deleted.
 * Custom providers have isBuiltIn=false and can be added/removed freely.
 */
export interface ProviderConfig {
  id: string;                    // Unique ID (e.g., 'gemini', 'custom-1720000000')
  name: string;                  // Display name (e.g., 'Gemini', 'My Local LLM')
  apiKey: string;                // User-entered API key; encrypted at rest on Electron when safeStorage is available
  baseUrl: string;               // API base URL (e.g., 'https://api.openai.com/v1')
  apiFormat: ApiFormat;          // Which API format to use
  isEnabled: boolean;            // Whether this provider is active
  isBuiltIn: boolean;            // true = default provider, false = user-added
  models: string[];              // Available model IDs
  selectedModel: string;         // Currently selected model ID
  /** Models included when Ensemble mode is enabled (maximum three total). */
  ensembleModels?: string[];
  /** Optional USD per 1k prompt tokens for run cost estimates. */
  inputUsdPer1k?: number;
  /** Optional USD per 1k completion tokens for run cost estimates. */
  outputUsdPer1k?: number;
  /**
   * Override for Anthropic extended-thinking eligibility on this provider
   * (apiFormat 'messages'). undefined = decide by model-id regex;
   * true = always request thinking (thinking-capable ids the regex can't
   * know yet); false = never (older Claude models that 400 on the thinking
   * block). Set from the provider editor.
   */
  thinkingCapable?: boolean;
}

/**
 * Labels for API format dropdown display
 */
export const API_FORMAT_LABELS: Record<ApiFormat, string> = {
  chat_completions: 'Chat completions (/chat/completions)',
  messages: 'Messages (/v1/messages)',
  responses: 'Responses (/responses)',
  google: 'Google Gemini (generateContent)',
};

export const parseApiFormat = (value: unknown): ApiFormat => {
  if (value === 'messages' || value === 'responses' || value === 'google' || value === 'chat_completions') {
    return value;
  }
  return 'chat_completions';
};
