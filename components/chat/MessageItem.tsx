
import React from 'react';
import { Message, MessageRole, TradeOutcome, SavedAnalysis, Conversation, DebateTurn, ConfidenceCalibration, AnalystLensConfig } from '../../types';
import { ChevronDownIcon, LinkIcon, CopyIcon, CheckIcon } from '../shared/Icons';
import LiveMarketDataView from '../market/LiveMarketDataView';
import DebateView from '../analysis/DebateView';
import AnalysisResult from '../analysis/AnalysisResult';
import { AutopilotResolution } from '../../services/ui/OutcomeAutopilotService';

// Helper to validate URLs (XSS prevention)
const isSafeUrl = (url: string): boolean => {
    return url.startsWith('http://') || url.startsWith('https://');
};

// Per-provider display metadata for thought-process insights, keyed by provider id.
// Legacy brand hints — unknown/custom provider ids fall back to DEFAULT_INSIGHT_STYLE.
const PROVIDER_INSIGHT_STYLES: Record<string, { name: string; bgClass: string; borderClass: string; titleClass: string; textClass: string }> = {
    gemini: { name: 'Gemini', bgClass: 'bg-blue-950/20', borderClass: 'border-blue-500/20', titleClass: 'text-blue-400', textClass: 'text-blue-100/90' },
    deepseek: { name: 'DeepSeek', bgClass: 'bg-emerald-950/20', borderClass: 'border-emerald-500/20', titleClass: 'text-emerald-400', textClass: 'text-emerald-100/90' },
    zhipu: { name: 'Zhipu AI', bgClass: 'bg-orange-950/20', borderClass: 'border-orange-500/20', titleClass: 'text-orange-400', textClass: 'text-orange-100/90' },
    groq: { name: 'Groq', bgClass: 'bg-yellow-950/20', borderClass: 'border-yellow-500/20', titleClass: 'text-yellow-400', textClass: 'text-yellow-100/90' },
    groq_new: { name: 'Groq (Alt)', bgClass: 'bg-lime-950/20', borderClass: 'border-lime-500/20', titleClass: 'text-lime-400', textClass: 'text-lime-100/90' },
    groq_alt2: { name: 'Groq (Alt 2)', bgClass: 'bg-rose-950/20', borderClass: 'border-rose-500/20', titleClass: 'text-rose-400', textClass: 'text-rose-100/90' },
    openrouter: { name: 'OpenRouter', bgClass: 'bg-emerald-950/20', borderClass: 'border-emerald-500/20', titleClass: 'text-emerald-400', textClass: 'text-emerald-100/90' },
    grok: { name: 'Grok (xAI)', bgClass: 'bg-sky-950/20', borderClass: 'border-sky-500/20', titleClass: 'text-sky-400', textClass: 'text-sky-100/90' },
};
const DEFAULT_INSIGHT_STYLE = { name: 'AI', bgClass: 'bg-zinc-950/20', borderClass: 'border-zinc-500/20', titleClass: 'text-zinc-400', textClass: 'text-zinc-100/90' };

export interface ChatContextProps {
    typingMessageState: { id: string; fullText: string; field: 'postMortem' } | null;
    setTypingMessageState: React.Dispatch<React.SetStateAction<{ id: string; fullText: string; field: 'postMortem' } | null>>;
    handleTypingComplete: () => void;
    highlightedAnalysisId: string | null;
    expandedPostMortems: Record<string, boolean>;
    setExpandedPostMortems: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
    expandedPostMortemImages: Record<string, boolean>;
    setExpandedPostMortemImages: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
    expandedIndividualThoughts: Record<string, boolean>;
    setExpandedIndividualThoughts: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
    expandedDebateTranscripts: Record<string, boolean>;
    setExpandedDebateTranscripts: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
    collapsedUserMessages: Record<string, boolean>;
    setCollapsedUserMessages: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
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
}

const MessageItem = React.memo(({ message, context }: { message: Message, context: ChatContextProps }) => {
    const {
        typingMessageState, highlightedAnalysisId, expandedPostMortems, setExpandedPostMortems,
        expandedPostMortemImages, setExpandedPostMortemImages, expandedIndividualThoughts, setExpandedIndividualThoughts,
        expandedDebateTranscripts, setExpandedDebateTranscripts, collapsedUserMessages, setCollapsedUserMessages,
        savedAnalyses, loggingTradeId,
        activeFrameworks, activeConversation, copiedMessageId, modelIdToName, ocrModelIdToName, providerNameToId,
        handleInitiateLogTrade, handleInitiateSkipTrade, handleViewStrategyDetails, handleApplyStrategy,
        handleSaveAnalysis, handleCopy, handleInitiateUpdateTrade, handleInitiateSimulator,
        isSelectionMode, selectedMessageIds, onToggleMessageSelection,
        confidenceCalibration, onRetryPostMortem, lensConfig, leverage, onViewImage,
        autopilotResolutions, onConfirmAutopilot, onDismissAutopilot,
        onSelectMessageForProbability
    } = context;

    const isHighlighted = highlightedAnalysisId === message.id;
    const isUserMessage = message.role === MessageRole.USER;
    const isCollapsed = isUserMessage && collapsedUserMessages[message.id];

    // Resolve a human-readable model name for a given provider id from message.modelsUsed.
    const resolveModelName = (providerId: string): string => {
        const modelId = message.modelsUsed?.[providerId];
        if (!modelId) return "Unknown";
        return modelIdToName[modelId] ?? modelId;
    };

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
                ? 'bg-zinc-800 text-zinc-100 border border-purple-500/20 rounded-2xl rounded-bl-md'
                : 'bg-zinc-800 text-zinc-200 border border-white/5 rounded-2xl rounded-bl-md')
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
            className={`flex items-start gap-2 sm:gap-4 my-2 sm:my-4 px-2 sm:px-4 transition-all duration-200 lg:max-w-3xl lg:mx-auto
            ${message.role === MessageRole.USER ? 'justify-end' : message.role === MessageRole.SYSTEM ? 'justify-center' : ''} 
            ${isHighlighted ? 'ring-2 ring-blue-500/40 rounded-2xl bg-blue-900/10' : ''}
            ${isSelectionMode ? 'cursor-pointer hover:bg-white/5 rounded-xl py-2' : ''}
        `}
            onClick={isSelectionMode ? handleSelectionClick : undefined}
        >
            {isSelectionMode && (
                <div className="flex items-center justify-center self-center pr-2">
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${isSelected ? 'bg-cyan-500 border-cyan-500' : 'border-zinc-500 bg-transparent'}`}>
                        {isSelected && <CheckIcon className="w-3 h-3 text-white" />}
                    </div>
                </div>
            )}

            <div className={`${isUserMessage
                ? 'py-1 pl-1 pr-6 max-w-[85%] sm:max-w-3xl break-words relative group text-zinc-100'
                : 'p-3 sm:p-5 rounded-2xl w-fit max-w-[85%] sm:max-w-3xl break-words shadow-sm border relative group'
                } ${isUserMessage ? '' : bubbleClass}`}>

                {isUserMessage && !isSelectionMode && (
                    <button
                        onClick={() => setCollapsedUserMessages(prev => ({ ...prev, [message.id]: !prev[message.id] }))}
                        className="absolute top-2 right-2 p-1.5 text-white/50 hover:text-white bg-black/10 hover:bg-black/30 rounded-full transition-all opacity-0 group-hover:opacity-100 focus:opacity-100 z-10"
                        title={isCollapsed ? "Expand message" : "Collapse message"}
                    >
                        <ChevronDownIcon className={`w-3 h-3 sm:w-4 sm:h-4 transition-transform duration-300 ${isCollapsed ? '' : 'rotate-180'}`} />
                    </button>
                )}

                {isCollapsed ? (
                    <div className="text-sm italic opacity-80 cursor-pointer pr-6 select-none" onClick={() => setCollapsedUserMessages(prev => ({ ...prev, [message.id]: false }))}>
                        {displayContent.length > 0 ? (displayContent.slice(0, 80) + (displayContent.length > 80 ? "..." : "")) : "Message collapsed"}
                    </div>
                ) : (
                    <>
                        {/* Post-Mortem Collapsible Header */}
                        {message.isPostMortem && (
                            <button
                                onClick={(e) => {
                                    if (isSelectionMode) return;
                                    setExpandedPostMortems(prev => ({ ...prev, [message.id]: !prev[message.id] }))
                                }}
                                className="flex items-center justify-between w-full mb-3 group select-none border-b border-purple-500/20 pb-2"
                            >
                                <span className="text-xs font-black tracking-widest text-purple-400 uppercase group-hover:text-purple-300 transition-colors flex items-center gap-2">
                                    <span className="w-2 h-2 rounded-full bg-purple-500 animate-pulse"></span>
                                    POST-MORTEM ANALYSIS
                                </span>
                                <ChevronDownIcon className={`w-4 h-4 text-purple-400 transition-transform duration-300 ${expandedPostMortems[message.id] ? 'rotate-180' : ''}`} />
                            </button>
                        )}

                        {/* Main Content Container - Collapsible if Post-Mortem */}
                        <div className={`${message.isPostMortem ? `collapsible-content ${expandedPostMortems[message.id] ? 'expanded' : ''} w-full` : ''}`}>

                            {/* Live Market Data Component */}
                            {liveMarketJson && (
                                <div className="mb-4 sm:mb-6">
                                    <LiveMarketDataView jsonString={liveMarketJson} />
                                </div>
                            )}

                            <div className={`prose prose-invert prose-sm sm:prose-lg max-w-none whitespace-pre-wrap leading-relaxed overflow-x-auto min-w-0 ${message.isPostMortem ? 'text-zinc-100' : 'text-zinc-200'}`}>
                                {displayContent}
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
                                            <div
                                                key={`${message.id}-img-${i}`}
                                                className="group relative aspect-video rounded-xl sm:rounded-2xl overflow-hidden border border-white/10 shadow-md bg-zinc-900 cursor-zoom-in"
                                                onClick={(e) => {
                                                    if (isSelectionMode) return;
                                                    if (onViewImage) onViewImage(img);
                                                }}
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
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Main Analysis Result */}
                            {message.analysis && <AnalysisResult analysis={message.analysis} messageId={message.id} onLogTrade={handleInitiateLogTrade} onInitiateSkip={handleInitiateSkipTrade} onViewStrategy={handleViewStrategyDetails} onSaveAnalysis={handleSaveAnalysis} onUpdateTrade={handleInitiateUpdateTrade} onSimulate={handleInitiateSimulator} isSaved={savedAnalyses.some(sa => sa.id === message.id)} outcome={message.outcome} isLogging={loggingTradeId === message.id} activeFrameworks={activeFrameworks} onApplyStrategy={handleApplyStrategy} imageSummaries={message.imageSummaries} isAccuracyMode={message.isAccuracyMode} accuracySubMode={message.accuracySubMode} confidenceCalibration={confidenceCalibration} confluenceData={message.confluenceData} leverage={leverage} isLensMode={message.isLensMode} tradingStyle={message.tradingStyle} onSelectForProbability={onSelectMessageForProbability} autopilotResolution={autopilotResolutions?.[message.id]} onConfirmAutopilot={onConfirmAutopilot} onDismissAutopilot={onDismissAutopilot} />}

                            {Array.isArray(message.postMortemImages) && message.postMortemImages.length > 0 && (
                                <div className="mt-4 sm:mt-6 pt-3 sm:pt-5 border-t border-white/10">
                                    <button
                                        onClick={(e) => {
                                            if (isSelectionMode) return;
                                            setExpandedPostMortemImages(prev => ({ ...prev, [message.id]: !prev[message.id] }))
                                        }}
                                        className="flex justify-between items-center w-full text-left text-zinc-400 hover:text-white transition-colors py-2 sm:py-3"
                                        aria-expanded={expandedPostMortemImages[message.id]}
                                    >
                                        <strong className="text-xs sm:text-sm uppercase tracking-wider font-bold opacity-80">Post-Trade Evidence</strong><ChevronDownIcon className={`w-5 h-5 sm:w-6 sm:h-6 transform transition-transform duration-300 ${expandedPostMortemImages[message.id] ? 'rotate-180' : ''}`} />
                                    </button>
                                    <div className={`collapsible-content ${expandedPostMortemImages[message.id] ? 'expanded' : ''}`}>
                                        <div className="pt-3 sm:pt-5">
                                            <div className={`grid gap-2 sm:gap-3 ${message.postMortemImages.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
                                                {message.postMortemImages.map((img, i) => (
                                                    <div
                                                        key={`${message.id}-pm-img-${i}`}
                                                        className="group aspect-video rounded-xl overflow-hidden border border-white/10 bg-zinc-900 cursor-zoom-in"
                                                        onClick={(e) => {
                                                            if (isSelectionMode) return;
                                                            if (onViewImage) onViewImage(img);
                                                        }}
                                                    >
                                                        <img src={img} className="w-full h-full object-cover hover:scale-105 transition-transform duration-500" alt={`post-mortem screenshot ${i + 1}`} />
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {message.role === MessageRole.AI && message.thoughtProcesses && Object.values(message.thoughtProcesses).some(c => c) && (
                                <div className="mt-4 sm:mt-6 pt-3 sm:pt-5 border-t border-white/10">
                                    <button
                                        onClick={(e) => {
                                            if (isSelectionMode) return;
                                            setExpandedIndividualThoughts(prev => ({ ...prev, [message.id]: !prev[message.id] }))
                                        }}
                                        className="flex justify-between items-center w-full text-left text-zinc-400 hover:text-white transition-colors py-2 sm:py-3"
                                        aria-expanded={expandedIndividualThoughts[message.id]}
                                    >
                                        <strong className="text-xs sm:text-sm uppercase tracking-wider font-bold opacity-80">Individual AI Insights</strong><ChevronDownIcon className={`w-5 h-5 sm:w-6 sm:h-6 transform transition-transform duration-300 ${expandedIndividualThoughts[message.id] ? 'rotate-180' : ''}`} />
                                    </button>
                                    <div className={`collapsible-content ${expandedIndividualThoughts[message.id] ? 'expanded' : ''}`}>
                                        <div className="pt-3 sm:pt-5 space-y-3 sm:space-y-4 text-xs sm:text-sm md:text-base">
                                            {/* Collapsible Insight Helper */}
                                            {(() => {
                                                const insights = Object.entries(message.thoughtProcesses ?? {})
                                                    .filter(([, content]) => content)
                                                    .map(([providerId, content]) => {
                                                        const style = PROVIDER_INSIGHT_STYLES[providerId] ?? DEFAULT_INSIGHT_STYLE;
                                                        return { providerId, provider: style.name, model: resolveModelName(providerId), content, bgClass: style.bgClass, borderClass: style.borderClass, titleClass: style.titleClass, textClass: style.textClass };
                                                    });

                                                return insights.map((insight) => {
                                                    const insightKey = `${message.id}-insight-${insight.providerId}`;
                                                    const isExpanded = expandedIndividualThoughts[insightKey] === true; // Default to collapsed
                                                    return (
                                                        <div key={insightKey} className={`${insight.bgClass} rounded-xl border ${insight.borderClass} overflow-hidden`}>
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    if (isSelectionMode) return;
                                                                    setExpandedIndividualThoughts(prev => ({ ...prev, [insightKey]: !isExpanded }));
                                                                }}
                                                                className="w-full flex items-center justify-between p-3 sm:p-4 hover:bg-white/5 transition-colors"
                                                            >
                                                                <p className={`font-bold ${insight.titleClass}`}>{insight.provider} ({insight.model})</p>
                                                                <ChevronDownIcon className={`w-4 h-4 ${insight.titleClass} transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`} />
                                                            </button>
                                                            <div className={`collapsible-content ${isExpanded ? 'expanded' : ''}`}>
                                                                <div className="px-4 pb-4 sm:px-5 sm:pb-5">
                                                                    <p className={`whitespace-pre-wrap ${insight.textClass} leading-relaxed`}>{insight.content}</p>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    );
                                                });
                                            })()}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Main Analysis Debate (Initial) */}
                            {message.isDebating && message.debateTurns && <DebateView debateTurns={message.debateTurns} modelsUsed={message.modelsUsed} modelIdToName={modelIdToName} providerNameToId={providerNameToId} lensConfig={lensConfig} isDebating={true} />}

                            {message.role === MessageRole.AI && !message.isDebating && Array.isArray(message.debateTurns) && message.debateTurns.length > 0 && (
                                <div className="mt-4 sm:mt-6 pt-3 sm:pt-5 border-t border-white/10">
                                    <button
                                        onClick={(e) => {
                                            if (isSelectionMode) return;
                                            setExpandedDebateTranscripts(prev => ({ ...prev, [message.id]: !prev[message.id] }))
                                        }}
                                        className="flex justify-between items-center w-full text-left text-zinc-400 hover:text-white transition-colors py-2 sm:py-3"
                                        aria-expanded={expandedDebateTranscripts[message.id]}
                                    >
                                        <strong className="text-xs sm:text-sm uppercase tracking-wider font-bold opacity-80">Debate Transcript</strong><ChevronDownIcon className={`w-5 h-5 sm:w-6 sm:h-6 transform transition-transform duration-300 ${expandedDebateTranscripts[message.id] ? 'rotate-180' : ''}`} />
                                    </button>
                                    <div className={`collapsible-content ${expandedDebateTranscripts[message.id] ? 'expanded' : ''}`}><DebateView debateTurns={message.debateTurns} modelsUsed={message.modelsUsed} modelIdToName={modelIdToName} providerNameToId={providerNameToId} lensConfig={lensConfig} /></div>
                                </div>
                            )}

                            {Array.isArray(message.sources) && message.sources.length > 0 && <div className="mt-4 sm:mt-6 pt-4 border-t border-white/10"><h4 className="text-xs uppercase font-bold text-zinc-500 mb-2 sm:mb-3 tracking-widest">Reference Sources</h4><ul className="text-xs sm:text-sm space-y-2 sm:space-y-3">{message.sources.map((source, index) => (<li key={`${message.id}-src-${index}`}>{isSafeUrl(source.web.uri) ? (<a href={source.web.uri} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:text-cyan-300 hover:underline break-all flex items-center gap-2"><LinkIcon /> {source.web.title}</a>) : (<span className="text-cyan-400 break-all flex items-center gap-2"><LinkIcon /> {source.web.title}</span>)}</li>))}</ul></div>}

                            {message.role === MessageRole.AI && !message.isDebating && !isSelectionMode && (
                                <div className="mt-4 sm:mt-6 pt-3 sm:pt-5 border-t border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-[10px] sm:text-sm text-zinc-500">
                                    <div className="flex flex-col gap-1.5 sm:gap-2">
                                        <div className="flex flex-wrap gap-x-4 sm:gap-x-6 gap-y-1">
                                            {Object.entries(message.modelsUsed ?? {}).map(([providerId, modelId]) => {
                                                const style = PROVIDER_INSIGHT_STYLES[providerId] ?? DEFAULT_INSIGHT_STYLE;
                                                const displayName = modelIdToName[modelId] ?? modelId;
                                                return (
                                                    <span key={providerId}>{style.name}: <span className="text-zinc-300">{displayName}</span></span>
                                                );
                                            })}
                                        </div>
                                        {message.ocrModelUsed && <span className="block">Vision: <span className="text-zinc-300">{(message.ocrModelUsed || '').split(',').map(id => id.trim()).map(id => ocrModelIdToName[id] || id).join(' & ')}</span></span>}
                                    </div>
                                    <button onClick={() => handleCopy(message)} className="self-start sm:self-auto flex items-center gap-2 text-zinc-400 hover:text-white transition-colors bg-white/5 hover:bg-white/10 px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg font-medium">{copiedMessageId === message.id ? (<><CheckIcon className="h-3 w-3 sm:h-4 sm:w-4 text-emerald-400" />Copied</>) : (<><CopyIcon />Copy Text</>)}</button>
                                </div>
                            )}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
});

export default MessageItem;
