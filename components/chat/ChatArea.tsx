import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { Message, ImageMetadata, AccuracySubMode, AnalysisStep, AnalystLensConfig, LiveThoughts, ProviderConfig } from '../../types';
import { MessageRole } from '../../types/enums';
import { EnsembleModelSelection } from '../../services/ui/AnalystLensService';
import { RegimeProviderStatsMap } from '../../services/learning/SetupMemoryService';
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import ErrorBoundary from '../shared/ErrorBoundary';
import MessageItem, { ChatContextProps } from './MessageItem';
import { ChatInput } from './ChatInput';
import { ArrowUpIcon, ArrowDownIcon, CloseIcon, LoadingIcon, EyeIcon, BrainIcon, EditIcon, CheckIcon, TrashIcon } from '../shared/Icons';
import HybridDataPanel from '../analysis/HybridDataPanel';
import ImageViewerModal from '../modals/ImageViewerModal';
import WorkspaceWelcome, { WorkspaceWelcomeProps } from './WorkspaceWelcome';

// Hoisted list components to prevent re-creation on each render
const ListHeader = () => <div className="h-16"></div>;
// Reserve the full vertical footprint of the fixed composer so the final
// message can always scroll above it instead of being hidden underneath it.
const ListFooter: React.FC<{ isLoading?: boolean }> = ({ isLoading = false }) => (
    <div
        className={isLoading ? 'h-52 sm:h-56' : 'h-36 sm:h-40'}
        aria-hidden="true"
    />
);

interface ChatAreaProps {
    messages: Message[];
    chatContext: ChatContextProps;
    virtuosoRef: React.RefObject<VirtuosoHandle | null>;
    isRateLimited: boolean;
    setIsRateLimited: (val: boolean) => void;
    showScrollDown: boolean;
    setShowScrollDown: (val: boolean) => void;
    showScrollUp: boolean;
    setShowScrollUp: (val: boolean) => void;
    handleCycleAnalysisUp: () => void;
    handleScrollToBottom: () => void;
    highlightedAnalysisId: string | null;
    setHighlightedAnalysisId: (id: string | null) => void;
    analysisMessages: Message[];
    loadingMessage: string | null;
    isAnalysisInProgress: boolean;
    /** Notes queued while a debate is running — shown as chips on the composer. */
    steeringNotes?: string[];
    onRemoveSteeringNote?: (index: number) => void;
    isPostMortemInProgress: boolean;
    setIsLivePostMortemVisible: (val: boolean) => void;
    handleCancelAnalysis: () => void;
    onRetryFailedRun?: (userMessageId: string) => void;
    onEditUserMessage?: (messageId: string, text: string) => void;
    onDeleteMessages: (ids: string[]) => void;
    // ChatInput Props
    images: ImageMetadata[];
    removeImage: (index: number) => void;
    leverageInput: string;
    handleLeverageChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    handleLeverageBlur: (e: React.FocusEvent<HTMLInputElement>) => void;
    handlePresetLeverage: (value: number) => void;
    fileInputRef: React.RefObject<HTMLInputElement | null>;
    isImageUploadDisabled: boolean;
    handleImageUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
    input: string;
    setInput: (value: string) => void;
    handleSendMessage: () => void;
    isSummarizing: boolean;
    isAnyProviderEnabled: boolean;
    isAccuracyModeEnabled: boolean;
    accuracySubMode?: AccuracySubMode;
    // Ensemble Intelligence Props — dynamic provider list
    providers: ProviderConfig[];
    onUpdateProvider?: (id: string, updates: Partial<Omit<ProviderConfig, 'id' | 'isBuiltIn'>>) => Promise<void>;
    selectedVisionModel: string;
    setSelectedVisionModel: (modelId: string) => void;
    // Lens Config
    lensConfig: AnalystLensConfig;
    setLensConfig: (config: AnalystLensConfig) => void;
    // Ordinary ensemble model selection (Lenses off)
    ensembleModelSelection: EnsembleModelSelection;
    setEnsembleModelSelection: (selection: EnsembleModelSelection) => void;
    // Custom prompt overrides (prompt editor)
    customEnsemblePrompt: string | null;
    setCustomEnsemblePrompt: (prompt: string | null) => void;
    customLensPrompts: Record<string, string>;
    setCustomLensPrompts: (prompts: Record<string, string>) => void;
    // Ensemble mode toggle (casual chat vs chart analysis)
    isEnsembleEnabled: boolean;
    setIsEnsembleEnabled: (v: boolean) => void;
    /** Regime-matched provider win rates for the composer dropdown + lens auto-assign. */
    regimeProviderStats?: RegimeProviderStatsMap;
    // Casual-chat model (ensemble off)
    selectedChatModel: string;
    setSelectedChatModel: (modelId: string) => void;
    /** Debate moderator — forwarded to the Team modal. */
    moderatorProviderId?: string;
    moderatorModel?: string;
    onSetModeratorProvider?: (providerId: string) => void;
    onSetModeratorModel?: (modelId: string) => void;
    // Hybrid Intelligence Props
    hybridData?: any;
    isHybridLoading?: boolean;
    hybridConnectionStatus?: 'disconnected' | 'connecting' | 'connected' | 'error';
    // Hide the floating hybrid panel (e.g. while Settings is open).
    hideHybridPanel?: boolean;
    slOptimization?: any; // SL Optimization data for display
    suggestedEntryPrice?: number | null; // Entry Timing suggested entry price
    entryTimingScore?: {
        score: number;
        timingQuality: string;
        suggestedEntry?: { price: number; reason: string } | null;
    } | null;
    onOpenSettings?: (tab?: string) => void;
    onOpenLiveMarket?: () => void;
    onInteract?: () => void;
    onSelectMessageForProbability?: (id: string) => void;
    /** Returning-user summary shown when the active conversation is empty. */
    homeDashboard?: WorkspaceWelcomeProps;
    // Analysis Progress (Task UI)
    analysisSteps?: AnalysisStep[];
    isAnalysisActive?: boolean;
}

const ChatAreaInner: React.FC<ChatAreaProps> = ({
    messages,
    chatContext,
    virtuosoRef,
    isRateLimited,
    setIsRateLimited,
    showScrollDown,
    setShowScrollDown,
    showScrollUp,
    setShowScrollUp,
    handleCycleAnalysisUp,
    handleScrollToBottom,
    highlightedAnalysisId,
    setHighlightedAnalysisId,
    analysisMessages,
    loadingMessage,
    isAnalysisInProgress,
    steeringNotes = [],
    onRemoveSteeringNote,
    isPostMortemInProgress,
    setIsLivePostMortemVisible,
    handleCancelAnalysis,
    onRetryFailedRun,
    onEditUserMessage,
    onDeleteMessages,
    // ChatInput Props
    images,
    removeImage,
    leverageInput,
    handleLeverageChange,
    handleLeverageBlur,
    handlePresetLeverage,
    fileInputRef,
    isImageUploadDisabled,
    handleImageUpload,
    input,
    setInput,
    handleSendMessage,
    isSummarizing,
    isAnyProviderEnabled,
    isAccuracyModeEnabled,
    accuracySubMode,
    providers,
    onUpdateProvider,
    selectedVisionModel,
    setSelectedVisionModel,
    lensConfig,
    setLensConfig,
    ensembleModelSelection,
    setEnsembleModelSelection,
    customEnsemblePrompt,
    setCustomEnsemblePrompt,
    customLensPrompts,
    setCustomLensPrompts,
    isEnsembleEnabled,
    setIsEnsembleEnabled,
    selectedChatModel,
    regimeProviderStats,
    setSelectedChatModel,
    moderatorProviderId,
    moderatorModel,
    onSetModeratorProvider,
    onSetModeratorModel,
    hybridData,
    isHybridLoading,
    hybridConnectionStatus,
    hideHybridPanel,
    slOptimization,
    suggestedEntryPrice,
    entryTimingScore,
    onOpenSettings,
    onOpenLiveMarket,
    onInteract,
    onSelectMessageForProbability,
    homeDashboard,
    analysisSteps,
    isAnalysisActive
}) => {
    const [isSelectionMode, setIsSelectionMode] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [viewerImageUrl, setViewerImageUrl] = useState<string | null>(null);
    const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
    // User scrolled away mid-stream: keep followOutput off until they
    // explicitly return to the bottom (button or scroll-down gesture).
    const followLockedRef = useRef(false);
    const lastUserScrollUpRef = useRef(false);
    const touchYRef = useRef<number | null>(null);

    useEffect(() => {
        const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
        const updateMotionPreference = () => setPrefersReducedMotion(mediaQuery.matches);
        updateMotionPreference();
        mediaQuery.addEventListener('change', updateMotionPreference);
        return () => mediaQuery.removeEventListener('change', updateMotionPreference);
    }, []);

    useEffect(() => {
        if (!highlightedAnalysisId) return;
        const index = messages.findIndex(m => m.id === highlightedAnalysisId);
        if (index < 0) return;
        virtuosoRef.current?.scrollIntoView({ index, align: 'center', behavior: 'smooth' });
    }, [highlightedAnalysisId, messages, virtuosoRef]);

    const pausedDebate = useMemo(() => {
        if (isAnalysisInProgress) return null;
        return messages.find(m =>
            !m.analysis
            && !m.isDebating
            && !m.isPostMortem
            && (m.debateCheckpoint || (m.debateTurns && m.debateTurns.length > 0))
        ) ?? null;
    }, [isAnalysisInProgress, messages]);

    const lockFollowIfScrollingUp = useCallback((deltaY: number): void => {
        if (deltaY < 0) {
            followLockedRef.current = true;
            lastUserScrollUpRef.current = true;
            return;
        }
        if (deltaY > 0) lastUserScrollUpRef.current = false;
    }, []);

    const scrollToLiveBottom = useCallback((): void => {
        followLockedRef.current = false;
        lastUserScrollUpRef.current = false;
        handleScrollToBottom();
    }, [handleScrollToBottom]);

    const wasAnalysisInProgressRef = useRef(false);
    useEffect(() => {
        if (isAnalysisInProgress && !wasAnalysisInProgressRef.current) {
            followLockedRef.current = false;
            lastUserScrollUpRef.current = false;
        }
        wasAnalysisInProgressRef.current = isAnalysisInProgress;
    }, [isAnalysisInProgress]);

    const handleToggleSelection = useCallback((id: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    }, []);

    const handleSelectAll = useCallback(() => {
        if (selectedIds.size === messages.length) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(messages.map(m => m.id)));
        }
    }, [messages, selectedIds]);

    const handleDeleteSelected = useCallback(() => {
        onDeleteMessages(Array.from(selectedIds));
        setSelectedIds(new Set());
        setIsSelectionMode(false);
    }, [selectedIds, onDeleteMessages]);

    const handleCancelSelection = useCallback(() => {
        setIsSelectionMode(false);
        setSelectedIds(new Set());
    }, []);

    // P1-6b: depend on the LAST MESSAGE ID (a primitive) instead of the whole
    // `messages` array — a streaming chunk grows the last message's text but
    // not its id, so enhancedContext (and every memoized MessageItem) stays
    // stable and only the streaming card re-renders.
    const latestMessageId = messages[messages.length - 1]?.id ?? null;
    const priorAnalysisById = useMemo(() => {
        const map: Record<string, NonNullable<typeof messages[number]['analysis']>> = {};
        let prev: (typeof messages)[number]['analysis'];
        for (const m of messages) {
            if (!m.analysis) continue;
            if (prev) map[m.id] = prev;
            prev = m.analysis;
        }
        return map;
    }, [messages]);
    // The user prompt that started each run — the thread view renders it as
    // the "You" bubble at the top of the debate thread.
    const priorUserMessageById = useMemo(() => {
        const map: Record<string, Pick<Message, 'text' | 'createdAt'>> = {};
        let lastUser: (typeof messages)[number] | undefined;
        for (const m of messages) {
            if (m.role === MessageRole.USER) { lastUser = m; continue; }
            if (lastUser) map[m.id] = { text: lastUser.text, createdAt: lastUser.createdAt };
        }
        return map;
    }, [messages]);
    const enhancedContext = useMemo(() => ({
        ...chatContext,
        latestMessageId,
        priorAnalysisById,
        priorUserMessageById,
        isSelectionMode,
        selectedMessageIds: selectedIds,
        onToggleMessageSelection: handleToggleSelection,
        onViewImage: (url: string) => setViewerImageUrl(url),
        onSelectMessageForProbability,
        onRetryFailedRun,
        onEditUserMessage,
    }), [chatContext, latestMessageId, priorAnalysisById, priorUserMessageById, isSelectionMode, selectedIds, handleToggleSelection, onSelectMessageForProbability, onRetryFailedRun, onEditUserMessage]);

    // Fresh sessions start with zero messages (no hardcoded intro bubble),
    // so no intro-text substitution is needed — messages pass through as-is.
    const processedMessages = messages;

    // Fresh-session hero: time-of-day serif greeting.
    // Late-evening variant ("Up late") starts at 22:00.
    const heroGreeting = useMemo(() => {
        const hour = new Date().getHours();
        const part = hour < 5 ? 'Up late' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : hour < 22 ? 'Good evening' : 'Up late';
        let name = '';
        try {
            const raw = localStorage.getItem('last_active_user') || '';
            name = raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : '';
        } catch {
            // localStorage unavailable — fall through with empty name.
        }
        return name ? `${part}, ${name}` : `${part}.`;
    }, []);

    // Shared ChatInput props — the composer renders either inside the
    // fresh-session hero canvas (centered) or docked at the bottom. Memoized
    // so the React.memo'd ChatInput skips re-renders when only the message
    // list changed (chatInputProps was a fresh object literal every render).
    const chatInputProps = useMemo(() => ({
        images,
        removeImage,
        leverageInput,
        handleLeverageChange,
        handleLeverageBlur,
        handlePresetLeverage,
        fileInputRef,
        isImageUploadDisabled,
        handleImageUpload,
        input,
        setInput,
        handleSendMessage,
        handleCancelAnalysis,
        loadingMessage,
        isSummarizing,
        isAnalysisInProgress,
        steeringNotes,
        onRemoveSteeringNote,
        isRateLimited,
        isAnyProviderEnabled,
        providers,
        onUpdateProvider,
        selectedVisionModel,
        setSelectedVisionModel,
        lensConfig,
        setLensConfig,
        ensembleModelSelection,
        setEnsembleModelSelection,
        customEnsemblePrompt,
        setCustomEnsemblePrompt,
        customLensPrompts,
        setCustomLensPrompts,
        isEnsembleEnabled,
        setIsEnsembleEnabled,
        selectedChatModel,
        setSelectedChatModel,
        regimeProviderStats,
        moderatorProviderId,
        moderatorModel,
        onSetModeratorProvider,
        onSetModeratorModel,
        onOpenSettings,
        onOpenLiveMarket,
        isAccuracyModeEnabled,
        hybridConnectionStatus,
        hybridData,
    }), [
        images, removeImage,
        leverageInput, handleLeverageChange, handleLeverageBlur,
        handlePresetLeverage, fileInputRef,
        isImageUploadDisabled, handleImageUpload, input, setInput,
        handleSendMessage, handleCancelAnalysis, loadingMessage, isSummarizing,
        isAnalysisInProgress, steeringNotes, onRemoveSteeringNote, isRateLimited, isAnyProviderEnabled, providers,
        onUpdateProvider, selectedVisionModel, setSelectedVisionModel,
        lensConfig, setLensConfig, ensembleModelSelection,
        setEnsembleModelSelection, customEnsemblePrompt,
        setCustomEnsemblePrompt, customLensPrompts, setCustomLensPrompts,
        isEnsembleEnabled, setIsEnsembleEnabled, selectedChatModel,
        setSelectedChatModel, regimeProviderStats,
        moderatorProviderId, moderatorModel, onSetModeratorProvider, onSetModeratorModel,
        onOpenSettings, onOpenLiveMarket, isAccuracyModeEnabled,
        hybridConnectionStatus, hybridData,
    ]);

    return (
        <div
            className={`flex-1 relative min-h-0 flex flex-col bg-zinc-950 transition-colors duration-500`}
            onClick={onInteract}
            onTouchStart={onInteract}
        >
            {/* Selection Toolbar */}
            {isSelectionMode ? (
                <div className="absolute top-4 left-4 right-4 z-40 bg-zinc-900 border border-white/10 rounded-xl p-3 flex items-center justify-between shadow-2xl animate-fade-in">
                    <div className="flex items-center gap-3">
                        <button
                            onClick={handleSelectAll}
                            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-colors ${selectedIds.size > 0 && selectedIds.size === messages.length ? 'bg-zinc-700/40 border-white/20 text-zinc-200' : 'bg-zinc-800 border-white/10 text-zinc-400 hover:text-white'}`}
                        >
                            <div className={`w-4 h-4 rounded border flex items-center justify-center ${selectedIds.size > 0 && selectedIds.size === messages.length ? 'bg-zinc-200 border-zinc-200' : 'border-zinc-500'}`}>
                                {selectedIds.size > 0 && selectedIds.size === messages.length && <CheckIcon className="w-3 h-3 text-white" />}
                            </div>
                            <span className="text-xs font-bold uppercase tracking-wider">Select All</span>
                        </button>
                        <span className="text-sm font-medium text-zinc-300 ml-2">{selectedIds.size} Selected</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleDeleteSelected}
                            disabled={selectedIds.size === 0}
                            className="status-surface flex items-center gap-2 px-4 py-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                        >
                            <TrashIcon className="w-4 h-4" />
                            <span className="text-xs font-bold uppercase tracking-wider">Delete</span>
                        </button>
                        <button
                            onClick={handleCancelSelection}
                            className="p-2 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors focus-visible:ring-2 focus-visible:ring-zinc-500"
                            aria-label="Close message selection"
                        >
                            <CloseIcon className="w-5 h-5" />
                        </button>
                    </div>
                </div>
            ) : (
                messages.length > 0 && (
                    <button
                        onClick={() => setIsSelectionMode(true)}
                        className="absolute top-4 right-6 z-30 p-2 bg-zinc-800 text-zinc-400 border border-white/10 rounded-xl shadow-lg hover:bg-zinc-700 hover:text-zinc-200 hover:scale-105 transition-all"
                        title="Manage Messages"
                    >
                        <EditIcon className="w-4 h-4" />
                    </button>
                )
            )}

            <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
                {loadingMessage || (messages.length > 0 ? `${messages.length} messages in conversation` : 'New conversation')}
            </div>

            {messages.length > 0 && (
            <div
                className="h-full w-full min-h-0"
                onWheelCapture={(event) => lockFollowIfScrollingUp(event.deltaY)}
                onTouchStart={(event) => { touchYRef.current = event.touches[0]?.clientY ?? null; }}
                onTouchMove={(event) => {
                    const currentY = event.touches[0]?.clientY;
                    if (touchYRef.current == null || currentY == null) return;
                    lockFollowIfScrollingUp(touchYRef.current - currentY);
                    touchYRef.current = currentY;
                }}
            >
            <Virtuoso
                ref={virtuosoRef}
                data={processedMessages}
                context={enhancedContext}
                computeItemKey={(_, message) => message.id}
                // Per-message error boundary: one message that fails to render
                // (e.g. odd analysis data) collapses to an inline fallback
                // instead of taking the whole app to the black error screen.
                itemContent={(index, message, context) => (
                    <ErrorBoundary compact>
                        <MessageItem message={message} context={context} />
                    </ErrorBoundary>
                )}
                // Follow the stream only while the user is at the bottom.
                // A scroll-up gesture locks follow until they return (button
                // or scroll-down) — growing thinking must not yank them back.
                followOutput={prefersReducedMotion ? false : (isAtBottom) => {
                    if (followLockedRef.current) return false;
                    return isAtBottom ? 'auto' : false;
                }}
                atBottomStateChange={(atBottom) => {
                    setShowScrollDown(!atBottom);
                    if (atBottom && !lastUserScrollUpRef.current) followLockedRef.current = false;
                }}
                atTopStateChange={(atTop) => setShowScrollUp(!atTop && analysisMessages.length > 0)}
                style={{ height: '100%', width: '100%' }}
                className="scrollbar-hide"
                increaseViewportBy={200}
                components={{
                    Header: ListHeader,
                    Footer: () => <ListFooter isLoading={Boolean(loadingMessage)} />
                }}
            />
            </div>
            )}

            {/* Accuracy Mode Banner Overlay - Positioned Fixed/Absolute at top of chat area */}
            {isAccuracyModeEnabled && !isSelectionMode && (
                <div className="absolute top-0 left-0 right-0 pointer-events-none flex justify-center pt-2 z-20">
                    <div className="border px-4 py-1 rounded-full shadow-lg bg-zinc-800 border-white/15">
                        <span className="text-[10px] font-bold uppercase tracking-widest animate-pulse text-zinc-300">
                            {accuracySubMode === 'pure_ai' ? 'Accuracy Mode: Pure AI Reasoning' : 'Accuracy Mode: Strict Protocol'}
                        </span>
                    </div>
                </div>
            )}

            {pausedDebate && chatContext.onResumeDebate && !isSelectionMode && (
                <div className="absolute top-10 left-0 right-0 z-20 flex justify-center px-3 pointer-events-none">
                    <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-white/15 bg-zinc-900 px-3 py-1.5 shadow-lg">
                        <span className="text-[11px] text-zinc-300">Debate paused</span>
                        <button
                            type="button"
                            onClick={() => chatContext.onResumeDebate?.(pausedDebate.id)}
                            className="rounded-full bg-zinc-800 px-2.5 py-0.5 text-[11px] font-semibold text-zinc-100 hover:bg-zinc-700"
                        >
                            Continue
                        </button>
                    </div>
                </div>
            )}

            {isRateLimited && <div className="status-surface absolute top-16 left-4 right-4 z-20 bg-red-500/10 border border-red-500/20 text-red-200 p-4 rounded-xl flex items-center justify-between mb-6 animate-fade-in" role="alert"><span><strong>Rate Limit Exceeded:</strong> Please wait a moment.</span><button onClick={() => setIsRateLimited(false)} aria-label="Dismiss rate limit notice" className="text-red-200 hover:text-white ml-4"><CloseIcon /></button></div>}

            <div className="fixed bottom-28 right-6 z-30 flex flex-col gap-2">
                {showScrollUp && !isSelectionMode && (
                    <button
                        onClick={handleCycleAnalysisUp}
                        className="w-9 h-9 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white border border-zinc-700/50 rounded-full shadow-lg flex items-center justify-center transition-all hover:scale-105"
                        aria-label="Cycle to previous analysis"
                        title={highlightedAnalysisId ? "Jump to previous analysis" : "Jump to latest analysis"}
                    >
                        <ArrowUpIcon className="h-4 w-4" />
                    </button>
                )}
                {showScrollDown && !isSelectionMode && (
                    <button
                        onClick={scrollToLiveBottom}
                        className="w-9 h-9 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white border border-zinc-700/50 rounded-full shadow-lg flex items-center justify-center transition-all hover:scale-105"
                        aria-label="Scroll to bottom"
                        title="Scroll to bottom"
                    >
                        <ArrowDownIcon className="h-4 w-4" />
                    </button>
                )}
            </div>

            {/* Hybrid Intelligence Connection Status - Always visible */}
            <HybridDataPanel
                data={hybridData}
                isLoading={isHybridLoading}
                connectionStatus={hybridConnectionStatus}
                hidden={hideHybridPanel}
                slOptimization={slOptimization}
                suggestedEntryPrice={suggestedEntryPrice}
                entryTimingScore={entryTimingScore}
            />

            {/* Progress panel + Stop stay visible through the whole run —
                loadingMessage goes null when the debate starts, but the user
                must still be able to cancel mid-debate. */}
            {(loadingMessage || (isAnalysisInProgress && !isPostMortemInProgress)) ? (
                <>
                <div className="absolute bottom-[calc(env(safe-area-inset-bottom)+8rem)] sm:bottom-[calc(env(safe-area-inset-bottom)+8.5rem)] left-0 right-0 p-2 sm:p-4 pointer-events-none z-10 lg:hidden">
                    <div className="max-w-4xl mx-auto pointer-events-auto lg:max-w-none">
                        {analysisSteps && analysisSteps.length > 0 ? (
                            /* The old step rail + pipeline panel are
                               gone — one quiet pill keeps the cancel affordance
                               while the stage bots + side panel show the run. */
                            <div className="flex justify-center">
                                <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-white/10 bg-zinc-900 px-4 py-2 shadow-lg">
                                    <span className="streaming-dots" aria-hidden="true"><span /><span /><span /></span>
                                    <span className="text-xs text-zinc-400">{loadingMessage || 'Debate in progress'}</span>
                                    {isPostMortemInProgress ? (
                                        <button onClick={() => setIsLivePostMortemVisible(true)} className="text-xs text-zinc-200 hover:text-white">View Post-Mortem</button>
                                    ) : (
                                        <button onClick={handleCancelAnalysis} className="status-surface text-xs text-rose-300 hover:text-rose-200">Stop</button>
                                    )}
                                </div>
                            </div>
                        ) : (
                            /* Fallback: original spinner overlay when no step data */
                                <div className="flex flex-col items-center justify-center p-6 glass rounded-2xl shadow-[0_0_50px_-12px_rgba(176, 176, 182,0.2)] animate-fade-in border-t border-white/10">
                                    <div className="relative">
                                        <div className="absolute inset-0 blur-xl opacity-20 animate-pulse bg-zinc-400"></div>
                                        <LoadingIcon className="h-8 w-8 relative z-10 text-zinc-300" />
                                    </div>
                                <div className="mt-3 flex items-center gap-2 text-zinc-300" aria-live="polite">
                                    <BrainIcon className="h-4 w-4" />
                                    <span className="text-sm font-medium">Thinking</span>
                                    <span className="flex gap-1" aria-hidden="true"><i className="h-1.5 w-1.5 rounded-full bg-zinc-400 animate-bounce [animation-delay:-0.2s]" /><i className="h-1.5 w-1.5 rounded-full bg-zinc-400 animate-bounce [animation-delay:-0.1s]" /><i className="h-1.5 w-1.5 rounded-full bg-zinc-400 animate-bounce" /></span>
                                </div>
                                <p className="mt-1 text-xs text-zinc-500">{loadingMessage}</p>
                                <div className="flex items-center gap-4 mt-4">
                                    {isPostMortemInProgress && <button onClick={() => setIsLivePostMortemVisible(true)} className="flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 border border-white/15 text-zinc-300 font-medium py-1.5 px-4 rounded-full text-xs transition-all uppercase tracking-wide"><EyeIcon />View Post-Mortem</button>}
                                    <button onClick={handleCancelAnalysis} className="status-surface bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-300 font-medium py-1.5 px-4 rounded-full text-xs transition-all uppercase tracking-wide">Stop generating</button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
                <ChatInput {...chatInputProps} />
                </>
            ) : messages.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center bg-zinc-950 px-4 py-10">
                    {/* Home hero: serif greeting ALONE on the page
                        background — no spark/asterisk mark beside it. */}
                    <div className="mb-10 flex items-center justify-center">
                        <h1 className="text-center font-serif text-[32px] tracking-tight text-white sm:text-[40px]">
                            {heroGreeting}
                        </h1>
                    </div>
                    <div className="w-full max-w-[680px]">
                        <ChatInput {...chatInputProps} centered />
                    </div>
                </div>
            ) : (
                <ChatInput {...chatInputProps} />
            )}

            {/* Image Viewer Modal */}
            <ImageViewerModal
                imageUrl={viewerImageUrl}
                onClose={() => setViewerImageUrl(null)}
            />
        </div>
    );
};

export const ChatArea = React.memo(ChatAreaInner);
