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

    const updateMessages = useCallback((updater: (prevMessages: Message[]) => Message[], conversationId: string | null = activeConversationId) => {
        setConversationHistory(prevHistory => {
            return prevHistory.map(conv => {
                if (conv.id === conversationId) {
                    const next = updater(conv.messages);
                    // P2-16: Enforce the message cap. Pure FIFO would evict the
                    // FIRST user message — the conversation's anchor request
                    // that later re-analyses reference as chatHistory — so keep
                    // it and trim the oldest messages AFTER it.
                    const trimmed = next.length > MAX_MESSAGES_PER_CONVERSATION
                        ? [next[0], ...next.slice(next.length - MAX_MESSAGES_PER_CONVERSATION + 1)]
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
