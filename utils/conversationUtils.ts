import { Conversation, MessageRole } from '../types';

export const createNewConversation = (): Conversation => {
  return {
    id: `conv-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    timestamp: Date.now(),
    // Fresh sessions start empty — the chat shows a centered input (no
    // hardcoded welcome bubble) and fills as messages are sent.
    messages: [],
    ocrModel: '',               // Set once a vision provider is configured
    moderatorProviderId: '',     // Set once providers are configured (defaults to first ready provider)
    moderatorModel: '',
    leverage: 100,              // Match the app-wide default (useTradeLogging / schema / UI)
  };
};
