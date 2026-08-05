
import React from 'react';
import { Message, MessageRole, TradeOutcome, SavedAnalysis, Conversation, DebateTurn, ConfidenceCalibration, AnalystLensConfig } from '../../types';
import { ChevronDownIcon, LinkIcon, CheckIcon, BrainIcon } from '../shared/Icons';
import MarkdownContent from '../shared/MarkdownContent';
import LiveMarketDataView from '../market/LiveMarketDataView';
import DebateChat from '../analysis/DebateChat';
import EnsembleProgressChat from '../analysis/EnsembleProgressChat';
import AnalysisResult from '../analysis/AnalysisResult';
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
    loggingTradeId: string | null;
    activeFrameworks: string[];
    activeConversation: Conversation | undefined;
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
    // Probability Selection
    onSelectMessageForProbability?: (id: string) => void;
    // Side-by-side compare of two analysis cards.
    onCompareAnalysis?: (messageId: string) => void;
    // Selection Mode Props
    isSelectionMode?: boolean;
    selectedMessageIds?: Set<string>;
    onToggleMessageSelection?: (id: string) => void;
    // Confidence Calibration
    confidenceCalibration?: ConfidenceCalibration;
    // Analyst Lens Configuration
    lensConfig?: AnalystLensConfig;
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
        savedAnalyses, loggingTradeId,
        activeFrameworks, activeConversation, modelIdToName, providerNameToId,
        handleInitiateLogTrade, handleInitiateSkipTrade, handleViewStrategyDetails, handleApplyStrategy,
        handleSaveAnalysis, handleInitiateUpdateTrade, handleInitiateSimulator,
        isSelectionMode, selectedMessageIds, onToggleMessageSelection,
        confidenceCalibration, onRetryPostMortem, lensConfig, leverage, onViewImage,
        autopilotResolutions, onConfirmAutopilot, onDismissAutopilot,
        onSelectMessageForProbability,
        onCompareAnalysis
    } = context;

    const isHighlighted = highlightedAnalysisId === message.id;
    const isUserMessage = message.role === MessageRole.USER;
    const [isThinkingExpanded, setIsThinkingExpanded] = React.useState(false);
    const [isPreviousDebateExpanded, setIsPreviousDebateExpanded] = React.useState(false);
    const [isAnalystOutputsExpanded, setIsAnalystOutputsExpanded] = React.useState(false);
    const thinkingEntries = Object.entries({
        ...(message.thoughtProcesses ?? {}),
        ...(message.reasoningProcesses ?? {}),
    }).filter(([, content]) => Boolean(content));
    const isCasualReply = message.role === MessageRole.AI && !message.analysis && !message.isDebating;
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
            setIsThinkingExpanded(false);
        } else if (thinkingEntries.length > 0) {
            setIsThinkingExpanded(true);
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
                                    <button type="button" onClick={() => setIsThinkingExpanded(prev => !prev)} className="flex w-full items-center gap-2 text-left text-sm text-zinc-500 hover:text-zinc-300 transition-colors" aria-expanded={isThinkingExpanded}>
                                        <BrainIcon className="h-4 w-4" />
                                        <span className="font-medium">Thinking</span>
                                        <span className="text-zinc-600">for a few seconds</span>
                                        <ChevronDownIcon className={`ml-auto h-4 w-4 transition-transform ${isThinkingExpanded ? 'rotate-180' : ''}`} />
                                    </button>
                                    {isThinkingExpanded && (
                                        <div className="mt-3 max-h-[min(52vh,34rem)] space-y-3 overflow-y-auto overscroll-contain rounded-lg border border-white/5 bg-zinc-900/60 px-3 py-3 text-xs leading-relaxed text-zinc-500 custom-scrollbar">
                                            {thinkingEntries.length > 0
                                                ? thinkingEntries.map(([providerId, content]) => (
                                                    <MarkdownContent key={providerId} content={content} className="text-zinc-400" />
                                                ))
                                                : 'This model did not return a separate reasoning trace. Only the generated answer is available.'}
                                        </div>
                                    )}
                                </div>
                            )}

                            {message.role === MessageRole.AI && !isCasualReply && !isEnsembleMessage && thinkingEntries.length > 0 && (
                                <div className="mb-4 border-b border-white/10 pb-3">
                                    <button type="button" onClick={() => setIsThinkingExpanded(prev => !prev)} className="flex w-full items-center gap-2 text-left text-sm text-zinc-500 hover:text-zinc-300 transition-colors" aria-expanded={isThinkingExpanded}>
                                        <BrainIcon className="h-4 w-4" />
                                        <span className="font-medium">Thinking</span>
                                        <span className="text-zinc-600">for a few seconds</span>
                                        <ChevronDownIcon className={`ml-auto h-4 w-4 transition-transform ${isThinkingExpanded ? 'rotate-180' : ''}`} />
                                    </button>
                                    {isThinkingExpanded && <div className="mt-3 max-h-[min(52vh,34rem)] space-y-3 overflow-y-auto overscroll-contain rounded-lg border border-white/5 bg-zinc-900/60 px-3 py-3 text-xs leading-relaxed text-zinc-400 custom-scrollbar">{thinkingEntries.map(([providerId, content]) => <MarkdownContent key={providerId} content={content} className="text-zinc-400" />)}</div>}
                                </div>
                            )}

                            {/* Live Market Data Component */}
                            {liveMarketJson && (
                                <div className="mb-4 sm:mb-6">
                                    <LiveMarketDataView jsonString={liveMarketJson} />
                                </div>
                            )}

                            {message.role === MessageRole.AI && displayContent.trim() && (
                                <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                                    Final output
                                </div>
                            )}
                            <div className={`prose prose-invert prose-sm max-w-none whitespace-pre-wrap leading-[1.65] overflow-x-auto min-w-0 ${message.isPostMortem ? 'text-zinc-100' : 'text-zinc-200'}`}>
                                <SmoothText text={displayContent} animate={message.role === MessageRole.AI && context.latestMessageId === message.id && !message.analysis} />
                            </div>


                            {/* Retry button for failed post-mortem analysis */}
                            {message.role === MessageRole.SYSTEM && message.postMortemFailedCandidate && onRetryPostMortem && (
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

                            {/* Analyst requests appear in chat before the moderator debate starts. */}
                            {!message.isDebating && !message.analysis && message.ensembleProgress && (
                                <EnsembleProgressChat progress={message.ensembleProgress} modelIdToName={modelIdToName} isLive />
                            )}

                            {/* Live debates stay visible; completed cards default to the result only. */}
                            {message.isDebating && debateTurns.length > 0 && (
                                <DebateChat
                                    debateTurns={debateTurns}
                                    modelsUsed={message.modelsUsed}
                                    thoughtProcesses={message.thoughtProcesses}
                                    reasoningProcesses={message.reasoningProcesses}
                                    modelIdToName={modelIdToName}
                                    providerNameToId={providerNameToId}
                                    lensConfig={lensConfig}
                                    isDebating
                                    activeDebateSpeakers={message.activeDebateSpeakers}
                                    analysis={message.analysis}
                                />
                            )}

                            {/* Per-run summary — durations, gate cap, Monte Carlo (from runStats) */}
                            {message.analysis && message.runStats && (
                                <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[9px] uppercase tracking-wider text-zinc-600">
                                    <span>Run {Math.round(message.runStats.durationMs / 1000)}s</span>
                                    {message.runStats.analystCount !== undefined && <span>{message.runStats.analystCount} analysts</span>}
                                    {message.runStats.gateCap !== undefined && <span>Gate cap {Math.round(message.runStats.gateCap * 100)}%</span>}
                                    {message.runStats.mcWinRate !== undefined && <span>MC win {message.runStats.mcWinRate}%</span>}
                                    {message.runStats.mcEV !== undefined && <span>MC EV {message.runStats.mcEV}R</span>}
                                </div>
                            )}

                            {/* Main Analysis Result */}
                            {message.analysis && <AnalysisResult analysis={message.analysis} messageId={message.id} onLogTrade={handleInitiateLogTrade} onInitiateSkip={handleInitiateSkipTrade} onViewStrategy={handleViewStrategyDetails} onSaveAnalysis={handleSaveAnalysis} onUpdateTrade={handleInitiateUpdateTrade} onSimulate={handleInitiateSimulator} isSaved={savedAnalyses.some(sa => sa.id === message.id)} outcome={message.outcome} isLogging={loggingTradeId === message.id} activeFrameworks={activeFrameworks} onApplyStrategy={handleApplyStrategy} imageSummaries={message.imageSummaries} isAccuracyMode={message.isAccuracyMode} accuracySubMode={message.accuracySubMode} confidenceCalibration={confidenceCalibration} confluenceData={message.confluenceData} leverage={leverage} isLensMode={message.isLensMode} tradingStyle={message.tradingStyle} onSelectForProbability={onSelectMessageForProbability} autopilotResolution={autopilotResolutions?.[message.id]} onConfirmAutopilot={onConfirmAutopilot} onDismissAutopilot={onDismissAutopilot} onCompare={onCompareAnalysis} />}

                            {!message.isDebating && debateTurns.length > 0 && !message.analysis && (
                                <DebateChat
                                    debateTurns={debateTurns}
                                    modelsUsed={message.modelsUsed}
                                    thoughtProcesses={message.thoughtProcesses}
                                    reasoningProcesses={message.reasoningProcesses}
                                    modelIdToName={modelIdToName}
                                    providerNameToId={providerNameToId}
                                    lensConfig={lensConfig}
                                    activeDebateSpeakers={message.activeDebateSpeakers}
                                    analysis={message.analysis}
                                />
                            )}

                            {!message.isDebating && message.analysis && message.ensembleProgress && (
                                <div className="mt-4 border-t border-white/10 pt-3">
                                    <button
                                        type="button"
                                        onClick={() => setIsAnalystOutputsExpanded(previous => !previous)}
                                        className="flex w-full items-center justify-between rounded-xl border border-white/5 bg-zinc-900/60 px-3 py-2.5 text-left text-xs font-semibold text-zinc-400 transition-colors hover:border-cyan-400/20 hover:bg-zinc-800/80 hover:text-zinc-200 focus-visible:ring-2 focus-visible:ring-cyan-400"
                                        aria-expanded={isAnalystOutputsExpanded}
                                        aria-controls={`analyst-outputs-${message.id}`}
                                    >
                                        <span>Analyst outputs</span>
                                        <ChevronDownIcon className={`h-4 w-4 transition-transform ${isAnalystOutputsExpanded ? 'rotate-180' : ''}`} />
                                    </button>
                                    {isAnalystOutputsExpanded && (
                                        <div id={`analyst-outputs-${message.id}`}>
                                            <EnsembleProgressChat progress={message.ensembleProgress} modelIdToName={modelIdToName} />
                                        </div>
                                    )}
                                </div>
                            )}

                            {!message.isDebating && message.analysis && debateTurns.length > 0 && (
                                <div className="mt-4 border-t border-white/10 pt-3">
                                    <button
                                        type="button"
                                        onClick={() => setIsPreviousDebateExpanded(previous => !previous)}
                                        className="flex w-full items-center justify-between rounded-xl border border-white/5 bg-zinc-900/60 px-3 py-2.5 text-left text-xs font-semibold text-zinc-400 transition-colors hover:border-cyan-400/20 hover:bg-zinc-800/80 hover:text-zinc-200 focus-visible:ring-2 focus-visible:ring-cyan-400"
                                        aria-expanded={isPreviousDebateExpanded}
                                        aria-controls={`previous-debate-${message.id}`}
                                    >
                                        <span>Previous debate</span>
                                        <ChevronDownIcon className={`h-4 w-4 transition-transform ${isPreviousDebateExpanded ? 'rotate-180' : ''}`} />
                                    </button>
                                    {isPreviousDebateExpanded && (
                                        <div id={`previous-debate-${message.id}`}>
                                            <DebateChat
                                                debateTurns={debateTurns}
                                                modelsUsed={message.modelsUsed}
                                                thoughtProcesses={message.thoughtProcesses}
                                                reasoningProcesses={message.reasoningProcesses}
                                                modelIdToName={modelIdToName}
                                                providerNameToId={providerNameToId}
                                                lensConfig={lensConfig}
                                                activeDebateSpeakers={message.activeDebateSpeakers}
                                            />
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
        </div>
    );
});

export default MessageItem;
