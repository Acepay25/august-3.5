import { useCallback, useEffect } from 'react';
import { createNewConversation, findReusableEmptyConversation } from '../utils/conversationUtils';
import { loadLastModeratorPick } from '../services/ui/AnalystLensService';
import type { ConfirmOptions } from '../components/shared/ConfirmDialog';
import type { Conversation, Message } from '../types';

export interface UseConversationHousekeepingArgs {
    conversationHistory: Conversation[];
    setConversationHistory: React.Dispatch<React.SetStateAction<Conversation[]>>;
    activeConversation: Conversation | undefined;
    activeConversationId: string | null;
    setActiveConversationId: React.Dispatch<React.SetStateAction<string | null>>;
    updateMessages: (updater: (prev: Message[]) => Message[], conversationId?: string) => void;
    handleCancelAnalysis: () => void;
    invalidatePostMortemRuns: () => void;
    confirmDialog: (opts: ConfirmOptions) => Promise<boolean>;
    toast: { success: (title: string, message?: string) => void };
    isCommandPaletteOpen: boolean;
}

export interface UseConversationHousekeepingResult {
    handleClearAllConversations: () => Promise<void>;
    handleNewConversation: () => void;
    handleLoadConversation: (id: string) => void;
    handleDeleteConversations: (ids: string[]) => void;
    handleDeleteConversationFromSidebar: (id: string) => Promise<void>;
    handleDeleteSelectedConversations: (ids: string[]) => Promise<boolean>;
    handleEditUserMessage: (messageId: string, text: string) => void;
}

/**
 * Conversation housekeeping: create / reuse / load / delete sessions and
 * edit a sent user message. Also owns the keyboard shortcuts that drive
 * session flow — Ctrl/Cmd+N for a new conversation and "/" to focus the
 * composer (unless the user is typing or the command palette is open).
 */
export const useConversationHousekeeping = (args: UseConversationHousekeepingArgs): UseConversationHousekeepingResult => {
    const {
        conversationHistory, setConversationHistory,
        activeConversation, activeConversationId, setActiveConversationId,
        updateMessages, handleCancelAnalysis, invalidatePostMortemRuns,
        confirmDialog, toast, isCommandPaletteOpen,
    } = args;

    const handleClearAllConversations = async () => {
        const prevHistory = conversationHistory;
        const prevActiveId = activeConversationId;
        const ok = await confirmDialog({
            title: 'Clear all conversation history?',
            message: `This will remove ${conversationHistory.length} conversation(s). You can undo this for 5 seconds.`,
            confirmLabel: 'Clear All',
            destructive: true,
            onUndo: () => {
                setConversationHistory(prevHistory);
                setActiveConversationId(prevActiveId);
                toast.success('Conversations restored');
            },
        });
        if (ok) {
            handleCancelAnalysis();
            const newConv = createNewConversation();
            setConversationHistory([newConv]);
            setActiveConversationId(newConv.id);
        }
    };

    // F3: New conversation (Ctrl/Cmd+N shortcut + palette action).
    // Reuse an existing blank session instead of minting another empty one —
    // "New" from a filled session should return to the unused blank tab.
    const handleNewConversation = useCallback(() => {
        handleCancelAnalysis();
        invalidatePostMortemRuns();
        const reusable = findReusableEmptyConversation(conversationHistory, activeConversationId);
        if (reusable) {
            if (reusable.id !== activeConversationId) {
                setConversationHistory(prev => [
                    { ...reusable, timestamp: Date.now() },
                    ...prev.filter(c => c.id !== reusable.id),
                ]);
                setActiveConversationId(reusable.id);
            }
            return;
        }
        const newConv = createNewConversation();
        const lastModerator = loadLastModeratorPick();
        if (activeConversation) {
            newConv.ocrModel = activeConversation.ocrModel;
            newConv.moderatorProviderId = activeConversation.moderatorProviderId || lastModerator?.providerId || '';
            newConv.moderatorModel = activeConversation.moderatorModel || lastModerator?.model || '';
            newConv.leverage = activeConversation.leverage;
        } else if (lastModerator) {
            newConv.moderatorProviderId = lastModerator.providerId;
            newConv.moderatorModel = lastModerator.model;
        }
        setConversationHistory(prev => [newConv, ...prev]);
        setActiveConversationId(newConv.id);
    }, [handleCancelAnalysis, invalidatePostMortemRuns, conversationHistory, activeConversationId, activeConversation, setConversationHistory, setActiveConversationId]);

    // F3: Ctrl/Cmd+N = new conversation; "/" focuses the composer (unless
    // already typing or an overlay is open).
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
                e.preventDefault();
                handleNewConversation();
                return;
            }
            if (e.key === '/' && !isCommandPaletteOpen) {
                const target = e.target as HTMLElement | null;
                const isTyping = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
                if (isTyping) return;
                const composer = document.getElementById('chat-composer') as HTMLTextAreaElement | null;
                composer?.focus();
            }
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [handleNewConversation, isCommandPaletteOpen]);

    const handleLoadConversation = useCallback((id: string) => {
        if (id !== activeConversationId) {
            handleCancelAnalysis();
            invalidatePostMortemRuns();
            setActiveConversationId(id);
        }
    }, [activeConversationId, handleCancelAnalysis, invalidatePostMortemRuns, setActiveConversationId]);

    const handleDeleteConversations = (ids: string[]) => {
        // Single source of truth: filter from the same list we store, so the
        // active-conversation fallback can't reference a stale snapshot.
        const remaining = conversationHistory.filter(c => !ids.includes(c.id));
        setConversationHistory(remaining);
        if (activeConversationId && ids.includes(activeConversationId)) {
            handleCancelAnalysis();
            invalidatePostMortemRuns();
            if (remaining.length > 0) {
                setActiveConversationId(remaining[0].id);
            } else {
                // Don't reuse via handleNewConversation — that would see the
                // pre-delete history and resurrect the session we just removed.
                const newConv = createNewConversation();
                setConversationHistory([newConv]);
                setActiveConversationId(newConv.id);
            }
        }
    };

    // Sidebar delete: confirm + undo (5s grace) before removing a session.
    const handleDeleteConversationFromSidebar = async (id: string) => {
        const ok = await confirmDialog({
            title: 'Delete session?',
            message: 'This conversation and its messages will be removed. Logged trades are kept.',
            confirmLabel: 'Delete',
        });
        if (ok) handleDeleteConversations([id]);
    };

    const handleDeleteSelectedConversations = async (ids: string[]): Promise<boolean> => {
        if (ids.length === 0) return false;
        const ok = await confirmDialog({
            title: `Delete ${ids.length} session${ids.length === 1 ? '' : 's'}?`,
            message: `This will remove ${ids.length} selected conversation${ids.length === 1 ? '' : 's'} and their messages. Logged trades are kept.`,
            confirmLabel: 'Delete selected',
            destructive: true,
        });
        if (!ok) return false;
        handleDeleteConversations(ids);
        return true;
    };

    // Edit a sent user message's text in place (persisted to history).
    const handleEditUserMessage = useCallback((messageId: string, text: string) => {
        updateMessages(prev => prev.map(m => m.id === messageId ? { ...m, text } : m));
    }, [updateMessages]);

    return {
        handleClearAllConversations,
        handleNewConversation,
        handleLoadConversation,
        handleDeleteConversations,
        handleDeleteConversationFromSidebar,
        handleDeleteSelectedConversations,
        handleEditUserMessage,
    };
};
