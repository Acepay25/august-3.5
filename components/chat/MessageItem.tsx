
import React from 'react';
import { Message, MessageRole, TradeOutcome, SavedAnalysis, Conversation, DebateTurn, ConfidenceCalibration } from '../../types';
import { ChevronDownIcon, LinkIcon, CheckIcon, BrainIcon } from '../shared/Icons';
import MarkdownContent from '../shared/MarkdownContent';
import LiveMarketDataView from '../market/LiveMarketDataView';
import EnsembleProgressChat from '../analysis/EnsembleProgressChat';
import AnalysisDetails from './AnalysisDetails';
import LiveThinkingAccordion from './LiveThinkingAccordion';
import ThinkingModal from '../analysis/ThinkingModal';
import TodayReassessmentPanel from './TodayReassessmentPanel';
import { buildAnalysisMarkdown, buildSupplementMarkdown } from '../../utils/analysisUtils';
import { getThinkingByTrade, getThinkingTradeId } from '../../services/infrastructure/ThinkingStoreService';
import { ThinkingRecord } from '../../types/thinking';
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
    /** Failed-run retry: rebuild the prompt + charts from the user message. */
    onRetryFailedRun?: (userMessageId: string) => void;
    /** Edit a sent user message's text in place (persisted to history). */
    onEditUserMessage?: (messageId: string, text: string) => void;
    /** Mid-debate analyst replacement: pick a candidate (providerId) or pass
     *  null to continue without. Keyed by message id so a stale click from an
     *  earlier run is ignored. */
    onReplacementChoice?: (messageId: string, providerId: string | null) => void;
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
            const nextLength = Math.min(text.length, currentLength + Math.max(4, Math.ceil(text.length / 180)));
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
        activeFrameworks, modelIdToName, providerNameToId,
        handleInitiateLogTrade, handleInitiateSkipTrade, handleViewStrategyDetails, handleApplyStrategy,
        handleSaveAnalysis, handleInitiateUpdateTrade, handleInitiateSimulator,
        isSelectionMode, selectedMessageIds, onToggleMessageSelection,
        confidenceCalibration, onRetryPostMortem, leverage, onViewImage,
        autopilotResolutions, onConfirmAutopilot, onDismissAutopilot,
        onSelectMessageForProbability,
        onCompareAnalysis,
        onViewReasoning,
        onReRunAnalysis,
        onRetryFailedRun,
        onEditUserMessage,
        onReplacementChoice,
        copiedMessageId,
        handleCopy,
        onTodayReassessment,
        todayReassessmentInFlight,
    } = context;

    const isHighlighted = highlightedAnalysisId === message.id;
    const isUserMessage = message.role === MessageRole.USER;
    const [isThinkingModalOpen, setIsThinkingModalOpen] = React.useState(false);
    const [isRunLedgerOpen, setIsRunLedgerOpen] = React.useState(false);
    // ④ Debate replay — the finished debate re-read from the persisted
    // thinking_records (condensed: thesis → rebuttal → clarification → verdict).
    const [isReplayOpen, setIsReplayOpen] = React.useState(false);
    const [replayTurns, setReplayTurns] = React.useState<ThinkingRecord[] | null>(null);
    const [isReplayLoading, setIsReplayLoading] = React.useState(false);
    const [isMemoryGateExpanded, setIsMemoryGateExpanded] = React.useState(false);
    // Inline edit of a sent user message (history correction).
    const [editingMessageId, setEditingMessageId] = React.useState<string | null>(null);
    const [editDraft, setEditDraft] = React.useState('');
    const thinkingEntries = Object.entries({
        ...(message.thoughtProcesses ?? {}),
        ...(message.reasoningProcesses ?? {}),
    }).filter(([, content]) => Boolean(content));
    const isCasualReply = message.role === MessageRole.AI && !message.analysis && !message.isDebating;

    // ④ Debate replay — load the persisted debate_turn records for this run
    // (keyed by trade id) and expand them as a condensed replay.
    const handleToggleReplay = React.useCallback(async () => {
        if (isReplayOpen) { setIsReplayOpen(false); return; }
        setIsReplayLoading(true);
        try {
            const username = localStorage.getItem('last_active_user') || 'default';
            const tradeId = getThinkingTradeId(message.analysis?.createdAt, message.id);
            const records = await getThinkingByTrade(tradeId, username);
            const turns = records
                .filter(r => r.role === 'debate_turn')
                .sort((a, b) => (a.debateTurnIndex ?? 0) - (b.debateTurnIndex ?? 0));
            setReplayTurns(turns);
        } catch (e) {
            console.warn('[Replay] Failed to load debate transcript:', e);
            setReplayTurns([]);
        }
        setIsReplayLoading(false);
        setIsReplayOpen(true);
    }, [isReplayOpen, message.analysis?.createdAt, message.id]);
    // Ensemble reasoning is presented in the analyst progress/output card.
    // Do not duplicate it in the generic chat-level Thinking disclosure.
    const isEnsembleMessage = Boolean(
        message.ensembleProgress ||
        message.isDebating ||
        Object.keys(message.modelsUsed ?? {}).length > 1
    );
    const debateTurns = message.debateTurns ?? message.postMortemDebateTurns ?? [];

    React.useEffect(() => {
        if (isEnsembleMessage) {
            setIsThinkingModalOpen(false);
        }
    }, [isEnsembleMessage, message.id, thinkingEntries.length]);

    // Extract embedded Live Market JSON if present
    const liveMarketMatch = message.text.match(/\*\*LIVE MARKET DATA\*\*\s*```json\s*([\s\S]*?)\s*```/);
    const liveMarketJson = liveMarketMatch ? liveMarketMatch[1] : null;

    // Clean text to hide JSON blocks from view
    let displayContent = message.text;

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

    // The FULL plan markdown. Ensemble messages carry a stub text ("The
    // ensemble has concluded its debate.") — the real **FINAL TRADE PLAN**
    // block lives in analysis.strategy (the moderator's markdown verdict,
    // tags stripped). When that text is missing or came back as a parse
    // error (custom prompt overrides can break the parser), the parsed
    // JSON fields are re-organized into the same markdown layout so the
    // plan ALWAYS renders.
    const planMarkdown = React.useMemo(() => {
        const s = message.analysis?.strategy;
        if (s && !s.startsWith('Parsing Error:') && !s.startsWith('Connection Error:')) return s;
        if (message.analysis) {
            const built = buildAnalysisMarkdown(message.analysis);
            if (built) return built;
        }
        return displayContent;
    }, [message.analysis, displayContent]);

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
                ? 'bg-zinc-900/60 text-zinc-100 border border-purple-500/20 rounded-xl'
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
            className={`status-surface flex items-start gap-2 sm:gap-4 my-2 sm:my-4 px-2 sm:px-4 transition-all duration-200 lg:max-w-4xl lg:mx-auto
            ${message.role === MessageRole.USER ? 'justify-end' : message.role === MessageRole.SYSTEM ? 'justify-center' : ''} 
            ${isHighlighted ? 'ring-2 ring-blue-500/40 rounded-2xl bg-blue-900/10' : ''}
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
                        className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all focus-visible:ring-2 focus-visible:ring-cyan-400 ${isSelected ? 'bg-cyan-500 border-cyan-500' : 'border-zinc-500 bg-transparent'}`}
                        aria-label={`${isSelected ? 'Deselect' : 'Select'} message`}
                        aria-pressed={isSelected}
                    >
                        {isSelected && <CheckIcon className="w-3 h-3 text-white" />}
                    </button>
                </div>
            )}

            <div className={`${isUserMessage
                ? 'py-1 pl-1 pr-6 max-w-[85%] sm:max-w-3xl break-words relative group text-zinc-100'
                : 'w-full max-w-3xl break-words relative group'
                } ${isUserMessage ? '' : bubbleClass}`}>

                <>
                        {/* Post-Mortem Collapsible Header */}
                        {message.isPostMortem && (
                            <button
                                onClick={(e) => {
                                    if (isSelectionMode) return;
                                    setExpandedPostMortems(prev => ({ ...prev, [message.id]: !prev[message.id] }))
                                }}
                                className="flex items-center justify-between w-full mb-3 group select-none border-b border-purple-500/20 pb-2 focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
                                aria-expanded={!!expandedPostMortems[message.id]}
                                aria-controls={`post-mortem-content-${message.id}`}
                            >
                                <span className="text-xs font-black tracking-widest text-purple-400 uppercase group-hover:text-purple-300 transition-colors flex items-center gap-2">
                                    <span className="w-2 h-2 rounded-full bg-purple-500 animate-pulse"></span>
                                    POST-MORTEM ANALYSIS
                                </span>
                                <ChevronDownIcon className={`w-4 h-4 text-purple-400 transition-transform duration-300 ${expandedPostMortems[message.id] ? 'rotate-180' : ''}`} />
                            </button>
                        )}

                        {/* Main Content Container - Collapsible if Post-Mortem */}
                        <div id={message.isPostMortem ? `post-mortem-content-${message.id}` : undefined} className={`${message.isPostMortem ? `collapsible-content ${expandedPostMortems[message.id] ? 'expanded' : ''} w-full` : ''}`}>

                            {isCasualReply && !isEnsembleMessage && (
                                <div className="mb-4 border-b border-white/10 pb-3">
                                    <button type="button" onClick={() => setIsThinkingModalOpen(true)} className="flex w-full items-center gap-2 text-left text-sm text-zinc-500 hover:text-zinc-300 transition-colors" aria-haspopup="dialog">
                                        <BrainIcon className="h-4 w-4" />
                                        <span className="font-medium">Thinking</span>
                                        <span className="text-zinc-600">for a few seconds</span>
                                        <span className="ml-auto text-[10px] uppercase tracking-wider text-zinc-600">View</span>
                                    </button>
                                </div>
                            )}

                            {message.role === MessageRole.AI && !isCasualReply && !isEnsembleMessage && thinkingEntries.length > 0 && (
                                <div className="mb-4 border-b border-white/10 pb-3">
                                    <button type="button" onClick={() => setIsThinkingModalOpen(true)} className="flex w-full items-center gap-2 text-left text-sm text-zinc-500 hover:text-zinc-300 transition-colors" aria-haspopup="dialog">
                                        <BrainIcon className="h-4 w-4" />
                                        <span className="font-medium">Thinking</span>
                                        <span className="text-zinc-600">for a few seconds</span>
                                        <span className="ml-auto text-[10px] uppercase tracking-wider text-zinc-600">View</span>
                                    </button>
                                </div>
                            )}

                            {/* Live Market Data Component */}
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

                            {message.role === MessageRole.AI && !message.analysis && displayContent.trim() && (
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
                                        className="w-full bg-zinc-950 border border-cyan-500/40 rounded-lg p-2.5 text-sm text-zinc-100 outline-none focus:border-cyan-500 resize-y font-mono"
                                        aria-label="Edit message"
                                    />
                                    <div className="flex items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={() => { onEditUserMessage?.(message.id, editDraft); setEditingMessageId(null); }}
                                            className="px-3 py-1 rounded-lg bg-cyan-600 hover:bg-cyan-700 text-white text-[10px] font-bold uppercase tracking-widest transition-colors"
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
                            ) : message.analysis && planMarkdown.trim() ? (
                                // Analysis messages render the FINAL TRADE PLAN
                                // in the Trading-workspace presentation: one
                                // carded bubble with proper spacing, a label
                                // row, the plan as RENDERED markdown, and the
                                // harness-side supplement in the same box.
                                <div className="rounded-2xl border border-white/5 bg-zinc-900/80 p-4 sm:p-5 shadow-lg">
                                    <div className="flex items-center gap-2 mb-3">
                                        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                                        <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">Trading signal</span>
                                        {/* Regenerate the latest analysis with the same
                                            prompt + chart (appends a fresh signal; the
                                            old one stays for comparison). */}
                                        {context.latestMessageId === message.id && onReRunAnalysis && (
                                            <button
                                                type="button"
                                                onClick={() => onReRunAnalysis(message.id)}
                                                className="ml-auto text-[10px] font-bold uppercase tracking-widest text-zinc-500 hover:text-cyan-400 transition-colors"
                                                title="Adds a fresh analysis with the same prompt + chart; the old card is kept for comparison"
                                            >
                                                ↻ Regenerate
                                            </button>
                                        )}
                                    </div>
                                    <div className="prose-sm">
                                        <MarkdownContent content={planMarkdown} />
                                        {supplementMarkdown && (
                                            <div className="mt-4 pt-4 border-t border-white/5">
                                                <MarkdownContent content={supplementMarkdown} />
                                            </div>
                                        )}
                                    </div>
                                    {ensembleNote && (
                                        <p className="mt-3 pt-3 border-t border-white/5 text-[11px] text-zinc-500 leading-relaxed">{ensembleNote}</p>
                                    )}
                                </div>
                            ) : (
                                <div className={`prose prose-invert max-w-none whitespace-pre-wrap leading-[1.65] overflow-x-auto min-w-0 ${message.isPostMortem ? 'text-zinc-100' : 'text-zinc-200'}`} style={{ fontSize: '15px' }}>
                                    <SmoothText text={displayContent} animate={message.role === MessageRole.AI && context.latestMessageId === message.id && !message.analysis} />
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
                                    className="mt-3 inline-flex items-center gap-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-md text-sm font-medium transition-colors"
                                    aria-label="Retry the failed analysis with the same chart"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                    </svg>
                                    Retry with same chart
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
                                    className="mt-3 px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-md text-sm font-medium transition-colors flex items-center gap-2"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                    </svg>
                                    Retry Post-Mortem Analysis
                                </button>
                            )}

                            {Array.isArray(message.images) && message.images.length > 0 && (
                                <div className="mt-4 sm:mt-6">
                                    <div className={`grid gap-2 sm:gap-3 ${message.images.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
                                        {message.images.map((img, i) => (
                                            <button
                                                 type="button"
                                                 key={`${message.id}-img-${i}`}
                                                 className="group relative aspect-video rounded-xl sm:rounded-2xl overflow-hidden border border-white/10 shadow-md bg-zinc-900 cursor-zoom-in focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
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

                            {/* Analyst requests appear in chat before the moderator debate starts.
                                hideSubagents was ALWAYS true here and the floating activity card
                                it referenced doesn't exist — so during "Analyzing charts" the
                                user saw zero per-analyst activity. The live cards now stream in
                                the chat itself. */}
                            {!message.isDebating && !message.analysis && message.ensembleProgress && (
                                <EnsembleProgressChat progress={message.ensembleProgress} modelIdToName={modelIdToName} isLive onRetryAnalyst={onReRunAnalysis ? () => onReRunAnalysis(message.id) : undefined} />
                            )}

                            {/* Live debate — compact thinking line + per-analyst
                                reasoning accordion (expands in place; the full
                                round-by-round transcript stays in the panel). */}
                            {message.isDebating && (
                                <LiveThinkingAccordion message={message} modelIdToName={modelIdToName} />
                            )}

                            {/* Per-run summary — durations, gate cap, Monte Carlo (from runStats) */}
                            {message.analysis && message.runStats && (
                                <div className="mb-2">
                                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[9px] uppercase tracking-wider text-zinc-600">
                                        <span>Run {Math.round(message.runStats.durationMs / 1000)}s</span>
                                        {message.runStats.analystCount !== undefined && <span>{message.runStats.analystCount} analysts</span>}
                                        {message.runStats.gateCap !== undefined && <span>Gate cap {Math.round(message.runStats.gateCap * 100)}%</span>}
                                        {message.runStats.mcWinRate !== undefined && <span>MC win {message.runStats.mcWinRate}%</span>}
                                        {message.runStats.mcEV !== undefined && <span>MC EV {message.runStats.mcEV}R</span>}
                                        {message.runStats.btMatches !== undefined && message.runStats.btMatches > 0 && (
                                            <span title="How this exact setup did historically (similar past trades)">
                                                Similar setups: {message.runStats.btMatches} · {message.runStats.btWinRate !== undefined ? `${message.runStats.btWinRate.toFixed(0)}% WR` : '—'} · {message.runStats.btEV !== undefined ? `${message.runStats.btEV > 0 ? '+' : ''}${message.runStats.btEV}R` : '—'}
                                            </span>
                                        )}
                                        {message.runStats.analysts && message.runStats.analysts.length > 0 && (
                                            <button
                                                type="button"
                                                onClick={() => setIsRunLedgerOpen(o => !o)}
                                                aria-expanded={isRunLedgerOpen}
                                                className="text-zinc-500 hover:text-zinc-300 transition-colors"
                                                title="Per-analyst cost & latency ledger"
                                            >
                                                {isRunLedgerOpen ? '▾ Run ledger' : '▸ Run ledger'}
                                            </button>
                                        )}
                                        {(message.debateTurns?.length ?? 0) > 0 && (
                                            <button
                                                type="button"
                                                onClick={handleToggleReplay}
                                                aria-expanded={isReplayOpen}
                                                className="text-zinc-500 hover:text-zinc-300 transition-colors"
                                                title="Replay the finished debate from the persisted transcript (thesis → rebuttal → clarification → verdict)"
                                            >
                                                {isReplayOpen ? '▾ Replay' : '⤢ Replay'}
                                            </button>
                                        )}
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
                                    {isRunLedgerOpen && message.runStats.analysts && message.runStats.analysts.length > 0 && (
                                        <div className="mt-1.5 overflow-x-auto rounded-lg border border-white/10 bg-zinc-900/60">
                                            <table className="w-full text-left text-[9px] border-collapse">
                                                <thead>
                                                    <tr className="text-zinc-500 uppercase tracking-wide">
                                                        <th className="px-2 py-1 font-semibold">Analyst</th>
                                                        <th className="px-2 py-1 font-semibold">Model</th>
                                                        <th className="px-2 py-1 font-semibold">Time</th>
                                                        <th className="px-2 py-1 font-semibold">Output</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {message.runStats.analysts.map(a => (
                                                        <tr key={`${a.providerId}::${a.modelId}`} className="border-t border-white/5 text-zinc-300">
                                                            <td className="px-2 py-1 whitespace-nowrap max-w-[160px] truncate" title={a.displayName}>{a.displayName}</td>
                                                            <td className="px-2 py-1 whitespace-nowrap max-w-[140px] truncate text-zinc-400" title={a.modelId}>{a.modelId}</td>
                                                            <td className="px-2 py-1 whitespace-nowrap">{a.durationMs !== undefined ? `${(a.durationMs / 1000).toFixed(1)}s` : '—'}</td>
                                                            <td className="px-2 py-1 whitespace-nowrap">{a.charsOut !== undefined ? `${a.charsOut.toLocaleString()} chars` : '—'}</td>
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
                            {message.analysis && (
                                <AnalysisDetails
                                    messageId={message.id}
                                    analysis={message.analysis}
                                    outcome={message.outcome}
                                    autopilotResolution={autopilotResolutions?.[message.id]}
                                    onLogTrade={handleInitiateLogTrade}
                                    onConfirmAutopilot={onConfirmAutopilot}
                                    onDismissAutopilot={onDismissAutopilot}
                                    onSelectForProbability={onSelectMessageForProbability}
                                    onCompare={onCompareAnalysis}
                                />
                            )}

                            {/* ④ Debate replay — condensed replay of the FINISHED
                                debate, read from the persisted transcript. */}
                            {isReplayOpen && (
                                <div className="mt-3 rounded-xl border border-white/5 bg-zinc-900/60 overflow-hidden">
                                    <div className="flex items-center justify-between px-3 py-2 border-b border-white/5">
                                        <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Debate replay</span>
                                        <button
                                            type="button"
                                            onClick={() => setIsReplayOpen(false)}
                                            className="text-[9px] font-bold uppercase tracking-widest text-zinc-500 hover:text-zinc-300 transition-colors"
                                        >
                                            Close
                                        </button>
                                    </div>
                                    {isReplayLoading ? (
                                        <p className="p-3 text-[10px] text-zinc-600 italic">Loading transcript…</p>
                                    ) : !replayTurns || replayTurns.length === 0 ? (
                                        <p className="p-3 text-[10px] text-zinc-600 italic">No persisted debate transcript for this run.</p>
                                    ) : (
                                        <div className="p-3 space-y-2">
                                            {(() => {
                                                // Condense: a moderator turn starts a
                                                // new round; the LAST round is the
                                                // verdict (with the self-refine step).
                                                const rounds: { turns: { speaker: string; text: string; isModerator: boolean }[] }[] = [];
                                                for (const r of replayTurns) {
                                                    const isMod = (r.debateTurnSpeaker ?? '').toLowerCase().includes('moderator');
                                                    if (isMod || rounds.length === 0) rounds.push({ turns: [] });
                                                    rounds[rounds.length - 1].turns.push({
                                                        speaker: r.debateTurnSpeaker ?? r.provider ?? '?',
                                                        text: r.reasoning,
                                                        isModerator: isMod,
                                                    });
                                                }
                                                const labels = ['Thesis', 'Rebuttal', 'Clarification'];
                                                return rounds.map((round, i) => {
                                                    const isLast = i === rounds.length - 1;
                                                    const label = isLast ? 'Verdict' : (labels[i] ?? `Round ${i + 1}`);
                                                    return (
                                                        <details key={i} open={isLast} className="rounded-lg border border-white/5 bg-zinc-950/50">
                                                            <summary className="px-2.5 py-1.5 text-[9px] font-bold uppercase tracking-widest text-zinc-500 cursor-pointer hover:text-zinc-300 flex items-center gap-2">
                                                                {label} <span className="text-zinc-700">({round.turns.length} turns)</span>
                                                            </summary>
                                                            <div className="px-2.5 pb-2.5 space-y-1.5">
                                                                {round.turns.map((t, j) => (
                                                                    <div key={j} className="space-y-0.5">
                                                                        <p className={`text-[9px] font-bold uppercase tracking-widest ${t.isModerator ? 'text-cyan-400/80' : 'text-zinc-600'}`}>{t.speaker}</p>
                                                                        <p className="text-[10px] text-zinc-400 leading-relaxed whitespace-pre-wrap max-h-32 overflow-y-auto custom-scrollbar">{t.text}</p>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </details>
                                                    );
                                                });
                                            })()}
                                        </div>
                                    )}
                                </div>
                            )}

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
                                                         className="group aspect-video rounded-xl overflow-hidden border border-white/10 bg-zinc-900 cursor-zoom-in focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
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


                            {Array.isArray(message.sources) && message.sources.length > 0 && <div className="mt-4 sm:mt-6 pt-4 border-t border-white/10"><h4 className="text-xs uppercase font-bold text-zinc-500 mb-2 sm:mb-3 tracking-widest">Reference Sources</h4><ul className="text-xs sm:text-sm space-y-2 sm:space-y-3">{message.sources.map((source, index) => (<li key={`${message.id}-src-${index}`}>{isSafeUrl(source.web.uri) ? (<a href={source.web.uri} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:text-cyan-300 hover:underline break-all flex items-center gap-2"><LinkIcon /> {source.web.title}</a>) : (<span className="text-cyan-400 break-all flex items-center gap-2"><LinkIcon /> {source.web.title}</span>)}</li>))}</ul></div>}

                        </div>
                </>
            </div>
            <ThinkingModal
                isOpen={isThinkingModalOpen}
                onClose={() => setIsThinkingModalOpen(false)}
                title="Model thinking"
                subtitle={thinkingEntries.length > 0 ? `${thinkingEntries.length} reasoning trace${thinkingEntries.length === 1 ? '' : 's'}` : 'No separate reasoning trace'}
            >
                {thinkingEntries.length > 0 ? thinkingEntries.map(([providerId, content]) => (
                    <div key={providerId} className="mb-5 last:mb-0">
                        <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500">{providerId}</div>
                        <MarkdownContent content={content} className="text-sm leading-7 text-zinc-300" />
                    </div>
                )) : <p className="text-sm italic text-zinc-600">This model did not return a separate reasoning trace. Only the generated answer is available.</p>}
            </ThinkingModal>
        </div>
    );
});

export default MessageItem;
