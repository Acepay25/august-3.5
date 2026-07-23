// =============================================================================
// PROVIDER CONFIGURATION TYPES
// Runtime-configurable AI provider settings with custom provider support
// =============================================================================

/**
 * API format determines how requests are sent to the provider.
 * - chat_completions: OpenAI-compatible /v1/chat/completions (most providers)
 * - messages: Anthropic-style /v1/messages
 * - responses: OpenAI Responses API /responses
 */
export type ApiFormat = 'chat_completions' | 'messages' | 'responses';

/**
 * Configuration for a single AI provider.
 * Built-in providers have isBuiltIn=true and cannot be deleted.
 * Custom providers have isBuiltIn=false and can be added/removed freely.
 */
export interface ProviderConfig {
  id: string;                    // Unique ID (e.g., 'gemini', 'custom-1720000000')
  name: string;                  // Display name (e.g., 'Gemini', 'My Local LLM')
  apiKey: string;                // User-entered API key (stored encrypted in prefs)
  baseUrl: string;               // API base URL (e.g., 'https://api.openai.com/v1')
  apiFormat: ApiFormat;          // Which API format to use
  isEnabled: boolean;            // Whether this provider is active
  isBuiltIn: boolean;            // true = default provider, false = user-added
  models: string[];              // Available model IDs
  selectedModel: string;         // Currently selected model ID
}

/**
 * Labels for API format dropdown display
 */
export const API_FORMAT_LABELS: Record<ApiFormat, string> = {
  chat_completions: 'Chat Completions (/v1/chat/completions)',
  messages: 'Messages (/v1/messages)',
  responses: 'Responses (/responses)',
};
