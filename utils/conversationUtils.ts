import { Conversation, MessageRole } from '../types';

/** App-wide default futures leverage. Single source of truth — the value was
 *  inlined as `100` at ~10 sites; one divergence silently skews every
 *  dashboard metric (PnL %, R:R, backtest math). */
export const DEFAULT_LEVERAGE = 100;

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
    leverage: DEFAULT_LEVERAGE, // Match the app-wide default (useTradeLogging / schema / UI)
  };
};
