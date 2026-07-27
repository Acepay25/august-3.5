import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Conversation, Message } from '../types';

// P2-16: Cap messages per conversation. Without this, conversations grow
// unbounded and the whole messages array (with base64 images) is re-serialized
// on every 1500ms debounce save. The cap is high enough that real trading
// sessions won't hit it, but it prevents pathological growth from silently
// inflating storage and save latency.
const MAX_MESSAGES_PER_CONVERSATION = 200;

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

    // Per-conversation selections. Provider enable/disable + per-provider model
    // selection now live in ProviderConfig (global, via useProviderConfigs).
    // The conversation only tracks the moderator provider/model and the vision model.
    const selectedOcrModel = activeConversation?.ocrModel || '';
    const moderatorProviderId = activeConversation?.moderatorProviderId || '';
    const moderatorModel = activeConversation?.moderatorModel || '';

    const updateMessages = useCallback((updater: (prevMessages: Message[]) => Message[]) => {
        setConversationHistory(prevHistory => {
            return prevHistory.map(conv => {
                if (conv.id === activeConversationId) {
                    const next = updater(conv.messages);
                    // P2-16: Enforce the message cap. Drop the OLDEST messages
                    // (FIFO) so recent context is preserved. This runs on every
                    // message append/edit, keeping conversations bounded.
                    const trimmed = next.length > MAX_MESSAGES_PER_CONVERSATION
                        ? next.slice(next.length - MAX_MESSAGES_PER_CONVERSATION)
                        : next;
                    return { ...conv, messages: trimmed };
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

    const handleSetVisionModel = (modelId: string) => updateActiveConversation(c => ({ ...c, ocrModel: modelId }));
    const handleSetSelectedOcrModel = (id: string) => updateActiveConversation(c => ({ ...c, ocrModel: id }));
    const handleSetModeratorProvider = (providerId: string) => updateActiveConversation(c => ({ ...c, moderatorProviderId: providerId }));
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
        selectedOcrModel,
        moderatorProviderId,
        moderatorModel,
        handleSetVisionModel,
        handleSetSelectedOcrModel,
        handleSetModeratorProvider,
        handleSetModeratorModel,
    };
}
