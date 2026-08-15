import { useEffect, useRef } from 'react';
import { Conversation, Message, TradeOutcome } from '../types';
import { OutcomeAutopilotService, AutopilotResolution } from '../services/ui/OutcomeAutopilotService';
import { appendWatchEpisode } from '../utils/watchList';
import { autoJournalPolicyFor } from '../utils/approvalInbox';
import { describeWatchTick } from '../utils/watchTicks';
import { ticketExpiryLine } from '../utils/paperPnl';

interface WatchSideEffectsArgs {
    messagesRef: React.MutableRefObject<Message[]>;
    setConversationHistory: React.Dispatch<React.SetStateAction<Conversation[]>>;
    setAutopilotResolutions: React.Dispatch<React.SetStateAction<Record<string, AutopilotResolution>>>;
    toast: {
        success: (title: string, message?: string, action?: { label: string; onClick: () => void }) => void;
        warning: (title: string, message?: string) => void;
    };
    confirmAutopilot: React.MutableRefObject<(messageId: string) => void>;
}

/** Autopilot ticks, watched auto-log with undo, and ticket expiry episodes. */
export const useWatchSideEffects = ({
    messagesRef,
    setConversationHistory,
    setAutopilotResolutions,
    toast,
    confirmAutopilot,
}: WatchSideEffectsArgs): void => {
    const pendingTimers = useRef<Map<string, number>>(new Map());
    const expiredIds = useRef<Set<string>>(new Set());

    useEffect(() => {
        const unsubscribe = OutcomeAutopilotService.subscribe((messageId, resolution) => {
            setAutopilotResolutions(prev => ({ ...prev, [messageId]: resolution }));
            const watched = messagesRef.current.find(m => m.id === messageId)?.watched;
            const coin = messagesRef.current.find(m => m.id === messageId)?.analysis?.coinName;
            const policy = autoJournalPolicyFor(coin);
            if (watched && policy === 'deny') return;
            if (watched && policy === 'always') {
                confirmAutopilot.current(messageId);
                return;
            }
            if (!watched || resolution.expiredOpen) {
                toast.success('Autopilot: outcome detected', resolution.detail);
                return;
            }
            const existing = pendingTimers.current.get(messageId);
            if (existing) window.clearTimeout(existing);
            const timer = window.setTimeout(() => {
                pendingTimers.current.delete(messageId);
                confirmAutopilot.current(messageId);
            }, 15_000);
            pendingTimers.current.set(messageId, timer);
            toast.success('Logging in 15s', 'Undo to keep this setup open.', {
                label: 'Undo',
                onClick: () => {
                    const id = pendingTimers.current.get(messageId);
                    if (id) window.clearTimeout(id);
                    pendingTimers.current.delete(messageId);
                },
            });
        });
        const unsubscribeTicks = OutcomeAutopilotService.subscribeTicks((messageId, price, previousPrice) => {
            setConversationHistory(prev => prev.map(conv => {
                const index = conv.messages.findIndex(m => m.id === messageId);
                if (index < 0) return conv;
                const msg = conv.messages[index];
                if (!msg.watched || !msg.analysis) return conv;
                const tick = describeWatchTick(msg.analysis, price, previousPrice);
                if (!tick) return conv;
                const nextMessages = [...conv.messages];
                nextMessages[index] = appendWatchEpisode(msg, tick.kind, tick.detail);
                return { ...conv, messages: nextMessages };
            }));
        });
        return () => {
            unsubscribe();
            unsubscribeTicks();
        };
    }, [messagesRef, setAutopilotResolutions, setConversationHistory, toast, confirmAutopilot]);

    useEffect(() => {
        const scan = (): void => {
            setConversationHistory(prev => prev.map(conv => {
                let changed = false;
                const nextMessages = conv.messages.map(m => {
                    if (!m.watched || !m.analysis || (m.outcome && m.outcome !== TradeOutcome.PENDING)) return m;
                    const expiry = ticketExpiryLine(m.analysis);
                    if (!expiry?.expired || expiredIds.current.has(m.id)) return m;
                    expiredIds.current.add(m.id);
                    changed = true;
                    return appendWatchEpisode(m, 'expired', expiry.line);
                });
                return changed ? { ...conv, messages: nextMessages } : conv;
            }));
        };
        scan();
        const id = window.setInterval(scan, 30_000);
        return () => window.clearInterval(id);
    }, [setConversationHistory, toast]);
};
