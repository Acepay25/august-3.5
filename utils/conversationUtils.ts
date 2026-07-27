import { Conversation, MessageRole } from '../types';

export const createNewConversation = (): Conversation => {
  return {
    id: `conv-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    timestamp: Date.now(),
    messages: [{
      id: 'init',
      role: MessageRole.AI,
      text: 'Welcome! I am an AI Trading Assistant. I can work as a single analyst or as a collaborative ensemble. For a full analysis, please upload your 4H, 1H, and 15M OKX charts and state your request.',
      createdAt: new Date().toISOString(),
    }],
    ocrModel: '',               // Set once a vision provider is configured
    moderatorProviderId: '',     // Set once providers are configured (defaults to first ready provider)
    moderatorModel: '',
    leverage: 10,
  };
};
