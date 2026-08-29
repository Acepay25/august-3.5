
import React from 'react';
import { Message, MessageRole, TradeOutcome, SavedAnalysis, Conversation, ConfidenceCalibration, AnalystLensConfig, TradeAnalysis } from '../../types';
import { ChevronDownIcon, LinkIcon, CheckIcon } from '../shared/Icons';
import MarkdownContent from '../shared/MarkdownContent';
import StreamingMarkdown from '../shared/StreamingMarkdown';
import ReasoningRow from '../shared/ReasoningRow';
import LiveMarketDataView from '../market/LiveMarketDataView';
import TradingSignalCard from '../analysis/TradingSignalCard';
import VerdictSkeletonCard from '../analysis/VerdictSkeletonCard';
import DebateStage, { DebateStageActor } from '../analysis/DebateStage';
import DebateSidePanel from '../analysis/DebateSidePanel';
import ReplacementOfferCard from '../analysis/ReplacementOfferCard';
import ModelByline from '../shared/ModelByline';
import TodayReassessmentPanel from './TodayReassessmentPanel';
import { extractModeratorThinking } from '../../utils/analysisUtils';
import { isEnsembleMessage as isEnsembleMessageOf, stageActorsForMessage } from '../../utils/debateStageActors';
import { deriveMessageDisplayText } from '../../utils/messageDisplayText';
import { AutopilotResolution } from '../../services/ui/OutcomeAutopilotService';

// Helper to validate URLs (XSS prevention)
const isSafeUrl = (url: string): boolean => {
    return url.startsWith('http://') || url.startsWith('https://');
};

// Neutral insight card style — no provider brand hints (providers are
// user-configured, so names render as-is).
export interface ChatContextProps {
    typingMessageState: { id: string; fullText: string; field: 'postMortem' } | null;
    setTypingMessageState: React.Dispatch<React.SetStateAction<{ id: string; fullText: string; field: 'postMortem' } | null>>;
    handleTypingComplete: () => void;
    highlightedAnalysisId: string | null;
    expandedPostMortems: Record<string, boolean>;
    setExpandedPostMortems: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
    expandedPostMortemImages: Record<string, boolean>;
    setExpandedPostMortemImages: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
    savedAnalyses: SavedAnalysis[];
    activeFrameworks: string[];
    copiedMessageId: string | null;
    modelIdToName: Record<string, string>;
    ocrModelIdToName: Record<string, string>;
    providerNameToId: Record<string, string>;
    handleInitiateLogTrade: (messageId: string, outcome: TradeOutcome.WIN | TradeOutcome.LOSS) => void;
    handleInitiateSkipTrade: (messageId: string) => void;
    handleViewStrategyDetails: (strategyName: string) => void;
    handleApplyStrategy: (strategyName: string) => void;
    handleSaveAnalysis: (messageId: string) => void;
    handleCopy: (message: Message) => void;
    handleInitiateUpdateTrade: (messageId: string) => void;
    handleInitiateSimulator?: (messageId: string) => void; // Scenario Simulator
    // Retry failed post-mortem
    onRetryPostMortem?: (messageId: string) => void;
    // Post-mortem "what would I do today?" re-assessment
    onTodayReassessment?: (messageId: string) => void;
    todayReassessmentInFlight?: string | null;
    // Probability Selection
    onSelectMessageForProbability?: (id: string) => void;
    // Side-by-side compare of two analysis cards.
    onCompareAnalysis?: (messageId: string) => void;
    /** Opens the Trading Journal Think tab focused on this card's reasoning. */
    onViewReasoning?: (messageId: string) => void;
    /** F4: re-run the debate for a completed analysis card with the same setup. */
    onReRunAnalysis?: (messageId: string) => void;
    onToggleWatch?: (messageId: string) => void;
    /** Failed-run retry: rebuild the prompt + charts from the user message. */
    onRetryFailedRun?: (userMessageId: string) => void;
    /** Continue an interrupted debate from the last completed round. */
    onResumeDebate?: (messageId: string) => void;
    /** Steer or bench one seat mid-debate. */
    onSteerSeat?: (seatName: string, note: string) => void;
    onStopSeat?: (seatName: string) => void;
    /** Approval items attached to THIS message, rendered inline. */
    inlineApprovals?: import('../../utils/approvalInbox').ApprovalItem[];
    onApprovalAllow?: (item: import('../../utils/approvalInbox').ApprovalItem) => void;
    onApprovalDeny?: (item: import('../../utils/approvalInbox').ApprovalItem) => void;
    onApprovalAlways?: (item: import('../../utils/approvalInbox').ApprovalItem) => void;
    onApprovalNever?: (item: import('../../utils/approvalInbox').ApprovalItem) => void;
    onApprovalShow?: (item: import('../../utils/approvalInbox').ApprovalItem) => void;
    onFollowUpTicket?: (messageId: string, text: string) => void;
    /** Edit a sent user message's text in place (persisted to history). */
    onEditUserMessage?: (messageId: string, text: string) => void;
    /** Mid-debate analyst replacement: pick a candidate (providerId) or pass
     *  null to continue without. Keyed by message id so a stale click from an
     *  earlier run is ignored. */
    onReplacementChoice?: (messageId: string, providerId: string | null) => void;
    onForkDebate?: (messageId: string, round: number) => void;
    /** SessionGuard trade counter — rides the context so the log-trade action
     *  strip can show today's cap usage right next to the Win/Loss buttons. */
    sessionTradeCount?: { tradesToday: number; maxTradesPerDay: number };
    // Selection Mode Props
    isSelectionMode?: boolean;
    selectedMessageIds?: Set<string>;
    onToggleMessageSelection?: (id: string) => void;
    // Confidence Calibration
    confidenceCalibration?: ConfidenceCalibration;
    // Leverage for backtest P&L calculations
    leverage?: number;
    // Image viewer callback (for Android WebView compatibility)
    onViewImage?: (url: string) => void;
    // Outcome Autopilot — detected resolutions + confirm/dismiss handlers
    autopilotResolutions?: Record<string, AutopilotResolution>;
    onConfirmAutopilot?: (messageId: string) => void;
    onDismissAutopilot?: (messageId: string) => void;
    latestMessageId?: string | null;
    lensConfig?: AnalystLensConfig;
    priorAnalysisById?: Record<string, TradeAnalysis>;
    /** True inside a chat-mode 1:1 agent thread: plain messages render
     *  as reference-style chat bubbles (light right-aligned user bubble,
     *  dark agent bubble) instead of the flat debate-transcript look. */
    threadMode?: boolean;
    /** id of the user message immediately before each message (thread "You" bubble). */
    priorUserMessageById?: Record<string, Pick<Message, 'text' | 'createdAt'>>;
    /** External request to open the per-message side panel for a specific
     *  actor. The MessageItem whose `message.id` matches the field's
     *  `messageId` will mirror the requested `actorId` into its local
     *  panel-actor state; the App uses this to let the desk view (or
     *  any other surface) open the same side panel a user would open
     *  by clicking an actor on the in-transcript DebateStage. */
    externalOpenActor?: { messageId: string; actorId: string } | null;
    /** Counter bumped by the App when it sets `externalOpenActor`, so the
     *  MessageItem effect re-syncs even if the same {messageId,actorId}
     *  pair is requested twice in a row. */
    externalOpenActorNonce?: number;
}

const SmoothText: React.FC<{ text: string; animate: boolean }> = ({ text, animate }) => {
    const [visibleText, setVisibleText] = React.useState(animate ? '' : text);
    // The reveal is JS-driven (setTimeout), so the global CSS reduced-motion
    // block can't affect it — check the media query here. Clicking the text
    // skips the animation entirely.
    const reducedMotion = React.useRef(
        typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ).current;
    const skippedRef = React.useRef(false);

    React.useEffect(() => {
        if (!animate || reducedMotion || skippedRef.current) {
            setVisibleText(text);
            return;
        }
        let frame = 0;
        let cancelled = false;
        let currentLength = 0;
        const step = () => {
            if (cancelled) return;
            const nextLength = Math.min(text.length, currentLength + Math.max(6, Math.ceil(text.length / 90)));
            currentLength = nextLength;
            setVisibleText(text.slice(0, nextLength));
            if (nextLength < text.length) frame = window.setTimeout(step, 16);
        };
        setVisibleText('');
        frame = window.setTimeout(step, 16);
        return () => {
            cancelled = true;
            window.clearTimeout(frame);
        };
    // The animation is intentionally tied to the message text and animate flag.
    }, [text, animate, reducedMotion]);

    if (!animate || reducedMotion || skippedRef.current) return <>{text}</>;
    return (
        <span
            onClick={() => { skippedRef.current = true; setVisibleText(text); }}
            title="Click to reveal the full text instantly"
            className="cursor-pointer"
        >
            {visibleText}
        </span>
    );
};

const MessageItem = React.memo(({ message, context }: { message: Message, context: ChatContextProps }) => {
    const {
        typingMessageState, highlightedAnalysisId, expandedPostMortems, setExpandedPostMortems,
        expandedPostMortemImages, setExpandedPostMortemImages,
        savedAnalyses,
        activeFrameworks, modelIdToName,
        handleInitiateLogTrade, handleInitiateSkipTrade, handleViewStrategyDetails, handleApplyStrategy,
        handleSaveAnalysis, handleInitiateUpdateTrade, handleInitiateSimulator,
        isSelectionMode, selectedMessageIds, onToggleMessageSelection,
        confidenceCalibration, onRetryPostMortem, leverage, onViewImage,
        autopilotResolutions, onConfirmAutopilot, onDismissAutopilot,
        onSelectMessageForProbability,
        onCompareAnalysis,
        onViewReasoning,
        onReRunAnalysis,
        onToggleWatch,
        onRetryFailedRun,
        onResumeDebate,
        onSteerSeat,
        onStopSeat,
        onReplacementChoice,
        onForkDebate,
        inlineApprovals,
        onApprovalAllow,
        onApprovalDeny,
        onApprovalAlways,
        onApprovalNever,
        onApprovalShow,
        onFollowUpTicket,
        onEditUserMessage,
        copiedMessageId,
        handleCopy,
        onTodayReassessment,
        todayReassessmentInFlight,
        // External open-actor request — the desk view (or any other
        // surface) publishes {messageId, actorId} and the matching
        // MessageItem mirrors the actor into its local panel state.
        externalOpenActor,
        externalOpenActorNonce,
    } = context;

    const isHighlighted = highlightedAnalysisId === message.id;
    const isUserMessage = message.role === MessageRole.USER;
    const [isMemoryGateExpanded, setIsMemoryGateExpanded] = React.useState(false);
    // Inline edit of a sent user message (history correction).
    const [editingMessageId, setEditingMessageId] = React.useState<string | null>(null);
    const [editDraft, setEditDraft] = React.useState('');
    // Track whether this bubble streamed live — once text has been revealed
    // incrementally, the settle must not replay the SmoothText animation.
    const wasStreamingRef = React.useRef(false);
    if (message.isStreaming) wasStreamingRef.current = true;
    // Bubble-text derivation is shared with TranscriptRow (the settled
    // analysis row) via utils/messageDisplayText so the strip chain can
    // never drift between the two row components.
    const { displayContent, leakedThinking, liveMarketJson } =
        deriveMessageDisplayText(message);
    const thinkingEntries = Object.entries({
        ...(message.thoughtProcesses ?? {}),
        ...(message.reasoningProcesses ?? {}),
        ...(leakedThinking ? { __leaked: leakedThinking } : {}),
    }).filter(([, content]) => Boolean(content));
    // Ensemble reasoning is presented in the analyst progress/output card.
    // Do not duplicate it in the generic chat-level Thinking disclosure.
    const isEnsembleMessage = isEnsembleMessageOf(message);
    const debateTurns = message.debateTurns ?? message.postMortemDebateTurns ?? [];

    // Debate floor: one thinking bubble per debater in the chat
    // area; the full transcript streams in the right-hand side panel.
    // Actor derivation lives in utils/debateStageActors so the opt-in
    // DeskScene overlay projects the exact same debate state.
    const [debatePanelActor, setDebatePanelActor] = React.useState<string | null>(null);
    // External open-actor request (e.g. from the desk view). The App
    // publishes a {messageId, actorId} pair + a nonce; only the message
    // whose id matches the request mirrors the actor into its local
    // panel-actor state.
    React.useEffect(() => {
        if (!externalOpenActor || externalOpenActor.messageId !== message.id) return;
        setDebatePanelActor(externalOpenActor.actorId);
    }, [externalOpenActor, externalOpenActorNonce, message.id]);
    const stageActors = React.useMemo(
        (): DebateStageActor[] => stageActorsForMessage(message),
        [message],
    );

    // Live phase line for the floor caption — "Round 2 · Rebuttal rounds" —
    // so the watcher always knows where in the protocol the debate is.
    const livePhase = React.useMemo(() => {
        if (!message.isDebating) return undefined;
        const maxRound = debateTurns.reduce((m, t) => Math.max(m, t.round ?? 0), 0);
        const running = (message.runContract ?? []).find(s => s.state === 'running');
        const bits: string[] = [];
        if (maxRound > 0) bits.push(`Round ${maxRound}`);
        if (running) bits.push(running.label);
        return bits.length > 0 ? bits.join(' · ') : undefined;
    }, [message.isDebating, message.runContract, debateTurns]);

    // Exchange map: directed addressing edges (who replied to whom, how
    // often) — real back-and-forth vs parallel monologues at a glance.
    const debateExchanges = React.useMemo(() => {
        const counts = new Map<string, number>();
        for (const t of debateTurns) {
            if (!t.to?.length || t.speaker === 'System' || t.speaker === 'Moderator') continue;
            for (const target of t.to) {
                if (!target || target.toLowerCase() === t.speaker.toLowerCase()) continue;
                const key = `${t.speaker}\u0000${target}`;
                counts.set(key, (counts.get(key) ?? 0) + 1);
            }
        }
        return [...counts.entries()]
            .map(([key, count]) => {
                const sep = key.indexOf('\u0000');
                return { from: key.slice(0, sep), to: key.slice(sep + 1), count };
            })
            .sort((a, b) => b.count - a.count)
            .slice(0, 6);
    }, [debateTurns]);

    // While the debate is live, open the side transcript once so the full
    // thinking/output is visible beside the thinking bubbles.
    React.useEffect(() => {
        if (message.isDebating && stageActors.length > 0) {
            setDebatePanelActor(prev => prev ?? stageActors[0].id);
        }
    }, [message.isDebating, stageActors]);

    // Ensemble messages route their reasoning through the Floor surface. The
    // moderator's chain-of-thought still shows here as a Thinking row, but the
    // final verdict PROSE does NOT render in the chat area: the
    // TradingSignalCard below is the moderator's only chat-area output.
    const moderatorThinking = extractModeratorThinking(message.reasoningProcesses, message.thoughtProcesses);

    // Determine Bubble Styling - Clean modern design like ChatGPT/Gemini.
    // In a 1:1 agent thread (context.threadMode) plain messages render as
    // reference-style bubbles: light right-aligned user bubble, dark agent
    // bubble. Debate/analysis cards keep their own surfaces either way.
    const threadBubble = context?.threadMode === true;
    const bubbleClass = isUserMessage
        ? (threadBubble ? 'bg-zinc-200 text-zinc-900 rounded-2xl px-4 py-2.5' : '') // user messages render as plain text (Cursor-style, no bubble)
        : message.role === MessageRole.AI
            ? (message.isPostMortem
                ? 'bg-zinc-900/60 text-zinc-100 border border-white/10 rounded-xl'
                : threadBubble
                    ? 'bg-zinc-800/80 text-zinc-100 rounded-2xl px-4 py-3'
                    : 'bg-transparent text-zinc-200')
            : 'bg-rose-500/10 text-rose-300 border border-rose-500/20 text-center rounded-xl';

    const isSelected = selectedMessageIds?.has(message.id);

    const handleSelectionClick = (e: React.MouseEvent) => {
        if (isSelectionMode && onToggleMessageSelection) {
            e.preventDefault();
            e.stopPropagation();
            onToggleMessageSelection(message.id);
        }
    };



    return (
        <div
            id={`message-${message.id}`}
            className={`status-surface flex items-start gap-2 sm:gap-4 my-2 sm:my-4 px-3 sm:px-4 lg:px-8 transition-all duration-200 chat-column
            ${message.role === MessageRole.USER ? 'justify-end' : message.role === MessageRole.SYSTEM ? 'justify-center' : ''} 
            ${isHighlighted ? 'rounded-2xl' : ''}
            ${isSelectionMode ? 'cursor-pointer hover:bg-zinc-800 rounded-xl py-2' : ''}
        `}
            onClick={isSelectionMode ? handleSelectionClick : undefined}
        >
            {isSelectionMode && (
                <div className="flex items-center justify-center self-center pr-2">
                    <button
                        type="button"
                        onClick={(event) => {
                            event.stopPropagation();
                            handleSelectionClick(event);
                        }}
                        className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all focus-visible:ring-2 focus-visible:ring-zinc-500 ${isSelected ? 'bg-zinc-200 border-zinc-200' : 'border-zinc-500 bg-transparent'}`}
                        aria-label={`${isSelected ? 'Deselect' : 'Select'} message`}
                        aria-pressed={isSelected}
                    >
                        {isSelected && <CheckIcon className="w-3 h-3 text-white" />}
                    </button>
                </div>
            )}

            <div className={`${isUserMessage
                ? threadBubble
                    // Reference-style: the user bubble hugs its content.
                    ? 'py-1 pl-1 pr-6 max-w-[85%] w-fit break-words relative group'
                    : 'py-1 pl-1 pr-6 max-w-[85%] sm:max-w-none w-full break-words relative group text-zinc-100'
                : 'w-full break-words relative group'
                } ${isUserMessage ? '' : bubbleClass}`}>

                <>
                        {/* Post-Mortem Collapsible Header */}
                        {message.isPostMortem && (
                            <button
                                onClick={(e) => {
                                    if (isSelectionMode) return;
                                    setExpandedPostMortems(prev => ({ ...prev, [message.id]: !prev[message.id] }))
                                }}
                                className="flex items-center justify-between w-full mb-3 group select-none border-b border-white/10 pb-2 focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
                                aria-expanded={!!expandedPostMortems[message.id]}
                                aria-controls={`post-mortem-content-${message.id}`}
                            >
                                <span className="text-xs font-black tracking-widest text-zinc-400 uppercase group-hover:text-zinc-200 transition-colors flex items-center gap-2">
                                    <span className="w-2 h-2 rounded-full bg-zinc-500 animate-pulse"></span>
                                    POST-MORTEM ANALYSIS
                                </span>
                                <ChevronDownIcon className={`w-4 h-4 text-zinc-500 transition-transform duration-300 ${expandedPostMortems[message.id] ? 'rotate-180' : ''}`} />
                            </button>
                        )}

                        {/* Main Content Container - Collapsible if Post-Mortem */}
                        <div id={message.isPostMortem ? `post-mortem-content-${message.id}` : undefined} className={`${message.isPostMortem ? `collapsible-content ${expandedPostMortems[message.id] ? 'expanded' : ''} w-full` : ''}`}>

                            {/* Inline thinking trace — collapsible reasoning row.
                                Ensemble messages present their reasoning inside the
                                Floor surface instead of this bubble. */}
                            {message.role === MessageRole.AI && !isEnsembleMessage && thinkingEntries.length > 0 && (
                                <div className="mb-4">
                                    <ReasoningRow
                                        thinking={thinkingEntries.map(([, content]) => content).join('\n\n')}
                                        label={thinkingEntries.length > 1 ? `Thinking · ${thinkingEntries.length} traces` : 'Thinking'}
                                        running={!!message.isStreaming}
                                    />
                                </div>
                            )}

                            {/* Debate floor — thinking bubbles per debater;
                                full transcripts stream in the side panel. */}
                            {stageActors.length > 0 && (
                                <div className="mb-4">
                                    <DebateStage
                                        actors={stageActors}
                                        caption={message.isDebating ? 'Debate in progress' : 'Debate floor'}
                                        phase={livePhase}
                                        stages={message.isDebating ? message.runContract : undefined}
                                        exchanges={debateExchanges}
                                        live={Boolean(message.isDebating)}
                                        onOpenActor={id => setDebatePanelActor(id)}
                                        onSteerSeat={message.isDebating ? onSteerSeat : undefined}
                                        onStopSeat={message.isDebating ? onStopSeat : undefined}
                                    />
                                    {/* Mid-debate replacement: the engine suspends
                                        until a candidate is picked or skipped — the
                                        choice must be visible or the wait is wasted.
                                        Shared card also renders inside the side panel. */}
                                    {message.replacementOffer && onReplacementChoice && (
                                        <ReplacementOfferCard
                                            offer={message.replacementOffer}
                                            onChoice={providerId => onReplacementChoice(message.id, providerId)}
                                            className="mt-2"
                                        />
                                    )}
                                    <DebateSidePanel
                                        open={debatePanelActor !== null}
                                        onClose={() => setDebatePanelActor(null)}
                                        turns={debateTurns}
                                        actorIds={stageActors.map(a => a.id)}
                                        activeActor={debatePanelActor}
                                        onSelectActor={id => setDebatePanelActor(id)}
                                        isLive={Boolean(message.isDebating)}
                                        liveToolEvents={message.liveToolEvents}
                                        reasoningProcesses={message.reasoningProcesses}
                                        runLog={message.debateRunLog}
                                        analysis={message.analysis}
                                        messageId={message.id}
                                        onForkDebate={onForkDebate}
                                        replacementOffer={message.replacementOffer}
                                        onReplacementChoice={onReplacementChoice
                                            ? providerId => onReplacementChoice(message.id, providerId)
                                            : undefined}
                                    />
                                </div>
                            )}

                            {/* The old Floor seat cards are gone —
                                the stage bubbles + side panel render the debate. */}

                            {/* Ensemble reasoning in the bubble: the moderator's
                                chain-of-thought streams in a Thinking row, and the
                                final verdict prose renders in the chat area once the
                                debate settles. Analyst thinking stays in the Floor's
                                seat modals to avoid duplication. */}
                            {isEnsembleMessage && !message.isPostMortem && moderatorThinking && (
                                <div className="mt-3 mb-4">
                                    <ReasoningRow
                                        thinking={moderatorThinking}
                                        label="Moderator thinking"
                                        running={!!message.isDebating && !message.analysis}
                                    />
                                </div>
                            )}
                            {/* The moderator's verdict PROSE no longer
                                renders in the chat area — the signal card is
                                the only chat-area output. The full text stays
                                available via Replay debate + the side panel. */}
                            {/* Progressive verdict: while the moderator is still
                                writing, a complete plan already parsed from the
                                stream fills the signal card live. No action
                                buttons — the final verdict replaces this card.
                                Before the plan binds, a skeleton card fills in
                                line by line as the labeled fields land. */}
                            {isEnsembleMessage && !message.analysis && message.isDebating && (message.provisionalAnalysis || message.provisionalPlanFields) && (
                                <div className="mb-4">
                                    <div className="mb-2 flex items-center gap-2">
                                        <span className="streaming-dots" aria-hidden="true"><span /><span /><span /></span>
                                        <div className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                                            Verdict drafting
                                        </div>
                                    </div>
                                    {message.provisionalAnalysis ? (
                                        <div className="ui-panel">
                                            <TradingSignalCard
                                                analysis={message.provisionalAnalysis}
                                                isLatest={false}
                                                bare
                                            />
                                        </div>
                                    ) : (
                                        <VerdictSkeletonCard fields={message.provisionalPlanFields!} />
                                    )}
                                </div>
                            )}
                            {/* Pre-skeleton gap: the debate is live and no plan
                                field has landed yet — show an empty skeleton
                                card so the verdict area doesn't pop in later. */}
                            {isEnsembleMessage && !message.analysis && message.isDebating && !message.provisionalAnalysis && !message.provisionalPlanFields && (
                                <div className="mb-4">
                                    <VerdictSkeletonCard fields={{}} />
                                </div>
                            )}

                            {liveMarketJson && (
                                <div className="mb-4 sm:mb-6">
                                    <LiveMarketDataView jsonString={liveMarketJson} />
                                </div>
                            )}

                            {/* Pattern-memory gate — the user must see when
                                memory HALTED / downsized / warned the trade. */}
                            {message.patternMemoryGate && message.patternMemoryGate.gateResult !== 'PASS' && (
                                <div className={`mb-3 rounded-lg border p-3 ${message.patternMemoryGate.gateResult === 'HALT'
                                    ? 'status-surface border-rose-500/40 bg-rose-500/10'
                                    : message.patternMemoryGate.gateResult === 'REDUCE_SIZE'
                                        ? 'status-surface border-amber-500/40 bg-amber-500/10'
                                        : 'status-surface border-amber-500/30 bg-amber-500/5'}`}>
                                    <button
                                        type="button"
                                        onClick={() => setIsMemoryGateExpanded(o => !o)}
                                        className="w-full text-left flex items-start justify-between gap-2"
                                        aria-expanded={isMemoryGateExpanded}
                                    >
                                        <div className="flex items-center gap-2 min-w-0">
                                            <span className={`text-[10px] font-black uppercase tracking-widest ${message.patternMemoryGate.gateResult === 'HALT' ? 'text-rose-400' : 'text-amber-400'}`}>
                                                {message.patternMemoryGate.gateResult === 'HALT' ? '⛔ Memory gate: halted' : message.patternMemoryGate.gateResult === 'REDUCE_SIZE' ? '⚠️ Memory gate: reduce size' : '⚡ Memory gate: warning'}
                                            </span>
                                        </div>
                                        <ChevronDownIcon className={`w-3.5 h-3.5 text-zinc-500 shrink-0 transition-transform ${isMemoryGateExpanded ? 'rotate-180' : ''}`} />
                                    </button>
                                    <p className="text-[11px] text-zinc-300 mt-1.5 leading-relaxed">{message.patternMemoryGate.reason}</p>
                                    {isMemoryGateExpanded && (
                                        <div className="mt-2 space-y-1.5 animate-fade-in">
                                            {message.patternMemoryGate.mandatoryQuestions.map((q, i) => (
                                                <p key={i} className="text-[11px] text-zinc-400">• {q}</p>
                                            ))}
                                            {message.patternMemoryGate.historicalFailures.length > 0 && (
                                                <div className="pt-1.5 border-t border-white/5">
                                                    <p className="text-[9px] uppercase tracking-widest font-bold text-zinc-500 mb-1">Matched historical trades</p>
                                                    {message.patternMemoryGate.historicalFailures.map((f, i) => (
                                                        <p key={i} className="text-[11px] text-zinc-400 leading-snug">
                                                            <span className={`font-bold ${f.outcome === 'LOSS' ? 'text-rose-400' : 'text-emerald-400'}`}>{f.outcome}</span>
                                                            {f.coinName ? ` · ${f.coinName}` : ''}{f.direction ? ` ${f.direction}` : ''}
                                                            {f.keyLesson ? <span className="text-zinc-500"> — {f.keyLesson}</span> : null}
                                                        </p>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}

                            {message.role === MessageRole.AI && !message.analysis && displayContent.trim() && !message.isDebating && !message.ensembleProgress && !isEnsembleMessage && (
                                <div className="mb-2 flex items-center justify-between gap-2">
                                    <div className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                                        Final output
                                    </div>
                                </div>
                            )}
                            {isUserMessage && editingMessageId === message.id ? (
                                <div className="flex flex-col gap-2">
                                    <textarea
                                        value={editDraft}
                                        onChange={(e) => setEditDraft(e.target.value)}
                                        autoFocus
                                        rows={Math.min(8, Math.max(2, editDraft.split('\n').length))}
                                        className="w-full bg-zinc-950 border border-white/20 rounded-lg p-2.5 text-sm text-zinc-100 outline-none focus:border-white/30 resize-y font-mono"
                                        aria-label="Edit message"
                                    />
                                    <div className="flex items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={() => { onEditUserMessage?.(message.id, editDraft); setEditingMessageId(null); }}
                                            className="px-3 py-1 rounded-lg bg-zinc-200 hover:bg-zinc-100 text-zinc-950 text-[10px] font-bold uppercase tracking-widest transition-colors"
                                        >
                                            Save
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setEditingMessageId(null)}
                                            className="px-3 py-1 rounded-lg border border-white/10 text-zinc-400 hover:text-zinc-200 text-[10px] font-bold uppercase tracking-widest transition-colors"
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                </div>
                            ) : message.analysis ? (
                                // Settled analysis rows render via TranscriptRow —
                                // ChatArea's row dispatch routes every message.analysis
                                // row there, so this arm is unreachable. Kept as a
                                // documented no-op so the dispatch contract stays
                                // visible at the ternary.
                                null
                            ) : message.isPostMortem ? (
                                <div className="overflow-x-auto min-w-0">
                                    <MarkdownContent content={displayContent} className="text-zinc-100" />
                                </div>
                            ) : (message.isDebating || message.ensembleProgress) ? null : (
                                <div className="prose prose-invert max-w-none whitespace-pre-wrap leading-[1.65] overflow-x-auto min-w-0 text-zinc-200" style={{ fontSize: '15px' }}>
                                    {message.isStreaming ? (
                                        displayContent.trim() ? (
                                            <StreamingMarkdown text={displayContent} live className="text-zinc-200" />
                                        ) : (
                                            <span className="streaming-dots" aria-label="Generating">
                                                <span /><span /><span />
                                            </span>
                                        )
                                    ) : (
                                        <SmoothText text={displayContent} animate={message.role === MessageRole.AI && context.latestMessageId === message.id && !message.analysis && !wasStreamingRef.current} />
                                    )}
                                </div>
                            )}

                            {/* Edit affordance for sent user messages (hover). */}
                            {isUserMessage && editingMessageId !== message.id && onEditUserMessage && (
                                <button
                                    type="button"
                                    onClick={() => { setEditDraft(message.text); setEditingMessageId(message.id); }}
                                    className="mt-1 opacity-0 group-hover:opacity-100 transition-opacity text-[10px] font-bold uppercase tracking-widest text-zinc-500 hover:text-zinc-300"
                                    aria-label="Edit message"
                                >
                                    ✎ Edit
                                </button>
                            )}

                            {/* Failed-run retry: rebuild the same prompt + charts. */}
                            {message.retryOf && onRetryFailedRun && (
                                <button
                                    type="button"
                                    onClick={() => onRetryFailedRun(message.retryOf!.userMessageId)}
                                    className="mt-3 inline-flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 rounded-md text-sm font-medium transition-colors"
                                    aria-label="Retry the failed analysis with the same chart"
                                >
                                    Retry with same chart
                                </button>
                            )}

                            {!message.analysis && !message.isDebating && (message.debateCheckpoint || (message.debateTurns && message.debateTurns.length > 0)) && onResumeDebate && (
                                <button
                                    type="button"
                                    onClick={() => onResumeDebate(message.id)}
                                    className="mt-3 inline-flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 rounded-md text-sm font-medium transition-colors"
                                >
                                    Continue debate
                                </button>
                            )}

                            {/* "What would I do today?" — fresh re-assessment against today's price */}
                            {message.isPostMortem && onTodayReassessment && (
                                <TodayReassessmentPanel
                                    message={message}
                                    inFlight={todayReassessmentInFlight ?? null}
                                    onRequest={onTodayReassessment}
                                />
                            )}

                            {/* Retry button for failed post-mortem analysis.
                                The failed message is persisted as role AI (P2-15),
                                so gate on the candidate flag alone, not the role. */}
                            {message.postMortemFailedCandidate && onRetryPostMortem && (
                                <button
                                    onClick={() => onRetryPostMortem(message.id)}
                                    className="mt-3 px-4 py-2 bg-zinc-200 hover:bg-zinc-100 text-zinc-950 rounded-md text-sm font-medium transition-colors flex items-center gap-2"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                    </svg>
                                    Retry Post-Mortem Analysis
                                </button>
                            )}

                            {/* Quiet byline: who sat on this desk, how long. */}
                            {!isUserMessage && !message.isDebating && !message.isPostMortem && message.runStats && (
                                <ModelByline runStats={message.runStats} />
                            )}

                            {Array.isArray(message.images) && message.images.length > 0 && (
                                <div className="mt-4 sm:mt-6">
                                    <div className={`grid gap-2 sm:gap-3 ${message.images.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
                                        {message.images.map((img, i) => (
                                            <button
                                                 type="button"
                                                 key={`${message.id}-img-${i}`}
                                                 className="group relative aspect-video rounded-xl sm:rounded-2xl overflow-hidden border border-white/10 shadow-md bg-zinc-900 cursor-zoom-in focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
                                                 onClick={() => {
                                                     if (isSelectionMode) return;
                                                     if (onViewImage) onViewImage(img);
                                                 }}
                                                 aria-label={`View trade screenshot ${i + 1}`}
                                                 disabled={isSelectionMode}
                                             >
                                                <img
                                                    src={img}
                                                    className="w-full h-full object-cover hover:scale-105 transition-transform duration-500"
                                                    alt="trade screenshot"
                                                />
                                                {message.imageSummaries?.[i] && (
                                                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent p-2 sm:p-4 pt-8 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                                                        <p className="text-[10px] sm:text-xs font-mono text-zinc-300 truncate" title={message.imageSummaries[i]}>
                                                            {message.imageSummaries[i].replace(/Chart \d+ \| /, '')}
                                                        </p>
                                                    </div>
                                                )}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Main Analysis Result */}
                            {/* Main Analysis Result — markdown-only: the plan
                                text above carries the analysis; the bubble
                                adds the harness-side supplement (gate,
                                calibration, memory insight), context chips,
                                team verdict line, and the action row. */}
                            {/* Main Analysis Result lives in the signal panel above. */}

                            {Array.isArray(message.postMortemImages) && message.postMortemImages.length > 0 && (
                                <div className="mt-4 sm:mt-6 pt-3 sm:pt-5 border-t border-white/10">
                                    <button
                                        onClick={(e) => {
                                            if (isSelectionMode) return;
                                            setExpandedPostMortemImages(prev => ({ ...prev, [message.id]: !prev[message.id] }))
                                        }}
                                        className="flex justify-between items-center w-full text-left text-zinc-400 hover:text-white transition-colors py-2 sm:py-3"
                                        aria-expanded={expandedPostMortemImages[message.id]}
                                        aria-controls={`post-mortem-images-${message.id}`}
                                    >
                                        <strong className="text-xs sm:text-sm uppercase tracking-wider font-bold opacity-80">Post-Trade Evidence</strong><ChevronDownIcon className={`w-5 h-5 sm:w-6 sm:h-6 transform transition-transform duration-300 ${expandedPostMortemImages[message.id] ? 'rotate-180' : ''}`} />
                                    </button>
                                    <div id={`post-mortem-images-${message.id}`} className={`collapsible-content ${expandedPostMortemImages[message.id] ? 'expanded' : ''}`}>
                                        <div className="pt-3 sm:pt-5">
                                            <div className={`grid gap-2 sm:gap-3 ${message.postMortemImages.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
                                                {message.postMortemImages.map((img, i) => (
                                                    <button
                                                         type="button"
                                                         key={`${message.id}-pm-img-${i}`}
                                                         className="group aspect-video rounded-xl overflow-hidden border border-white/10 bg-zinc-900 cursor-zoom-in focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
                                                         onClick={() => {
                                                             if (isSelectionMode) return;
                                                             if (onViewImage) onViewImage(img);
                                                         }}
                                                         aria-label={`View post-mortem screenshot ${i + 1}`}
                                                         disabled={isSelectionMode}
                                                     >
                                                        <img src={img} className="w-full h-full object-cover hover:scale-105 transition-transform duration-500" alt={`post-mortem screenshot ${i + 1}`} />
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}


                            {Array.isArray(message.sources) && message.sources.length > 0 && <div className="mt-4 sm:mt-6 pt-4 border-t border-white/10"><h4 className="text-xs uppercase font-bold text-zinc-500 mb-2 sm:mb-3 tracking-widest">Reference Sources</h4><ul className="text-xs sm:text-sm space-y-2 sm:space-y-3">{message.sources.map((source, index) => (<li key={`${message.id}-src-${index}`}>{isSafeUrl(source.web.uri) ? (<a href={source.web.uri} target="_blank" rel="noopener noreferrer" className="text-zinc-300 hover:text-zinc-100 hover:underline break-all flex items-center gap-2"><LinkIcon /> {source.web.title}</a>) : (<span className="text-zinc-300 break-all flex items-center gap-2"><LinkIcon /> {source.web.title}</span>)}</li>))}</ul></div>}

                        </div>
                </>
            </div>
        </div>
    );
});

export default MessageItem;
