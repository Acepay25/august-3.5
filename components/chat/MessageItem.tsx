
import React from 'react';
import { Message, MessageRole, TradeOutcome, SavedAnalysis, Conversation, ConfidenceCalibration, AnalystLensConfig, TradeAnalysis } from '../../types';
import { ChevronDownIcon, LinkIcon, CheckIcon } from '../shared/Icons';
import MarkdownContent from '../shared/MarkdownContent';
import StreamingMarkdown from '../shared/StreamingMarkdown';
import ReasoningRow from '../shared/ReasoningRow';
import LiveMarketDataView from '../market/LiveMarketDataView';
import DebateSummary from '../analysis/DebateSummary';
import TradingSignalCard from '../analysis/TradingSignalCard';
import VerdictSkeletonCard from '../analysis/VerdictSkeletonCard';
import DebateReplay from '../analysis/DebateReplay';
import DebateStage, { DebateStageActor } from '../analysis/DebateStage';
import DebateSidePanel from '../analysis/DebateSidePanel';
import DebateRunLog from '../analysis/DebateRunLog';
import RunContractPanel from '../analysis/RunContractPanel';
import EvidencePackCard from '../analysis/EvidencePackCard';
import ModelByline from '../shared/ModelByline';
import AnalysisTracePanel from '../analysis/AnalysisTracePanel';
import AnalysisDetails from './AnalysisDetails';
import SetupLifecycleCard from '../analysis/SetupLifecycleCard';
import TodayReassessmentPanel from './TodayReassessmentPanel';
import { buildSupplementMarkdown, extractFinalVerdictText, extractModeratorThinking } from '../../utils/analysisUtils';
import { extractAndStripThinkBlocks } from '../../utils/thinkingSplit';
import { formatModelDisplayName } from '../../utils/providerUtils';
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
    onFollowUpTicket?: (messageId: string, text: string) => void;
    /** Edit a sent user message's text in place (persisted to history). */
    onEditUserMessage?: (messageId: string, text: string) => void;
    /** Mid-debate analyst replacement: pick a candidate (providerId) or pass
     *  null to continue without. Keyed by message id so a stale click from an
     *  earlier run is ignored. */
    onReplacementChoice?: (messageId: string, providerId: string | null) => void;
    onForkDebate?: (messageId: string, round: number) => void;
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
    /** id of the user message immediately before each message (thread "You" bubble). */
    priorUserMessageById?: Record<string, Pick<Message, 'text' | 'createdAt'>>;
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
        onFollowUpTicket,
        onEditUserMessage,
        copiedMessageId,
        handleCopy,
        onTodayReassessment,
        todayReassessmentInFlight,
    } = context;

    const isHighlighted = highlightedAnalysisId === message.id;
    const isUserMessage = message.role === MessageRole.USER;
    const [isRunLedgerOpen, setIsRunLedgerOpen] = React.useState(false);
    const [isMemoryGateExpanded, setIsMemoryGateExpanded] = React.useState(false);
    // Inline edit of a sent user message (history correction).
    const [editingMessageId, setEditingMessageId] = React.useState<string | null>(null);
    const [editDraft, setEditDraft] = React.useState('');
    const [isReplayOpen, setIsReplayOpen] = React.useState(false);
    // Track whether this bubble streamed live — once text has been revealed
    // incrementally, the settle must not replay the SmoothText animation.
    const wasStreamingRef = React.useRef(false);
    if (message.isStreaming) wasStreamingRef.current = true;
    // Peel any think-tag scaffolding out of the stored text at render time so
    // it never shows in the bubble; the peeled CoT joins the Thinking row.
    const peeled = extractAndStripThinkBlocks(message.text);
    const leakedThinking = peeled.leaked;
    const thinkingEntries = Object.entries({
        ...(message.thoughtProcesses ?? {}),
        ...(message.reasoningProcesses ?? {}),
        ...(leakedThinking ? { __leaked: leakedThinking } : {}),
    }).filter(([, content]) => Boolean(content));
    // Ensemble reasoning is presented in the analyst progress/output card.
    // Do not duplicate it in the generic chat-level Thinking disclosure.
    const isEnsembleMessage = Boolean(
        message.ensembleProgress ||
        message.isDebating ||
        Object.keys(message.modelsUsed ?? {}).length > 1
    );
    const debateTurns = message.debateTurns ?? message.postMortemDebateTurns ?? [];

    // Debate floor (ROUND-34): one thinking bubble per debater in the chat
    // area; the full transcript streams in the right-hand side panel.
    const [debatePanelActor, setDebatePanelActor] = React.useState<string | null>(null);
    const stageActors = React.useMemo((): DebateStageActor[] => {
        if (!isEnsembleMessage) return [];
        const active = message.activeDebateSpeakers ?? {};
        const names: string[] = [];
        for (const t of debateTurns) if (!names.includes(t.speaker)) names.push(t.speaker);
        for (const k of Object.keys(active)) if (!names.includes(k)) names.push(k);
        if (names.length === 0 && message.isDebating) names.push('Moderator');
        return names.map(name => {
            const last = debateTurns.slice().reverse().find(t => t.speaker === name);
            const isActive = Boolean(message.isDebating) && (active[name] ?? 0) > 0;
            const addressedTo = (last as { to?: string[] } | undefined)?.to;
            return {
                id: name,
                name,
                toneKey: name,
                live: Boolean(message.isDebating),
                // Bubbles show the thinking animation only — the output text
                // streams in the side panel, never in the chat bubble.
                thinking: isActive,
                speaking: false,
                speech: '',
                // Reference-style activity chip: "replying to X" from the
                // REPLY-TO routing, else the live desk-tool lookup line.
                toolChip: addressedTo?.length
                    ? `replying to ${addressedTo.join(', ')}`
                    : (message.liveToolEvents ?? {})[name],
                thought: (last?.reasoning ?? '').replace(/\s+/g, ' ').slice(0, 72),
            };
        });
    }, [isEnsembleMessage, debateTurns, message.activeDebateSpeakers, message.isDebating]);

    // While the debate is live, open the side transcript once so the full
    // thinking/output is visible beside the thinking bubbles.
    React.useEffect(() => {
        if (message.isDebating && stageActors.length > 0) {
            setDebatePanelActor(prev => prev ?? stageActors[0].id);
        }
    }, [message.isDebating, stageActors]);

    // Ensemble messages route their reasoning through the Floor surface, but the
    // moderator's chain-of-thought and the final verdict prose should still be
    // visible in the chat area — not only inside the seat modal.
    const moderatorThinking = extractModeratorThinking(message.reasoningProcesses, message.thoughtProcesses);
    const verdictProse = React.useMemo(() => {
        if (message.analysis || !message.isDebating) {
            return extractFinalVerdictText(debateTurns, message.analysis?.strategy);
        }
        // Live: once plan fields start landing, the moderator's current turn
        // IS the verdict (clarification questions never carry a plan) — stream
        // its prose in the chat area while it is still being written.
        if (!message.provisionalAnalysis && !message.provisionalPlanFields) return '';
        const modTurns = debateTurns.filter(t => t.speaker === 'Moderator' && t.text.trim());
        return modTurns[modTurns.length - 1]?.text ?? '';
    }, [debateTurns, message.analysis, message.isDebating, message.provisionalAnalysis, message.provisionalPlanFields]);

    // Extract embedded Live Market JSON if present
    const liveMarketMatch = message.text.match(/\*\*LIVE MARKET DATA\*\*\s*```json\s*([\s\S]*?)\s*```/);
    const liveMarketJson = liveMarketMatch ? liveMarketMatch[1] : null;

    // Clean text to hide JSON blocks from view
    let displayContent = peeled.visible;

    // Hide Live Market Data JSON block if component is rendering it
    if (liveMarketJson) {
        displayContent = displayContent.replace(/\*\*LIVE MARKET DATA\*\*\s*```json[\s\S]*?```/, '').trim();
    }

    // Hide JSON_PLAN block if we have an analysis object to render it
    if (message.analysis) {
        displayContent = displayContent.replace(/<JSON_PLAN>[\s\S]*?<\/JSON_PLAN>/g, '').trim();
    }

    // Legacy prompt formats wrapped output in <THINKING>/<FINAL_OUTPUT> tags
    // or header-style labels. Strip residual scaffolding from cached and
    // historical messages so it never renders in the bubble.
    displayContent = displayContent
        .replace(/<THINKING>[\s\S]*?<\/THINKING>/gi, '')
        .replace(/<FINAL_OUTPUT>[\s\S]*?<\/FINAL_OUTPUT>/gi, '')
        .replace(/<\/?(?:THINKING|FINAL_OUTPUT)>/gi, '')
        .replace(/^\s*(?:\*\*)?(?:THINKING|FINAL OUTPUT|FINAL_OUTPUT)(?:\*\*)?\s*:?\s*$/gim, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

    // Structured Trading signal card (levels grid + verdict + plan).
    // Fallback to the raw display text only when there is no analysis object.

    // Accuracy-mode verification note — the stub sentence plus an optional
    // note ("Plan verified by the accuracy pass."); show only the note.
    const ensembleNote = displayContent.includes('The ensemble has concluded its debate.')
        ? displayContent.replace('The ensemble has concluded its debate.', '').trim()
        : '';

    // Harness-side data (gate, calibration, team verdict, memory insight,
    // freshness) — rendered as markdown sections inside the same card.
    const supplementMarkdown = React.useMemo(() => {
        return message.analysis ? buildSupplementMarkdown(message.analysis, confidenceCalibration) : '';
    }, [message.analysis, confidenceCalibration]);

    // Determine Bubble Styling - Clean modern design like ChatGPT/Gemini
    const bubbleClass = isUserMessage
        ? '' // user messages render as plain text (Cursor-style, no bubble)
        : message.role === MessageRole.AI
            ? (message.isPostMortem
                ? 'bg-zinc-900/60 text-zinc-100 border border-white/10 rounded-xl'
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
                ? 'py-1 pl-1 pr-6 max-w-[85%] sm:max-w-none w-full break-words relative group text-zinc-100'
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
                                        live={Boolean(message.isDebating)}
                                        onOpenActor={id => setDebatePanelActor(id)}
                                    />
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
                                    />
                                </div>
                            )}

                            {/* ROUND-34: the old Floor seat cards are gone —
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
                            {isEnsembleMessage && !message.isPostMortem && verdictProse && (
                                <div className="mb-4">
                                    <div className="mb-2 flex items-center justify-between gap-2">
                                        <div className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                                            Final output
                                        </div>
                                    </div>
                                    <div className="prose prose-invert max-w-none leading-[1.65] overflow-x-auto min-w-0 text-zinc-200" style={{ fontSize: '15px' }}>
                                        {message.isDebating ? (
                                            <StreamingMarkdown text={verdictProse} live className="text-zinc-200" />
                                        ) : (
                                            <MarkdownContent content={verdictProse} className="text-zinc-200" />
                                        )}
                                    </div>
                                </div>
                            )}

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
                                <div className="ui-panel">
                                <DebateSummary debateTurns={debateTurns} analysis={message.analysis} />
                                {debateTurns.length > 0 && (
                                    <div className="flex items-center justify-end border-b border-white/5 px-4 py-1.5">
                                        <button
                                            type="button"
                                            onClick={() => setIsReplayOpen(open => !open)}
                                            className="rounded border border-white/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-zinc-500 transition-colors hover:text-zinc-200"
                                        >
                                            {isReplayOpen ? 'Hide replay' : 'Replay debate'}
                                        </button>
                                    </div>
                                )}
                                {isReplayOpen && debateTurns.length > 0 && (
                                    <div className="border-b border-white/5 px-4 py-3">
                                        <DebateReplay turns={debateTurns} onClose={() => setIsReplayOpen(false)} />
                                    </div>
                                )}
                                <div className="border-t border-white/5">
                                <TradingSignalCard
                                    analysis={message.analysis}
                                    debateTurns={message.debateTurns}
                                    isLatest={context.latestMessageId === message.id}
                                    onReRun={onReRunAnalysis ? () => onReRunAnalysis(message.id) : undefined}
                                    supplementMarkdown={supplementMarkdown}
                                    ensembleNote={ensembleNote}
                                    calibration={confidenceCalibration}
                                    modelsUsed={message.modelsUsed}
                                    priorAnalysis={context.priorAnalysisById?.[message.id]}
                                    promptLane={message.runStats?.promptLane}
                                    runStats={message.runStats}
                                    onFollowUp={context.onFollowUpTicket ? (text) => context.onFollowUpTicket!(message.id, text) : undefined}
                                    leverage={leverage}
                                    bare
                                />
                                <AnalysisTracePanel message={message} />
                                </div>
                                <SetupLifecycleCard
                                    analysis={message.analysis}
                                    outcome={message.outcome}
                                    compact
                                    embedded
                                />
                                <div className="border-t border-white/5 px-4 pb-4">
                                <AnalysisDetails
                                    messageId={message.id}
                                    analysis={message.analysis}
                                    outcome={message.outcome}
                                    autopilotResolution={autopilotResolutions?.[message.id]}
                                    onLogTrade={handleInitiateLogTrade}
                                    onSkipTrade={handleInitiateSkipTrade}
                                    onConfirmAutopilot={onConfirmAutopilot}
                                    onDismissAutopilot={onDismissAutopilot}
                                    onSelectForProbability={onSelectMessageForProbability}
                                    onCompare={onCompareAnalysis}
                                    watched={Boolean(message.watched)}
                                    onToggleWatch={(id: string) => onToggleWatch?.(id)}
                                    message={message}
                                    tradingStyle={message.tradingStyle}
                                    highlighted={isHighlighted}
                                >
                                    {/* Audit surfaces (ROUND-28/U1+U2): run contract + verdict evidence. */}
                                    <RunContractPanel stages={message.runContract} />
                                    <EvidencePackCard pack={message.evidencePack} />
                                </AnalysisDetails>
                                </div>
                                {(message.debateRunLog && message.debateRunLog.length > 0) || message.runStats ? (
                                    <DebateRunLog events={message.debateRunLog ?? []} runStats={message.runStats} defaultOpen={false} />
                                ) : null}
                                </div>
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

                            {/* Quiet DeepSeek-style byline: who sat on this desk, how long. */}
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

                            {message.analysis && message.runStats?.analysts && message.runStats.analysts.length > 0 && (
                                <div className="mb-2">
                                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-zinc-500">
                                        <button
                                            type="button"
                                            onClick={() => setIsRunLedgerOpen(o => !o)}
                                            aria-expanded={isRunLedgerOpen}
                                            className="text-zinc-500 hover:text-zinc-300 transition-colors"
                                            title="Per-analyst cost & latency ledger"
                                        >
                                            {isRunLedgerOpen ? '▾ Run ledger' : '▸ Run ledger'}
                                        </button>
                                        {message.text && (
                                            <button
                                                type="button"
                                                onClick={() => handleCopy(message)}
                                                className="text-zinc-500 hover:text-zinc-300 transition-colors"
                                                title="Copy the full analysis text"
                                                aria-label="Copy analysis text"
                                            >
                                                {copiedMessageId === message.id ? '✓ Copied' : '⧉ Copy'}
                                            </button>
                                        )}
                                    </div>
                                    {isRunLedgerOpen && (
                                        <div className="mt-1.5 overflow-x-auto rounded-lg border border-white/10 bg-zinc-900/60">
                                            <table className="w-full text-left text-[11px] border-collapse">
                                                <thead>
                                                    <tr className="text-zinc-500">
                                                        <th className="px-2 py-1 font-medium">Analyst</th>
                                                        <th className="px-2 py-1 font-medium">Model</th>
                                                        <th className="px-2 py-1 font-medium">Time</th>
                                                        <th className="px-2 py-1 font-medium">Chars</th>
                                                        <th className="px-2 py-1 font-medium">Est. tok</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {message.runStats.analysts.map(a => (
                                                        <tr key={`${a.providerId}::${a.modelId}`} className="border-t border-white/5 text-zinc-300">
                                                            <td className="px-2 py-1 whitespace-nowrap max-w-[160px] truncate" title={a.displayName}>{a.displayName}</td>
                                                            <td className="px-2 py-1 whitespace-nowrap max-w-[140px] truncate text-zinc-400" title={a.modelId}>{formatModelDisplayName(a.modelId)}</td>
                                                            <td className="px-2 py-1 whitespace-nowrap">{a.durationMs !== undefined ? `${(a.durationMs / 1000).toFixed(1)}s` : '—'}</td>
                                                            <td className="px-2 py-1 whitespace-nowrap">{a.charsOut !== undefined ? a.charsOut.toLocaleString() : '—'}</td>
                                                            <td className="px-2 py-1 whitespace-nowrap">{
                                                                a.promptTokens !== undefined || a.completionTokens !== undefined
                                                                    ? ((a.promptTokens ?? 0) + (a.completionTokens ?? 0)).toLocaleString()
                                                                    : (a.charsOut !== undefined ? `~${Math.round(a.charsOut / 4).toLocaleString()}` : '—')
                                                            }</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
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
