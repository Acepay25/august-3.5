import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collectWatchedSignals, toggleWatchOnMessage } from '../utils/watchList';
import { buildRiskBook, formatRiskBookBadge } from '../utils/riskBook';
import { reconstructOpenings } from '../utils/debateResume';
import { PriceAlertService } from '../services/ui/PriceAlertService';
import { OutcomeAutopilotService, type AutopilotResolution } from '../services/ui/OutcomeAutopilotService';
import { DEFAULT_LEVERAGE } from '../utils/conversationUtils';
import type { ApprovalItem } from '../utils/approvalInbox';
import { TradeOutcome } from '../types';
import type { Conversation, LoggedTrade, Message } from '../types';

export interface UseWatchAndAutopilotArgs {
    messages: Message[];
    conversationHistory: Conversation[];
    loggedTrades: LoggedTrade[];
    activeConversationId: string | null;
    activeConversation: Conversation | undefined;
    updateMessages: (updater: (prev: Message[]) => Message[], conversationId?: string) => void;
    messagesRef: React.MutableRefObject<Message[]>;
    /** Stable send bridge — a fresh identity here would re-create chatContext
     *  (and re-render every visible MessageItem) per stream chunk. */
    stableHandleSendMessage: (...args: any[]) => any;
    handleLoadConversation: (id: string) => void;
    setHighlightedAnalysisId: (id: string | null) => void;
    setIsApprovalInboxVisible: (open: boolean) => void;
    setIsWatchListVisible: (open: boolean) => void;
    confirmAutopilotOutcome: (msg: Message, outcome: TradeOutcome.WIN | TradeOutcome.LOSS, pnlPercent?: number, slData?: any) => void;
    confirmAutopilotEntryNotHit: (msg: Message) => void;
    handleInitiateLogTrade: (messageId: string, outcome: TradeOutcome.WIN | TradeOutcome.LOSS) => void;
    /** Latest-ref bridge: the pipeline's resolution callbacks read the
     *  freshest confirm handler through this ref (assigned in the hook body). */
    confirmAutopilotRef: React.MutableRefObject<(messageId: string) => void>;
    toast: {
        success: (title: string, message?: string) => void;
    };
}

export interface UseWatchAndAutopilotResult {
    autopilotResolutions: Record<string, AutopilotResolution>;
    setAutopilotResolutions: React.Dispatch<React.SetStateAction<Record<string, AutopilotResolution>>>;
    handleApprovalShow: (item: ApprovalItem) => void;
    handleToggleWatch: (messageId: string, conversationId?: string | null) => void;
    watchedSignals: ReturnType<typeof collectWatchedSignals>;
    watchOpenR: string | undefined;
    handleFollowUpTicket: (messageId: string, text: string) => void;
    handlePreReadCommit: (messageId: string, prior: { direction: 'Long' | 'Short' | 'Flat'; confidencePct: number }) => void;
    handleOpenWatchedSignal: (conversationId: string, messageId: string) => void;
    handleConfirmAutopilot: (messageId: string) => void;
    runWatchListAction: (
        conversationId: string,
        action: { type: 'log'; messageId: string; outcome: TradeOutcome.WIN | TradeOutcome.LOSS } | { type: 'autopilot'; messageId: string },
    ) => void;
    handleDismissAutopilot: (messageId: string) => void;
}

/**
 * Watch list + outcome autopilot. Pinned signals derive from the
 * conversation history; the autopilot effect diffs pending verdicts into
 * the OutcomeAutopilotService (re-registering only on id/leverage change —
 * register() re-arms the 60s detection loop, so re-registering every stream
 * chunk would perpetually reset the timers). Resolutions surface in chat
 * via chatContext for inline one-click confirmation; watch-list actions
 * against another conversation defer until that conversation's messages
 * are actually loaded.
 */
export const useWatchAndAutopilot = (args: UseWatchAndAutopilotArgs): UseWatchAndAutopilotResult => {
    const {
        messages, conversationHistory, loggedTrades,
        activeConversationId, activeConversation, updateMessages, messagesRef,
        stableHandleSendMessage, handleLoadConversation,
        setHighlightedAnalysisId, setIsApprovalInboxVisible, setIsWatchListVisible,
        confirmAutopilotOutcome, confirmAutopilotEntryNotHit, handleInitiateLogTrade,
        confirmAutopilotRef, toast,
    } = args;

    const pendingWatchActionRef = useRef<
        | { type: 'log'; messageId: string; outcome: TradeOutcome.WIN | TradeOutcome.LOSS }
        | { type: 'autopilot'; messageId: string }
        | null
    >(null);

    const handleApprovalShow = useCallback((item: ApprovalItem) => {
        setHighlightedAnalysisId(item.messageId);
        setIsApprovalInboxVisible(false);
    }, [setHighlightedAnalysisId, setIsApprovalInboxVisible]);

    const handleToggleWatch = useCallback((messageId: string, conversationId?: string | null) => {
        const convId = conversationId || activeConversationId;
        if (!convId) return;
        updateMessages(prev => prev.map(m => {
            if (m.id !== messageId) return m;
            const nextWatch = !m.watched;
            const updated = toggleWatchOnMessage(m, nextWatch);
            if (updated.watched) {
                toast.success('Pinned', 'This signal is on the Watch list. Win/Loss and autopilot still work the same.');
            }
            return updated;
        }), convId);
    }, [activeConversationId, toast, updateMessages]);

    const watchedSignals = useMemo(() => collectWatchedSignals(conversationHistory), [conversationHistory]);
    const watchOpenR = useMemo(() => {
        const book = buildRiskBook(watchedSignals, loggedTrades, (symbol) => PriceAlertService.getCurrentPrice(symbol));
        return formatRiskBookBadge(book);
    }, [watchedSignals, loggedTrades]);

    const handleFollowUpTicket = useCallback((messageId: string, text: string) => {
        const msg = messagesRef.current.find(m => m.id === messageId);
        const analysis = msg?.analysis;
        const ocr = (msg?.ocrCache?.texts || []).join('\n').slice(0, 800);
        const openings = reconstructOpenings(msg?.debateTurns || [])
            .map(s => `${s.name}: ${s.opening.slice(0, 280)}`)
            .join('\n');
        const hidden = analysis
            ? `Follow-up on ${analysis.coinName || 'setup'} ${analysis.direction} SL ${analysis.stopLoss || '—'}. Do not re-open the tape; answer the user only.\n${openings ? `Prior openings:\n${openings}\n` : ''}${ocr ? `OCR:\n${ocr}` : ''}`
            : 'Follow-up on the latest ticket.';
        stableHandleSendMessage(text, [], hidden, { followUpFromMessageId: messageId });
    }, [stableHandleSendMessage]);

    // Pre-read capture: persist the user's committed prior
    // call onto the settled verdict's message BEFORE the card reveals.
    // Rides conversation history (same path as the watch toggle), copied
    // onto the LoggedTrade at log time by useTradeLogging.
    const handlePreReadCommit = useCallback((messageId: string, prior: { direction: 'Long' | 'Short' | 'Flat'; confidencePct: number }) => {
        const convId = activeConversationId;
        if (!convId) return;
        updateMessages(prev => prev.map(m => m.id === messageId
            ? { ...m, userPriorCall: { ...prior, confidencePct: Math.min(100, Math.max(0, prior.confidencePct)), createdAt: new Date().toISOString() } }
            : m), convId);
    }, [activeConversationId, updateMessages]);

    const handleOpenWatchedSignal = useCallback((conversationId: string, messageId: string) => {
        handleLoadConversation(conversationId);
        setHighlightedAnalysisId(messageId);
        setIsWatchListVisible(false);
    }, [handleLoadConversation, setHighlightedAnalysisId, setIsWatchListVisible]);

    // ─── Outcome autopilot ──────────────────────────────────────────────
    const [autopilotResolutions, setAutopilotResolutions] = useState<Record<string, AutopilotResolution>>({});

    // Diff ids instead of re-registering every message on every stream
    // chunk — register() re-arms the 60s detection loop, so the old effect
    // perpetually reset the timers while a debate streamed.
    const autopilotRegisteredRef = useRef<Set<string>>(new Set());
    const autopilotLeverageRef = useRef<number>(DEFAULT_LEVERAGE);

    useEffect(() => {
        const leverage = activeConversation?.leverage || DEFAULT_LEVERAGE;
        if (autopilotLeverageRef.current !== leverage) {
            // Leverage changed — re-register everything with the new value.
            autopilotRegisteredRef.current.clear();
            autopilotLeverageRef.current = leverage;
        }

        const trackableIds = new Set<string>();
        messages.forEach(m => {
            const trackable = m.outcome === TradeOutcome.PENDING
                && !!m.analysis
                && m.analysis.direction !== 'Neutral'
                && m.analysis.confidence !== 'Avoid'
                && (m.analysis.direction === 'Long' || m.analysis.direction === 'Short')
                && (m.analysis.entryPoints?.length ?? 0) > 0
                && !!m.analysis.stopLoss;
            if (trackable) {
                trackableIds.add(m.id);
                if (!autopilotRegisteredRef.current.has(m.id)) {
                    OutcomeAutopilotService.register(m.id, m.analysis!, leverage);
                    autopilotRegisteredRef.current.add(m.id);
                }
            } else if (autopilotRegisteredRef.current.has(m.id)) {
                OutcomeAutopilotService.unregister(m.id);
                autopilotRegisteredRef.current.delete(m.id);
            }
        });
        // Messages removed from the conversation entirely.
        for (const id of [...autopilotRegisteredRef.current]) {
            if (!trackableIds.has(id)) {
                OutcomeAutopilotService.unregister(id);
                autopilotRegisteredRef.current.delete(id);
            }
        }
    }, [messages, activeConversation?.leverage]);

    // Startup catch-up: once messages load, verify pending trades once
    // (covers outcomes that resolved while the app was closed).
    const autopilotCaughtUp = useRef(false);
    useEffect(() => {
        if (!autopilotCaughtUp.current && messages.length > 0) {
            autopilotCaughtUp.current = true;
            void OutcomeAutopilotService.checkNow();
        }
    }, [messages]);

    const handleConfirmAutopilot = useCallback((messageId: string) => {
        const msg = messages.find(m => m.id === messageId);
        const resolution = OutcomeAutopilotService.getResolution(messageId);
        if (!msg || !resolution || resolution.expiredOpen) return;
        if (resolution.outcome === TradeOutcome.ENTRY_NOT_HIT) {
            confirmAutopilotEntryNotHit(msg);
        } else {
            confirmAutopilotOutcome(msg, resolution.outcome, resolution.pnlPercent, resolution.slOptimizationData);
        }
        OutcomeAutopilotService.markProcessed(messageId);
        setAutopilotResolutions(prev => {
            const next = { ...prev };
            delete next[messageId];
            return next;
        });
        toast.success('Trade logged', `${resolution.outcome} confirmed via autopilot`);
    }, [messages, confirmAutopilotOutcome, confirmAutopilotEntryNotHit, toast]);
    confirmAutopilotRef.current = handleConfirmAutopilot;

    const runWatchListAction = useCallback((
        conversationId: string,
        action: { type: 'log'; messageId: string; outcome: TradeOutcome.WIN | TradeOutcome.LOSS } | { type: 'autopilot'; messageId: string },
    ) => {
        if (conversationId !== activeConversationId) {
            pendingWatchActionRef.current = action;
            handleLoadConversation(conversationId);
            setIsWatchListVisible(false);
            return;
        }
        if (action.type === 'log') handleInitiateLogTrade(action.messageId, action.outcome);
        else handleConfirmAutopilot(action.messageId);
        setIsWatchListVisible(false);
    }, [activeConversationId, handleConfirmAutopilot, handleInitiateLogTrade, handleLoadConversation, setIsWatchListVisible]);

    useEffect(() => {
        const pending = pendingWatchActionRef.current;
        if (!pending) return;
        if (!messages.some(m => m.id === pending.messageId)) return;
        pendingWatchActionRef.current = null;
        if (pending.type === 'log') handleInitiateLogTrade(pending.messageId, pending.outcome);
        else handleConfirmAutopilot(pending.messageId);
    }, [messages, handleInitiateLogTrade, handleConfirmAutopilot]);

    const handleDismissAutopilot = useCallback((messageId: string) => {
        OutcomeAutopilotService.dismiss(messageId);
        setAutopilotResolutions(prev => {
            const next = { ...prev };
            delete next[messageId];
            return next;
        });
    }, []);

    return {
        autopilotResolutions, setAutopilotResolutions,
        handleApprovalShow,
        handleToggleWatch,
        watchedSignals,
        watchOpenR,
        handleFollowUpTicket,
        handlePreReadCommit,
        handleOpenWatchedSignal,
        handleConfirmAutopilot,
        runWatchListAction,
        handleDismissAutopilot,
    };
};
