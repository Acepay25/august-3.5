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

/** A session with no messages — the blank "new conversation" state. */
export const isEmptyConversation = (conv: Conversation): boolean =>
  (conv.messages ?? []).length === 0;

/**
 * Prefer an existing blank session over creating another one.
 * Returns the active session if it is already blank, otherwise the most
 * recent other blank session (history is newest-first), otherwise null.
 */
export const findReusableEmptyConversation = (
  conversations: Conversation[],
  activeId: string | null | undefined,
): Conversation | null => {
  const active = conversations.find(c => c.id === activeId);
  if (active && isEmptyConversation(active)) return active;
  return conversations.find(c => c.id !== activeId && isEmptyConversation(c)) ?? null;
};
