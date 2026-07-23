import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Conversation, Message, AIProvider } from '../types';
import { GEMINI_MODELS, DEEPSEEK_MODELS, ZHIPU_MODELS, GROQ_MODELS, GROQ_NEW_MODELS, GROQ_ALT2_MODELS, OPENROUTER_MODELS, OPENAI_MODELS, GROK_MODELS, OCR_MODELS } from '../constants/models';

export function useConversations() {
    // Master state for all conversation data.
    const [conversationHistory, setConversationHistory] = useState<Conversation[]>([]);
    const [activeConversationId, setActiveConversationId] = useState<string | null>(null);

    // Derived state for the active conversation.
    const activeConversation = useMemo(() =>
        conversationHistory.find(c => c.id === activeConversationId),
        [conversationHistory, activeConversationId]);

    const messages = activeConversation?.messages || [];

    // Ref to hold the latest messages for async access to prevent stale closures
    const messagesRef = useRef<Message[]>([]);
    useEffect(() => {
        messagesRef.current = messages;
    }, [messages]);

    const selectedGeminiModel = activeConversation?.geminiModel || GEMINI_MODELS[0].id;
    const selectedDeepSeekModel = activeConversation?.deepseekModel || DEEPSEEK_MODELS[0].id;
    const selectedZhipuModel = activeConversation?.zhipuModel || ZHIPU_MODELS[0].id;
    const selectedGroqModel = activeConversation?.groqModel || GROQ_MODELS[0].id;
    const selectedGroqNewModel = activeConversation?.groqNewModel || GROQ_NEW_MODELS[0].id;
    const selectedGroqAlt2Model = activeConversation?.groqAlt2Model || GROQ_ALT2_MODELS[0].id
    const selectedOpenrouterModel = activeConversation?.openrouterModel || OPENROUTER_MODELS[0].id;
    const selectedOcrModel = activeConversation?.ocrModel || OCR_MODELS[0].id;
    const isGeminiEnabled = activeConversation?.isGeminiEnabled ?? true;
    const isDeepSeekEnabled = activeConversation?.isDeepSeekEnabled ?? true;
    const isZhipuEnabled = activeConversation?.isZhipuEnabled ?? false; // Zhipu Disabled by default
    const isGroqEnabled = activeConversation?.isGroqEnabled ?? false;
    const isGroqNewEnabled = activeConversation?.isGroqNewEnabled ?? false;
    const isGroqAlt2Enabled = activeConversation?.isGroqAlt2Enabled ?? false;
    const isOpenrouterEnabled = activeConversation?.isOpenrouterEnabled ?? false;
    const isOpenaiEnabled = activeConversation?.isOpenaiEnabled ?? false;
    const selectedOpenaiModel = activeConversation?.openaiModel || OPENAI_MODELS[0].id;
    const isGrokNativeEnabled = activeConversation?.isGrokNativeEnabled ?? false;
    const selectedGrokNativeModel = activeConversation?.grokNativeModel || GROK_MODELS[0].id;
    const moderatorProvider = activeConversation?.moderatorProvider || AIProvider.GEMINI;
    const moderatorModel = activeConversation?.moderatorModel || 'gemini-2.5-pro';

    const updateMessages = useCallback((updater: (prevMessages: Message[]) => Message[]) => {
        setConversationHistory(prevHistory => {
            return prevHistory.map(conv => {
                if (conv.id === activeConversationId) {
                    return { ...conv, messages: updater(conv.messages) };
                }
                return conv;
            });
        });
    }, [activeConversationId]);

    const updateActiveConversation = useCallback((updater: (conv: Conversation) => Conversation) => {
        setConversationHistory(prev => prev.map(c =>
            c.id === activeConversationId ? updater(c) : c
        ));
    }, [activeConversationId]);

    // AI Provider Toggle Handlers (for ChatInput Ensemble Configuration)
    const handleSetIsGeminiEnabled = (enabled: boolean) => updateActiveConversation(c => ({ ...c, isGeminiEnabled: enabled }));
    const handleSetIsDeepSeekEnabled = (enabled: boolean) => updateActiveConversation(c => ({ ...c, isDeepSeekEnabled: enabled }));
    const handleSetIsZhipuEnabled = (enabled: boolean) => updateActiveConversation(c => ({ ...c, isZhipuEnabled: enabled }));
    const handleSetIsGroqEnabled = (enabled: boolean) => updateActiveConversation(c => ({ ...c, isGroqEnabled: enabled }));
    const handleSetIsGroqNewEnabled = (enabled: boolean) => updateActiveConversation(c => ({ ...c, isGroqNewEnabled: enabled }));
    const handleSetIsGroqAlt2Enabled = (enabled: boolean) => updateActiveConversation(c => ({ ...c, isGroqAlt2Enabled: enabled }));

    const handleSetIsOpenrouterEnabled = (enabled: boolean) => updateActiveConversation(c => ({ ...c, isOpenrouterEnabled: enabled }));
    const handleSetIsOpenaiEnabled = (enabled: boolean) => updateActiveConversation(c => ({ ...c, isOpenaiEnabled: enabled }));
    const handleSetIsGrokNativeEnabled = (enabled: boolean) => updateActiveConversation(c => ({ ...c, isGrokNativeEnabled: enabled }));
    const handleSetVisionModel = (modelId: string) => updateActiveConversation(c => ({ ...c, ocrModel: modelId }));

    const handleSetSelectedGeminiModel = (id: string) => updateActiveConversation(c => ({ ...c, geminiModel: id }));
    const handleSetSelectedDeepSeekModel = (id: string) => updateActiveConversation(c => ({ ...c, deepseekModel: id }));
    const handleSetSelectedZhipuModel = (id: string) => updateActiveConversation(c => ({ ...c, zhipuModel: id }));
    const handleSetSelectedGroqModel = (id: string) => updateActiveConversation(c => ({ ...c, groqModel: id }));
    const handleSetSelectedGroqNewModel = (id: string) => updateActiveConversation(c => ({ ...c, groqNewModel: id }));
    const handleSetSelectedGroqAlt2Model = (id: string) => updateActiveConversation(c => ({ ...c, groqAlt2Model: id }));
    const handleSetSelectedOpenrouterModel = (id: string) => updateActiveConversation(c => ({ ...c, openrouterModel: id }));

    const handleSetSelectedOcrModel = (id: string) => updateActiveConversation(c => ({ ...c, ocrModel: id }));
    const handleSetSelectedOpenaiModel = (id: string) => updateActiveConversation(c => ({ ...c, openaiModel: id }));
    const handleSetSelectedGrokNativeModel = (id: string) => updateActiveConversation(c => ({ ...c, grokNativeModel: id }));

    const handleToggleProvider = (provider: 'gemini' | 'deepseek' | 'zhipu' | 'groq' | 'groqNew' | 'groqAlt2' | 'openrouter' | 'openai' | 'grokNative') => {
        updateActiveConversation(c => {
            const key = provider === 'gemini' ? 'isGeminiEnabled' :
                provider === 'deepseek' ? 'isDeepSeekEnabled' :
                    provider === 'zhipu' ? 'isZhipuEnabled' :
                        provider === 'groq' ? 'isGroqEnabled' :
                            provider === 'groqNew' ? 'isGroqNewEnabled' :
                                provider === 'groqAlt2' ? 'isGroqAlt2Enabled' :
                                    provider === 'openrouter' ? 'isOpenrouterEnabled' :
                                        provider === 'grokNative' ? 'isGrokNativeEnabled' : 'isOpenaiEnabled';
            return { ...c, [key]: !c[key] };
        });
    };

    const handleSetModeratorProvider = (provider: AIProvider) => updateActiveConversation(c => ({ ...c, moderatorProvider: provider }));
    const handleSetModeratorModel = (id: string) => updateActiveConversation(c => ({ ...c, moderatorModel: id }));

    return {
        conversationHistory,
        setConversationHistory,
        activeConversationId,
        setActiveConversationId,
        activeConversation,
        messages,
        messagesRef,
        updateMessages,
        updateActiveConversation,
        selectedGeminiModel,
        selectedDeepSeekModel,
        selectedZhipuModel,
        selectedGroqModel,
        selectedGroqNewModel,
        selectedGroqAlt2Model,
        selectedOpenrouterModel,
        selectedOcrModel,
        selectedOpenaiModel,
        selectedGrokNativeModel,
        isGeminiEnabled,
        isDeepSeekEnabled,
        isZhipuEnabled,
        isGroqEnabled,
        isGroqNewEnabled,
        isGroqAlt2Enabled,
        isOpenrouterEnabled,
        isOpenaiEnabled,
        isGrokNativeEnabled,
        moderatorProvider,
        moderatorModel,
        handleSetIsGeminiEnabled,
        handleSetIsDeepSeekEnabled,
        handleSetIsZhipuEnabled,
        handleSetIsGroqEnabled,
        handleSetIsGroqNewEnabled,
        handleSetIsGroqAlt2Enabled,
        handleSetIsOpenrouterEnabled,
        handleSetIsOpenaiEnabled,
        handleSetIsGrokNativeEnabled,
        handleSetVisionModel,
        handleSetSelectedGeminiModel,
        handleSetSelectedDeepSeekModel,
        handleSetSelectedZhipuModel,
        handleSetSelectedGroqModel,
        handleSetSelectedGroqNewModel,
        handleSetSelectedGroqAlt2Model,
        handleSetSelectedOpenrouterModel,
        handleSetSelectedOcrModel,
        handleSetSelectedOpenaiModel,
        handleSetSelectedGrokNativeModel,
        handleToggleProvider,
        handleSetModeratorProvider,
        handleSetModeratorModel,
    };
}
