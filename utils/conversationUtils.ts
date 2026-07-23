import { Conversation, MessageRole, AIProvider } from '../types';
import { GEMINI_MODELS, DEEPSEEK_MODELS, ZHIPU_MODELS, OCR_MODELS, GROQ_MODELS, GROQ_NEW_MODELS, GROQ_ALT2_MODELS, OPENROUTER_MODELS, OPENAI_MODELS, GROK_MODELS } from '../constants/models';

export const createNewConversation = (): Conversation => {
  return {
    id: `conv-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    timestamp: Date.now(),
    messages: [{
      id: 'init',
      role: MessageRole.AI,
      text: 'Welcome! I am an AI Trading Assistant. I can work as a single analyst or as a collaborative ensemble. For a full analysis, please upload your 4H, 1H, and 15M OKX charts and state your request.',
      createdAt: new Date().toISOString(),
      geminiModelUsed: 'gemini-2.5-pro',
    }],
    geminiModel: GEMINI_MODELS[0].id,
    deepseekModel: DEEPSEEK_MODELS[0].id,
    zhipuModel: ZHIPU_MODELS[0].id,
    groqModel: GROQ_MODELS[0].id,
    groqNewModel: GROQ_NEW_MODELS[0].id,
    groqAlt2Model: GROQ_ALT2_MODELS[0].id,

    openrouterModel: OPENROUTER_MODELS[0].id,
    openaiModel: OPENAI_MODELS[0].id,
    grokNativeModel: GROK_MODELS[0].id,

    ocrModel: OCR_MODELS[0].id,
    isGeminiEnabled: true,
    isDeepSeekEnabled: true,
    isZhipuEnabled: false, // Default to false
    isGroqEnabled: false, // Default to false
    isGroqNewEnabled: false, // Default to false
    isGroqAlt2Enabled: false, // Default to false

    isOpenrouterEnabled: false, // Default to false
    isOpenaiEnabled: false, // Default to false
    isGrokNativeEnabled: false, // Default to false
    moderatorProvider: AIProvider.GEMINI,
    moderatorModel: 'gemini-2.5-pro',
    leverage: 10,
  };
};
